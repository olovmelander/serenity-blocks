# Phase 2 Testing Checklist

**Date:** October 18, 2025  
**Status:** Ready for Testing

---

## Setup Instructions

1. **Open TWO browser windows** (side by side)
2. **Window 1 (Host):**
   - Open game
   - Create lobby
   - Start match when ready
3. **Window 2 (Peer):**
   - Open game
   - Join lobby created by Window 1
   - Ready up

---

## Critical Tests

### ✅ Test 1: Peer Sees Host's Pieces
**Expected:** Peer window shows host's tetromino moving in real-time

**Steps:**
1. Start match with 2 players
2. In Host window, press arrow keys to move piece
3. **Look at Peer window** - Should see host's piece moving

**Pass Criteria:**
- [ ] Peer sees host's current piece
- [ ] Piece position updates smoothly (60 FPS)
- [ ] Piece moves when host presses keys

---

### ✅ Test 2: Host Sees Peer's Pieces
**Expected:** Host window shows peer's tetromino moving in real-time

**Steps:**
1. In Peer window, press arrow keys to move piece
2. **Look at Host window** - Should see peer's piece moving

**Pass Criteria:**
- [ ] Host sees peer's current piece
- [ ] Piece position updates smoothly
- [ ] Piece moves when peer presses keys

---

### ✅ Test 3: Both See Each Other's Board
**Expected:** Both players see all boards (including their own)

**Steps:**
1. Both players play for 30 seconds
2. Clear some lines
3. Lock some pieces

**Pass Criteria:**
- [ ] Both players see multiple canvases (self + opponent)
- [ ] Locked pieces appear on both boards
- [ ] Line clears show on both boards
- [ ] Boards stay in sync

---

### ✅ Test 4: State Sync Frequency (30Hz)
**Expected:** Visual updates happen smoothly without lag

**Steps:**
1. Play for 1 minute
2. Observe opponent's board

**Pass Criteria:**
- [ ] No stuttering or freezing
- [ ] Smooth piece movement
- [ ] No visible lag (< 100ms delay)

**Open browser console and check for:**
```
📡 State sync started (30Hz)
```

---

### ✅ Test 5: Pieces in Correct Positions
**Expected:** Pieces appear in exact positions on both screens

**Steps:**
1. Host drops piece to bottom-left corner
2. Peer checks if piece appears in bottom-left on their screen
3. Repeat for different positions

**Pass Criteria:**
- [ ] Pieces match positions exactly
- [ ] No offset or misalignment
- [ ] Colors match

---

### ✅ Test 6: Stats Update (Score, Lines, Level)
**Expected:** Score/lines/level update on both screens

**Steps:**
1. Clear 4 lines in Host window
2. Check Peer window - Should see Host's score increase
3. Clear 4 lines in Peer window
4. Check Host window - Should see Peer's score increase

**Pass Criteria:**
- [ ] Score updates appear on opponent's screen
- [ ] Lines cleared counter updates
- [ ] Level updates (if applicable)

---

## Console Checks

**Host Console Should Show:**
```
🎮 Game loop started (60fps with rendering, HOST mode)
📡 State sync started (30Hz)
```

**Peer Console Should Show:**
```
🎮 Game loop started (60fps with rendering, PEER mode)
📬 Peer received game start from host!
```

**Both Should Show (60 times per second):**
```
🎮 ffa:render-frame event dispatched
```

---

## Common Issues

### Issue: Peer sees nothing
**Check:**
- Is `ffa:render-frame` event firing? (Check console)
- Is `MultiPlayerCanvasLayout.renderFrame()` being called?
- Are canvases created? (Inspect DOM)

**Fix:** Check `main.js` event listener for `ffa:render-frame`

---

### Issue: Pieces don't move smoothly
**Check:**
- Is game loop running at 60 FPS?
- Is state sync running at 30Hz?

**Fix:** Check `startGameLoop()` interval is 1000/60 = 16.67ms

---

### Issue: Board is blank
**Check:**
- Are locked pieces being sent in state broadcast?
- Is peer receiving `GAME_STATE_FULL` messages?

**Fix:** Check `broadcastGameState()` includes `lockedPieces`

---

### Issue: Only host's board updates
**Check:**
- Is peer sending inputs to host?
- Is host processing peer inputs?

**Fix:** Check `processPlayerInput()` is called for peer's inputs

---

## Performance Checks

Open browser DevTools → Performance tab:

**Expected:**
- 60 FPS rendering (16.67ms per frame)
- No dropped frames
- < 5% CPU usage per window

**If Performance is Bad:**
- Check if too many canvases are rendering
- Check if locked pieces array is too large (> 200 pieces)
- Enable canvas pooling/optimization

---

## Debug Commands

Open console and run:

```javascript
// Check game state
window.ffaGameState.players.forEach((p, id) => {
  console.log(`${p.name}: Alive=${p.isAlive}, Frags=${p.frags}, Score=${p.gameState.score}`);
});

// Check render loop
console.log('Game loop:', window.ffaGameState.gameLoopInterval ? 'RUNNING' : 'STOPPED');

// Check state sync (host only)
console.log('State sync:', window.ffaGameState.stateSyncInterval ? 'RUNNING' : 'STOPPED');

// Force render
window.ffaGameState.renderAllPlayers();
```

---

## Success Criteria

**Phase 2 is COMPLETE when:**
- ✅ Peer sees host's pieces moving in real-time
- ✅ Host sees peer's pieces moving in real-time
- ✅ Both players see locked pieces on both boards
- ✅ Stats (score, lines, level) sync correctly
- ✅ No visual lag or stuttering
- ✅ Pieces appear in correct positions
- ✅ 60 FPS rendering on both windows
- ✅ 30Hz state sync (host → peer)

---

## If All Tests Pass → Phase 3

If all the above tests pass, you're ready for **Phase 3: Garbage System Integration**!

Phase 3 will add:
- Garbage lines appearing after attacks
- Garbage queue indicators
- Top-out detection from garbage
- Frag attribution

---

## If Tests Fail

Report the specific test that failed and we'll debug it together!

**Include:**
1. Which test failed
2. Console errors (if any)
3. Screenshots (if helpful)
4. Browser console output

---

**Good luck testing! 🚀**

