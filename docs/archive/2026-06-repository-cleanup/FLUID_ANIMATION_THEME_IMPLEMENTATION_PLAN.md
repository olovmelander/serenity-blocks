# Fluid Animation Background Theme - Implementation Plan

## Overview
Implementation plan for a new WebGL-based fluid animation background theme inspired by the react-fluid-animation library. The theme will feature GPU-accelerated fluid dynamics creating organic, flowing visual effects.

---

## Theme Name: **"Nebula Flow"**

**Rationale:** The name evokes cosmic, flowing energy while being unique among existing themes. It suggests both the fluid dynamics and the ethereal visual quality of the animation.

**Category:** Abstract (alongside Fluid Dreams and Electric Dreams)

---

## Technical Architecture

### 1. Core Technology Stack

**Base Implementation:**
- **WebGL Shader-based Rendering** - GPU-accelerated fluid simulation
- **Frame Buffer Objects (FBOs)** - Double-buffering for velocity and pressure fields
- **Navier-Stokes Solver** - Simplified 2D incompressible flow equations
- **Interactive Elements** - Mouse/touch input creates flow disturbances

**Integration with Existing System:**
- Extends `BaseTheme` class (`src/themes/base-theme.js`)
- Uses existing WebGL renderer infrastructure (`src/rendering/renderer.js`)
- Leverages Phaser 4 background scene for rendering loop

---

## 2. Fluid Simulation Pipeline

### Simplified Implementation (Performance-Optimized)

We'll implement a lightweight version with essential features:

#### A. Simulation Steps (Each Frame)
1. **Advection** - Move velocity field along itself
2. **Diffusion** - Spread velocity smoothly (optional, can skip for performance)
3. **Pressure Solve** - Make fluid incompressible (3-5 iterations)
4. **Pressure Gradient** - Apply pressure to velocity
5. **Color Advection** - Move color/dye field along velocity
6. **Render** - Display color field to screen

#### B. Shader Programs Needed

**Vertex Shader** (shared):
```glsl
// Simple fullscreen quad vertex shader
attribute vec2 a_position;
varying vec2 v_texCoord;

void main() {
    v_texCoord = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
```

**Fragment Shaders** (5 total):
1. `advection.frag` - Advect velocity/color fields
2. `divergence.frag` - Calculate velocity divergence
3. `pressure.frag` - Solve pressure via Jacobi iteration
4. `gradient.frag` - Subtract pressure gradient from velocity
5. `display.frag` - Render color field with bloom/glow

#### C. Frame Buffer Configuration

```javascript
const config = {
    simResolution: 128,      // Lower resolution for simulation (performance)
    dyeResolution: 512,      // Higher resolution for visual quality
    iterations: 3,           // Pressure solver iterations (3-5 is good balance)
};
```

**Required FBOs:**
- Velocity field (double-buffered)
- Pressure field (double-buffered)
- Divergence field (single)
- Color/dye field (double-buffered, higher resolution)

---

## 3. Theme-Specific Features

### A. Essential Features (Must Have)

1. **Fluid Simulation Core**
   - Velocity field advection
   - Pressure projection (incompressibility)
   - Color field advection

2. **Visual Quality**
   - Smooth color gradients
   - Soft bloom effect
   - Configurable color palette

3. **Interactivity**
   - Mouse/touch creates flow disturbances
   - Automatic ambient motion (splats at random positions)
   - Gameplay-reactive effects (combo triggers, line clears)

### B. Simplified Features (Optimizations)

**What to Include:**
- 2-3 color schemes (cosmic nebula, ocean depths, aurora borealis)
- Simple splat injection (circular force + color)
- Basic bloom for glow effect

**What to Skip (from reference):**
- Complex UI controls for every parameter
- Real-time configuration panel
- Curl noise (advanced turbulence)
- Multiple simultaneous splats
- Sunrays effect (too performance-intensive)

---

## 4. File Structure

```
src/themes/nebula-flow/
├── nebula-flow-theme.js          # Main theme class
├── fluid-simulator.js            # Core simulation logic
├── shaders/
│   ├── advection.frag
│   ├── divergence.frag
│   ├── pressure.frag
│   ├── gradient.frag
│   ├── display.frag
│   └── base.vert                 # Shared vertex shader
├── color-schemes.js              # Predefined color palettes
└── README.md                     # Theme documentation
```

---

## 5. Implementation Phases

### Phase 1: Core Simulation Setup ✓

**Files to Create:**
- `src/themes/nebula-flow/nebula-flow-theme.js`
- `src/themes/nebula-flow/fluid-simulator.js`
- `src/themes/nebula-flow/shaders/` (all shader files)

**Tasks:**
1. Create `NebulaFlowTheme` class extending `BaseTheme`
2. Implement `FluidSimulator` class:
   - Initialize WebGL context and shaders
   - Create frame buffers for velocity, pressure, dye
   - Implement simulation step functions
3. Set up basic rendering loop

**Acceptance Criteria:**
- Fluid simulation runs at 60 FPS on medium hardware
- Basic flow visible on screen

---

### Phase 2: Visual Polish ✓

**Files to Create:**
- `src/themes/nebula-flow/color-schemes.js`

**Tasks:**
1. Implement color palette system:
   ```javascript
   const colorSchemes = {
       cosmic: {
           primary: [0.6, 0.3, 0.9],   // Purple
           secondary: [0.2, 0.5, 1.0],  // Blue
           ambient: [0.05, 0.05, 0.15], // Dark space
       },
       ocean: { /* ... */ },
       aurora: { /* ... */ },
   };
   ```
2. Add bloom/glow shader pass
3. Implement smooth color transitions
4. Add ambient motion (auto-splats every 0.5-2 seconds)

**Acceptance Criteria:**
- Three distinct color schemes available
- Smooth, visually appealing flow
- Automatic ambient motion creates living background

---

### Phase 3: Interactivity & Game Integration ✓

**Files to Modify:**
- `src/themes/nebula-flow/nebula-flow-theme.js`
- `src/themes/theme-registry.js`

**Tasks:**
1. Add mouse/touch interaction:
   ```javascript
   onPointerMove(x, y, dx, dy) {
       this.simulator.addSplat(x, y, dx, dy);
   }
   ```
2. Integrate with game events:
   - Listen to `LINE_CLEAR` → create splat
   - Listen to `COMBO` → increase splat intensity
   - Listen to `PIECE_LOCK` → subtle pulse
3. Register theme in `theme-registry.js`:
   ```javascript
   {
       id: 'nebula-flow',
       displayName: 'Nebula Flow',
       module: './nebula-flow/nebula-flow-theme.js',
       group: 'abstract',
   }
   ```
4. Implement quality settings support (reduce sim resolution on low quality)

**Acceptance Criteria:**
- Mouse movement creates visible flow
- Game events trigger themed visual responses
- Theme appears in theme selector UI
- Performance scales with quality settings

---

### Phase 4: Optimization & Polish ✓

**Tasks:**
1. Performance optimizations:
   - Adjust simulation resolution based on screen size
   - Implement frame skipping on low-end devices
   - Optimize shader code (minimize texture lookups)
2. Memory management:
   - Proper FBO cleanup in `stop()` and `cleanup()`
   - No memory leaks on theme switching
3. Edge case handling:
   - Window resize support
   - WebGL context loss recovery
   - Graceful degradation on unsupported devices
4. Documentation:
   - Code comments explaining simulation steps
   - README with technical details
   - Performance tuning guide

**Acceptance Criteria:**
- Runs smoothly on mid-range mobile devices
- No memory leaks after 10+ theme switches
- Clean code with comprehensive comments

---

## 6. Configuration & Parameters

### Recommended Default Settings

```javascript
const config = {
    // Simulation
    simResolution: 128,           // Sim grid resolution (lower = faster)
    dyeResolution: 512,           // Visual resolution (higher = prettier)
    pressureIterations: 3,        // Pressure solver iterations (3-5)

    // Dissipation (how fast effects fade)
    velocityDissipation: 0.98,    // Higher = longer lasting flow
    densityDissipation: 0.99,     // Higher = longer lasting colors

    // Splat parameters
    splatRadius: 0.25,            // Size of disturbance (0.0-1.0)
    splatForce: 6000,             // Strength of velocity injection

    // Ambient motion
    autoSplatInterval: 1500,      // ms between automatic splats
    autoSplatForce: 3000,         // Weaker than interactive splats

    // Visual
    colorScheme: 'cosmic',        // Default palette
    bloomIntensity: 0.3,          // Glow strength

    // Quality scaling
    qualityMultipliers: {
        low: { sim: 0.5, dye: 0.5 },
        medium: { sim: 1.0, dye: 1.0 },
        high: { sim: 1.5, dye: 1.5 },
    },
};
```

---

## 7. Integration Checklist

### Theme Registration
- [ ] Add to `src/themes/theme-registry.js`
- [ ] Ensure unique theme ID
- [ ] Assign to 'abstract' group

### WebGL Renderer Compatibility
- [ ] Theme creates its own canvas element
- [ ] Canvas added to WebGL renderer via `addLayer(canvas, zIndex)`
- [ ] No conflicts with existing particle systems

### Lifecycle Methods
- [ ] `init()` - Load shaders, create FBOs
- [ ] `createScene()` - Initialize canvas, start simulation
- [ ] `start()` - Resume animation loop
- [ ] `stop()` - Pause animation, cleanup event listeners
- [ ] `cleanup()` - Destroy WebGL resources
- [ ] `resize()` - Handle window size changes
- [ ] `update(deltaTime)` - Run simulation step

### Event System
- [ ] Subscribe to game events in `createScene()`
- [ ] Unsubscribe in `stop()`
- [ ] Handle: `LINE_CLEAR`, `COMBO`, `PIECE_LOCK`, `GAME_OVER`

---

## 8. Testing Plan

### Visual Testing
1. **Color Schemes**: Verify all 3 palettes render correctly
2. **Responsiveness**: Test on 1920x1080, 1366x768, mobile sizes
3. **Theme Switching**: Switch to/from Nebula Flow 10+ times
4. **Quality Settings**: Test Low/Medium/High visual quality

### Performance Testing
1. **Frame Rate**: Maintain 60 FPS on target hardware
2. **Memory**: Monitor with Chrome DevTools (no leaks)
3. **CPU/GPU Usage**: Should be comparable to other themes
4. **Mobile**: Test on mid-range Android/iOS devices

### Integration Testing
1. **Game Events**: Verify visual responses to combos, line clears
2. **Multiplayer**: Ensure no conflicts with multiplayer rendering
3. **Concurrent Themes**: Switch between all themes smoothly

### Edge Cases
1. **WebGL Not Supported**: Graceful fallback (solid color background?)
2. **Window Resize**: Simulation adjusts properly
3. **Context Loss**: Recovery mechanism works
4. **Extremely Low Resolution**: Minimum viable appearance

---

## 9. Performance Targets

### Desktop (1920x1080)
- **60 FPS** on GTX 1060 / RX 580 or better
- **Sim Resolution**: 128x128
- **Dye Resolution**: 512x512

### Mobile (720p)
- **30 FPS** minimum on mid-range devices
- **Sim Resolution**: 64x64
- **Dye Resolution**: 256x256

### Quality Settings Impact
| Quality | Sim Res | Dye Res | Pressure Iter | Bloom |
|---------|---------|---------|---------------|-------|
| Low     | 64      | 256     | 2             | Off   |
| Medium  | 128     | 512     | 3             | Light |
| High    | 192     | 1024    | 5             | Full  |

---

## 10. Code Best Practices

### WebGL Resource Management
```javascript
cleanup() {
    // Delete all frame buffers
    this.fbos.forEach(fbo => {
        this.gl.deleteFramebuffer(fbo.fbo);
        this.gl.deleteTexture(fbo.texture);
    });

    // Delete shader programs
    this.programs.forEach(program => {
        this.gl.deleteProgram(program);
    });

    // Call parent cleanup
    super.cleanup();
}
```

### Shader Compilation
```javascript
compileShader(source, type) {
    const shader = this.gl.createShader(type);
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
        console.error('Shader compilation error:', this.gl.getShaderInfoLog(shader));
        this.gl.deleteShader(shader);
        return null;
    }

    return shader;
}
```

### Frame Buffer Creation
```javascript
createDoubleFBO(width, height, internalFormat, format, type) {
    return {
        read: this.createFBO(width, height, internalFormat, format, type),
        write: this.createFBO(width, height, internalFormat, format, type),
        swap() {
            const temp = this.read;
            this.read = this.write;
            this.write = temp;
        }
    };
}
```

---

## 11. Future Enhancements (Post-MVP)

### Advanced Features (Optional)
1. **Vorticity Confinement** - Enhanced turbulence and swirls
2. **Color Mixing** - Multiple dye colors interact realistically
3. **Obstacles** - Flow around game pieces or UI elements
4. **Curl Noise** - Procedural turbulence injection
5. **User Configuration** - In-game settings for color scheme, intensity

### Accessibility
1. **Reduced Motion** - Static gradient fallback
2. **High Contrast Mode** - Simplified color palette
3. **Performance Mode** - Ultra-low resolution option

### Creative Variations
1. **"Solar Flare"** variant - Warm orange/red colors
2. **"Deep Ocean"** variant - Cool blue/green colors
3. **"Prismatic"** variant - Rainbow color injection

---

## 12. Estimated Timeline

| Phase | Tasks | Time Estimate |
|-------|-------|---------------|
| Phase 1: Core Simulation | WebGL setup, shaders, basic simulation | 6-8 hours |
| Phase 2: Visual Polish | Color schemes, bloom, ambient motion | 3-4 hours |
| Phase 3: Integration | Events, registry, interactivity | 2-3 hours |
| Phase 4: Optimization | Performance tuning, cleanup, docs | 3-4 hours |
| **Total** | **End-to-end implementation** | **14-19 hours** |

---

## 13. Risk Mitigation

### Potential Issues & Solutions

**Issue:** Poor performance on low-end devices
**Solution:** Aggressive quality scaling, minimum viable simulation resolution (32x32)

**Issue:** WebGL not supported on some browsers
**Solution:** Feature detection, fallback to static gradient background

**Issue:** Memory leaks from FBOs
**Solution:** Strict cleanup procedures, automated testing with memory profiling

**Issue:** Visual artifacts from simulation instability
**Solution:** Parameter tuning, clamping values, stability checks

---

## 14. Success Criteria

### Must Have ✓
- [ ] Fluid simulation runs smoothly (60 FPS desktop, 30 FPS mobile)
- [ ] Three distinct color schemes
- [ ] Interactive mouse/touch input
- [ ] Game event reactions (combos, line clears)
- [ ] No memory leaks
- [ ] Theme selectable from UI

### Nice to Have
- [ ] Configurable color schemes in settings
- [ ] Advanced simulation features (vorticity, curl noise)
- [ ] Accessibility modes (reduced motion)

---

## 15. References

### Technical Resources
- [GPU Gems Chapter 38: Fast Fluid Dynamics Simulation on the GPU](https://developer.nvidia.com/gpugems/GPUGems/gpugems_ch38.html)
- [WebGL Fluid Simulation by Pavel Dobryakov](https://paveldogreat.github.io/WebGL-Fluid-Simulation/)
- [Navier-Stokes Equations for Dummies](https://www.karlsims.com/fluid-flow.html)

### Existing Codebase References
- `src/themes/base-theme.js` - Theme lifecycle
- `src/rendering/renderer.js` - WebGL renderer integration
- `src/themes/aurora/aurora-theme.js` - Event-reactive theme example
- `src/themes/fluid-dreams/fluid-dreams-theme.js` - Similar aesthetic theme

---

## Conclusion

This implementation plan provides a clear, phased approach to creating a performant, visually stunning fluid animation background theme. By focusing on essential features and leveraging your existing theme infrastructure, we can deliver a high-quality result efficiently.

The "Nebula Flow" theme will stand out as a premium, modern background option while maintaining the clean, efficient integration patterns established in your codebase.

**Next Steps:**
1. Review and approve this plan
2. Begin Phase 1 implementation (core simulation)
3. Iterate based on visual testing and performance metrics
4. Polish and integrate with existing theme system

Let me know if you'd like to adjust any aspect of this plan before we begin implementation!
