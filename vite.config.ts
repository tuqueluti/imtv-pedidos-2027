import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3270',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://127.0.0.1:3270',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: {
          three: [
            'three',
            'three/addons/environments/RoomEnvironment.js',
            'three/addons/objects/Reflector.js',
            'three/addons/renderers/CSS3DRenderer.js',
          ],
        },
      },
    },
  },
});
