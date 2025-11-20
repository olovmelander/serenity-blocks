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
- **Multiple Color Schemes**: Cosmic, Ocean, Aurora, and Prismatic palettes.
- **Game Event Reactions**: Spectacular visual effects triggered by combos, line clears, and piece locks.
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

## Performance

### Quality Settings

| Quality | Sim Resolution | Dye Resolution | Iterations | Bloom | Sunrays |
|---------|----------------|----------------|------------|-------|---------|
| Low     | 64x64          | 512x512        | 10         | Off   | Off     |
| Medium  | 128x128        | 512x512        | 15         | On    | Off     |
| High    | 128x128        | 1024x1024      | 20         | On    | On      |

## References

- [WebGL Fluid Simulation by Pavel Dobryakov](https://github.com/paveldogreat/WebGL-Fluid-Simulation)
- [GPU Gems Chapter 38: Fast Fluid Dynamics Simulation on the GPU](https://developer.nvidia.com/gpugems/GPUGems/gpugems_ch38.html)

## License

MIT - Adapted from WebGL Fluid Simulation (MIT License Copyright (c) 2017 Pavel Dobryakov)
