# 🎮 Garbage System Testing - Quick Reference Card

## ✅ What Was Fixed (Critical)

### 1. Hole Encoding: LSB-first → MSB-first ✅
```
BEFORE: bits |= (1 << x)              ❌ WRONG
AFTER:  bits <<= 1; bits |= mask[x]   ✅ CORRECT
```

### 2. Hole Decoding: Direct → MSB-mapping ✅
```
BEFORE: if (bits & (1 << x))          ❌ WRONG
AFTER:  if (bits & (1 << (9-x)))      ✅ CORRECT
```

### 3. moved[][] Tracking: Enhanced ✅
- Now properly initialized from piece lockFootprint
- Clear logging at every step
- Proper reset after line clearing

---

## 🧪 5-Minute Test Protocol

### Test 1: Horizontal I-Piece (30 seconds)
```
1. Start 2-player multiplayer
2. Player 1: Place I-piece horizontally
3. Player 1: Clear 4 lines
4. Check Player 2's board

✅ EXPECTED:
- 3 garbage lines appear (4-1=3)
- Each line has 4 holes
- Holes align with I-piece position

📊 CONSOLE CHECK:
[Physics] holes=[3, 4, 5, 6], solid=[0, 1, 2, 7, 8, 9]
[insertGarbageEntries] holes at columns: [3, 4, 5, 6]
```

### Test 2: Vertical Piece (30 seconds)
```
1. Player 1: Place piece vertically
2. Player 1: Clear 2 lines
3. Check Player 2's board

✅ EXPECTED:
- 1 garbage line (2-1=1)
- 1 hole only
- Much harder to clear!

📊 CONSOLE CHECK:
[Physics] holes=[5], solid=[0, 1, 2, 3, 4, 6, 7, 8, 9]
```

### Test 3: Clean Bonus (1 minute)
```
1. Player 1: Clear entire board
2. Player 1: Clear 3 lines

✅ EXPECTED:
- 4 lines total (2 base + 2 clean)
- First 2 lines: clean pattern
- Last 2 lines: normal holes

📊 CONSOLE CHECK:
[MultiplayerState] Total attack rows: 4 (clean bonus: 2)
```

### Test 4: Cascade (1 minute)
```
1. Player 1: Stack blocks with gaps
2. Player 1: Fill gap, trigger cascade
3. Check garbage holes

✅ EXPECTED:
- Cascade 1: holes from initial piece
- Cascade 2: holes from falling blocks
- Different hole patterns

📊 CONSOLE CHECK:
[Physics] Cascade 1: holes=[...]
[Physics] Cascade 2: holes=[...] (different!)
```

### Test 5: No Attack (30 seconds)
```
1. Player 1: Clear 1 line only

✅ EXPECTED:
- NO garbage sent (1-1=0)
- Player 2's board unchanged

📊 CONSOLE CHECK:
[MultiplayerState] Total attack rows: 0
```

---

## 🎯 Expected Attack Values

| Lines Cleared | Base Attack | Clean Bonus | Total (Clean) |
|--------------|-------------|-------------|---------------|
| 1 (Single)   | 0           | 1           | 1             |
| 2 (Double)   | 1           | 1           | 2             |
| 3 (Triple)   | 2           | 2           | 4             |
| 4 (Quad)     | 3           | 2           | 5             |
| 5            | 4           | 3           | 7             |
| 6            | 5           | 3           | 8             |

**Formula**: `base = depth - 1`, `clean = ⌊(1 + depth) / 2⌋`

---

## 🔍 Console Output Checklist

Open browser console (F12) and look for these messages:

### ✅ Step 1: Piece Lock
```
[Physics] Initial moved[][] tracking: N cells marked from placed piece
```

### ✅ Step 2: Line Clear
```
[Physics] ===== Cascade 1: Processing N cleared lines =====
[Physics] Moved[][] array state before line clear:
[Physics]   Row Y: moved columns = [a, b, c]
```

### ✅ Step 3: Hole Calculation
```
[Physics] Hole masks (TRUE = hole in garbage):
[Physics]   Line 1/N: holes=[a, b, c], solid=[...]
```

### ✅ Step 4: Attack Generation
```
[MultiplayerState] Player P cascade resolved → depth=D, combo=C
[MultiplayerState]   Total attack rows: N (clean bonus: B)
```

### ✅ Step 5: Garbage Insertion
```
[insertGarbageEntries] Inserting N garbage row(s)
[insertGarbageEntries] Row 1/N:
[insertGarbageEntries]   holeMask bits: 0011110000 (240)
[insertGarbageEntries]   holes at columns: [2, 3, 4, 5]
[insertGarbageEntries]   solid at columns: [0, 1, 6, 7, 8, 9]
```

---

## 🚨 Red Flags (What to Look For)

### ❌ BAD: Holes Don't Match Piece Position
```
Piece at:     [3, 4, 5, 6]
Holes shown:  [0, 1, 2, 7]  ← WRONG!
```
**→ Encoding/decoding issue**

### ❌ BAD: Wrong Number of Attack Lines
```
4 lines cleared → 4 garbage lines  ← WRONG! (should be 3)
```
**→ Attack calculation issue (should be depth - 1)**

### ❌ BAD: Clean Patterns Don't Alternate
```
Clean line 1: pattern A
Clean line 2: pattern A  ← WRONG! (should alternate)
```
**→ Clean pattern generation issue**

### ❌ BAD: Cascade Holes Same as Initial
```
Cascade 1: holes=[3, 4, 5, 6]
Cascade 2: holes=[3, 4, 5, 6]  ← SUSPICIOUS! (should differ)
```
**→ moved[][] not being reset properly**

---

## 🎨 Visual Verification

### Hole Pattern Visualization

Use this legend to check garbage visually:
- `_` = Hole (empty, can stack through)
- `█` = Solid (garbage block)

#### Example 1: I-Piece at columns 3-6
```
Encoding: 0b0011110000 = 240
Visual:   ███____███
Holes:    [3, 4, 5, 6]
Solid:    [0, 1, 2, 7, 8, 9]
```

#### Example 2: T-Piece at columns 4-6
```
Encoding: 0b0001110000 = 112
Visual:   ████___███
Holes:    [4, 5, 6]
Solid:    [0, 1, 2, 3, 7, 8, 9]
```

#### Example 3: Clean Pattern (even)
```
Encoding: 0b0001001000 = 72
Visual:   █_███_█████
Holes:    [1, 4]
Solid:    [0, 2, 3, 5, 6, 7, 8, 9]
```

#### Example 4: Clean Pattern (odd)
```
Encoding: 0b1001001001 = 585
Visual:   _██_██_██_
Holes:    [0, 3, 6, 9]
Solid:    [1, 2, 4, 5, 7, 8]
```

---

## 💡 Pro Tips

### Tip 1: Strategic Play
- **Wide pieces** → More holes → Easier garbage for opponent
- **Narrow pieces** → Fewer holes → Harder garbage for opponent
- **Cascades** → Unpredictable holes (from falling blocks)

### Tip 2: Clean Bonus
- Clearing entire board gives bonus attack lines
- Great comeback mechanic!
- Clean patterns are easier than normal garbage

### Tip 3: Debugging
- Open console BEFORE starting game
- Keep console open during gameplay
- Filter by "[Physics]" or "[insertGarbageEntries]"

---

## 📋 Pre-Flight Checklist

Before testing, verify these files were modified:

- [x] `src/core/garbage.js` - Encoding/decoding functions
- [x] `src/core/physics.js` - moved[][] tracking
- [x] `src/core/game.js` - lockFootprint calculation
- [x] `src/core/multiplayer.js` - Attack routing

Check for these keywords in the code:
- [x] `bits <<= 1` (MSB-first encoding)
- [x] `COLS - 1 - x` (MSB-first decoding)
- [x] `lockFootprint` (piece tracking)
- [x] `depth - 1` (attack calculation)

---

## 🏁 Quick Validation Script

Run this in your browser console:

```javascript
// Test encoding/decoding round-trip
function testRoundTrip(columns) {
  const mask = Array(10).fill(false);
  columns.forEach(c => mask[c] = true);

  // Encode
  let bits = 0;
  for (let x = 0; x < 10; x++) {
    bits <<= 1;
    if (mask[x]) bits |= 1;
  }

  // Decode
  const result = [];
  for (let x = 0; x < 10; x++) {
    if (bits & (1 << (9 - x))) result.push(x);
  }

  console.log('Input:', columns);
  console.log('Bits:', bits.toString(2).padStart(10, '0'), `(${bits})`);
  console.log('Output:', result);
  console.log('Match:', JSON.stringify(columns) === JSON.stringify(result) ? '✅' : '❌');
}

// Test cases
testRoundTrip([3, 4, 5, 6]);  // I-piece
testRoundTrip([1, 4]);         // Clean even (72)
testRoundTrip([0, 3, 6, 9]);   // Clean odd (585)
```

Expected output:
```
Input: [3, 4, 5, 6]
Bits: 0011110000 (240)
Output: [3, 4, 5, 6]
Match: ✅
```

---

## ✅ Success Criteria

Your implementation is correct if:

1. ✅ Hole positions match piece positions (inverse mapping)
2. ✅ Attack calculation: depth - 1
3. ✅ Clean bonus: ⌊(1 + depth) / 2⌋
4. ✅ Clean patterns: 72 and 585 (alternating)
5. ✅ Cascade holes differ from initial piece holes
6. ✅ Console logs show correct values at each step

**If all checks pass → 100% Quadra-accurate! 🎉**

---

**Ready to test? Open your game in multiplayer mode and start playing!**
