# Phase 1 Quick Test Guide

**🎯 Goal:** See pieces moving on screen!

---

## Quick Test (5 minutes)

### Step 1: Start the Server
```bash
npm run dev
```

### Step 2: Open Browser
Go to: `http://localhost:5173/`

### Step 3: Start a Match
```javascript
// In browser console (F12):

// Create and start a match
window.testMultiplayer(1);

// Wait 2 seconds, then:
ffa.startMatch();
```

### Step 4: Play!
Press arrow keys:
- ← LEFT: Move piece left
- → RIGHT: Move piece right
- ↑ UP: Rotate piece
- ↓ DOWN: Soft drop
- SPACE: Hard drop

---

## Expected Result

You should see:
- ✅ A grid (10 columns × 20 rows)
- ✅ A colored tetromino at the top
- ✅ Piece moves when you press keys
- ✅ Piece locks when it hits bottom
- ✅ New piece spawns after lock
- ✅ Stats update (score, lines, level)

Console should show (every frame):
```
🎨 Rendering...
📡 Render event 1 players
```

---

## Two-Player Test (10 minutes)

### Window 1 (Host):
```javascript
// Console:
window.showLobbyBrowser();
// Click "Create Match"
// Note the lobby ID in console
```

### Window 2 (Peer):
```javascript
// Open 2nd window: http://localhost:5173/
// Console:
window.showLobbyBrowser();
// Click the lobby in the list
// Click "Join"
```

### Back to Window 1:
```
// Wait for peer to show in waiting room
// Click "Start Match"
```

### Both Windows:
Press arrow keys and see:
- ✅ Your own piece moves
- ✅ You see opponent's board
- ✅ Opponent's piece moves
- ✅ Both stats update

---

## Troubleshooting

### "Nothing happens when I press keys"
```javascript
// Check game phase:
console.log(ffa.gamePhase); // Should be 'playing'

// Check you have a piece:
console.log(ffa.getLocalPlayer().gameState.currentPiece);
```

### "Black canvas"
```javascript
// Check canvas exists:
const canvas = document.querySelector('#main-game-canvas');
console.log('Canvas:', canvas);
console.log('Size:', canvas.width, 'x', canvas.height);
```

### "Piece doesn't appear"
```javascript
// Check rendering is being called:
let count = 0;
window.addEventListener('ffa:render-frame', () => {
  console.log('Render count:', ++count);
});
// Should count up rapidly
```

### "Still not working?"
```javascript
// Full diagnostic:
console.log('=== DIAGNOSTIC ===');
console.log('FFA exists?', !!window.ffa);
console.log('Game phase:', window.ffa?.gamePhase);
console.log('Players:', window.ffa?.players.size);
console.log('Local player:', window.ffa?.getLocalPlayer()?.name);
console.log('Has piece?', !!window.ffa?.getLocalPlayer()?.gameState.currentPiece);
console.log('Canvas exists?', !!document.querySelector('#main-game-canvas'));
console.log('=== END ===');
```

---

## Success!

If you see pieces moving, **congratulations!** 🎉

Phase 1 is complete and working!

Next: Proceed to Phase 2 for peer synchronization improvements.

---

## Quick Commands Reference

```javascript
// Show lobby browser
window.showLobbyBrowser();

// Create match (no UI)
await window.createFFAMatch();

// Test with N players
window.testMultiplayer(3); // 3 players

// Mark all ready
window.markAllReady();

// Start match
ffa.startMatch();

// Exit multiplayer
window.exitMultiplayer();

// Clear lobbies
window.clearLobbies();
```

---

**Have fun playing! 🎮**

