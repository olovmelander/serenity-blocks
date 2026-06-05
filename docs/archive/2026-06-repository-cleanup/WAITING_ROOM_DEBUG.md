# 🐛 Waiting Room Debug Guide

## What I Fixed

I've added extensive logging to track exactly what's happening when you create a match. This will help us figure out why the waiting room isn't appearing.

## New Console Output

When you create a match, you should now see:

```
🎮 Creating FFA match with config: {...}
🧪 Mock lobby created: mock_lobby_...
✅ Player added: Dev_XXX (mock_XXX) [LOCAL]

🔧 Setting up waiting room...
   Waiting room exists: true/false
   FFA game state exists: true
   ✅ Game state set in waiting room
   📋 Showing waiting room...
   ✅ Waiting room visible
   ✅ Lobby browser hidden

✅ FFA Match created!
   Lobby ID: mock_lobby_...
   You are HOST
   Waiting for players...
   Access via: window.ffa
```

---

## 🧪 Test Steps

### 1. Refresh the page
Make sure the new code is loaded.

### 2. Click MULTIPLAYER button
The lobby browser should appear.

### 3. Click "Create New Match"
The config modal should appear.

### 4. Fill out and create
Watch the console output carefully!

---

## 🔍 What to Look For

### ✅ GOOD: If you see all these logs
```
🔧 Setting up waiting room...
   Waiting room exists: true
   FFA game state exists: true
   ✅ Game state set in waiting room
   📋 Showing waiting room...
   ✅ Waiting room visible
```
**Then the waiting room IS being shown!** If you still don't see it visually:
- Check if it's hidden behind something (press F12 → Elements tab)
- Look for a `#lobby-waiting-room` element
- Check if it has class `hidden`

### ❌ BAD: If you see this
```
   Waiting room exists: false
   ❌ Waiting room not initialized!
```
**Then the waiting room wasn't created!** This means `initializeMultiplayerUI()` didn't run or failed.

### ⚠️ WARNING: If you see this
```
⚠️ updateUI called but no gameState
```
**Then the gameState wasn't set properly** before show() was called.

### 🔴 ERROR: If you see this
```
❌ Error updating waiting room UI: [error details]
```
**Then there's an error in the UI update** - copy the full error message!

---

## 🛠️ Manual Tests

If automatic show doesn't work, try these in console:

### Test 1: Check if waiting room exists
```javascript
console.log('Waiting room:', window.app.lobbyWaitingRoom)
console.log('Container:', window.app.lobbyWaitingRoom?.container)
```

### Test 2: Check if element is in DOM
```javascript
const el = document.getElementById('lobby-waiting-room')
console.log('Element:', el)
console.log('Has hidden class:', el?.classList.contains('hidden'))
```

### Test 3: Manually show it
```javascript
if (window.ffa && window.app.lobbyWaitingRoom) {
  window.app.lobbyWaitingRoom.gameState = window.ffa
  window.app.lobbyWaitingRoom.show()
}
```

### Test 4: Check visibility
```javascript
const el = document.getElementById('lobby-waiting-room')
const styles = getComputedStyle(el)
console.log('Display:', styles.display)
console.log('Visibility:', styles.visibility)
console.log('Opacity:', styles.opacity)
console.log('Z-index:', styles.zIndex)
```

---

## 📸 What to Report

Please run the test and share:

1. **Full console output** when creating a match (copy/paste)
2. **Does the waiting room element exist?** (result of Test 2)
3. **Does manual show work?** (result of Test 3)
4. **Any red error messages?** (screenshot or copy/paste)

---

## Expected Flow

1. ✅ Click MULTIPLAYER → Lobby Browser shows
2. ✅ Click Create → Config Modal shows
3. ✅ Submit form → Modal closes
4. ✅ Match creates → Lobby Browser hides
5. ✅ **Waiting Room shows** ← This is where it's failing for you
6. ✅ Click Ready → Button changes
7. ✅ Click Start → Match begins, canvas layout shows

We need to figure out which step is failing!

