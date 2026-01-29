import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 11001,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:11000",
        changeOrigin: true,
      },
    },
  },
  // Configuracion para build de Electron
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // Optimizaciones para Electron
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          uplot: ['uplot']
        }
      }
    }
  }
});
