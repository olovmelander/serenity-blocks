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

## Second pass (2026-10-21): atmosphere, the jump, the light

A pass over the look; nothing in the event language changed. All in `serenity-warp-sky.js` unless named.

| Where | Before | Now |
|---|---|---|
| The vortex | A flat twirl: smooth ribbons streaked along the spiral, the same brightness on both sides of every arm | Lit by the throat: one more read of the gas a step nearer the gate (`turn + wind·dL`, `L − dL` in its log-polar frame) gives every billow a face that looks at the gate (bright, its edges in the gate's colour) and a far side in shade. A second, nearer veil of dust winds 30 % slower and crosses the arms, dark against the glow. The outer arms are broken by the open sky's clouds (far out the log-polar read magnifies itself into long smears). Nearest the throat the gas runs hot, toward the gate's white. |
| The ring | One uniform white neon circle | Beamed: the side the swirl comes at us from is brighter and bluer, the other dimmer and in the gas's colour; the gas behind the throat is lensed into arcs along it; a fainter second ring a little outside. The halo is tinted by the glow and takes only half of a surge. |
| The open sky | A flat mauve haze, evenly sprinkled | An emission nebula in two hues with dust threads (extinction, so the clouds have edges), a band of our own galaxy across the sky toward the gate with a dust rift down its spine and a fine grain of faint stars along it, star colours from orange to blue-white, dust hiding stars, and one cell in twenty of a coarse lattice holding a bright star with a halo and four spikes upright on the screen. |
| A jump | Overlapping translucent discs with hard edges (rings drawn as `pow(fract(log θ), 14)`: a hard leading edge and a long tail each), fBm smears, green blotches | Hyperspace: lanes round the tunnel holding dashes of light that run out past us, a pixel wide at any angle, in the other sky's colours over a dim glow of its gas; thin rings rushing past. The zoom blur only softens it (half as strong). |
| Lens fringe (`serenity-warp-post.js`) | Red and blue taken whole from the sharp scene while green stayed blurred: during the rush the picture broke into green and magenta | Only the split itself is added to the rushed picture. |
| Clear waves | Broad flat bands of light | A lens: a dim body and wake, a thin crest whose colours split a little (blue leads, red trails), twice the bend of the sky behind it. |
| A chain, an arrival (post, world) | A grey veil over the gate (the bloom's wide mips) | Bloom radius 0.62 → 0.42, and the bloom gives way while the scene itself burns brighter (`bloomEase`: the warp and the surge); the shafts grow less with a chain; a surge lifts the gate half as much. |
| The pieces (`serenity-warp-glass.js`) | Lit by the gate's direction from the camera, so every piece as if it stood on the axis | Lit from where the gate stands; the silhouette on the gate's side burns in its light, and with the gate behind it a cooled piece glows through in its own colour (stained glass against a window). |

**Tiers** (`serenity-warp-quality.js`): `vortexLight` (Medium up), `vortexDust` (High up), `heroStars` and `richFar` (the nebula, the band and its grain; Medium up). Low and Minimal keep the old open sky: on the integrated Radeon 610M the sky shader is most of the frame and is bound by arithmetic there, so every term shows (see the timing below). The environment pass (what the pieces mirror) never draws the relief, the near dust or the bright stars.

**Gate**: `tests/unit/serenity-warp-shaders.test.js` (new) builds every material, the environment pass and the post output through the WGSL and GLSL builders at High and Minimal: no warning, under 96 KB a stage, no equal smoothstep edges, NaN/Infinity, stringified nodes, MaterialX noise, reserved parameter names or WGSL vars read before they are assigned; and it counts the gas reads each tier's sky makes (High 8, Minimal 4; the environment pass 6 and 4).

**Verified** on 2026-10-21 (RTX 5080 Laptop unless named): playground captures of every event, six palettes, every tier, Ultra at 2400 × 1350, an upright phone and the WebGL2 backend, clean consoles; the lifecycle validator PASS (0 failures, 0 console errors); the real game (pinned theme, real hard drops) at High. **Frame cost** on the AMD Radeon 610M (`force_low_power_gpu`, 1600 × 900, GPU timestamps, median of 120 frames, old and new served side by side and interleaved, other sessions working on the machine): High 37.4 / 25.6 ms against 35.2 / 27.3 (inside the noise); Low 14.5 / 13.9 against 12.8 / 12.5 (about +1.5 ms, after the lean tiers were split off; with the rich sky everywhere Low was +3.6 ms). Medium too noisy to call (18.7 / 16.3 against 22.0 / 14.6).

**Still open**: a run of hard drops at an unrealistic rate (about 500 pieces a minute) piles white-hot newborns beside the card into a pastel glow, as it did before this pass; nobody has watched it move except through stills; not on a physical phone.

## Reproduce

Playground (`npm run dev:playground`, then `playground.html?effect=serenity-warp&...`):

| Frame | Query |
|---|---|
| rest | `t=20&quality=High` |
| with the board | `t=26&quality=High&board=1&locks=6` |
| a lock, hot / cooled | `t=20&quality=High&board=1&event=lock&eventAge=0.4&piece=J&turns=1&row=12&u=0.2` / `eventAge=4` |
| a clear | `t=26&quality=High&board=1&locks=6&event=clear&lines=3&eventAge=0.7` |
| a chain | `t=26&quality=High&board=1&locks=8&combo=7` |
| the jump | `t=26&quality=High&board=1&event=quad&eventAge=0.75` (opening), `1.2` / `1.6` / `2.2` (inside), `3.4` (out) |
| the open sky alone | `t=20&quality=High&parts=sky,stars,motes` (Medium shows the rich sky, Low the lean one) |
| palettes | `t=10&quality=High&level=1…7` (t=10 is inside the rest) |
| the icon | `t=20&quality=High&icon=1` (square frame) |

Real game: `?skipIntro=1&unlockAll=1`, then pick Serenity Warp; capture flags
`serenityWarpTime`, `serenityWarpFixedDt`, `serenityWarpParts=sky,glass,stars,motes,streams,flares`,
`serenityWarpFalseColor`, `serenityWarpForceWebGL`.

## Third pass (2026-11-17): a living warp, a shape for every event

Asked: audit the whole theme and make it one of the most visually stunning themes in the game,
varied over time, a distinct effect per event with the biggest moments the most spectacular,
smooth and readable. Built on branch `feature/serenity-warp-living`.

### What the audit found

- **The vortex was a soft twirl.** Smooth billows wound round the gate; nothing in it moved fast
  enough to read as space pouring in, and the "streaks of light" existed only in a chain or a jump.
- **The open sky was wallpaper.** Right of the board (a quarter of a landscape frame) the nebula
  peaked near 0.08 of white: a dim mauve haze under evenly sprinkled stars, the same on every
  palette, and it never moved.
- **Nothing changed but the colours.** The palettes walked by level and clock; the vortex's form,
  the ring and the sky were the same for the whole session.
- **Every event was a ring.** A clear, a chain step, a back-to-back, a twist, a level and the
  crowned arrival all sent rings out of the rim, told apart only by colour, count and speed.
- **Nothing happened at the end of a run** (the session simply reset).
- **The pieces wore a dotted white outline** whenever they moved through the rush or a kick
  (HDR fireflies: gotcha #904), and a white-hot newborn piece was a flat pale sticker.

### What changed

All in `src/themes/serenity-warp/`; the new three-free module is `serenity-warp-living.js`.

| Where | Now |
|---|---|
| Streamers (`skyLight`) | Lanes of light at a constant turn of the vortex (the arms' own log spiral), broken into dashes with bright heads that run down the arms into the throat faster than the gas; a pixel wide at any distance, faded where the lanes crowd at the rim, ended at β ≈ 0.5 rad. One layer on every tier, two from High (gotcha #1415). A chain makes them brighter and faster. |
| The open sky | Its nebula is lit by the gate: one more read of the gas a step toward it gives the clouds' gate-facing edges a rim in the gas's own glow (Medium up, read only on the cloud edges). Brighter hearts. The whole open sky turns slowly round the gate (`SKY_TURN`, a turn in 43 min) and its clouds drift through the gas volume (`CLOUD_DRIFT`), so they form and melt. Far galaxies: now and then a small tilted spiral, warm core and blue disc (Medium up, a rare coherent branch). |
| The ring | Hot spots circle the photon ring with the gas (two, and five fainter the other way), on its glow and halo. |
| Moods (`WARP_MOODS`) | Calm, torrent, bloom, tide, one every 117 s with a rest on each, a level a mood on: two arms or three, wound tighter or looser, the gas pouring faster or slower, more or fewer streamers, a brighter or dimmer nebula, a wider or narrower throat, how far the vortex reaches, how bright the hot spots. |
| Wandering stars | Every ~43 s a star (ember to blue-white) is caught far out, rides an arm in with its tail behind it, spirals in at a steady pace, is torn into an arc round the throat and goes in; the ring flares in its colour. Its outer path is laid on the open side of the gate, never behind the board (gotcha #1414). |
| The comet | Every ~151 s a comet crosses the open sky beyond the board (right of the HUD; below the card on an upright phone), its ion tail straight and its dust tail curved, both blown away from the gate as a sun's wind blows a comet's. |
| A twist | An OPEN pinwheel of five thin arms unwinds out of the rim and turns the way the vortex was twisted (a smaller one for a twist that cleared nothing). It replaces the twist's faint ring. |
| A chain's step | A surge of light runs down the arms INTO the throat (the clears' rings go out; the chain pulls in). It replaces the step's ring. |
| Back-to-back | The Einstein cross: bright images of one light stand round the photon ring in the nebula's third colour (four, two more for each difficult clear in a row, up to eight) and drift a little out as they fade. It replaces the back-to-back's extra rings. |
| A level | A lotus of the new palette's light opens out of the rim: six lobes with a burning lip, brightest at the tips. The palette and the mood both move on. It replaces the level's slow ring. |
| A crown (perfect clear) | On the crowned arrival a corona of fine rays bursts out of the gate across the whole sky, gold with one ray in four in the nebula's third colour, over a soft glow that fades to even light at the hub (scaled by Reduce flashing). It replaces the arrival's two extra rings. |
| The run's end | The gate closes to a pinhole, its light sinks to an ember and the gas stalls; it holds a few seconds and opens by itself, at once when the next run starts. The theme ends a run in the order flush → reset → close (`endRun`), so the reset never wipes the closing (gotcha #1716); the world keeps it shut through a later session reset (the menu) and `modeStarted` opens it. The warp now unwinds at its own pace through a session reset instead of snapping. |
| The pieces (`serenity-warp-glass.js`) | Their surface is capped, hue kept, at 2.6 at rest and 6 while white hot or falling in; the rush's taps are capped at 6 (`serenity-warp-post.js`). A white-hot piece is white on the faces toward us and its own colour at the edges. |

Event language now, in short: a lock lifts off in glass with a flare and a ripple; a clear sends
rings out of the rim, streams from the rows and pieces into the throat; a chain winds the warp and
pulls surges down the arms; a twist unwinds a pinwheel; a back-to-back lights the Einstein cross;
four lines take us through the throat; a crown bursts a corona across the sky; a level opens a
lotus; the run's end closes the gate.

### Tiers

Every tier gets streamers (one layer; two from High), the moods, the visitors, the comet and every
event shape. Medium and up add the gate-lit nebula and the far galaxies. Nothing new is drawn into
the environment pass (what the glass mirrors). The shapes, visitors and comet are loops and
branches on counts that are zero at rest.

**Cost** (RTX 5080 Laptop, playground at 1920 × 1080, `maxFps=30` with GPU timestamps, the branch
and the untouched base served side by side and interleaved, three rounds, another session busy on
the machine): High 0.40–0.44 → 0.45–0.52 ms a frame (+11 to +27 %), Medium about +3 to +20 %,
Low 0.19 → 0.20–0.22 ms (+8 to +14 %; it was +22 % before the streamers were branched to their
region and given cheaper hashes). The integrated GPU was not measured.

### Traps met

- In the lensed sky the photon ring is β = 0: a star sent "to the throat's radius" stopped at
  1.6 radii, and anything white laid on the ring vanished in it (gotcha #1414).
- Lanes hashed by their raw index drew a seam at `atan`'s cut; lanes kept going far out drew rain
  across the open sky (gotcha #1415).
- The gate-lit nebula lit everywhere read as grey smoke; lit in the palette's other hue (ember's
  green under its orange) it read as mud. Only the clouds' edges, in the gas's own glow.
- The first lotus (outlined petals) read as line art, the first fill as a violet splat.
- The theme's own tests encoded "every event is a ring" (wave counts per chain step,
  back-to-back and twist); they now count the shapes (`formCursor`, `surgeCursor`).
- Capped GPU timings swing ±20 % between identical runs here; only an interleaved A/B against
  the untouched base on a second private server gave usable numbers.

### Verification

- Shader gate (`serenity-warp-shaders.test.js`): every material on WGSL and GLSL at High and
  Minimal, no warning, under budget; the read count now includes the lit nebula's read.
- `tests/unit/serenity-warp-living.test.js` (new, 14 tests): the moods rest whole and melt without
  a jump, a level is a mood on; visitors are a pure function of the clock, fall monotonically,
  stand on the open side and flare the ring; comets stay in the open sky and point away from the
  gate; nothing is alive at rest; each event throws its own shape; a live shape is never
  re-randomised by a burst; the gate closes, holds, opens by itself, survives a session reset and
  opens on a new run; tier flags. All 173 Serenity Warp tests pass.
- Playground captures (private Vite, headless Chrome, `maxFps=30`), clean consoles: rest, the
  board, every mood, a visitor riding, whipping round and torn, the comet, every event (lock,
  drop, clear, chain step, twist, spin, back-to-back, quad, crown, level, the run's end, the
  reopening), WebGPU and the WebGL2 backend, Minimal, Low, Medium, an upright phone, 21:9, and
  lagoon / ember palettes.
- The real game in headless Chrome (`?skipIntro=1&unlockAll=1`, Serenity Warp at High on WebGPU):
  real hard drops topped the board out, the gate closed (0.112 → 0.018 rad), stayed shut behind
  the result screen and reopened when the next run started; the world's counts reset between
  runs; console clean but Chrome's own powerPreference note.

### Reproduce

Playground (`playground.html?effect=serenity-warp&maxFps=30&…`; `hud=0` hides the panel):

| Frame | Query |
|---|---|
| a mood | `t=20&quality=High&mood=1` (0 calm, 1 torrent, 2 bloom, 3 tide) |
| a wandering star riding / torn | `t=24&quality=High` / `t=28` / `t=30.6` |
| the comet | `t=77&quality=High&board=1` |
| a twist / a spin | `t=26&quality=High&board=1&locks=6&event=twist&eventAge=0.6` / `event=spin&eventAge=0.5` |
| a chain's step | `t=26&quality=High&board=1&combo=3&event=step&eventAge=0.5` |
| back-to-back | `t=26&quality=High&board=1&event=b2b&lines=3&b2bRun=1&eventAge=0.45` |
| the crown | `t=26&quality=High&board=1&event=crown&eventAge=4.2` |
| a level | `t=26&quality=High&board=1&event=levelUp&eventAge=0.9` |
| the run's end / reopening | `t=26&quality=High&board=1&event=over&eventAge=3` / `event=open&eventAge=2.6&openAt=2` |

**Open calls** (my doubts, not decisions made): the crown's corona is loud and covers the whole
sky (it is the rarest event); the lotus is bold on the violet palettes; the ember palette's open
sky stays brownish; the visitor's torn arc is subtle against the ring; Blender was not needed
(nothing here is modelled); the theme icon and `docs/theme-screenshots/serenity-warp.png` still
show the second pass; the integrated GPU's cost was not measured.
