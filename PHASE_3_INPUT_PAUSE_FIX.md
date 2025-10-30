# Phase 3: Input Between Rounds Fix

**Date:** October 30, 2025  
**Issue:** Players can still control pieces and score points during round transitions  
**Severity:** Gameplay breaking - allows unfair scoring between rounds

---

## Problem Description

After a player dies and a round ends, there's a period where:
1. Round-end overlay is shown (3 seconds)
2. Countdown happens (3 seconds)
3. New round starts

During this ~6 second transition, players could still:
- ❌ Move and rotate pieces
- ❌ Hard drop pieces
- ❌ Score points
- ❌ Clear lines
- ❌ Gain unfair advantage

**User Report:**
> "when we get the score shown, i can still fast drop the pieces and the score of the game increases for the other player. this should not be possible between rounds."

---

## Root Cause

The game was not being paused immediately when a player died. The pause only happened later in the `_startNewRound()` method, after:
- Round-end overlay was shown
- 3 second wait
- Overlay was removed
- Stats were accumulated
- State was reset

**Timeline of Events (BEFORE FIX):**

```
T+0ms:   Player dies
T+10ms:  _handleGameOver() called
T+20ms:  handlePlayerDeath() marks player as dead
T+30ms:  handleRoundEnd() called
T+40ms:  _showRoundEnd() shows overlay
         ⚠️  GAME STILL RUNNING - Players can control pieces!
T+3000ms: Overlay waits 3 seconds
         ⚠️  GAME STILL RUNNING - Pieces falling, input working!
T+3300ms: Overlay removed
T+3310ms: _startNewRound() called
T+3320ms: isPaused = true  ← TOO LATE!
T+3330ms: _showCountdown() 
T+6330ms: Countdown completes
T+6340ms: isPaused = false
T+6350ms: New round starts
```

**Problem Window:** 3.3 seconds where game is running but shouldn't be!

---

## Solution

**TWO fixes were required:**

### Fix 1: Immediate Pause (Incomplete - Not Enough!)
Initially, we added an immediate pause at the start of `_handleGameOver()`. This paused the game loop but **did NOT block input handlers**!

### Fix 2: Input Handler Pause Checks (The Real Fix!)
The input handlers (`window.move`, `window.rotate`, `window.softDrop`, `window.hardDrop`, and Player 2 equivalents) were **not checking the pause state** before processing input. They only checked if the piece existed.

### Code Changes

#### Change 1: Immediate Pause in _handleGameOver()

**File:** `src/core/game-modes/LocalMultiplayerMode.js`  
**Line:** 540-541

```javascript
async _handleGameOver(playerIndex) {
    console.log(`[LocalMultiplayer] Player ${playerIndex + 1} lost!`);

    // IMMEDIATELY pause the game to prevent input during round transition
    this.multiplayerState.isPaused = true;  // ← Pauses game loop

    // Mark player as dead and handle frag attribution
    this.multiplayerState.handlePlayerDeath(playerIndex);
    // ... rest of logic
}
```

**This alone was NOT enough!** The game loop stopped, but input handlers kept working.

---

#### Change 2: Add Pause Checks to ALL Input Handlers (THE REAL FIX)

**File:** `src/main.js`  
**Lines:** 1262-1334 (Player 1), 1398-1450 (Player 2)

**Player 1 Example - BEFORE:**
```javascript
window.hardDrop = () => {
    const gameState = getCurrentGameState();
    if (!gameState || !gameState.currentPiece) return;
    // ❌ No pause check!
    
    coreHardDrop(gameState, ...);
};
```

**Player 1 Example - AFTER:**
```javascript
window.hardDrop = () => {
    const gameState = getCurrentGameState();
    if (!gameState || !gameState.currentPiece) return;
    
    // ✅ Check if game is paused!
    const currentMode = this.gameModeManager?.getCurrentMode();
    if (currentMode?.multiplayerState?.isPaused || gameState.isPaused) return;
    
    coreHardDrop(gameState, ...);
};
```

**Applied to 8 functions:**
- `window.move()`
- `window.rotate()`
- `window.softDrop()`
- `window.hardDrop()`
- `window.moveP2()`
- `window.rotateP2()`
- `window.softDropP2()`
- `window.hardDropP2()`

---

## How It Works Now (FIXED)

**Timeline of Events (AFTER FIX):**

```
T+0ms:   Player dies
T+10ms:  _handleGameOver() called
T+20ms:  isPaused = true  ← IMMEDIATELY PAUSED!
T+30ms:  handlePlayerDeath() marks player as dead
T+40ms:  handleRoundEnd() called
T+50ms:  _showRoundEnd() shows overlay
         ✅  GAME PAUSED - No input accepted!
T+3000ms: Overlay waits 3 seconds
         ✅  GAME PAUSED - Pieces frozen!
T+3300ms: Overlay removed
T+3310ms: _startNewRound() called
T+3320ms: (isPaused already true)
T+3330ms: _showCountdown() 
         ✅  GAME PAUSED - Countdown shows
T+6330ms: Countdown completes
T+6340ms: isPaused = false  ← Unpause at correct time
T+6350ms: New round starts
         ✅  GAME ACTIVE - Input now accepted!
```

**Protected Window:** Entire 6.3 seconds is now properly paused!

---

## What Gets Paused

When `isPaused = true`, the game loop (line 391-394) checks the flag:

```javascript
if (this.multiplayerState.isPaused) {
    this.animationFrameId = requestAnimationFrame(loop);
    return; // Skip physics processing
}
```

This prevents:
- ✅ Piece dropping (gravity)
- ✅ Player input processing
- ✅ Physics updates
- ✅ Score accumulation
- ✅ Line clearing
- ✅ Garbage processing

**The boards are frozen until the new round starts!**

---

## Testing Checklist

After this fix:
- ✅ Player dies → game pauses immediately
- ✅ Round-end overlay shows with frozen boards
- ✅ No input is accepted during overlay (3s)
- ✅ Countdown shows with frozen boards
- ✅ No input is accepted during countdown (3s)
- ✅ After countdown "GO!" → game unpauses
- ✅ New round starts with working input
- ✅ No unfair scoring between rounds

---

## Impact

### Before Fix:
- ⚠️ ~3.3 seconds of playable time between rounds
- ⚠️ Players could gain unfair points
- ⚠️ Pieces kept falling during transitions
- ⚠️ Input was processed during overlays

### After Fix:
- ✅ Zero playable time between rounds
- ✅ Fair gameplay - no mid-transition scoring
- ✅ Pieces frozen during all transitions
- ✅ Input blocked during overlays and countdown

---

## Related Files

- `src/core/game-modes/LocalMultiplayerMode.js` - Main fix location
- `PHASE_3_ROUND_END_FIX.md` - Previous round-end fixes
- `PHASE_3_BUG_FIX.md` - Compatibility fixes

---

## Notes

- The game remains paused through both the round-end overlay (~3s) and countdown (~3s)
- Unpause only happens after countdown completes in `_showCountdown()` line 640
- The `isPaused` flag is checked in the game loop, blocking all physics updates
- This is the correct behavior for competitive Tetris - clean transitions between rounds

