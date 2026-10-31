import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8080', changeOrigin: false }
    }
  },
  build: {
    target: 'es2022',
    // Source maps are a debugging aid, not a production artifact. Set VITE_SOURCEMAP=true for a
    // deliberate diagnostic build in a non-public environment.
    sourcemap: process.env.VITE_SOURCEMAP === 'true'
  },
  test: {
    environment: 'jsdom'
  }
});
