"""Imágenes de los trades: se guardan y se pueden volver a leer. Uso: python -m pytest tests/test_screenshots.py"""
import pytest
from fastapi.testclient import TestClient

import main

PNG = b"\x89PNG\r\n\x1a\n" + b"imagen"
SESSION = "session_BTCUSDT_1"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "SCREENSHOTS_DIR", tmp_path / "sessions")
    return TestClient(main.app)


def upload(client, session=SESSION, content=PNG, kind="image/png"):
    return client.post(f"/api/screenshots/session/{session}", files={"file": ("order_1.png", content, kind)})


def test_una_imagen_guardada_se_puede_leer(client):
    session, filename = upload(client).json()["screenshotPath"].split("/")
    response = client.get(f"/api/screenshots/session/{session}/{filename}")
    assert response.status_code == 200
    assert response.content == PNG
    assert response.headers["content-type"] == "image/png"


def test_el_nombre_guardado_conserva_su_extension(client):
    assert upload(client).json()["screenshotPath"].endswith(".png")


def test_tambien_se_lee_sin_extension(client):
    session, filename = upload(client).json()["screenshotPath"].split("/")
    response = client.get(f"/api/screenshots/session/{session}/{filename[:-4]}")
    assert response.status_code == 200


def test_cada_sesion_tiene_su_carpeta(client):
    session, filename = upload(client, session="session_A").json()["screenshotPath"].split("/")
    assert session == "session_A"
    assert client.get(f"/api/screenshots/session/session_B/{filename}").status_code == 404


def test_una_imagen_que_no_existe_da_404(client):
    assert client.get(f"/api/screenshots/session/{SESSION}/order_1.png").status_code == 404


def test_no_lee_fuera_de_la_carpeta_de_imagenes(client, tmp_path):
    (tmp_path / "secreto.png").write_bytes(PNG)
    upload(client)
    for name in ["..%2F..%2Fsecreto.png", "..%5C..%5Csecreto.png"]:
        response = client.get(f"/api/screenshots/session/{SESSION}/{name}")
        assert response.status_code == 404, name
        assert response.content != PNG


def test_solo_acepta_imagenes(client):
    assert upload(client, content=b"hola", kind="text/plain").status_code == 400


def test_el_frontend_en_otro_puerto_puede_leer_las_respuestas(client):
    origin = {"Origin": "http://localhost:9001"}
    saved = client.post(f"/api/screenshots/session/{SESSION}", files={"file": ("order_1.png", PNG, "image/png")}, headers=origin)
    assert saved.headers["access-control-allow-origin"] == origin["Origin"]
    session, filename = saved.json()["screenshotPath"].split("/")
    read = client.get(f"/api/screenshots/session/{session}/{filename}", headers=origin)
    assert read.headers["access-control-allow-origin"] == origin["Origin"]


def test_borrar_la_sesion_borra_sus_imagenes(client):
    session, filename = upload(client).json()["screenshotPath"].split("/")
    assert client.delete(f"/api/screenshots/session/{session}").json()["deleted"] == 1
    assert client.get(f"/api/screenshots/session/{session}/{filename}").status_code == 404
