# -*- coding: utf-8 -*-
"""
Tests para endpoints de la API (básicos)
"""
import sys
from pathlib import Path
import pytest

# Agregar el directorio padre al path
sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi.testclient import TestClient
from main import app


@pytest.fixture
def client():
    """Cliente de test para la API"""
    return TestClient(app)


class TestStatusEndpoint:
    """Tests para /api/status"""

    def test_status_returns_ok(self, client):
        """El endpoint status debe retornar status ok"""
        response = client.get("/api/status")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"

    def test_status_has_version(self, client):
        """El endpoint status debe incluir versión"""
        response = client.get("/api/status")

        data = response.json()
        assert "version" in data
        assert "2.7.0" in data["version"]  # Versión actual

    def test_status_has_memory_cache(self, client):
        """El endpoint status debe incluir estadísticas de caché"""
        response = client.get("/api/status")

        data = response.json()
        assert "memory_cache" in data
        assert "dtb_candles" in data["memory_cache"]
        assert "dtb_patterns" in data["memory_cache"]

    def test_status_has_timezone(self, client):
        """El endpoint status debe incluir timezone"""
        response = client.get("/api/status")

        data = response.json()
        assert "timezone" in data
        assert "Bogota" in data["timezone"]


class TestHistoricalEndpoint:
    """Tests para /api/historical/{symbol}"""

    def test_historical_invalid_symbol(self, client):
        """Símbolo inválido debe manejar el error"""
        response = client.get("/api/historical/INVALID_SYMBOL_XYZ")

        # Puede retornar error o datos vacíos
        assert response.status_code in [200, 400, 404]

    def test_historical_valid_params(self, client):
        """Parámetros válidos deben aceptarse"""
        response = client.get("/api/historical/BTCUSDT?interval=60&days=1")

        # Verificar que acepta los parámetros
        assert response.status_code == 200

    def test_historical_days_limit(self, client):
        """Días excesivos deben limitarse automáticamente"""
        # Pedir 9999 días en 1 minuto (límite es 5)
        response = client.get("/api/historical/BTCUSDT?interval=1&days=9999")

        # No debe crashear
        assert response.status_code == 200


class TestPathTraversalProtection:
    """Tests de seguridad para Path Traversal"""

    def test_historical_path_traversal(self, client):
        """Intento de path traversal debe ser sanitizado"""
        response = client.get("/api/historical/../../../etc/passwd")

        # No debe retornar contenido del sistema de archivos
        assert response.status_code in [200, 400, 404, 422]

        # Si retorna datos, no deben ser del filesystem
        if response.status_code == 200:
            data = response.json()
            assert "root:" not in str(data)  # No contenido de /etc/passwd

    def test_drawings_path_traversal(self, client):
        """Path traversal en drawings debe ser sanitizado"""
        response = client.get("/api/drawings/../../../etc/passwd")

        assert response.status_code in [200, 400, 404, 422]
