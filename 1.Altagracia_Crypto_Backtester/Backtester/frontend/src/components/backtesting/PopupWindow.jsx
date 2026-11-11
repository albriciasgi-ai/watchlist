import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Ventana aparte del navegador que muestra parte de la app. Sigue siendo el mismo árbol de React:
 * comparte el estado y los datos con la ventana principal, sin cargarlos otra vez.
 *
 * La ventana se abre en el clic (openPopup), porque el navegador bloquea las que se abren después.
 * PopupWindow copia en ella los estilos de la página (también los que Vite agrega después) y la clase y
 * las variables del estilo elegido, que viven en el body. Los modales de adentro se abren en ella:
 * usan usePortalTarget() en vez de document.body.
 */

const PortalTargetContext = createContext(null);

/** Dónde abrir un modal: el body de la ventana aparte, o el de la principal */
export const usePortalTarget = () => useContext(PortalTargetContext) || document.body;

/** Documento donde está el componente, para escuchar el teclado en la ventana correcta */
export const useHostDocument = () => usePortalTarget().ownerDocument || document;

/** Abre (o trae al frente) una ventana aparte. Llamar desde un clic. null si el navegador la bloqueó */
export function openPopup(name, { width = 900, height = 900 } = {}) {
  const features = `width=${width},height=${height},left=${Math.max(0, window.screenX + 60)},top=${Math.max(0, window.screenY + 40)}`;
  const popup = window.open('', name, features);
  if (!popup) {
    window.alert('El navegador bloqueó la ventana. Permite las ventanas emergentes para esta página y vuelve a intentarlo.');
    return null;
  }
  popup.focus();
  return popup;
}

function copyBody(from, to) {
  to.body.className = from.body.className;
  const style = from.body.getAttribute('style');
  if (style) to.body.setAttribute('style', style);
  else to.body.removeAttribute('style');
  to.body.style.margin = '0';
  to.body.style.overflow = 'auto';
}

const isSheet = (node) => node.nodeName === 'STYLE' || (node.nodeName === 'LINK' && node.rel === 'stylesheet');

const PopupWindow = ({ popup, title, onClose, children }) => {
  const [container, setContainer] = useState(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!popup || popup.closed) return undefined;
    const doc = popup.document;
    doc.head.innerHTML = '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">';
    doc.title = title; // Después de armar el head, que lo borraría
    doc.body.innerHTML = '';
    for (const node of document.head.querySelectorAll('style, link[rel="stylesheet"]')) doc.head.appendChild(node.cloneNode(true));
    copyBody(document, doc);

    const root = doc.createElement('div');
    root.className = 'popup-window-root';
    doc.body.appendChild(root);
    setContainer(root);

    // Estilos que llegan después (Vite) y cambios de estilo de la app
    const headWatch = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) if (isSheet(node)) doc.head.appendChild(node.cloneNode(true));
      }
    });
    headWatch.observe(document.head, { childList: true });
    const bodyWatch = new MutationObserver(() => copyBody(document, doc));
    bodyWatch.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });

    // Quien cierra la ventana a mano la devuelve a la principal
    const handleUnload = () => closeRef.current?.();
    popup.addEventListener('beforeunload', handleUnload);
    // Si se cierra o recarga la ventana principal, la aparte no queda huérfana
    const closeChild = () => popup.close();
    window.addEventListener('beforeunload', closeChild);

    return () => {
      headWatch.disconnect();
      bodyWatch.disconnect();
      window.removeEventListener('beforeunload', closeChild);
      popup.removeEventListener('beforeunload', handleUnload);
      setContainer(null);
    };
  }, [popup, title]);

  if (!container) return null;
  return createPortal(
    <PortalTargetContext.Provider value={container.ownerDocument.body}>
      {children}
    </PortalTargetContext.Provider>,
    container
  );
};

export default PopupWindow;
