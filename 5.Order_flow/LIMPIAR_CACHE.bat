@echo off
chcp 65001 >nul
echo ========================================
echo    LIMPIEZA DE CACHE - ORDER FLOW
echo ========================================
echo.

REM Limpiar cache del backend
echo [1/3] Limpiando cache del backend...
if exist "backend\cache" (
    del /q "backend\cache\*.*" 2>nul
    echo       - Cache de velas: OK
) else (
    echo       - Cache de velas: No existe
)

if exist "backend\footprint_cache" (
    del /q "backend\footprint_cache\*.*" 2>nul
    echo       - Cache de footprints: OK
) else (
    echo       - Cache de footprints: No existe
)

echo.
echo [2/3] Limpiando archivos temporales...
if exist "backend\*.log" (
    del /q "backend\*.log" 2>nul
    echo       - Logs del backend: OK
)
if exist "backend\logs\*.log" (
    del /q "backend\logs\*.log" 2>nul
    echo       - Logs en carpeta logs: OK
)

echo.
echo [3/3] Abriendo limpiador de IndexedDB en el navegador...
echo       (Esto limpiara el cache de velas del frontend)
echo.

REM Crear archivo HTML temporal para limpiar IndexedDB
echo ^<!DOCTYPE html^> > "%TEMP%\clear_indexeddb.html"
echo ^<html^>^<head^>^<title^>Limpiando Cache...^</title^> >> "%TEMP%\clear_indexeddb.html"
echo ^<style^> >> "%TEMP%\clear_indexeddb.html"
echo body { font-family: Arial, sans-serif; padding: 40px; background: #1a1a2e; color: #eee; } >> "%TEMP%\clear_indexeddb.html"
echo .container { max-width: 500px; margin: 0 auto; text-align: center; } >> "%TEMP%\clear_indexeddb.html"
echo h1 { color: #00d4aa; } >> "%TEMP%\clear_indexeddb.html"
echo .status { padding: 20px; margin: 20px 0; border-radius: 8px; font-size: 18px; } >> "%TEMP%\clear_indexeddb.html"
echo .success { background: #0d4d3a; border: 1px solid #00d4aa; } >> "%TEMP%\clear_indexeddb.html"
echo .error { background: #4d0d0d; border: 1px solid #ff4444; } >> "%TEMP%\clear_indexeddb.html"
echo .info { background: #0d2d4d; border: 1px solid #4488ff; } >> "%TEMP%\clear_indexeddb.html"
echo button { padding: 15px 30px; font-size: 16px; cursor: pointer; background: #00d4aa; border: none; border-radius: 5px; margin-top: 20px; } >> "%TEMP%\clear_indexeddb.html"
echo button:hover { background: #00b894; } >> "%TEMP%\clear_indexeddb.html"
echo ^</style^>^</head^>^<body^> >> "%TEMP%\clear_indexeddb.html"
echo ^<div class="container"^> >> "%TEMP%\clear_indexeddb.html"
echo ^<h1^>Limpieza de Cache Frontend^</h1^> >> "%TEMP%\clear_indexeddb.html"
echo ^<div id="status" class="status info"^>Limpiando IndexedDB...^</div^> >> "%TEMP%\clear_indexeddb.html"
echo ^<div id="details"^>^</div^> >> "%TEMP%\clear_indexeddb.html"
echo ^<button onclick="window.close()"^>Cerrar^</button^> >> "%TEMP%\clear_indexeddb.html"
echo ^</div^> >> "%TEMP%\clear_indexeddb.html"
echo ^<script^> >> "%TEMP%\clear_indexeddb.html"
echo async function clearAllCache() { >> "%TEMP%\clear_indexeddb.html"
echo   const statusDiv = document.getElementById('status'); >> "%TEMP%\clear_indexeddb.html"
echo   const detailsDiv = document.getElementById('details'); >> "%TEMP%\clear_indexeddb.html"
echo   let results = []; >> "%TEMP%\clear_indexeddb.html"
echo   try { >> "%TEMP%\clear_indexeddb.html"
echo     // Limpiar IndexedDB - CandleCache >> "%TEMP%\clear_indexeddb.html"
echo     const dbs = ['CandleCache', 'IndicatorCache', 'DrawingCache']; >> "%TEMP%\clear_indexeddb.html"
echo     for (const dbName of dbs) { >> "%TEMP%\clear_indexeddb.html"
echo       try { >> "%TEMP%\clear_indexeddb.html"
echo         await new Promise((resolve, reject) =^> { >> "%TEMP%\clear_indexeddb.html"
echo           const req = indexedDB.deleteDatabase(dbName); >> "%TEMP%\clear_indexeddb.html"
echo           req.onsuccess = () =^> resolve(); >> "%TEMP%\clear_indexeddb.html"
echo           req.onerror = () =^> reject(req.error); >> "%TEMP%\clear_indexeddb.html"
echo           req.onblocked = () =^> resolve(); >> "%TEMP%\clear_indexeddb.html"
echo         }); >> "%TEMP%\clear_indexeddb.html"
echo         results.push('IndexedDB ' + dbName + ': OK'); >> "%TEMP%\clear_indexeddb.html"
echo       } catch(e) { >> "%TEMP%\clear_indexeddb.html"
echo         results.push('IndexedDB ' + dbName + ': ' + e.message); >> "%TEMP%\clear_indexeddb.html"
echo       } >> "%TEMP%\clear_indexeddb.html"
echo     } >> "%TEMP%\clear_indexeddb.html"
echo     // Limpiar localStorage relacionado >> "%TEMP%\clear_indexeddb.html"
echo     const keysToRemove = []; >> "%TEMP%\clear_indexeddb.html"
echo     for (let i = 0; i ^< localStorage.length; i++) { >> "%TEMP%\clear_indexeddb.html"
echo       const key = localStorage.key(i); >> "%TEMP%\clear_indexeddb.html"
echo       if (key.includes('cache') ^|^| key.includes('Cache') ^|^| key.includes('orderflow')) { >> "%TEMP%\clear_indexeddb.html"
echo         keysToRemove.push(key); >> "%TEMP%\clear_indexeddb.html"
echo       } >> "%TEMP%\clear_indexeddb.html"
echo     } >> "%TEMP%\clear_indexeddb.html"
echo     keysToRemove.forEach(k =^> localStorage.removeItem(k)); >> "%TEMP%\clear_indexeddb.html"
echo     results.push('localStorage: ' + keysToRemove.length + ' keys removed'); >> "%TEMP%\clear_indexeddb.html"
echo     statusDiv.className = 'status success'; >> "%TEMP%\clear_indexeddb.html"
echo     statusDiv.innerHTML = 'Cache limpiado exitosamente!'; >> "%TEMP%\clear_indexeddb.html"
echo   } catch(e) { >> "%TEMP%\clear_indexeddb.html"
echo     statusDiv.className = 'status error'; >> "%TEMP%\clear_indexeddb.html"
echo     statusDiv.innerHTML = 'Error: ' + e.message; >> "%TEMP%\clear_indexeddb.html"
echo   } >> "%TEMP%\clear_indexeddb.html"
echo   detailsDiv.innerHTML = '^<ul^>' + results.map(r =^> '^<li^>' + r + '^</li^>').join('') + '^</ul^>'; >> "%TEMP%\clear_indexeddb.html"
echo } >> "%TEMP%\clear_indexeddb.html"
echo clearAllCache(); >> "%TEMP%\clear_indexeddb.html"
echo ^</script^>^</body^>^</html^> >> "%TEMP%\clear_indexeddb.html"

REM Abrir en el navegador
start "" "%TEMP%\clear_indexeddb.html"

echo.
echo ========================================
echo    LIMPIEZA COMPLETADA
echo ========================================
echo.
echo Cache del backend: LIMPIADO
echo Cache del frontend: Se abrio ventana del navegador
echo.
echo IMPORTANTE: Despues de cerrar la ventana del navegador,
echo recarga la aplicacion (F5) para cargar datos frescos.
echo.
pause
