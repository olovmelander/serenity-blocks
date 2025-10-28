# FFA Multiplayer Visual Effects Upgrade Plan

## 📋 Overview

This document outlines the plan to bring the enhanced visual effects from single-player mode to FFA multiplayer mode, including:
- ✨ **Solid tetromino piece rendering** (no "4 bits" look)
- 🌊 **Pulsating ghost piece effect**
- 💫 **Phaser 4 visual effects** (particle systems, ripples, flashes, combo popups)
- 🎨 **Hybrid rendering architecture** (Canvas for game board + Phaser for effects overlay)

---

## 🎯 Goals

### Primary Goals
1. **Solid Tetromino Look**: Each piece appears as one cohesive shape with a single outer outline
2. **Pulsating Ghost Piece**: Semi-transparent ghost with animated pulsating effect
3. **Phaser Effects**: Integrate particle systems, line clear effects, piece lock ripples, and combo popups
4. **Performance**: Maintain 60 FPS with multiple player canvases + effects
5. **Scalability**: Effects should work for 1v1, 1v2, and 1v3+ FFA matches

### Secondary Goals
- Keep existing responsive canvas sizing system
- Maintain pixel-perfect alignment across all player boards
- Allow per-player quality settings (low, medium, high)
- Ensure effects don't obscure gameplay

---

## 🏗️ Current Architecture Analysis

### Multiplayer Rendering System

**File: `src/ui/multi-player-canvas-layout.js`**
- **Purpose**: Creates and manages multiple HTML5 canvas elements for each player
- **Rendering**: Uses pure Canvas 2D API via imported `draw()` function
- **Layout**: Dynamically adjusts canvas sizes based on player count
- **No Phaser Integration**: Currently no effects overlay

**File: `src/rendering/canvas/canvas-drawing-utils.js`**
- **Status**: ✅ Already updated with solid tetromino rendering
- **Features**: 
  - Solid block rendering with piece-level outlines
  - Pulsating ghost piece effect
  - Grid drawing utilities
- **Used By**: Single-player canvas renderer
- **Not Yet Used By**: Multiplayer canvas layout

**File: `src/rendering/phaser/multiplayer/board-panel.js`**
- **Status**: Exists but not actively used for main board
- **Features**: 
  - MultiplayerBoardScene class with full Phaser effects support
  - Particle systems for line clears
  - Combo popups
  - Line clear flashes
- **Problem**: Not currently integrated with multiplayer canvas rendering

---

## 📦 Implementation Phases

### Phase 1: Integrate Updated Canvas Drawing Utils ✅ (Quick Win)
**Goal**: Replace multiplayer's current drawing code with the upgraded canvas-drawing-utils

**Files to Modify**:
- ✏️ `src/ui/multi-player-canvas-layout.js`

**Changes**:
1. Import drawing functions from `canvas-drawing-utils.js`:
   ```javascript
   import {
     drawGrid,
     drawPiece,
     drawLockedPieces,
     calculateGhostY,
     calculateBlockSize
   } from '../rendering/canvas/canvas-drawing-utils.js';
   ```

2. Replace current `renderPlayerCanvas()` method to use new drawing functions:
   - Use `drawLockedPieces()` for solid locked pieces
   - Use `drawPiece()` with ghost flag for pulsating ghost
   - Use `drawPiece()` for current piece with outline
   - Use `drawGrid()` for consistent grid rendering

3. Update `startRenderLoop()` to include time-based animation:
   ```javascript
   const render = (timestamp) => {
     this.currentTimestamp = timestamp;
     this.renderAllCanvases();
     this.renderFrameId = requestAnimationFrame(render);
   };
   ```

**Expected Result**: 
- ✅ Solid tetrominos in multiplayer
- ✅ Pulsating ghost pieces
- ✅ Consistent rendering with single-player
- ⏱️ Time to complete: 1-2 hours

---

### Phase 2: Hybrid Rendering Architecture (Medium Complexity)
**Goal**: Add Phaser effects overlay for the main player's board

**Files to Modify**:
- ✏️ `src/ui/multi-player-canvas-layout.js`
- ✏️ `public/styles/multiplayer-ui.css`
- 🆕 `src/rendering/phaser/multiplayer-effects-manager.js` (new file)

**Architecture Design**:

```
┌─────────────────────────────────────┐
│   Main Player Game Area             │
│  ┌───────────────────────────────┐  │
│  │  Canvas Container (position:  │  │
│  │  relative)                    │  │
│  │  ┌─────────────────────────┐  │  │
│  │  │ HTML5 Canvas (z-index:2)│  │  │ ← Game board rendering
│  │  │ - Board, pieces, grid   │  │  │
│  │  └─────────────────────────┘  │  │
│  │  ┌─────────────────────────┐  │  │
│  │  │ Phaser Canvas           │  │  │ ← Effects overlay
│  │  │ (position: absolute,    │  │  │
│  │  │  z-index: 10,           │  │  │
│  │  │  pointer-events: none)  │  │  │
│  │  │ - Particles             │  │  │
│  │  │ - Flashes               │  │  │
│  │  │ - Ripples               │  │  │
│  │  │ - Combo popups          │  │  │
│  │  └─────────────────────────┘  │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

**Implementation Steps**:

1. **Create Effects Manager** (`src/rendering/phaser/multiplayer-effects-manager.js`):
   ```javascript
   export class MultiplayerEffectsManager {
     constructor(containerElement, canvasSize) {
       this.container = containerElement;
       this.phaserGame = null;
       this.boardScene = null;
       this.initPhaser(canvasSize);
     }
     
     initPhaser(canvasSize) {
       // Create Phaser game instance for effects only
       // Configure MultiplayerBoardScene
       // Set transparent background
       // Disable game board rendering in scene
     }
     
     // Effect trigger methods
     triggerLineClearFlash(rows) { ... }
     createPieceLockRipple(piece) { ... }
     showComboPopup(comboCount) { ... }
     playLineClearImpact(lineCount) { ... }
     
     // Lifecycle
     updateGameState(gameState) { ... }
     resize(newCanvasSize) { ... }
     destroy() { ... }
   }
   ```

2. **Integrate into MultiPlayerCanvasLayout**:
   - Add `this.effectsManager = null` to constructor
   - Initialize effects manager for main player canvas only
   - Wire up game events to effects manager (line clears, piece locks, combos)
   - Handle resize events
   - Clean up on destroy

3. **Update CSS** (`public/styles/multiplayer-ui.css`):
   ```css
   .main-canvas-container {
     position: relative;
     display: inline-block;
   }
   
   #main-game-canvas {
     position: relative;
     z-index: 2;
     display: block;
   }
   
   .main-canvas-container canvas[data-phaser-effects] {
     position: absolute !important;
     top: 0;
     left: 0;
     pointer-events: none;
     z-index: 10;
   }
   ```

4. **Modify MultiplayerBoardScene**:
   - Disable all board/piece rendering (grid, locked pieces, current piece, ghost)
   - Keep only particle systems, flashes, ripples, and popups
   - Ensure scene is transparent

**Expected Result**:
- ✅ Phaser effects overlay on main player board
- ✅ Particles on line clears
- ✅ Combo popups
- ✅ Piece lock ripples
- ✅ Line clear flashes
- ⏱️ Time to complete: 3-4 hours

---

### Phase 3: Event System Integration (Medium Complexity)
**Goal**: Wire multiplayer game events to trigger visual effects

**Files to Modify**:
- ✏️ `src/core/multiplayer/ffa-p2p-game-state.js`
- ✏️ `src/ui/multi-player-canvas-layout.js`

**Current Event Flow**:
```
FFAGameStateP2P
  └─> applyLocalGameUpdate()
      └─> Updates player.gameState
          └─> MultiPlayerCanvasLayout renders via requestAnimationFrame
```

**New Event Flow**:
```
FFAGameStateP2P
  └─> applyLocalGameUpdate()
      └─> Updates player.gameState
      └─> Emit effect events (line clear, piece lock, combo)
          └─> MultiplayerEffectsManager triggers Phaser effects
          └─> MultiPlayerCanvasLayout renders via requestAnimationFrame
```

**Implementation Steps**:

1. **Add Effects Callbacks to FFAGameStateP2P**:
   ```javascript
   // In constructor
   this.effectsCallbacks = {
     onLineClear: null,
     onPieceLock: null,
     onCombo: null,
     onLevelUp: null
   };
   
   setEffectsCallbacks(callbacks) {
     this.effectsCallbacks = { ...this.effectsCallbacks, ...callbacks };
   }
   ```

2. **Trigger Effects from Game Updates**:
   - In `applyLocalGameUpdate()`, detect events:
     - Line clears: Check `update.clearedRows`
     - Piece locks: Check `update.type === 'piece_locked'`
     - Combos: Track consecutive clears
     - Level ups: Check `update.level !== previousLevel`
   - Call appropriate callbacks

3. **Wire Effects Manager in MultiPlayerCanvasLayout**:
   ```javascript
   setupEffectsForMainPlayer() {
     if (!this.effectsManager) return;
     
     this.gameState.setEffectsCallbacks({
       onLineClear: (rows, lineCount) => {
         this.effectsManager.triggerLineClearFlash(rows);
         this.effectsManager.playLineClearImpact(lineCount);
       },
       onPieceLock: (piece) => {
         this.effectsManager.createPieceLockRipple(piece);
       },
       onCombo: (comboCount) => {
         this.effectsManager.showComboPopup(comboCount);
       }
     });
   }
   ```

**Expected Result**:
- ✅ Effects trigger automatically from gameplay
- ✅ Proper sync between game state and visuals
- ✅ No manual effect triggering needed
- ⏱️ Time to complete: 2-3 hours

---

### Phase 4: Opponent Effects (Optional - Advanced)
**Goal**: Add minimal visual effects for opponent boards

**Scope**:
- **Full effects**: Too resource-intensive for multiple boards
- **Minimal effects**: Flash/screen shake on opponent line clears
- **Visual indicators**: Show when opponents are in danger (top-out warning)

**Implementation**:
1. Add lightweight CSS-based flash effects for opponent canvases
2. Add danger indicator (red border) when opponent near top
3. Optionally add particle burst (single burst, not continuous) for opponent T-spins/Tetrises

**Expected Result**:
- ✅ Visual feedback from opponent actions
- ✅ Maintains performance with multiple boards
- ⏱️ Time to complete: 2-3 hours

---

### Phase 5: Performance Optimization & Polish
**Goal**: Ensure smooth 60 FPS with all effects enabled

**Optimization Strategies**:

1. **Effect Quality Settings**:
   - **Low**: No particles, minimal flashes
   - **Medium**: Reduced particle count (50%)
   - **High**: Full effects
   
2. **Smart Particle Pooling**:
   - Reuse particle emitters
   - Limit max active particles (e.g., 200)
   - Cull particles outside view

3. **Conditional Rendering**:
   - Only render effects for main player
   - Skip effects if FPS drops below 40
   - Disable effects for opponent boards by default

4. **Profiling**:
   - Use Chrome DevTools Performance tab
   - Monitor frame times
   - Identify bottlenecks

**Expected Result**:
- ✅ Consistent 60 FPS on mid-range hardware
- ✅ Graceful degradation on low-end systems
- ✅ Configurable quality settings
- ⏱️ Time to complete: 2-3 hours

---

## 📁 Files to Create/Modify

### New Files
1. `src/rendering/phaser/multiplayer-effects-manager.js`
   - Purpose: Manage Phaser effects overlay for multiplayer
   - Dependencies: Phaser 4, MultiplayerBoardScene

### Files to Modify
1. `src/ui/multi-player-canvas-layout.js` ⭐ (Primary)
   - Import canvas-drawing-utils
   - Integrate effects manager
   - Update render loop
   - Add event wiring

2. `src/core/multiplayer/ffa-p2p-game-state.js`
   - Add effects callbacks
   - Trigger effects from game updates

3. `src/rendering/phaser/multiplayer/board-panel.js`
   - Disable board rendering
   - Keep only effects systems

4. `public/styles/multiplayer-ui.css`
   - Add effects canvas layering
   - Position absolute for Phaser canvas

5. `src/rendering/phaser/base-board-scene.js`
   - Already updated to disable rendering ✅
   - Verify effects-only mode works for multiplayer scene

---

## 🎨 Visual Effects Breakdown

### Effect: Line Clear Flash
- **Type**: Phaser Graphics (Flash overlay)
- **Trigger**: When lines are cleared
- **Visual**: White flash across cleared rows
- **Duration**: 200ms
- **Performance**: Low impact

### Effect: Line Clear Particles
- **Type**: Phaser Particle Emitter
- **Trigger**: When lines are cleared
- **Visual**: Colored particles burst from cleared blocks
- **Duration**: 800ms
- **Performance**: Medium impact (scalable via quality)

### Effect: Piece Lock Ripple
- **Type**: Phaser Graphics (Expanding circle)
- **Trigger**: When piece locks into place
- **Visual**: Ripple emanates from piece center
- **Duration**: 400ms
- **Performance**: Low impact

### Effect: Combo Popup
- **Type**: Phaser Text
- **Trigger**: When combo count increases
- **Visual**: "x2 COMBO", "x3 COMBO", etc. with scale animation
- **Duration**: 1000ms
- **Performance**: Very low impact

### Effect: Ghost Piece Pulse
- **Type**: Canvas 2D (Math.sin animation)
- **Trigger**: Continuous (every frame)
- **Visual**: Alpha oscillation between 0.1 and 0.35
- **Duration**: Continuous
- **Performance**: Very low impact (pure math, no textures)

---

## ⚡ Performance Considerations

### Optimization Checklist
- [ ] **Particle Pooling**: Reuse particle emitters (don't create new ones every time)
- [ ] **Culling**: Don't render effects outside visible area
- [ ] **Quality Tiers**: Implement low/medium/high settings
- [ ] **Main Board Only**: Only apply Phaser effects to main player (not opponents)
- [ ] **FPS Monitoring**: Disable effects if FPS drops below threshold
- [ ] **Debounced Resize**: Avoid recreating Phaser game on every resize event
- [ ] **Batch Updates**: Update all player canvases in single rAF callback

### Performance Targets
- **1v1**: 60 FPS with high quality effects
- **1v2**: 60 FPS with medium quality effects
- **1v3+**: 60 FPS with low-medium quality effects (main player only)

---

## 🧪 Testing Strategy

### Visual Testing
1. **Solo Testing**: Start FFA match alone, verify effects work
2. **1v1 Testing**: Test with one opponent
3. **1v3 Testing**: Test with 3 opponents (stress test)
4. **Resize Testing**: Resize window, verify effects stay aligned
5. **Quality Testing**: Test low/medium/high quality settings

### Performance Testing
1. Monitor FPS with Chrome DevTools (Performance tab)
2. Test on different hardware tiers:
   - High-end: RTX 3080 + i9
   - Mid-range: GTX 1060 + i5
   - Low-end: Integrated GPU + i3
3. Test with different player counts (1v1, 1v2, 1v3+)

### Regression Testing
1. Verify single-player effects still work
2. Verify opponent canvas rendering not affected
3. Verify multiplayer networking still works
4. Verify leaderboard/chat not affected

---

## 🚀 Implementation Order (Recommended)

### Sprint 1: Foundation (Day 1)
- ✅ Phase 1: Integrate canvas-drawing-utils into multiplayer - **COMPLETE**
- ✅ Test solid tetrominos and ghost piece in FFA - **COMPLETE**

### Sprint 2: Effects System (Day 2-3)
- ✅ Phase 2: Create MultiplayerEffectsManager - **COMPLETE**
- ✅ Phase 2: Integrate Phaser overlay for main player - **COMPLETE**
- ✅ Phase 2: Update CSS layering - **COMPLETE**

### Sprint 3: Event Wiring (Day 4)
- ✅ Phase 3: Add effects callbacks to FFAGameStateP2P - **COMPLETE**
- ✅ Phase 3: Wire effects to game events - **COMPLETE**
- ✅ Phase 3: Test all effects in multiplayer - **READY FOR TESTING**

### Sprint 4: Polish (Day 5)
- 🔲 Phase 5: Performance optimization
- 🔲 Phase 5: Quality settings
- 🔲 Testing & bug fixes

### Sprint 5: Optional (Day 6+)
- 🔲 Phase 4: Opponent effects (if time permits)

---

## 🎯 Success Criteria

### Must Have
- ✅ Solid tetromino rendering in multiplayer
- ✅ Pulsating ghost piece in multiplayer
- ✅ Phaser effects on main player board (particles, flashes, ripples, combos)
- ✅ Effects aligned with game board
- ✅ 60 FPS on mid-range hardware
- ✅ No visual regressions in single-player

### Nice to Have
- ⭐ Opponent board minimal effects
- ⭐ Per-player quality settings
- ⭐ Mobile support (touch-optimized effects)

### Stretch Goals
- 🌟 Custom particle shapes per piece color
- 🌟 Screen shake on T-spin/Tetris
- 🌟 Victory animation when winning FFA

---

## 📝 Notes & Considerations

### Design Decisions
1. **Why Hybrid Rendering?**
   - Canvas 2D is faster for static board rendering
   - Phaser excels at particle systems and effects
   - Separation of concerns (game logic vs visual polish)

2. **Why Main Player Only for Effects?**
   - Performance: 4 Phaser instances = significant overhead
   - User experience: Player cares most about their own effects
   - Scalability: Works for 1v1 and 1v9

3. **Why Not Full Phaser for Multiplayer?**
   - Canvas 2D is simpler for basic shapes (blocks, grid)
   - Easier to dynamically create/destroy player canvases
   - Lower memory footprint for opponent boards

### Potential Challenges
- **Canvas Layering**: Ensuring Phaser canvas stays aligned with game canvas during resize
- **Event Timing**: Syncing effects with networked game state updates (lag compensation)
- **Memory Management**: Properly destroying Phaser instances when players leave
- **CSS Conflicts**: Multiplayer CSS might conflict with single-player styling

### Future Enhancements
- **Spectator Mode**: Allow spectators to see all players with full effects
- **Replay System**: Record effects and replay them
- **Custom Effects**: Let players customize particle colors/shapes
- **Season Themes**: Holiday-themed effects (e.g., snowflakes in winter)

---

## ✅ Completion Checklist

- [x] Phase 1: Canvas drawing utils integrated ✅
- [x] Phase 2: Phaser effects overlay working ✅
- [x] Phase 3: Events triggering effects ✅
- [ ] Phase 4: Opponent effects (optional)
- [ ] Phase 5: Performance optimized
- [ ] All visual tests passing
- [ ] All performance tests passing
- [ ] No regressions in single-player
- [ ] Documentation updated
- [ ] Code reviewed and merged

---

**Status**: 🔄 IN PROGRESS (Phase 1 & 2 Complete!)  
**Priority**: ⭐⭐⭐ HIGH  
**Estimated Total Time**: 2-3 days  
**Risk Level**: 🟡 MEDIUM (requires careful layering and performance tuning)

---

## 📝 Implementation Log

### Phase 1 - Complete! ✅
- ✅ Added imports from `canvas-drawing-utils.js`
- ✅ Updated `renderPlayerCanvas()` to use new drawing functions
- ✅ Updated `startRenderLoop()` to use `requestAnimationFrame`
- ✅ Solid tetrominos rendering in multiplayer
- ✅ Pulsating ghost pieces working

### Phase 2 - Complete! ✅
- ✅ Created `MultiplayerEffectsManager` class
- ✅ Integrated Phaser overlay for main player canvas
- ✅ Updated CSS layering for effects overlay
- ✅ Proper z-index stacking (canvas at z:2, effects at z:10)
- ✅ Cleanup handlers in `hide()` and `destroy()`

### Phase 3 - Complete! ✅
- ✅ Added `ffa:line-clear` event dispatch in FFAGameStateP2P
- ✅ Added `ffa:piece-lock` event dispatch in FFAGameStateP2P
- ✅ Created `setupEffectEventListeners()` in MultiPlayerCanvasLayout
- ✅ Wired line clear effects (flash + particles)
- ✅ Wired piece lock effects (ripples)
- ✅ Cleanup handlers added for event listeners

### How to Test 🧪
```javascript
// In browser console:
window.testMultiplayer(2);  // Wait 1-2 seconds
ffa.startMatch();            // Start the game

// Now play! Clear lines to see:
// - 💫 Line clear flashes
// - ✨ Particle effects
// - 🌊 Piece lock ripples
// - 👻 Pulsating ghost pieces
// - 🎮 Solid tetromino pieces
```

---

*Last Updated: 2025-10-18*

