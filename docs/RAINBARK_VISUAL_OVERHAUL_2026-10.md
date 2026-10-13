# Rainbark — the painted giants come alive

The second pass on Rainbark (2026-10-13), on WebGPURenderer + TSL with the WebGL2 backend as
fallback. The first pass (branch `ccr-b2364ce7-64kjge`, merged as `589ee199`) built the grove:
the painted bark, the composition solver, the air, the mist floor, the canopy and the Climb, and
left every gameplay beat undrawn ([`RAINBARK_HANDOVER_2026-10.md`](RAINBARK_HANDOVER_2026-10.md)).
This pass draws every beat, adds the grove's ambient life and the light that turns with the
clock, and reworks the environment against two rounds of an independent art critic. The spec is
[`theme-concepts/rainbark.md`](theme-concepts/rainbark.md); where this file and the code depart
from it, they win.

## The picture

The middle storey of a forest of colossal rainbow eucalyptus, in blue air over a floor of
luminous mist. On the left the **Elder**, a wall of painted bark: tall torn ribbons of lime,
emerald, teal, cobalt, violet, ruby and ember in a cool slate matrix, each ribbon streaked along
the grain and drifting in colour along its length, its torn edges lifted into light lips over a
soft contact shadow. Sunlight comes through the canopy as **dappled flecks**: each fleck a few
soft, jittered ellipses that merge into pools, stretched along the sun's ray, as bright on the
whole as a solid fleck, its rim on the near bark a soft ramp over many pixels; inside, a finer
dapple of the leaves' pinholes laid on the bark itself, two layers (a few large pinholes and many
small) whose number swells and thins with a slow noise so they gather into pools (after the
fleck's shoulder, so a fleck's heart is never one flat plateau; on the flecks' own light only, so
the bare slate's glow stays even): never stuck-on discs, pasted pills, slats or a printed grid of
dots. On the right two slim **Sisters** set deep, a two-strand **liana** slung between them.
Behind the card the grove recedes in blue haze toward **gold air** on the sun's side, never a
colonnade: its trunks in clumps of two and three with open gaps between (the gold air opens
behind the card's right half), of every girth (the near ranks from slim poles to giants), the
near ranks leaning a degree or so to one side or the other (no two crossing in the frame), each
trunk its own tone and its own depth in the haze, some standing clear, some faint; above, the canopy in two
storeys of leaf clusters glowing green with the sun through them, the air under them lit
green-gold, their edges ragged with leaves at any distance and lime toward the sun, the lower
storey hanging below the canopy's edge into the haze, every trunk ending in its leaves; below,
the mist floor with its pools of sun.

What moves by itself: the bark ripens (patch lifetimes 4–10 min, a visible wrap every few
seconds), strips of bark shed and fall as **quills** that drift out into the air (1–3 a second in
menus, fewer in play), sunflecks crawl with the canopy's wind, the mist tide breathes (150 s),
shafts of light follow it, the liana sways, and now and then a small flock of **rainbow lorikeets**
crosses the air (Medium and up).

**The light turns with the clock** (`LIGHT_WHEEL`), whatever the level: a wheel of four moods over
each storey's own colours — morning (as authored), noon (whiter, cooler shade), gold (an amber
sun, rose-gold air, its sun's hue turned without dimming the key light), pearl (a soft lilac
light) — 100 s a mood, held only 15 % at either end, so the light is on its way most of the time. The level adds the Climb on top: a new storey, a new
zone.

## Event language

Every beat is a material event on bark already in the picture, or a change in the grove's light
and air. Nothing leaves the card as light; nothing crosses it.

| Event | What happens |
|---|---|
| lock — **the Peel** | On the lane trunk by the piece's columns (0–4 the Elder's card-facing side, 5–9 Sister One's sunlit side), at the piece's rows: a gold hairline splits, a tall torn ribbon unzips down the bark, its freed end lifting off as an open lip, and under it the bark is bared fresh: First Skin lime that ripens into the piece's own colour in under two seconds, wet, with a darker margin at its torn edge. Each ribbon has its own outline (its two sides meander on their own, the whole ribbon sways; the cambium's cream shows only in breaks along the tear). The strip lets go, pops out into the air and, as it dries, rolls across its width into an open curl (most of a turn, never closing on itself), the lane's rust-maroon bark outside, the cream underside within, tumbling away. Bared bright, every band settles to 60 % of its chroma over three seconds: it belongs to the tree, never a paint chip beside the card. The lane itself stands in old bark (rust, maroon, slate), so the last half-dozen pieces stand out on it as a staggered column of ribbons (never a ruled stack; on Sister One's slim lane narrower bands, staggered across the whole lane, two at most) and erode back into the bark within about 40 s. |
| hard drop — **the Knock** | The strip tears off whole; a gleam in the bark's own colour runs up the struck side of the trunk as a chevron, the bark it passes half again as bright (crisp at its front, a soft tail behind, lagging toward its sides: never a ring round the bole); flakes shake loose from above the impact. No camera motion. |
| clear ×1–3 — **the Shed** | Lowest row first, 120 ms apart: a gold split runs round both near trunks at each cleared row, the girdle's bark peels down in lips of old bark (violet to ember, from the middle of the visible arc, staggered and of mixed sizes, two at most on Sister One) that curl over as they lift, pop clear and fall away, the ring blazes First Skin, then ripens cell by cell, left to right, into the cleared row's own ten colours. Every ring is torn, never cut: its own height (±30 %), each edge meandering on its own, its cells parting along ragged, slanted lines (never a barcode). A double also girdles the R1 trunks; a triple shakes a curtain of quills off the grove. Every shed thing fades where it nears the card, judged along its whole length. |
| four lines — **the Great Moult** | A creak (every old lip lifts), then a ragged front sweeps down every trunk in view: above it every coloured patch is bared in wet First Skin (three limes; the slate matrix stays), the iris closing a quarter stop so it never clips; quills pour off the grove along the front; from the foot of the frame the colour climbs back in crisp tongues, rank by rank. The near grove stays younger for minutes. |
| combo — **Opening the canopy** + **Quickening** | Each link opens a gap in the crowns over a fixed station on the lanes: a pool of sun lands there (the gap's pinhole image: a solid disc of light, faintly dappled at its heart, never a dim blob) under a slanted golden beam of lit haze that reads whatever its angle to the sun (and never crosses the card), a puff of leaves falls; count the pools. The bark's clocks run faster with the chain: the grove visibly ripens, colour flowing up the trunks; from ×4 the flecks crawl in a stronger wind. |
| combo break — **the Set** | The gaps close in reverse, the quickened bark sets (its sheen dips), and a curtain of quills (8 per link of the chain) falls off both near trunks. |
| T-spin — **the Unwinding** | A helical strip unwinds round the trunk on the T's side like an apple peel, one turn per line (count the diagonal stripes), ripening from First Skin to the T's emerald; the freed strip lifts off as a lock's does and curls as it falls. The scars last the level. |
| back-to-back — **the Sunshower** | Rain glints where the light catches it (backlit toward the sun, bright in the flecks, faint in shade; short streaks, never longer than 70 px on screen, the nearest dimmed), heavier per back-to-back; the grove goes wet — darker, glossier, deeper in colour — water running down the near bark in broken, beaded rivulets that mirror the bright air and glint in the flecks — and dries slowly when the run breaks. |
| perfect clear — **the Floor** | The mist drains far below the walkway and the haze thins: for the first time the forest floor shows, warm gravel, a braided stream in soft wet banks mirroring the gold air and glinting in the flecks, the session's shed bark as a carpet, the trunks' buttresses standing on it; the frame lifts a fifth of a stop. Mist and haze return over the next fifteen seconds. (Seen from this far up, the flecks are never read finer than a pixel: no speckle.) |
| level — **the Climb** | 1.2 s after the clear, the walkway rises a storey (12 m) over 3.5 s into the next zone's light. |
| game over — **Mistfall** | The mist rises past the camera: a quiet blue-lilac fog; the next run brings the morning back. |
| meditation | A click peels a band at the lane point nearest it, each click the next age of the bark; click chains open gaps. |

## How it is built

`src/themes/rainbark/` (new this pass: `rainbark-events.js`, `rainbark-curls.js`,
`rainbark-life.js`):

| Module | Role |
|---|---|
| `rainbark-events.js` | The event table's writer (renderer-free): peels, knocks, girdles, helices, the moult and the gaps, each block compacted to its front every frame with its count, slots recycled in place (nothing allocated after construction). |
| `rainbark-world.js` | Turns the director's sink calls into the beats: where a lock peels (`peelTarget`: the lane, the column across it, the rows cast onto the trunk through the rest lens), the Shed's rings (`shed`, `visibleArc`), the Moult, the gap stations (`solveStations`, every frame from the live layout), Quickening (integrated group-clock rates), the Set's curtain, the Unwinding, the Sunshower's rain and wetness, the Floor's drain, meditation's clicks; the light wheel over the palette; the curls' emitters. |
| `rainbark-tsl.js` | `rbBarkEvents` (the near trunks' overlay: one named Loop per block over its live rows), `rbLaneOld`, `rbMoult` (every trunk, near and far), `rbBandAlbedo`, `rbSpots` (the flecks' clusters, a laid-out pure helper), the canopy's lower storey (`CANOPY_UNDER`), the bark's streaks and lips. |
| `rainbark-curls.js` | One instanced draw of strips (14 × 10 segments) for every shed thing: ambient quills (respawned per slot and cycle, closed form in the clock), a lock's strip (an open lip riding the unzip front, then drying into a spiral quill), the Shed's plates, the Moult's and the Set's quills, flakes, leaves, the T-spin's corkscrew. Rolled, tumbled, eased and fluttered in the vertex stage; rolled round a centre behind the old bark, so the old bark is outside and the pale underside inside, as a strip curls on the tree; backlit where the sun is behind; kept clear of the card vertex by vertex. Unlike the other fx it writes depth (an alpha-tested strip hides its own inner turns). |
| `rainbark-fx.js` | The shafts (ambient, god-rays in the Fog Line; one per open gap) and the Sunshower's drops. |
| `rainbark-life.js` | The liana (two twisted strands) and the lorikeets. |
| `rainbark-sky.js` | The backdrop, now with the Floor's branch. |

## Verification

**The critic.** An independent art critic (an agent that never saw the code) scored ten rounds of
the same 24 framings (rest, the board, every event at one or two moments, four storeys, a phone,
Low and Minimal on the WebGL2 backend, the bark close-up, the gold mood, Mistfall) plus a dried
strip and a Sister One lock, against the house bar (Solar Eclipse, Painted Ages, Himalayan Peak,
Starlight, Lunara):

| Round | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| Environment | 5 | 5.5 | 6 | 6 | 6 | 6 | 6.5 | 7 | 7.5 | 7.5 |
| Effects | 4 | 5 | 5.5 | 6 | 6.5 | 6.5 | 6.5 | 6.5 | 6.5 | 7 |

Its round-10 verdict: nothing blocks a masterpiece verdict; at the house bar, at its lower end; no
flash concern; nothing touches the card. What it would do next, ranked: a flake still shows
face-on now and then (a violet disc by Sister One; the curtain's quills have since taken the
bands' 60 % chroma, which tamed their magenta); the L12 right-hand limbs still read as straight poles; the
trunks are untapered cylinders (and the gold window behind the HUD could be wider); the Knock is
a soft dome rather than a band riding the trunk's curve; the Shed's lips are all horizontal; the
dapple spots share one aspect; the canopy's lower layer could be greener; the floor's channels,
wet bark's visibility, the flat grey L8 and the slate tint. Its structural ceiling: plain
cylindrical trunks and a canopy built as a textured plane.

**Measured as we went** (1440 × 769 playground, RTX 3070, WebGPU): the Elder's mean luminance at
rest 93–96 (the flecks never dim the hero trunk; inside a fleck 185–235 in pools and gaps, its
rim a ramp over 8–20 px); the canopy strip at rest rgb(98–104, 113–121, 110–117) (green, never
grey-teal); the gold mood's Elder ~71 (its exposure left at 1.0: raised, it clipped 85 % of the
gold air); WGSL and GLSL built for every material at Minimal and Ultra on the CPU
(`rainbark-shaders.test.js`: no NaN, no MaterialX noise, no equal-edge smoothstep, within the
uniform and vertex-buffer limits). Every capture's console held only the dev server's HMR socket
and Electron's dev CSP notice: no WebGPU validation error.

**Gates** (on the branch, before any commit): typecheck clean; lint ratchet 612 errors (main's, under
the 807 baseline; 0 errors in `src/themes/rainbark/` and its tests); TS ratchet at baseline;
architecture fitness OK; theme lifecycle audit passed; palette gate 0 matches (one warning, already
on main); boundaries clean; the 12 Rainbark test files (308 tests) pass; the full unit suite passes
but for `tts-recorder-e2e` and `odyssey-level-briefing`, which fail on main as well; `npm run build`
with the boot closure OK; IP strings OK (including `dist`); pages artifact OK; release gates and
perf budgets pass.

**The real game** (`?skipIntro=1&themeValidation=1&unlockAll=1`, Rainbark pinned, scripted locks,
hard drops, clears, a chain, four lines, a level-up; 1584 × 813, RTX 3070): on WebGPU at High,
85–130 fps (display-capped at 130; lower while other sessions loaded the GPU), no dropped events,
every beat counted (locks, hard drops, clears, a chain, four lines, a level-up, game over and the
next run's morning), a live switch to Medium rebuilt in 4.8 s, and leaving the theme left 0
canvases; the console held only Chrome's power-preference notice and the theme's own "Scene
ready". On the WebGL2 backend at Low, the same run at 130 fps with every beat counted, the live
switch to Medium rebuilt in 15.7 s (its shaders compiled cold), leaving left 0 canvases, and the
console was clean. The phone validator (`npm run validate:mobile:webgl2 -- --theme rainbark`,
390 × 844 at DPR 3, software WebGL2) passed at Low and at Minimal with no failure.

**The WebGL2 backend's first build is slow (open).** On WebGL2, ANGLE compiles each program on
the main thread, and this pass's shaders are bigger: the near bark carries the board's marks
(`rbBarkEvents`, loops over the event table), and that overlay alone more than doubles its compile.
Measured cold (shader cache defeated), 1440 × 769, RTX 3070, total main-thread blocking until
ready: at Low, main 13.0 s against 25.2 s here; at Medium, main 12.6 s against 23.7 s here. Warm
(Chrome's program cache, every later visit) it is a few seconds. WebGPU is unaffected (ready in
about 2.5 s). Two fixes are in: the trunk's dissolving top no longer inlines the canopy's lower
storey and its second pass of air (the near bark's shader 155 → 134 KB at Medium), and the fleck
spots no longer call another laid-out helper (which made a material's second build emit its
functions in another order, a whole second compile of the near bark: 9–13 s). What would cut the
rest: drawing the board's marks as their own small overlay draw over the near trunks, or warming
the WebGL2 programs off the first frame.

**Captures** in [`rainbark-captures/`](rainbark-captures/): `overhaul-environment.jpg` (rest, L1,
L8, L10, L12, the gold mood), `overhaul-events.jpg` (a lock at 0.3 s and 1.4 s, a hard drop, a
triple at 0.75 s and 1.8 s, four lines at 1.3 s and 4.2 s, a 6-chain, the Set, a T-spin,
back-to-back, the Floor), `overhaul-tiers.jpg` (the board, Low and Minimal on WebGL2, Mistfall).
The `*.webp` files there are the first pass's.

**The icon** (both `src/themes/rainbark/rainbark-theme-icon.png` and
`public/assets/themes/rainbark-theme-icon.png`): the bark close-up (`icon=1`, yaw 24°, pitch 8°,
fov 30°, an I piece's peel 0.45 s in), cropped by the critic's reframe (the lime strip and its
curl right of centre against the blue air, ~1.3× in), a 512 px full-bleed circle, judged at 80 px.

## Reproduce

Playground (`npm run dev:playground`, then `playground.html?effect=rainbark&…`):

| Frame | Query |
|---|---|
| rest | `t=55&level=4` |
| with the board | `t=55&level=4&board=1&locks=10` |
| a lock | `t=55&level=4&board=1&locks=8&event=lock&piece=L&u=0.15&row=12&eventAge=0.3` (and `1.4`) |
| a hard drop | `t=55&level=4&board=1&locks=6&event=drop&piece=O&u=0.3&row=17&dist=18&eventAge=0.25` |
| a triple | `t=55&level=4&board=1&locks=10&event=clear&lines=3&row=16&eventAge=0.75` (and `1.8`) |
| four lines | `t=55&level=4&board=1&event=quad&row=16&eventAge=1.3` (and `4.2`) |
| a chain / the Set | `t=55&level=4&board=1&combo=6` / `event=release&peak=7&eventAge=1.2` |
| a T-spin | `t=55&level=4&board=1&event=tspin&lines=2&u=0.2&row=13&eventAge=2.0` |
| back-to-back | `t=55&level=4&board=1&b2b=2` |
| perfect clear | `t=55&level=4&board=1&event=perfect&eventAge=5&sheds=700` |
| the light wheel | `t=10&level=4` (morning) … `t=110` (noon), `t=210` (gold), `t=310` (pearl) |
| the icon | `t=55&level=4&icon=1&iconFov=30&iconYaw=24&iconPitch=8&event=lock&piece=I&u=0.2&row=8&eventAge=0.45` (square) |

Real game: `?skipIntro=1&unlockAll=1`, then pick Rainbark; capture flags `rainbarkTime`,
`rainbarkFixedDt`, `rainbarkParts=sky,trunks,mist,curls,fx,life`, `rainbarkFalseColor`,
`rainbarkForceWebGL`.
