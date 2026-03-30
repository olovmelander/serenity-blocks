/**
 * Minimal preload script — stubs all renderer-expected globals
 * so the web app doesn't crash on missing Electron APIs.
 */
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  isPackaged: false,
  getDesktopRuntimeConfig: async () => ({
    isPackagedWindowsApp: false,
    isElectron: true,
  }),
  onRuntimeEvent: () => () => {},
});

contextBridge.exposeInMainWorld('electronDisplay', {
  getDisplays: async () => [],
  setFullscreen: async () => {},
  setBorderless: async () => {},
  setWindowed: async () => {},
  setResolution: async () => {},
  getWindowBounds: async () => ({ x: 0, y: 0, width: 1280, height: 720 }),
  isFullscreen: async () => false,
  setVSync: async () => {},
});

contextBridge.exposeInMainWorld('steamworks', null);
