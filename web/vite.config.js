import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In dev, `vite` serves the UI on :5173 and forwards /api to server.js on :3000
// so that the API key never leaves the Node process.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: false,
        // never buffer, never time out a 3-minute generation
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
});
