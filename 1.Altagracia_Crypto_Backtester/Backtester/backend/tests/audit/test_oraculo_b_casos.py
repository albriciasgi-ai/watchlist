"""Casos sintéticos del oráculo B, con el resultado esperado calculado a mano en cada comentario.

Velas de 1 hora (tf = 60): el hueco de datos por defecto es max(6 h, 2 h) = 6 h. Salvo que se
diga otra cosa, ATR = 1 en todas las velas, stop = 1·ATR y sin comisiones (taker = maker = 0),
para que el R se lea directo de los precios. Velas: (o, h, l, c).
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from oraculo_b import simulate_signals  # noqa: E402

TF = 60
STEP = TF * 60_000
T0 = 1_704_067_200_000          # 2024-01-01 00:00 UTC
A = pytest.approx


def velas(*rows, times=None):
    return [{"t": T0 + i * STEP if times is None else times[i], "o": o, "h": h, "l": l, "c": c,
             "v": 1.0} for i, (o, h, l, c) in enumerate(rows)]


def regla(entry=None, stop=None, one=True, cooldown=0, target_at=None, **exit_kw):
    ex = {"targetR": None, "horizon": None, "opposite": False, "trail": "none"}
    ex.update(exit_kw)
    r = {"entry": entry or {"type": "market"},
         "stop": stop or {"type": "atr", "atr": 1.0, "buffer": 0.0},
         "exit": ex, "oneAtATime": one, "cooldown": cooldown}
    if target_at is not None:
        r["targetAt"] = target_at
    return r


def senal(k, side=1, zone=None, i0=None, expiry=None, sides=None, sid=None):
    return {"k": k, "side": side, "zone": zone, "i0": k if i0 is None else i0, "expiry": expiry,
            "sides": tuple(sides) if sides is not None else (side,),
            "id": sid if sid is not None else f"k{k}"}


def correr(bars, sigs, rule, atr=1.0, fees=False, **kw):
    atrs = atr if isinstance(atr, list) else [atr] * len(bars)
    if not fees:
        kw.setdefault("taker", 0.0)
        kw.setdefault("maker", 0.0)
    return simulate_signals(TF, bars, atrs, sigs, rule, **kw)


def uno(bars, sig, rule, **kw):
    return correr(bars, [sig], rule, **kw)["results"][0]


def minuto(j, i):
    return T0 + j * STEP + i * 60_000


def minutos(tabla):
    """{j: [(alto, bajo), ...]} → minutes_of, un minuto por elemento."""
    return lambda j: [(minuto(j, i), hi, lo) for i, (hi, lo) in enumerate(tabla.get(j) or [])]


# ------------------------------------------------------------------ 3.1 a mercado

def test_mercado_largo_objetivo_en_R():
    # entrada o[1] = 100, stop 100 - 1 = 99, riesgo 1, objetivo 2R = 102.
    # vela 1: l 99.5 > 99, h 101 < 102 → mfe 1, mae -0.5. vela 2: h 103 >= 102 → objetivo 102.
    # gross 2 = r (sin comisiones), bars 2. reach None: sin corte y con menos de 300 velas.
    b = velas((100, 101, 99, 100), (100, 101, 99.5, 100.5), (100.5, 103, 100, 102.5))
    r = uno(b, senal(0), regla(targetR=2))
    assert r["entry_i"] == 1 and r["entry"] == 100 and r["entry_t"] == T0 + STEP
    assert r["order"] == "market" and r["stop"] == 99 and r["target"] == 102 and r["risk"] == 1
    assert r["stop_atr"] == 1 and r["k"] == 0 and r["side"] == 1 and r["id"] == "k0"
    assert r["exit_i"] == 2 and r["exit"] == 102 and r["exit_t"] == T0 + 2 * STEP
    assert r["reason"] == "objetivo" and r["gross"] == 2 and r["r"] == 2
    assert r["mfe"] == 2 and r["mae"] == -0.5 and r["bars"] == 2 and r["reach"] is None
    assert "tp_on" not in r


def test_comisiones_taker_en_el_r():
    # el mismo trade con las comisiones por defecto (taker 0.00055 en la entrada y la salida):
    # costo = (0.00055·100 + 0.00055·102) / 1 = 0.1111 → r = 2 - 0.1111 = 1.8889.
    b = velas((100, 101, 99, 100), (100, 101, 99.5, 100.5), (100.5, 103, 100, 102.5))
    r = uno(b, senal(0), regla(targetR=2), fees=True)
    assert r["gross"] == 2 and r["r"] == A(1.8889, abs=1e-12)


def test_mercado_corto_sale_por_stop_y_reach():
    # corto: entrada 100, stop 101, riesgo 1, objetivo 2R = 98.
    # vela 1: h 100.5 < 101, l 99 > 98 → mfe 1, mae -0.5.
    # vela 2: h 101.5 >= 101 → stop en 101 (abrió en 99.2, no más allá); mae = min(-0.5, -1).
    # reach: la vela 1 da 1R; la vela 2 toca el stop inicial → corte → 1.
    b = velas((100, 101, 99, 100), (100, 100.5, 99, 99.2), (99.2, 101.5, 99, 101),
              (101, 102, 100, 101.5))
    r = uno(b, senal(0, side=-1), regla(targetR=2))
    assert r["side"] == -1 and r["stop"] == 101 and r["target"] == 98
    assert r["exit_i"] == 2 and r["exit"] == 101 and r["reason"] == "stop"
    assert r["exit_t"] == T0 + 2 * STEP and r["gross"] == -1 and r["r"] == -1
    assert r["mfe"] == 1 and r["mae"] == -1 and r["reach"] == 1


# ------------------------------------------------------------------ 3.2 limit

def test_limit_borde_cercano_se_llena_al_cruzar_no_al_tocar():
    # zona [98, 99], near → limit en 99. o[1] = 100 > 99: espera. vela 1: l = 99 toca, no cruza.
    # vela 2: l 98.5 < 99 → llena a 99 (entry_i 2, maker). stop 98, objetivo 2R = 101.
    # vela 2 (del llenado): no toca stop ni objetivo; mfe 0.8, mae -0.5. vela 3: h 103 → 101.
    # maker 0.001: costo 0.001·99 / 1 = 0.099 → r = 1.901. reach desde la vela 3 (limit): 4R,
    # sin corte y sin 300 velas → None.
    b = velas((100, 100.5, 99.5, 100), (100, 100.2, 99, 99.5), (99.5, 99.8, 98.5, 99.6),
              (99.6, 103, 99.4, 102.8))
    rl = regla(entry={"type": "limit", "at": "near", "expiry": 3}, targetR=2)
    r = uno(b, senal(0, zone=[98, 99]), rl, maker=0.001)
    assert r["order"] == "limit" and r["entry_i"] == 2 and r["entry"] == 99
    assert r["entry_t"] == T0 + 2 * STEP and r["stop"] == 98 and r["target"] == 101
    assert r["exit_i"] == 3 and r["exit"] == 101 and r["reason"] == "objetivo" and r["bars"] == 2
    assert r["mfe"] == 2 and r["mae"] == A(-0.5) and r["r"] == A(1.901, abs=1e-12)
    assert r["reach"] is None


def test_limit_mitad_en_corto_y_objetivo_diferido_en_la_vela_del_llenado():
    # zona [101, 103], mid, corto → limit en 103 - 0.5·2 = 102. o[1] = 100: espera.
    # vela 1: h = 102 toca, no cruza. vela 2: h 102.5 > 102 → llena a 102. stop 103, objetivo
    # 1R = 101. vela 2: l 100.8 <= 101 toca el objetivo, pero es la vela del llenado y no toca el
    # stop → se deja para la siguiente. mfe (102-100.8)/1 = 1.2, mae -0.5.
    # vela 3: l 100.9 <= 101 → objetivo; mfe = max(1.2, 1) = 1.2.
    b = velas((100, 100.5, 99.5, 100), (100, 102, 99.5, 101), (101, 102.5, 100.8, 101.5),
              (101.5, 101.8, 100.9, 101.2))
    rl = regla(entry={"type": "limit", "at": "mid", "expiry": 5}, targetR=1)
    r = uno(b, senal(0, side=-1, zone=[101, 103]), rl)
    assert r["entry_i"] == 2 and r["entry"] == 102 and r["order"] == "limit"
    assert r["stop"] == 103 and r["target"] == 101
    assert r["exit_i"] == 3 and r["exit"] == 101 and r["reason"] == "objetivo" and r["gross"] == 1
    assert r["mfe"] == A(1.2) and r["mae"] == A(-0.5)


def test_limit_borde_lejano_con_stop_de_zona():
    # zona [97, 99], far → limit en 97. vela 2: l 96.8 < 97 → llena a 97.
    # stop de zona sin margen: 97 - 0 = 97 = la entrada → riesgo 0 → "stop del lado equivocado".
    b = velas((100, 100.5, 99.5, 100), (100, 100.2, 98, 98.5), (98.5, 99.5, 96.8, 97.5),
              (97.5, 99, 97.2, 98.8), (98.8, 98.9, 96.4, 96.6))
    ent = {"type": "limit", "at": "far", "expiry": 3}
    r = uno(b, senal(0, zone=[97, 99]), regla(entry=ent, stop={"type": "zone", "buffer": 0.0},
                                               targetR=2))
    assert r == {"id": "k0", "skip": "stop del lado equivocado"}
    # con margen 0.5·ATR: stop 96.5, riesgo 0.5, objetivo 2R = 98. vela 2 (del llenado): h 99.5
    # pasa el objetivo pero no toca el stop (l 96.8 > 96.5) → diferido; mfe = (99.5-97)/0.5 = 5
    # (la vela del llenado cuenta entera), mae = -0.4. vela 3: h 99 >= 98 → objetivo; mfe sigue 5.
    # reach empieza en la vela 3: (99-97)/0.5 = 4; la vela 4 toca 96.5 → corte → 4.
    r = uno(b, senal(0, zone=[97, 99]), regla(entry=ent, stop={"type": "zone", "buffer": 0.5},
                                               targetR=2))
    assert r["entry_i"] == 2 and r["entry"] == 97 and r["stop"] == 96.5 and r["risk"] == 0.5
    assert r["exit_i"] == 3 and r["exit"] == 98 and r["reason"] == "objetivo"
    assert r["mfe"] == 5 and r["mae"] == A(-0.4) and r["reach"] == 4


def test_limit_del_lado_equivocado_entra_a_mercado_con_taker():
    # limit en 99 (near de [98, 99]) pero o[1] = 98.8 <= 99 → a mercado en 98.8 con taker.
    # stop 97.8, objetivo 1R = 99.8; vela 2: h 101 → 99.8.
    # costo (0.001·98.8 + 0.001·99.8) / 1 = 0.1986 → r = 0.8014 (el maker 0.5 no se usa).
    b = velas((100, 100.5, 99.5, 99), (98.8, 99.5, 98.5, 99.2), (99.2, 101, 99, 100.8))
    rl = regla(entry={"type": "limit", "at": "near", "expiry": 3}, targetR=1)
    r = uno(b, senal(0, zone=[98, 99]), rl, taker=0.001, maker=0.5)
    assert r["order"] == "market" and r["entry_i"] == 1 and r["entry"] == 98.8
    assert r["exit_i"] == 2 and r["exit"] == A(99.8) and r["r"] == A(0.8014, abs=1e-9)


def test_limit_vence_sin_llenar():
    # limit en 99 con 2 velas de espera: la 1 y la 2 no cruzan; la 3 cruza pero ya venció.
    b = velas((100, 100.5, 99.5, 100), (100, 100.5, 99.2, 99.5), (99.5, 100, 99.1, 99.8),
              (99.8, 100, 98, 98.5))
    rl = regla(entry={"type": "limit", "at": "near", "expiry": 2}, targetR=1)
    assert uno(b, senal(0, zone=[98, 99]), rl) == {"id": "k0", "skip": "limit sin llenar"}


def test_limit_sin_zona_entra_a_mercado():
    b = velas((100, 100.5, 99.5, 100), (100.2, 100.6, 99.8, 100.4), (100.4, 101.5, 100.1, 101.3))
    rl = regla(entry={"type": "limit", "at": "near", "expiry": 2}, targetR=1)
    r = uno(b, senal(0, zone=None), rl)
    assert r["order"] == "market" and r["entry"] == 100.2 and r["entry_i"] == 1


# ------------------------------------------------------------------ 3.3 orden stop

def test_orden_stop_se_llena_en_su_nivel():
    # zona [99, 100], offset 0.5, ATR 2 → nivel 100 + 1 = 101. vela 1: h 100.8 no toca.
    # vela 2: h 101.5 >= 101 y abrió en 100.5 → llena a 101 (vela del llenado), taker.
    # stop 101 - 2 = 99, riesgo 2, stop_atr 1, objetivo 1R = 103.
    # vela 2: mfe (101.5-101)/2 = 0.25, mae (100.2-101)/2 = -0.4. vela 3: h 103.5 → 103.
    b = velas((99.5, 100, 99, 99.8), (99.8, 100.8, 99.5, 100.5), (100.5, 101.5, 100.2, 101.2),
              (101.2, 103.5, 101, 103))
    rl = regla(entry={"type": "stop", "offset": 0.5, "expiry": 3, "cancel": False}, targetR=1)
    r = uno(b, senal(0, zone=[99, 100]), rl, atr=2.0)
    assert r["order"] == "stop" and r["entry_i"] == 2 and r["entry"] == 101
    assert r["stop"] == 99 and r["risk"] == 2 and r["stop_atr"] == 1 and r["target"] == 103
    assert r["exit_i"] == 3 and r["exit"] == 103 and r["gross"] == 1
    assert r["mfe"] == 1 and r["mae"] == A(-0.4)
    # comisión de entrada taker: (0.001·101 + 0.001·103) / 2 = 0.102 → r = 0.898
    r = uno(b, senal(0, zone=[99, 100]), rl, atr=2.0, taker=0.001, maker=0.5)
    assert r["r"] == A(0.898, abs=1e-12)


def test_orden_stop_que_salta_se_llena_en_la_apertura_y_no_es_vela_del_llenado():
    # nivel 100 + 0.5·1 = 100.5; la vela 2 abre en 101.6 → llena en la apertura, 101.6.
    # stop 100.6, objetivo 1R = 102.6; la misma vela 2 llega a 102.7: como no es vela del
    # llenado, el objetivo cuenta ahí → sale en 102.6 con 1 vela. reach: desde la vela 3, que
    # no existe → None.
    b = velas((99.5, 100, 99, 99.8), (99.8, 100.4, 99.6, 100.2), (101.6, 102.7, 101.3, 102.5))
    rl = regla(entry={"type": "stop", "offset": 0.5, "expiry": 3}, targetR=1)
    r = uno(b, senal(0, zone=[99, 100]), rl)
    assert r["entry_i"] == 2 and r["entry"] == 101.6 and r["order"] == "stop"
    assert r["exit_i"] == 2 and r["exit"] == A(102.6) and r["reason"] == "objetivo"
    assert r["bars"] == 1 and r["reach"] is None


def test_orden_stop_desde_el_cierre_y_espera_propia_de_la_senal():
    # sin zona: nivel c[0] + 1·0.5 = 100.3. La regla espera 1 vela, la señal trae expiry 3:
    # manda la señal → la vela 3 (h 100.4) la llena.
    b = velas((99.6, 100, 99.5, 99.8), (99.8, 100.1, 99.6, 99.9), (99.9, 100.2, 99.7, 100),
              (100, 100.4, 99.9, 100.3))
    rl = regla(entry={"type": "stop", "offset": 0.5, "expiry": 1}, stop={"type": "atr", "atr": 2.0})
    assert uno(b, senal(0), rl)["skip"] == "orden stop sin llenar"
    r = uno(b, senal(0, expiry=3), rl)
    assert r["entry_i"] == 3 and r["entry"] == A(100.3)
    # con zona y from = "close" también se mide desde el cierre
    rl2 = regla(entry={"type": "stop", "offset": 0.5, "expiry": 3, "from": "close"},
                stop={"type": "atr", "atr": 2.0})
    assert uno(b, senal(0, zone=[95, 96]), rl2)["entry"] == A(100.3)


def test_orden_stop_cancelada_al_pasar_el_otro_borde():
    # nivel 100.5, cancelación en 99. vela 1: no toca el nivel y su l 98.9 < 99 → cancelada.
    b = velas((99.5, 100, 99.2, 99.8), (99.8, 100.2, 98.9, 99.2), (99.2, 101, 99, 100.8))
    rl = regla(entry={"type": "stop", "offset": 0.5, "expiry": 3, "cancel": True}, targetR=1)
    assert uno(b, senal(0, zone=[99, 100]), rl)["skip"] == "orden stop sin llenar"
    # si solo la toca (l = 99, sin pasarla) no se cancela: la vela 2 llena en 100.5
    b2 = velas((99.5, 100, 99.2, 99.8), (99.8, 100.2, 99.0, 99.2), (99.2, 101, 99, 100.8))
    r = uno(b2, senal(0, zone=[99, 100]), rl)
    assert r["entry_i"] == 2 and r["entry"] == 100.5
    # sin cancel la primera también se llena en la vela 2
    rl2 = regla(entry={"type": "stop", "offset": 0.5, "expiry": 3, "cancel": False}, targetR=1)
    assert uno(b, senal(0, zone=[99, 100]), rl2)["entry_i"] == 2


def test_orden_stop_con_toque_y_cancelacion_en_la_vela_deciden_los_minutos():
    # nivel 100.5 y cancelación 99; la vela 1 hace las dos cosas (h 100.8, l 98.8).
    b = velas((99.5, 100, 99.2, 99.8), (99.5, 100.8, 98.8, 100.6), (100.6, 101, 100.3, 100.9))
    rl = regla(entry={"type": "stop", "offset": 0.5, "expiry": 3, "cancel": True},
               stop={"type": "atr", "atr": 2.0}, horizon=2)
    # primero pasa la cancelación → cancelada
    m1 = minutos({1: [(99.6, 98.8), (100.8, 99.5)]})
    assert uno(b, senal(0, zone=[99, 100]), rl, minutes_of=m1)["skip"] == "orden stop sin llenar"
    # primero toca el nivel → llena en 100.5 en la vela 1; stop 98.5, riesgo 2. La vela 1 no
    # toca el stop. Sale por tiempo al cierre de la vela 2 (horizonte 2) en 100.9: gross 0.2.
    # mfe (101-100.5)/2 = 0.25; mae (98.8-100.5)/2 = -0.85 (la vela del llenado cuenta entera).
    m2 = minutos({1: [(100.8, 99.4), (100.6, 98.8)]})
    r = uno(b, senal(0, zone=[99, 100]), rl, minutes_of=m2)
    assert r["entry_i"] == 1 and r["entry"] == 100.5 and r["stop"] == 98.5
    assert r["reason"] == "tiempo" and r["exit_i"] == 2 and r["exit"] == 100.9
    assert r["exit_t"] == T0 + 3 * STEP and r["gross"] == A(0.2)
    assert r["mfe"] == A(0.25) and r["mae"] == A(-0.85)


@pytest.mark.parametrize("o, minutos_vela, esperado", [
    (99.5, [(100.8, 98.8)], None),      # mismo minuto: |100.5-99.5| = 1 > |99.5-99| = 0.5 → cancela
    (99.75, [(100.8, 98.8)], 100.5),    # mismo minuto, empate 0.75 = 0.75 → a favor del llenado
    (99.5, None, None),                 # recorrido o, l, h, c (h-o 1.3 >= o-l 0.7): cancela antes
    (100.2, None, 100.5),               # recorrido o, h, l, c (h-o 0.6 < o-l 1.4): llena antes
])
def test_orden_stop_empate_en_el_mismo_minuto_o_recorrido_supuesto(o, minutos_vela, esperado):
    b = velas((99.5, 100, 99.2, 99.8), (o, 100.8, 98.8, 100.6), (100.6, 101, 100.3, 100.9))
    rl = regla(entry={"type": "stop", "offset": 0.5, "expiry": 1, "cancel": True},
               stop={"type": "atr", "atr": 3.0}, horizon=1)
    mo = minutos({1: minutos_vela}) if minutos_vela else None
    r = uno(b, senal(0, zone=[99, 100]), rl, minutes_of=mo)
    if esperado is None:
        assert r["skip"] == "orden stop sin llenar"
    else:
        assert r["entry_i"] == 1 and r["entry"] == esperado


# ------------------------------------------------------------------ 3.4 dos órdenes

def test_dos_ordenes_lado_por_minutos_por_cercania_y_lados_permitidos():
    # desde el cierre 100 con offset 1·ATR: arriba 101, abajo 99. La vela 1 toca las dos.
    b = velas((99.8, 100.3, 99.6, 100), (100, 101.5, 98.5, 100.5), (100.5, 101, 100, 100.8))
    rl = regla(entry={"type": "straddle", "from": "close", "offset": 1.0, "expiry": 2},
               stop={"type": "atr", "atr": 3.0}, horizon=1)
    s = senal(0, sides=(1, -1))
    # el primer minuto toca abajo → corto en 99, stop 102; sale por tiempo en 100.5:
    # gross (100.5-99)·(-1)/3 = -0.5
    r = uno(b, s, rl, minutes_of=minutos({1: [(100.2, 98.9), (101.5, 99.5), (100.6, 98.5)]}))
    assert r["side"] == -1 and r["entry"] == 99 and r["order"] == "stop" and r["stop"] == 102
    assert r["gross"] == A(-0.5)
    # sin minutos: la más cercana a la apertura; |101-100| = 1 <= |100-99| = 1 → largo en 101
    r = uno(b, s, rl)
    assert r["side"] == 1 and r["entry"] == 101 and r["stop"] == 98
    # minutos que no muestran ningún toque: también decide la cercanía → largo
    r = uno(b, s, rl, minutes_of=minutos({1: [(100.5, 99.5)]}))
    assert r["side"] == 1 and r["entry"] == 101
    # minutos en que las dos tocan en el mismo minuto → cercanía → largo
    r = uno(b, s, rl, minutes_of=minutos({1: [(101.5, 98.5)]}))
    assert r["side"] == 1
    # solo el lado corto permitido → corto en 99 aunque la de arriba también se tocara
    r = uno(b, senal(0, sides=(-1,)), rl)
    assert r["side"] == -1 and r["entry"] == 99
    # ninguna se toca en la espera
    b2 = velas((99.8, 100.3, 99.6, 100), (100, 100.5, 99.5, 100.2), (100.2, 100.8, 99.2, 100))
    assert uno(b2, s, rl)["skip"] == "ninguna orden stop se llenó"


def test_dos_ordenes_desde_la_zona_y_salto_en_la_apertura():
    # zona [99.5, 100.5], offset 0.5 → arriba 101, abajo 99.
    rl = regla(entry={"type": "straddle", "from": "zone", "offset": 0.5, "expiry": 2},
               stop={"type": "atr", "atr": 3.0}, horizon=1)
    s = senal(0, zone=[99.5, 100.5], sides=(1, -1))
    b = velas((99.8, 100.3, 99.6, 100), (100, 101.2, 99.6, 101), (101, 101.5, 100.5, 101.2))
    r = uno(b, s, rl)
    assert r["side"] == 1 and r["entry"] == 101 and r["entry_i"] == 1
    # la vela 1 abre en 101.3 (más allá de 101) → largo en la apertura
    b2 = velas((99.8, 100.3, 99.6, 100), (101.3, 101.8, 101.1, 101.5), (101.5, 102, 101, 101.8))
    r = uno(b2, s, rl)
    assert r["side"] == 1 and r["entry"] == 101.3


# ------------------------------------------------------------------ 4. stops

def test_stop_swing_con_pivote_unico_y_margen():
    # N = 2, k = 4. Mínimos [99, 98, 97, 98.5, 99]: p = k-N = 2 es el único mínimo de [0, 4].
    # entrada o[5] = 100 > 97 → stop = 97 - 0.5·1 = 96.5, riesgo 3.5, stop_atr 3.5.
    b = velas((99.5, 100, 99, 99.5), (99.5, 99.8, 98, 98.5), (98.5, 99, 97, 98.8),
              (98.8, 99.5, 98.5, 99.2), (99.2, 100, 99, 99.8), (100, 100.5, 99.5, 100.2))
    r = uno(b, senal(4), regla(stop={"type": "swing", "bars": 2, "buffer": 0.5}, horizon=1))
    assert r["stop"] == 96.5 and r["risk"] == 3.5 and r["stop_atr"] == 3.5
    assert r["exit"] == 100.2 and r["reason"] == "tiempo"


def test_stop_swing_un_empate_no_es_pivote():
    # N = 1, k = 6. Mínimos [99, 98, 97.5, 98.2, 97.3, 97.3, 98.5]. p = 5 y p = 4 empatan en
    # 97.3: ninguno es pivote. p = 3 no es el mínimo. p = 2 (97.5) es el único mínimo de
    # [1, 3] → stop 97.5, riesgo 2.5. (Aceptar el empate daría 97.3, igual que el respaldo.)
    b = velas((99.5, 100, 99, 99.5), (99.5, 99.8, 98, 98.5), (98.5, 99, 97.5, 98.6),
              (98.6, 99.2, 98.2, 98.4), (98.4, 98.8, 97.3, 97.8), (97.8, 98.5, 97.3, 98.2),
              (98.6, 99.5, 98.5, 99.4), (100, 100.5, 99.8, 100.2))
    r = uno(b, senal(6), regla(stop={"type": "swing", "bars": 1, "buffer": 0.0}, horizon=1))
    assert r["stop"] == 97.5 and r["risk"] == 2.5


def test_stop_swing_salta_el_pivote_delante_de_la_entrada():
    # N = 1, k = 5. Mínimos [100, 96, 99, 98, 99.5, 99.8]; la entrada o[6] = 97.5 (salto abajo).
    # p = 4 no es pivote; p = 3 (98) sí, pero queda delante de la entrada → se sigue;
    # p = 2 no; p = 1 (96) sí y queda detrás → stop 96, riesgo 1.5.
    b = velas((100.5, 101, 100, 100.2), (100.2, 100.4, 96, 97), (99.2, 100, 99, 99.5),
              (99.5, 99.8, 98, 98.5), (99.6, 100, 99.5, 99.9), (99.9, 100.2, 99.8, 100),
              (97.5, 98, 97, 97.8))
    r = uno(b, senal(5), regla(stop={"type": "swing", "bars": 1}, horizon=1))
    assert r["entry"] == 97.5 and r["stop"] == 96 and r["risk"] == 1.5


def test_stop_swing_en_corto_con_pivote_de_maximo():
    # N = 1, k = 3. Máximos [100, 102, 101, 100.5]: p = 2 no es el máximo de [1, 3]; p = 1 (102)
    # es el único máximo de [0, 2] y queda detrás de la entrada corta 100 → stop 102 + 0.5 =
    # 102.5, riesgo 2.5. Sale por tiempo en c[4] = 99.7: gross (99.7-100)·(-1)/2.5 = 0.12.
    b = velas((99.5, 100, 99, 99.8), (99.8, 102, 99.6, 101.5), (100.8, 101, 100.2, 100.5),
              (100.5, 100.5, 99.8, 100.1), (100, 100.4, 99.5, 99.7))
    rl = regla(stop={"type": "swing", "bars": 1, "buffer": 0.5}, horizon=1)
    r = uno(b, senal(3, side=-1), rl)
    assert r["stop"] == 102.5 and r["risk"] == 2.5 and r["gross"] == A(0.12)


def test_stop_swing_sin_pivote_usa_el_respaldo():
    # N = 1, k = 3, mínimos que bajan [100, 99, 98, 97]: ningún pivote confirmado (p = 0 no
    # tiene ventana completa). Respaldo: mín(l[max(0, 3-4) .. 3]) - 0.2·ATR = 97 - 0.2 = 96.8;
    # entrada 97.5 → riesgo 0.7.
    b = velas((100.5, 101, 100, 100.2), (100.2, 100.5, 99, 99.3), (99.3, 99.6, 98, 98.2),
              (98.2, 98.5, 97, 97.4), (97.5, 98, 97.2, 97.8))
    r = uno(b, senal(3), regla(stop={"type": "swing", "bars": 1, "buffer": 0.2}, horizon=1))
    assert r["stop"] == A(96.8) and r["risk"] == A(0.7)


def test_stop_de_la_vela_del_elemento_con_i0():
    b = velas((99.5, 100, 99, 99.6), (99.6, 99.9, 98.2, 98.5), (98.7, 99.4, 98.6, 99.1),
              (99.1, 99.7, 98.9, 99.3), (99.2, 99.8, 99, 99.5))
    rl = regla(stop={"type": "candle", "buffer": 0.3}, horizon=1)
    # largo, i0 = 1: mín(l[1..3]) = 98.2 → 98.2 - 0.3 = 97.9; entrada o[4] = 99.2 → riesgo 1.3
    r = uno(b, senal(3, i0=1), rl)
    assert r["stop"] == A(97.9) and r["risk"] == A(1.3)
    # corto, i0 = 1: máx(h[1..3]) = 99.9 → 100.2; riesgo 1.0
    r = uno(b, senal(3, side=-1, i0=1), rl)
    assert r["stop"] == A(100.2) and r["risk"] == A(1.0)
    # i0 se recorta a [0, k]: i0 = 10 → solo la vela 3: 98.9 - 0.3 = 98.6
    assert uno(b, senal(3, i0=10), rl)["stop"] == A(98.6)
    # el stop de zona sin zona se comporta como el de la vela
    r = uno(b, senal(3, i0=1), regla(stop={"type": "zone", "buffer": 0.3}, horizon=1))
    assert r["stop"] == A(97.9)


def test_stop_de_zona_largo_y_corto():
    # largo: zona_baja 98.5 - 0.2 = 98.3 (riesgo 1.7); corto: zona_alta 101.5 + 0.2 = 101.7
    b = velas((100, 100.5, 99.5, 100), (100, 100.6, 99.4, 100.2), (100.2, 100.5, 99.8, 100.1))
    rl = regla(stop={"type": "zone", "buffer": 0.2}, horizon=1)
    r = uno(b, senal(0, zone=[98.5, 99.5]), rl)
    assert r["stop"] == A(98.3) and r["risk"] == A(1.7)
    r = uno(b, senal(0, side=-1, zone=[100.5, 101.5]), rl)
    assert r["stop"] == A(101.7) and r["risk"] == A(1.7)


def test_stop_muy_corto_muy_largo_y_del_lado_equivocado():
    b = velas((100, 100.5, 99.5, 100), (100, 100.6, 99.4, 100.2), (100.2, 100.5, 99.8, 100.1))
    s = senal(0)
    # 0.5 ATR < minAtr 1 → muy corto; 3 ATR > maxAtr 2 → muy largo
    assert uno(b, s, regla(stop={"type": "atr", "atr": 0.5, "minAtr": 1.0}))["skip"] == "stop muy corto"
    assert uno(b, s, regla(stop={"type": "atr", "atr": 3.0, "maxAtr": 2.0}))["skip"] == "stop muy largo"
    # zona por encima de la entrada: stop 100.5 > 100 en un largo
    r = uno(b, senal(0, zone=[100.5, 101]), regla(stop={"type": "zone"}))
    assert r["skip"] == "stop del lado equivocado"
    # ATR 0 en la vela de la señal: stop_atr = 0 → con minAtr positivo, muy corto
    r = uno(b, s, regla(stop={"type": "candle", "minAtr": 0.1}), atr=[0.0, 1.0, 1.0])
    assert r["skip"] == "stop muy corto"
    # en los límites (stop_atr = minAtr = maxAtr = 1) pasa
    r = uno(b, s, regla(stop={"type": "atr", "atr": 1.0, "minAtr": 1.0, "maxAtr": 1.0}, horizon=1))
    assert r["stop_atr"] == 1 and "skip" not in r


# ------------------------------------------------------------------ 4. objetivo

def test_objetivo_mixto_con_los_flujos_on_chain():
    # entrada 100, stop 99, riesgo 1. targetR 3, chainTarget r 5.
    b = velas((100, 100.5, 99.5, 100), (100, 104, 99.8, 103.5), (103.5, 105.5, 103, 105))
    rl = regla(targetR=3, chainTarget={"r": 5})
    llamadas = []

    def chain(k, side):
        llamadas.append((k, side))
        return True

    # a favor: 5R = 105; la vela 1 (h 104) no llega, la 2 (h 105.5) sí → r 5
    r = uno(b, senal(0), rl, chain_on=chain)
    assert llamadas == [(0, 1)]
    assert r["target"] == 105 and r["exit_i"] == 2 and r["exit"] == 105 and r["r"] == 5
    # sin flujos a favor: 3R = 103, ya en la vela 1 (la de la entrada a mercado)
    r = uno(b, senal(0), rl, chain_on=lambda k, s: False)
    assert r["target"] == 103 and r["exit_i"] == 1 and r["r"] == 3
    # sin chainTarget en la regla no cambia
    assert uno(b, senal(0), regla(targetR=3), chain_on=lambda k, s: True)["target"] == 103


def test_objetivo_de_nivel():
    b = velas((100, 100.5, 99.5, 100), (100, 100.8, 99.6, 100.5), (100.5, 102.2, 100.2, 102))
    rl = regla(target_at="poc")
    # a 0.2R de la entrada (< 0.3·riesgo) o ya pasado: no se opera
    assert uno(b, senal(0), rl, level_target=lambda s: 100.2)["skip"] == "objetivo muy cerca o ya pasado"
    assert uno(b, senal(0), rl, level_target=lambda s: 99.8)["skip"] == "objetivo muy cerca o ya pasado"
    # en 102: la vela 2 llega → sale ahí
    r = uno(b, senal(0), rl, level_target=lambda s: 102)
    assert r["target"] == 102 and r["exit_i"] == 2 and r["exit"] == 102 and r["reason"] == "objetivo"


# ------------------------------------------------------------------ 5.2 toques en la vela

def test_stop_y_objetivo_en_la_misma_vela_con_minutos():
    # entrada 100, stop 99, objetivo 1R = 101. La vela 1 no toca nada (mfe 0.6, mae -0.4);
    # la vela 2 toca los dos (h 101.5, l 98.5) → deciden los minutos.
    b = velas((100, 100.5, 99.5, 100), (100, 100.6, 99.6, 100.2), (100.2, 101.5, 98.5, 99))
    rl = regla(targetR=1)
    # el objetivo llega en el minuto 1 → sale en 101 a la hora de ese minuto; mfe 1
    r = uno(b, senal(0), rl, minutes_of=minutos({2: [(100.5, 100.1), (101.2, 100.3), (100.4, 98.5)]}))
    assert r["reason"] == "objetivo" and r["exit"] == 101 and r["exit_t"] == minuto(2, 1)
    assert r["mfe"] == 1 and r["mae"] == A(-0.4)
    # el stop llega primero → 99 en el minuto 0; mae -1
    r = uno(b, senal(0), rl, minutes_of=minutos({2: [(100.3, 98.9), (101.5, 99.5)]}))
    assert r["reason"] == "stop" and r["exit"] == 99 and r["exit_t"] == minuto(2, 0)
    assert r["mae"] == -1 and r["mfe"] == A(0.6)
    # los dos en el mismo minuto → cuenta el stop
    r = uno(b, senal(0), rl, minutes_of=minutos({2: [(101.5, 98.5)]}))
    assert r["reason"] == "stop" and r["exit"] == 99
    # los minutos no muestran ningún toque → la vela no cierra el trade (convención); su h y su
    # l sí entran al mfe y al mae: 1.5 y -1.5. Sin más velas, queda abierto.
    r = uno(b, senal(0), rl, minutes_of=minutos({2: [(100.6, 99.4)]}))
    assert r["open"] is True and r["mfe"] == A(1.5) and r["mae"] == A(-1.5)


def test_stop_y_objetivo_en_la_misma_vela_con_el_recorrido_supuesto():
    rl = regla(targetR=1)
    base = [(100, 100.5, 99.5, 100), (100, 100.6, 99.6, 100.2)]
    # h-o = 2 = o-l: no es menor → primero el mínimo → stop 99 a la hora de apertura de la vela
    r = uno(velas(*base, (100.5, 102.5, 98.5, 99)), senal(0), rl)
    assert r["reason"] == "stop" and r["exit"] == 99 and r["exit_t"] == T0 + 2 * STEP
    # h-o = 0.7 < o-l = 2.3 → primero el máximo → objetivo 101
    r = uno(velas(*base, (100.8, 101.5, 98.5, 99.5)), senal(0), rl)
    assert r["reason"] == "objetivo" and r["exit"] == 101 and r["exit_t"] == T0 + 2 * STEP
    # corto: entrada 100, stop 101, objetivo 99; vela (99.6, 101.5, 98.5, 100): h-o 1.9 >= o-l
    # 1.1 → primero el mínimo → objetivo, r 1
    r = uno(velas(*base, (99.6, 101.5, 98.5, 100)), senal(0, side=-1), rl)
    assert r["reason"] == "objetivo" and r["exit"] == 99 and r["r"] == 1


def test_vela_del_llenado_de_una_limit_solo_cuenta_el_stop_en_el_minuto_del_llenado():
    # limit en 99 (zona [98, 99]); la vela 1 la llena (l 97.5) y toca el stop 98.
    b = velas((100, 100.5, 99.5, 100), (100, 100.2, 97.5, 99), (99, 99.5, 98.5, 99.2))
    rl = regla(entry={"type": "limit", "at": "near", "expiry": 2}, targetR=2)
    s = senal(0, zone=[98, 99])
    # sin minutos: o 100, h 100.2, l 97.5, c 99 (h-o 0.2 < o-l 2.5). El minuto del llenado es el
    # del mínimo (97.5 < 99) y en él toca el stop → sale en 98 (no en la apertura), -1R,
    # mae -1, mfe 0 (no se actualiza con la vela de la salida).
    r = uno(b, s, rl)
    assert r["entry_i"] == 1 and r["reason"] == "stop" and r["exit"] == 98
    assert r["exit_t"] == T0 + STEP and r["gross"] == -1 and r["mae"] == -1 and r["mfe"] == 0
    assert r["bars"] == 1
    # con minutos: llena en el minuto 1 (98.6 < 99) sin tocar el stop; lo toca en el minuto 2
    m = minutos({1: [(100.2, 99.4), (99.6, 98.6), (99.2, 97.5), (99.1, 98.8)]})
    r = uno(b, s, rl, minutes_of=m)
    assert r["reason"] == "stop" and r["exit"] == 98 and r["exit_t"] == minuto(1, 2)


def test_vela_del_llenado_de_una_orden_stop_antes_del_llenado_no_cuenta_nada():
    # nivel 100.5 + 0.5 = 101 (zona [99.5, 100.5]); stop 1·ATR → 100. La vela 1 abre en 100.5,
    # baja a 99.8 (toca el stop) y sube a 101.5. Recorrido: h-o 1.0 >= o-l 0.7 → o, l, h, c.
    # El minuto del llenado es el del máximo: el mínimo fue antes y no cuenta → la vela no cierra
    # el trade. mfe y mae la cuentan entera: 0.5 y -1.2. Sale por tiempo en c[2] = 101.
    b = velas((100, 100.4, 99.8, 100.2), (100.5, 101.5, 99.8, 100.9), (100.9, 101.2, 100.6, 101))
    rl = regla(entry={"type": "stop", "offset": 0.5, "expiry": 2}, horizon=2)
    r = uno(b, senal(0, zone=[99.5, 100.5]), rl)
    assert r["entry_i"] == 1 and r["entry"] == 101 and r["stop"] == 100
    assert r["reason"] == "tiempo" and r["exit_i"] == 2 and r["exit"] == 101
    assert r["mfe"] == A(0.5) and r["mae"] == A(-1.2)


def test_vela_del_llenado_con_stop_y_objetivo_el_objetivo_puede_ganar_tras_el_llenado():
    # limit en 99, stop 98, objetivo 2R = 101. La vela 1 llena y toca los dos.
    b = velas((100, 100.5, 99.5, 100), (100, 101.5, 97.8, 99))
    rl = regla(entry={"type": "limit", "at": "near", "expiry": 1}, targetR=2)
    s = senal(0, zone=[98, 99])
    # minutos: llena en el 1 (98.6), el objetivo en el 2 (101.5) antes que el stop (97.8 en el 3)
    m = minutos({1: [(100.4, 99.6), (99.7, 98.6), (101.5, 99.5), (99.5, 97.8)]})
    r = uno(b, s, rl, minutes_of=m)
    assert r["reason"] == "objetivo" and r["exit"] == 101 and r["exit_t"] == minuto(1, 2)
    assert r["mfe"] == 2
    # sin minutos: o 100, h 101.5, l 97.8, c 99 (h-o 1.5 < o-l 2.2): el máximo vino antes del
    # llenado y no cuenta; en el minuto del llenado (97.8) toca el stop → -1R
    r = uno(b, s, rl)
    assert r["reason"] == "stop" and r["exit"] == 98 and r["gross"] == -1


def test_objetivo_diferido_en_la_vela_del_llenado_de_una_orden_stop_corta():
    # corto: zona [100, 101], offset 0.5 → nivel 100 - 0.5 = 99.5. La vela 1 abre en 100.2 y
    # llega a 99.2 → llena a 99.5. stop 100.5, objetivo 0.25R = 99.25: la vela 1 lo pasa pero no
    # toca el stop → se deja; la 2 no llega (l 99.3) y la 3 sí (l 99.1) → sale en 99.25.
    b = velas((100.3, 100.6, 100.1, 100.4), (100.2, 100.4, 99.2, 99.4), (99.4, 99.6, 99.3, 99.5),
              (99.5, 99.6, 99.1, 99.2))
    rl = regla(entry={"type": "stop", "offset": 0.5, "expiry": 2}, targetR=0.25)
    r = uno(b, senal(0, side=-1, zone=[100, 101]), rl)
    assert r["entry_i"] == 1 and r["entry"] == 99.5 and r["stop"] == 100.5
    assert r["target"] == 99.25 and r["exit_i"] == 3 and r["exit"] == 99.25
    assert r["reason"] == "objetivo"


def test_salida_por_stop_con_salto_en_la_apertura():
    # largo: entrada 100, stop 99; la vela 2 abre en 98.5 → sale en 98.5: gross y mae -1.5
    b = velas((100, 100.5, 99.5, 100), (100, 100.5, 99.5, 100), (98.5, 99, 98, 98.8))
    r = uno(b, senal(0), regla())
    assert r["reason"] == "stop" and r["exit"] == 98.5 and r["gross"] == -1.5 and r["mae"] == -1.5
    assert r["exit_t"] == T0 + 2 * STEP
    # corto: stop 101; la vela 2 abre en 101.8 → sale en 101.8, -1.8R
    b = velas((100, 100.5, 99.5, 100), (100, 100.5, 99.5, 100), (101.8, 102, 101.5, 101.9))
    r = uno(b, senal(0, side=-1), regla())
    assert r["exit"] == 101.8 and r["gross"] == A(-1.8)


# ------------------------------------------------------------------ 5.1 y 2: huecos

def test_hueco_de_datos_y_sin_vela_siguiente():
    tt = [T0, T0 + STEP, T0 + 2 * STEP, T0 + 9 * STEP, T0 + 10 * STEP]  # 7 h entre la 2 y la 3
    b = velas((100, 100.5, 99.5, 100), (100, 100.8, 99.6, 100.5), (100.5, 101, 100.2, 100.7),
              (102, 102.5, 101.5, 102.2), (102.2, 103, 102, 102.8), times=tt)
    rl = regla(targetR=5)
    # entra en la vela 1; en la 3 hay un hueco (7 h > 6 h) → sale en c[2] = 100.7 a t[2] + 1 h
    r = uno(b, senal(0), rl)
    assert r["reason"] == "hueco de datos" and r["exit_i"] == 2 and r["exit"] == 100.7
    assert r["exit_t"] == T0 + 3 * STEP and r["bars"] == 2 and r["gross"] == A(0.7)
    # reach: 0.8 en la vela 1, 1.0 en la 2; el hueco corta → 1.0
    assert r["reach"] == A(1.0)
    # señal en la vela 2: el salto a la 3 es un hueco; en la última vela no hay siguiente
    out = correr(b, [senal(2), senal(4)], rl)
    assert [x["skip"] for x in out["results"]] == ["sin vela siguiente", "sin vela siguiente"]
    assert out["trades"] == [] and out["fates"] == {}
    # con gap_ms de 8 h no hay hueco: el trade sigue (105 no se alcanza) y queda abierto
    r = uno(b, senal(0), rl, gap_ms=8 * 3_600_000)
    assert r["open"] is True and "exit_i" not in r


# ------------------------------------------------------------------ 5.4 al cierre de la vela

def test_salida_por_senal_contraria():
    b = velas((100, 100.5, 99.5, 100), (100, 100.8, 99.6, 100.5), (100.5, 101, 100.2, 100.7),
              (100.9, 101.2, 100.5, 101))
    opp = {1: set(), -1: {2}}
    # largo con una señal corta conocida al cierre de la vela 2 → sale en o[3] = 100.9 a t[3];
    # exit_i 3, bars 3; mfe 1.0 (h 101 de la vela 2), mae -0.4 (l 99.6 de la vela 1)
    r = uno(b, senal(0), regla(opposite=True), opposite=opp)
    assert r["reason"] == "señal contraria" and r["exit_i"] == 3 and r["exit"] == 100.9
    assert r["exit_t"] == T0 + 3 * STEP and r["bars"] == 3
    assert r["mfe"] == A(1.0) and r["mae"] == A(-0.4)
    # sin opposite en la regla no sale; una señal del mismo lado tampoco la cierra
    assert uno(b, senal(0), regla(opposite=False), opposite=opp)["open"] is True
    assert uno(b, senal(0), regla(opposite=True), opposite={1: {2}, -1: set()})["open"] is True


def test_salida_del_canal_en_corto():
    # corto, entrada 100; el canal manda salir al cierre de la vela 1 → o[2] = 99.4, gross 0.6
    b = velas((100, 100.5, 99.5, 100), (100, 100.4, 99.2, 99.5), (99.4, 99.8, 99, 99.6))
    r = uno(b, senal(0, side=-1), regla(), exit_at={1: set(), -1: {1}})
    assert r["reason"] == "sale del canal" and r["exit_i"] == 2 and r["exit"] == 99.4
    assert r["exit_t"] == T0 + 2 * STEP and r["gross"] == A(0.6)
    # la salida del canal de los largos no la cierra
    assert uno(b, senal(0, side=-1), regla(), exit_at={1: {1}, -1: set()})["open"] is True


def test_salida_vpa_desde_fromR():
    # vela 1: mfe 0.5 < fromR 1 → no sale aunque haya aviso; vela 2: mfe 1.4 >= 1 → sale en
    # o[3] = 101.1 con el motivo del aviso
    b = velas((100, 100.5, 99.5, 100), (100, 100.5, 99.8, 100.3), (100.3, 101.4, 100.1, 101.2),
              (101.1, 101.5, 100.8, 101.3))
    vpa = {1: {1: "clímax o frenado", 2: "clímax o frenado"}, -1: {}}
    r = uno(b, senal(0), regla(vpa={"fromR": 1.0}), vpa_exit=vpa)
    assert r["reason"] == "clímax o frenado" and r["exit_i"] == 3 and r["exit"] == 101.1
    assert r["gross"] == A(1.1)


def test_salida_por_tiempo_tambien_en_la_ultima_vela():
    # horizonte 3 desde la entrada en la 1: sale al cierre de la 3 (la última) en 100.6, a
    # t[3] + 1 h, aunque no exista la vela 4
    b = velas((100, 100.5, 99.5, 100), (100, 100.5, 99.6, 100.2), (100.2, 100.6, 99.9, 100.4),
              (100.4, 100.9, 100.1, 100.6))
    r = uno(b, senal(0), regla(horizon=3))
    assert r["reason"] == "tiempo" and r["exit_i"] == 3 and r["exit"] == 100.6
    assert r["exit_t"] == T0 + 4 * STEP and r["bars"] == 3
    assert uno(b, senal(0), regla(horizon=4))["open"] is True


def test_trailing_swing():
    # entrada 100, stop 2·ATR = 98, trailBars 1. Al cierre de la 4, p = 3 (l 99.9) es el único
    # mínimo de [2, 4] y p > k → nivel 99.9; c 101.3 > 99.9 y 99.9 > 98 → stop 99.9 desde la 5.
    # (En los cierres 2 y 3 la vela p no es el mínimo de su ventana.) La vela 5 baja a 99.7 →
    # sale en 99.9, "stop arrastrado": gross -0.05; mfe (101.5-100)/2 = 0.75; mae -0.1.
    b = velas((100, 100.5, 99.5, 100), (100, 101, 99.8, 100.8), (100.8, 101.2, 100.2, 100.4),
              (100.4, 100.6, 99.9, 100.3), (100.3, 101.5, 100.1, 101.3), (101.3, 101.6, 99.7, 99.8))
    rl = regla(stop={"type": "atr", "atr": 2.0, "buffer": 0.0}, trail="swing", trailBars=1)
    r = uno(b, senal(0), rl)
    assert r["reason"] == "stop arrastrado" and r["exit_i"] == 5 and r["exit"] == 99.9
    assert r["stop"] == 98 and r["gross"] == A(-0.05)
    assert r["mfe"] == A(0.75) and r["mae"] == A(-0.1)


def test_trailing_bars_en_corto_con_margen():
    # corto, entrada 100, stop 2·ATR = 102. trailBars 2, margen 0.5·ATR:
    # cierre 1: máx(h[0..1]) = 100.6 → 101.1 < 102 y c 99.6 < 101.1 → stop 101.1
    # cierre 2: máx(h[1..2]) = 100.6 → 101.1, no se acerca → igual
    # cierre 3: máx(h[2..3]) = 99.9 → 100.4 → stop 100.4. La vela 4 sube a 100.6 → sale en 100.4.
    # gross -0.2; mfe (100-98)/2 = 1.0; mae (100-100.6)/2 = -0.3.
    b = velas((100, 100.5, 99.5, 100), (100, 100.6, 99.4, 99.6), (99.6, 99.9, 98.8, 99.0),
              (99.0, 99.2, 98.0, 98.3), (98.3, 100.6, 98.1, 100.2))
    rl = regla(stop={"type": "atr", "atr": 2.0, "buffer": 0.5}, trail="bars", trailBars=2)
    r = uno(b, senal(0, side=-1), rl)
    assert r["reason"] == "stop arrastrado" and r["exit_i"] == 4 and r["exit"] == A(100.4)
    assert r["gross"] == A(-0.2) and r["mfe"] == A(1.0) and r["mae"] == A(-0.3)


def test_trailing_atr_con_arranque():
    # entrada 100, stop 99. trailAtr 1.5 desde 1R. Cierre 1: mfe 0.8 < 1 → nada.
    # cierre 2: mfe 2 → mejor 102 → nivel 100.5 (c 101.8 > 100.5) → stop 100.5.
    # vela 3: l 100.3 → sale en 100.5, "stop arrastrado"; mfe 2, mae -0.5.
    b = velas((100, 100.5, 99.5, 100), (100, 100.8, 99.5, 100.6), (100.6, 102, 100.4, 101.8),
              (101.8, 102.2, 100.3, 100.6))
    r = uno(b, senal(0), regla(trail="atr", trailAtr=1.5, trailStart=1.0))
    assert r["reason"] == "stop arrastrado" and r["exit_i"] == 3 and r["exit"] == 100.5
    assert r["gross"] == A(0.5) and r["mfe"] == A(2.0) and r["mae"] == A(-0.5)
    # con arranque en 2.5R el stop no se mueve y la vela 3 no toca 99: queda abierta
    assert uno(b, senal(0), regla(trail="atr", trailAtr=1.5, trailStart=2.5))["open"] is True


def test_trailing_porcentaje():
    # entrada 100, stop 2·ATR = 98, riesgo 2. trailPct 1, sin trailStart (0).
    # cierre 1: mfe 0.5 → mejor 101 → nivel 101 - 1.01 = 99.99 → stop 99.99
    # cierre 2: mfe 1 → mejor 102 → nivel 102 - 1.02 = 100.98 → stop 100.98.
    # vela 3: l 100.9 → sale en 100.98: gross 0.98/2 = 0.49.
    b = velas((100, 100.5, 99.5, 100), (100, 101, 99.5, 100.8), (100.8, 102, 100.5, 101.9),
              (101.9, 102.1, 100.9, 101))
    r = uno(b, senal(0), regla(stop={"type": "atr", "atr": 2.0}, trail="pct", trailPct=1.0))
    assert r["reason"] == "stop arrastrado" and r["exit"] == A(100.98) and r["gross"] == A(0.49)


def test_stop_a_la_entrada():
    # entrada 100, stop 99, breakEven 1. Cierre 1: mfe 1.2 >= 1, stop detrás y c 100.9 > 100
    # → stop = 100. La vela 2 baja a 99.8 → sale en 100, "stop en la entrada".
    # taker 0.001: costo (0.1 + 0.1)/1 = 0.2 → r = -0.2.
    b = velas((100, 100.5, 99.5, 100), (100, 101.2, 99.6, 100.9), (100.9, 101, 99.8, 100.2))
    r = uno(b, senal(0), regla(breakEven=1.0), taker=0.001)
    assert r["reason"] == "stop en la entrada" and r["exit"] == 100 and r["gross"] == 0
    assert r["r"] == A(-0.2, abs=1e-12)
    # si el cierre no queda a favor (c 99.9) el stop no se mueve y la vela 2 no toca 99
    b2 = velas((100, 100.5, 99.5, 100), (100, 101.2, 99.6, 99.9), (99.9, 101, 99.8, 100.2))
    assert uno(b2, senal(0), regla(breakEven=1.0))["open"] is True


# ------------------------------------------------------------------ 6. objetivo arrastrado

def test_objetivo_arrastrado_se_activa_y_sale_en_el_nivel_arrastrado():
    # entrada 100, stop 99, objetivo fijo 3R = 103 (nunca cierra), arranque 2R = 102, 0.5R.
    # vela 1: no llega a 102. vela 2 (o, l, h, c): llega a 102.6 → se activa (tp_on = t[2]) y
    # el objetivo queda en 102.1; el cierre 102.4 no lo toca. vela 3 (o, l, h, c): pasa el fijo
    # 103 sin cerrar; su máximo 103.5 lo arrastra a 103. vela 4 (o, h, l, c): en el tercer punto
    # baja a 102.5 <= 103 → sale en 103: gross 3, mfe 3.5 (vela 3), mae -0.4 (vela 1).
    b = velas((100, 100.5, 99.5, 100), (100, 101, 99.6, 100.8), (100.8, 102.6, 100.7, 102.4),
              (102.4, 103.5, 102.3, 103.3), (103.3, 103.4, 102.5, 102.7))
    rl = regla(targetR=3, tpTrail={"start": 2.0, "dist": 0.5, "unit": "r"})
    r = uno(b, senal(0), rl)
    assert r["target"] == 103 and r["tp_on"] == T0 + 2 * STEP
    assert r["reason"] == "objetivo arrastrado" and r["exit_i"] == 4 and r["exit"] == 103
    assert r["exit_t"] == T0 + 4 * STEP and r["gross"] == 3 and r["bars"] == 4
    assert r["mfe"] == A(3.5) and r["mae"] == A(-0.4)
    # la vela 4 abre en 102.6, ya bajo el objetivo arrastrado 103 → sale en la apertura
    b2 = b[:4] + velas((102.6, 102.9, 102.2, 102.5), times=[T0 + 4 * STEP])
    r = uno(b2, senal(0), rl)
    assert r["reason"] == "objetivo arrastrado" and r["exit"] == 102.6 and r["gross"] == A(2.6)


@pytest.mark.parametrize("unit, salida", [
    ("atr", 101.4),     # 1·ATR[k] = 1: se activa con 102 → 101; 102.4 → 101.4
    ("r", 101.9),       # 1·riesgo = 0.5: 102 → 101.5; 102.4 → 101.9
    ("pct", 101.376),   # 1% del mejor precio: 102 → 100.98; 102.4 → 102.4 - 1.024 = 101.376
])
def test_objetivo_arrastrado_unidades(unit, salida):
    # entrada 100, stop 0.5·ATR = 99.5 (riesgo 0.5), objetivo 4R = 102, arranque 3R = 101.5.
    # vela 1 (o, l, h, c): se activa en 102 (el fijo 102 no cierra). vela 2 (o, h, l, c): 102.4
    # arrastra y 100.8 toca el nivel → sale ahí.
    b = velas((100, 100.5, 99.6, 100), (100, 102, 99.9, 101.8), (101.8, 102.4, 100.8, 101))
    rl = regla(stop={"type": "atr", "atr": 0.5}, targetR=4,
               tpTrail={"start": 3.0, "dist": 1.0, "unit": unit})
    r = uno(b, senal(0), rl)
    assert r["tp_on"] == T0 + STEP and r["reason"] == "objetivo arrastrado" and r["exit_i"] == 2
    assert r["exit"] == A(salida)


def test_objetivo_arrastrado_el_stop_sigue_valiendo_antes_de_activarse():
    # entrada 100, stop 99, arranque 2R = 102. La vela 1 toca el stop y el arranque; los minutos
    # dicen que primero bajó a 98.9 → sale por stop en 99 en ese minuto, sin activarse.
    b = velas((100, 100.5, 99.5, 100), (100, 102.5, 98.9, 101))
    rl = regla(targetR=3, tpTrail={"start": 2.0, "dist": 0.5, "unit": "r"})
    m = minutos({1: [(100.2, 99.6), (99.9, 98.9), (102.5, 99.8)]})
    r = uno(b, senal(0), rl, minutes_of=m)
    assert r["reason"] == "stop" and r["exit"] == 99 and r["exit_t"] == minuto(1, 1)
    assert r["tp_on"] is None


# ------------------------------------------------------------------ 8. reach

def test_reach_en_300_velas_sin_importar_la_salida():
    # 305 velas planas en 100 (el stop 99 nunca se toca); la 150 llega a 103 y la 302 a 104,
    # fuera de las 300 velas desde la entrada en la 1 (velas 1..300). Sale por tiempo en la
    # vela 1, pero reach = 3.
    rows = [(100, 100.5, 99.5, 100)] * 305
    rows[150] = (100, 103, 99.5, 100)
    rows[302] = (100, 104, 99.5, 100)
    r = uno(velas(*rows), senal(0), regla(horizon=1))
    assert r["exit_i"] == 1 and r["reach"] == 3
    # con 200 velas y sin corte no hay 300 → None
    assert uno(velas(*rows[:200]), senal(0), regla(horizon=1))["reach"] is None


# ------------------------------------------------------------------ 9. selección

PLANAS = (100, 100.5, 99.5, 100)          # el stop 99 nunca se toca


def test_seleccion_a_mercado_una_posicion_a_la_vez_con_enfriamiento():
    # cada trade sale por tiempo al cierre de su segunda vela (horizonte 2), enfriamiento 1:
    # A (k 0): entra en 1, sale en 2. B (k 1) y C (k 2): k <= 2 → posición abierta.
    # D (k 3): 3 < 2 + 1 + 1 → enfriamiento. E (k 4): entra en 5, sale en 6.
    # F (k 7): 7 < 6 + 1 + 1 → enfriamiento. G (k 8): entra en 9 y no alcanza → abierta al final.
    b = velas(*[PLANAS] * 10)
    ks = {"A": 0, "B": 1, "C": 2, "D": 3, "E": 4, "F": 7, "G": 8}
    sigs = [senal(ks[n], sid=n) for n in "GCAFEDB"]                 # desordenadas a propósito
    out = correr(b, sigs, regla(horizon=2, cooldown=1))
    assert [x["id"] for x in out["results"]] == list("GCAFEDB")    # en el orden de entrada
    assert [(t["n"], t["id"], t["exit_i"]) for t in out["trades"]] == [(1, "A", 2), (2, "E", 6)]
    assert out["fates"] == {"B": "posición abierta", "C": "posición abierta",
                            "D": "enfriamiento", "F": "enfriamiento",
                            "G": "abierta al final de la fase"}
    assert all("n" not in x for x in out["results"])


def test_seleccion_una_abierta_al_final_ocupa_todo_lo_que_sigue():
    b = velas(*[PLANAS] * 8)
    out = correr(b, [senal(0, sid="A"), senal(5, sid="B")], regla())
    assert out["trades"] == []
    assert out["fates"] == {"A": "abierta al final de la fase", "B": "posición abierta"}
    # sin una posición a la vez cada una queda abierta por su cuenta
    out = correr(b, [senal(0, sid="A"), senal(5, sid="B")], regla(one=False))
    assert out["fates"] == {"A": "abierta al final de la fase", "B": "abierta al final de la fase"}


def test_seleccion_con_limit_por_orden_de_llenado():
    b = velas((100, 100.5, 99.8, 100), (100, 100.3, 99.6, 99.9), (99.9, 100.2, 99.0, 99.5),
              (99.5, 99.7, 98.4, 99.2), (99.2, 99.4, 97.4, 98.0), (98, 98.5, 97.8, 98.2))
    ent = {"type": "limit", "at": "near", "expiry": 5}
    # cada trade sale por tiempo al cierre de su vela del llenado (horizonte 1); stop a 3 ATR
    sigs = [senal(0, zone=[97, 97.5], sid="A"),      # limit 97.5: llena en la vela 4
            senal(1, zone=[98.8, 99.2], sid="B"),    # limit 99.2: llena en la 2
            senal(1, zone=[98, 98.5], sid="C"),      # limit 98.5: llena en la 3
            senal(1, zone=[98.9, 99.3], sid="D")]    # limit 99.3: llena en la 2, como B
    rl = regla(entry=ent, stop={"type": "atr", "atr": 3.0}, horizon=1, cooldown=1)
    out = correr(b, sigs, rl)
    assert [r["entry_i"] for r in out["results"]] == [4, 2, 3, 2]
    # orden (entry_i, k): B (2,1), D (2,1), C (3,1), A (4,0). B se toma y sale en 2;
    # D: 2 < 2 + 1 → posición abierta; C: 3 < 2 + 1 + 1 → enfriamiento; A: 4 → se toma.
    assert [(t["n"], t["id"]) for t in out["trades"]] == [(1, "B"), (2, "A")]
    assert out["fates"] == {"D": "posición abierta", "C": "enfriamiento"}
    # sin enfriamiento C también entra: B, C (sale en 3) y A (4 >= 3 + 1)
    rl0 = regla(entry=ent, stop={"type": "atr", "atr": 3.0}, horizon=1)
    assert [t["id"] for t in correr(b, sigs, rl0)["trades"]] == ["B", "C", "A"]


def test_seleccion_sin_una_posicion_a_la_vez():
    # todas las que entran son trades, en orden de k; C (entra en 8, horizonte 2) queda abierta
    b = velas(*[PLANAS] * 9)
    sigs = [senal(1, sid="B"), senal(0, sid="A"), senal(7, sid="C")]
    out = correr(b, sigs, regla(one=False, horizon=2))
    assert [(t["n"], t["id"]) for t in out["trades"]] == [(1, "A"), (2, "B")]
    assert out["fates"] == {"C": "abierta al final de la fase"}


def test_seleccion_dos_ordenes_misma_vela_una_sola_vez():
    # dos señales en la misma vela k con dos órdenes: cada una se simula (las dos llenan arriba
    # en 101), pero la vela pone sus órdenes una sola vez → queda X. El motivo de Y es propio
    # del oráculo (la especificación no lo nombra).
    b = velas((99.8, 100.3, 99.6, 100), (100, 101.5, 99.5, 101.2), (101.2, 101.6, 100.9, 101.4))
    rl = regla(entry={"type": "straddle", "from": "close", "offset": 1.0, "expiry": 1},
               stop={"type": "atr", "atr": 3.0}, horizon=1, one=False)
    out = correr(b, [senal(0, sides=(1, -1), sid="X"), senal(0, sides=(1, -1), sid="Y")], rl)
    assert [x["entry"] for x in out["results"]] == [101, 101]
    assert [t["id"] for t in out["trades"]] == ["X"]
    assert out["fates"] == {"Y": "misma vela"}


# ------------------------------------------------------------------ simetría largo / corto

def _espejo(bars):
    return [{"t": x["t"], "o": 200 - x["o"], "h": 200 - x["l"], "l": 200 - x["h"],
             "c": 200 - x["c"], "v": x["v"]} for x in bars]


ESCENARIOS = {
    "trailing swing": (
        [(100, 100.5, 99.5, 100), (100, 101, 99.8, 100.8), (100.8, 101.2, 100.2, 100.4),
         (100.4, 100.6, 99.9, 100.3), (100.3, 101.5, 100.1, 101.3), (101.3, 101.6, 99.7, 99.8)],
        None, regla(stop={"type": "atr", "atr": 2.0}, trail="swing", trailBars=1), 1.0),
    "objetivo arrastrado": (
        [(100, 100.5, 99.5, 100), (100, 101, 99.6, 100.8), (100.8, 102.6, 100.7, 102.4),
         (102.4, 103.5, 102.3, 103.3), (103.3, 103.4, 102.5, 102.7)],
        None, regla(targetR=3, tpTrail={"start": 2.0, "dist": 0.5, "unit": "r"}), 1.0),
    "limit con objetivo diferido": (
        [(100, 100.5, 99.5, 100), (100, 100.2, 99, 99.5), (99.5, 99.8, 98.5, 99.6),
         (99.6, 103, 99.4, 102.8)],
        [98, 99], regla(entry={"type": "limit", "at": "near", "expiry": 3}, targetR=2), 1.0),
    "orden stop": (
        [(99.5, 100, 99, 99.8), (99.8, 100.8, 99.5, 100.5), (100.5, 101.5, 100.2, 101.2),
         (101.2, 103.5, 101, 103)],
        [99, 100], regla(entry={"type": "stop", "offset": 0.5, "expiry": 3}, targetR=1), 2.0),
    "trailing atr": (
        [(100, 100.5, 99.5, 100), (100, 100.8, 99.5, 100.6), (100.6, 102, 100.4, 101.8),
         (101.8, 102.2, 100.3, 100.6)],
        None, regla(trail="atr", trailAtr=1.5, trailStart=1.0), 1.0),
    "misma vela con el recorrido supuesto": (
        [(100, 100.5, 99.5, 100), (100, 100.6, 99.6, 100.2), (100.8, 101.5, 98.5, 99.5)],
        None, regla(targetR=1), 1.0),
}


@pytest.mark.parametrize("nombre", list(ESCENARIOS))
def test_el_corto_en_espejo_da_lo_mismo_que_el_largo(nombre):
    # precio p → 200 - p (y el máximo pasa a ser el mínimo): el corto debe repetir el largo.
    rows, zone, rl, atr = ESCENARIOS[nombre]
    b = velas(*rows)
    largo = uno(b, senal(0, zone=zone), rl, atr=atr)
    zona_c = None if zone is None else [200 - zone[1], 200 - zone[0]]
    corto = uno(_espejo(b), senal(0, side=-1, zone=zona_c), rl, atr=atr)
    assert "skip" not in largo and "open" not in largo
    for key in ("entry_i", "exit_i", "reason", "bars", "order", "exit_t", "entry_t"):
        assert corto[key] == largo[key], key
    for key in ("gross", "r", "mfe", "mae", "risk", "stop_atr"):
        assert corto[key] == A(largo[key]), key
    for key in ("entry", "exit", "stop"):
        assert corto[key] == A(200 - largo[key]), key
    if largo["target"] is not None:
        assert corto["target"] == A(200 - largo["target"])
    assert (corto["reach"] is None) == (largo["reach"] is None)
    if largo["reach"] is not None:
        assert corto["reach"] == A(largo["reach"])
    assert corto.get("tp_on") == largo.get("tp_on")
