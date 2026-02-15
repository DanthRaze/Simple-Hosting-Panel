const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { Rcon } = require('rcon-client');
const pidusage = require('pidusage');
const fixPath = require('fix-path');
const AdmZip = require('adm-zip');
const https = require('https');
const archiver = require('archiver');

fixPath();

let mainWindow;
let serverProcess = null;
let rcon = null;
let serverConfig = { folderPath: null, jarFile: null, ram: '4', rconPort: '25575', rconPw: '' };
const configPath = path.join(app.getPath('userData'), 'server-config.json');

// --- Utils ---
function loadConfig() {
    if (fs.existsSync(configPath)) {
        try {
            serverConfig = JSON.parse(fs.readFileSync(configPath));
        } catch (e) { console.error("Config load error", e); }
    }
}
function saveConfig() {
    fs.writeFileSync(configPath, JSON.stringify(serverConfig));
}
function getPropPath() { return path.join(serverConfig.folderPath, 'server.properties'); }

// --- Window ---
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280, height: 850,
        backgroundColor: '#0b0e14',
        title: "Simple Hosting Panel",
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });
    mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
    loadConfig();
    createWindow();
});

// --- IPC: Core & Config ---
ipcMain.handle('check-config', () => serverConfig.folderPath && serverConfig.jarFile);
ipcMain.handle('get-config', () => serverConfig);

ipcMain.handle('save-setup', (event, folder, jar, ram, rconPort, rconPw) => {
    serverConfig.folderPath = folder;
    serverConfig.jarFile = jar;
    serverConfig.ram = ram;
    serverConfig.rconPort = rconPort;
    serverConfig.rconPw = rconPw;
    saveConfig();
    return true;
});

ipcMain.handle('reset-config', () => {
    if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
        serverConfig = { folderPath: null, jarFile: null, ram: '4', rconPort: '25575', rconPw: '' };
        return true;
    }
    return false;
});

ipcMain.handle('select-folder', async () => {
    const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
    return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('scan-jars', (event, folder) => {
    try {
        return fs.readdirSync(folder).filter(f => f.endsWith('.jar'));
    } catch (e) { return []; }
});

// --- IPC: Installer / Downloader ---
ipcMain.handle('download-file', (event, url, folder, filename) => {
    return new Promise((resolve, reject) => {
        const dest = path.join(folder, filename);
        const file = fs.createWriteStream(dest);
        
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                return reject(`Failed to download: Status ${response.statusCode}`);
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close(() => resolve(true));
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => {});
            reject(err.message);
        });
    });
});

ipcMain.handle('init-eula', (event, folder) => {
    try {
        fs.writeFileSync(path.join(folder, 'eula.txt'), 'eula=true');
        return true;
    } catch (e) { return false; }
});

// --- IPC: Backups ---
ipcMain.handle('create-backup', async () => {
    const backupDir = path.join(serverConfig.folderPath, 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const zipName = `backup-${timestamp}.zip`;
    const outputPath = path.join(backupDir, zipName);
    
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(outputPath);
        const archive = archiver('zip', { zlib: { level: 5 } }); 

        output.on('close', () => resolve(true));
        archive.on('error', (err) => reject(err));

        archive.pipe(output);

        archive.glob('**/*', {
            cwd: serverConfig.folderPath,
            ignore: ['backups/**', 'backups'] 
        });

        archive.finalize();
    });
});

ipcMain.handle('list-backups', () => {
    if (!serverConfig.folderPath) return [];
    const backupDir = path.join(serverConfig.folderPath, 'backups');
    if (!fs.existsSync(backupDir)) return [];
    
    return fs.readdirSync(backupDir)
        .filter(f => f.endsWith('.zip'))
        .map(f => {
            const stats = fs.statSync(path.join(backupDir, f));
            return { name: f, size: stats.size, date: stats.mtime };
        })
        .sort((a, b) => b.date - a.date);
});

ipcMain.handle('restore-backup', async (event, backupName) => {
    if (serverProcess) throw new Error("Stop the server before restoring!");
    
    const backupPath = path.join(serverConfig.folderPath, 'backups', backupName);
    const zip = new AdmZip(backupPath);
    
    zip.extractAllTo(serverConfig.folderPath, true);
    return true;
});

ipcMain.handle('delete-backup', async (event, backupName) => {
    const p = path.join(serverConfig.folderPath, 'backups', backupName);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    return true;
});

// --- IPC: Server Control ---
ipcMain.handle('start-server', async () => {
    if (serverProcess) return;
    const jarPath = path.join(serverConfig.folderPath, serverConfig.jarFile);
    
    if (!fs.existsSync(jarPath)) {
        mainWindow.webContents.send('console-log', `Error: JAR file not found at ${jarPath}`);
        return;
    }

    serverProcess = spawn('java', [`-Xmx${serverConfig.ram}G`, `-Xms${serverConfig.ram}G`, '-jar', jarPath, 'nogui'], {
        cwd: serverConfig.folderPath
    });

    mainWindow.webContents.send('server-status', 'online');

    serverProcess.stdout.on('data', d => mainWindow.webContents.send('console-log', d.toString()));
    serverProcess.stderr.on('data', d => mainWindow.webContents.send('console-log', `ERR: ${d.toString()}`));
    
    serverProcess.on('close', () => {
        mainWindow.webContents.send('server-status', 'offline');
        serverProcess = null;
        if(rcon) { rcon.end(); rcon = null; }
    });

    setTimeout(connectRcon, 10000);
});

async function connectRcon() {
    try {
        const port = serverConfig.rconPort || 25575;
        const pw = serverConfig.rconPw || "";
        rcon = await Rcon.connect({ host: '127.0.0.1', port: parseInt(port), password: pw });
        if (mainWindow) mainWindow.webContents.send('console-log', '✅ RCON Connected');
    } catch (e) {
        console.log("RCON waiting...", e.message);
    }
}

ipcMain.handle('stop-server', async () => {
    if (rcon) await rcon.send('stop');
    else if (serverProcess) serverProcess.stdin.write('stop\n');
});

ipcMain.handle('kill-server', () => {
    if (serverProcess) { serverProcess.kill('SIGKILL'); serverProcess = null; }
});

ipcMain.handle('send-command', async (event, cmd) => {
    if (rcon) return await rcon.send(cmd);
    if (serverProcess) serverProcess.stdin.write(cmd + '\n');
    return "Sent to Console";
});

ipcMain.handle('get-stats', async () => {
    if (!serverProcess) return { cpu: 0, memory: 0 };
    try { return await pidusage(serverProcess.pid); } catch { return { cpu: 0, memory: 0 }; }
});

// --- IPC: File Manager ---
ipcMain.handle('list-files', (event, subPath = '') => {
    if (!serverConfig.folderPath) return [];
    const target = path.join(serverConfig.folderPath, subPath);
    if (!target.startsWith(serverConfig.folderPath)) return []; 
    try {
        return fs.readdirSync(target, { withFileTypes: true }).map(f => ({
            name: f.name,
            isDirectory: f.isDirectory(),
            size: f.isDirectory() ? 0 : fs.statSync(path.join(target, f.name)).size
        }));
    } catch (e) { return []; }
});

ipcMain.handle('read-file', (event, subPath) => {
    if (!serverConfig.folderPath) return "";
    return fs.readFileSync(path.join(serverConfig.folderPath, subPath), 'utf-8');
});

ipcMain.handle('save-file', (event, subPath, content) => {
    if (!serverConfig.folderPath) throw new Error("Server path not configured.");
    fs.writeFileSync(path.join(serverConfig.folderPath, subPath), content);
    return true;
});

// --- IPC: Settings & Players ---
ipcMain.handle('read-properties', () => {
    if (!fs.existsSync(getPropPath())) return "";
    return fs.readFileSync(getPropPath(), 'utf-8');
});

ipcMain.handle('save-properties', (event, content) => {
    fs.writeFileSync(getPropPath(), content);
    return true;
});

ipcMain.handle('get-players-data', () => {
    if (!serverConfig.folderPath) return { cache:[], whitelist:[], ops:[], banned:[] };
    const readJson = (name) => {
        const p = path.join(serverConfig.folderPath, name);
        return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : [];
    };
    return {
        cache: readJson('usercache.json'),
        whitelist: readJson('whitelist.json'),
        ops: readJson('ops.json'),
        banned: readJson('banned-players.json')
    };
});

ipcMain.handle('get-online-players', async () => {
    if (!rcon) return [];
    return await rcon.send('list uuids'); 
});