# Analizador Desktop

Aplicacion de escritorio para analisis de criptomonedas basada en Electron.

## Caracteristicas

- **Sin throttling**: Los graficos no presentan gaps al minimizar o inactividad
- **PowerSaveBlocker**: Previene suspension del sistema
- **System Tray**: Ejecucion en segundo plano
- **Visualmente identico**: Misma interfaz que el Analizador web

## Puertos

| Servicio | Puerto |
|----------|--------|
| Backend (FastAPI) | 10000 |
| Frontend (Vite dev) | 5174 |

## Inicio Rapido

### Opcion 1: Inicio completo
```batch
1_START.bat
```
Inicia backend + Electron automaticamente.

### Opcion 2: Inicio manual
```batch
# Terminal 1 - Backend
start_backend.bat

# Terminal 2 - Electron
start_electron_dev.bat
```

## Comandos NPM

```bash
# Desarrollo
npm run dev              # Solo Vite (navegador)
npm run dev:electron     # Vite + Electron

# Build
npm run build            # Build de React
npm run build:electron   # Build + instalador NSIS
npm run build:portable   # Build + EXE portable
```

## Estructura

```
8.AnalizadorDesktop/
├── electron/
│   ├── main.js          # Proceso principal (anti-throttling)
│   └── preload.js       # Bridge seguro
├── src/
│   ├── components/      # Componentes React
│   ├── hooks/           # Custom hooks
│   ├── utils/           # Utilidades
│   ├── config.js        # URL del backend
│   ├── main.jsx         # Entry point React
│   └── styles.css       # Estilos globales
├── assets/
│   └── icon.ico         # Icono de la app
├── package.json
├── vite.config.js
└── index.html
```

## Backend

Esta aplicacion usa el backend de `4.Analizador cripto/backend/` (puerto 10000).
El backend no requiere modificaciones.

## Requisitos

- Node.js 18+
- Python 3.10+ (para el backend)
- Windows 10/11

## Instalacion

```bash
cd 8.AnalizadorDesktop
npm install
```

## Build para Produccion

```bash
npm run build:electron
```

Genera instalador en `dist-electron/`:
- `Analizador Desktop Setup.exe` - Instalador NSIS
- `AnalizadorDesktop-Portable.exe` - Version portable
