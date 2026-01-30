@echo off
REM ============================================================
REM START_ALL.bat - Inicio coordinado de Backend + Electron
REM WatchlistDesktop (App 7)
REM ============================================================

echo ============================================================
echo   WATCHLIST DESKTOP - INICIO AUTOMATICO
echo ============================================================
echo.

REM Verificar si el backend ya esta corriendo
echo [1/3] Verificando si el backend esta corriendo en puerto 8000...
curl -s http://localhost:8000/api/status >nul 2>&1
if %errorlevel% equ 0 (
    echo      Backend YA esta corriendo - OK
    goto :start_electron
)

echo      Backend NO esta corriendo - Iniciando...
echo.

REM Iniciar backend en ventana separada
echo [2/3] Iniciando backend de Watchlist...
start "Watchlist Backend" cmd /k "cd /d %~dp0..\2.WatchlistConIndicadores\backend && .venv\Scripts\activate && python -m uvicorn main:app --reload --port 8000"

echo      Esperando a que el backend responda...
echo      (Maximo 2 minutos)
echo.

REM Esperar hasta que el backend responda (max 120 segundos)
set /a counter=0
set /a max_wait=120

:wait_loop
curl -s http://localhost:8000/api/status >nul 2>&1
if %errorlevel% equ 0 (
    echo.
    echo      Backend listo despues de %counter% segundos
    goto :start_electron
)

set /a counter+=5
if %counter% geq %max_wait% (
    echo.
    echo [ERROR] Backend no respondio despues de %max_wait% segundos
    echo         Verifica que el entorno virtual existe en:
    echo         2.WatchlistConIndicadores\backend\.venv
    echo.
    pause
    exit /b 1
)

REM Mostrar progreso
set /a dots=%counter%/5
echo      Esperando... %counter%s / %max_wait%s
timeout /t 5 /nobreak >nul
goto :wait_loop

:start_electron
echo.
echo [3/3] Iniciando Electron + Vite...
echo.

REM Cambiar al directorio de la aplicacion e iniciar
cd /d %~dp0
call npm run dev:electron

echo.
echo ============================================================
echo   Aplicacion cerrada
echo ============================================================
pause
