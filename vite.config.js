import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  // Relative paths: the same build is served by the server and packed into the Android app.
  base: './',
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: {
    port: 5190,
    proxy: { '/api': { target: 'http://127.0.0.1:8090', changeOrigin: false } }
  },
  build: { chunkSizeWarningLimit: 1500 }
});
