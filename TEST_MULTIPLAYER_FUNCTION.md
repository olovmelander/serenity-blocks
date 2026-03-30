# 🧪 Test Multiplayer Function

## Quick Testing Tool for Online Multiplayer

A console function to quickly create a test lobby with dummy players for development and testing.

---

## Usage

Open the browser console and run:

```javascript
testMultiplayer(5)
```

This will:
1. ✅ Switch to online multiplayer mode
2. ✅ Create a new lobby named "TEST LOBBY"
3. ✅ Add you as the host
4. ✅ Add 4 dummy players (total 5 players)
5. ✅ Auto-ready all dummy players
6. ✅ Show the waiting room with all players

---

## Function Signature

```javascript
window.testMultiplayer(numPlayers = 4)
```

### Parameters

- **`numPlayers`** (optional, default: 4)
  - Number of total players in the lobby (including you)
  - Min: 2, Max: 8
  - Automatically clamped to valid range

### Returns

Promise that resolves to an object with:
```javascript
{
  lobbyId: string,
  players: Array<{
    name: string,
    steamId: string,
    isReady: boolean,
    color: string
  }>
}
```

---

## Examples

### 2 Players (You + 1 Bot)
```javascript
testMultiplayer(2)
```

### 4 Players (Default)
```javascript
testMultiplayer()
// or
testMultiplayer(4)
```

### 8 Players (Maximum)
```javascript
testMultiplayer(8)
```

---

## What You'll See

### Console Output
```
🧪 [TEST] Creating test lobby with 5 players...
🧪 [TEST] Switching to online multiplayer mode...
🧪 [TEST] Creating test lobby...
🧪 [TEST] Adding dummy players...
✅ [TEST] Test lobby created with 5 players!
📋 [TEST] All dummy players are auto-ready
🎮 [TEST] You can now click "Start Match" to begin
```

### Dummy Player Names
The function adds players with these names:
1. **TestBot_Alpha**
2. **TestBot_Beta**
3. **TestBot_Gamma**
4. **TestBot_Delta**
5. **TestBot_Epsilon**
6. **TestBot_Zeta**
7. **TestBot_Eta**

### Waiting Room
You'll see a beautiful waiting room with:
- All players listed with their colors
- All dummy players marked as "Ready" (green)
- You as the host with crown icon (👑)
- "Start Match" button ready to click

---

## Test Lobby Configuration

The test lobby is created with these settings:

```javascript
{
  gameName: 'TEST LOBBY',
  maxPlayers: numPlayers,
  lobbyType: 'public',
  endCondition: 'frags',
  endConditionValue: 10,
  boringRules: false
}
```

**Win Condition:** First to 10 frags (kills)

---

## Features

### Auto-Ready
- ✅ All dummy players are automatically set to "Ready"
- ✅ You can immediately click "Start Match"
- ✅ No need to wait for bots to ready up

### Real Players
- ✅ Each dummy player has a unique Steam ID
- ✅ Each player gets a unique color from the color pool
- ✅ Players appear in the waiting room with their colors
- ✅ Ready indicators show green and pulse

### Beautiful UI
- ✅ See all player colors in action
- ✅ Test the ready state animations
- ✅ Verify the waiting room layout
- ✅ Check responsive design with different player counts

---

## Use Cases

### 1. **UI Testing**
Test the waiting room with different player counts:
```javascript
testMultiplayer(2)  // Minimal
testMultiplayer(4)  // Common
testMultiplayer(8)  // Maximum
```

### 2. **Color Testing**
Verify all 8 player colors are correctly assigned:
```javascript
testMultiplayer(8)
```

### 3. **Quick Match Start**
Instantly start a match with bots:
```javascript
await testMultiplayer(4)
// Click "Start Match" button
```

### 4. **Animation Testing**
Test ready state animations and transitions:
```javascript
testMultiplayer(5)
// Watch the pulsing ready indicators
// See player color glows
```

---

## Technical Details

### What It Does Internally

1. **Mode Switching**
   ```javascript
   - Stops current mode
   - Deactivates current mode  
   - Activates online multiplayer mode
   - Waits 500ms for initialization
   ```

2. **Lobby Creation**
   ```javascript
   - Calls handleCreateLobby() with config
   - Creates FFA game state
   - Sets match configuration
   - Shows waiting room
   ```

3. **Player Addition**
   ```javascript
   - Generates unique dummy IDs
   - Adds players via addPlayer()
   - Assigns colors automatically
   - Sets isReady = true
   - Triggers UI updates
   ```

### Player IDs Format
```
dummy_1_1729896543210
dummy_2_1729896543210
dummy_3_1729896543210
...
```

---

## Limitations

### Dummy Players Can't Play
- ⚠️ Dummy players are not AI bots
- ⚠️ They won't make moves or play the game
- ⚠️ They're just for UI/lobby testing
- ℹ️ When match starts, only you will be playing

### Mock Mode Only
- ℹ️ Works in browser mock mode
- ℹ️ No actual Steam P2P connection
- ℹ️ Perfect for local development

---

## After Starting Match

When you click "Start Match":
- ✅ Game countdown appears
- ✅ Match starts with all players
- ℹ️ Only your board will be active
- ℹ️ Dummy players' boards will remain empty

This is expected behavior for UI testing!

---

## Troubleshooting

### Function Not Found
If you see `testMultiplayer is not defined`:
- Refresh the page
- Check console for initialization message
- Look for: `🧪 Test functions available:`

### Mode Switch Error
If mode doesn't switch:
- Check if already in a match
- Exit current mode first
- Try again

### No Waiting Room
If waiting room doesn't appear:
- Check console for errors
- Verify mode initialized properly
- Try refreshing and running again

---

## Console Tips

### View Current Lobby
```javascript
const result = await testMultiplayer(5)
console.table(result.players)
```

### Quick 8-Player Test
```javascript
testMultiplayer(8)
// Perfect for testing max players
```

### Repeat Test
```javascript
// Close waiting room first
// Then run again:
testMultiplayer(4)
```

---

## Developer Notes

### Location
Function is defined in: `src/main.js` (lines 2172-2256)

### Exposed At
`window.testMultiplayer`

### Dependencies
- GameModeManager
- OnlineMultiplayerMode
- FFAGameStateP2P
- SteamNetworking (mock mode)

---

**Perfect for:**
- 🎨 UI/UX testing
- 🎮 Lobby feature development
- 🎯 Color assignment verification
- ✨ Animation testing
- 📱 Responsive design checks

**Happy Testing!** 🧪✨

