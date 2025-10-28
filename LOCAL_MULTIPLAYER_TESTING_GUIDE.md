# 🧪 Local Multiplayer Testing Guide

**How to Test Online Multiplayer with Just Your Computer**

---

## 🎯 Overview

You can test the online multiplayer system using **multiple browser windows/tabs** on your computer! Each tab acts as a separate player with its own mock Steam ID.

---

## 🚀 Quick Start (2 Players)

### **Step 1: Open Two Browser Windows**

1. **Window 1 (HOST):**
   - Open `http://localhost:5173` in a browser window
   - This will be the host player

2. **Window 2 (PEER):**
   - Open a **NEW WINDOW** (not just a tab) at `http://localhost:5173`
   - This will be the joining player
   - **Or:** Use a different browser (Chrome + Firefox)

**TIP:** Side-by-side windows work best!

---

### **Step 2: Create Match (Window 1 - HOST)**

In the first window:

1. Click **"Online MP"** button
2. Lobby browser appears
3. Click **"Create New Match"**
4. Configure match:
   ```
   Game Name: Test Match
   Max Players: 8
   Win Condition: First to 10 frags
   Lobby Type: Public
   ```
5. Click **"Create Match"**
6. ✅ **Waiting room appears**
7. Note the **Lobby ID** in console (e.g., `mock_lobby_123`)

---

### **Step 3: Join Match (Window 2 - PEER)**

In the second window:

1. Click **"Online MP"** button
2. Lobby browser appears
3. You should see the host's lobby in the list!
   ```
   🎮 Test Match
   Players: 1/8
   [Join] button
   ```
4. Click **"Join"** button
5. ✅ **Waiting room appears in Window 2**

**Both windows should now show the waiting room!**

---

### **Step 4: Get Ready**

**Window 2 (PEER):**
- Click **"✅ I'm Ready"** button
- Your status changes to ✅ Ready

**Window 1 (HOST):**
- You'll see the peer join in the player list
- Click **"✅ I'm Ready"** button (optional)
- Click **"🚀 Start Match"** button

---

### **Step 5: Play!**

- ✅ Both windows start the match
- ✅ Both players see the game boards
- ✅ Real-time gameplay!

---

## 🎮 Detailed Testing (3-5 Players)

### **Method 1: Multiple Browser Windows**

```
Window 1 (Chrome) → Host
Window 2 (Chrome) → Player 2
Window 3 (Firefox) → Player 3
Window 4 (Edge) → Player 4
```

### **Method 2: Multiple Chrome Profiles**

1. Create multiple Chrome profiles
2. Each profile = separate player
3. Can have multiple windows from different profiles

### **Method 3: Incognito + Regular**

```
Regular Window → Host
Incognito Window 1 → Player 2
Incognito Window 2 → Player 3
```

**Note:** Each incognito window should be a separate session

---

## 🧪 Test Scenarios

### **Scenario 1: Basic 2-Player Match**

```javascript
// Window 1 (HOST):
// 1. Click "Online MP"
// 2. Create match
// 3. Wait in waiting room

// Window 2 (PEER):
// 1. Click "Online MP"
// 2. Join match
// 3. Click "Ready"

// Window 1 (HOST):
// 1. Click "Ready"
// 2. Click "Start Match"
// → Both windows start playing!
```

### **Scenario 2: Quick Test with Console**

**Window 1 (HOST):**
```javascript
// Create match with test players
testMultiplayer(3)
// This creates a match with 3 mock players (you + 2 bots)
// Click "Start Match" to begin
```

**Window 2 (PEER):**
```javascript
// Join the match
showLobbyBrowser()
// Click "Join" on the test match
```

### **Scenario 3: Manual 5-Player Setup**

**Window 1:** Create match
**Window 2:** Join match
**Window 3:** Join match
**Window 4:** Join match
**Window 5:** Join match

All players appear in waiting room!
Host starts when ready.

---

## 🔍 Verification

### **Check Each Window:**

**In Waiting Room:**
- [ ] Player count increases as players join
- [ ] All players appear in player list
- [ ] Each player has unique name (Dev_XXX)
- [ ] Ready buttons work
- [ ] Chat works between windows

**During Match:**
- [ ] Both/all windows show game boards
- [ ] Tetrominos fall and are controllable
- [ ] Garbage attacks work between players
- [ ] Kill feed shows eliminations
- [ ] All canvases update in real-time

---

## 💡 Testing Tips

### **1. Arrange Windows Side-by-Side**

```
┌────────────────┬────────────────┐
│   Window 1     │   Window 2     │
│   (HOST)       │   (PEER)       │
│                │                │
│   Your game    │   Your game    │
│   board        │   board        │
│                │                │
└────────────────┴────────────────┘
```

### **2. Use Console Commands**

**Check lobby status:**
```javascript
// Window 1 (HOST)
console.log('Players:', ffa.players.size);
console.log('Game phase:', ffa.gamePhase);

// Window 2 (PEER)
console.log('Connected to:', ffa.network.currentLobbyId);
```

### **3. Simulate More Players**

**Window 1 (HOST) - Add bots:**
```javascript
// Add 3 mock players
testMultiplayer(5)  // You + 4 mock players

// Then in Window 2:
// Join this match normally
```

### **4. Test Different Browsers**

Different browsers = completely separate sessions:
- Chrome
- Firefox
- Edge
- Safari (Mac)

Each can be a different player!

---

## 🐛 Troubleshooting

### **Issue: Can't see lobby in other window**

**Solution 1: Refresh lobby browser**
```javascript
showLobbyBrowser()  // Re-opens lobby browser
```

**Solution 2: Check lobby ID**
```javascript
// Window 1 (HOST):
console.log('Lobby ID:', steam.currentLobbyId);

// Window 2 (PEER):
// Manually join if needed:
joinFFAMatch('mock_lobby_123')  // Use actual ID
```

### **Issue: Players not syncing**

**Check network status:**
```javascript
// Both windows:
console.log('Steam ID:', steam.steamId);
console.log('Is host:', ffa.isHost);
console.log('Players:', ffa.players);
```

### **Issue: Match won't start**

**Make sure:**
1. At least one player is ready
2. Host clicks "Start Match"
3. Check console for errors

**Force start:**
```javascript
// Window 1 (HOST only):
ffa.startMatch()
```

---

## 📊 Test Checklist

### **Lobby System:**
- [ ] Create match in Window 1
- [ ] Lobby appears in Window 2's browser
- [ ] Join successfully
- [ ] Player count updates
- [ ] Both windows show waiting room

### **Waiting Room:**
- [ ] Player list shows all players
- [ ] Match info displays correctly
- [ ] Ready button works
- [ ] Chat works between windows
- [ ] Host can start match

### **Gameplay:**
- [ ] Match starts in all windows
- [ ] Game boards render
- [ ] Tetrominos are playable
- [ ] Garbage attacks work
- [ ] Opponent boards update
- [ ] Kill feed works
- [ ] Score tracking works

### **Match End:**
- [ ] Winner is detected
- [ ] Match stats shown
- [ ] Can exit cleanly (ESC)
- [ ] Can start new match

---

## 🎯 Recommended Test Flow

### **First Test: 2 Players**

1. **Setup:**
   - Open 2 windows side-by-side
   - Window 1: Create match
   - Window 2: Join match

2. **Verify:**
   - Waiting room works
   - Match starts
   - Both players can play
   - Attacks work

3. **Duration:** ~5 minutes

### **Second Test: 3-5 Players**

1. **Setup:**
   - Window 1: `testMultiplayer(5)`
   - Window 2: Join the match
   - Optional: Window 3 joins too

2. **Verify:**
   - All players shown in waiting room
   - Match starts with all players
   - 2x2 grid shows opponents
   - All canvases update

3. **Duration:** ~10 minutes

### **Third Test: Full Features**

1. **Test:**
   - Different match settings
   - Chat functionality
   - Host migration (disconnect host)
   - Garbage attacks
   - Kill feed
   - Win conditions

2. **Duration:** ~15 minutes

---

## 🚀 Quick Commands Reference

### **Window 1 (HOST):**
```javascript
// Quick test match with bots
testMultiplayer(5)

// Create real match
showLobbyBrowser()  // Then click "Create"

// Check status
console.log('Lobby:', steam.currentLobbyId);
console.log('Players:', ffa.players.size);

// Force start
ffa.startMatch()
```

### **Window 2 (PEER):**
```javascript
// Show lobby browser
showLobbyBrowser()

// Manually join (if needed)
joinFFAMatch('mock_lobby_123')

// Check status
console.log('Connected:', ffa.isHost ? 'HOST' : 'PEER');
console.log('Lobby:', ffa.network.currentLobbyId);

// Mark ready
ffa.setLocalPlayerReady(true)
```

### **Both Windows:**
```javascript
// Exit match
exitMultiplayer()

// Check game state
console.log('Phase:', ffa.gamePhase);
console.log('Players:', Array.from(ffa.players.values()).map(p => p.name));

// Debug
window.ffa  // Access game state
window.steam  // Access Steam networking
```

---

## 🎉 Example Session

### **Complete 2-Player Test:**

```
TIME    WINDOW 1 (HOST)              WINDOW 2 (PEER)
────────────────────────────────────────────────────────
0:00    Open localhost:5173          Open localhost:5173
0:05    Click "Online MP"            Click "Online MP"
0:10    Click "Create Match"         See lobby in list
0:15    Configure settings           Click "Join"
0:20    Click "Create"               —
0:25    Waiting room appears         Waiting room appears
0:30    See player list (1 player)   See player list (2 players)
0:35    —                            Click "I'm Ready"
0:40    See peer ready ✅            —
0:45    Click "I'm Ready"            —
0:50    Click "Start Match"          —
0:55    Match starts!                Match starts!
1:00    Playing...                   Playing...
1:30    Game ends                    Game ends
1:35    Press ESC                    Press ESC
1:40    Back to lobby                Back to lobby
```

**Total time:** ~2 minutes for complete test!

---

## 💡 Pro Tips

1. **Side-by-Side Windows:**
   - Makes testing much easier
   - Can see both players simultaneously
   - Easier to debug issues

2. **Use Different Browsers:**
   - More realistic test (different sessions)
   - Avoids any shared state issues
   - Chrome + Firefox works great

3. **Start Simple:**
   - Test 2 players first
   - Add more players gradually
   - Verify each feature works

4. **Check Console:**
   - Keep DevTools open
   - Watch for errors
   - Monitor network events

5. **Test Edge Cases:**
   - Host disconnects
   - Peer disconnects
   - Empty lobby
   - Full lobby (8 players)

---

## 🔥 Advanced Testing

### **Test Host Migration:**

1. Open 3 windows
2. Window 1 creates match (HOST)
3. Windows 2 & 3 join
4. Start match
5. Close Window 1 (host disconnects)
6. ✅ Window 2 becomes new host automatically!

### **Test Chat:**

1. Two windows in waiting room
2. Type message in Window 1
3. ✅ Appears in Window 2
4. Type message in Window 2
5. ✅ Appears in Window 1

### **Test Full Lobby:**

```javascript
// Window 1:
testMultiplayer(8)  // Create 8-player match

// Windows 2-8:
// Try to join → should work until 8 players
```

---

## 📚 Next Steps

After local testing works:

1. ✅ **Test on local network:**
   - Use actual IP address
   - Test with friend on same WiFi

2. ✅ **Test with real Steam:**
   - Switch from mock mode
   - Test with Steam friends
   - Use Spacewar AppID (480)

3. ✅ **Test with your own Steam AppID:**
   - Get your own AppID from Steam
   - Replace in config
   - Full production test

---

## ✅ Quick Checklist

Before considering multiplayer "done":

- [ ] 2-player match works locally
- [ ] 5-player match works locally
- [ ] Waiting room functions correctly
- [ ] Match starts smoothly
- [ ] Gameplay works in all windows
- [ ] Chat works between windows
- [ ] Garbage attacks work
- [ ] Kill feed displays
- [ ] Match end works
- [ ] Can create/join multiple times
- [ ] Host migration works
- [ ] ESC exits cleanly

---

**You're now ready to test multiplayer locally!** 🎮✨

**Start with 2 windows and work your way up to more players!**

Good luck testing! 🚀

