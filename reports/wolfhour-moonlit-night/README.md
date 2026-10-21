# Wolfhour: a moonlit night with wolves

Wolfhour (Odyssey orb 23) leaves the black-and-silver grade it shared with Cosmic Noir's
black-and-white film. It is now a cold blue night with one warm light: snowfields cut by granite
ribs, valley mist and distance haze between the ranges, spruce along the lower ridges, moonlit
clouds, and wolves: a pack on the right-hand spur that howls on a four-line clear, a lone wolf
across the valley that answers, and a scout that walks in along the foreground ridge now and
then. No red moon, eclipse or mirror (Blood Moon's ground).

Before: [moon-idle-t8.png](../wolfhour-moon-refinement/moon-idle-t8.png).
After: [high.png](high.png) (High, 16:9, the scout at its lookout), [board.png](board.png) (with a
mock board), [low.png](low.png) (Low), [portrait-low.png](portrait-low.png),
[clouds.png](clouds.png) (a cloud veiling the moon), [howl.png](howl.png) and its close-ups
[howl-closeup.png](howl-closeup.png) and [answer-closeup.png](answer-closeup.png) (2.6 s into a
howl, 2x), [scout-closeup.png](scout-closeup.png), [valley-closeup.png](valley-closeup.png) (the hut,
the spruce, the answering wolf), [combo.png](combo.png) and [crash.png](crash.png) (the existing
reactions in the new palette).

## What changed

- **Grade** (`wolfhour-grade.js`, `wolfhour-post.js`): colour is kept (saturation 1.0, was 0.25;
  desaturation 0.08, was 0.55). A split-tone by scaling only leans the shadows blue and keeps
  moonlit snow a cool white; the hut's window stays warm. The scene pass takes 4x MSAA from High
  up (`shared/scene-antialias.js`).
- **Terrain** (`wolfhour-landscape-bake.js`, `wolfhour-landscape.js`): the bake gives each vertex
  how much moonlight reaches it, a snow potential and its valley air. Snow is the ground high on
  the walls, cut by thin rock ribs down the fall line; lower down rock is the ground with snow in
  couloirs. The shader cuts a crisp snow line through a stretched noise read, lights each pixel
  from the moon, adds wind-packed drift texture, and fades into one shared blue air
  (`wolfhourAir`): distance haze for the far range and mist pooling below every crest, so each
  nearer ridge stands dark against the bright foot of the one behind. From Medium up, one cell in
  twenty of moonlit snow holds a glint that twinkles (never under a pixel, so it does not shimmer).
- **Sky** (`wolfhour-sky.js`): an indigo zenith over a slate-blue horizon, a faint aureole round
  the moon, bluer stars, a cooler moon and halo, and (Low up) a thin broken cloud layer drifting
  east between the moon and the mountains, lit by how close it passes to the moon, silver-edged
  near it, now and then veiling it.
- **Valley mist** (`wolfhour-mist.js`): up to three moonlit banks between the ranges (Minimal 1,
  Low 2, Medium+ 3), drifting, brighter under the moon, lifting with gameplay and the howl.
- **Spindrift** (`wolfhour-spindrift.js`): wind tearing snow off the two summits, gusting.
- **Spruce** (`wolfhour-forest.js`): snow-laden conifers along the spurs (Medium up) and the
  foreground ridge (Low up), one draw per belt. Trees stand on and just below the crest, so they
  silhouette against the mist; lower ones fade into the valley air. Tall spruce frame the
  foreground's edges; the scout steps out from behind the right-hand ones. Belts keep clear of
  the wolves, the hut's window and the scout's path, and keep their widths through aspect changes.
- **Wolves** (`wolfhour-wolf-rig.js`, `wolfhour-wolves.js`): each wolf is a rig of 25 tapered
  capsules (legs placed by two-bone IK from the paw; a four-beat walk) that one small quad's shader
  unions smoothly into a single silhouette, frays into fur with the noise tile, and lights with a
  hairline of moonlight on the edges that face the moon (the union's own gradient is the normal),
  plus a faint eye glint. Idle they breathe, flick an ear, stir their tails and now and then lower
  their heads to a scent; the young wolf paces the ridge. A 1-3 line clear makes the lead lift its
  head; a four-line clear makes the pack howl one after another (jaws open, ears back, breath
  smoking), the wolf across the valley answers, and the scout howls too if it stands at its
  lookout. The scout visits every 96 s: it walks in from off screen, looks over the valley, and
  walks out. Every pose is a pure function of time. Reduce motion stills the idle movement and
  stops all walking (no scout, no pacing); the howl still answers a four-line clear. On a
  portrait screen two of the pack stand on the ridge.
- **Footing** (`wolfhour-wolf-rig.js` `pose.ground`): every paw is set on the ridge line under
  it (toes included), the body settles on the ground under its hips and shoulders and tilts with
  the slope (about its own height, so the legs stay upright), and a sitting wolf's haunch, folded
  hind leg and tail lie along the ground. A walker's gait is read from the distance it has really
  travelled with the stride equal to that distance per cycle, so a planted paw does not slide. The
  young wolf paces 18 units along the dome's top away from the lead and back (the ridge falls at
  35-40 degrees beyond its walk). Close-ups through the playground's inspection lens
  (`zoom=4&zoomX=..&zoomY=..`, which shifts the view window and keeps the game's parallax):
  [pack-closeup.png](pack-closeup.png), [howl-closeup.png](howl-closeup.png),
  [scout-walking.png](scout-walking.png), [scout-closeup.png](scout-closeup.png),
  [answer-closeup.png](answer-closeup.png). Tests pin it: paws on flat, sloped and rough ground
  at rest and through a stride, leg bones keeping their lengths, a planted paw not moving while
  the scout walks, and the young wolf's walk staying under 30 degrees.
- **Animation** (`wolfhour-wolf-behaviour.js`, rig additions): every wolf lives through slots
  of its own length (10-15 s), each drawing an action from its repertoire with a deterministic
  hash, so behaviour is still a pure function of time. The rig gained a lying build (forelegs
  out, head able to rest on them), a head turned toward the viewer (two eyes catch the moon), a
  trot, a carried, wagging tail, crouch, leap, tuck and stretch, and `blendRigs` carries a wolf
  between standing, sitting and lying.
  - Lead: looks round at you, yawns, shakes the snow off (the coat fluffs and shivers, snow
    flies), sits a while, stretches into a bow.
  - Sitter and the far wolf: lie down and rest their heads, look up, yawn; the sitter stands up
    now and then and shakes.
  - Young wolf: paces, plays (a bow, a wagging tail, little hops) and hunts: it stalks a mouse
    under the snow, leaps in an arc, dives nose-first and throws up a plume of snow, shakes it
    off and walks back.
  - Scout: walks in, looks over the valley, turns to look at you, trots away.
  - Gameplay: a line clear turns the pack's heads to you; a combo of 2+ puts the young wolf in a
    play bow with a wagging tail; a four-line clear makes all howl (lying wolves sit up for it; a
    young wolf in mid-pounce finishes its hunt instead).
  - Reduce motion: no walking, hunting, play, shaking or stretching; looks, yawns, sitting,
    lying and the howl remain.
  - [wolf-moments.png](wolf-moments.png) (the pounce in four frames, the shake, the play bow, a
    look at you, lying, a yawn, the howl) and [wolf-moments-2.png](wolf-moments-2.png) (the scout
    looking at you and trotting away, the far wolf lying down).
- **Second pass** ([../wolfhour-wolves-alive/](../wolfhour-wolves-alive/README.md)): the rig in three
  dimensions (wolves turn round instead of flipping), continuous posture, more actions, the
  scout's lookout, blinking and breath, and the pops fixed.
- **The warm accent** (`wolfhour-hut.js`): a herder's hut low on the left-hand spur, a snowy roof
  line, a firelit window, firelight spreading into the mist in front of it, a thread of smoke. Its
  flicker is slow and a few percent deep (a test keeps it under 14 %).
- **Placement** (`wolfhour-props.js`; `landscape.addProp`, `crestPoint`, `setPropScale`): props
  stand on a range's crest, move with its parallax, and keep their proportions when the terrain
  stretches with the aspect.
- **Theme** (`wolfhour-theme.js`): builds, updates, resizes and disposes the new parts; routes line
  clears to the wolves (4 lines: howl, fewer: glance).
- **Playground** (`wolfhour.effect.js`): `event=howl|clear` with `eventAge`, `msaa=<n>`, and
  `icon=1` (the icon lens). The scout is on screen around `t=26..42`.
- **Icon** (candidate, awaiting Olov's word): three wolves howling against the moon on the left
  massif's summit ridge ([icon-lens-square.png](icon-lens-square.png): the playground's
  `?effect=wolfhour&t=20&icon=1&iconHalf=108&event=howl&eventAge=1.6` at 1024x1024, cut to a
  512 px circle by `harness/make-icon.mjs`); [icon-80px.png](icon-80px.png) is the picker size.
  It replaces both copies (`src/themes/wolfhour/`, `public/assets/themes/`); the old one is in git.

## Verification

- Wolfhour unit tests: 136 pass (`wolfhour-valley.test.js`, `wolfhour-wolves.test.js`, and a
  theme test that a four-line clear howls and a smaller one glances).
- Full suite: all Wolfhour files pass. Two unrelated tests fail on this machine's Swedish number
  formatting (`250 000` for `250,000`); nine timing-budget tests that failed while `vite build` ran
  in parallel pass when run alone. `tsc --noEmit` clean; every touched file lints clean or as
  before; the lint ratchet passes (533, baseline 539); `depcruise` clean; `vite build` passes.
- Cost, 1080p High on the RTX (playground profiler, window shown off screen): frame p50 5.8 ms,
  p99 9.1 ms; CPU p50 2.3 ms; 46 draws, 131k triangles.
- Captures: single-effect playground, Electron 38 on the RTX (WebGPU), High and Low, 16:9 and
  portrait; zero GPU validation errors, device losses or console errors in every capture.

## Harness notes

`harness/` holds the capture used here (`cap.sh`, `wh-capture.mjs`, `wh-preload.cjs`). Electron
38's Chromium predates the string form of `GPUTextureViewDescriptor.swizzle` that three r186
sends, so the preload strips an identity swizzle (harness only, as in
`scripts/capture-breathing-ingame.mjs`); it also logs every uncaptured WebGPU error and device
loss. A changed shader takes about two seconds to compile on first load, so the script waits 3 s
after `__PLAYGROUND_READY__`. A hidden window renders at 1 fps: for timings set `CAP_SHOW=1`
(the window opens off screen). The wolf rig can be previewed without a GPU: rasterise
`poseWolf()` capsules on the CPU (the smooth union is a few lines).
