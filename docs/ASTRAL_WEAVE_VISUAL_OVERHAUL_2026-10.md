# Astral Weave — the celestial silk loom

Implemented 2026-10-04 on `codex/astral-weave-visual-overhaul`, with Three.js 0.186.1.
This document records the shipped branch design and bounded verification. It is a
reference, not a new backlog.

## Result

The thin radial tubes and hard cone shafts have been replaced by paired, folded silk
arcs around a quiet playfield. Cyan, violet and rose threads flow through pearlescent
fabric, with a brighter pearl loom above the board, soft nebula banks, star jewels and
fine drifting particles. Gold accents belong to clears and stronger combos.

The new `astral-weave-world.js` owns the baked cloud field, sky, loom corona and
instanced constellation jewels. The ribbon curves and strip geometry are shared with
the isolated playground effect. The shipping theme retains its existing lifecycle,
event bus, quality selection, native compute and forced-WebGL2 recovery paths.

| Event | Visual response |
| --- | --- |
| Piece lock | A small stitch pulse and a few pearl sparks. |
| Line clear | One coherent wave travels from the loom along the complete silk arcs. |
| Tetris | A warm crown, constellation scintillation and a gold woven ripple. |
| Combo | A slower aurora charge; stronger combos add the crown and gold ripple. |

All envelopes decay by elapsed seconds. Burst queues have fixed limits and stale
impacts expire after 0.4 seconds. Event storms coalesce into a gold ripple and a clear
ripple. Camera sway is smooth and deterministic; nebula movement is bounded and no
longer accumulates per frame.

## Renderer and layout fixes

- Both backends use node materials and the same composition. Native WebGPU retains
  compute/MRT; WebGL2 uses attributes and the bounded CPU burst pool.
- Stars, flow and dust now use instanced billboard quads. The old `Points` masks read
  geometry UVs that were absent, making those systems nearly invisible.
- Portrait layout reduces the silk span while compensating the core and corona to
  preserve circular shapes. Ripple origins use the full scene transform.
- Thin double-sided surfaces render in one pass. Instanced meshes explicitly release
  their instance buffers during teardown. Native compute pipelines prepare asynchronously.
- Post-processing preserves faint shadow hues, adds restrained saturation and bloom,
  and removes the old film grain and exaggerated vignette/chromatic treatment.
- Counts are fixed per tier: 4–14 silk arcs and 320–2,400 soft stars. The baked cloud
  texture replaces repeated fragment-noise bodies in the large backdrop.

## Verification

- Production build and boot closure, typecheck, changed-source lint, and diff checks pass.
- 76 focused tests pass: reaction timing/limits, geometry, transformed ripple origin,
  disposal, WebGL2 node parity, renderer recovery and r186 compute contracts.
- Real theme screenshots: 1,280×720 desktop High and 390×844 portrait High/Low WebGL2;
  idle, Tetris and combo frames have zero console errors or warnings.
- High submits 38 idle / 40 event draws; Low portrait submits 20 / 22. These include
  post-processing and were read directly before renderer counters reset.
- The single-pass change preserved the captured appearance: mean RGB difference below
  0.006 on the 0–255 scale against the corresponding two-pass captures.

This environment uses software browser rendering. Native WebGPU could not be visually
accepted: Dawn reported `Instance dropped in popErrorScope` and lost its software device.
The same failure occurred with an isolated green plane, without Astral code, post,
MRT, compute or the shared WebGL context. Native GPU hardware acceptance remains open;
these captures establish WebGL2 correctness, not physical-phone FPS or hardware performance.

## Reproduce

Run `npm run dev:playground`, then use:

`/playground.html?effect=astral-weave&t=2&forceWebGL=1&quality=High`

Add `event=tetris&eventAge=0.35` or `event=combo&combo=5` for deterministic event frames.
Use `board=1` for a composition guide. Production baseline controls remain available
through `astralWeaveBaseline`, `astralWeaveSeed`, `astralWeaveFixedDt` and
`window.astralWeaveBaseline`.

## Captured previews

![Desktop idle](astral-weave-captures/desktop-idle.webp)

![Desktop events](astral-weave-captures/desktop-events.webp)

![Portrait events](astral-weave-captures/portrait-events.webp)
