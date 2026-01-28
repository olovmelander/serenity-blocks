/**
 * Electron Preload Script for Steamworks.js Integration
 * 
 * This script runs in the renderer process with access to both
 * the DOM and Node.js APIs. It safely exposes Steam functionality
 * to the renderer via contextBridge.
 */

const { contextBridge, ipcRenderer } = require('electron');

// Expose Steam API to the renderer process
contextBridge.exposeInMainWorld('steamworks', {
    // Steam initialization status
    isInitialized: () => ipcRenderer.invoke('steam:isInitialized'),

    // Steam ID and player info
    getSteamId: () => ipcRenderer.invoke('steam:getSteamId'),
    getPlayerName: () => ipcRenderer.invoke('steam:getPlayerName'),

    // Steam running check
    isSteamRunning: () => ipcRenderer.invoke('steam:isSteamRunning'),

    // Lobby functions
    createLobby: (options) => ipcRenderer.invoke('steam:createLobby', options),
    joinLobby: (lobbyId) => ipcRenderer.invoke('steam:joinLobby', lobbyId),
    leaveLobby: () => ipcRenderer.invoke('steam:leaveLobby'),
    getLobbies: () => ipcRenderer.invoke('steam:getLobbies'),
    getLobbyData: (lobbyId, key) => ipcRenderer.invoke('steam:getLobbyData', lobbyId, key),
    setLobbyData: (lobbyId, key, value) => ipcRenderer.invoke('steam:setLobbyData', lobbyId, key, value),
    getLobbyMembers: (lobbyId) => ipcRenderer.invoke('steam:getLobbyMembers', lobbyId),
    getLobbyOwner: (lobbyId) => ipcRenderer.invoke('steam:getLobbyOwner', lobbyId),

    // P2P Networking
    sendP2PPacket: (steamId, data, sendType, channel) =>
        ipcRenderer.invoke('steam:sendP2PPacket', steamId, data, sendType, channel),
    readP2PPacket: (channel) => ipcRenderer.invoke('steam:readP2PPacket', channel),
    isP2PPacketAvailable: (channel) => ipcRenderer.invoke('steam:isP2PPacketAvailable', channel),
    closeP2PSession: (steamId) => ipcRenderer.invoke('steam:closeP2PSession', steamId),

    // Events from main process
    onLobbyJoined: (callback) => {
        ipcRenderer.on('steam:lobbyJoined', (event, data) => callback(data));
    },
    onLobbyLeft: (callback) => {
        ipcRenderer.on('steam:lobbyLeft', (event, data) => callback(data));
    },
    onP2PPacket: (callback) => {
        ipcRenderer.on('steam:p2pPacket', (event, data) => callback(data));
    },
    onPlayerJoined: (callback) => {
        ipcRenderer.on('steam:playerJoined', (event, data) => callback(data));
    },
    onPlayerLeft: (callback) => {
        ipcRenderer.on('steam:playerLeft', (event, data) => callback(data));
    },
});

// Expose display/window management APIs (existing functionality)
contextBridge.exposeInMainWorld('electronDisplay', {
    getDisplays: () => ipcRenderer.invoke('get-displays'),
    setFullscreen: (enable) => ipcRenderer.invoke('set-fullscreen', enable),
    setBorderless: (resolution) => ipcRenderer.invoke('set-borderless', resolution),
    setWindowed: (resolution) => ipcRenderer.invoke('set-windowed', resolution),
    setResolution: (width, height) => ipcRenderer.invoke('set-resolution', { width, height }),
    getWindowBounds: () => ipcRenderer.invoke('get-window-bounds'),
    isFullscreen: () => ipcRenderer.invoke('is-fullscreen'),
    setVSync: (enable) => ipcRenderer.invoke('set-vsync', enable),
});
