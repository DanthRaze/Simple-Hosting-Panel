const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // Config
    checkConfig: () => ipcRenderer.invoke('check-config'),
    getConfig: () => ipcRenderer.invoke('get-config'),
    saveSetup: (f, j, r, rp, rpw, ab, ar) => ipcRenderer.invoke('save-setup', f, j, r, rp, rpw, ab, ar),
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    scanJars: (p) => ipcRenderer.invoke('scan-jars', p),
    resetConfig: () => ipcRenderer.invoke('reset-config'),
    uploadServerIcon: () => ipcRenderer.invoke('upload-server-icon'),
    onServerIconUpdated: (cb) => ipcRenderer.on('server-icon-updated', cb),

    // Network
    getPublicIP: () => ipcRenderer.invoke('get-public-ip'),

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
    getServerIcon: () => ipcRenderer.invoke('get-server-icon'),

    // Installation & Backups
    downloadFile: (url, folder, name) => ipcRenderer.invoke('download-file', url, folder, name),
    initEula: (folder) => ipcRenderer.invoke('init-eula', folder),
    createBackup: () => ipcRenderer.invoke('create-backup'),
    listBackups: () => ipcRenderer.invoke('list-backups'),
    restoreBackup: (name) => ipcRenderer.invoke('restore-backup', name),
    deleteBackup: (name) => ipcRenderer.invoke('delete-backup', name),

    // Google Drive
    checkDriveStatus: () => ipcRenderer.invoke('gdrive-status'),
    loginDrive: () => ipcRenderer.invoke('gdrive-login'),
    logoutDrive: () => ipcRenderer.invoke('gdrive-logout'),
    uploadDrive: (name) => ipcRenderer.invoke('gdrive-upload', name),

    // MCServerJars API
    getMcProjects: () => ipcRenderer.invoke('get-mc-projects'),
    getMcVersions: (slug) => ipcRenderer.invoke('get-mc-versions', slug),
    getMcLatestBuild: (slug, version) => ipcRenderer.invoke('get-mc-latest-build', slug, version),

    // Events
    onConsole: (cb) => ipcRenderer.on('console-log', (e, d) => cb(d)),
    onStatus: (cb) => ipcRenderer.on('server-status', (e, s) => cb(s)),
    downloadPlugin: (url, filename, type) => ipcRenderer.invoke('download-plugin', url, filename, type),
    updateSchedules: (config) => ipcRenderer.invoke('update-schedules', config),

    // Discord
    saveDiscordSettings: (token, enabled) => ipcRenderer.invoke('save-discord-settings', token, enabled),
    getDiscordLink: (token) => ipcRenderer.invoke('get-discord-link', token),
});