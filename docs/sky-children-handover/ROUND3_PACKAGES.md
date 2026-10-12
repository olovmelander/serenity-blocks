# Sky Children — the round-3 fix packages (planned, not built)

The critique ([CRITIQUE_ROUND3.md](CRITIQUE_ROUND3.md)) was split into six packages by **file ownership**, so
that six builders could work in parallel worktrees and be merged with git. They were launched on
2026-10-12 and stopped a few minutes later for the handover, before any of them committed; only the isles
builder had started (its partial edit is on the branch `sky-children-r3-isles-wip`, unverified). Relaunch them
from the delivery state with the workflow below (one workflow per package; each builds, is reviewed by a
code reviewer and an art director, then fixes what they confirm).

## Setup the workflow expects

- One git worktree per package, on its own branch from the delivery commit, `node_modules` symlinked from the
  main checkout (`ln -s <main>/node_modules <worktree>/node_modules`; never commit it).
- `<SCRATCH>/shoot.sh` and `<SCRATCH>/shot.mjs` from [CAPTURE_TOOLS.md](CAPTURE_TOOLS.md); one port per package
  (the reviewers use port+10 and port+20).
- `<SCRATCH>/r3/verdicts.py`, which printed each finding with its skeptic verdict from the critique run. In a new
  session, replace it with a lookup into CRITIQUE_ROUND3.md (each finding is a `### `id`` section) or simply
  tell the builder to read its findings there.
- `<SCRATCH>/r3/CONSTRAINTS-r3.md`: the rendering law, budgets, capture tool and IP guardrail (reproduced
  in the handover document).

Merge risk to expect: `createStoneMaterial` (isles and stone packages edit different blocks of it),
`sky-children-world.js` `applyFrame`/`createUniforms` (composition, sky and light add lines), `sky-children-tsl.js`
(sky and light edit different functions), and the one-line key-light edits the light package makes in five
files the others rewrite. Merge in the order composition, light, sky, falls, stone, isles and re-run every
test and the key captures after each merge.

## The packages

### isles — worktree `/home/user/wt-isles`, branch `sc/r3-isles`, port 5201

**Isles: the cascade as one travertine ribbon with pools that fill their terraces, a leaning root with real lobes and no web panel, a rim with bays and a crisp lip instead of a lid over a dark slot, a lived-in front crown, a Twin of its own**

Findings: `isles-1`, `isles-2`, `isles-3`, `isles-4`, `isles-6`

Owns: src/themes/sky-children/sky-children-isles.js EXCEPT buildFarGate, buildGateway, buildParapet, buildLedge, baluster, buildFarIsles, createFarStoneMaterial and, inside createStoneMaterial, the cliff-bed block (rims, cups, the aBed bed tone and bed lines), the far branch and the shadeBelow/corner branch (the structures package owns those). Inside createStoneMaterial you may add new options and blocks for the turf/crown, the path, the cascade's travertine apron (flow), the rim's overhang and lip shade, rock showing through the turf, and the wet tint under the notch. Also src/themes/sky-children/sky-children-water.js (createPools) and, in sky-children-world.js, placePools() only. NOT sky-children-plan.js: PLAN.spring.root -245 -> -220 and the parapet-clearance test (isles-2 step 4) belong to the composition package, and the light package will change ONE line in createStoneMaterial (the key light read U.key -> U.shadeKey times a terminator): leave that line's structure alone.

Tests: tests/unit/sky-children-isles.test.js (keep every grounding test; extend the ones your changes touch, e.g. held-all-round for elliptical pools, a strand-root test, a root-jump test), and the pool tests in tests/unit/sky-children-world.test.js

Key views: the b07 crown lens, b02 game view (board=1), b01, b17 (21:9), b16 (phone), a Twin close-up (icon=1&iconFov=10&iconYaw=-0.66&iconPitch=-0.12 at 1600x900), and the isles alone (b01 query + parts=isles)

Notes: Notes: (1) The grounding tests are the user's explicit ask: every change to the crown (bays, rim, lean, dome) must keep crownHeight exact for everything standing on it (gateway, aqueduct, trees, outcrops, cascade, strands). (2) isles-2: steps 1-3 and 5 of the amended fix are yours; step 4 is the composition package's: in your report give the root tip's new local position so they can size the lift. (3) isles-3: follow the amended fix (rim series and bays on the shape, flush sectors, crisp lip by split normals, lipShade by overhang with atan(lp.z, lp.x)); do NOT raise the dome exponent. (4) isles-1: follow the amended fix (apron shader-only, elliptical pools that never reach half the gap, alternating stagger; do NOT raise the minimum level drop). (5) isles-4 and isles-6 share groveSpots: build them together (front-of-crown shrubs and small pines by the cascade banks, rim leaners away from the Mother Fall, stepped limestone outcrops in clusters, the path carried to a front-left overlook; the Twin gets its own front group and, if the composition allows, the aqueduct swung off face-on — that changes isleAnchors and the span's fall position: re-run the world/composition tests). (6) The cascade, pools and held jewels are the gameplay link (locks land in pools): keep the pool-slot counts and the held-all-round test green.

<details><summary>Arguments as launched (JSON)</summary>

```json
{
 "name": "isles",
 "worktree": "/home/user/wt-isles",
 "branch": "sc/r3-isles",
 "port": 5201,
 "findings": [
  "isles-1",
  "isles-2",
  "isles-3",
  "isles-4",
  "isles-6"
 ],
 "title": "Isles: the cascade as one travertine ribbon with pools that fill their terraces, a leaning root with real lobes and no web panel, a rim with bays and a crisp lip instead of a lid over a dark slot, a lived-in front crown, a Twin of its own",
 "owns": "src/themes/sky-children/sky-children-isles.js EXCEPT buildFarGate, buildGateway, buildParapet, buildLedge, baluster, buildFarIsles, createFarStoneMaterial and, inside createStoneMaterial, the cliff-bed block (rims, cups, the aBed bed tone and bed lines), the far branch and the shadeBelow/corner branch (the structures package owns those). Inside createStoneMaterial you may add new options and blocks for the turf/crown, the path, the cascade's travertine apron (flow), the rim's overhang and lip shade, rock showing through the turf, and the wet tint under the notch. Also src/themes/sky-children/sky-children-water.js (createPools) and, in sky-children-world.js, placePools() only. NOT sky-children-plan.js: PLAN.spring.root -245 -> -220 and the parapet-clearance test (isles-2 step 4) belong to the composition package, and the light package will change ONE line in createStoneMaterial (the key light read U.key -> U.shadeKey times a terminator): leave that line's structure alone.",
 "tests": "tests/unit/sky-children-isles.test.js (keep every grounding test; extend the ones your changes touch, e.g. held-all-round for elliptical pools, a strand-root test, a root-jump test), and the pool tests in tests/unit/sky-children-world.test.js",
 "views": "the b07 crown lens, b02 game view (board=1), b01, b17 (21:9), b16 (phone), a Twin close-up (icon=1&iconFov=10&iconYaw=-0.66&iconPitch=-0.12 at 1600x900), and the isles alone (b01 query + parts=isles)",
 "extra": "Notes: (1) The grounding tests are the user's explicit ask: every change to the crown (bays, rim, lean, dome) must keep crownHeight exact for everything standing on it (gateway, aqueduct, trees, outcrops, cascade, strands). (2) isles-2: steps 1-3 and 5 of the amended fix are yours; step 4 is the composition package's: in your report give the root tip's new local position so they can size the lift. (3) isles-3: follow the amended fix (rim series and bays on the shape, flush sectors, crisp lip by split normals, lipShade by overhang with atan(lp.z, lp.x)); do NOT raise the dome exponent. (4) isles-1: follow the amended fix (apron shader-only, elliptical pools that never reach half the gap, alternating stagger; do NOT raise the minimum level drop). (5) isles-4 and isles-6 share groveSpots: build them together (front-of-crown shrubs and small pines by the cascade banks, rim leaners away from the Mother Fall, stepped limestone outcrops in clusters, the path carried to a front-left overlook; the Twin gets its own front group and, if the composition allows, the aqueduct swung off face-on — that changes isleAnchors and the span's fall position: re-run the world/composition tests). (6) The cascade, pools and held jewels are the gameplay link (locks land in pools): keep the pool-slot counts and the held-all-round test green."
}
```
</details>

### stone — worktree `/home/user/wt-ground`, branch `sc/r3-stone`, port 5202

**Stone and structures: the Far Gate's faceted piers with base and capital, a ruin skyline with a real notch and a travertine drape, the near overlook as weathered warm stone running in from the frame edges, far isles that sit in the haze instead of glowing like glass, a crisp bedded cliff without the quilt**

Findings: `gates-3`, `gates-5`, `gates-6`, `composition-2`, `atmosphere-parapet-black`, `atmosphere-far-ghosts`, `isles-5`

Owns: in src/themes/sky-children/sky-children-isles.js: buildFarGate, buildGateway (only its two upright column stubs), buildParapet, buildLedge, baluster, buildFarIsles, createFarStoneMaterial, and inside createStoneMaterial only the cliff-bed block (rims, cups, the aBed bed tone and bed lines), the far branch (the far stone's veil and aerial perspective) and the shadeBelow/corner branch, plus new options for those; createIsles only where your materials and options are wired (another package edits createIsles' isle wiring, buildMassif, the cascade, the groves and the crown/turf parts of createStoneMaterial at the same time; the light package will change ONE line in createStoneMaterial, the key light read U.key -> U.shadeKey: leave its structure alone). Also src/themes/sky-children/sky-children-core.js (a new bed LUT bake beside bakeStoneNoise, nothing else), and in src/themes/sky-children/sky-children-tsl.js only a NEW exported helper (for example seaTone) appended next to deepColour: do not edit existing tsl functions. If the far-ghosts fix needs the falls' far air changed (sky-children-falls.js), report it as a hook.

Tests: the Far Gate / gateway / parapet / far isle tests in tests/unit/sky-children-isles.test.js (edit only those) and a new tests/unit/sky-children-structures.test.js for new tests

Key views: b02 (crop the Far Gate and both bottom corners), b09 (gate lens), b07 (cliff), b18 (overlook lens), b03 (Gilded: far isles), b04 (Rose), b05 (Night: the parapet), b17 (21:9)

Notes: Notes: (1) composition-2: you own the parapet's geometry and shading (newel height, the right corner as natural ledge rock running out through the frame edges, the warm bounce and the sun line on tops); its ANCHORS in sky-children-plan.js (cornerL (0.02, 1.07) -> about (0.06, 1.0); corners never showing their tops when the pitch is below -5 deg) belong to the composition package: report the hooks with numbers. gates-6's parapet part, composition-2 and atmosphere-parapet-black are one design: do them together (target L* about 22-30 at Jade, never black at Night, a clear step above the board card's value). (2) The gateway's two upright stubs read as a shrine motif (IP guardrail): replace them per gates-6 (a drum lying on its side on the top course and/or a low trough, or remove them); keep the gateway's grounding tests green. (3) The Far Gate: gates-1 (the gate's placement, its foot lost in the Deep's mist) is the composition package's; gates-3 (faceted piers, batter, base and capital) and gates-5 (a real U-notch, the drape as a skin about 45-50 m proud, a stepped break with loose blocks; update profile.topAt/floorAt and anchors.weir) are yours. The depth buffer resolves about 35 m at 13 km: keep proud steps >= 45 m. The Far Gate's grounding tests (mesa, blocks, solid, weir) must stay green. (4) atmosphere-far-ghosts: a far mass must never be paler than what lies behind it; floor T per band so the three distance bands stack by value. (5) isles-5 (minor): the bed LUT computed in the fragment and the dropped cell net; verify with the b07 cliff.

<details><summary>Arguments as launched (JSON)</summary>

```json
{
 "name": "stone",
 "worktree": "/home/user/wt-ground",
 "branch": "sc/r3-stone",
 "port": 5202,
 "findings": [
  "gates-3",
  "gates-5",
  "gates-6",
  "composition-2",
  "atmosphere-parapet-black",
  "atmosphere-far-ghosts",
  "isles-5"
 ],
 "title": "Stone and structures: the Far Gate's faceted piers with base and capital, a ruin skyline with a real notch and a travertine drape, the near overlook as weathered warm stone running in from the frame edges, far isles that sit in the haze instead of glowing like glass, a crisp bedded cliff without the quilt",
 "owns": "in src/themes/sky-children/sky-children-isles.js: buildFarGate, buildGateway (only its two upright column stubs), buildParapet, buildLedge, baluster, buildFarIsles, createFarStoneMaterial, and inside createStoneMaterial only the cliff-bed block (rims, cups, the aBed bed tone and bed lines), the far branch (the far stone's veil and aerial perspective) and the shadeBelow/corner branch, plus new options for those; createIsles only where your materials and options are wired (another package edits createIsles' isle wiring, buildMassif, the cascade, the groves and the crown/turf parts of createStoneMaterial at the same time; the light package will change ONE line in createStoneMaterial, the key light read U.key -> U.shadeKey: leave its structure alone). Also src/themes/sky-children/sky-children-core.js (a new bed LUT bake beside bakeStoneNoise, nothing else), and in src/themes/sky-children/sky-children-tsl.js only a NEW exported helper (for example seaTone) appended next to deepColour: do not edit existing tsl functions. If the far-ghosts fix needs the falls' far air changed (sky-children-falls.js), report it as a hook.",
 "tests": "the Far Gate / gateway / parapet / far isle tests in tests/unit/sky-children-isles.test.js (edit only those) and a new tests/unit/sky-children-structures.test.js for new tests",
 "views": "b02 (crop the Far Gate and both bottom corners), b09 (gate lens), b07 (cliff), b18 (overlook lens), b03 (Gilded: far isles), b04 (Rose), b05 (Night: the parapet), b17 (21:9)",
 "extra": "Notes: (1) composition-2: you own the parapet's geometry and shading (newel height, the right corner as natural ledge rock running out through the frame edges, the warm bounce and the sun line on tops); its ANCHORS in sky-children-plan.js (cornerL (0.02, 1.07) -> about (0.06, 1.0); corners never showing their tops when the pitch is below -5 deg) belong to the composition package: report the hooks with numbers. gates-6's parapet part, composition-2 and atmosphere-parapet-black are one design: do them together (target L* about 22-30 at Jade, never black at Night, a clear step above the board card's value). (2) The gateway's two upright stubs read as a shrine motif (IP guardrail): replace them per gates-6 (a drum lying on its side on the top course and/or a low trough, or remove them); keep the gateway's grounding tests green. (3) The Far Gate: gates-1 (the gate's placement, its foot lost in the Deep's mist) is the composition package's; gates-3 (faceted piers, batter, base and capital) and gates-5 (a real U-notch, the drape as a skin about 45-50 m proud, a stepped break with loose blocks; update profile.topAt/floorAt and anchors.weir) are yours. The depth buffer resolves about 35 m at 13 km: keep proud steps >= 45 m. The Far Gate's grounding tests (mesa, blocks, solid, weir) must stay green. (4) atmosphere-far-ghosts: a far mass must never be paler than what lies behind it; floor T per band so the three distance bands stack by value. (5) isles-5 (minor): the bed LUT computed in the fragment and the dropped cell net; verify with the b07 cliff."
}
```
</details>

### comp — worktree `/home/user/wt-int`, branch `sc/r3-comp`, port 5203

**Composition: a crown plan for phones and rows of boards (isles in silhouette against the sky, the bow as an arch over the board), the right group placed from the HUD, the Far Gate standing on visible ground and never framing the Twin's aqueduct, the parapet's anchors, composed glider flocks, the Spring's root clear of the parapet**

Findings: `composition-1`, `composition-3`, `gates-1`, `gates-2`, `gates-4`, `composition-2`, `composition-5`, `isles-2`

Owns: src/themes/sky-children/sky-children-frame.js, sky-children-plan.js, sky-children-flock.js, sky-children-gliders.js, sky-children-composition.js, sky-children-quality.js (the gliders counts only), and in src/themes/sky-children/sky-children-world.js only applyFrame (except the U.bowDeep/smile lines, which the light package edits, and ONE line the sky package adds for its deck uniform), bowHides, writeCalm, placeSprayColumn, motherBearing, solveMotherBearing, frameCrossing and the frame-solve helpers. For composition-2 you own only the corner ANCHORS in the plan (not the parapet's geometry or shading: the structures package rebuilds those; it may shorten the left ledge and replace the right corner by a low natural ledge rock). For isles-2 you own only step 4: PLAN.spring.root -245 -> about -220 and a world test that the Spring root's lowest projected vertices stay >= 30 px from the whole parapet hull (newel and ledge) at 16:9, 16:10, 21:9 and 4:3; the isles package leans the root toward the isle's local -x (back-left) by about 0.25R at the tip, so leave margin.

Tests: tests/unit/sky-children-frame.test.js, -plan.test.js, -composition.test.js, -flock.test.js, and the composition/plan tests in -world.test.js

Key views: b02 (16:9 board), b01, b16 (phone 430x932), 390x844 phone, players=2 at 1600x900 (board=1), b17 (21:9), 1024x768 (4:3, board=1), b13 (the quad), b12 (combo 13)

Notes: Notes: (1) Order: the cheap fixes that touch every landscape frame first: gates-4 (the aqueduct never inside the gate's opening), composition-3 (the Twin and the gate placed from the HUD, not at fixed frame x; never behind the HUD at 4:3), gates-1 (the gate's plinth and mesa above the Deep's mist so its foot reads), then gates-2 (the phone gate), then composition-1 (the crown plan: build it as the design record's planned crown plan, keeping the smile as a fallback; check the record for 'crown'), then composition-5 (two composed flocks) and the anchors. (2) Every placement change must keep the bow composition tests (bow cut, stroke quotas, legs clear of the calm rects), the Mother Fall on the bow's leg, the casters' wedges and the spray column valid. (3) Each new layout rule gets a plan/frame test at the layouts it promises (4:3, 16:10, 16:9, 21:9, phones 430x932 and 390x844, 2 boards).

<details><summary>Arguments as launched (JSON)</summary>

```json
{
 "name": "comp",
 "worktree": "/home/user/wt-int",
 "branch": "sc/r3-comp",
 "port": 5203,
 "findings": [
  "composition-1",
  "composition-3",
  "gates-1",
  "gates-2",
  "gates-4",
  "composition-2",
  "composition-5",
  "isles-2"
 ],
 "title": "Composition: a crown plan for phones and rows of boards (isles in silhouette against the sky, the bow as an arch over the board), the right group placed from the HUD, the Far Gate standing on visible ground and never framing the Twin's aqueduct, the parapet's anchors, composed glider flocks, the Spring's root clear of the parapet",
 "owns": "src/themes/sky-children/sky-children-frame.js, sky-children-plan.js, sky-children-flock.js, sky-children-gliders.js, sky-children-composition.js, sky-children-quality.js (the gliders counts only), and in src/themes/sky-children/sky-children-world.js only applyFrame (except the U.bowDeep/smile lines, which the light package edits, and ONE line the sky package adds for its deck uniform), bowHides, writeCalm, placeSprayColumn, motherBearing, solveMotherBearing, frameCrossing and the frame-solve helpers. For composition-2 you own only the corner ANCHORS in the plan (not the parapet's geometry or shading: the structures package rebuilds those; it may shorten the left ledge and replace the right corner by a low natural ledge rock). For isles-2 you own only step 4: PLAN.spring.root -245 -> about -220 and a world test that the Spring root's lowest projected vertices stay >= 30 px from the whole parapet hull (newel and ledge) at 16:9, 16:10, 21:9 and 4:3; the isles package leans the root toward the isle's local -x (back-left) by about 0.25R at the tip, so leave margin.",
 "tests": "tests/unit/sky-children-frame.test.js, -plan.test.js, -composition.test.js, -flock.test.js, and the composition/plan tests in -world.test.js",
 "views": "b02 (16:9 board), b01, b16 (phone 430x932), 390x844 phone, players=2 at 1600x900 (board=1), b17 (21:9), 1024x768 (4:3, board=1), b13 (the quad), b12 (combo 13)",
 "extra": "Notes: (1) Order: the cheap fixes that touch every landscape frame first: gates-4 (the aqueduct never inside the gate's opening), composition-3 (the Twin and the gate placed from the HUD, not at fixed frame x; never behind the HUD at 4:3), gates-1 (the gate's plinth and mesa above the Deep's mist so its foot reads), then gates-2 (the phone gate), then composition-1 (the crown plan: build it as the design record's planned crown plan, keeping the smile as a fallback; check the record for 'crown'), then composition-5 (two composed flocks) and the anchors. (2) Every placement change must keep the bow composition tests (bow cut, stroke quotas, legs clear of the calm rects), the Mother Fall on the bow's leg, the casters' wedges and the spray column valid. (3) Each new layout rule gets a plan/frame test at the layouts it promises (4:3, 16:10, 16:9, 21:9, phones 430x932 and 390x844, 2 boards)."
}
```
</details>

### sky — worktree `/home/user/wt-sky`, branch `sc/r3-sky`, port 5204

**Sky and cloud sea: lit cloud closed round the antisolar point (no hole, no dark lake, the glory on cloud), a storm that reads as one cumulonimbus (stepped tower, anvil, slate crossing the billows), an altocumulus field instead of a column and a sticker, a soft vapour sea without crease aliasing, one sun for cloud and stone, soft masks**

Findings: `clouds-1`, `bow-1`, `atmosphere-antisolar-dark`, `clouds-2`, `clouds-3`, `composition-4`, `clouds-4`, `clouds-5`, `clouds-6`, `bow-4`

Owns: src/themes/sky-children/sky-children-sea.js, src/themes/sky-children/sky-children-cumulus.js, in src/themes/sky-children/sky-children-core.js only bakeSeaField and its helpers, in src/themes/sky-children/sky-children-tsl.js only createFieldTexture, deepColour, altoDeck, cirrusLayer, antiRays, horizonBanks, stormWall and its storm helpers (scStormHeight, scBillow) - NOT optics(), chainVeil(), skyBase(), cloudLight(), createLight() or skyColour's optics block (the light package edits those) - and in src/themes/sky-children/sky-children-world.js a NEW helper for the deck's room/zone uniform (called from ONE added line in applyFrame) plus that uniform in createUniforms. The light package will change ONE line each in sea.js and cumulus.js (the key light read U.key -> U.shadeKey, times a terminator): leave those lines' structure alone.

Tests: tests/unit/sky-children-sky.test.js, -core.test.js (sea field), -shaders.test.js (WGSL sizes), and the sea/optics tests in -world.test.js

Key views: b01, b02, b13 (the quad at A; also at hour=0), b10 (sea lens), b11 (sky lens), b03 (Gilded), b17 (21:9), b16 (phone), and an idle frame at board=0 hour=4 (Pearl) for the rest glow at A

Notes: Notes: (1) clouds-1, bow-1 and atmosphere-antisolar-dark are three views of one place, the antisolar point A, where everything converges (the bow's circle, the isles' wedges, the rays, the glory): do them as ONE design: the sea closed round A, the rim's mist matching the dome behind so the discard edge vanishes, a feathered discard, holes elsewhere with soft walls or depth instead of navy water, the rest glow multiplicative on the sea's own light (not gated by rim), and the wedges dissolving into the glow at rest while the quad's deepening still plays. The glory/opposition mist floor inside optics() (bow-1 step 3) belongs to the light package: report it as a hook only if you still need it after your changes. (2) clouds-3 and composition-4 are the same deck: one design (a wide low drift in the free sky right of the HUD, thinned at the gate rather than cleared, never a single cell; absent where it cannot lie as a field). (3) bow-4: the cumulus optics call (veil 0 so the sunlit tower shows no bow) and stormWall's rain falling from the base are yours. (4) clouds-5: warm the clouds' hue to the hour while holding their value (the falls stay the brightest whites). (5) Keep the dome's fragment WGSL under 64 KB (now about 40 KB) and every other stage under 48 KB.

<details><summary>Arguments as launched (JSON)</summary>

```json
{
 "name": "sky",
 "worktree": "/home/user/wt-sky",
 "branch": "sc/r3-sky",
 "port": 5204,
 "findings": [
  "clouds-1",
  "bow-1",
  "atmosphere-antisolar-dark",
  "clouds-2",
  "clouds-3",
  "composition-4",
  "clouds-4",
  "clouds-5",
  "clouds-6",
  "bow-4"
 ],
 "title": "Sky and cloud sea: lit cloud closed round the antisolar point (no hole, no dark lake, the glory on cloud), a storm that reads as one cumulonimbus (stepped tower, anvil, slate crossing the billows), an altocumulus field instead of a column and a sticker, a soft vapour sea without crease aliasing, one sun for cloud and stone, soft masks",
 "owns": "src/themes/sky-children/sky-children-sea.js, src/themes/sky-children/sky-children-cumulus.js, in src/themes/sky-children/sky-children-core.js only bakeSeaField and its helpers, in src/themes/sky-children/sky-children-tsl.js only createFieldTexture, deepColour, altoDeck, cirrusLayer, antiRays, horizonBanks, stormWall and its storm helpers (scStormHeight, scBillow) - NOT optics(), chainVeil(), skyBase(), cloudLight(), createLight() or skyColour's optics block (the light package edits those) - and in src/themes/sky-children/sky-children-world.js a NEW helper for the deck's room/zone uniform (called from ONE added line in applyFrame) plus that uniform in createUniforms. The light package will change ONE line each in sea.js and cumulus.js (the key light read U.key -> U.shadeKey, times a terminator): leave those lines' structure alone.",
 "tests": "tests/unit/sky-children-sky.test.js, -core.test.js (sea field), -shaders.test.js (WGSL sizes), and the sea/optics tests in -world.test.js",
 "views": "b01, b02, b13 (the quad at A; also at hour=0), b10 (sea lens), b11 (sky lens), b03 (Gilded), b17 (21:9), b16 (phone), and an idle frame at board=0 hour=4 (Pearl) for the rest glow at A",
 "extra": "Notes: (1) clouds-1, bow-1 and atmosphere-antisolar-dark are three views of one place, the antisolar point A, where everything converges (the bow's circle, the isles' wedges, the rays, the glory): do them as ONE design: the sea closed round A, the rim's mist matching the dome behind so the discard edge vanishes, a feathered discard, holes elsewhere with soft walls or depth instead of navy water, the rest glow multiplicative on the sea's own light (not gated by rim), and the wedges dissolving into the glow at rest while the quad's deepening still plays. The glory/opposition mist floor inside optics() (bow-1 step 3) belongs to the light package: report it as a hook only if you still need it after your changes. (2) clouds-3 and composition-4 are the same deck: one design (a wide low drift in the free sky right of the HUD, thinned at the gate rather than cleared, never a single cell; absent where it cannot lie as a field). (3) bow-4: the cumulus optics call (veil 0 so the sunlit tower shows no bow) and stormWall's rain falling from the base are yours. (4) clouds-5: warm the clouds' hue to the hour while holding their value (the falls stay the brightest whites). (5) Keep the dome's fragment WGSL under 64 KB (now about 40 KB) and every other stage under 48 KB."
}
```
</details>

### falls — worktree `/home/user/wt-falls2`, branch `sc/r3-falls`, port 5205

**Falls and spray: the Mother Fall reads at full height over a low boil instead of a cloud heap, the veil torn from its edge instead of a chimney beside it, jets as tapered comets, a brink that pours instead of a lid, thin falls that end in a breath instead of cotton balls, warmth seen through the water at night instead of a sticker**

Findings: `falls-plume`, `falls-veil`, `falls-jets`, `falls-lip`, `falls-thread`, `falls-night`, `atmosphere-hearth`, `bow-3`

Owns: src/themes/sky-children/sky-children-falls.js, src/themes/sky-children/sky-children-fx.js (createSpray and the glow/spray sprites), and in src/themes/sky-children/sky-children-world.js only the MOTHER / SPAN / HORSE / SPRAY / SPRAY_BURST / SPILLWAY tables, sprayBursts, sprayPuffs, emitSpray, fitSpray, writeLamps and emitGlows. The light package will change ONE line each in falls.js and fx.js (the key light read U.key -> U.shadeKey) and the falls' keyLight factor (atmosphere-no-glow): leave those lines' structure alone. If falls-lip (d) needs the outlets moved, that is sky-children-isles.js (the isles package): report the hook with numbers.

Tests: tests/unit/sky-children-world.test.js (spray and falls tests only), tests/unit/sky-children-shaders.test.js if a shader budget moves

Key views: b02 (the Mother Fall and the Twin's threads), b08 (fall lens), b07 (the lip; and a tight lip lens, iconFov about 9), b12 (combo 13), b13 (quad), the great pour at eventAge 5 (b13 query with eventAge=5), a three-line clear (event=clear&lines=3&eventAge=1.6), b05 (Night), b16 (phone), b17 (21:9)

Notes: Notes: (1) falls-plume is the top item: the Mother Fall is the frame's hero vertical; target in b02: the white water reads for about 80% of the visible drop, plume mean luminance at or below 0.9x the curtain's with visible form (sd >= 20), and the event towers (three-line clear, the quad) still have headroom to rise. (2) bow-3: only step 3 is yours (the spray's optics gain by alpha in fx.js, so the bow passes through a puff's edge without a step); steps 1-2 belong to the light package. (3) falls-night-grotto-lump and atmosphere-hearth-sticker are the same night beat: do them together (no sprite drawn over the curtain when veiled; the warmth carried by the falls' own hearth term between the ropes and by a hearth lamp row that warms the stone round it). (4) Keep SPRAY's emitter counts within the spray budget and the flash governor intact.

<details><summary>Arguments as launched (JSON)</summary>

```json
{
 "name": "falls",
 "worktree": "/home/user/wt-falls2",
 "branch": "sc/r3-falls",
 "port": 5205,
 "findings": [
  "falls-plume",
  "falls-veil",
  "falls-jets",
  "falls-lip",
  "falls-thread",
  "falls-night",
  "atmosphere-hearth",
  "bow-3"
 ],
 "title": "Falls and spray: the Mother Fall reads at full height over a low boil instead of a cloud heap, the veil torn from its edge instead of a chimney beside it, jets as tapered comets, a brink that pours instead of a lid, thin falls that end in a breath instead of cotton balls, warmth seen through the water at night instead of a sticker",
 "owns": "src/themes/sky-children/sky-children-falls.js, src/themes/sky-children/sky-children-fx.js (createSpray and the glow/spray sprites), and in src/themes/sky-children/sky-children-world.js only the MOTHER / SPAN / HORSE / SPRAY / SPRAY_BURST / SPILLWAY tables, sprayBursts, sprayPuffs, emitSpray, fitSpray, writeLamps and emitGlows. The light package will change ONE line each in falls.js and fx.js (the key light read U.key -> U.shadeKey) and the falls' keyLight factor (atmosphere-no-glow): leave those lines' structure alone. If falls-lip (d) needs the outlets moved, that is sky-children-isles.js (the isles package): report the hook with numbers.",
 "tests": "tests/unit/sky-children-world.test.js (spray and falls tests only), tests/unit/sky-children-shaders.test.js if a shader budget moves",
 "views": "b02 (the Mother Fall and the Twin's threads), b08 (fall lens), b07 (the lip; and a tight lip lens, iconFov about 9), b12 (combo 13), b13 (quad), the great pour at eventAge 5 (b13 query with eventAge=5), a three-line clear (event=clear&lines=3&eventAge=1.6), b05 (Night), b16 (phone), b17 (21:9)",
 "extra": "Notes: (1) falls-plume is the top item: the Mother Fall is the frame's hero vertical; target in b02: the white water reads for about 80% of the visible drop, plume mean luminance at or below 0.9x the curtain's with visible form (sd >= 20), and the event towers (three-line clear, the quad) still have headroom to rise. (2) bow-3: only step 3 is yours (the spray's optics gain by alpha in fx.js, so the bow passes through a puff's edge without a step); steps 1-2 belong to the light package. (3) falls-night-grotto-lump and atmosphere-hearth-sticker are the same night beat: do them together (no sprite drawn over the curtain when veiled; the warmth carried by the falls' own hearth term between the ropes and by a hearth lamp row that warms the stone round it). (4) Keep SPRAY's emitter counts within the spray budget and the flash governor intact."
}
```
</details>

### light — worktree `/home/user/wt-bow2`, branch `sc/r3-light`, port 5206

**Light and the bow: each hour its own light (a shading key that swings with the hour, an Earth's shadow that climbs the isles at Rose, a blue band that sits on the horizon), small hot things in HDR with a Gilded glow, a bow that reads warm over blue sky, a phone smile whose painted strokes outshine the resting bow, no invisible fogbow**

Findings: `atmosphere-hours`, `atmosphere-no-glow`, `bow-2`, `bow-3`, `bow-5`

Owns: src/themes/sky-children/sky-children-hours.js, src/themes/sky-children/sky-children-post.js, in src/themes/sky-children/sky-children-tsl.js only optics(), chainVeil(), skyBase(), cloudLight(), createLight(), the lut helpers and skyColour's optics block; in src/themes/sky-children/sky-children-core.js only bakeOpticsLut; in src/themes/sky-children/sky-children-world.js only SCALAR_UNIFORMS, createUniforms (new uniforms), applyHour, getPostState and the U.bowDeep/smile lines of applyFrame; and, as minimal edits only, the key-light read (U.key -> U.shadeKey, times the terminator) in createStoneMaterial (sky-children-isles.js), sky-children-sea.js, sky-children-cumulus.js, sky-children-falls.js and sky-children-fx.js, plus the falls' keyLight factor in sky-children-falls.js (atmosphere-no-glow (1)) and the cumulus crown's gain if cloudLight's new per-hour gain needs it. Other packages are rewriting large parts of those five files right now: change nothing else in them, and keep each such edit to the fewest lines.

Tests: tests/unit/sky-children-hours.test.js, -sky.test.js, -core.test.js (OPTICS_ROWS), -shaders.test.js, and the hour/optics tests in -world.test.js

Key views: b02-b06 (the five hours, board=1), the crossings at hour=1.5 and hour=2.5 if the playground accepts fractional hours (check the playground/effect for the hour parameter), b12 (combo 13), b02 crest crop (combo 3 over blue sky), b16 (phone, combo 4, hour 2) and 430x932 at hour 0 combo 12, b13 (quad), b07 at hour=2 (Rose on the isle)

Notes: Notes: (1) atmosphere-hours-one-light: U.shadeKey separate from the bow's U.key (optics, antiRays and casterShadow keep U.A/U.key so the bow does not move); the Earth's-shadow terminator multiplies only the key term (never lamps, hearth, pools, glider glow) and fades through the crossings; stars off over a sunlit crown. (2) atmosphere-no-glow: lift only small hot things (the falls' core and ropes, the tower's crown at Gilded/Rose, glints) into HDR and give the post a per-hour glow uniform separate from bloomBoost; verify with the playground's false-colour view if it has one, else with luminance probes; keep the flash governor intact. (3) bow-2: the drops' extinction under the coloured band so red reads red over blue sky (scaled by bowSat, no dark rim on the night moonbow); the virga option only if a capture shows it reads as rain, not noise. (4) bow-3: steps 1-2 are yours (step 3, the spray's optics gain, is the falls package's). (5) bow-5: if you remove the fogbow, update the OPTICS_ROWS tests and the design record's mentions consistently. (6) Keep the dome's fragment WGSL under 64 KB and other stages under 48 KB.

<details><summary>Arguments as launched (JSON)</summary>

```json
{
 "name": "light",
 "worktree": "/home/user/wt-bow2",
 "branch": "sc/r3-light",
 "port": 5206,
 "findings": [
  "atmosphere-hours",
  "atmosphere-no-glow",
  "bow-2",
  "bow-3",
  "bow-5"
 ],
 "title": "Light and the bow: each hour its own light (a shading key that swings with the hour, an Earth's shadow that climbs the isles at Rose, a blue band that sits on the horizon), small hot things in HDR with a Gilded glow, a bow that reads warm over blue sky, a phone smile whose painted strokes outshine the resting bow, no invisible fogbow",
 "owns": "src/themes/sky-children/sky-children-hours.js, src/themes/sky-children/sky-children-post.js, in src/themes/sky-children/sky-children-tsl.js only optics(), chainVeil(), skyBase(), cloudLight(), createLight(), the lut helpers and skyColour's optics block; in src/themes/sky-children/sky-children-core.js only bakeOpticsLut; in src/themes/sky-children/sky-children-world.js only SCALAR_UNIFORMS, createUniforms (new uniforms), applyHour, getPostState and the U.bowDeep/smile lines of applyFrame; and, as minimal edits only, the key-light read (U.key -> U.shadeKey, times the terminator) in createStoneMaterial (sky-children-isles.js), sky-children-sea.js, sky-children-cumulus.js, sky-children-falls.js and sky-children-fx.js, plus the falls' keyLight factor in sky-children-falls.js (atmosphere-no-glow (1)) and the cumulus crown's gain if cloudLight's new per-hour gain needs it. Other packages are rewriting large parts of those five files right now: change nothing else in them, and keep each such edit to the fewest lines.",
 "tests": "tests/unit/sky-children-hours.test.js, -sky.test.js, -core.test.js (OPTICS_ROWS), -shaders.test.js, and the hour/optics tests in -world.test.js",
 "views": "b02-b06 (the five hours, board=1), the crossings at hour=1.5 and hour=2.5 if the playground accepts fractional hours (check the playground/effect for the hour parameter), b12 (combo 13), b02 crest crop (combo 3 over blue sky), b16 (phone, combo 4, hour 2) and 430x932 at hour 0 combo 12, b13 (quad), b07 at hour=2 (Rose on the isle)",
 "extra": "Notes: (1) atmosphere-hours-one-light: U.shadeKey separate from the bow's U.key (optics, antiRays and casterShadow keep U.A/U.key so the bow does not move); the Earth's-shadow terminator multiplies only the key term (never lamps, hearth, pools, glider glow) and fades through the crossings; stars off over a sunlit crown. (2) atmosphere-no-glow: lift only small hot things (the falls' core and ropes, the tower's crown at Gilded/Rose, glints) into HDR and give the post a per-hour glow uniform separate from bloomBoost; verify with the playground's false-colour view if it has one, else with luminance probes; keep the flash governor intact. (3) bow-2: the drops' extinction under the coloured band so red reads red over blue sky (scaled by bowSat, no dark rim on the night moonbow); the virga option only if a capture shows it reads as rain, not noise. (4) bow-3: steps 1-2 are yours (step 3, the spray's optics gain, is the falls package's). (5) bow-5: if you remove the fogbow, update the OPTICS_ROWS tests and the design record's mentions consistently. (6) Keep the dome's fragment WGSL under 64 KB and other stages under 48 KB."
}
```
</details>

## The workflow script

Run with the Workflow tool, one call per package, `args` = the package JSON above (paths adjusted). It needs the
multi-agent opt-in (say "ultracode" or "use a workflow").

```js
export const meta = {
  name: 'sky-children-r3-package',
  description: 'Round 3: build one Sky Children fix package in its worktree from the critique + skeptic verdicts, review it adversarially (code + art), fix what is confirmed',
  phases: [
    { title: 'Build', detail: 'implement the package, screenshot-verified' },
    { title: 'Review', detail: 'two independent reviewers: correctness/perf and art direction' },
    { title: 'Fix', detail: 'fix the confirmed review findings, re-verify, commit' },
  ],
}

const SP = '<SCRATCH>'
const A = args
const TRAILER = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01PquZrKFLxhCGyftfLPf7F1'
const shoot = (port) => `${SP}/shoot.sh ${A.worktree} ${port}`

const COMMON = `You are a senior graphics engineer and technical artist on "Sky Children — Irisfall", a WebGPU/TSL background theme (three 0.186.1, three/webgpu + three/tsl, MeshBasicNodeMaterial only, WebGL2 fallback) in the repo serenity-blocks. The user asked for a total visual audit and improvement of the theme (the visuals, the models, the atmosphere, the floating isles, the waterfall, the composition, the art style, the modelling, the assets, the clouds, the rainbow, the gates) to the level of the repo's most beloved themes, and insisted that every arch stands on solid ground, aligned with it (now pinned by tests: keep it true). Two build rounds and two grounding audits are done (current state: commit 79adc87). A new art-direction critique scored each dimension 5.5-7/10 and listed what still holds it back; a skeptic per major finding tried to refute it and amended the fix. You own ONE package of that critique.

Your worktree: ${A.worktree} (branch ${A.branch}, checked out at 79adc87; node_modules is a symlink: never commit it; stage only your own paths with git add <paths>).

Read first: ${SP}/r3/CONSTRAINTS-r3.md (rendering law, budgets, capture tool, IP guardrail), the design record ${A.worktree}/docs/SKY_CHILDREN_VISUAL_OVERHAUL_2026-10.md (skim; read the sections on your subject), and your findings:
  python3 ${SP}/r3/verdicts.py ${A.findings.join(' ')}
It prints each critic finding and the skeptic's verdict with its AMENDED FIX. The skeptics read the code and often corrected the critic: where they differ, follow the amended fix (it is still a proposal: check it against the code). Some verdicts are still PENDING (the skeptics are finishing): do the findings that have a verdict first; re-run the script before starting each later finding; if one is still pending, verify it yourself (a capture and the code) before building it. Do not build a finding the skeptic REFUTED. Minor findings have no skeptic: verify them yourself and do them when cheap and clearly right.
Frames: ${SP}/audit/a*.png (first audit), ${SP}/audit/after/b*.png (the critique's AFTER frames; their queries are in ${SP}/audit/after-set.txt — note they predate the last grounding fixes), the critics' and skeptics' crops under ${SP}/critique/. Sibling references for the quality bar: ${SP}/audit/r-*.png.

Capture: ${shoot(A.port)} "<query>" <out.png> <w> <h>   or   ${shoot(A.port)} <list.txt>   (list lines: out.png|query|w|h). It starts its own Vite on port ${A.port} for the call and stops it after; never run two at once on your port, never start a server yourself. Write captures under ${SP}/r3/${A.name}/ (mkdir -p). Look at them with the Read tool. Six packages build in parallel on 4 shared CPUs, so a frame takes 1-4 min: batch frames in lists and take what you need, but never claim a visual change works without having looked at it.

FILE OWNERSHIP (other packages edit other parts of the same theme in parallel; the lead merges them with git): you may edit ONLY ${A.owns}. Keep your edits inside those functions/blocks; do not reformat, reorder or rename code you do not need to change (that makes the merge conflict). If you need a change elsewhere, do not make it: describe the exact hook in your report. Tests: you may edit or add tests under tests/unit/ that cover your work (${A.tests}).

GIT SAFETY (several builders share one repository): NEVER run \`git stash\` in any form; never \`git rm\` or delete tracked files; never touch, reset, checkout or apply into any other worktree (/home/user/wt-*, /home/user/serenity-blocks) or any branch but yours. Commit often, in small coherent commits. Never push.

Rules: CLAUDE.md applies (visual work is verified by screenshots and a clean console; a clean build is not proof). Keep determinism (everything a function of the world clock), both backends (TSL that compiles to WGSL and GLSL), the tier budgets (triangles, at most 15 draws, WGSL sizes: tests/unit/sky-children-world.test.js and -shaders.test.js), the flash governor, and grounding (tests/unit/sky-children-isles.test.js: nothing floats, nothing sinks, consistent winding). No IP from the inspiring game: grep your diff (case-insensitive) for the IP denylist in the handover document (the inspiring game's name, its studio, its realm and collectible names, its carried-flame and guide-figure motifs) before each commit. Match the surrounding code style (prose-like comments in the theme's vocabulary; no comment that narrates the change). Before each commit run (cd ${A.worktree} && npx vitest run tests/unit/sky-children-*.test.js) and (cd ${A.worktree} && npx eslint src/themes/sky-children/ tests/unit/): 0 failures, 0 errors. Commit messages: a clear subject ("Sky Children: ...") and a short body, ending with exactly these two lines:
${TRAILER}`

const REPORT = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'what you changed, finding by finding (ids): built / partly built / not built (and why), with the before/after evidence' },
    commits: { type: 'array', items: { type: 'string' } },
    captures: { type: 'array', items: { type: 'string' }, description: 'before/after capture paths with the query used' },
    hooks: { type: 'array', items: { type: 'string' }, description: 'exact changes needed in files or functions you do not own' },
    risks: { type: 'array', items: { type: 'string' } },
    triangles: { type: 'string', description: 'scene triangles per tier after your change (from the world test)' },
  },
  required: ['summary', 'commits', 'captures', 'hooks', 'risks'],
}
const REVIEW = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' }, severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          title: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' },
        },
        required: ['id', 'severity', 'title', 'evidence', 'fix'],
      },
    },
    verdict: { type: 'string' },
  },
  required: ['findings', 'verdict'],
}

phase('Build')
const built = await agent(`${COMMON}

YOUR PACKAGE: ${A.title}
Findings: ${A.findings.join(', ')}
${A.extra}

Work in order of visual impact. At the start capture the key views once as your baseline (${A.views}). For each change: implement, capture, look, iterate until it is genuinely better (compare with the AFTER frames and the sibling references), check the console. Fix what breaks. Commit in coherent steps. At the end report as the schema asks.`, { label: `build:${A.name}`, phase: 'Build', schema: REPORT })

phase('Review')
const reviews = await parallel([
  () => agent(`You are an adversarial reviewer (correctness, performance, determinism, robustness) of a graphics package just built for the Sky Children theme. Read ${SP}/r3/CONSTRAINTS-r3.md. Worktree ${A.worktree}, branch ${A.branch}; the package's diff is \`git -C ${A.worktree} diff 79adc87..${A.branch}\`. Its findings: python3 ${SP}/r3/verdicts.py ${A.findings.join(' ')}. Its file ownership was: ${A.owns}. The builder's report: ${JSON.stringify(built)}.
Hunt for real defects: NaN/Inf paths (zero vectors normalised, divisions, acos/pow domains), WGSL/GLSL compile issues on either backend (run the theme's shader tests), uniform-control-flow violations (derivatives or texture sampling inside non-uniform branches), per-pixel cost blowups on integrated GPUs, budget or test regressions (run (cd ${A.worktree} && npx vitest run tests/unit/sky-children-*.test.js) and the eslint command), nondeterminism (Math.random, wall clock), resource leaks (dispose), grounding regressions (anything floating, sunk, inside-out), edits outside the ownership (merge risk), layout cases (phone portrait 430x932 board=1, ultrawide 2560x1080, 4:3 1024x768, players=2), and breaking other systems (gameplay slots, events, the bow composition, the hours). Capture with ${shoot(A.port + 10)} "<query>" <out.png> w h (or a list file; it starts and stops its own Vite on port ${A.port + 10}; never two at once) into ${SP}/r3/${A.name}/review-*.png. Report only confirmed or highly plausible defects with evidence. Do not edit, stage, commit or stash anything.`, { label: `review-code:${A.name}`, phase: 'Review', schema: REVIEW }),
  () => agent(`You are a demanding art director reviewing a visual package just built for the Sky Children theme. Read ${SP}/r3/CONSTRAINTS-r3.md and the package's findings with their skeptic verdicts: python3 ${SP}/r3/verdicts.py ${A.findings.join(' ')}. Worktree ${A.worktree}. The builder's report: ${JSON.stringify(built)}.
Capture the package's key views yourself (${A.views}) plus at least two other hours and a phone frame (430x932, board=1), with ${shoot(A.port + 20)} "<query>" <out.png> w h (or a list file; it starts and stops its own Vite on port ${A.port + 20}; never two at once) into ${SP}/r3/${A.name}/art-*.png, and compare with the AFTER frames ${SP}/audit/after/b*.png (queries in ${SP}/audit/after-set.txt), the first audit ${SP}/audit/a*.png and the sibling references ${SP}/audit/r-*.png. Judge: did each finding really get solved in the picture? What still looks wrong, cheap, inconsistent with the rest of the frame, or worse than before (regressions)? Be specific (frame, pixel region, what to change, how). Do not edit, stage, commit or stash anything.`, { label: `review-art:${A.name}`, phase: 'Review', schema: REVIEW }),
])
const issues = reviews.filter(Boolean).flatMap((r) => r.findings)
log(`${A.name}: ${issues.length} review findings`)

phase('Fix')
const fixed = issues.length ? await agent(`${COMMON}

You built package "${A.title}" (your report: ${JSON.stringify(built)}). Two reviewers then examined it. Their findings:
${JSON.stringify(issues, null, 1)}

Verify each finding yourself (reproduce it with a capture or a test). Fix every one that is real (blockers and majors first; minors when cheap), within your file ownership; if a fix needs another file, add it to hooks. For any you judge not real, say why. Also re-run python3 ${SP}/r3/verdicts.py ${A.findings.join(' ')}: if a verdict that was pending when you built has since landed and contradicts what you built, reconcile it now. Re-run the tests and lint, capture the key views again and look at them, commit. Report as the schema asks (the summary must list each review finding id with: fixed / not real + why / deferred + why, and the final state of each package finding).`, { label: `fix:${A.name}`, phase: 'Fix', schema: REPORT }) : built

return { name: A.name, built, reviews, fixed }
```
