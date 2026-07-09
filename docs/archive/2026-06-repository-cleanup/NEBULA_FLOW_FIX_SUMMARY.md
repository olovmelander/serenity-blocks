# Nebula Flow - White Flickering Fix

## Problem
The theme is showing white epilepsy-like flickering instead of smooth, colorful fluid nebulas.

## Root Cause
The current implementation has been heavily modified with complex envelope-based splat injection that schedules many splats over time. This is causing:
1. Too many concurrent splats being added
2. Colors getting oversaturated (reaching white [1,1,1])
3. Rapid flickering from overlapping injections

## Solution Options

### Option 1: Reduce Splat Frequency (Quick Fix)
Modify the ambient motion to add splats less frequently and with lower intensity.

### Option 2: Simplify Injection (Recommended)
Replace the complex envelope system with simple, single splats.

### Option 3: Clamp Color Values
Ensure colors never exceed safe thresholds in the simulator.

## Recommended Fix

I'll implement **Option 2 + 3**: Simplify the injection system and add color clamping.

### Changes Needed:

1. **Simplify `addRandomSplat()`** - Remove envelope system, use single splats
2. **Reduce ambient frequency** - 5-8 seconds between splats instead of 3-5
3. **Lower color intensity** - Reduce color values to 0.3-0.6 range instead of near 1.0
4. **Add color clamping** - Ensure splat colors are clamped before injection
5. **Reduce initial splats** - Start with 2-3 splats instead of 5+

### Testing

After applying fixes:
1. Background should show gentle, slow-moving colored nebulas
2. Colors should be purple, blue, pink (cosmic scheme)
3. No white flickering
4. Smooth, continuous motion
5. Mouse movement adds subtle trails

## Implementation

Would you like me to:
A) Apply the simplified version (removes complexity but ensures it works)
B) Try to fix the current complex version (keep envelope system but debug it)
C) Create a hybrid (simplified splats with optional envelope for special events)

**Recommendation: Option A** - Get it working first, then we can add sophistication later.
