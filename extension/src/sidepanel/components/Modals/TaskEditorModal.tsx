import React, { useEffect, useRef, useState } from 'react';
import { handleDialogBackdrop } from '../Common';
import { BOARD_COLUMNS, blankTask, type Task, type TaskStatus } from '../../../shared/domain-types';

export function TaskEditorModal({
  open,
  task,
  onClose,
  onSave,
  busy,
}: {
  open: boolean;
  task: Task | null;
  onClose: () => void;
  onSave: (task: Task) => Promise<void>;
  busy: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Task>(task || blankTask());

  useEffect(() => {
    if (task) setDraft(structuredClone(task));
    else setDraft(blankTask());
  }, [task, open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

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
        <button type="button" className="icon-button" aria-label="Close task editor" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="modal-content">
        <label>
          Task Title
          <input
            autoFocus
            maxLength={180}
            placeholder="Short, actionable task name"
            value={draft.title}
            onChange={e => setDraft({ ...draft, title: e.target.value })}
          />
        </label>
        <label>
          Description <span className="optional-label">Optional · shown on the card</span>
          <textarea
            rows={2}
            placeholder="Context or acceptance criteria"
            value={draft.description || ''}
            onChange={e => setDraft({ ...draft, description: e.target.value })}
          />
        </label>
        <label>
          Agent Prompt <span className="optional-label">Sent to T3; separate from task title</span>
          <textarea
            rows={7}
            placeholder="Tell the coding agent what to investigate, change and verify…"
            value={draft.prompt}
            onChange={e => setDraft({ ...draft, prompt: e.target.value })}
          />
        </label>
        <div className="field-pair">
          <label>
            Priority
            <select
              value={draft.priority ?? 2}
              onChange={e => setDraft({ ...draft, priority: Number(e.target.value) })}
            >
              <option value="1">High</option>
              <option value="2">Normal</option>
              <option value="3">Low</option>
            </select>
          </label>
          <label>
            Status
            <select
              value={draft.status}
              onChange={e =>
                setDraft({ ...draft, status: e.target.value as TaskStatus, statusOverride: true })
              }
            >
              {BOARD_COLUMNS.map(c => (
                <option key={c.key} value={c.key}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="modal-actions">
        <button onClick={onClose}>Cancel</button>
        <button
          className="primary"
          disabled={busy || !draft.title.trim() || !draft.prompt.trim()}
          onClick={() => void onSave(draft)}
        >
          Save task
        </button>
      </div>
    </dialog>
  );
}
