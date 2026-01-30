@echo off
REM ============================================================
REM START_FRONTEND.bat - Inicia solo el frontend del TradingBot
REM Puerto: 3000
REM ============================================================

echo ============================================================
echo   TRADING BOT - FRONTEND
echo   Puerto: 3000
echo ============================================================
echo.

REM Verificar node_modules
if not exist "%~dp0node_modules" (
    echo [SETUP] Instalando dependencias npm...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] No se pudieron instalar las dependencias
        echo         Verifica que Node.js este instalado
        pause
        exit /b 1
    )
)

REM Verificar que el backend este corriendo
echo [CHECK] Verificando conexion con backend (puerto 5000)...
curl -s http://localhost:5000/api/status >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [WARNING] El backend NO esta corriendo!
    echo           Inicia primero el backend con:
    echo           cd backend ^&^& START_BACKEND.bat
    echo.
    echo           O usa START_ALL.bat desde la raiz del proyecto
    echo.
    choice /M "Continuar de todos modos"
    if %errorlevel% neq 1 (
        exit /b 0
    )
) else (
    echo [OK] Backend conectado
)

echo.
echo Iniciando Vite dev server en puerto 3000...
echo.
echo URL: http://localhost:3000
echo.
echo Presiona Ctrl+C para detener
echo ============================================================
echo.

call npm run dev

echo.
echo Frontend detenido
pause
