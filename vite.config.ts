import { defineConfig } from 'vite';
// base relative : la même construction sert GitHub Pages et l'APK (Capacitor).
export default defineConfig({ base: './', build: { target: 'es2022' } });
