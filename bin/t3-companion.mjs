#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import { enqueueJob, listJobs, listProjects, registerProject, rootDir, unregisterProject } from '../src/store.mjs';
import { requestStop, runRunner, runnerStatus, startDetached } from '../src/runner.mjs';

const usage = `t3-companion — T3 Code companion control interface

  project add <path>                   Register a local project
  project remove <id|path>             Unregister an idle project
  project list                         List registered projects
  job add <id|path> --prompt <text>    Enqueue agent work
      [--worktree <base-ref>]          Use a T3-managed worktree
      [--prompt-file <path>]           Read prompt from a file instead
  job list                             List jobs and statuses
  runner start                         Start detached runner
  runner run [--once]                  Run in foreground (10s polling)
      [--interval-ms <n>] [--max-concurrent <1..3>]
  runner stop                          Graceful drain: stop accepting new jobs
  runner status                        Read runner status

Storage: T3_COMPANION_HOME (default ~/.t3/runner)
T3 CLI: T3_COMPANION_T3_BIN (default t3)`;

const [, , group, action, ...rest] = process.argv;
const option = (name) => {
  const index = rest.indexOf(name);
  return index === -1 ? undefined : rest[index + 1];
};
const has = (name) => rest.includes(name);
const print = (value) => console.log(JSON.stringify(value, null, 2));

try {
  if (group === 'project' && action === 'add' && rest[0]) print(await registerProject(rest[0]));
  else if (group === 'project' && action === 'remove' && rest[0]) print(await unregisterProject(rest[0]));
  else if (group === 'project' && action === 'list') print(await listProjects());
  else if (group === 'job' && action === 'add' && rest[0]) {
    if (has('--prompt') && has('--prompt-file')) throw new Error('Specify --prompt OR --prompt-file');
    const prompt = has('--prompt-file') ? await fs.readFile(option('--prompt-file'), 'utf8') : option('--prompt');
    print(await enqueueJob(rest[0], prompt, { worktree: option('--worktree') }));
  } else if (group === 'job' && action === 'list') print(await listJobs());
  else if (group === 'runner' && action === 'start') print({ pid: await startDetached() });
  else if (group === 'runner' && action === 'run') {
    await runRunner({ once: has('--once'),
      intervalMs: Number(option('--interval-ms') ?? 10000),
      maxConcurrent: Number(option('--max-concurrent') ?? process.env.T3_COMPANION_MAX_CONCURRENT ?? 3) });
  } else if (group === 'runner' && action === 'stop') print({ requested: await requestStop() });
  else if (group === 'runner' && action === 'status') {
    const jobs = await listJobs();
    print({ ...await runnerStatus(), root: rootDir(), jobs: Object.fromEntries(
      [...new Set(jobs.map((job) => job.state))].map((state) => [state, jobs.filter((job) => job.state === state).length])) });
  } else if (['--help', '-h', 'help'].includes(group)) console.log(usage);
  else { console.error(usage); process.exitCode = 2; }
} catch (error) {
  console.error(`t3-companion: ${error.message}`);
  process.exitCode = 1;
}
