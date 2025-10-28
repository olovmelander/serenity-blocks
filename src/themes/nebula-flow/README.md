# Nebula Flow Theme

A GPU-accelerated fluid dynamics background theme featuring real-time fluid simulation using WebGL.

## Overview

Nebula Flow creates organic, flowing visual effects using a simplified Navier-Stokes solver running entirely on the GPU. The theme responds to mouse/touch input and game events, creating an immersive, interactive background.

## Features

- **Real-time Fluid Simulation**: GPU-accelerated 2D incompressible flow
- **Multiple Color Schemes**: Cosmic, Ocean, Aurora, Fire, and Prismatic palettes
- **Interactive**: Responds to mouse/touch movement
- **Game Event Reactions**: Visual effects triggered by combos, line clears, and piece locks
- **Performance Optimized**: Quality settings automatically adjust simulation resolution
- **Ambient Motion**: Automatic splats create a living, breathing background

## Technical Details

### Simulation Pipeline

The fluid simulation runs through the following steps each frame:

1. **Advection** - Move velocity field along itself (semi-Lagrangian)
2. **Divergence** - Calculate velocity divergence
3. **Pressure Solve** - Iteratively solve for pressure (Jacobi method)
4. **Gradient Subtraction** - Make velocity field incompressible
5. **Dye Advection** - Move color field along velocity
6. **Display** - Render to screen with optional bloom

### Shaders

- `base.vert` - Shared fullscreen quad vertex shader
- `advection.frag` - Advect fields along velocity
- `divergence.frag` - Compute velocity divergence
- `pressure.frag` - Pressure Poisson solver (Jacobi iteration)
- `gradient.frag` - Subtract pressure gradient from velocity
- `display.frag` - Final rendering with bloom effect

### Configuration

```javascript
{
    simResolution: 128,           // Simulation grid size (lower = faster)
    dyeResolution: 512,           // Visual quality (higher = prettier)
    pressureIterations: 3,        // Solver accuracy (3-5 recommended)
    velocityDissipation: 0.98,    // How long velocity persists
    densityDissipation: 0.99,     // How long colors persist
    splatRadius: 0.25,            // Size of disturbances
    splatForce: 6000,             // Strength of velocity injection
    bloomIntensity: 0.3,          // Glow effect strength
}
```

## Performance

### Targets

- **Desktop (1920x1080)**: 60 FPS on GTX 1060 or better
- **Mobile (720p)**: 30 FPS on mid-range devices

### Quality Settings

| Quality | Sim Resolution | Dye Resolution | Iterations | Bloom |
|---------|----------------|----------------|------------|-------|
| Low     | 64x64          | 256x256        | 2          | Off   |
| Medium  | 128x128        | 512x512        | 3          | Light |
| High    | 192x192        | 1024x1024      | 5          | Full  |

## Color Schemes

### Cosmic (Default)
Deep space purples and blues with pink accents. Evokes nebulae and cosmic phenomena.

### Ocean
Cool aquatic colors with cyan, teal, and deep blue. Creates an underwater atmosphere.

### Aurora
Northern lights palette with greens, purples, and cyan. Mimics aurora borealis.

### Fire
Warm oranges, reds, and yellows. Solar flare aesthetic.

### Prismatic
Rainbow spectrum with pink, sky blue, and lime. Colorful and vibrant.

## Usage

The theme is automatically registered and can be selected from the theme dropdown:

```javascript
// Select from UI
settings.theme = 'nebula-flow';

// Or programmatically
themeManager.switchTheme('nebula-flow');
```

## Game Event Integration

### Line Clear
Creates splats based on the number of lines cleared. More lines = more splats.

### Combo
Intense multi-splat effect with increasing intensity based on combo count.

### Piece Lock
Subtle single splat on each piece placement.

## Browser Compatibility

Requires WebGL support:
- Chrome 56+
- Firefox 51+
- Safari 15+
- Edge 79+

Falls back gracefully if WebGL is not available (shows solid background).

## References

- [GPU Gems Chapter 38: Fast Fluid Dynamics Simulation on the GPU](https://developer.nvidia.com/gpugems/GPUGems/gpugems_ch38.html)
- [WebGL Fluid Simulation by Pavel Dobryakov](https://paveldogreat.github.io/WebGL-Fluid-Simulation/)
- [Jos Stam - "Stable Fluids" (SIGGRAPH 1999)](https://www.dgp.toronto.edu/public_user/stam/reality/Research/pdf/ns.pdf)

## Future Enhancements

Potential improvements for future versions:

- Vorticity confinement for enhanced turbulence
- Multiple dye colors with realistic mixing
- Obstacles (flow around game pieces)
- Curl noise for procedural turbulence
- User-configurable parameters in settings
- Accessibility modes (reduced motion, high contrast)

## License

MIT - Same as parent project
