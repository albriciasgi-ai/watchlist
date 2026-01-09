@echo off
echo =======================================
echo   Trading Bot Frontend - Startup
echo =======================================
echo.

cd frontend

REM Check if node_modules exists
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    echo.
)

echo =======================================
echo   Starting Frontend Server...
echo =======================================
echo   Frontend URL: http://localhost:3000
echo =======================================
echo.

call npm run dev

pause
