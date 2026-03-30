# Game Mode Lifecycle Implementation

## Problem
When playing online multiplayer, the single-player game was still running in the background, wasting CPU/GPU resources and causing confusion.

## Solution
Created a `GameModeLifecycle` manager that ensures only one game mode runs at a time by properly stopping/starting modes on transitions.

## Implementation

### 1. Created `src/core/game-mode-lifecycle.js`
- **Purpose**: Centralized lifecycle management for all game modes
- **Modes**: `SINGLE_PLAYER`, `LOCAL_MULTIPLAYER`, `ONLINE_MULTIPLAYER`, `NONE`
- **Key Methods**:
  - `switchTo(mode)` - Stop current mode and start new one
  - `stopCurrentMode()` - Clean up active mode resources
  - `startMode(mode)` - Initialize and show target mode

### 2. What Gets Stopped in Each Mode

#### Single-Player:
- ✅ Cancels `animationFrameId` (game loop)
- ✅ Hides single-player canvas
- ✅ Hides single-player container (`#single-player-container`)
- ✅ Pauses Phaser board scene (effects)

#### Local Multiplayer:
- ✅ Cancels multiplayer animation frame
- ✅ Clears multiplayer state

#### Online Multiplayer:
- ✅ Stops FFA render loop
- ✅ Hides multiplayer container (`#multiplayer-container`)
- ✅ Pauses FFA game state

### 3. Integration Points in `main.js`

#### Imports:
```javascript
import { GameModeLifecycle, GAME_MODE } from './core/game-mode-lifecycle.js';
```

#### Constructor:
```javascript
this.gameModeLifecycle = null; // NEW: Lifecycle manager
```

#### Initialization (after all managers):
```javascript
// Initialize game mode lifecycle manager
this.gameModeLifecycle = new GameModeLifecycle(this);
```

#### Test Multiplayer (`testMultiplayerUI`):
```javascript
// Step 0: Switch to online multiplayer mode (stops single-player)
if (this.gameModeLifecycle) {
    await this.gameModeLifecycle.switchTo(GAME_MODE.ONLINE_MULTIPLAYER);
}
```

#### Exit Multiplayer (`exitOnlineMultiplayer`):
```javascript
// Switch back to single-player mode (stops multiplayer)
if (this.gameModeLifecycle) {
    await this.gameModeLifecycle.switchTo(GAME_MODE.SINGLE_PLAYER);
}
```

#### Start Game (`startGame`):
```javascript
// Made async
async startGame() {
    // ...
    if (currentMode === GAME_MODES.LOCAL_MULTIPLAYER) {
        // Switch to local multiplayer mode
        if (this.gameModeLifecycle) {
            await this.gameModeLifecycle.switchTo(GAME_MODE.LOCAL_MULTIPLAYER);
        }
        this.startMultiplayerGame();
    } else {
        // Switch to single player mode (stops other modes)
        if (this.gameModeLifecycle) {
            await this.gameModeLifecycle.switchTo(GAME_MODE.SINGLE_PLAYER);
        }
        this.startSinglePlayerGame();
    }
}
```

## Benefits

1. **Resource Efficiency**: Only one game mode runs at a time
2. **Clean Transitions**: Proper cleanup when switching modes
3. **No Interference**: Each mode is fully isolated from others
4. **Clear Lifecycle**: Easy to understand what's active and when
5. **Debugging**: Clear console logs for mode transitions

## Testing

### Test Single → Online:
```javascript
// Start single-player first (press spacebar on start modal)
// Then switch to online:
window.testMultiplayer(2);
setTimeout(() => window.startFFAMatch(), 2000);
// ✅ Single-player should be stopped and hidden
```

### Test Online → Single:
```javascript
// While in online multiplayer:
window.exitMultiplayer();
// ✅ Multiplayer should stop, single-player UI shows
```

### Test Mode Button Switching:
1. Start single-player game
2. Open settings (ESC)
3. Change game mode
4. ✅ Game should stop and switch modes

## Console Output Example

```
🔄 GameModeLifecycle initialized
🔄 Switching from none → online-multiplayer
▶️ Starting online-multiplayer...
  👁️ Showing multiplayer container
  ✅ Online multiplayer UI ready
✅ Now in online-multiplayer mode

🔄 Switching from online-multiplayer → single-player
🛑 Stopping online-multiplayer...
  ⏹️ Stopping FFA render loop
  👁️ Hiding multiplayer container
  ⏸️ Pausing FFA game state
  ✅ Online multiplayer stopped
▶️ Starting single-player...
  👁️ Showing single-player container
  👁️ Showing single-player canvas
  ✅ Single-player UI ready
✅ Now in single-player mode
```

## Files Modified

- ✅ `/src/core/game-mode-lifecycle.js` (NEW)
- ✅ `/src/main.js` (imported, integrated lifecycle)
- ✅ `/GAME_MODE_LIFECYCLE_IMPLEMENTATION.md` (this file)

## Status

✅ **COMPLETE** - Game mode lifecycle properly manages transitions between all modes.

