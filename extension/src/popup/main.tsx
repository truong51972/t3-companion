import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { isT3Web } from '../shared/t3-site';
import { checkLatestRelease, newerVersion, releasesPage, type LatestRelease } from '../shared/releases';
import '../shared/styles.css';
import './popup.css';

function Popup() {
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null);
  const [open, setOpen] = useState(false);
  const [release, setRelease] = useState<LatestRelease>(null);
  const [releaseStatus, setReleaseStatus] = useState('Not checked');
  const [error, setError] = useState('');
  const current = chrome.runtime.getManifest().version;
  const detected = isT3Web(tab?.url);
  useEffect(() => {
    let alive = true;
    void chrome.tabs.query({ active: true, currentWindow: true }).then(async ([active]) => {
      if (!alive) return;
      setTab(active || null);
      if (active?.id !== undefined) {
        const state = await chrome.storage.session.get(`open:${active.id}`);
        if (alive) setOpen(Boolean(state[`open:${active.id}`]));
      }
    });
    return () => { alive = false; };
  }, []);
  async function toggle() {
    if (!detected || tab?.id === undefined) return;
    setError('');
    try {
      if (open) await chrome.sidePanel.close({ tabId: tab.id });
      else {
        await chrome.sidePanel.setOptions({ tabId: tab.id, path: 'sidepanel.html', enabled: true });
        await chrome.sidePanel.open({ tabId: tab.id });
      }
      setOpen(!open);
    } catch (e) { setError(String(e)); }
  }
  async function check() {
    setError(''); setReleaseStatus('Checking...');
    try {
      const latest = await checkLatestRelease(); setRelease(latest);
      setReleaseStatus(latest ? (newerVersion(latest.version, current) ? `Update available: ${latest.version}` : `Latest release: ${latest.version}`) : 'No published GitHub release yet');
    } catch (e) { setReleaseStatus('Check failed'); setError(String(e)); }
  }
  return <main className="stack popup">
    <header className="row"><div><h1>T3 Companion</h1><p className="caption">Browser management UI</p></div><span className="tag">v{current}</span></header>
    <div className="panel stack"><div className="row"><span>T3 Web</span><span className={`tag ${detected ? 'ok':'warn'}`}>{detected ? 'Detected' : 'Not detected'}</span></div>
      <p className="muted">{detected ? 'Side Panel available on this tab.' : 'Open T3 Web to enable the dashboard.'}</p>
      <button className="primary" disabled={!detected} onClick={() => void toggle()}>{open ? 'Close Side Panel' : 'Open Side Panel'}</button></div>
    <div className="panel stack"><div className="row"><h2>Runner</h2><span className="tag">Not connected</span></div>
      <p className="muted">Runner status will be available after the authenticated T3 RPC bridge is verified.</p></div>
    <div className="panel stack"><div className="row"><h2>Updates</h2><span className="caption">{releaseStatus}</span></div>
      <div className="buttons"><button onClick={() => void check()}>Check Updates</button><button onClick={() => void chrome.tabs.create({ url: release?.url || releasesPage })}>{release ? 'Download Release' : 'View Releases'}</button></div></div>
    {error && <p role="alert" className="notice">{error}</p>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Popup />);
