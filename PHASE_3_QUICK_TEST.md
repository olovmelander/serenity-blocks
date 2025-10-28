# Phase 3 Quick Test Guide

**Date:** October 18, 2025  
**Purpose:** Quickly verify Phase 3 features are working

---

## 🚀 Setup (2 minutes)

1. **Open TWO browser windows** (side by side)
2. **Window 1:** `window.showLobbyBrowser()` → Create Match
3. **Window 2:** `window.showLobbyBrowser()` → Join Match
4. **Window 1:** Click "Start Match"
5. **Both:** Play!

---

## ✅ Quick Tests (5 minutes)

### Test 1: Basic Garbage (30 seconds)
**Window 1:** Clear 4 lines  
**Expected:**
- ✅ Red bar appears on Window 2 (shows pending garbage)
- ✅ When Window 2's next piece spawns, gray lines appear at bottom
- ✅ Window 2's canvas shakes
- ✅ Red popup: "+3 garbage"
- ✅ Sound plays (if audio on)

**Pass?** [ ] Yes [ ] No

---

### Test 2: Garbage Counter (1 minute)
**Setup:** Window 2 has 5 garbage lines pending  
**Window 2:** Clear 3 lines (sends 2 garbage)  
**Expected:**
- ✅ Green flash effect on Window 2
- ✅ Green popup: "-2 garbage" 
- ✅ Red bar reduces from 5 → 3 lines
- ✅ Counter sound plays

**Pass?** [ ] Yes [ ] No

---

### Test 3: Warning Indicators (30 seconds)
**Window 1:** Send 15+ garbage lines to Window 2  
(Clear many lines quickly)  
**Expected:**
- ✅ Red bar pulses rapidly
- ✅ Yellow warning stripes visible
- ✅ "DANGER" label appears
- ✅ Text glows red

**Pass?** [ ] Yes [ ] No

---

### Test 4: Immediate Insertion (30 seconds)
**Window 2:** Hold still (don't move any pieces)  
**Window 1:** Clear 2 lines  
**Expected:**
- ✅ Garbage inserts immediately (doesn't wait for next spawn)
- ✅ Console shows: "⚡ Immediate insertion"

**Pass?** [ ] Yes [ ] No

---

### Test 5: Visual Effects (30 seconds)
**Test all effects:**
- ✅ Shake effect when garbage arrives
- ✅ Green flash when countering
- ✅ Red popups for incoming garbage
- ✅ Green popups for countered garbage

**Pass?** [ ] Yes [ ] No

---

### Test 6: Sound Effects (30 seconds)
**Test all sounds:**
- ✅ Sound when sending garbage
- ✅ Sound when receiving garbage (local player only)
- ✅ Sound when countering garbage
- ✅ Sound when player dies

**Pass?** [ ] Yes [ ] No

---

### Test 7: Top-Out Effect (1 minute)
**Window 2:** Let garbage stack up until death  
**Expected:**
- ✅ Canvas turns grayscale
- ✅ Red border appears
- ✅ "💀 DEAD" overlay shows
- ✅ Chat message: "💀 [Name] topped out!"
- ✅ Death sound plays

**Pass?** [ ] Yes [ ] No

---

## 🐛 Common Issues

### Issue: No visual effects
**Fix:** Check browser console for errors  
**Fix:** Ensure `setupVisualEffectsListeners()` is called

### Issue: No sound effects
**Fix:** Click on page to resume audio context  
**Fix:** Check audio isn't muted  
**Fix:** Check `window.gameInstance.soundManager` exists

### Issue: Garbage doesn't counter
**Fix:** Check console for "🛡️ countered" message  
**Fix:** Ensure host is processing attacks

### Issue: Warning indicator doesn't pulse
**Fix:** Normal - pulse is subtle for < 10 lines  
**Fix:** Send 10+ lines to see full effect

---

## 📊 Console Messages to Look For

### Successful Garbage Flow:
```
💥 [Player] cleared lines → sending X garbage lines
🛡️ [Player] countered Y garbage lines (A → B)
  → [Opponent] receives X lines (queue: Y)
💥 Inserting Y garbage lines for [Opponent]
  Added garbage line at y=23, holes at: [1, 4]
```

### Immediate Insertion:
```
  → [Opponent] receives X lines (queue: Y)
  ⚡ Immediate insertion (no piece active)
💥 Inserting X garbage lines for [Opponent]
```

### Top-Out:
```
💀 [Player] topped out!
```

---

## ✅ Success Checklist

Phase 3 is working if:
- [x] Basic garbage appears on opponent's board
- [x] Garbage counter reduces incoming garbage
- [x] Visual effects play (shake, flash, death)
- [x] Sound effects play for all events
- [x] Warning indicator pulses and shows "DANGER"
- [x] Immediate insertion works when no piece active
- [x] Popups show "+X" and "-X" garbage
- [x] Chat messages appear for deaths

---

## 🎉 If All Tests Pass

**Congratulations!** Phase 3 is working perfectly!

Your FFA multiplayer now has:
- ✅ Complete garbage system
- ✅ Defensive mechanics (counter)
- ✅ Polished visual feedback
- ✅ Complete audio feedback
- ✅ Clear danger indicators

**Next steps:**
- Continue playing and enjoying!
- Move to Phase 4 (UX improvements)
- Or jump to Phase 5 (testing & optimization)

---

## 🎮 Advanced Tests (Optional)

### Multi-Player Garbage Counter
1. Start match with 3+ players
2. Everyone send garbage simultaneously
3. Verify garbage scales correctly
4. Verify countering works for all players

### High Garbage Stress Test
1. Send 20+ garbage lines
2. Verify warning indicator shows correctly
3. Verify performance doesn't degrade
4. Verify all lines insert correctly

### Death Cascade Test
1. Send massive garbage to multiple players
2. Verify multiple deaths trigger correctly
3. Verify death effects don't conflict
4. Verify frag tracking works

---

**Happy testing!** 🚀

If you encounter any issues, check `PHASE_3_COMPLETE.md` for detailed troubleshooting.

