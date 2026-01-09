@echo off
REM start_backend.bat - Ejecutar desde la carpeta backend con cmd.exe

REM 1) Buscar python
where python >nul 2>nul
IF ERRORLEVEL 1 (
  echo [ERROR] No se encontro python en PATH. Instala Python 3.10+ y vuelve a intentarlo.
  pause
  exit /b 1
)

REM 2) Crear venv si no existe
IF NOT EXIST ".venv\Scripts\python.exe" (
  echo [INFO] Creando virtualenv .venv...
  python -m venv .venv
  IF ERRORLEVEL 1 (
    echo [ERROR] Error creando virtualenv.
    pause
    exit /b 1
  )
) ELSE (
  echo [INFO] Virtualenv .venv ya existe.
)

REM 3) Instalar dependencias si existe requirements.txt
IF EXIST "requirements.txt" (
  echo [INFO] Instalando dependencias...
  .venv\Scripts\python.exe -m pip install -U pip setuptools wheel >nul
  .venv\Scripts\pip.exe install -r requirements.txt
  IF ERRORLEVEL 1 (
    echo [WARNING] Hubo un error al instalar dependencias. Revisa la salida.
  ) ELSE (
    echo [INFO] Dependencias instaladas.
  )
) ELSE (
  echo [INFO] requirements.txt no encontrado. Saltando instalacion.
)

REM 4) Activar venv y ejecutar uvicorn
echo [INFO] Iniciando servidor uvicorn (main:app) en puerto 8000...
REM Llamamos directamente al python del venv para lanzar uvicorn
.venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000

pause
