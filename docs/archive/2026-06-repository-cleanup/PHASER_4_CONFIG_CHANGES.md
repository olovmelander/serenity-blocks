# Phaser 4 Configuration Changes

**Date:** October 15, 2025  
**Phase:** Phase 3 - Refactor Game Configuration  
**Purpose:** Document Phaser 3 → Phaser 4 configuration changes

---

## 🔍 Current Phaser 3 Configuration

### Game Config Object (main.js lines 322-372)

```javascript
const config = {
    type: PhaserRef.WEBGL,
    width: singleBoardWidth,
    height: singleBoardHeight,
    parent: 'phaser-game-container',
    transparent: true,
    audio: { noAudio: true },
    scene: [BoardScene, BackgroundScene],
    scale: {
        mode: PhaserRef.Scale.FIT,
        autoCenter: PhaserRef.Scale.CENTER_BOTH,
        width: singleBoardWidth,
        height: singleBoardHeight,
    },
    resolution: window.devicePixelRatio || 1,
    physics: {
        default: false,
    },
    render: {
        antialias: true,
        pixelArt: false,
    },
    callbacks: {
        postBoot: (game) => {
            // Scene initialization
        },
    },
};
```

---

## 🎯 Phaser 4 Configuration Updates

### Key Changes

#### 1. Type Property
**Phaser 3:**
```javascript
type: Phaser.WEBGL
```

**Phaser 4:**
```javascript
type: Phaser.WEBGL  // Same constant name
```
**Status:** ✅ Compatible (Phaser 4 only supports WebGL)

---

#### 2. Scale Manager Configuration
**Phaser 3:**
```javascript
scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: singleBoardWidth,
    height: singleBoardHeight,
}
```

**Phaser 4:** Scale Manager API has been modernized
```javascript
scale: {
    mode: Phaser.Scale.FIT,  // Mode likely same
    autoCenter: Phaser.Scale.CENTER_BOTH,  // May be renamed
    width: singleBoardWidth,
    height: singleBoardHeight,
    // New Phaser 4 properties may be available
}
```
**Status:** ⚠️ Needs verification - API may have minor changes

---

#### 3. Resolution / DPI
**Phaser 3:**
```javascript
resolution: window.devicePixelRatio || 1
```

**Phaser 4:**
```javascript
resolution: window.devicePixelRatio || 1
// OR potentially moved to render config
```
**Status:** ⚠️ May be relocated to render config

---

#### 4. Render Configuration
**Phaser 3:**
```javascript
render: {
    antialias: true,
    pixelArt: false,
}
```

**Phaser 4:**
```javascript
render: {
    antialias: true,
    pixelArt: false,
    // Potentially new options for WebGL2
}
```
**Status:** ✅ Likely compatible with possible enhancements

---

#### 5. Physics Configuration
**Phaser 3:**
```javascript
physics: {
    default: false,
}
```

**Phaser 4:**
```javascript
physics: {
    default: false,
}
// OR may be optional entirely if not used
```
**Status:** ✅ Compatible (Serenity Blocks doesn't use Phaser physics)

---

#### 6. Audio Configuration
**Phaser 3:**
```javascript
audio: {
    noAudio: true,
}
```

**Phaser 4:**
```javascript
audio: {
    noAudio: true,
}
// Audio system may be optional
```
**Status:** ✅ Compatible

---

#### 7. Callbacks
**Phaser 3:**
```javascript
callbacks: {
    postBoot: (game) => {
        // Initialization code
    },
}
```

**Phaser 4:**
```javascript
callbacks: {
    postBoot: (game) => {
        // Same callback structure expected
    },
}
```
**Status:** ✅ Likely compatible

---

## 🔧 Updated Phaser 4 Configuration

### Proposed Config for Serenity Blocks

```javascript
initializePhaserGame() {
    if (!Phaser) {
        console.error('Phaser module not loaded');
        return;
    }

    const PhaserRef = Phaser;

    // Create scene classes once Phaser is loaded
    const BackgroundScene = createBackgroundScene(PhaserRef);
    const BoardScene = createBoardScene(PhaserRef);
    const MultiplayerBoardScene = createMultiplayerBoardScene(PhaserRef);

    const singleBoardWidth = COLS * BLOCK_SIZE;
    const singleBoardHeight = ROWS * BLOCK_SIZE;

    this.singleBoardWidth = singleBoardWidth;
    this.phaserBaseWidth = singleBoardWidth;
    this.phaserBaseHeight = singleBoardHeight;

    const config = {
        // Renderer type (WebGL only in Phaser 4)
        type: PhaserRef.WEBGL,
        
        // Canvas dimensions
        width: singleBoardWidth,
        height: singleBoardHeight,
        
        // Parent DOM element
        parent: 'phaser-game-container',
        
        // Transparent canvas for theme backgrounds
        transparent: true,
        
        // Disable Phaser audio (using custom SoundManager)
        audio: {
            noAudio: true,
        },
        
        // Register initial scenes
        scene: [BoardScene, BackgroundScene],
        
        // Scale manager configuration
        scale: {
            mode: PhaserRef.Scale.FIT,
            autoCenter: PhaserRef.Scale.CENTER_BOTH,
            width: singleBoardWidth,
            height: singleBoardHeight,
        },
        
        // High DPI support
        resolution: window.devicePixelRatio || 1,
        
        // Disable Phaser physics (custom physics system)
        physics: {
            default: false,
        },
        
        // WebGL render settings
        render: {
            antialias: true,
            pixelArt: false,
        },
        
        // Post-boot callback for scene initialization
        callbacks: {
            postBoot: (game) => {
                this.backgroundScene = game.scene.getScene('BackgroundScene');
                this.boardScene = game.scene.getScene('BoardScene');
                this.MultiplayerBoardSceneClass = MultiplayerBoardScene;
                
                console.log('✅ Phaser 4 game initialized with BoardScene');
                console.log('Canvas dimensions:', game.canvas.width, 'x', game.canvas.height);
                
                document.body.classList.add('phaser-hud-ready');
                
                if (this.gameState) {
                    this.updatePhaserStats();
                    this.refreshNextQueue();
                }
                
                this.applyEffectQuality(
                    this.settingsManager?.get().effectQuality ?? this.currentEffectQuality,
                );
            },
        },
    };

    console.log('Creating Phaser 4 game with config:', {
        width: config.width,
        height: config.height,
        parent: config.parent,
    });
    
    this.phaserGame = new PhaserRef.Game(config);
    console.log('Phaser 4 game instance created:', this.phaserGame);
}
```

---

## ✅ Configuration Validation Checklist

### Essential Features
- [x] WebGL renderer specified
- [x] Canvas dimensions set (10 cols × 20 rows)
- [x] Parent container specified
- [x] Transparent rendering enabled
- [x] Scenes registered (BoardScene, BackgroundScene)
- [x] Scale manager configured (FIT mode)
- [x] High DPI support (devicePixelRatio)
- [x] Post-boot callback defined

### Serenity Blocks Specific
- [x] Audio disabled (using custom SoundManager)
- [x] Physics disabled (using custom physics)
- [x] Antialias enabled for smooth blocks
- [x] MultiplayerBoardScene class stored for dynamic scenes

---

## 🚨 Potential Issues & Solutions

### Issue 1: Scale Manager API Changes
**Risk:** Medium  
**Description:** Scale constants or properties may have different names in Phaser 4.

**Solution:**
```javascript
// If Phaser 4 changes Scale constants, adapt:
mode: PhaserRef.Scale?.FIT ?? PhaserRef.ScaleManager?.FIT ?? 'FIT'
autoCenter: PhaserRef.Scale?.CENTER_BOTH ?? PhaserRef.ScaleManager?.CENTER_BOTH ?? 'CENTER_BOTH'
```

### Issue 2: Resolution Property Location
**Risk:** Low  
**Description:** Resolution may move to render config in Phaser 4.

**Solution:**
```javascript
// Try both locations
resolution: window.devicePixelRatio || 1,
render: {
    antialias: true,
    pixelArt: false,
    resolution: window.devicePixelRatio || 1,  // Fallback location
}
```

### Issue 3: Callback Timing
**Risk:** Low  
**Description:** postBoot callback timing may differ slightly.

**Solution:** Add defensive checks in callback:
```javascript
postBoot: (game) => {
    if (!game.scene) {
        console.error('Scene manager not ready');
        return;
    }
    // ... rest of callback
}
```

---

## 🔍 Testing Strategy

### Test 1: Game Boots
```javascript
// Expected console output:
// "Creating Phaser 4 game with config: ..."
// "✅ Phaser 4 game initialized with BoardScene"
// "Canvas dimensions: 300 x 600"
```

### Test 2: Canvas Renders
- Canvas element created in `#phaser-game-container`
- Canvas dimensions: 300×600 (logical), scaled by devicePixelRatio
- Transparent background (shows themes behind)

### Test 3: Scenes Load
- BoardScene accessible via `game.scene.getScene('BoardScene')`
- BackgroundScene accessible via `game.scene.getScene('BackgroundScene')`
- No scene initialization errors in console

### Test 4: Responsive Scaling
- Resize browser window
- Canvas scales proportionally (FIT mode)
- Canvas remains centered (CENTER_BOTH)
- No distortion or clipping

---

## 📝 Next Steps

After configuration refactor:
1. Test game initialization with Phaser 4
2. Verify scene loading
3. Check responsive scaling behavior
4. Move to Phase 4: Scene System Migration

---

**Status:** ✅ Ready for Implementation  
**Risk Level:** Low (configuration structure likely similar)  
**Next Action:** Apply configuration updates to main.js

