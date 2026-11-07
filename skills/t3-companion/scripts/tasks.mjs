#!/usr/bin/env node
// Project-local T3 Companion task operations. Only Node.js built-ins required.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const statuses = new Set(['todo', 'in_progress', 'review', 'awaiting_merge', 'done']);
const commands = new Set(['list', 'show', 'add', 'set', 'queue', 'remove']);
const [command, ...args] = process.argv.slice(2);
const usage = 'Usage: tasks.mjs <list|show|add|set|queue|remove> [--project path] [--id id] [--title text] [--prompt text] [--description text] [--priority 1..3] [--status status] [--workspace auto|root|worktree] [--base-ref git-ref] [--branch new-branch] [--provider instance-id --model model-slug] [--not-before ISO-8601] (add/set only)';

function options(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 2) {
    const option = argv[i];
    if (!option.startsWith('--') || i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
      throw new Error('Invalid option: ' + option);
    }
    const key = option.slice(2);
    if (!['project','id','title','prompt','description','priority','status','workspace','base-ref','branch','provider','model','not-before'].includes(key) || Object.hasOwn(result, key)) {
      throw new Error('Unknown or duplicate option: ' + option);
    }
    result[key] = argv[i + 1];
  }
  return result;
}
function validExecution(value) {
  if (!value || typeof value !== 'object' || !['auto','root','worktree'].includes(value.workspace)) return false;
  if (value.baseRef !== undefined && (typeof value.baseRef !== 'string' || !value.baseRef.trim())) return false;
  if (value.branch !== undefined && (typeof value.branch !== 'string' || !value.branch.trim())) return false;
  if (value.notBefore !== undefined && (typeof value.notBefore !== 'string' || Number.isNaN(Date.parse(value.notBefore)))) return false;
  if (value.workspace === 'root' && (value.baseRef || value.branch)) return false;
  if (value.branch && !value.baseRef && value.workspace !== 'auto') return false;
  if (value.modelSelection !== undefined && (
    !value.modelSelection || typeof value.modelSelection.instanceId !== 'string' ||
    !value.modelSelection.instanceId.trim() || typeof value.modelSelection.model !== 'string' ||
    !value.modelSelection.model.trim())) return false;
  return true;
}
const executionFlags = ['workspace','base-ref','branch','provider','model','not-before'];
function setExecution(task, opt) {
  if (!executionFlags.some(key => opt[key] !== undefined)) return;
  const next = { workspace: 'auto', ...task.execution };
  if (opt.workspace !== undefined) next.workspace = opt.workspace;
  if (opt['base-ref'] !== undefined) next.baseRef = opt['base-ref'];
  if (opt.branch !== undefined) next.branch = opt.branch;
  if (opt['not-before'] !== undefined) next.notBefore = opt['not-before'];
  if ((opt.provider === undefined) !== (opt.model === undefined))
    throw new Error('--provider and --model must be specified together');
  if (opt.provider !== undefined) next.modelSelection = { instanceId: opt.provider, model: opt.model };
  if (next.workspace === 'root') { delete next.baseRef; delete next.branch; }
  if (next.notBefore !== undefined) {
    const date = new Date(next.notBefore);
    if (Number.isNaN(date.getTime())) throw new Error('Invalid --not-before date');
    next.notBefore = date.toISOString();
  }
  if (!validExecution(next)) throw new Error('Invalid task execution settings');
  task.execution = next;
}
function validate(doc) {
  if (doc?.version !== 1 || !Array.isArray(doc.tasks)) throw new Error('Invalid tasks.json; refusing to overwrite');
  const ids = new Set(), requestIds = new Set();
  for (const task of doc.tasks) {
    if (!task || typeof task.id !== 'string' || !task.id || ids.has(task.id) ||
        typeof task.title !== 'string' || typeof task.prompt !== 'string' || !statuses.has(task.status) ||
        (task.description !== undefined && typeof task.description !== 'string') ||
        (task.priority !== undefined && (!Number.isInteger(task.priority) || task.priority < 1 || task.priority > 3)) ||
        (task.statusOverride !== undefined && typeof task.statusOverride !== 'boolean') ||
        (task.execution !== undefined && !validExecution(task.execution)) ||
        (task.executionRequests !== undefined && !Array.isArray(task.executionRequests))) {
      throw new Error('Invalid task in tasks.json; refusing to overwrite');
    }
    ids.add(task.id);
    for (const request of task.executionRequests || []) {
      if (!request || typeof request.requestId !== 'string' || !request.requestId || requestIds.has(request.requestId) ||
          (request.worktree !== undefined && typeof request.worktree !== 'string') ||
          (request.workspace !== undefined && !['auto','root','worktree'].includes(request.workspace)) ||
          (request.notBefore !== undefined && typeof request.notBefore !== 'string') ||
          (request.execution !== undefined && !validExecution(request.execution))) {
        throw new Error('Invalid execution request in tasks.json; refusing to overwrite');
      }
      requestIds.add(request.requestId);
    }
  }
  return doc;
}
function priority(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 3) throw new Error('Priority must be 1..3');
  return number;
}
async function read(file) {
  let raw;
  try { raw = await fs.readFile(file, 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { raw: null, doc: { version: 1, tasks: [] } };
  }
  return { raw, doc: validate(JSON.parse(raw)) };
}
function get(doc, id) {
  if (!id) throw new Error('--id is required');
  const task = doc.tasks.find(task => task.id === id);
  if (!task) throw new Error('Task not found: ' + id);
  return task;
}
async function write(file, oldRaw, doc) {
  validate(doc);
  const current = await fs.readFile(file, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (current !== oldRaw) throw new Error('tasks.json changed during edit; reload and retry');
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.' + process.pid + '.' + randomUUID() + '.tmp';
  try {
    await fs.writeFile(temp, JSON.stringify(doc, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await fs.rename(temp, file);
  } finally { await fs.rm(temp, { force: true }); }
}
async function main() {
  if (!commands.has(command)) throw new Error(usage);
  const opt = options(args);
  const project = path.resolve(opt.project || process.cwd());
  const stat = await fs.stat(project);
  if (!stat.isDirectory()) throw new Error('Not a project directory: ' + project);
  const file = path.join(project, '.t3', 'tasks.json');
  const { raw, doc } = await read(file);
  let result;
  if (command === 'list') result = doc;
  else if (command === 'show') result = get(doc, opt.id);
  else if (command === 'add') {
    if (!opt.title?.trim() || !opt.prompt?.trim()) throw new Error('--title and --prompt are required');
    const task = { id: randomUUID(), title: opt.title.trim(), prompt: opt.prompt, status: 'todo', priority: opt.priority === undefined ? 2 : priority(opt.priority) };
    if (opt.description !== undefined) task.description = opt.description;
    task.execution = { workspace: 'auto' };
    setExecution(task, opt);
    doc.tasks.push(task); result = task;
  } else if (command === 'set') {
    const task = get(doc, opt.id);
    if (!['title','prompt','description','priority','status',...executionFlags].some(key => opt[key] !== undefined)) throw new Error('Provide a field to update');
    if (opt.title !== undefined) {
      if (!opt.title.trim()) throw new Error('Title cannot be empty');
      task.title = opt.title.trim();
    }
    if (opt.prompt !== undefined) {
      if (!opt.prompt.trim()) throw new Error('Prompt cannot be empty');
      task.prompt = opt.prompt;
    }
    if (opt.description !== undefined) task.description = opt.description;
    if (opt.priority !== undefined) task.priority = priority(opt.priority);
    if (opt.status !== undefined) {
      if (!statuses.has(opt.status)) throw new Error('Invalid status: ' + opt.status);
      if (opt.status === 'done') throw new Error('Done is reserved for verified merged PR/MR or a manual Board move');
      task.status = opt.status;
      task.statusOverride = true;
    }
    setExecution(task, opt);
    result = task;
  } else if (command === 'queue') {
    if (executionFlags.some(key => opt[key] !== undefined)) {
      throw new Error('Execution options belong to the task. Use add/set before queue.');
    }
    const task = get(doc, opt.id);
    const execution = structuredClone(task.execution || { workspace: 'auto' });
    if (!validExecution(execution)) throw new Error('Invalid saved task execution settings');
    const request = { requestId: randomUUID(), execution };
    if (execution.notBefore) request.notBefore = execution.notBefore;
    task.status = 'todo';
    task.statusOverride = false;
    task.executionRequests ??= [];
    task.executionRequests.push(request); result = { taskId: task.id, ...request };
  } else if (command === 'remove') {
    get(doc, opt.id);
    doc.tasks = doc.tasks.filter(task => task.id !== opt.id);
    result = { removed: opt.id };
  }
  if (!['list','show'].includes(command)) await write(file, raw, doc);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
main().catch(error => { console.error(String(error.message || error)); process.exitCode = 1; });
