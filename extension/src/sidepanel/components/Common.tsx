import React from 'react';

/** One consistent chevron for all expandable controls. CSS owns orientation. */
export function Chevron({ className = '' }: { className?: string }) {
  return <svg className={'disclosure-chevron ' + className} aria-hidden="true"
    viewBox="0 0 24 24" width="14" height="14" fill="none"
    stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="m6 9 6 6 6-6"/>
  </svg>;
}

/** A single refresh control for both services, including consistent busy feedback. */
export function ServiceRefresh({
  service,
  disabled,
  refreshing,
  onRefresh,
}: {
  service: 'Runner' | 'Agent Skill';
  disabled: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <button
      type="button"
      className={'service-refresh' + (refreshing ? ' is-refreshing' : '')}
      aria-label={`Refresh ${service} status`}
      title={`Refresh ${service} status`}
      aria-busy={refreshing}
      disabled={disabled || refreshing}
      onClick={onRefresh}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 11a8 8 0 1 0-2.4 5.7M20 4v7h-7"/>
      </svg>
    </button>
  );
}

/** Secondary service operations stay out of the main action row. */
export function ServiceMore({
  service,
  menuRef,
  children,
}: {
  service: 'Runner' | 'Agent Skill';
  menuRef: React.RefObject<HTMLDetailsElement | null>;
  children: React.ReactNode;
}) {
  return (
    <details className="service-more" ref={menuRef}>
      <summary aria-label={`More ${service} actions`} title={`More ${service} actions`}>
        <span aria-hidden="true">···</span>
      </summary>
      <div className="service-menu">{children}</div>
    </details>
  );
}

export function handleDialogBackdrop(
  event: React.MouseEvent<HTMLDialogElement>,
  close: () => void
) {
  if (event.target !== event.currentTarget) return;
  const rect = event.currentTarget.getBoundingClientRect();
  if (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  ) {
    close();
  }
}
