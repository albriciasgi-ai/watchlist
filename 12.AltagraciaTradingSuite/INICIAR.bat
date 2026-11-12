@echo off
REM Altagracia Trading Suite en el navegador: arma la pagina, levanta el servidor (127.0.0.1:13000) y la abre.
REM Para uso diario conviene INICIAR_DESKTOP.bat (Electron): el navegador frena las pestanas en segundo plano.
REM El servidor graba solo los trades de sus monedas; para el modulo del bot debe correr el bot (5000).
cd /d "%~dp0"

pushd web
if not exist "node_modules" (
  echo Instalando la pagina por primera vez...
  call npm install --no-audit --no-fund || goto :error
)
REM Siempre se vuelve a armar (unos segundos): asi nunca queda una pagina vieja
call npm run build || goto :error
popd

start "Altagracia Trading Suite - servidor" C:\Python314\python.exe -B server\main.py
timeout /t 3 /nobreak >nul
start "" http://127.0.0.1:13000
exit /b 0

:error
popd
echo No se pudo armar la pagina. Revisa que Node.js este instalado.
pause
exit /b 1
