# 🎮 Local Multiplayer 4-Player Support - Quick Reference

**See:** `LOCAL_MULTIPLAYER_CONFIGURATION_PLAN.md` for full details.

---

## 📊 Summary

**Goal:** Add configuration options and extend local multiplayer from 2 to 4 players.

**Timeline:** 2-3 weeks (10-14 working days)

**Status:** 📝 Planning Complete, Ready to Implement

---

## 🎯 Key Features

1. **Configuration Modal** - Similar to online MP
2. **2-4 Player Support** - Dynamic player count
3. **Win Conditions** - Frags, time, points, lines, never
4. **Advanced Settings** - Starting level, level progression, boring rules
5. **Input Support** - 4 keyboard layouts + 4 gamepads
6. **Dynamic Layout** - 2x1 grid for 2 players, 2x2 for 4 players

---

## 📁 Files to Create/Modify

### New Files
- `src/ui/local-match-config-modal.js` - Configuration UI
- `src/core/multi-player-state.js` - N-player game state
- `styles/multiplayer.css` - Layout styles

### Modified Files
- `src/core/game-modes/LocalMultiplayerMode.js` - Main logic
- `src/input/input-manager.js` - 4-player input
- `public/index.html` - HTML structure for 4 boards

---

## 🗺️ Implementation Phases

| Phase | Task | Duration | Status |
|-------|------|----------|--------|
| 1 | Research & Planning | - | ✅ Done |
| 2 | Configuration UI | 1-2 days | 📝 Ready |
| 3 | Game State Extension | 2-3 days | ⏳ Pending |
| 4 | Rendering System | 2-3 days | ⏳ Pending |
| 5 | Input Handling | 2 days | ⏳ Pending |
| 6 | Garbage System | 1 day | ⏳ Pending |
| 7 | Testing & Polish | 2-3 days | ⏳ Pending |

---

## 🎹 Input Layouts

### Player 1 - Arrow Keys
- Move: Arrow Keys
- Rotate CW: Right Shift
- Rotate CCW: Right Ctrl
- Hard Drop: Enter

### Player 2 - WASD
- Move: WASD
- Rotate CW: Left Shift
- Rotate CCW: Left Ctrl
- Hard Drop: Tab

### Player 3 - IJKL
- Move: IJKL
- Rotate CW: U
- Rotate CCW: O
- Hard Drop: P

### Player 4 - Numpad
- Move: Numpad 8456
- Rotate CW: Numpad 7
- Rotate CCW: Numpad 9
- Hard Drop: Numpad +

### Gamepads
- Player 1: Gamepad 0
- Player 2: Gamepad 1
- Player 3: Gamepad 2
- Player 4: Gamepad 3

---

## 🎨 UI Layouts

### 2 Players
```
┌─────────┬─────────┐
│         │         │
│ Player1 │ Player2 │
│         │         │
└─────────┴─────────┘
```

### 3 Players
```
┌─────────┬─────────┐
│ Player1 │ Player2 │
├─────────┴─────────┤
│     Player3       │
└───────────────────┘
```

### 4 Players
```
┌─────────┬─────────┐
│ Player1 │ Player2 │
├─────────┼─────────┤
│ Player3 │ Player4 │
└─────────┴─────────┘
```

---

## ⚡ Performance Targets

| Players | Target FPS | Min FPS | Board Size |
|---------|-----------|---------|------------|
| 2 | 60 FPS | 60 FPS | Full (320x640) |
| 3 | 60 FPS | 45 FPS | Medium (300x600) |
| 4 | 45 FPS | 30 FPS | Small (300x600) |

---

## 🎯 Configuration Options

### Basic Settings
- **Number of Players:** 2, 3, or 4
- **Win Condition:** Frags, Time, Points, Lines, Never
- **Win Value:** Configurable target (e.g., 7 frags, 3 minutes)

### Advanced Settings
- **Starting Level:** 1-9 (affects piece speed)
- **Level Progression:** On/Off (increase every 15 lines)
- **Boring Rules:** On/Off (disable attack scaling)

---

## 🔄 Garbage Routing

### 2 Players
- Player 1 → Player 2
- Player 2 → Player 1

### 3 Players
- Player 1 → Player 2, 3
- Player 2 → Player 1, 3
- Player 3 → Player 1, 2

### 4 Players
- Player 1 → Player 2, 3, 4
- Player 2 → Player 1, 3, 4
- Player 3 → Player 1, 2, 4
- Player 4 → Player 1, 2, 3

### Attack Scaling (if not "boring rules")
- 2 players: 100% damage
- 3 players: 75% damage
- 4 players: 50% damage

---

## 🧪 Testing Checklist

### Basic Functionality
- [ ] Configuration modal appears
- [ ] Settings save correctly
- [ ] Boards render correctly
- [ ] All players can control pieces
- [ ] Garbage attacks work
- [ ] Win conditions trigger

### Player Counts
- [ ] 2-player mode works
- [ ] 3-player mode works
- [ ] 4-player mode works

### Win Conditions
- [ ] Frags condition works
- [ ] Time condition works
- [ ] Points condition works
- [ ] Lines condition works
- [ ] Never condition works

### Input
- [ ] 4 keyboard layouts work
- [ ] No input conflicts
- [ ] Gamepad support works
- [ ] 4 gamepads simultaneously

### Performance
- [ ] 60 FPS with 2 players
- [ ] 45+ FPS with 3 players
- [ ] 30+ FPS with 4 players
- [ ] No memory leaks

---

## 🚀 How to Start

### Step 1: Create Feature Branch
```bash
git checkout -b feature/local-mp-config
```

### Step 2: Begin Phase 2 (Config UI)
```bash
# Create modal component
touch src/ui/local-match-config-modal.js
```

### Step 3: Follow the Plan
See `LOCAL_MULTIPLAYER_CONFIGURATION_PLAN.md` for detailed implementation steps.

---

## 🔗 Related Files

- **Full Plan:** `LOCAL_MULTIPLAYER_CONFIGURATION_PLAN.md`
- **Current Implementation:** `src/core/game-modes/LocalMultiplayerMode.js`
- **Online MP Reference:** `src/core/game-modes/OnlineMultiplayerMode.js`
- **Online Config Modal:** `src/ui/match-config-modal.js`
- **Game State:** `src/core/multiplayer.js`

---

## 💡 Key Decisions Made

1. **Max 4 Players:** Limited to 4 for performance and screen space
2. **Keyboard Layouts:** Fixed layouts (IJKL for P3, Numpad for P4)
3. **Attack Scaling:** Enabled by default, configurable via "boring rules"
4. **Layout Strategy:** 2x1 for 2 players, 2x2 for 4 players
5. **Reuse Code:** Leverage online MP modal and FFA game state patterns

---

## ⚠️ Known Risks

1. **Performance:** 4 Phaser instances may be slow on older hardware
2. **Input Conflicts:** Keyboard layouts may interfere
3. **Screen Space:** 4 boards may not fit on smaller monitors
4. **Balance:** Attack scaling needs extensive testing

**Mitigations:** See "Risk Assessment" in full plan.

---

## 📞 Questions?

Refer to the full implementation plan or ask for clarification on specific phases.

**Ready to code? Let's go! 🚀**

