# 🎮 Test Multiplayer with 3 Players

## Quick Test

Just run this in the browser console:

```javascript
testMultiplayer(3)
```

---

## What This Does

1. ✅ Creates a new FFA match
2. ✅ Adds 2 mock players (Alice and Bob)
3. ✅ Shows the waiting room with all 3 players
4. ✅ Some players are "Ready", some are "Not Ready"
5. ✅ You can then start the match to see the canvas layout

---

## Expected Output

### In Console:
```
🧪 Testing Multiplayer UI with 3 players...

Step 1: Creating match...
✅ Match created

Step 2: Adding 2 mock players...
   ✅ Added Alice (Ready)
   ✅ Added Bob (Not Ready)
✅ All players added

Step 3: Current state:
   Total players: 3
   You are: HOST
   Phase: waiting

📋 Player List:
   Dev_XXX (YOU - HOST): ⏳ Not Ready
   Alice: ✅ Ready
   Bob: ⏳ Not Ready

🎮 What to do next:
...
```

### In Browser Window:
You should see the **Lobby Waiting Room** with:
- **Match Info Panel** (top left)
  - Max Players: 3/4
  - Win Condition: First to 10 Frags
  - Host: Your Name
  
- **Player List** (left side)
  - You (HOST) - ✅ Ready
  - Alice - ✅ Ready
  - Bob - ✅ Ready

- **Chat Area** (bottom left)
  - Ready for chat messages

- **Start Button** (as host)
  - "🚀 Start Match" button (enabled!)
  - Click to begin!

---

## Starting the Match

### Option A: Click the Button
Just click the **"🚀 Start Match"** button in the waiting room!

### Option B: Console Command
```javascript
ffa.startMatch()
```

---

## After Starting

You'll see:
1. **Waiting room hides**
2. **Multi-player canvas layout shows**
3. **3 game boards appear:**
   - **Your board** - Large, centered
   - **Alice's board** - Smaller, top-left
   - **Bob's board** - Smaller, top-right

4. **HUD appears** with:
   - Match timer
   - Current standings
   - Kill feed (when players die)

---

## Test Different Player Counts

Try these:

```javascript
testMultiplayer(2)  // 1v1 match
testMultiplayer(3)  // You + 2 opponents (recommended!)
testMultiplayer(4)  // You + 3 opponents
testMultiplayer(5)  // You + 4 opponents (max visible)
testMultiplayer(8)  // Full lobby!
```

---

## What to Look For

### In Waiting Room:
- ✅ All player names visible
- ✅ Ready status shows correctly
- ✅ Player count updates (e.g., "3/4")
- ✅ Host controls visible (Start button)
- ✅ Clean, readable layout

### In Game (After Starting):
- ✅ Your canvas is large and centered
- ✅ Opponent canvases are smaller
- ✅ Layout looks like the reference image
- ✅ All canvases update independently
- ✅ HUD shows match info

---

## Canvas Layout Examples

### 1v1 (2 Players):
```
+----------------------------------+
|                                  |
|     [Opponent - Large Left]      |
|                                  |
|                                  |
|      [You - Large Right]         |
|                                  |
+----------------------------------+
```

### 1v3 (4 Players):
```
+----------------------------------+
|  [Opp1]  [Opp2]                  |
|                                  |
|       [You - Large Center]       |
|                                  |
|  [Opp3]        [Stats]           |
+----------------------------------+
```

### 1v4 (5 Players):
```
+----------------------------------+
|  [Opp1]  [Opp2]                  |
|                                  |
|       [You - Large Center]       |
|                                  |
|  [Opp3]  [Opp4]                  |
+----------------------------------+
```

---

## Troubleshooting

### If "Start Match" button is disabled:
This means not all players are ready. The test automatically marks everyone ready, but if you manually create a match, you can run:

```javascript
markAllReady()
```

This will mark all players (including you) as ready!

---

## Cleanup

To go back to the lobby browser:
```javascript
// Hide everything
ffa = null
window.app.multiPlayerCanvasLayout.hide()
window.app.ffaHUD.hide()
window.app.lobbyWaitingRoom.hide()

// Show lobby browser
window.app.showLobbyBrowser()
```

Or just refresh the page! 🔄

---

## 🎉 Have Fun Testing!

This should give you a complete preview of the multiplayer experience from lobby → waiting room → in-game canvas layout!

Try different player counts to see how the layout adapts! 😊

