import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
// Build multi-page : le jeu demeure l'entrée principale ; le simulateur tactique
// possède son URL autonome. La base relative reste compatible Pages et Capacitor.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        tactical: fileURLToPath(new URL('./cinematic-demo.html', import.meta.url)),
      },
    },
  },
});
