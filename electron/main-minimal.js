/**
 * Minimal Electron wrapper — baseline test.
 *
 * Usage:
 *   npm run electron:minimal          (with Vite dev server running)
 *   npm run electron:minimal:packaged (loads dist/index.html)
 *
 * This file intentionally has NO:
 *   - Steam integration
 *   - GPU command-line switches (beyond high-performance GPU)
 *   - Structured logging / diagnostics
 *   - Startup reveal gates
 *   - Managed DevTools host windows
 *   - Runtime profiles
 *   - Crash reporter
 *
 * Purpose: prove the web app works in Electron with zero interference,
 * then incrementally add features back to identify what breaks.
 */

import { app, BrowserWindow, screen, Menu } from 'electron';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isPackaged = app.isPackaged;

// Use the discrete GPU on laptops with dual GPUs
app.commandLine.appendSwitch('force-high-performance-gpu');

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow = null;

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workArea;

  mainWindow = new BrowserWindow({
    width: isPackaged ? width : Math.min(1280, width),
    height: isPackaged ? height : Math.min(720, height),
    title: 'Serenity Blocks',
    backgroundColor: '#000000',
    show: true,
    webPreferences: {
      preload: join(__dirname, 'preload-minimal.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  if (isPackaged) {
    mainWindow.maximize();
  }

  // Simple menu with DevTools and reload
  const menu = Menu.buildFromTemplate([
    {
      label: 'View',
      submenu: [
        { role: 'toggleDevTools', accelerator: 'F12' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'reload', accelerator: 'F5' },
        { role: 'forceReload' },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);

  // Load content
  if (isPackaged) {
    const indexPath = join(app.getAppPath(), 'dist', 'index.html');
    mainWindow.loadFile(indexPath).catch((err) => {
      console.error('Failed to load dist/index.html:', err);
    });
  } else {
    mainWindow.loadURL('http://localhost:5173').catch((err) => {
      console.error('Failed to load dev server:', err);
    });
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
