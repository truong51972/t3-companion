import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { isT3Web } from '../shared/t3-site';
import '../shared/styles.css';
import './sidepanel.css';

type Section = 'board' | 'sessions' | 'runner';
const columns = [{ key: 'todo', name: 'To Do' }, { key: 'in_progress', name: 'In Progress' }, { key: 'review', name: 'Review' }, { key: 'done', name: 'Done' }];
function SidePanel() {
  const [section, setSection] = useState<Section>('board');
  const [location, setLocation] = useState('');
  const detected = isT3Web(location);
  useEffect(() => {
    let mounted = true;
    const refresh = async () => { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); if (mounted) setLocation(tab?.url || ''); };
    void refresh();
    const changed = () => void refresh();
    chrome.tabs.onActivated.addListener(changed);
    chrome.tabs.onUpdated.addListener(changed);
    return () => { mounted = false; chrome.tabs.onActivated.removeListener(changed); chrome.tabs.onUpdated.removeListener(changed); };
  }, []);
  return <main className="stack sidepanel">
    <header className="panel stack header"><div className="row"><div><h1>T3 Companion</h1><p className="caption">Workspace dashboard</p></div><span className={`tag ${detected ? 'ok':'warn'}`}>{detected ? 'T3 Web' : 'Inactive'}</span></div>
      <div className="row"><span className="muted">Environment</span><span className="tag">Not linked</span></div>
      <div className="row"><span className="muted">Project</span><span className="tag">Select via T3 RPC</span></div></header>
    <nav className="nav" aria-label="Dashboard sections">{([['board','Kanban'],['sessions','Sessions'],['runner','Runner']] as const).map(([key,label]) => <button className={section === key ? 'selected' : ''} onClick={() => setSection(key)} key={key}>{label}</button>)}</nav>
    {!detected ? <div className="notice">Open a supported T3 Web tab to use the Companion panel.</div> : <>
      <div className="notice"><strong>T3 RPC bridge pending verification.</strong> This build deliberately does not read browser credentials, modify the T3 page, or connect to a separate local HTTP service. Management actions will be enabled only after P1 is validated.</div>
      {section === 'board' && <section className="stack"><div className="row"><h2>Kanban</h2><button disabled title="Requires authenticated project filesystem RPC">+ Task</button></div>
        <div className="board">{columns.map(col => <div className="lane" key={col.key}><div className="row"><strong>{col.name}</strong><span className="caption">—</span></div><p className="caption">Awaiting project connection</p></div>)}</div></section>}
      {section === 'sessions' && <section className="panel stack"><h2>Sessions</h2><p className="muted">T3 session list and start/send actions will use orchestration RPC when the bridge has been validated.</p><button disabled>Start Session</button></section>}
      {section === 'runner' && <section className="panel stack"><h2>Runner Control</h2><div className="row"><span className="muted">Runner</span><span className="tag">Unknown</span></div><p className="muted">Start/stop and project registration will run through T3 Terminal RPC, never direct HTTP.</p><div className="buttons"><button disabled>Start</button><button disabled>Stop</button><button disabled>Add Project</button></div></section>}
    </>}
    <footer className="caption">T3 Companion · browser UI / local runner / T3 Code</footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<SidePanel />);
