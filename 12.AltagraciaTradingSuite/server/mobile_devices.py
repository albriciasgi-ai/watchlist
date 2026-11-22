# mobile_devices.py - Celulares emparejados con la suite y sus pedidos firmados (puerta movil, 21/11/2026).
#
# Emparejar: la suite crea un dispositivo pendiente con un secreto al azar y lo muestra una sola vez (un QR en la
# pantalla del PC). El secreto nunca viaja por la red: el celular lo lee de la pantalla y firma con el cada pedido.
# El primer pedido bien firmado, antes de que venza el emparejamiento, lo deja activo.
#
# Firma de cada pedido (cabeceras):
#   X-Device  id del dispositivo
#   X-Time    hora del celular en ms (se acepta a +-90 s de la del servidor)
#   X-Nonce   16 a 64 caracteres al azar; no se acepta dos veces
#   X-Sign    HMAC-SHA256(secreto, "METODO\nruta?consulta\nX-Time\nX-Nonce\nsha256(cuerpo)") en hexadecimal
# Asi un pedido capturado no se puede repetir ni cambiar. Las claves de Bybit nunca pasan por aqui.
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

DEVICE_RE = re.compile(r"^[a-f0-9]{12}$")
NONCE_RE = re.compile(r"^[A-Za-z0-9_-]{16,64}$")
SIGN_RE = re.compile(r"^[a-f0-9]{64}$")
TOKEN_RE = re.compile(r"^[A-Za-z0-9_:\-.]{20,4096}$")
PAIR_SECONDS = 600          # un emparejamiento sin usar vence a los 10 minutos
TIME_WINDOW_MS = 90_000
MAX_DEVICES = 10
MAX_FAILS = 10              # firmas malas por direccion en un minuto, antes de responder 429


class AuthError(Exception):
    def __init__(self, status: int, detail: str, now: Optional[int] = None):
        super().__init__(detail)
        self.status, self.detail, self.now = status, detail, now


def now_ms() -> int:
    return int(time.time() * 1000)


def signature(secret_hex: str, method: str, target: str, at: str, nonce: str, body: bytes) -> str:
    """La firma que debe mandar el celular. `target` es la ruta con su consulta, tal como se pidio."""
    message = "\n".join((method.upper(), target, str(at), nonce, hashlib.sha256(body or b"").hexdigest()))
    return hmac.new(bytes.fromhex(secret_hex), message.encode("utf-8"), hashlib.sha256).hexdigest()


class DeviceStore:
    def __init__(self, base_dir, clock=now_ms):
        self.path = Path(base_dir) / "devices.json"
        self.clock = clock
        self._lock = threading.Lock()
        self._nonces: Dict[str, Dict[str, int]] = {}
        self._fails: Dict[str, List[int]] = {}
        self._devices: Optional[List[Dict[str, Any]]] = None
        self.error: Optional[str] = None

    # ---------- archivo ----------
    def _load(self) -> List[Dict[str, Any]]:
        if self._devices is None:
            if not self.path.exists():
                self._devices = []
            else:
                try:
                    data = json.loads(self.path.read_text(encoding="utf-8"))
                    self._devices = [d for d in data["devices"] if isinstance(d, dict) and DEVICE_RE.match(str(d.get("id")))]
                    self.error = None
                except Exception as e:
                    # Un archivo danado no se pisa: nadie entra hasta que se arregle o se borre a mano
                    self.error = f"devices.json ilegible: {type(e).__name__}"
                    raise AuthError(503, self.error)
        return self._devices

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_name(self.path.name + ".tmp")
        tmp.write_text(json.dumps({"devices": self._devices}, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(tmp, self.path)

    def _prune(self) -> bool:
        """Quita los emparejamientos que vencieron sin usarse."""
        now = self.clock()
        keep = [d for d in self._devices if d.get("activated_at") or d.get("expires_at", 0) > now]
        changed = len(keep) != len(self._devices)
        self._devices[:] = keep
        return changed

    # ---------- emparejar y revocar (solo desde el PC) ----------
    def pair(self, name: str) -> Dict[str, Any]:
        name = (name or "").strip()
        if not 1 <= len(name) <= 40:
            raise ValueError("nombre de 1 a 40 caracteres")
        with self._lock:
            devices = self._load()
            self._prune()
            if len(devices) >= MAX_DEVICES:
                raise ValueError(f"ya hay {MAX_DEVICES} celulares: revoca uno antes")
            now = self.clock()
            device = {"id": secrets.token_hex(6), "name": name, "secret": secrets.token_hex(32), "created_at": now,
                      "expires_at": now + PAIR_SECONDS * 1000, "activated_at": None, "last_seen": None, "push_token": None}
            devices.append(device)
            self._save()
            return dict(device)

    def revoke(self, device_id: str) -> bool:
        with self._lock:
            devices = self._load()
            keep = [d for d in devices if d["id"] != device_id]
            if len(keep) == len(devices):
                return False
            devices[:] = keep
            self._nonces.pop(device_id, None)
            self._save()
            return True

    def public(self) -> List[Dict[str, Any]]:
        """Los dispositivos sin su secreto ni su token de avisos, para la pantalla del PC."""
        with self._lock:
            devices = self._load()
            if self._prune():
                self._save()
            return [{"id": d["id"], "name": d["name"], "created_at": d["created_at"], "activated_at": d.get("activated_at"),
                     "expires_at": None if d.get("activated_at") else d.get("expires_at"), "last_seen": d.get("last_seen"),
                     "push": bool(d.get("push_token"))} for d in devices]

    # ---------- avisos ----------
    def set_push_token(self, device_id: str, token: Optional[str]) -> None:
        if token is not None and not TOKEN_RE.match(token):
            raise ValueError("token de avisos invalido")
        with self._lock:
            for d in self._load():
                if d["id"] == device_id:
                    d["push_token"] = token
                elif token and d.get("push_token") == token:
                    d["push_token"] = None  # el mismo celular emparejado otra vez: un solo aviso
            self._save()

    def push_tokens(self) -> List[str]:
        with self._lock:
            return [d["push_token"] for d in self._load() if d.get("activated_at") and d.get("push_token")]

    def drop_push_token(self, token: str) -> None:
        """El servicio de avisos dijo que ese token ya no existe (la app se desinstalo)."""
        with self._lock:
            changed = False
            for d in self._load():
                if d.get("push_token") == token:
                    d["push_token"], changed = None, True
            if changed:
                self._save()

    # ---------- firma ----------
    def _fail(self, peer: str, status: int, detail: str):
        now = self.clock()
        recent = [t for t in self._fails.get(peer, []) if now - t < 60_000]
        recent.append(now)
        self._fails[peer] = recent
        if len(self._fails) > 1000:
            self._fails = {k: v for k, v in self._fails.items() if v and now - v[-1] < 60_000}
        return AuthError(status, detail)

    def verify(self, headers, method: str, target: str, body: bytes, peer: str = "") -> Dict[str, Any]:
        """Devuelve el dispositivo si el pedido esta bien firmado; si no, lanza AuthError. No dice que fallo."""
        now = self.clock()
        with self._lock:
            if len([t for t in self._fails.get(peer, []) if now - t < 60_000]) >= MAX_FAILS:
                raise AuthError(429, "demasiados intentos: espera un minuto")
            device_id, at = str(headers.get("x-device") or ""), str(headers.get("x-time") or "")
            nonce, sign = str(headers.get("x-nonce") or ""), str(headers.get("x-sign") or "").lower()
            bad = self._fail  # todo rechazo cuenta como intento
            if not (DEVICE_RE.match(device_id) and at.isdigit() and len(at) <= 15 and NONCE_RE.match(nonce) and SIGN_RE.match(sign)):
                raise bad(peer, 401, "pedido sin firma valida")
            devices = self._load()
            device = next((d for d in devices if d["id"] == device_id), None)
            # Sin dispositivo se compara igual contra un secreto cualquiera: el tiempo de respuesta no lo delata
            expected = signature(device["secret"] if device else "00" * 32, method, target, at, nonce, body)
            if not hmac.compare_digest(expected, sign) or device is None:
                raise bad(peer, 401, "pedido sin firma valida")
            if abs(now - int(at)) > TIME_WINDOW_MS:
                # La firma ya coincidio: es un celular emparejado con el reloj corrido. Se le dice la hora del
                # servidor para que corrija y repita (no cuenta como intento malo)
                raise AuthError(401, "la hora del celular no coincide con la del servidor", now=now)
            if not device.get("activated_at") and device.get("expires_at", 0) <= now:
                raise bad(peer, 401, "el emparejamiento vencio: crea otro en la suite")
            seen = self._nonces.setdefault(device_id, {})
            for key in [k for k, t in seen.items() if now - t > 2 * TIME_WINDOW_MS]:
                del seen[key]
            if nonce in seen:
                raise bad(peer, 401, "pedido repetido")
            seen[nonce] = now
            first = not device.get("activated_at")
            if first:
                device["activated_at"] = now
            # last_seen se guarda a lo sumo una vez por minuto: la app pregunta cada pocos segundos
            if first or now - (device.get("last_seen") or 0) > 60_000:
                device["last_seen"] = now
                self._save()
            return {"id": device["id"], "name": device["name"], "first": first}
