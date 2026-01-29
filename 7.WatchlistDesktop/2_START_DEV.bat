@echo off
echo ====================================
echo Watchlist Desktop - Modo Desarrollo
echo ====================================
echo.

cd /d "%~dp0"

echo IMPORTANTE: Asegurate de que el backend este corriendo en puerto 8000
echo (Ejecuta start_backend.bat en 2.WatchlistConIndicadores\backend)
echo.
echo Iniciando Vite + Electron en modo desarrollo...
echo.

call npm run dev:electron

pause
