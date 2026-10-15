@echo off
echo ================================================================================
echo                    xSTOCKS API VALIDATION - QUICK START
echo ================================================================================
echo.

REM Verificar si Python está instalado
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python no esta instalado o no esta en PATH
    echo.
    echo Instala Python 3.8+ desde https://www.python.org/
    pause
    exit /b 1
)

echo [OK] Python detectado
echo.

REM Verificar si httpx está instalado
python -c "import httpx" >nul 2>&1
if errorlevel 1 (
    echo [INFO] httpx no detectado, instalando...
    pip install httpx
    if errorlevel 1 (
        echo [ERROR] No se pudo instalar httpx
        pause
        exit /b 1
    )
    echo [OK] httpx instalado
) else (
    echo [OK] httpx ya esta instalado
)
echo.

echo ================================================================================
echo                         EJECUTANDO VALIDACION
echo ================================================================================
echo.
echo Probando 8 xStocks en Bybit API...
echo Esto tomara ~30-60 segundos
echo.

REM Ejecutar el script
python test_xstocks_api.py

if errorlevel 1 (
    echo.
    echo [ERROR] El script termino con errores
    echo Revisa el output arriba para mas detalles
) else (
    echo.
    echo [SUCCESS] Validacion completada
    echo.
    echo Resultados guardados en: xstocks_validation_results.json
)

echo.
echo ================================================================================
pause
