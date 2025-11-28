# Demo Recording & Playback System for Serenity Blocks

## Overview
Implement a demo recording and playback system for single player mode that allows players to record gameplay, save demos, and share cool cascades/combos with others.

## Recommended Approach: Input Recording (Event Sourcing)

**Why Input Recording?**
- Minimal file size: 500 bytes - 10KB per demo (vs 180KB/second for state snapshots)
- Deterministic replay: Same RNG seed + inputs = identical outcome
- Easy sharing: Fits in URLs, clipboard, QR codes
- Already supported by existing architecture with `seededRandom()` utility

## Demo File Format

```javascript
{
  "version": "1.0",
  "gameMode": "single-player",
  "timestamp": 1700000000000,

  "initialState": {
    "seed": 42,                    // RNG seed for piece generation
    "level": 1,
    "settings": {...}              // DAS, theme, etc.
  },

  "inputs": [
    { "t": 0, "a": "spawn" },           // t=time(ms), a=action
    { "t": 150, "a": "move", "d": 1 },  // d=direction
    { "t": 300, "a": "rotate", "d": "right" },
    { "t": 450, "a": "hardDrop" }
  ],

  "metadata": {
    "duration": 30000,
    "finalScore": 15000,
    "maxCombo": 8,
    "linesCleared": 12,
    "description": "Amazing 8x cascade combo!"
  }
}
```

**File Formats:**
- Local storage: Raw JSON in IndexedDB
- File export: `.sbd` (Serenity Blocks Demo) file extension
- URL sharing: Base64-encoded + GZIP compressed

## Architecture

### Module 1: DemoRecorder.js
**Location:** [src/core/demo/DemoRecorder.js](src/core/demo/DemoRecorder.js)

**Purpose:** Captures player inputs during gameplay

**Key Methods:**
- `startRecording(gameState, settings, seed)` - Initialize with seed capture
- `recordInput(action, data, timestamp)` - Capture each input event
- `stopRecording()` - Finalize and return demo object
- `getDemo()` - Export as JSON

**Integration:** Hook into input handlers in SinglePlayerMode BEFORE actions execute

### Module 2: DemoPlayer.js
**Location:** [src/core/demo/DemoPlayer.js](src/core/demo/DemoPlayer.js)

**Purpose:** Replays demos with frame-perfect timing

**Key Methods:**
- `loadDemo(demoData)` - Parse and validate demo
- `startPlayback(callbacks)` - Begin replay with timing control
- `pausePlayback()` / `resumePlayback()`
- `setPlaybackSpeed(speed)` - Adjust playback rate (0.25x to 2.0x)

**Playback Strategy:**
1. Create new GameState with demo's RNG seed
2. Queue all demo inputs with target timestamps
3. Process inputs at exact recorded times (accounting for playback speed)
4. Block player input during playback
5. Use same game loop as regular gameplay

### Module 3: DemoManager.js
**Location:** [src/core/demo/DemoManager.js](src/core/demo/DemoManager.js)

**Purpose:** Storage, retrieval, and sharing of demos

**Storage:** IndexedDB (following HighScoreManager pattern)

**Key Methods:**
- `saveDemo(demo)` - Store to IndexedDB
- `loadDemo(id)` - Retrieve by ID
- `listDemos({ sort, filter, limit })` - Browse demos
- `deleteDemo(id)` - Remove demo
- `exportToFile(demo)` - Download as `.sbd` file
- `importFromFile(file)` - Load `.sbd` file
- `exportToURL(demo)` - Generate shareable URL with compression
- `importFromURL(url)` - Parse compressed URL parameter

### Module 4: Integration with SinglePlayerMode
**Location:** [src/core/game-modes/SinglePlayerMode.js](src/core/game-modes/SinglePlayerMode.js)

**Changes Required:**

1. Add recording state properties
2. Initialize RNG with seed in `onStart()`
3. Hook recording into input handlers (move, rotate, hardDrop, softDrop)
4. Save demo on game over if recording
5. Add `startDemoPlayback(demo)` method for playback mode

## UI Components

### 1. Recording Indicator
- Overlay on game board (top-right corner)
- Red pulsing dot + "REC" text + elapsed time
- Toggle in settings to enable/disable auto-recording

### 2. Game Over Demo Options
**File:** [src/ui/modals.js](src/ui/modals.js) - showGameOverModal function

Add buttons:
- "💾 Save Replay" - Save to IndexedDB
- "📤 Share Replay" - Copy shareable URL to clipboard

### 3. Demo Browser
**New file:** [src/ui/demo-browser.js](src/ui/demo-browser.js)

Features:
- List all saved demos from IndexedDB
- Sort by: Date, Score, Max Combo, Duration
- Filter by: Score range, Combo count
- Actions: Play, Share, Delete
- Import from file (.sbd) or URL

### 4. Playback Controls
**New file:** [src/ui/demo-playback-ui.js](src/ui/demo-playback-ui.js)

Overlay controls during playback:
- Play/Pause toggle
- Speed selector: 0.25x, 0.5x, 1.0x, 1.5x, 2.0x
- Progress bar
- Current time / Total duration
- Exit playback button

## Implementation Steps

### Phase 1: Core Infrastructure
**Goal:** Establish deterministic recording foundation

1. **Verify RNG determinism** (CRITICAL)
   - Review [src/core/game.js](src/core/game.js) - `fillBag()` and `spawnPiece()`
   - Ensure consistent use of `gameState.randomGenerator`
   - Test: Record with seed X, replay 10 times, verify identical results

2. **Create DemoRecorder module**
   - Implement input capture with timestamps
   - Create demo JSON structure
   - Add unit tests

3. **Integrate recorder with SinglePlayerMode**
   - Add recorder instance and state
   - Hook into input pipeline
   - Capture RNG seed during initialization

### Phase 2: Playback Engine
**Goal:** Reliable demo replay

4. **Create DemoPlayer module**
   - Implement input queue and timing system
   - Add playback controls (play, pause, speed)
   - Use `performance.now()` for precise timing

5. **Test determinism thoroughly**
   - Record 20+ demos with various gameplay patterns
   - Replay each 5+ times
   - Verify final scores are identical

6. **Add playback mode to SinglePlayerMode**
   - New method: `startDemoPlayback(demo)`
   - Initialize GameState with demo's seed
   - Block player input during playback

### Phase 3: Storage Layer
**Goal:** Persistent storage and sharing

7. **Create DemoManager module**
   - Follow IndexedDB pattern from [src/ui/high-scores.js](src/ui/high-scores.js)
   - Implement CRUD operations
   - Add demo listing with sort/filter

8. **Implement file export/import**
   - Export as `.sbd` JSON file
   - Import via file picker
   - Validate demo format and version

9. **Implement URL compression**
   - Use browser `CompressionStream` API for GZIP
   - Base64 encode compressed data
   - Generate shareable URLs

### Phase 4: UI Integration
**Goal:** User-facing features

10. **Add recording indicator**
    - Create UI component showing REC status
    - Display elapsed time
    - Add toggle in settings

11. **Update Game Over modal**
    - Add "Save Replay" and "Share Replay" buttons
    - Wire to DemoManager
    - Show clipboard copy confirmation

12. **Create Demo Browser**
    - List demos from IndexedDB
    - Implement sort/filter controls
    - Add play/share/delete actions

13. **Create Playback Controls**
    - Overlay controls during playback
    - Play/pause, speed control, progress bar

### Phase 5: Polish & Validation
**Goal:** Production-ready quality

14. **Add demo validation**
    - Version compatibility checks
    - Input sequence validation
    - Graceful handling of corrupted demos

15. **Add auto-metadata**
    - Calculate max combo during recording
    - Auto-generate descriptions
    - Add tags for filtering

16. **Performance optimization**
    - Lazy load demo list in browser
    - Optimize compression/decompression speed

17. **End-to-end testing**
    - Full workflow: Record → Save → Load → Replay
    - URL sharing workflow
    - File export/import workflow
    - Cross-browser testing

## Critical Considerations

### 1. RNG Desynchronization
**Risk:** If ANY randomness uses Math.random() instead of seeded RNG, replays will diverge

**Solution:**
- Audit codebase for `Math.random()` calls
- Replace with `gameState.randomGenerator()`
- Test extensively with 100+ replay iterations

### 2. Input Timing Precision
**Risk:** Browser frame timing variations may affect input processing

**Solution:**
- Use `performance.now()` for high-precision timestamps
- Process inputs on exact timestamp matches (not frame-based)
- Queue inputs and process when timestamp reached

### 3. Version Compatibility
**Risk:** Game updates may break old demo format

**Solution:**
- Add version field to demo format
- Maintain backward compatibility layer
- Show warning when replaying old-version demos

## Critical Files to Review

1. [src/core/game.js](src/core/game.js) - Core game loop and RNG usage; verify `fillBag()` and `spawnPiece()` use seeded randomGenerator

2. [src/core/game-modes/SinglePlayerMode.js](src/core/game-modes/SinglePlayerMode.js) - Main integration point for recording/playback hooks

3. [src/utils/helpers.js](src/utils/helpers.js) - Contains `seededRandom()` utility for deterministic replay

4. [src/ui/high-scores.js](src/ui/high-scores.js) - Pattern to follow for IndexedDB storage in DemoManager

5. [src/ui/modals.js](src/ui/modals.js) - Game over modal where demo save/share options will be added

## Success Metrics

- File size: 500 bytes - 10KB per demo
- Determinism: 100% identical replays
- Performance: <5ms recording overhead per input
- Reliability: Works across Chrome, Firefox, Safari
- Sharing: URL-friendly, clipboard-ready

## Extending to Other Game Modes

The demo recording system is designed to be mode-agnostic and can be extended to support other game modes with minimal changes.

### Supported Game Modes

Based on the codebase analysis, here are the game modes and their demo compatibility:

#### ✅ Fully Compatible Modes

1. **SinglePlayerMode** (Primary target)
   - Standard gameplay with scoring and levels
   - Already covered in this plan

2. **InfinityMode** (Recommended next implementation)
   - 1000-row vertical playfield with dynamic camera
   - Similar to SinglePlayer but with extended features
   - See implementation details below

3. **LocalMultiplayerMode** (Future enhancement)
   - Multiple players on same device
   - Requires recording inputs for each player
   - More complex but feasible

#### ❌ Not Applicable

4. **SerenityMode**
   - Non-interactive meditation/visualization mode
   - No gameplay to record

5. **OnlineMultiplayerMode**
   - Already has server-side replay capabilities
   - May benefit from client-side demo saving for offline viewing

### Implementing Demo Recording for Infinity Mode

Infinity Mode shares the same core game mechanics as Single Player but adds:
- Expandable 1000-row grid
- Camera positioning and movement
- Minimap visualization
- Height milestones

**Additional Demo Data Required:**

```javascript
{
  "version": "1.0",
  "gameMode": "infinity",  // Changed from "single-player"
  "timestamp": 1700000000000,

  "initialState": {
    "seed": 42,
    "level": 1,
    "settings": {...},
    // Infinity-specific state
    "maxRows": 1000,
    "visibleRows": 20,
    "initialTopRow": 0
  },

  "inputs": [
    // Same input format as single player
    { "t": 150, "a": "move", "d": 1 },
    { "t": 300, "a": "rotate", "d": "right" },
    // Camera controls are auto-calculated during replay
    // No need to record camera position changes
  ],

  "metadata": {
    "duration": 180000,
    "finalScore": 50000,
    "maxCombo": 12,
    "linesCleared": 45,
    "maxHeight": 156,  // Infinity-specific: highest row reached
    "description": "Reached row 156 with massive cascade!"
  }
}
```

**Code Changes for Infinity Mode:**

1. **InfinityMode.js integration** - Same pattern as SinglePlayerMode:
   ```javascript
   // In InfinityMode.js
   async onStart() {
     // Initialize RNG with seed
     const seed = this.isPlayingDemo ?
       this.demoPlayer.demo.initialState.seed :
       Date.now();
     this.gameState.randomGenerator = seededRandom(seed);

     // Start recording if enabled
     if (this.isRecordingDemo) {
       this.demoRecorder = new DemoRecorder();
       this.demoRecorder.startRecording(
         this.gameState,
         settings,
         seed,
         'infinity'  // Pass mode identifier
       );
     }

     // ... rest of onStart
   }
   ```

2. **Camera replay** - During playback, camera should auto-follow based on piece positions
   - No need to record camera movements
   - The camera logic (`_updateCameraPosition()`, `_smoothCameraFollow()`) will automatically recalculate based on replayed game state
   - Grid expansion (`expandGridIfNeeded()`) is deterministic based on piece positions

3. **Minimap replay** - Minimap will update automatically during playback as pieces are placed

**No Additional Complexity!** The beauty of input recording is that Infinity Mode's camera, grid expansion, and minimap are all **derived from game state**, which is deterministically replayed from inputs.

### Implementing Demo Recording for Local Multiplayer

Local Multiplayer requires recording inputs for multiple players simultaneously.

**Extended Demo Format:**

```javascript
{
  "version": "1.0",
  "gameMode": "local-multiplayer",
  "timestamp": 1700000000000,
  "playerCount": 2,

  "initialState": {
    "seeds": [42, 87],  // One seed per player
    "level": 1,
    "settings": {...}
  },

  "inputs": [
    { "t": 150, "p": 0, "a": "move", "d": 1 },      // p=player index
    { "t": 155, "p": 1, "a": "rotate", "d": "right" },
    { "t": 300, "p": 0, "a": "hardDrop" },
    { "t": 450, "p": 1, "a": "move", "d": -1 }
  ],

  "metadata": {
    "duration": 120000,
    "winner": 0,  // Player index
    "playerStats": [
      { "score": 15000, "linesCleared": 20 },
      { "score": 12000, "linesCleared": 18 }
    ]
  }
}
```

**Implementation Notes:**
- Each player's inputs are recorded with player index (`p`)
- Each player needs their own RNG seed for piece generation
- Playback processes inputs in chronological order, dispatching to appropriate player
- Slightly larger file size due to multiple input streams (still <20KB for typical matches)

### Mode-Agnostic DemoRecorder Changes

To support multiple modes, update `DemoRecorder.js`:

```javascript
class DemoRecorder {
  startRecording(gameState, settings, seed, gameMode = 'single-player') {
    this.demo = {
      version: "1.0",
      gameMode: gameMode,  // Now configurable
      timestamp: Date.now(),
      initialState: {
        seed: seed,
        level: gameState.level,
        settings: this._captureSettings(settings)
      },
      inputs: [],
      metadata: {}
    };

    this.isRecording = true;
    this.startTime = performance.now();
  }

  // Rest of implementation remains the same
}
```

### Demo Browser Filtering

Update the Demo Browser UI to filter by game mode:

```javascript
// In demo-browser.js
<select id="mode-filter">
  <option value="all">All Modes</option>
  <option value="single-player">Single Player</option>
  <option value="infinity">Infinity Mode</option>
  <option value="local-multiplayer">Local Multiplayer</option>
</select>
```

### Recommended Implementation Order

1. **Phase 1-5** - Implement for Single Player Mode (as outlined in main plan)
2. **Phase 6** - Extend to Infinity Mode (1-2 days)
   - Add mode parameter to DemoRecorder
   - Integrate with InfinityMode.js
   - Test camera/grid expansion during replay
3. **Phase 7** - Add mode filtering to Demo Browser (0.5 days)
4. **Future** - Extend to Local Multiplayer (3-4 days)
   - Requires multi-player input recording
   - More complex but uses same architecture

### Key Insight

The input recording approach makes multi-mode support **trivial** because:
- Core recording logic is mode-agnostic (just timestamps + actions)
- Mode-specific rendering (camera, minimap, multiplayer boards) is derived from game state
- Only the `gameMode` field and `initialState` structure need to be mode-aware
- Same DemoRecorder/DemoPlayer classes work for all modes
