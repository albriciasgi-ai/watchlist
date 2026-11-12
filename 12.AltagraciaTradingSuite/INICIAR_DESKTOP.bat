@echo off
REM Altagracia Trading Suite en Electron: sin freno en segundo plano y con bandeja del sistema.
REM La app arma la pagina si falta, usa el servidor si ya corre o lo lanza sin ventana (y lo cierra al salir).
REM Para los footprints recientes debe estar corriendo el backend de Order Flow (11000); para el modulo del bot, el bot (5000).
cd /d "%~dp0desktop"

if not exist "node_modules\electron" (
  echo Instalando Electron por primera vez...
  call npm install --no-audit --no-fund || goto :error
)

start "" "node_modules\electron\dist\electron.exe" .
exit /b 0

:error
echo No se pudo instalar Electron. Revisa que Node.js este instalado.
pause
exit /b 1
