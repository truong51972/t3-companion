import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Runner installation and upgrades are Git-managed at ~/.t3/t3-companion.
// The browser extension no longer embeds a controller source commit or
// downloads executable JavaScript during installation.
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
