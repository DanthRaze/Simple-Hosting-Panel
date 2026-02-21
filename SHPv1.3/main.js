require('dotenv').config();
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { Rcon } = require('rcon-client');
const pidusage = require('pidusage');
const fixPath = require('fix-path');
const AdmZip = require('adm-zip');
const https = require('https');
const axios = require("axios");
const sharp = require('sharp');
const http = require('http'); 
const archiver = require('archiver');
const url = require('url');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const querystring = require('querystring');
axios.get("https://mcserverjars.com/api/v1/projects")
    .then(res => console.log("MC API OK:", res.data.length))
    .catch(err => console.error("MC API FAIL:", err.message));


fixPath();

// --- CONFIGURATION ---
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = 'http://127.0.0.1:54321/callback';

let mainWindow;
let serverProcess = null;
let discordClient = null;
let rcon = null;
let serverConfig = { 
    folderPath: null, 
    jarFile: null, 
    ram: '4', 
    rconPort: '25575', 
    rconPw: '',
    autoBackupInterval: 'off',
    autoRestartInterval: 'off',
    restartWarning: '/bcast Server restart due in 5 minutes.',
    driveByDefault: true,
    discordToken: '',
    discordEnabled: false
};
const configPath = path.join(app.getPath('userData'), 'server-config.json');
const tokenPath = path.join(app.getPath('userData'), 'drive-token.enc');

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
let backupTimer = null;
let restartTimer = null;

function parseInterval(val) {
    if (!val || val === 'off') return 0;
    const num = parseInt(val);
    if (val.includes('mins')) return num * 60 * 1000;
    if (val.includes('hrs') || val.includes('hr')) return num * 60 * 60 * 1000;
    if (val.includes('d')) return num * 24 * 60 * 60 * 1000;
    if (val.includes('m')) return num * 30 * 24 * 60 * 60 * 1000; // Month
    return 0;
}

ipcMain.handle('update-schedules', (event, newConfig) => {
    serverConfig = { ...serverConfig, ...newConfig };
    if (backupTimer) clearInterval(backupTimer);
    if (restartTimer) clearInterval(restartTimer);

    const bTime = parseInterval(serverConfig.autoBackupInterval);
    if (bTime > 0) {
        backupTimer = setInterval(() => {
            console.log("Auto-backup triggered");
            // Logic to trigger backup
        }, bTime);
    }

    const rTime = parseInterval(serverConfig.autoRestartInterval);
    if (rTime > 0) {
        restartTimer = setInterval(async () => {
            if (rcon && rcon.authenticated) {
                rcon.send(serverConfig.restartWarning);
            }
            setTimeout(() => { restartServer(); }, 5 * 60 * 1000);
        }, rTime);
    }
});
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
    initDiscordBot();
});

// --- GOOGLE DRIVE SECURITY MANAGER ---
const driveManager = {
    tokens: null,

    getAuthUrl: () => {
        const scopes = ['https://www.googleapis.com/auth/drive.file'];
        return `https://accounts.google.com/o/oauth2/v2/auth?` +
            `scope=${encodeURIComponent(scopes.join(' '))}&` +
            `access_type=offline&` +
            `include_granted_scopes=true&` +
            `response_type=code&` +
            `state=state_parameter_passthrough_value&` +
            `redirect_uri=${encodeURIComponent(GOOGLE_REDIRECT_URI)}&` +
            `client_id=${GOOGLE_CLIENT_ID}`;
    },

    // Securely save tokens using OS Keychain (SafeStorage)
    saveTokens: async (tokens) => {
        driveManager.tokens = tokens;
        if (safeStorage.isEncryptionAvailable()) {
            const encrypted = safeStorage.encryptString(JSON.stringify(tokens));
            fs.writeFileSync(tokenPath, encrypted);
        } else {
            console.warn("SafeStorage unavailable. Tokens not saved to disk for security.");
        }
    },

    // Load and decrypt tokens
    loadTokens: () => {
        if (!fs.existsSync(tokenPath)) return null;
        try {
            if (safeStorage.isEncryptionAvailable()) {
                const encrypted = fs.readFileSync(tokenPath);
                const decrypted = safeStorage.decryptString(encrypted);
                driveManager.tokens = JSON.parse(decrypted);
                return driveManager.tokens;
            }
        } catch (e) {
            console.error("Failed to decrypt tokens:", e);
            return null;
        }
    },

    // Refresh access token if expired
    refreshAccessToken: async () => {
        if (!driveManager.tokens || !driveManager.tokens.refresh_token) throw new Error("No refresh token available");

        const params = new URLSearchParams();
        params.append('client_id', GOOGLE_CLIENT_ID);
        params.append('client_secret', GOOGLE_CLIENT_SECRET);
        params.append('refresh_token', driveManager.tokens.refresh_token);
        params.append('grant_type', 'refresh_token');

        const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: params });
        const data = await res.json();

        if (data.error) throw new Error(data.error_description || data.error);

        // Update access token, keep old refresh token if not provided new one
        driveManager.tokens.access_token = data.access_token;
        if (data.refresh_token) driveManager.tokens.refresh_token = data.refresh_token;
        driveManager.tokens.expiry_date = Date.now() + (data.expires_in * 1000);
        
        await driveManager.saveTokens(driveManager.tokens);
        return data.access_token;
    },

    

    getValidToken: async () => {
        if (!driveManager.tokens) driveManager.loadTokens();
        if (!driveManager.tokens) return null;

        // Refresh if expiring in less than 5 minutes
        if (Date.now() > (driveManager.tokens.expiry_date - 300000)) {
            return await driveManager.refreshAccessToken();
        }
        return driveManager.tokens.access_token;
    }
};

// --- IPC: Google Drive ---
ipcMain.handle('gdrive-status', async () => {
    const tokens = driveManager.loadTokens();
    return !!tokens;
});

ipcMain.handle('gdrive-logout', async () => {
    if (fs.existsSync(tokenPath)) fs.unlinkSync(tokenPath);
    driveManager.tokens = null;
    return true;
});

ipcMain.handle('gdrive-login', () => {
    return new Promise((resolve, reject) => {
        const server = http.createServer(async (req, res) => {
            if (req.url.startsWith('/callback')) {
                const query = url.parse(req.url, true).query;
                const code = query.code;

                if (code) {
                    try {
                        // Exchange code for tokens
                        const params = new URLSearchParams();
                        params.append('code', code);
                        params.append('client_id', GOOGLE_CLIENT_ID);
                        params.append('client_secret', GOOGLE_CLIENT_SECRET);
                        params.append('redirect_uri', GOOGLE_REDIRECT_URI);
                        params.append('grant_type', 'authorization_code');

                        const tokenRes = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: params });
                        const tokens = await tokenRes.json();

                        if (tokens.error) throw new Error(tokens.error);

                        tokens.expiry_date = Date.now() + (tokens.expires_in * 1000);
                        await driveManager.saveTokens(tokens);

                        res.end('Login successful! You can close this tab and return to the app.');
                        resolve(true);
                    } catch (e) {
                        res.end('Error during authentication.');
                        reject(e.message);
                    }
                } else {
                    res.end('Authentication failed (No code).');
                    reject('No code received');
                }
                server.close();
            }
        });

        server.listen(54321, () => {
            shell.openExternal(driveManager.getAuthUrl());
        });
        
        // Timeout after 2 minutes
        setTimeout(() => { 
            if(server.listening) {
                server.close(); 
                reject("Timeout");
            }
        }, 120000);
    });
});

ipcMain.handle('gdrive-upload', async (event, backupName) => {
    const token = await driveManager.getValidToken();
    if (!token) throw new Error("Not logged in to Google Drive");

    const filePath = path.join(serverConfig.folderPath, 'backups', backupName);
    const stats = fs.statSync(filePath);
    const fileSize = stats.size;

    // 1. Initiate Resumable Upload
    const metadata = {
        name: backupName,
        mimeType: 'application/zip'
        // 'parents': [] // Optional: ID of a specific folder
    };

    const initRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-Upload-Content-Length': fileSize
        },
        body: JSON.stringify(metadata)
    });

    if (!initRes.ok) throw new Error(`Init Failed: ${initRes.statusText}`);
    const uploadUrl = initRes.headers.get('Location');

    // 2. Stream File (Chunked upload is better for large files, but piping stream is simpler for this example)
    // Note: fetch doesn't support streams perfectly in all node versions without duplex: 'half'
    // We will use native https for the actual data piping to be safe and memory efficient.
    
    return new Promise((resolve, reject) => {
        const fileStream = fs.createReadStream(filePath);
        const req = https.request(uploadUrl, {
            method: 'PUT',
            headers: {
                'Content-Length': fileSize
            }
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                if(res.statusCode === 200 || res.statusCode === 201) resolve(true);
                else reject(`Upload Failed: ${res.statusCode} ${data}`);
            });
        });

        req.on('error', (e) => reject(e));
        fileStream.pipe(req);
    });
});


// --- IPC: Core & Config ---
ipcMain.handle('check-config', () => serverConfig.folderPath && serverConfig.jarFile);
ipcMain.handle('get-config', () => serverConfig);

ipcMain.handle('save-setup', async (event, folder, jar, ram, rconPort, rconPw, autoBackup, autoRestart) => {
    serverConfig.folderPath = folder;
    serverConfig.jarFile = jar;
    serverConfig.ram = ram;
    serverConfig.rconPort = rconPort;
    serverConfig.rconPw = rconPw;
    serverConfig.autoBackupInterval = autoBackup;
    serverConfig.autoRestartInterval = autoRestart;
    
    saveConfig(); 
    return true;
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

// --- IPC: Network & IP ---
ipcMain.handle('get-public-ip', () => {
    return new Promise((resolve) => {
        https.get('https://api.ipify.org?format=json', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data).ip);
                } catch {
                    resolve("Unable to fetch");
                }
            });
        }).on('error', () => resolve("Offline"));
    });
});

ipcMain.handle('upload-server-icon', async (event) => {
    if (!serverConfig.folderPath) {
        throw new Error("No server folder configured");
    }

    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Select any image (will be resized to 64×64 PNG)',
        properties: ['openFile'],
        filters: [
            { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }
        ]
    });

    if (canceled || !filePaths || filePaths.length === 0) {
        return { success: false, message: "Selection cancelled" };
    }

    const sourcePath = filePaths[0];
    const targetPath = path.join(serverConfig.folderPath, 'server-icon.png');

    try {
        // Process with sharp: resize to exactly 64x64, convert to PNG
        await sharp(sourcePath)
            .resize({
                width: 64,
                height: 64,
                fit: 'contain',           // keeps aspect ratio, adds transparent padding if needed
                background: { r: 0, g: 0, b: 0, alpha: 0 }  // transparent bg
            })
            .png({ quality: 90 })     // good compression
            .toFile(targetPath);

        // Notify UI to refresh preview
        if (mainWindow) {
            mainWindow.webContents.send('server-icon-updated');
        }

        return { 
            success: true, 
            message: "Server icon updated! (resized to 64×64 PNG)" 
        };
    } catch (err) {
        console.error("Icon processing failed:", err);
        return { success: false, message: "Processing failed: " + err.message };
    }
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

        output.on('close', async () => {
            const token = await driveManager.getValidToken();
            if (token) {
                console.log("Auto-uploading backup to Drive...");
            }
            resolve(true);
        });
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
function startMinecraftServer() {
    if (serverProcess) return;
    const jarPath = path.join(serverConfig.folderPath, serverConfig.jarFile);
    
    if (!fs.existsSync(jarPath)) {
        if (mainWindow) mainWindow.webContents.send('console-log', `Error: JAR file not found at ${jarPath}`);
        return;
    }

    serverProcess = spawn('java', [`-Xmx${serverConfig.ram}G`, `-Xms${serverConfig.ram}G`, '-jar', jarPath, 'nogui'], {
        cwd: serverConfig.folderPath
    });

    if (mainWindow) mainWindow.webContents.send('server-status', 'online');

    serverProcess.stdout.on('data', d => { if (mainWindow) mainWindow.webContents.send('console-log', d.toString()); });
    serverProcess.stderr.on('data', d => { if (mainWindow) mainWindow.webContents.send('console-log', `ERR: ${d.toString()}`); });
    
    serverProcess.on('close', () => {
        if (mainWindow) mainWindow.webContents.send('server-status', 'offline');
        serverProcess = null;
        if(rcon) { rcon.end(); rcon = null; }
    });

    setTimeout(connectRcon, 10000);
}

ipcMain.handle('start-server', () => startMinecraftServer());

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
ipcMain.handle('download-plugin', async (event, { url, filename, type }) => {
    const folder = type === 'mod' ? 'mods' : 'plugins';
    const targetDir = path.join(serverConfig.folderPath, folder);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir);
    
    const filePath = path.join(targetDir, filename);
    const file = fs.createWriteStream(filePath);
    
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            res.pipe(file);
            file.on('finish', () => { file.close(); resolve(true); });
        }).on('error', (err) => { reject(err); });
    });
});

ipcMain.handle('get-server-icon', async () => {
    if (!serverConfig.folderPath) return null;
    const iconPath = path.join(serverConfig.folderPath, 'server-icon.png');
    try {
        if (fs.existsSync(iconPath)) {
            const buffer = fs.readFileSync(iconPath);
            return `data:image/png;base64,${buffer.toString('base64')}`;
        }
    } catch (e) { console.error("Icon error:", e); }
    return null;
});

ipcMain.handle('reset-config', async () => {
    try {
        if (fs.existsSync(configPath)) {
            serverConfig = { folderPath: null }; 
            
            fs.unlinkSync(configPath);
            
            console.log("Settings wiped. System ready for re-setup.");
            return true;
        }
    } catch (err) {
        console.error("Reset failed:", err);
        return false;
    }
    return false;
});

// --- MCServerJars API ---
const MC_BASE = "https://mcserverjars.com/api/v1";

ipcMain.handle("get-mc-projects", async () => {
    try {
        const response = await axios.get(`${MC_BASE}/projects`, {
            timeout: 10000
        });
        return response.data; // return raw array
    } catch (err) {
        console.error("get-mc-projects FAILED:", err.message);
        return []; // always return array so UI never hangs
    }
});

ipcMain.handle("get-mc-versions", async (event, slug) => {
    try {
        if (!slug) return [];

        const response = await axios.get(
            `${MC_BASE}/projects/${slug}/versions`,
            { timeout: 10000 }
        );

        return response.data; 
    } catch (err) {
        console.error("get-mc-versions FAILED:", err.message);
        return [];
    }
});

ipcMain.handle("get-mc-latest-build", async (event, slug, version) => {
    try {
        if (!slug || !version) return null;

        const response = await axios.get(
            `${MC_BASE}/projects/${slug}/versions/${version}/latest`,
            { timeout: 10000 }
        );

        return response.data; 
    } catch (err) {
        console.error("get-mc-latest-build FAILED:", err.message);
        return null;
    }
});

// --- Discord Bot Logic ---
async function initDiscordBot() {
    if (discordClient) {
        try { 
            await discordClient.destroy(); 
        } catch (e) {
            console.error("Error stopping bot:", e);
        }
        discordClient = null;
    }

    if (!serverConfig.discordToken || !serverConfig.discordEnabled) {
        console.log("Discord bot is disabled.");
        return;
    }

    const { Client, GatewayIntentBits, Partials } = require('discord.js');
    
    discordClient = new Client({
        intents: [
            GatewayIntentBits.Guilds, 
            GatewayIntentBits.DirectMessages, 
            GatewayIntentBits.MessageContent
        ],
        partials: [Partials.Channel]
    });

    discordClient.on('clientReady', (c) => {
        console.log(`Discord Bot Active: ${c.user.tag}`);
    });

    discordClient.on('messageCreate', async (message) => {
        if (message.author.bot) return;
        const cmd = message.content.toLowerCase();

        if (cmd === '!start') {
            if (serverProcess === null) {
                startMinecraftServer(); 
                message.reply("🚀 Command received! I'm starting the Minecraft server now.");
            } else {
                message.reply("⚠️ The server is already running!");
            }
        }

        if (cmd === '!status') {
            const isOnline = serverProcess !== null;
            message.reply(isOnline ? "✅ Server is **Online**." : "😴 Server is **Offline**.");
        }
    });

    discordClient.login(serverConfig.discordToken).catch(err => {
        console.error("Bot Login Error:", err.message);
    });
}

// --- Discord IPC Handlers ---
ipcMain.handle('get-discord-link', (event, token) => {
    try {
        if (!token) return null;
        const clientId = Buffer.from(token.split('.')[0], 'base64').toString();
        return `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=2048&scope=bot`;
    } catch (e) { return null; }
});
ipcMain.handle('save-discord-settings', async (event, token, enabled) => {
    try {
        serverConfig.discordToken = token;
        serverConfig.discordEnabled = enabled;

        const configPath = path.join(app.getPath('userData'), 'config.json');
        fs.writeFileSync(configPath, JSON.stringify(serverConfig, null, 2));

        await initDiscordBot();

        return { success: true };
    } catch (err) {
        console.error("Failed to save to config.json:", err);
        return { success: false, error: err.message };
    }
});