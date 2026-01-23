@echo off
REM ============================================
REM  INICIO EN MODO PRODUCCION
REM  Watchlist + Trading Bot + Analizador Cripto
REM ============================================
REM
REM  Uso de recursos REDUCIDO vs modo desarrollo:
REM  - RAM: ~400MB vs ~2GB
REM  - CPU: Minimo vs Alto constante
REM
REM  Puertos:
REM  - Watchlist:    Backend 8000  | Frontend 5173
REM  - Trading Bot:  Backend 5000  | Frontend 3000
REM  - Analizador:   Backend 10000 | Frontend 5174
REM ============================================

echo.
echo ========================================
echo   MODO PRODUCCION - Bajo consumo CPU/RAM
echo ========================================
echo.

REM Ruta base
set BASE_PATH=C:\Users\inven\OneDrive\Documentos\GitHub\watchlist

REM ============================================
REM  1. TRADING BOT (Puerto 5000 / 3000)
REM ============================================
echo [1/6] Iniciando Trading Bot Backend (puerto 5000)...
start "TradingBot-Backend" cmd /k "cd /d %BASE_PATH%\3.TradingBot_Python\backend && venv\Scripts\activate && python main.py"
timeout /t 3 /nobreak > nul

echo [2/6] Iniciando Trading Bot Frontend (puerto 3000)...
start "TradingBot-Frontend" cmd /k "cd /d %BASE_PATH%\3.TradingBot_Python\frontend && npx serve dist -l 3000"
timeout /t 2 /nobreak > nul

REM ============================================
REM  2. WATCHLIST (Puerto 8000 / 5173)
REM ============================================
echo [3/6] Iniciando Watchlist Backend (puerto 8000)...
start "Watchlist-Backend" cmd /k "cd /d %BASE_PATH%\2.WatchlistConIndicadores\backend && .venv\Scripts\activate && python -m uvicorn main:app --host 0.0.0.0 --port 8000"
timeout /t 3 /nobreak > nul

echo [4/6] Iniciando Watchlist Frontend (puerto 5173)...
start "Watchlist-Frontend" cmd /k "cd /d %BASE_PATH%\2.WatchlistConIndicadores\frontend && npx serve dist -l 5173"
timeout /t 2 /nobreak > nul

REM ============================================
REM  3. ANALIZADOR CRIPTO (Puerto 10000 / 5174)
REM ============================================
echo [5/6] Iniciando Analizador Backend (puerto 10000)...
start "Analizador-Backend" cmd /k "cd /d %BASE_PATH%\4.Analizador cripto\backend && .venv\Scripts\activate && python -m uvicorn main:app --host 0.0.0.0 --port 10000"
timeout /t 3 /nobreak > nul

echo [6/6] Iniciando Analizador Frontend (puerto 5174)...
start "Analizador-Frontend" cmd /k "cd /d %BASE_PATH%\4.Analizador cripto\frontend && npx serve dist -l 5174"
timeout /t 2 /nobreak > nul

REM ============================================
REM  RESUMEN
REM ============================================
echo.
echo ========================================
echo   TODAS LAS APPS INICIADAS
echo ========================================
echo.
echo   Trading Bot:  http://localhost:3000
echo   Watchlist:    http://localhost:5173
echo   Analizador:   http://localhost:5174
echo.
echo   Para detener: Cierra las ventanas CMD
echo ========================================
echo.
pause
