import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// API key stays in server/ (separate process). The browser only talks to /api via this proxy.
const apiTarget = process.env.API_PROXY_TARGET || 'http://127.0.0.1:8788';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': { target: apiTarget, changeOrigin: true } } },
  preview: { proxy: { '/api': { target: apiTarget, changeOrigin: true } } },
});
