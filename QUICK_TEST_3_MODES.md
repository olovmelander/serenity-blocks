# 🧪 Quick Test: 3-Way Mode Selection

**Date:** October 17, 2025

---

## 🚀 What to Test

You should now see **3 clear buttons** in the main menu:
1. **Single Player**
2. **Local 2P**
3. **Online MP**

---

## ✅ Test Steps

### **1. Refresh Browser**
- **Ctrl + Shift + R** (Windows/Linux)
- **Cmd + Shift + R** (Mac)

### **2. Check Main Menu**

You should see:
```
┌──────────────────────────────────┐
│      SERENITY BLOCKS             │
│                                  │
│  [Single Player] [Local 2P] [Online MP] │
│                                  │
│  Press any key or tap to start   │
└──────────────────────────────────┘
```

---

## 🧪 Test Each Mode

### **TEST 1: Single Player** ✅

1. Click **"Single Player"** button
2. Press **SPACEBAR**
3. **Expected:**
   - ✅ Single-player game starts
   - ✅ One board visible
   - ✅ No multiplayer UI

### **TEST 2: Local 2P** ✅

1. Click **"Local 2P"** button
2. Press **SPACEBAR**
3. **Expected:**
   - ✅ Local 2-player game starts
   - ✅ Two boards visible side-by-side
   - ✅ "PLAYER 1" and "PLAYER 2" labels
   - ✅ No lobby browser
   - ✅ No online multiplayer

### **TEST 3: Online MP** ✅

1. Click **"Online MP"** button
2. **Expected (WITHOUT pressing SPACEBAR):**
   - ✅ Lobby browser appears automatically
   - ✅ Can see "Create New Match" button
   - ✅ Can see available lobbies
   - ✅ **NO game starts**
   - ✅ **NO local multiplayer in background**

3. Press **SPACEBAR**
   - ✅ **Nothing happens** (correct behavior!)
   - Console should show: `💡 Select "Online Multiplayer" to access lobby browser`

4. Test online match:
   ```javascript
   testMultiplayer(5)  // In console
   ```
   - ✅ Waiting room appears
   - ✅ Start match → Online game works
   - ✅ No local UI in background

---

## ⚙️ Test Settings Menu

### **1. Open Settings**
- Click ⚙️ button

### **2. Go to General Tab**

### **3. Check Game Mode Dropdown**

Should show **3 options:**
```
┌──────────────────────────────────┐
│ Game Mode: [▼ Single Player   ] │
│            ├─ Single Player      │
│            ├─ Local Multiplayer (2P)
│            └─ Online Multiplayer (FFA)
└──────────────────────────────────┘
```

### **4. Test Each Option**

**Select "Local Multiplayer (2P)":**
- Close settings
- Press SPACEBAR
- ✅ Local 2-player game should start

**Select "Online Multiplayer (FFA)":**
- Close settings
- ✅ Lobby browser should appear
- No game starts automatically

---

## ❌ What You Should NOT See

### **When "Online MP" is selected:**
- ❌ Local multiplayer UI in background
- ❌ "PLAYER 1" / "PLAYER 2" labels
- ❌ Two-board Phaser layout
- ❌ Local multiplayer starting on SPACEBAR
- ❌ Any game starting automatically

### **When "Local 2P" is selected:**
- ❌ Lobby browser appearing
- ❌ Online multiplayer UI
- ❌ FFA HUD
- ❌ Waiting room

---

## 🔍 Console Verification

### **After clicking "Online MP":**
```
🎮 Multiplayer mode selected
✅ Lobby browser shown
```

### **After pressing SPACEBAR with "Online MP":**
```
💡 Select "Online Multiplayer" to access lobby browser
```

### **After clicking "Local 2P" and pressing SPACEBAR:**
```
🎮 Starting LOCAL 2-player multiplayer...
[Multiplayer] Starting multiplayer game...
```

---

## 🎯 Success Checklist

Main Menu:
- [ ] 3 buttons visible: Single Player, Local 2P, Online MP
- [ ] Buttons look distinct and clickable
- [ ] Active button is highlighted

Single Player:
- [ ] Clicking button selects it
- [ ] SPACEBAR starts single-player game
- [ ] No multiplayer UI visible

Local 2P:
- [ ] Clicking button selects it
- [ ] SPACEBAR starts local 2-player game
- [ ] Two boards visible
- [ ] No online UI visible

Online MP:
- [ ] Clicking button selects it
- [ ] Lobby browser appears automatically
- [ ] No game starts on SPACEBAR
- [ ] No local multiplayer in background
- [ ] Can create/join lobbies normally

Settings:
- [ ] Game Mode dropdown has 3 options
- [ ] Selecting each option works
- [ ] Settings persist after closing menu

---

## 🐛 If Something's Wrong

### **Issue: Still see 2 buttons**
**Fix:** Hard refresh (Ctrl+Shift+R)

### **Issue: Local multiplayer starts with online**
**Fix:** 
1. Hard refresh
2. Check console for error messages
3. Make sure you clicked "Online MP" not "Local 2P"

### **Issue: Lobby browser doesn't appear**
**Fix:**
1. Check console for Steam initialization errors
2. Make sure "Online MP" button was clicked
3. Try `window.showLobbyBrowser()` in console

---

## 💡 Quick Commands

```javascript
// Show lobby browser manually
showLobbyBrowser()

// Test online multiplayer
testMultiplayer(5)

// Check current mode
console.log('Current mode:', window.serenityBlocks.gameModeUI.getMode())

// Expected values:
// - 'single' (Single Player)
// - 'local-multiplayer' (Local 2P)
// - 'online-multiplayer' (Online MP)
```

---

## 🎉 Success Criteria

### **✅ You've verified the fix when:**

1. ✅ Main menu shows 3 distinct buttons
2. ✅ Single Player works as expected
3. ✅ Local 2P starts local multiplayer (no online UI)
4. ✅ Online MP shows lobby browser (no local UI)
5. ✅ SPACEBAR does nothing in Online MP mode
6. ✅ Settings menu has all 3 options
7. ✅ No background systems conflicting
8. ✅ Each mode is cleanly separated

---

**If all checks pass, the 3-way selection is working perfectly!** 🎮✨

**The three modes are now completely separated and intuitive!**

