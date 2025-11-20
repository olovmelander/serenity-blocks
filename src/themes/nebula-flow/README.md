# Nebula Flow Theme

A GPU-accelerated fluid dynamics background theme featuring real-time fluid simulation using WebGL.
This is a faithful port of the [WebGL Fluid Simulation](https://github.com/paveldogreat/WebGL-Fluid-Simulation) by Pavel Dobryakov.

## Overview

Nebula Flow creates organic, flowing visual effects using a Navier-Stokes solver running entirely on the GPU. The theme is fully autonomous, creating an immersive, living background without requiring user interaction.

## Features

- **Real-time Fluid Simulation**: High-fidelity GPU-accelerated 2D incompressible flow.
- **Advanced Visual Effects**:
    - **Bloom**: High-quality bloom for glowing, neon-like visuals.
    - **Sunrays**: God-ray effects that shine through the fluid.
    - **Vorticity Confinement**: Enhanced swirling and turbulence.
- **Autonomous Motion**: Self-animating fluid with multiple wandering emitters.
- **Multiple Color Schemes**: Cosmic, Ocean, Aurora, Fire, and Prismatic palettes.
- **Themed Tetrominos**: Vibrant, glowing game pieces with pulse, shimmer, and trail effects that match the nebula aesthetic.
- **Game Event Reactions**: Spectacular visual effects triggered by combos, line clears, and piece locks.
  - **Regular Combos (1-3)**: Single spiral pattern
  - **High Combos (4-7)**: Dual counter-rotating spirals
  - **Epic Combos (8+)**: Triple spiral explosion with central burst
  - **Tetris (4 lines)**: Dual mirrored wave effect
- **Performance Optimized**: Quality settings automatically adjust simulation resolution and toggle expensive effects (Bloom, Sunrays).
- **Black Background**: High contrast vibrant fluid on pure black.

## Technical Details

### Simulation Pipeline

The fluid simulation runs through the following steps each frame:

1.  **Curl & Vorticity** - Calculate vorticity to enhance swirling motion.
2.  **Divergence** - Calculate velocity divergence.
3.  **Pressure Solve** - Iteratively solve for pressure (Jacobi method).
4.  **Gradient Subtraction** - Make velocity field incompressible.
5.  **Advection** - Move velocity and dye fields along the velocity vectors.
6.  **Post-Processing** - Apply Bloom and Sunrays effects.

### Configuration

The simulation is highly configurable via the `FluidSimulator` class:

```javascript
{
    SIM_RESOLUTION: 128,          // Simulation grid size
    DYE_RESOLUTION: 1024,         // Visual quality
    PRESSURE_ITERATIONS: 20,      // Solver accuracy
    CURL: 30,                     // Vorticity strength
    SPLAT_FORCE: 6000,            // Emitter strength
    BLOOM: true,                  // Enable bloom
    SUNRAYS: true,                // Enable sunrays
    // ...
}
```

## Themed Tetrominos

Nebula Flow features custom-designed glowing tetrominos that complement the fluid simulation:

- **Electric Cyan (I)** - Flowing water energy
- **Bright Magenta (O)** - Cosmic energy burst
- **Deep Purple (T)** - Nebula core
- **Spring Green (S)** - Aurora flow
- **Hot Pink (Z)** - Stellar burst
- **Sky Blue (J)** - Cosmic vapor
- **Bright Orange (L)** - Solar flare

Each piece includes:
- **Glow effects** with auto-derived colors
- **Pulse animation** synced with nebula flow
- **Shimmer overlay** for liquid appearance
- **Motion trails** during piece movement

See [TETROMINO_CONFIG.md](./TETROMINO_CONFIG.md) for detailed configuration.

## Performance

### Quality Settings

The fluid simulation is highly optimized and performs exceptionally well. **All quality settings use the same extreme configuration** for the best possible experience:

| Quality Setting | Configuration |
|----------------|---------------|
| **All Levels** (Minimal → Extreme) | 320x320 sim, 1280x1280 dye, 25 iterations |

**Why the same for all?**
- The simulation performs excellently on modern hardware
- GPU acceleration makes high-resolution fluid dynamics fast
- No need to compromise on quality - everyone gets the best experience
- Smooth 60+ FPS across all settings

**Technical Specs:**
- **Simulation Resolution**: 320×320
- **Dye Resolution**: 1280×1280
- **Pressure Iterations**: 25
- **Curl Strength**: 45
- **Performance**: Smooth 60+ FPS on modern GPUs

## References

- [WebGL Fluid Simulation by Pavel Dobryakov](https://github.com/paveldogreat/WebGL-Fluid-Simulation)
- [GPU Gems Chapter 38: Fast Fluid Dynamics Simulation on the GPU](https://developer.nvidia.com/gpugems/GPUGems/gpugems_ch38.html)

## License

MIT - Adapted from WebGL Fluid Simulation (MIT License Copyright (c) 2017 Pavel Dobryakov)
