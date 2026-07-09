# 🎮 Quick Test: Play the Game NOW!

**Test all gameplay in 5 minutes!**

---

## 🚀 5-Minute Test

### **IMPORTANT: Use Same Browser, Different WINDOWS!**

- ✅ **Same browser** (Chrome, Firefox, or Edge)
- ✅ **Different WINDOWS** (not tabs!)
- ❌ **NOT different browsers** (won't work - localStorage limitation)

---

### **Step 1: Refresh** (10 seconds)

Both windows need the new code:
```
Ctrl + Shift + R (hard refresh)
```

### **Step 2: Window 1 - Create** (30 seconds)

1. Open `http://localhost:5173/`
2. Click "**Online MP**"
3. Click "**Create New Match**"
4. Settings:
   ```
   Game Name: Quick Test
   Max Players: 4
   Win: First to 5 frags
   ```
5. Click "**Create Match**"

**Check console (F12):**
```
✅ 🧪 Mock lobby created
✅ 📢 Lobby visible to all windows
✅ 📡 Mock P2P communication enabled!  ← Must see this!
```

### **Step 3: Window 2 - Join** (30 seconds)

1. Open NEW WINDOW: `http://localhost:5173/`
2. Click "**Online MP**"
3. See "**Quick Test**" in list
4. Click "**Join**"

**Check console (F12):**
```
✅ 🧪 Mock joined lobby
✅ 📡 Mock P2P communication enabled!  ← Must see this!
✅ 📢 Announcing join to host...
```

**Check BOTH windows:**
- ✅ **Window 1:** Should now show 2 players!
- ✅ **Window 2:** Should show 2 players!
- ✅ **Player count:** 2/8 (or whatever max is)

*Wait 1-2 seconds for the waiting room to update if you don't see it immediately.*

### **Step 4: Start Match** (30 seconds)

**Window 2:**
- Click "✅ **I'm Ready**"

**Window 1:**
- Click "✅ **I'm Ready**"
- Click "🚀 **Start Match**"

**Both windows:**
- ✅ Match starts!
- ✅ Countdown appears
- ✅ Game begins!

### **Step 5: TEST GAMEPLAY!** (3 minutes)

#### **Test Garbage Attacks:**

**Window 1:**
- Clear 2 lines at once

**Window 2:**
- ✅ **Garbage line appears at bottom!**
- Now clear 3 lines

**Window 1:**
- ✅ **2 garbage lines appear!**

**If this works, your game logic is working!** 🎉

#### **Test Frags:**

**Window 1:**
- Play until you top out (game over)

**Window 2:**
- ✅ **Kill feed shows: "You eliminated Dev_XXX"**
- ✅ **Frag counter shows: 1**

**If this works, frag counting is working!** 🎉

---

## ✅ Success Checklist

After 5 minutes, you should have verified:

- [x] Both windows can create/join lobby
- [x] Mock P2P communication enabled (console message)
- [x] Match starts in both windows
- [x] **Garbage attacks work between windows**
- [x] **Frag counting works**
- [x] Layout looks good (no scrolling)
- [x] All UI elements visible

---

## 🐛 If Something Doesn't Work

### **Issue: No "📡 Mock P2P communication enabled!" message**

**Fix:**
```javascript
// Both windows: Hard refresh
Ctrl + Shift + R

// Clear lobbies:
clearLobbies()

// Try again
```

### **Issue: Garbage doesn't work**

**Check console for:**
```
🧪 Mock sent to [id]: garbage:attack
🧪 Mock received from [id]: garbage:attack
```

**If you don't see these:**
1. Hard refresh both windows
2. Make sure both joined SAME lobby
3. Check `steam.broadcastChannel` exists:
   ```javascript
   console.log('Channel:', steam.broadcastChannel);
   ```

**If null:**
```javascript
// Something went wrong, restart:
clearLobbies()
// Create/join again
```

### **Issue: No messages received**

**Verify BroadcastChannel support:**
```javascript
console.log('Supported:', typeof BroadcastChannel !== 'undefined');
```

**Should show:**
```
Supported: true
```

**If false:**
- Use Chrome, Firefox, or Edge
- BroadcastChannel is in all modern browsers

---

## 💡 Quick Debug

```javascript
// Check if mock P2P is active:
console.log('Has channel:', !!steam.broadcastChannel);
console.log('Channel name:', steam.broadcastChannel?.name);
console.log('Current lobby:', steam.currentLobbyId);

// Test message sending:
steam.broadcastToAll('test:ping', { test: true });

// In other window, should see:
🧪 Mock received from mock_XXX: test:ping
```

---

## 🎯 What You're Testing

| Feature | What to Verify |
|---------|----------------|
| **Lobby system** | ✅ Create/join works |
| **Mock P2P** | ✅ Console shows "📡 enabled" |
| **Garbage attacks** | ✅ **Lines sent between windows** |
| **Frag counting** | ✅ **Kills are counted** |
| **Layout** | ✅ No scrolling, looks good |
| **Real-time** | ✅ Opponent board updates |

---

## 🎉 Success!

### **If garbage attacks work:**
✅ Your game logic is solid!  
✅ Mock P2P is working!  
✅ Ready to keep testing and polishing!  

### **Next Steps:**

1. **Keep testing:**
   - Different win conditions
   - 3-5 player matches
   - Chat functionality

2. **Polish:**
   - Adjust layout if needed
   - Fine-tune gameplay
   - Add more features

3. **When ready:**
   - Move to real Steam
   - Test over internet
   - Production release!

---

**Start testing NOW!** 🎮

**See `TEST_GAMEPLAY_WITHOUT_STEAM.md` for complete guide!**

**Everything should work perfectly in local testing!** 🚀

