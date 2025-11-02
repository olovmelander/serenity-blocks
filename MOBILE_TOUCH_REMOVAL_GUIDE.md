# Mobile & Touch Support Removal Guide

## Executive Summary

This document provides a comprehensive guide to remove mobile and touch-specific configurations from Serenity Blocks. The game currently includes touch controls and mobile detection logic that are not needed for a desktop-only application.

**Status**: The game DOES include touch support and mobile-specific settings that can be removed.

---

## Touch Support Findings

### 1. Touch Control Detection

**Location**: [src/ui/settings.js:27](src/ui/settings.js#L27), [src/core/constants.js:223](src/core/constants.js#L223)

```javascript
controlScheme: 'ontouchstart' in window ? 'Touch' : 'Keyboard',
```

**Purpose**: Automatically detects if the device supports touch and sets the control scheme accordingly.

**Impact**: Mobile devices would default to touch controls instead of keyboard.

---

### 2. Touch Controls Implementation

**Location**: [src/ui/controls.js](src/ui/controls.js)

The entire touch control system is implemented with:
- Touch gesture detection (tap, drag, flick, swipe)
- Touch event handlers (touchstart, touchmove, touchend)
- Touch state tracking
- Canvas region detection for touch input

**Key Functions**:
- `setupTouchControls()` (lines 456-603)
- `InputController.resetTouch()` (lines 53-59)
- Touch state properties (lines 29-35)

**Features**:
- Horizontal drag to move pieces
- Vertical drag for soft drop
- Tap left/right side to rotate
- Flick down for hard drop

---

### 3. Serenity Hub Touch Gestures

**Location**: [src/ui/serenity-hub/GestureController.js](src/ui/serenity-hub/GestureController.js)

**Purpose**: Handles swipe gestures for music track navigation in Serenity Mode.

**Features**:
- Swipe left/right to change tracks
- Touch event tracking
- Swipe velocity detection
- Visual swipe indicators

---

### 4. HTML Viewport Meta Tag

**Location**: [index.html:5](index.html#L5)

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0">
```

**Purpose**: Configures mobile browser viewport settings for responsive display.

---

### 5. Settings UI - Touch Control Option

**Location**: [index.html:927](index.html#L927)

```html
<label for="control-scheme">Control Scheme:</label>
<select id="control-scheme" class="setting-select">
    <option value="Keyboard">Keyboard</option>
    <option value="Touch">Touch</option>
</select>
```

**Purpose**: Allows users to switch between keyboard and touch controls.

---

## Removal Steps

### Step 1: Remove Touch Control Logic

#### A. Remove Touch Control Setup in main.js

**File**: [src/main.js:70](src/main.js#L70)

**Remove import**:
```javascript
import { InputController, setupKeyboardControls, setupTouchControls } from './ui/controls.js';
```

**Change to**:
```javascript
import { InputController, setupKeyboardControls } from './ui/controls.js';
```

**File**: [src/main.js:1595-1599](src/main.js#L1595-L1599)

**Remove these lines**:
```javascript
setupTouchControls(
    this.inputController,
    this.settingsManager.get(),
    gameActions,
    this.canvas, // Canvas may be null (using Phaser), touch controls will adapt
);
```

---

#### B. Remove Touch Functions from controls.js

**File**: [src/ui/controls.js](src/ui/controls.js)

**Remove these sections**:

1. **Touch state from InputController** (lines 29-35):
```javascript
// Touch state
this.touchStartX = null;
this.touchStartY = null;
this.touchStartTime = null;
this.lastTap = 0;
this.touchLastX = null;
this.touchLastY = null;
```

2. **resetTouch method** (lines 49-59):
```javascript
resetTouch() {
    this.touchStartX = null;
    this.touchStartY = null;
    this.touchStartTime = null;
    this.touchLastX = null;
    this.touchLastY = null;
}
```

3. **Entire setupTouchControls function** (lines 447-603)

4. **Touch control initialization in initializeControls** (line 672):
```javascript
setupTouchControls(inputController, settings, gameActions, canvas);
```

5. **Remove canvas parameter from initializeControls function** (line 666):
```javascript
export function initializeControls(settings, gameActions, canvas) {
```
**Change to**:
```javascript
export function initializeControls(settings, gameActions) {
```

---

### Step 2: Remove Serenity Hub Touch Gestures

**File**: [src/ui/serenity-hub/GestureController.js](src/ui/serenity-hub/GestureController.js)

**Action**: Delete the entire file.

**Note**: Check if any files import GestureController and remove those imports:

```bash
# Search for GestureController imports
grep -r "GestureController" src/
```

---

### Step 3: Update Settings Configuration

#### A. Remove Touch Control Scheme Detection

**File**: [src/ui/settings.js:27](src/ui/settings.js#L27)

**Change from**:
```javascript
controlScheme: 'ontouchstart' in window ? 'Touch' : 'Keyboard',
```

**Change to**:
```javascript
controlScheme: 'Keyboard',
```

**File**: [src/core/constants.js:223](src/core/constants.js#L223)

Make the same change if this exists in constants.js.

---

#### B. Remove Touch Option from Settings UI

**File**: [index.html:927-929](index.html#L927-L929)

**Change from**:
```html
<label for="control-scheme">Control Scheme:</label>
<select id="control-scheme" class="setting-select">
    <option value="Keyboard">Keyboard</option>
    <option value="Touch">Touch</option>
</select>
```

**Option 1 - Remove entirely**: Delete the entire setting (lines 924-929)

**Option 2 - Keep as informational**: Change to read-only display:
```html
<label>Control Scheme:</label>
<div class="setting-value">Keyboard</div>
```

---

### Step 4: Simplify HTML Viewport (Optional)

**File**: [index.html:5](index.html#L5)

**Current**:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0">
```

**Option 1 - Keep as-is**: This doesn't hurt desktop and maintains basic responsiveness.

**Option 2 - Desktop-optimized**: Change to:
```html
<meta name="viewport" content="width=1280, initial-scale=1.0, user-scalable=no">
```

**Option 3 - Remove entirely**: Delete the meta tag (not recommended - may cause display issues).

**Recommendation**: Keep as-is (Option 1).

---

### Step 5: Update Documentation Comments

**Files to update**:
- [src/ui/controls.js](src/ui/controls.js) - Update file header comment to remove "touch input" references
- [src/main.js](src/main.js) - Update control setup comments

**Example**:

**Change from**:
```javascript
/**
 * @fileoverview Input Controls for Serenity Blocks (Phaser 4 Compatible)
 * Handles keyboard and touch input with DAS (Delayed Auto Shift) support
 */
```

**Change to**:
```javascript
/**
 * @fileoverview Input Controls for Serenity Blocks (Phaser 4 Compatible)
 * Handles keyboard input with DAS (Delayed Auto Shift) support
 */
```

---

## Impact Analysis

### Files to Modify

1. **[src/main.js](src/main.js)** - Remove touch control setup
2. **[src/ui/controls.js](src/ui/controls.js)** - Remove touch functions
3. **[src/ui/settings.js](src/ui/settings.js)** - Remove touch detection
4. **[src/core/constants.js](src/core/constants.js)** - Remove touch detection (if present)
5. **[index.html](index.html)** - Remove touch control option from settings UI
6. **[src/ui/serenity-hub/GestureController.js](src/ui/serenity-hub/GestureController.js)** - Delete entire file

### Files to Delete

- [src/ui/serenity-hub/GestureController.js](src/ui/serenity-hub/GestureController.js)

---

## Testing Checklist

After removing touch support, verify:

- [ ] Game starts without errors
- [ ] Keyboard controls work in single player mode
- [ ] Keyboard controls work in local multiplayer mode
- [ ] Settings modal opens and closes properly
- [ ] Control scheme setting is removed or shows "Keyboard" only
- [ ] No console errors related to touch events
- [ ] Serenity Mode works without gesture controller
- [ ] All documentation reflects keyboard-only controls
- [ ] Build process completes successfully
- [ ] No orphaned imports or references to touch code

---

## Code Size Reduction

**Estimated lines removed**: ~300-350 lines
- controls.js: ~150 lines (touch functions)
- GestureController.js: ~200 lines (entire file)

**Estimated file size reduction**: ~10-12 KB (minified)

---

## Rollback Plan

If you need to restore touch support:

1. Revert changes using git:
```bash
git checkout HEAD -- src/ui/controls.js src/ui/settings.js src/main.js index.html
```

2. Restore GestureController.js from git history:
```bash
git checkout HEAD -- src/ui/serenity-hub/GestureController.js
```

---

## Additional Notes

### Touch Events NOT Used For

The following features do NOT rely on touch events and will remain functional:

- Mouse click detection (uses `click` events, not touch)
- Modal interactions (button clicks)
- Settings UI (standard HTML inputs)
- Gamepad support (separate system)
- Keyboard controls (unaffected)

### Performance Considerations

Removing touch support will:
- Slightly reduce bundle size (~10KB)
- Remove event listeners (minor performance improvement)
- Simplify control flow logic
- Reduce initialization overhead

### Future Considerations

If you later decide to add mobile support:

1. The touch code is well-isolated and can be easily restored
2. Consider using a feature flag to enable/disable touch at build time
3. Keep GestureController.js in version control for reference

---

## Summary

**What will be removed**:
- Touch gesture detection and handling
- Touch event listeners (touchstart, touchmove, touchend)
- Mobile control scheme auto-detection
- Swipe gestures in Serenity Mode
- Touch control option in settings UI

**What will remain**:
- Mouse/click event handling
- Keyboard controls
- Gamepad support
- All game functionality
- Responsive viewport (optional)

**Recommended approach**:
Follow the removal steps in order, test after each major change, and commit changes incrementally for easy rollback if needed.

---

## Quick Removal Commands

For a quick automated removal (use with caution):

```bash
# Backup first!
git add -A
git commit -m "Backup before removing touch support"

# Remove GestureController
rm src/ui/serenity-hub/GestureController.js

# Then manually edit the files listed in "Files to Modify" section
```

---

**Last Updated**: 2025-11-01
**Project**: Serenity Blocks
**Purpose**: Desktop-only optimization
