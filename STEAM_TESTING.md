# Steam Integration Testing Guide

## ✅ What We Just Set Up

You now have **Steam P2P networking** integrated into Serenity Blocks! This enables:
- Free multiplayer (no server hosting costs)
- Steam lobbies & matchmaking
- P2P messaging for FFA gameplay
- Testing with Spacewar (AppID 480) before paying the $100 Steam fee

## 🧪 Test It Now (3 Ways)

### Option 1: Test with Real Steam (Recommended)

**Requirements:**
- Steam must be running on your computer

**Steps:**
1. Make sure Steam is running
2. Start Vite dev server (in one terminal):
   ```bash
   npm run dev
   ```

3. Start Electron (in another terminal):
   ```bash
   npm run dev:electron
   ```

4. **Look at the console!** You should see:
   ```
   🎮 Initializing Steam API...
   ✅ Steam initialized: YourName (your_steam_id)
   💡 Test Steam in console: window.testSteam()
   ```

5. Open DevTools (it opens automatically) and type:
   ```javascript
   testSteam()
   ```

**Expected output:**
```
🧪 Testing Steam Integration...
Step 1: Initializing Steam API...
✅ Steam initialized successfully!
   Player: YourName
   Steam ID: 76561198xxxxxxxxx
   Mock Mode: NO

Step 2: Creating test lobby...
✅ Lobby created successfully!
   Lobby ID: 109775241026662951
   You are HOST: true

🎉 Steam integration is working!
```

---

### Option 2: Test with Mock Mode (No Steam Required)

**Good for:** Local development when Steam isn't running

**Steps:**
1. Set mock mode:
   ```bash
   MOCK_STEAM=true npm run dev:electron
   ```

2. In DevTools console:
   ```javascript
   testSteam()
   ```

**Expected output:**
```
🧪 MOCK MODE: Steam multiplayer disabled for local testing
✅ Mock Steam initialized: Dev_123 (mock_abc123)
🧪 Mock lobby created: mock_lobby_1697472000000
```

---

### Option 3: Check Integration Status

In DevTools console, check:
```javascript
// Check if Steam is initialized
steam
// Should show: SteamNetworking { initialized: true, ... }

// Get your Steam info
steam.playerName  // Your Steam name
steam.steamId     // Your Steam ID
steam.mockMode    // true or false
```

---

## 🎯 What You Can Do Now

### Create a Lobby
```javascript
const lobbyId = await steam.createLobby({
  maxPlayers: 8,
  lobbyType: 'public',  // or 'friends'
  gameName: 'My FFA Match'
});
console.log('Lobby created:', lobbyId);
```

### Get Available Lobbies
```javascript
const lobbies = await steam.getLobbies();
console.log('Available lobbies:', lobbies);
```

### Join a Lobby
```javascript
await steam.joinLobby(lobbyId);
console.log('Joined lobby!');
```

### Send P2P Message
```javascript
steam.sendP2PMessage(targetSteamId, 'test:message', { hello: 'world' });
```

---

## 🐛 Troubleshooting

### "Steam is not running!"
**Solution:** Launch Steam client first, then run the Electron app.

### "Greenworks not available"
**Solution:** The app automatically falls back to mock mode. This is fine for development!

### "Failed to initialize Steam API"
**Options:**
1. Make sure `electron/steam_appid.txt` exists with "480" inside
2. Or use mock mode: `MOCK_STEAM=true npm run dev:electron`

### Testing with a Friend
1. Both of you need Steam running
2. Both run: `npm run dev:electron`
3. One creates lobby: `steam.createLobby()`
4. Other joins: `steam.joinLobby(lobbyId)`
5. You're now P2P connected! 🎉

---

## 📋 Next Steps (Phase 1 Complete!)

✅ **You've completed Step 1 of Phase 1!** You now have:
- Electron wrapper ✓
- Steam API integration ✓
- P2P messaging infrastructure ✓
- Testing with Spacewar (AppID 480) ✓

**What's next:**
- Phase 2: Build FFA game state with host-authority
- Phase 3: Implement attack routing & frag tracking
- Phase 4: Build lobby browser UI
- Phase 5: Testing & polish

**Want to continue?** Check out `docs/FFA_MULTIPLAYER_IMPLEMENTATION_PLAN.md` for the full roadmap!

---

## 💡 Pro Tips

1. **DevTools is your friend:** All console logs show Steam activity
2. **Use mock mode for rapid iteration:** No need to wait for Steam
3. **Test with Spacewar (480) first:** Free testing before paying $100
4. **Steam ID 480 = Spacewar:** Valve's free test app with full Steamworks API access

**You're now ready to build multiplayer! 🚀**

