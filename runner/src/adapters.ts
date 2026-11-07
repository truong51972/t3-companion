import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const run = promisify(execFile);
export const RUNNER_CAPABILITIES = {
  adapters: ['t3-cli', 'git', 'workflow', 'scheduler'],
  workspaces: ['root', 'auto', 'worktree'],
  existingWorktreeDispatch: false,
  modelSelection: 'provider-instance-and-model',
  threadLinkOnLaunch: false,
  maxConcurrent: 3,
} as const;

export interface GitWorktree { path: string; head: string | null; branch: string | null; locked: boolean }
export interface GitProjectInfo {
  project: string;
  isGit: boolean;
  repositoryRoot: string | null;
  currentBranch: string | null;
  defaultBranch: string | null;
  refs: string[];
  worktrees: GitWorktree[];
}

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run('git', ['-C', cwd, ...args], {
      encoding: 'utf8', timeout: 5000, maxBuffer: 256 * 1024, windowsHide: true,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** Read-only Git adapter for the execution host; never executes task-supplied shell text. */
export async function inspectGitProject(input: string): Promise<GitProjectInfo> {
  const project = await fs.realpath(path.resolve(input));
  if (!(await fs.stat(project)).isDirectory()) throw new Error('Project is not a directory');
  const repositoryRoot = await git(project, ['rev-parse', '--show-toplevel']);
  if (!repositoryRoot) return {
    project, isGit: false, repositoryRoot: null, currentBranch: null,
    defaultBranch: null, refs: [], worktrees: [],
  };
  const currentBranch = await git(project, ['branch', '--show-current']);
  const defaultBranch = await git(project, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  const rawRefs = await git(project, ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes']);
  const refs = rawRefs ? [...new Set(rawRefs.split(/\r?\n/).filter(Boolean))] : [];
  const rawWorktrees = await git(project, ['worktree', 'list', '--porcelain']);
  const worktrees: GitWorktree[] = [];
  for (const entry of (rawWorktrees || '').split(/\r?\n\r?\n/)) {
    const lines = entry.split(/\r?\n/);
    const name = lines.find(line => line.startsWith('worktree '))?.slice(9);
    if (!name) continue;
    const head = lines.find(line => line.startsWith('HEAD '))?.slice(5) || null;
    const branch = lines.find(line => line.startsWith('branch '))?.slice(7).replace(/^refs\/heads\//, '') || null;
    worktrees.push({ path: name, head, branch, locked: lines.some(line => line.startsWith('locked')) });
  }
  return { project, isGit: true, repositoryRoot, currentBranch, defaultBranch, refs, worktrees };
}
