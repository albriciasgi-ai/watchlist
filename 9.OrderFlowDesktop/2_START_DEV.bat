@echo off
echo ====================================
echo Order Flow Desktop - Modo Desarrollo
echo ====================================
echo.
echo IMPORTANTE: Asegurate de que el backend este corriendo en puerto 11000
echo   cd 5.Order_flow/backend
echo   uvicorn main:app --reload --port 11000
echo.
echo ====================================
echo.

cd /d "%~dp0"

echo Iniciando Electron + Vite...
call npm run dev:electron

pause
