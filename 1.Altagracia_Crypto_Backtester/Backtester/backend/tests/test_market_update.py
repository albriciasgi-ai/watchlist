"""Actualización automática al arrancar el backend (21/11). Uso: python -m pytest tests/test_market_update.py"""
import os
import time

import market_update as mu


def _setup(tmp_path, monkeypatch):
    monkeypatch.setattr(mu, "DIR", tmp_path)
    monkeypatch.setattr(mu, "LOCK", tmp_path / "actualizacion.lock")
    monkeypatch.setattr(mu, "STAMP", tmp_path / "ultima_actualizacion.txt")
    monkeypatch.delenv("TESTER_AUTO_UPDATE", raising=False)


def _old(path, hours):
    t = time.time() - hours * 3600
    os.utime(path, (t, t))


def test_corre_una_vez_cada_dos_horas_y_una_a_la_vez(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    assert mu.due()  # Nunca corrió
    mu.STAMP.write_text("x")
    assert not mu.due()  # Recién corrió: un reinicio por --reload no la repite
    _old(mu.STAMP, 3)
    assert mu.due()
    assert mu._take_lock() and not mu._take_lock()  # Otra que arranca no corre a la vez
    assert not mu.due()
    _old(mu.LOCK, 4)  # Un candado de una vuelta cortada vence
    assert mu.due() and mu._take_lock()
    monkeypatch.setenv("TESTER_AUTO_UPDATE", "0")
    mu.LOCK.unlink()
    assert not mu.due()


def test_sin_carpeta_de_datos_no_lanza_nada(tmp_path, monkeypatch):
    _setup(tmp_path / "no", monkeypatch)
    assert not mu.due() and not mu.start_in_background()
