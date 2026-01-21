// src/components/trading/TradingPanel.jsx
// Panel lateral de trading con integración al TradingBot backend
import React, { useState, useEffect, useCallback, useRef } from 'react';
import OrderForm from './OrderForm';
import PositionCard from './PositionCard';
import './TradingPanel.css';

const TRADING_BOT_URL = 'http://localhost:5000';

// Función para convertir HSL a RGB
const hslToRgb = (h, s, l) => {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color);
  };
  return [f(0), f(8), f(4)];
};

// Función para generar colores del tema basado en un hue
const generateThemeColors = (hue, isDark = true) => {
  if (isDark) {
    return {
      bgPrimary: `hsl(${hue}, 15%, 12%)`,
      bgSecondary: `hsl(${hue}, 15%, 16%)`,
      bgTertiary: `hsl(${hue}, 15%, 9%)`,
      bgInput: `hsl(${hue}, 15%, 12%)`,
      border: `hsl(${hue}, 12%, 22%)`,
      borderLight: `hsl(${hue}, 12%, 28%)`,
      textPrimary: `hsl(${hue}, 10%, 95%)`,
      textSecondary: `hsl(${hue}, 10%, 70%)`,
      textMuted: `hsl(${hue}, 8%, 55%)`,
      textDim: `hsl(${hue}, 8%, 42%)`,
      shadow: 'rgba(0, 0, 0, 0.35)',
    };
  } else {
    return {
      bgPrimary: `hsl(${hue}, 20%, 98%)`,
      bgSecondary: `hsl(${hue}, 20%, 94%)`,
      bgTertiary: `hsl(${hue}, 20%, 90%)`,
      bgInput: `hsl(${hue}, 20%, 100%)`,
      border: `hsl(${hue}, 15%, 85%)`,
      borderLight: `hsl(${hue}, 15%, 78%)`,
      textPrimary: `hsl(${hue}, 20%, 15%)`,
      textSecondary: `hsl(${hue}, 15%, 35%)`,
      textMuted: `hsl(${hue}, 10%, 50%)`,
      textDim: `hsl(${hue}, 8%, 65%)`,
      shadow: 'rgba(0, 0, 0, 0.1)',
    };
  }
};

const TradingPanel = ({
  isOpen,
  onClose,
  symbol,
  tpslBoxData,  // { entryPrice, slPrice, tpPrice, side: 'Buy'|'Sell' }
  currentPrice
}) => {
  // Color state - cargar desde localStorage
  const [hue, setHue] = useState(() => {
    return parseInt(localStorage.getItem('tradingPanelHue') || '220');
  });
  const [isDarkMode, setIsDarkMode] = useState(() => {
    return localStorage.getItem('tradingPanelDarkMode') !== 'false';
  });

  // Estado de conexión con TradingBot
  const [botStatus, setBotStatus] = useState({
    connected: false,
    hasCredentials: false,
    mode: 'demo',
    checking: true
  });

  // Guardar preferencias en localStorage cuando cambian
  const handleHueChange = useCallback((newHue) => {
    setHue(newHue);
    localStorage.setItem('tradingPanelHue', newHue.toString());
  }, []);

  const handleDarkModeToggle = useCallback(() => {
    setIsDarkMode(prev => {
      const newValue = !prev;
      localStorage.setItem('tradingPanelDarkMode', newValue.toString());
      return newValue;
    });
  }, []);

  // Generar CSS variables basadas en el hue seleccionado
  const themeColors = generateThemeColors(hue, isDarkMode);
  const themeStyle = {
    '--tp-bg-primary': themeColors.bgPrimary,
    '--tp-bg-secondary': themeColors.bgSecondary,
    '--tp-bg-tertiary': themeColors.bgTertiary,
    '--tp-bg-input': themeColors.bgInput,
    '--tp-border': themeColors.border,
    '--tp-border-light': themeColors.borderLight,
    '--tp-text-primary': themeColors.textPrimary,
    '--tp-text-secondary': themeColors.textSecondary,
    '--tp-text-muted': themeColors.textMuted,
    '--tp-text-dim': themeColors.textDim,
    '--tp-shadow': themeColors.shadow,
    '--tp-header-gradient': `linear-gradient(180deg, ${themeColors.bgSecondary} 0%, ${themeColors.bgPrimary} 100%)`,
  };

  // Config del símbolo (stepSize, tickSize, etc)
  const [symbolConfig, setSymbolConfig] = useState(null);

  // Posición actual
  const [position, setPosition] = useState(null);
  const [positionLoading, setPositionLoading] = useState(false);

  // Estado de orden
  const [orderStatus, setOrderStatus] = useState({
    loading: false,
    success: null,
    error: null
  });

  // Polling refs
  const positionPollRef = useRef(null);
  const statusCheckRef = useRef(null);

  // Verificar conexión con TradingBot
  const checkBotConnection = useCallback(async () => {
    try {
      const response = await fetch(`${TRADING_BOT_URL}/api/status`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000)
      });

      if (response.ok) {
        const data = await response.json();
        setBotStatus(prev => ({
          ...prev,
          connected: true,
          hasCredentials: data.credentials_configured || false,
          mode: data.trading_mode || 'demo',
          checking: false
        }));
        return true;
      }
    } catch (error) {
      console.warn('[TradingPanel] Bot not reachable:', error.message);
    }

    setBotStatus(prev => ({
      ...prev,
      connected: false,
      hasCredentials: false,
      checking: false
    }));
    return false;
  }, []);

  // Cargar config del símbolo
  const loadSymbolConfig = useCallback(async () => {
    if (!botStatus.connected) return;

    try {
      const response = await fetch(`${TRADING_BOT_URL}/api/config`);
      if (response.ok) {
        const data = await response.json();
        // El endpoint devuelve { success: true, coins: [...] }
        const coins = data.coins || data.symbols || [];
        const config = coins.find(s => s.symbol === symbol);
        if (config) {
          setSymbolConfig(config);
          console.log('[TradingPanel] Symbol config loaded:', config);
        } else {
          // Símbolo no configurado en el bot
          console.warn(`[TradingPanel] Symbol ${symbol} not found in bot config`);
          setSymbolConfig(null);
        }
      }
    } catch (error) {
      console.error('[TradingPanel] Error loading symbol config:', error);
    }
  }, [symbol, botStatus.connected]);

  // Cargar posición actual
  const loadPosition = useCallback(async () => {
    if (!botStatus.connected || !botStatus.hasCredentials) return;

    setPositionLoading(true);
    try {
      const response = await fetch(`${TRADING_BOT_URL}/api/position/${symbol}`);
      if (response.ok) {
        const data = await response.json();
        console.log('[TradingPanel] Position raw response:', JSON.stringify(data, null, 2));
        // El endpoint devuelve los datos directamente, no anidados en .position
        if (data.success && data.hasPosition) {
          console.log('[TradingPanel] Position found:', {
            size: data.size,
            side: data.side,
            entryPrice: data.entryPrice,
            unrealizedPnl: data.unrealizedPnl,
            markPrice: data.markPrice
          });
          setPosition(data);
        } else {
          console.log('[TradingPanel] No position - success:', data.success, 'hasPosition:', data.hasPosition);
          setPosition(null);
        }
      } else {
        console.error('[TradingPanel] Position fetch failed:', response.status, response.statusText);
      }
    } catch (error) {
      console.warn('[TradingPanel] Error loading position:', error);
    } finally {
      setPositionLoading(false);
    }
  }, [symbol, botStatus.connected, botStatus.hasCredentials]);

  // Enviar orden market
  const submitMarketOrder = useCallback(async (orderData) => {
    if (!botStatus.connected) {
      setOrderStatus({ loading: false, success: false, error: 'TradingBot no conectado' });
      return;
    }

    setOrderStatus({ loading: true, success: null, error: null });

    try {
      const payload = {
        symbol: symbol,
        side: orderData.side, // 'Buy' o 'Sell'
        quantity: orderData.quantity,
        stopLoss: orderData.stopLoss,
        takeProfit: orderData.takeProfit
      };

      console.log('[TradingPanel] Sending order:', payload);

      const response = await fetch(`${TRADING_BOT_URL}/api/trade/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      console.log('[TradingPanel] Response:', data);

      if (response.ok && data.success) {
        setOrderStatus({ loading: false, success: true, error: null });
        // Recargar posición después de ejecutar
        setTimeout(loadPosition, 2000);
      } else {
        // Extract error message from various possible locations
        const errorMsg = data.detail || data.error || data.message ||
                        (data.result && data.result.error) ||
                        `Error ${response.status}: ${response.statusText}`;
        console.error('[TradingPanel] Order failed:', errorMsg);
        setOrderStatus({
          loading: false,
          success: false,
          error: errorMsg
        });
      }
    } catch (error) {
      console.error('[TradingPanel] Order error:', error);
      setOrderStatus({
        loading: false,
        success: false,
        error: error.message || 'Error de conexión'
      });
    }
  }, [symbol, botStatus.connected, loadPosition]);

  // Efectos
  useEffect(() => {
    if (isOpen) {
      checkBotConnection();
    }
    return () => {
      if (statusCheckRef.current) clearInterval(statusCheckRef.current);
      if (positionPollRef.current) clearInterval(positionPollRef.current);
    };
  }, [isOpen, checkBotConnection]);

  // Cargar config cuando cambia símbolo o conexión
  useEffect(() => {
    if (isOpen && botStatus.connected) {
      loadSymbolConfig();
    }
  }, [isOpen, botStatus.connected, loadSymbolConfig]);

  // Polling de posición cada 10s
  useEffect(() => {
    if (isOpen && botStatus.connected && botStatus.hasCredentials) {
      loadPosition();
      positionPollRef.current = setInterval(loadPosition, 10000);
    }
    return () => {
      if (positionPollRef.current) clearInterval(positionPollRef.current);
    };
  }, [isOpen, botStatus.connected, botStatus.hasCredentials, loadPosition]);

  // Re-check bot status cada 30s
  useEffect(() => {
    if (isOpen) {
      statusCheckRef.current = setInterval(checkBotConnection, 30000);
    }
    return () => {
      if (statusCheckRef.current) clearInterval(statusCheckRef.current);
    };
  }, [isOpen, checkBotConnection]);

  if (!isOpen) return null;

  return (
    <div className="trading-panel" style={themeStyle}>
      <div className="trading-panel-header">
        <div className="trading-panel-title">
          <span className="trading-icon">📊</span>
          Trading - {symbol}
        </div>
        {/* Color Picker */}
        <div className="color-picker-wrapper">
          <input
            type="range"
            min="0"
            max="360"
            value={hue}
            onChange={(e) => handleHueChange(parseInt(e.target.value))}
            className="hue-slider"
            title={`Color: ${hue}°`}
          />
          <button
            className={`dark-mode-toggle ${isDarkMode ? 'dark' : 'light'}`}
            onClick={handleDarkModeToggle}
            title={isDarkMode ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
          >
            {isDarkMode ? '🌙' : '☀️'}
          </button>
        </div>
        <button className="trading-panel-close" onClick={onClose}>×</button>
      </div>

      {/* Status de conexión */}
      <div className="trading-panel-status">
        <div className={`status-indicator ${botStatus.connected ? 'connected' : 'disconnected'}`}>
          <span className="status-dot"></span>
          {botStatus.checking ? 'Verificando...' :
           botStatus.connected ? 'Bot Conectado' : 'Bot Desconectado'}
        </div>
        {botStatus.connected && (
          <div className="status-details">
            <span className={`mode-badge ${botStatus.mode}`}>
              {botStatus.mode === 'live' ? '🔴 LIVE' : '🟢 DEMO'}
            </span>
            {!botStatus.hasCredentials && (
              <span className="warning-badge">⚠️ Sin API Keys</span>
            )}
          </div>
        )}
      </div>

      {/* Contenido principal */}
      <div className="trading-panel-content">
        {!botStatus.connected ? (
          <div className="trading-panel-warning">
            <div className="warning-icon">⚠️</div>
            <div className="warning-text">
              <strong>TradingBot no disponible</strong>
              <p>Inicia el backend del TradingBot en el puerto 5000 para habilitar trading.</p>
              <code>cd 3.TradingBot_Python/backend && python main.py</code>
            </div>
            <button className="retry-btn" onClick={checkBotConnection}>
              Reintentar conexión
            </button>
          </div>
        ) : !symbolConfig ? (
          <div className="trading-panel-warning">
            <div className="warning-icon">⚠️</div>
            <div className="warning-text">
              <strong>Símbolo no configurado</strong>
              <p>{symbol} no está en la lista de símbolos del TradingBot.</p>
              <p>Configúralo en trading_config.json</p>
            </div>
          </div>
        ) : (
          <>
            {/* Formulario de orden */}
            <OrderForm
              symbol={symbol}
              symbolConfig={symbolConfig}
              tpslBoxData={tpslBoxData}
              currentPrice={currentPrice}
              onSubmit={submitMarketOrder}
              orderStatus={orderStatus}
              disabled={!botStatus.hasCredentials || orderStatus.loading}
            />

            {/* Posición actual */}
            {(position || positionLoading) && (
              <PositionCard
                position={position}
                loading={positionLoading}
                symbol={symbol}
              />
            )}
          </>
        )}
      </div>

      {/* Footer con shortcut hint */}
      <div className="trading-panel-footer">
        <span className="shortcut-hint">Alt+T para abrir/cerrar</span>
      </div>
    </div>
  );
};

export default TradingPanel;
