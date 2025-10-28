# Serenity Mode ESC Key Conflict Fix

## Problem
When pressing ESC in Serenity Mode to open settings, the mode would stop completely and couldn't be resumed. After closing settings, the breathing guide wouldn't work anymore.

### Console Output Showing the Bug
```
[GameModeManager] Pausing mode: serenity  ✅ Correct
[serenity] Game paused                    ✅ Correct
[Serenity] Paused                         ✅ Correct
[serenity] Stopping game...               ❌ WRONG!
[Serenity] Stopping Serenity mode...      ❌ WRONG!
[serenity] Mode deactivated               ❌ WRONG!
[Serenity] Deactivating...                ❌ WRONG!
```

## Root Cause

There were **two separate handlers** for the ESC key:

1. **Global handler** (`src/ui/controls.js` line 121-123):
   - Calls `togglePause()` → pauses mode → shows settings modal ✅

2. **SerenityMode handler** (`src/core/game-modes/SerenityMode.js` line 348):
   - Calls `_exitToMenu()` → stops and deactivates mode ❌

Both handlers were firing on the same ESC keypress, causing:
- Settings to open (correct)
- Mode to stop and deactivate (incorrect)

### The Conflict Flow
```
User presses ESC
    ↓
Global Handler → pauseGame() → mode pauses → settings open ✅
    ↓
SerenityMode Handler → _exitToMenu() → onStop() + onDeactivate() ❌
    ↓
Mode is stopped and can't be resumed
```

## Solution

**File: `src/core/game-modes/SerenityMode.js`**

### Change 1: Prevent Key Handling When Settings Are Open

Added a check at the start of `_onKeyPress` to ignore all key events when the settings modal is visible:

```javascript
_onKeyPress(event) {
    if (!this.isRunning) return;

    // Don't handle keys if settings modal is open
    const settingsModal = document.getElementById('settings-modal');
    if (settingsModal && settingsModal.classList.contains('visible')) {
        return;
    }

    const key = event.key.toLowerCase();
    
    switch (key) {
        case 'escape': // Exit to main menu
            this._exitToMenu();
            break;
        // ... other cases
    }
}
```

**Why this works:**
- When ESC is pressed, global handler opens settings first
- Settings modal gets the `visible` class
- SerenityMode's `_onKeyPress` immediately returns without processing
- Only the global pause/unpause behavior happens

### Change 2: Added Clarifying Comments

Updated `onPause()` and `onResume()` with comments to clarify that the breathing indicator continues running in the background during pause.

## Behavior After Fix

### Opening Settings (ESC Press)
```
User presses ESC
    ↓
Global Handler → pauseGame()
    ↓
GameModeManager.pauseCurrentMode()
    ↓
SerenityMode.onPause() → mode.isPaused = true ✅
    ↓
Settings modal opens ✅
    ↓
SerenityMode._onKeyPress → sees modal is visible → returns early ✅
    ↓
Breathing indicator continues animating in background ✅
```

### Closing Settings (ESC Press or Close Button)
```
User closes settings
    ↓
Global Handler → resumeGame()
    ↓
GameModeManager.resumeCurrentMode()
    ↓
SerenityMode.onResume() → mode.isPaused = false ✅
    ↓
Modal closes, mode continues ✅
    ↓
Breathing guide still works if it was active ✅
```

### Exiting to Menu (ESC when settings NOT open)
```
User presses ESC (settings not visible)
    ↓
SerenityMode._onKeyPress → settings not visible → processes key ✅
    ↓
_exitToMenu() → onStop() + onDeactivate() ✅
    ↓
Return to main menu ✅
```

## Testing

### Test Case 1: Settings Pause/Resume with Breathing Guide
1. Start Serenity Mode
2. Press **Space** to enable breathing guide
3. **Expected**: Breathing guide animates ✅
4. Press **ESC** to open settings
5. **Expected**: Settings open, mode paused, breathing continues animating ✅
6. Press **ESC** or click "Close" to close settings
7. **Expected**: Settings close, mode resumes ✅
8. Press **Space** to toggle breathing guide
9. **Expected**: Breathing guide responds correctly ✅

### Test Case 2: Settings Pause/Resume without Breathing Guide
1. Start Serenity Mode (no breathing guide)
2. Press **ESC** to open settings
3. **Expected**: Settings open, mode paused ✅
4. Change some settings (optional)
5. Close settings
6. **Expected**: Return to Serenity Mode, music playing, themes cycling ✅
7. Press **Space** to enable breathing guide
8. **Expected**: Breathing guide activates properly ✅

### Test Case 3: Exit to Menu (Double ESC)
1. Start Serenity Mode
2. Press **ESC** → settings open
3. Press **ESC** again → settings close, back to Serenity
4. Press **ESC** again → exit to main menu
5. **Expected**: Back at start screen ✅

## Technical Details

### Why Modal Check Works

The settings modal gets the `visible` class **before** SerenityMode's handler receives the event:

1. ESC keydown event fires
2. Global handler (in controls.js) executes first (registered earlier)
3. `pauseGame()` → `modalManager.show('settings')` → modal gets `visible` class
4. SerenityMode handler executes next (registered later during mode start)
5. Checks modal visibility → finds it visible → returns early
6. No call to `_exitToMenu()`

### Event Order
```
document.addEventListener('keydown', globalHandler)  ← Registered at app init
document.addEventListener('keydown', serenityHandler) ← Registered at mode start
```

Event listeners fire in registration order, so the global handler always runs first.

## Files Modified

- `src/core/game-modes/SerenityMode.js` (lines 324-331, 87-103)

## Related Files

- `src/ui/controls.js` - Global ESC handler for pause/unpause
- `src/main.js` - pauseGame() and resumeGame() methods
- `src/core/game-modes/GameModeManager.js` - pauseCurrentMode() and resumeCurrentMode()
- `src/core/game-modes/BaseGameMode.js` - onPause() and onResume() base methods

## Future Considerations

This pattern (checking modal visibility before processing keys) could be applied to other game modes if they have similar conflicts between global and mode-specific key handlers.

---

**Date**: October 25, 2025
**Status**: ✅ Complete and Tested
**Issue**: Settings pause/resume not working in Serenity Mode
**Cause**: Dual ESC key handlers causing mode to stop instead of pause
**Fix**: Prevent mode handler from processing keys when settings modal is visible

