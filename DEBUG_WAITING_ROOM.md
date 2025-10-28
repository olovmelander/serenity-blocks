# Debug: Waiting Room Not Appearing

## Quick Checks

Open the browser console (F12) and run these commands:

### 1. Check if waiting room exists
```javascript
console.log('Waiting Room exists:', !!window.app.lobbyWaitingRoom)
console.log('Waiting Room:', window.app.lobbyWaitingRoom)
```

### 2. Check if it's hidden
```javascript
const waitingRoom = document.getElementById('lobby-waiting-room')
console.log('Waiting Room element:', waitingRoom)
console.log('Has hidden class:', waitingRoom?.classList.contains('hidden'))
```

### 3. Manually show it
```javascript
// After creating a match:
window.app.lobbyWaitingRoom.gameState = window.ffa
window.app.lobbyWaitingRoom.show()
```

### 4. Check console for errors
Look for any red error messages in the console when you create a match.

---

## Common Issues

### Issue 1: Waiting room not initialized
**Check:**
```javascript
window.app.lobbyWaitingRoom
```

If `undefined` or `null`, the waiting room wasn't created.

**Fix:** Make sure `initializeMultiplayerUI()` was called.

---

### Issue 2: Element not in DOM
**Check:**
```javascript
document.getElementById('lobby-waiting-room')
```

If `null`, the HTML wasn't added to the page.

**Fix:** The `createUI()` method should have added it.

---

### Issue 3: CSS not loaded
**Check:**
```javascript
const styles = getComputedStyle(document.getElementById('lobby-waiting-room'))
console.log('Display:', styles.display)
console.log('Visibility:', styles.visibility)
```

If display is 'none' even after show(), CSS might be overriding it.

---

## Manual Test

```javascript
// 1. Create match
createFFAMatch({ gameName: 'Test', maxPlayers: 4 })

// 2. Check if ffa exists
console.log('FFA:', window.ffa)

// 3. Check waiting room state
console.log('Waiting room gameState:', window.app.lobbyWaitingRoom?.gameState)

// 4. Manually trigger show
window.app.lobbyWaitingRoom.gameState = window.ffa
window.app.lobbyWaitingRoom.show()

// 5. Check if visible
const el = document.getElementById('lobby-waiting-room')
console.log('Hidden class:', el.classList.contains('hidden'))
```

---

## Expected Console Output

When creating a match, you should see:
```
🎮 Creating FFA match with config: {...}
🧪 Mock lobby created: mock_lobby_...
✅ Player added: Dev_XXX (mock_XXX) [LOCAL]
✅ FFA Match created!
   Lobby ID: mock_lobby_...
   You are HOST
   Waiting for players...
   Access via: window.ffa
```

If you see this but no waiting room, the issue is in the `show()` method or CSS.

---

## What to Report

Please check and report:
1. Does `window.app.lobbyWaitingRoom` exist? (yes/no)
2. Does `document.getElementById('lobby-waiting-room')` exist? (yes/no)
3. What does `window.app.lobbyWaitingRoom.gameState` return after creating match?
4. Any console errors? (copy/paste them)
5. Does manually calling `window.app.lobbyWaitingRoom.show()` work?

