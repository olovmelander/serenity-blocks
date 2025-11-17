import { app, BrowserWindow, screen, ipcMain } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Enable GPU acceleration for WSL2/Linux
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-webgl');
app.commandLine.appendSwitch('enable-accelerated-2d-canvas');

// Force high-performance GPU on multi-GPU systems (e.g., NVIDIA over integrated graphics)
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('use-angle', 'gl'); // Use native OpenGL/Direct3D
app.commandLine.appendSwitch('use-gl', 'desktop'); // Use desktop GL instead of ANGLE
app.commandLine.appendSwitch('enable-native-gpu-memory-buffers');
app.commandLine.appendSwitch('enable-accelerated-video-decode');
app.commandLine.appendSwitch('disable-gpu-driver-bug-workarounds');

let mainWindow;
let currentVSyncEnabled = null;

function applyVSyncSettings(enabled) {
  const target = !!enabled;

  if (currentVSyncEnabled === target) {
    return;
  }

  currentVSyncEnabled = target;

  if (target) {
    app.commandLine.removeSwitch('disable-frame-rate-limit');
    app.commandLine.removeSwitch('disable-gpu-vsync');
    console.log('[Electron] VSync enabled (default renderer timing)');
  } else {
    app.commandLine.appendSwitch('disable-frame-rate-limit');
    app.commandLine.appendSwitch('disable-gpu-vsync');
    console.log('[Electron] VSync disabled (manual frame timing)');
  }
}

// Apply default VSync configuration (enabled by default)
applyVSyncSettings(true);

// ============================================================================
// IPC Handlers for Display Management
// ============================================================================

/**
 * Get all available displays
 */
ipcMain.handle('get-displays', () => {
  return screen.getAllDisplays().map(display => ({
    id: display.id,
    bounds: display.bounds,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor,
    rotation: display.rotation,
    internal: display.internal
  }));
});

/**
 * Set fullscreen mode
 */
ipcMain.handle('set-fullscreen', (event, enable) => {
  if (mainWindow) {
    mainWindow.setFullScreen(enable);
    return true;
  }
  return false;
});

/**
 * Set borderless window (fullscreen window without borders)
 */
ipcMain.handle('set-borderless', (event, resolution) => {
  if (!mainWindow) return false;

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = resolution || primaryDisplay.workArea;

  mainWindow.setFullScreen(false);
  mainWindow.setBounds({
    x: 0,
    y: 0,
    width,
    height
  });
  mainWindow.setResizable(false);
  mainWindow.setMaximizable(false);

  return true;
});

/**
 * Set windowed mode with specific resolution
 */
ipcMain.handle('set-windowed', (event, resolution) => {
  if (!mainWindow) return false;

  mainWindow.setFullScreen(false);
  mainWindow.setResizable(true);
  mainWindow.setMaximizable(true);

  if (resolution) {
    const { width, height } = resolution;
    mainWindow.setSize(width, height);
    mainWindow.center();
  }

  return true;
});

/**
 * Set window resolution
 */
ipcMain.handle('set-resolution', (event, { width, height }) => {
  if (!mainWindow) return false;

  mainWindow.setSize(width, height);
  mainWindow.center();
  return true;
});

/**
 * Get current window bounds
 */
ipcMain.handle('get-window-bounds', () => {
  if (!mainWindow) return null;
  return mainWindow.getBounds();
});

/**
 * Check if window is fullscreen
 */
ipcMain.handle('is-fullscreen', () => {
  if (!mainWindow) return false;
  return mainWindow.isFullScreen();
});

/**
 * Toggle VSync settings
 */
ipcMain.handle('set-vsync', (event, enable) => {
  applyVSyncSettings(enable);
  if (!app.isReady()) {
    return currentVSyncEnabled;
  }

  if (mainWindow?.webContents?.setFrameRate) {
    // When VSync is disabled, Electron will honor manual frame rate caps.
    const fallbackFPS = 240;
    try {
      const target = currentVSyncEnabled ? 60 : fallbackFPS;
      mainWindow.webContents.setFrameRate(target);
      console.log(`[Electron] webContents frame rate hint set to ${target} FPS`);
    } catch (error) {
      console.warn('[Electron] Failed to set webContents frame rate hint:', error);
    }
  }

  return currentVSyncEnabled;
});

// ============================================================================
// Window Creation
// ============================================================================

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workArea;

  mainWindow = new BrowserWindow({
    width: Math.min(1280, width),
    height: Math.min(720, height),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    title: 'Serenity Blocks',
    backgroundColor: '#000000',
    show: false, // Don't show until ready to prevent flicker
  });

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Load Vite dev server (development mode)
  if (process.env.NODE_ENV !== 'production') {
    mainWindow.loadURL('http://localhost:5173');
    
    // Open DevTools for debugging
    mainWindow.webContents.openDevTools();
  } else {
    // Load built files (production mode)
    mainWindow.loadFile(join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
