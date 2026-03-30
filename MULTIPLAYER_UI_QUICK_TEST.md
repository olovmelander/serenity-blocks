# Multiplayer UI Quick Test

## 🎮 How to Access the Multiplayer UI

The multiplayer UI is now connected to the **MULTIPLAYER** button on the main menu!

---

## ✅ Step-by-Step Instructions

### 1. Start the Game

```bash
npm run dev
```

### 2. Open the Game

Navigate to: **http://localhost:5173**

### 3. Click the MULTIPLAYER Button

On the main menu screen, click the **"MULTIPLAYER"** button (the purple/blue one on the right).

### 4. You Should See...

**🎉 The Lobby Browser should appear!**

A beautiful modal will slide in showing:
- **Title:** "🎮 Multiplayer Lobbies"
- **Buttons:** "➕ Create New Match" and "🔄 Refresh"
- **Empty state:** "🔍 No lobbies found" (if no lobbies exist yet)
- **Close button (X)** in the top-right corner

---

## 🎨 What the Lobby Browser Looks Like

```
┌─────────────────────────────────────────────────┐
│  🎮 Multiplayer Lobbies                      ✕  │
├─────────────────────────────────────────────────┤
│  ➕ Create New Match    🔄 Refresh              │
├─────────────────────────────────────────────────┤
│                                                  │
│              🔍 No lobbies found                 │
│       Create a new match to get started!        │
│                                                  │
└─────────────────────────────────────────────────┘
```

---

## 🧪 Test the UI Flow

### Test 1: Create a Match

1. **Click MULTIPLAYER** button
2. **Click "➕ Create New Match"**
3. **Match Config Modal appears!**
   - Fill in match name (e.g., "My Test Match")
   - Select max players (e.g., 4)
   - Select win condition (e.g., "Frags")
   - Set value (e.g., 5)
4. **Click "🚀 Create Match"**
5. **You should see:**
   - Modal closes
   - Console shows: "✅ FFA Match created!"
   - **FFA HUD appears on screen**
   - Timer starts (00:00)
   - Kill feed is empty
   - Quick stats show "0 frags"

---

### Test 2: View the Match Config Modal

1. Click MULTIPLAYER
2. Click "Create New Match"
3. **Explore the form:**
   - Change "Win Condition" dropdown
   - Notice the value field changes dynamically
   - Try "Time" → "Time Limit (minutes)"
   - Try "Frags" → "Frags to Win"
   - Try "Points" → "Score Target (thousands)"
   - Try "Lines" → "Lines to Clear"
   - Try "Never" → Value field disappears!

---

### Test 3: In-Game HUD

After creating a match:

1. **Check the top bar:**
   - Match phase: "PLAYING" (green badge)
   - Timer: Counting up (00:01, 00:02, etc.)
   - Win condition: "First to 5 frags"

2. **Press Tab key:**
   - Scoreboard appears!
   - Shows your player with frags, score, lines
   - Press Tab again to close

3. **Bottom right:**
   - "Your Frags: 0"
   - "Rank: #1"

---

## 🐛 Troubleshooting

### Issue: Nothing happens when I click MULTIPLAYER

**Check console for errors:**
1. Press F12 to open DevTools
2. Check the Console tab
3. Look for any red error messages

**Common issues:**
- Steam not initialized (should see warning)
- Lobby browser not created (check if `window.app.lobbyBrowser` exists)

**Fix:**
```javascript
// Run in console to check:
console.log('Lobby Browser:', window.app.lobbyBrowser)
console.log('Steam:', window.app.steamNetworking)

// If lobby browser is null, Steam may not have initialized
// Check for: "✅ Multiplayer UI initialized" in console
```

---

### Issue: "Lobby browser not initialized" alert

This means Steam didn't initialize. This can happen if:
- Running in browser (expected - uses mock mode)
- Greenworks not available

**Solution:** This is normal! The lobby browser should still work in mock mode. If you see this alert, there's a bug. Let me know!

---

### Issue: UI looks broken/unstyled

**Check if CSS is loaded:**
```javascript
// Run in console:
const link = document.querySelector('link[href*="multiplayer-ui.css"]')
console.log('CSS loaded:', link ? 'YES' : 'NO')
```

**If not loaded:**
1. Check `public/index.html` has this line:
   ```html
   <link rel="stylesheet" href="./styles/multiplayer-ui.css">
   ```
2. Check file exists: `public/styles/multiplayer-ui.css`
3. Refresh the page (Ctrl+Shift+R or Cmd+Shift+R)

---

### Issue: Can't close modals

**Try these:**
- Click the X button (top-right)
- Click outside the modal (on dark overlay)
- Press Escape key (if you're in-game)

---

## 📋 Visual Checklist

After clicking MULTIPLAYER, you should see:

- [ ] Lobby Browser modal appears
- [ ] Beautiful purple/blue gradient background
- [ ] "🎮 Multiplayer Lobbies" title
- [ ] "Create New Match" button (purple)
- [ ] "Refresh" button (gray)
- [ ] Close button (X) in top-right
- [ ] Empty state message (if no lobbies)
- [ ] Modal has shadow and blur effect
- [ ] Smooth fade-in animation

---

## ✅ Success!

If you see the lobby browser modal appear when you click MULTIPLAYER, **Phase 4 UI is working!** 🎉

---

## 💡 Console Commands

You can also test via console:

```javascript
// Show lobby browser directly
showLobbyBrowser()

// Or via app instance
window.app.showLobbyBrowser()

// Create match directly
createFFAMatch({
  gameName: 'Test Match',
  maxPlayers: 4,
  endCondition: 'frags',
  endConditionValue: 5
})
```

---

## 📞 Still Having Issues?

If the multiplayer button still doesn't work:

1. **Check console for:**
   - "✅ Multiplayer UI initialized"
   - "🎮 Multiplayer mode selected" (when clicking button)
   - Any error messages

2. **Run these in console:**
   ```javascript
   // Check if handlers are set up
   console.log('App:', window.app)
   console.log('Lobby Browser:', window.app?.lobbyBrowser)
   console.log('Steam:', window.app?.steamNetworking)
   ```

3. **Try manual trigger:**
   ```javascript
   window.app.handleMultiplayerModeSelected()
   ```

If it still doesn't work, let me know what error you see in the console!

---

**Last Updated:** October 16, 2025  
**Status:** ✅ Connected to MULTIPLAYER button  
**Next:** Click that button and see the magic! 🎨✨

