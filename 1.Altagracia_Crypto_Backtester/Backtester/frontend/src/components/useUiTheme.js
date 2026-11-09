// El componente se vuelve a pintar cuando cambia el estilo o algún color (uiTheme.js).
// Va aparte para que los indicadores, que también corren en las pruebas de Node, no dependan de React.
import { useSyncExternalStore } from 'react';
import { onThemeChange, themeRevision } from './uiTheme.js';

export function useUiTheme() {
  return useSyncExternalStore(onThemeChange, themeRevision, themeRevision);
}

export default useUiTheme;
