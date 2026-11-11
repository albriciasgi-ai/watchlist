// Íconos de línea de un solo color para la muestra del tema nuevo (en lugar de emojis).
// Dibujados a mano en una grilla de 24 px; toman el color del texto (currentColor).
import React from 'react';

const PATHS = {
  sliders: <><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>,
  maximize: <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />,
  toEnd: <path d="M3 12h13M11 6l6 6-6 6M21 5v14" />,
  play: <path d="M7 4.5v15l12-7.5z" />,
  pause: <path d="M8 5v14M16 5v14" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="1.5" />,
  refresh: <><path d="M20 12a8 8 0 1 1-2.4-5.7L20 8.5" /><path d="M20 4v4.5h-4.5" /></>,
  layers: <><path d="M12 3 3 7.5 12 12l9-4.5z" /><path d="M3 12l9 4.5 9-4.5" /><path d="M3 16.5 12 21l9-4.5" /></>,
  cursor: <path d="M5 4l6 16 2.4-6.6L20 11z" />,
  trend: <><path d="M5.5 18.5 18.5 5.5" /><circle cx="4.5" cy="19.5" r="1.5" /><circle cx="19.5" cy="4.5" r="1.5" /></>,
  hline: <><path d="M6 12h12" /><circle cx="4" cy="12" r="1.5" /><circle cx="20" cy="12" r="1.5" /></>,
  vline: <><path d="M12 6v12" /><circle cx="12" cy="4" r="1.5" /><circle cx="12" cy="20" r="1.5" /></>,
  rect: <rect x="4" y="6" width="16" height="12" rx="1" />,
  fib: <><path d="M3 5h18M3 9.5h18M3 14.5h18M3 19h18" /><path d="M5 19 19 5" opacity="0.55" /></>,
  text: <><path d="M5 6V4h14v2" /><path d="M12 4v16" /><path d="M9 20h6" /></>,
  long: <><rect x="4" y="4" width="16" height="16" rx="1" /><path d="M4 12h16" /><path d="M12 9V6M10 8l2-2 2 2" /></>,
  short: <><rect x="4" y="4" width="16" height="16" rx="1" /><path d="M4 12h16" /><path d="M12 15v3M10 16l2 2 2-2" /></>,
  undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>,
  redo: <><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></>,
  trash: <path d="M4 7h16M9 7V4h6v3M18 7l-1 13H7L6 7" />,
  pencil: <><path d="M13 20h8" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>,
  close: <path d="M18 6 6 18M6 6l12 12" />,
  chevronLeft: <path d="m15 6-6 6 6 6" />,
  follow: <><circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></>,
  profile: <><path d="M4 4v16" /><path d="M4 7h7M4 10h12M4 13h16M4 16h9M4 19h5" /></>,
  palette: <><path d="M12 3a9 9 0 0 0 0 18c1.2 0 1.8-.9 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8h2.1A4.3 4.3 0 0 0 21 10.7C21 6.4 17 3 12 3z" /><circle cx="7.5" cy="11" r="1.1" /><circle cx="10" cy="7.3" r="1.1" /><circle cx="14.5" cy="7.3" r="1.1" /></>
};

export function Icon({ name, size = 16, strokeWidth = 1.75, style }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: 'block', ...style }}
    >
      {PATHS[name]}
    </svg>
  );
}

export default Icon;
