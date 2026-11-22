# CLAUDE.md - Altagracia móvil (app Android)

Guía para Claude Code en esta carpeta. Comunicarse siempre en español con el usuario.

## Qué es

La app Android para seguir los trades del bot de la suite (`12.AltagraciaTradingSuite`). Pedida el 21/11/2026. Es una página React + Vite dentro de una cáscara de Capacitor 7. **Solo lee** (fase 2): cerrar posiciones llega en la fase 3.

El plan por fases y todo lo del servidor (puerta móvil, firmas, vigilante, avisos) está en `12.AltagraciaTradingSuite/CLAUDE.md`, "Puerta móvil".

## Estado (21/11/2026)

- **Hecho y probado en el navegador** a 375×812, contra la puerta de demostración: emparejar con el código, inicio, posiciones, trades con su decisión y sus capturas, avisos y el aviso de "sin conexión".
- **No probado:** en un celular. Este PC no tiene Java ni el SDK de Android, así que el APK nunca se armó. Tampoco el lector de QR, los avisos push ni el modo directo contra Bybit real (en el navegador Bybit lo bloquea por CORS; en el celular los pedidos salen por el HTTP nativo de Capacitor).

## Estructura

```
13.AltagraciaMobile/
├── capacitor.config.json   appId co.altagracia.mobile; CapacitorHttp encendido (pedidos nativos: sin CORS ni bloqueo de http)
├── src/
│   ├── App.jsx             Estado, lecturas cada 5 s (resumen y posiciones) y 30 s (trades y avisos), pestañas
│   ├── lib/sign.js         HMAC con WebCrypto: firma de la puerta y firma de Bybit V5
│   ├── lib/gate.js         Pedidos firmados a la puerta; corrige el reloj con la hora del servidor; imágenes
│   ├── lib/bybit.js        Modo directo: posiciones y saldo de Bybit, solo GET, con clave de solo lectura
│   ├── lib/native.js       Lo del teléfono: guardar datos, leer el QR, avisos push, volver al frente
│   ├── lib/format.js       Números y cuentas de las pantallas (P&L, ROI, "Al TP", "Al SL", resumen)
│   └── screens/            Home, Positions, Trades (lista y detalle), Events, Settings
└── tests/app.test.mjs      8 pruebas con node (npm test)
```

## Pantallas

- **Inicio:** cuenta activa (DEMO o REAL), pausa, P&L abierto, posiciones sin stop, resumen de 30 días y últimos avisos.
- **Posiciones:** una tarjeta por posición con P&L y ROI de Bybit, entrada, marca, stop y objetivo con lo que se perdería o ganaría, liquidación, "Al SL" y "Al TP".
- **Trades:** el journal de 30 días. El detalle trae la decisión (nota y lo elegido, numerado) y las capturas; un toque las abre a tamaño real.
- **Avisos:** los eventos del vigilante, guardados en el celular. Un toque abre su trade.
- **Ajustes:** emparejar (QR o pegando el código), avisos, y las claves del modo directo.

## Reglas

- **Solo lectura.** `lib/bybit.js` solo hace GET a `/v5/position/list` y `/v5/account/wallet-balance`; una prueba lo comprueba. No agregar ahí nada que opere: cerrar una posición va por la puerta de la suite (fase 3), nunca directo a Bybit.
- **Las claves del bot nunca van al celular.** El modo directo usa una clave aparte, creada por el usuario solo con permiso de lectura.
- **La firma** de `lib/sign.js` y la de `mobile_devices.signature` (suite) son la misma: un cambio va en los dos lados. Las dos pruebas comparten los mismos valores.
- **Sin la suite** (PC apagado o sin Tailscale): la app lo distingue porque no hay respuesta. Un error de la suite (bot caído, celular revocado) no activa el modo directo.
- **Avisos push:** solo se registran si el usuario los enciende en Ajustes. Sin `google-services.json` dentro de la app, registrarse la cierra.
- **Datos guardados:** en el almacenamiento privado de la app (`@capacitor/preferences`). El cifrado con el Keystore y la huella quedan para la fase 3.

## Ver la app en el navegador

```
cd 12.AltagraciaTradingSuite\server
C:\Python314\python.exe -B tests\mobile_demo.py        (puerta de demostración en 127.0.0.1:13092; imprime un código)
cd 13.AltagraciaMobile
npm run dev                                            (http://localhost:13010)
```

En Ajustes de la app se pega el código que imprimió la demostración. Son datos inventados: no toca el bot ni los datos de la suite.

## Armar el APK (lo hace el usuario; aquí no se pudo)

1. Instalar Android Studio (trae Java y el SDK).
2. En esta carpeta: `npm install`, `npm run build` y, la primera vez, `npx cap add android`.
3. Para los avisos: copiar el `google-services.json` del proyecto de Firebase a `android/app/`.
4. `npx cap sync android` y `npx cap open android`; en Android Studio, Run con el celular conectado por USB (depuración USB encendida).

La carpeta `android/` no va a git (se genera). El permiso de cámara para el QR y el de avisos los agregan los plugins.

## Pruebas

```
npm test        (8: firma igual a la del servidor, código de emparejamiento, puerta, reloj corrido, modo directo solo de lectura, tarjeta y formatos)
```
