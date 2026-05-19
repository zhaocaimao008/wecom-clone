import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify('4.2.0'),
    __BUILD_TIME__: JSON.stringify(new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3001', ws: true }
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // React core — always needed, cache separately
          if (id.includes('/node_modules/react-dom/')) return 'react-dom';
          if (id.includes('/node_modules/react/')) return 'react-core';
          // Date library
          if (id.includes('/node_modules/dayjs/')) return 'dayjs';
          // QR libs — only used on login/profile, lazy loaded
          if (id.includes('/node_modules/qrcode/') ||
              id.includes('/node_modules/jsqr/')) return 'qr-libs';
          // Capacitor — mobile only
          if (id.includes('/node_modules/@capacitor/')) return 'capacitor';
          // Zustand + virtual
          if (id.includes('/node_modules/zustand/') ||
              id.includes('/node_modules/@tanstack/')) return 'state-libs';
          // Everything else from node_modules
          if (id.includes('/node_modules/')) return 'vendor';
        },
      },
    },
    // Raise warning threshold since we've now explicitly split chunks
    chunkSizeWarningLimit: 600,
  },
});
