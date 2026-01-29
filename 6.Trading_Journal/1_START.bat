@echo off
echo ========================================
echo   TRADING JOURNAL - Iniciando...
echo ========================================
echo.

cd /d "%~dp0"

:: Verificar si existe el entorno virtual
if not exist "backend\.venv" (
    echo [1/4] Creando entorno virtual...
    cd backend
    python -m venv .venv
    cd ..
    echo       Entorno virtual creado.
) else (
    echo [1/4] Entorno virtual ya existe.
)

:: Activar entorno e instalar dependencias backend
echo [2/4] Instalando dependencias backend...
cd backend
call .venv\Scripts\activate.bat

:: Instalar dependencias mostrando progreso
pip install fastapi uvicorn httpx pydantic python-dateutil python-multipart --quiet
if errorlevel 1 (
    echo ERROR: Fallo la instalacion de dependencias basicas
    pause
    exit /b 1
)
echo       Dependencias basicas instaladas.

cd ..

:: Instalar dependencias frontend si es necesario
if not exist "frontend\node_modules" (
    echo [3/4] Instalando dependencias frontend...
    cd frontend
    call npm install
    cd ..
) else (
    echo [3/4] Dependencias frontend ya instaladas.
)

:: Iniciar servicios
echo [4/4] Iniciando servicios...
echo.

:: Iniciar backend
cd backend
start "Trading Journal Backend" cmd /k ".venv\Scripts\activate.bat && python main.py"
cd ..

:: Esperar un poco para que el backend inicie
echo       Esperando que el backend inicie...
timeout /t 3 /nobreak > nul

:: Iniciar frontend
cd frontend
start "Trading Journal Frontend" cmd /k "npm run dev"
cd ..

echo.
echo ========================================
echo   Backend:  http://localhost:12000
echo   Frontend: http://localhost:12001
echo   API Docs: http://localhost:12000/docs
echo ========================================
echo.
echo Presiona cualquier tecla para cerrar esta ventana...
echo (Los servicios seguiran corriendo en sus ventanas)
pause > nul
