import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { activeTab, detectTab, isRecognizedTab } from '../bridge/t3-bridge';
import { checkLatestRelease, newerVersion, releasesPage, type LatestRelease } from '../shared/releases';
import '../shared/styles.css';
import './popup.css';

function Popup() {
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null);
  const [detected, setDetected] = useState(false);
  const [checking, setChecking] = useState(true);
  const [open, setOpen] = useState(false);
  const [release, setRelease] = useState<LatestRelease>(null);
  const [releaseStatus, setReleaseStatus] = useState('Not checked');
  const [error, setError] = useState('');
  const current = chrome.runtime.getManifest().version;
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const t = await activeTab();
        const recognized = await isRecognizedTab(t);
        if (!alive) return;
        setTab(t); setDetected(recognized);
        if (t.id) {
          await setPanelEnabled(t.id, recognized);
          const state = await chrome.storage.session.get(`open:${t.id}`);
          if (alive) setOpen(Boolean(state[`open:${t.id}`]));
        }
      } catch (e) { if (alive) setError(String(e)); }
      finally { if (alive) setChecking(false); }
    })();
    return () => { alive = false; };
  }, []);
  async function toggle() {
    if ((!detected && !open) || tab?.windowId === undefined) return;
    setError('');
    try {
      if (open) await chrome.sidePanel.close({ windowId: tab.windowId });
      else await chrome.sidePanel.open({ windowId: tab.windowId });
      setOpen(!open);
    } catch (e) { setError(String(e)); }
  }
  async function recheck() {
    if (!tab) return;
    setChecking(true); setError('');
    try {
      const recognized = await detectTab(tab);
      setDetected(recognized);
    } catch (e) { setError(String(e)); }
    finally { setChecking(false); }
  }
  async function check() {
    setError(''); setReleaseStatus('Checking...');
    try {
      const latest = await checkLatestRelease(); setRelease(latest);
      setReleaseStatus(latest ? (newerVersion(latest.version, current) ? `Update available: ${latest.version}` : `Latest release: ${latest.version}`) : 'No published GitHub release yet');
    } catch (e) { setReleaseStatus('Check failed'); setError(String(e)); }
  }
  return <main className="stack popup">
    <header className="row"><div><h1>T3 Companion</h1><p className="caption">Chromium management extension</p></div><span className="tag">v{current}</span></header>
    <div className="panel stack">
      <div className="row"><span>T3 Web</span><span className={`tag ${detected ? 'ok':'warn'}`}>{checking ? 'Checking…' : detected ? 'Detected' : 'Not detected'}</span></div>
      <p className="muted">{detected ? 'Dashboard available on this tab (including custom Cloudflare domains).' : 'Open T3 Code and verify the app page to enable the dashboard.'}</p>
      <div className="buttons"><button className="primary" disabled={(!detected && !open) || checking} onClick={() => void toggle()}>{open ? 'Close Side Panel' : 'Open Side Panel'}</button><button disabled={checking} onClick={() => void recheck()}>Recheck</button></div>
    </div>
    <div className="panel stack"><div className="row"><h2>Runner</h2><span className="tag">Via T3 RPC</span></div>
      <p className="muted">Open Overview in the Side Panel to inspect and manage the Runner installed on the T3 environment.</p></div>
    <div className="panel stack"><div className="row"><h2>Updates</h2><span className="caption">{releaseStatus}</span></div>
      <div className="buttons"><button onClick={() => void check()}>Check Updates</button><button onClick={() => void chrome.tabs.create({ url: release?.url || releasesPage })}>{release ? 'Download Release' : 'View Releases'}</button></div></div>
    {error && <p role="alert" className="notice">{error}</p>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Popup />);
