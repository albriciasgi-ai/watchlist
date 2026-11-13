# journal_routes.py - Rutas del journal de la suite (paso 4): imagenes, contexto de decision, medidas e informe.
# Los hechos de cada trade los da el bot (/api/bot/journal); aqui se suma lo del Observador de App 1.
from typing import Optional

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

import journal_measures
from journal_store import ORDER_ID_RE, TRADE_ID_RE, JournalStore

REPORT_BATCH = 8  # medidas que el informe calcula por pedido (cada una pide velas a Bybit); el resto en la siguiente


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
        if cached and cached.get("complete"):
            return cached
        result = await journal_measures.trade_measures(trade)
        if result.get("available") and result.get("complete"):
            store.measures_put(trade["trade_id"], result)  # cerrado: ya no cambia
        return result

    # ---------- medidas de un trade ----------
    @r.get("/api/journal/measures/{trade_id}")
    async def trade_measures(trade_id: str):
        if not TRADE_ID_RE.match(trade_id):
            raise HTTPException(status_code=400, detail="trade invalido")
        cached = store.measures_get(trade_id)
        if cached and cached.get("complete"):
            return {"success": True, "cached": True, **cached}
        trade = next((t for t in await trades(3650) if t.get("trade_id") == trade_id), None)
        if trade is None:
            raise HTTPException(status_code=404, detail="trade no encontrado")
        return {"success": True, "cached": False, **(await measures_for(trade))}

    @r.get("/api/journal/catalog")
    async def catalog():
        return {"success": True, "measures": journal_measures.catalog()}

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
            if m is None:
                if t.get("pre_existing") or not t.get("opened_at"):
                    without += 1
                    continue
                if computed >= REPORT_BATCH:
                    pending += 1
                    continue
                m = await measures_for(t)
                computed += 1
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
        }

    return r
