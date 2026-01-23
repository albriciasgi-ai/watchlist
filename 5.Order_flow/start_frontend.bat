@echo off
title Analizador Cripto - Frontend (Puerto 10001)
cd /d "%~dp0frontend"

echo ========================================
echo    ANALIZADOR CRIPTO - FRONTEND
echo    Puerto: 10001
echo ========================================
echo.

if not exist "node_modules" (
    echo Instalando dependencias...
    npm install
)

echo.
echo Iniciando servidor de desarrollo...
echo.
echo Abre tu navegador en: http://localhost:10001
echo.
npm run dev

pause
