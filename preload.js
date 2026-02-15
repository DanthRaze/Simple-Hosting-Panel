const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // Config
    checkConfig: () => ipcRenderer.invoke('check-config'),
    getConfig: () => ipcRenderer.invoke('get-config'),
    saveSetup: (f, j, r, rp, rpw) => ipcRenderer.invoke('save-setup', f, j, r, rp, rpw),
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    scanJars: (p) => ipcRenderer.invoke('scan-jars', p),
    resetConfig: () => ipcRenderer.invoke('reset-config'),

    // Server Control
    startServer: () => ipcRenderer.invoke('start-server'),
    stopServer: () => ipcRenderer.invoke('stop-server'),
    killServer: () => ipcRenderer.invoke('kill-server'),
    sendCommand: (c) => ipcRenderer.invoke('send-command', c),
    getStats: () => ipcRenderer.invoke('get-stats'),

    // Files
    listFiles: (p) => ipcRenderer.invoke('list-files', p),
    readFile: (p) => ipcRenderer.invoke('read-file', p),
    saveFile: (p, c) => ipcRenderer.invoke('save-file', p, c),

    // Properties & Players
    readProps: () => ipcRenderer.invoke('read-properties'),
    saveProps: (c) => ipcRenderer.invoke('save-properties', c),
    getPlayersData: () => ipcRenderer.invoke('get-players-data'),
    getOnlinePlayers: () => ipcRenderer.invoke('get-online-players'),

    // Installation & Backups
    downloadFile: (url, folder, name) => ipcRenderer.invoke('download-file', url, folder, name),
    initEula: (folder) => ipcRenderer.invoke('init-eula', folder),
    createBackup: () => ipcRenderer.invoke('create-backup'),
    listBackups: () => ipcRenderer.invoke('list-backups'),
    restoreBackup: (name) => ipcRenderer.invoke('restore-backup', name),
    deleteBackup: (name) => ipcRenderer.invoke('delete-backup', name),

    // Events
    onConsole: (cb) => ipcRenderer.on('console-log', (e, d) => cb(d)),
    onStatus: (cb) => ipcRenderer.on('server-status', (e, s) => cb(s))
});