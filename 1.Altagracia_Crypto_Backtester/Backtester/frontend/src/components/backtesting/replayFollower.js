/**
 * Hora que muestra el segundo gráfico.
 *
 * La principal informa la hora de su pantalla unas 9 veces por segundo mientras reproduce (o más
 * espaciado si el navegador la frena). A 10000x cada informe trae 19 minutos de golpe: dibujados tal cual,
 * las velas de un marco chico aparecen completas y el gráfico avanza a saltos. Aquí se decide qué hora
 * dibujar en cada cuadro de la pantalla:
 * - nunca una hora posterior a la última informada: el segundo gráfico no se adelanta a la principal;
 * - si un informe avanza más de un minuto, la hora mostrada recorre ese tramo a la velocidad de la
 *   reproducción en vez de saltar. Va un informe detrás (una décima de segundo) y llega a cada hora
 *   informada cuando está por llegar la siguiente;
 * - en pausa, al retroceder o con un salto grande va directo a la hora informada.
 *
 * Mientras recorre un tramo la hora mostrada cae en minutos enteros: la vela en formación se arma con
 * velas de 1 minuto ya cerradas. Es lógica pura, sin navegador, para probarla en Node.
 */

export const MINUTE_MS = 60000;

const SNAP_AHEAD_MS = 3000;  // Un informe con más de 3 s reales de reproducción por delante es un salto
const MIN_SLACK_MS = 34;     // Atraso normal mínimo: dos cuadros de 60 Hz
const MAX_BOOST = 4;         // Cuánto se puede acelerar para alcanzar a la principal
const INTERVAL_WEIGHT = 0.3; // Peso del último intervalo entre informes en el promedio

export function createFollower() {
  let target = null;       // Última hora informada por la principal
  let shown = null;        // Hora mostrada, continua. Nunca pasa de target
  let playing = false;
  let speed = 0;           // Velocidad de la reproducción: ms simulados por ms real
  let interval = 0;        // Promedio de ms reales entre informes que avanzan
  let lastReportAt = null;
  let lastFrameAt = null;
  let stepMs = MINUTE_MS;  // Paso del reloj de la principal: dentro de un paso no hay nada que recorrer
  let returned = null;     // Última hora entregada: no baja mientras la principal no retroceda

  const snap = (time, now) => {
    shown = time;
    returned = time;
    lastFrameAt = now;
    lastReportAt = null; // El intervalo entre informes se mide de nuevo: una pausa no cuenta como intervalo
    interval = 0;
  };

  return {
    /** Informe de la principal: { time, playing, speed, step }. "now" es el reloj real de esta pestaña, en ms */
    report(clock, now) {
      const time = clock?.time;
      if (!Number.isFinite(time)) return;

      const advanced = target !== null && time > target;
      if (advanced && lastReportAt !== null && now > lastReportAt) {
        const gap = Math.min(now - lastReportAt, SNAP_AHEAD_MS);
        interval = interval ? interval * (1 - INTERVAL_WEIGHT) + gap * INTERVAL_WEIGHT : gap;
      }
      if (advanced || target === null) lastReportAt = now;

      const wasCaughtUp = shown !== null && shown >= target;
      playing = clock.playing === true;
      speed = Number.isFinite(clock.speed) && clock.speed > 0 ? clock.speed : 0;
      stepMs = Number.isFinite(clock.step) && clock.step > MINUTE_MS ? clock.step : MINUTE_MS;
      target = time;

      const ahead = shown === null ? 0 : time - shown;
      const follows = shown !== null && playing && speed > 0
        && ahead > stepMs                                 // Un solo paso del reloj no tiene estados intermedios
        && ahead <= Math.max(speed * SNAP_AHEAD_MS, stepMs);
      if (!follows) {
        // Primera hora, pausa, retroceso, salto, o un avance que no necesita recorrido
        const steady = playing && ahead > 0 && ahead <= stepMs;
        const keep = steady ? [lastReportAt, interval] : null;
        snap(time, now);
        if (keep) [lastReportAt, interval] = [now, keep[1]]; // Sigue reproduciendo paso a paso: el ritmo se conserva
        return;
      }
      // Estaba al día: el tramo se empieza a recorrer desde este informe, no desde el último cuadro
      if (wasCaughtUp) lastFrameAt = now;
    },

    /** Hora a dibujar en este cuadro, o null si la principal todavía no informó */
    frame(now) {
      if (shown === null) return null;
      const elapsed = lastFrameAt === null ? 0 : Math.max(0, now - lastFrameAt);
      lastFrameAt = now;
      if (shown >= target) return (returned = target);

      if (!playing || !(speed > 0)) {
        shown = target;
        return (returned = target);
      }
      // Atraso en ms reales de reproducción. Lo normal es ir un informe detrás; con más, acelera
      const behind = (target - shown) / speed;
      const slack = Math.max(interval * 1.5, MIN_SLACK_MS);
      const boost = behind > slack ? Math.min(MAX_BOOST, behind / slack) : 1;
      shown = Math.min(target, shown + elapsed * speed * boost);
      if (shown >= target) return (returned = target);
      // Cae en múltiplos del paso (minutos enteros con velas de 1 minuto) y nunca por debajo de lo ya entregado
      const floored = Math.floor(shown / stepMs) * stepMs;
      returned = returned === null ? floored : Math.max(returned, floored);
      return returned;
    },

    /** ¿Hace falta otro cuadro? Solo mientras queda tramo por recorrer */
    pending() {
      return shown !== null && shown < target;
    },

    reset() {
      target = null;
      shown = null;
      playing = false;
      speed = 0;
      interval = 0;
      lastReportAt = null;
      lastFrameAt = null;
      stepMs = MINUTE_MS;
      returned = null;
    },

    /** Para pruebas y para la medición en pantalla */
    state() {
      return { target, shown, playing, speed, interval };
    }
  };
}

const QUIET_MS = 1500;  // Sin avanzar este tiempo, otra principal que avanza toma el lugar
const SILENT_MS = 15000; // Sin ningún mensaje este tiempo, la principal se cerró. Tres veces el latido del 2.º gráfico

/**
 * Con dos pestañas principales abiertas (una vieja, o la misma recargada) el segundo gráfico sigue una
 * sola: si atendiera a las dos saltaría entre sus horas. Pasa a otra cuando la que seguía dejó de
 * informar, o cuando la otra avanza y la que seguía está quieta.
 */
export function createSourcePicker() {
  let current = null;
  let movedAt = -Infinity; // Última vez que avanzó la principal que se sigue
  let seenAt = -Infinity;  // Último mensaje suyo
  let currentPlaying = false;
  const last = new Map();  // Principal → última hora que informó

  return {
    /** { follow, changed }: si el informe es de la principal que se sigue, y si acaba de cambiar a ella */
    accept(source, time, now, playing = false) {
      const id = source ?? 'sin-id';
      const previous = last.get(id);
      last.set(id, time);
      const moved = previous !== undefined && previous !== time;

      if (id === current) {
        seenAt = now;
        currentPlaying = playing === true;
        if (moved) movedAt = now;
        return { follow: true, changed: false };
      }
      // Una que reproduce no cede por el avance de otra: a 1x pasa un minuto entre dos avances suyos
      const takesOver = current === null
        || now - seenAt > SILENT_MS
        || (moved && !currentPlaying && now - movedAt > QUIET_MS);
      if (!takesOver) return { follow: false, changed: false };

      current = id;
      currentPlaying = playing === true;
      seenAt = now;
      movedAt = moved ? now : -Infinity;
      return { follow: true, changed: true };
    },

    /** La principal avisó que se cierra: la próxima que informe toma su lugar */
    release(source) {
      if ((source ?? 'sin-id') !== current) return;
      current = null;
      movedAt = -Infinity;
      seenAt = -Infinity;
    },

    current: () => current
  };
}
