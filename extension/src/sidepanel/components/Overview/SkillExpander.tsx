import React, { useRef } from 'react';
import { Chevron, ServiceRefresh, ServiceMore } from '../Common';
import { SKILL_PATH } from '../../../shared/skill-shell';

export type SkillState = 'checking' | 'installed' | 'not_installed' | 'unavailable' | 'error';

export function SkillExpander({
  skillState,
  skillBusy,
  skillError,
  skillCacheAt,
  runnerHostAvailable,
  tabId,
  environmentId,
  currentProjectRoot,
  recognized,
  busy,
  onManageSkill,
  onConfirmReinstall,
}: {
  skillState: SkillState;
  skillBusy: boolean;
  skillError: string;
  skillCacheAt: number | null;
  runnerHostAvailable: boolean;
  tabId: number | null;
  environmentId: string;
  currentProjectRoot?: string;
  recognized: boolean;
  busy: boolean;
  onManageSkill: (verb: 'status' | 'install' | 'update' | 'reinstall') => Promise<void>;
  onConfirmReinstall: () => void;
}) {
  const skillActionsMenu = useRef<HTMLDetailsElement>(null);

  const statusLabel =
    skillState === 'installed'
      ? 'Installed'
      : skillState === 'not_installed'
      ? 'Not installed'
      : skillState === 'checking'
      ? 'Checking…'
      : skillState === 'error'
      ? 'Error'
      : 'Unavailable';

  return (
    <details className="overview-expander">
      <summary><Chevron/><span className="overview-expander-title">Agent Skill</span>
        <span
          className={'skill-state ' + (skillState === 'installed' ? 'installed' : '')}
          title={
            skillCacheAt
              ? 'Cached · Last verified ' + new Date(skillCacheAt).toLocaleTimeString()
              : undefined
          }
        >
          {statusLabel}
        </span>
      </summary>
      <div className="overview-expander-body">
        <div className="service-facts" aria-label="Agent Skill information">
          <div><span>Scope</span><strong>Selected project</strong></div>
          <div><span>Location</span><strong title={currentProjectRoot ? currentProjectRoot + '/' + SKILL_PATH : undefined}>{SKILL_PATH}</strong></div>
          <div><span>Commands</span><strong>List · Show · Add · Set · Queue · Remove</strong></div>
          <div><span>Last verified</span><strong>{skillCacheAt ? new Date(skillCacheAt).toLocaleTimeString() + ' (cached)' : skillState === 'checking' ? 'Checking…' : 'Current check'}</strong></div>
        </div>
        {skillError && (
          <p className="runner-error" role="alert">
            {skillError}
          </p>
        )}
        <div className="service-actions" aria-label="Agent Skill controls">
          {skillState !== 'installed' && (
            <button
              className="primary"
              disabled={busy || skillBusy || !runnerHostAvailable || skillState === 'checking'}
              onClick={() => void onManageSkill('install')}
            >
              {skillBusy ? 'Installing…' : 'Install Skill'}
            </button>
          )}
          <div className="service-tools">
            <ServiceRefresh service="Agent Skill" refreshing={skillBusy || skillState === 'checking'}
              disabled={busy || !tabId || !environmentId || !currentProjectRoot || !recognized}
              onRefresh={() => void onManageSkill('status')}/>
            {skillState === 'installed' && (
              <ServiceMore service="Agent Skill" menuRef={skillActionsMenu}>
                <button
                  type="button"
                  disabled={busy || skillBusy || !runnerHostAvailable}
                  onClick={() => {
                    skillActionsMenu.current?.removeAttribute('open');
                    void onManageSkill('update');
                  }}
                >
                  Update Skill
                </button>
                <button
                  type="button"
                  disabled={busy || skillBusy || !runnerHostAvailable}
                  onClick={() => {
                    skillActionsMenu.current?.removeAttribute('open');
                    onConfirmReinstall();
                  }}
                >
                  Re-install Skill
                </button>
              </ServiceMore>
            )}
          </div>
        </div>
        {skillState !== 'installed' && (
          <details className="service-help">
            <summary><Chevron/>Manual setup</summary>
            <p className="runner-hint">
              Installs into the selected project via npx skills. Requires Node.js 22.20+ and an open
              T3 thread for one-click setup.
            </p>
            <code className="skill-command">
              npx skills add truong51972/t3-companion --skill t3-companion -y
            </code>
          </details>
        )}
      </div>
    </details>
  );
}
