# -*- coding: utf-8 -*-
"""
Tests para LimitedMemoryCache (LRU Cache con límite de memoria)
"""
import sys
from pathlib import Path

# Agregar el directorio padre al path para importar main
sys.path.insert(0, str(Path(__file__).parent.parent))

from main import LimitedMemoryCache


class TestLimitedMemoryCache:
    """Tests para el caché LRU con límite de memoria"""

    def test_basic_set_get(self):
        """Test básico de guardar y recuperar"""
        cache = LimitedMemoryCache(max_size_mb=1, name="test")
        cache.set("key1", {"data": "value1"})

        result = cache.get("key1")
        assert result == {"data": "value1"}

    def test_cache_miss(self):
        """Test de cache miss retorna None"""
        cache = LimitedMemoryCache(max_size_mb=1, name="test")

        result = cache.get("nonexistent")
        assert result is None

    def test_hit_counter(self):
        """Test de contador de hits"""
        cache = LimitedMemoryCache(max_size_mb=1, name="test")
        cache.set("key1", "value1")

        # Primer acceso = hit
        cache.get("key1")
        assert cache.hits == 1

        # Segundo acceso = otro hit
        cache.get("key1")
        assert cache.hits == 2

    def test_miss_counter(self):
        """Test de contador de misses"""
        cache = LimitedMemoryCache(max_size_mb=1, name="test")

        cache.get("nonexistent1")
        cache.get("nonexistent2")

        assert cache.misses == 2

    def test_stats(self):
        """Test de estadísticas"""
        cache = LimitedMemoryCache(max_size_mb=10, name="test_cache")
        cache.set("key1", "value1")
        cache.get("key1")  # hit
        cache.get("key2")  # miss

        stats = cache.stats()

        assert stats["name"] == "test_cache"
        assert stats["entries"] == 1
        assert stats["hits"] == 1
        assert stats["misses"] == 1
        assert stats["hit_rate_percent"] == 50.0

    def test_eviction_on_limit(self):
        """Test de evicción cuando se supera el límite"""
        # Caché muy pequeño (1KB)
        cache = LimitedMemoryCache(max_size_mb=0.001, name="test")

        # Agregar datos que excedan 1KB
        cache.set("key1", "x" * 500)
        cache.set("key2", "y" * 500)
        cache.set("key3", "z" * 500)

        # Debería haber evictado algunas entradas
        # El primero debería haberse evictado
        assert cache.get("key1") is None or cache.entries_count() <= 2

    def test_clear(self):
        """Test de limpiar caché"""
        cache = LimitedMemoryCache(max_size_mb=1, name="test")
        cache.set("key1", "value1")
        cache.set("key2", "value2")
        cache.get("key1")  # hit

        cache.clear()

        assert cache.get("key1") is None
        assert cache.get("key2") is None
        assert cache.hits == 0
        assert cache.misses == 0

    def test_contains(self):
        """Test de operador 'in'"""
        cache = LimitedMemoryCache(max_size_mb=1, name="test")
        cache.set("key1", "value1")

        assert "key1" in cache
        assert "key2" not in cache

    def test_bracket_access(self):
        """Test de acceso con corchetes"""
        cache = LimitedMemoryCache(max_size_mb=1, name="test")

        # Escribir con corchetes
        cache["key1"] = "value1"

        # Leer con corchetes
        assert cache["key1"] == "value1"

    def test_bracket_keyerror(self):
        """Test de KeyError con corchetes"""
        cache = LimitedMemoryCache(max_size_mb=1, name="test")

        try:
            _ = cache["nonexistent"]
            assert False, "Debería lanzar KeyError"
        except KeyError:
            pass  # Esperado

    def test_lru_order(self):
        """Test de orden LRU (último accedido al final)"""
        cache = LimitedMemoryCache(max_size_mb=1, name="test")
        cache.set("key1", "value1")
        cache.set("key2", "value2")
        cache.set("key3", "value3")

        # Acceder a key1 lo mueve al final
        cache.get("key1")

        # El orden interno debería ser: key2, key3, key1
        keys = list(cache.cache.keys())
        assert keys[-1] == "key1"  # key1 debería estar al final

    def test_overwrite_existing_key(self):
        """Test de sobrescribir una key existente"""
        cache = LimitedMemoryCache(max_size_mb=1, name="test")
        cache.set("key1", "value1")
        cache.set("key1", "value2")  # Sobrescribir

        assert cache.get("key1") == "value2"
        assert len(cache.cache) == 1  # Solo una entrada

    def entries_count(self):
        """Helper para contar entradas"""
        return len(self.cache)
