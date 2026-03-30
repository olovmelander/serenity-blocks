# Debugging Theme Reactions

## How to Debug

1. **Open the browser console** (F12)
2. **Switch to Misty Lake theme**
3. **Start a game**
4. **Clear some lines**

## What to Look For

### Step 1: Theme Activation
You should see:
```
[MistyLake] Setting up event listeners
[MistyLake] Event listeners set up successfully
```

### Step 2: Line Clear
When you clear lines, you should see:
```
[Main] Emitting LINE_CLEAR event, count: 1
[MistyLake] LINE_CLEAR event received: {lineCount: 1} isActive: true
[MistyLake] onLineClear called with lineCount: 1
[MistyLake] createWaterRipples - container found: true intensity: 1
[MistyLake] Creating 2 ripples
```

### Step 3: Combo
When you get a 2x+ combo, you should see:
```
[Main] Emitting COMBO event, comboCount: 2
[MistyLake] COMBO event received: {comboCount: 2} isActive: true
```

## Common Issues

### Issue 1: "container not found"
**Problem:** `[MistyLake] Ripples container not found!`
**Solution:** The HTML element `misty-lake-ripples` is missing. Check `public/index.html` line ~230

### Issue 2: "isActive: false"
**Problem:** Events received but `isActive: false`
**Solution:** Theme isn't properly activated. Switch to Misty Lake theme using the settings.

### Issue 3: No events at all
**Problem:** No "[Main] Emitting..." messages
**Solution:** Events aren't being emitted. Verify the physics callback is set up correctly.

### Issue 4: Event listeners not set up
**Problem:** No "[MistyLake] Setting up..." message
**Solution:** `createScene()` not being called. Check theme initialization.

## Quick Test

Run this in the browser console after switching to Misty Lake:
```javascript
// Manually trigger a line clear event
eventBus.emit('lineClear', { lineCount: 4 });

// Manually trigger a combo event
eventBus.emit('combo', { comboCount: 3 });
```

You should see ripples and mist appear!

## Verify DOM Elements Exist

Run this in console:
```javascript
console.log('Ripples container:', document.getElementById('misty-lake-ripples'));
console.log('Mist container:', document.getElementById('misty-mist'));
console.log('Fish container:', document.getElementById('misty-fish'));
console.log('Birds container:', document.getElementById('misty-birds'));
```

All should return DOM elements, not `null`.
