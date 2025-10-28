# Next Pieces Not Rendering - Debug & Fix Plan

## Problem Statement
The next pieces canvases are visible (3 dark rectangles above the main board) but no tetromino shapes are being drawn inside them.

## Current Implementation

### HTML Location
- **File**: `src/ui/multi-player-canvas-layout.js` (lines 59-64)
- **Location**: Above main game board in center area
- **Canvas IDs**: `ffa-next-0`, `ffa-next-1`, `ffa-next-2`

### CSS Styling
- **File**: `public/styles/multiplayer-ui.css` (lines 1179-1193)
- **Container**: `.next-pieces-above-board` - horizontal flexbox
- **Canvas sizing**:
  - First canvas: 100x100px (min)
  - Others: 80x80px (min)

### JavaScript Methods
- **File**: `src/ui/multi-player-canvas-layout.js`
- **initializeNextPieces()** (lines 258-289): Sets canvas dimensions and event listener
- **updateNextPieces()** (lines 291-390): Renders pieces to canvases

## Diagnostic Steps

### Step 1: Verify Canvas Elements Exist
**Goal**: Confirm canvases are in DOM and being found by JavaScript

**Actions**:
1. Add console.log in `initializeNextPieces()` after canvas selection
2. Log each canvas element reference
3. Log canvas dimensions (width, height)
4. Check if canvases are null

**Expected Output**:
```
✅ Initialized 3 next piece canvases
Canvas 0: <canvas id="ffa-next-0" width="120" height="240">
Canvas 1: <canvas id="ffa-next-1" width="99" height="198">
Canvas 2: <canvas id="ffa-next-2" width="99" height="198">
```

**File to modify**: `src/ui/multi-player-canvas-layout.js:258-289`

---

### Step 2: Verify Event Listener is Attached
**Goal**: Confirm `updateNextPieces()` is being called

**Actions**:
1. Add console.log at start of `updateNextPieces()`
2. Log how many times per second it's called
3. Verify `ffa:render-frame` event is firing

**Expected Output**:
```
🎲 updateNextPieces() called
🎲 updateNextPieces() called
🎲 updateNextPieces() called
(should appear ~60 times per second during gameplay)
```

**File to modify**: `src/ui/multi-player-canvas-layout.js:294`

---

### Step 3: Verify Game State Exists
**Goal**: Confirm `this.gameState` and `localPlayer` are available

**Actions**:
1. Log `this.gameState` in `updateNextPieces()`
2. Log `this.gameState.localPlayer`
3. Check if they exist when game starts

**Expected Output**:
```
gameState: FFAPeerToPeerGameState { players: Map, localPlayerId: "mock_xyz", ... }
localPlayer: { steamId: "mock_xyz", name: "Dev_695", gameState: {...}, ... }
```

**File to modify**: `src/ui/multi-player-canvas-layout.js:295-296`

---

### Step 4: Verify Next Pieces Data Path
**Goal**: Find the correct path to nextPieces array

**Actions**:
1. Log full player object structure
2. Try multiple possible paths:
   - `this.gameState.localPlayer.nextPieces`
   - `this.gameState.localPlayer.gameState.nextPieces`
   - `this.gameState.getLocalPlayerState()?.nextPieces`
3. Search for where nextPieces is populated in ffa-p2p-game-state.js

**Expected Output**:
```
Trying path 1: undefined
Trying path 2: ['I', 'O', 'T', 'S', 'Z', 'J', 'L']
✅ Found nextPieces at: localPlayer.gameState.nextPieces
```

**Files to check**:
- `src/ui/multi-player-canvas-layout.js:297`
- `src/core/multiplayer/ffa-p2p-game-state.js:686,733`

---

### Step 5: Verify SHAPES and COLORS Constants
**Goal**: Confirm tetromino shapes and colors are imported correctly

**Actions**:
1. Log `SHAPES` and `COLORS` at top of file
2. Check if they're undefined
3. Verify import statement

**Expected Output**:
```
SHAPES: { I: [[0,0,0,0],[1,1,1,1],...], O: [...], T: [...], ... }
COLORS: { I: '#00ff00', O: '#ff9900', T: '#0000ff', ... }
```

**File to modify**: `src/ui/multi-player-canvas-layout.js:12`

---

### Step 6: Verify Canvas Drawing Logic
**Goal**: Ensure shapes are being drawn to canvas

**Actions**:
1. Add console.log before drawing each piece
2. Log piece type, shape, color, canvas dimensions
3. Log calculated blockSize, offsetX, offsetY
4. Try drawing a test rectangle to canvas to verify drawing works

**Expected Output**:
```
🎨 Drawing piece 0: I
  Shape: [[0,0,0,0],[1,1,1,1],...]
  Color: #00ff00
  Canvas: 120x240
  BlockSize: 12
  Offset: X=24, Y=96
  Drawing block at: (24, 96)
```

**File to modify**: `src/ui/multi-player-canvas-layout.js:306-377`

---

### Step 7: Test Manual Rendering
**Goal**: Bypass game state and draw pieces directly

**Actions**:
1. Create a test function that draws a hardcoded piece:
```javascript
testDrawNextPiece() {
  const canvas = document.getElementById('ffa-next-0');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#00ff00';
  ctx.fillRect(10, 10, 50, 50); // Draw green square
  console.log('✅ Test square drawn');
}
```
2. Call this in browser console
3. If square appears, drawing logic works
4. If not, canvas element or context has issues

**File to add**: `src/ui/multi-player-canvas-layout.js` (new method)

---

## Likely Root Causes (Ranked by Probability)

### 1. Wrong Data Path (90% likely)
**Issue**: Accessing nextPieces from wrong location in game state
**Current code**: `this.gameState.localPlayer.gameState?.nextPieces`
**Fix**: Find correct path by logging player object

### 2. Event Listener Not Firing (5% likely)
**Issue**: `ffa:render-frame` event not being dispatched or listener not attached
**Fix**: Verify event is firing, attach listener at correct time

### 3. Canvas Not Initialized (3% likely)
**Issue**: Canvases found but dimensions are 0x0
**Fix**: Ensure BLOCK_SIZE is set before initialization

### 4. SHAPES/COLORS Not Imported (1% likely)
**Issue**: Constants are undefined
**Fix**: Check import statement

### 5. Drawing Logic Bug (1% likely)
**Issue**: Math is wrong, pieces drawn off-canvas
**Fix**: Add bounds checking and logging

---

## Implementation Plan

### Phase 1: Add Comprehensive Logging
**Time**: 15 minutes

**File**: `src/ui/multi-player-canvas-layout.js`

**Changes**:
1. Add logging to `initializeNextPieces()`:
   ```javascript
   console.log('🔍 Initializing next pieces...');
   console.log('Canvas elements:', this.nextPieceCanvases);
   console.log('Canvas 0 dimensions:', canvas[0]?.width, 'x', canvas[0]?.height);
   console.log('BLOCK_SIZE:', BLOCK_SIZE);
   console.log('SHAPES:', Object.keys(SHAPES));
   console.log('COLORS:', Object.keys(COLORS));
   ```

2. Add logging to `updateNextPieces()`:
   ```javascript
   console.log('🎲 updateNextPieces called');
   console.log('gameState:', this.gameState);
   console.log('localPlayer:', this.gameState?.localPlayer);
   console.log('localPlayer.gameState:', this.gameState?.localPlayer?.gameState);
   console.log('nextPieces path 1:', this.gameState?.localPlayer?.nextPieces);
   console.log('nextPieces path 2:', this.gameState?.localPlayer?.gameState?.nextPieces);
   ```

3. Add drawing confirmation:
   ```javascript
   console.log(`Drawing piece ${idx}: ${nextPieces[idx]}`);
   console.log(`  Shape:`, shape);
   console.log(`  Color:`, color);
   console.log(`  Canvas size: ${canvas.width}x${canvas.height}`);
   console.log(`  Block size: ${blockSize}`);
   ```

### Phase 2: Test and Identify Issue
**Time**: 10 minutes

**Actions**:
1. Run `window.testMultiplayer(2)`
2. Run `ffa.startMatch()`
3. Open browser console
4. Read logs to identify where the chain breaks
5. Document findings

### Phase 3: Implement Fix
**Time**: 20 minutes (depends on issue)

**Possible fixes**:

**If data path is wrong**:
- Update line 297 to correct path
- Consider using a getter method from FFAPeerToPeerGameState

**If event not firing**:
- Move event listener attachment to `show()` method
- Use different event or polling mechanism

**If constants undefined**:
- Fix import statement
- Verify constants.js exports correctly

**If canvas dimensions wrong**:
- Call initializeNextPieces() later in lifecycle
- Use fixed pixel dimensions instead of BLOCK_SIZE calculation

### Phase 4: Remove Debug Logging
**Time**: 5 minutes

**Actions**:
1. Remove or comment out console.logs
2. Keep critical error warnings

### Phase 5: Test Thoroughly
**Time**: 10 minutes

**Test cases**:
- [ ] Start 2-player match - pieces show
- [ ] Start 3-player match - pieces show
- [ ] Play for 30 seconds - pieces update correctly
- [ ] Place piece - next piece shifts to first position
- [ ] Refresh page mid-game - pieces still show

---

## Success Criteria

✅ 3 next piece canvases visible above main board
✅ Each canvas shows a colored tetromino shape
✅ First piece (left) is slightly larger than others
✅ Pieces update when current piece is placed
✅ Correct colors match piece types (I=green, O=orange, etc.)
✅ No console errors
✅ Performance: 60 FPS maintained

---

## Rollback Plan

If fix doesn't work after 1 hour:

1. Revert to simpler approach: Show only 1 next piece
2. Use local multiplayer's `drawNextPieces()` function directly
3. Create separate update method not tied to render frame
4. Consider using a `setInterval()` to update pieces every 100ms instead of every frame

---

## References

### Related Files
- `src/ui/multi-player-canvas-layout.js` - Main implementation
- `src/core/multiplayer/ffa-p2p-game-state.js` - Game state structure
- `src/rendering/draw.js:233-312` - Original next pieces rendering (local MP)
- `src/core/constants.js` - SHAPES, COLORS, BLOCK_SIZE
- `public/index.html:470-510` - Local multiplayer next pieces (working reference)

### Key Data Structures
```javascript
// Player object structure
{
  steamId: "mock_xyz",
  name: "Dev_695",
  isHost: true,
  isReady: true,
  isAlive: true,
  frags: 0,
  gameState: {              // ← Next pieces are HERE
    grid: [...],
    currentPiece: {...},
    nextPieces: ['I', 'O', 'T'],  // ← This is what we need
    score: 0,
    lines: 0,
    level: 1
  }
}
```

### Console Commands for Testing
```javascript
// Test canvas exists
document.getElementById('ffa-next-0')

// Test draw directly
const canvas = document.getElementById('ffa-next-0');
const ctx = canvas.getContext('2d');
ctx.fillStyle = 'red';
ctx.fillRect(0, 0, 100, 100);

// Check game state
window.ffa.gameState.localPlayer.gameState.nextPieces

// Force update
window.ffa.multiPlayerLayout.updateNextPieces()
```

---

## Next Steps

1. **Implement Phase 1** (add logging)
2. **Run tests** and gather console output
3. **Analyze logs** to identify exact failure point
4. **Implement targeted fix** based on findings
5. **Verify fix works**
6. **Clean up debug code**

This methodical approach will definitively identify and fix the issue.
