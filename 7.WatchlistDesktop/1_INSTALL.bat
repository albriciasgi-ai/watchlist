@echo off
echo ====================================
echo Watchlist Desktop - Instalacion
echo ====================================
echo.

cd /d "%~dp0"

echo [1/2] Instalando dependencias de Node.js...
call npm install

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: Fallo la instalacion de dependencias
    echo Verifica que tienes Node.js instalado
    pause
    exit /b 1
)

echo.
echo [2/2] Instalacion completada!
echo.
echo Ahora puedes ejecutar:
echo   - 2_START_DEV.bat   (Modo desarrollo)
echo   - 3_BUILD.bat       (Crear ejecutable)
echo.
pause
