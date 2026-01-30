@echo off
REM ============================================================
REM START_BACKEND.bat - Inicia solo el backend del TradingBot
REM Puerto: 5000
REM ============================================================

echo ============================================================
echo   TRADING BOT - BACKEND
echo   Puerto: 5000
echo ============================================================
echo.

REM Verificar entorno virtual
if not exist "%~dp0.venv\Scripts\activate.bat" (
    echo [SETUP] Creando entorno virtual...
    python -m venv .venv
    if %errorlevel% neq 0 (
        echo [ERROR] No se pudo crear el entorno virtual
        echo         Verifica que Python este instalado
        pause
        exit /b 1
    )

    echo [SETUP] Instalando dependencias...
    call .venv\Scripts\activate
    pip install -r requirements.txt
    if %errorlevel% neq 0 (
        echo [ERROR] No se pudieron instalar las dependencias
        pause
        exit /b 1
    )
) else (
    call .venv\Scripts\activate
)

echo [OK] Entorno virtual activado
echo.
echo Iniciando servidor FastAPI en puerto 5000...
echo.
echo URLs:
echo   - API:  http://localhost:5000
echo   - Docs: http://localhost:5000/docs
echo.
echo Presiona Ctrl+C para detener
echo ============================================================
echo.

python main.py

echo.
echo Backend detenido
pause
