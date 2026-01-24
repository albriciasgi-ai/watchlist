@echo off
title Order Flow - Frontend (Puerto 11001)
cd /d "%~dp0frontend"

echo ========================================
echo    ORDER FLOW - FRONTEND
echo    Puerto: 11001
echo ========================================
echo.

if not exist "node_modules" (
    echo Instalando dependencias...
    npm install
)

echo.
echo Iniciando servidor de desarrollo...
echo.
echo Abre tu navegador en: http://localhost:11001
echo.
npm run dev

pause
