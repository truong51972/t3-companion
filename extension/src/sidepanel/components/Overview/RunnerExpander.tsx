import React, { useRef } from 'react';
import { Chevron, ServiceRefresh, ServiceMore } from '../Common';
import type { ParsedRunnerState } from '../../../shared/domain-types';

export function RunnerExpander({
  runner,
  runnerHostAvailable,
  runnerBusy,
  runnerAutoStart,
  runnerCacheAt,
  runnerStatusError,
  environmentId,
  busy,
  onManageRunner,
  onSetAutoStart,
  onConfirmReinstall,
}: {
  runner: ParsedRunnerState;
  runnerHostAvailable: boolean;
  runnerBusy: boolean;
  runnerAutoStart: boolean;
  runnerCacheAt: number | null;
  runnerStatusError: string;
  environmentId: string;
  busy: boolean;
  onManageRunner: (
    verb: 'install' | 'update' | 'reinstall' | 'status' | 'start' | 'stop' | 'add' | 'remove' | 'configure',
    target?: string
  ) => Promise<void>;
  onSetAutoStart: (enabled: boolean) => void;
  onConfirmReinstall: () => void;
}) {
  const runnerActionsMenu = useRef<HTMLDetailsElement>(null);
  const errorToShow = runnerStatusError || runner.error;

  const runnerInstalled = runner.installed;
  const runnerUpgradeRequired = runner.upgradeRequired;
  const runnerScanInterval = runner.scanIntervalMs;

  return (
    <details className="overview-expander">
      <summary><Chevron/><span className="overview-expander-title">Runner</span>
        <span
          className={
            'runner-state ' +
            (errorToShow
              ? 'error'
              : runner.running
              ? 'running'
              : runner.installed && !runner.running
              ? 'stopped'
              : '')
          }
          title={errorToShow || undefined}
        >
          {runner.label}
          {runnerCacheAt ? ' · Cached' : ''}
          {runner.pid && runner.running ? ' · PID ' + runner.pid : ''}
        </span>
      </summary>
      <div className="overview-expander-body">
        <div className="runner-section">
          {!runnerHostAvailable && (
            <p className="runner-hint">
              Open a T3 thread in this environment to manage its Runner.
            </p>
          )}
          {errorToShow && (
            <p className="runner-error" role="alert">
              Could not verify Runner: {errorToShow}
              {runnerCacheAt ? ' (showing last known status)' : ''}
            </p>
          )}
          {runner.installed && !runner.cliAvailable && (
            <div className="service-info service-info-upgrade" role="alert">
              <span>
                T3 CLI was not found on this environment host. Install the T3 CLI there or configure
                its executable path, then refresh Runner. Existing queued tasks are preserved.
              </span>
            </div>
          )}
          {runner.installed && runner.cliAvailable && runner.cliCommand && (
            <span className="runner-hint" title={runner.cliCommand}>
              CLI: {runner.cliCommand}
            </span>
          )}
          {runnerInstalled && (runnerUpgradeRequired || !runnerScanInterval) ? (
            <div className="service-info service-info-upgrade">
              <span>Runner installation is incomplete. Update to restore scheduler controls.</span>
              <button
                type="button"
                className="text-action"
                disabled={busy || runnerBusy || !runnerHostAvailable}
                onClick={() => void onManageRunner('update')}
              >
                Update
              </button>
            </div>
          ) : (
            runnerInstalled && (
              <div className="runner-config" role="group" aria-label="Runner scheduler settings">
                <label htmlFor="runner-max-concurrent">Max concurrent</label>
                <select
                  id="runner-max-concurrent"
                  aria-label="Max concurrent Runner tasks"
                  value={String(runner.maxConcurrent)}
                  disabled={busy || runnerBusy || !runnerHostAvailable || !runner.scanIntervalMs}
                  onChange={event => void onManageRunner('configure', event.target.value)}
                >
                  <option value="1">1 worker</option>
                  <option value="2">2 workers</option>
                  <option value="3">3 workers</option>
                </select>
                <span className="runner-config-meta">
                  Scan{' '}
                  {runner.scanIntervalMs
                    ? Math.round(runner.scanIntervalMs / 1000) + 's'
                    : '10s'}{' '}
                  · applies next cycle
                </span>
              </div>
            )
          )}
          {runner.installed && (
            <div className="service-facts" aria-label="Runner information">
              <div><span>Execution</span><strong>{runner.running ? 'Active' : 'Stopped'}{runner.pid && runner.running ? ' · PID ' + runner.pid : ''}</strong></div>
              <div><span>Version</span><strong>{runner.version ? runner.version.slice(0, 10) : 'Unversioned'}</strong></div>
              <div><span>Scheduler</span><strong>{runner.scanIntervalMs ? Math.round(runner.scanIntervalMs / 1000) + 's scan' : 'Unavailable'} · {runner.maxConcurrent} workers</strong></div>
              <div><span>Registered projects</span><strong>{runner.registeredProjects ?? 'Unknown'}</strong></div>
              <div><span>Last scan</span><strong>{runner.lastScanAt ? new Date(runner.lastScanAt).toLocaleTimeString() : 'Not observed'}</strong></div>
              <div><span>Active tasks / scan errors</span><strong>{runner.activeExecutions ?? '—'} / {runner.scanErrors ?? '—'}</strong></div>
              <div><span>Last verified</span><strong>{runnerCacheAt ? new Date(runnerCacheAt).toLocaleTimeString() + ' (cached)' : 'Current check'}</strong></div>
            </div>
          )}
          <div className="service-actions" aria-label="Runner controls">
            {!runner.installed && (
              <button
                className="primary"
                disabled={busy || runnerBusy || !runnerHostAvailable}
                onClick={() => void onManageRunner('install')}
              >
                Install & Start
              </button>
            )}
            {runner.installed &&
              !runner.starting &&
              !runner.running && (
                <button
                  className="primary"
                  disabled={busy || runnerBusy || !runnerHostAvailable}
                  onClick={() => void onManageRunner('start')}
                >
                  Start
                </button>
              )}
            <div className="service-tools">
              <ServiceRefresh service="Runner" refreshing={runnerBusy}
                disabled={busy || !runnerHostAvailable}
                onRefresh={() => void onManageRunner('status')}/>
              {runner.installed && (
                <ServiceMore service="Runner" menuRef={runnerActionsMenu}>
                  {runner.running && (
                    <button type="button"
                      disabled={busy || runnerBusy || runner.stopping || !runnerHostAvailable}
                      onClick={() => {
                        runnerActionsMenu.current?.removeAttribute('open');
                        void onManageRunner('stop');
                      }}>
                      {runner.stopping ? 'Stopping…' : 'Stop after active tasks'}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy || runnerBusy || !runnerHostAvailable}
                    onClick={() => {
                      runnerActionsMenu.current?.removeAttribute('open');
                      void onManageRunner('update');
                    }}
                  >
                    Update Runner
                  </button>
                  <button
                    type="button"
                    disabled={busy || runnerBusy || !runnerHostAvailable}
                    onClick={() => {
                      runnerActionsMenu.current?.removeAttribute('open');
                      onConfirmReinstall();
                    }}
                  >
                    Refresh checkout (git pull)
                  </button>
                  <div className="service-menu-divider" role="separator" />
                  <button
                    type="button"
                    disabled={busy || runnerBusy || !runnerHostAvailable}
                    onClick={() => {
                      runnerActionsMenu.current?.removeAttribute('open');
                      void onManageRunner('add');
                    }}
                  >
                    Register project
                  </button>
                  <button
                    type="button"
                    disabled={busy || runnerBusy || !runnerHostAvailable}
                    onClick={() => {
                      runnerActionsMenu.current?.removeAttribute('open');
                      void onManageRunner('remove');
                    }}
                  >
                    Unregister project
                  </button>
                  <label className="runner-autostart">
                    <input
                      type="checkbox"
                      checked={runnerAutoStart}
                      disabled={!environmentId}
                      onChange={event => onSetAutoStart(event.target.checked)}
                    />
                    <span>Auto-start when connected</span>
                  </label>
                  <details className="service-help">
                    <summary><Chevron/>Diagnostics</summary>
                    <p className="service-meta">
                      {runner.version
                        ? 'Build ' + runner.version.slice(0, 10)
                        : 'Unversioned installation'}
                      {runnerCacheAt
                        ? ' · Cached at ' + new Date(runnerCacheAt).toLocaleTimeString()
                        : ''}
                    </p>
                    <pre className="runner-result">{runner.raw}</pre>
                  </details>
                </ServiceMore>
              )}
            </div>
          </div>
        </div>
      </div>
    </details>
  );
}
