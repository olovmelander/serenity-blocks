# Nebula Flow - Bug Fix Applied

## Issue Found

When testing the theme in the browser, encountered this error:

```
TypeError: Cannot read properties of undefined (reading 'width')
    at FluidSimulator.advect (fluid-simulator.js:285:72)
```

## Root Cause

The `advect()` method was receiving inconsistent parameter types:

**Problem on line 252:**
```javascript
// Passing double FBO as velocity parameter
this.advect(this.fbos.velocity, this.fbos.velocity, dt, ...)
```

But the method expected `velocity` to be a **single FBO** (with `.width`, `.height`, `.texture`), not a double FBO (with `.read` and `.write`).

## Fix Applied

### 1. Fixed the method call (line 252)
```javascript
// Before:
this.advect(this.fbos.velocity, this.fbos.velocity, dt, this.config.velocityDissipation);

// After:
this.advect(this.fbos.velocity, this.fbos.velocity.read, dt, this.config.velocityDissipation);
```

### 2. Updated advect() method to clarify expectations (lines 280-302)
```javascript
/**
 * Advection step
 * @param {Object} target - Double FBO to advect (read from target.read, write to target.write)
 * @param {Object} velocity - Single FBO containing velocity field
 * @param {number} dt - Time step
 * @param {number} dissipation - Dissipation factor
 */
advect(target, velocity, dt, dissipation) {
    // ...
    // Now correctly accesses velocity.width and velocity.texture
    gl.uniform2f(program.uniforms.u_texelSize, 1.0 / velocity.width, 1.0 / velocity.height);
    gl.bindTexture(gl.TEXTURE_2D, velocity.texture);
    // ...
}
```

## Status

✅ **Fixed!** The theme should now load and run without errors.

## Testing

Reload the page and:
1. Select "Nebula Flow" from theme dropdown
2. Should see fluid animation without console errors
3. Mouse movement should create fluid trails
4. Game events should trigger splats

## Files Modified

- `src/themes/nebula-flow/fluid-simulator.js` (lines 252, 289, 295)

## Notes

The confusion came from mixing two patterns:
- **Double FBOs** (for ping-pong rendering): Have `.read` and `.write` properties
- **Single FBOs** (for read-only access): Have `.width`, `.height`, `.texture` directly

The `advect()` method needs:
- `target`: Double FBO (to write results)
- `velocity`: Single FBO (read-only, for sampling velocity)

This is now correctly documented and implemented.
