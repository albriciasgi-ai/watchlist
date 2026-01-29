@echo off
echo ====================================
echo Analizador Desktop - Solo Backend
echo ====================================
echo.
echo Iniciando backend en puerto 10000...
echo.

cd /d "C:\Users\inven\OneDrive\Documentos\GitHub\watchlist\4.Analizador cripto\backend"
call .venv\Scripts\activate
python -m uvicorn main:app --reload --port 10000

pause
