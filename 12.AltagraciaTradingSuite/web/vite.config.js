import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// El grafico y los indicadores son los de App 1 (pieza compartida): se importan desde su carpeta, sin copiarlos.
// Dos ajustes al importarlos:
//  - su config.js (API_BASE_URL = localhost:9000) se cambia por src/app1Config.js, que apunta al servidor de la suite;
//  - los paquetes (react, etc.) se resuelven desde esta app, para que haya un solo React.
const APP1_SRC = path.resolve(__dirname, '../../1.Altagracia_Crypto_Backtester/Backtester/frontend/src');
const APP1_CONFIG = path.join(APP1_SRC, 'config.js');
const SUITE_CONFIG = path.resolve(__dirname, 'src/app1Config.js');
const SUITE_ENTRY = path.resolve(__dirname, 'src/main.jsx');
const same = (a, b) => path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase();
const inApp1 = (file) => path.normalize(file).toLowerCase().startsWith(path.normalize(APP1_SRC).toLowerCase());

function app1Shared() {
  return {
    name: 'app1-shared',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer) return null;
      const from = importer.split('?')[0];
      if (!inApp1(from)) return null;
      if (source.startsWith('.')) {
        const target = path.resolve(path.dirname(from), source);
        if (same(target, APP1_CONFIG) || same(target + '.js', APP1_CONFIG)) return SUITE_CONFIG;
        return null;
      }
      if (source.startsWith('/') || source.startsWith('\0') || /^[a-zA-Z]:/.test(source)) return null;
      return this.resolve(source, SUITE_ENTRY, { ...options, skipSelf: true });
    },
  };
}

const SERVER = process.env.SUITE_SERVER || 'http://127.0.0.1:13000';

export default defineConfig({
  plugins: [app1Shared(), react()],
  resolve: {
    alias: { '@app1': APP1_SRC },
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: Number(process.env.SUITE_WEB_PORT || 13001),
    host: '127.0.0.1',
    strictPort: true,
    fs: { allow: [path.resolve(__dirname, '../..')] },
    proxy: { '/api': { target: SERVER, changeOrigin: true } },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 4000 },
});
