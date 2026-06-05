# Phase 1 Testing Guide
## Display Settings Implementation

This document provides testing instructions for Phase 1 of the graphics and display settings implementation.

---

## What Was Implemented

### 1. Settings Data Structure
- Added display settings to `DEFAULT_CONFIG` in [src/ui/settings.js](src/ui/settings.js)
- New settings include:
  - `displayMode`: 'windowed', 'fullscreen', or 'borderless'
  - `resolution`: 'auto' or specific resolution like '1920x1080'
  - `customResolution`: Custom width/height object
  - `vsyncEnabled`: Enable/disable VSync
  - `targetFrameRate`: Target FPS (30, 60, 120, etc.)
  - `graphicsQuality`: Quality preset
  - Advanced graphics settings (antialiasing, bloom, shadows, etc.)

### 2. DisplayManager Module
- New file: [src/core/display-manager.js](src/core/display-manager.js)
- Features:
  - Detects Electron vs browser environment
  - Gets available displays and resolutions
  - Supports windowed, fullscreen, and borderless modes
  - Validates resolutions against display bounds
  - Fullscreen API fallback for browser mode

### 3. Electron IPC Handlers
- Updated: [electron/main.js](electron/main.js)
- New IPC handlers:
  - `get-displays`: Get all available displays
  - `set-fullscreen`: Toggle fullscreen mode
  - `set-borderless`: Enable borderless window
  - `set-windowed`: Enable windowed mode
  - `set-resolution`: Change window size
  - `get-window-bounds`: Get current window dimensions
  - `is-fullscreen`: Check fullscreen state

### 4. Main Application Integration
- Updated: [src/main.js](src/main.js)
- Added `DisplayManager` import and initialization
- New method: `applyDisplaySettings(settings)`
- Integrated with Phaser scale manager

---

## Testing Instructions

### Browser Mode Testing (Web)

1. **Start Development Server:**
   ```bash
   npm run dev
   ```

2. **Open Browser Console** (F12) and test the DisplayManager:
   ```javascript
   // Get the app instance
   const app = window.serenityBlocks;

   // Test 1: Check DisplayManager is initialized
   console.log('DisplayManager:', app.displayManager);
   console.log('Is Electron:', app.displayManager.isElectron); // Should be false

   // Test 2: Get available displays
   const displays = await app.displayManager.getAvailableDisplays();
   console.log('Available displays:', displays);

   // Test 3: Get common resolutions
   const resolutions = app.displayManager.getCommonResolutions(1920, 1080);
   console.log('Common resolutions:', resolutions);

   // Test 4: Toggle fullscreen (browser Fullscreen API)
   await app.displayManager.requestFullscreen();

   // Wait a moment, then exit
   setTimeout(async () => {
       await app.displayManager.exitFullscreen();
   }, 3000);

   // Test 5: Apply display settings
   const testSettings = {
       displayMode: 'windowed',
       resolution: '1280x720',
       customResolution: null
   };
   await app.applyDisplaySettings(testSettings);
   ```

### Electron Mode Testing

1. **Start Electron:**
   ```bash
   npm run dev:electron
   ```

2. **Open DevTools** and test Electron-specific features:
   ```javascript
   const app = window.serenityBlocks;

   // Test 1: Verify Electron mode
   console.log('Is Electron:', app.displayManager.isElectron); // Should be true

   // Test 2: Get displays (should return actual display info)
   const displays = await app.displayManager.getAvailableDisplays();
   console.log('Displays:', displays);

   // Test 3: Get window bounds
   const bounds = await app.displayManager.getWindowBounds();
   console.log('Window bounds:', bounds);

   // Test 4: Change to fullscreen
   await app.displayManager.setDisplayMode('fullscreen');

   // Test 5: Wait, then back to windowed
   setTimeout(async () => {
       await app.displayManager.setDisplayMode('windowed', {
           width: 1280,
           height: 720
       });
   }, 3000);

   // Test 6: Try borderless window
   setTimeout(async () => {
       await app.displayManager.setDisplayMode('borderless', {
           width: 1920,
           height: 1080
       });
   }, 6000);

   // Test 7: Apply full display settings
   const settings = {
       displayMode: 'windowed',
       resolution: '1600x900',
       customResolution: null
   };
   await app.applyDisplaySettings(settings);
   ```

### Settings Manager Testing

Test that settings persist correctly:

```javascript
const app = window.serenityBlocks;

// Test 1: Update display settings
app.settingsManager.update({
    displayMode: 'fullscreen',
    resolution: '1920x1080',
    vsyncEnabled: true,
    targetFrameRate: 60,
    graphicsQuality: 'High'
});

// Test 2: Save to localStorage
app.settingsManager.save();

// Test 3: Reload the page and check if settings persisted
// Then run:
const settings = app.settingsManager.get();
console.log('Loaded settings:', settings);
console.log('Display mode:', settings.displayMode);
console.log('Resolution:', settings.resolution);

// Test 4: Apply the loaded settings
await app.applyDisplaySettings(settings);
```

### Resolution Validation Testing

Test that invalid resolutions are handled:

```javascript
const app = window.serenityBlocks;

// Test 1: Valid resolution
const valid = await app.displayManager.validateResolution(1920, 1080);
console.log('1920x1080 valid:', valid); // Should be true

// Test 2: Too large resolution
const invalid = await app.displayManager.validateResolution(9999, 9999);
console.log('9999x9999 valid:', invalid); // Should be false

// Test 3: Negative resolution
const negative = await app.displayManager.validateResolution(-100, -100);
console.log('Negative valid:', negative); // Should be false

// Test 4: Apply invalid settings (should fallback to safe defaults)
const badSettings = {
    displayMode: 'windowed',
    resolution: '9999x9999',
    customResolution: null
};
await app.applyDisplaySettings(badSettings);
// Check console - should show warnings and use 1280x720
```

### Phaser Scale Manager Testing

Test that Phaser properly resizes:

```javascript
const app = window.serenityBlocks;

// Test 1: Get current Phaser game size
console.log('Current game size:', {
    width: app.phaserGame.scale.width,
    height: app.phaserGame.scale.height
});

// Test 2: Resize to different resolutions
const resolutions = [
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
    { width: 1600, height: 900 },
];

for (const res of resolutions) {
    console.log(`Testing ${res.width}x${res.height}...`);

    await app.applyDisplaySettings({
        displayMode: 'windowed',
        resolution: `${res.width}x${res.height}`,
        customResolution: null
    });

    // Wait 1 second between changes
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('New game size:', {
        width: app.phaserGame.scale.width,
        height: app.phaserGame.scale.height
    });
}
```

---

## Expected Results

### ✅ Success Criteria

1. **DisplayManager Initialization**
   - DisplayManager should be created and initialized
   - `isElectron` should correctly detect environment
   - No console errors

2. **Display Detection**
   - `getAvailableDisplays()` returns at least one display
   - Display info includes bounds, workArea, scaleFactor
   - Common resolutions are filtered correctly

3. **Display Mode Changes**
   - Fullscreen toggle works without errors
   - Borderless window mode applies correctly (Electron only)
   - Windowed mode restores properly
   - Window centers after resize

4. **Resolution Changes**
   - Valid resolutions apply correctly
   - Invalid resolutions fallback to 1280x720
   - Resolution validation catches out-of-bounds values
   - Phaser game resizes to match window

5. **Settings Persistence**
   - Display settings save to localStorage
   - Settings load correctly on page refresh
   - Default values are used for missing settings

6. **Error Handling**
   - Invalid resolutions don't crash the app
   - Missing displays are handled gracefully
   - IPC errors (in Electron) are caught and logged

---

## Known Limitations (Phase 1)

1. **Frame Rate Control**: Not yet implemented (Phase 2)
   - `targetFrameRate` setting exists but isn't enforced
   - `vsyncEnabled` setting exists but isn't applied

2. **Graphics Quality Presets**: Not yet implemented (Phase 3)
   - `graphicsQuality` setting exists but doesn't apply visual changes
   - Advanced graphics settings don't affect rendering yet

3. **UI Integration**: Not yet implemented (Phase 4)
   - No settings menu for display options
   - Changes must be made via console

4. **Auto-Detection**: Basic implementation
   - No automatic quality detection based on hardware
   - No performance monitoring

---

## Troubleshooting

### Issue: "displayManager is null"
**Solution:** Wait for app initialization to complete:
```javascript
// Wait for initialization
setTimeout(() => {
    const app = window.serenityBlocks;
    console.log('DisplayManager:', app.displayManager);
}, 2000);
```

### Issue: "IPC handler not found" (Electron)
**Solution:** Make sure you're running Electron with the updated main.js:
```bash
npm run dev:electron
```

### Issue: Fullscreen doesn't work in browser
**Solution:** User gesture required. Try clicking a button first:
```javascript
document.addEventListener('click', async () => {
    await app.displayManager.requestFullscreen();
}, { once: true });
```

### Issue: Resolution change doesn't affect game
**Solution:** Check that Phaser game is initialized:
```javascript
console.log('Phaser initialized:', app.phaserGame !== null);
console.log('Scale manager:', app.phaserGame?.scale);
```

---

## Next Steps

After Phase 1 testing is complete:

1. **Phase 2**: Implement frame rate control and VSync
   - Create `FrameRateController` class
   - Integrate with game loop
   - Add FPS counter option

2. **Phase 3**: Implement graphics quality presets
   - Enhance quality.js with full presets
   - Apply settings to all renderers
   - Implement particle limits

3. **Phase 4**: Create UI for display settings
   - Add Display tab to settings modal
   - Create resolution selector dropdown
   - Add quality preset selector
   - Wire up event handlers

4. **Phase 5**: Testing and optimization
   - Performance benchmarking
   - Cross-platform testing
   - Memory leak detection

---

## Manual Testing Checklist

- [ ] DisplayManager initializes without errors
- [ ] Can get available displays
- [ ] Can switch to fullscreen (browser)
- [ ] Can exit fullscreen (browser)
- [ ] Can switch to fullscreen (Electron)
- [ ] Can switch to borderless (Electron)
- [ ] Can switch to windowed (Electron)
- [ ] Resolution changes apply correctly
- [ ] Invalid resolutions are rejected
- [ ] Settings persist across page reload
- [ ] Phaser game resizes with window
- [ ] No console errors during testing
- [ ] No memory leaks after multiple changes

---

## Automated Testing (Future)

Consider adding these automated tests:

```javascript
// tests/display-manager.test.js
import { describe, it, expect } from 'vitest';
import { DisplayManager } from '../src/core/display-manager';

describe('DisplayManager', () => {
    it('should initialize correctly', () => {
        const dm = new DisplayManager();
        expect(dm).toBeDefined();
        expect(typeof dm.isElectron).toBe('boolean');
    });

    it('should parse resolution strings', () => {
        const dm = new DisplayManager();
        const parsed = dm.parseResolution('1920x1080');
        expect(parsed).toEqual({ width: 1920, height: 1080 });
    });

    it('should filter common resolutions', () => {
        const dm = new DisplayManager();
        const resolutions = dm.getCommonResolutions(1920, 1080);
        expect(resolutions.length).toBeGreaterThan(0);
        expect(resolutions.every(r => r.width <= 1920)).toBe(true);
    });
});
```

Run tests with:
```bash
npm test
```
