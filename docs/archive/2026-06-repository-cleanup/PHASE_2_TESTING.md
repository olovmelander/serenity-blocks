# Phase 2 Testing Guide - FFA Game State & Anti-Cheat

**Status:** ✅ Ready for Testing  
**Date:** October 16, 2025

---

## 🧪 Test Phase 2 Features

### Quick Test (Browser Console)

1. **Start your dev server** (if not running):
   ```bash
   npm run dev
   ```

2. **Open browser** at `http://localhost:5173`

3. **Open DevTools Console** (F12)

4. **Run the automated test**:
   ```javascript
   testFFA()
   ```

---

## ✅ Expected Test Output

```
🧪 Testing FFA Game State...

Step 1: Creating FFA match...
🧪 Mock lobby created: mock_lobby_1760634123456
✅ Player added: Dev_XXX (mock_xxxxx) [LOCAL]
✅ FFA Match created!
   Lobby ID: mock_lobby_1760634123456
   You are HOST
   Access via: window.ffa
✅ Match created
   Players: 1
   Is Host: true
   Phase: waiting

Step 2: Setting player ready...
✅ Local player is ready

Step 3: Starting match...
✅ Player Dev_XXX initialized with seed 123456
📡 State sync started (30Hz)
🎮 Match started!
   Seed: 123456
   End Condition: frags = 10
   Players: 1
✅ Match started!
   Seed: 123456
   Phase: playing
   Players: 1

Step 4: Sending test inputs...
📥 Dev_XXX input: move Object
📥 Dev_XXX input: rotate Object
📥 Dev_XXX input: drop Object
✅ Inputs sent

Step 5: Checking anti-cheat stats...
✅ Validator stats: Object

🎉 FFA Game State test complete!

📊 Current State:
   Players: 1
   Phase: playing
   Is Host: true
   Seed: 123456

💡 Try these commands:
   - ffa.sendInput("move", { direction: 1 })
   - ffa.sendInput("rotate", { direction: "left" })
   - ffa.sendInput("drop", { type: "hard" })
   - ffa.players  # See all players
   - ffa.broadcastGameState()  # Manual sync (host only)
```

---

## 🎮 Manual Testing

### Test 1: Create Match

```javascript
// Create an FFA match
const ffa = await createFFAMatch({
  gameName: 'My Test Match',
  maxPlayers: 8
});

// Check the state
console.log('Players:', ffa.players.size);
console.log('Is Host:', ffa.isHost);
console.log('Phase:', ffa.gamePhase);
```

**Expected:**
- ✅ Match created
- ✅ `ffa.isHost === true`
- ✅ `ffa.players.size === 1`
- ✅ `ffa.gamePhase === 'waiting'`

---

### Test 2: Ready Up & Start Match

```javascript
// Set ready
ffa.setReady(true);

// Start match (host only)
ffa.startMatch();

// Check match state
console.log('Game Phase:', ffa.gamePhase);
console.log('Shared Seed:', ffa.sharedSeed);
console.log('Players:', Array.from(ffa.players.values()));
```

**Expected:**
- ✅ `ffa.gamePhase === 'playing'`
- ✅ `ffa.sharedSeed` is a number (e.g., 453892)
- ✅ State sync started (30Hz broadcasts)

---

### Test 3: Send Inputs

```javascript
// Send various inputs
ffa.sendInput('move', { direction: 1 });    // Move right
ffa.sendInput('move', { direction: -1 });   // Move left
ffa.sendInput('rotate', { direction: 'left' });
ffa.sendInput('rotate', { direction: 'right' });
ffa.sendInput('drop', { type: 'soft' });
ffa.sendInput('drop', { type: 'hard' });
```

**Expected:**
- ✅ Console shows: `📥 Dev_XXX input: move ...`
- ✅ No errors or warnings
- ✅ Inputs are validated before processing

---

### Test 4: Test Anti-Cheat (Rate Limiting)

```javascript
// Try to spam inputs (should be blocked)
for (let i = 0; i < 100; i++) {
  ffa.sendInput('move', { direction: 1 });
}

// Check validator stats
const stats = ffa.inputValidator.getPlayerStats(ffa.localPlayerId);
console.log('Validator Stats:', stats);
```

**Expected:**
- ✅ Rate limit warnings appear after ~30 inputs/second
- ✅ Console shows: `⚠️ Player XXX exceeded input rate limit`
- ✅ Excessive inputs are rejected (anti-cheat working!)

---

### Test 5: Test Invalid Inputs (Should Be Rejected)

```javascript
// Invalid move
ffa.sendInput('move', { direction: 5 }); // Invalid! Only -1 or 1 allowed

// Invalid rotate
ffa.sendInput('rotate', { direction: 'up' }); // Invalid! Only left/right/flip

// Invalid drop
ffa.sendInput('drop', { type: 'mega' }); // Invalid! Only soft/hard
```

**Expected:**
- ✅ Console shows: `⚠️ Invalid input from Dev_XXX: Invalid move direction: 5`
- ✅ Invalid inputs are rejected
- ✅ Anti-cheat validation working!

---

### Test 6: Check State Synchronization (Host Only)

```javascript
// Manually trigger state broadcast
ffa.broadcastGameState();

// Check what's being broadcast
console.log('State to broadcast:', {
  players: Array.from(ffa.players.values()).map(p => ({
    name: p.name,
    score: p.gameState.score,
    isAlive: p.isAlive
  })),
  phase: ffa.gamePhase
});
```

**Expected:**
- ✅ State broadcast sent to all peers
- ✅ Contains player stats (score, lines, frags)
- ✅ Happens automatically at 30Hz

---

### Test 7: Inspect Player State

```javascript
// Get local player
const localPlayer = ffa.getLocalPlayer();

console.log('Local Player:', {
  name: localPlayer.name,
  steamId: localPlayer.steamId,
  isAlive: localPlayer.isAlive,
  isReady: localPlayer.isReady,
  frags: localPlayer.frags,
  score: localPlayer.gameState.score,
  lines: localPlayer.gameState.lines,
  level: localPlayer.gameState.level,
});
```

**Expected:**
- ✅ All player data is accessible
- ✅ Game state is initialized
- ✅ Garbage queue exists

---

### Test 8: Cleanup

```javascript
// Clean up match
ffa.cleanup();

console.log('Phase after cleanup:', ffa.gamePhase);
console.log('Players after cleanup:', ffa.players.size);
```

**Expected:**
- ✅ State sync stopped
- ✅ Players cleared
- ✅ Phase set to 'waiting'
- ✅ Console shows: `🧹 FFA game state cleaned up`

---

## 🔍 What to Verify

### ✅ Core Functionality
- [ ] Match creation works
- [ ] Player can set ready status
- [ ] Match starts with deterministic seed
- [ ] State sync broadcasts at 30Hz (host only)
- [ ] Inputs are sent and processed
- [ ] Cleanup works properly

### ✅ Anti-Cheat
- [ ] Rate limiting works (max 30 inputs/sec)
- [ ] Invalid inputs are rejected
- [ ] Timestamp validation works
- [ ] Input history is tracked
- [ ] Validator stats are accurate

### ✅ Host-Authoritative
- [ ] Host validates all inputs
- [ ] Host broadcasts state
- [ ] Peers receive state updates
- [ ] Deterministic RNG working (same seed = same pieces)
- [ ] All players synchronized

### ✅ Network Messages
- [ ] `GAME_INPUT_MOVE` sent correctly
- [ ] `GAME_INPUT_ROTATE` sent correctly
- [ ] `GAME_INPUT_DROP` sent correctly
- [ ] `GAME_STATE_FULL` broadcast (host only)
- [ ] Message handlers registered

---

## 🐛 Troubleshooting

### Issue: "Steam networking not initialized"
**Solution:** Refresh the page and wait for Steam to initialize.

### Issue: No console output when sending inputs
**Solution:** Make sure match is started (`ffa.gamePhase === 'playing'`)

### Issue: Rate limit warnings immediately
**Solution:** This is correct! Anti-cheat is working.

### Issue: "Cannot read property 'sendInput' of null"
**Solution:** Create a match first: `await createFFAMatch()`

---

## 📊 Phase 2 Features Implemented

### Files Created
- ✅ `src/core/validation/input-validator.js` (238 lines)
- ✅ `src/core/multiplayer/ffa-p2p-game-state.js` (458 lines)

### Files Modified
- ✅ `src/main.js` - Added FFA integration and test functions

### Features
- ✅ Host-authoritative game state
- ✅ Input validation (anti-cheat)
- ✅ Rate limiting (30 inputs/sec max)
- ✅ Deterministic RNG (seeded random)
- ✅ State synchronization (30Hz)
- ✅ Player management
- ✅ Match lifecycle (waiting → playing → finished)
- ✅ Ready system
- ✅ Network message handlers
- ✅ Cleanup on disconnect

---

## 🎯 Next: Phase 3

Once Phase 2 testing is complete, Phase 3 will add:
- FFA attack routing (all-vs-all combat)
- Garbage calculation and distribution
- Frag tracking and kill feed
- All 5 end conditions
- Host migration on disconnect

---

**Test thoroughly and report any issues!** 🚀

