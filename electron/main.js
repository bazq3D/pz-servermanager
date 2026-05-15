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
let steamcmdPath = null;
const runningServers = {};

const getConfigPath = () => path.join(app.getPath('userData'), 'pzsm-config.json');

const loadAppConfig = () => {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (data.customDir) customDir = data.customDir;
      if (data.serverExePath) serverExePath = data.serverExePath;
      if (data.steamcmdPath) steamcmdPath = data.steamcmdPath;
    }
  } catch (err) {
    console.error("Error loading app config:", err);
  }
};

const saveAppConfig = () => {
  try {
    fs.writeFileSync(getConfigPath(), JSON.stringify({ customDir, serverExePath, steamcmdPath }), 'utf8');
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

// --- Setup Wizard IPC ---

ipcMain.handle('check-steamcmd', async () => {
  if (steamcmdPath && fs.existsSync(steamcmdPath)) return { found: true, path: steamcmdPath };
  const candidates = [
    'C:\\steamcmd\\steamcmd.exe',
    'C:\\SteamCMD\\steamcmd.exe',
    path.join(process.env.USERPROFILE || '', 'steamcmd', 'steamcmd.exe'),
    path.join(process.env.USERPROFILE || '', 'SteamCMD', 'steamcmd.exe'),
    path.join(process.env.ProgramFiles || '', 'steamcmd', 'steamcmd.exe'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      steamcmdPath = p;
      saveAppConfig();
      return { found: true, path: p };
    }
  }
  return { found: false };
});

ipcMain.handle('select-steamcmd', async () => {
  const window = BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = await dialog.showOpenDialog(window, {
    properties: ['openFile'],
    title: 'Select steamcmd.exe',
    filters: [{ name: 'SteamCMD', extensions: ['exe'] }],
  });
  if (!canceled && filePaths.length > 0) {
    steamcmdPath = filePaths[0];
    saveAppConfig();
    return steamcmdPath;
  }
  return null;
});

ipcMain.handle('get-steamcmd-path', () => steamcmdPath);

ipcMain.handle('select-install-dir', async () => {
  const window = BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = await dialog.showOpenDialog(window, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select PZ Dedicated Server Installation Folder',
    buttonLabel: 'Install Here',
  });
  if (!canceled && filePaths.length > 0) return filePaths[0];
  return null;
});

ipcMain.handle('install-pz-server', async (event, { steamcmdExe, installDir }) => {
  return new Promise((resolve) => {
    const win = BrowserWindow.getAllWindows()[0];
    const sendLog = (line) => { if (win) win.webContents.send('install-log', line); };

    if (!fs.existsSync(steamcmdExe)) {
      sendLog('[ERROR] steamcmd.exe not found at: ' + steamcmdExe + '\n');
      return resolve({ success: false, error: 'steamcmd.exe not found' });
    }
    if (!fs.existsSync(installDir)) {
      try { fs.mkdirSync(installDir, { recursive: true }); }
      catch (e) { return resolve({ success: false, error: e.message }); }
    }

    sendLog(`[SYSTEM] Starting SteamCMD...\n`);
    sendLog(`[SYSTEM] Install dir: ${installDir}\n`);
    sendLog(`[SYSTEM] App ID: 380870 (Project Zomboid Dedicated Server)\n\n`);

    const args = [
      '+force_install_dir', installDir,
      '+login', 'anonymous',
      '+app_update', '380870', 'validate',
      '+quit',
    ];
    const child = spawn(steamcmdExe, args);

    child.stdout.on('data', (d) => sendLog(d.toString()));
    child.stderr.on('data', (d) => sendLog(d.toString()));

    child.on('error', (err) => {
      sendLog(`\n[ERROR] ${err.message}\n`);
      resolve({ success: false, error: err.message });
    });

    child.on('close', (code) => {
      const exeCandidates = ['StartServer64.bat', 'StartServer32.bat', 'start-server.sh'];
      let foundExe = null;
      for (const name of exeCandidates) {
        const p = path.join(installDir, name);
        if (fs.existsSync(p)) { foundExe = p; break; }
      }
      if (foundExe) {
        serverExePath = foundExe;
        saveAppConfig();
        sendLog(`\n[SYSTEM] Server executable set: ${foundExe}\n`);
      }
      sendLog(`\n[SYSTEM] SteamCMD exited with code ${code}\n`);
      resolve({ success: code === 0 || !!foundExe, exePath: foundExe });
    });
  });
});

ipcMain.handle('create-server-instance', async (event, { instanceName, config }) => {
  const dir = getZomboidServerDir();
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }); }
    catch (e) { return { success: false, error: e.message }; }
  }
  const iniPath = path.join(dir, `${instanceName}.ini`);
  if (fs.existsSync(iniPath)) return { success: false, error: 'Instance already exists' };

  const port = parseInt(config.port) || 16261;
  const lines = [
    `PublicName=${config.serverName || instanceName}`,
    `PublicDescription=A Project Zomboid Server`,
    `MaxPlayers=${config.maxPlayers || 32}`,
    `Password=${config.password || ''}`,
    `DefaultPort=${port}`,
    `UDPPort=${port + 1}`,
    `ResetID=${Math.floor(Math.random() * 1000000000)}`,
    `Map=Muldraugh, KY`,
    `Mods=`,
    `WorkshopItems=`,
    `PauseEmpty=true`,
    `GlobalChat=true`,
    `Open=${config.password ? 'false' : 'true'}`,
    `ServerWelcomeMessage=Welcome to our server!`,
    `DisplayUserName=true`,
    `LogLocalChat=false`,
    `AutoCreateUserInWhiteList=false`,
    `RealTimePerIngameMinute=1.0`,
    `StartTime=0`,
    `AntiCheatProtectionType1=true`,
    `AntiCheatProtectionType2=true`,
    `AntiCheatProtectionType3=true`,
    `AntiCheatProtectionType4=true`,
    `AntiCheatProtectionType5=true`,
    `AntiCheatProtectionType6=true`,
    `AntiCheatProtectionType7=true`,
    `AntiCheatProtectionType8=true`,
    `AntiCheatProtectionType9=true`,
    `AntiCheatProtectionType10=true`,
    `AntiCheatProtectionType11=true`,
    `AntiCheatProtectionType12=true`,
    `AntiCheatProtectionType13=true`,
    `AntiCheatProtectionType14=true`,
    `AntiCheatProtectionType15=true`,
    `AntiCheatProtectionType16=true`,
    `AntiCheatProtectionType17=true`,
    `AntiCheatProtectionType18=true`,
    `AntiCheatProtectionType19=true`,
    `AntiCheatProtectionType20=true`,
  ];
  try {
    fs.writeFileSync(iniPath, lines.join('\n'), 'utf8');
    return { success: true, path: iniPath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
