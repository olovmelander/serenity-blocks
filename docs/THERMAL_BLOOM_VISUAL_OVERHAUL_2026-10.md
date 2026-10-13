# Thermal Bloom — a hot spring from the overlook

A new theme (2026-10-12), the 63rd, built from the Iris Springs concept
(`docs/theme-concepts/iris-springs.md`, renamed Thermal Bloom at Stage 0) on WebGPURenderer + TSL with
the WebGL2 backend as fallback. It replaces no theme: it is the bonus reward for completing every orb
of Odyssey chapter 1. Built with `docs/theme-concepts/PLAYBOOK.md`, stage by stage, each environment
step judged by an independent critic from screenshots on both backends.

## The picture

We stand on a pale sinter lip above a vast hydrothermal basin and look down into it. Left of the
card lies **the Iris**, a hot spring about 105 m across: an abyssal cobalt eye seen through clear
water down its white ledges, a turquoise shelf, a wet cream rim, then the living bands — lemon,
blazing orange, rust — breaking at their edge into braided runoff fingers that fan toward the
camera. A translucent dome of steam rises off it, turquoise over the water and apricot over the
mats, pearl on its sunlit flank, leaning with the wind; it shades the bands beside it.

Right of the card, **the Chalice**: a squat, lumpy sinter cone on a broad mound, breathing a steam
thread, with spouters burbling on its skirt; from its flank **the Stair** of scalloped travertine
terraces descends into the bottom-right corner, its pools milky turquoise lit from within, its
risers streaked apricot and hung with dripstone. Beyond: ghost pines with white sinter socks, jewel
pools (lime, a fizzing champagne pool with an orange rim, milky opal), fumaroles chuffing, far steam
columns at mixed distances, the Sleeper's dormant mound on the far rim and the Consort's quiet vent
on the apron, a dark lodgepole rim, a pale plateau and a far range, cirrus. Droplets drift and
glitter in the near air (diamond dust in the cold seasons).

The sun stands low behind the camera's left shoulder (solved per layout so the one rainbow falls
across the Chalice's column), so the mineral colours are as saturated as they get and nothing
glares. Two dead lodgepole snags and a third apart stand in the near corner on the Iris's side;
their long shadows rake across the floor toward the card, the clearest sign of the low morning
sun. A thin morning mist lies over the warm ground round the Iris (never over its water).

### The remake (2026-10-13)

The theme was remade on three r186.1 techniques after it merged, for "amazing lock and combo
effects":

- **Marched steam.** Every column of steam is a ray-marched volume in the post pass
  (`thermal-bloom-vapour.js`): up to 32 bodies a frame (plumes, puffs, the Iris's dome, devils,
  spray), each with billowing 3D noise, eroded edges, a self-shadow toward the sun and an
  underglow. They are drawn at reduced resolution and upsampled against the scene's depth.
  Event steam is white, and the event's colour shows only as underglow at its foot.
- **Drops** (`thermal-bloom-bursts.js`) are closed-form ballistic streaks: splashes, jets and
  fountains.
- **The season wheel**: the year drifts slowly with the clock, and each level adds a step.

## Event language

| Event | What happens |
|---|---|
| lock | A little hot spring opens beside the card at the piece's rows, in the piece's colour: a dark coloured deep glowing while hot, three birth ripples, a thin pale rim, a ring of mats, a halo of its light on the ground, two or three runoff fingers wandering away from the card. A white plume rises off a narrow stem, lit in the piece's colour only at its foot, and drops are thrown up as glinting streaks. On the Stair the brimming lip overflows as a coloured sheet down the face below. At most five lock springs live at once; they bleach back into the mat over the slot pressure's life. A hard drop adds a jet of water and a jet of steam. |
| clear | The Seal: for each cleared row a new white sinter lip draws itself along its rim on both sides, flashes and settles within about four seconds; the pool behind it fills and glows turquoise, a curtain of steam lifts off the rim and drops splash; then the row's colours fix into the stone record as soft mineral stains (on its Stair tier and its ring of the Iris's microterraces), kept for the session. Cascades reach a tier further a wave. |
| combo | The ladder, a rung a link up the card's sides: each rung a glowing spring with a white fountain and a short white plume, opening with a flash; the springs zig-zag out from the card so no plume skewers the rung above; their colours climb turquoise → green → gold → orange → red → white-hot from nine links, each rung a little bigger and brighter than the last. The Chalice counts the chain in splashes, the Iris heats (the eye widens, the rim warms to lemon), the fingers run wet a notch a link; from six links a sustained column. The break: each column lifts off and a big lit puff rolls away from the card, the springs cool into the mat over 2.5 s, and a white steam phase rises over the Chalice. |
| four lines | The Chalice's surge, then a white column of water (the resting thread steps aside), a spray veil densest at its crown with a soft bow in the dense spray only (the theme's one bow), a low skirt at the vent; spouters fire near to far; the apron floods outward from the Iris and drains; rain falls back; a steam phase swells over the Chalice. |
| T-spin | Steam devils (one a line): slender spinning columns with a clear core and bands climbing them, wandering off the Iris toward the card's side; where each dies its foot scours a sinter rosette into the mats. |
| back-to-back | The Consort wakes: its mound wets, a boiling dome swells in its pool, a steam column stands over it with splashes by level; with four lines it fires the double eruption. |
| perfect clear | The Sleeper wakes: a 150 m column of water on the far rim, its steam held back while the water stands, then rolling up through the sky band; a glowing renewal wave runs out from the Iris along the fingers with the mats flushing vivid behind it; the light swells (the bloom, never the exposure); live blooms finish; the stone record stays. |
| level | The year turns (six seasons: High Summer, Straw Gold, First Frost, Deep Cold, Thaw, Bloom): a warm gold succession front sweeps out from the Iris along the fingers, the new season vivid in its wake. The year also drifts with the clock alone. |
| gust | Every 20–40 s a front of wind crosses the basin downwind in six seconds: every column it reaches leans hard and tears thinner, the mist blows off, a cat's-paw of ripples crosses the Iris and the sheets. |
| game over | The springs sigh: blooms bleach, the Stair's pools drain, the Chalice falls to a faint thread; the next run refills it. |

## How it is built

`src/themes/thermal-bloom/`:

| Module | Role |
|---|---|
| `thermal-bloom-theme.js` | BaseTheme adapter: renderer (WebGPU, else WebGL2), post, director, layout reads on frame time, settings, GPU-loss recovery, capture flags. |
| `thermal-bloom-world.js` | The world shared with the playground: uniforms, parts, rig and composition, the event table writers (blooms, fills, columns, jets, devils, rosettes, plumes), the stone record texture, seasons, weather, sun solver. |
| `thermal-bloom-core.js` | Three-free constants and maths: palettes and seasons, the temperature ramp, presets and anchors, the sun solver, schedules and envelopes, plume, pine, jewel and fumarole plans, the event table layout. |
| `thermal-bloom-tsl.js` | Shared TSL: uniforms, the mineral filmic, aerial perspective, the steam veil, plume shade, glints, bounce, the bow, blooms and fills. |
| `thermal-bloom-bake.js` | CPU bakes: noise atlases, the ramp, the basin fan, the Stair generator and its layout texture. |
| `thermal-bloom-basin.js` | The basin ground: the Iris (temperature field, lobes, fingers, the eye's water and ledges), mats, microterraces, jewel pools, blooms, rosettes, the record's rings, plume shadows, the flood. |
| `thermal-bloom-terraces.js` | The Stair: baked heights, pools lit from within, rims, curtains, bubble trains, blooms, fills, record stripes, seasons, the drain. |
| `thermal-bloom-vapour.js` | The marched steam (post pass): the bodies the world writes (plumes, puffs, the dome, devils, spray) marched near to far at reduced resolution, each its own billows, erosion, sun self-shadow, underglow and the bow in dense spray; the morning mist layer; the joint-bilateral upsample. |
| `thermal-bloom-bursts.js` | Drops thrown by the events (lock boil-overs, jets, the ladder's fountains, the Seal's splashes) as camera-facing motion streaks on closed-form ballistic paths. |
| `thermal-bloom-snags.js` | The near dead snags (real meshes, placed from screen anchors); their shadows are drawn by the basin. |
| `thermal-bloom-steam.js` | Plume sheets (used where the post does not march the steam) and the ground mist (anticrepuscular lanes on Ultra). |
| `thermal-bloom-geyser.js` | The Chalice heightfield mound and cone, the Sleeper's and Consort's mounds, the eruption columns (water, haze shell, collar) and the spray. |
| `thermal-bloom-fumaroles.js`, `-devils.js` | Fumarole chuffs and the Sleeper's wisp; the T-spin's steam devils. |
| `thermal-bloom-flora.js`, `-motes.js` | Ghost pines; drifting droplets and diamond dust. |
| `thermal-bloom-sky.js` | The backdrop: cerulean, cirrus, the far range, the plateau, the lodgepole rim, the far apron. |
| `thermal-bloom-post.js` | One scene pass, bloom with a high knee (glints, the bow's core), heat shimmer, calm zones over the card and HUD, the mineral filmic with a toe, grade, vivid, vignette, grain, FXAA/MSAA. |
| `thermal-bloom-director.js`, `-composition.js`, `-quality.js`, `-tetrominos.js` | Gameplay staging, layout rects, tiers, the piece palette. |

No textures or models are loaded; everything is baked on the CPU at build time.

## Tiers

Every tier keeps the whole picture and every event. Tiers scale:
- the basin fan, the Stair bake and its tiers;
- plume count × sheets, and plume shadows;
- mist sheets, spray particles, column and devil meshes;
- bloom slots, record samples and rosette slots;
- pines and motes;
- the steam's detail tap, the shimmer, and the anticrepuscular lanes (Ultra and up);
- the drops a burst throws, and the marched steam's 3D noise size.

In the post, bloom runs on Medium and up, FXAA on Medium and High, and MSAA on Ultra and up. The
marched steam scales with the tier (`POST_LOOK.vapour` in `thermal-bloom-post.js`): from 8 steps
at a quarter resolution with no mist on Minimal, to 28 steps at 0.6 resolution with 12 mist steps
on Extreme.

## Verification

**The remake (2026-10-13)** was verified on this machine's RTX 3070.

- **Critic rounds.** Every change was judged from playground screenshots on WebGPU; WebGL2,
  Low and Minimal shots were taken for every event family. Independent critic rounds scored
  the 32-shot set from 4/10 to environment 5.5 and effects 5.5 against the favourites' 9. What
  the critics still name is in the handover.
- **Real game.** On both backends the real game ran a session of hard drops, clears, a chain,
  four lines, a level-up, a quality change and a switch-away: no dropped events, a clean console,
  and no canvas left behind. WebGPU ran at about 130 fps at rest and about 119 fps at four lines
  (High, 1584×813).
- **Phone.** The phone validator (software WebGL2, 390×844 at DPR 3) passes at Low and Minimal,
  and its pictures were looked at.
- **Tests.** The theme's ten test files pass, 232 tests, including the WGSL builds at Minimal and
  Ultra. The theme is lint-clean.
- **Full suite.** It passes apart from timing-budget tests that fail under this machine's load
  and one locale-formatting test. None of these touch the theme.

The record of the first build follows.

The build stopped before Stage C was finished; the state at the merge, stage by stage, and what
is left are in the handover, [THERMAL_BLOOM_HANDOVER_2026-10.md](THERMAL_BLOOM_HANDOVER_2026-10.md).
In short, so far (2026-10-12, in a cloud container on the CPU rasterisers):

- **Critics:** the sky and basin (A1) and the Stair (A2) passed independent critic rounds; steam,
  geyser and flora, seasons and composition (A3–A5) and the gameplay beats (B1–B5) were reworked
  after REVISE verdicts and have not been re-judged.
- **Shader graphs:** every material builds to WGSL on the CPU at Minimal and Ultra within the
  limits (`tests/unit/thermal-bloom-shaders.test.js`); every playground capture of the last round
  reported a clean console on WebGPU, and the WebGL2 backend's shots matched.
- **Unit tests:** nine `thermal-bloom-*` files; the gates and the full suite on the merged tree are
  recorded in the merge commit.
- **Phone emulation** (`scripts/validate-mobile-webgl2.mjs`, software WebGL2): pass at Low and at
  Minimal; its screenshots were looked at.
- **The real game** on both backends ran and switching away left no canvas, before Stage B's
  rework; to be repeated.

## Deviations from the concept

- **The name**: Iris Springs became Thermal Bloom (the user's choice at Stage 0).
- **Contrast target (§3.3)**: "the darkest 10% of pixels at L\* ≤ 25" is not reachable with this
  palette (the ground alone, steam hidden, measures p10 ≈ 40 after the toe). The working target is
  that steam lifts p10 by at most about 3 L\* over the same frame without steam.
- **Upright phone**: the camera rises to 220 m, so the top band above the card lies beyond the
  basin; the Chalice, the Stair and the Sleeper stand in the right margin and the Consort in the
  left, the eye just under the card.
- **The Stair** stands a little farther and higher than the concept's 10–15 m near rim, so it reads
  whole at 16:9.

## Reproduce

Playground (`npm run dev:playground`, then `playground.html?effect=thermal-bloom&...`):

| Frame | Query |
|---|---|
| rest | `t=40` |
| with the board | `t=40&board=1` |
| the idle eruption | `t=176` (menus only; first at 170 s) |
| a lock | `t=40&board=1&event=lock&piece=L&u=0.15&row=12&eventAge=1.5` |
| a clear | `t=40&board=1&locks=10&event=clear&lines=3&row=16&eventAge=1.6` |
| a chain (the ladder) | `t=10&board=1&chain=6` (each link opened in turn; `chain=10` for white-hot) |
| its release | `t=10&board=1&chain=7&event=release&eventAge=1.5` |
| a hard drop | `t=10&board=1&event=drop&piece=T&u=0.3&row=17&dist=18&eventAge=0.6` |
| four lines | `t=40&board=1&event=quad&row=16&eventAge=1.4` |
| T-spin | `t=40&board=1&event=tspin&lines=2&u=0.2&row=13&eventAge=3` |
| perfect clear | `t=10&board=1&event=perfect&eventAge=3.5` |
| a gust | `t=10&board=1&gust=0.5` |
| a free camera | `cam=x,y,z,tx,ty,tz,fov` (the Iris close: `t=10&cam=-40,40,-90,-108,0,-205,46`); `sunAz=` and `sunEl=` hold the sun |
| seasons | `t=40&level=1…6` or `season=0…5` |
| the icon | `t=40&quality=Ultra&icon=1&iconFov=30&iconYaw=0&iconPitch=5&gust=0.5` at 720×720, then saturation 1.15, contrast 1.08, brightness 1.03 and the 512 px circle (the concept's yaw −34°, pitch −8° framed the Stair once the composition settled) |

Real game: `?skipIntro=1&unlockAll=1`, then pick Thermal Bloom.
