// redrawPacer.js - Ritmo máximo de dibujo de un gráfico en vivo (13/11/2026).
//
// En vivo, cada precio de Bybit pide un dibujo: unas 10 veces por segundo por moneda. Con muchos gráficos a la vez
// (la Watchlist de la suite) eso ocupa la página. El pacer junta los pedidos y dibuja a lo sumo uno cada `waitMs`:
// la suite usa 500 ms para los gráficos a la vista y 30 s para los que no se ven. Los datos siguen llegando igual;
// solo se dibuja menos. Sin ritmo (waitMs vacío o 0) dibuja en el cuadro siguiente, como siempre. App 1 no lo usa.
export function createRedrawPacer(draw, {
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  frame = (fn) => requestAnimationFrame(fn),
} = {}) {
  let timer = null;
  let framePending = false;
  let last = -Infinity;
  const run = () => {
    timer = null;
    framePending = false;
    last = now();
    draw();
  };
  return {
    /** Un precio o una vela nuevos: dibuja ahora si pasó el ritmo, o cuando pase */
    request(waitMs) {
      if (!waitMs) {
        if (framePending) return;
        framePending = true;
        frame(run);
        return;
      }
      if (timer !== null || framePending) return; // ya hay un dibujo programado
      timer = setTimer(run, Math.max(0, last + waitMs - now()));
    },
    /** El ritmo cambió (un gráfico que se vuelve visible): lo pendiente se dibuja ya */
    flush() {
      if (timer === null) return;
      clearTimer(timer);
      run();
    },
    cancel() {
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
    pending: () => timer !== null || framePending,
  };
}
