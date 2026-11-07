import React, { useEffect, useMemo, useRef, useState } from 'react';
import { handleDialogBackdrop } from '../Common';
import {
  BOARD_COLUMNS, blankTask, type Task, type TaskStatus,
  type TaskModelSelection, type WorkspaceMode,
} from '../../../shared/domain-types';

function localDateTime(iso?: string) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function TaskEditorModal({
  open, task, availableModels, onClose, onSave, busy,
}: {
  open: boolean;
  task: Task | null;
  availableModels: TaskModelSelection[];
  onClose: () => void;
  onSave: (task: Task) => Promise<void>;
  busy: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Task>(task || blankTask());
  const [customModel, setCustomModel] = useState(false);
  const [schedule, setSchedule] = useState('');

  useEffect(() => {
    const next = task ? structuredClone(task) : blankTask();
    setDraft({ ...next, execution: next.execution || { workspace: 'auto' } });
    setSchedule(localDateTime(next.execution?.notBefore));
    const chosen = next.execution?.modelSelection;
    setCustomModel(Boolean(chosen && !availableModels.some(
      item => item.instanceId === chosen.instanceId && item.model === chosen.model
    )));
  }, [task, open]); // Models refresh when selecting a different project; opening resets editor.

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  const execution = draft.execution || { workspace: 'auto' as WorkspaceMode };
  const selectedModel = execution.modelSelection
    ? execution.modelSelection.instanceId + '\u0000' + execution.modelSelection.model
    : '';
  const modelChoices = useMemo(() => {
    const values = [...availableModels];
    if (execution.modelSelection && !values.some(item =>
      item.instanceId === execution.modelSelection?.instanceId &&
      item.model === execution.modelSelection?.model)) values.push(execution.modelSelection);
    return values;
  }, [availableModels, execution.modelSelection?.instanceId, execution.modelSelection?.model]);

  function setExecution(patch: Partial<NonNullable<Task['execution']>>) {
    setDraft(previous => ({
      ...previous,
      execution: { workspace: 'auto', ...previous.execution, ...patch },
    }));
  }
  const scheduledISO = schedule ? new Date(schedule).toISOString() : undefined;
  const selectedModelValid = !execution.modelSelection ||
    Boolean(execution.modelSelection.instanceId.trim() && execution.modelSelection.model.trim());
  const workspaceValid = execution.workspace === 'root' ||
    (!execution.branch || Boolean(execution.baseRef?.trim()));

  return (
    <dialog
      ref={dialogRef}
      className="modal task-editor-dialog"
      aria-label="Task editor"
      onCancel={onClose}
      onClose={onClose}
      onClick={event => handleDialogBackdrop(event, onClose)}
    >
      <div className="modal-heading">
        <h2>{task?.title ? 'Edit task' : 'New task'}</h2>
        <button type="button" className="icon-button" aria-label="Close task editor" onClick={onClose}>×</button>
      </div>
      <div className="modal-content">
        <label>
          Task Title
          <input autoFocus maxLength={180} placeholder="Short, actionable task name"
            value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} />
        </label>
        <label>
          Description <span className="optional-label">Optional · shown on the card</span>
          <textarea rows={2} placeholder="Context or acceptance criteria"
            value={draft.description || ''} onChange={e => setDraft({ ...draft, description: e.target.value })} />
        </label>
        <label>
          Agent Prompt <span className="optional-label">Sent to T3</span>
          <textarea rows={5} placeholder="What should the coding agent do?"
            value={draft.prompt} onChange={e => setDraft({ ...draft, prompt: e.target.value })} />
        </label>

        <div className="task-execution-header">Execution settings <span className="muted">Saved with this task</span></div>
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
            <option value="auto">Auto · isolated worktree for Git projects</option>
            <option value="worktree">New worktree</option>
            <option value="root">Current checkout · shared, serial</option>
          </select>
        </label>
        {execution.workspace !== 'root' && (
          <>
            <label>
              From branch / ref <span className="optional-label">Optional · empty uses current branch</span>
              <input value={execution.baseRef || ''} placeholder="e.g. origin/main"
                onChange={e => setExecution({ baseRef: e.target.value || undefined })} />
            </label>
            <label>
              New branch name <span className="optional-label">Optional · requires From branch</span>
              <input value={execution.branch || ''} placeholder="e.g. feat/task-123"
                onChange={e => setExecution({ branch: e.target.value || undefined })} />
            </label>
          </>
        )}
        <label>
          Model
          <select value={customModel ? '__custom__' : selectedModel}
            onChange={e => {
              if (e.target.value === '__custom__') {
                setCustomModel(true);
                setExecution({ modelSelection: execution.modelSelection || { instanceId: '', model: '' } });
              } else {
                setCustomModel(false);
                const model = modelChoices.find(item =>
                  item.instanceId + '\u0000' + item.model === e.target.value);
                setExecution({ modelSelection: model ? { ...model } : undefined });
              }
            }}>
            <option value="">Use T3 project default</option>
            {modelChoices.map(item => (
              <option key={item.instanceId + ':' + item.model} value={item.instanceId + '\u0000' + item.model}>
                {item.model} · {item.instanceId}
              </option>
            ))}
            <option value="__custom__">Other provider / model…</option>
          </select>
        </label>
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
        <p className="muted task-execution-help">
          Models shown are observed in this project's T3 sessions. Provider/model IDs must match T3.
          Reasoning effort and access mode currently inherit T3 defaults (the standalone T3 CLI
          does not expose per-thread overrides). Existing worktrees are not yet supported by the CLI.
        </p>
        <label>
          Not before <span className="optional-label">Optional · stored on task, not selected at queue time</span>
          <input type="datetime-local" value={schedule}
            onChange={e => setSchedule(e.target.value)} />
        </label>
        {!workspaceValid && <p className="request-error">Select a base branch when naming the new branch.</p>}
        <div className="field-pair">
          <label>
            Priority
            <select value={draft.priority ?? 2}
              onChange={e => setDraft({ ...draft, priority: Number(e.target.value) })}>
              <option value="1">High</option>
              <option value="2">Normal</option>
              <option value="3">Low</option>
            </select>
          </label>
          <label>
            Status
            <select value={draft.status}
              onChange={e => setDraft({ ...draft, status: e.target.value as TaskStatus, statusOverride: true })}>
              {BOARD_COLUMNS.map(c => <option key={c.key} value={c.key}>{c.name}</option>)}
            </select>
          </label>
        </div>
      </div>
      <div className="modal-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary"
          disabled={busy || !draft.title.trim() || !draft.prompt.trim() ||
            !selectedModelValid || !workspaceValid || Boolean(schedule && Number.isNaN(Date.parse(schedule)))}
          onClick={() => void onSave({
            ...draft, execution: {
              ...execution,
              ...(scheduledISO ? { notBefore: scheduledISO } : { notBefore: undefined }),
            },
          })}>Save task</button>
      </div>
    </dialog>
  );
}
