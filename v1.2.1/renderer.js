// ==========================================
// 1. NAVIGATION & INITIALIZATION
// ==========================================
let currentConfig = {};

window.showPage = (pageId) => {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById(`page-${pageId}`).classList.add('active');
    
    // Refresh specific page data
    if(pageId === 'files') refreshFiles('');
    if(pageId === 'players') refreshPlayers();
    if(pageId === 'settings') loadSettingsPage();
    if(pageId === 'backups') {
        refreshBackups();
        checkDriveStatus();
    }
};

async function init() {
    const hasConfig = await window.api.checkConfig();
    const resetBtn = document.getElementById('btn-reset-data');
    if (resetBtn) {
        resetBtn.onclick = async () => {
            if(confirm("Reset App?")) {
                await window.api.resetConfig();
                location.reload();
            }
        };
    }
    
    if (!hasConfig) {
        document.getElementById('setup-modal').style.display = 'flex';
        initSoftwareList();
    } else {
        document.getElementById('setup-modal').style.display = 'none';
        currentConfig = await window.api.getConfig();
        startStatsLoop();
        updateNetworkInfo();
    }
}
init();

async function updateNetworkInfo() {
    const ip = await window.api.getPublicIP();
    document.getElementById('header-ip').innerText = ip;
    
    try {
        const rawProps = await window.api.readProps();
        const props = parseProperties(rawProps);
        const port = props['server-port'] || '25565';
        document.getElementById('header-port').innerText = port;
    } catch {
        document.getElementById('header-port').innerText = '25565';
    }
}

window.toggleIpHelp = () => {
    const modal = document.getElementById('ip-help-modal');
    modal.style.display = (modal.style.display === 'none' || modal.style.display === '') ? 'flex' : 'none';
};

// ==========================================
// 2. SETUP WIZARD
// ==========================================
window.switchSetupTab = (tab) => {
    document.querySelectorAll('.setup-tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    
    document.getElementById(`tab-${tab}`).classList.add('active');
    const btns = document.querySelectorAll('.tab-btn');
    if(tab === 'create') btns[0].classList.add('active');
    else btns[1].classList.add('active');
};

// --- IMPORT EXISTING ---
document.getElementById('btn-select-folder').onclick = async () => {
    const path = await window.api.selectFolder();
    if (path) {
        document.getElementById('selected-path').innerText = path;
        const jars = await window.api.scanJars(path);
        const sel = document.getElementById('jar-select');
        sel.innerHTML = jars.map(j => `<option value="${j}">${j}</option>`).join('');
    }
};

document.getElementById('btn-finish-setup').onclick = async () => {
    const folder = document.getElementById('selected-path').innerText;
    const jar = document.getElementById('jar-select').value;
    const ram = document.getElementById('setup-ram').value;
    const rconPort = document.getElementById('setup-rcon-port').value;
    const rconPw = document.getElementById('setup-rcon-pw').value;

    if(folder && jar && !folder.includes('No folder') && jar !== 'Select Folder First') {
        await window.api.saveSetup(folder, jar, ram, rconPort, rconPw, 'off', 'off');
        document.getElementById('setup-modal').style.display = 'none';
        currentConfig = await window.api.getConfig();
        startStatsLoop();
        updateNetworkInfo();
    } else {
        alert("Please ensure all fields are valid.");
    }
};

// ==========================================
// CREATE NEW SERVER TAB (fixed & cleaned)
// ==========================================
let installPath = null;

document.getElementById('btn-create-folder').onclick = async () => {
    const path = await window.api.selectFolder();
    if (path) {
        installPath = path;
        document.getElementById('create-path-display').innerText = path;
    }
};

// === FUNCTIONS (defined BEFORE listeners) ===
window.updateSoftwareVersions = async () => {
    const slug = document.getElementById('api-type-select').value;
    const versionSelect = document.getElementById('version-select');
    if (!versionSelect) return;

    versionSelect.innerHTML = '<option>Loading versions...</option>';
    document.getElementById('btn-install-server').disabled = true;

    try {
        const versionsData = await window.api.getMcVersions(slug);
        
        if (versionsData && Array.isArray(versionsData) && versionsData.length > 0) {
            versionSelect.innerHTML = versionsData
                .map(item => `<option value="${item.version}">${item.version}</option>`)
                .join('');
            
            versionSelect.value = versionsData[0].version;
            await window.syncSelectionToHiddenFields();
        } else {
            versionSelect.innerHTML = '<option>No versions available</option>';
        }
    } catch (err) {
        console.error("Version fetch failed:", err);
        versionSelect.innerHTML = '<option>Error loading versions</option>';
    }
};

window.syncSelectionToHiddenFields = async () => {
    const slug = document.getElementById('api-type-select').value;
    const version = document.getElementById('version-select').value;
    if (!slug || !version) {
        document.getElementById('btn-install-server').disabled = true;
        return;
    }

    try {
        const buildData = await window.api.getMcLatestBuild(slug, version);
        if (buildData && buildData.download_url) {
            document.getElementById('setup-jar').value = buildData.file_name || `${slug}-${version}.jar`;
            document.getElementById('setup-download-url').value = buildData.download_url;
            document.getElementById('btn-install-server').disabled = false;
            console.log(`Download ready: ${buildData.download_url} (build ${buildData.build})`);
        } else {
            throw new Error("No download_url in latest build response");
        }
    } catch (err) {
        console.error(`Failed to get latest build for ${slug} ${version}:`, err.message);
        document.getElementById('btn-install-server').disabled = true;
    }
};

// === EVENT LISTENERS (now safe) ===
document.getElementById('api-type-select').onchange = window.updateSoftwareVersions;
document.getElementById('version-select').onchange = window.syncSelectionToHiddenFields;

// Install button
document.getElementById('btn-install-server').onclick = async () => {
    const status = document.getElementById('install-status');
    const slug = document.getElementById('api-type-select').value;
    const version = document.getElementById('version-select').value;
    const ram = document.getElementById('create-ram').value;
    const port = document.getElementById('create-port').value;
    const downloadUrl = document.getElementById('setup-download-url').value;
    const filename = document.getElementById('setup-jar').value;

    if (!installPath || !slug || !downloadUrl) {
        alert("Please select a folder and ensure software is loaded!");
        return;
    }

    try {
        document.getElementById('btn-install-server').disabled = true;
        status.innerText = `Downloading ${slug} ${version}...`;

        await window.api.downloadFile(downloadUrl, installPath, filename);
        status.innerText = "Accepting EULA...";
        await window.api.initEula(installPath);

        status.innerText = "Saving Configuration...";
        const rconPw = "admin" + Math.floor(Math.random() * 1000);
        await window.api.saveSetup(installPath, filename, ram, "25575", rconPw, 'off', 'off');

        const props = `server-port=${port}\nenable-rcon=true\nrcon.port=25575\nrcon.password=${rconPw}\nmax-players=20\n`;
        await window.api.saveFile('server.properties', props);

        status.innerText = "Done! Restarting app...";
        setTimeout(() => {
            document.getElementById('setup-modal').style.display = 'none';
            window.location.reload();
        }, 1500);
    } catch (e) {
        status.innerText = "Error: " + e.message;
        alert("Installation failed: " + e.message);
        document.getElementById('btn-install-server').disabled = false;
    }
};

// Init software list (called from init() when needed)
async function initSoftwareList() {
    const select = document.getElementById('api-type-select');
    if (!select) return;

    select.innerHTML = '<option>Loading Software...</option>';
    try {
        const projects = await window.api.getMcProjects();
        if (projects && projects.length > 0) {
            select.innerHTML = projects.map(p => `<option value="${p.slug}">${p.name}</option>`).join('');
            await window.updateSoftwareVersions(); // load first project's versions
        } else {
            select.innerHTML = '<option value="vanilla">Vanilla (Fallback)</option>';
        }
    } catch (err) {
        console.error("Software list failed:", err);
        select.innerHTML = '<option>Error loading software</option>';
    }
}

// ==========================================
// 3. SERVER CONTROLS & CONSOLE
// ==========================================
const term = new Terminal({ theme: { background: '#111' }, fontFamily: 'Consolas, monospace', fontSize: 13 });
const fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);
term.open(document.getElementById('terminal-container'));
fitAddon.fit();

window.api.onConsole(d => term.write(d.replace(/\n/g, '\r\n')));
window.api.onStatus(s => {
    const b = document.getElementById('status-badge');
    b.innerText = s.toUpperCase();
    b.className = `status-badge ${s}`;
});

let inputBuffer = "";
term.onData(e => {
    if (e === '\r') {
        window.api.sendCommand(inputBuffer);
        inputBuffer = "";
        term.write('\r\n');
    } else if (e === '\u007f') {
        if (inputBuffer.length > 0) {
            inputBuffer = inputBuffer.slice(0, -1);
            term.write('\b \b');
        }
    } else {
        inputBuffer += e;
        term.write(e);
    }
});

['start', 'stop', 'kill', 'restart'].forEach(act => {
    document.getElementById(`${act}-btn`).onclick = () => {
        if(act === 'restart') {
            window.api.stopServer();
            setTimeout(() => window.api.startServer(), 5000);
        } else {
            window.api[`${act}Server`]();
        }
    };
});

// ==========================================
// 4. STATS GRAPH
// ==========================================
function startStatsLoop() {
    const ctx = document.getElementById('perfChart').getContext('2d');
    const chart = new Chart(ctx, {
        type: 'line',
        data: { labels: Array(20).fill(''), datasets: [{ label: 'RAM Usage (MB)', data: Array(20).fill(0), borderColor: '#00e676', backgroundColor: 'rgba(0,230,118,0.1)', fill: true, tension: 0.4 }] },
        options: { responsive:true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { grid: { color: '#333' } } } }
    });

    setInterval(async () => {
        const stats = await window.api.getStats();
        document.getElementById('cpu-val').innerText = stats.cpu.toFixed(1) + '%';
        document.getElementById('ram-val').innerText = (stats.memory / 1024 / 1024).toFixed(0) + ' MB';
        
        chart.data.datasets[0].data.shift();
        chart.data.datasets[0].data.push(stats.memory / 1024 / 1024);
        chart.update();
    }, 2000);
}

// ==========================================
// 5. FILE MANAGER
// ==========================================
let currentFileDir = ""; 
async function refreshFiles(subPath) {
    currentFileDir = subPath;
    const files = await window.api.listFiles(subPath);
    document.getElementById('current-path-display').innerText = subPath || '/';
    document.getElementById('btn-back').disabled = (subPath === "");

    const container = document.getElementById('file-list-container');
    container.innerHTML = files.map(f => `
        <div class="file-item" onclick="handleFileClick('${f.name}', ${f.isDirectory})">
            <span class="icon">${f.isDirectory ? '📁' : '📄'}</span>
            <span class="name">${f.name}</span>
            <span class="size">${f.isDirectory ? '' : (f.size/1024).toFixed(1)+' KB'}</span>
        </div>
    `).join('');
}

window.handleFileClick = (name, isDir) => {
    const fullPath = currentFileDir ? currentFileDir + '/' + name : name;
    if (isDir) {
        refreshFiles(fullPath);
    } else {
        openEditor(fullPath);
    }
};

document.getElementById('btn-root').onclick = () => refreshFiles('');
document.getElementById('btn-back').onclick = () => {
    const parts = currentFileDir.split('/');
    parts.pop();
    refreshFiles(parts.join('/'));
};

let editingPath = "";
async function openEditor(path) {
    editingPath = path;
    const content = await window.api.readFile(path);
    document.getElementById('file-browser').style.display = 'none';
    document.getElementById('file-editor').style.display = 'flex';
    document.getElementById('editing-filename').innerText = path;
    document.getElementById('editor-textarea').value = content;
}

window.closeEditor = () => {
    document.getElementById('file-browser').style.display = 'block';
    document.getElementById('file-editor').style.display = 'none';
};

document.getElementById('btn-save-file').onclick = async () => {
    await window.api.saveFile(editingPath, document.getElementById('editor-textarea').value);
    alert('File Saved Successfully!');
};

// ==========================================
// 6. BACKUP & GOOGLE DRIVE MANAGER
// ==========================================
let isDriveLinked = false;

async function checkDriveStatus() {
    isDriveLinked = await window.api.checkDriveStatus();
    const btn = document.getElementById('btn-drive-link');
    
    if (isDriveLinked) {
        btn.innerHTML = `<i class="fas fa-check-circle"></i> Linked (Unlink)`;
        btn.style.color = '#58a6ff';
        btn.onclick = async () => {
            if(confirm('Unlink Google Drive?')) {
                await window.api.logoutDrive();
                checkDriveStatus();
            }
        };
    } else {
        btn.innerHTML = `<i class="fas fa-sign-in-alt"></i> Link Google Drive`;
        btn.style.color = '#fff';
        btn.onclick = async () => {
            btn.innerHTML = 'Waiting for browser...';
            try {
                await window.api.loginDrive();
                checkDriveStatus();
            } catch (e) {
                alert("Login failed or timed out.");
                checkDriveStatus();
            }
        };
    }
    refreshBackups(); 
}

async function refreshBackups() {
    const list = await window.api.listBackups();
    const container = document.getElementById('backup-list');
    
    if(list.length === 0) {
        container.innerHTML = '<div style="color:#666; padding:20px; text-align:center;">No backups found.</div>';
        return;
    }

    container.innerHTML = list.map(b => `
        <div class="backup-item">
            <div class="backup-info">
                <div class="backup-name">${b.name}</div>
                <div class="backup-meta">${new Date(b.date).toLocaleString()} • ${(b.size/1024/1024).toFixed(2)} MB</div>
            </div>
            <div class="backup-actions">
                ${isDriveLinked ? `<button class="btn-action" style="background:#238636" onclick="uploadToDrive('${b.name}', this)">
                    <i class="fab fa-google-drive"></i> Upload
                </button>` : ''}
                <button class="btn-action restart" onclick="restoreBackup('${b.name}')">Restore</button>
                <button class="btn-action stop" onclick="deleteBackup('${b.name}')">Delete</button>
            </div>
        </div>
    `).join('');
}

window.uploadToDrive = async (filename, btnElement) => {
    const ogText = btnElement.innerHTML;
    btnElement.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Uploading...`;
    btnElement.disabled = true;

    try {
        await window.api.uploadDrive(filename);
        btnElement.innerHTML = `<i class="fas fa-check"></i> Done`;
        setTimeout(() => { btnElement.innerHTML = ogText; btnElement.disabled = false; }, 3000);
    } catch (e) {
        alert("Upload Failed: " + e.message);
        btnElement.innerHTML = `<i class="fas fa-times"></i> Error`;
        setTimeout(() => { btnElement.innerHTML = ogText; btnElement.disabled = false; }, 3000);
    }
};

window.createNewBackup = async () => {
    if(!confirm("Create a backup now? (Server may lag slightly during zip process)")) return;
    
    const btn = document.querySelector('#page-backups button');
    const ogText = btn.innerHTML;
    btn.innerText = "Zipping...";
    btn.disabled = true;

    try {
        await window.api.createBackup();
        alert("Backup Created!");
        refreshBackups();
    } catch (e) {
        alert("Backup failed: " + e.message);
    } finally {
        btn.innerHTML = ogText;
        btn.disabled = false;
    }
};

window.restoreBackup = async (name) => {
    if(!confirm(`⚠️ DANGER: This will OVERWRITE your current server files with ${name}.\n\nEnsure server is STOPPED before proceeding.`)) return;
    
    try {
        await window.api.restoreBackup(name);
        alert("Restored successfully!");
        refreshFiles(''); 
    } catch (e) {
        alert("Restore failed: " + e.message);
    }
};

window.deleteBackup = async (name) => {
    if(!confirm(`Delete backup ${name}?`)) return;
    await window.api.deleteBackup(name);
    refreshBackups();
};

// ==========================================
// 7. SETTINGS, PROPERTIES & PLUGINS
// ==========================================
let propertiesData = {};

function parseProperties(text) {
    const props = {};
    if (!text) return props;
    text.split('\n').forEach(line => {
        const clean = line.trim();
        if (clean.startsWith('#') || !clean.includes('=')) return;
        const [key, ...val] = clean.split('=');
        props[key.trim()] = val.join('=').trim();
    });
    return props;
}

async function loadSettingsPage() {
    currentConfig = await window.api.getConfig();
    
    // Config properties
    document.getElementById('set-auto-restart').value = currentConfig.autoRestartInterval || 'off';
    document.getElementById('set-auto-backup').value = currentConfig.autoBackupInterval || 'off';
    
    const slider = document.getElementById('set-ram');
    slider.value = currentConfig.ram;
    document.getElementById('ram-disp').innerText = currentConfig.ram + ' GB';
    slider.oninput = (e) => document.getElementById('ram-disp').innerText = e.target.value + ' GB';

    document.getElementById('set-rcon-port').value = currentConfig.rconPort || '25575';
    document.getElementById('set-rcon-pw').value = currentConfig.rconPw || '';

    // Server properties
    const rawProps = await window.api.readProps();
    propertiesData = parseProperties(rawProps);
    
    const setVal = (id, key) => {
        const el = document.getElementById(id);
        if(!el) return;
        if(el.type === 'checkbox') el.checked = propertiesData[key] === 'true';
        else el.value = propertiesData[key] || '';
    };

    setVal('prop-max-players', 'max-players');
    setVal('prop-view-distance', 'view-distance');
    setVal('prop-gamemode', 'gamemode');
    setVal('prop-difficulty', 'difficulty');
    setVal('prop-motd', 'motd');
    setVal('prop-white-list', 'white-list');
    setVal('prop-server-port', 'server-port');
    setVal('prop-server-ip', 'server-ip');

    // Server Icon
    const iconData = await window.api.getServerIcon();
    if (iconData) {
        document.getElementById('motd-icon').src = iconData;
    } else {
        document.getElementById('motd-icon').src = 'https://minecraft.net/favicon.png'; // Fallback
    }

    renderMotd();
}
// Refresh icon preview (call this when loading settings page + after upload)
async function refreshServerIcon() {
    try {
        const iconDataUrl = await window.api.getServerIcon();
        const img = document.getElementById('motd-icon');
        if (iconDataUrl) {
            img.src = iconDataUrl + '?t=' + Date.now();  // cache bust so it updates
        } else {
            img.src = 'https://via.placeholder.com/64?text=No+Icon';
        }
        document.getElementById('icon-status').innerText = '';
    } catch (err) {
        console.error("Failed to load icon:", err);
    }
}

// Make icon clickable
document.querySelector('#motd-preview > div[style*="position: relative"]').onclick = async () => {
    try {
        const result = await window.api.uploadServerIcon();
        const statusEl = document.getElementById('icon-status');
        
        if (result.success) {
            statusEl.style.color = '#238636';
            statusEl.innerText = result.message;
            setTimeout(refreshServerIcon, 600);  // give FS a moment
        } else {
            statusEl.style.color = '#da3633';
            statusEl.innerText = result.message || 'Upload failed';
        }
    } catch (err) {
        document.getElementById('icon-status').innerText = 'Error: ' + err.message;
    }
};

// Optional: listen for broadcast from main (good practice)
window.api.onServerIconUpdated(() => refreshServerIcon());

// In your loadSettingsPage() function (or wherever you init settings tab), add:
refreshServerIcon();


document.getElementById('prop-motd').addEventListener('input', renderMotd);

function renderMotd() {
    const raw = document.getElementById('prop-motd').value;
    const codes = {
        '0': '#000000', '1': '#0000AA', '2': '#00AA00', '3': '#00AAAA',
        '4': '#AA0000', '5': '#AA00AA', '6': '#FFAA00', '7': '#AAAAAA',
        '8': '#555555', '9': '#5555FF', 'a': '#55FF55', 'b': '#55FFFF',
        'c': '#FF5555', 'd': '#FF55FF', 'e': '#FFFF55', 'f': '#FFFFFF'
    };
    
    let html = "";
    let color = "#AAAAAA"; 
    let parts = raw.split('§');
    
    html += `<span style="color:${color}">${parts[0]}</span>`;
    for(let i=1; i<parts.length; i++) {
        let code = parts[i][0];
        let text = parts[i].substring(1);
        if(codes[code]) color = codes[code];
        html += `<span style="color:${color}">${text}</span>`;
    }
    document.getElementById('motd-render').innerHTML = html;
}

const saveBtn = document.getElementById('btn-save-settings');
if(saveBtn) {
    saveBtn.onclick = async () => {
        const autoRestart = document.getElementById('set-auto-restart').value;
        const autoBackup = document.getElementById('set-auto-backup').value;
        const ram = document.getElementById('set-ram').value;
        const rconPort = document.getElementById('set-rcon-port').value;
        const rconPw = document.getElementById('set-rcon-pw').value;

        // 1. Save app-specific config
        await window.api.saveSetup(currentConfig.folderPath, currentConfig.jarFile, ram, rconPort, rconPw, autoBackup, autoRestart);
        
        // 2. Update schedules
        await window.api.updateSchedules({
            autoBackupInterval: autoBackup,
            autoRestartInterval: autoRestart
        });

        // 3. SAFE SAVE: Read existing properties first so we don't delete other settings
        const rawProps = await window.api.readProps();
        let properties = parseProperties(rawProps);

        // Update only the fields modified in the UI
        properties['motd'] = document.getElementById('prop-motd').value;
        properties['gamemode'] = document.getElementById('prop-gamemode').value;
        properties['difficulty'] = document.getElementById('prop-difficulty').value;
        properties['max-players'] = document.getElementById('prop-max-players').value;
        properties['server-port'] = document.getElementById('prop-server-port').value;
        properties['view-distance'] = document.getElementById('prop-view-distance').value; // FIX: Now saving
        
        const whiteListElement = document.getElementById('prop-white-list');
        if(whiteListElement) properties['white-list'] = whiteListElement.checked.toString();
        
        properties['enable-rcon'] = 'true';
        properties['rcon.port'] = rconPort;
        properties['rcon.password'] = rconPw;

        // Convert object back to the server.properties format
        let propsString = `# Updated ${new Date().toLocaleString()}\n`;
        for (const [key, value] of Object.entries(properties)) {
            if (key) propsString += `${key}=${value}\n`;
        }

        await window.api.saveProps(propsString);
        alert("Settings Saved Successfully!");
    };
}

// PLUGIN MANAGER (Modrinth)
async function loadPluginsPage() {
    const resultsDiv = document.getElementById('plugin-results');
    resultsDiv.innerHTML = '<div class="loading-spinner">Loading popular items...</div>';

    const isModded = currentConfig.jarFile.toLowerCase().includes('fabric') || 
                     currentConfig.jarFile.toLowerCase().includes('forge');
    
    const projectType = isModded ? 'mod' : 'plugin';

    const res = await fetch(`https://api.modrinth.com/v2/search?limit=20&facets=[["project_type:${projectType}"]]`);
    const data = await res.json();
    renderPluginCards(data.hits);
}

function renderPluginCards(items) {
    const resultsDiv = document.getElementById('plugin-results');
    resultsDiv.innerHTML = items.map(item => `
        <div class="plugin-card">
            <img src="${item.icon_url || 'https://cdn-icons-png.flaticon.com/512/262/262350.png'}" width="50">
            <div class="plugin-info">
                <strong>${item.title}</strong>
                <p>${item.description.substring(0, 60)}...</p>
                <div class="plugin-meta">
                    <span><i class="fas fa-download"></i> ${item.downloads.toLocaleString()}</span>
                </div>
            </div>
            <button class="btn-main" onclick="openPluginDetails('${item.project_id}')">View Versions</button>
        </div>
    `).join('');
}

window.searchModrinth = async () => {
    const query = document.getElementById('plugin-query').value;
    if(!query) return loadPluginsPage();
    
    const res = await fetch(`https://api.modrinth.com/v2/search?query=${query}&limit=20`);
    const data = await res.json();
    renderPluginCards(data.hits);
};

window.openPluginDetails = async (projectId) => {
    const res = await fetch(`https://api.modrinth.com/v2/project/${projectId}/version`);
    const versions = await res.json();

    let html = `<div class="version-list-modal">
        <h3>Select Version to Download</h3>
        <div class="scroll-area" style="max-height: 400px; overflow-y: auto;">`;

    html += versions.map(v => `
        <div class="version-item" style="border-bottom: 1px solid #333; padding: 10px; display: flex; justify-content: space-between; align-items: center;">
            <div>
                <strong>${v.version_number}</strong> 
                <span class="tag">${v.loaders.join(', ')}</span>
                <div style="font-size: 10px; color: #8b949e;">MC: ${v.game_versions.join(', ')}</div>
            </div>
            <button class="btn-main" style="width: 80px;" onclick="downloadThisVersion('${v.files[0].url}', '${v.files[0].filename}')">Install</button>
        </div>
    `).join('');

    html += `</div><button class="btn-action kill" onclick="this.parentElement.parentElement.remove()" style="margin-top:10px;">Close</button></div>`;
    
    const div = document.createElement('div');
    div.className = "modal-overlay";
    div.id = "version-modal";
    div.innerHTML = html;
    document.body.appendChild(div);
};

window.downloadThisVersion = async (url, filename) => {
    const isMod = currentConfig.jarFile.toLowerCase().includes('fabric') || currentConfig.jarFile.toLowerCase().includes('forge');
    const type = isMod ? 'mod' : 'plugin';
    
    document.getElementById('version-modal').remove();
    alert("Download started. Please wait...");
    
    await window.api.downloadPlugin({ url, filename, type });
    alert("Installation Complete! Please restart your server.");
};

// ==========================================
// 8. PLAYERS MANAGER
// ==========================================
async function refreshPlayers() {
    const data = await window.api.getPlayersData(); 
    const playersMap = new Map();

    const add = (p, source) => {
        if(!p.uuid && !p.name) return;
        const id = p.uuid || p.name;
        if(!playersMap.has(id)) {
            playersMap.set(id, { 
                name: p.name || 'Unknown', 
                uuid: p.uuid || '?', 
                whitelisted: false, 
                op: false, 
                banned: false,
                online: false 
            });
        }
        if(source === 'whitelist') playersMap.get(id).whitelisted = true;
        if(source === 'ops') playersMap.get(id).op = true;
        if(source === 'banned') playersMap.get(id).banned = true;
    };

    data.cache.forEach(p => add(p, 'cache'));
    data.whitelist.forEach(p => add(p, 'whitelist'));
    data.ops.forEach(p => add(p, 'ops'));
    data.banned.forEach(p => add(p, 'banned'));

    const tbody = document.getElementById('player-list-body');
    tbody.innerHTML = '';

    playersMap.forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><div class="online-dot ${p.online ? 'on' : 'off'}"></div></td>
            <td>${p.name}</td>
            <td style="font-size:10px; color:#666;">${p.uuid}</td>
            <td><label class="switch"><input type="checkbox" ${p.whitelisted ? 'checked' : ''} onchange="togglePlayer('${p.name}', 'whitelist', this.checked)"><span class="slider round"></span></label></td>
            <td><label class="switch"><input type="checkbox" ${p.op ? 'checked' : ''} onchange="togglePlayer('${p.name}', 'op', this.checked)"><span class="slider round"></span></label></td>
            <td><label class="switch"><input type="checkbox" ${p.banned ? 'checked' : ''} onchange="togglePlayer('${p.name}', 'ban', this.checked)"><span class="slider round"></span></label></td>
        `;
        tbody.appendChild(tr);
    });
}

window.togglePlayer = async (name, type, state) => {
    let cmd = "";
    if(type === 'whitelist') cmd = `whitelist ${state ? 'add' : 'remove'} ${name}`;
    if(type === 'op') cmd = state ? `op ${name}` : `deop ${name}`;
    if(type === 'ban') cmd = state ? `ban ${name}` : `pardon ${name}`;
    
    await window.api.sendCommand(cmd);
};
