import { defineConfig } from 'vite';
// Test server without HMR/full reloads (stable while files are being edited)
export default defineConfig({ base: './', server: { port: 5174, hmr: false, watch: null } });
