# Debug Canvas Positions After Resize

Run this in the browser console after resizing to check canvas positions:

```javascript
// Check all canvases
const phaserContainer = document.getElementById('phaser-game-container');
const gameCanvas = document.getElementById('single-player-game-canvas');
const phaserCanvas = phaserContainer?.querySelector('canvas');

console.log('=== CANVAS POSITIONS DEBUG ===');
console.log('Phaser Container:', {
  element: phaserContainer,
  size: phaserContainer ? `${phaserContainer.offsetWidth}x${phaserContainer.offsetHeight}` : 'N/A',
  position: phaserContainer ? phaserContainer.getBoundingClientRect() : 'N/A'
});

console.log('Game Canvas (single-player-game-canvas):', {
  element: gameCanvas,
  size: gameCanvas ? `${gameCanvas.width}x${gameCanvas.height}` : 'N/A',
  displaySize: gameCanvas ? `${gameCanvas.offsetWidth}x${gameCanvas.offsetHeight}` : 'N/A',
  position: gameCanvas ? gameCanvas.getBoundingClientRect() : 'N/A',
  zIndex: gameCanvas ? window.getComputedStyle(gameCanvas).zIndex : 'N/A',
  display: gameCanvas ? window.getComputedStyle(gameCanvas).display : 'N/A'
});

console.log('Phaser Canvas:', {
  element: phaserCanvas,
  size: phaserCanvas ? `${phaserCanvas.width}x${phaserCanvas.height}` : 'N/A',
  displaySize: phaserCanvas ? `${phaserCanvas.offsetWidth}x${phaserCanvas.offsetHeight}` : 'N/A',
  position: phaserCanvas ? phaserCanvas.getBoundingClientRect() : 'N/A',
  zIndex: phaserCanvas ? window.getComputedStyle(phaserCanvas).zIndex : 'N/A',
  display: phaserCanvas ? window.getComputedStyle(phaserCanvas).display : 'N/A',
  transform: phaserCanvas ? window.getComputedStyle(phaserCanvas).transform : 'N/A'
});

console.log('Are they overlapping?', {
  gameCanvasRect: gameCanvas?.getBoundingClientRect(),
  phaserCanvasRect: phaserCanvas?.getBoundingClientRect(),
  overlap: function() {
    if (!gameCanvas || !phaserCanvas) return 'Cannot determine';
    const r1 = gameCanvas.getBoundingClientRect();
    const r2 = phaserCanvas.getBoundingClientRect();
    return !(r2.left > r1.right ||
             r2.right < r1.left ||
             r2.top > r1.bottom ||
             r2.bottom < r1.top);
  }()
});

// Check if particles exist in the scene
if (window.game?.boardScene) {
  console.log('BoardScene effects:', {
    effectsAvailable: !!window.game.boardScene.effects,
    activeParticleSystems: window.game.boardScene.effects?.activeParticleSystems?.size || 0,
    blockSize: window.game.boardScene.blockSize,
    boardConfig: window.game.boardScene.boardConfig
  });
}
```

## What to Look For:

1. **Size Mismatch**: Phaser canvas and game canvas should be the same dimensions
2. **Position Mismatch**: They should overlap perfectly (same bounding rect)
3. **Z-Index**: Phaser should be higher (10 vs 1)
4. **Transform**: Phaser canvas uses `translate(-50%, -50%)` - check if this is correct
5. **Display**: Both should be visible (`display: block` or similar, not `none`)

## Expected Values After 400x800 Resize:

```
Game Canvas size: 400x800
Phaser Canvas size: 400x800
Both at same position (overlapping)
Phaser z-index: 10
Game z-index: 1
```

If the Phaser canvas is positioned outside the viewport or behind the game canvas, that's the problem!
