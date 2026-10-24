const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('northstar', {
  command: (action, value) => ipcRenderer.invoke('browser:command', action, value),
  state: () => ipcRenderer.invoke('browser:state'),
  on: (channel, callback) => {
    const allowed = ['tabs:changed', 'tab:active', 'tab:crashed', 'history:add', 'history:open', 'omnibox:focus', 'bookmark:toggle', 'media:toggle', 'find:open', 'find:result', 'downloads:open', 'home:open', 'profiles:changed', 'toast', 'download:started', 'download:progress', 'download:done'];
    if (allowed.includes(channel)) ipcRenderer.on(channel, (_event, value) => callback(value));
  }
});
