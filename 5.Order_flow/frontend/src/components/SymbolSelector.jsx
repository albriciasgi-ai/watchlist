// src/components/SymbolSelector.jsx
import React, { useState, useRef, useEffect, useCallback } from 'react';

const SymbolSelector = ({ value, onChange, symbols = [] }) => {
  const [inputValue, setInputValue] = useState(value);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filteredSymbols, setFilteredSymbols] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef(null);
  const suggestionsRef = useRef(null);

  // Actualizar input cuando cambia el valor externo
  useEffect(() => {
    setInputValue(value);
  }, [value]);

  // Filtrar simbolos basado en input
  useEffect(() => {
    if (inputValue.trim() === '') {
      setFilteredSymbols(symbols.slice(0, 10));
    } else {
      const searchTerm = inputValue.toUpperCase();
      const filtered = symbols.filter(s =>
        s.toUpperCase().includes(searchTerm)
      ).slice(0, 10);
      setFilteredSymbols(filtered);
    }
    setSelectedIndex(-1);
  }, [inputValue, symbols]);

  // Cerrar sugerencias al hacer click fuera
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        inputRef.current &&
        !inputRef.current.contains(e.target) &&
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e) => {
    const newValue = e.target.value.toUpperCase();
    setInputValue(newValue);
    setShowSuggestions(true);
  };

  const handleSelectSymbol = useCallback((symbol) => {
    setInputValue(symbol);
    setShowSuggestions(false);
    onChange(symbol);
  }, [onChange]);

  const handleKeyDown = (e) => {
    if (!showSuggestions) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setShowSuggestions(true);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev =>
          prev < filteredSymbols.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => prev > 0 ? prev - 1 : -1);
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < filteredSymbols.length) {
          handleSelectSymbol(filteredSymbols[selectedIndex]);
        } else if (inputValue.trim()) {
          // Validar si el simbolo existe
          const upperInput = inputValue.toUpperCase();
          if (symbols.includes(upperInput)) {
            handleSelectSymbol(upperInput);
          } else {
            // Permitir simbolos personalizados
            handleSelectSymbol(upperInput);
          }
        }
        break;
      case 'Escape':
        setShowSuggestions(false);
        setInputValue(value);
        break;
      default:
        break;
    }
  };

  const handleFocus = () => {
    setShowSuggestions(true);
  };

  return (
    <div className="symbol-selector">
      <div className="symbol-input-wrapper">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          placeholder="Escribir simbolo..."
          className="symbol-input"
          autoComplete="off"
          spellCheck="false"
        />
        <button
          className="symbol-dropdown-btn"
          onClick={() => setShowSuggestions(!showSuggestions)}
          type="button"
        >
          ▼
        </button>
      </div>

      {showSuggestions && filteredSymbols.length > 0 && (
        <ul ref={suggestionsRef} className="symbol-suggestions">
          {filteredSymbols.map((symbol, index) => (
            <li
              key={symbol}
              className={`symbol-suggestion ${index === selectedIndex ? 'selected' : ''} ${symbol === value ? 'current' : ''}`}
              onClick={() => handleSelectSymbol(symbol)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <span className="symbol-name">{symbol}</span>
              {symbol === value && <span className="current-badge">actual</span>}
            </li>
          ))}
        </ul>
      )}

      <style>{`
        .symbol-selector {
          position: relative;
          display: inline-block;
          min-width: 180px;
        }

        .symbol-input-wrapper {
          display: flex;
          align-items: stretch;
        }

        .symbol-input {
          flex: 1;
          padding: 8px 12px;
          font-size: 16px;
          font-weight: bold;
          border: 2px solid #DDE2E7;
          border-right: none;
          border-radius: 6px 0 0 6px;
          background: white;
          color: #4A90E2;
          outline: none;
          text-transform: uppercase;
          letter-spacing: 1px;
        }

        .symbol-input:focus {
          border-color: #4A90E2;
        }

        .symbol-input::placeholder {
          color: #999;
          font-weight: normal;
        }

        .symbol-dropdown-btn {
          padding: 8px 12px;
          background: #f5f7fa;
          border: 2px solid #DDE2E7;
          border-left: none;
          border-radius: 0 6px 6px 0;
          color: #666;
          cursor: pointer;
          transition: all 0.2s;
        }

        .symbol-dropdown-btn:hover {
          background: #e8ecf0;
          color: #4A90E2;
        }

        .symbol-suggestions {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          margin: 4px 0 0 0;
          padding: 0;
          list-style: none;
          background: white;
          border: 2px solid #DDE2E7;
          border-radius: 6px;
          max-height: 300px;
          overflow-y: auto;
          z-index: 1000;
          box-shadow: 0 8px 24px rgba(0,0,0,0.12);
        }

        .symbol-suggestion {
          padding: 10px 14px;
          cursor: pointer;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid #eee;
          transition: background 0.15s;
        }

        .symbol-suggestion:last-child {
          border-bottom: none;
        }

        .symbol-suggestion:hover,
        .symbol-suggestion.selected {
          background: #f5f7fa;
        }

        .symbol-suggestion.current {
          background: rgba(74, 144, 226, 0.1);
        }

        .symbol-name {
          font-weight: bold;
          color: #333;
          letter-spacing: 0.5px;
        }

        .current-badge {
          font-size: 10px;
          padding: 2px 6px;
          background: #4A90E2;
          color: white;
          border-radius: 4px;
          font-weight: bold;
          text-transform: uppercase;
        }

        /* Scrollbar */
        .symbol-suggestions::-webkit-scrollbar {
          width: 6px;
        }

        .symbol-suggestions::-webkit-scrollbar-track {
          background: #f5f5f5;
        }

        .symbol-suggestions::-webkit-scrollbar-thumb {
          background: #ccc;
          border-radius: 3px;
        }

        .symbol-suggestions::-webkit-scrollbar-thumb:hover {
          background: #bbb;
        }
      `}</style>
    </div>
  );
};

export default SymbolSelector;
