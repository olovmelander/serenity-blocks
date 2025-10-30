# Phase 3 Round-End Bug Fix

**Date:** October 30, 2025  
**Issue:** Rounds don't end when a player tops out (hits the top of the board)  
**Expected:** When a player dies, the round should end, opponent gets a frag, and either start new round or end match

---

## Problem Analysis

When a player's pieces hit the top of the board (game over condition), the round was not ending properly. Two issues were identified:

### Issue 1: Game Loop Processing Dead Players

**Location:** `src/core/game-modes/LocalMultiplayerMode.js` line 404

**Problem:** The game loop was processing physics for ALL players, including dead ones. This meant dead players continued to have pieces spawn and drop.

```javascript
// ❌ WRONG - No check for dead players
for (let playerIndex = 0; playerIndex < this.multiplayerState.numPlayers; playerIndex++) {
    const playerState = this.multiplayerState.players[playerIndex];
    
    if (!playerState.isProcessingPhysics && playerState.currentPiece) {
        // Process physics even if player is dead!
    }
}
```

**Fix:** Added `isAlive` check to skip dead players:
```javascript
// ✅ CORRECT - Skip dead players
for (let playerIndex = 0; playerIndex < this.multiplayerState.numPlayers; playerIndex++) {
    const playerState = this.multiplayerState.players[playerIndex];
    
    // Skip dead players
    if (!playerState.isAlive) {
        continue;
    }
    
    if (!playerState.isProcessingPhysics && playerState.currentPiece) {
        // Only process physics for alive players
    }
}
```

---

### Issue 2: Conflicting Round-End vs Match-End Logic

**Location:** `src/core/multi-player-state.js` line 272-287

**Problem:** The `checkWinCondition()` method was treating "last player standing" as a MATCH-END condition, when it should be a ROUND-END condition. This caused the entire match to end after the first death, instead of just ending the round.

```javascript
// ❌ WRONG - Treats "last player standing" as match-end
checkWinCondition() {
    const alivePlayers = this.players.filter(p => p.isAlive);
    
    // This immediately ends the MATCH after first death!
    if (alivePlayers.length === 1) {
        const winnerIndex = this.players.findIndex(p => p.isAlive);
        this.endMatch(winnerIndex); // Sets isGameOver = true
        return true;
    }
    
    // Check other conditions...
}
```

**Why This Was Wrong:**
- In a best-of-7 (first to 7 frags) match, rounds should continue until one player reaches 7 frags
- "Last player standing" should end the ROUND (award 1 frag), not the MATCH
- `LocalMultiplayerMode._handleGameOver()` already properly handles round-end logic

**Fix:** Removed "last player standing" check from `checkWinCondition()`:
```javascript
// ✅ CORRECT - Only checks MATCH win conditions
checkWinCondition() {
    // Check specific win conditions (frags, time, points, lines, never)
    // DO NOT check "last player standing" here - that's handled by LocalMultiplayerMode
    switch (config.endCondition) {
        case 'frags': {
            // Only end match if a player has reached the frag target
            if (maxFrags >= config.endConditionValue) {
                this.endMatch(topPlayerIndex);
            }
            break;
        }
        // ... other conditions
    }
}
```

---

## How It Works Now

### Proper Round-End Flow:

1. **Player tops out** → `spawnPiece()` calls `gameOverCallback()`
2. **`_handleGameOver(playerIndex)` is called**
   - Calls `multiplayerState.handlePlayerDeath(playerIndex)`
   - Sets `player.isAlive = false`
   - Awards frag to opponent
   - Calls `checkWinCondition()` (only checks match-end, not round-end)
3. **`_handleGameOver` determines round winner**
   - For 2 players: opponent wins round
   - For 3-4 players: checks if only 1 player left alive
4. **Calls `handleRoundEnd(winnerKey)`**
   - Accumulates stats
   - Checks if winner has enough frags for match victory
   - If yes: Shows match-end screen
   - If no: Starts new round with `_startNewRound()`
5. **Game loop skips dead players** until round resets

---

### Issue 3: Handler Not Being Called 🔧 → ✅ FIXED

**Location:** `src/main.js` line 2323-2325

**Problem:** After calling `handlePlayerDeath()`, the code checked if `_handleGameOver` exists, then **returned early** without actually calling it!

```javascript
// ❌ WRONG - Checks for handler but never calls it!
if (currentMode && typeof currentMode._handleGameOver === 'function') {
    // LocalMultiplayerMode will handle the rest
    return; // ← Returns without calling _handleGameOver()!
}
```

**Fix:** Actually call the handler:
```javascript
// ✅ CORRECT - Actually calls the handler
if (currentMode && typeof currentMode._handleGameOver === 'function') {
    // Call LocalMultiplayerMode's round-end handler
    await currentMode._handleGameOver(losingPlayerIndex);
    return;
}
```

---

## Files Modified

1. **`src/core/game-modes/LocalMultiplayerMode.js`**
   - Line 405-407: Added `isAlive` check in game loop

2. **`src/core/multi-player-state.js`**
   - Lines 269-279: Removed "last player standing" logic from `checkWinCondition()`
   - Added clarifying comments about round-end vs match-end logic

3. **`src/main.js`**
   - Line 2325: Actually call `_handleGameOver()` instead of just checking if it exists

---

## Testing Checklist

After these changes:
- ✅ When a player tops out, their pieces stop spawning
- ✅ Round ends immediately when a player dies
- ✅ Opponent is awarded a frag
- ✅ If opponent has reached win condition (e.g., 7 frags): Match ends with victory screen
- ✅ If opponent hasn't reached win condition: New round starts
- ✅ Round counter increments correctly
- ✅ Multiple rounds can be played until someone wins the match
- ✅ All win conditions work (frags, time, points, lines, never)

---

## Key Concepts

### Round vs Match
- **Round:** Single game until one player dies (or time/score limit in that round)
- **Match:** Best-of-N format (e.g., first to 7 frags wins the match)

### Who Handles What
- **`MultiPlayerState.checkWinCondition()`:** Checks MATCH win conditions only
  - Has a player reached the frag target?
  - Has time limit been reached?
  - Has score target been reached?
  
- **`LocalMultiplayerMode._handleGameOver()`:** Handles ROUND end logic
  - Determines round winner
  - Awards frag to winner
  - Decides whether to start new round or end match
  - Manages round-to-round state transitions

---

## Related Files

- `src/core/game.js` - `spawnPiece()` function that detects top-out
- `src/main.js` - `endMultiplayerGame()` callback handler
- `PHASE_3_BUG_FIX.md` - Previous compatibility fixes

