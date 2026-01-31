@echo off
echo ============================================================
echo LIMPIANDO CACHE DE PYTHON Y BACKTESTING
echo ============================================================

cd /d "%~dp0"

echo.
echo [1/3] Borrando __pycache__...
if exist __pycache__ (
    rmdir /s /q __pycache__
    echo       OK - __pycache__ eliminado
) else (
    echo       No existe __pycache__
)

echo.
echo [2/3] Borrando archivos .pyc sueltos...
del /s /q *.pyc 2>nul
echo       OK - Archivos .pyc eliminados

echo.
echo [3/3] Borrando cache de backtesting...
if exist backtesting_cache (
    del /q backtesting_cache\*.json 2>nul
    echo       OK - Cache de backtesting eliminado
) else (
    echo       No existe carpeta backtesting_cache
)

echo.
echo ============================================================
echo CACHE LIMPIADO EXITOSAMENTE
echo ============================================================
echo.
echo Ahora reinicia el servidor con:
echo   .venv\Scripts\activate
echo   uvicorn main:app --reload --port 9000
echo.
pause
