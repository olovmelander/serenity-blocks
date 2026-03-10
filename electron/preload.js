/**
 * Electron Preload Script for Steamworks.js Integration
 * 
 * This script runs in the renderer process with access to both
 * the DOM and Node.js APIs. It safely exposes Steam functionality
 * to the renderer via contextBridge.
 */

const { contextBridge, ipcRenderer } = require('electron');

const allowedInvokeChannels = new Set([
    'get-displays',
    'set-fullscreen',
    'set-borderless',
    'set-windowed',
    'set-resolution',
    'get-window-bounds',
    'is-fullscreen',
    'set-vsync',
    'steam:isInitialized',
    'steam:getSteamId',
    'steam:getPlayerName',
    'steam:getAppId',
    'steam:getConnectionStatus',
    'steam:getCapabilities',
    'steam:isSteamRunning',
    'steam:checkConnection',
    'steam:getAvatar',
    'steam:setRichPresence',
    'steam:clearRichPresence',
    'steam:getStat',
    'steam:setStat',
    'steam:setStatMax',
    'steam:incrementStat',
    'steam:storeStats',
    'steam:getStats',
    'steam:uploadScore',
    'steam:getLeaderboard',
    'steam:getLeaderboardEntry',
    'steam:cloudWrite',
    'steam:cloudRead',
    'steam:cloudDelete',
    'steam:cloudExists',
    'steam:cloudGetQuota',
    'steam:cloudGetTimestamp',
    'steam:getFriends',
    'steam:getPersonaState',
    'steam:inviteToLobby',
    'steam:openLobbyInviteDialog',
    'steam:activateOverlay',
    'steam:activateOverlayToUser',
    'steam:createLobby',
    'steam:joinLobby',
    'steam:leaveLobby',
    'steam:getLobbies',
    'steam:getLobbyData',
    'steam:setLobbyData',
    'steam:getLobbyMembers',
    'steam:getLobbyOwner',
    'steam:sendP2PPacket',
    'steam:readP2PPacket',
    'steam:isP2PPacketAvailable',
    'steam:closeP2PSession',
]);

const allowedEventChannels = new Set([
    'steam:lobbyJoinRequested',
    'steam:serverConnection',
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

// Expose Steam API to the renderer process
contextBridge.exposeInMainWorld('steamworks', {
    // Steam initialization status
    isInitialized: () => invoke('steam:isInitialized'),

    // Steam ID and player info
    getSteamId: () => invoke('steam:getSteamId'),
    getPlayerName: () => invoke('steam:getPlayerName'),

    // Steam running check
    isSteamRunning: () => invoke('steam:isSteamRunning'),

    // Lobby functions
    createLobby: (options) => invoke('steam:createLobby', options),
    joinLobby: (lobbyId) => invoke('steam:joinLobby', lobbyId),
    leaveLobby: () => invoke('steam:leaveLobby'),
    getLobbies: () => invoke('steam:getLobbies'),
    getLobbyData: (lobbyId, key) => invoke('steam:getLobbyData', lobbyId, key),
    setLobbyData: (lobbyId, key, value) => invoke('steam:setLobbyData', lobbyId, key, value),
    getLobbyMembers: (lobbyId) => invoke('steam:getLobbyMembers', lobbyId),
    getLobbyOwner: (lobbyId) => invoke('steam:getLobbyOwner', lobbyId),

    // P2P Networking
    sendP2PPacket: (steamId, data, sendType, channel) =>
        invoke('steam:sendP2PPacket', steamId, data, sendType, channel),
    readP2PPacket: (channel) => invoke('steam:readP2PPacket', channel),
    isP2PPacketAvailable: (channel) => invoke('steam:isP2PPacketAvailable', channel),
    closeP2PSession: (steamId) => invoke('steam:closeP2PSession', steamId),

    // Events from main process
    onLobbyJoinRequested: (callback) => on('steam:lobbyJoinRequested', callback),
    onServerConnection: (callback) => on('steam:serverConnection', callback),
});

// Expose display/window management APIs (existing functionality)
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
    on,
    onRuntimeEvent: (callback) => on('desktop:runtime-event', callback),
});
