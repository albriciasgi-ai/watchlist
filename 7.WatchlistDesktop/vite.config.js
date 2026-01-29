import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],

  // CRITICO: Base relativa para que funcione con file:// en Electron
  base: './',

  // Resolver alias para imports mas limpios
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@hooks': path.resolve(__dirname, './src/hooks')
    }
  },

  // Configuracion del servidor de desarrollo
  server: {
    port: 5173,
    strictPort: true,
    // Permitir conexiones desde Electron
    cors: true,
    // CRITICO: Proxy para reutilizar conexiones HTTP (igual que el original)
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },

  // Configuracion de build
  build: {
    outDir: 'dist',
    // Generar sourcemaps para debugging
    sourcemap: true,
    // Optimizaciones
    minify: 'esbuild',
    // Target para Electron (Chrome moderno)
    target: 'chrome120',
    rollupOptions: {
      output: {
        // Nombres de archivos predecibles
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]'
      }
    }
  },

  // Optimizaciones para dependencias
  optimizeDeps: {
    include: ['react', 'react-dom', 'uplot', 'localforage']
  }
});
