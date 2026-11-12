# Panel Order Flow

Ventana para bajar los trades diarios de Bybit (los `.tape` de `C:\Users\inven\OrderFlowData`), armar el almacén de App 1 y ver el collector de footprints de App 9.

## Abrir

- Doble clic en "Panel Order Flow" del escritorio, el ícono de tres velas. También sirve doble clic en `Abrir panel.bat` o en `panel.pyw`.
- Si falta el acceso directo: clic derecho en `Abrir panel.bat` → Mostrar más opciones → Enviar a → Escritorio (crear acceso directo).
- Es una sola ventana con dos pestañas: "Descargas de Bybit" y "Collector de App 9".
- Cerrar la ventana no detiene ninguna descarga. Si el panel ya está abierto, avisa y no abre otro.

## Descargar una moneda

1. Elige la moneda en la tabla o escríbela, por ejemplo `SOLUSDT`.
2. Opcional: en "Desde" pon el día más viejo que quieres (AAAA-MM-DD). Vacío baja todo lo que publica Bybit.
3. Pulsa "Descargar ahora". Baja del día más nuevo al más viejo.

Con una moneda completa, "Descargar ahora" solo baja los días nuevos. Bybit publica el día anterior cerca de las 01:10 UTC (20:10 en Colombia).

## Pausar, reanudar y detener

| Botón | Qué hace |
|-------|----------|
| Pausar | Termina el archivo en curso y espera |
| Reanudar | Sigue con el día siguiente, en menos de 20 s |
| Detener | Termina el archivo en curso y se cierra. También detiene la cola |
| Detener ya | Corta en el acto. Solo se pierde el archivo a medias, que se vuelve a bajar la próxima vez |

Ningún día se pierde ni se repite: cada día se verifica contra el original y queda anotado en `manifest` antes de borrar el archivo crudo. Apagar el PC tampoco daña lo descargado.

Pausar, Detener y la velocidad máxima valen para todas las descargas a la vez, porque usan `control.json`. La velocidad rige desde el siguiente archivo.

## Cola

Baja las monedas de `queue.txt` una tras otra. Salta las que terminaron su última descarga, aunque haya sido con "Desde". "Agregar", "Quitar" y ▲▼ cambian la lista. "Detener cola" deja terminar la moneda actual y después no empieza otra. Con la cola activa, "Descargar ahora" se desactiva para no bajar dos monedas a la vez.

## Almacén de App 1

"Armar almacén de App 1" corre `tools\build_store.py` para la moneda elegida y omite los días ya armados. Desde el 10/11/2026 arma también el almacén de flujo (`OrderFlowData\flow`, con `tools\build_flow.py`): delta exacto dentro de cada minuto y órdenes agresivas. Con la casilla marcada se arma solo cuando una descarga termina sin que la detengas, si el panel está abierto en ese momento. App 1 ve los días nuevos sin reiniciar.

## Collector de App 9

Solo consulta, no cambia nada:

- **Nube (Northflank):** si responde, qué monedas recoge y la última vela de cada una. "Buscar huecos" cuenta los minutos sin footprint en las últimas 6 horas; en monedas de poco volumen un minuto sin trades también cuenta.
- **Backend local (puerto 11000):** si está abierto, si su WebSocket está conectado y cuándo escribió `footprint_cache`.
- **Archivo de App 9:** cuándo App 9 bajó su última copia de la nube. Solo lo renueva mientras está abierta.

Un ⚠ en Step indica que el step es 1% o más del precio: cada vela queda en una o dos celdas y el footprint no se puede leer.

## Errores

- Cada moneda tiene su pestaña "Errores y días para revisar": días que no coinciden con las velas oficiales, errores al procesar, reintentos de descarga con su causa y la salida de errores del proceso.
- La salida de los procesos lanzados desde el panel queda en `%LOCALAPPDATA%\PanelOrderFlow\salidas`. Los errores del propio panel, en `%LOCALAPPDATA%\PanelOrderFlow\panel_errores.txt`.

## Qué toca

Escribe solo `control.json` y `queue.txt`, los mismos que antes se editaban a mano según `OrderFlowData\LEEME.txt`, y lanza `ingest.py`, `build_store.py` y `queue_runner.py` sin ventana. No modifica las herramientas ni borra archivos.

Usa el Python de `C:\Python314`, el mismo de la descarga. No hay que instalar nada.

## Días recientes desde la nube (`sync_nube.py`, 12/11/2026)

Baja del collector de Northflank los trades de los días que el almacén oficial todavía no tiene y arma con
ellos su almacén y su flujo, con `build_store.py` y `build_flow.py` sin cambios:

```
C:\Python314\python.exe -B sync_nube.py
C:\Python314\python.exe -B sync_nube.py --monedas BTCUSDT,ETHUSDT --dias 5
```

- Guarda en `OrderFlowData/live/tape`, `live/store` y `live/flow`, con los mismos nombres y formato que
  `tape/`, `store/` y `flow/`. Van aparte porque `build_store.py` y el lector de App 1 no aceptan otros
  nombres dentro de sus carpetas.
- Un día que ya existe en `tape/` (oficial) no se baja: el oficial manda.
- Solo baja lo que cambió en la nube desde la última vez (`.json` junto a cada `.tape`).
- Necesita el collector nuevo desplegado (rutas `/api/tape/...`).
