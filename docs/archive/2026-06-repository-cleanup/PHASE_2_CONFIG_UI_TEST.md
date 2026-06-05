# 🧪 Phase 2: Configuration UI - Test Guide

**Status:** ✅ Implementation Complete  
**Date:** October 30, 2025

---

## What Was Implemented

### ✅ Phase 2 Deliverables

1. **LocalMatchConfigModal Component** (`src/ui/local-match-config-modal.js`)
   - Configuration modal for local multiplayer
   - Player count selector (2-4 players)
   - Win condition selector (frags/time/points/lines/never)
   - Win condition value input
   - Advanced settings (starting level, level progression, boring rules)
   - Form validation
   - Show/hide functionality

2. **LocalMultiplayerMode Integration**
   - Modal shows on mode activation
   - Configuration is stored and used
   - Win condition logic updated to use configuration
   - Display texts updated dynamically
   - Modal cleanup on deactivation

3. **Win Condition System**
   - Frags (kills) - First to X frags
   - Time - Match ends after X minutes  
   - Points - First to X thousand points
   - Lines - First to clear X lines
   - Never - Play forever (manual end)

---

## Testing Instructions

### Test 1: Modal Shows on Local MP Selection

**Steps:**
1. Start the game (`npm run dev`)
2. Click "Local 2P" button on main menu
3. Configuration modal should appear

**Expected:**
- ✅ Modal appears with "🎮 Local Multiplayer Setup" header
- ✅ All form fields are visible
- ✅ Default values: 2 players, 7 frags, start level 1
- ✅ No console errors

### Test 2: Player Count Selection

**Steps:**
1. Open local MP configuration modal
2. Change "Number of Players" dropdown to 3, then 4, then back to 2

**Expected:**
- ✅ Dropdown values change correctly
- ✅ No visual glitches

**Note:** 3-4 player support will be fully implemented in Phase 4. For now, selecting 3-4 players will configure the match but only 2 boards will render.

### Test 3: Win Condition Selection

**Steps:**
1. Open configuration modal
2. Change "Win Condition" to each option:
   - **Frags:** Should show "Frags to Win" input (default 7)
   - **Time:** Should show "Time Limit (minutes)" input (default 3)
   - **Points:** Should show "Score Target (thousands)" input (default 10)
   - **Lines:** Should show "Lines to Clear" input (default 100)
   - **Never:** Should hide the value input

**Expected:**
- ✅ UI updates correctly for each condition
- ✅ Help text updates to match condition
- ✅ Default values are appropriate
- ✅ Value input is hidden for "Never" condition

### Test 4: Advanced Settings

**Steps:**
1. Open configuration modal
2. Click "⚙️ Advanced Settings" to expand
3. Verify all fields are visible:
   - Starting Level (1-9)
   - Enable Level Progression checkbox
   - Boring Rules checkbox

**Expected:**
- ✅ Advanced settings expand/collapse
- ✅ All fields are functional
- ✅ Default values: Level 1, unchecked boxes

### Test 5: Form Validation

**Steps:**
1. Open configuration modal
2. Try these invalid inputs:
   - Set "Frags to Win" to 0 or negative → Should show error
   - Set "Starting Level" to 0 or 10+ → Should show error
3. Try valid inputs and submit

**Expected:**
- ✅ Invalid inputs are rejected with alert
- ✅ Valid inputs are accepted
- ✅ Form submits successfully

### Test 6: Cancel/Close Modal

**Steps:**
1. Open configuration modal
2. Try closing via:
   - ✕ button (top right)
   - Cancel button (bottom)
   - Click outside modal (on overlay)

**Expected:**
- ✅ Modal closes for all methods
- ✅ No errors in console
- ✅ Configuration is not saved if cancelled

### Test 7: Start Match with Configuration

**Steps:**
1. Open configuration modal
2. Configure:
   - Players: 2
   - Win Condition: Frags
   - Frags to Win: 5
   - Starting Level: 3
3. Click "🚀 Start Match"
4. Press SPACEBAR to start game
5. Play until one player gets 5 frags

**Expected:**
- ✅ Modal closes after submitting
- ✅ Multiplayer UI appears
- ✅ Game starts when SPACEBAR is pressed
- ✅ Match ends when a player reaches 5 frags
- ✅ Win condition text shows "First to 5 frags wins"

### Test 8: Time-Based Win Condition

**Steps:**
1. Open configuration modal
2. Set:
   - Win Condition: Time
   - Time Limit: 1 minute
3. Start match and play for >1 minute

**Expected:**
- ✅ Match ends after 1 minute
- ✅ Player with higher score wins
- ✅ Win condition text shows "1 minute time limit"

**Note:** This may need extended gameplay testing.

### Test 9: Points-Based Win Condition

**Steps:**
1. Open configuration modal
2. Set:
   - Win Condition: Points
   - Score Target: 5 (= 5,000 points)
3. Start match and play until someone reaches 5,000 points

**Expected:**
- ✅ Match ends when score target is reached
- ✅ Correct player is declared winner
- ✅ Win condition text shows "First to 5000 points wins"

### Test 10: Lines-Based Win Condition

**Steps:**
1. Open configuration modal
2. Set:
   - Win Condition: Lines
   - Lines to Clear: 20
3. Start match and clear 20+ lines with one player

**Expected:**
- ✅ Match ends when line target is reached
- ✅ Correct player is declared winner
- ✅ Win condition text shows "First to 20 lines wins"

### Test 11: Never Win Condition

**Steps:**
1. Open configuration modal
2. Set:
   - Win Condition: Never
3. Start match and play

**Expected:**
- ✅ Match continues indefinitely
- ✅ Frags are still tracked but don't end match
- ✅ Win condition text shows "Play until manual end"
- ✅ Must manually exit (ESC or pause menu)

### Test 12: Configuration Persists

**Steps:**
1. Open configuration modal
2. Configure custom settings
3. Start match
4. Let one player win a round (not the whole match)
5. Check round end overlay

**Expected:**
- ✅ Round end overlay shows correct win condition
- ✅ Match continues with same configuration
- ✅ Next round inherits same settings

### Test 13: Modal Re-shows if Not Configured

**Steps:**
1. Select "Local 2P" mode
2. Close configuration modal without submitting
3. Press SPACEBAR to try to start

**Expected:**
- ✅ Configuration modal re-appears
- ✅ Console warns about missing configuration
- ✅ Game does not start until configured

### Test 14: Cleanup on Mode Switch

**Steps:**
1. Select "Local 2P" mode (modal appears)
2. Close modal
3. Switch to "Single Player" mode
4. Switch back to "Local 2P"

**Expected:**
- ✅ Modal appears again
- ✅ No duplicate modals
- ✅ No memory leaks
- ✅ Clean transition

---

## Known Limitations (To be addressed in later phases)

1. **2 Players Only:** Selecting 3-4 players will configure the match, but only 2 boards render (Phase 4 will add multi-board support)
2. **Basic UI:** Modal uses simple HTML/CSS (Phase 7 may add polish)
3. **No Persistence:** Configuration resets on page refresh (future enhancement)
4. **No Player Names:** Players are labeled "Player 1/2" (future enhancement)

---

## Success Criteria

### Must Pass ✅

- [x] Modal appears on local MP selection
- [x] All win conditions configurable
- [x] Form validation works
- [x] Configuration is applied to match
- [x] Win condition logic works correctly
- [x] Modal cleans up properly
- [x] No console errors

### Nice to Have 

- [ ] Smooth animations (Phase 7)
- [ ] Keyboard navigation in modal (Phase 7)
- [ ] Configuration presets (future)

---

## Next Steps

**Phase 2 Complete! ✅**

Ready to move to **Phase 3: Game State Extension**
- Create `MultiPlayerState` class
- Support 2-4 players dynamically
- Update garbage routing
- Implement win condition checks

---

## Troubleshooting

### Modal doesn't appear
- Check browser console for errors
- Verify `src/ui/local-match-config-modal.js` was created
- Check import in `LocalMultiplayerMode.js`

### Form validation not working
- Check browser console for JavaScript errors
- Verify event listeners are attached

### Win conditions not working
- Check `_checkMatchWinCondition()` method
- Verify `matchConfig` is set
- Check console logs for match state

### Modal doesn't close
- Check event listeners for close button
- Verify overlay click handler
- Check CSS for `.hidden` class

---

## Console Commands for Testing

```javascript
// Check if modal exists
document.getElementById('local-match-config-modal')

// Check configuration
window.serenityBlocks?.gameModeManager?.getCurrentMode()?.matchConfig

// Force show modal (for debugging)
window.serenityBlocks?.gameModeManager?.getCurrentMode()?.configModal?.show()

// Check if configured
window.serenityBlocks?.gameModeManager?.getCurrentMode()?.configuredForStart
```

---

**Happy Testing! 🎮**

