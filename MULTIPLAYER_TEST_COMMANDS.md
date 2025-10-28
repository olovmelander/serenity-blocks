# FFA Multiplayer Test Commands

## 🎮 Quick Test (One Command)

Paste this into your browser console:

```javascript
window.testMultiplayer(2); setTimeout(() => window.startFFAMatch(), 2000);
```

This will:
1. Create a 2-player match
2. Wait 2 seconds
3. Automatically start the game

---

## 🎮 Step-by-Step Test

### Step 1: Create Match
```javascript
window.testMultiplayer(2)
```

Wait for console to show "✅ All players added"

### Step 2: Start Match
```javascript
window.startFFAMatch()
```

OR use the original method:
```javascript
ffa.startMatch()
```

---

## ✅ What You Should See

After running `window.startFFAMatch()`:

### Console Output:
```
🚀 Starting FFA match...
📊 Initializing canvases for 2 players
✅ Created 2 total canvases (1 main + 1 opponents)
🎨 Multi-player render loop started (requestAnimationFrame)
✨ Using upgraded rendering: solid tetrominos + pulsating ghost!
✅ Phaser effects overlay initialized for multiplayer
📡 Effects listening for game events (line-clear, piece-lock)
🎮 Match started!
```

### Visual:
- Waiting room closes
- Game board appears in center (large)
- Opponent board appears on left (small)
- You can play with arrow keys!

---

## 🐛 Troubleshooting

### "ffa is not defined"
**Solution**: Use `window.startFFAMatch()` instead of `ffa.startMatch()`

### "No FFA game state"
**Solution**: Run `window.testMultiplayer(2)` first

### "Game doesn't start"
**Solution**: 
1. Check console for errors
2. Make sure you waited for "✅ All players added"
3. Try: `window.ffa.gamePhase` (should be "waiting")
4. Hard refresh: Ctrl+Shift+R

### Still not working?
Run this diagnostic:
```javascript
console.log('FFA exists?', !!window.ffa);
console.log('Phase:', window.ffa?.gamePhase);
console.log('Players:', window.ffa?.players?.size);
```

---

## 🎯 Alternative: Use UI Button

After running `window.testMultiplayer(2)`, you should see a **waiting room** with a **"🚀 Start Match"** button. You can click that instead of using console commands!

---

## 📝 All Available Commands

```javascript
window.testMultiplayer(2)     // Create 2-player match
window.startFFAMatch()         // Start the match
window.exitMultiplayer()       // Exit multiplayer
window.markAllReady()          // Mark all players ready
window.clearLobbies()          // Clear mock lobbies
```

---

## 🎮 Expected Gameplay

Once started:
- **Arrow Keys**: Move piece
- **Up Arrow**: Rotate
- **Down Arrow**: Soft drop
- **Space**: Hard drop
- **ESC**: Exit multiplayer

### Effects You'll See:
- 💫 Line clear flashes
- ✨ Particle explosions
- 🌊 Piece lock ripples
- 👻 Pulsating ghost pieces
- 🎮 Solid tetromino shapes

---

*Last Updated: 2025-10-18*

