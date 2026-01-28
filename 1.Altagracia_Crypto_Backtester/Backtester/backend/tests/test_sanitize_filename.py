# -*- coding: utf-8 -*-
"""
Tests para la función sanitize_filename (prevención Path Traversal)
"""
import sys
from pathlib import Path

# Agregar el directorio padre al path para importar main
sys.path.insert(0, str(Path(__file__).parent.parent))

from main import sanitize_filename


class TestSanitizeFilename:
    """Tests para prevención de Path Traversal"""

    def test_normal_symbol(self):
        """Símbolos normales no deben modificarse"""
        assert sanitize_filename("BTCUSDT") == "BTCUSDT"
        assert sanitize_filename("ETHUSDT") == "ETHUSDT"
        assert sanitize_filename("SOL-PERP") == "SOL-PERP"

    def test_path_traversal_dots(self):
        """Debe eliminar intentos de path traversal con .."""
        assert sanitize_filename("../../../etc/passwd") == "etcpasswd"
        assert sanitize_filename("..\\..\\windows\\system32") == "windowssystem32"
        assert sanitize_filename("....") == "invalid"

    def test_path_traversal_slashes(self):
        """Debe eliminar slashes"""
        assert sanitize_filename("/etc/passwd") == "etcpasswd"
        assert sanitize_filename("\\windows\\system32") == "windowssystem32"

    def test_special_characters(self):
        """Debe eliminar caracteres especiales"""
        assert sanitize_filename("BTC<>USDT") == "BTCUSDT"
        assert sanitize_filename("ETH|USDT") == "ETHUSDT"
        assert sanitize_filename("SOL:USDT") == "SOLUSDT"
        assert sanitize_filename("ADA*USDT") == "ADAUSDT"

    def test_empty_result(self):
        """Si todo se elimina, debe retornar 'invalid'"""
        assert sanitize_filename("...") == "invalid"
        assert sanitize_filename("///") == "invalid"
        assert sanitize_filename("<>|:") == "invalid"

    def test_preserves_underscores_hyphens(self):
        """Debe preservar guiones y guiones bajos"""
        assert sanitize_filename("BTC_USDT") == "BTC_USDT"
        assert sanitize_filename("ETH-PERP") == "ETH-PERP"
        assert sanitize_filename("SOL_USDT-PERP") == "SOL_USDT-PERP"

    def test_numbers(self):
        """Debe preservar números"""
        assert sanitize_filename("1000SHIBUSDT") == "1000SHIBUSDT"
        assert sanitize_filename("BTC123") == "BTC123"

    def test_mixed_attack(self):
        """Debe manejar ataques combinados"""
        assert sanitize_filename("../BTC/../USDT/..") == "BTCUSDT"
        assert sanitize_filename("..%2f..%2fetc%2fpasswd") == "2f2fetc2fpasswd"
