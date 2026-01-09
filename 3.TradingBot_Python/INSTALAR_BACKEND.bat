@echo off
echo =======================================
echo   Instalando Backend - FIX
echo =======================================
echo.

cd backend

echo Activando entorno virtual...
call venv\Scripts\activate

echo.
echo Actualizando pip...
python -m pip install --upgrade pip

echo.
echo Instalando dependencias (SIN cryptography)...
pip install --no-cache-dir fastapi==0.115.0
pip install --no-cache-dir uvicorn[standard]==0.32.0
pip install --no-cache-dir httpx==0.27.2
pip install --no-cache-dir pydantic==2.9.2
pip install --no-cache-dir pydantic-settings==2.5.2
pip install --no-cache-dir python-multipart==0.0.12
pip install --no-cache-dir websockets==13.1

echo.
echo =======================================
echo   Instalacion Completa!
echo =======================================
echo.
echo Ahora puedes cerrar esta ventana y ejecutar:
echo   start_backend.bat
echo.
pause
