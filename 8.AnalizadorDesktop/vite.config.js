import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],

  // CRITICO: Base relativa para que funcione con file:// en Electron produccion
  base: './',

  // Aliases para imports mas limpios
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@hooks': path.resolve(__dirname, './src/hooks')
    }
  },

  server: {
    port: 5174,
    strictPort: true,
    cors: true,
    // Proxy al backend del Analizador (puerto 10000)
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:10000',
        changeOrigin: true,
      },
    },
  },

  build: {
    outDir: 'dist',
    sourcemap: false,  // Desactivar sourcemaps para produccion (mejor rendimiento)
    // Target Chrome 120 (version embebida en Electron 33)
    target: 'chrome120',
    minify: 'esbuild',  // Minificacion rapida con esbuild
    cssMinify: true,
    rollupOptions: {
      output: {
        // Nombres de archivo sin hash para facilitar debugging
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
        // Separar vendor chunks para mejor cache
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-uplot': ['uplot'],
          'vendor-storage': ['localforage']
        }
      }
    }
  },

  // Pre-bundle de dependencias comunes para acelerar dev
  optimizeDeps: {
    include: ['react', 'react-dom', 'uplot', 'localforage'],
    // Forzar pre-bundle para evitar re-escaneos
    force: false
  },

  // Optimizaciones de esbuild
  esbuild: {
    // Eliminar console.log en produccion (DESHABILITADO TEMPORALMENTE PARA DEBUG)
    // drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
    // Target moderno para Electron
    target: 'chrome120'
  }
});
