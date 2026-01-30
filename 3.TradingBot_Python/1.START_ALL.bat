@echo off
REM ============================================================
REM START_ALL.bat - Inicio coordinado de Backend + Frontend
REM TradingBot (App 3) - Puerto 5000 (backend) + 3000 (frontend)
REM ============================================================

echo ============================================================
echo   TRADING BOT - INICIO AUTOMATICO
echo ============================================================
echo.

REM Verificar si el backend ya esta corriendo
echo [1/4] Verificando si el backend esta corriendo en puerto 5000...
curl -s http://localhost:5000/api/status >nul 2>&1
if %errorlevel% equ 0 (
    echo      Backend YA esta corriendo - OK
    goto :start_frontend
)

echo      Backend NO esta corriendo - Iniciando...
echo.

REM Verificar que existe el entorno virtual
if not exist "%~dp0backend\.venv\Scripts\activate.bat" (
    echo [ERROR] No se encontro el entorno virtual en:
    echo         %~dp0backend\.venv
    echo.
    echo         Ejecuta primero:
    echo         cd backend
    echo         python -m venv .venv
    echo         .venv\Scripts\activate
    echo         pip install -r requirements.txt
    echo.
    pause
    exit /b 1
)

REM Iniciar backend en ventana separada
echo [2/4] Iniciando backend del Trading Bot...
start "TradingBot Backend" cmd /k "cd /d %~dp0backend && .venv\Scripts\activate && python main.py"

echo      Esperando a que el backend responda...
echo      (Maximo 2 minutos)
echo.

REM Esperar hasta que el backend responda (max 120 segundos)
set /a counter=0
set /a max_wait=120

:wait_loop
curl -s http://localhost:5000/api/status >nul 2>&1
if %errorlevel% equ 0 (
    echo.
    echo      Backend listo despues de %counter% segundos
    goto :start_frontend
)

set /a counter+=5
if %counter% geq %max_wait% (
    echo.
    echo [ERROR] Backend no respondio despues de %max_wait% segundos
    echo         Verifica los logs en la ventana del backend
    echo.
    pause
    exit /b 1
)

REM Mostrar progreso
echo      Esperando... %counter%s / %max_wait%s
timeout /t 5 /nobreak >nul
goto :wait_loop

:start_frontend
echo.
echo [3/4] Verificando dependencias del frontend...

REM Verificar que existe node_modules
if not exist "%~dp0frontend\node_modules" (
    echo      Instalando dependencias npm...
    cd /d %~dp0frontend
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Fallo npm install
        pause
        exit /b 1
    )
)

echo [4/4] Iniciando frontend React...
echo.
echo ============================================================
echo   URLs disponibles:
echo   - Frontend: http://localhost:3000
echo   - Backend:  http://localhost:5000
echo   - API Docs: http://localhost:5000/docs
echo ============================================================
echo.

REM Iniciar frontend
cd /d %~dp0frontend
call npm run dev

echo.
echo ============================================================
echo   Aplicacion cerrada
echo ============================================================
pause
