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
    if(pageId === 'backups') refreshBackups();
};

async function init() {
    const hasConfig = await window.api.checkConfig();
    if (!hasConfig) {
        document.getElementById('setup-modal').style.display = 'flex';
    } else {
        document.getElementById('setup-modal').style.display = 'none';
        currentConfig = await window.api.getConfig();
        startStatsLoop();
    }
}
init();

// ==========================================
// 2. SETUP WIZARD (ENHANCED)
// ==========================================

// Tabs Logic
window.switchSetupTab = (tab) => {
    document.querySelectorAll('.setup-tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    
    document.getElementById(`tab-${tab}`).classList.add('active');
    const btns = document.querySelectorAll('.tab-btn');
    if(tab === 'create') btns[0].classList.add('active');
    else btns[1].classList.add('active');
};

// --- IMPORT EXISTING LOGIC ---
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
        await window.api.saveSetup(folder, jar, ram, rconPort, rconPw);
        document.getElementById('setup-modal').style.display = 'none';
        currentConfig = await window.api.getConfig();
        startStatsLoop();
    } else {
        alert("Please ensure all fields are valid.");
    }
};

// --- CREATE NEW LOGIC ---
let selectedSoftware = null;
let installPath = null;
let softwareVersions = [];

document.getElementById('btn-create-folder').onclick = async () => {
    const path = await window.api.selectFolder();
    if (path) {
        installPath = path;
        document.getElementById('create-path-display').innerText = path;
        checkInstallReady();
    }
};

window.selectSoftware = async (type) => {
    selectedSoftware = type;
    document.querySelectorAll('.soft-card').forEach(c => c.classList.remove('active'));
    document.getElementById(`soft-${type}`).classList.add('active');
    
    const verSelect = document.getElementById('version-select');
    verSelect.innerHTML = '<option>Fetching versions...</option>';
    verSelect.disabled = true;

    try {
        softwareVersions = await fetchVersions(type);
        verSelect.innerHTML = softwareVersions.map(v => `<option value="${v}">${v}</option>`).join('');
        verSelect.disabled = false;
    } catch (e) {
        verSelect.innerHTML = `<option>Error: ${e.message}</option>`;
    }
    checkInstallReady();
};

async function fetchVersions(type) {
    if (type === 'paper') {
        const res = await fetch('https://api.papermc.io/v2/projects/paper');
        const data = await res.json();
        return data.versions.reverse();
    } 
    else if (type === 'purpur') {
        const res = await fetch('https://api.purpurmc.org/v2/purpur');
        const data = await res.json();
        return data.versions.reverse();
    }
    else if (type === 'vanilla') {
        const res = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
        const data = await res.json();
        return data.versions.filter(v => v.type === 'release').map(v => v.id);
    }
    return [];
}

async function getDownloadUrl(type, version) {
    if (type === 'paper') {
        const res = await fetch(`https://api.papermc.io/v2/projects/paper/versions/${version}/builds`);
        const data = await res.json();
        const latestBuild = data.builds[data.builds.length - 1];
        const file = latestBuild.downloads.application.name;
        return `https://api.papermc.io/v2/projects/paper/versions/${version}/builds/${latestBuild.build}/downloads/${file}`;
    }
    else if (type === 'purpur') {
        return `https://api.purpurmc.org/v2/purpur/${version}/latest/download`;
    }
    else if (type === 'vanilla') {
        const res = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
        const data = await res.json();
        const verData = data.versions.find(v => v.id === version);
        const verRes = await fetch(verData.url);
        const verJson = await verRes.json();
        return verJson.downloads.server.url;
    }
}

function checkInstallReady() {
    const btn = document.getElementById('btn-install-server');
    btn.disabled = !(installPath && selectedSoftware && document.getElementById('version-select').value);
}

document.getElementById('btn-install-server').onclick = async () => {
    const status = document.getElementById('install-status');
    const version = document.getElementById('version-select').value;
    const ram = document.getElementById('create-ram').value;
    const port = document.getElementById('create-port').value;
    
    if (!installPath || !selectedSoftware) return;

    try {
        status.innerText = "Fetching download URL...";
        const url = await getDownloadUrl(selectedSoftware, version);
        
        status.innerText = `Downloading ${selectedSoftware} ${version}...`;
        const filename = `${selectedSoftware}-${version}.jar`;
        
        await window.api.downloadFile(url, installPath, filename);
        
        status.innerText = "Configuring EULA...";
        await window.api.initEula(installPath);
        
        status.innerText = "Saving Configuration...";
        
        const rconPw = "admin" + Math.floor(Math.random() * 1000);
        
        // FIX: Save Setup FIRST so main.js knows the folderPath for subsequent file ops
        await window.api.saveSetup(installPath, filename, ram, "25575", rconPw);

        // Create basic server.properties
        const props = `server-port=${port}\nenable-rcon=true\nrcon.port=25575\nrcon.password=${rconPw}\nmax-players=20\n`;
        
        // FIX: Use relative path now that config is saved
        await window.api.saveFile('server.properties', props);
        
        status.innerText = "Done! Starting application...";
        setTimeout(() => {
            document.getElementById('setup-modal').style.display = 'none';
            window.location.reload();
        }, 1000);

    } catch (e) {
        status.innerText = "Error: " + e;
        console.error(e);
        alert("An error occurred during installation: " + e.message);
    }
};

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
// 6. BACKUP MANAGER
// ==========================================
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
                <button class="btn-action restart" onclick="restoreBackup('${b.name}')">Restore</button>
                <button class="btn-action stop" onclick="deleteBackup('${b.name}')">Delete</button>
            </div>
        </div>
    `).join('');
}

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
        refreshFiles(''); // Refresh files view if open
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
// 7. SETTINGS & PROPERTIES
// ==========================================
let propertiesData = {};

async function loadSettingsPage() {
    const cfg = await window.api.getConfig();
    
    const slider = document.getElementById('set-ram');
    slider.value = cfg.ram;
    document.getElementById('ram-disp').innerText = cfg.ram + ' GB';
    
    slider.oninput = (e) => {
        document.getElementById('ram-disp').innerText = e.target.value + ' GB';
    };

    document.getElementById('set-rcon-port').value = cfg.rconPort || '25575';
    document.getElementById('set-rcon-pw').value = cfg.rconPw || '';

    const rawProps = await window.api.readProps();
    propertiesData = parseProperties(rawProps);
    
    const setVal = (id, key) => {
        const el = document.getElementById(id);
        if(el.type === 'checkbox') el.checked = propertiesData[key] === 'true';
        else el.value = propertiesData[key] || '';
    };

    setVal('prop-max-players', 'max-players');
    setVal('prop-view-distance', 'view-distance');
    setVal('prop-gamemode', 'gamemode');
    setVal('prop-difficulty', 'difficulty');
    setVal('prop-motd', 'motd');
    setVal('prop-white-list', 'white-list');

    renderMotd();
}

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

document.getElementById('btn-save-settings').onclick = async () => {
    const ram = document.getElementById('set-ram').value;
    const rconPort = document.getElementById('set-rcon-port').value;
    const rconPw = document.getElementById('set-rcon-pw').value;
    const cfg = await window.api.getConfig();
    
    await window.api.saveSetup(cfg.folderPath, cfg.jarFile, ram, rconPort, rconPw);

    const getVal = (id) => {
        const el = document.getElementById(id);
        return el.type === 'checkbox' ? el.checked : el.value;
    };

    propertiesData['max-players'] = getVal('prop-max-players');
    propertiesData['view-distance'] = getVal('prop-view-distance');
    propertiesData['gamemode'] = getVal('prop-gamemode');
    propertiesData['difficulty'] = getVal('prop-difficulty');
    propertiesData['motd'] = getVal('prop-motd');
    propertiesData['white-list'] = getVal('prop-white-list');

    let newContent = "";
    for(const [key, val] of Object.entries(propertiesData)) {
        newContent += `${key}=${val}\n`;
    }
    await window.api.saveProps(newContent);
    alert("Settings Saved! Restart server to apply changes.");
};

function parseProperties(text) {
    const props = {};
    text.split('\n').forEach(line => {
        if(line.startsWith('#') || !line.includes('=')) return;
        const [k, v] = line.split('=');
        props[k.trim()] = v ? v.trim() : '';
    });
    return props;
}

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

document.getElementById('btn-reset-data').onclick = async () => {
    const confirmed = confirm("Are you sure? This will forget your server folder and JAR settings. (It won't delete your actual Minecraft files).");
    if (confirmed) {
        await window.api.resetConfig();
        window.location.reload(); 
    }
};