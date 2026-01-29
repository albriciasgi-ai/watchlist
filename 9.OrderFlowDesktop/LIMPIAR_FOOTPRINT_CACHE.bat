@echo off
echo ========================================
echo  Limpiando cache de footprints...
echo ========================================
del /q "backend\footprint_cache\*.json" 2>nul
echo.
echo Cache de footprints limpiado.
echo Reinicia el backend para cargar datos frescos del cloud.
echo.
pause
