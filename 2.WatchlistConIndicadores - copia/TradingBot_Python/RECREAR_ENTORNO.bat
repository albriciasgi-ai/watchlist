@echo off
echo =======================================
echo   RECREANDO ENTORNO VIRTUAL
echo =======================================
echo.

cd backend

echo [1/4] Eliminando entorno virtual anterior...
if exist venv (
    rmdir /s /q venv
    echo Entorno eliminado.
) else (
    echo No habia entorno previo.
)

echo.
echo [2/4] Creando nuevo entorno virtual...
python -m venv venv

echo.
echo [3/4] Activando entorno...
call venv\Scripts\activate

echo.
echo [4/4] Instalando dependencias...
python -m pip install --upgrade pip
pip install fastapi==0.115.0
pip install uvicorn==0.32.0
pip install httpx==0.27.2
pip install pydantic==2.9.2
pip install websockets==13.1
pip install python-multipart==0.0.12

echo.
echo =======================================
echo   ENTORNO RECREADO!
echo =======================================
echo.
echo Verificando instalacion...
python -c "import fastapi; print('FastAPI OK')"
python -c "import uvicorn; print('Uvicorn OK')"

echo.
echo Presiona cualquier tecla para cerrar...
pause
