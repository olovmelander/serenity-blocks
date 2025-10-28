# Nebula Flow - Debugging Black Screen

## Issue
Theme selector shows "Nebula Flow" but background is just black.

## Added Debug Logging

I've added comprehensive console logging to trace the issue. After refreshing the page and selecting "Nebula Flow", check the browser console (F12) for these messages:

### Expected Console Output

```
[NebulaFlow] createScene() called
[NebulaFlow] Fluid simulator initialized successfully
[FluidSimulator] Initializing...
[FluidSimulator] Canvas size: 1920 x 1080 (or your window size)
[FluidSimulator] WebGL context created
[FluidSimulator] Compiling shaders...
[FluidSimulator] - Advection shader compiled
[FluidSimulator] - Divergence shader compiled
[FluidSimulator] - Pressure shader compiled
[FluidSimulator] - Gradient shader compiled
[FluidSimulator] - Display shader compiled
[FluidSimulator] FBOs created successfully
[FluidSimulator] Initialization complete!
[NebulaFlow] createScene() completed successfully
```

## Troubleshooting Steps

### Step 1: Check Console Output

**Refresh the page**, select "Nebula Flow", and check console for errors.

**If you see shader compilation errors:**
- The `?raw` import might not be working with Vite
- Shaders might have syntax errors

**If initialization stops at "Compiling shaders":**
- One of the shaders has a compilation error
- Check which shader is listed last

**If you see "Canvas size: 0 x 0":**
- Canvas isn't getting dimensions properly
- Window size detection issue

### Step 2: Check Canvas Element

In browser console, run:

```javascript
const canvas = document.querySelector('#nebula-flow-canvas');
console.log('Canvas:', canvas);
console.log('Canvas size:', canvas?.width, 'x', canvas?.height);
console.log('Canvas style:', canvas?.style.cssText);
console.log('Canvas in DOM:', document.contains(canvas));
```

**Expected:**
- Canvas exists
- Canvas has non-zero width/height
- Canvas is in the DOM

### Step 3: Check Theme Container

```javascript
const container = document.getElementById('nebula-flow-theme');
console.log('Container:', container);
console.log('Container active:', container?.classList.contains('active'));
console.log('Container children:', container?.children.length);
```

**Expected:**
- Container exists
- Has "active" class
- Contains the canvas element

### Step 4: Check WebGL Context

```javascript
const canvas = document.querySelector('#nebula-flow-canvas');
const gl = canvas?.getContext('webgl');
console.log('WebGL context:', gl);
console.log('WebGL vendor:', gl?.getParameter(gl.VENDOR));
console.log('WebGL renderer:', gl?.getParameter(gl.RENDERER));
```

**Expected:**
- WebGL context exists
- Vendor and renderer info shown

### Step 5: Manual Test Render

Try manually rendering to the canvas:

```javascript
const canvas = document.querySelector('#nebula-flow-canvas');
const gl = canvas.getContext('webgl');
gl.clearColor(1.0, 0.0, 1.0, 1.0); // Bright magenta
gl.clear(gl.COLOR_BUFFER_BIT);
```

**Expected:**
- Canvas should turn bright magenta/pink
- If it does, WebGL is working but the fluid simulator isn't rendering

## Common Issues

### Issue 1: Shader Import Failure

**Symptom:** Error like "Cannot read properties of undefined (reading 'program')"

**Cause:** Vite `?raw` import not working

**Fix:** May need to inline shaders or use different import method

### Issue 2: Canvas Not Visible

**Symptom:** Console logs show success but nothing visible

**Possible causes:**
- Z-index issue (canvas behind other elements)
- Canvas outside viewport
- Transparency issue

**Fix:**
```javascript
const canvas = document.querySelector('#nebula-flow-canvas');
canvas.style.zIndex = '1000'; // Bring to front temporarily
canvas.style.border = '2px solid red'; // Visual debugging
```

### Issue 3: RG Format Not Supported

**Symptom:** FBO creation fails or shows errors

**Cause:** `gl.RG` format not supported on some browsers

**Fix:** Already handled - falls back to `gl.RGBA`

### Issue 4: Texture Format Issues

**Symptom:** Black screen, no errors in console

**Cause:** Framebuffer attachment incomplete

**Check:**
```javascript
const theme = window.themeManager.activeTheme;
const gl = theme.simulator.gl;
gl.bindFramebuffer(gl.FRAMEBUFFER, theme.simulator.fbos.dye.read.fbo);
console.log('Framebuffer status:', gl.checkFramebufferStatus(gl.FRAMEBUFFER));
// Should be: 36053 (FRAMEBUFFER_COMPLETE)
```

## Quick Fixes to Try

### Fix 1: Force Canvas Visibility

In `nebula-flow-theme.js`, after creating canvas:

```javascript
this.canvas.style.backgroundColor = 'rgba(5, 5, 15, 1)'; // Dark blue
this.canvas.style.zIndex = '0'; // Ensure it's visible
```

### Fix 2: Add Initial Dye

After initialization completes, add some color immediately:

```javascript
// In nebula-flow-theme.js, after simulator.init()
// Add a large initial splat to see something
for (let i = 0; i < 5; i++) {
    this.addRandomSplat(true);
}
```

### Fix 3: Simplify Display Shader

The display shader might be too dark. Temporarily modify `display.frag`:

```glsl
void main() {
    vec4 color = texture2D(u_dye, v_texCoord);

    // TEMPORARY: Boost brightness for debugging
    color.rgb *= 5.0;

    gl_FragColor = vec4(color.rgb, 1.0);
}
```

## Report Findings

After checking the console, report:

1. **What console logs appear?** (copy exact output)
2. **Canvas element info** (size, visibility)
3. **WebGL context status** (exists, vendor/renderer)
4. **Any error messages?**

This will help pinpoint the exact issue!

## Temporary Workaround

If fluid simulation isn't working, we can temporarily use a simple gradient or static pattern to verify the canvas rendering works:

```javascript
// In fluid-simulator.js display() method, replace with:
display() {
    const gl = this.gl;
    gl.clearColor(0.2, 0.1, 0.3, 1.0); // Purple
    gl.clear(gl.COLOR_BUFFER_BIT);
}
```

This will at least show if the canvas is rendering at all.
