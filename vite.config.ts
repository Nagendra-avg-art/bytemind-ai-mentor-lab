import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Exposes the app to your local network for testing on mobile devices (e.g., iQOO phone)
    host: true,
    port: 5173,
    // Proxy API requests from Vite (:5173/api/...) to the Node.js Express backend (:3001/api/...)
    // This solves CORS issues and allows mobile devices accessing :5173 to reach the backend seamlessly.
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
