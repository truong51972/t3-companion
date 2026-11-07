import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * Bind Runner updates to the same source commit as the extension build.
 * This is essential while testing an unmerged PR: using "main" downloads the
 * legacy controller, whose unknown "update" verb breaks the upgrade flow.
 *
 * When the packaged extension is built outside a Git checkout, fall back to
 * the normal main release channel. Override only with an immutable commit SHA.
 */
function companionSourceRef(): string {
  const overridden = process.env.T3_COMPANION_SOURCE_REF;
  if (overridden) {
    if (!/^[0-9a-f]{40}$/.test(overridden)) throw new Error('T3_COMPANION_SOURCE_REF must be a full Git commit SHA');
    return overridden;
  }
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: resolve(import.meta.dirname, '..'), encoding: 'utf8', timeout: 3000,
    }).trim();
    if (/^[0-9a-f]{40}$/.test(sha)) return sha;
  } catch { /* distributed source without .git */ }
  return 'main';
}

export default defineConfig({
  plugins: [react()],
  define: { __T3_COMPANION_SOURCE_REF__: JSON.stringify(companionSourceRef()) },
  build: {
    outDir: 'dist', emptyOutDir: true,
    rollupOptions: {
      input: { popup: resolve('popup.html'), sidepanel: resolve('sidepanel.html'), background: resolve('src/background/index.ts') },
      output: { entryFileNames: chunk => chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js' }
    }
  }
});
