import { isT3Web } from '../shared/t3-site';

async function applyTab(tabId: number, url?: string): Promise<void> {
  if (!Number.isInteger(tabId) || tabId < 0) return;
  try { await chrome.sidePanel.setOptions({ tabId, path: 'sidepanel.html', enabled: isT3Web(url) }); }
  catch { /* Tab may have closed or sidePanel may be unavailable. */ }
}
async function initialize() {
  await chrome.sidePanel.setOptions({ enabled: false });
  for (const tab of await chrome.tabs.query({})) if (tab.id !== undefined) await applyTab(tab.id, tab.url);
}
chrome.runtime.onInstalled.addListener(() => { void initialize(); });
chrome.runtime.onStartup.addListener(() => { void initialize(); });
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url !== undefined || changeInfo.status === 'complete') void applyTab(tabId, tab.url);
});
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab) await applyTab(tabId, tab.url);
});
chrome.tabs.onRemoved.addListener((tabId) => { void chrome.storage.session.remove(`open:${tabId}`); });
chrome.sidePanel.onOpened.addListener(info => {
  if (info.tabId !== undefined) void chrome.storage.session.set({ [`open:${info.tabId}`]: true });
});
chrome.sidePanel.onClosed.addListener(info => {
  if (info.tabId !== undefined) void chrome.storage.session.set({ [`open:${info.tabId}`]: false });
});
