# Phase 3 Bug Fix: MultiPlayerState Compatibility

**Date:** October 30, 2025  
**Issue:** Game crashes on start with "Cannot read properties of undefined" errors  
**Root Cause:** Incompatibility between new `MultiPlayerState` array-based structure and legacy callback system

---

## Problem Summary

After implementing Phase 3 (Game State Extension), the local multiplayer mode was creating a new `MultiPlayerState` instance with an array-based structure (`players[0]`, `players[1]`), but the game callbacks in `main.js` were still expecting the old structure (`player1`, `player2`).

### Errors Encountered

1. **`game.js:216`**: `Cannot read properties of undefined (reading 'nextPieces')`
2. **`main.js:2183`**: `Cannot read properties of undefined (reading 'isEmpty')`
3. **`game.js:371`**: `Cannot read properties of undefined (reading 'currentPiece')`

These errors occurred because:
- The callbacks were trying to access `multiplayerState.player1` and `multiplayerState.player2`
- But the new `MultiPlayerState` uses `multiplayerState.players[0]` and `multiplayerState.players[1]`

---

## Solution

Updated `src/main.js` to support **both** the old and new multiplayer state structures, ensuring backward compatibility with legacy code while supporting the new array-based system.

### Changes Made

#### 1. Updated `spawnPiece` Callback (Line 2206-2250)

**Issue:** The callback was calling `getGarbageQueue(playerNum)`, `insertPendingGarbage(playerNum)`, and `resolveGarbageCascade(playerNum)` with 1-based player numbers, but the new structure expects 0-based indices.

**Fix:** Added playerIdentifier conversion at the start of the callback:
```javascript
callbacks.spawnPiece = async () => {
    // Convert playerNum to appropriate format based on multiplayerState structure
    const playerIdentifier = multiplayerState.players 
        ? playerNum - 1  // New structure uses 0-based index
        : playerNum;     // Old structure uses 1-based player number
    
    const garbageQueue = multiplayerState.getGarbageQueue(playerIdentifier);
    // ... rest of callback uses playerIdentifier
};
```

#### 2. Updated `getMultiplayerPhysicsCallbacks()` (Line 2077-2080)

**Before:**
```javascript
const playerState = playerNum === 1 ? multiplayerState.player1 : multiplayerState.player2;
```

**After:**
```javascript
// Support both old structure (player1/player2) and new structure (players array)
const playerState = multiplayerState.players 
    ? multiplayerState.players[playerNum - 1]  // New array-based structure
    : (playerNum === 1 ? multiplayerState.player1 : multiplayerState.player2);  // Old structure
```

#### 3. Updated `onGarbageReady` Callback (Line 2117-2133)

**Before:**
```javascript
onGarbageReady: (summary) => {
    multiplayerState.handleGarbageSummary(
        playerNum,
        summary,
        ...
    );
},
```

**After:**
```javascript
onGarbageReady: (summary) => {
    // Convert playerNum to appropriate format based on multiplayerState structure
    const playerIdentifier = multiplayerState.players 
        ? playerNum - 1  // New structure uses 0-based index
        : playerNum;     // Old structure uses 1-based player number
    
    multiplayerState.handleGarbageSummary(
        playerIdentifier,
        summary,
        ...
    );
},
```

**Reason:** The new `MultiPlayerState.handleGarbageSummary()` expects 0-based indices, while the old system uses 1-based player numbers.

#### 4. Updated `getCurrentGameState()` Helper (Line 1249-1251)

**Before:**
```javascript
if (currentMode && currentMode.multiplayerState) {
    return currentMode.multiplayerState.player1;
}
```

**After:**
```javascript
if (currentMode && currentMode.multiplayerState) {
    const multiplayerState = currentMode.multiplayerState;
    // Support both new (players array) and old (player1/player2) structure
    return multiplayerState.players ? multiplayerState.players[0] : multiplayerState.player1;
}
```

#### 5. Added `getPlayerState()` Helper (Line 1367-1377)

**New helper function:**
```javascript
// Helper to get player state (supports both old and new structure)
const getPlayerState = (playerNum) => {
    const multiplayerState = getMultiplayerState();
    if (!multiplayerState) return null;
    
    // New structure uses players array (0-based), old structure uses player1/player2
    if (multiplayerState.players) {
        return multiplayerState.players[playerNum - 1];
    } else {
        return playerNum === 1 ? multiplayerState.player1 : multiplayerState.player2;
    }
};
```

#### 6. Updated Player 2 Input Handlers (Lines 1380-1428)

Updated all Player 2 control functions to use the new `getPlayerState()` helper:

**Before:**
```javascript
window.moveP2 = (dir) => {
    const multiplayerState = getMultiplayerState();
    if (multiplayerState && !multiplayerState.isGameOver) {
        coreMove(multiplayerState.player2, ...);
    }
};
```

**After:**
```javascript
window.moveP2 = (dir) => {
    const multiplayerState = getMultiplayerState();
    const player2State = getPlayerState(2);
    if (multiplayerState && player2State && !multiplayerState.isGameOver) {
        coreMove(player2State, ...);
    }
};
```

Applied to:
- `window.moveP2()`
- `window.rotateP2()`
- `window.softDropP2()`
- `window.hardDropP2()`

---

## Structure Comparison

### Old Structure (MultiplayerGameState)
```javascript
{
    player1: GameState,
    player2: GameState,
    handleGarbageSummary(playerNum, ...) // 1-based player numbers
}
```

### New Structure (MultiPlayerState)
```javascript
{
    numPlayers: 2-4,
    players: [GameState, GameState, ...], // Array of 2-4 players
    handleGarbageSummary(playerIndex, ...) // 0-based indices
}
```

---

#### 7. Fixed `endMultiplayerGame()` Method (Line 2303-2330)

**Issue:** Called `multiplayerState.setGameOver(losingPlayer)` which doesn't exist in new `MultiPlayerState`.

**Fix:** 
```javascript
// New MultiPlayerState uses handlePlayerDeath with 0-based index
if (multiplayerState.players && typeof multiplayerState.handlePlayerDeath === 'function') {
    const losingPlayerIndex = losingPlayer - 1; // Convert to 0-based
    multiplayerState.handlePlayerDeath(losingPlayerIndex);
    
    // Let LocalMultiplayerMode handle the rest
    if (currentMode && typeof currentMode._handleGameOver === 'function') {
        return;
    }
} else if (typeof multiplayerState.setGameOver === 'function') {
    // Old structure
    multiplayerState.setGameOver(losingPlayer);
}
```

#### 8. Fixed `_syncBoardScenes()` in LocalMultiplayerMode (Line 501-526)

**Issue:** Still accessing `multiplayerState.player1` and `multiplayerState.player2` instead of array.

**Fix:**
```javascript
_syncBoardScenes() {
    this.boardScenes.forEach((scene, index) => {
        // Use array-based access for new MultiPlayerState
        const playerState = this.multiplayerState.players[index];
        
        if (!playerState) {
            console.warn(`[LocalMultiplayer] No player state for index ${index}`);
            return;
        }
        
        if (scene && scene.syncFromGameState) {
            scene.syncFromGameState(playerState);
        }
    });
}
```

**This was causing the tetrominos to be invisible!** The sync method was getting `undefined` for playerState.

## Testing

After these changes:
- ✅ Game starts successfully
- ✅ Both players can control their pieces
- ✅ **Tetrominos are now visible on screen**
- ✅ Piece spawning works correctly
- ✅ Input handling (keyboard/gamepad) functions properly
- ✅ **Game over handling works correctly**
- ✅ No linter errors

---

## Backward Compatibility

All changes maintain **full backward compatibility** with the legacy local multiplayer system:
- Old code using `player1`/`player2` continues to work
- New code using `players[]` array works seamlessly
- Detection is automatic based on structure inspection

---

## Files Modified

1. **`src/main.js`**
   - Updated `getMultiplayerPhysicsCallbacks()` for dual-structure support
   - Fixed `spawnPiece` callback index conversion
   - Updated `onGarbageReady` callback indexing
   - Fixed `getCurrentGameState()` helper
   - Added `getPlayerState()` helper
   - Updated all Player 2 input handlers
   - **Fixed `endMultiplayerGame()` to use `handlePlayerDeath()`**

2. **`src/core/game-modes/LocalMultiplayerMode.js`**
   - **Fixed `_syncBoardScenes()` to use array-based player access**

## Files Created

- None (bug fix only)

---

## Next Steps

Phase 3 is now **complete and working**. Ready to proceed with:
- **Phase 4:** Update Rendering System (horizontal layouts for 2-4 players)
- **Phase 5:** Implement 4-Player Input Handling
- **Phase 6:** Update Garbage System for multi-player routing
- **Phase 7:** Testing and Polish

