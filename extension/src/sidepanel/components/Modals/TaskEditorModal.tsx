import React, { useEffect, useMemo, useRef, useState } from 'react';
import { handleDialogBackdrop } from '../Common';
import {
  BOARD_COLUMNS, blankTask, type Task, type TaskStatus,
  type TaskModelSelection, type TaskExecutionSettings, type WorkspaceMode,
} from '../../../shared/domain-types';
import type { T3GitRef } from '../../../bridge/t3-bridge';

type DiscoveredModel = TaskModelSelection & { name: string; provider: string };
type InspectedWorktree = { path: string; branch: string | null; locked?: boolean };

function localDateTime(iso?: string) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function TaskEditorModal({
  open, task, availableModels, discoveryScope, onExploreRefs, onExploreModels, onExploreWorktrees, onClose, onSave, busy,
}: {
  open: boolean;
  task: Task | null;
  availableModels: TaskModelSelection[];
  discoveryScope: string;
  onExploreRefs: () => Promise<T3GitRef[]>;
  onExploreModels: () => Promise<DiscoveredModel[]>;
  onExploreWorktrees: () => Promise<InspectedWorktree[]>;
  onClose: () => void;
  onSave: (task: Task) => Promise<void>;
  busy: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Task>(task || blankTask());
  const [customModel, setCustomModel] = useState(false);
  const [modelMore, setModelMore] = useState(false);
  const [refs, setRefs] = useState<T3GitRef[]>([]);
  const [refsBusy, setRefsBusy] = useState(false);
  const [refsError, setRefsError] = useState('');
  const [models, setModels] = useState<DiscoveredModel[]>([]);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [explored, setExplored] = useState(false);
  const [showWorktrees, setShowWorktrees] = useState(false);
  const [inspectedWorktrees, setInspectedWorktrees] = useState<InspectedWorktree[] | null>(null);
  const [worktreesBusy, setWorktreesBusy] = useState(false);
  const [worktreesError, setWorktreesError] = useState('');
  const [schedule, setSchedule] = useState('');

  useEffect(() => {
    const next = task ? structuredClone(task) : blankTask();
    setDraft({ ...next, execution: next.execution || { workspace: 'auto' } });
    setSchedule(localDateTime(next.execution?.notBefore));
    setCustomModel(false);
    setModelMore(false);
    setShowWorktrees(false);
    setInspectedWorktrees(null);
    setWorktreesError('');
  }, [task, open]);

  useEffect(() => {
    if (!open || !discoveryScope) return;
    let active = true;
    setRefs([]);
    setRefsError('');
    setModels([]);
    setExplored(false);
    setRefsBusy(true);
    void onExploreRefs().then(result => {
      if (active) setRefs(result);
    }).catch(error => {
      if (active) setRefsError(String(error));
    }).finally(() => {
      if (active) setRefsBusy(false);
    });
    return () => { active = false; };
    // Discovery scope includes the selected T3 environment and project.
  }, [open, discoveryScope]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  const execution: TaskExecutionSettings = draft.execution || { workspace: 'auto' };
  const selectedModel = execution.modelSelection
    ? JSON.stringify([execution.modelSelection.instanceId, execution.modelSelection.model])
    : '';
  const modelChoices = useMemo(() => {
    const values: DiscoveredModel[] = [
      ...availableModels.map(value => ({ ...value, name: value.model, provider: value.instanceId })),
      ...models,
    ];
    if (execution.modelSelection) values.push({
      ...execution.modelSelection, name: execution.modelSelection.model,
      provider: execution.modelSelection.instanceId,
    });
    const seen = new Set<string>();
    return values.filter(item => {
      const key = JSON.stringify([item.instanceId, item.model]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [availableModels, models, execution.modelSelection?.instanceId, execution.modelSelection?.model]);
  const knownWorktrees = useMemo(() => {
    const seen = new Set<string>();
    return refs.filter(item => {
      if (!item.worktreePath || seen.has(item.worktreePath)) return false;
      seen.add(item.worktreePath);
      return true;
    });
  }, [refs]);

  function setExecution(patch: Partial<NonNullable<Task['execution']>>) {
    setDraft(previous => ({
      ...previous,
      execution: { workspace: 'auto', ...previous.execution, ...patch },
    }));
  }
  async function toggleWorktreeExplorer() {
    if (showWorktrees) {
      setShowWorktrees(false);
      return;
    }
    setShowWorktrees(true);
    if (inspectedWorktrees !== null) return;
    setWorktreesBusy(true);
    setWorktreesError('');
    try {
      setInspectedWorktrees(await onExploreWorktrees());
    } catch (error) {
      setWorktreesError(String(error));
    } finally {
      setWorktreesBusy(false);
    }
  }
  async function discoverModels() {
    setModelsBusy(true);
    setModelsError('');
    try {
      const result = await onExploreModels();
      setModels(result);
      setExplored(true);
    } catch (error) {
      setModelsError(String(error));
    } finally {
      setModelsBusy(false);
    }
  }
  const scheduledDate = schedule ? new Date(schedule) : null;
  const scheduleValid = !scheduledDate || !Number.isNaN(scheduledDate.valueOf());
  const scheduledISO = scheduledDate && scheduleValid ? scheduledDate.toISOString() : undefined;
  const selectedModelValid = !execution.modelSelection ||
    Boolean(execution.modelSelection.instanceId.trim() && execution.modelSelection.model.trim());
  const workspaceValid = execution.workspace === 'root' ||
    (!execution.branch || Boolean(execution.baseRef?.trim()));

  return (
    <dialog ref={dialogRef} className="modal task-editor-dialog" aria-label="Task editor"
      onCancel={onClose} onClose={onClose} onClick={event => handleDialogBackdrop(event, onClose)}>
      <div className="modal-heading">
        <h2>{task?.title ? 'Edit task' : 'New task'}</h2>
        <button type="button" className="icon-button" aria-label="Close task editor" onClick={onClose}>×</button>
      </div>
      <div className="modal-content">
        <label>
          Task title
          <input autoFocus maxLength={180} placeholder="Short, actionable task name"
            value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} />
        </label>
        <label>
          Agent prompt <span className="optional-label">Sent to T3 when queued</span>
          <textarea rows={4} placeholder="What should the coding agent do?"
            value={draft.prompt} onChange={e => setDraft({ ...draft, prompt: e.target.value })} />
        </label>
        <div className="task-execution-header">Execution settings <span className="muted">Saved with this task</span></div>
        <div className="task-config-pair">
          <label>
            Workspace
            <select value={execution.workspace} onChange={e => {
              const workspace = e.target.value as WorkspaceMode;
              setDraft(previous => ({
                ...previous,
                execution: { ...execution, workspace,
                  ...(workspace === 'root' ? { baseRef: undefined, branch: undefined } : {}) },
              }));
            }}>
              <option value="auto">Auto · isolated for Git</option>
              <option value="worktree">New worktree</option>
              <option value="root">Current checkout · serial</option>
            </select>
          </label>
          {execution.workspace !== 'root' && (
            <label>
              From branch / ref
              <input list="companion-git-refs" value={execution.baseRef || ''}
                placeholder={refsBusy ? 'Exploring branches…' : 'Current branch (default)'}
                onChange={e => setExecution({ baseRef: e.target.value || undefined })} />
              <datalist id="companion-git-refs">
                {refs.map(item => <option key={item.name} value={item.name}
                  label={item.isDefault ? 'Default' : item.current ? 'Current' : item.isRemote ? 'Remote' : 'Local'} />)}
              </datalist>
            </label>
          )}
        </div>
        {execution.workspace !== 'root' && (
          <div className="task-ref-row">
            <span className="muted">{refsBusy ? 'Loading Git refs from T3…' :
              refsError ? 'Branch discovery unavailable; enter a ref manually.' :
              refs.length ? refs.length + ' refs available' : 'No Git refs found'}</span>
            <button type="button" className="text-action"
              onClick={() => void toggleWorktreeExplorer()}>
              {showWorktrees ? 'Hide worktrees' : 'Explore worktrees'} ({inspectedWorktrees?.length ?? knownWorktrees.length})
            </button>
          </div>
        )}
        {showWorktrees && (
          <div className="task-discovery-panel" aria-label="Existing Git worktrees">
            <strong>Existing worktrees</strong>
            {worktreesBusy && <p className="muted">Inspecting execution host…</p>}
            {inspectedWorktrees !== null
              ? inspectedWorktrees.length ? inspectedWorktrees.map(item => (
                <div key={item.path} className="task-discovery-item">
                  <span>{item.branch || '(detached HEAD)'}{item.locked ? ' · locked' : ''}</span>
                  <small title={item.path}>{item.path}</small>
                </div>
              )) : <p className="muted">No worktrees found by Runner.</p>
              : knownWorktrees.length ? knownWorktrees.map(item => (
                <div key={item.worktreePath} className="task-discovery-item">
                  <span>{item.name}</span><small title={item.worktreePath || ''}>{item.worktreePath}</small>
                </div>
              )) : <p className="muted">No known worktrees for this project.</p>}
            {worktreesError && <p className="muted">Runner inspection unavailable: {worktreesError}. Showing T3 refs where available.</p>}
            <p className="muted">Read-only explorer. The standalone T3 CLI cannot safely attach an existing worktree yet.</p>
          </div>
        )}
        <div className="task-model-row">
          <label>
            Model
            <select value={customModel ? '__custom__' : selectedModel} onChange={e => {
              if (e.target.value === '__custom__') {
                setCustomModel(true);
                setExecution({ modelSelection: execution.modelSelection || { instanceId: '', model: '' } });
              } else {
                setCustomModel(false);
                const model = modelChoices.find(item =>
                  JSON.stringify([item.instanceId, item.model]) === e.target.value);
                setExecution({ modelSelection: model ? { instanceId: model.instanceId, model: model.model } : undefined });
              }
            }}>
              <option value="">Use T3 project default</option>
              {modelChoices.map(item => (
                <option key={item.instanceId + ':' + item.model}
                  value={JSON.stringify([item.instanceId, item.model])}>
                  {item.name} · {item.provider}
                </option>
              ))}
              <option value="__custom__">Other provider / model…</option>
            </select>
          </label>
          <button type="button" className="task-model-more" aria-expanded={modelMore}
            onClick={() => setModelMore(value => !value)}>More ···</button>
        </div>
        {modelMore && (
          <div className="task-discovery-panel">
            <div className="task-ref-row">
              <span className="muted">{explored ? models.length + ' configured models discovered' :
                'Discover provider models from this T3 environment'}</span>
              <button type="button" className="compact" disabled={modelsBusy} onClick={() => void discoverModels()}>
                {modelsBusy ? 'Exploring…' : 'Explore models'}
              </button>
            </div>
            {modelsError && <p role="alert" className="request-error">{modelsError}</p>}
            <button type="button" className="text-action" onClick={() => {
              setCustomModel(true);
              setExecution({ modelSelection: execution.modelSelection || { instanceId: '', model: '' } });
            }}>Enter model manually</button>
          </div>
        )}
        {customModel && (
          <div className="field-pair">
            <label>Provider instance ID
              <input value={execution.modelSelection?.instanceId || ''}
                onChange={e => setExecution({ modelSelection: {
                  instanceId: e.target.value, model: execution.modelSelection?.model || '',
                } })} />
            </label>
            <label>Model slug
              <input value={execution.modelSelection?.model || ''}
                onChange={e => setExecution({ modelSelection: {
                  instanceId: execution.modelSelection?.instanceId || '', model: e.target.value,
                } })} />
            </label>
          </div>
        )}
        <details className="advanced-options task-advanced">
          <summary>Advanced settings <span className="muted">Description, scheduling, priority, status</span></summary>
          <div className="task-advanced-content">
            <label>
              Description <span className="optional-label">Shown on the card</span>
              <textarea rows={2} placeholder="Context or acceptance criteria"
                value={draft.description || ''} onChange={e => setDraft({ ...draft, description: e.target.value })} />
            </label>
            {execution.workspace !== 'root' && (
              <label>New branch name <span className="optional-label">Optional · requires base ref</span>
                <input value={execution.branch || ''} placeholder="e.g. feat/task-123"
                  onChange={e => setExecution({ branch: e.target.value || undefined })} />
              </label>
            )}
            <label>Not before <span className="optional-label">Optional; applied when queued</span>
              <input type="datetime-local" value={schedule} onChange={e => setSchedule(e.target.value)} />
            </label>
            <div className="field-pair">
              <label>Priority
                <select value={draft.priority ?? 2}
                  onChange={e => setDraft({ ...draft, priority: Number(e.target.value) })}>
                  <option value="1">High</option><option value="2">Normal</option><option value="3">Low</option>
                </select>
              </label>
              <label>Status
                <select value={draft.status} onChange={e =>
                  setDraft({ ...draft, status: e.target.value as TaskStatus, statusOverride: true })}>
                  {BOARD_COLUMNS.map(c => <option key={c.key} value={c.key}>{c.name}</option>)}
                </select>
              </label>
            </div>
          </div>
        </details>
        {!workspaceValid && <p className="request-error">Select a base branch when naming the new branch.</p>}
      </div>
      <div className="modal-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary"
          disabled={busy || !draft.title.trim() || !draft.prompt.trim() ||
            !selectedModelValid || !workspaceValid || !scheduleValid}
          onClick={() => void onSave({
            ...draft, execution: {
              ...execution, ...(scheduledISO ? { notBefore: scheduledISO } : { notBefore: undefined }),
            },
          })}>Save task</button>
      </div>
    </dialog>
  );
}
