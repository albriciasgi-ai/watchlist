@echo off
chcp 65001 > nul
cls

echo.
echo ============================================
echo 🚀  Iniciando Frontend Watchlist PoC
echo ============================================
echo.

REM Verificar si node_modules existe
if not exist "node_modules" (
    echo [INFO] Instalando dependencias npm...
    call npm install
    if errorlevel 1 (
        echo [ERROR] Falló la instalación de dependencias
        pause
        exit /b 1
    )
) else (
    echo [INFO] Dependencias npm ya instaladas.
)

echo [INFO] Iniciando servidor de desarrollo (npm run dev)...
echo [INFO] Si todo va bien, abre en tu navegador: http://localhost:5173
echo.

call npm run dev

pause
