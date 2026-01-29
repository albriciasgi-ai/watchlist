@echo off
chcp 65001 >nul
title Order Flow Desktop - Iniciando...

echo ============================================
echo    ORDER FLOW DESKTOP - INICIO COMPLETO
echo ============================================
echo.

:: Configuracion
set BACKEND_DIR=..\5.Order_flow\backend
set BACKEND_PORT=11000
set MAX_WAIT_SECONDS=120
set CHECK_INTERVAL=2

:: Verificar que existe el directorio del backend
if not exist "%BACKEND_DIR%" (
    echo [ERROR] No se encuentra el directorio del backend: %BACKEND_DIR%
    echo Verifica que la estructura de carpetas es correcta.
    pause
    exit /b 1
)

:: Verificar si el backend ya esta corriendo
echo [1/3] Verificando si el backend ya esta corriendo...
curl -s http://localhost:%BACKEND_PORT%/api/status >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [OK] Backend ya esta corriendo en puerto %BACKEND_PORT%
    goto :start_electron
)

:: Iniciar el backend en una nueva ventana
echo [2/3] Iniciando backend en puerto %BACKEND_PORT%...
start "Order Flow Backend" cmd /c "cd /d %BACKEND_DIR% && call .venv\Scripts\activate.bat && uvicorn main:app --host 0.0.0.0 --port %BACKEND_PORT%"

:: Esperar a que el backend este listo
echo.
echo Esperando a que el backend inicie (maximo %MAX_WAIT_SECONDS% segundos)...
echo Esto puede tardar 1-2 minutos mientras carga los footprints del disco.
echo.

set /a WAITED=0
set /a DOTS=0

:wait_loop
:: Incrementar contador de puntos para animacion
set /a DOTS+=1
if %DOTS% GTR 3 set DOTS=0

:: Mostrar progreso
if %DOTS% EQU 0 (set "ANIM=   ")
if %DOTS% EQU 1 (set "ANIM=.  ")
if %DOTS% EQU 2 (set "ANIM=.. ")
if %DOTS% EQU 3 (set "ANIM=...")

<nul set /p "=[%WAITED%s] Esperando backend%ANIM%   "
echo.

:: Verificar si el backend responde
curl -s http://localhost:%BACKEND_PORT%/api/status >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo.
    echo [OK] Backend listo! Respondiendo en puerto %BACKEND_PORT%
    goto :start_electron
)

:: Esperar intervalo
timeout /t %CHECK_INTERVAL% /nobreak >nul

:: Incrementar tiempo esperado
set /a WAITED+=%CHECK_INTERVAL%

:: Verificar timeout
if %WAITED% GEQ %MAX_WAIT_SECONDS% (
    echo.
    echo [ERROR] Timeout! El backend no respondio en %MAX_WAIT_SECONDS% segundos.
    echo Revisa la ventana del backend para ver errores.
    pause
    exit /b 1
)

goto :wait_loop

:start_electron
echo.
echo [3/3] Iniciando Electron...
echo.

:: Iniciar Electron en modo desarrollo
start "Order Flow Desktop" cmd /c "npm run dev:electron"

echo ============================================
echo    INICIO COMPLETADO
echo ============================================
echo.
echo - Backend: http://localhost:%BACKEND_PORT%
echo - Frontend: Electron (puerto 11001 en dev)
echo.
echo Puedes cerrar esta ventana.
echo.

timeout /t 5
exit /b 0
