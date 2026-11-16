// Only the local setup page can connect; pages from the server get a single harmless call: bring this window forward
// (clicking a Windows notification while the app sits in the tray).
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('setup', {
    connect: (address) => ipcRenderer.invoke('setup:connect', address),
    retry: () => ipcRenderer.invoke('setup:retry')
  });
}

contextBridge.exposeInMainWorld('sttDesktop', { show: () => ipcRenderer.send('window:show') });
