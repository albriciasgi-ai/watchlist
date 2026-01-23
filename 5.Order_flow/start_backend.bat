@echo off
title Analizador Cripto - Backend (Puerto 10000)
cd /d "%~dp0backend"

echo ========================================
echo    ANALIZADOR CRIPTO - BACKEND
echo    Puerto: 10000
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
echo Iniciando servidor en puerto 10000...
echo.
python -m uvicorn main:app --reload --port 10000 --host 0.0.0.0

pause
