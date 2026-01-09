@echo off
color 0A
title Trading Bot - Quick Start

cls
echo.
echo ===============================================
echo          TRADING BOT - QUICK START
echo ===============================================
echo.
echo  This script will start BOTH backend and frontend
echo  in separate windows.
echo.
echo  What will happen:
echo  1. Backend will start on port 5000
echo  2. Frontend will start on port 3000
echo  3. Two command windows will open
echo.
echo ===============================================
echo.
pause

echo.
echo [1/2] Starting Backend Server...
start "Trading Bot Backend" cmd /k start_backend.bat

timeout /t 3 /nobreak >nul

echo [2/2] Starting Frontend Server...
start "Trading Bot Frontend" cmd /k start_frontend.bat

echo.
echo ===============================================
echo   Trading Bot Started Successfully!
echo ===============================================
echo.
echo   Backend: http://localhost:5000
echo   Frontend: http://localhost:3000
echo   API Docs: http://localhost:5000/docs
echo.
echo ===============================================
echo.
echo You can close this window.
echo The backend and frontend will continue running.
echo.
pause
