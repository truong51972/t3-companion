import React, { useEffect, useRef } from 'react';
import { handleDialogBackdrop } from '../Common';
import { getTaskColumn, type Task, type RuntimeDocument } from '../../../shared/domain-types';

export function TaskDetailsModal({
  task,
  runtime,
  tabUrl,
  environmentId,
  environmentThreadUrl,
  onClose,
  onEdit,
  onDelete,
  onQueue,
  onOpenThread,
  busy,
}: {
  task: Task | null;
  runtime: RuntimeDocument;
  tabUrl: string;
  environmentId: string;
  environmentThreadUrl: (tabUrl: string, envId: string, threadId: string) => string | null;
  onClose: () => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onQueue: (task: Task) => void;
  onOpenThread: (threadId: string) => Promise<boolean>;
  busy: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (task && !dialog.open) dialog.showModal();
    else if (!task && dialog.open) dialog.close();
  }, [task]);

  if (!task) return null;

  const requests = [...(task.executionRequests || [])].reverse().map(request => ({
    request,
    execution: runtime.requests[request.requestId],
  }));

  const linkedThreadId = requests
    .map(item => item.execution?.threadId)
    .find((id): id is string => typeof id === 'string' && id.length > 0);

  const threadUrl = (threadId: string) => environmentThreadUrl(tabUrl, environmentId, threadId);
  const activeLinkedUrl = linkedThreadId ? threadUrl(linkedThreadId) : null;

  return (
    <dialog
      ref={dialogRef}
      className="modal task-details-dialog"
      aria-label="Task details"
      onCancel={onClose}
      onClose={onClose}
      onClick={event => handleDialogBackdrop(event, onClose)}
    >
      <div className="modal-heading">
        <div>
          <h2>{task.title || 'Task details'}</h2>
          <p className="muted">
            {getTaskColumn(task, runtime).replaceAll('_', ' ')} · Priority {task.priority || 2}
          </p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close task details"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="modal-content">
        {task.description && (
          <div className="detail-field">
            <strong>Description</strong>
            <p>{task.description}</p>
          </div>
        )}
        <div className="detail-field">
          <strong>Agent Prompt</strong>
          <p className="task-prompt">{task.prompt}</p>
        </div>
        <div className="detail-field">
          <strong>Execution settings</strong>
          <p className="task-execution-summary">
            Workspace: {task.execution?.workspace === 'root' ? 'Current checkout'
              : task.execution?.workspace === 'worktree' ? 'New worktree'
              : 'Auto worktree'}
            {task.execution?.baseRef ? ' · From ' + task.execution.baseRef : ''}
            {task.execution?.branch ? ' · Branch ' + task.execution.branch : ''}
          </p>
          <p className="task-execution-summary">
            Model: {task.execution?.modelSelection
              ? task.execution.modelSelection.model + ' (' + task.execution.modelSelection.instanceId + ')'
              : 'T3 project default'}
          </p>
          {task.execution?.notBefore && (
            <p className="task-execution-summary">
              Not before: {new Date(task.execution.notBefore).toLocaleString()}
            </p>
          )}
        </div>
        <div className="detail-field">
          <strong>Execution history</strong>
          {!task.executionRequests?.length && (
            <p className="muted">No execution requested yet.</p>
          )}
          {requests.map(({ request, execution }) => {
            const url = execution?.threadId ? threadUrl(execution.threadId) : null;
            return (
              <div className="request-row" key={request.requestId}>
                <div className="request-info">
                  <span className="execution-status">
                    {execution?.workflowStage === 'human_review'
                      ? 'Human review'
                      : execution?.workflowStage?.replaceAll('_', ' ') ||
                        execution?.status?.replaceAll('_', ' ') ||
                        (request.execution.notBefore ? 'scheduled / queued' : 'queued')}
                  </span>
                  {execution?.pendingRequestCount ? (
                    <span className="request-error">
                      Waiting for {execution.pendingRequestCount} answer(s) in T3
                    </span>
                  ) : null}
                  {execution?.changeRequests?.map(pr => (
                    <a key={pr.url} href={pr.url} target="_blank" rel="noopener noreferrer">
                      {pr.url} · {pr.state}
                    </a>
                  ))}
                  {request.execution && (
                    <span className="muted">
                      {request.execution.workspace === 'root' ? 'Current checkout' : 'Worktree'}
                      {request.execution.baseRef ? ' · From ' + request.execution.baseRef : ''}
                      {request.execution.branch ? ' · ' + request.execution.branch : ''}
                      {request.execution.modelSelection ? ' · ' + request.execution.modelSelection.model : ''}
                    </span>
                  )}
                  {request.execution.notBefore && (
                    <span className="muted">
                      Not before: {new Date(request.execution.notBefore).toLocaleString()}
                    </span>
                  )}
                  {execution?.error && <span className="request-error">{execution.error}</span>}
                </div>
                {execution?.threadId && url && (
                  <button className="compact" onClick={() => void onOpenThread(execution.threadId!)}>
                    Open thread ↗
                  </button>
                )}
                {execution?.threadId && !url && (
                  <span className="muted" title={execution.threadId}>
                    Thread linked
                  </span>
                )}
              </div>
            );
          })}
          {linkedThreadId && !activeLinkedUrl && (
            <p className="muted">
              This thread cannot be opened safely from the selected environment.
            </p>
          )}
          {requests.some(
            ({ execution }) => execution?.status === 'dispatching' && !execution.threadId
          ) && (
            <p className="muted">
              Runner records a thread ID after the T3 CLI returns. An active execution may not have a link yet.
            </p>
          )}
        </div>
      </div>
      <div className="modal-actions">
        <details className="task-detail-more">
          <summary aria-label="More task actions" title="More task actions">•••</summary>
          <div className="task-detail-menu">
            <button className="danger-action" type="button" onClick={() => {
              onClose();
              onDelete(task);
            }}>Delete task…</button>
          </div>
        </details>
        {linkedThreadId && activeLinkedUrl && (
          <button onClick={() => void onOpenThread(linkedThreadId)}>Open T3 thread ↗</button>
        )}
        <button
          onClick={() => {
            onClose();
            onEdit(task);
          }}
        >
          Edit
        </button>
        <button
          className="primary"
          disabled={busy}
          onClick={() => {
            onClose();
            onQueue(task);
          }}
        >
          Queue execution
        </button>
      </div>
    </dialog>
  );
}
