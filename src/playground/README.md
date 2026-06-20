# WebGPU/TSL Playground

A standalone page for iterating on a single WebGPU/TSL effect in isolation — instant
HMR, deterministic time, a screenshot-ready signal, and a reference-image overlay. It is
**decoupled from the game**: it does not boot `BaseTheme`, the theme DOM containers, or
the eventBus theme pipeline. Iterate a shader here in seconds, then port the proven code
into a real theme.

## Run it

```bash
npm run dev:playground        # opens /playground.html
# or: npm run dev  then open  http://localhost:5173/playground.html
```

## URL parameters

| param | meaning |
| --- | --- |
| `effect=<id>` | which effect to mount (default: first registered) |
| `t=<seconds>` | **fixed** deterministic time — phase-locked, reproducible screenshots |
| `paused=1` | start paused |
| `orbit=0` | disable the default orbit camera (static framing) |
| `forceWebGL=1` | force the WebGL2 backend instead of WebGPU |
| `ref=<url>` | reference image to overlay, e.g. `/playground-refs/target.png` |
| `refMode=overlay\|split\|side` | how the reference is shown |
| `refOpacity=<0..1>` | reference opacity in `overlay` mode |

Example: `/playground.html?effect=nebula-dome&t=8&ref=/playground-refs/sky.png&refMode=split`

## Authoring an effect

Drop a file named `<id>.effect.js` into [`effects/`](effects/) — it auto-registers (no
wiring). It must export `meta` and `create`:

```js
import * as THREE from 'three/webgpu';          // WebGPURenderer + *NodeMaterial + core THREE
import { uniform, mix, sin /* ... */ } from 'three/tsl';   // TSL nodes

export const meta = {
  id: 'my-effect',            // unique, kebab-case; also the ?effect= value
  title: 'My Effect',
  description: 'one line shown in the dropdown',
};

// ctx = { THREE, scene, camera, renderer, sizes:{width,height}, params:URLSearchParams }
export function create({ scene }) {
  const uTime = uniform(0);
  // ...build geometry + a *NodeMaterial, set material.colorNode/emissiveNode/positionNode...
  // scene.add(mesh);
  return {
    cameraRadius: 6,                 // optional: default-orbit distance
    update(time, dt) { uTime.value = time; },   // optional: push time into uniforms
    camera(time, camera) { /* optional: drive the camera; deterministic in `time` */ },
    resize(w, h) { /* optional */ },
    dispose() { /* required: remove from scene + dispose geometry/material */ },
  };
}
```

Two starters to copy: [`nebula-dome.effect.js`](effects/nebula-dome.effect.js) (a
backdrop — BackSide sphere `colorNode`) and [`pulse-sphere.effect.js`](effects/pulse-sphere.effect.js)
(an object material — animated color + emissive fresnel + vertex displacement).

### TSL reminders
- Renderer + node materials come from `three/webgpu`; TSL nodes from `three/tsl`. A single
  `import * as THREE from 'three/webgpu'` also gives you core types (Scene, Color, geometries).
- TSL is method-chained: `a.mul(b).add(c)`, wrap literals with `float()/vec2()/vec3()`.
- Effects attach to node slots: `colorNode`, `emissiveNode`, `opacityNode`, `positionNode`
  (vertex displacement), `sizeNode` (points).
- The deep reference lives in the `webgpu-threejs-tsl` skill — your agent loads it automatically.

## Screenshot / agent contract

After the first frame compiles and renders, the page sets `window.__PLAYGROUND_READY__ = true`,
prefixes the tab title with `✓`, and dispatches a `playground-ready` event. Drive it from an
agent via `window.__PLAYGROUND__`: `setEffect(id)`, `setTime(s)`, `clearFixedTime()`,
`pause(bool)`, `setReference(url, opts)`, `backend()`, `listEffects()`.

For reproducible captures use a fixed `?t=` and wait on `window.__PLAYGROUND_READY__`.
⚠️ Keep sessions to a single small effect — full WebGPU journey captures have TDR-crashed the dev iGPU.
