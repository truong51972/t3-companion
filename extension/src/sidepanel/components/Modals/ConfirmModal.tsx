import React, { useEffect, useRef } from 'react';
import { handleDialogBackdrop } from '../Common';

export interface ConfirmDialogState {
  title: string;
  description: string;
  confirmLabel: string;
  run: () => Promise<void>;
  dangerous?: boolean;
}

export function ConfirmModal({
  confirmation,
  onClose,
  busy,
}: {
  confirmation: ConfirmDialogState | null;
  onClose: () => void;
  busy: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (confirmation && !dialog.open) dialog.showModal();
    else if (!confirmation && dialog.open) dialog.close();
  }, [confirmation]);

  return (
    <dialog
      ref={dialogRef}
      className="modal confirm-dialog"
      aria-label="Confirm action"
      onCancel={onClose}
      onClose={onClose}
      onClick={event => handleDialogBackdrop(event, onClose)}
    >
      <div className="modal-heading">
        <div>
          <h2>{confirmation?.title}</h2>
        </div>
        <button type="button" className="icon-button" aria-label="Cancel action" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="modal-content">
        <p className="modal-intro">{confirmation?.description}</p>
      </div>
      <div className="modal-actions">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={confirmation?.dangerous ? 'danger-action' : 'primary'}
          disabled={busy}
          onClick={() => {
            const next = confirmation?.run;
            onClose();
            if (next) void next();
          }}
        >
          {confirmation?.confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

export function ClearBrowserDataModal({
  open,
  onClose,
  onClear,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onClear: () => Promise<void>;
  busy: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="modal confirm-dialog"
      aria-label="Clear browser data"
      onCancel={onClose}
      onClose={onClose}
      onClick={event => handleDialogBackdrop(event, onClose)}
    >
      <div className="modal-heading">
        <div>
          <h2>Clear Companion browser data?</h2>
          <p className="muted">This cannot be undone.</p>
        </div>
        <button className="icon-button" aria-label="Close confirmation" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="modal-content">
        <p className="modal-intro">
          This removes saved UI preferences, environment/project selections, recognized host list and
          cached statuses. It does not delete project files, Runner, Agent Skill, T3 threads or T3
          cookies.
        </p>
      </div>
      <div className="modal-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="danger-action" disabled={busy} onClick={() => void onClear()}>
          Clear data
        </button>
      </div>
    </dialog>
  );
}
