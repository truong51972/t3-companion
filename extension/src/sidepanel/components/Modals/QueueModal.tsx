import React, { useEffect, useRef, useState } from 'react';
import { Chevron, handleDialogBackdrop } from '../Common';
import type { Task, WorkspaceMode } from '../../../shared/domain-types';

export function QueueModal({
  open,
  task,
  runnerRunning,
  initialWorkspaceMode = 'auto',
  initialWorktree = '',
  onClose,
  onQueue,
  busy,
}: {
  open: boolean;
  task: Task | null;
  runnerRunning: boolean;
  initialWorkspaceMode?: WorkspaceMode;
  initialWorktree?: string;
  onClose: () => void;
  onQueue: (task: Task, mode: WorkspaceMode, worktree: string, schedule: string) => Promise<void>;
  busy: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(initialWorkspaceMode);
  const [worktree, setWorktree] = useState(initialWorktree);
  const [schedule, setSchedule] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setWorkspaceMode(initialWorkspaceMode);
      setWorktree(initialWorktree);
      setSchedule('');
      setAdvancedOpen(false);
    }
  }, [open, initialWorkspaceMode, initialWorktree]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="modal queue-dialog"
      aria-label="Queue execution"
      onCancel={onClose}
      onClose={onClose}
      onClick={event => handleDialogBackdrop(event, onClose)}
    >
      <div className="modal-heading">
        <div>
          <h2>Queue execution</h2>
          <p className="muted">{task?.title}</p>
        </div>
        <button type="button" className="icon-button" aria-label="Close execution dialog" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="modal-content">
        <p className="modal-intro">
          This creates an execution request. The task title stays on the Board; only its Agent Prompt
          is sent to T3.
        </p>
        {!runnerRunning && (
          <p className="queue-warning">
            Runner is not confirmed running in this environment. Requests remain queued until Runner
            starts and the project is registered.
          </p>
        )}
        <label>
          Workspace
          <select
            value={workspaceMode}
            onChange={e => setWorkspaceMode(e.target.value as WorkspaceMode)}
          >
            <option value="auto">Auto · isolated worktree for Git projects</option>
            <option value="worktree">Always create worktree</option>
            <option value="root">Shared project checkout (serial)</option>
          </select>
        </label>
        <details
          className="advanced-options"
          open={advancedOpen}
          onToggle={event => setAdvancedOpen(event.currentTarget.open)}
        >
          <summary>Advanced options<Chevron/></summary>
          <div className="advanced-fields">
            {workspaceMode !== 'root' && (
              <label>
                Base branch (optional)
                <input
                  placeholder="Auto-detect current Git branch"
                  value={worktree}
                  onChange={e => setWorktree(e.target.value)}
                />
              </label>
            )}
            <label>
              Not before (optional)
              <input
                type="datetime-local"
                value={schedule}
                onChange={e => setSchedule(e.target.value)}
              />
            </label>
          </div>
        </details>
      </div>
      <div className="modal-actions">
        <button onClick={onClose}>Cancel</button>
        <button
          className="primary"
          disabled={busy || !task}
          onClick={() => {
            if (task) void onQueue(task, workspaceMode, worktree, schedule);
          }}
        >
          Queue request
        </button>
      </div>
    </dialog>
  );
}
