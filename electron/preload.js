const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pzAPI', {
  getAvailableInstances: () => ipcRenderer.invoke('get-available-instances'),
  selectCustomDirectory: () => ipcRenderer.invoke('select-custom-directory'),
  getServerConfig: (instanceName) => ipcRenderer.invoke('get-server-config', instanceName),
  addModToServer: (instanceName, workshopId, modId) => ipcRenderer.invoke('add-mod-to-server', { instanceName, workshopId, modId }),
  removeModFromServer: (instanceName, workshopId, modId) => ipcRenderer.invoke('remove-mod-from-server', { instanceName, workshopId, modId }),
  // App Config & Server Runner
  getAppConfig: () => ipcRenderer.invoke('get-app-config'),
  selectServerExe: () => ipcRenderer.invoke('select-server-exe'),
  startServer: (instanceName) => ipcRenderer.invoke('start-server', instanceName),
  stopServer: (instanceName) => ipcRenderer.invoke('stop-server', instanceName),
  getServerStates: () => ipcRenderer.invoke('get-server-states'),
  onServerLog: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('server-log', handler);
    return () => ipcRenderer.removeListener('server-log', handler);
  },
  onServerState: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('server-state', handler);
    return () => ipcRenderer.removeListener('server-state', handler);
  },

  // Files & Folders
  selectCustomFile: () => ipcRenderer.invoke('select-custom-file'),
  saveCustomFile: (filePath, content) => ipcRenderer.invoke('save-custom-file', { filePath, content }),

  // Live Map: tracker file
  selectPlayersFile: () => ipcRenderer.invoke('select-players-file'),
  setPlayersFile: (filePath) => ipcRenderer.invoke('set-players-file', filePath),
  stopPlayersWatcher: () => ipcRenderer.invoke('stop-players-watcher'),
  onPlayersUpdated: (callback) => {
    const handler = (_event, players) => callback(players);
    ipcRenderer.on('players-updated', handler);
    // Return cleanup function
    return () => ipcRenderer.removeListener('players-updated', handler);
  },
});
