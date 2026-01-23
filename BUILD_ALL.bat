@echo off
REM ============================================
REM  BUILD DE TODOS LOS FRONTENDS
REM  Ejecutar despues de hacer cambios al codigo
REM ============================================

echo.
echo ========================================
echo   BUILDING ALL FRONTENDS
echo ========================================
echo.

set BASE_PATH=C:\Users\inven\OneDrive\Documentos\GitHub\watchlist

REM ============================================
REM  1. TRADING BOT
REM ============================================
echo [1/3] Building Trading Bot Frontend...
cd /d %BASE_PATH%\3.TradingBot_Python\frontend
call npm run build
if %errorlevel% neq 0 (
    echo ERROR: Trading Bot build failed!
    pause
    exit /b 1
)
echo       Trading Bot OK
echo.

REM ============================================
REM  2. WATCHLIST
REM ============================================
echo [2/3] Building Watchlist Frontend...
cd /d %BASE_PATH%\2.WatchlistConIndicadores\frontend
call npm run build
if %errorlevel% neq 0 (
    echo ERROR: Watchlist build failed!
    pause
    exit /b 1
)
echo       Watchlist OK
echo.

REM ============================================
REM  3. ANALIZADOR CRIPTO
REM ============================================
echo [3/3] Building Analizador Frontend...
cd /d "%BASE_PATH%\4.Analizador cripto\frontend"
call npm run build
if %errorlevel% neq 0 (
    echo ERROR: Analizador build failed!
    pause
    exit /b 1
)
echo       Analizador OK
echo.

REM ============================================
REM  RESUMEN
REM ============================================
echo ========================================
echo   TODOS LOS BUILDS COMPLETADOS
echo ========================================
echo.
echo   Ahora puedes ejecutar START_PRODUCTION.bat
echo.
pause
