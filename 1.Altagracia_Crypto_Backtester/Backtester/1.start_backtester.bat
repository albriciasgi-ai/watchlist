@echo off
chcp 65001 > nul
cls

echo.
echo ============================================
echo    ALTAGRACIA CRYPTO BACKTESTER
echo    Backend: Puerto 9000
echo    Frontend: Puerto 9001
echo ============================================
echo.

REM Obtener la ruta del script
set "SCRIPT_DIR=%~dp0"

REM ============================================
REM INICIAR BACKEND (en nueva ventana)
REM ============================================
echo [1/2] Iniciando Backend en puerto 9000...
start "Backtester Backend" cmd /k "cd /d "%SCRIPT_DIR%backend" && (if not exist ".venv\Scripts\python.exe" (echo [INFO] Creando virtualenv... && python -m venv .venv)) && (if exist "requirements.txt" (.venv\Scripts\pip.exe install -r requirements.txt -q)) && echo [INFO] Backend listo. Iniciando uvicorn... && .venv\Scripts\python.exe -m uvicorn main:app --reload --port 9000"

REM Esperar un momento para que el backend inicie
timeout /t 3 /nobreak > nul

REM ============================================
REM INICIAR FRONTEND (en nueva ventana)
REM ============================================
echo [2/2] Iniciando Frontend en puerto 9001...
start "Backtester Frontend" cmd /k "cd /d "%SCRIPT_DIR%frontend" && (if not exist "node_modules" (echo [INFO] Instalando dependencias npm... && npm install)) && echo [INFO] Frontend listo. Iniciando Vite... && npm run dev"

echo.
echo ============================================
echo    SERVIDORES INICIADOS
echo ============================================
echo.
echo    Backend:  http://localhost:9000
echo    Frontend: http://localhost:9001
echo.
echo    Abre el navegador en http://localhost:9001
echo.
echo    Para detener: cierra las ventanas de cmd
echo ============================================
echo.

REM Abrir el navegador automaticamente despues de 5 segundos
timeout /t 5 /nobreak > nul
start "" "http://localhost:9001"

echo Presiona cualquier tecla para cerrar esta ventana...
pause > nul
