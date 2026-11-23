import React, { useCallback, useEffect, useRef, useState } from 'react';
import { gateGet, gatePost } from './lib/gate.js';
import { directBalance, directPositions } from './lib/bybit.js';
import { disablePushListeners, enablePush, isNative, loadValue, onResume, saveValue } from './lib/native.js';
import Home from './screens/Home.jsx';
import Positions from './screens/Positions.jsx';
import Trades from './screens/Trades.jsx';
import Events from './screens/Events.jsx';
import Settings from './screens/Settings.jsx';

/**
 * App Android de Altagracia Trading Suite (fase 2, 21/11/2026): solo lectura.
 * - Con la suite al alcance (Tailscale), lee de su puerta movil: resumen, posiciones, trades con capturas y avisos.
 * - Sin la suite (PC apagado), "modo directo": posiciones leidas de Bybit con una clave de solo lectura.
 * Cerrar posiciones llega en la fase 3.
 */

const TABS = [['home', 'Inicio'], ['positions', 'Posiciones'], ['trades', 'Trades'], ['events', 'Avisos'], ['settings', 'Ajustes']];
const FAST_MS = 5000;     // resumen y posiciones
const SLOW_MS = 30000;    // trades y avisos
const DIRECT_MS = 15000;  // Bybit directo

export default function App() {
  const [ready, setReady] = useState(false);
  const [pairing, setPairing] = useState(null);
  const [accounts, setAccounts] = useState([]);       // claves de solo lectura del modo directo
  const [prefs, setPrefs] = useState({ push: false, seenEvent: null });
  const [tab, setTab] = useState('home');
  const [openTrade, setOpenTrade] = useState(null);
  const [live, setLive] = useState({ source: null, overview: null, positions: [], error: null, at: null });
  const [direct, setDirect] = useState({ accounts: [], error: null, at: null });
  const [trades, setTrades] = useState({ items: null, error: null });
  const [events, setEvents] = useState([]);
  const [notice, setNotice] = useState(null);
  const [pushState, setPushState] = useState(null);
  const tick = useRef(0);

  useEffect(() => {
    (async () => {
      const [p, a, f, cachedEvents] = await Promise.all([loadValue('pairing'), loadValue('accounts'), loadValue('prefs'), loadValue('events')]);
      setPairing(p);
      setAccounts(a || []);
      if (f) setPrefs(f);
      if (cachedEvents) setEvents(cachedEvents);
      if (!p) setTab('settings');
      setReady(true);
    })();
  }, []);

  const savePrefs = useCallback((change) => setPrefs(prev => {
    const next = { ...prev, ...change };
    saveValue('prefs', next);
    return next;
  }), []);

  // ---------- la suite ----------
  const readFast = useCallback(async () => {
    if (!pairing) return;
    try {
      const [overview, positions] = await Promise.all([gateGet(pairing, '/m/overview'), gateGet(pairing, '/m/positions').catch(e => ({ error: e.message, positions: [] }))]);
      setLive({ source: 'suite', overview, positions: positions.positions || [], error: positions.error || overview.positions?.error || null, at: Date.now() });
    } catch (e) {
      // offline: no hubo respuesta (PC apagado o sin Tailscale). Otro error (bot caido, celular revocado) viene de la suite
      setLive(prev => ({ ...prev, source: e.offline ? 'offline' : 'suite-error', error: e.message }));
    }
  }, [pairing]);

  const readSlow = useCallback(async () => {
    if (!pairing) return;
    try {
      const last = events.length ? events[events.length - 1].id : null;
      const [t, ev] = await Promise.all([
        gateGet(pairing, '/m/trades?days=30'),
        gateGet(pairing, last ? `/m/events?after=${last}&limit=200` : '/m/events?limit=200'),
      ]);
      setTrades({ items: t.trades || [], error: null });
      if (ev.events?.length) {
        setEvents(prev => {
          const known = new Set(prev.map(e => e.id));
          const next = [...prev, ...ev.events.filter(e => !known.has(e.id))].slice(-300);
          saveValue('events', next);
          return next;
        });
      }
    } catch (e) {
      setTrades(prev => ({ ...prev, error: e.message }));
    }
  }, [pairing, events]);

  // ---------- modo directo ----------
  const readDirect = useCallback(async () => {
    if (!accounts.length) return;
    const out = [];
    for (const account of accounts) {
      try {
        const [positions, balance] = await Promise.all([directPositions(account), directBalance(account).catch(() => null)]);
        out.push({ name: account.name, demo: account.demo, positions, balance, error: null });
      } catch (e) {
        out.push({ name: account.name, demo: account.demo, positions: [], balance: null, error: e.message });
      }
    }
    setDirect({ accounts: out, at: Date.now(), error: out.every(a => a.error) ? out[0].error : null });
  }, [accounts]);

  const offline = live.source === 'offline' || !pairing;
  const readers = useRef({});
  readers.current = { readFast, readSlow, readDirect, offline, hasAccounts: accounts.length > 0 };

  useEffect(() => {
    if (!ready) return undefined;
    const run = (force) => {
      const r = readers.current;
      if (document.visibilityState === 'hidden' && !force) return;
      tick.current += 1;
      r.readFast();
      if (force || tick.current % (SLOW_MS / FAST_MS) === 1) r.readSlow();
      if (r.offline && r.hasAccounts && (force || tick.current % (DIRECT_MS / FAST_MS) === 1)) r.readDirect();
    };
    run(true);
    const timer = setInterval(run, FAST_MS);
    let stop = null;
    onResume(() => run(true)).then(off => { stop = off; });
    return () => { clearInterval(timer); stop?.(); };
  }, [ready, pairing]);

  // Al quedar sin la suite, lee Bybit de una vez
  useEffect(() => { if (ready && offline && accounts.length) readDirect(); }, [ready, offline, accounts.length, readDirect]);

  // ---------- avisos push ----------
  const openFromPush = useCallback((data) => {
    if (data?.trade_id) {
      setOpenTrade(data.trade_id);
      setTab('trades');
    } else setTab('events');
    readers.current.readSlow?.();
  }, []);

  const startPush = useCallback(async (activePairing) => {
    await enablePush(async (token, error) => {
      if (!token) {
        setPushState(`No se registró: ${error}`);
        return;
      }
      try {
        await gatePost(activePairing, '/m/push-token', { token });
        setPushState('Avisos activos en este celular');
      } catch (e) {
        setPushState(`El celular se registró, pero la suite no lo recibió: ${e.message}`);
      }
    }, openFromPush);
  }, [openFromPush]);

  useEffect(() => {
    if (ready && isNative() && prefs.push && pairing) startPush(pairing).catch(e => setPushState(e.message));
    return () => { disablePushListeners(); };
  }, [ready, prefs.push, pairing, startPush]);

  // ---------- ajustes ----------
  const actions = {
    async pair(next) {
      // Se comprueba contra la suite antes de guardarlo: ese primer pedido firmado lo deja activo
      const hello = await gateGet(next, '/m/hello');
      await saveValue('pairing', next);
      setPairing(next);
      setEvents([]);
      await saveValue('events', null);
      setNotice(`Emparejado con la suite como "${hello.device}"`);
      setTab('home');
    },
    async unpair() {
      if (pairing && prefs.push) await gatePost(pairing, '/m/push-token', { token: null }).catch(() => {});
      await saveValue('pairing', null);
      setPairing(null);
      setLive({ source: null, overview: null, positions: [], error: null, at: null });
      setTrades({ items: null, error: null });
    },
    async addAccount(account) {
      const [positions] = await Promise.all([directPositions(account)]); // la clave se prueba antes de guardarla
      const next = [...accounts.filter(a => a.name !== account.name), account];
      await saveValue('accounts', next);
      setAccounts(next);
      setNotice(`Clave "${account.name}" guardada: ${positions.length} posición(es) abiertas`);
    },
    async removeAccount(name) {
      const next = accounts.filter(a => a.name !== name);
      await saveValue('accounts', next);
      setAccounts(next);
    },
    async setPush(on) {
      if (!on && pairing) await gatePost(pairing, '/m/push-token', { token: null }).catch(() => {});
      setPushState(null);
      savePrefs({ push: on });
    },
    refresh() {
      readFast();
      readSlow();
      if (offline && accounts.length) readDirect();
    },
  };

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const lastEvent = events.length ? events[events.length - 1].id : null;
  const unread = prefs.seenEvent ? events.filter(e => e.id > prefs.seenEvent).length : events.length;
  useEffect(() => {
    if (tab === 'events' && lastEvent && lastEvent !== prefs.seenEvent) savePrefs({ seenEvent: lastEvent });
  }, [tab, lastEvent, prefs.seenEvent, savePrefs]);

  if (!ready) return <div className="splash">Altagracia</div>;

  const shared = { pairing, live, direct, offline, accounts, trades, events, actions, goto: setTab, openTrade: (id) => { setOpenTrade(id); setTab('trades'); } };

  return (
    <div className="app">
      {notice && <div className="toast" onClick={() => setNotice(null)}>{notice}</div>}
      <main className="screen">
        {tab === 'home' && <Home {...shared} />}
        {tab === 'positions' && <Positions {...shared} />}
        {tab === 'trades' && <Trades {...shared} selected={openTrade} onSelect={setOpenTrade} />}
        {tab === 'events' && <Events {...shared} seen={prefs.seenEvent} />}
        {tab === 'settings' && <Settings {...shared} prefs={prefs} pushState={pushState} />}
      </main>
      <nav className="tabs">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" className={tab === id ? 'tab on' : 'tab'} onClick={() => { setTab(id); if (id !== 'trades') setOpenTrade(null); }}>
            {label}
            {id === 'events' && unread > 0 && tab !== 'events' && <span className="dot">{unread > 99 ? '99+' : unread}</span>}
            {id === 'positions' && live.positions.length > 0 && !offline && <span className="count">{live.positions.length}</span>}
          </button>
        ))}
      </nav>
    </div>
  );
}
