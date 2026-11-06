import { useState, useEffect } from 'react';
import { API_BASE_URL } from '../config';
import './components.css';

const ORIGINS = [
  { id: 'ANALIZADOR', label: 'Analizador' },
  { id: 'WATCHLIST', label: 'Watchlist' },
  { id: 'ORDERFLOW', label: 'Order Flow' },
];

const AlertOriginsPanel = () => {
  const [allowedOrigins, setAllowedOrigins] = useState(null);
  const [updating, setUpdating] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchOrigins = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/settings`);
        const data = await response.json();
        if (!data.allowed_origins) {
          setError('Reinicia el backend del bot para activar este filtro');
          return;
        }
        setAllowedOrigins(data.allowed_origins);
      } catch (err) {
        setError('No se pudo leer el filtro de origenes');
      }
    };

    fetchOrigins();
  }, []);

  const handleToggle = async (origin, enabled) => {
    setUpdating(origin);
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/settings/allowed-origins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin, enabled }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      setAllowedOrigins(data.allowed_origins);
    } catch (err) {
      setError(`No se pudo actualizar ${origin}`);
    } finally {
      setUpdating(null);
    }
  };

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}
      {allowedOrigins && ORIGINS.map(({ id, label }) => (
        <label key={id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0' }}>
          <input
            type="checkbox"
            checked={allowedOrigins[id] === true}
            disabled={updating !== null}
            onChange={(e) => handleToggle(id, e.target.checked)}
          />
          <span>{label}: {allowedOrigins[id] ? 'permitido' : 'bloqueado'}</span>
        </label>
      ))}
    </div>
  );
};

export default AlertOriginsPanel;
