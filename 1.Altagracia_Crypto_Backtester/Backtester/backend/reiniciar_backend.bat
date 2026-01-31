@echo off
echo ============================================================
echo REINICIANDO BACKEND COMPLETAMENTE
echo ============================================================

cd /d "%~dp0"

echo.
echo [1/4] Matando procesos de uvicorn/python en puerto 9000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :9000 ^| findstr LISTENING') do (
    echo       Matando PID: %%a
    taskkill /F /PID %%a 2>nul
)

echo.
echo [2/4] Limpiando cache de Python...
if exist __pycache__ rmdir /s /q __pycache__
del /s /q *.pyc 2>nul
echo       OK - Cache limpiado

echo.
echo [3/4] Limpiando cache de backtesting...
if exist backtesting_cache del /q backtesting_cache\*.json 2>nul
echo       OK - Cache de backtesting limpiado

echo.
echo [4/4] Iniciando servidor...
echo ============================================================
echo.

call .venv\Scripts\activate.bat
python -m uvicorn main:app --reload --port 9000
