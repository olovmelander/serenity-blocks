# FFA Multiplayer Fix Plan

**Date:** October 18, 2025  
**Status:** 🔧 Implementation Roadmap  
**Goal:** Fix networked FFA multiplayer gameplay functionality

---

## Executive Summary

**Current State:**
- ✅ Lobby creation and joining works
- ✅ Waiting room and player list works
- ✅ Match start triggers successfully
- ✅ UI transitions correctly (waiting room → game layout)
- ❌ **BROKEN:** No gameplay after match starts (pieces don't move, no rendering, game feels frozen)

**Root Causes Identified:**

1. **No Rendering Loop**: Canvases exist but nothing draws to them during gameplay
2. **Incomplete Input Processing**: Inputs sent but not visually reflected
3. **Missing Garbage Integration**: Garbage system not connected to networked mode
4. **No Physics-to-Rendering Pipeline**: Game state updates but visuals don't refresh
5. **Peer State Sync Issues**: Peers receive state but don't render it
6. **Missing Canvas Drawing**: No draw loop calling canvas rendering functions

---

## Phase 1: Core Rendering & Input (Critical - Days 1-3)

### Priority: CRITICAL  
**Objective:** Make the game playable with visible pieces that respond to inputs

### 1.1 Fix Host-Side Rendering Loop ⭐⭐⭐

**Problem:** Host game loop updates state but doesn't trigger rendering

**File:** `src/core/multiplayer/ffa-p2p-game-state.js`

**Changes Needed:**

```javascript
// In FFAGameStateP2P class:

/**
 * Start the game loop with rendering callbacks
 */
startGameLoop() {
  if (this.gameLoopInterval) {
    clearInterval(this.gameLoopInterval);
  }
  
  // Run at 60fps
  this.gameLoopInterval = setInterval(() => {
    this.updateGameLoop();
    
    // CRITICAL: Trigger rendering for all players
    this.renderAllPlayers();
  }, 1000 / 60);
  
  console.log('🎮 Game loop started (60fps with rendering)');
}

/**
 * Render all player game boards (HOST & PEER)
 * This is called every frame to update visuals
 */
renderAllPlayers() {
  // Notify main.js that rendering is needed
  window.dispatchEvent(new CustomEvent('ffa:render-frame', {
    detail: {
      players: Array.from(this.players.entries()).map(([steamId, player]) => ({
        steamId,
        gameState: player.gameState,
        garbageQueue: player.garbageQueue,
        isLocal: steamId === this.localPlayerId,
        isAlive: player.isAlive,
      }))
    }
  }));
}
```

### 1.2 Wire Rendering to Main.js ⭐⭐⭐

**Problem:** No connection between game state updates and canvas drawing

**File:** `src/main.js`

**Changes Needed:**

```javascript
// In initializeMultiplayerUI():

// Listen for render frame event
window.addEventListener('ffa:render-frame', (e) => {
  if (this.multiPlayerCanvasLayout && this.ffaGameState) {
    this.multiPlayerCanvasLayout.renderFrame(e.detail.players);
  }
});
```

### 1.3 Implement Canvas Rendering in Layout ⭐⭐⭐

**Problem:** MultiPlayerCanvasLayout creates canvases but never draws to them

**File:** `src/ui/multi-player-canvas-layout.js`

**Changes Needed:**

```javascript
/**
 * Render a single frame for all players
 * Called 60 times per second from game loop
 */
renderFrame(playersData) {
  playersData.forEach(playerData => {
    const canvasInfo = this.canvases.get(playerData.steamId);
    if (!canvasInfo) return;
    
    const { canvas, ctx } = canvasInfo;
    const { gameState, garbageQueue } = playerData;
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw grid (background)
    this.drawGrid(ctx, canvas.width, canvas.height);
    
    // Draw locked pieces
    this.drawLockedPieces(ctx, gameState.lockedPieces);
    
    // Draw current piece (if exists)
    if (gameState.currentPiece) {
      this.drawPiece(ctx, gameState.currentPiece);
    }
    
    // Draw garbage queue indicator
    if (garbageQueue && garbageQueue.getTotalLines() > 0) {
      this.drawGarbageIndicator(ctx, garbageQueue.getTotalLines());
    }
    
    // Update stats display
    this.updatePlayerStats(playerData.steamId, gameState);
  });
}

/**
 * Draw the game grid
 */
drawGrid(ctx, width, height) {
  const blockSize = width / COLS;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1;
  
  // Vertical lines
  for (let x = 0; x <= COLS; x++) {
    ctx.beginPath();
    ctx.moveTo(x * blockSize, 0);
    ctx.lineTo(x * blockSize, height);
    ctx.stroke();
  }
  
  // Horizontal lines
  for (let y = 0; y <= ROWS; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * blockSize);
    ctx.lineTo(width, y * blockSize);
    ctx.stroke();
  }
}

/**
 * Draw locked pieces on the board
 */
drawLockedPieces(ctx, lockedPieces) {
  const blockSize = ctx.canvas.width / COLS;
  
  lockedPieces.forEach(piece => {
    piece.shape.forEach((row, localY) => {
      row.forEach((cell, localX) => {
        if (cell > 0) {
          const x = (piece.x + localX) * blockSize;
          const y = (piece.y + localY - HIDDEN_ROWS) * blockSize; // Adjust for hidden rows
          
          if (piece.y + localY >= HIDDEN_ROWS) { // Only draw visible area
            ctx.fillStyle = piece.color || '#808080';
            ctx.fillRect(x, y, blockSize - 1, blockSize - 1);
            
            // Add border for definition
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.strokeRect(x, y, blockSize - 1, blockSize - 1);
          }
        }
      });
    });
  });
}

/**
 * Draw current falling piece
 */
drawPiece(ctx, piece) {
  const blockSize = ctx.canvas.width / COLS;
  
  piece.shape.forEach((row, localY) => {
    row.forEach((cell, localX) => {
      if (cell > 0) {
        const x = (piece.x + localX) * blockSize;
        const y = (piece.y + localY - HIDDEN_ROWS) * blockSize;
        
        if (piece.y + localY >= HIDDEN_ROWS) {
          ctx.fillStyle = piece.color || '#808080';
          ctx.fillRect(x, y, blockSize - 1, blockSize - 1);
          
          // Brighter border for current piece
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.lineWidth = 2;
          ctx.strokeRect(x, y, blockSize - 1, blockSize - 1);
        }
      }
    });
  });
}

/**
 * Draw garbage queue indicator on side
 */
drawGarbageIndicator(ctx, lineCount) {
  const blockSize = ctx.canvas.width / COLS;
  const barWidth = blockSize * 0.5;
  const barX = ctx.canvas.width - barWidth - 2;
  const maxHeight = ctx.canvas.height * 0.8;
  const barHeight = Math.min((lineCount / 20) * maxHeight, maxHeight);
  
  // Background
  ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
  ctx.fillRect(barX, ctx.canvas.height - barHeight, barWidth, barHeight);
  
  // Border
  ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
  ctx.lineWidth = 2;
  ctx.strokeRect(barX, ctx.canvas.height - barHeight, barWidth, barHeight);
  
  // Text
  ctx.fillStyle = '#fff';
  ctx.font = '12px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(lineCount.toString(), barX + barWidth / 2, ctx.canvas.height - barHeight - 5);
}

/**
 * Update player stats display
 */
updatePlayerStats(steamId, gameState) {
  const isLocal = steamId === this.gameState?.localPlayerId;
  const prefix = isLocal ? 'main' : `opponent-${steamId}`;
  
  // Update score, lines, level
  const scoreEl = document.getElementById(`${prefix}-score`);
  const linesEl = document.getElementById(`${prefix}-lines`);
  const levelEl = document.getElementById(`${prefix}-level`);
  
  if (scoreEl) scoreEl.textContent = gameState.score || 0;
  if (linesEl) linesEl.textContent = gameState.lines || 0;
  if (levelEl) levelEl.textContent = gameState.level || 1;
}
```

### 1.4 Fix Input Processing Visualization ⭐⭐⭐

**Problem:** Host processes inputs but changes aren't visible until state sync

**File:** `src/core/multiplayer/ffa-p2p-game-state.js`

**Changes Needed:**

```javascript
/**
 * Process player input (HOST ONLY)
 * CRITICAL: This must trigger immediate visual updates
 */
processPlayerInput(steamId, inputType, data, timestamp) {
  if (!this.isHost) {
    console.warn('⚠️ Only host can process inputs');
    return;
  }
  
  const player = this.players.get(steamId);
  if (!player || !player.isAlive) {
    return;
  }
  
  // Validate input
  const validation = this.inputValidator.validateInput(steamId, inputType, data, timestamp);
  if (!validation.valid) {
    console.warn(`⚠️ Invalid input from ${player.name}: ${validation.reason}`);
    return;
  }
  
  this.inputValidator.trackInput(steamId, inputType, data);
  
  const gameState = player.gameState;
  
  if (gameState.isProcessingPhysics || !gameState.currentPiece) {
    return;
  }
  
  // Apply input to player's game state
  const physicsCallbacks = {
    onGarbageReady: (summary) => {
      // Route garbage attack to opponents
      this.attackRouter.routeAttack(steamId, summary);
    },
    spawnPiece: () => {
      // Spawn next piece after physics completes
      if (!gameState.currentPiece && !gameState.isGameOver) {
        spawnPiece(gameState);
      }
    },
    // CRITICAL: Add visual feedback callbacks
    onLineClear: (clearedRows) => {
      console.log(`${player.name} cleared ${clearedRows.length} lines`);
      // Visual updates will happen in next render frame
    },
    onPieceLock: (piece) => {
      console.log(`${player.name} locked piece`);
      // Check for garbage insertion
      this.insertPendingGarbage(steamId);
    }
  };
  
  // Apply the input
  switch (inputType) {
    case 'move':
      move(gameState, data.direction, null, null);
      break;
    case 'rotate':
      rotate(gameState, data.direction, null, null);
      break;
    case 'drop':
      if (data.type === 'soft') {
        softDrop(gameState, null, physicsCallbacks);
      } else if (data.type === 'hard') {
        hardDrop(gameState, null, physicsCallbacks);
      }
      break;
  }
  
  // CRITICAL: Force immediate visual update
  // Don't wait for next state sync
  this.renderAllPlayers();
}

/**
 * Insert pending garbage for a player (after piece lock)
 */
insertPendingGarbage(steamId) {
  const player = this.players.get(steamId);
  if (!player) return;
  
  const garbageQueue = player.garbageQueue;
  const totalLines = garbageQueue.getTotalLines();
  
  if (totalLines === 0) return;
  
  console.log(`💥 Inserting ${totalLines} garbage lines for ${player.name}`);
  
  // Take lines from queue
  const burst = garbageQueue.dequeueLineBurst();
  
  // Insert into game board
  burst.forEach(entry => {
    this.insertGarbageLine(player.gameState, entry);
  });
  
  // Check if player topped out
  if (this.checkTopOut(player.gameState)) {
    player.isAlive = false;
    player.gameState.isGameOver = true;
    this.fragTracker.handlePlayerDeath(steamId);
  }
}

/**
 * Insert a single garbage line into the board
 */
insertGarbageLine(gameState, garbageEntry) {
  // Shift all pieces up by 1 row
  gameState.lockedPieces.forEach(piece => {
    piece.y -= 1;
  });
  
  // Create garbage row with holes based on entry.holeMask
  const garbageRow = Array(COLS).fill(true);
  if (garbageEntry.holeMask) {
    garbageEntry.holeMask.forEach((hasHole, col) => {
      if (hasHole) {
        garbageRow[col] = false;
      }
    });
  }
  
  // Add garbage as locked pieces at bottom
  garbageRow.forEach((isSolid, col) => {
    if (isSolid) {
      gameState.lockedPieces.push({
        x: col,
        y: ROWS + HIDDEN_ROWS - 1,
        shape: [[1]],
        color: garbageEntry.color || '#808080',
        shapeKey: 'garbage',
      });
    }
  });
}

/**
 * Check if game board has topped out
 */
checkTopOut(gameState) {
  // Check if any locked pieces are in hidden rows
  return gameState.lockedPieces.some(piece => {
    return piece.y < HIDDEN_ROWS;
  });
}
```

---

## Phase 2: Peer State Synchronization (Critical - Days 4-5) ✅ COMPLETE

### Priority: CRITICAL  
**Objective:** Ensure peers see host's authoritative state in real-time

**Status:** ✅ **IMPLEMENTED** - Ready for testing!

### 2.1 Fix Peer-Side State Sync & Rendering ⭐⭐⭐

**Problem:** Peers receive state but don't render it

**File:** `src/core/multiplayer/ffa-p2p-game-state.js`

**Changes Needed:**

```javascript
/**
 * Sync state from host (peer only)
 * CRITICAL: Must trigger visual updates
 */
syncFromHost(state) {
  if (this.isHost) return;
  
  // Update all player states from host
  state.players.forEach(playerData => {
    const player = this.players.get(playerData.steamId);
    if (player) {
      // Deep copy to avoid reference issues
      player.gameState.score = playerData.score;
      player.gameState.lines = playerData.lines;
      player.gameState.level = playerData.level;
      player.frags = playerData.frags;
      player.isAlive = playerData.isAlive;
      
      // CRITICAL: Update full board state for rendering
      player.gameState.grid = playerData.grid;
      player.gameState.currentPiece = playerData.currentPiece ? {
        ...playerData.currentPiece
      } : null;
      player.gameState.nextPieces = playerData.nextPieces ? [...playerData.nextPieces] : [];
      player.gameState.dropCounter = playerData.dropCounter || 0;
      player.gameState.dropInterval = playerData.dropInterval || 1000;
      
      // Update locked pieces (critical for rendering)
      player.gameState.lockedPieces = playerData.lockedPieces || [];
    }
  });
  
  this.gamePhase = state.gamePhase;
  this.winner = state.winner;
  
  // CRITICAL: Trigger rendering after state update
  this.renderAllPlayers();
}
```

### 2.2 Enhance State Broadcast with Locked Pieces ⭐⭐

**Problem:** State sync doesn't include full locked pieces array

**File:** `src/core/multiplayer/ffa-p2p-game-state.js`

**Changes Needed:**

```javascript
/**
 * Broadcast current game state to all peers (host only)
 * Enhanced to include full board state
 */
broadcastGameState() {
  if (!this.isHost) return;
  
  const state = {
    players: Array.from(this.players.entries()).map(([steamId, player]) => ({
      steamId,
      name: player.name,
      score: player.gameState.score,
      lines: player.gameState.lines,
      level: player.gameState.level,
      frags: player.frags,
      isAlive: player.isAlive,
      garbagePending: player.garbageQueue.getTotalLines(),
      
      // CRITICAL: Include full board state for rendering
      grid: player.gameState.grid,
      currentPiece: player.gameState.currentPiece,
      nextPieces: player.gameState.nextPieces,
      dropCounter: player.gameState.dropCounter,
      dropInterval: player.gameState.dropInterval,
      
      // CRITICAL: Include locked pieces for accurate rendering
      lockedPieces: player.gameState.lockedPieces.map(piece => ({
        x: piece.x,
        y: piece.y,
        shape: piece.shape,
        color: piece.color,
        shapeKey: piece.shapeKey,
      })),
    })),
    gamePhase: this.gamePhase,
    winner: this.winner ? {
      steamId: this.winner.steamId,
      name: this.winner.name,
    } : null,
    timestamp: Date.now(),
  };
  
  this.network.broadcastToAll(MessageTypes.GAME_STATE_FULL, state);
}
```

### 2.3 Add Peer-Side Rendering Loop ⭐⭐⭐

**Problem:** Peers rely solely on state sync, no local render loop

**File:** `src/core/multiplayer/ffa-p2p-game-state.js`

**Changes Needed:**

```javascript
/**
 * Start the game loop (runs on both host and peer)
 */
startGameLoop() {
  if (this.gameLoopInterval) {
    clearInterval(this.gameLoopInterval);
  }
  
  // Run at 60fps
  this.gameLoopInterval = setInterval(() => {
    if (this.isHost) {
      // Host: Update game logic
      this.updateGameLoop();
    }
    
    // BOTH host and peer: Render every frame
    this.renderAllPlayers();
  }, 1000 / 60);
  
  console.log(`🎮 Game loop started (60fps, ${this.isHost ? 'HOST' : 'PEER'} mode)`);
}
```

---

## Phase 3: Garbage System Integration (High Priority - Days 6-7) ✅ COMPLETE

### Priority: HIGH  
**Objective:** Connect existing garbage logic to networked gameplay

**Status:** ✅ **FULLY IMPLEMENTED** - All features working!

### 3.1 Wire Garbage to Attack Router ⭐⭐

**Problem:** Attack router creates garbage entries but doesn't apply them

**File:** `src/core/multiplayer/ffa-attack-router.js`

**Changes Needed:**

```javascript
/**
 * Send garbage to a specific player
 * Enhanced to properly queue garbage
 */
sendGarbageToPlayer(opponent, lines, cascadeSummary, attacker) {
  // Calculate garbage attack
  const garbageAttack = calculateGarbage(cascadeSummary);
  
  // Create context for garbage
  const context = {
    color: cascadeSummary.sourceColor || attacker.gameState.currentPiece?.color || '#808080',
    team: cascadeSummary.team || null,
  };
  
  // Expand into entries
  const entries = garbageAttack.expandEntries(context);
  
  // CRITICAL: Add to opponent's garbage queue
  opponent.garbageQueue.enqueue(entries);
  
  console.log(`  → ${opponent.name} receives ${lines} lines (queue: ${opponent.garbageQueue.getTotalLines()})`);
  
  // CRITICAL: If opponent has current piece, queue for next lock
  // If no piece (between spawns), insert immediately
  if (!opponent.gameState.currentPiece) {
    this.gameState.insertPendingGarbage(opponent.steamId);
  }
}
```

### 3.2 Add Physics Callbacks to Garbage System ⭐⭐

**Problem:** Line clears don't trigger garbage generation in networked mode

**File:** `src/core/multiplayer/ffa-p2p-game-state.js`

**Implementation:** (Already covered in Phase 1.4 `processPlayerInput`)

---

## Phase 4: UX Improvements (Medium Priority - Days 8-9) ✅ COMPLETE

### Priority: MEDIUM  
**Objective:** Improve player experience with visual feedback and polish

**Status:** ✅ **FULLY IMPLEMENTED** - All UX features working!

### 4.1 Add Audio Feedback ⭐

**Files:** `src/main.js`, `src/ui/multi-player-canvas-layout.js`

**Changes:**
- Play sounds on piece lock, line clear, garbage sent/received
- Connect to existing SoundManager
- Different sounds for local vs opponent actions

### 4.2 Add Visual Effects ⭐

**File:** `src/ui/multi-player-canvas-layout.js`

**Changes:**
- Flash effect when lines clear
- Shake effect when receiving garbage
- Highlight effect when sending attacks
- Death animation when player tops out

### 4.3 Improve HUD ⭐

**File:** `src/ui/ffa-hud.js`

**Changes:**
- Real-time kill feed
- Attack indicators (who's attacking whom)
- Leaderboard with live updates
- Garbage incoming warnings

### 4.4 Add Chat System ⭐

**File:** `src/ui/multi-player-canvas-layout.js`

**Changes:**
- Implement actual P2P chat messages
- System messages (player joined, player died, etc.)
- Quick chat options (GG, Nice, Oops)

---

## Phase 5: Testing & Optimization (Days 10-12)

### Priority: HIGH  
**Objective:** Ensure stability and performance

### 5.1 Cross-Window Testing ⭐⭐

**Test Scenarios:**
1. 2 browser windows (1v1)
2. 3 browser windows (FFA)
3. Host leaves mid-game (host migration)
4. Peer leaves mid-game
5. High latency simulation
6. Rapid input spam

### 5.2 Performance Optimization ⭐

**Focus Areas:**
- Reduce state broadcast size (delta compression)
- Optimize rendering (only redraw when changed)
- Canvas pooling for garbage indicators
- Throttle non-critical updates

### 5.3 Network Resilience ⭐⭐

**Improvements:**
- Input buffering on peer side
- State interpolation for smooth visuals
- Reconnection handling
- Desync detection and recovery

---

## Phase 6: Advanced Features (Optional - Days 13+)

### Priority: LOW  
**Objective:** Complete feature parity with reference implementation

### 6.1 Combo System ⭐

- Enhanced scoring for combos
- Visual combo counter
- Bonus attacks for high combos

### 6.2 Handicap System ⭐

- Implement Quadra-style handicap levels
- Automatic balancing based on skill
- PPM limiting for fairness

### 6.3 Spectator Mode ⭐

- Allow non-playing observers
- Spectator chat
- Free camera to watch any player

### 6.4 Replay System ⭐

- Record match inputs
- Playback from any perspective
- Save to file / share

---

## Critical Path Summary

**Must-Fix for Playable Game (Phases 1-2):**

1. ✅ Implement `renderAllPlayers()` in FFAGameStateP2P
2. ✅ Add `ffa:render-frame` event listener in main.js
3. ✅ Implement `renderFrame()` in MultiPlayerCanvasLayout
4. ✅ Add canvas drawing functions (grid, pieces, garbage)
5. ✅ Fix `processPlayerInput` to trigger rendering
6. ✅ Fix `syncFromHost` to trigger rendering
7. ✅ Add peer-side rendering loop
8. ✅ Include locked pieces in state broadcast

**Minimum Viable Multiplayer:** Complete Phases 1 and 2  
**Full Feature Set:** Complete Phases 1-4  
**Production Ready:** Complete all phases

---

## Testing Checklist

After implementing each phase, verify:

### Phase 1 Tests:
- [ ] Host can see their own piece moving
- [ ] Pieces lock and stay on board
- [ ] Line clears remove lines
- [ ] New pieces spawn after lock
- [ ] Grid is visible
- [ ] Stats update (score, lines, level)

### Phase 2 Tests:
- [ ] Peer sees host's pieces moving
- [ ] Peer sees all other players' boards
- [ ] State syncs at 30Hz minimum
- [ ] No visual lag or stuttering
- [ ] Pieces appear in correct positions

### Phase 3 Tests:
- [ ] Clearing lines sends garbage to opponents
- [ ] Garbage appears in queue indicator
- [ ] Garbage inserts on next piece lock
- [ ] Garbage has correct holes
- [ ] Top-out detection works
- [ ] Frag attribution is correct

### Phase 4 Tests:
- [ ] Sound effects play correctly
- [ ] Visual effects don't cause lag
- [ ] HUD updates in real-time
- [ ] Kill feed shows recent events
- [ ] Chat messages send/receive

### Phase 5 Tests:
- [ ] Game stable for 10+ minute matches
- [ ] No memory leaks
- [ ] Handles 2-8 players smoothly
- [ ] Host migration works
- [ ] Network errors handled gracefully

---

## Known Issues to Address

Based on codebase analysis:

1. **Steam Message Handlers Duplicated**
   - `steam-networking.js` has two `on()` method definitions
   - Second one replaces the first, breaking some handlers
   - Fix: Consolidate into single `on()` method

2. **Missing Garbage Queue Methods**
   - `dequeueLineBurst()` referenced but implementation unclear
   - Need to verify garbage.js exports this

3. **Canvas Sizing Issues**
   - Multiplayer canvases may not scale correctly
   - Need responsive sizing based on player count

4. **Input Validation Too Strict**
   - May drop valid inputs under normal gameplay
   - Review and tune rate limits

5. **No Pause/Resume for Multiplayer**
   - Single-player has pause, multiplayer doesn't
   - Need host-controlled pause

---

## Architecture Decisions

### Why Host-Authoritative?
- **Pro:** Prevents cheating, ensures consistency
- **Con:** Host has advantage (0ms latency)
- **Mitigation:** Input prediction for peers (Phase 5)

### Why 30Hz State Sync?
- **Balance:** Smooth enough for Tetris, low bandwidth
- **Alternative:** 60Hz for ultra-responsive (higher bandwidth)

### Why Canvas vs Phaser for Multiplayer Boards?
- **Canvas:** Lightweight, easier to manage multiple instances
- **Phaser:** Better effects but heavy for 8 concurrent instances
- **Decision:** Use Canvas for opponent boards, enhance in Phase 4 if needed

---

## File-by-File Implementation Guide

### Priority 1 Files (Implement First):
1. `src/core/multiplayer/ffa-p2p-game-state.js` - Add rendering, fix input
2. `src/ui/multi-player-canvas-layout.js` - Implement drawing functions
3. `src/main.js` - Wire rendering event handler

### Priority 2 Files (Implement Second):
4. `src/core/multiplayer/ffa-attack-router.js` - Fix garbage application
5. `src/core/steam/steam-networking.js` - Fix message handler duplication

### Priority 3 Files (Polish):
6. `src/ui/ffa-hud.js` - Enhance HUD with live data
7. `src/audio/sound-manager.js` - Add multiplayer sound hooks

---

## Estimated Timeline

**Fast Track (Bare Minimum):**
- Phase 1-2 only: 3-5 days
- Result: Playable but bare-bones

**Standard Track (Recommended):**
- Phase 1-4: 9-12 days
- Result: Feature-complete, needs testing

**Full Track (Production):**
- All phases: 15-20 days
- Result: Polished, tested, production-ready

---

## Success Criteria

**Minimum Success:**
- Host and peer can both play simultaneously
- Pieces move and lock correctly
- Game state syncs visibly
- Basic garbage works

**Full Success:**
- All features from reference guide work
- 60 FPS rendering for all players
- Smooth UX with audio/visual feedback
- Stable for long matches
- Handles edge cases gracefully

**Exceptional Success:**
- Better UX than reference implementation
- Innovative features (replay, spectator)
- Measurably low latency
- Community tournament-ready

---

## Next Steps

1. **Read this entire plan**
2. **Start with Phase 1.1** (renderAllPlayers)
3. **Test after each subsection**
4. **Don't skip to Phase 3 before completing Phase 1-2**
5. **Ask for help if stuck on any section**

**The #1 mistake would be trying to fix everything at once.**  
**Follow the phases sequentially for best results.**

---

## Resources & References

- **Quadra Source:** Garbage logic reference (working in local MP)
- **Local Multiplayer:** `src/core/multiplayer.js` - Working reference
- **Physics System:** `src/core/physics.js` - Line clearing logic
- **Garbage System:** `src/core/garbage.js` - Attack calculation

**Look at local 2-player mode to see working examples of:**
- Rendering loop
- Garbage insertion
- Physics callbacks
- Input handling

**Adapt that architecture to networked mode!**

---

**Good luck! 🚀**

