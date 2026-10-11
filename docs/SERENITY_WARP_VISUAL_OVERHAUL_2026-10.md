# Serenity Warp — the wormhole gate

A total visual rebuild of the Serenity Warp theme (2026-10-11), on WebGPURenderer + TSL with the
WebGL2 backend as fallback. It replaces the adapter that drew the boot intro's renderer
(`src/ui/threejs-intro-renderer*.js`) behind the board; the intro itself is untouched and still
plays at boot. Supersedes `docs/SERENITY_WARP_COMBO_LOCK_FIX_PLAN_2026-07.md`.

## The picture

Deep blue and violet space, the game's own pieces drifting in it — what the old theme was — taken
to a place: a **wormhole** hangs in the free space left of the card (above it on an upright
phone). Space runs into it: the gas winds round it in two spiral arms and flows in, stars and dust
stream along the current, and through its throat **another sky** shows — a galaxy seen face on,
in the colours of the palette the drift is heading for. The throat is ringed by a thin, sharp
Einstein ring; just outside it our own sky is bent round it, stars drawn into arcs.

The **pieces** are the game's tetrominoes, solid and in their own colours, as they always were in
this theme: each is one fused block with rounded edges (never four cubes), glossy, lit by the gate
and a soft light from above, with a light of its own and a little of the sky showing through it.
They drift on the current and spiral into the throat.

## Event language

| Event | What happens |
|---|---|
| lock | The piece lifts off the board as a solid block in its own shape, colour and the orientation it locked in, white hot. It comes out at the card's edge on the gate's side with a four-pointed flare and a ripple through space round it, cools to its colour within two seconds and joins the current. A hard drop: a larger piece, a quicker flight, a stronger ripple, a kick. |
| clear | The throat breathes out: one ring of light per line leaves its rim and crosses the whole sky (it bends the sky as it passes, and every piece flares as the ring goes through it). The cleared rows send streams of light from the card into the throat. One piece per line, the one furthest along, falls in: drawn out into a streak of its colour, a flash on the rim in that colour as it goes. |
| combo | Each step of a chain winds the warp up: the current runs faster, the arms wind tighter and flow in quicker, near stars draw out into trails, the dust streams, the pieces glow from within, the lens opens a little, and a ring in the nebula's own glow leaves the rim. When the chain breaks the warp lets go. |
| four lines / perfect | The warp holds its breath (every light sinks for a quarter second), then the throat opens wider than the frame round us: our sky is lensed into rings as it swells, the galaxy rushes at us, its light streams past as the throat's walls. Half the field goes in ahead of us. We come out under the sky we saw in the throat (the gas field is moved), a ring of light leaving the new gate. |
| T-spin | The vortex twists round the gate and springs back; the pieces tumble. |
| level | The sky moves one palette along its line of six, and a slow ring of the new colour leaves the rim. |
| time | With no level change at all the sky drifts along the same line by itself: one palette every 90 s (resting 15 % of each step at either end, so it is on its way about 70 % of the time). The level is a step added on top of the clock: `place = (level − 1) + t / 90`. The throat always shows the palette one step ahead. |

The field is never empty: about ten pieces drift in from the edges of the frame with no play.
When the board keeps locking, the current runs faster (a crowded field flows in quicker) and the
piece furthest along is let go first, so the procession into the gate keeps pace with the board.

## How it is built

`src/themes/serenity-warp/`:

| Module | Role |
|---|---|
| `serenity-warp-theme.js` | BaseTheme adapter (ported from Stellar Velocity's): renderer (WebGPU, else the WebGL2 backend), post, director, layout reads on frame time, pointer parallax, settings, GPU-loss recovery, capture flags. The clock survives a rebuild in place. |
| `serenity-warp-world.js` | The world, shared with the playground effect: uniforms, parts, camera rig, the pieces' pool and runs, events, palettes. |
| `serenity-warp-core.js` | Three-free constants and maths: the gate, the run (`pathAt`), shapes and cell packing, the CPU twin of the pieces' trace (`unionExit`), waves, the jump, the six palettes and the wheel, anchors per aspect. |
| `serenity-warp-sky.js` | The sky as ONE function of a direction: the throat (the other sky folded into it, γ = π (θ/α)^1.35), the lens outside (β = θ − α²/θ), the vortex (log-polar about the gate's axis, wound, flowing in), deep clouds, star lattices sized by their footprint (dimmed where the lens squeezes them), waves and ripples, the jump's tunnel. Drawn along the view ray as the backdrop (after the pieces, depth-tested), and painted in every direction into a small equirectangular target each frame. |
| `serenity-warp-glass.js` | The pieces: each shape extruded from its outline (`pieceOutline`, inset, rounded corners, `ExtrudeGeometry` with a rounded bevel, merged for smooth normals), seven instanced draws sharing one material. A lock's turn is matched to its shape (`matchShape`) and applied as quarter turns in its quaternion. Shading: body colour lit by the gate and a top light, own glow, clear-coat Fresnel reflection of the environment target, the gate's glint, a sheen, and 30 % of the sky refracted through the piece (traced to where it leaves the union of its cells, stained by the path). |
| `serenity-warp-stars.js` | Near stars and the dust of the current as instanced streaks (points at rest, trails in a chain). |
| `serenity-warp-fx.js` | Screen-space streams (cleared rows → throat) and four-pointed flares. |
| `serenity-warp-post.js` | One scene pass (MSAA on High and up, for the pieces' edges), hue-preserving bloom, the rush toward the gate, the gate's shafts (the pieces shadow them), calm zones over the card and HUD, filmic tone map, grade. |
| `serenity-warp-director.js`, `-composition.js` | Gameplay staging (now also the locked piece's shape and cells) and the layout rects, as in the sibling rebuilds. |
| `serenity-warp-quality.js` | Tiers. |

No textures or models are loaded: the gas volume (64³) and the grain are baked on the CPU at
build time. Blender was not needed (the pieces are extruded outlines).

## Tiers

Every tier keeps the whole picture and every event. They scale the gas's second read and its
curl, star lattices, the environment target (256–1024 wide; Low and Minimal paint it every other
frame), how many pieces are held (12–24) and drift with no play (6–12), the pieces' bevel
segments, near stars (400–4400) and dust (120–1100), and in the post: bloom (Medium and up),
MSAA (High and up), the rush and the shafts.

## Verification

All on 2026-10-11, on this laptop (RTX 3070 laptop GPU unless noted).

- **Shader graphs**: every material (sky, pieces, stars, dust, streams, flares, the environment
  pass) built in Node for both backends (WGSL and GLSL) with no warning, at every change.
- **Unit tests**: five files — core (palettes, the clock drift, the run, the dive, shapes and their
  packing, the CPU twin of the pieces' trace, waves, the jump, anchors, the environment map), world
  (the board's events end to end on a real world, capacity, replay, sizes), director, composition,
  theme (the adapter, ported from Stellar Velocity's): 135 tests (21 + 19 + 21 + 10 + 64). The palette test caught a
  half-way mix going grey (amethyst's gold threads against rose's azure) before any capture did.
- **CI gates**: typecheck, ts ratchet, lint ratchet (count shrank; baseline left alone), fitness,
  theme-lifecycle audit, boundaries, palette, perf budgets, the production build with boot
  closure, IP strings, pages artifact, release gates: all green.
- **Playground**: WebGPU at every tier, forced WebGL2 (Minimal and High), 16:9, 21:9 and an
  upright phone, every event and seven palettes; clean consoles.
- **The real game** (dev server, `skipIntro=1&unlockAll=1`, Serenity Warp pinned): WebGPU and the
  WebGL2 backend at High, about 131 fps (the display's rate); real hard drops from the keyboard
  became lock pieces, clears, a chain, four lines, a live quality change rebuilt on Medium, and
  leaving the theme left no canvas behind. A clock-only run (`serenityWarpFixedDt=250`, no play,
  the HUD on level 1 throughout) walked the sky rose → amethyst → serenity → lagoon → verdant.
- **The iGPU** (AMD, `force_low_power_gpu`): the same real-game run at High, 128–130 fps (the
  display's rate), clean console.
- **Theme lifecycle validator** (`scripts/validate-all-themes.mjs --theme serenity-warp`, fresh
  Electron process): PASS, 0 lifecycle failures, 0 console errors.
- **Phone emulation** (`scripts/validate-mobile-webgl2.mjs`, software WebGL2): pass at Low and at
  Minimal; its portrait, effects and landscape screenshots were looked at (gate above the frame's
  middle, no snow, no black blocks).
- **Whole unit suite**: 812 of 814 files; the two failures are this machine's and fail the same on
  untouched main (`odyssey-level-briefing`: Swedish number format; `tts-recorder-e2e`: a symlink
  Windows refuses).
- Two things only the real layout showed, both fixed: the game's board cells are smaller than the
  playground mock's, so lock pieces came out three times the board's cell (now sized from the live
  board, about 1.7×), and a run of hard drops piled white-hot pieces by the card (they now cool
  within a second and dive toward the gate at once).

**Open:** no perf-lane (ADR-0016) GPU-cost reading; not tried on a physical phone; multiplayer,
Infinity, meditation and Odyssey layouts not captured; nobody has watched it move except through
stills and strips; the icon (the ringed throat with a knot of coloured pieces in front) is my pick.

## Reproduce

Playground (`npm run dev:playground`, then `playground.html?effect=serenity-warp&...`):

| Frame | Query |
|---|---|
| rest | `t=20&quality=High` |
| with the board | `t=26&quality=High&board=1&locks=6` |
| a lock, hot / cooled | `t=20&quality=High&board=1&event=lock&eventAge=0.4&piece=J&turns=1&row=12&u=0.2` / `eventAge=4` |
| a clear | `t=26&quality=High&board=1&locks=6&event=clear&lines=3&eventAge=0.7` |
| a chain | `t=26&quality=High&board=1&locks=8&combo=7` |
| the jump | `t=26&quality=High&board=1&event=quad&eventAge=0.75` (opening), `1.6` (inside), `3.4` (out) |
| palettes | `t=10&quality=High&level=1…7` (t=10 is inside the rest) |
| the icon | `t=20&quality=High&icon=1` (square frame) |

Real game: `?skipIntro=1&unlockAll=1`, then pick Serenity Warp; capture flags
`serenityWarpTime`, `serenityWarpFixedDt`, `serenityWarpParts=sky,glass,stars,motes,streams,flares`,
`serenityWarpFalseColor`, `serenityWarpForceWebGL`.
