# journal_routes.py - Rutas del journal de la suite (paso 4): imagenes, contexto de decision, medidas, lectura de la
# regla del laboratorio e informe. Los hechos de cada trade los da el bot (/api/bot/journal); aqui se suma lo del
# Observador de App 1.
from typing import Optional

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

import journal_measures
import journal_reading
from journal_store import ORDER_ID_RE, TRADE_ID_RE, JournalStore

REPORT_BATCH = 8  # medidas que el informe calcula por pedido (cada una pide velas a Bybit); el resto en la siguiente
READING_BATCH = 8  # lecturas de la regla por pedido del informe (cada una lee hasta 46 dias del almacen)


def _fresh_measures(m) -> bool:
    """Medidas guardadas que no hay que volver a calcular: de un trade cerrado y de la version actual."""
    return bool(m and m.get("complete") and m.get("version") == journal_measures.MEASURES_VERSION)


def make_router(store: JournalStore, bot) -> APIRouter:
    """bot(method, path, **kw) llama al bot y devuelve su JSON."""
    r = APIRouter()

    # ---------- imagenes (el mismo contrato que App 1: MiniChart.captureScreenshot las sube aqui) ----------
    @r.post("/api/screenshots/session/{session_id}")
    async def save_screenshot(session_id: str, file: UploadFile = File(...)):
        content = await file.read()
        try:
            path = store.save_image(session_id, content)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        return {"success": True, "screenshotPath": path, "metadata": {"size": len(content)}}

    @r.get("/api/screenshots/session/{session_id}/{filename}")
    async def get_screenshot(session_id: str, filename: str):
        path = store.image_path(session_id, filename)
        if not path:
            raise HTTPException(status_code=404, detail="imagen no encontrada")
        return FileResponse(path, media_type="image/png")

    # ---------- contexto: decision (panel), apertura y cierre (imagenes) ----------
    @r.post("/api/journal/context")
    async def add_context(request: Request):
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="cuerpo JSON invalido")
        try:
            event = store.add_context(body)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        return {"success": True, "context": event}

    @r.get("/api/journal/decision")
    async def decision(order_id: Optional[str] = None, order_link_id: Optional[str] = None):
        """La decision de una orden de Bybit: al cancelar una Limit del panel, lo elegido para ella vuelve a la lista."""
        for value in (order_id, order_link_id):
            if value is not None and not ORDER_ID_RE.match(value):
                raise HTTPException(status_code=400, detail="orden invalida")
        if not order_id and not order_link_id:
            raise HTTPException(status_code=400, detail="falta order_id u order_link_id")
        return {"success": True, "decision": store.decision_for(order_id, order_link_id)}

    async def trades(days: int):
        data = await bot("GET", "/api/journal/trades", params={"days": days})
        return store.merge(data.get("trades") or [])

    async def measures_for(trade):
        cached = store.measures_get(trade["trade_id"])
        if _fresh_measures(cached):
            return cached
        result = await journal_measures.trade_measures(trade)
        if result.get("available") and result.get("complete"):
            store.measures_put(trade["trade_id"], result)  # cerrado: ya no cambia
        return result

    async def trade_by_id(trade_id: str):
        trade = next((t for t in await trades(3650) if t.get("trade_id") == trade_id), None)
        if trade is None:
            raise HTTPException(status_code=404, detail="trade no encontrado")
        return trade

    # ---------- medidas de un trade ----------
    @r.get("/api/journal/measures/{trade_id}")
    async def trade_measures(trade_id: str):
        if not TRADE_ID_RE.match(trade_id):
            raise HTTPException(status_code=400, detail="trade invalido")
        cached = store.measures_get(trade_id)
        if _fresh_measures(cached):
            return {"success": True, "cached": True, **cached}
        return {"success": True, "cached": False, **(await measures_for(await trade_by_id(trade_id)))}

    @r.get("/api/journal/catalog")
    async def catalog():
        return {"success": True, "measures": journal_measures.catalog()}

    # ---------- analisis post-trade: la capa de dibujos de cada trade (13/11/2026) ----------
    @r.get("/api/journal/analysis/{trade_id}/drawings")
    async def analysis_drawings(trade_id: str):
        if not TRADE_ID_RE.match(trade_id):
            raise HTTPException(status_code=400, detail="trade invalido")
        return {"success": True, "shapes": store.analysis_drawings_get(trade_id)}

    @r.post("/api/journal/analysis/{trade_id}/drawings")
    async def save_analysis_drawings(trade_id: str, request: Request):
        if not TRADE_ID_RE.match(trade_id):
            raise HTTPException(status_code=400, detail="trade invalido")
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="cuerpo JSON invalido")
        try:
            count = store.analysis_drawings_put(trade_id, body.get("shapes") if isinstance(body, dict) else None)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        return {"success": True, "count": count}

    @r.delete("/api/journal/analysis/{trade_id}/image")
    async def delete_analysis_image(trade_id: str, image: str = ""):
        """Borra una imagen del analisis post-trade de ese trade (solo de analisis). La pagina pide confirmacion antes"""
        try:
            store.remove_analysis_image(trade_id, image)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except KeyError as e:
            raise HTTPException(status_code=404, detail=str(e.args[0]) if e.args else "imagen no encontrada")
        return {"success": True}

    # ---------- lectura de la regla del laboratorio (como el Observador de App 1: solo con el trade cerrado) ----------
    @r.get("/api/journal/reading/{trade_id}")
    async def trade_reading(trade_id: str):
        if not TRADE_ID_RE.match(trade_id):
            raise HTTPException(status_code=400, detail="trade invalido")
        cached = store.readings_get(trade_id)
        if cached and cached.get("version") == journal_reading.READING_VERSION:
            return {"success": True, "cached": True, **cached}
        trade = await trade_by_id(trade_id)
        if trade.get("status") != "closed":
            return {"success": True, "available": False, "hidden": True,
                    "reason": "La lectura de la regla se ve cuando el trade se cierra, como en el Observador de App 1."}
        return {"success": True, "cached": False, **(await journal_reading.reading_for(store, trade))}

    # ---------- informe: que distingue a las ganadoras de las perdedoras (como el Observador) ----------
    @r.get("/api/journal/report")
    async def report(days: int = 90):
        try:
            import patterns  # App 1
        except Exception as e:  # pragma: no cover - sin el backend de App 1
            raise HTTPException(status_code=503, detail=f"informe no disponible: {e}")
        closed = [t for t in await trades(max(1, min(days, 3650))) if t.get("status") == "closed" and t.get("pnl") is not None]
        winners, losers, without, pending, computed = [], [], 0, 0, 0
        for t in closed:
            m = store.measures_get(t["trade_id"])
            if not _fresh_measures(m):
                if m is None and (t.get("pre_existing") or not t.get("opened_at")):
                    without += 1
                    continue
                if computed < REPORT_BATCH:
                    computed += 1
                    again = await measures_for(t)
                    # Si no se pudo volver a calcular, sirven las de la version anterior (solo les falta delta y OI)
                    m = again if again.get("available") or m is None else m
                elif m is None:
                    pending += 1
                    continue
            if not m.get("available"):
                without += 1
                continue
            (winners if t["pnl"] > 0 else losers).append(m["decision"])
        labels = {k["key"]: (k["label"], k["group"]) for k in journal_measures.catalog()}
        comparison = (patterns.compare_groups(winners, losers, list(labels), labels)
                      if winners and losers else {"rows": [], "threshold": None})
        return {
            "success": True, "closed": len(closed), "winners": len(winners), "losers": len(losers),
            "without_measures": without, "pending": pending,
            "small_sample": min(len(winners), len(losers)) < patterns.MIN_GROUP or len(winners) + len(losers) < 30,
            **comparison,
            "rule": await rule_report(closed),
        }

    async def rule_report(closed):
        """
        Lo que leia la regla del laboratorio en los trades cerrados, con las tablas del informe del Observador de App 1
        (sus funciones, sin copiarlas). Solo con lecturas completas: una parcial (la moneda tiene menos de 45 dias
        grabados antes de la decision) contaria como ausente lo que la regla no pudo ver.
        """
        import observer  # App 1
        group, partial, without, pending, computed = [], 0, 0, 0, 0
        for t in closed:
            cached = store.readings_get(t["trade_id"])
            if cached and cached.get("version") == journal_reading.READING_VERSION:
                reading = cached
            elif journal_reading.reading_time(t) is None:
                without += 1
                continue
            elif computed < READING_BATCH:
                computed += 1
                reading = await journal_reading.reading_for(store, t)
            else:
                pending += 1
                continue
            if not reading.get("available"):
                without += 1
            elif not reading.get("complete"):
                partial += 1
            else:
                group.append(journal_reading.as_observer_trade(t, reading["reading"]))
        entries = [item["reading"]["entry"] for item in group if item["reading"].get("entry")]
        return {
            "complete": len(group), "partial": partial, "without": without, "pending": pending,
            "small_sample": len(group) < observer.SMALL_SAMPLE,
            "overall": observer._stats(group),
            "conditions": [observer._condition_row(key, label, group, check) for key, label, check in observer.CONDITIONS],
            "habits": observer._habits(group),
            "zones": {
                "orders": len(entries), "near": sum(bool(entry["near"]) for entry in entries),
                "chance": sum(entry["chance"] for entry in entries) / len(entries) if entries else None,
            },
            "best_worst": observer._best_and_worst(group),
        }

    return r
