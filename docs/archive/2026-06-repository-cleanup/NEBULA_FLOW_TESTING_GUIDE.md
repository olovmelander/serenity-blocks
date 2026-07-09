# Nebula Flow Theme - Testing Guide

## Quick Start Testing

### 1. Start the Development Server

```bash
npm run dev
```

Open http://localhost:5173 in your browser.

### 2. Select Nebula Flow Theme

1. Open the game settings (⚙️ icon)
2. Find the "Background Theme" dropdown
3. Select "Nebula Flow" from the list
4. Close settings

You should see the fluid animation start immediately.

---

## Visual Testing Checklist

### Basic Functionality
- [ ] Theme appears in dropdown menu as "Nebula Flow"
- [ ] Theme loads without console errors
- [ ] Fluid animation is visible and animating
- [ ] Background fills entire screen
- [ ] Animation runs smoothly (check FPS)

### Color Schemes
The default scheme is "Cosmic" (purple/blue). To test other schemes, you'll need to modify the theme initialization temporarily or add UI controls.

**Current Default: Cosmic**
- [ ] Purple and blue colors visible
- [ ] Dark space background
- [ ] Pink accents appear occasionally

### Interactivity
- [ ] Move mouse across screen → creates flowing trails
- [ ] Fast mouse movement → more intense effects
- [ ] Slow mouse movement → subtle effects
- [ ] Touch works on mobile/tablet devices

### Game Event Reactions

**Line Clears:**
1. Play the game and clear lines
2. [ ] Single line clear → 1 splat appears
3. [ ] Double line clear → 2 splats appear
4. [ ] Triple/Tetris → 3-4 splats appear

**Combos:**
1. Clear multiple lines in succession quickly
2. [ ] Combo triggers multiple splats in rapid succession
3. [ ] Higher combos → more intense effects

**Piece Lock:**
1. Place pieces normally
2. [ ] Subtle effect on each piece placement
3. [ ] Effect doesn't overwhelm the main gameplay

### Ambient Motion
- [ ] Without any interaction, splats appear automatically every 1-2 seconds
- [ ] Ambient splats are subtle (smaller than interactive ones)
- [ ] Animation continues to feel "alive" even without input

---

## Performance Testing

### Desktop Testing (Target: 60 FPS)

**Test Hardware:**
- GTX 1060 / RX 580 or better
- 1920x1080 resolution

**Steps:**
1. Open browser DevTools (F12)
2. Go to Performance tab
3. Start recording
4. Play game for 30 seconds
5. Stop recording

**Metrics to Check:**
- [ ] Frame rate: ≥ 60 FPS consistently
- [ ] Frame time: ≤ 16.67ms per frame
- [ ] No significant frame drops during gameplay
- [ ] CPU usage: < 30% (one core)
- [ ] GPU usage: Moderate (varies by hardware)

### Mobile Testing (Target: 30 FPS)

**Test Devices:**
- Mid-range Android/iOS device
- 720p or higher resolution

**Steps:**
1. Use remote debugging or on-device browser
2. Monitor FPS using browser DevTools
3. Play for 1 minute

**Metrics to Check:**
- [ ] Frame rate: ≥ 30 FPS consistently
- [ ] No excessive battery drain
- [ ] Device doesn't overheat
- [ ] Game remains playable

### Quality Settings Impact

Test all three quality levels:

**Low Quality:**
1. Set `settings.effectQuality = 'Low'` in console
2. Reload theme
3. [ ] Simulation still runs
4. [ ] Visual quality reduced but acceptable
5. [ ] FPS improves on lower-end hardware
6. [ ] No bloom effect

**Medium Quality (Default):**
- [ ] Good balance of quality and performance
- [ ] Light bloom effect
- [ ] Smooth animation

**High Quality:**
1. Set `settings.effectQuality = 'High'` in console
2. Reload theme
3. [ ] Enhanced visual quality
4. [ ] Full bloom effect
5. [ ] May impact FPS on lower-end hardware

---

## Memory Testing

### Check for Memory Leaks

**Test Procedure:**
1. Open Chrome DevTools → Memory tab
2. Take heap snapshot
3. Switch to Nebula Flow theme
4. Wait 10 seconds
5. Take another heap snapshot
6. Switch to different theme
7. Wait 5 seconds
8. Take final heap snapshot
9. Switch back to Nebula Flow
10. Repeat steps 3-8 ten times

**Expected Results:**
- [ ] Memory usage stabilizes (no continuous growth)
- [ ] Memory is released when switching away from theme
- [ ] No detached DOM nodes accumulate
- [ ] WebGL resources properly cleaned up

### WebGL Resource Cleanup

**Test in Console:**
```javascript
// Get WebGL context info
const canvas = document.querySelector('#nebula-flow-canvas');
const gl = canvas.getContext('webgl');
const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
console.log('Renderer:', gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL));

// Check context loss handling
canvas.addEventListener('webglcontextlost', (e) => {
    console.log('Context lost!');
});

canvas.addEventListener('webglcontextrestored', (e) => {
    console.log('Context restored!');
});
```

**Checks:**
- [ ] No "too many contexts" errors
- [ ] Context loss handled gracefully (if triggered)
- [ ] No orphaned frame buffers or textures

---

## Compatibility Testing

### Browser Testing

Test in all major browsers:

**Chrome:**
- [ ] Version 56+ works
- [ ] Animation smooth
- [ ] No console errors

**Firefox:**
- [ ] Version 51+ works
- [ ] Animation smooth
- [ ] No console errors

**Safari:**
- [ ] Version 15+ works
- [ ] Animation smooth
- [ ] No console errors (check for WebGL warnings)

**Edge:**
- [ ] Version 79+ works
- [ ] Animation smooth
- [ ] No console errors

### WebGL Support Detection

**Test Fallback:**
1. Disable WebGL in browser flags
2. Reload page
3. Select Nebula Flow theme
4. [ ] Console shows error message
5. [ ] Game still playable (background may be solid color)
6. [ ] No JavaScript errors break the game

---

## Integration Testing

### Theme Switching

**Test Sequence:**
1. Start with different theme (e.g., Aurora)
2. Switch to Nebula Flow
3. [ ] Previous theme stops completely
4. [ ] Nebula Flow starts cleanly
5. Switch to another theme
6. [ ] Nebula Flow stops completely
7. [ ] Canvas removed from DOM
8. [ ] No lingering event listeners

**Rapid Switching:**
1. Rapidly switch between themes 10+ times
2. [ ] No errors in console
3. [ ] Memory doesn't leak
4. [ ] Each theme works correctly

### Multiplayer Mode

**Test Procedure:**
1. Start multiplayer game
2. Select Nebula Flow theme
3. [ ] Theme works in multiplayer
4. [ ] No conflicts with multiplayer rendering
5. [ ] Performance acceptable with multiple boards
6. [ ] Background visible behind all game boards

### Window Resize

**Test Procedure:**
1. Load theme at full screen
2. Resize browser window smaller
3. [ ] Canvas resizes correctly
4. [ ] Animation continues smoothly
5. [ ] No visual glitches
6. Resize back to full screen
7. [ ] Canvas adjusts properly
8. [ ] Simulation quality maintained

---

## Edge Cases

### Low-End Hardware

**Test on:**
- Integrated graphics (Intel HD 4000 or similar)
- 4GB RAM or less
- Old mobile devices (3+ years old)

**Checks:**
- [ ] Theme still loads
- [ ] May run at lower FPS (20-30)
- [ ] Game remains playable
- [ ] Quality auto-adjusts if implemented

### Very High Resolution

**Test at:**
- 4K (3840x2160)
- Ultrawide (3440x1440)

**Checks:**
- [ ] Simulation scales properly
- [ ] FPS may be lower but acceptable
- [ ] Visual quality maintained
- [ ] No aspect ratio issues

### Background Effects Setting

**Test with setting disabled:**
1. Set `settings.backgroundComboEffects = false`
2. Play game
3. [ ] Line clears don't trigger effects
4. [ ] Combos don't trigger effects
5. [ ] Piece locks don't trigger effects
6. [ ] Ambient motion still works
7. [ ] Mouse interaction still works

---

## Debugging Tools

### Console Commands

Open browser console and try these:

```javascript
// Get theme instance
const theme = window.themeManager.activeTheme;

// Check if it's Nebula Flow
console.log(theme.name); // Should output: "nebula-flow"

// Check simulator
console.log(theme.simulator); // Should show FluidSimulator instance

// Add a test splat
theme.addRandomSplat(true); // Large splat

// Change color scheme (requires code modification)
theme.setColorScheme('ocean'); // Switch to ocean colors

// Check if active
console.log(theme.isActive); // Should be true

// Manually trigger game events
eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 4 });
eventBus.emit(EVENTS.COMBO, { comboCount: 10 });
```

### Performance Monitoring

```javascript
// Monitor frame rate
let frameCount = 0;
let lastTime = performance.now();

const measureFPS = () => {
    frameCount++;
    const now = performance.now();

    if (now - lastTime >= 1000) {
        console.log(`FPS: ${frameCount}`);
        frameCount = 0;
        lastTime = now;
    }

    requestAnimationFrame(measureFPS);
};

measureFPS();
```

---

## Known Limitations

### Current Implementation

1. **Color Scheme Selection**: Currently hardcoded to 'cosmic'. UI controls not yet implemented.
2. **Quality Auto-Detection**: Uses game settings, but doesn't auto-detect hardware capability.
3. **WebGL Fallback**: Shows error but no graceful static background fallback yet.

### Expected Behavior

- Simulation resolution is relatively low (128x128) for performance
- Pressure solver uses only 3-5 iterations (trade-off for speed)
- No vorticity confinement (advanced feature)
- No curl noise (would be more GPU intensive)

---

## Success Criteria

### Must Pass ✓

- [ ] Theme loads without errors
- [ ] Fluid animation visible and smooth
- [ ] Mouse interaction works
- [ ] Game events trigger effects
- [ ] No memory leaks
- [ ] 60 FPS on target desktop hardware
- [ ] 30 FPS on target mobile hardware
- [ ] Theme switching works cleanly
- [ ] No console errors during normal use

### Nice to Have

- [ ] Consistent 60 FPS even on medium hardware
- [ ] Works on older browsers
- [ ] Graceful degradation on very low-end hardware
- [ ] Additional color schemes accessible via UI

---

## Reporting Issues

If you find bugs or performance issues:

1. **Capture Details:**
   - Browser and version
   - OS and version
   - Graphics card
   - Screen resolution
   - Quality setting used
   - Console error messages

2. **Steps to Reproduce:**
   - Exact actions taken
   - When issue occurs
   - Frequency (always, sometimes, rare)

3. **Expected vs Actual:**
   - What should happen
   - What actually happens

4. **Screenshots/Video:**
   - Visual issues benefit from screenshots
   - Performance issues benefit from DevTools screenshots

---

## Next Steps After Testing

1. **Performance Optimization:**
   - Profile and optimize shader code
   - Adjust default quality settings
   - Implement auto-quality detection

2. **Feature Additions:**
   - UI controls for color scheme selection
   - More color schemes
   - User-configurable parameters

3. **Polish:**
   - Better WebGL fallback
   - Loading indicator
   - Smooth theme transitions

4. **Documentation:**
   - User-facing documentation
   - API documentation for color scheme system
   - Performance tuning guide
