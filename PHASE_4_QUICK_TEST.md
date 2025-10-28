# Phase 4 Quick Test Guide

**Purpose:** Quickly verify all Phase 4 UX features  
**Time:** 5-7 minutes  
**Players:** 2 required

---

## 🚀 Setup (30 seconds)

1. Open **2 browser windows** side by side
2. **Window 1:** `window.showLobbyBrowser()` → Create Match
3. **Window 2:** `window.showLobbyBrowser()` → Join Match
4. **Window 1:** Click **Start Match**

---

## ✅ Quick Tests

### Test 1: Leaderboard (30 seconds)

**Look at top-left corner**

Expected:
- ✅ See leaderboard with both players
- ✅ See 🥇 medal for 1st place
- ✅ See 🥈 medal for 2nd place
- ✅ Your entry highlighted in **blue**
- ✅ Shows frags (💀) and score (📊)

**Clear some lines:**
- ✅ Leaderboard updates in real-time
- ✅ Rankings change as scores change

---

### Test 2: Kill Feed (1 minute)

**Window 1:** Send lots of garbage to Window 2  
**(Clear 4+ lines repeatedly)**

**Window 2:** Let yourself top out

Expected in **Window 1** (top-right):
- ✅ Kill feed shows: "You 💀 Player2"
- ✅ Entry has **green background**
- ✅ Entry **slides in from right**
- ✅ Entry **fades over time**

Expected in **Window 2** (top-right):
- ✅ Kill feed shows: "Player1 💀 You"
- ✅ Entry has **red background**

---

### Test 3: Attack Indicators (1 minute)

**Window 1:** Clear 4 lines (Tetris)

Expected in **Window 1** (center):
- ✅ **Yellow/gold arrow** appears
- ✅ Shows "3 lines"
- ✅ Shows "→ 1 player"
- ✅ Disappears after 2 seconds

Expected in **Window 2** (center):
- ✅ **Red arrow** appears (pulsing)
- ✅ Shows incoming attack info
- ✅ Disappears after 2 seconds

---

### Test 4: P2P Chat (1 minute)

**Window 1:**
1. Click chat input (bottom-right)
2. Type "hello"
3. Press **Enter**

Expected in **Window 1**:
- ✅ Message appears: "You: hello"
- ✅ Timestamp shown (e.g., "14:32")

Expected in **Window 2**:
- ✅ Message appears: "Player1: hello"
- ✅ Same timestamp

**Window 2:**
1. Type "hi" and press Enter

Expected:
- ✅ Both windows see both messages
- ✅ Messages in chronological order

**Test hide/show:**
- Click **−** button → Chat minimizes
- Click **+** button → Chat expands

---

### Test 5: Line Clear Flash (1 minute)

**Clear different line counts:**

1. **Clear 1 line:**
   - ✅ **White flash**

2. **Clear 3 lines:**
   - ✅ **Yellow flash**

3. **Clear 4 lines (Tetris):**
   - ✅ **Orange flash**
   - ✅ **Gold flash** when sending garbage

Expected:
- ✅ Flashes are quick (< 200ms)
- ✅ Flashes fade smoothly
- ✅ Both players see their own flashes

---

### Test 6: Match Timer (30 seconds)

**Look at top-center**

Expected:
- ✅ Timer shows elapsed time (e.g., "0:15")
- ✅ Updates every second
- ✅ Format: M:SS

**Play for 1 minute:**
- ✅ Timer shows "1:00" or more
- ✅ No freezing or stuttering

---

## 🎮 All Features Checklist

After all tests:

- [ ] **Leaderboard**
  - [ ] Shows all players
  - [ ] Updates in real-time
  - [ ] Medals for top 3
  - [ ] Your player highlighted
  - [ ] Dead players faded

- [ ] **Kill Feed**
  - [ ] Shows kills/deaths
  - [ ] Green for your kills
  - [ ] Red for your deaths
  - [ ] Slide-in animation
  - [ ] Fades over time

- [ ] **Attack Indicators**
  - [ ] Yellow for outgoing
  - [ ] Red for incoming
  - [ ] Shows line count
  - [ ] Shows target count
  - [ ] 2-second duration

- [ ] **P2P Chat**
  - [ ] Messages send
  - [ ] Messages receive
  - [ ] Timestamps shown
  - [ ] Hide/show works
  - [ ] Enter key works

- [ ] **Line Clear Flash**
  - [ ] White (1-2 lines)
  - [ ] Yellow (3 lines)
  - [ ] Orange (4+ lines)
  - [ ] Gold (attacks)
  - [ ] Quick duration

- [ ] **Match Timer**
  - [ ] Shows elapsed time
  - [ ] Updates every second
  - [ ] Correct format

---

## 🐛 Common Issues

### Issue: Kill feed not showing
**Check:** Is player actually dying?  
**Check:** Console for "game:player:frag" events  
**Fix:** Verify frag tracker is working

### Issue: Attack indicators not appearing
**Check:** Are you clearing lines?  
**Check:** Console for "game:garbage:sent" events  
**Fix:** Verify attack router is working

### Issue: Chat not sending
**Check:** Network connection established?  
**Check:** Console for "game:chat" events  
**Fix:** Verify broadcastToAll is working

### Issue: Leaderboard not updating
**Check:** Is game loop running (60 FPS)?  
**Check:** Console for "ffa:render-frame" events  
**Fix:** Verify game loop is started

### Issue: Flash effects not visible
**Check:** Are lines being cleared?  
**Check:** Console for "ffa:line-clear" events  
**Fix:** Verify physics callbacks

---

## 📊 Console Messages

### Expected (if all working):

```
✅ FFA HUD shown
💬 Chat from Player1: hello
💀 Kill Feed: You killed Player2
⚡ Attack indicator: Player1 → 3 lines
✨ Line clear flash: 4 lines (orange)
⏱️ Match timer: 1:23
🏆 Leaderboard: Player1 (1st)
```

---

## ✅ Success Criteria

**Phase 4 is working** if:
- All 6 tests pass
- All features in checklist work
- No console errors
- Smooth performance (60 FPS)
- Animations are smooth

---

## 🎉 If All Tests Pass

**Congratulations!** Phase 4 is working perfectly!

Your FFA multiplayer now has:
- ✅ Professional HUD
- ✅ Real-time feedback
- ✅ Social features (chat)
- ✅ Competitive features (leaderboard, kill feed)
- ✅ Polished visual effects

**Next steps:**
- **Phase 5:** Stress testing (8 players, long matches)
- **Or Ship It:** Your game is ready for players!

---

**Happy testing!** 🚀

See `PHASE_4_COMPLETE.md` for full documentation.

