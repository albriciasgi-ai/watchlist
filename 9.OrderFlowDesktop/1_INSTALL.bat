@echo off
echo ====================================
echo Order Flow Desktop - Instalacion
echo ====================================
echo.

cd /d "%~dp0"

echo Instalando dependencias...
call npm install

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: Fallo la instalacion de dependencias
    pause
    exit /b 1
)

echo.
echo ====================================
echo Instalacion completada exitosamente
echo ====================================
echo.
echo Para iniciar la aplicacion, ejecuta:
echo   2_START_DEV.bat  (modo desarrollo)
echo   3_BUILD.bat      (generar .exe)
echo.
pause
