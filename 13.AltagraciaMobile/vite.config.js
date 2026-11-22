import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// La app es una pagina local dentro de la cascara de Capacitor: rutas relativas
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', target: 'es2020' },
});
