@echo off
echo ===========================================
echo Starting Alert Listener Service (Port 5000)
echo ===========================================
echo.

REM Check if Python is available
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Python is not installed or not in PATH
    echo Please install Python 3.10+ from python.org
    pause
    exit /b 1
)

echo Starting service...
echo Dashboard will be available at: http://localhost:5000
echo Press Ctrl+C to stop the service
echo.

python alert_listener.py

pause
