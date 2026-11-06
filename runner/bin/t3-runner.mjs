#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const child = spawnSync(process.execPath, ['--experimental-strip-types', cli, ...process.argv.slice(2)], { stdio: 'inherit' });
if (child.error) { console.error(child.error.message); process.exit(1); }
process.exit(child.status ?? 1);
