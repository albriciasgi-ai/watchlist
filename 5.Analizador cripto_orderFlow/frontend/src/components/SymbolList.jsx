// src/components/SymbolList.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { API_BASE_URL } from '../config';
import CandleCache from '../utils/CandleCache';

// Monedas por defecto
const DEFAULT_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "XRPUSDT", "TRXUSDT", "GALAUSDT",
  "SUIUSDT", "TRBUSDT", "SOLUSDT", "ADAUSDT", "DOGEUSDT"
];

const STORAGE_KEY = 'analyzer_symbol_list';
const COLLAPSED_KEY = 'analyzer_symbol_list_collapsed';
const WIDTH_KEY = 'analyzer_symbol_list_width';

const MIN_WIDTH = 180;
const MAX_WIDTH = 400;
const DEFAULT_WIDTH = 280;

/**
 * SymbolList - Panel lateral con lista de monedas y variacion diaria
 *
 * Funcionalidades:
 * - Lista de monedas con % variacion desde 7pm Colombia
 * - Click para seleccionar moneda
 * - Navegacion con flechas del teclado
 * - Agregar/eliminar monedas personalizadas
 * - Expandir/colapsar panel
 * - Redimensionar arrastrando el borde
 * - 🚀 Prefetch en hover: precarga datos cuando el usuario pasa el mouse
 */
const SymbolList = ({ currentSymbol, onSymbolSelect, interval = "60", days = 1 }) => {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const saved = localStorage.getItem(COLLAPSED_KEY);
    return saved === 'true';
  });

  const [panelWidth, setPanelWidth] = useState(() => {
    const saved = localStorage.getItem(WIDTH_KEY);
    return saved ? parseInt(saved) : DEFAULT_WIDTH;
  });

  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef(null);

  const [symbols, setSymbols] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Error loading symbol list:', e);
      }
    }
    return DEFAULT_SYMBOLS;
  });

  const [priceChanges, setPriceChanges] = useState({});
  const [isAddingSymbol, setIsAddingSymbol] = useState(false);
  const [newSymbol, setNewSymbol] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(true);

  const listRef = useRef(null);
  const inputRef = useRef(null);
  const prefetchTimeoutRef = useRef(null);
  const prefetchedSymbolsRef = useRef(new Set());

  // 🚀 Prefetch: precarga velas históricas cuando el usuario hace hover
  const prefetchSymbolData = useCallback(async (sym) => {
    // Skip si ya está en cache o es el símbolo actual
    if (sym === currentSymbol) return;
    if (prefetchedSymbolsRef.current.has(`${sym}_${interval}`)) return;

    // Verificar si ya está en cache
    const cached = await CandleCache.get(sym, interval);
    if (cached && cached.candles && cached.candles.length > 0) {
      prefetchedSymbolsRef.current.add(`${sym}_${interval}`);
      console.log(`[Prefetch] ${sym}@${interval} - ya en cache (${cached.candles.length} velas)`);
      return;
    }

    try {
      console.log(`[Prefetch] ${sym}@${interval} - precargando...`);
      const response = await fetch(
        `${API_BASE_URL}/api/historical/${sym}?interval=${interval}&days=${days}`
      );
      const data = await response.json();

      if (data.success && data.candles && data.candles.length > 0) {
        await CandleCache.set(sym, interval, data.candles);
        prefetchedSymbolsRef.current.add(`${sym}_${interval}`);
        console.log(`[Prefetch] ${sym}@${interval} - precargado (${data.candles.length} velas)`);
      }
    } catch (error) {
      console.warn(`[Prefetch] ${sym}@${interval} - error:`, error);
    }
  }, [currentSymbol, interval, days]);

  // Handler para hover con debounce de 300ms
  const handleSymbolHover = useCallback((sym) => {
    // Cancelar prefetch anterior
    if (prefetchTimeoutRef.current) {
      clearTimeout(prefetchTimeoutRef.current);
    }

    // Iniciar nuevo prefetch con delay
    prefetchTimeoutRef.current = setTimeout(() => {
      prefetchSymbolData(sym);
    }, 300);
  }, [prefetchSymbolData]);

  // Cancelar prefetch al salir
  const handleSymbolLeave = useCallback(() => {
    if (prefetchTimeoutRef.current) {
      clearTimeout(prefetchTimeoutRef.current);
      prefetchTimeoutRef.current = null;
    }
  }, []);

  // Limpiar prefetched cuando cambia el interval
  useEffect(() => {
    prefetchedSymbolsRef.current.clear();
  }, [interval]);

  // Guardar lista en localStorage cuando cambia
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(symbols));
  }, [symbols]);

  // Guardar estado colapsado
  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, isCollapsed.toString());
  }, [isCollapsed]);

  // Guardar ancho del panel
  useEffect(() => {
    localStorage.setItem(WIDTH_KEY, panelWidth.toString());
  }, [panelWidth]);

  // Manejar resize con mouse
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing) return;

      const containerRect = resizeRef.current?.parentElement?.getBoundingClientRect();
      if (!containerRect) return;

      // Calcular nuevo ancho (desde la derecha)
      const newWidth = containerRect.right - e.clientX;
      const clampedWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, newWidth));
      setPanelWidth(clampedWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    if (isResizing) {
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  const handleResizeStart = (e) => {
    e.preventDefault();
    setIsResizing(true);
  };

  const toggleCollapse = () => {
    setIsCollapsed(prev => !prev);
  };

  // Actualizar indice seleccionado cuando cambia el simbolo actual
  useEffect(() => {
    const index = symbols.indexOf(currentSymbol);
    if (index !== -1) {
      setSelectedIndex(index);
    }
  }, [currentSymbol, symbols]);

  // Fetch precios usando endpoint optimizado de tickers (una sola llamada)
  const fetchPriceChanges = useCallback(async () => {
    setIsLoading(true);

    try {
      // Una sola llamada para todos los simbolos
      const symbolsParam = symbols.join(',');
      const response = await fetch(
        `${API_BASE_URL}/api/tickers?symbols=${symbolsParam}`
      );
      const data = await response.json();

      if (!data.success) {
        console.error('Error fetching tickers:', data.error);
        setIsLoading(false);
        return;
      }

      const changes = {};
      for (const symbol of symbols) {
        const ticker = data.data[symbol];
        if (ticker) {
          changes[symbol] = {
            change: ticker.price24hPcnt,  // Ya viene en porcentaje
            currentPrice: ticker.lastPrice
          };
        } else {
          changes[symbol] = { change: null, currentPrice: null };
        }
      }

      setPriceChanges(changes);
    } catch (error) {
      console.error('Error fetching price changes:', error);
    } finally {
      setIsLoading(false);
    }
  }, [symbols]);

  // Fetch inicial y cada 60 segundos
  useEffect(() => {
    fetchPriceChanges();
    const interval = setInterval(fetchPriceChanges, 60000);
    return () => clearInterval(interval);
  }, [fetchPriceChanges]);

  // Navegacion con teclado
  useEffect(() => {
    const handleKeyDown = (e) => {
      // No interceptar si estamos escribiendo en el input
      if (isAddingSymbol) return;

      // Solo interceptar si el foco esta en el documento (no en otros inputs)
      if (document.activeElement.tagName === 'INPUT' ||
          document.activeElement.tagName === 'TEXTAREA' ||
          document.activeElement.tagName === 'SELECT') {
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => {
          const newIndex = prev < symbols.length - 1 ? prev + 1 : prev;
          if (newIndex !== prev) {
            onSymbolSelect(symbols[newIndex]);
          }
          return newIndex;
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => {
          const newIndex = prev > 0 ? prev - 1 : prev;
          if (newIndex !== prev) {
            onSymbolSelect(symbols[newIndex]);
          }
          return newIndex;
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [symbols, isAddingSymbol, onSymbolSelect]);

  // Scroll al elemento seleccionado
  useEffect(() => {
    if (listRef.current && selectedIndex >= 0) {
      const items = listRef.current.querySelectorAll('.symbol-list-item');
      if (items[selectedIndex]) {
        items[selectedIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [selectedIndex]);

  // Focus en input cuando se abre el modal de agregar
  useEffect(() => {
    if (isAddingSymbol && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isAddingSymbol]);

  const handleAddSymbol = () => {
    const symbolToAdd = newSymbol.toUpperCase().trim();

    if (!symbolToAdd) {
      setIsAddingSymbol(false);
      return;
    }

    // Agregar USDT si no lo tiene
    const finalSymbol = symbolToAdd.endsWith('USDT') ? symbolToAdd : `${symbolToAdd}USDT`;

    if (symbols.includes(finalSymbol)) {
      alert(`${finalSymbol} ya esta en la lista`);
      return;
    }

    setSymbols(prev => [...prev, finalSymbol]);
    setNewSymbol('');
    setIsAddingSymbol(false);
  };

  const handleRemoveSymbol = (symbolToRemove, e) => {
    e.stopPropagation();

    if (symbols.length <= 1) {
      alert('Debe haber al menos una moneda en la lista');
      return;
    }

    setSymbols(prev => prev.filter(s => s !== symbolToRemove));

    // Si se elimina el simbolo actual, seleccionar el primero
    if (currentSymbol === symbolToRemove) {
      const remaining = symbols.filter(s => s !== symbolToRemove);
      if (remaining.length > 0) {
        onSymbolSelect(remaining[0]);
      }
    }
  };

  const handleKeyDownInput = (e) => {
    if (e.key === 'Enter') {
      handleAddSymbol();
    } else if (e.key === 'Escape') {
      setIsAddingSymbol(false);
      setNewSymbol('');
    }
  };

  const formatChange = (change) => {
    if (change === null || change === undefined) return '--';
    const sign = change >= 0 ? '+' : '';
    return `${sign}${change.toFixed(2)}%`;
  };

  const getChangeColor = (change) => {
    if (change === null || change === undefined) return '#888';
    if (change > 0) return '#00C853';
    if (change < 0) return '#FF1744';
    return '#888';
  };

  // Cuando esta colapsado, mostrar solo el boton de expandir
  if (isCollapsed) {
    return (
      <div
        className="symbol-list-container collapsed"
        ref={resizeRef}
        style={{ width: '40px', minWidth: '40px' }}
      >
        <button
          className="collapse-toggle-btn"
          onClick={toggleCollapse}
          title="Expandir lista de monedas"
        >
          <span style={{ fontSize: '16px' }}>◀</span>
        </button>
      </div>
    );
  }

  return (
    <div
      className="symbol-list-container"
      ref={resizeRef}
      style={{ width: `${panelWidth}px`, minWidth: `${panelWidth}px` }}
    >
      {/* Handle de resize */}
      <div
        className="resize-handle"
        onMouseDown={handleResizeStart}
        title="Arrastrar para redimensionar"
      />

      <div className="symbol-list-header">
        <span>Monedas</span>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            className="add-btn"
            onClick={() => setIsAddingSymbol(true)}
            title="Agregar moneda"
          >
            +
          </button>
          <button
            className="collapse-btn"
            onClick={toggleCollapse}
            title="Colapsar panel"
          >
            ▶
          </button>
        </div>
      </div>

      {isAddingSymbol && (
        <div className="add-symbol-modal" onClick={() => { setIsAddingSymbol(false); setNewSymbol(''); }}>
          <div className="add-symbol-content" onClick={(e) => e.stopPropagation()}>
            <h3>Agregar Moneda</h3>
            <input
              ref={inputRef}
              type="text"
              value={newSymbol}
              onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
              onKeyDown={handleKeyDownInput}
              placeholder="Ej: BTC o BTCUSDT"
            />
            <div className="add-symbol-buttons">
              <button onClick={() => { setIsAddingSymbol(false); setNewSymbol(''); }} className="cancel-btn">Cancelar</button>
              <button onClick={handleAddSymbol} className="confirm-btn">Agregar</button>
            </div>
          </div>
        </div>
      )}

      <div className="symbol-list-items" ref={listRef}>
        {isLoading && symbols.length > 0 && Object.keys(priceChanges).length === 0 && (
          <div className="loading-indicator" style={{ padding: '20px', textAlign: 'center', color: '#888', fontSize: '12px' }}>
            Cargando precios...
          </div>
        )}

        {symbols.map((sym, index) => {
          const data = priceChanges[sym] || {};
          const isSelected = sym === currentSymbol;
          const changeClass = data.change > 0 ? 'positive' : data.change < 0 ? 'negative' : 'neutral';

          return (
            <div
              key={sym}
              className={`symbol-item ${isSelected ? 'selected' : ''} ${index === selectedIndex ? 'keyboard-selected' : ''}`}
              onClick={() => onSymbolSelect(sym)}
              onMouseEnter={() => handleSymbolHover(sym)}
              onMouseLeave={handleSymbolLeave}
            >
              <span className="symbol-name">{sym.replace('USDT', '')}</span>
              <span className={`price-change ${changeClass}`}>
                {formatChange(data.change)}
              </span>
              <button
                className="remove-btn"
                onClick={(e) => handleRemoveSymbol(sym, e)}
                title="Eliminar"
              >
                x
              </button>
            </div>
          );
        })}
      </div>

      <div style={{
        padding: '8px 15px',
        borderTop: '1px solid #DDE2E7',
        background: '#f9fafb',
        fontSize: '10px',
        color: '#888'
      }}>
        <div>Variacion 24h</div>
        <div>Flechas: navegar</div>
      </div>
    </div>
  );
};

export default SymbolList;
