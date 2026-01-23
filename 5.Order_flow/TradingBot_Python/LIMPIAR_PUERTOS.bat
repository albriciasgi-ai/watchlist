@echo off
echo =======================================
echo   LIMPIANDO PUERTOS
echo =======================================
echo.

echo Buscando procesos en puerto 5000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :5000 ^| findstr LISTENING') do (
    echo Deteniendo proceso %%a en puerto 5000...
    taskkill /PID %%a /F
)

echo.
echo Buscando procesos en puerto 8000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8000 ^| findstr LISTENING') do (
    echo Deteniendo proceso %%a en puerto 8000...
    taskkill /PID %%a /F
)

echo.
echo Buscando procesos en puerto 3000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do (
    echo Deteniendo proceso %%a en puerto 3000...
    taskkill /PID %%a /F
)

echo.
echo =======================================
echo   PUERTOS LIMPIADOS
echo =======================================
echo.
echo Ahora puedes ejecutar START_HERE.bat
echo.
pause
