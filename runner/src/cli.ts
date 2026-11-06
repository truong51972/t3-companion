#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import { createTask, defaultHome, listProjects, registerProject, unregisterProject } from './storage.ts';
import { runRunner, startDetached, requestStop, status } from './runner.ts';

const [, , command, ...args] = process.argv;
const usage = `t3-runner <command>
  add <path> | remove <path> | list
  task add <project> --title <text> --prompt <text> [--worktree main]
  run [--once] [--interval-ms 10000] [--concurrency 3]
  start | stop | status
Environment: T3_COMPANION_HOME, T3CODE_HOME, T3_COMPANION_T3_BIN`;
const opt = (name: string) => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1]; };
try {
  let result: unknown;
  if (command === 'add' && args[0]) result = await registerProject(args[0]);
  else if (command === 'remove' && args[0]) result = await unregisterProject(args[0]);
  else if (command === 'list') result = await listProjects();
  else if (command === 'task' && args[0] === 'add' && args[1]) result = await createTask(args[1], opt('--title') || '', opt('--prompt') || '', opt('--worktree'));
  else if (command === 'run') result = await runRunner({ once: args.includes('--once'), intervalMs: Number(opt('--interval-ms') || 10000), concurrency: Number(opt('--concurrency') || 3) });
  else if (command === 'start') result = { pid: await startDetached() };
  else if (command === 'stop') result = { requested: await requestStop() };
  else if (command === 'status') result = { ...await status(), home: defaultHome() };
  else { console.log(usage); process.exitCode = 2; }
  if (result !== undefined) console.log(JSON.stringify(result, null, 2));
} catch (e: any) { console.error(e.message); process.exitCode = 1; }
