@echo off
REM Altagracia Trading Suite: arma la pagina la primera vez, levanta el servidor (127.0.0.1:13000) y la abre.
REM Para los footprints recientes debe estar corriendo el backend de Order Flow (11000); para el modulo del bot, el bot (5000).
cd /d "%~dp0"

if not exist "web\dist\index.html" (
  echo Armando la pagina por primera vez...
  pushd web
  call npm install --no-audit --no-fund || goto :error
  call npm run build || goto :error
  popd
)

start "Altagracia Trading Suite - servidor" C:\Python314\python.exe -B server\main.py
timeout /t 3 /nobreak >nul
start "" http://127.0.0.1:13000
exit /b 0

:error
echo No se pudo armar la pagina. Revisa que Node.js este instalado.
pause
exit /b 1
