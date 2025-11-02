# Graphics and Display Settings Implementation Guide
## Serenity Blocks - Phaser 4 + Electron

---

## Table of Contents

1. [Overview](#overview)
2. [Current System Analysis](#current-system-analysis)
3. [Architecture Design](#architecture-design)
4. [Implementation Phases](#implementation-phases)
   - [Phase 1: Resolution and Display Options](#phase-1-resolution-and-display-options)
   - [Phase 2: VSync and Frame Rate Control](#phase-2-vsync-and-frame-rate-control)
   - [Phase 3: Graphics Quality Presets](#phase-3-graphics-quality-presets)
   - [Phase 4: UI Integration](#phase-4-ui-integration)
   - [Phase 5: Testing and Optimization](#phase-5-testing-and-optimization)
5. [Data Structures](#data-structures)
6. [Performance Considerations](#performance-considerations)
7. [Best Practices](#best-practices)

---

## Overview

This guide provides a comprehensive implementation plan for adding advanced graphics and display settings to Serenity Blocks, a Phaser 4 + Electron puzzle game. The system will allow players to customize:

- **Resolution and Display Mode** (windowed, fullscreen, borderless)
- **VSync and Frame Rate Caps** (30, 60, 120, 144, unlimited)
- **Graphics Quality Presets** (Low, Medium, High, Ultra)
- **Individual Visual Effects** (ripples, combo effects, particles, etc.)

### Goals
- Provide optimal performance across different hardware configurations
- Maintain visual quality while allowing performance trade-offs
- Create an intuitive settings interface
- Persist user preferences across sessions
- Ensure smooth transitions when changing settings

---

## Current System Analysis

### Existing Architecture

**Current Technologies:**
- **Game Engine:** Phaser 4 (WebGL-only renderer)
- **Framework:** Electron 38.3.0
- **Rendering:** Custom WebGL renderer for backgrounds + Phaser scenes
- **Settings Storage:** localStorage via `SettingsManager` class

**Existing Settings (from [src/ui/settings.js](src/ui/settings.js)):**
```javascript
{
    // Visual Effects (already implemented)
    pieceLockRipple: true,
    comboPopupEffect: true,
    lineClearEffects: true,
    backgroundComboEffects: true,

    // Audio
    musicVolume: 1.0,
    sfxVolume: 1.0,

    // Controls
    gamepadDeadzone: 0.25,
    controlScheme: 'Keyboard',
    // ... key bindings
}
```

**Quality System (from [src/utils/quality.js](src/utils/quality.js)):**
Currently supports Low/Medium/High with basic settings:
```javascript
{
    High: { renderFrameSkip: 0, shakeMultiplier: 1, particles: true },
    Medium: { renderFrameSkip: 1, shakeMultiplier: 0.75, particles: true },
    Low: { renderFrameSkip: 2, shakeMultiplier: 0.5, particles: false }
}
```

**Phaser Configuration (from [src/main.js](src/main.js:339)):**
```javascript
const config = {
    type: Phaser.WEBGL,
    parent: 'game-container',
    transparent: true,
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: 800,
        height: 600
    },
    render: {
        antialias: true,
        pixelArt: false
    }
}
```

**Electron Window (from [electron/main.js](electron/main.js:18)):**
```javascript
mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
    }
})
```

---

## Architecture Design

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Display Settings Manager                  │
│  • Resolution control                                        │
│  • Display mode (fullscreen/windowed)                        │
│  • VSync & FPS management                                    │
│  • Quality preset coordination                               │
└─────────────────────────────────────────────────────────────┘
                            │
           ┌────────────────┼────────────────┐
           │                │                │
┌──────────▼──────┐  ┌─────▼─────┐  ┌──────▼──────┐
│  Electron API   │  │  Phaser   │  │   WebGL     │
│  (Window/Screen)│  │  Renderer │  │  Renderer   │
└─────────────────┘  └───────────┘  └─────────────┘
           │                │                │
           └────────────────┼────────────────┘
                            │
           ┌────────────────┼────────────────┐
           │                │                │
┌──────────▼──────┐  ┌─────▼─────┐  ┌──────▼──────┐
│  Settings UI    │  │localStorage│  │   Event     │
│  (Modal/Tabs)   │  │ Persistence│  │   System    │
└─────────────────┘  └───────────┘  └─────────────┘
```

### Technology Stack

| Component | API/Library | Purpose |
|-----------|-------------|---------|
| Window Control | Electron `BrowserWindow` API | Fullscreen, resolution, display management |
| Display Detection | Electron `screen` module | Get available displays and resolutions |
| Frame Rate | `requestAnimationFrame` + custom limiter | FPS capping and VSync control |
| Renderer Config | Phaser 4 Scale Manager | Canvas scaling and rendering settings |
| WebGL Effects | Custom WebGL renderer | Background effects quality control |
| Storage | `localStorage` API | Persist user preferences |
| UI | HTML/CSS + JavaScript | Settings modal and controls |

---

## Implementation Phases

### Phase 1: Resolution and Display Options

#### Objective
Enable players to change window resolution and toggle between windowed, fullscreen, and borderless window modes.

#### 1.1 Extend Settings Data Structure

**File:** `src/ui/settings.js`

Add to `DEFAULT_CONFIG`:
```javascript
const DEFAULT_CONFIG = {
    // ... existing settings ...

    // Display Settings (NEW)
    displayMode: 'windowed',        // 'windowed' | 'fullscreen' | 'borderless'
    resolution: 'auto',             // 'auto' | '1280x720' | '1920x1080' | '2560x1440' | '3840x2160'
    customResolution: null,         // { width: number, height: number } or null
    vsyncEnabled: true,
    targetFrameRate: 60,            // 30 | 60 | 120 | 144 | 240 | 0 (unlimited)
    graphicsQuality: 'High',        // 'Low' | 'Medium' | 'High' | 'Ultra'

    // Individual effect overrides (NEW)
    enableAntialiasing: true,
    enableMotionBlur: false,
    enableBloom: true,
    enableShadows: true,
    particleQuality: 'high',        // 'low' | 'medium' | 'high'
    textureQuality: 'high',         // 'low' | 'medium' | 'high'
};
```

#### 1.2 Create Display Manager Module

**File:** `src/core/display-manager.js` (NEW)

```javascript
/**
 * DisplayManager - Handles resolution, display modes, and window management
 * Works with Electron's screen and BrowserWindow APIs
 */

export class DisplayManager {
    constructor() {
        this.currentDisplay = null;
        this.availableResolutions = [];
        this.isElectron = this.detectElectron();
    }

    /**
     * Detect if running in Electron environment
     */
    detectElectron() {
        return typeof window !== 'undefined' &&
               window.process &&
               window.process.type === 'renderer';
    }

    /**
     * Get available displays and resolutions
     * Uses Electron's screen API if available
     */
    async getAvailableDisplays() {
        if (!this.isElectron) {
            // Web fallback - use screen API
            return [{
                id: 'primary',
                bounds: {
                    width: window.screen.width,
                    height: window.screen.height
                },
                workArea: {
                    width: window.screen.availWidth,
                    height: window.screen.availHeight
                }
            }];
        }

        // Electron environment - use IPC to get display info
        const { ipcRenderer } = require('electron');
        return await ipcRenderer.invoke('get-displays');
    }

    /**
     * Get common resolutions that fit within the current display
     */
    getCommonResolutions(maxWidth, maxHeight) {
        const commonResolutions = [
            { width: 1280, height: 720, label: '1280x720 (HD)' },
            { width: 1366, height: 768, label: '1366x768' },
            { width: 1600, height: 900, label: '1600x900 (HD+)' },
            { width: 1920, height: 1080, label: '1920x1080 (Full HD)' },
            { width: 2560, height: 1440, label: '2560x1440 (2K)' },
            { width: 3840, height: 2160, label: '3840x2160 (4K)' },
        ];

        return commonResolutions.filter(
            res => res.width <= maxWidth && res.height <= maxHeight
        );
    }

    /**
     * Set display mode (windowed, fullscreen, borderless)
     */
    async setDisplayMode(mode, resolution = null) {
        if (!this.isElectron) {
            // Web fallback - only fullscreen API available
            if (mode === 'fullscreen') {
                return this.requestFullscreen();
            } else {
                return this.exitFullscreen();
            }
        }

        const { ipcRenderer } = require('electron');

        switch (mode) {
            case 'fullscreen':
                await ipcRenderer.invoke('set-fullscreen', true);
                break;

            case 'borderless':
                await ipcRenderer.invoke('set-borderless', resolution);
                break;

            case 'windowed':
            default:
                await ipcRenderer.invoke('set-windowed', resolution);
                break;
        }
    }

    /**
     * Change window resolution (windowed mode only)
     */
    async setResolution(width, height) {
        if (!this.isElectron) {
            console.warn('Resolution change only available in Electron');
            return false;
        }

        const { ipcRenderer } = require('electron');
        await ipcRenderer.invoke('set-resolution', { width, height });
        return true;
    }

    /**
     * Fullscreen API (browser/web)
     */
    requestFullscreen() {
        const elem = document.documentElement;
        if (elem.requestFullscreen) {
            return elem.requestFullscreen();
        } else if (elem.webkitRequestFullscreen) {
            return elem.webkitRequestFullscreen();
        } else if (elem.msRequestFullscreen) {
            return elem.msRequestFullscreen();
        }
        return Promise.reject(new Error('Fullscreen not supported'));
    }

    exitFullscreen() {
        if (document.exitFullscreen) {
            return document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            return document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) {
            return document.msExitFullscreen();
        }
        return Promise.reject(new Error('Exit fullscreen not supported'));
    }

    /**
     * Check if currently in fullscreen
     */
    isFullscreen() {
        return !!(
            document.fullscreenElement ||
            document.webkitFullscreenElement ||
            document.msFullscreenElement
        );
    }

    /**
     * Listen for fullscreen changes
     */
    onFullscreenChange(callback) {
        const events = [
            'fullscreenchange',
            'webkitfullscreenchange',
            'msfullscreenchange'
        ];

        events.forEach(event => {
            document.addEventListener(event, () => {
                callback(this.isFullscreen());
            });
        });
    }
}
```

#### 1.3 Electron IPC Handlers

**File:** `electron/main.js` (MODIFY)

Add IPC handlers for display management:

```javascript
import { app, BrowserWindow, screen, ipcMain } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Enable GPU acceleration
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-webgl');
app.commandLine.appendSwitch('enable-accelerated-2d-canvas');

// Disable VSync (we'll control FPS manually for better control)
// Can be re-enabled via settings
app.commandLine.appendSwitch('disable-frame-rate-limit');

let mainWindow;

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
        show: false, // Don't show until ready
    });

    // Show window when ready to prevent flicker
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // Load content
    if (process.env.NODE_ENV !== 'production') {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
    } else {
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
```

#### 1.4 Integrate with Phaser Scale Manager

**File:** `src/main.js` (MODIFY)

Update the Phaser configuration to respond to resolution changes:

```javascript
import { DisplayManager } from './core/display-manager.js';

// In AppController class
class AppController {
    constructor() {
        // ... existing initialization ...
        this.displayManager = new DisplayManager();
    }

    /**
     * Apply display settings
     */
    async applyDisplaySettings(settings) {
        const { displayMode, resolution, customResolution } = settings;

        // Parse resolution
        let width, height;
        if (resolution === 'auto') {
            const displays = await this.displayManager.getAvailableDisplays();
            const primary = displays[0];
            width = primary.workArea.width;
            height = primary.workArea.height;
        } else if (customResolution) {
            width = customResolution.width;
            height = customResolution.height;
        } else {
            // Parse resolution string like "1920x1080"
            const [w, h] = resolution.split('x').map(Number);
            width = w;
            height = h;
        }

        // Apply display mode
        await this.displayManager.setDisplayMode(
            displayMode,
            { width, height }
        );

        // Resize Phaser game if initialized
        if (this.phaserGame && this.phaserGame.scale) {
            this.phaserGame.scale.resize(width, height);
        }

        // Emit event for other systems to respond
        window.dispatchEvent(new CustomEvent('displaySettingsChanged', {
            detail: { displayMode, width, height }
        }));
    }
}
```

#### 1.5 Default Values and Best Practices

**Default Settings:**
- `displayMode`: `'windowed'` (safer default, doesn't force fullscreen)
- `resolution`: `'auto'` (adapts to user's display)
- `vsyncEnabled`: `true` (smoother by default)
- `targetFrameRate`: `60` (standard refresh rate)

**Performance Notes:**
- Fullscreen mode typically has better performance (less OS overhead)
- Borderless window good for multi-monitor setups
- Resolution changes require canvas recreation - keep debounced

---

### Phase 2: VSync and Frame Rate Control

#### Objective
Implement frame rate limiting and VSync control to balance performance and visual smoothness.

#### 2.1 Frame Rate Controller

**File:** `src/core/frame-rate-controller.js` (NEW)

```javascript
/**
 * FrameRateController - Manages FPS limiting and VSync
 */

export class FrameRateController {
    constructor() {
        this.targetFPS = 60;
        this.vsyncEnabled = true;
        this.actualFPS = 0;
        this.frameCount = 0;
        this.lastFrameTime = performance.now();
        this.lastFPSUpdate = performance.now();
        this.frameInterval = 1000 / 60; // 60 FPS default
        this.rafId = null;
        this.isRunning = false;

        // FPS tracking
        this.fpsHistory = [];
        this.maxFPSHistory = 60; // Track last 60 frames
    }

    /**
     * Set target frame rate
     * @param {number} fps - Target FPS (0 = unlimited)
     */
    setTargetFPS(fps) {
        this.targetFPS = fps;
        this.frameInterval = fps > 0 ? 1000 / fps : 0;
        console.log(`[FrameRate] Target FPS set to: ${fps === 0 ? 'Unlimited' : fps}`);
    }

    /**
     * Enable or disable VSync
     * @param {boolean} enabled
     */
    setVSync(enabled) {
        this.vsyncEnabled = enabled;
        console.log(`[FrameRate] VSync ${enabled ? 'enabled' : 'disabled'}`);

        // VSync in browser is controlled by requestAnimationFrame
        // When disabled, we can use setTimeout for more precise control
    }

    /**
     * Start the frame controller
     * @param {Function} callback - Function to call each frame
     */
    start(callback) {
        if (this.isRunning) {
            console.warn('[FrameRate] Already running');
            return;
        }

        this.isRunning = true;
        this.lastFrameTime = performance.now();
        this.lastFPSUpdate = performance.now();

        const loop = (currentTime) => {
            if (!this.isRunning) return;

            const deltaTime = currentTime - this.lastFrameTime;

            // FPS limiting logic
            if (this.targetFPS > 0) {
                // If not enough time has passed, skip this frame
                if (deltaTime < this.frameInterval) {
                    if (this.vsyncEnabled) {
                        this.rafId = requestAnimationFrame(loop);
                    } else {
                        // Use setTimeout for more precise timing when VSync is off
                        const remaining = this.frameInterval - deltaTime;
                        this.rafId = setTimeout(() => {
                            requestAnimationFrame(loop);
                        }, remaining);
                    }
                    return;
                }
            }

            // Update FPS counter
            this.frameCount++;
            const fpsElapsed = currentTime - this.lastFPSUpdate;
            if (fpsElapsed >= 1000) {
                this.actualFPS = Math.round((this.frameCount * 1000) / fpsElapsed);
                this.frameCount = 0;
                this.lastFPSUpdate = currentTime;

                // Track FPS history
                this.fpsHistory.push(this.actualFPS);
                if (this.fpsHistory.length > this.maxFPSHistory) {
                    this.fpsHistory.shift();
                }
            }

            // Call game loop callback
            if (callback) {
                callback(deltaTime, currentTime);
            }

            this.lastFrameTime = currentTime;

            // Schedule next frame
            if (this.vsyncEnabled) {
                this.rafId = requestAnimationFrame(loop);
            } else {
                // For non-VSync, use setTimeout + rAF for better control
                this.rafId = setTimeout(() => {
                    requestAnimationFrame(loop);
                }, this.frameInterval);
            }
        };

        // Start the loop
        if (this.vsyncEnabled) {
            this.rafId = requestAnimationFrame(loop);
        } else {
            this.rafId = setTimeout(() => {
                requestAnimationFrame(loop);
            }, 0);
        }
    }

    /**
     * Stop the frame controller
     */
    stop() {
        this.isRunning = false;
        if (this.rafId) {
            if (typeof this.rafId === 'number' && this.rafId > 0) {
                clearTimeout(this.rafId);
                cancelAnimationFrame(this.rafId);
            }
            this.rafId = null;
        }
    }

    /**
     * Get current FPS
     */
    getFPS() {
        return this.actualFPS;
    }

    /**
     * Get average FPS over last N frames
     */
    getAverageFPS() {
        if (this.fpsHistory.length === 0) return 0;
        const sum = this.fpsHistory.reduce((a, b) => a + b, 0);
        return Math.round(sum / this.fpsHistory.length);
    }

    /**
     * Get FPS statistics
     */
    getStats() {
        if (this.fpsHistory.length === 0) {
            return { current: 0, average: 0, min: 0, max: 0 };
        }

        return {
            current: this.actualFPS,
            average: this.getAverageFPS(),
            min: Math.min(...this.fpsHistory),
            max: Math.max(...this.fpsHistory),
        };
    }

    /**
     * Reset FPS statistics
     */
    resetStats() {
        this.fpsHistory = [];
        this.frameCount = 0;
        this.actualFPS = 0;
    }
}
```

#### 2.2 Integrate with Main Game Loop

**File:** `src/main.js` (MODIFY)

```javascript
import { FrameRateController } from './core/frame-rate-controller.js';

class AppController {
    constructor() {
        // ... existing initialization ...
        this.frameRateController = new FrameRateController();
    }

    async initializePhaser() {
        // ... existing Phaser initialization ...

        // Start custom frame rate controller
        const settings = this.settingsManager.get();
        this.applyFrameRateSettings(settings);

        // Replace default game loop with controlled loop
        this.frameRateController.start((deltaTime, currentTime) => {
            this.gameLoop(deltaTime, currentTime);
        });
    }

    /**
     * Apply frame rate settings
     */
    applyFrameRateSettings(settings) {
        const { vsyncEnabled, targetFrameRate } = settings;

        this.frameRateController.setVSync(vsyncEnabled);
        this.frameRateController.setTargetFPS(targetFrameRate);

        console.log('[Settings] Frame rate settings applied:', {
            vsync: vsyncEnabled,
            targetFPS: targetFrameRate
        });
    }

    /**
     * Main game loop (called by frame rate controller)
     */
    gameLoop(deltaTime, currentTime) {
        // Update Phaser systems
        if (this.phaserGame) {
            this.phaserGame.step(currentTime, deltaTime);
        }

        // Update WebGL renderer
        if (this.webglRenderer) {
            this.webglRenderer.render(deltaTime);
        }

        // Update game mode
        if (this.gameModeManager) {
            this.gameModeManager.update(deltaTime);
        }
    }

    /**
     * Show FPS counter in debug mode
     */
    showFPSCounter() {
        const fpsElement = document.getElementById('fps-counter');
        if (!fpsElement) {
            const div = document.createElement('div');
            div.id = 'fps-counter';
            div.style.position = 'fixed';
            div.style.top = '10px';
            div.style.right = '10px';
            div.style.background = 'rgba(0, 0, 0, 0.7)';
            div.style.color = '#0f0';
            div.style.padding = '8px 12px';
            div.style.fontFamily = 'monospace';
            div.style.fontSize = '14px';
            div.style.borderRadius = '4px';
            div.style.zIndex = '10000';
            document.body.appendChild(div);
        }

        setInterval(() => {
            const fps = this.frameRateController.getFPS();
            const stats = this.frameRateController.getStats();
            const elem = document.getElementById('fps-counter');
            if (elem) {
                elem.innerHTML = `
                    FPS: ${fps}<br>
                    Avg: ${stats.average}<br>
                    Min: ${stats.min} Max: ${stats.max}
                `;
            }
        }, 500);
    }
}
```

#### 2.3 VSync in Electron

For better VSync control in Electron, modify the launch flags:

**File:** `electron/main.js` (MODIFY)

```javascript
// VSync control via command line switches
function applyVSyncSettings(enabled) {
    if (enabled) {
        // Enable VSync (default)
        app.commandLine.removeSwitch('disable-frame-rate-limit');
        app.commandLine.removeSwitch('disable-gpu-vsync');
    } else {
        // Disable VSync for manual FPS control
        app.commandLine.appendSwitch('disable-frame-rate-limit');
        app.commandLine.appendSwitch('disable-gpu-vsync');
    }
}

// Apply from saved settings before creating window
app.whenReady().then(() => {
    // Load settings from localStorage simulation
    // (In Electron, you'd use electron-store or similar)
    const vsyncEnabled = true; // Load from config
    applyVSyncSettings(vsyncEnabled);

    createWindow();
});
```

#### 2.4 FPS Presets

Common FPS targets to offer:

```javascript
const FPS_PRESETS = {
    30: { label: '30 FPS (Battery Saver)', vsync: false },
    60: { label: '60 FPS (Standard)', vsync: true },
    120: { label: '120 FPS (High Refresh)', vsync: true },
    144: { label: '144 FPS (Gaming)', vsync: true },
    240: { label: '240 FPS (Pro)', vsync: false },
    0: { label: 'Unlimited (No Cap)', vsync: false },
};
```

**Performance Impact:**
- **30 FPS:** Lowest CPU/GPU usage, good for battery life
- **60 FPS:** Standard, smooth for most players
- **120+ FPS:** High refresh rate monitors only, more CPU/GPU intensive
- **Unlimited:** Maximum performance but can cause screen tearing without VSync

---

### Phase 3: Graphics Quality Presets

#### Objective
Create comprehensive quality presets that control multiple visual settings simultaneously.

#### 3.1 Enhanced Quality Configuration

**File:** `src/utils/quality.js` (MODIFY)

```javascript
/**
 * Enhanced quality configuration system
 * Defines four quality levels: Low, Medium, High, Ultra
 */

export const QUALITY_PRESETS = {
    Low: {
        id: 'Low',
        label: 'Low (Performance)',
        description: 'Minimum visual effects for best performance',

        // Rendering
        renderFrameSkip: 2,              // Render every 3rd frame
        targetFPS: 30,
        vsyncEnabled: false,

        // Effects
        particles: false,
        shakeMultiplier: 0.3,
        enableMotionBlur: false,
        enableBloom: false,
        enableShadows: false,
        enableAntialiasing: false,

        // Textures and quality
        textureQuality: 'low',           // Use compressed/downscaled textures
        particleQuality: 'low',
        maxParticles: 50,

        // Visual effects (existing system)
        pieceLockRipple: false,
        comboPopupEffect: true,          // Keep for gameplay feedback
        lineClearEffects: false,
        backgroundComboEffects: false,

        // Background rendering
        backgroundEffects: false,        // Disable WebGL background effects
        backgroundQuality: 0.5,          // 50% resolution for backgrounds

        // Phaser settings
        antialias: false,
        pixelArt: true,                  // Crisp pixels, no filtering
        roundPixels: true,
    },

    Medium: {
        id: 'Medium',
        label: 'Medium (Balanced)',
        description: 'Balanced visuals and performance',

        renderFrameSkip: 1,
        targetFPS: 60,
        vsyncEnabled: true,

        particles: true,
        shakeMultiplier: 0.65,
        enableMotionBlur: false,
        enableBloom: true,
        enableShadows: false,
        enableAntialiasing: true,

        textureQuality: 'medium',
        particleQuality: 'medium',
        maxParticles: 150,

        pieceLockRipple: true,
        comboPopupEffect: true,
        lineClearEffects: true,
        backgroundComboEffects: false,

        backgroundEffects: true,
        backgroundQuality: 0.75,

        antialias: true,
        pixelArt: false,
        roundPixels: false,
    },

    High: {
        id: 'High',
        label: 'High (Quality)',
        description: 'High quality visuals with good performance',

        renderFrameSkip: 0,
        targetFPS: 60,
        vsyncEnabled: true,

        particles: true,
        shakeMultiplier: 1.0,
        enableMotionBlur: false,
        enableBloom: true,
        enableShadows: true,
        enableAntialiasing: true,

        textureQuality: 'high',
        particleQuality: 'high',
        maxParticles: 300,

        pieceLockRipple: true,
        comboPopupEffect: true,
        lineClearEffects: true,
        backgroundComboEffects: true,

        backgroundEffects: true,
        backgroundQuality: 1.0,

        antialias: true,
        pixelArt: false,
        roundPixels: false,
    },

    Ultra: {
        id: 'Ultra',
        label: 'Ultra (Maximum)',
        description: 'Maximum visual quality - requires powerful hardware',

        renderFrameSkip: 0,
        targetFPS: 120,
        vsyncEnabled: true,

        particles: true,
        shakeMultiplier: 1.2,
        enableMotionBlur: true,
        enableBloom: true,
        enableShadows: true,
        enableAntialiasing: true,

        textureQuality: 'ultra',
        particleQuality: 'ultra',
        maxParticles: 500,

        pieceLockRipple: true,
        comboPopupEffect: true,
        lineClearEffects: true,
        backgroundComboEffects: true,

        backgroundEffects: true,
        backgroundQuality: 1.0,

        antialias: true,
        pixelArt: false,
        roundPixels: false,

        // Ultra-specific enhancements
        enableAdvancedLighting: true,
        enablePostProcessing: true,
        enableReflections: true,
    },
};

/**
 * Get quality configuration
 */
export function getQualityConfig(level) {
    const normalized = normalizeQuality(level);
    return QUALITY_PRESETS[normalized] || QUALITY_PRESETS.High;
}

/**
 * Normalize quality level string
 */
export function normalizeQuality(level) {
    if (!level) return 'High';
    const normalized = String(level).trim();

    const map = {
        'low': 'Low',
        'medium': 'Medium',
        'high': 'High',
        'ultra': 'Ultra',
    };

    return map[normalized.toLowerCase()] || 'High';
}

/**
 * Apply quality preset to settings
 */
export function applyQualityPreset(settingsManager, qualityLevel) {
    const config = getQualityConfig(qualityLevel);

    // Extract relevant settings
    const updates = {
        graphicsQuality: config.id,
        targetFrameRate: config.targetFPS,
        vsyncEnabled: config.vsyncEnabled,

        // Visual effects
        pieceLockRipple: config.pieceLockRipple,
        comboPopupEffect: config.comboPopupEffect,
        lineClearEffects: config.lineClearEffects,
        backgroundComboEffects: config.backgroundComboEffects,

        // Advanced settings
        enableAntialiasing: config.enableAntialiasing,
        enableMotionBlur: config.enableMotionBlur,
        enableBloom: config.enableBloom,
        enableShadows: config.enableShadows,
        particleQuality: config.particleQuality,
        textureQuality: config.textureQuality,
    };

    settingsManager.update(updates);
    settingsManager.save();

    return config;
}

/**
 * Check if current quality settings match a preset
 */
export function detectQualityPreset(settings) {
    for (const [level, preset] of Object.entries(QUALITY_PRESETS)) {
        const matches = (
            settings.targetFrameRate === preset.targetFPS &&
            settings.vsyncEnabled === preset.vsyncEnabled &&
            settings.pieceLockRipple === preset.pieceLockRipple &&
            settings.lineClearEffects === preset.lineClearEffects
        );

        if (matches) return level;
    }

    return 'Custom';
}

// Export individual getters for backwards compatibility
export function shouldRenderParticles(level) {
    return getQualityConfig(level).particles;
}

export function getShakeMultiplier(level) {
    return getQualityConfig(level).shakeMultiplier;
}

export function getRenderFrameSkip(level) {
    return getQualityConfig(level).renderFrameSkip;
}

export function getMaxParticles(level) {
    return getQualityConfig(level).maxParticles;
}

export function getBackgroundQuality(level) {
    return getQualityConfig(level).backgroundQuality;
}
```

#### 3.2 Apply Quality Settings to Renderers

**File:** `src/main.js` (MODIFY)

```javascript
import { getQualityConfig, applyQualityPreset } from './utils/quality.js';

class AppController {
    /**
     * Apply graphics quality settings
     */
    applyGraphicsQuality(quality) {
        const config = getQualityConfig(quality);
        console.log(`[Graphics] Applying quality preset: ${quality}`, config);

        // 1. Apply to frame rate controller
        if (this.frameRateController) {
            this.frameRateController.setTargetFPS(config.targetFPS);
            this.frameRateController.setVSync(config.vsyncEnabled);
        }

        // 2. Apply to WebGL background renderer
        if (this.webglRenderer) {
            this.webglRenderer.setQuality(config.backgroundQuality);
            this.webglRenderer.setEffectsEnabled(config.backgroundEffects);
        }

        // 3. Apply to Phaser renderer
        if (this.phaserGame) {
            // Phaser 4 renderer config updates
            const renderer = this.phaserGame.renderer;

            if (renderer && renderer.config) {
                renderer.config.antialias = config.antialias;
                renderer.config.roundPixels = config.roundPixels;
            }
        }

        // 4. Apply to effects systems
        if (this.boardScene && this.boardScene.effects) {
            this.boardScene.effects.setParticleLimit(config.maxParticles);
            this.boardScene.effects.setShakeMultiplier(config.shakeMultiplier);
        }

        // 5. Update theme manager
        if (this.themeManager) {
            this.themeManager.setQuality(quality);
        }

        // 6. Emit event for other systems
        window.dispatchEvent(new CustomEvent('graphicsQualityChanged', {
            detail: { quality, config }
        }));

        console.log(`[Graphics] Quality preset "${quality}" applied successfully`);
    }
}
```

#### 3.3 Performance Impact Table

| Setting | Low | Medium | High | Ultra | Impact |
|---------|-----|--------|------|-------|--------|
| **FPS Target** | 30 | 60 | 60 | 120 | High |
| **VSync** | Off | On | On | On | Medium |
| **Particles** | Off | On | On | On | High |
| **Max Particles** | 50 | 150 | 300 | 500 | High |
| **Antialiasing** | Off | On | On | On | Medium |
| **Shadows** | Off | Off | On | On | Medium |
| **Bloom** | Off | On | On | On | Low |
| **Motion Blur** | Off | Off | Off | On | Low |
| **Background FX** | Off | On | On | On | High |
| **Texture Quality** | Low | Med | High | Ultra | Medium |
| **Shake Intensity** | 0.3x | 0.65x | 1.0x | 1.2x | Low |

**Recommendations:**
- **Low:** Integrated graphics, older hardware, battery-powered devices
- **Medium:** Mid-range GPUs, most laptops, balanced gaming
- **High:** Dedicated GPUs, desktop gaming, 60Hz displays
- **Ultra:** High-end GPUs (RTX 3060+), 120Hz+ displays, enthusiasts

---

### Phase 4: UI Integration

#### Objective
Create an intuitive settings interface for all graphics and display options.

#### 4.1 HTML Structure

**File:** `index.html` (MODIFY)

Add new Display tab to settings modal:

```html
<!-- Settings Modal Tabs -->
<div class="settings-tabs">
    <button class="settings-tab active" data-tab="general">General</button>
    <button class="settings-tab" data-tab="display">Display</button> <!-- NEW -->
    <button class="settings-tab" data-tab="audio">Audio</button>
    <button class="settings-tab" data-tab="controls">Controls</button>
    <button class="settings-tab" data-tab="visual">Visual</button>
</div>

<!-- Display Settings Tab Content (NEW) -->
<div id="settings-display" class="settings-tab-content">
    <h3>Display Settings</h3>

    <!-- Resolution -->
    <div class="setting-item">
        <label for="resolution-select">Resolution</label>
        <select id="resolution-select">
            <option value="auto">Auto (Native)</option>
            <option value="1280x720">1280 × 720 (HD)</option>
            <option value="1920x1080">1920 × 1080 (Full HD)</option>
            <option value="2560x1440">2560 × 1440 (2K)</option>
            <option value="3840x2160">3840 × 2160 (4K)</option>
            <option value="custom">Custom...</option>
        </select>
    </div>

    <!-- Display Mode -->
    <div class="setting-item">
        <label for="display-mode">Display Mode</label>
        <select id="display-mode">
            <option value="windowed">Windowed</option>
            <option value="fullscreen">Fullscreen</option>
            <option value="borderless">Borderless Window</option>
        </select>
    </div>

    <hr>

    <h3>Performance</h3>

    <!-- Graphics Quality Preset -->
    <div class="setting-item">
        <label for="graphics-quality">Graphics Quality</label>
        <select id="graphics-quality">
            <option value="Low">Low (Performance)</option>
            <option value="Medium">Medium (Balanced)</option>
            <option value="High">High (Quality)</option>
            <option value="Ultra">Ultra (Maximum)</option>
            <option value="Custom">Custom</option>
        </select>
        <small class="setting-description" id="quality-description">
            Balanced visuals and performance
        </small>
    </div>

    <!-- FPS Target -->
    <div class="setting-item">
        <label for="fps-target">Frame Rate Target</label>
        <select id="fps-target">
            <option value="30">30 FPS (Battery Saver)</option>
            <option value="60">60 FPS (Standard)</option>
            <option value="120">120 FPS (High Refresh)</option>
            <option value="144">144 FPS (Gaming)</option>
            <option value="240">240 FPS (Pro)</option>
            <option value="0">Unlimited</option>
        </select>
    </div>

    <!-- VSync -->
    <div class="setting-item">
        <label for="vsync-toggle">Vertical Sync (VSync)</label>
        <select id="vsync-toggle">
            <option value="true">On (Smooth)</option>
            <option value="false">Off (Low Latency)</option>
        </select>
        <small class="setting-description">
            Prevents screen tearing but may add input lag
        </small>
    </div>

    <hr>

    <h3>Advanced Graphics</h3>

    <!-- Antialiasing -->
    <div class="setting-item">
        <label for="antialiasing-toggle">Antialiasing</label>
        <select id="antialiasing-toggle">
            <option value="true">On</option>
            <option value="false">Off</option>
        </select>
    </div>

    <!-- Shadows -->
    <div class="setting-item">
        <label for="shadows-toggle">Shadows</label>
        <select id="shadows-toggle">
            <option value="true">On</option>
            <option value="false">Off</option>
        </select>
    </div>

    <!-- Bloom -->
    <div class="setting-item">
        <label for="bloom-toggle">Bloom Effect</label>
        <select id="bloom-toggle">
            <option value="true">On</option>
            <option value="false">Off</option>
        </select>
    </div>

    <!-- Motion Blur -->
    <div class="setting-item">
        <label for="motion-blur-toggle">Motion Blur</label>
        <select id="motion-blur-toggle">
            <option value="true">On</option>
            <option value="false">Off</option>
        </select>
    </div>

    <!-- Particle Quality -->
    <div class="setting-item">
        <label for="particle-quality">Particle Quality</label>
        <select id="particle-quality">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="ultra">Ultra</option>
        </select>
    </div>

    <hr>

    <!-- FPS Counter -->
    <div class="setting-item">
        <label for="show-fps-counter">Show FPS Counter</label>
        <select id="show-fps-counter">
            <option value="false">Off</option>
            <option value="true">On</option>
        </select>
    </div>

    <!-- Apply Button -->
    <div class="setting-item">
        <button id="apply-display-settings" class="btn btn-primary">
            Apply Display Settings
        </button>
    </div>
</div>
```

#### 4.2 CSS Styling

**File:** `styles.css` (ADD)

```css
/* Display Settings Styles */

.settings-tab-content {
    display: none;
}

.settings-tab-content.active {
    display: block;
}

.setting-item {
    margin-bottom: 20px;
    padding: 10px 0;
}

.setting-item label {
    display: block;
    font-weight: 600;
    margin-bottom: 8px;
    color: #e0e0e0;
}

.setting-item select {
    width: 100%;
    padding: 8px 12px;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 4px;
    color: #fff;
    font-size: 14px;
    cursor: pointer;
    transition: all 0.2s;
}

.setting-item select:hover {
    background: rgba(255, 255, 255, 0.15);
    border-color: rgba(255, 255, 255, 0.3);
}

.setting-item select:focus {
    outline: none;
    border-color: #64c8ff;
    box-shadow: 0 0 0 2px rgba(100, 200, 255, 0.2);
}

.setting-description {
    display: block;
    margin-top: 6px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.6);
    font-style: italic;
}

.btn-primary {
    width: 100%;
    padding: 12px 24px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border: none;
    border-radius: 6px;
    color: white;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s;
}

.btn-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.btn-primary:active {
    transform: translateY(0);
}

/* FPS Counter */
#fps-counter {
    position: fixed;
    top: 10px;
    right: 10px;
    background: rgba(0, 0, 0, 0.8);
    color: #0f0;
    padding: 8px 12px;
    font-family: 'Courier New', monospace;
    font-size: 14px;
    border-radius: 4px;
    z-index: 10000;
    user-select: none;
    pointer-events: none;
}

/* Quality indicator badges */
.quality-badge {
    display: inline-block;
    padding: 4px 8px;
    border-radius: 3px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    margin-left: 8px;
}

.quality-badge.low {
    background: #f44336;
    color: white;
}

.quality-badge.medium {
    background: #ff9800;
    color: white;
}

.quality-badge.high {
    background: #4caf50;
    color: white;
}

.quality-badge.ultra {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
}
```

#### 4.3 JavaScript Event Handlers

**File:** `src/ui/settings.js` (MODIFY)

Add display settings initialization:

```javascript
/**
 * Initialize display settings UI
 */
export function initializeDisplaySettingsUI(settingsManager, callbacks) {
    const settings = settingsManager.get();

    // Resolution selector
    const resolutionSelect = document.getElementById('resolution-select');
    if (resolutionSelect) {
        resolutionSelect.value = settings.resolution || 'auto';

        resolutionSelect.addEventListener('change', (e) => {
            const value = e.target.value;

            if (value === 'custom') {
                // Show custom resolution dialog
                const width = prompt('Enter width:', '1920');
                const height = prompt('Enter height:', '1080');

                if (width && height) {
                    settingsManager.update({
                        resolution: 'custom',
                        customResolution: {
                            width: parseInt(width),
                            height: parseInt(height)
                        }
                    });
                }
            } else {
                settingsManager.update({
                    resolution: value,
                    customResolution: null
                });
            }
        });
    }

    // Display mode selector
    const displayModeSelect = document.getElementById('display-mode');
    if (displayModeSelect) {
        displayModeSelect.value = settings.displayMode || 'windowed';

        displayModeSelect.addEventListener('change', (e) => {
            settingsManager.update({ displayMode: e.target.value });
        });
    }

    // Graphics quality preset
    const graphicsQualitySelect = document.getElementById('graphics-quality');
    const qualityDescription = document.getElementById('quality-description');

    if (graphicsQualitySelect) {
        graphicsQualitySelect.value = settings.graphicsQuality || 'High';

        graphicsQualitySelect.addEventListener('change', (e) => {
            const quality = e.target.value;

            if (quality !== 'Custom') {
                // Apply preset
                const config = applyQualityPreset(settingsManager, quality);

                // Update description
                if (qualityDescription) {
                    qualityDescription.textContent = config.description;
                }

                // Update all dependent UI elements
                updateDisplayUIFromSettings(settingsManager.get());
            }

            settingsManager.update({ graphicsQuality: quality });
        });
    }

    // FPS target
    const fpsTargetSelect = document.getElementById('fps-target');
    if (fpsTargetSelect) {
        fpsTargetSelect.value = String(settings.targetFrameRate || 60);

        fpsTargetSelect.addEventListener('change', (e) => {
            const fps = parseInt(e.target.value);
            settingsManager.update({ targetFrameRate: fps });

            // Mark as custom if manually changed
            if (graphicsQualitySelect && graphicsQualitySelect.value !== 'Custom') {
                graphicsQualitySelect.value = 'Custom';
                settingsManager.update({ graphicsQuality: 'Custom' });
            }
        });
    }

    // VSync toggle
    const vsyncToggle = document.getElementById('vsync-toggle');
    if (vsyncToggle) {
        vsyncToggle.value = String(settings.vsyncEnabled ?? true);

        vsyncToggle.addEventListener('change', (e) => {
            const enabled = e.target.value === 'true';
            settingsManager.update({ vsyncEnabled: enabled });
        });
    }

    // Advanced graphics options
    setupAdvancedGraphicsUI(settingsManager);

    // FPS counter toggle
    const showFPSCounter = document.getElementById('show-fps-counter');
    if (showFPSCounter) {
        showFPSCounter.value = String(settings.showFPSCounter || false);

        showFPSCounter.addEventListener('change', (e) => {
            const show = e.target.value === 'true';
            settingsManager.update({ showFPSCounter: show });

            if (callbacks.onFPSCounterToggle) {
                callbacks.onFPSCounterToggle(show);
            }
        });
    }

    // Apply button
    const applyButton = document.getElementById('apply-display-settings');
    if (applyButton) {
        applyButton.addEventListener('click', async () => {
            const currentSettings = settingsManager.get();

            settingsManager.save();

            if (callbacks.onDisplaySettingsApply) {
                await callbacks.onDisplaySettingsApply(currentSettings);
            }

            // Show confirmation
            applyButton.textContent = 'Applied!';
            applyButton.style.background = '#4caf50';

            setTimeout(() => {
                applyButton.textContent = 'Apply Display Settings';
                applyButton.style.background = '';
            }, 2000);
        });
    }
}

/**
 * Setup advanced graphics options
 */
function setupAdvancedGraphicsUI(settingsManager) {
    const advancedSettings = [
        'antialiasing',
        'shadows',
        'bloom',
        'motion-blur',
        'particle-quality'
    ];

    advancedSettings.forEach(settingId => {
        const element = document.getElementById(`${settingId}-toggle`);
        if (!element) return;

        const settingKey = settingId.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
        settingKey = 'enable' + settingKey.charAt(0).toUpperCase() + settingKey.slice(1);

        const currentValue = settingsManager.getValue(settingKey);

        if (element.tagName === 'SELECT') {
            element.value = String(currentValue ?? true);

            element.addEventListener('change', (e) => {
                const value = e.target.value === 'true';
                settingsManager.update({ [settingKey]: value });

                // Mark quality as custom
                settingsManager.update({ graphicsQuality: 'Custom' });
            });
        }
    });
}

/**
 * Update UI elements from current settings
 */
function updateDisplayUIFromSettings(settings) {
    // Update all UI elements to match current settings
    const elements = {
        'fps-target': settings.targetFrameRate,
        'vsync-toggle': String(settings.vsyncEnabled),
        'antialiasing-toggle': String(settings.enableAntialiasing),
        'shadows-toggle': String(settings.enableShadows),
        'bloom-toggle': String(settings.enableBloom),
        'motion-blur-toggle': String(settings.enableMotionBlur),
        'particle-quality': settings.particleQuality,
    };

    Object.entries(elements).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element && value !== undefined) {
            element.value = String(value);
        }
    });
}
```

#### 4.4 Wire Up Callbacks

**File:** `src/main.js` (MODIFY)

```javascript
// In AppController initialization
initializeSettingsUI(this.settingsManager, {
    // ... existing callbacks ...

    // NEW: Display settings callbacks
    onDisplaySettingsApply: async (settings) => {
        console.log('[Settings] Applying display settings:', settings);

        // Apply display mode and resolution
        await this.applyDisplaySettings(settings);

        // Apply frame rate settings
        await this.applyFrameRateSettings(settings);

        // Apply graphics quality
        await this.applyGraphicsQuality(settings.graphicsQuality);

        console.log('[Settings] Display settings applied successfully');
    },

    onFPSCounterToggle: (show) => {
        if (show) {
            this.showFPSCounter();
        } else {
            const counter = document.getElementById('fps-counter');
            if (counter) counter.remove();
        }
    },
});
```

---

### Phase 5: Testing and Optimization

#### Objective
Ensure all settings work correctly across different hardware and configurations.

#### 5.1 Testing Checklist

**Display Settings:**
- [ ] Resolution changes apply correctly
- [ ] Fullscreen toggle works in both browser and Electron
- [ ] Borderless window mode functions properly
- [ ] Settings persist after restart
- [ ] Multiple monitor support (if applicable)

**Frame Rate:**
- [ ] FPS cap enforced accurately (±5 fps tolerance)
- [ ] VSync toggles correctly
- [ ] No frame skipping at 60 FPS
- [ ] Smooth performance at all FPS targets
- [ ] FPS counter displays accurate values

**Graphics Quality:**
- [ ] All four presets apply correctly
- [ ] Custom settings can be created
- [ ] Visual effects enable/disable properly
- [ ] No crashes when switching quality levels
- [ ] Smooth transitions between quality levels

**Performance:**
- [ ] Low quality achieves target FPS on low-end hardware
- [ ] Ultra quality runs without stuttering on high-end hardware
- [ ] No memory leaks during quality changes
- [ ] Particle limits enforced correctly
- [ ] Background effects toggle properly

#### 5.2 Performance Testing Script

**File:** `src/utils/performance-test.js` (NEW)

```javascript
/**
 * Performance testing utilities
 */

export class PerformanceTest {
    constructor(frameRateController) {
        this.frameRateController = frameRateController;
        this.results = [];
    }

    /**
     * Run automated quality benchmarks
     */
    async runQualityBenchmark(duration = 10000) {
        const qualities = ['Low', 'Medium', 'High', 'Ultra'];
        const results = {};

        for (const quality of qualities) {
            console.log(`[Benchmark] Testing ${quality} quality...`);

            // Apply quality
            window.app.applyGraphicsQuality(quality);

            // Wait for stabilization
            await this.wait(2000);

            // Measure performance
            const stats = await this.measurePerformance(duration);
            results[quality] = stats;

            console.log(`[Benchmark] ${quality}: ${stats.avgFPS} FPS (avg)`);
        }

        return results;
    }

    /**
     * Measure performance over time
     */
    async measurePerformance(duration) {
        return new Promise((resolve) => {
            const startTime = performance.now();
            const samples = [];

            const interval = setInterval(() => {
                const fps = this.frameRateController.getFPS();
                samples.push(fps);

                if (performance.now() - startTime >= duration) {
                    clearInterval(interval);

                    const stats = {
                        avgFPS: Math.round(samples.reduce((a, b) => a + b, 0) / samples.length),
                        minFPS: Math.min(...samples),
                        maxFPS: Math.max(...samples),
                        samples: samples.length,
                        duration,
                    };

                    resolve(stats);
                }
            }, 100);
        });
    }

    /**
     * Test memory usage
     */
    getMemoryUsage() {
        if (performance.memory) {
            return {
                usedJSHeapSize: performance.memory.usedJSHeapSize,
                totalJSHeapSize: performance.memory.totalJSHeapSize,
                jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
            };
        }
        return null;
    }

    /**
     * Helper: wait for duration
     */
    wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Expose to console for manual testing
if (typeof window !== 'undefined') {
    window.PerformanceTest = PerformanceTest;
}
```

Usage in console:
```javascript
const tester = new PerformanceTest(app.frameRateController);
const results = await tester.runQualityBenchmark(5000);
console.table(results);
```

#### 5.3 Optimization Tips

**General:**
1. **Batch Updates:** Apply multiple settings in one operation to avoid multiple reloads
2. **Debounce:** Add debouncing to resolution sliders/inputs
3. **Lazy Loading:** Only load high-quality assets when needed
4. **Asset Streaming:** Use progressive texture loading for Ultra quality

**Phaser Specific:**
1. **Object Pooling:** Reuse particle emitters instead of creating new ones
2. **Texture Atlases:** Combine textures to reduce draw calls
3. **Render Texture Caching:** Cache static elements
4. **Scene Management:** Unload unused scenes

**WebGL Specific:**
1. **Shader Compilation:** Pre-compile shaders during loading
2. **Uniform Caching:** Minimize uniform updates
3. **Draw Call Reduction:** Batch similar objects
4. **Framebuffer Management:** Reuse framebuffers

---

## Data Structures

### Settings Schema

```typescript
interface GraphicsSettings {
    // Display
    displayMode: 'windowed' | 'fullscreen' | 'borderless';
    resolution: 'auto' | string; // 'auto' or '1920x1080'
    customResolution?: { width: number; height: number } | null;

    // Performance
    vsyncEnabled: boolean;
    targetFrameRate: 30 | 60 | 120 | 144 | 240 | 0; // 0 = unlimited
    graphicsQuality: 'Low' | 'Medium' | 'High' | 'Ultra' | 'Custom';

    // Visual Effects (existing)
    pieceLockRipple: boolean;
    comboPopupEffect: boolean;
    lineClearEffects: boolean;
    backgroundComboEffects: boolean;

    // Advanced Graphics
    enableAntialiasing: boolean;
    enableMotionBlur: boolean;
    enableBloom: boolean;
    enableShadows: boolean;
    particleQuality: 'low' | 'medium' | 'high' | 'ultra';
    textureQuality: 'low' | 'medium' | 'high' | 'ultra';

    // Debug
    showFPSCounter: boolean;
}
```

### Quality Preset Structure

```typescript
interface QualityPreset {
    id: string;
    label: string;
    description: string;

    // Performance
    renderFrameSkip: number;
    targetFPS: number;
    vsyncEnabled: boolean;

    // Effects
    particles: boolean;
    shakeMultiplier: number;
    enableMotionBlur: boolean;
    enableBloom: boolean;
    enableShadows: boolean;
    enableAntialiasing: boolean;

    // Quality levels
    textureQuality: string;
    particleQuality: string;
    maxParticles: number;

    // Visual effects
    pieceLockRipple: boolean;
    comboPopupEffect: boolean;
    lineClearEffects: boolean;
    backgroundComboEffects: boolean;

    // Background
    backgroundEffects: boolean;
    backgroundQuality: number; // 0.0 - 1.0

    // Phaser config
    antialias: boolean;
    pixelArt: boolean;
    roundPixels: boolean;
}
```

---

## Performance Considerations

### Hardware Requirements

**Minimum (Low Quality):**
- GPU: Integrated graphics (Intel HD 4000+)
- RAM: 2 GB
- Display: 1280×720
- Target: 30 FPS stable

**Recommended (High Quality):**
- GPU: Dedicated GPU (GTX 1050 / RX 560)
- RAM: 4 GB
- Display: 1920×1080
- Target: 60 FPS stable

**Ultra (Maximum Quality):**
- GPU: Modern GPU (RTX 3060 / RX 6600)
- RAM: 8 GB
- Display: 2560×1440 @ 120Hz+
- Target: 120+ FPS stable

### Optimization Strategies

**1. Progressive Enhancement:**
Start with Low quality, detect hardware capabilities, auto-upgrade to appropriate quality level.

**2. Dynamic Quality Adjustment:**
Monitor FPS, automatically lower quality if FPS drops below target for extended period.

**3. Asset Management:**
- Low: Load compressed textures, minimal particles
- Medium: Standard textures, moderate particles
- High: Full-res textures, full particles
- Ultra: Ultra-res textures, post-processing shaders

**4. Memory Management:**
- Unload unused assets when switching quality
- Clear texture caches between quality changes
- Dispose of unused particle emitters
- Garbage collect after major changes

---

## Best Practices

### 1. User Experience

**First Launch:**
- Auto-detect hardware and set appropriate quality
- Show brief quality description
- Allow immediate override

**Settings Changes:**
- Show preview/description before applying
- Confirm changes that require restart
- Provide "Revert" button with 10-second timer

**Performance Warnings:**
- Warn if Ultra selected on low-end hardware
- Suggest quality downgrade if FPS < 30
- Show performance impact indicators

### 2. Default Values

**Conservative Defaults:**
```javascript
{
    displayMode: 'windowed',      // Safer than fullscreen
    resolution: 'auto',           // Adapts to user's display
    vsyncEnabled: true,           // Prevents tearing
    targetFrameRate: 60,          // Standard refresh rate
    graphicsQuality: 'High',      // Good balance
    showFPSCounter: false,        // Less clutter
}
```

### 3. Validation

**Before Applying Settings:**
- Validate resolution fits in display bounds
- Check FPS target is supported by monitor
- Verify quality preset compatibility
- Warn about Ultra on integrated graphics

### 4. Error Handling

**Graceful Degradation:**
```javascript
try {
    await applyDisplaySettings(settings);
} catch (error) {
    console.error('Failed to apply settings:', error);

    // Revert to safe defaults
    await applyDisplaySettings({
        displayMode: 'windowed',
        resolution: '1280x720',
        graphicsQuality: 'Medium'
    });

    // Notify user
    showNotification('Settings partially applied. Some options reverted to defaults.');
}
```

### 5. Testing

**Cross-Platform Testing:**
- Test on Windows, macOS, Linux (if supported)
- Test in browser AND Electron
- Test on different resolutions (HD, FHD, 2K, 4K)
- Test on different GPUs (integrated, dedicated, high-end)

**Performance Testing:**
- Run benchmark suite on target hardware
- Measure FPS stability over extended sessions
- Check memory usage over time
- Test quality transitions (no crashes/leaks)

---

## Conclusion

This implementation guide provides a complete roadmap for adding comprehensive graphics and display settings to Serenity Blocks. The phased approach ensures:

1. **Modularity:** Each phase builds on previous work
2. **Flexibility:** Users can customize every aspect
3. **Performance:** Optimized for various hardware tiers
4. **UX:** Intuitive interface with sensible defaults
5. **Maintainability:** Clean, documented code

**Next Steps:**
1. Implement Phase 1 (Resolution/Display) first
2. Test thoroughly before moving to Phase 2
3. Gather user feedback on each phase
4. Iterate based on real-world performance data
5. Consider adding auto-quality detection in Phase 6

**Additional Resources:**
- [Phaser 4 Scale Manager Docs](https://newdocs.phaser.io/docs/3.80.0/Phaser.Scale.ScaleManager)
- [Electron BrowserWindow API](https://www.electronjs.org/docs/latest/api/browser-window)
- [requestAnimationFrame MDN](https://developer.mozilla.org/en-US/docs/Web/API/window/requestAnimationFrame)
- [Fullscreen API MDN](https://developer.mozilla.org/en-US/docs/Web/API/Fullscreen_API)
