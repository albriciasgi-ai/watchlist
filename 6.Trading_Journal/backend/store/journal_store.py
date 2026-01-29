"""
Trading Journal - SQLite Store
Almacenamiento persistente para entries del journal.
"""

import sqlite3
import json
import os
import logging
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
from contextlib import contextmanager

from models.journal_entry import (
    JournalEntry,
    TradeSource,
    TradeDirection,
    TradeStatus
)

logger = logging.getLogger(__name__)


class JournalStore:
    """Store SQLite para el Trading Journal"""

    def __init__(self, db_path: str = "data/journal.db"):
        self.db_path = db_path
        self._ensure_directory()
        self._init_db()

    def _ensure_directory(self):
        """Asegura que el directorio existe"""
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)

    @contextmanager
    def _get_connection(self):
        """Context manager para conexiones"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception as e:
            conn.rollback()
            logger.error(f"Database error: {e}")
            raise
        finally:
            conn.close()

    def _init_db(self):
        """Inicializa el schema de la base de datos"""
        with self._get_connection() as conn:
            cursor = conn.cursor()

            # Tabla principal de entries
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS journal_entries (
                    id TEXT PRIMARY KEY,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    symbol TEXT NOT NULL,
                    direction TEXT NOT NULL,
                    status TEXT NOT NULL,
                    source TEXT NOT NULL,
                    source_alert_id TEXT,
                    entry_time TEXT NOT NULL,
                    exit_time TEXT,
                    duration_minutes INTEGER DEFAULT 0,
                    entry_price REAL NOT NULL,
                    exit_price REAL,
                    pnl_usd REAL DEFAULT 0,
                    pnl_percent REAL DEFAULT 0,
                    r_multiple REAL DEFAULT 0,
                    entry_fee_usd REAL DEFAULT 0,
                    exit_fee_usd REAL DEFAULT 0,
                    total_fees_usd REAL DEFAULT 0,
                    screenshot_entry TEXT,
                    screenshot_exit TEXT,
                    market_context TEXT,
                    setup TEXT,
                    execution TEXT,
                    reflection TEXT,
                    bybit_order_id TEXT,
                    notes TEXT
                )
            ''')

            # Indices para busquedas comunes
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_symbol ON journal_entries(symbol)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_status ON journal_entries(status)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_source ON journal_entries(source)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_entry_time ON journal_entries(entry_time)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_created_at ON journal_entries(created_at)')

            # Tabla para metricas agregadas (cache)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS metrics_cache (
                    id TEXT PRIMARY KEY,
                    period TEXT NOT NULL,
                    start_date TEXT NOT NULL,
                    end_date TEXT NOT NULL,
                    metrics TEXT NOT NULL,
                    calculated_at TEXT NOT NULL
                )
            ''')

            # Tabla para alertas recibidas (tracking de source)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS received_alerts (
                    id TEXT PRIMARY KEY,
                    timestamp TEXT NOT NULL,
                    source TEXT NOT NULL,
                    symbol TEXT NOT NULL,
                    direction TEXT NOT NULL,
                    pattern_type TEXT,
                    price REAL,
                    raw_data TEXT,
                    matched_entry_id TEXT
                )
            ''')

            cursor.execute('CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON received_alerts(timestamp)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_alerts_symbol ON received_alerts(symbol)')

            logger.info(f"Database initialized at {self.db_path}")

    # ==================== CRUD Operations ====================

    def create(self, entry: JournalEntry) -> JournalEntry:
        """Crea una nueva entrada en el journal"""
        with self._get_connection() as conn:
            cursor = conn.cursor()

            data = entry.to_dict()

            cursor.execute('''
                INSERT INTO journal_entries (
                    id, created_at, updated_at, symbol, direction, status, source,
                    source_alert_id, entry_time, exit_time, duration_minutes,
                    entry_price, exit_price, pnl_usd, pnl_percent, r_multiple,
                    entry_fee_usd, exit_fee_usd, total_fees_usd,
                    screenshot_entry, screenshot_exit,
                    market_context, setup, execution, reflection,
                    bybit_order_id, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                data['id'],
                data['created_at'],
                data['updated_at'],
                data['symbol'],
                data['direction'],
                data['status'],
                data['source'],
                data['source_alert_id'],
                data['entry_time'],
                data['exit_time'],
                data['duration_minutes'],
                data['entry_price'],
                data['exit_price'],
                data['pnl_usd'],
                data['pnl_percent'],
                data['r_multiple'],
                data['entry_fee_usd'],
                data['exit_fee_usd'],
                data['total_fees_usd'],
                data['screenshot_entry'],
                data['screenshot_exit'],
                json.dumps(data['market_context']),
                json.dumps(data['setup']),
                json.dumps(data['execution']),
                json.dumps(data['reflection']),
                data['bybit_order_id'],
                data['notes']
            ))

            logger.info(f"Created journal entry: {entry.id} - {entry.symbol} {entry.direction.value}")
            return entry

    def get(self, entry_id: str) -> Optional[JournalEntry]:
        """Obtiene una entrada por ID"""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM journal_entries WHERE id = ?', (entry_id,))
            row = cursor.fetchone()

            if row:
                return self._row_to_entry(row)
            return None

    def update(self, entry: JournalEntry) -> JournalEntry:
        """Actualiza una entrada existente"""
        entry.updated_at = datetime.utcnow().isoformat()

        with self._get_connection() as conn:
            cursor = conn.cursor()
            data = entry.to_dict()

            cursor.execute('''
                UPDATE journal_entries SET
                    updated_at = ?,
                    symbol = ?,
                    direction = ?,
                    status = ?,
                    source = ?,
                    source_alert_id = ?,
                    entry_time = ?,
                    exit_time = ?,
                    duration_minutes = ?,
                    entry_price = ?,
                    exit_price = ?,
                    pnl_usd = ?,
                    pnl_percent = ?,
                    r_multiple = ?,
                    entry_fee_usd = ?,
                    exit_fee_usd = ?,
                    total_fees_usd = ?,
                    screenshot_entry = ?,
                    screenshot_exit = ?,
                    market_context = ?,
                    setup = ?,
                    execution = ?,
                    reflection = ?,
                    bybit_order_id = ?,
                    notes = ?
                WHERE id = ?
            ''', (
                data['updated_at'],
                data['symbol'],
                data['direction'],
                data['status'],
                data['source'],
                data['source_alert_id'],
                data['entry_time'],
                data['exit_time'],
                data['duration_minutes'],
                data['entry_price'],
                data['exit_price'],
                data['pnl_usd'],
                data['pnl_percent'],
                data['r_multiple'],
                data['entry_fee_usd'],
                data['exit_fee_usd'],
                data['total_fees_usd'],
                data['screenshot_entry'],
                data['screenshot_exit'],
                json.dumps(data['market_context']),
                json.dumps(data['setup']),
                json.dumps(data['execution']),
                json.dumps(data['reflection']),
                data['bybit_order_id'],
                data['notes'],
                data['id']
            ))

            logger.info(f"Updated journal entry: {entry.id}")
            return entry

    def delete(self, entry_id: str) -> bool:
        """Elimina una entrada"""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('DELETE FROM journal_entries WHERE id = ?', (entry_id,))

            if cursor.rowcount > 0:
                logger.info(f"Deleted journal entry: {entry_id}")
                return True
            return False

    # ==================== Query Operations ====================

    def list_all(
        self,
        limit: int = 100,
        offset: int = 0,
        status: Optional[TradeStatus] = None,
        symbol: Optional[str] = None,
        source: Optional[TradeSource] = None,
        direction: Optional[TradeDirection] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        order_by: str = "entry_time",
        order_dir: str = "DESC"
    ) -> List[JournalEntry]:
        """Lista entries con filtros"""
        with self._get_connection() as conn:
            cursor = conn.cursor()

            query = "SELECT * FROM journal_entries WHERE 1=1"
            params = []

            if status:
                query += " AND status = ?"
                params.append(status.value if isinstance(status, TradeStatus) else status)

            if symbol:
                query += " AND symbol = ?"
                params.append(symbol)

            if source:
                query += " AND source = ?"
                params.append(source.value if isinstance(source, TradeSource) else source)

            if direction:
                query += " AND direction = ?"
                params.append(direction.value if isinstance(direction, TradeDirection) else direction)

            if start_date:
                query += " AND entry_time >= ?"
                params.append(start_date)

            if end_date:
                query += " AND entry_time <= ?"
                params.append(end_date)

            # Validar order_by para prevenir SQL injection
            valid_columns = ['entry_time', 'created_at', 'updated_at', 'symbol', 'pnl_usd', 'pnl_percent']
            if order_by not in valid_columns:
                order_by = 'entry_time'

            order_dir = "DESC" if order_dir.upper() == "DESC" else "ASC"

            query += f" ORDER BY {order_by} {order_dir} LIMIT ? OFFSET ?"
            params.extend([limit, offset])

            cursor.execute(query, params)
            rows = cursor.fetchall()

            return [self._row_to_entry(row) for row in rows]

    def get_open_entries(self) -> List[JournalEntry]:
        """Obtiene todas las entradas con status OPEN"""
        return self.list_all(status=TradeStatus.OPEN, limit=1000)

    def get_by_symbol(self, symbol: str, limit: int = 50) -> List[JournalEntry]:
        """Obtiene entries por simbolo"""
        return self.list_all(symbol=symbol, limit=limit)

    def get_by_date_range(self, start_date: str, end_date: str) -> List[JournalEntry]:
        """Obtiene entries en un rango de fechas"""
        return self.list_all(start_date=start_date, end_date=end_date, limit=10000)

    def count(
        self,
        status: Optional[TradeStatus] = None,
        symbol: Optional[str] = None,
        source: Optional[TradeSource] = None
    ) -> int:
        """Cuenta entries con filtros"""
        with self._get_connection() as conn:
            cursor = conn.cursor()

            query = "SELECT COUNT(*) FROM journal_entries WHERE 1=1"
            params = []

            if status:
                query += " AND status = ?"
                params.append(status.value if isinstance(status, TradeStatus) else status)

            if symbol:
                query += " AND symbol = ?"
                params.append(symbol)

            if source:
                query += " AND source = ?"
                params.append(source.value if isinstance(source, TradeSource) else source)

            cursor.execute(query, params)
            return cursor.fetchone()[0]

    # ==================== Alert Tracking ====================

    def save_received_alert(self, alert_data: Dict[str, Any]) -> str:
        """Guarda una alerta recibida para tracking"""
        import uuid
        alert_id = str(uuid.uuid4())

        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO received_alerts (
                    id, timestamp, source, symbol, direction, pattern_type, price, raw_data, matched_entry_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                alert_id,
                datetime.utcnow().isoformat(),
                alert_data.get('source', 'unknown'),
                alert_data.get('symbol', ''),
                alert_data.get('direction', ''),
                alert_data.get('pattern_type', ''),
                alert_data.get('price', 0),
                json.dumps(alert_data),
                None
            ))

            logger.info(f"Saved received alert: {alert_id} - {alert_data.get('symbol')}")
            return alert_id

    def get_recent_alerts(self, minutes: int = 30, symbol: Optional[str] = None) -> List[Dict]:
        """Obtiene alertas recientes para matching con positions"""
        with self._get_connection() as conn:
            cursor = conn.cursor()

            cutoff = (datetime.utcnow() - timedelta(minutes=minutes)).isoformat()

            query = "SELECT * FROM received_alerts WHERE timestamp >= ?"
            params = [cutoff]

            if symbol:
                query += " AND symbol = ?"
                params.append(symbol)

            query += " ORDER BY timestamp DESC"

            cursor.execute(query, params)
            rows = cursor.fetchall()

            return [dict(row) for row in rows]

    def match_alert_to_entry(self, alert_id: str, entry_id: str):
        """Vincula una alerta con una entrada del journal"""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE received_alerts SET matched_entry_id = ? WHERE id = ?
            ''', (entry_id, alert_id))

            logger.info(f"Matched alert {alert_id} to entry {entry_id}")

    # ==================== Statistics ====================

    def get_statistics(
        self,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        symbol: Optional[str] = None
    ) -> Dict[str, Any]:
        """Calcula estadisticas basicas"""
        entries = self.list_all(
            start_date=start_date,
            end_date=end_date,
            symbol=symbol,
            limit=10000
        )

        # Filtrar solo trades cerrados
        closed_entries = [e for e in entries if e.status != TradeStatus.OPEN]

        if not closed_entries:
            return {
                'total_trades': 0,
                'open_trades': len([e for e in entries if e.status == TradeStatus.OPEN]),
                'win_rate': 0,
                'total_pnl_usd': 0,
                'avg_pnl_usd': 0,
                'avg_r_multiple': 0,
                'profit_factor': 0,
                'avg_duration_minutes': 0,
                'best_trade_usd': 0,
                'worst_trade_usd': 0,
                'winners': 0,
                'losers': 0,
                'breakeven': 0
            }

        winners = [e for e in closed_entries if e.pnl_usd > 0]
        losers = [e for e in closed_entries if e.pnl_usd < 0]
        breakeven = [e for e in closed_entries if e.pnl_usd == 0]

        total_pnl = sum(e.pnl_usd for e in closed_entries)
        gross_profit = sum(e.pnl_usd for e in winners) if winners else 0
        gross_loss = abs(sum(e.pnl_usd for e in losers)) if losers else 0

        return {
            'total_trades': len(closed_entries),
            'open_trades': len([e for e in entries if e.status == TradeStatus.OPEN]),
            'win_rate': round((len(winners) / len(closed_entries)) * 100, 2) if closed_entries else 0,
            'total_pnl_usd': round(total_pnl, 2),
            'avg_pnl_usd': round(total_pnl / len(closed_entries), 2) if closed_entries else 0,
            'avg_r_multiple': round(sum(e.r_multiple for e in closed_entries) / len(closed_entries), 2) if closed_entries else 0,
            'profit_factor': round(gross_profit / gross_loss, 2) if gross_loss > 0 else float('inf') if gross_profit > 0 else 0,
            'avg_duration_minutes': round(sum(e.duration_minutes for e in closed_entries) / len(closed_entries), 0) if closed_entries else 0,
            'best_trade_usd': round(max(e.pnl_usd for e in closed_entries), 2) if closed_entries else 0,
            'worst_trade_usd': round(min(e.pnl_usd for e in closed_entries), 2) if closed_entries else 0,
            'winners': len(winners),
            'losers': len(losers),
            'breakeven': len(breakeven)
        }

    # ==================== Helper Methods ====================

    def _row_to_entry(self, row: sqlite3.Row) -> JournalEntry:
        """Convierte una fila de SQLite a JournalEntry"""
        data = dict(row)

        # Parsear JSON fields
        if data.get('market_context'):
            data['market_context'] = json.loads(data['market_context'])
        if data.get('setup'):
            data['setup'] = json.loads(data['setup'])
        if data.get('execution'):
            data['execution'] = json.loads(data['execution'])
        if data.get('reflection'):
            data['reflection'] = json.loads(data['reflection'])

        return JournalEntry.from_dict(data)

    def export_to_json(self, filepath: str, **filters) -> int:
        """Exporta entries a JSON"""
        entries = self.list_all(limit=100000, **filters)
        data = [e.to_dict() for e in entries]

        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

        logger.info(f"Exported {len(entries)} entries to {filepath}")
        return len(entries)

    def import_from_json(self, filepath: str) -> int:
        """Importa entries desde JSON"""
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)

        count = 0
        for item in data:
            entry = JournalEntry.from_dict(item)
            try:
                self.create(entry)
                count += 1
            except Exception as e:
                logger.warning(f"Failed to import entry {item.get('id')}: {e}")

        logger.info(f"Imported {count} entries from {filepath}")
        return count
