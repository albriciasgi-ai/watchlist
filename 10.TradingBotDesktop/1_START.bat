@echo off
title Trading Bot Desktop - Inicio
color 0A

echo.
echo ========================================
echo   TRADING BOT DESKTOP - INICIO RAPIDO
echo ========================================
echo.

REM Verificar si el backend esta corriendo
echo [1/3] Verificando backend en puerto 5000...
curl -s -o nul -w "%%{http_code}" http://localhost:5000/api/status | findstr "200" >nul
if %errorlevel% neq 0 (
    echo.
    echo [!] Backend no detectado en puerto 5000
    echo [!] Iniciando backend automaticamente...
    echo.

    REM Iniciar backend en nueva ventana
    start "Trading Bot Backend" cmd /k "cd /d %~dp0\..\3.TradingBot_Python\backend && python main.py"

    echo [*] Esperando que el backend inicie (10 segundos)...
    timeout /t 10 /nobreak >nul
) else (
    echo [OK] Backend detectado y funcionando
)

echo.
echo [2/3] Instalando dependencias si es necesario...
if not exist "node_modules" (
    echo [*] Primera ejecucion - instalando dependencias...
    call npm install
) else (
    echo [OK] Dependencias ya instaladas
)

echo.
echo [3/3] Iniciando aplicacion Electron...
echo.
echo ========================================
echo   La aplicacion se abrira en breve...
echo ========================================
echo.

REM Iniciar en modo desarrollo con Electron
call npm run dev:electron

pause
