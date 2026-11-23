// Lo que depende del telefono (Capacitor): guardar datos, leer el QR y los avisos push. En el navegador
// (desarrollo) guarda en localStorage, el QR se pega como texto y no hay avisos.
import { Capacitor } from '@capacitor/core';

export const isNative = () => Capacitor.isNativePlatform();

// ---------- datos de la app ----------
// En el telefono van al almacenamiento privado de la app (Preferences). El cifrado con el Keystore y la huella
// llegan con la fase 3 (cerrar posiciones): hoy la app solo lee.
export async function loadValue(key) {
  try {
    if (isNative()) {
      const { Preferences } = await import('@capacitor/preferences');
      const { value } = await Preferences.get({ key });
      return value ? JSON.parse(value) : null;
    }
    const value = localStorage.getItem(`alt_${key}`);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export async function saveValue(key, value) {
  if (isNative()) {
    const { Preferences } = await import('@capacitor/preferences');
    if (value === null) await Preferences.remove({ key });
    else await Preferences.set({ key, value: JSON.stringify(value) });
  } else if (value === null) localStorage.removeItem(`alt_${key}`);
  else localStorage.setItem(`alt_${key}`, JSON.stringify(value));
}

// ---------- QR ----------
/** Abre la camara y devuelve el texto del QR. Solo en el telefono. */
export async function scanQr() {
  const { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } = await import('@capacitor/barcode-scanner');
  const result = await CapacitorBarcodeScanner.scanBarcode({
    hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
    scanInstructions: 'Apunta al código de la suite',
    scanButton: false,
  });
  return result.ScanResult;
}

// ---------- avisos push ----------
// Solo se registran cuando el usuario los enciende en Ajustes: sin el archivo google-services.json de Firebase
// dentro de la app, registrarse la cierra.
let listeners = [];

export async function enablePush(onToken, onOpen) {
  const { PushNotifications } = await import('@capacitor/push-notifications');
  let permission = await PushNotifications.checkPermissions();
  if (permission.receive !== 'granted') permission = await PushNotifications.requestPermissions();
  if (permission.receive !== 'granted') throw new Error('Android no dio permiso para los avisos');
  await PushNotifications.createChannel({ id: 'trades', name: 'Trades', description: 'Posiciones abiertas y cerradas', importance: 4 });
  await PushNotifications.createChannel({ id: 'critical', name: 'Avisos críticos', description: 'Posición sin stop, bot sin responder', importance: 5 });
  await disablePushListeners();
  listeners = [
    await PushNotifications.addListener('registration', (token) => onToken(token.value)),
    await PushNotifications.addListener('registrationError', (e) => onToken(null, e?.error || 'Firebase no registró el celular')),
    await PushNotifications.addListener('pushNotificationActionPerformed', (action) => onOpen?.(action.notification?.data || {})),
  ];
  await PushNotifications.register();
}

export async function disablePushListeners() {
  for (const l of listeners) await l.remove();
  listeners = [];
}

/** Avisa cuando la app vuelve al frente (para leer de inmediato). Devuelve como quitarlo. */
export async function onResume(callback) {
  if (!isNative()) {
    const handler = () => { if (document.visibilityState === 'visible') callback(); };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }
  const { App } = await import('@capacitor/app');
  const l = await App.addListener('appStateChange', (state) => { if (state.isActive) callback(); });
  return () => l.remove();
}
