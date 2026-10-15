@echo off
echo.
echo ========================================
echo   LIMPIANDO CACHE DE VITE Y REINICIANDO
echo ========================================
echo.
echo Este script va a:
echo 1. Limpiar el cache de Vite
echo 2. Limpiar la carpeta dist
echo 3. Reiniciar el servidor de desarrollo
echo.
pause

echo.
echo [1/3] Limpiando cache de Vite...
if exist node_modules\.vite (
    rmdir /s /q node_modules\.vite
    echo     ✓ Cache de Vite eliminado
) else (
    echo     - No hay cache de Vite para eliminar
)

echo.
echo [2/3] Limpiando carpeta dist...
if exist dist (
    rmdir /s /q dist
    echo     ✓ Carpeta dist eliminada
) else (
    echo     - No hay carpeta dist para eliminar
)

echo.
echo [3/3] Iniciando servidor de desarrollo...
echo.
echo ========================================
echo   SERVIDOR INICIADO
echo ========================================
echo.
echo IMPORTANTE: Ahora debes hacer Hard Reload en el navegador:
echo.
echo   1. Abre http://localhost:5173
echo   2. Presiona: Ctrl + Shift + R
echo      (o clic derecho en recargar → "Vaciar cache y recargar de manera forzada")
echo.
echo ========================================
echo.

npm run dev
