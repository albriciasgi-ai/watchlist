@echo off
echo =======================================
echo   Test Watchlist Alert Integration
echo =======================================
echo.

cd backend
call venv\Scripts\activate
cd ..
python test_watchlist_alert.py

pause
