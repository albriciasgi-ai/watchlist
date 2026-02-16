@echo off
REM ============================================================
REM START_ALL.bat - Inicio rapido Backend + Electron
REM AnalizadorDesktop (App 8)
REM ============================================================

echo ============================================================
echo   ANALIZADOR DESKTOP - INICIO
echo ============================================================
echo.

REM Iniciar backend en ventana separada (si ya corre, uvicorn dara error de puerto y se cierra solo)
echo [1/2] Iniciando backend en puerto 10000...
start "Analizador Backend" cmd /k "cd /d %~dp0..\4.Analizador cripto\backend && .venv\Scripts\activate && python -m uvicorn main:app --port 10000 --host 127.0.0.1"

REM Esperar 3 segundos para que el backend arranque
echo      Esperando 3 segundos...
timeout /t 3 /nobreak >nul

REM Iniciar Electron + Vite
echo [2/2] Iniciando Electron + Vite...
echo.
cd /d %~dp0
call npm run dev:electron

echo.
echo ============================================================
echo   Aplicacion cerrada
echo ============================================================
pause
