# FFA Multiplayer Diagnostic Checklist

**Use this to debug when gameplay doesn't work after match starts**

---

## 🩺 Quick Health Check

Run these in browser console after starting a match:

### 1. Is the game state created?
```javascript
console.log('Game State:', window.ffa);
console.log('Players:', window.ffa?.players.size);
console.log('Game Phase:', window.ffa?.gamePhase);
```

**Expected:**
- `window.ffa` exists
- `players.size` >= 1
- `gamePhase` = 'playing'

**If not:** Match didn't start properly, check waiting room

---

### 2. Is the game loop running?
```javascript
// Add to FFAGameStateP2P.updateGameLoop()
console.log('🔄 Game loop tick', Date.now());
```

**Expected:** Console floods with messages (60 per second)

**If not:** Game loop didn't start
- Check `startGameLoop()` was called
- Check `gameLoopInterval` is set
- Check no JavaScript errors

---

### 3. Is rendering being called?
```javascript
// Add to FFAGameStateP2P.renderAllPlayers()
console.log('🎨 Render all players', Date.now());
```

**Expected:** Console floods with messages (60 per second)

**If not:** Rendering not connected to game loop
- Add `this.renderAllPlayers()` to game loop
- Check method exists

---

### 4. Is the event being dispatched?
```javascript
// Listen for the event
window.addEventListener('ffa:render-frame', (e) => {
  console.log('📡 Render event received', e.detail.players.length);
});
```

**Expected:** Console floods with messages

**If not:** Event not being dispatched
- Check `window.dispatchEvent()` is called
- Check event name matches exactly

---

### 5. Is main.js receiving the event?
```javascript
// Add to main.js event listener
console.log('📬 Main.js received render event');
```

**Expected:** Console floods with messages

**If not:** Event listener not registered
- Check `initializeMultiplayerUI()` was called
- Check event listener added
- Check `this.multiPlayerCanvasLayout` exists

---

### 6. Is canvas layout rendering?
```javascript
// Add to MultiPlayerCanvasLayout.renderFrame()
console.log('🖼️ Rendering canvases:', playersData.length);
```

**Expected:** Console floods with messages

**If not:** Method not being called or not implemented
- Implement `renderFrame()` method
- Check it's being called from main.js

---

### 7. Are canvases being drawn to?
```javascript
// Add to MultiPlayerCanvasLayout.renderFrame()
playersData.forEach(pd => {
  console.log('Drawing player:', pd.steamId, 'piece:', pd.gameState.currentPiece);
});
```

**Expected:** See player IDs and piece data

**If not:** Canvas info missing
- Check `this.canvases.get()` returns data
- Check canvases were created in `show()`

---

### 8. Do players have game states?
```javascript
console.log('Local player:', ffa.getLocalPlayer());
console.log('Has piece?', ffa.getLocalPlayer().gameState.currentPiece);
console.log('Locked pieces:', ffa.getLocalPlayer().gameState.lockedPieces.length);
```

**Expected:**
- Local player exists
- Has `currentPiece` object or null
- Has `lockedPieces` array

**If not:** Game state not initialized
- Check `initializePlayerForMatch()` was called
- Check `spawnPiece()` was called

---

### 9. Are inputs being sent?
```javascript
// Add to main.js multiplayerKeyHandler
console.log('⌨️ Key pressed:', e.code);

// Add to FFAGameStateP2P.sendInput()
console.log('📤 Sending input:', inputType, data);
```

**Expected:** See messages when pressing arrow keys

**If not:** Input handler not registered
- Check `setupMultiplayerControls()` was called
- Check event listener added to window
- Check game phase is 'playing'

---

### 10. Are inputs being processed?
```javascript
// Add to FFAGameStateP2P.processPlayerInput()
console.log('⚙️ Processing input:', steamId, inputType, data);
```

**Expected:** See messages when pressing arrow keys (host only)

**If not for host:** Input processing broken
- Check method is called
- Check player exists and is alive
- Check validation passes

**If not for peer:** Input not reaching host
- Check P2P messaging works
- Check host is receiving messages

---

## 🚨 Common Issues & Solutions

### Issue: "Nothing renders after match starts"

**Diagnostic:**
```javascript
// 1. Check game loop
console.log('Loop running?', !!ffa.gameLoopInterval);

// 2. Check render method exists
console.log('Render method?', typeof ffa.renderAllPlayers);

// 3. Check it's being called
// (Add console.log to renderAllPlayers)
```

**Solution:** Add `this.renderAllPlayers()` to game loop

---

### Issue: "I see one frame then it freezes"

**Diagnostic:**
```javascript
// Check if render is called repeatedly
let count = 0;
window.addEventListener('ffa:render-frame', () => {
  console.log('Render count:', ++count);
});
```

**Solution:** Render must be called every frame, not just once

---

### Issue: "Host sees gameplay but peer doesn't"

**Diagnostic:**
```javascript
// On peer window:
console.log('Is peer?', !ffa.isHost);
console.log('Peer loop running?', !!ffa.gameLoopInterval);
console.log('Peer receiving state?');
// (Check syncFromHost logs)
```

**Solution:** Peer needs its own render loop, not just host

---

### Issue: "Pieces move but don't show"

**Diagnostic:**
```javascript
// Check currentPiece exists
console.log('Piece:', ffa.getLocalPlayer().gameState.currentPiece);

// Check canvas exists
const canvas = document.querySelector('#main-game-canvas');
console.log('Canvas:', canvas);
console.log('Context:', canvas?.getContext('2d'));

// Check drawing is called
// (Add log to drawPiece method)
```

**Solution:** Implement `drawPiece()` in canvas layout

---

### Issue: "Canvas is black/empty"

**Diagnostic:**
```javascript
// Check canvas dimensions
const canvas = document.querySelector('#main-game-canvas');
console.log('Size:', canvas.width, canvas.height);

// Check it's visible
console.log('Visible?', canvas.offsetWidth > 0);

// Check drawing commands run
// (Add logs to draw methods)
```

**Solution:**
1. Check canvas has size: `canvas.width > 0`
2. Check CSS doesn't hide it: `display: block`
3. Check drawing functions are called

---

### Issue: "Inputs don't work"

**Diagnostic:**
```javascript
// Check game phase
console.log('Phase:', ffa.gamePhase); // Should be 'playing'

// Check player is alive
console.log('Alive?', ffa.getLocalPlayer().isAlive);

// Check controls are set up
console.log('Handler?', window.app?.multiplayerKeyHandler);
```

**Solution:**
1. Ensure `gamePhase === 'playing'`
2. Ensure player `isAlive === true`
3. Call `setupMultiplayerControls()`

---

### Issue: "Peer sees frozen host board"

**Diagnostic:**
```javascript
// On peer window:
// Check if state sync is working
let lastSync = 0;
ffa.network.on(MessageTypes.GAME_STATE_FULL, () => {
  const now = Date.now();
  console.log('State sync delay:', now - lastSync, 'ms');
  lastSync = now;
});
```

**Solution:**
1. Check state broadcast is running (host)
2. Check peer is receiving messages
3. Check `syncFromHost` calls `renderAllPlayers()`

---

### Issue: "Game lags badly"

**Diagnostic:**
```javascript
// Check render frequency
let frames = 0;
let lastCheck = Date.now();
window.addEventListener('ffa:render-frame', () => {
  frames++;
  if (Date.now() - lastCheck > 1000) {
    console.log('FPS:', frames);
    frames = 0;
    lastCheck = Date.now();
  }
});
```

**Solution:**
- Should be ~60 FPS
- If lower: Rendering is too slow
  - Simplify drawing code
  - Don't clear/redraw everything
  - Use requestAnimationFrame instead of setInterval

---

## 🔍 Step-by-Step Debug Process

### Step 1: Verify Match Start
```javascript
// Should see these logs:
// "🎮 Match started!"
// "Game loop started (60fps)"
// "📡 State sync started (30Hz)"

console.log('Match config:', ffa.matchConfig);
console.log('Players:', Array.from(ffa.players.keys()));
```

### Step 2: Verify Game State
```javascript
const local = ffa.getLocalPlayer();
console.log('Current piece:', local.gameState.currentPiece);
console.log('Next pieces:', local.gameState.nextPieces.length);
console.log('Is processing?', local.gameState.isProcessingPhysics);
```

### Step 3: Verify Rendering Pipeline
```javascript
// Add logs to each stage:
// 1. Game loop tick
// 2. renderAllPlayers() call
// 3. Event dispatch
// 4. Main.js receives event
// 5. Canvas layout renders
// 6. Drawing functions called

// All should appear 60 times per second
```

### Step 4: Verify Input Pipeline
```javascript
// Press arrow key, should see:
// 1. "⌨️ Key pressed: ArrowLeft"
// 2. "📤 Sending input: move {direction: -1}"
// 3. "⚙️ Processing input: [steamId] move"
// 4. "🎨 Render triggered"
```

### Step 5: Verify Visual Output
```javascript
// Check canvas has content:
const canvas = document.querySelector('#main-game-canvas');
const ctx = canvas.getContext('2d');
const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
const hasPixels = imageData.data.some(pixel => pixel !== 0);
console.log('Canvas has pixels?', hasPixels);
```

---

## 🧰 Debugging Tools

### Console Shortcuts
```javascript
// Quick access
window.d = {
  ffa: () => window.ffa,
  local: () => window.ffa?.getLocalPlayer(),
  piece: () => window.ffa?.getLocalPlayer().gameState.currentPiece,
  inputs: () => {
    // Enable verbose input logging
    window.inputDebug = true;
  },
  renders: () => {
    // Count renders
    let count = 0;
    window.addEventListener('ffa:render-frame', () => {
      console.log('Render #', ++count);
    });
  }
};

// Usage:
// d.ffa()
// d.local()
// d.piece()
```

### Performance Monitor
```javascript
// Add to game loop to monitor performance
let lastTime = performance.now();
let frameCount = 0;
let totalTime = 0;

function monitorFrame() {
  frameCount++;
  const now = performance.now();
  const delta = now - lastTime;
  totalTime += delta;
  
  if (frameCount % 60 === 0) {
    console.log('Average frame time:', (totalTime / 60).toFixed(2), 'ms');
    console.log('FPS:', (1000 / (totalTime / 60)).toFixed(1));
    totalTime = 0;
  }
  
  lastTime = now;
}

// Call in game loop
```

### State Snapshot
```javascript
// Capture complete state for debugging
function captureState() {
  return {
    timestamp: Date.now(),
    gamePhase: ffa.gamePhase,
    players: Array.from(ffa.players.entries()).map(([id, p]) => ({
      steamId: id,
      name: p.name,
      isAlive: p.isAlive,
      hasCurrentPiece: !!p.gameState.currentPiece,
      lockedPiecesCount: p.gameState.lockedPieces.length,
      score: p.gameState.score,
      lines: p.gameState.lines,
    })),
    isHost: ffa.isHost,
    loopRunning: !!ffa.gameLoopInterval,
  };
}

// Usage:
console.log(captureState());
```

---

## ✅ Success Checklist

After implementing Phase 1, you should be able to check all these:

- [ ] `window.ffa` exists and has players
- [ ] `ffa.gamePhase === 'playing'`
- [ ] Console shows "🔄 Game loop tick" 60 times/sec
- [ ] Console shows "🎨 Render all players" 60 times/sec
- [ ] Console shows "📡 Render event received" 60 times/sec
- [ ] Pressing arrow keys shows "⌨️ Key pressed" logs
- [ ] Canvas exists and has size > 0
- [ ] Canvas context exists
- [ ] Drawing functions are called
- [ ] Canvas has pixels (not blank)
- [ ] You can see grid lines
- [ ] You can see a tetromino
- [ ] Tetromino moves when you press keys

---

## 🆘 Still Stuck?

If you've checked everything and it still doesn't work:

1. **Restart from clean state:**
   ```javascript
   window.exitMultiplayer();
   // Then create new match
   ```

2. **Check browser console for errors:**
   - Red error messages?
   - Stack traces?
   - Failed network requests?

3. **Check file was saved:**
   - Changes sometimes don't hot-reload
   - Hard refresh: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)

4. **Compare to local multiplayer:**
   - Local 2P mode works perfectly
   - Look at `src/core/multiplayer.js`
   - Copy the pattern!

5. **Minimal test:**
   ```javascript
   // Just try to render ONE frame manually
   const local = ffa.getLocalPlayer();
   const canvas = document.querySelector('#main-game-canvas');
   const ctx = canvas.getContext('2d');
   
   // Clear
   ctx.clearRect(0, 0, canvas.width, canvas.height);
   
   // Draw something simple
   ctx.fillStyle = 'red';
   ctx.fillRect(50, 50, 100, 100);
   
   // See red square? Canvas works!
   // Don't see it? Canvas setup issue.
   ```

---

**Remember:** 90% of issues are missing function calls. Add console.logs everywhere and trace the execution path!

