# Single Player Layout Fix

## Issues Identified

When starting single player mode after the refactoring:
1. ❌ Sidebar not visible on the left
2. ❌ Next pieces preview not showing
3. ❌ Game not playable
4. ❌ Layout broken

## Root Causes

### 1. Event-Based UI Updates Not Connected
**Problem**: `SinglePlayerMode` was dispatching custom events but nothing was listening
```javascript
// Old approach (not working)
window.dispatchEvent(new CustomEvent('refreshNextQueue', {...}));
window.dispatchEvent(new CustomEvent('updateStats', {...}));
```

**Solution**: Call UI update functions directly
```javascript
// New approach (working)
updateNextQueue(this.gameState.nextPieces);
updateStats(this.gameState);
```

### 2. Container Display Property Incorrect
**Problem**: Container was set to `display: block` instead of `display: flex`
```javascript
// Old (incorrect)
singlePlayerContainer.style.display = 'block';
```

**Solution**: Use flex layout as defined in CSS
```javascript
// New (correct)
singlePlayerContainer.style.display = 'flex';
```

## Fixes Applied

### File: `/src/core/game-modes/SinglePlayerMode.js`

#### 1. Added Import for UI Functions
```javascript
import { updateNextQueue } from '../../ui/next-queue-ui.js';
```

#### 2. Updated Container Display
```javascript
// Show single player container (flex for proper layout)
const singlePlayerContainer = document.getElementById('single-player-container');
if (singlePlayerContainer) {
    singlePlayerContainer.style.display = 'flex'; // Changed from 'block'
}
```

#### 3. Replaced Event Dispatching with Direct Function Calls
```javascript
// Before:
_refreshNextQueue() {
    window.dispatchEvent(new CustomEvent('refreshNextQueue', {
        detail: { gameState: this.gameState, canvases: this.nextCanvases }
    }));
}

// After:
_refreshNextQueue() {
    updateNextQueue(this.gameState.nextPieces);
}

// Before:
_updateStats() {
    window.dispatchEvent(new CustomEvent('updateStats', {
        detail: { gameState: this.gameState }
    }));
}

// After:
_updateStats() {
    updateStats(this.gameState);
}
```

## Expected Result

After these fixes, single player mode should:
- ✅ Show the sidebar on the left with stats
- ✅ Display next piece previews (5 pieces)
- ✅ Properly position the game canvas
- ✅ Be fully playable
- ✅ Have correct layout with:
  - Left sidebar: Stats and next pieces
  - Center: Game board (Phaser canvas)
  - Proper spacing and alignment

## Testing Checklist

### Visual Layout
- [ ] Sidebar visible on the left
- [ ] Stats panel shows: Score, Lines, Level
- [ ] Next piece preview shows 5 upcoming pieces
- [ ] Game board (Phaser canvas) centered in view
- [ ] Proper spacing between elements
- [ ] Background theme visible and animated

### Functionality
- [ ] Can move pieces left/right (Arrow keys)
- [ ] Can rotate pieces (Up arrow or Z)
- [ ] Can soft drop (Down arrow)
- [ ] Can hard drop (Space)
- [ ] Next piece preview updates when piece spawns
- [ ] Stats update in real-time
- [ ] Lines clear correctly
- [ ] Level increases after clearing lines
- [ ] Game over modal appears when topped out

### Phaser Integration
- [ ] Phaser canvas visible
- [ ] Pieces render on Phaser canvas
- [ ] Visual effects work (line clear, piece lock, etc.)
- [ ] Theme matches background
- [ ] No canvas rendering artifacts

## How It Works Now

1. **User opens page** → Start modal appears
2. **User selects "Single Player"** → Description updates
3. **User clicks "START GAME"** →
   - `GameModeManager.activateMode('single')` called
   - `SinglePlayerMode.onActivate()` runs:
     - Shows single-player container (`display: flex`)
     - Hides multiplayer container
     - Moves Phaser canvas to correct container
     - Resizes Phaser to single-player dimensions
   - `SinglePlayerMode.onStart()` runs:
     - Creates GameState
     - Fills piece bag
     - Spawns first piece
     - Calls `updateNextQueue()` directly ✅
     - Calls `updateStats()` directly ✅
     - Starts game loop
4. **Game runs** →
   - Game loop calls `updateStats()` and `updateNextQueue()` as needed
   - UI updates in real-time
   - Phaser renders the game board

## Browser Console Output

### On Mode Activation:
```
[GameModeManager] Activating mode: single
[SinglePlayer] Activating single player mode...
[SinglePlayer] Mode activated, ready to start
[Main] Mode activated: single
```

### On Game Start:
```
[GameModeManager] Starting mode: single
[SinglePlayer] Starting game...
[SinglePlayer] Game started!
[Main] Mode started: single
```

### During Gameplay:
- Stats update silently (no console logs)
- Next queue updates silently
- Physics events logged if enabled

## Troubleshooting

### Issue: Sidebar still not visible
**Check**:
1. Browser console for errors
2. Container display property: `display: flex`
3. CSS loaded correctly
4. Single-player container not hidden by modal overlay

**Solution**:
```javascript
// In browser console:
const container = document.getElementById('single-player-container');
console.log(container.style.display); // Should be 'flex'
console.log(getComputedStyle(container).display); // Should be 'flex'
```

### Issue: Next pieces not showing
**Check**:
1. `updateNextQueue` being called
2. Canvas elements exist
3. `gameState.nextPieces` populated

**Solution**:
```javascript
// In browser console (during game):
console.log(app.gameModeManager.getCurrentMode().gameState.nextPieces);
// Should show array of 5+ piece types
```

### Issue: Stats not updating
**Check**:
1. `updateStats` being called
2. DOM elements exist (#score, #lines, #level)
3. GameState values changing

**Solution**:
```javascript
// In browser console (during game):
const mode = app.gameModeManager.getCurrentMode();
console.log(mode.gameState.score);
console.log(mode.gameState.lines);
console.log(mode.gameState.level);
```

## Related Files

- `/src/core/game-modes/SinglePlayerMode.js` - Mode implementation
- `/src/ui/next-queue-ui.js` - Next piece display
- `/src/rendering/draw.js` - Stats update function
- `/public/styles/main.css` - Layout styles
- `/public/index.html` - HTML structure

## Summary

The single player layout is now fixed by:
1. ✅ Using direct UI function calls instead of events
2. ✅ Using correct CSS display property (`flex`)
3. ✅ Properly integrating with existing UI system

The game should now be fully playable with proper layout!
