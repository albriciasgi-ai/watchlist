@echo off
chcp 65001 >nul 2>&1
title Strategy Builder (Order Flow) - Test Runner

echo ======================================================================
echo   STRATEGY BUILDER (ORDER FLOW) - TEST RUNNER
echo ======================================================================
echo.

:: ====================================================================
:: CONFIGURACION - Editar estas variables segun tu entorno
:: ====================================================================

set PYTHON_EXE=python
set BACKEND_URL=http://localhost:11000
set SYMBOL=BTCUSDT
set INTERVAL=60
set DAYS=90

:: Filtros opcionales (dejar vacio para ejecutar todos)
:: Ejemplos:
::   set TEST_FILTER=--tests A1,A2,G1,H1
::   set TEST_FILTER=--group G
::   set TEST_FILTER=--group H
::   set TEST_FILTER=--group I
::   set TEST_FILTER=--group J
::   set TEST_FILTER=
set TEST_FILTER=

:: ====================================================================
:: Verificar Python
:: ====================================================================

%PYTHON_EXE% --version >nul 2>&1
if errorlevel 1 (
    echo   ERROR: Python no encontrado como "%PYTHON_EXE%"
    echo   Intentando con py...
    set PYTHON_EXE=py
    py --version >nul 2>&1
    if errorlevel 1 (
        echo   ERROR: No se encontro Python. Instalar desde python.org
        pause
        exit /b 1
    )
)

echo   Python:
%PYTHON_EXE% --version
echo.

:: ====================================================================
:: Verificar backend de Order Flow
:: ====================================================================

echo   Verificando backend en %BACKEND_URL%...
%PYTHON_EXE% -c "import urllib.request; urllib.request.urlopen('%BACKEND_URL%/api/status', timeout=5); print('  Backend OK')" 2>nul
if errorlevel 1 (
    echo.
    echo   ERROR: Backend no responde en %BACKEND_URL%
    echo.
    echo   Inicia el backend de Order Flow primero:
    echo     cd "5.Order_flow\backend"
    echo     .venv\Scripts\python.exe -m uvicorn main:app --port 11000
    echo.
    pause
    exit /b 1
)

echo.

:: ====================================================================
:: Ejecutar tests
:: ====================================================================

echo   Iniciando tests...
echo   Simbolo:   %SYMBOL%
echo   Intervalo: %INTERVAL%
echo   Dias:      %DAYS%
echo   Filtro:    %TEST_FILTER%
echo.
echo   Grupos: A (Levels), B (Entry), C (Filters), D (Risk), E (Exit),
echo           F (Determinismo), G (OF Levels), H (OF Entry), I (OF Filters),
echo           J (Param Validation)
echo.

%PYTHON_EXE% "%~dp0run_strategy_tests.py" --url %BACKEND_URL% --symbol %SYMBOL% --interval %INTERVAL% --days %DAYS% %TEST_FILTER%

echo.
if errorlevel 1 (
    echo   === HAY TESTS FALLIDOS ===
) else (
    echo   === TODOS LOS TESTS PASARON ===
)

echo.
pause
