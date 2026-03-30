# Single-Player Canvas Refactor Plan
## Making Single-Player Match FFA Multiplayer Visual Design

**Goal:** Refactor the single-player game canvas container to match the beautiful, modern design of the FFA multiplayer canvas, while preserving all game mechanics and visual effects.

---

## 📊 Current State Analysis

### Single-Player (Current)
**Container:** `#phaser-game-container`
- **Size:** Fixed 300x600px
- **Border:** 4px solid purple (#8b5cf6)
- **Background:** Semi-transparent dark (rgba(26, 26, 46, 0.5))
- **Glow:** Triple-layered purple box-shadow
- **Layout:** Sits in `.game-area` with left sidebar
- **Padding:** None
- **Positioning:** Static, centered with `margin: 0 auto`

### FFA Multiplayer (Target Design)
**Container:** `.main-canvas-container`
- **Size:** Dynamically calculated based on viewport (responsive)
- **Border:** 2px solid blue-purple (rgba(102, 126, 234, 0.5))
- **Background:** Semi-transparent dark (rgba(0, 0, 0, 0.6)) with backdrop-filter blur
- **Glow:** Softer, modern shadow (0 8px 32px rgba(102, 126, 234, 0.3))
- **Layout:** Flexbox-centered with generous spacing
- **Padding:** 12px internal padding
- **Border-radius:** 12px rounded corners
- **Positioning:** Flexbox center alignment

---

## ✅ What Must Be Preserved

### Game Mechanics & Rendering
1. ✅ **Phaser rendering system** - No changes to Phaser scenes
2. ✅ **Solid tetromino design** - Keep current block rendering
3. ✅ **All visual effects:**
   - Particle effects (combos, line clears)
   - Line clear flash animations
   - Score popups
   - Piece lock ripple effect
   - Background theme animations
4. ✅ **Game state management** - No changes to game logic
5. ✅ **Controls and input** - All keyboard/touch controls unchanged
6. ✅ **Stats display** - Left sidebar stats panel remains functional

### Content & Features
1. ✅ **Next pieces display** - Keep existing next queue
2. ✅ **Settings button** - Keep ⚙️ button functional
3. ✅ **High scores** - All scoring/tracking preserved
4. ✅ **Modal system** - Game over, start, settings modals unchanged

---

## 🎨 What Will Change

### Visual Design Only
1. **Container styling** - Match multiplayer's modern look
2. **Border design** - Switch from purple glow to blue-purple modern border
3. **Spacing** - Better padding and margins like multiplayer
4. **Size calculation** - Make canvas responsive to viewport
5. **Layout positioning** - Better centering and flexbox alignment

---

## 📋 Implementation Plan

### Phase 1: CSS Refactoring
**Goal:** Update container styles to match multiplayer design

#### Step 1.1: Update `#phaser-game-container` Base Styles
**File:** `public/styles/main.css`

```css
/* BEFORE (Current) */
#phaser-game-container {
    border: 4px solid #8b5cf6;
    border-radius: 12px;
    background: rgba(26, 26, 46, 0.5);
    box-shadow: 0 0 30px rgba(139, 92, 246, 0.5), 
                0 0 60px rgba(139, 92, 246, 0.3), 
                0 0 90px rgba(139, 92, 246, 0.1);
    display: block;
    position: relative;
    overflow: hidden;
    box-sizing: content-box;
    height: 600px;
    width: 300px;
    margin: 0 auto;
}

/* AFTER (Target) */
#phaser-game-container {
    /* Match multiplayer container design */
    position: relative;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(10px);
    border-radius: 12px;
    padding: 12px;
    border: 2px solid rgba(102, 126, 234, 0.5);
    box-shadow: 0 8px 32px rgba(102, 126, 234, 0.3);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    box-sizing: border-box;
    /* Size will be calculated dynamically in JS */
}
```

#### Step 1.2: Update Canvas Rendering
**File:** `public/styles/main.css`

```css
/* BEFORE */
#phaser-game-container canvas {
    display: block !important;
    width: 300px !important;
    height: 600px !important;
    image-rendering: crisp-edges;
    image-rendering: -moz-crisp-edges;
    image-rendering: pixelated;
    position: relative;
    margin: 0 !important;
    padding: 0;
}

/* AFTER */
#phaser-game-container canvas {
    display: block !important;
    image-rendering: crisp-edges;
    image-rendering: -moz-crisp-edges;
    image-rendering: pixelated;
    /* Size calculated dynamically in JS */
}
```

#### Step 1.3: Update Game Area Layout
**File:** `public/styles/main.css`

```css
/* Update .game-area to better center content like multiplayer */
.game-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 10px; /* Reduced padding like multiplayer */
    gap: 12px; /* Add spacing between elements */
}
```

---

### Phase 2: JavaScript Size Calculation
**Goal:** Make canvas size responsive like multiplayer

#### Step 2.1: Create Dynamic Sizing Function
**File:** `src/main.js`

Add new method in the main game initialization:

```javascript
/**
 * Calculate optimal canvas size for single-player
 * Matches the FFA multiplayer sizing logic
 */
function calculateSinglePlayerCanvasSize() {
    // Account for UI elements:
    // - Stats panel header: ~60px
    // - Next pieces preview: ~120px
    // - Container padding: ~50px
    // - Main area padding: ~40px
    const UI_OVERHEAD_HEIGHT = 270;
    const availableHeight = window.innerHeight - UI_OVERHEAD_HEIGHT;
    
    // Account for sidebar (typically ~350px) plus margins
    const SIDEBAR_WIDTH = 400;
    const availableWidth = window.innerWidth - SIDEBAR_WIDTH;
    
    // Calculate block size (COLS=10, ROWS=20)
    const blockSizeFromHeight = Math.floor(availableHeight / 20);
    const blockSizeFromWidth = Math.floor(availableWidth / 10);
    
    // Use smaller dimension, with min 25px and max 60px per block
    const blockSize = Math.max(25, Math.min(blockSizeFromHeight, blockSizeFromWidth, 60));
    
    return {
        width: 10 * blockSize,
        height: 20 * blockSize,
        blockSize: blockSize
    };
}
```

#### Step 2.2: Apply Size on Initialization
**File:** `src/main.js` - Update `initializeCanvas()` or similar

```javascript
initializeCanvas() {
    const container = document.getElementById('phaser-game-container');
    
    if (!container) {
        console.error('❌ Game container not found');
        return;
    }
    
    // Calculate responsive size
    const size = calculateSinglePlayerCanvasSize();
    
    // Apply size to container
    container.style.width = `${size.width + 24}px`; // +24 for 12px padding on each side
    container.style.height = `${size.height + 24}px`;
    
    // Update Phaser config if needed
    if (this.phaserGame && this.phaserGame.config) {
        this.phaserGame.scale.resize(size.width, size.height);
    }
    
    console.log(`📐 Single-player canvas: ${size.width}x${size.height} (${size.blockSize}px blocks)`);
}
```

#### Step 2.3: Add Resize Handler
**File:** `src/main.js`

```javascript
/**
 * Setup window resize handler for responsive canvas
 */
setupResizeHandler() {
    let resizeTimeout;
    
    const handleResize = () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            console.log('🔄 Window resized, recalculating canvas...');
            this.initializeCanvas();
        }, 250);
    };
    
    window.addEventListener('resize', handleResize);
    
    // Store for cleanup
    this._resizeHandler = handleResize;
}

/**
 * Cleanup resize handler
 */
cleanupResizeHandler() {
    if (this._resizeHandler) {
        window.removeEventListener('resize', this._resizeHandler);
        this._resizeHandler = null;
    }
}
```

---

### Phase 3: Layout Improvements
**Goal:** Better spacing and visual hierarchy

#### Step 3.1: Improve Next Pieces Container
**File:** `public/styles/main.css`

```css
/* Update next queue to match multiplayer style */
#next-queue-container {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 12px;
    padding: 8px 16px;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 8px;
    border: 1px solid rgba(102, 126, 234, 0.2);
    margin-bottom: 12px;
}

.next-queue-piece {
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(102, 126, 234, 0.25);
    border-radius: 4px;
    padding: 4px;
    transition: all 0.2s ease;
}

.next-queue-piece.highlight {
    background: rgba(102, 126, 234, 0.15);
    border: 2px solid rgba(102, 126, 234, 0.5);
    box-shadow: 0 0 20px rgba(102, 126, 234, 0.3);
}
```

#### Step 3.2: Improve Sidebar Styling
**File:** `public/styles/main.css`

```css
/* Update sidebar to complement new canvas design */
.sidebar {
    background: rgba(18, 23, 31, 0.85);
    backdrop-filter: blur(10px);
    border-right: 2px solid rgba(102, 126, 234, 0.3);
    /* Keep existing layout */
}

.panel {
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(102, 126, 234, 0.2);
    /* Keep existing spacing */
}

.panel h2 {
    background: rgba(102, 126, 234, 0.1);
    border-bottom: 1px solid rgba(102, 126, 234, 0.3);
    /* Keep existing text styles */
}
```

---

## 📁 Files to Modify

### CSS Files
1. **`public/styles/main.css`**
   - `#phaser-game-container` - Container styling
   - `#phaser-game-container canvas` - Canvas styling
   - `.game-area` - Layout improvements
   - `#next-queue-container` - Next pieces styling
   - `.sidebar` - Optional sidebar updates
   - `.panel` - Optional panel styling

### JavaScript Files
2. **`src/main.js`**
   - Add `calculateSinglePlayerCanvasSize()` function
   - Update `initializeCanvas()` method
   - Add `setupResizeHandler()` method
   - Add `cleanupResizeHandler()` method
   - Update Phaser initialization to use dynamic sizing

### HTML Files
3. **`public/index.html`** (Optional)
   - May need minor structure tweaks if needed
   - Mostly CSS changes, HTML structure is fine

---

## 🧪 Testing Checklist

### Visual Testing
- [ ] Container has proper border and shadow (blue-purple, not purple)
- [ ] Container has blur backdrop effect
- [ ] Canvas is properly centered in container
- [ ] Canvas has 12px padding around it
- [ ] Border radius is 12px and looks smooth
- [ ] Glow effect is subtle and modern

### Responsive Testing
- [ ] Canvas size adjusts when window is resized
- [ ] Canvas never exceeds viewport height
- [ ] Canvas never exceeds viewport width (accounting for sidebar)
- [ ] Canvas maintains 10:20 aspect ratio
- [ ] Minimum size is enforced (blocks ≥ 25px)
- [ ] Maximum size is capped (blocks ≤ 60px)

### Gameplay Testing
- [ ] All controls work (keyboard, touch, click)
- [ ] Pieces move correctly
- [ ] Pieces rotate correctly
- [ ] Hard drop works
- [ ] Soft drop works
- [ ] Line clearing works
- [ ] Scoring works
- [ ] Level progression works

### Visual Effects Testing
- [ ] Particle effects render correctly
- [ ] Line clear flash animations work
- [ ] Score popups appear in correct position
- [ ] Piece lock ripple effect works
- [ ] Background theme animations unaffected
- [ ] Combo effects work
- [ ] All colors and gradients preserved

### UI Testing
- [ ] Next pieces display correctly
- [ ] Stats panel updates correctly
- [ ] Settings button works
- [ ] Game over modal appears correctly
- [ ] High scores modal works
- [ ] Start modal works

### Cross-Browser Testing
- [ ] Chrome/Edge (Chromium)
- [ ] Firefox
- [ ] Safari
- [ ] Mobile browsers (if applicable)

### Performance Testing
- [ ] No FPS drops from styling changes
- [ ] Resize handler doesn't cause lag
- [ ] Backdrop-filter performs well
- [ ] No layout thrashing

---

## 🎯 Success Criteria

### Visual Match (Primary Goal)
✅ Single-player canvas container looks identical to FFA multiplayer:
- Same border style (2px, blue-purple)
- Same background (dark + blur)
- Same shadow (soft modern glow)
- Same padding (12px internal)
- Same border-radius (12px)

### Responsiveness (Secondary Goal)
✅ Canvas size adapts to viewport like multiplayer:
- Calculates optimal size on load
- Recalculates on window resize
- Respects min/max constraints
- Maintains aspect ratio

### Preservation (Critical)
✅ All game mechanics and effects preserved:
- Solid tetromino rendering unchanged
- All particle effects work
- All animations work
- All controls work
- All scoring/tracking works

---

## 🚀 Implementation Order

1. **Phase 1 - CSS** (1-2 hours)
   - Update container styles
   - Update canvas styles
   - Update layout styles
   - Test visually

2. **Phase 2 - JavaScript** (2-3 hours)
   - Add size calculation function
   - Update initialization
   - Add resize handler
   - Test responsiveness

3. **Phase 3 - Polish** (1 hour)
   - Improve next pieces styling
   - Adjust sidebar if needed
   - Fine-tune spacing
   - Final testing

**Total Estimated Time:** 4-6 hours

---

## 📝 Notes & Considerations

### Why This Approach?
- **Minimal risk:** Only changes styling, not game logic
- **Proven design:** Reusing working multiplayer styles
- **User benefit:** Better visual consistency across modes
- **Modern look:** Cleaner, more polished appearance

### Potential Challenges
1. **Phaser Integration**
   - Phaser config may need updates for dynamic sizing
   - Scale manager needs to be aware of container changes
   - Solution: Use Phaser's `scale.resize()` method

2. **Sidebar Interaction**
   - Sidebar width affects available space
   - Need to account for it in calculations
   - Solution: Subtract sidebar width from available width

3. **Performance**
   - Backdrop-filter can be expensive
   - Resize handler needs debouncing
   - Solution: 250ms debounce + optimize filters

### Alternative Approaches Considered
1. **Wrap in new container:** ✗ More complex, unnecessary DOM changes
2. **Use React/Vue:** ✗ Over-engineering, current system works
3. **CSS-only:** ✗ Can't achieve responsive sizing without JS
4. **Selected approach:** ✓ Minimal changes, proven design, clean implementation

---

## 🔗 Related Documents
- `PROJECT_COMPLETE_SUMMARY.md` - Overall project status
- `FFA_MULTIPLAYER_FIX_PLAN.md` - Multiplayer implementation details
- `public/styles/multiplayer-ui.css` - Reference for multiplayer styles

---

## ✅ Completion Checklist

- [x] All CSS changes applied
- [x] All JavaScript changes applied
- [ ] All tests passed (ready for testing)
- [ ] Visual QA complete (ready for visual review)
- [ ] Performance validated (pending user validation)
- [x] Documentation updated
- [x] Ready for user testing

---

## 🎉 Implementation Summary

All three phases have been successfully completed:

### Phase 1 - CSS Refactoring ✅
- Updated `#phaser-game-container` with modern FFA multiplayer styling
- Applied backdrop-filter blur effect
- Changed from purple to blue-purple border
- Updated canvas rendering styles
- Improved game area layout with flexbox

### Phase 2 - JavaScript Size Calculation ✅  
- Added `calculateSinglePlayerCanvasSize()` method
- Updated `initializeCanvas()` to use dynamic sizing
- Added `setupResizeHandler()` and `cleanupResizeHandler()` methods
- Integrated resize handler into app initialization
- Canvas now responds to window resize events

### Phase 3 - Layout Improvements ✅
- Updated next pieces container with modern styling
- Improved sidebar with complementary design
- Enhanced panel headers with blue-purple accents
- All styling now matches FFA multiplayer aesthetic

**All code changes are complete and ready for testing!**

---

**Created:** 2025-01-18  
**Status:** Implementation Complete - Ready for Testing  
**Priority:** Medium  
**Estimated Time:** 4-6 hours  
**Actual Time:** ~2 hours (implementation)
**Complexity:** Low-Medium  
**Risk Level:** Low

