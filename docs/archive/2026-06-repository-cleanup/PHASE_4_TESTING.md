# Phase 4 Testing Guide - Lobby Browser & Match Config UI

**Project:** Serenity Blocks - FFA Multiplayer Implementation  
**Phase:** Phase 4 - Lobby Browser & Match Config UI  
**Date:** October 16, 2025  
**Test Environment:** Browser (localhost:5173)

---

## 🎯 What We're Testing

Phase 4 adds beautiful, modern UI for multiplayer:

✅ **Lobby Browser** - Browse and join available matches  
✅ **Match Config Modal** - Create custom matches  
✅ **In-Game HUD** - Kill feed, timer, match info  
✅ **Scoreboard** - Real-time standings  

---

## 🚀 Quick Start

### Step 1: Start the Game

```bash
npm run dev
```

### Step 2: Open Browser

Navigate to: **http://localhost:5173**  
Open DevTools (F12)

### Step 3: Test the UI

```javascript
// Show lobby browser
showLobbyBrowser()
```

---

## 🧪 Test 1: Lobby Browser

### Show the Lobby Browser

```javascript
showLobbyBrowser()
```

**Expected:**
- Beautiful modal appears with gradient background
- Shows "No lobbies found" message (if no lobbies exist)
- Has "Create New Match" button
- Has "Refresh" button
- Has close button (X)

**✅ Success:** Lobby browser displays correctly

---

### Create a Test Match

1. Click **"➕ Create New Match"** button
2. Match Config Modal should appear

**✅ Success:** Match config modal opens

---

## 🧪 Test 2: Match Config Modal

### Fill Out the Form

1. **Match Name:** Enter "My Test Match"
2. **Max Players:** Select "4 Players"
3. **Win Condition:** Select "Frags (Kills)"
4. **Frags to Win:** Enter "5"
5. **Lobby Type:** Select "Public"

### Advanced Settings

1. Click "⚙️ Advanced Settings"
2. Check "Boring Rules" (optional)

### Create the Match

1. Click **"🚀 Create Match"**

**Expected:**
- Modal closes
- Console shows: "✅ FFA Match created!"
- FFA HUD appears
- `window.ffa` is available

**✅ Success:** Match created successfully

---

## 🧪 Test 3: In-Game HUD

### Check HUD Elements

Once a match is created, verify:

**Match Info Bar (Top):**
- ✅ Match phase badge ("WAITING" / "PLAYING" / "FINISHED")
- ✅ Match timer (MM:SS format)
- ✅ Win condition text ("First to 5 frags")

**Kill Feed (Top Right):**
- Initially empty
- Will show kills when they happen

**Quick Stats (Bottom Right):**
- ✅ "Your Frags" counter (starts at 0)
- ✅ "Rank" indicator

---

### Test Kill Feed

```javascript
// Simulate a kill (host only)
ffa.recordPlayerDeath(ffa.localPlayerId, null)
```

**Expected:**
- Kill feed shows "[YourName] died"
- Fades out after 5 seconds
- Slides in from right with animation

**✅ Success:** Kill feed works

---

### Test Scoreboard (Press Tab)

Press **Tab** key to toggle scoreboard

**Expected:**
- Scoreboard modal appears
- Shows all players in table format
- Columns: #, Player, Frags, Score, Lines, Status
- Your row is highlighted
- Press Tab again to close

**✅ Success:** Scoreboard toggles correctly

---

## 🧪 Test 4: Win Condition Types

### Test Each Win Condition

Create matches with different win conditions:

#### Frags (Kills)
```javascript
// Create match, then in config modal:
// Win Condition: Frags
// Value: 5
```
**Expected:** "First to 5 frags" displayed

#### Time Limit
```javascript
// Win Condition: Time Limit
// Value: 3 minutes
```
**Expected:** "3 minute time limit" displayed

#### Score Target
```javascript
// Win Condition: Score Target
// Value: 10 (thousands)
```
**Expected:** "First to 10K points" displayed

#### Lines Cleared
```javascript
// Win Condition: Lines Cleared
// Value: 50
```
**Expected:** "First to 50 lines" displayed

#### Never
```javascript
// Win Condition: Never
```
**Expected:** "No win condition" displayed, value input hidden

**✅ Success:** All win conditions work

---

## 🧪 Test 5: Lobby List

### Create Multiple Matches (Simulated)

In the browser console:

```javascript
// Create first match
createFFAMatch({ gameName: 'Match 1', maxPlayers: 4 })

// Open new tab, create second match
// Or simulate with mock lobbies
```

### View in Lobby Browser

```javascript
showLobbyBrowser()
```

**Expected:**
- Multiple lobbies listed
- Each shows:
  - Match name
  - Player count (e.g., "1/4")
  - Win condition badge
  - Status (Waiting/Playing/Finished)
  - Join button (if not full)

**✅ Success:** Lobbies display correctly

---

## 🧪 Test 6: Responsive Design

### Test on Different Window Sizes

1. **Desktop (1920x1080):**
   - All elements visible
   - Proper spacing
   - No overlap

2. **Tablet (768px):**
   - Lobby browser responsive
   - Scoreboard adjusts
   - Buttons stack properly

3. **Mobile (375px):**
   - UI remains usable
   - Text readable
   - No horizontal scroll

**✅ Success:** UI is responsive

---

## 🧪 Test 7: UI Interactions

### Test All Buttons

- ✅ Close button (X) closes modals
- ✅ Create Match opens config modal
- ✅ Refresh button updates lobby list
- ✅ Join button joins lobby (if available)
- ✅ Cancel button in config closes modal
- ✅ Create button in config creates match

### Test Keyboard Shortcuts

- ✅ Tab key toggles scoreboard (during match)
- ✅ Escape key closes modals (if implemented)

### Test Overlay Clicks

- ✅ Clicking outside modal closes it

**✅ Success:** All interactions work

---

## 🧪 Test 8: Visual Polish

### Check Animations

- ✅ Modals slide in smoothly
- ✅ Kill feed items slide from right
- ✅ Kill feed items fade out after 5 seconds
- ✅ Buttons have hover effects
- ✅ Winner announcement pulses

### Check Styling

- ✅ Gradients look good
- ✅ Text is readable
- ✅ Colors are consistent
- ✅ Borders and shadows visible
- ✅ No visual glitches

**✅ Success:** UI looks polished

---

## 🎮 Complete Workflow Test

### Full Multiplayer UI Flow

1. **Start game** → `npm run dev`
2. **Open lobby browser** → `showLobbyBrowser()`
3. **Click "Create New Match"**
4. **Fill out form:**
   - Name: "Epic FFA Match"
   - Players: 8
   - Condition: Frags
   - Value: 10
5. **Click "Create Match"**
6. **Verify HUD appears**
7. **Start match** → `ffa.setReady(true)` → `ffa.startMatch()`
8. **Press Tab** → Scoreboard appears
9. **Send attack** → `ffa.sendGarbageAttack({ linesCleared: 4 })`
10. **Simulate death** → `ffa.recordPlayerDeath(ffa.localPlayerId)`
11. **Check kill feed** → Shows death
12. **Press Tab** → Check standings

**✅ Success:** Full workflow works end-to-end

---

## 📊 Visual Checklist

| Element | Visible | Styled | Animated |
|---------|---------|--------|----------|
| Lobby Browser | ✅ | ✅ | ✅ |
| Match Config Modal | ✅ | ✅ | ✅ |
| Match Info Bar | ✅ | ✅ | ✅ |
| Kill Feed | ✅ | ✅ | ✅ |
| Quick Stats | ✅ | ✅ | ✅ |
| Scoreboard | ✅ | ✅ | ✅ |
| Buttons | ✅ | ✅ | ✅ |
| Badges | ✅ | ✅ | ✅ |

---

## 🐛 Common Issues

### Issue: UI doesn't appear

**Solution:** Check console for errors. Make sure CSS is loaded.

```javascript
// Check if UI components exist
console.log('Lobby Browser:', window.app.lobbyBrowser)
console.log('Match Config:', window.app.matchConfigModal)
console.log('FFA HUD:', window.app.ffaHUD)
```

---

### Issue: Styling looks broken

**Solution:** Verify `multiplayer-ui.css` is loaded in `index.html`

```html
<link rel="stylesheet" href="./styles/multiplayer-ui.css">
```

---

### Issue: Can't close modal

**Solution:** Make sure close button is clickable. Check z-index and pointer-events.

---

### Issue: Scoreboard doesn't toggle

**Solution:** Make sure you're in a match and Tab key isn't captured by browser.

---

## 📈 Performance Metrics

### Expected Performance

| Metric | Target | Notes |
|--------|--------|-------|
| **Modal Open Time** | <100ms | Should feel instant |
| **HUD Update Rate** | 10 Hz | Updates 10x per second |
| **Kill Feed Animation** | 300ms | Smooth slide-in |
| **Scoreboard Render** | <50ms | Even with 8 players |
| **Memory Usage** | <5 MB | For all UI components |

### Measure Performance

```javascript
// Measure modal open time
console.time('modal-open')
showLobbyBrowser()
console.timeEnd('modal-open')

// Measure HUD update
console.time('hud-update')
ffaHUD.update()
console.timeEnd('hud-update')
```

---

## ✅ Phase 4 Completion Checklist

Before proceeding to Phase 5, verify:

- [ ] Lobby browser displays and functions correctly
- [ ] Match config modal allows creating custom matches
- [ ] All 5 win conditions work
- [ ] In-game HUD shows correct information
- [ ] Kill feed displays and animates properly
- [ ] Scoreboard shows all players and updates
- [ ] Tab key toggles scoreboard
- [ ] All buttons and interactions work
- [ ] UI is responsive on different screen sizes
- [ ] Animations are smooth
- [ ] No console errors
- [ ] Visual design looks polished

---

## 🎊 Success!

If all tests pass, **Phase 4 is complete!** 🎉

You now have:
✅ Beautiful lobby browser UI  
✅ Custom match configuration  
✅ Real-time in-game HUD  
✅ Scoreboard with rankings  
✅ Smooth animations and polish  

**Next:** Phase 5 - Comprehensive Testing & Optimization

---

## 💡 Console Commands Reference

```javascript
// Show lobby browser
showLobbyBrowser()

// Create match (quick)
createFFAMatch()

// Create match (with config)
createFFAMatch({
  gameName: 'My Match',
  maxPlayers: 8,
  endCondition: 'frags',
  endConditionValue: 10
})

// Access UI components
window.app.lobbyBrowser
window.app.matchConfigModal
window.app.ffaHUD

// Access current match
window.ffa
```

---

**Testing Date:** October 16, 2025  
**Next Phase:** Phase 5 - Comprehensive Testing & Optimization  
**Status:** ✅ **READY FOR TESTING**

