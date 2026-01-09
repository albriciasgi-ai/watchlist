@echo off
echo =======================================
echo   INSTALACION MANUAL DE DEPENDENCIAS
echo =======================================
echo.

cd backend

echo [1/8] Activando entorno virtual...
call venv\Scripts\activate

echo.
echo [2/8] Actualizando pip...
python -m pip install --upgrade pip

echo.
echo [3/8] Instalando FastAPI...
pip install --no-cache-dir fastapi==0.115.0

echo.
echo [4/8] Instalando Uvicorn...
pip install --no-cache-dir uvicorn==0.32.0

echo.
echo [5/8] Instalando HTTPX...
pip install --no-cache-dir httpx==0.27.2

echo.
echo [6/8] Instalando Pydantic...
pip install --no-cache-dir pydantic==2.9.2

echo.
echo [7/8] Instalando WebSockets...
pip install --no-cache-dir websockets==13.1

echo.
echo [8/8] Instalando Python Multipart...
pip install --no-cache-dir python-multipart==0.0.12

echo.
echo =======================================
echo   VERIFICANDO INSTALACION
echo =======================================
echo.

python -c "import fastapi; print('FastAPI:', fastapi.__version__)"
python -c "import uvicorn; print('Uvicorn: OK')"
python -c "import httpx; print('HTTPX: OK')"
python -c "import pydantic; print('Pydantic:', pydantic.__version__)"
python -c "import websockets; print('WebSockets: OK')"

echo.
echo =======================================
echo   INSTALACION COMPLETADA!
echo =======================================
echo.
echo Presiona cualquier tecla para cerrar...
pause
