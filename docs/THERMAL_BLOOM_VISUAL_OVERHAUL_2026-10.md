# Thermal Bloom — a hot spring from the overlook

A new theme (2026-10-12), the 62nd, built from the Iris Springs concept
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

The sun stands behind the camera's left shoulder (solved per layout so the one rainbow falls across
the Chalice's column), so the mineral colours are as saturated as they get and nothing glares.

## Event language

| Event | What happens |
|---|---|
| lock | The Spill: a hot surge scours a runoff fan to wet cream on that side's ground beside the card (the Iris's mats or the Stair's risers), streamers in the piece's colour grow down it, then it bleaches back into the mat over its life (60 s at rest, compressed under slot pressure). A hard drop fires a fumarole jet at the spot. |
| clear | The Seal: for each cleared row a new white sinter lip draws itself along its rim on both sides and the pool behind it fills; then the row's own colours fix into the stone record — a stripe on its Stair tier and on its ring of the Iris's microterraces, kept for the session. Cascades reach a tier further a wave. |
| combo | A splash at the Chalice a link (its height counts the chain), the Iris heats (the eye widens, the bands march out), the fingers run wet a notch a link; links 4–5 make the fumaroles chuff in sympathy; from six links a sustained column, 25 m growing to 60 m. The break releases a white steam phase (4 + 2·peak s). |
| four lines | The Chalice's surge, then a 90 m column with its spray veil; the primary rainbow appears in the spray (the only bow in the theme); spouters fire near to far; the apron floods outward from the Iris and drains; rain falls back; a steam phase swells over the Chalice. |
| T-spin | One slender steam devil a line spins up off the Iris and wanders toward the card's side; where each dies its foot scours a sinter rosette into the mats, which the mat slowly takes back. |
| back-to-back | The Consort wakes: its mound wets, a boiling dome swells in its pool, a steam column stands over it with splashes by level; with four lines it fires the double eruption. |
| perfect clear | The Sleeper wakes: a 150 m column on the far rim, its steam rolling up through the sky band; the living colour is renewed (live blooms finish, the bands blaze for 20 s); the stone record stays. |
| level | The year turns (six seasons: High Summer, Straw Gold, First Frost, Deep Cold, Thaw, Bloom): a succession front sweeps out from the Iris along the fingers. |
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
| `thermal-bloom-steam.js` | Plume sheets as slices of one volume (the Iris's shell dome, the thread, far columns) and the ground mist (anticrepuscular lanes on Ultra). |
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
- the steam's detail tap, the shimmer, and the anticrepuscular lanes (Ultra and up).

In the post, bloom runs on Medium and up, FXAA on Medium and High, and MSAA on Ultra and up.

## Verification

(Filled at the end of the build; see the commit log for the stage-by-stage critic rounds.)

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
| a chain | `t=40&board=1&combo=7` |
| four lines | `t=40&board=1&event=quad&row=16&eventAge=1.4` |
| T-spin | `t=40&board=1&event=tspin&lines=2&u=0.2&row=13&eventAge=3` |
| perfect clear | `t=40&board=1&event=perfect&eventAge=2.5` |
| seasons | `t=40&level=1…6` or `season=0…5` |
| the icon | `t=40&quality=Ultra&icon=1&iconFov=30&iconYaw=0&iconPitch=5&gust=0.5` at 720×720, then saturation 1.15, contrast 1.08, brightness 1.03 and the 512 px circle (the concept's yaw −34°, pitch −8° framed the Stair once the composition settled) |

Real game: `?skipIntro=1&unlockAll=1`, then pick Thermal Bloom.
