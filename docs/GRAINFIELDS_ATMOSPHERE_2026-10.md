# Grainfields — the atmosphere pass (2026-10-21)

Olov asked to "start improving the visuals, effects, atmosphere and graphics in the grainfields
theme". The theme had two passes behind it ([GRAINFIELDS_VISUAL_OVERHAUL_2026-10.md](GRAINFIELDS_VISUAL_OVERHAUL_2026-10.md),
[GRAINFIELDS_PERF_2026-10.md](GRAINFIELDS_PERF_2026-10.md)). Captures of the five hours, the gameplay
events, the tiers and the lenses found what held it back; each change below was iterated in the
playground against those captures (Electron on a private dev server, RTX 5080 laptop, WebGPU, consoles
clean throughout).

## What held it back

- **The field was one flat gold.** False colour showed the sunlit stand at 1–2.5 (linear, after
  exposure) at the storm break and in the golden hour. The output's shoulder was exponential and had
  all but reached white by 1.6, and the barley's own blaze cap clamped every plant at 2.1, so the
  stand's gusts, ripeness patches and depth all landed on one value.
- **Lapporten was a flat silhouette.** At 12 km a pixel is ~10 m, but the fells' mesh carries
  ~150 m of relief: the walls read as smooth grey with a few snow dashes and the skirts as one
  brown band. Nothing said amphibolite cliffs or September at Abisko.
- **The storm break never moved.** The sun's own gap was held on the eye's line, so the near field
  was always in full sun, and the storm's dark only lay on the fells.
- **The storm was dry.** The deck was heavy and dark but nothing fell from it.
- **Portrait (phones) showed bare floor.** The portrait lens looks down to the ground 1.6 m out;
  the stand begins at 2.5 m (a clearing keeps stalks off the lens), so the bottom third of a phone
  was a flat brown plane. This predates this pass.

## What changed

**The tone (`grainfields-post.js` `gfFilmic`, `grainfields-grain.js` `BLAZE_CAP`, `grainfields-hours.js`).**
The shoulder is rational (`z / (1 + z)` above the knee at 0.6: same slope at the knee, but 1–4
spread over the top of the range). The blaze cap is soft (untouched to 1.5, rolling toward 3.2). The
storm break and the golden hour are exposed for the sunlit barley (0.92 → 0.62, 0.96 → 0.70), as a
photograph of storm light is: the deck darkens, the field keeps its texture. Between gusts, with the
wind up, the stand stands upright in its own shade (`lull`), so the waves running over it read as
light and dark, not only as paler sheen.

**Lapporten's walls (`grainfields-lapporten.js` `WALL`, `COLOURS`).** Per-pixel texture in the gate's
own frame, finer than the mesh: gullies and ribs down the fall line (along the trough on the front
faces, across it on the U's walls), bumped into the normal so each rib has a lit and a shaded side;
the amphibolite's ledges across the cliffs, broken and faded where they shrink under a couple of
pixels. Rock dark and wet in the gullies, weathered pale on the ribs; scree fans where gullies
open onto gentler ground; late snow only in the deepest gullies, broken where it thaws, and on high
ledges. The skirts are the ruska: mountain birch in gold and rust patches among the last green, the
heath above red with bilberry. Under a heavy deck the bright band low on the horizon lights the
faces more (it is nearly all the light they get).

**Sun and shade on the field (`grainfields-world.js` `SUN_GAP_SWING`, `sunGapSwing`).** Under the
storm break's heavy deck, the sun's own gap swings off the eye's line and back (two slow swells, the
side turning round): the field round the eye stands now in its clear heart, now in its torn edge
(sun and shade in patches running with the deck), now and then in the deck's shade, where the
locks' pools of sun stand out. It starts at its least, so a run opens in sunlight. A lighter deck,
or a chain breaking the storm, holds it on the eye.

**Rain (`grainfields-post.js` `RAIN`, `u.rain`).** Curtains hang under the storm's core, from the
deck's base down to the land, raked by the wind, drifting with the deck, fibrous (finer shafts of
heavier rain in each curtain). They are in the light-in-the-air march: they veil what lies behind
them in the storm's own grey, and where a gap lets the sun into them they shine. The veil is
integrated on its own finer steps (the shafts' steps are nearly as long as a curtain is wide, which
dithered it into a mesh). `u.rain` follows the cover: rain at the storm break, none from the golden
hour on, gone when a chain breaks the storm, back when the storm closes at game over. Medium and up
(the tiers with the march).

**The clouds' edges (`grainfields-clouds.js` `CLOUD_EDGE`, `CLOUD_CRISP`, `CLOUD_BILLOW`).** The
broken sky's heaps had blurred margins. Their density ramp is crisper where the march's steps are
short enough to draw it (the overhead sky), soft as before far out (steps a kilometre long through a
sharp edge banded it into stripes), and their thin margins are bitten into rounded bays by finer
billows. Morning cumulus bases are a darker grey-blue under the white heads.

**The ears by the lens (`grainfields-lens.js`, part `lens`).** A few ears stand nearer than the lens
can focus, in the frame's bottom corners: soft, swaying with the wind, darker than the field (the
stand shades them), so they frame the picture and say the eye is in the barley. Placed in the
camera's frame (every lens and aspect keeps them in their corners, the portrait shift allowed for),
drawn last with no depth. Six from Medium up, four at Low, two at Minimal.

**The close stand for portrait (`grainfields-plan.js` `CLOSE_STAND`, `grainfields-grain.js`
`CLOSE_BAND`).** The clearing round the eye is planted (1.25–2.55 m, the portrait frame's bearings,
the main stand's crop density, ~340 clumps at High) and drawn first, only while the portrait lens is
on (`setClose` from `setViewport`). Landscape, wide and square lenses never see that close; they
draw nothing new.

**The locks' beams (`grainfields-beams.js`).** The beams converging on the sun showed concentric
rings: each column was modulated by a noise texture whose cells, a few metres across, shrank to a
pixel along the beam and aliased into regular bands (found by switching the air, the bloom and the
post off in turn; only removing the modulation removed the rings). The columns are smooth now (the
motes in them are their glints). A beam also keeps less of its long upper reach (with ten beams in
play their sum was one pale haze) and is sunlight with a breath of the piece's pigment, not tinted.

**Smaller.** The four-line flash is added after the exposure, so it now scales with the hour's
exposure (never stronger than its old value; with the storm exposed darker it had become a milky
veil). The shelterbelts' larch and birch lean toward autumn (olive outer needles, the first yellow in
the birch) and glow warm, not lime, with the sun behind them.

## Tried and dropped

- Exposure alone (no shoulder change): the field stayed flat at any exposure that kept the deck's
  rims and the sun's aureole out of white; the shoulder had to change.
- The ears by the lens big and bright (a metre and a half wide blur, the stand's full light): gold on
  gold, they read as ghosts. Out-of-focus foreground only reads darker than what lies behind it.
- Rain on the march's own steps: a mesh of stripes (see above).
- A 3 × 3 tent over the clouds' target, to take the march's start offsets out: no change to the
  combs on thin lit cloud; they are the steps' own spacing (kept from before, still open).
- The beams' glint kept only round their foot: the nearest beam still showed arcs low down.

## Verification

- Playground captures (WebGPU, 1600 × 900 unless named; `.cache/grain/shots/` in the worktree): the
  five hours; the storm break at 12, 25, 45, 65 and 85 s (the gap's swing, the rain); a held chain of
  3; four lines; eight locks with the board; game over at dusk; the golden hour with the board;
  Medium, Low, Minimal; the WebGL2 fallback (same picture); portrait 430 × 932 before and after the
  close stand; square 1000 × 1000; Lapporten close up in four hours; the trees close up. Consoles
  clean (the playground's own boot lines only).
- Unit tests: `tests/unit/grainfields-atmosphere.test.js` (the swing, the rain through a chain,
  the close stand's planting and its draw by lens, the lens ears' placement and tiers, the soft cap);
  all 16 Grainfields files, 376 tests. The shader gate builds every material (the lens ears' too) in
  WGSL and GLSL at High and Minimal.
- `npm run lint:ci` at its baseline; `npm run build` (boot closure OK). The full unit suite's
  failures on this machine are not this pass's: three number-format checks that expect `28,840`
  where the machine's Swedish locale writes `28 840`, and files that time out only under the full
  run's load (they pass alone).

## Performance

Not settled. Uncapped frame rates on this machine swung by a third between identical runs while
other sessions shared it (the unchanged theme read 176 and then 109 fps at Extreme in the storm),
and the playground's GPU timestamps did not come back in an off-screen window. Interleaved
original/new runs in one process gave, in the calmer round, 109 vs 110 fps (Extreme, storm) and
124 vs 148 fps (Extreme, golden hour): no cost shows above the noise. What was added, by
construction: in the storm only, the rain's veil (40 texture-only steps a pixel of the half-resolution
air target); one texture read a sample in the cloud march; a few texture reads a pixel on the fells;
six instanced quads for the ears by the lens; under the portrait lens only, ~340 more clumps. The
locks' beams lost a texture read. A measured pass on a quiet machine (the perf doc's probe, GPU
timestamps per pass) should confirm Extreme still holds the display's rate.
