@echo off
echo ====================================
echo Analizador Desktop - Modo RAPIDO
echo ====================================
echo.
echo Este modo compila el frontend y lo ejecuta
echo directamente desde los archivos estaticos.
echo Es mas rapido que el modo desarrollo.
echo.

REM Verificar si el backend ya esta corriendo
echo Verificando backend en puerto 10000...
curl -s http://localhost:10000/api/status >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Backend ya esta corriendo
) else (
    echo [!] Backend no detectado. Iniciando...
    start "Backend Analizador" cmd /c "cd /d C:\Users\inven\OneDrive\Documentos\GitHub\watchlist\4.Analizador cripto\backend && call .venv\Scripts\activate && python -m uvicorn main:app --port 10000"
    echo Esperando que el backend inicie...
    timeout /t 5 /nobreak >nul
)

echo.
echo Compilando e iniciando Electron...
cd /d "%~dp0"
call npm run start

pause
