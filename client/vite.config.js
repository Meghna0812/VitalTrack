import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The proxy forwards /api/* from the React dev server (5173) to the Express API (4000),
// so the browser thinks both live on the same origin.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:4000' } },
});
