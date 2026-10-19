@echo off
echo ========================================
echo LIMPIEZA COMPLETA DE CACHE
echo ========================================

echo.
echo [1/4] Deteniendo procesos...
taskkill /F /IM "Analizador Desktop.exe" 2>nul
taskkill /F /IM electron.exe 2>nul
timeout /t 2 /nobreak >nul

echo.
echo [2/4] Limpiando cache de Vite...
if exist "node_modules\.vite" (
    rmdir /S /Q "node_modules\.vite"
    echo    ✓ node_modules\.vite eliminado
) else (
    echo    - node_modules\.vite no existe
)

echo.
echo [3/4] Limpiando cache de Electron...
set APPDATA_PATH=%APPDATA%\analizador-desktop
if exist "%APPDATA_PATH%\Cache" (
    rmdir /S /Q "%APPDATA_PATH%\Cache"
    echo    ✓ Cache eliminado
) else (
    echo    - Cache no existe
)

if exist "%APPDATA_PATH%\Code Cache" (
    rmdir /S /Q "%APPDATA_PATH%\Code Cache"
    echo    ✓ Code Cache eliminado
) else (
    echo    - Code Cache no existe
)

if exist "%APPDATA_PATH%\GPUCache" (
    rmdir /S /Q "%APPDATA_PATH%\GPUCache"
    echo    ✓ GPUCache eliminado
) else (
    echo    - GPUCache no existe
)

if exist "%APPDATA_PATH%\Local Storage" (
    rmdir /S /Q "%APPDATA_PATH%\Local Storage"
    echo    ✓ Local Storage eliminado
) else (
    echo    - Local Storage no existe
)

if exist "%APPDATA_PATH%\Session Storage" (
    rmdir /S /Q "%APPDATA_PATH%\Session Storage"
    echo    ✓ Session Storage eliminado
) else (
    echo    - Session Storage no existe
)

echo.
echo [4/4] Limpiando logs antiguos...
del /Q frontend*.log 2>nul
del /Q backend*.log 2>nul
echo    ✓ Logs eliminados

echo.
echo ========================================
echo ✅ LIMPIEZA COMPLETA
echo ========================================
echo.
echo Ahora ejecuta: npm run dev:electron
echo.
pause
