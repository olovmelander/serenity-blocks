/**
 * Serenity Blocks Electron preload.
 *
 * Context-isolated bridge between renderer and main process.
 */

const { contextBridge, ipcRenderer } = require('electron');

const allowedInvokeChannels = new Set([
    'get-displays', 'set-fullscreen', 'set-borderless', 'set-windowed',
    'set-resolution', 'get-window-bounds', 'is-fullscreen', 'set-vsync',
    'get-gpu-diagnostics', 'set-active-gpu-renderer',
    'desktop:get-runtime-config', 'desktop:get-process-metrics',
    'desktop:get-gpu-health', 'desktop:get-devtools-diagnostics',
    'desktop:get-debug-tools-status', 'desktop:open-devtools',
    'desktop:open-renderer-debugger', 'desktop:get-log-paths',
    'desktop:apply-runtime-profile', 'desktop:store-performance-report',
    'desktop:startup-mark',
    'steam:isInitialized', 'steam:getSteamId', 'steam:getPlayerName',
    'steam:getAppId', 'steam:getConnectionStatus', 'steam:getCapabilities',
    'steam:isSteamRunning', 'steam:checkConnection', 'steam:getAvatar',
    'steam:setRichPresence', 'steam:clearRichPresence',
    'steam:getStat', 'steam:setStat', 'steam:setStatMax',
    'steam:incrementStat', 'steam:storeStats', 'steam:getStats',
    'steam:uploadScore', 'steam:getLeaderboard', 'steam:getLeaderboardEntry',
    'steam:cloudWrite', 'steam:cloudRead', 'steam:cloudDelete',
    'steam:cloudExists', 'steam:cloudGetQuota', 'steam:cloudGetTimestamp',
    'steam:getFriends', 'steam:getPersonaState',
    'steam:inviteToLobby', 'steam:openLobbyInviteDialog',
    'steam:activateOverlay', 'steam:activateOverlayToUser',
    'steam:createLobby', 'steam:joinLobby', 'steam:leaveLobby',
    'steam:getLobbies', 'steam:getLobbyData', 'steam:setLobbyData',
    'steam:getLobbyMembers', 'steam:getLobbyOwner',
    'steam:sendP2PPacket', 'steam:readP2PPacket',
    'steam:isP2PPacketAvailable', 'steam:closeP2PSession',
    'steam:getDiagnostics',
]);

const allowedEventChannels = new Set([
    'steam:lobbyJoinRequested',
    'steam:serverConnection',
    'steam:status',
    'desktop:runtime-event',
]);

function invoke(channel, ...args) {
    if (!allowedInvokeChannels.has(channel)) {
        throw new Error(`IPC channel not allowed: ${channel}`);
    }
    return ipcRenderer.invoke(channel, ...args);
}

function on(channel, callback) {
    if (!allowedEventChannels.has(channel)) {
        throw new Error(`Event channel not allowed: ${channel}`);
    }
    const wrapped = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld('steamworks', {
    isInitialized: () => invoke('steam:isInitialized'),
    getSteamId: () => invoke('steam:getSteamId'),
    getPlayerName: () => invoke('steam:getPlayerName'),
    isSteamRunning: () => invoke('steam:isSteamRunning'),

    createLobby: (options) => invoke('steam:createLobby', options),
    joinLobby: (lobbyId) => invoke('steam:joinLobby', lobbyId),
    leaveLobby: () => invoke('steam:leaveLobby'),
    getLobbies: () => invoke('steam:getLobbies'),
    getLobbyData: (lobbyId, key) => invoke('steam:getLobbyData', lobbyId, key),
    setLobbyData: (lobbyId, key, value) => invoke('steam:setLobbyData', lobbyId, key, value),
    getLobbyMembers: (lobbyId) => invoke('steam:getLobbyMembers', lobbyId),
    getLobbyOwner: (lobbyId) => invoke('steam:getLobbyOwner', lobbyId),

    sendP2PPacket: (steamId, data, sendType, channel) =>
        invoke('steam:sendP2PPacket', steamId, data, sendType, channel),
    readP2PPacket: (channel) => invoke('steam:readP2PPacket', channel),
    isP2PPacketAvailable: (channel) => invoke('steam:isP2PPacketAvailable', channel),
    closeP2PSession: (steamId) => invoke('steam:closeP2PSession', steamId),

    onLobbyJoinRequested: (callback) => on('steam:lobbyJoinRequested', callback),
    onServerConnection: (callback) => on('steam:serverConnection', callback),
    onStatus: (callback) => on('steam:status', callback),
});

contextBridge.exposeInMainWorld('electronDisplay', {
    getDisplays: () => invoke('get-displays'),
    setFullscreen: (enable) => invoke('set-fullscreen', enable),
    setBorderless: (resolution) => invoke('set-borderless', resolution),
    setWindowed: (resolution) => invoke('set-windowed', resolution),
    setResolution: (width, height) => invoke('set-resolution', { width, height }),
    getWindowBounds: () => invoke('get-window-bounds'),
    isFullscreen: () => invoke('is-fullscreen'),
    setVSync: (enable) => invoke('set-vsync', enable),
});

contextBridge.exposeInMainWorld('electronAPI', {
    invoke,
    getDesktopRuntimeConfig: () => invoke('desktop:get-runtime-config'),
    getProcessMetrics: () => invoke('desktop:get-process-metrics'),
    getGPUHealth: () => invoke('desktop:get-gpu-health'),
    getDevToolsDiagnostics: () => invoke('desktop:get-devtools-diagnostics'),
    getDebugToolsStatus: () => invoke('desktop:get-debug-tools-status'),
    getLogPaths: () => invoke('desktop:get-log-paths'),
    openDevTools: () => invoke('desktop:open-devtools'),
    openRendererDebugger: () => invoke('desktop:open-renderer-debugger'),
    applyRuntimeProfile: (profileName) => invoke('desktop:apply-runtime-profile', profileName),
    storeDesktopPerformanceReport: (payload) => invoke('desktop:store-performance-report', payload),
    getGPUDiagnostics: () => invoke('get-gpu-diagnostics'),
    on,
    onRuntimeEvent: (callback) => on('desktop:runtime-event', callback),
    reportActiveGPURenderer: (renderer) => invoke('set-active-gpu-renderer', renderer),
});
