@echo off
title Analizador Cripto - Launcher
echo ========================================
echo    ANALIZADOR CRIPTO
echo    Single Symbol Analysis Tool
echo ========================================
echo.
echo Iniciando servicios...
echo.

echo [1/2] Iniciando Backend (Puerto 10000)...
start "Backend - 10000" cmd /k "call start_backend.bat"

timeout /t 3 /nobreak > nul

echo [2/2] Iniciando Frontend (Puerto 10001)...
start "Frontend - 10001" cmd /k "call start_frontend.bat"

echo.
echo ========================================
echo    SERVICIOS INICIADOS
echo ========================================
echo.
echo Backend:  http://localhost:10000
echo Frontend: http://localhost:10001
echo.
echo Presiona cualquier tecla para cerrar esta ventana...
pause > nul
