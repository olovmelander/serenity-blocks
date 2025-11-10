# Infinity Mode Minimap - Visual Improvements Implementation Plan

## Overview

This document outlines the implementation plan for 5 high-impact, simple visual improvements to the Infinity Mode minimap. These enhancements will add polish, life, and visual feedback to the minimap while maintaining all existing functionality.

**Target File**: `src/ui/infinity/InfinityMinimap.js`

**Design Philosophy**: Subtle, polished enhancements that add depth and interactivity without overwhelming the clean, technical aesthetic.

---

## Goals

- ✨ Add life and motion through subtle animations
- 🎨 Enhance visual feedback based on game state
- 🖱️ Improve interactive feel with better hover states
- 📐 Add depth through textures and layering
- 🎯 Maintain 100% of existing functionality
- ⚡ Keep performance impact minimal

---

## Improvement #1: Pulsing Viewport Border Glow

### What It Does
The green viewport indicator border will pulse gently, creating a "breathing" effect that draws attention to the player's current view position.

### Why It's Impactful
- Makes the viewport feel alive and active
- Subtly guides the player's eye to their current position
- Adds professional polish with minimal code

### Implementation Approach

**Method**: CSS keyframe animation applied to the viewport border

**Location**: Lines 368-390 in `InfinityMinimap.js` (viewport rendering)

### Detailed Steps

1. **Add CSS Animation Keyframes** (in `createMinimapContainer()` method around line 85):

```javascript
// Add to the <style> block in the container creation
const styleBlock = `
  @keyframes viewportPulse {
    0%, 100% {
      box-shadow: 0 0 8px rgba(0, 255, 0, 0.6),
                  0 0 16px rgba(0, 255, 0, 0.3),
                  inset 0 0 8px rgba(0, 255, 0, 0.2);
    }
    50% {
      box-shadow: 0 0 12px rgba(0, 255, 0, 0.9),
                  0 0 24px rgba(0, 255, 0, 0.5),
                  inset 0 0 12px rgba(0, 255, 0, 0.4);
    }
  }
`;
```

2. **Modify Viewport Rendering** (around line 368):

Currently, the viewport is drawn on canvas. We need to add a DOM overlay for the animated border.

```javascript
// Create viewport overlay element (add to constructor)
this.viewportOverlay = document.createElement('div');
this.viewportOverlay.style.position = 'absolute';
this.viewportOverlay.style.pointerEvents = 'none';
this.viewportOverlay.style.border = '2px solid #00ff00';
this.viewportOverlay.style.borderRadius = '4px';
this.viewportOverlay.style.animation = 'viewportPulse 2s ease-in-out infinite';
this.viewportOverlay.style.transition = 'all 0.3s ease';
this.container.appendChild(this.viewportOverlay);
```

3. **Update Position in render()** (modify around line 368):

```javascript
// In the render method, update viewport overlay position
updateViewportOverlay(viewportRect) {
    if (!this.viewportOverlay) return;

    const padding = 12; // Container padding
    this.viewportOverlay.style.left = `${viewportRect.x + padding}px`;
    this.viewportOverlay.style.top = `${viewportRect.y + padding}px`;
    this.viewportOverlay.style.width = `${viewportRect.width}px`;
    this.viewportOverlay.style.height = `${viewportRect.height}px`;
}
```

**Alternative Simpler Approach**: If DOM overlay adds complexity, use canvas-based glow with requestAnimationFrame:

```javascript
// In render() method, add pulsing glow to viewport border
drawViewportWithPulse(ctx, viewportRect) {
    const time = Date.now() / 1000;
    const pulse = Math.sin(time * Math.PI) * 0.3 + 0.7; // Oscillates 0.7-1.0

    ctx.strokeStyle = `rgba(0, 255, 0, ${pulse})`;
    ctx.lineWidth = 2;
    ctx.shadowBlur = 8 + (pulse * 8); // 8-16px blur
    ctx.shadowColor = `rgba(0, 255, 0, ${pulse * 0.8})`;
    ctx.strokeRect(viewportRect.x, viewportRect.y, viewportRect.width, viewportRect.height);

    // Reset shadow
    ctx.shadowBlur = 0;
}
```

### Performance Considerations
- CSS animation: Nearly zero CPU cost (GPU accelerated)
- Canvas-based: ~0.1ms per frame (negligible)

### Testing Checklist
- [ ] Pulse animation runs smoothly at 60fps
- [ ] Animation doesn't affect viewport click detection
- [ ] Glow is visible but not distracting
- [ ] Works on all screen sizes

---

## Improvement #2: Enhanced Hover State

### What It Does
When hovering over the minimap, it will:
- Scale up slightly (1.02x)
- Brighten the border glow
- Show enhanced depth with expanded shadows

### Why It's Impactful
- Provides clear interactive feedback
- Makes the minimap feel more responsive
- Subtle enough not to be jarring

### Implementation Approach

**Method**: CSS transitions and transforms on hover

**Location**: Lines 85-100 (container creation) and lines 470-482 (hover handlers)

### Detailed Steps

1. **Enhance Container CSS** (around line 85-100):

```javascript
// Modify the container style
container.style.cssText = `
    position: absolute;
    top: 20px;
    right: 20px;
    width: ${this.width}px;
    height: ${this.height}px;
    background: linear-gradient(135deg, rgba(6, 10, 24, 0.92) 0%, rgba(4, 6, 18, 0.92) 100%);
    border: 2px solid rgba(100, 255, 200, 0.35);
    border-radius: 16px;
    padding: 12px;
    box-shadow:
        0 14px 40px rgba(10, 16, 30, 0.5),
        inset 0 0 24px rgba(60, 255, 200, 0.2);
    z-index: 1000;
    cursor: pointer;
    opacity: 0.8;
    transform-origin: top right;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
`;
```

2. **Add Hover Styles** (create a style element):

```javascript
// Add in constructor after creating container
const hoverStyle = document.createElement('style');
hoverStyle.textContent = `
    .infinity-minimap:hover {
        opacity: 1 !important;
        transform: scale(1.02) !important;
        border-color: rgba(100, 255, 200, 0.65) !important;
        box-shadow:
            0 18px 50px rgba(10, 16, 30, 0.7),
            inset 0 0 32px rgba(60, 255, 200, 0.35),
            0 0 40px rgba(100, 255, 200, 0.2) !important;
    }

    .infinity-minimap:active {
        transform: scale(0.98) !important;
    }
`;
document.head.appendChild(hoverStyle);

// Add class to container
container.classList.add('infinity-minimap');
```

3. **Optional: Add Cursor Tracking Glow** (advanced):

```javascript
// In constructor
this.container.addEventListener('mousemove', (e) => {
    if (!this.isHovering) return;

    const rect = this.container.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    this.container.style.background = `
        radial-gradient(circle at ${x}% ${y}%,
            rgba(60, 255, 200, 0.15) 0%,
            rgba(6, 10, 24, 0.92) 50%),
        linear-gradient(135deg, rgba(6, 10, 24, 0.92) 0%, rgba(4, 6, 18, 0.92) 100%)
    `;
});

this.container.addEventListener('mouseleave', () => {
    this.container.style.background =
        'linear-gradient(135deg, rgba(6, 10, 24, 0.92) 0%, rgba(4, 6, 18, 0.92) 100%)';
});
```

### Performance Considerations
- CSS transforms are GPU accelerated
- Mousemove tracking: ~0.05ms per event (only when hovering)

### Testing Checklist
- [ ] Smooth scale transition on hover
- [ ] No layout shift affecting nearby elements
- [ ] Works with touch devices (optional)
- [ ] Active state (click) provides feedback

---

## Improvement #3: Dynamic Border Color

### What It Does
The minimap container border color shifts based on height progress:
- **Rows 0-250**: Cyan-green (current)
- **Rows 250-500**: Green
- **Rows 500-750**: Yellow-green
- **Rows 750-1000**: Orange-yellow

### Why It's Impactful
- Provides subtle game state feedback
- Adds visual variety during gameplay
- Creates sense of progression

### Implementation Approach

**Method**: Dynamic CSS color calculation based on `topRow` value

**Location**: In `render()` method, update container border color

### Detailed Steps

1. **Create Color Interpolation Function** (add as class method):

```javascript
/**
 * Calculate border color based on current progress
 * @param {number} topRow - Current top row (0 = goal, 1000 = start)
 * @returns {string} RGB color string
 */
getBorderColor(topRow) {
    // Invert so higher achievement = higher value
    const progress = (1000 - topRow) / 1000; // 0.0 to 1.0

    // Define color stops
    const colors = [
        { pos: 0.00, color: [100, 255, 200] }, // Cyan-green (start)
        { pos: 0.25, color: [50, 255, 150] },  // Green
        { pos: 0.50, color: [200, 255, 100] }, // Yellow-green
        { pos: 0.75, color: [255, 200, 50] },  // Orange-yellow
        { pos: 1.00, color: [255, 150, 50] }   // Orange (near goal)
    ];

    // Find surrounding color stops
    let lower = colors[0];
    let upper = colors[colors.length - 1];

    for (let i = 0; i < colors.length - 1; i++) {
        if (progress >= colors[i].pos && progress <= colors[i + 1].pos) {
            lower = colors[i];
            upper = colors[i + 1];
            break;
        }
    }

    // Interpolate between color stops
    const range = upper.pos - lower.pos;
    const rangeProgress = range === 0 ? 0 : (progress - lower.pos) / range;

    const r = Math.round(lower.color[0] + (upper.color[0] - lower.color[0]) * rangeProgress);
    const g = Math.round(lower.color[1] + (upper.color[1] - lower.color[1]) * rangeProgress);
    const b = Math.round(lower.color[2] + (upper.color[2] - lower.color[2]) * rangeProgress);

    return `rgba(${r}, ${g}, ${b}, 0.5)`;
}

/**
 * Get brighter version for glow effect
 */
getBorderGlowColor(topRow) {
    const progress = (1000 - topRow) / 1000;

    const colors = [
        { pos: 0.00, color: [100, 255, 200] },
        { pos: 0.25, color: [50, 255, 150] },
        { pos: 0.50, color: [200, 255, 100] },
        { pos: 0.75, color: [255, 200, 50] },
        { pos: 1.00, color: [255, 150, 50] }
    ];

    let lower = colors[0];
    let upper = colors[colors.length - 1];

    for (let i = 0; i < colors.length - 1; i++) {
        if (progress >= colors[i].pos && progress <= colors[i + 1].pos) {
            lower = colors[i];
            upper = colors[i + 1];
            break;
        }
    }

    const range = upper.pos - lower.pos;
    const rangeProgress = range === 0 ? 0 : (progress - lower.pos) / range;

    const r = Math.round(lower.color[0] + (upper.color[0] - lower.color[0]) * rangeProgress);
    const g = Math.round(lower.color[1] + (upper.color[1] - lower.color[1]) * rangeProgress);
    const b = Math.round(lower.color[2] + (upper.color[2] - lower.color[2]) * rangeProgress);

    return `rgba(${r}, ${g}, ${b}, 0.25)`;
}
```

2. **Update Border Color in render()** (add after line 155):

```javascript
// In render() method, after getting topRow
render(buildState, viewport, topRow) {
    // ... existing code ...

    // Update border color based on progress
    const borderColor = this.getBorderColor(topRow);
    const glowColor = this.getBorderGlowColor(topRow);

    this.container.style.borderColor = borderColor;
    this.container.style.boxShadow = `
        0 14px 40px rgba(10, 16, 30, 0.5),
        inset 0 0 24px ${glowColor}
    `;

    // ... rest of render code ...
}
```

3. **Add Smooth Transition** (already added in Improvement #2):

The `transition: all 0.3s` will make color changes smooth.

### Performance Considerations
- Color calculation: ~0.05ms per frame
- CSS updates: Negligible (browser optimized)

### Testing Checklist
- [ ] Color transitions smoothly as you progress
- [ ] Colors are visible against dark background
- [ ] No jarring color jumps
- [ ] Works at all progress levels (0-1000)

---

## Improvement #4: Subtle Background Texture

### What It Does
Adds a faint grid or dot pattern to the build area canvas, creating visual depth and texture without obscuring the build visualization.

### Why It's Impactful
- Adds professional, polished look
- Creates depth perception
- Makes empty areas feel less flat
- Very subtle, doesn't interfere with readability

### Implementation Approach

**Method**: Canvas rendering of grid/dots before drawing build

**Location**: In `render()` method, before drawing build blocks (around line 190)

### Detailed Steps

1. **Create Texture Drawing Function** (add as class method):

```javascript
/**
 * Draw subtle background texture on canvas
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 */
drawBackgroundTexture(ctx) {
    const width = this.canvas.width;
    const height = this.canvas.height;

    // Option A: Dot Grid Pattern
    ctx.fillStyle = 'rgba(100, 255, 200, 0.08)';
    const dotSpacing = 12;
    const dotSize = 1;

    for (let x = dotSpacing; x < width; x += dotSpacing) {
        for (let y = dotSpacing; y < height; y += dotSpacing) {
            ctx.beginPath();
            ctx.arc(x, y, dotSize, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Option B: Grid Lines (Alternative)
    // Uncomment this and comment out Option A to use grid instead
    /*
    ctx.strokeStyle = 'rgba(100, 255, 200, 0.05)';
    ctx.lineWidth = 0.5;
    const gridSpacing = 20;

    // Vertical lines
    for (let x = gridSpacing; x < width; x += gridSpacing) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
    }

    // Horizontal lines
    for (let y = gridSpacing; y < height; y += gridSpacing) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }
    */
}
```

2. **Alternative: Scanline Effect** (futuristic option):

```javascript
/**
 * Draw animated scanline effect
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 */
drawScanlineEffect(ctx) {
    const width = this.canvas.width;
    const height = this.canvas.height;
    const time = Date.now() / 1000;

    // Moving scanline
    const scanlineY = ((time * 50) % height);

    const gradient = ctx.createLinearGradient(0, scanlineY - 30, 0, scanlineY + 30);
    gradient.addColorStop(0, 'rgba(100, 255, 200, 0)');
    gradient.addColorStop(0.5, 'rgba(100, 255, 200, 0.15)');
    gradient.addColorStop(1, 'rgba(100, 255, 200, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, scanlineY - 30, width, 60);

    // Static scanlines
    ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
    for (let y = 0; y < height; y += 4) {
        ctx.fillRect(0, y, width, 2);
    }
}
```

3. **Integrate into render()** (around line 190):

```javascript
render(buildState, viewport, topRow) {
    // ... existing setup code ...

    // Clear canvas
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // NEW: Draw background texture FIRST
    this.drawBackgroundTexture(ctx);
    // OR this.drawScanlineEffect(ctx);

    // ... existing render code for build blocks, viewport, etc. ...
}
```

4. **Performance Optimization** (optional):

Cache the texture on a separate canvas to avoid redrawing every frame:

```javascript
// In constructor
this.textureCanvas = document.createElement('canvas');
this.textureCanvas.width = this.canvas.width;
this.textureCanvas.height = this.canvas.height;
this.generateTexture();

generateTexture() {
    const ctx = this.textureCanvas.getContext('2d');
    // Draw dots/grid on texture canvas
    // ... (same code as drawBackgroundTexture)
}

// In render()
ctx.drawImage(this.textureCanvas, 0, 0);
```

### Performance Considerations
- Dot pattern: ~0.2ms per frame (acceptable)
- Cached texture: ~0.01ms per frame (optimal)
- Scanline effect: ~0.1ms per frame

### Testing Checklist
- [ ] Texture is visible but subtle
- [ ] Doesn't obscure build visualization
- [ ] Runs smoothly at 60fps
- [ ] Looks good at different zoom levels

---

## Improvement #5: Smooth Transitions

### What It Does
Adds CSS transitions to all dynamic properties for smooth, polished animations:
- Opacity changes
- Color shifts
- Position updates
- Scale transformations

### Why It's Impactful
- Makes all interactions feel smooth and professional
- Eliminates jarring instant changes
- Ties all improvements together cohesively
- Very easy to implement with big perceived impact

### Implementation Approach

**Method**: CSS transition properties on all dynamic elements

**Location**: Container and canvas styling (lines 85-112)

### Detailed Steps

1. **Add Global Transition to Container** (already added in Improvement #2):

```javascript
// In container style (line ~85)
transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
```

2. **Add Transition to Canvas** (around line 106):

```javascript
canvas.style.cssText = `
    width: 100%;
    height: 100%;
    background: rgba(10, 18, 40, 0.85);
    border-radius: 10px;
    image-rendering: pixelated;
    image-rendering: -moz-crisp-edges;
    image-rendering: crisp-edges;
    transition: opacity 0.3s ease;
`;
```

3. **Add Transition to Title Label** (around line 121):

```javascript
title.style.cssText = `
    position: absolute;
    top: 0px;
    left: 12px;
    font-family: 'Orbitron', monospace;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.6);
    letter-spacing: 1px;
    text-transform: uppercase;
    pointer-events: none;
    transition: color 0.3s ease, opacity 0.3s ease;
`;
```

4. **Smooth Canvas Drawing Transitions** (optional advanced):

For smooth build block transitions, track previous state and interpolate:

```javascript
// In constructor
this.previousBuildState = new Map();
this.interpolationFactor = 0.15; // Smoothing factor

// In render(), when drawing blocks
drawBuildWithSmoothing(ctx, buildState) {
    buildState.forEach((height, col) => {
        const prevHeight = this.previousBuildState.get(col) || height;

        // Interpolate between previous and current
        const smoothHeight = prevHeight + (height - prevHeight) * this.interpolationFactor;

        // Draw with smooth height
        this.drawColumn(ctx, col, smoothHeight);

        // Update previous state
        this.previousBuildState.set(col, smoothHeight);
    });
}
```

5. **Add Easing to Viewport Movement**:

```javascript
// In constructor
this.viewportTarget = { x: 0, y: 0, width: 0, height: 0 };
this.viewportCurrent = { x: 0, y: 0, width: 0, height: 0 };

// In render(), smooth viewport position
smoothViewportPosition(target) {
    const factor = 0.2; // Adjust for more/less smoothing

    this.viewportCurrent.x += (target.x - this.viewportCurrent.x) * factor;
    this.viewportCurrent.y += (target.y - this.viewportCurrent.y) * factor;
    this.viewportCurrent.width += (target.width - this.viewportCurrent.width) * factor;
    this.viewportCurrent.height += (target.height - this.viewportCurrent.height) * factor;

    return this.viewportCurrent;
}

// Use in render()
const smoothViewport = this.smoothViewportPosition(viewportRect);
// Draw using smoothViewport instead of viewportRect
```

### Easing Functions Reference

```javascript
// Cubic bezier curve options for different feels:
// cubic-bezier(0.4, 0, 0.2, 1)  - Standard Material Design (smooth)
// cubic-bezier(0.25, 0.46, 0.45, 0.94) - Ease-out (decelerating)
// cubic-bezier(0.68, -0.55, 0.265, 1.55) - Back ease (slight overshoot)
// cubic-bezier(0.17, 0.67, 0.83, 0.67) - Ease-in-out (smooth start & end)
```

### Performance Considerations
- CSS transitions: GPU accelerated, ~0ms CPU cost
- JavaScript interpolation: ~0.1ms per frame
- Overall impact: Negligible

### Testing Checklist
- [ ] All color changes are smooth
- [ ] Hover states transition gracefully
- [ ] No stuttering or lag
- [ ] Transitions feel natural, not too slow or fast
- [ ] Works on lower-end devices

---

## Implementation Order

**Recommended sequence** to build features incrementally:

1. **Start with #5 (Smooth Transitions)** - Foundation for all other improvements
2. **Add #2 (Enhanced Hover)** - Quick win, immediately noticeable
3. **Implement #1 (Pulsing Viewport)** - Adds life to the minimap
4. **Add #4 (Background Texture)** - Adds depth
5. **Finish with #3 (Dynamic Border)** - Ties everything together

---

## Testing Strategy

### Visual Testing
1. **Static appearance**: Check at rows 0, 250, 500, 750, 1000
2. **Hover states**: Verify smooth transitions and proper scaling
3. **Animation smoothness**: Watch for 60fps, no stuttering
4. **Color accuracy**: Ensure visibility against dark background
5. **Responsive behavior**: Test at different screen sizes

### Performance Testing
1. **FPS monitoring**: Should maintain 60fps during gameplay
2. **CPU profiling**: Minimap should use <1% CPU
3. **Memory usage**: No memory leaks over extended play
4. **Mobile testing**: Works on lower-powered devices

### Functional Testing
1. **Click detection**: All interactive features still work
2. **Viewport tracking**: Accurately reflects game view
3. **Build visualization**: Correctly displays structure
4. **Milestone indicators**: Properly positioned and colored

### Cross-browser Testing
- Chrome/Edge (Chromium)
- Firefox
- Safari (if applicable)
- Mobile browsers

---

## Code Quality Standards

### Best Practices
- Add JSDoc comments to all new methods
- Use consistent naming conventions
- Keep methods focused and single-purpose
- Avoid magic numbers (use named constants)
- Clean up any debugging code before committing

### Constants to Define

```javascript
// At top of class
static ANIMATION_DURATION = 0.3; // seconds
static PULSE_SPEED = 2.0; // seconds per cycle
static HOVER_SCALE = 1.02;
static TEXTURE_DOT_SPACING = 12;
static TEXTURE_DOT_SIZE = 1;
static TEXTURE_OPACITY = 0.08;
static COLOR_TRANSITION_SPEED = 0.3;
```

---

## Rollback Plan

If any improvement causes issues:

1. **Each improvement is independent** - Can be removed individually
2. **Git branch strategy**: Implement on feature branch, easy to revert
3. **Feature flags**: Optional - add config to enable/disable effects

```javascript
// Optional feature flags in constructor
this.effects = {
    pulsingViewport: true,
    enhancedHover: true,
    dynamicBorder: true,
    backgroundTexture: true,
    smoothTransitions: true
};
```

---

## Expected Results

### Before
- Static, functional minimap
- Instant state changes
- Flat appearance
- Basic hover (opacity only)

### After
- Living, breathing viewport indicator
- Smooth, polished transitions
- Depth and texture
- Responsive, satisfying hover states
- Progressive color feedback

---

## Future Enhancement Ideas

Once these 5 improvements are successful, consider:

1. **Particle effects** on milestone achievements
2. **Combo meter integration** - Glow intensifies during combos
3. **Sound effects** on minimap interactions
4. **Themes integration** - Match minimap colors to active theme
5. **Minimap zoom** - Pinch to zoom on the minimap itself
6. **Danger indicators** - Flash red when near losing condition
7. **Achievement badges** - Small icons for milestones reached
8. **Time-of-day effect** - Background color shifts over gameplay time

---

## Resources & References

### Color Theory
- Use complementary colors for contrast (green viewport vs. orange progress)
- Maintain WCAG AA contrast ratios for visibility
- Test with colorblind simulation tools

### Animation Principles
- Disney's 12 Principles of Animation (especially "Slow In/Out" and "Staging")
- Material Design Motion Guidelines
- Aim for 200-400ms transitions for UI elements

### Performance Guidelines
- Keep paint time under 16ms (60fps)
- Use `will-change` CSS property sparingly
- Prefer CSS animations over JavaScript where possible
- Use `requestAnimationFrame` for canvas animations

### Browser Compatibility
- Test CSS animations in all major browsers
- Provide fallbacks for older browsers (graceful degradation)
- Consider using `@supports` for feature detection

---

## Conclusion

These 5 improvements will transform the minimap from a functional tool into a polished, engaging UI element. Each enhancement is:

- ✅ Simple to implement
- ✅ High visual impact
- ✅ Performance-friendly
- ✅ Maintains existing functionality
- ✅ Adds professional polish

**Estimated implementation time**: 2-4 hours

**Expected performance impact**: <1% CPU, negligible GPU

**User experience improvement**: Significant increase in polish and engagement

---

## Implementation Checklist

- [ ] Set up feature branch
- [ ] Add smooth transitions (Foundation)
- [ ] Implement enhanced hover states
- [ ] Add pulsing viewport border
- [ ] Create background texture
- [ ] Implement dynamic border colors
- [ ] Add JSDoc comments
- [ ] Remove debug code
- [ ] Test performance (60fps)
- [ ] Test functionality (all features work)
- [ ] Test on multiple browsers
- [ ] Test on mobile devices
- [ ] Code review
- [ ] Merge to main branch

---

**Document Version**: 1.0
**Last Updated**: 2025-11-10
**Author**: Claude (Anthropic)
**Target File**: `src/ui/infinity/InfinityMinimap.js`
