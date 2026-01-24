@echo off
title Order Flow - Backend (Puerto 11000)
cd /d "%~dp0backend"

echo ========================================
echo    ORDER FLOW - BACKEND
echo    Puerto: 11000
echo ========================================
echo.

if not exist ".venv" (
    echo Creando entorno virtual...
    python -m venv .venv
)

echo Activando entorno virtual...
call .venv\Scripts\activate.bat

echo Verificando dependencias...
pip install -r requirements.txt -q

echo.
echo Iniciando servidor en puerto 11000...
echo.
python -m uvicorn main:app --reload --port 11000 --host 0.0.0.0

pause
