# Phase 6: Garbage System - Test Plan & Verification

**Date:** October 30, 2025
**Status:** ✅ Implementation Complete - Ready for Testing
**Objective:** Verify garbage routing and attack scaling work correctly for 2-4 players

---

## Implementation Summary

Phase 6 has been **fully implemented** in `src/core/multi-player-state.js`. The following features are in place:

### Features Implemented

1. **Dynamic Attack Targeting** (`_getAttackTargets()`)
   - Routes attacks to all alive opponents
   - Excludes the attacking player
   - Adapts to player count (2, 3, or 4 players)

2. **Attack Scaling** (`_scaleAttackForPlayerCount()`)
   - 2 players: 100% damage (no scaling)
   - 3 players: 75% damage
   - 4 players: 50% damage
   - Respects "boring rules" configuration

3. **Garbage Distribution** (`handleGarbageSummary()`)
   - Calculates garbage attacks
   - Applies scaling
   - Distributes to all targets
   - Tracks last attacker for frag attribution

---

## Test Scenarios

### Test 1: 2-Player Garbage Routing

**Setup:**
- 2 players
- Player 1 clears 4 lines (Tetris)
- Default settings (no boring rules)

**Expected Behavior:**
```
Player 1 clears Tetris → Sends 4 lines to Player 2
Scaling: 100% (2 players)
Final attack: 4 lines to Player 2
```

**Verification Steps:**
1. Start a 2-player local match
2. Player 1 clears a Tetris
3. Check Player 2's garbage queue
4. Console should log:
   ```
   [MultiPlayerState] Player 1 cascade resolved → depth=X, combo=X
   [MultiPlayerState]   Total attack rows: 4 (scaled from 4)
   [MultiPlayerState] Player 1 → Player 2: 4 lines
   ```

**Pass Criteria:**
- ✅ Player 2 receives exactly 4 lines of garbage
- ✅ No scaling applied (100% damage)
- ✅ Garbage appears in Player 2's queue

---

### Test 2: 3-Player Garbage Routing

**Setup:**
- 3 players (all alive)
- Player 1 clears 4 lines (Tetris)
- Default settings (no boring rules)

**Expected Behavior:**
```
Player 1 clears Tetris → Sends garbage to Player 2 AND Player 3
Scaling: 75% (3 players)
Original attack: 4 lines
Scaled attack: 3 lines (Math.ceil(4 * 0.75))
Final: 3 lines to Player 2, 3 lines to Player 3
```

**Verification Steps:**
1. Start a 3-player local match
2. Player 1 clears a Tetris
3. Check both Player 2 and Player 3 garbage queues
4. Console should log:
   ```
   [MultiPlayerState] Player 1 cascade resolved → depth=X, combo=X
   [MultiPlayerState]   Total attack rows: 3 (scaled from 4)
   [MultiPlayerState] Player 1 → Player 2: 3 lines
   [MultiPlayerState] Player 1 → Player 3: 3 lines
   ```

**Pass Criteria:**
- ✅ Player 2 receives 3 lines of garbage (75% of 4)
- ✅ Player 3 receives 3 lines of garbage (75% of 4)
- ✅ Scaling correctly applied
- ✅ Both players receive the same amount

---

### Test 3: 4-Player Garbage Routing

**Setup:**
- 4 players (all alive)
- Player 1 clears 4 lines (Tetris)
- Default settings (no boring rules)

**Expected Behavior:**
```
Player 1 clears Tetris → Sends to Player 2, Player 3, AND Player 4
Scaling: 50% (4 players)
Original attack: 4 lines
Scaled attack: 2 lines (Math.ceil(4 * 0.5))
Final: 2 lines to each opponent
```

**Verification Steps:**
1. Start a 4-player local match
2. Player 1 clears a Tetris
3. Check all three opponents' garbage queues
4. Console should log:
   ```
   [MultiPlayerState] Player 1 cascade resolved → depth=X, combo=X
   [MultiPlayerState]   Total attack rows: 2 (scaled from 4)
   [MultiPlayerState] Player 1 → Player 2: 2 lines
   [MultiPlayerState] Player 1 → Player 3: 2 lines
   [MultiPlayerState] Player 1 → Player 4: 2 lines
   ```

**Pass Criteria:**
- ✅ Player 2 receives 2 lines (50% of 4)
- ✅ Player 3 receives 2 lines (50% of 4)
- ✅ Player 4 receives 2 lines (50% of 4)
- ✅ All opponents receive equal damage

---

### Test 4: Boring Rules (No Scaling)

**Setup:**
- 4 players (all alive)
- Player 1 clears 4 lines (Tetris)
- **Boring Rules ENABLED** in match config

**Expected Behavior:**
```
Player 1 clears Tetris → Sends to all opponents
Scaling: DISABLED (boring rules)
Original attack: 4 lines
Scaled attack: 4 lines (no scaling)
Final: 4 lines to each opponent
```

**Verification Steps:**
1. Start a 4-player match with "Boring Rules" enabled
2. Player 1 clears a Tetris
3. Check all opponents' garbage queues
4. Console should log:
   ```
   [MultiPlayerState]   Total attack rows: 4 (scaled from 4)
   ```

**Pass Criteria:**
- ✅ Each opponent receives 4 lines (no scaling)
- ✅ Boring rules override player count scaling
- ✅ All opponents receive full damage

---

### Test 5: Dead Player Targeting

**Setup:**
- 4 players
- Player 2 is dead (isAlive = false)
- Players 1, 3, 4 are alive
- Player 1 clears 4 lines

**Expected Behavior:**
```
Player 1 clears Tetris → Sends ONLY to alive opponents (P3, P4)
Targets: Player 3, Player 4 (Player 2 skipped)
Scaling: 75% (3 alive players)
Final: 3 lines to Player 3, 3 lines to Player 4
```

**Verification Steps:**
1. Start a 4-player match
2. Manually set `multiplayerState.players[1].isAlive = false` (or let Player 2 die)
3. Player 1 clears a Tetris
4. Verify Player 2 receives NO garbage
5. Verify Players 3 and 4 receive garbage

**Pass Criteria:**
- ✅ Player 2 receives 0 lines (dead)
- ✅ Player 3 receives 3 lines
- ✅ Player 4 receives 3 lines
- ✅ Scaling based on 3 alive players (not 4)

---

### Test 6: Combo Attacks

**Setup:**
- 2 players
- Player 1 performs a combo (e.g., Tetris → Double)
- Default settings

**Expected Behavior:**
```
Player 1 combo → Garbage accumulates and sends
Attack calculation includes combo bonus
Scaling: 100% (2 players)
```

**Verification Steps:**
1. Start a 2-player match
2. Player 1 clears lines consecutively to build a combo
3. Observe garbage sent after combo resolution
4. Console logs should show combo depth and complexity

**Pass Criteria:**
- ✅ Combo attacks send more garbage than single clears
- ✅ Garbage routing works with combo system
- ✅ Player 2 receives appropriate scaled garbage

---

### Test 7: Back-to-Back Tetris (B2B)

**Setup:**
- 3 players
- Player 1 performs back-to-back Tetrises
- Default settings

**Expected Behavior:**
```
Player 1 B2B Tetris → Increased garbage output
Scaling: 75% (3 players)
Both opponents receive scaled B2B garbage
```

**Verification Steps:**
1. Start a 3-player match
2. Player 1 clears two consecutive Tetrises without single/double/triple
3. Verify B2B bonus is applied
4. Check both opponents receive scaled garbage

**Pass Criteria:**
- ✅ B2B bonus calculated correctly
- ✅ Scaling applied after B2B calculation
- ✅ Both opponents receive equal scaled damage

---

## Attack Scaling Calculations Reference

### Formula
```javascript
scaledLines = boringRules
    ? originalLines
    : Math.ceil(originalLines * scalingFactor)
```

### Scaling Factors
- **2 players (or ≤2 alive):** 1.0 (100%)
- **3 players (alive):** 0.75 (75%)
- **4+ players (alive):** 0.5 (50%)

### Example Calculations

| Original Lines | 2P (100%) | 3P (75%) | 4P (50%) | Boring (100%) |
|----------------|-----------|----------|----------|---------------|
| 1              | 1         | 1        | 1        | 1             |
| 2              | 2         | 2        | 1        | 2             |
| 3              | 3         | 3        | 2        | 3             |
| 4 (Tetris)     | 4         | 3        | 2        | 4             |
| 6              | 6         | 5        | 3        | 6             |
| 8              | 8         | 6        | 4        | 8             |
| 10             | 10        | 8        | 5        | 10            |

---

## Console Debugging Commands

### Check Attack Targets
```javascript
// In browser console during match
window.multiplayerState = // get reference from game
multiplayerState._getAttackTargets(0) // Returns target indices for Player 1
```

### Check Scaling
```javascript
// Simulate scaling calculation
multiplayerState._scaleAttackForPlayerCount(4) // Should return scaled value
```

### Check Player Alive Status
```javascript
multiplayerState.players.map((p, i) => ({
    player: i + 1,
    isAlive: p.isAlive
}))
```

---

## Known Issues & Edge Cases

### Edge Case 1: Single Player Remaining
**Scenario:** 3 players, 2 are dead
**Expected:** Scaling should be 100% (only 2 alive, including attacker)
**Implementation:** ✅ Correctly implemented (checks `alivePlayers.length`)

### Edge Case 2: All Opponents Dead
**Scenario:** Only 1 player alive
**Expected:** No targets, no garbage sent
**Implementation:** ✅ Handled by `_getAttackTargets()` returning empty array

### Edge Case 3: Fraction Rounding
**Scenario:** 3 lines at 75% = 2.25 lines
**Expected:** Round up to 3 lines (Math.ceil)
**Implementation:** ✅ Uses `Math.ceil()` for all calculations

---

## Integration Testing Checklist

### Basic Functionality
- [ ] 2-player garbage routing works
- [ ] 3-player garbage routing works
- [ ] 4-player garbage routing works
- [ ] Attack scaling calculations are correct
- [ ] Boring rules disable scaling

### Advanced Features
- [ ] Dead players are excluded from targets
- [ ] Scaling adapts when players die mid-game
- [ ] Combo attacks scale correctly
- [ ] B2B attacks scale correctly
- [ ] Blind attacks work with scaling

### Performance
- [ ] No lag when sending garbage to multiple players
- [ ] Console logs are helpful for debugging
- [ ] Garbage queues update immediately

### Edge Cases
- [ ] 1 player remaining (no targets)
- [ ] All opponents dead
- [ ] Fractional damage rounds correctly
- [ ] 0 damage attacks are ignored

---

## Manual Testing Guide

### Test Setup
1. Start local multiplayer mode
2. Open browser console (F12)
3. Watch for `[MultiPlayerState]` log messages
4. Monitor garbage queues in UI

### Quick Test Procedure
```
1. Start 2-player match → Clear Tetris → Verify 4 lines sent
2. Start 3-player match → Clear Tetris → Verify 3 lines sent to both
3. Start 4-player match → Clear Tetris → Verify 2 lines sent to all
4. Enable boring rules → Clear Tetris → Verify 4 lines sent regardless
5. Let a player die → Clear lines → Verify dead player not targeted
```

---

## Success Criteria

Phase 6 is considered **complete and verified** when:

✅ All 7 test scenarios pass
✅ Attack scaling calculations are correct
✅ Boring rules option works as expected
✅ Dead players are properly excluded
✅ No console errors during garbage routing
✅ Performance is acceptable with 4 players
✅ Edge cases are handled gracefully

---

## Next Steps

After Phase 6 testing is complete:

1. **Move to Phase 7:** Testing & Polish (comprehensive testing)
2. **Document any bugs** found during testing
3. **Create regression tests** for critical scenarios
4. **Performance profiling** with 4 active players

---

## Conclusion

Phase 6 implementation is **complete**. The garbage system supports:
- ✅ 2-4 player routing
- ✅ Dynamic attack scaling
- ✅ Configurable boring rules
- ✅ Dead player exclusion
- ✅ Frag attribution

**Ready for testing!** 🎮✨
