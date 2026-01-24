@echo off
title Order Flow - Launcher
echo ========================================
echo    ORDER FLOW ANALYZER
echo    Footprint Chart Visualization
echo ========================================
echo.
echo Iniciando servicios...
echo.

echo [1/2] Iniciando Backend (Puerto 11000)...
start "Backend - 11000" cmd /k "call start_backend.bat"

timeout /t 3 /nobreak > nul

echo [2/2] Iniciando Frontend (Puerto 11001)...
start "Frontend - 11001" cmd /k "call start_frontend.bat"

echo.
echo ========================================
echo    SERVICIOS INICIADOS
echo ========================================
echo.
echo Backend:  http://localhost:11000
echo Frontend: http://localhost:11001
echo.
echo Presiona cualquier tecla para cerrar esta ventana...
pause > nul
