/**
 * Use one window-scoped panel so Edge doesn't recreate the React app when the
 * active tab changes. Connection discovery remains restricted to verified T3 tabs.
 */
async function initialize() {
  const options = await chrome.sidePanel.getOptions({});
  if (!options.enabled || options.path !== 'sidepanel.html') {
    await chrome.sidePanel.setOptions({ enabled: true, path: 'sidepanel.html' });
  }
}
chrome.runtime.onInstalled.addListener(() => { void initialize(); });
chrome.runtime.onStartup.addListener(() => { void initialize(); });
chrome.sidePanel.onOpened.addListener(info => {
  void chrome.storage.session.set({ [`open:window:${info.windowId}`]: true });
});
chrome.sidePanel.onClosed.addListener(info => {
  void chrome.storage.session.set({ [`open:window:${info.windowId}`]: false });
});
