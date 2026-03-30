# Multiplayer Effects Debugging Guide

## Current Status
The ghost piece is visible in multiplayer, but the Phaser effects (line clear flash, particles, piece lock ripples) are not showing.

## Testing Steps

### Step 1: Fresh Start
1. Press **Ctrl+Shift+R** to hard refresh
2. Open browser console (F12)

### Step 2: Start Multiplayer
```javascript
window.testMultiplayer(2); 
setTimeout(() => window.startFFAMatch(), 2000);
```

### Step 3: Test Effects Manually
Once in the game, run:
```javascript
window.testEffects();
```

## What to Look For

### Expected Console Output:

#### On Game Start:
```
🔄 Switching from none → online-multiplayer
🛑 Stopping single-player...
✅ Single-player stopped
▶️ Starting online-multiplayer...
✅ Now in online-multiplayer mode
```

#### When Effects Initialize:
```
🎨 Initializing MultiplayerEffectsManager
✅ Phaser effects overlay initialized for multiplayer
✨ Setting up effect event listeners...
📡 Effects listening for game events (line-clear, piece-lock)
   Effects manager status: {exists: true, hasBoardScene: true, methods: [...]}
```

#### When You Clear a Line:
```
🔔 Line clear event received: {isLocal: true, linesCleared: 1, ...}
💫 Triggering line clear effects! {lines: 1, hasEffectsManager: true}
✅ Line clear effects triggered successfully!
```

#### When Testing Manually:
```
🧪 Testing effects manually...
Effects manager: MultiplayerEffectsManager {...}
Board scene: MultiplayerBoardScene {...}
Phaser game: Game {...}
💫 Testing line clear flash...
✅ Line clear flash triggered
🌊 Testing piece lock ripple...
✅ Piece lock ripple triggered
✅ Effects test complete!
```

## Troubleshooting

### If Effects Manager is Null:
```javascript
// Check if canvas layout exists
console.log('Canvas layout:', window.app?.multiPlayerCanvasLayout);

// Check if show() was called
console.log('Is visible:', !window.app?.multiPlayerCanvasLayout?.container?.classList.contains('hidden'));
```

### If Board Scene is Null:
```javascript
// Check Phaser game state
const effectsManager = window.app?.multiPlayerCanvasLayout?.effectsManager;
console.log('Phaser game:', effectsManager?.phaserGame);
console.log('Scenes:', effectsManager?.phaserGame?.scene?.scenes);
console.log('Active scenes:', effectsManager?.phaserGame?.scene?.getScenes(true));
```

### If Effects Don't Show But Methods Exist:
```javascript
// Check if Phaser canvas is visible
const phaserContainer = document.querySelector('.phaser-effects-container');
console.log('Phaser container:', phaserContainer);
console.log('Container visibility:', window.getComputedStyle(phaserContainer));
console.log('Container position:', phaserContainer?.getBoundingClientRect());

// Check canvas
const phaserCanvas = phaserContainer?.querySelector('canvas');
console.log('Phaser canvas:', phaserCanvas);
console.log('Canvas size:', phaserCanvas?.width, 'x', phaserCanvas?.height);
```

### Manual Event Dispatch Test:
```javascript
// Manually trigger a line clear event
window.dispatchEvent(new CustomEvent('ffa:line-clear', {
  detail: {
    steamId: 'test',
    playerName: 'Test',
    linesCleared: 2,
    isLocal: true
  }
}));

// Manually trigger a piece lock event
window.dispatchEvent(new CustomEvent('ffa:piece-lock', {
  detail: {
    steamId: 'test',
    playerName: 'Test',
    piece: {
      x: 4,
      y: 10,
      shape: [[1, 1], [1, 1]],
      color: '#ff0000'
    },
    isLocal: true
  }
}));
```

## Common Issues

### 1. Effects Manager Not Initialized
**Symptom**: `window.testEffects()` shows "❌ No effects manager!"
**Fix**: The `show()` method in `MultiPlayerCanvasLayout` should call `initializeEffectsForMainPlayer()`

### 2. Board Scene Not Ready
**Symptom**: Effects manager exists but boardScene is null
**Fix**: Wait for Phaser 'ready' event. The scene might still be loading.

### 3. Phaser Canvas Not Visible
**Symptom**: Methods execute but no visual effects
**Fix**: Check CSS z-index and positioning of `.phaser-effects-container`

### 4. Events Not Dispatched
**Symptom**: No console logs when clearing lines
**Fix**: Check `ffa-p2p-game-state.js` is dispatching `ffa:line-clear` and `ffa:piece-lock` events

### 5. Listeners Not Attached
**Symptom**: Events dispatched but not received
**Fix**: Check `setupEffectEventListeners()` is called in `initializeEffectsForMainPlayer()`

## Files to Check

1. **`src/ui/multi-player-canvas-layout.js`**
   - Line 503: `initializeEffectsForMainPlayer()` called in `show()`
   - Line 747: Effects manager initialization
   - Line 786: Event listeners setup

2. **`src/rendering/phaser/multiplayer-effects-manager.js`**
   - Line 33: Phaser initialization
   - Line 97: Scene ready callback
   - Line 142: `triggerLineClearFlash()`
   - Line 153: `createPieceLockRipple()`

3. **`src/core/multiplayer/ffa-p2p-game-state.js`**
   - Line 318: `ffa:line-clear` event dispatch
   - Line 343: `ffa:piece-lock` event dispatch

4. **`public/styles/multiplayer-ui.css`**
   - Line 1224: `.phaser-effects-container` positioning

## Next Steps

Based on the console output from `window.testEffects()`, we can determine:
- ✅ If effects manager is initialized
- ✅ If Phaser scene is loaded
- ✅ If methods exist and can be called
- ✅ If effects actually render (you should see flashes/ripples)

Report back what you see! 🔍

