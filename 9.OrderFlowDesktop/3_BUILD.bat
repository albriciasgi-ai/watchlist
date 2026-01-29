@echo off
echo ====================================
echo Order Flow Desktop - Build Windows
echo ====================================
echo.

cd /d "%~dp0"

echo Generando build de produccion...
call npm run build:electron

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: Fallo el build
    pause
    exit /b 1
)

echo.
echo ====================================
echo Build completado exitosamente
echo ====================================
echo.
echo Los archivos de instalacion estan en:
echo   dist-electron/
echo.
echo Archivos generados:
echo   - Order Flow Desktop Setup.exe (instalador)
echo   - OrderFlowDesktop-Portable.exe (portable)
echo.
pause
