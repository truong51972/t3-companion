import React, { useRef } from 'react';
import type { Project } from '../../bridge/t3-bridge';
import type { SessionEnvironment } from '../../bridge/page-session';

export function Header({
  recognized,
  busy,
  tabUrl,
  manualTabId,
  tabChoices,
  sessionEnvironments,
  manualEnvironmentId,
  environmentLabel,
  projects,
  projectId,
  currentProject,
  page,
  onSelectTab,
  onSelectEnvironment,
  onSelectProject,
  onRefreshConnection,
  onSelectPage,
}: {
  recognized: boolean;
  busy: boolean;
  tabUrl: string;
  manualTabId: number | null;
  tabChoices: chrome.tabs.Tab[];
  sessionEnvironments: SessionEnvironment[];
  manualEnvironmentId: string;
  environmentLabel: string;
  projects: Project[];
  projectId: string;
  currentProject: Project | null;
  page: 'kanban' | 'overview';
  onSelectTab: (val: string) => Promise<void>;
  onSelectEnvironment: (val: string) => void;
  onSelectProject: (val: string) => void;
  onRefreshConnection: () => Promise<void>;
  onSelectPage: (p: 'kanban' | 'overview') => void;
}) {
  const connectionMenu = useRef<HTMLDetailsElement>(null);

  return (
    <>
      <header className="header">
        <div className="header-toolbar">
          <div className="brand">
            <span className="brand-mark">T3</span>
            <strong>Companion</strong>
          </div>
          <div className="header-actions">
            <span
              className={'connection ' + (recognized ? 'connected' : 'disconnected')}
              title={recognized ? 'T3 connected' : 'T3 offline'}
              aria-label={recognized ? 'T3 connected' : 'T3 offline'}
            >
              <span className="status-dot" />
            </span>
            <details className="connection-settings" ref={connectionMenu}>
              <summary
                className="icon-button"
                aria-label="Connection settings"
                title="Connection settings"
              >
                ⚙
              </summary>
              <div className="connection-menu">
                <label htmlFor="source-tab">
                  T3 Web session tab
                  <select
                    id="source-tab"
                    aria-label="T3 Web session tab"
                    disabled={busy}
                    value={manualTabId === null ? 'auto' : String(manualTabId)}
                    onChange={e => {
                      connectionMenu.current?.removeAttribute('open');
                      void onSelectTab(e.target.value);
                    }}
                  >
                    <option value="auto">Auto (active T3 tab)</option>
                    {tabChoices.map(tab => (
                      <option key={tab.id} value={tab.id}>
                        {new URL(tab.url!).host} · {tab.title?.slice(0, 38) || 'T3 Web'}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="runner-hint">
                  Uses the active T3 tab, or keeps the last connection when browsing other sites.
                  Select a tab here to override.
                </p>
                {recognized && (
                  <p className="runner-hint">
                    Connected via {tabUrl ? new URL(tabUrl).host : 'T3 Web'}
                  </p>
                )}
              </div>
            </details>
            <button
              className="icon-button"
              type="button"
              aria-label="Refresh T3 connection"
              title="Refresh connection"
              disabled={busy}
              onClick={() => void onRefreshConnection()}
            >
              ↻
            </button>
          </div>
        </div>
        <div className="context-row" role="group" aria-label="T3 workspace context">
          <label className="context-field" htmlFor="session-environment">
            <span>Environment</span>
            <select
              id="session-environment"
              aria-label="T3 session environment"
              disabled={busy || sessionEnvironments.length === 0}
              value={manualEnvironmentId || 'auto'}
              title={environmentLabel || 'Follow current T3 thread'}
              onChange={e => onSelectEnvironment(e.target.value === 'auto' ? '' : e.target.value)}
            >
              <option value="auto">
                {environmentLabel ? 'Current · ' + environmentLabel : 'Follow T3 thread'}
              </option>
              {sessionEnvironments.map(env => (
                <option key={env.environmentId} value={env.environmentId}>
                  {env.label} · {env.source === 'direct' ? 'Direct' : 'T3 session'}
                </option>
              ))}
            </select>
          </label>
          <label className="context-field" htmlFor="project">
            <span>Project</span>
            <select
              id="project"
              aria-label="Project"
              title={currentProject?.workspaceRoot || 'Select project'}
              value={projectId}
              disabled={busy || projects.length === 0}
              onChange={e => onSelectProject(e.target.value)}
            >
              {projects.length ? (
                projects.map(project => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))
              ) : (
                <option value="">No project</option>
              )}
            </select>
          </label>
        </div>
      </header>
      <nav className="section-tabs" aria-label="Companion sections">
        {(['kanban', 'overview'] as const).map(p => (
          <button
            type="button"
            key={p}
            className={p === page ? 'selected' : ''}
            aria-current={p === page ? 'page' : undefined}
            onClick={() => onSelectPage(p)}
          >
            {p === 'kanban' ? 'Board' : 'Overview'}
          </button>
        ))}
      </nav>
    </>
  );
}
