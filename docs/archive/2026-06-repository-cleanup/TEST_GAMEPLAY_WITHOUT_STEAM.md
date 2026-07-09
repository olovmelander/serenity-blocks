# 🎮 Test Gameplay Without Steam!

**Test all game logic locally before connecting to real Steam**

---

## 🎯 What You Can Test Now

With the new mock P2P system, you can test **everything** locally:

✅ **Garbage attacks** between players  
✅ **Frag counting** (kills/eliminations)  
✅ **Kill feed** display  
✅ **2x2 opponent grid** layout  
✅ **Waiting room** and host controls  
✅ **Match start** and countdown  
✅ **Real-time gameplay** between 2+ windows  
✅ **Win conditions** (frags, time, points, lines)  
✅ **Chat** between players  
✅ **All UI elements** and animations  

**NO STEAM REQUIRED!** 🎉

---

## 🚀 How It Works

### **Mock P2P Communication:**

- Uses `BroadcastChannel` API (built into browsers)
- Messages sent in one window appear in all other windows
- Simulates real Steam P2P, but 100% local
- Perfect for testing game logic!

```
Window 1 (HOST)              Window 2 (PEER)
─────────────────            ─────────────────
Send garbage attack     ←────→  Receive attack
    ↓                            ↓
BroadcastChannel ────────────→ BroadcastChannel
    ↓                            ↓
Opponent board updates    ←─────→ Your board gets garbage
```

---

## 🧪 Complete Test Flow

### **Step 1: Clear Old Data**

Open console (F12) and run:
```javascript
clearLobbies()  // Clear old lobbies
```

### **Step 2: Window 1 (HOST) - Create Match**

1. Open `http://localhost:5173/`
2. Click "Online MP"
3. Click "Create New Match"
4. Configure:
   ```
   Game Name: Gameplay Test
   Max Players: 8
   Win Condition: First to 5 frags
   ```
5. Click "Create Match"
6. **Check console:**
   ```
   🧪 Mock lobby created: mock_lobby_123
      📢 Lobby is now visible to all browser windows!
      📡 Mock P2P communication enabled!
   ```

### **Step 3: Window 2 (PEER) - Join Match**

1. Open **NEW WINDOW**: `http://localhost:5173/`
2. Click "Online MP"
3. See "Gameplay Test" in lobby list
4. Click "Join"
5. **Check console:**
   ```
   🧪 Mock joined lobby: mock_lobby_123
      📡 Mock P2P communication enabled!
   ```

### **Step 4: Waiting Room**

**Both windows should now show:**
- ✅ Waiting room with player list
- ✅ 2 players visible
- ✅ Match info (5 frags to win)
- ✅ Chat interface

**Window 2:**
- Click "✅ I'm Ready"

**Window 1:**
- Click "✅ I'm Ready" (optional for host)
- Click "🚀 Start Match"

### **Step 5: PLAY!**

**Both windows start the game!**

You should see:
- ✅ Your board in the center (large)
- ✅ Opponent's board on the left (smaller)
- ✅ Real-time piece movement
- ✅ **Garbage attacks work between windows!**
- ✅ Kill feed when someone dies
- ✅ Frag counter updates

---

## 🎮 What to Test

### **1. Garbage Attacks** 💥

**Window 1:**
- Clear 2 lines → Sends 1 garbage line to Window 2

**Window 2:**
- Watch your board → Garbage line appears at bottom!
- Clear 3 lines → Sends 2 garbage lines to Window 1

**Verify:**
- ✅ Garbage appears in opponent's board
- ✅ Happens in real-time
- ✅ No lag or delay

### **2. Frags/Kills** 💀

**Window 1:**
- Play until you top out (game over)

**Window 2:**
- Watch kill feed → "You eliminated Dev_XXX" appears
- Check frag counter → Shows 1 frag

**Verify:**
- ✅ Kill feed displays
- ✅ Frag counter updates
- ✅ Winner is detected when reaching 5 frags

### **3. Layout** 📱

**Check both windows:**
- ✅ Your board is large and centered
- ✅ Opponent's board is visible on left
- ✅ No scrolling needed
- ✅ All UI elements visible (HUD, chat)

### **4. Real-Time Updates** ⚡

**Window 1:**
- Move piece left/right
- Rotate piece
- Drop piece

**Window 2:**
- Watch opponent's board on left
- ✅ Should see their pieces move in real-time!

### **5. Chat** 💬

**Window 1:**
- Type message in chat: "Testing!"
- Press Enter

**Window 2:**
- ✅ Message appears in your chat!

**Verify:**
- ✅ Messages appear in both windows
- ✅ No delay
- ✅ Sender name shows correctly

### **6. Win Conditions** 🏆

**Test "First to 5 frags":**
- Play until one player gets 5 kills
- ✅ Match should end
- ✅ Winner is announced
- ✅ Both windows show results

---

## 🔍 Debug Commands

### **Check P2P Status:**

```javascript
// Is P2P working?
console.log('Broadcast channel:', steam.broadcastChannel);
console.log('Is connected:', !!steam.broadcastChannel);

// Check lobby
console.log('Current lobby:', steam.currentLobbyId);
console.log('Is host:', steam.isHost);
console.log('Player ID:', steam.steamId);
```

### **Test Message Sending:**

```javascript
// Manually send a test message (Window 1):
steam.broadcastToAll('test:message', { text: 'Hello from console!' });

// Check if Window 2 receives it (set up listener first):
steam.on('test:message', (msg) => {
  console.log('Received test message:', msg.data);
});
```

### **Check Game State:**

```javascript
// FFA game state
console.log('Players:', ffa.players.size);
console.log('Game phase:', ffa.gamePhase);
console.log('My frags:', ffa.fragTracker.getFrags(ffa.localPlayerId));

// Check all players
ffa.players.forEach((player, id) => {
  console.log(`${player.name}: ${player.frags} frags, alive: ${player.isAlive}`);
});
```

---

## 🐛 Troubleshooting

### **Issue: No garbage attacks work**

**Check console for:**
```
🧪 Mock sent to [steamId]: garbage:attack
🧪 Mock received from [steamId]: garbage:attack
```

**If you don't see these:**
1. Hard refresh both windows (Ctrl+Shift+R)
2. Make sure both joined the SAME lobby
3. Check `steam.broadcastChannel` is not null

**Fix:**
```javascript
// Window 1 & 2: Check if channel exists
console.log('Has channel:', !!steam.broadcastChannel);

// If null, rejoin lobby:
clearLobbies()  // Clear
// Then create/join again
```

### **Issue: Messages not received**

**Check if BroadcastChannel is supported:**
```javascript
console.log('BroadcastChannel supported:', typeof BroadcastChannel !== 'undefined');
```

**If not supported:**
- Use a modern browser (Chrome, Firefox, Edge)
- BroadcastChannel is supported in all modern browsers

**If supported but not working:**
```javascript
// Check if both windows are on same lobby channel
// Window 1:
console.log('Channel name:', steam.broadcastChannel?.name);

// Window 2:
console.log('Channel name:', steam.broadcastChannel?.name);

// Should both show: "serenity-lobby-mock_lobby_XXX"
```

### **Issue: Opponent board doesn't update**

**Verify state sync:**
```javascript
// Host should broadcast state every ~33ms
console.log('Is host:', ffa.isHost);

// If host, check sync is running:
console.log('Sync interval:', ffa.stateSyncInterval);
```

**Enable debug mode:**
```javascript
// In steam-networking config:
// Set debugMode: true to see all messages
```

---

## 💡 Pro Tips

### **1. Arrange Windows Side-by-Side**

```
┌────────────────────┬────────────────────┐
│   Window 1 (HOST)  │   Window 2 (PEER)  │
│                    │                    │
│   You play here    │   You play here    │
│   See opponent →   │   ← See opponent   │
│                    │                    │
└────────────────────┴────────────────────┘
```

### **2. Use DevTools in Both Windows**

- Keep console open (F12)
- Watch for debug messages
- See mock P2P communication in real-time

### **3. Test with 3-5 Players**

**Window 1:**
```javascript
testMultiplayer(5)  // Create match with 4 bots
```

**Windows 2-3:**
- Join normally
- Test with more opponents!

### **4. Focus on Specific Features**

**Test garbage only:**
1. Clear lines quickly
2. Watch opponent get garbage
3. Verify timing and amount

**Test frags only:**
1. Intentionally lose (top out)
2. Check kill feed
3. Verify frag counter

**Test UI only:**
1. Don't worry about gameplay
2. Just check layout
3. Verify all elements visible

---

## 🎯 Test Checklist

Before moving to real Steam:

### **Lobby System:**
- [ ] Can create lobby in Window 1
- [ ] Can join lobby in Window 2
- [ ] Both windows show waiting room
- [ ] Player count updates correctly

### **Game Start:**
- [ ] Ready button works
- [ ] Host can start match
- [ ] Both windows start simultaneously
- [ ] Countdown appears

### **Gameplay:**
- [ ] Pieces fall and are controllable
- [ ] Can clear lines
- [ ] Garbage attacks work between windows
- [ ] Opponent boards update in real-time
- [ ] Kill feed displays eliminations
- [ ] Frag counter increments

### **UI/Layout:**
- [ ] Your board is large and centered
- [ ] Opponent boards visible in 2x2 grid
- [ ] No scrolling needed
- [ ] HUD shows match info
- [ ] Chat is functional

### **Win Conditions:**
- [ ] Match ends when win condition met
- [ ] Winner is announced
- [ ] Both windows show results
- [ ] Can exit cleanly (ESC)

### **Performance:**
- [ ] No lag between windows
- [ ] Smooth piece movement
- [ ] Real-time updates
- [ ] No console errors

---

## 🚀 Next Steps

### **After Local Testing Works:**

1. **✅ Everything works locally?**
   - Great! Your game logic is solid!

2. **Switch to real Steam:**
   - Install Steam
   - Run Steam client
   - Test with Spacewar AppID (480)
   - Test with friend on same network

3. **Test over internet:**
   - Test with friend online
   - Verify NAT traversal works
   - Check for lag/latency

4. **Get your own Steam AppID:**
   - Submit to Steam
   - Get your AppID
   - Replace in config
   - Final production test

---

## 📊 What Gets Tested

| Feature | Local Test | Real Steam |
|---------|------------|------------|
| **Lobby creation** | ✅ Yes | ✅ Yes |
| **Player joining** | ✅ Yes | ✅ Yes |
| **P2P messages** | ✅ Simulated | ✅ Real |
| **Garbage attacks** | ✅ Yes | ✅ Yes |
| **Frag counting** | ✅ Yes | ✅ Yes |
| **Game logic** | ✅ Yes | ✅ Yes |
| **UI/Layout** | ✅ Yes | ✅ Yes |
| **Real internet** | ❌ No | ✅ Yes |
| **NAT traversal** | ❌ No | ✅ Yes |
| **Relay servers** | ❌ No | ✅ Yes |

**Local testing covers 90% of development!** 🎉

---

## 🎉 Summary

### **What You Can Do:**

✅ Test all game logic locally  
✅ No Steam required  
✅ Perfect for development  
✅ Fast iteration  
✅ Debug easily  

### **What You Can't Do:**

❌ Test over internet  
❌ Test NAT traversal  
❌ Test with real Steam friends (yet)  

### **When to Move to Real Steam:**

- ✅ Local gameplay works perfectly
- ✅ All features tested and verified
- ✅ UI polished and bug-free
- ✅ Ready for real multiplayer testing

---

**Start testing now! Everything works locally!** 🎮✨

**Follow the test flow above and verify all features!**

**Then move to real Steam when ready!** 🚀

