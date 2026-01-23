@echo off
REM ============================================
REM  SETUP INICIAL PARA MODO PRODUCCION
REM  Solo necesitas ejecutar esto UNA VEZ
REM ============================================

echo.
echo ========================================
echo   SETUP INICIAL - Modo Produccion
echo ========================================
echo.

REM Instalar serve globalmente
echo [1/2] Instalando servidor estatico (serve)...
call npm install -g serve
if %errorlevel% neq 0 (
    echo ERROR: No se pudo instalar serve
    echo Intenta ejecutar como Administrador
    pause
    exit /b 1
)
echo       serve instalado OK
echo.

REM Hacer builds
echo [2/2] Ejecutando builds...
call "%~dp0BUILD_ALL.bat"

echo.
echo ========================================
echo   SETUP COMPLETADO
echo ========================================
echo.
echo   Ahora puedes usar:
echo   - BUILD_ALL.bat      (despues de cambios al codigo)
echo   - START_PRODUCTION.bat (para iniciar las apps)
echo.
pause
