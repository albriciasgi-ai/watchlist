@echo off
echo ====================================
echo Watchlist Desktop - Build Windows
echo ====================================
echo.

cd /d "%~dp0"

echo [1/2] Compilando aplicacion React...
call npm run build

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: Fallo la compilacion de React
    pause
    exit /b 1
)

echo.
echo [2/2] Empaquetando con Electron Builder...
call npm run build:electron

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: Fallo el empaquetado con Electron
    pause
    exit /b 1
)

echo.
echo ====================================
echo Build completado!
echo ====================================
echo.
echo El ejecutable esta en: dist-electron\
echo.
pause
