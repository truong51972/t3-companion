import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist', emptyOutDir: true,
    rollupOptions: {
      input: { popup: resolve('popup.html'), sidepanel: resolve('sidepanel.html'), background: resolve('src/background/index.ts') },
      output: { entryFileNames: chunk => chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js' }
    }
  }
});
