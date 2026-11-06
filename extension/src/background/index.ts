import { isT3Web } from '../shared/t3-site';
async function applyTab(tabId: number, raw?: string) {
  if (!raw || !Number.isInteger(tabId) || tabId < 0) return;
  try {
    const { verifiedOrigins = [] } = await chrome.storage.local.get('verifiedOrigins');
    const origin = new URL(raw).origin;
    const enabled = isT3Web(raw) || (verifiedOrigins as string[]).includes(origin);
    await chrome.sidePanel.setOptions({ tabId, path: 'sidepanel.html', enabled });
  } catch { /* closed tab or forbidden URL */ }
}
async function initialize() {
  await chrome.sidePanel.setOptions({ enabled: false });
  for (const tab of await chrome.tabs.query({})) if (tab.id !== undefined) await applyTab(tab.id, tab.url);
}
chrome.runtime.onInstalled.addListener(() => { void initialize(); });
chrome.runtime.onStartup.addListener(() => { void initialize(); });
chrome.tabs.onUpdated.addListener((id, changes, tab) => {
  if (changes.url || changes.status === 'complete') void applyTab(id, tab.url);
});
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab) await applyTab(tabId, tab.url);
});
chrome.tabs.onRemoved.addListener(id => { void chrome.storage.session.remove(`open:${id}`); });
chrome.sidePanel.onOpened.addListener(info => {
  if (info.tabId !== undefined) void chrome.storage.session.set({ [`open:${info.tabId}`]: true });
});
chrome.sidePanel.onClosed.addListener(info => {
  if (info.tabId !== undefined) void chrome.storage.session.set({ [`open:${info.tabId}`]: false });
});
