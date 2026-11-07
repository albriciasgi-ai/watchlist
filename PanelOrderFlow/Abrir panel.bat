@echo off
rem Abre el Panel Order Flow (descargas de Bybit y collector de App 9) sin ventana negra.
set "PYW=C:\Python314\pythonw.exe"
if not exist "%PYW%" set "PYW=pythonw.exe"
start "" "%PYW%" "%~dp0panel.pyw" %*
