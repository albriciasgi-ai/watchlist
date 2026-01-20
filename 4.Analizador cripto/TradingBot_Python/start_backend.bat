@echo off
echo =======================================
echo   Trading Bot Backend - Startup
echo =======================================
echo.

cd backend

REM Check if venv exists
if not exist "venv" (
    echo Creating virtual environment...
    python -m venv venv
    echo.
)

echo Activating virtual environment...
call venv\Scripts\activate

echo Installing/Updating dependencies...
pip install -r requirements.txt
echo.

echo =======================================
echo   Starting Backend Server...
echo =======================================
echo   Backend URL: http://localhost:5000
echo   API Docs: http://localhost:5000/docs
echo =======================================
echo.

python main.py

pause
