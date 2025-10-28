# 🎮 Quick 2-Player Test (Right Now!)

**Test multiplayer in 5 minutes with 2 browser windows!**

---

## 🚀 Step-by-Step Guide

### **Step 0: (Optional) Clear Old Lobbies** 🧹

If you've tested before and want a fresh start:
1. Open console (F12)
2. Run: `clearLobbies()`
3. ✅ All old lobbies removed!

---

### **Step 1: Open Window 1 (HOST)** 👑

1. **Open your browser**
2. Go to: `http://localhost:5173` ← **Use this URL exactly! No `/public/index.html`**
3. **Keep this window visible** (don't minimize!)

---

### **Step 2: Open Window 2 (PEER)** 👤

1. **Open a NEW browser window** (not a tab!)
   - Windows: Ctrl + N
   - Mac: Cmd + N
   - Or: Use a different browser (Firefox, Edge, etc.)

2. Go to: `http://localhost:5173`
3. **Arrange side-by-side:**
   ```
   ┌──────────────┬──────────────┐
   │  Window 1    │  Window 2    │
   │  (HOST)      │  (PEER)      │
   └──────────────┴──────────────┘
   ```

---

### **Step 3: Create Match (Window 1)** 🏗️

**In Window 1:**

1. Click **"Online MP"** button in main menu
2. Lobby browser appears
3. Click **"✨ Create New Match"** button
4. Fill in match settings:
   ```
   Game Name: My Test Match
   Max Players: 8
   Win Condition: First to 10 frags
   Lobby Type: Public
   Boring Rules: OFF
   ```
5. Click **"Create Match"** button

**✅ You should see:**
- Waiting room appears
- Match info displayed
- Player list shows "Dev_XXX (YOU - HOST)"
- "I'm Ready" button
- "Start Match" button

---

### **Step 4: Join Match (Window 2)** 🚪

**In Window 2:**

1. Click **"Online MP"** button in main menu
2. Lobby browser appears
3. **Look for your match in the list:**
   ```
   🎮 My Test Match
   Players: 1/8
   Win: First to 10 frags
   [Join] button ← Click this!
   ```
4. Click **"Join"** button

**✅ You should see:**
- Waiting room appears in Window 2
- Player list shows 2 players now
- Both windows show the same lobby!

---

### **Step 5: Get Ready** ✅

**In Window 2 (PEER):**
- Click **"✅ I'm Ready"** button
- Your status changes to ✅ Ready

**In Window 1 (HOST):**
- You'll see Window 2's player show as ✅ Ready
- Click **"✅ I'm Ready"** button (optional for host)

---

### **Step 6: Start Match** 🚀

**In Window 1 (HOST):**
- Click **"🚀 Start Match"** button

**What happens:**
- ✅ Both windows start the match
- ✅ Waiting room hides
- ✅ Game boards appear
- ✅ Tetrominos start falling
- ✅ You can play in both windows!

---

## 🎮 Play the Game!

**Window 1 (HOST):**
- Use **Arrow Keys** to play
- Your board is in the center
- See Window 2's board on the left

**Window 2 (PEER):**
- Use **Arrow Keys** to play
- Your board is in the center
- See Window 1's board on the left

**Try sending garbage attacks!**
- Clear lines → Sends garbage to opponent
- Watch opponent's board get garbage!

---

## 🎯 What to Test

### **In Waiting Room:**
- [ ] Both windows show the same player list
- [ ] Player count updates when peer joins
- [ ] Ready button works
- [ ] Chat works (type message in one, appears in both)

### **During Match:**
- [ ] Both windows show game boards
- [ ] Tetrominos fall and are playable
- [ ] Controls work in both windows
- [ ] Garbage attacks work
- [ ] Opponent boards update in real-time

### **Match End:**
- [ ] Winner is detected
- [ ] Can exit with ESC key
- [ ] Can start new match

---

## 💡 Quick Tips

### **Can't see the lobby?**

**Window 2:**
```javascript
// Open console (F12) and run:
showLobbyBrowser()
```

### **Need to rejoin?**

**Window 1 (check lobby ID):**
```javascript
// Open console (F12):
console.log('Lobby ID:', steam.currentLobbyId);
// Copy the ID (e.g., "mock_lobby_123")
```

**Window 2 (rejoin):**
```javascript
// Open console (F12):
joinFFAMatch('mock_lobby_123')  // Paste the actual ID
```

### **Want to test with bots?**

**Window 1 (HOST):**
```javascript
// Open console (F12):
testMultiplayer(5)  // Creates match with 5 players (you + 4 bots)
// Click "Start Match" button
```

**Window 2 (PEER):**
- Just join normally via lobby browser
- You'll join a match that already has bots!

---

## 🐛 Troubleshooting

### **Issue: Blank screen after joining**

**Fix:** Hard refresh both windows
- Windows: Ctrl + Shift + R
- Mac: Cmd + Shift + R

### **Issue: Can't click buttons**

**Fix:** Make sure you clicked "Online MP" first, not "Local 2P"

### **Issue: Only see background**

**Fix:** Check console (F12) for errors
```javascript
// Check if multiplayer UI exists:
console.log('Lobby browser:', document.querySelector('.lobby-browser-modal'));
console.log('Waiting room:', document.querySelector('.lobby-waiting-room'));
```

---

## 🎉 Success Checklist

### **✅ You've successfully tested multiplayer when:**

1. ✅ Window 1 created a match
2. ✅ Window 2 joined the match
3. ✅ Both windows showed waiting room
4. ✅ Player list updated in both windows
5. ✅ Match started in both windows
6. ✅ Both players could play simultaneously
7. ✅ Garbage attacks worked
8. ✅ Opponent boards updated in real-time

---

## 🚀 Next: Test with More Players!

Once 2-player works, try 3-5 players:

**Method 1: More windows**
```
Window 1: Host (Chrome)
Window 2: Join (Firefox)
Window 3: Join (Edge)
```

**Method 2: Quick bot test**
```javascript
// Window 1:
testMultiplayer(5)  // You + 4 bots

// Windows 2-5:
// Join manually via lobby browser
```

---

## 📋 Visual Flow

```
WINDOW 1 (HOST)                 WINDOW 2 (PEER)
─────────────────               ─────────────────
Open localhost:5173             Open localhost:5173
     ↓                               ↓
Click "Online MP"               Click "Online MP"
     ↓                               ↓
Create Match                    See lobby in browser
     ↓                               ↓
Waiting Room                    Click "Join"
     ↓                               ↓
See 1 player                    Waiting Room
     ↓                               ↓
See 2 players ←─────────────────── Join successful
     ↓                               ↓
Peer ready ✅  ←─────────────────── Click "I'm Ready"
     ↓                               ↓
Click "Start Match" ─────────────→ Match starts
     ↓                               ↓
PLAYING! 🎮                     PLAYING! 🎮
```

---

**That's it! You're now testing multiplayer!** 🎉

**Start with 2 windows and see if it works!**

Open `LOCAL_MULTIPLAYER_TESTING_GUIDE.md` for more advanced testing scenarios! 📚

