import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { spawn } from 'child_process';
import { PZIniParser } from './iniParser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let customDir = null;
let serverExePath = null;
const runningServers = {};

const getConfigPath = () => path.join(app.getPath('userData'), 'pzsm-config.json');

const loadAppConfig = () => {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (data.customDir) customDir = data.customDir;
      if (data.serverExePath) serverExePath = data.serverExePath;
    }
  } catch (err) {
    console.error("Error loading app config:", err);
  }
};

const saveAppConfig = () => {
  try {
    fs.writeFileSync(getConfigPath(), JSON.stringify({ customDir, serverExePath }), 'utf8');
  } catch (err) {
    console.error("Error saving app config:", err);
  }
};

const getZomboidServerDir = () => {
  if (customDir && fs.existsSync(customDir)) {
    return customDir;
  }
  return path.join(process.env.USERPROFILE || process.env.HOME, 'Zomboid', 'Server');
};

const getIniPath = (instanceName) => {
  if (!instanceName) return null;
  return path.join(getZomboidServerDir(), `${instanceName}.ini`);
};

// ... existing createWindow and app.whenReady logic remains the same ...
const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#121212',
      symbolColor: '#ffffff',
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
    },
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
};

app.whenReady().then(() => {
  loadAppConfig();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// --- IPC Handlers ---
ipcMain.handle('select-custom-directory', async (event) => {
  const window = BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = await dialog.showOpenDialog(window, {
    properties: ['openDirectory'],
    title: 'Select Project Zomboid Server Configuration Folder',
    buttonLabel: 'Select Folder'
  });

  if (!canceled && filePaths.length > 0) {
    customDir = filePaths[0];
    saveAppConfig();
    return customDir;
  }
  return null;
});

ipcMain.handle('get-app-config', async () => {
  return { customDir, serverExePath };
});

ipcMain.handle('select-server-exe', async (event) => {
  const window = BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = await dialog.showOpenDialog(window, {
    properties: ['openFile'],
    title: 'Select Server Executable (StartServer64.bat)',
    filters: [{ name: 'Batch Files', extensions: ['bat', 'cmd'] }]
  });

  if (!canceled && filePaths.length > 0) {
    serverExePath = filePaths[0];
    saveAppConfig();
    return serverExePath;
  }
  return null;
});

ipcMain.handle('get-available-instances', async () => {
  const dir = getZomboidServerDir();
  if (!fs.existsSync(dir)) return { instances: [], dir };
  
  const files = fs.readdirSync(dir);
  const instances = [];
  files.forEach(file => {
    if (file.endsWith('.ini')) {
      instances.push(file.replace('.ini', ''));
    }
  });
  return { instances, dir };
});

ipcMain.handle('get-server-config', async (event, instanceName) => {
  const targetPath = getIniPath(instanceName);
  if (!targetPath || !fs.existsSync(targetPath)) return null;
  
  const parser = new PZIniParser(targetPath);
  return parser.parsedConfig;
});

ipcMain.handle('add-mod-to-server', async (event, { instanceName, workshopId, modId }) => {
  const targetPath = getIniPath(instanceName);
  if (!targetPath || !fs.existsSync(targetPath)) return { success: false, error: 'File not found' };

  const parser = new PZIniParser(targetPath);
  
  if (workshopId) {
    parser.appendToList('WorkshopItems', workshopId);
  }
  
  if (modId) {
    parser.appendToList('Mods', modId);
  }
  
  const success = parser.save();
  return { success, config: parser.parsedConfig };
});

ipcMain.handle('remove-mod-from-server', async (event, { instanceName, workshopId, modId }) => {
  const targetPath = getIniPath(instanceName);
  if (!targetPath || !fs.existsSync(targetPath)) return { success: false, error: 'File not found' };

  const parser = new PZIniParser(targetPath);
  
  if (workshopId) {
    parser.removeFromList('WorkshopItems', workshopId);
  }
  
  if (modId) {
    parser.removeFromList('Mods', modId);
  }
  
  const success = parser.save();
  return { success, config: parser.parsedConfig };
});

ipcMain.handle('start-server', async (event, instanceName) => {
  if (!serverExePath || !fs.existsSync(serverExePath)) {
    return { success: false, error: 'Server executable path not set or invalid.' };
  }
  if (runningServers[instanceName]) {
    return { success: false, error: 'Server is already running.' };
  }

  const cwd = path.dirname(serverExePath);
  
  const child = spawn(serverExePath, [`-servername`, instanceName], { cwd, shell: true });
  runningServers[instanceName] = child;

  const win = BrowserWindow.getAllWindows()[0];
  const sendLog = (data) => {
    if (win) win.webContents.send('server-log', { instanceName, log: data.toString() });
  };

  child.stdout.on('data', sendLog);
  child.stderr.on('data', sendLog);

  child.on('close', (code) => {
    delete runningServers[instanceName];
    if (win) win.webContents.send('server-state', { instanceName, state: 'offline' });
    sendLog(`\n[SYSTEM] Server process exited with code ${code}\n`);
  });

  return { success: true };
});

ipcMain.handle('stop-server', async (event, instanceName) => {
  const child = runningServers[instanceName];
  if (child) {
    child.stdin.write('quit\n');
    return { success: true };
  }
  return { success: false, error: 'Server not running.' };
});

ipcMain.handle('get-server-states', () => {
  const states = {};
  for (const key in runningServers) {
    states[key] = 'online';
  }
  return states;
});

ipcMain.handle('select-custom-file', async (event) => {
  const window = BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = await dialog.showOpenDialog(window, {
    properties: ['openFile'],
    title: 'Select Custom Configuration File',
    filters: [
      { name: 'Config Files', extensions: ['ini', 'json', 'txt', 'lua', 'xml'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (!canceled && filePaths.length > 0) {
    const filePath = filePaths[0];
    const content = fs.readFileSync(filePath, 'utf8');
    return { filePath, content };
  }
  return null;
});

ipcMain.handle('save-custom-file', async (event, { filePath, content }) => {
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  } catch (err) {
    console.error('Failed to save file:', err);
    return false;
  }
});

// --- Live Map: pzsm_players.json watcher ---
let playersWatcher = null;
let watchedPlayersPath = null;

ipcMain.handle('set-players-file', async (event, filePath) => {
  // Stop any previous watcher
  if (playersWatcher) {
    playersWatcher.close();
    playersWatcher = null;
  }

  if (!filePath || !fs.existsSync(filePath)) return { success: false, error: 'File not found' };

  watchedPlayersPath = filePath;

  // Watch for changes and push data to renderer
  playersWatcher = fs.watch(filePath, { persistent: false }, () => {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const players = JSON.parse(raw);
      const win = BrowserWindow.getAllWindows()[0];
      if (win) win.webContents.send('players-updated', players);
    } catch (e) {
      // Ignore parse errors (file may be mid-write)
    }
  });

  // Send initial data immediately
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return { success: true, players: JSON.parse(raw) };
  } catch (e) {
    return { success: true, players: [] };
  }
});

ipcMain.handle('select-players-file', async (event) => {
  const window = BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = await dialog.showOpenDialog(window, {
    properties: ['openFile'],
    title: 'Select pzsm_players.json (from your Zomboid server folder)',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (!canceled && filePaths.length > 0) return filePaths[0];
  return null;
});

ipcMain.handle('stop-players-watcher', async () => {
  if (playersWatcher) {
    playersWatcher.close();
    playersWatcher = null;
  }
  watchedPlayersPath = null;
  return true;
});
