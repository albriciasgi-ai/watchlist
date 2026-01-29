@echo off
echo ====================================
echo Analizador Desktop - Solo Electron (Dev)
echo ====================================
echo.
echo NOTA: El backend debe estar corriendo en puerto 10000
echo.

cd /d "%~dp0"
call npm run dev:electron

pause
