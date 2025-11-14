# Theme-Specific Tetromino Visual Styles System

**Status**: Planning Phase
**Version**: 1.0
**Last Updated**: 2025-01-13

---

## Table of Contents

1. [Overview](#overview)
2. [Goals & Requirements](#goals--requirements)
3. [Architecture Design](#architecture-design)
4. [Implementation Plan](#implementation-plan)
5. [API Reference](#api-reference)
6. [Adding New Theme Styles](#adding-new-theme-styles)
7. [Testing Strategy](#testing-strategy)
8. [Performance Considerations](#performance-considerations)
9. [Future Enhancements](#future-enhancements)

---

## Overview

### Current State

The game currently uses a **fixed color palette** for tetromino pieces defined in `src/core/constants.js`:

```javascript
export const COLORS = {
    I: '#00ff00', // Green
    O: '#ff9900', // Orange
    T: '#0000ff', // Blue
    S: '#00ffff', // Cyan
    Z: '#ff0000', // Red
    J: '#ffff00', // Yellow
    L: '#cc00cc', // Purple
    GARBAGE: '#808080', // Gray
};
```

These colors are universally applied regardless of the active theme, creating a disconnect between beautiful themed backgrounds and generic tetromino colors.

### Proposed System

Create an **extensible theming system** that allows themes to optionally define custom tetromino visual styles including:
- Custom color palettes
- Rendering styles (solid, gradient, glowing)
- Visual effects (glow radius, outlines, pulsating)
- Per-renderer optimizations (Canvas vs Phaser)

**Key Principle**: Opt-in system where themes *can* provide custom styles but aren't required to. Graceful fallback to default colors ensures compatibility.

---

## Goals & Requirements

### Primary Goals

1. **Scalability**: Easy to add new themed tetromino styles (target: 30 minutes per theme)
2. **Performance**: Zero FPS impact through intelligent caching
3. **Consistency**: Both Canvas and Phaser renderers show identical visual results
4. **User Control**: Settings toggle for enabling/disabling themed tetrominos
5. **Backward Compatibility**: Existing themes work without modification
6. **Maintainability**: Clear separation of concerns, well-documented code

### Non-Goals (for MVP)

- ❌ User-created custom color schemes
- ❌ Per-piece type customization by users
- ❌ Animated/textured tetromino blocks
- ❌ Different styles for different game modes

---

## Architecture Design

### File Organization

**Tetromino configs are stored in separate files for better organization:**

```
src/themes/bioluminescence/
├── bioluminescence-theme.js          (main theme)
├── bioluminescence-tetrominos.js     (tetromino config) ⭐ NEW
└── ...
```

**Advantages of separate files:**
- ✅ Easier to copy template for new themes
- ✅ Cleaner separation of concerns
- ✅ Can reuse configs across themes
- ✅ Easier to find/edit just the tetromino styles
- ✅ Keeps theme file focused on theme logic
- ✅ Simplifies version control (tetromino changes are isolated)

### System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Settings Manager                        │
│  Setting: themeBasedTetrominos: boolean                     │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│              TetrominoStyleManager (NEW)                     │
│  - Resolves active style from theme or default              │
│  - Caches styles (performance optimization)                 │
│  - Listens to THEME_CHANGED events                          │
│  - Provides unified API for renderers                       │
└───────────────────────┬─────────────────────────────────────┘
                        │
           ┌────────────┴────────────┐
           ▼                         ▼
┌──────────────────────┐  ┌──────────────────────┐
│  Canvas Renderer     │  │  Phaser Renderer     │
│  (canvas-drawing-    │  │  (base-board-        │
│   utils.js)          │  │   scene.js)          │
│                      │  │                      │
│  drawBlock() →       │  │  drawBlock() →       │
│  drawBlockStyled()   │  │  drawBlockStyled()   │
└──────────────────────┘  └──────────────────────┘
           ▲                         ▲
           └─────────────┬───────────┘
                         │
                    Query Style
                         │
           ┌─────────────┴───────────┐
           ▼                         ▼
┌──────────────────────┐  ┌──────────────────────┐
│  BaseTheme           │  │  Active Theme        │
│  (base-theme.js)     │  │  (e.g. biolumines-   │
│                      │  │   cence-theme.js)    │
│  getTetrominoConfig()│  │                      │
│  → null (default)    │  │  getTetrominoConfig()│
│                      │  │  → imports from:     │
└──────────────────────┘  └──────────────────────┘
                                      │
                                      ▼
                          ┌──────────────────────┐
                          │  Tetromino Config    │
                          │  (bioluminescence-   │
                          │   tetrominos.js)     │
                          │                      │
                          │  export const config │
                          └──────────────────────┘
```

### Core Components

#### 1. TetrominoStyleManager

**Location**: `src/rendering/tetromino-style-manager.js` (NEW FILE)

**Responsibilities**:
- Resolve which style to use (theme-based or default)
- Cache resolved styles to avoid per-frame lookups
- Listen to theme and settings changes
- Provide simple API: `getStyleForPiece(pieceType)`

**API**:
```javascript
class TetrominoStyleManager {
    constructor(themeManager, settingsManager)

    // Main API
    getStyleForPiece(pieceType) // Returns: { color, renderMode, effects }

    // Lifecycle
    init()
    refresh()
    destroy()

    // Internal
    _cacheCurrentStyle()
    _onThemeChanged()
    _onSettingsChanged()
}
```

#### 2. BaseTheme Extension

**Location**: `src/themes/base-theme.js` (MODIFY)

**New Optional Method**:
```javascript
class BaseTheme {
    // ... existing methods ...

    /**
     * Optional: Provide custom tetromino visual configuration
     * Themes should import config from separate tetromino config file
     * @returns {TetrominoConfig|null} Theme-specific config or null for default
     */
    getTetrominoConfig() {
        return null; // Default: no custom styling
    }
}
```

**Example Theme Implementation**:
```javascript
// In src/themes/bioluminescence/bioluminescence-theme.js
import { BIOLUMINESCENCE_TETROMINOS } from './bioluminescence-tetrominos.js';

export default class BioluminescenceTheme extends BaseTheme {
    // ... existing theme code ...

    getTetrominoConfig() {
        return BIOLUMINESCENCE_TETROMINOS;
    }
}
```

#### 3. Tetromino Config Schema

**Standard format** that all themes follow:

```javascript
{
    // Version for future compatibility
    version: 1,

    // Color palette for each piece type
    colors: {
        I: '#00ff88',  // Cyan-green
        O: '#88ffff',  // Bright cyan
        T: '#00ddaa',  // Teal
        S: '#66ffaa',  // Light green
        Z: '#00ff99',  // Medium green
        J: '#44ffcc',  // Aqua
        L: '#22ffbb',  // Sea green
        GARBAGE: '#224433' // Dark teal
    },

    // Rendering mode
    renderMode: 'glow', // 'solid' | 'glow' | 'gradient'

    // Visual effects configuration
    effects: {
        // Glow effect (renderMode: 'glow')
        glowRadius: 8,           // Pixels
        glowIntensity: 0.6,      // 0-1
        glowColor: 'auto',       // 'auto' uses piece color

        // Outline
        outline: true,
        outlineWidth: 2,         // Pixels
        outlineColor: 'lighten', // 'lighten' | 'darken' | hex color

        // Gradient (renderMode: 'gradient')
        gradientType: 'radial',  // 'linear' | 'radial'
        gradientStops: [
            { offset: 0, color: 'lighten', opacity: 1 },
            { offset: 1, color: 'base', opacity: 0.8 }
        ],

        // Animation
        pulse: false,            // Enable pulsating effect
        pulseSpeed: 0.05,        // Radians per frame
        pulseAmplitude: 0.2      // 0-1 intensity variation
    },

    // Renderer-specific overrides (optional)
    rendererOverrides: {
        canvas: {
            // Canvas-specific tweaks
            outlineWidth: 1.5  // Thinner outlines in Canvas
        },
        phaser: {
            // Phaser-specific tweaks
            glowRadius: 10  // Slightly larger glow in WebGL
        }
    }
}
```

#### 4. Renderer Integration

##### Canvas Renderer

**Location**: `src/rendering/canvas/canvas-drawing-utils.js` (MODIFY)

**Current Function**:
```javascript
export function drawBlock(ctx, x, y, size, color, alpha = 1.0) {
    // Simple solid fill with outline
}
```

**New Function**:
```javascript
export function drawBlockStyled(ctx, x, y, size, pieceType, styleConfig, alpha = 1.0) {
    const { color, renderMode, effects } = styleConfig;

    switch (renderMode) {
        case 'solid':
            drawBlockSolid(ctx, x, y, size, color, alpha);
            break;
        case 'glow':
            drawBlockGlow(ctx, x, y, size, color, effects, alpha);
            break;
        case 'gradient':
            drawBlockGradient(ctx, x, y, size, color, effects, alpha);
            break;
    }
}
```

**Helper Functions**:
```javascript
function drawBlockGlow(ctx, x, y, size, color, effects, alpha) {
    // 1. Draw glow effect (larger, semi-transparent)
    ctx.save();
    ctx.shadowColor = effects.glowColor === 'auto' ? color : effects.glowColor;
    ctx.shadowBlur = effects.glowRadius;
    ctx.globalAlpha = effects.glowIntensity * alpha;

    // 2. Draw solid block
    ctx.fillStyle = color;
    ctx.fillRect(x, y, size, size);

    // 3. Draw outline if enabled
    if (effects.outline) {
        ctx.strokeStyle = computeOutlineColor(color, effects.outlineColor);
        ctx.lineWidth = effects.outlineWidth;
        ctx.strokeRect(x, y, size, size);
    }

    ctx.restore();
}

function drawBlockGradient(ctx, x, y, size, color, effects, alpha) {
    // Create gradient based on config
    const gradient = effects.gradientType === 'radial'
        ? ctx.createRadialGradient(x + size/2, y + size/2, 0, x + size/2, y + size/2, size)
        : ctx.createLinearGradient(x, y, x + size, y + size);

    // Add color stops
    effects.gradientStops.forEach(stop => {
        const stopColor = computeStopColor(color, stop.color);
        gradient.addColorStop(stop.offset, stopColor);
    });

    ctx.fillStyle = gradient;
    ctx.globalAlpha = alpha;
    ctx.fillRect(x, y, size, size);

    // Outline
    if (effects.outline) {
        ctx.strokeStyle = computeOutlineColor(color, effects.outlineColor);
        ctx.lineWidth = effects.outlineWidth;
        ctx.strokeRect(x, y, size, size);
    }
}

function computeOutlineColor(baseColor, mode) {
    if (mode.startsWith('#')) return mode; // Explicit color

    // Parse base color and lighten/darken
    const [r, g, b] = hexToRgb(baseColor);
    const factor = mode === 'lighten' ? 1.3 : 0.7;

    return rgbToHex(
        Math.min(255, r * factor),
        Math.min(255, g * factor),
        Math.min(255, b * factor)
    );
}
```

##### Phaser Renderer

**Location**: `src/rendering/phaser/base-board-scene.js` (MODIFY)

**Current Method**:
```javascript
drawBlock(x, y, size, pieceType, alpha = 1.0) {
    const color = COLORS[pieceType];
    // Draw solid rectangle
}
```

**New Method**:
```javascript
drawBlockStyled(x, y, size, pieceType, styleConfig, alpha = 1.0) {
    const { color, renderMode, effects } = styleConfig;

    // Apply renderer-specific overrides if present
    const finalEffects = {
        ...effects,
        ...(styleConfig.rendererOverrides?.phaser || {})
    };

    switch (renderMode) {
        case 'solid':
            this.drawBlockSolid(x, y, size, color, alpha);
            break;
        case 'glow':
            this.drawBlockGlow(x, y, size, color, finalEffects, alpha);
            break;
        case 'gradient':
            this.drawBlockGradient(x, y, size, color, finalEffects, alpha);
            break;
    }
}

drawBlockGlow(x, y, size, color, effects, alpha) {
    // Use Phaser's built-in glow post-processing if available
    const graphics = this.add.graphics();

    // Draw glow layer
    graphics.fillStyle(parseInt(color.replace('#', '0x')), effects.glowIntensity * alpha);
    graphics.fillRect(x - effects.glowRadius/2, y - effects.glowRadius/2,
                     size + effects.glowRadius, size + effects.glowRadius);

    // Draw solid block on top
    graphics.fillStyle(parseInt(color.replace('#', '0x')), alpha);
    graphics.fillRect(x, y, size, size);

    // Outline
    if (effects.outline) {
        const outlineColor = this.computeOutlineColor(color, effects.outlineColor);
        graphics.lineStyle(effects.outlineWidth, parseInt(outlineColor.replace('#', '0x')));
        graphics.strokeRect(x, y, size, size);
    }
}
```

#### 5. Settings Integration

**Location**: `src/ui/settings.js` (MODIFY)

**Add New Setting**:
```javascript
export const DEFAULT_SETTINGS = {
    // ... existing settings ...

    // Tetromino Theming
    themeBasedTetrominos: true, // Enable theme-specific tetromino styles
};
```

**Settings Change Handler**:
```javascript
// In SettingsManager.update()
if (changes.themeBasedTetrominos !== undefined) {
    eventBus.emit(EVENTS.SETTINGS_CHANGED, {
        key: 'themeBasedTetrominos',
        value: changes.themeBasedTetrominos
    });
}
```

#### 6. Event System

**Location**: `src/events/event-bus.js` (MODIFY if needed)

**Ensure These Events Exist**:
```javascript
export const EVENTS = {
    // ... existing events ...
    THEME_CHANGED: 'themeChanged',
    SETTINGS_CHANGED: 'settingsChanged',
};
```

---

## Implementation Plan

### Phase 1: Foundation (Core System)

**Goal**: Create the base infrastructure without breaking existing functionality.

#### Step 1.1: Create TetrominoStyleManager

**File**: `src/rendering/tetromino-style-manager.js` (NEW)

```javascript
import { eventBus, EVENTS } from '../events/event-bus.js';
import { COLORS } from '../core/constants.js';

/**
 * Default tetromino style configuration
 */
const DEFAULT_CONFIG = {
    version: 1,
    colors: COLORS,
    renderMode: 'solid',
    effects: {
        glowRadius: 0,
        glowIntensity: 0,
        outline: true,
        outlineWidth: 0.5,
        outlineColor: 'rgba(255, 255, 255, 0.08)',
        pulse: false
    }
};

export class TetrominoStyleManager {
    constructor(themeManager, settingsManager) {
        this.themeManager = themeManager;
        this.settingsManager = settingsManager;

        this.cachedConfig = null;
        this.eventUnsubscribers = [];
    }

    init() {
        this._cacheCurrentStyle();

        // Listen for theme changes
        const themeUnsub = eventBus.on(EVENTS.THEME_CHANGED, () => {
            this._onThemeChanged();
        });

        // Listen for settings changes
        const settingsUnsub = eventBus.on(EVENTS.SETTINGS_CHANGED, (data) => {
            if (data.key === 'themeBasedTetrominos') {
                this._onSettingsChanged();
            }
        });

        this.eventUnsubscribers.push(themeUnsub, settingsUnsub);
    }

    /**
     * Get style configuration for a specific piece type
     * @param {string} pieceType - 'I', 'O', 'T', 'S', 'Z', 'J', 'L'
     * @returns {Object} { color, renderMode, effects }
     */
    getStyleForPiece(pieceType) {
        if (!this.cachedConfig) {
            this._cacheCurrentStyle();
        }

        return {
            color: this.cachedConfig.colors[pieceType] || COLORS[pieceType],
            renderMode: this.cachedConfig.renderMode,
            effects: this.cachedConfig.effects,
            rendererOverrides: this.cachedConfig.rendererOverrides
        };
    }

    /**
     * Force refresh of cached style
     */
    refresh() {
        this._cacheCurrentStyle();
    }

    /**
     * Cleanup event listeners
     */
    destroy() {
        this.eventUnsubscribers.forEach(unsub => unsub());
        this.eventUnsubscribers = [];
    }

    // Internal methods

    _cacheCurrentStyle() {
        const settings = this.settingsManager?.get();
        const themeBasedEnabled = settings?.themeBasedTetrominos ?? true;

        if (themeBasedEnabled && this.themeManager?.activeTheme) {
            const themeConfig = this.themeManager.activeTheme.getTetrominoConfig?.();

            if (themeConfig) {
                this.cachedConfig = this._validateConfig(themeConfig);
                console.log('🎨 Tetromino style: Theme-based', this.cachedConfig);
                return;
            }
        }

        // Fallback to default
        this.cachedConfig = DEFAULT_CONFIG;
        console.log('🎨 Tetromino style: Default');
    }

    _validateConfig(config) {
        // Ensure config has all required fields
        return {
            version: config.version || 1,
            colors: { ...COLORS, ...config.colors },
            renderMode: config.renderMode || 'solid',
            effects: { ...DEFAULT_CONFIG.effects, ...config.effects },
            rendererOverrides: config.rendererOverrides || {}
        };
    }

    _onThemeChanged() {
        console.log('🎨 Theme changed, refreshing tetromino style');
        this._cacheCurrentStyle();
    }

    _onSettingsChanged() {
        console.log('🎨 Settings changed, refreshing tetromino style');
        this._cacheCurrentStyle();
    }
}
```

#### Step 1.2: Extend BaseTheme

**File**: `src/themes/base-theme.js` (MODIFY)

**Add Method**:
```javascript
export class BaseTheme {
    constructor(name) {
        this.name = name;
        // ... existing code ...
    }

    // ... existing methods ...

    /**
     * Optional: Provide custom tetromino visual configuration
     * Themes can override this to provide custom tetromino styles
     * @returns {TetrominoConfig|null} Custom config or null for default
     */
    getTetrominoConfig() {
        return null; // Default: no custom styling
    }
}
```

#### Step 1.3: Add Settings

**File**: `src/ui/settings.js` (MODIFY)

**Update Default Settings**:
```javascript
export const DEFAULT_SETTINGS = {
    // ... existing settings ...

    // Tetromino Visual Settings
    themeBasedTetrominos: true,
};
```

### Phase 2: Renderer Integration

#### Step 2.1: Update Canvas Renderer

**File**: `src/rendering/canvas/canvas-drawing-utils.js` (MODIFY)

**Goals**:
1. Keep existing `drawBlock()` for backward compatibility
2. Add new `drawBlockStyled()` for theme-aware rendering
3. Add helper functions for different render modes

**Pseudocode Structure**:
```javascript
// Keep existing function (backward compatibility)
export function drawBlock(ctx, x, y, size, color, alpha = 1.0) {
    // Existing implementation unchanged
}

// New styled drawing function
export function drawBlockStyled(ctx, x, y, size, pieceType, styleConfig, alpha = 1.0) {
    // Extract config
    // Apply renderer overrides
    // Route to appropriate rendering function based on renderMode
}

// Render mode implementations
function drawBlockSolid(ctx, x, y, size, color, effects, alpha) { }
function drawBlockGlow(ctx, x, y, size, color, effects, alpha) { }
function drawBlockGradient(ctx, x, y, size, color, effects, alpha) { }

// Helper utilities
function computeOutlineColor(baseColor, mode) { }
function hexToRgb(hex) { }
function rgbToHex(r, g, b) { }
```

#### Step 2.2: Update Phaser Renderer

**File**: `src/rendering/phaser/base-board-scene.js` (MODIFY)

**Similar approach**:
1. Keep existing `drawBlock()` method
2. Add new `drawBlockStyled()` method
3. Add render mode implementations

#### Step 2.3: Wire Up Style Manager

**Files to modify**:
- `src/rendering/canvas/single-player-canvas-renderer.js`
- `src/rendering/phaser/board-scene.js`
- `src/ui/multi-player-canvas-layout.js` (for FFA multiplayer)

**Example Integration** (Canvas Single Player):
```javascript
// In single-player-canvas-renderer.js
import { TetrominoStyleManager } from '../tetromino-style-manager.js';

class SinglePlayerCanvasRenderer {
    constructor(themeManager, settingsManager) {
        this.styleManager = new TetrominoStyleManager(themeManager, settingsManager);
        this.styleManager.init();
    }

    drawPiece(ctx, piece, blockSize, options) {
        piece.shape.forEach((row, y) => {
            row.forEach((value, x) => {
                if (value) {
                    const screenX = (piece.x + x) * blockSize;
                    const screenY = (piece.y + y) * blockSize;

                    // Get themed style
                    const styleConfig = this.styleManager.getStyleForPiece(piece.type);

                    // Use new styled drawing
                    drawBlockStyled(ctx, screenX, screenY, blockSize,
                                   piece.type, styleConfig, options.alpha || 1.0);
                }
            });
        });
    }
}
```

### Phase 3: Bioluminescence Theme Implementation

#### Step 3.1: Create Tetromino Config File

**File**: `src/themes/bioluminescence/bioluminescence-tetrominos.js` (NEW)

**Create Configuration**:
```javascript
/**
 * Bioluminescence Theme - Tetromino Visual Configuration
 *
 * Glowing cyan-green-teal palette inspired by bioluminescent organisms
 * in deep ocean and forest environments.
 */

export const BIOLUMINESCENCE_TETROMINOS = {
    version: 1,

    // Bioluminescent color palette (cyan-green-teal spectrum)
    colors: {
        I: '#00ff88',  // Bright cyan-green (most bioluminescent)
        O: '#88ffff',  // Bright cyan (like jellyfish glow)
        T: '#00ddaa',  // Teal (like plankton)
        S: '#66ffaa',  // Light green (like algae)
        Z: '#00ff99',  // Medium green (like fireflies)
        J: '#44ffcc',  // Aqua (like deep sea creatures)
        L: '#22ffbb',  // Sea green (like coral)
        GARBAGE: '#224433' // Dark teal (minimal glow)
    },

    // Glowing render mode (signature bioluminescence effect)
    renderMode: 'glow',

    effects: {
        // Soft glowing aura around each block
        glowRadius: 8,
        glowIntensity: 0.6,
        glowColor: 'auto', // Use piece color for glow

        // Brighter outline for definition
        outline: true,
        outlineWidth: 2,
        outlineColor: 'lighten',

        // Subtle pulsating effect (like breathing organisms)
        pulse: true,
        pulseSpeed: 0.03,      // Slow, organic pulse
        pulseAmplitude: 0.15   // Subtle intensity variation
    },

    // Renderer-specific tweaks
    rendererOverrides: {
        canvas: {
            glowRadius: 6,      // Slightly smaller glow in Canvas
            outlineWidth: 1.5   // Thinner outline for clarity
        },
        phaser: {
            glowRadius: 10,     // Larger glow with WebGL
            glowIntensity: 0.7  // Slightly brighter in WebGL
        }
    }
};
```

#### Step 3.2: Import Config in Theme

**File**: `src/themes/bioluminescence/bioluminescence-theme.js` (MODIFY)

**Add Import and Method**:
```javascript
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { BIOLUMINESCENCE_TETROMINOS } from './bioluminescence-tetrominos.js'; // ⭐ NEW

export default class BioluminescenceTheme extends BaseTheme {
    constructor() {
        super('bioluminescence');
        // ... existing constructor code ...
    }

    // ... existing methods ...

    // ⭐ NEW METHOD
    getTetrominoConfig() {
        return BIOLUMINESCENCE_TETROMINOS;
    }
}
```

### Phase 4: Settings UI

#### Step 4.1: Add Toggle to Settings Modal

**Location**: Settings UI (HTML template or component)

**Add Section**:
```html
<!-- In Display Settings section -->
<div class="setting-group">
    <h3>Tetromino Appearance</h3>

    <div class="setting-item">
        <label>
            <input type="checkbox"
                   id="themeBasedTetrominos"
                   checked>
            Use Theme-Based Tetrominos
        </label>
        <p class="setting-description">
            When enabled, tetromino colors and effects match the active theme.
            Disable for classic appearance.
        </p>
    </div>
</div>
```

**Wire Up Event**:
```javascript
// In settings initialization
document.getElementById('themeBasedTetrominos').addEventListener('change', (e) => {
    settingsManager.update({
        themeBasedTetrominos: e.target.checked
    });
});
```

---

## API Reference

### TetrominoStyleManager

#### Constructor
```javascript
new TetrominoStyleManager(themeManager, settingsManager)
```

#### Methods

**`init()`**
- Initializes the manager and sets up event listeners
- Call once during app initialization

**`getStyleForPiece(pieceType: string): StyleConfig`**
- Returns style configuration for the specified piece type
- Uses cached config for performance
- **Parameters**: `pieceType` - One of: 'I', 'O', 'T', 'S', 'Z', 'J', 'L'
- **Returns**: `{ color, renderMode, effects, rendererOverrides }`

**`refresh()`**
- Forces recalculation of cached style
- Automatically called on theme/settings changes
- Can be called manually if needed

**`destroy()`**
- Cleans up event listeners
- Call when disposing of the manager

### Canvas Drawing Functions

**`drawBlockStyled(ctx, x, y, size, pieceType, styleConfig, alpha)`**
- Main styled drawing function for Canvas renderer
- **Parameters**:
  - `ctx`: Canvas 2D context
  - `x, y`: Screen coordinates
  - `size`: Block size in pixels
  - `pieceType`: Piece type ('I', 'O', etc.)
  - `styleConfig`: Style configuration object
  - `alpha`: Opacity (0-1)

### Phaser Drawing Methods

**`drawBlockStyled(x, y, size, pieceType, styleConfig, alpha)`**
- Main styled drawing method for Phaser renderer
- Similar parameters to Canvas version

### Theme API

**`BaseTheme.getTetrominoConfig(): TetrominoConfig | null`**
- Optional method that themes can implement
- Return `null` for default styling
- Return config object for custom styling

---

## Adding New Theme Styles

### File Structure Approach

**Always create tetromino configs in separate files:**

```
src/themes/your-theme/
├── your-theme-theme.js          (main theme - imports config)
├── your-theme-tetrominos.js     (tetromino config - exported constant) ⭐
└── ...
```

This separation provides:
- Cleaner code organization
- Easier to maintain and find tetromino-specific code
- Simple template for creating new theme styles
- Ability to reuse configs across multiple themes

### Quick Start (6 Steps, ~30 minutes)

#### 1. Create Tetromino Config File

Create a new file in your theme's directory:

**File**: `src/themes/sunset-sky/sunset-sky-tetrominos.js` (NEW)

```javascript
/**
 * Sunset Sky Theme - Tetromino Visual Configuration
 */

export const SUNSET_SKY_TETROMINOS = {
    version: 1,
    colors: {
        I: '#ff6b35',  // Warm sunset orange
        O: '#f7931e',  // Golden hour
        T: '#ff8552',  // Coral
        S: '#ffa500',  // Amber
        Z: '#ff7f50',  // Sunset coral
        J: '#ff9a76',  // Peach
        L: '#ffb347',  // Pastel orange
        GARBAGE: '#8b4513' // Dull brown
    },
    renderMode: 'gradient',  // or 'solid' or 'glow'
    effects: {
        glowRadius: 6,
        glowIntensity: 0.5,
        outline: true,
        outlineWidth: 2,
        outlineColor: 'lighten',
        gradientType: 'radial',
        gradientStops: [
            { offset: 0, color: 'lighten', opacity: 1 },
            { offset: 1, color: 'base', opacity: 0.9 }
        ],
        pulse: false
    }
};
```

#### 2. Import Config in Theme File

**File**: `src/themes/sunset-sky/sunset-sky-theme.js` (MODIFY)

Add import at the top and implement the method:

```javascript
import { BaseTheme } from '../base-theme.js';
import { SUNSET_SKY_TETROMINOS } from './sunset-sky-tetrominos.js'; // ⭐ Add this

export default class SunsetSkyTheme extends BaseTheme {
    // ... existing theme code ...

    // ⭐ Add this method
    getTetrominoConfig() {
        return SUNSET_SKY_TETROMINOS;
    }
}
```

#### 3. Customize Colors

Match your theme's color palette. Use a color picker on your theme background for inspiration.

**Tips**:
- Maintain contrast between piece types
- Test visibility on your theme background
- Consider colorblind-friendly palettes
- Use 6-digit hex codes (#RRGGBB)

#### 4. Choose Render Mode

**Solid** - Clean, classic look
```javascript
renderMode: 'solid',
effects: {
    outline: true,
    outlineWidth: 2,
    outlineColor: 'lighten'
}
```

**Glow** - Modern, vibrant look
```javascript
renderMode: 'glow',
effects: {
    glowRadius: 8,
    glowIntensity: 0.6,
    outline: true
}
```

**Gradient** - Sophisticated, dimensional look
```javascript
renderMode: 'gradient',
effects: {
    gradientType: 'radial',
    gradientStops: [
        { offset: 0, color: 'lighten', opacity: 1 },
        { offset: 0.7, color: 'base', opacity: 0.95 },
        { offset: 1, color: 'darken', opacity: 0.9 }
    ]
}
```

#### 5. Test and Iterate
1. Enable the theme in-game
2. Enable "Theme-Based Tetrominos" in settings
3. Play a few games and observe:
   - Visibility (can you distinguish pieces?)
   - Aesthetics (does it match the theme?)
   - Performance (any FPS drops?)
4. Tweak colors/effects as needed

### Advanced: Renderer-Specific Overrides

If visual effects look different between Canvas and Phaser:

```javascript
getTetrominoConfig() {
    return {
        // ... base config ...

        rendererOverrides: {
            canvas: {
                // Canvas tends to have slightly thicker lines
                outlineWidth: 1.5,
                glowRadius: 6
            },
            phaser: {
                // WebGL can handle more intense effects
                glowRadius: 10,
                glowIntensity: 0.7
            }
        }
    };
}
```

### Example: Galaxy Theme

```javascript
// src/themes/galaxy/galaxy-theme.js
getTetrominoConfig() {
    return {
        version: 1,
        colors: {
            I: '#9d4edd',  // Purple nebula
            O: '#7209b7',  // Deep purple
            T: '#560bad',  // Dark purple
            S: '#b5179e',  // Magenta
            Z: '#f72585',  // Pink star
            J: '#4361ee',  // Blue giant
            L: '#4cc9f0',  // Cyan star
            GARBAGE: '#3a0ca3' // Dark space
        },
        renderMode: 'glow',
        effects: {
            glowRadius: 12,       // Strong cosmic glow
            glowIntensity: 0.8,   // Bright like stars
            outline: true,
            outlineWidth: 1,
            outlineColor: '#ffffff', // White stellar edge
            pulse: true,          // Pulsating stars
            pulseSpeed: 0.04,
            pulseAmplitude: 0.25
        }
    };
}
```

---

## Testing Strategy

### Unit Tests

**File**: `tests/rendering/tetromino-style-manager.test.js`

```javascript
describe('TetrominoStyleManager', () => {
    it('should return default config when no theme is active', () => {
        // Test fallback behavior
    });

    it('should return theme config when theme provides one', () => {
        // Test theme integration
    });

    it('should respect settings toggle', () => {
        // Test settings override
    });

    it('should cache configs for performance', () => {
        // Test caching mechanism
    });

    it('should refresh on theme change', () => {
        // Test reactivity
    });
});
```

### Integration Tests

**Checklist**:
- [ ] Single Player mode shows themed tetrominos
- [ ] Local Multiplayer (2-4 players) shows themed tetrominos
- [ ] FFA Multiplayer main player shows themed tetrominos
- [ ] FFA Multiplayer opponent boards show themed tetrominos
- [ ] Settings toggle works (enable/disable immediately visible)
- [ ] Theme switching updates tetrominos in real-time
- [ ] Ghost pieces use themed colors
- [ ] Locked pieces on board use themed colors
- [ ] Performance: 60 FPS maintained with themed tetrominos

### Visual Regression Tests

**Capture Screenshots**:
1. Default tetrominos (setting disabled)
2. Bioluminescence tetrominos (setting enabled)
3. Tetrominos with different piece types
4. Ghost piece appearance
5. Locked board state

### Performance Benchmarks

**Metrics to Track**:
- Frame time with default tetrominos
- Frame time with themed tetrominos
- Memory usage with style manager
- Cache hit rate (should be ~99% after first frame)

**Target Performance**:
- No measurable FPS impact (<1ms per frame)
- Memory overhead <1MB
- Instant style switching (<16ms)

---

## Performance Considerations

### Optimization Strategies

#### 1. Style Caching
**Problem**: Looking up theme config every frame is expensive
**Solution**: Cache resolved config, refresh only on theme/settings change

```javascript
// ❌ BAD: Per-frame lookup
drawBlock() {
    const theme = themeManager.getActiveTheme();
    const config = theme.getTetrominoConfig(); // Called 100+ times per frame!
}

// ✅ GOOD: Cached lookup
constructor() {
    this.cachedConfig = styleManager.getStyleForPiece('I'); // Cached
}
drawBlock() {
    const config = this.cachedConfig; // Fast memory access
}
```

#### 2. Gradient/Glow Pre-rendering
For static effects, consider pre-rendering to textures:

```javascript
// One-time generation
const glowTexture = preRenderGlowBlock(color, size, effects);

// Fast per-frame blit
ctx.drawImage(glowTexture, x, y);
```

#### 3. Renderer-Specific Paths
Different complexity for different renderers:

```javascript
if (renderMode === 'glow') {
    if (rendererType === 'phaser') {
        // Use WebGL post-processing effects
        this.applyGlowShader();
    } else {
        // Use canvas shadow blur (simpler)
        ctx.shadowBlur = glowRadius;
    }
}
```

#### 4. Quality Scaling
Respect graphics quality settings:

```javascript
getEffectiveGlowRadius() {
    const baseRadius = styleConfig.effects.glowRadius;
    const quality = this.settingsManager.get('graphicsQuality');

    const qualityMultipliers = {
        'Low': 0.5,
        'Medium': 0.75,
        'High': 1.0,
        'Ultra': 1.2
    };

    return baseRadius * qualityMultipliers[quality];
}
```

### Performance Budget

**Target**: <0.5ms per frame for tetromino rendering

**Breakdown**:
- Style lookup: <0.01ms (cached)
- Drawing 40 blocks (20x10 board): <0.4ms
- Effects (glow/gradient): <0.09ms per block
- Total: ~0.45ms (safe margin)

**If Budget Exceeded**:
1. Reduce glow radius
2. Simplify gradients (fewer stops)
3. Disable pulse animation on low quality
4. Use texture atlas for common blocks

---

## Future Enhancements

### Phase 2 Features (Post-MVP)

#### 1. Custom Color Schemes
Allow users to create custom tetromino color palettes:

```javascript
// Settings UI
customTetrominoColors: {
    I: '#user-chosen-color',
    O: '#user-chosen-color',
    // ...
}
```

#### 2. Style Library
Predefined style packs independent of themes:

```javascript
const STYLE_PACKS = {
    'classic': { /* NES colors */ },
    'neon': { /* Bright cyberpunk */ },
    'pastel': { /* Soft colors */ },
    'monochrome': { /* Grayscale */ },
    'retro': { /* 80s aesthetic */ }
};
```

#### 3. Texture Support
Apply textures to tetromino blocks:

```javascript
renderMode: 'textured',
effects: {
    texture: 'images/block-textures/wood-grain.png',
    textureScale: 1.0,
    blendMode: 'multiply'
}
```

#### 4. Animation Effects
More dynamic visual effects:

```javascript
effects: {
    shimmer: true,        // Sparkle effect
    shimmerInterval: 2000, // Every 2 seconds
    rotation: 0.01,       // Slow rotation
    breathing: true       // Size pulsation
}
```

#### 5. Per-Mode Styles
Different styles for different game modes:

```javascript
getTetrominoConfig(gameMode) {
    if (gameMode === 'zen') {
        return this.zenModeConfig;
    } else if (gameMode === 'battle') {
        return this.battleModeConfig;
    }
    return this.defaultConfig;
}
```

#### 6. Theme Variants
Themes with multiple tetromino style options:

```javascript
getTetrominoConfig(variant = 'default') {
    return {
        'default': { /* Standard bioluminescence */ },
        'intense': { /* Brighter, more animated */ },
        'subtle': { /* Minimal effects */ }
    }[variant];
}
```

### Long-Term Ideas

- **AI-Generated Themes**: Upload image, AI extracts color palette
- **Community Themes**: User-submitted theme configs
- **Seasonal Events**: Holiday-themed tetrominos (Halloween, Christmas)
- **Accessibility Profiles**: High-contrast, colorblind-safe presets
- **Gameplay Integration**: Tetrominos glow brighter with combos

---

## Appendix

### A. Color Palette Guidelines

**Good Tetromino Palettes**:
- Sufficient contrast between all 7 piece types
- Visibility on both light and dark backgrounds
- Colorblind-friendly (avoid red-green only distinction)
- Saturation balanced (not too dull, not too neon)

**Color Contrast Testing**:
```javascript
function testColorContrast(color1, color2) {
    const ratio = calculateContrastRatio(color1, color2);
    return ratio >= 3.0; // WCAG AA standard for large text
}
```

### B. Render Mode Comparison

| Mode | Performance | Visual Impact | Best For |
|------|------------|---------------|----------|
| **Solid** | Best (baseline) | Clean, classic | Retro themes, minimalist |
| **Glow** | Good (-5% fps) | Modern, vibrant | Neon, sci-fi, bioluminescence |
| **Gradient** | Fair (-10% fps) | Sophisticated | Realistic, 3D-style themes |

### C. Common Pitfalls

**❌ Don't**: Recompute colors every frame
```javascript
drawBlock() {
    const theme = getTheme(); // Expensive lookup
    const color = theme.getColor(type); // Computed each time
}
```

**✅ Do**: Cache and reuse
```javascript
constructor() {
    this.colors = styleManager.getAllColors(); // Once
}
drawBlock() {
    const color = this.colors[type]; // Fast
}
```

**❌ Don't**: Use complex effects without quality scaling
```javascript
effects: {
    glowRadius: 20, // Always maximum
    pulse: true,    // Always animated
}
```

**✅ Do**: Scale with settings
```javascript
effects: {
    glowRadius: quality === 'Low' ? 5 : 20,
    pulse: quality !== 'Low',
}
```

### D. Debugging Tips

**Enable Debug Logging**:
```javascript
// In tetromino-style-manager.js
const DEBUG = true;

if (DEBUG) {
    console.log('🎨 Style config:', this.cachedConfig);
    console.log('🎨 Active theme:', this.themeManager.activeTheme.name);
}
```

**Visual Debug Mode**:
Draw borders around themed blocks:
```javascript
if (DEBUG_VISUALS) {
    ctx.strokeStyle = 'red';
    ctx.strokeRect(x, y, size, size);
}
```

**Performance Monitoring**:
```javascript
const start = performance.now();
drawBlockStyled(...);
const duration = performance.now() - start;
if (duration > 1.0) {
    console.warn('Slow block render:', duration, 'ms');
}
```

---

## Conclusion

This system provides a **scalable, performant, and user-friendly** way to add theme-specific tetromino styles to Serenity Blocks. The architecture is designed for:

- **Easy expansion**: 30 minutes to add a new theme style
- **Performance**: Zero FPS impact through intelligent caching
- **Flexibility**: Support for various render modes and effects
- **Consistency**: Unified API across Canvas and Phaser renderers
- **User control**: Settings toggle for enabling/disabling

**Implementation Estimate**: 8-12 hours for MVP (including testing)

**Next Steps**:
1. Review and approve this plan
2. Implement Phase 1 (foundation)
3. Test with Bioluminescence theme
4. Iterate based on feedback
5. Expand to additional themes

---

**Document Version**: 1.0
**Last Updated**: 2025-01-13
**Status**: Planning Phase
**Feedback**: Please provide feedback on this plan before implementation begins
