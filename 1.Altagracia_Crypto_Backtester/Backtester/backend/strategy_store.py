# strategy_store.py
# Almacenamiento persistente de estrategias

import json
import os
from typing import List, Dict, Optional
from datetime import datetime
from strategy_model import Strategy, get_template, list_templates

# Directorio para guardar estrategias
STRATEGIES_DIR = os.path.join(os.path.dirname(__file__), "strategies")


class StrategyStore:
    """Gestiona el almacenamiento de estrategias en archivos JSON"""

    def __init__(self, strategies_dir: str = STRATEGIES_DIR):
        self.strategies_dir = strategies_dir
        self._ensure_dir_exists()

    def _ensure_dir_exists(self):
        """Crea el directorio si no existe"""
        if not os.path.exists(self.strategies_dir):
            os.makedirs(self.strategies_dir)
            print(f"[StrategyStore] Created directory: {self.strategies_dir}")

    def _get_filepath(self, strategy_id: str) -> str:
        """Obtiene la ruta del archivo para una estrategia"""
        return os.path.join(self.strategies_dir, f"{strategy_id}.json")

    def save(self, strategy: Strategy) -> bool:
        """Guarda una estrategia"""
        try:
            strategy.updated_at = datetime.now().isoformat()
            filepath = self._get_filepath(strategy.id)

            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(strategy.to_dict(), f, indent=2, ensure_ascii=False)

            print(f"[StrategyStore] Saved strategy: {strategy.name} ({strategy.id})")
            return True
        except Exception as e:
            print(f"[StrategyStore] Error saving strategy: {e}")
            return False

    def load(self, strategy_id: str) -> Optional[Strategy]:
        """Carga una estrategia por ID"""
        try:
            filepath = self._get_filepath(strategy_id)

            if not os.path.exists(filepath):
                print(f"[StrategyStore] Strategy not found: {strategy_id}")
                return None

            with open(filepath, 'r', encoding='utf-8') as f:
                data = json.load(f)

            return Strategy.from_dict(data)
        except Exception as e:
            print(f"[StrategyStore] Error loading strategy: {e}")
            return None

    def delete(self, strategy_id: str) -> bool:
        """Elimina una estrategia"""
        try:
            filepath = self._get_filepath(strategy_id)

            if os.path.exists(filepath):
                os.remove(filepath)
                print(f"[StrategyStore] Deleted strategy: {strategy_id}")
                return True
            return False
        except Exception as e:
            print(f"[StrategyStore] Error deleting strategy: {e}")
            return False

    def list_all(self) -> List[Dict]:
        """Lista todas las estrategias (metadata básica)"""
        strategies = []

        try:
            for filename in os.listdir(self.strategies_dir):
                if filename.endswith('.json'):
                    filepath = os.path.join(self.strategies_dir, filename)
                    try:
                        with open(filepath, 'r', encoding='utf-8') as f:
                            data = json.load(f)
                            strategies.append({
                                "id": data.get("id"),
                                "name": data.get("name"),
                                "description": data.get("description", ""),
                                "version": data.get("version", "1.0"),
                                "created_at": data.get("created_at"),
                                "updated_at": data.get("updated_at"),
                                "tags": data.get("tags", []),
                                "is_active": data.get("is_active", True)
                            })
                    except Exception as e:
                        print(f"[StrategyStore] Error reading {filename}: {e}")
        except Exception as e:
            print(f"[StrategyStore] Error listing strategies: {e}")

        # Ordenar por fecha de actualización (más reciente primero)
        strategies.sort(key=lambda x: x.get("updated_at", ""), reverse=True)
        return strategies

    def exists(self, strategy_id: str) -> bool:
        """Verifica si una estrategia existe"""
        return os.path.exists(self._get_filepath(strategy_id))

    def duplicate(self, strategy_id: str, new_name: str = None) -> Optional[Strategy]:
        """Duplica una estrategia existente"""
        original = self.load(strategy_id)
        if not original:
            return None

        # Crear copia con nuevo ID
        import uuid
        new_strategy = Strategy.from_dict(original.to_dict())
        new_strategy.id = str(uuid.uuid4())
        new_strategy.name = new_name or f"{original.name} (copia)"
        new_strategy.created_at = datetime.now().isoformat()
        new_strategy.updated_at = datetime.now().isoformat()

        if self.save(new_strategy):
            return new_strategy
        return None

    def create_from_template(self, template_name: str) -> Optional[Strategy]:
        """Crea una nueva estrategia desde un template"""
        template = get_template(template_name)
        if template:
            if self.save(template):
                return template
        return None

    def get_templates(self) -> List[Dict]:
        """Lista templates disponibles"""
        return list_templates()


# Instancia global
strategy_store = StrategyStore()
