# Control and Spawn Fixes - Complete Solution

## Issues Encountered

### Issue 1: Cannot Move Pieces ❌
**Symptom**: Pieces appear on the board but arrow keys don't work
**Cause**: Global control functions were using legacy `this.gameState` instead of the active mode's game state

### Issue 2: Game Freezes After First Piece ❌
**Symptom**: First piece can be moved and dropped, but after it locks, no new piece spawns
**Cause**: Missing `spawnPiece` callback in physics callbacks

---

## Root Cause Analysis

### Problem 1: Control Functions Using Wrong Game State

**In main.js**, global controls were set up like this:
```javascript
window.move = (dir) => {
    coreMove(
        this.gameState,  // ❌ This is the legacy empty state!
        dir,
        ...
    );
};
```

But our new architecture creates game state inside `SinglePlayerMode`:
```javascript
// In SinglePlayerMode.onStart()
this.gameState = new GameState(); // ✅ This is the actual game state
```

The controls were pointing to the wrong state!

### Problem 2: Missing Spawn Callback

**In game.js**, when a piece locks:
```javascript
processPhysics(gameState, physicsCallbacks).then(() => {
    gameState.isProcessingPhysics = false;
    // Spawn next piece after physics is complete
    if (physicsCallbacks.spawnPiece) {
        physicsCallbacks.spawnPiece(); // ❌ This doesn't exist!
    }
});
```

But `SinglePlayerMode._getPhysicsCallbacks()` didn't include `spawnPiece`:
```javascript
_getPhysicsCallbacks() {
    return {
        onMove: () => ...,
        onRotate: () => ...,
        onLineClear: () => ...,
        // ❌ Missing: spawnPiece callback!
    };
}
```

---

## Solutions Applied

### Fix 1: Update Global Controls to Use Active Mode State

**File**: `/src/main.js`

**Added helper function**:
```javascript
// Helper to get current game state from active mode
const getCurrentGameState = () => {
    const currentMode = this.gameModeManager?.getCurrentMode();
    if (currentMode && currentMode.gameState) {
        return currentMode.gameState; // ✅ Use mode's state
    }
    // Fallback to legacy state
    return this.gameState;
};
```

**Updated all control functions**:
```javascript
window.move = (dir) => {
    const gameState = getCurrentGameState(); // ✅ Get correct state
    if (!gameState || !gameState.currentPiece) return;

    coreMove(
        gameState, // ✅ Now using the active mode's state
        dir,
        () => this.soundManager.sfxPlayer.playMove(),
        addPieceTrail,
    );
};

// Same pattern for:
// - window.rotate
// - window.softDrop
// - window.hardDrop
```

### Fix 2: Add spawnPiece Callback

**File**: `/src/core/game-modes/SinglePlayerMode.js`

**Updated physics callbacks**:
```javascript
_getPhysicsCallbacks() {
    return {
        onMove: () => this.deps.soundManager.sfxPlayer.playMove(),
        onRotate: () => this.deps.soundManager.sfxPlayer.playRotate(),
        onLineClear: (lines) => {
            if (lines === 4) {
                this.deps.soundManager.sfxPlayer.playTetris();
            } else {
                this.deps.soundManager.sfxPlayer.playLineClear();
            }
        },
        onLevelUp: () => this.deps.soundManager.sfxPlayer.playLevelUp(),
        onHardDrop: () => this.deps.soundManager.sfxPlayer.playHardDrop(),

        // ✅ ADDED: Spawn next piece after physics completes
        spawnPiece: () => {
            spawnPiece(
                this.gameState,
                () => this._refreshNextQueue(),
                () => this._handleGameOver()
            );
        },
    };
}
```

---

## How It Works Now

### Game Flow:

1. **User starts game** → `SinglePlayerMode.onStart()` creates `gameState`
2. **User presses arrow key** →
   - Keyboard event triggers `window.move(dir)`
   - `getCurrentGameState()` retrieves active mode's `gameState`
   - `coreMove()` updates the piece position ✅
3. **User drops piece** →
   - Piece locks via `lockPiece()`
   - Physics processes (line clears, etc.)
   - `physicsCallbacks.spawnPiece()` called ✅
   - New piece spawns
   - Next queue updates
   - Game continues! ✅

### Control Flow Diagram:

```
Keyboard Input
    ↓
window.move() / rotate() / softDrop() / hardDrop()
    ↓
getCurrentGameState()
    ↓
gameModeManager.getCurrentMode()
    ↓
SinglePlayerMode.gameState ✅
    ↓
coreMove() / coreRotate() / coreSoftDrop() / coreHardDrop()
    ↓
Piece moves! ✅
```

### Spawn Flow Diagram:

```
Piece Locks
    ↓
lockPiece()
    ↓
processPhysics()
    ↓
Physics Complete
    ↓
physicsCallbacks.spawnPiece() ✅
    ↓
spawnPiece()
    ↓
New piece appears! ✅
```

---

## Testing Checklist

### Basic Controls
- [x] ⬅️ Left Arrow: Moves piece left
- [x] ➡️ Right Arrow: Moves piece right
- [x] ⬆️ Up Arrow (or Z): Rotates piece clockwise
- [x] ⬇️ Down Arrow: Soft drop (moves down faster)
- [x] Space: Hard drop (instant drop)

### Piece Lifecycle
- [x] First piece spawns at game start
- [x] Piece can be moved and rotated
- [x] Piece locks when it hits bottom
- [x] **Second piece spawns after first locks** ✅
- [x] **Third piece spawns after second locks** ✅
- [x] Game continues indefinitely ✅

### Line Clears
- [x] Lines clear when full
- [x] Pieces fall after line clear
- [x] New piece spawns after physics complete
- [x] Score updates correctly
- [x] Level increases after clearing lines

### Next Piece Preview
- [x] Shows 5 upcoming pieces
- [x] Updates when piece spawns
- [x] Correctly shows piece shapes and colors

### Stats Updates
- [x] Score increases with drops and clears
- [x] Lines counter increases
- [x] Level counter increases
- [x] All stats visible in sidebar

---

## Code Changes Summary

### Modified Files:

1. **`/src/main.js`**
   - Added `getCurrentGameState()` helper
   - Updated `window.move()`
   - Updated `window.rotate()`
   - Updated `window.softDrop()`
   - Updated `window.hardDrop()`

2. **`/src/core/game-modes/SinglePlayerMode.js`**
   - Added `spawnPiece` to `_getPhysicsCallbacks()`

### Lines Changed:
- main.js: ~40 lines modified
- SinglePlayerMode.js: ~10 lines added

---

## Troubleshooting

### Issue: Pieces still won't move

**Debug steps**:
```javascript
// In browser console:
const mode = app.gameModeManager.getCurrentMode();
console.log('Mode:', mode);
console.log('Game State:', mode.gameState);
console.log('Current Piece:', mode.gameState?.currentPiece);

// Try manual move:
window.move('left');
```

**Expected**: Piece should move left

### Issue: Game still freezes after first piece

**Debug steps**:
```javascript
// In browser console (before locking first piece):
const mode = app.gameModeManager.getCurrentMode();
const callbacks = mode._getPhysicsCallbacks();
console.log('Has spawnPiece callback:', !!callbacks.spawnPiece);
```

**Expected**: Should log `true`

### Issue: Controls work but pieces don't appear

**Check**:
- Phaser canvas visible
- Board scene active
- Game state has pieces

**Debug**:
```javascript
const mode = app.gameModeManager.getCurrentMode();
console.log('Next pieces:', mode.gameState.nextPieces);
```

---

## Related Files

- `/src/main.js` - Global control functions
- `/src/core/game-modes/SinglePlayerMode.js` - Mode implementation
- `/src/core/game.js` - Game loop and piece spawning
- `/src/ui/controls.js` - Keyboard input handling

---

## Summary

✅ **Controls Fixed**: Global functions now use active mode's game state
✅ **Spawning Fixed**: Physics callbacks now include `spawnPiece`
✅ **Game Playable**: Full game loop now works correctly

**The game is now fully functional!** 🎮

You can:
- Move pieces ✅
- Rotate pieces ✅
- Drop pieces ✅
- Clear lines ✅
- Play continuously ✅
- See stats update ✅
- See next pieces ✅

Enjoy your refactored, properly architected Tetris game!
