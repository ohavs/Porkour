import { defineConfig } from 'vite';
// base './' = works on GitHub Pages (/Porkour/) and any static host.
export default defineConfig({
  base: './',
  build: { assetsDir: 'js', target: 'es2022', chunkSizeWarningLimit: 4000, assetsInlineLimit: 0 },
  server: { host: true },
});
