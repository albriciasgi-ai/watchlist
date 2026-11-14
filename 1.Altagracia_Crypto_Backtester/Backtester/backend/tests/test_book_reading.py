# Medidas del libro de la suite en el Observador de App 1 (book_reading.py, 14/11/2026), sin la suite ni el libro reales.
import book_reading
import patterns


class FakeBookMeasures:
    GROUP = "Libro"
    CATALOG = [("book_depth05", "Libro: liquidez a ±0.5%"), ("book_entry_usd", "Libro: liquidez en tu entrada")]

    class book_store:
        @staticmethod
        def sources(base):
            return ["base"]

    calls = []

    @classmethod
    def compute(cls, trade, base=None):
        cls.calls.append((trade, base))
        return {"book_depth05": 1.0, "book_entry_usd": 2.0}


def use_fake(monkeypatch):
    FakeBookMeasures.calls = []
    book_reading._cache.clear()
    monkeypatch.setattr(book_reading, "_module", FakeBookMeasures)
    monkeypatch.setattr(book_reading, "_tried", True)


def test_la_orden_del_observador_pasa_como_trade_del_journal(monkeypatch):
    use_fake(monkeypatch)
    t = {"id": "o1", "symbol": "BTCUSDT", "side": "short", "time": book_reading.BOOK_SINCE_MS + 1000, "entry": 65000.0,
         "stop": 65300.0, "fill_time": book_reading.BOOK_SINCE_MS + 61000, "status": "closed"}
    assert book_reading.compute(t) == {"book_depth05": 1.0, "book_entry_usd": 2.0}
    trade, base = FakeBookMeasures.calls[0]
    assert trade == {"symbol": "BTCUSDT", "side": "Sell", "decision": {"at": t["time"]}, "entry": 65000.0,
                     "initial_stop_loss": 65300.0, "opened_at": t["fill_time"]}
    assert base == ["base"]
    book_reading.compute(t)
    assert len(FakeBookMeasures.calls) == 1   # en memoria por orden y estado


def test_antes_del_libro_no_hay_medidas(monkeypatch):
    use_fake(monkeypatch)
    assert book_reading.compute({"id": "o2", "symbol": "BTCUSDT", "side": "long", "time": book_reading.BOOK_SINCE_MS - 1}) == {}
    assert FakeBookMeasures.calls == []


def test_sin_la_suite_nada_cambia(monkeypatch):
    monkeypatch.setattr(book_reading, "_module", None)
    monkeypatch.setattr(book_reading, "_tried", True)
    assert book_reading.catalog() == [] and book_reading.keys() == []
    assert book_reading.compute({"id": "x", "symbol": "BTCUSDT", "time": book_reading.BOOK_SINCE_MS + 1}) == {}


def test_catalogo_y_etiquetas_en_el_grupo_libro(monkeypatch):
    use_fake(monkeypatch)
    assert [c["group"] for c in book_reading.catalog()] == ["Libro", "Libro"]
    assert patterns._labels()["book_entry_usd"] == ("Libro: liquidez en tu entrada", "Libro")
