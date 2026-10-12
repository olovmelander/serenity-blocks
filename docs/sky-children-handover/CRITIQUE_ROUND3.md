# Sky Children — round-3 critique and skeptic verdicts (2026-10-12)

Exported from the session that built the theme, for the next session to act on. Seven critics
compared the first audit's frames (the "a" set) with the same queries rendered after the second
build round and the grounding fixes (the "b" set), scored each dimension and listed what still
holds it back. A skeptic per **major** finding then tried to refute it from the frames and the
code, and where the finding survived wrote an amended fix. **Where an amended fix differs from
the critic's, follow the amended fix** (the skeptics read the code and caught several proposals
that would have broken grounding, pool slots or the bow). Minor findings were not put to a
skeptic: verify them before building.

Verdicts at export: 8 of 28 major findings (8 confirmed, 0 refuted); the rest are marked PENDING and should be verified before they are built (re-run a skeptic, or check the claim with a capture).

Frame names (a01..a18, b01..b18, critique/*.png) refer to captures in the original session's scratch
space, which is gone. The a and b frames can be re-rendered at the commits they were taken at (the a
set at `36770ad`, the b set at `e680429`; queries in [CAPTURE_TOOLS.md](CAPTURE_TOOLS.md)); the
critique/*.png views are listed there as far as the text records them.

## Read first: corrections since the critique

- **Triangles:** measured at the merge (the census of the world test), the tiers are Minimal 47.6 k, Low 59.8 k,
  Medium 76.4 k, High 101.7 k, Ultra 130.8 k, Extreme 165.0 k. Figures below such as "High ~121k of 140k" or
  "98.6k" are out of date.
- **The dome's WGSL:** the sky dome's fragment stage is about 55 KB at High of its 64 KB gate (about 10 KB of
  headroom: 55,074 of 65,536 bytes). Cost notes below that say "about 40 of 64 KB" are wrong; every other stage is
  under 35 KB of its 48 KB.
- **Depth:** the near plane is 2 m (`REST_RIG`), so the depth buffer resolves about 5 m at the Far Gate. The
  "~35 m" resolution and the "keep each step >= 45 m proud" rule in gates-3 and gates-5 date from the old 0.3 m
  near plane; 15 m is enough.
- **Isle sizes:** "72 m" and "46 m" are the isles' radii (`PLAN.spring.radius`, `PLAN.twin.radius`); the Spring's
  crown is about 140 m across.
- **Line numbers** are as the critics read them. In `sky-children-isles.js` they run about 17 lines short of
  79adc87 (the critics read it at 70f9bd9, and 79adc87 added 17 lines above these): 2083 -> 2100 (`const L = U.key`), 2225-2229 -> 2242-2246
  (shadeBelow), 2232 -> 2249 (the fill), 2286 -> 2303 (the far T floor), 2291 -> 2308 (the veil), 2301-2302 ->
  2318-2319 (the mist dissolve). In the other files they match 79adc87. Search by the quoted code.
- **Dangling references:** ids such as comp-5, comp-9b, atmo-2/4/6, isles-7, falls-3, gate-2, comp-6, isles-3(b) in
  isles-5 (the first audit's isles-3, not this round's), "PLAN
  decision 6", "PLAN §P6" and "PLAN's own rules" name findings and decisions in the first audit's plan, which
  lived in the old scratch space and is gone: what the text quotes from them is all that survives. "FINAL §..."
  in the theme's code and tests names the first build's design plan, also gone; the design record replaces it.
  The design record does not describe a "crown plan": composition-1's critic's fix is its only spec. The skeptics'
  scratch paths (scratchpad/critique/lidref/, refute-plume-mirror/...) were in the old scratch space too.

## Scores (before → after, 0-10 against the repo's most loved themes)

| Dimension | Before | After | Majors | Verdicts in |
|---|---|---|---|---|
| isles | 3 | 5.5 | 4 | 4 |
| falls | 4 | 6 | 5 | 4 |
| clouds | 3 | 6 | 4 | 0 |
| bow | 4 | 7 | 3 | 0 |
| gates | 3 | 6 | 5 | 0 |
| composition | 4 | 6.5 | 3 | 0 |
| atmosphere | 4 | 6 | 4 | 0 |

## Index

| Finding | Severity | Verdict |
|---|---|---|
| `isles-1-cascade-slats` The rimstone cascade reads as a ladder of white slats on a lawn: no water mass, and no travertine body joining the basins | major | confirmed |
| `isles-2-root-spinning-top` The root is a symmetric spinning top: the lobes do not break its silhouette, a flat web panel shows, and the tip touches the parapet ledge | major | confirmed |
| `isles-3-crown-lid` The crown sits on the cliff like a lid: a uniform turf overhang over an unbroken dark slot all round, with a smooth cushion edge | major | confirmed |
| `isles-4-crown-empty` The crown's front half is an empty olive lawn: every tree on the back crest, dice-shaped outcrops, a path that goes nowhere | major | confirmed |
| `isles-5-cliff-quilt` The cliff skin is a quilt: a regular 1.5 m cell net over every bed, and bed boundaries stair-stepped along the triangles | minor | not verified (minor) |
| `isles-6-twin-bare` The Twin Isle is a putting green on a cone, its aqueduct a face-on cardboard cutout | minor | not verified (minor) |
| `falls-plume-swallows-the-fall` The Mother's plume is an opaque, flat cumulus heap: it cuts the hero vertical in half, out-shines the curtain, and leaves the event beats no headroom | major | confirmed |
| `falls-veil-detached-chimney` The edge veil stands as a separate steam column beside the curtain instead of spray torn off its edge | major | confirmed |
| `falls-jets-read-as-tabs` The jets are flat, square-headed white tabs all of one length: a barcode of tape strips rather than comets of water | major | confirmed |
| `falls-lip-reads-as-a-lid` The brink is a smooth teal dome under the turf overhang (a lid or a jellyfish bell), and the far flank is a ruled curve | major | PENDING |
| `falls-thread-feet-cotton-balls` Every Twin thread and the span's fall ends in a stack of hard-edged cotton balls hanging in mid-air (steam-engine smoke), not a breath of spray | major | confirmed |
| `falls-night-grotto-lump-remains` At night an opaque orange lump still sits on the Mother Fall's head; commit be704eb claims it is gone | minor | not verified (minor) |
| `clouds-1-holes-at-A` Holes in the cloud sea open onto the old flat 'ocean' shelf, with a jagged discard outline, and one sits at A right on the glory | major | PENDING |
| `clouds-2-tower-storm-cutouts` Tower and storm read as two cut-outs glued side by side: a white bullet with a 150-px vertical seam against a dark slope that reads as a mountain | major | PENDING |
| `clouds-3-alto-column-and-sticker` The altocumulus deck is squeezed into a vertical column at idle, and into one stray sticker puff in every board frame | major | PENDING |
| `clouds-4-sea-crumpled-foil` The cloud sea reads as crumpled foil or rippled sand in the middle distance: hard creases alias into contour hatching and dotted lines, and the valleys go dark instead of filling with mist | major | PENDING |
| `clouds-5-two-suns` Clouds are lit by a cooler sun than the stone: at Gilded the tower and the deck are lilac-grey while the gate, isles and far mist are gold | minor | not verified (minor) |
| `clouds-6-graphic-masks` Two masks still read as graphics: the cirrus' bow-exclusion ring, and hairline ray lanes scratched across the sea | minor | not verified (minor) |
| `bow-1` The antisolar point lands in a hole of the cloud sea: no opposition glow at rest, and the quad's glory is cut by a hard chord under a hard-edged dark blob | major | PENDING |
| `bow-2` Over clear blue sky the bow is a pastel pink-teal ribbon with no warm half, and nothing in the picture carries it | major | PENDING |
| `bow-3` Phone smile: painted strokes barely read over the bright sea, while the spray's resting bow is vivid and stops dead at the puff's edge (the reward is inverted) | major | PENDING |
| `bow-4` The secondary smears across the sunlit tower and leaves a maroon cap on a storm billow (b12, the hero combo-13 frame) | minor | not verified (minor) |
| `bow-5` The fogbow can't be seen in any layout, yet it costs every Deep fragment | minor | not verified (minor) |
| `gates-1` In every gameplay frame the Far Gate's piers fade into fog; its plinth and mesa (the ground it stands on) are never seen | major | PENDING |
| `gates-2` Portrait still crops the gate: two pink shafts hang from the top edge, the head is off-frame (unchanged since a16) | major | PENDING |
| `gates-3` The Far Gate's piers render as smooth round tubes with no base or capital, so 55% of the monument is featureless pipe | major | PENDING |
| `gates-4` The Twin's aqueduct stands centred inside the Far Gate's opening, at its foot, in every landscape frame, which collapses the scale | major | PENDING |
| `gates-5` The attic skyline reads as a step and a pitched roof: the weir notch is a proud pale block, the break a straight ramp, and the water story is illegible | major | PENDING |
| `gates-6` Near pieces are crude: the parapet reads as navy primitives with a pawn baluster, and the gateway's two upright stubs read as votive light | minor | not verified (minor) |
| `composition-1` Phone and rows of boards are still the aerial-survey smile; the planned crown plan (PLAN decision 6, comp-5) was never built | major | PENDING |
| `composition-2` The foreground parapet reads as UI furniture: two small navy boxes of the card's value that close inside the frame and frame nothing | major | PENDING |
| `composition-3` The right group stands at fixed frame x, not from the HUD: the Twin's crown lands on the gate's mesa line at 16:9/21:9, and at 4:3 the gate stands behind the HUD | major | PENDING |
| `composition-4` The altocumulus deck survives only as a residue squeezed between the HUD's calm fade and the gate's clearing, tracing the HUD's edge | minor | not verified (minor) |
| `composition-5` The gliders are still confetti spread over every free region (comp-9b's two composed flocks not built) | minor | not verified (minor) |
| `atmosphere-hours-one-light` Five hours, one light: Rose, Pearl and Gilded are recolours of the same lighting, and the Earth's shadow is still a stripe | major | PENDING |
| `atmosphere-antisolar-dark` At rest the antisolar point is the darkest patch of the lower half in every hour, and even the quad's glory has a dark heart | major | PENDING |
| `atmosphere-far-ghosts` Aerial perspective is inverted on the far archipelago: veiled roots glow brighter than the sea in front of them, as flat frosted-glass cones | major | PENDING |
| `atmosphere-no-glow` The scene is still authored in SDR: bloom fires only on the falls' ropes and the bow's leg, and Gilded, the hazy-gold hour, does not glow | major | PENDING |
| `atmosphere-hearth-sticker` Night's only warm note is a clipped peach sticker on the face of the Mother Fall, and it lights nothing | minor | not verified (minor) |
| `atmosphere-parapet-black` The overlook's coulisses are the frame's blackest values in every hour, darker than the board card | minor | not verified (minor) |

## isles: 3 → 5.5

**What improved (the critic):** The isles now read as one coherent stylised world. Before, they were a clay tart on a carrot.

What improved, frame by frame:
- **Floating.** The Spring Isle floats with air and cloud sea under it (b01, b02, b17); in a01/a02 it was a drum standing on the cloud floor. Its crown is 72 m across and pitched toward the eye, so the trees and the gateway sit well inside the rim.
- **Cliff.** The marbled Rorschach drips are gone. The cliff is now bedded rock: horizontal iron and lime beds with hard cap ledges and undercut feet (b07 x 300-700 y 470-900). That gives geological scale, and it holds its value in every hour; Night is navy, no longer a black hole (b03-b06 strip).
- **No seams.** The material seams are fixed: continuous aMoss/aCrown weights mean no pale zigzag bands anywhere.
- **Spillway.** The Mother Fall leaves a real spillway notch with a dark, wet cliff under it (b07 x 700-830 y 470-520). This is the strongest natural cue on the isle.
- **Trees.** The broccoli blobs are replaced by tapered cypress spires and umbrella pines on trunks. This is the best new asset: a real vertical scale cue (b07 x 480-760 y 130-300).
- **Gateway.** The paper-clip hoop is replaced by a masonry gateway with voussoirs, a plinth and a hanging bronze bell, on a levelled pad.
- **Small pieces.** The summit hump crag is gone. Satellites drift beside and under the isle, moss curtains hang from the lip, and the Deep's light bounces under overhangs.
- **Cascade.** It no longer wraps the rim as a white wedding-cake skirt; it runs on a diagonal flow path into the notch.
- **Twin.** It got a promontory with a two-tier aqueduct, its own cascade and three falls.
- **Grounding.** Every work stands on the crown as it is built (tests pin this).

Against the siblings it still reads as a toy: a bald lawn pillow sitting like a lid on a spinning-top root, a ladder of white slats for a cascade, and a quilted procedural skin. Problems 1-4 below are what keep it from 7-8.

Caveat: the worktree has an uncommitted, in-progress edit to buildCascade in sky-children-isles.js (basin dishes under the pools, contour-aligned dams, a travertine runnel into the notch). My verdict is on the committed b-frames. My captures (critique/isles-c1-spring-isolated.png, parts=isles; critique/isles-c2-twin-close.png) may include part of that edit through HMR, but the cascade still reads as slats in both.

Measured on the working tree (node, High tier):
- Spring: 17 trees, only 1 on the half facing the eye.
- Twin: 6 trees, none on the front half; about 2 are visible in c2.
- Pools: Spring has 31, with radii 1.2-3.8 m (median about 2.2 m), in basins 13-30 m wide.

### `isles-1-cascade-slats` [major] The rimstone cascade reads as a ladder of white slats on a lawn: no water mass, and no travertine body joining the basins

**Evidence:** b07 (crown): 12 thin peach-white slats in a neat column with teal slivers behind them, each one isolated on plain grass (x 505-745 y 270-410). b01/b02 game view: a white zipper with 2-px jewel chips (x 260-395 y 375-450). b17 x 455-590 y 355-420. b16 portrait: salmon brackets (x 0-75 y 290-360). Twin in c2: 'fingernail' crescents (x 800-980 y 400-495). Pool radii are 1.2-3.8 m (median 2.2 m) in dams 13-30 m wide, so water covers about a third of each terrace and the rest of the basin shows lawn. In the committed frames about 15 m of bare turf separate the last dam from the notch lip (b07 x 700-800 y 400-470), so the Mother Fall's water appears from nowhere. The uncommitted runnel edit targets exactly this gap.

**Why it matters:** The cascade is the theme's 'one idea': the board pours colour into terraced pools. Right now nothing on the crown says 'water stepping down stone'; it says 'stairs'. The held jewels (the gameplay link) are chips a few pixels wide, so locks land on pools the eye can barely find. Every sibling has one hero surface rendered with care; here the hero is the weakest read on the isle.

**Critic's fix:** Build on the in-progress basin-dish and runnel edit.
(a) Travertine apron, in createStoneMaterial (sky-children-isles.js). Add a `flow` option shaped like `path`: about 8 points [x, z, halfWidth] sampled from buildCascade's Bezier (have buildCascade return it; createIsles passes it). Inside about 0.6× each dam's width, mix the turf to cream travertine with ochre-wet streaks running down the fall line (stone.a sampled along the slope). Carry it over the notch lip, and turn the `wet` tint's first 8-10 m under the notch from dark-green into white-ochre flowstone. The dams then sit in one continuous white-jade ribbon from spring to fall, the Pamukkale read.
(b) Pools that fill their basins. buildCascade emits rx (half the crest stretch between jewel spots, ×1.05), rz (the basin depth from setBack) and yaw = atan2(d.tx, d.tz) per pool. sky-children-water.js createPools().set(i, world, rx, rz, yaw, tilt) uses s.set(rx, 1, rz) and yaw instead of the random seed turn. world.placePools (sky-children-world.js:840) passes them. Slot counts are unchanged, so the side and level tests hold.
(c) Break the ladder. Raise the minimum level drop in buildCascade from 0.6 to about 1.1·scaleR so curtains are 4-6 px tall at game view. Stagger the basins laterally by ±0.4 width, and pair two side-by-side basins on 2-3 levels so it reads as a fan of basins, not stair treads. Add a darker wet band under each crest.

**Files:** src/themes/sky-children/sky-children-isles.js (buildCascade, createStoneMaterial, createIsles); src/themes/sky-children/sky-children-water.js (createPools.set); src/themes/sky-children/sky-children-world.js (placePools)

**Cost:** 0 draws. (a) is shader only: the path loop over about 8 segments, about +0.8 KB fragment WGSL and +30 ALU on the Spring material. (b) is 0 tris (instance scale only). (c) is 0-1k tris. Re-run the pool-slot and grounding tests.

**Skeptic: CONFIRMED.** The problem is real, but some of the critic's evidence is out of date. The AFTER frames were captured at 15:17-15:36. Commit 178c361, which added the rimstone dishes and the runnel down the notch, landed at 16:09. So I captured the current state twice.

- critique/cascade-x1-b07-now.png, the b07 query: the runnel now joins the last dam to the Mother Fall's lip (x 715-760, y 360-470). The critic's point about 15 m of bare turf before the notch no longer holds.
- Same frame: the core read is unchanged. The crown (x 505-760, y 270-400) shows 12 peach-cream treads stacked in a neat diagonal column on plain lawn. Each terrace has a teal sliver of water 2-4 px tall. The dish floors only thicken the treads a little.
- critique/cascade-x2-b02-now.png, the game view (x 255-400, y 375-470): still a white zipper. The water is 1-2 px lines and the held jewels are a smear a few px wide. The runnel reads as a thin pale post under the last dam, not as water.

I dumped buildCascade's output. Spring Isle: 31 pools with radii 1.2-3.8 m (median about 2 m), drops between levels 0.6-2.1 m. Twin Isle: 22 pools with radii 1.3-2.6 m. That confirms the critic's numbers: across each terrace, water covers about a third.

The critic did not misread the BEFORE frames. In a02 and a07 the old cascade was clunky, but it had mass: a field of terraces across the whole front of the crown. The AFTER cascade is grounded but has lost that presence. The design record calls for "white travertine terraces holding jade pools", and the one idea, the board pouring colour into pools, depends on the water reading. So this is a real, major gap in the picture and not a matter of taste.

On the proposed fix:
- (a), the travertine apron, is sound. It is shader-only and follows the existing `path` block in createStoneMaterial.
- (b), elliptical pools, is sound but needs corrections:
  - Making each pool 1.05 times half the gap between spots makes neighbouring pools overlap. Pools on the same terrace sit at the same height (level − 0.05), so the overlaps would z-fight.
  - The yaw must add the isle's placement yaw (`e.yaw`).
  - The dish's reach (`far`) must be computed from rz.
  - The "held all round" test samples a circle and must sample the ellipse instead.
  - The corner basins must stay circles with their seeded turn.
- (c) is partly unsound. Pool levels are fitted to the turf: `min(top + 0.5, mid + 1.8)`, never above the pool upstream. Forcing a minimum drop of 1.1·scaleR would sink the lower levels under their own turf. Their wet stretches (`ground < level − 0.4`) would empty and pools and slots would disappear. That contradicts the critic's claim that slot counts stay the same. Lateral stagger alone, at zero triangles, is enough to break the ladder.

**Amended fix (use this):** Three changes, in order of how much each helps. None adds triangles or draws.

1. A travertine apron, so the cascade becomes one cream ribbon from the spring to the Mother Fall. This is the biggest lever and is shader-only.
   - buildCascade (sky-children-isles.js) also returns `flow`: about 8 points [x, z, halfWidth] in isle-local coordinates:
     - each dam's centre `d.c` with halfWidth about 0.45·d.width, so the ribbon stays inside the dams' sunken wings;
     - then the runnel's `from` and `to` points, halfWidth about 1.5·scaleR rising to 4·scaleR.
   - createIsles calls isleCascade before it builds the materials (isleCascade is a pure function). It passes `flow: cascades.spring.flow` to the spring material and `cascades.twin.flow` to twinMaterial.
   - createStoneMaterial gains a `flow` option next to the `path` block:
     - Distance loop: the same segment-distance loop on lp.xz, noise-warped like the path, with the half width interpolated along each segment.
     - Mask: `(1 − smoothstep(0.75·hw, hw, d + (grain − 0.5)·1.5)) · smoothstep(0.5, 0.75, N.y)`.
     - Colour: inside the mask, mix the turf toward the same `trav` albedo, about 1.08× whiter.
     - Streaks: add ochre-wet streaks (`trav·vec3(0.86, 0.74, 0.55)`) where a stone-texture read stretched along the fall line exceeds 0.6.
     - Order: apply this before crownRock and the moss creep consume `turf`.
   - Under the notch, inside the existing `wet` lobe: for the first 8-10 m below lipY, replace the dark green wet tint with this flowstone tint. Keep the dark wet below that depth.
   - Cost: about 8 segments, roughly +0.8 KB fragment WGSL and +30-40 ALU on the spring and twin stone materials. Check the shaders test (each stage under 48 KB).

2. Pools that fill their terraces. Instance scale only.
   - buildCascade, in the reach loop, per spot:
     - rx = min((0.5·gap − 0.15)/1.11, (0.5·(s1 − s0)·d.width/spots)/1.11, 6·scaleR), using the half span when there is one spot. The lobed rim reaches 1.11×, and same-level pools are coplanar, so rx must never reach half the gap or they z-fight.
     - rz = the existing shrink-until-the-centre-is-wet radius loop.
     - `setBack` and `far` use rz.
     - Emit `{ x, y, z, rx, rz, yaw: atan2(d.tx, d.tz), radius: max(rx, rz), level, … }`.
   - createIsles forwards rx, rz and yaw. The footprint keeps using `radius`.
   - sky-children-water.js: createPools.set(i, world, rx, rz, yaw, tilt) uses `s.set(rx, 1, rz)` and `q.setFromAxisAngle(Y, yaw).premultiply(tiltQ)`.
   - world.placePools calls `pools.set(k, q.world, (q.rx ?? q.radius)·scale, (q.rz ?? q.radius)·scale, q.rx ? q.yaw + e.yaw : k·2.39996, pitch)`. The corner basins stay circles with their seeded turn.
   - Tests:
     - Update the "held all round" test to sample the yawed ellipse at 1.11·(rx, rz).
     - Re-run the pool-slot counts and the grounding tests; slot counts are unchanged because the spots are unchanged.

3. Break the ladder without changing the levels.
   - Replace the random lateral wander `(rand() − 0.5)·0.28·width` with an alternating stagger, `(i % 2 ? 1 : −1)·(0.18 + 0.12·rand())·width`, so the column zigzags into a fan. The fits() loop and the dams-cross test still keep the dams apart.
   - Do not raise the minimum level drop. It would sink the lower pools under their turf and drop slots.
   - Optional: once the apron is cream, deepen the curtain rows' aAO (about 0.72 → 0.55 at the foot) and tint them ochre-wet, so tread and riser separate by value.

Verify:
- Re-capture the b07 and b02 queries. Jade crescents should fill each terrace inside one cream ribbon that runs to the fall's lip.
- Run the isles, world and shaders tests: pool slots, held-all-round, the triangle budget and the WGSL budget.

### `isles-2-root-spinning-top` [major] The root is a symmetric spinning top: the lobes do not break its silhouette, a flat web panel shows, and the tip touches the parapet ledge

**Evidence:** c1 (isles only, on black): a near-symmetric inverted cone from the rim to one central tip (x 470-850 y 200-700). Its outline only steps at the ledges; no hanging masses, saddles or lean. The same cone shows across all four hours (b03-b06 strip) and in b01 x 135-380 y 465-875. A flat vertical web panel with a straight edge sits low on the left of the root (b01 x 185-220 y 705-750; b17 x 410-450 y 700-760). The tip lands about 6 px above the parapet slab's top edge in b01 (tip at 253,873) and about 17 px from its edge in b17 (503,870). The satellites (c1 x 420-470 y 330-385; b01 x 60-112 y 560-605) and the near far isles are the same cupcake-on-cone shape.

**Why it matters:** The user's first complaint was 'a pillar standing in the clouds'. The tip kissing the ledge recreates the 'standing on it' read in the two most common aspect ratios. An upturned mountain needs an irregular, leaning silhouette with sub-peaks; a centred cone reads as a manufactured top. The web panel is a visible modelling error at game view.

**Critic's fix:** In buildMassif (sky-children-isles.js):
(1) Bend the spine. Offset each root ring by spine(s) = A·s^1.6 toward a silhouette bearing (local −x, back-left), with A ≈ 0.3R. Compute section() relative to the spine, and move the hard-coded tip vertex push(0, p.root-4, 0) to spine(1). The root then leans and its deepest point is off-centre.
(2) Remove the web. In section(), replace the far-hit with its `if (disc <= 0) continue` cut-off by the disc's support function, d = cu + rho. The cut-off makes a radial step at the tangent bearings, which is the planar panel. The support function is smooth everywhere.
(3) Read the lobes from a table in isleShapes.spring instead of a count. Put them on the silhouette bearings (±x, where they shape the outline; front and back lobes are invisible): w 0.5-0.6, off 0.5, ends 0.7 and 0.5. End the main lobe at about 0.75, and set kSmooth 0.15R → 0.09R so the saddles read as notches. Add 2 buildPinnacles at the lobe ends, but not on the Mother Fall's bearing.
(4) Clear the parapet. PLAN.spring.root -245 → about -220 lifts the tip about 60 px. Or add a frame-solver check that the tip's screen y stays at least 30 px above the parapet top.
(5) buildSatellites: make 3 of the 5 bare, tilted debris rocks (no turf dome, tilt 0.4-0.7 rad so the beds slant).

**Files:** src/themes/sky-children/sky-children-isles.js (buildMassif, isleShapes, buildPinnacles, buildSatellites, createIsles casters); src/themes/sky-children/sky-children-plan.js (PLAN.spring.root)

**Cost:** 0 draws; 0 tris for the body (same rings × radial); pinnacles about +500 tris at High. CPU build is negligible. Update the casters' capsule end (a/b) for the new tip, and re-run the composition tests (bow cut, spray skirt).

**Skeptic: CONFIRMED.** I could not refute it. All three parts show in the frames, and the code confirms them.

(1) Symmetric cone. c1 and b01 x 120-380 y 440-875 show a centred inverted cone. The b03-b06 strip shows the same at every hour, and b17 x 350-690 too. In buildMassif the main lobe sits on the axis (w 0.8, end 1) and the tip is pushed at (0, root-4, 0). Rebuilding the Spring at High (112×72) gives a ring centroid at most 2.6 m off the axis on a ~50 m radius. The three random side lobes (phi 80°, 205°, 303°, off 0.63-0.72) detach from the axis as soon as |c| > rho. After that they only show as wedges. The design record promises 'fused lobes with saddles', and the geometry does not deliver it. The BEFORE root (a01) was worse overall, but its outline was more broken; the AFTER outline is a manufactured top.

(2) Web panel. This is a real modelling error, not taste. Dumping r(θ) per root ring shows radial jumps between adjacent columns:
- Ring 7 (y -192): one column at 50 m between neighbours at 10 m.
- Ring 10: 51/50/48 m next to 15 m.
- Ring 14: a 4-column wedge at 35-38 m next to 19-20 m, at θ≈200-210° (back-left).

Each jump is a flat radial wall. It is exactly the 'if (disc <= 0) continue' cut-off. The first audit's skeptic predicted this web ('swap to a separate pinnacle once |c_k| > rho_k'). The swap was never built, and the pinnacles were dropped. It is visible at game view as a flat tan facet with straight edges, at b01 x 182-220 y 667-750 and b17 x 375-450 y 670-760.

(3) Tangency. A 4× crop of b01 puts the tip at about (253, 875) and the top edge of the left overlook's travertine ledge (buildLedge) at about 876. They touch. The critic's 6 px is close to my 1-3 px. b17 shows the same within a few px, and so do all four hours (b03-b06). The design target was a tip ending above the corner, with air under it. This recreates the 'standing on it' read.

The proposed fix is wrong in three places:
- (a) The support function d = cu + rho is the support of the lobes' convex hull. That fills the saddles that point (3) wants, so it works against it. I simulated section(): it cuts the column jumps from 36.5 m to 5.3 m, but the jumps between rings stay at 37 m. Each lobe still ends at s = end as a flat floor about |c| ≈ 0.5R across, because a point's pedal curve is a circle.
- (b) 'End the main lobe at about 0.75' leaves rings from s 0.75 to 0.985 with no lobe. Their radius clamps to Math.max(0.4, …), which makes a hairline needle about 55 m long.
- (c) buildPinnacles as written goes through ensureAttrs, which sets aBed tone −1. The pendants would be smooth unbedded cones, the 'insect legs' that isles-7 rejected.

Also, a lean toward −x moves the tip about 40-50 px toward the newel post at 16:9, so the clearance check has to use the whole parapet outline, not only the ledge edge.

The lean (1) and the lift (4) are sound. I simulated a clamped, polynomial-smooth-max version with a lobe table and a 0.25R lean. It has no jumps (column steps ≤ 1.4 m, ring steps ≤ 1.2 m). Its left outline bulges to 54 m, has a concave saddle (48 → 38 m between s 0.34 and 0.39), and its deepest point sits 17 m off-axis.

**Amended fix (use this):** All in src/themes/sky-children/sky-children-isles.js unless noted. No new draws, no shader change, and the body triangles stay the same (rings × radial).

1. Remove the web without the support function (buildMassif → section).
   - Keep the far-hit, but keep every lobe star-shaped about the spine. Scale the lobe centre so that |c| ≤ 0.9·rho: `if (cl > 0.9*rho) { cx *= 0.9*rho/cl; cz *= 0.9*rho/cl; }`. Then disc = rho² − |c|² + cu² is never negative, and the far-hit is defined at every bearing. The union of discs that each contain the spine is exactly star-shaped, so the concave saddles between lobes survive. As rho → 0 at a lobe's end, its centre retracts onto the spine, so the lobe leaves no floor.
   - Replace the log-sum-exp with a polynomial smooth max folded over the lobes: `smax(a, b, k) = max(a, b) + h²k/4`, with `h = max(k − |a − b|, 0)/k` and k = 0.09R. A lobe far below the max then adds nothing (no LSE inflation, no jump at `s >= L.end`).
   - Simulated on the Spring's seed: the largest jump between adjacent columns drops from 36.5 m to 0.9 m, and between rings from 36.7 m to 0.5 m.
   - This also fixes the satellites and the far archipelago, which use buildMassif.

2. Lean the spine (buildMassif root ring loop).
   - Use spine(s) = A·s^1.6·(cos β, sin β), with A = p.lean?.[0] ?? 0.25 (times R) and β = p.lean?.[1] ?? π + 0.3 (back-left, away from the Mother Fall at body θ ≈ 0.95).
   - Evaluate section() and the noise relative to the spine, and push each vertex at spine + u·r.
   - Push the tip vertex at (spine(1).x, p.root − 4, spine(1).z), not at (0, root − 4, 0).
   - The rim and crown rings are untouched, since the offset is 0 at s = 0.
   - Give the satellites and FAR_SHAPES their own seeded lean, so they stop being one cupcake-on-cone.

3. Give the lobes silhouette weight (isleShapes.spring).
   - Replace `lobes: 3` with a table, and have buildMassif read p.lobes when it is an array; keep the random count for numbers.
   - The main lobe must still reach the tip (end 1, never 0.75). Narrow it below the shoulder: w 0.8, shoulder 1.0, power 2.0, so it stays near the rim width under the rim.
   - Left (on the silhouette): phi π + 0.15, off 0.55, w 0.62, end 0.55, shoulder 2.
   - Right: phi −0.2, off 0.5, w 0.5, end 0.42, shoulder 2. This is ≥ 0.6 rad off the fall's bearing.
   - Back: phi −π/2 − 0.3, off 0.5, w 0.55, end 0.5.
   - Simulated with the lean: a left bulge to 54 m, a concave saddle at s ≈ 0.35-0.4, and an off-centre tip 17 m left. Iterate in the playground and keep the rim's set-back cap band; the root under the rim must not undercut it into a mushroom.
   - Optional, for true downward sub-peaks: 2 pendants from buildPinnacles under the left and back lobes. Make them near-vertical (lean ≤ 0.05), radius 0.3-0.4 of the local section, 25-35 % of the depth, with the joint buried ≥ 0.15 local radius. They must carry per-vertex aBed from the same cliffBeds/bedAt at their depths (and aMoss 0). Otherwise ensureAttrs makes them unbedded smooth cones, the old 'insect legs'. About +300 triangles at High.

4. Clear the parapet (src/themes/sky-children/sky-children-plan.js).
   - Set PLAN.spring.root from −245 to −220. That lifts the tip about 25 m, roughly 55-60 px at 16:9 and 21:9.
   - Pin it with a world test in tests/unit/sky-children-world.test.js: for 16:9, 16:10, 21:9 and 4:3, project the placed spring mesh's lowest vertices (as bowHides does) and assert ≥ 30 px from the cornerL hull, the whole parapet (the newel post as well as the ledge edge). The lean moves the tip toward the post.
   - Add an isles test: the largest radius jump between adjacent columns and between adjacent rings on the Spring root at High is < 3 m.

5. Casters (createIsles.place). Move the lower end of setCaster 0 and 5 to the spine offset at that depth: extend setCaster with a local x/z for the b end, using entryToWorld(e, spine.x, yb, spine.z). The bow-stroke cut needs no change, because bowHides builds the hull from the placed mesh's own vertices.

Cost: 0 draws, 0 triangles for the body, optional pendants about +300 triangles at High (now ~121k of 140k), negligible CPU. Re-capture b01, b17 and c1, and re-run the composition and world tests (bow cut, spray skirt, Mother Fall lip on the bow's leg).

### `isles-3-crown-lid` [major] The crown sits on the cliff like a lid: a uniform turf overhang over an unbroken dark slot all round, with a smooth cushion edge

**Evidence:** b01: a continuous dark blue-grey band right under the green all the way round (x 120-450 y 450-475). b07: the same band under a rounded, pillowy rim (x 290-885 y 410-470). c1 x 455-855 y 200-240. Twin, c2: x 550-1080 y 500-560. Present in every hour (b03-b06). Code: buildMassif's rim rings use constant fractions (cap rock 0.93R, lip 1.03R) modulated only by outlineScale and a 2% wobble. The three ravines cut the root rings but not the rim or crown rings, so the turf lip rolls smoothly over them and the outline has no bays.

**Why it matters:** The isle reads as three stacked parts (green cap, dark gap, rock drum): the toy 'tart on a rock'. Painted floating islands get their mass from cliffs rising to the turf, from bites in the edge and from varying overhang. This band is the strongest single cue that the crown is a separate object.

**Critic's fix:** In buildMassif's rim block and rawCrownHeight (sky-children-isles.js):
(a) Vary the overhang. Seed overhang(θ) as a 5-term cosine series in 0..1. Cap rock q = mix(1.0, 0.92, ov) and turf lip q = mix(1.0, 1.035, ov). Over about 40% of the perimeter the cliff rises flush to the turf, topped by the existing bright capLine; elsewhere the turf rolls over.
(b) Bites. Add a shared biteAt(θ) = Π(1 − 0.12·exp(−((θ−θj)/0.1)²)) at the ravines' bearings. Apply it to k in the rim rings, the crown rings and rawCrownHeight (as spurWeight is), so 2-3 bays notch the outline. Keep them off the gateway pad, the cascade footprint and the Twin's promontory; the grounding tests will catch any violation.
(c) In createStoneMaterial, scale lipShade by the same overhang (evaluate the cosine series from atan(lp.x, lp.z), a uniform array of 5 coefficients). Where the turf overhangs, paint a 1.5-2.5 m band of dark earth, about (0.12, 0.08, 0.05), with root hairs under it.
(d) Flatten the dome's last 10%: domeAt exponent 2.2 → about 3.5. The rim is then a crisp turf edge, not a rounded cushion.

**Files:** src/themes/sky-children/sky-children-isles.js (buildMassif rim/crown rings, rawCrownHeight, domeAt, createStoneMaterial lipShade)

**Cost:** 0 draws, 0 tris (same rings). About +0.4 KB fragment WGSL. crownHeight must carry the bites so isleAnchors, the groves, the outcrops and the cascade stay grounded; the existing tests cover this.

**Skeptic: CONFIRMED.** I tried to refute this and couldn't. The problem is real, but the proposed fix has three gaps and one part that would make the problem worse.

**What the frames show** (my crops are in scratchpad/critique/lidref/)
- b02, at game scale: under the green there is a thin dark blue-grey line, then a pale line, then a darker band about 15 px tall. At x=160 the pixels go (105,122,75) green, then (56,75,91), (72,87,97), (56,71,85) down to y≈478, and only then the rock. It runs unbroken from x≈120 to the fall.
- b07, c1 and the Twin in c2: the crown's last few metres roll down into this slot like a pillow, so the isle reads as a green cap on a rock drum.
- b03 to b06: the band is there at every hour.
- The BEFORE frames had a cream pie crust in the same place. AFTER is better, and the critic did not misread it.

**What the code and a node measurement show** (buildMassif at 96×64)
- The overhang is the same all round. On the Spring, the cap rock sits at about 0.93Rk (y=-6), the turf underside at about 1.0Rk (y=-3.5) and the lip at about 1.03Rk (y≈-1.2). The lip overhangs the cap rock by 6.5–9 m at every bearing, over a downward-facing shelf about 7.6 m deep. The Twin is the same.
- The ravines do not reach the outline. They cut only the root rings: at θ≈2.09 the root's top ring is 52 m against a 61.6 m cap. The rim and crown keep rolling over the gap.
- The dark band is painted, not cast. lipShade cuts the key light by 62% from 1.5 m to 5–13 m below the lip, whatever the geometry is. Changing the geometry alone would leave the uniform band in place.
- The "cushion" is domeAt. Its outer power of 0.6 has a vertical tangent at the rim. The Spring's crown rises 5.2 m over the last 4 m inside the lip and 9 m within 9 m: a 40–55° rounded shoulder. The Twin's is steeper.

**Where the proposed fix goes wrong**
- **(a) is incomplete.** The root's top rings sit at roughly the current cap radius (median root/cap ratio 0.99). If the cap rock moves out to 1.0R where the cliff should be flush, a 5–8 m rock shelf facing down appears one ring lower. The slot moves down instead of going away, so the top root rings have to come out too.
- **(b) needs shared bearings.** rawCrownHeight has no outletTh, so it cannot reproduce buildMassif's random ravine bearings. buildStrands also hangs every strand from the unbitten R·k, so strands would hang in air at each bay, and no test covers strands.
- **(c) has an angle trap.** The existing `wet` code uses atan(lp.x, lp.z), which is π/2−θ. The cosine series is in body θ and must use atan(lp.z, lp.x).
- **(d) is backwards.** Raising the inner exponent from 2.2 to 3.5 keeps the vertical tangent and raises the rim zone: +1.6 m at q=0.96 and +2.5 m at q=0.9. That makes the shoulder taller and more pillow-like, and steepens the front under the lowest dams. bodyProfile's dome branch, which buildTerraces reads, is domeAt's inverse with the exponents hard-coded, so it would also go out of step.

**Amended fix (use this):** All changes are in src/themes/sky-children/sky-children-isles.js.

1. **Put the rim design on the shape (isleShapes), not in buildMassif's random draws.**
   - Each isle gets `rim: { ov: [[a,φ]×4] }`, a 4-term cosine series normalised to 0..1 that is flush (≈0) over about 35–40% of the perimeter.
   - Each isle gets `bays: [[θ, depth 0.10–0.13, width 0.09–0.12]]`: 2 on the Spring, 2 on the Twin, all in body θ = atan2(z, x).
   - Author the bays on the edges the camera sees in silhouette. Keep them at least 0.6 rad from the notch/outlet, out of the terrace fan and the gateway pad's bearing (about ±3.42 rad), and off the Twin's spur (π ± 0.6) and aqueduct.
   - Export `rimOverhang(p, th)` and `bayCut(p, th) = Π(1 − d·exp(−(Δθ/w)²))`.
   - buildMassif takes its ravine bearings from p.bays when they are present, and keeps the seeded ones for far isles.

2. **buildMassif.**
   - Rim rings: cap q = mix(1.0, 0.93, ov), underside q = 1.0, lip q = mix(1.0, 1.03, ov). Multiply all three, and k in every crown ring, by bayCut(θ).
   - Root rings: on the top ~3 rings (s < 0.04, about lip−8 to lip−15 m), blend r toward max(r, capR(θ)) by (1 − ov)·(1 − smooth(0, 0.04, s)). Apply the ravine cut after this, so the cliff rises flush into the turf in flush sectors and the ravines still notch it.
   - Make the turf lip crisp by splitting its normals: emit the lip ring twice, once closing the rim rows and once opening the crown rows, with a zero-height row between them. The lit meadow then breaks to the shaded turf face on one line. This adds 2·cols degenerate triangles and nothing visible.

3. **rawCrownHeight.** Use k *= bayCut(θ) so that `on` and the heights follow the bays. crownHeight and everything standing on it (anchors, groves, outcrops, terraces) then stay grounded.

4. **buildStrands.** Root each strand at R·k·mix(1.0, 1.03, ov)·bayCut(θ). Skip strands where ov < 0.3, since nothing overhangs there. Add a test that each strand's root lies within 1 m of the lip ring.

5. **createStoneMaterial.**
   - New option `rim` (the shape's series). Compile the coefficients into TSL constants.
   - Compute thB = atan(lp.z, lp.x). Do not copy the wet code's atan(lp.x, lp.z), which gives π/2 − θ.
   - Change the lipShade strength from 0.62 to mix(0.15, 0.62, ov).
   - Where ov > 0.3, paint a 1.5–2.5 m dark earth band, about (0.12, 0.08, 0.05), on the turf's underside: ironK, with below in [−2.5, 0.3].
   - The far and corner materials keep ov = 1, which is current behaviour.

6. **Dome shoulder.**
   - Do not raise the 2.2 exponent.
   - If the shoulder still reads as a cushion after steps 2 and 5, ease the last 20% instead: f^mix(0.6, 0.9, smooth(0.8, 1.0, q)). That lowers q=0.9 by about 3 m and meets the lip at a finite slope.
   - Change bodyProfile's dome inverse in lockstep, or replace it with a bisection of domeAt, because buildTerraces reads radii from it. Re-run the terrace and pool-slot tests.

7. **Verify.**
   - Tests: the grounding tests (works, terraces, groves, outcrops, outlets on the rim), plus the new strand test.
   - Captures: b02 and b07, and one Twin close-up.

**Cost:** 0 draws. About +190 degenerate triangles on the Spring at High and about +100 on the Twin. About +0.4 KB of fragment WGSL (an atan and 4 cosines). Negligible CPU.

### `isles-4-crown-empty` [major] The crown's front half is an empty olive lawn: every tree on the back crest, dice-shaped outcrops, a path that goes nowhere

**Evidence:** b07: from the gateway to the front rim the meadow is one smooth olive gradient (x 270-620 y 300-450). In b01 the front of the crown is bare (x 110-330 y 380-470). groveSpots places groves at angles π·(1.0..2.25), the back half only: 1 of 17 Spring trees and 0 of 6 Twin trees stand on the half facing the eye. The outcrops are 20-tri flattened icosahedra that read as dice or hay bales (b07 x 457-532 y 317-342). The path is a straight tan stripe that ends mid-meadow (b07 x 405-450 y 270-375).

**Why it matters:** The front slope is the largest crown area on screen, and nothing there gives scale or interest, so the crown reads as a green pillow. The trees, the best new asset, all sit in one skyline row. Nothing ties the gateway, the path and the water into a scene a viewer could walk.

**Critic's fix:** (a) groveSpots (sky-children-isles.js): add a front group of 3-5 shrubs (kind 2) and 1-2 small pines along the cascade's banks, outside its footprint and beside every second or third dam. Add 2 rim-leaners on the front-left rim, body bearing about -0.3..-0.9, never over the Mother Fall. Water-side vegetation gives scale to the basins.
(b) buildOutcrops: use icosphere(1) with y quantised into 2-3 bedding steps (stepped limestone), in clusters of 3-5 along the knoll shoulders and the rim shoulder, lime-toned.
(c) springPath: carry the path from the gateway down past the spring head to a small overlook on the front-left rim, curving along the contour, so it leads the eye from the bell to the water.
(d) createStoneMaterial crown: on convex shoulders (N.y < 0.85 within about 6 m of the lip) let crownRock show through the turf in patches (it already exists and is only gated by N.y).

**Files:** src/themes/sky-children/sky-children-isles.js (groveSpots, isleGroves, buildOutcrops, springPath, createStoneMaterial)

**Cost:** About +1.5-2k tris at High (shrubs about 80 tris each, pines about 400) and +600 tris for outcrops; High goes from about 121k to about 124k of the 140k budget. Fewer on Minimal/Low through groveTrees. 0 draws, negligible shader cost.

**Skeptic: CONFIRMED.** I could not refute this. The frames and the code both support it, and I took no captures because they weren't needed.

**What the frames show**
- b07 crop, 2x (critique/r4/b07-crown.png): from the gateway to the front rim the meadow is one smooth olive slope. Every tree stands on the back crest as a single skyline row.
- The two front outcrops (b07 x 457-532 y 317-342) are flat-topped faceted blocks. Up close they read as mossy hay bales.
- The worn path stops about 60 px short of the rim (b07 x 405-450, ending at y ~375; the rim is at y ~440).
- The same bare front-left lawn is visible at game view (b02 and b01, x 110-330 y 380-470). It is the largest flat area of the crown on screen, with nothing in it to give scale.
- The BEFORE frame a07 had no trees in front either, so this is a gap that remains, not a regression.

**What the code confirms**
- I ran isleGroves at High: 1 of 17 Spring trees has z > 0, and only barely (0.02R). 0 of 6 Twin trees, and 0 of 8 Spring trees at Minimal.
- groveSpots puts grove centres at angles π·(1.0..2.25), which is the back half. Its two "leaners" sit at π·1.25 and π·1.65, also on the back rim.
- buildOutcrops builds IcosahedronGeometry(1, 0), 20 triangles, with y clamped to 0.42, so every outcrop has a flat top.
- springPath does reach the front-left rim at (-0.46R, 0.86R). The worn mask then fades it out: it is multiplied by smoothstep(0.55, 0.8, N.y), and N.y is the world normal. On the dome's convex front shoulder, with the isle's 0.3 rad pitch, that normal is 0.72 at z = 0.63R and 0.50 at 0.74R. The last ~20 m of the path therefore disappear, and its rim end lies off the crown (on = false).
- The meadow's dry/lush drift noise samples lp.xz·0.0055, a wavelength of about 180 m. The crown is only 144 m across, so the drifts become one gradient. That is why the lawn reads as a smooth pillow.

**Where the critic is wrong**
- (d) has the wrong mechanism. Crown vertices carry aMoss = 1, and the shader mixes with max(mossK, N.y term). Rock can never show through, whatever N.y is.
- "1-2 small pines along the cascade's banks" would hide gameplay pools. I checked the angles: an eye ray grazes the crown at about 10°. A 12 m pine at (-0.25R, 0.45R) has its top at about 9.1° elevation, which is above the pool head at (-0.19R, 0R), at about 8.7°. A 3 m shrub at the same spot reaches about 8.0°, which is safe.
- Trees on the front rim at bearings -0.45..-0.65 stand in the gateway's column. They only overlap the gateway itself above about 28 m, but they need an explicit sight test.
- The Twin's front is its cascade, which holds 11 or more jewel slots, and it sits 820 m away. Leave it as it is.
- Budget: High is now 98.6k of 140k, not 121k.

**Amended fix (use this):** All changes are in src/themes/sky-children/sky-children-isles.js unless noted.

**0. Sight guard (do this first)**
- Add eyeLocal(plan): the desktop eye in the Spring Isle's local frame. It is the inverse of the yaw and the 0.3 rad pitch, roughly (29, 83, 466), and it matches gatewaySight's (0.063, 0.994).
- Add sightClear(spot, targets). It treats each tree as a capsule: from its foot to foot + its height (cypress size·4.4, pine size·3, shrub size·0.9), with radius equal to its canopy (size·0.6). It rejects the tree if the capsule cuts the segment from eyeLocal to any target.
- Targets: every pool centre in cascades.spring.pools, three points on the gateway (its opening, the bell, the top of the keystone) and the spillway outlet.
- Apply sightClear to every new spot below. Add a unit test that ray-casts from eyeLocal to each target through buildGrove(spring) and the outcrops, and expects no hit, on every tier.

**1. Front planting (groveSpots, new pass)**
- Size: a separate front quota of round(groveTrees·0.3), so +2 at Minimal and +5 at High. Do not take it from the back groves.
- (a) Shrubs (kind 2, size 2.5-4): 3-4 in a loose drift down the cascade's LEFT bank, between z 0.15R and 0.55R. Keep them 2-4 m outside the footprint and beside every second or third dam, so they sit lateral to the pools, never in front of them.
- (b) Taller trees: 1-2 pines and 1 cypress in a tight clump on the front-left flank, x < -0.62R, z 0.1R to 0.6R, inside the rim. This keeps them outside the gateway's column (|x - arch.x| > arch.width/2 + canopy + 2).
- (c) One leaner on the front-left rim, bearing about -0.9..-1.1 (x ≈ -0.75R, z ≈ 0.4R). Its trunk is forced to lean outward (not the random lean), and its foot sits about 0.6 m deeper.
- Never place trees on the right half: that is the cascade and the Mother Fall's notch, which the bow's strokes cut round.

**2. Path**
- Gate the worn mask by the local normal, not the world one. Either use transformNormalToView-free normalLocal, or pass N.y from the pitch-free local normal as a vertex attribute. Lower the thresholds to smoothstep(0.35, 0.6, ·).
- Re-route the first segment so it no longer runs straight down the steep shoulder. It should curve along the contour from the gateway's door to an overlook at about (-0.6R, 0.5R), where the turf is still on, with local N.y about 0.86.
- End it there at a small paved landing: 2-3 masonry slabs and one low post or cairn, about 100 triangles. Merge it into the stone geometry with MAT masonry, whose coursing shader already exists, and ground it with crownHeight like the other works.
- Add the landing to the outcrops' avoid circles and to the groves' avoid circles.

**3. Meadow drifts (createStoneMaterial)**
- Raise the drift frequency from 0.0055 to about 0.022 per metre (patches of about 45 m), so the crown gets 3-4 dry and lush drifts.
- Keep the convex-dry term. This adds no triangles and no shader cost.

**4. Outcrops (buildOutcrops)**
- Use icosphere(1) with y quantised into 2-3 bedding steps: floor(y·k)/k, blended about 70% toward the raw y, then the same flattening.
- Lime-toned, and placed in clusters of 2-4 along the knoll shoulders and the left shoulder, subject to sightClear.
- Update the outcrop test's hard-coded PER = 60 (the vertices per rock) to read the count from the geometry.

**5. Rock through the turf (buildMassif, crown rings)**
- Set moss to 1 - 0.6·smooth(convexity)·smooth(0.55, 0.75, patchNoise) on vertices within about 6 m of the lip on the left and front shoulders. Keep it at 1 inside the cascade corridor and on the path and landing.
- Do NOT change the N.y gate in the shader: mossK already dominates it.

**Cost at High:** about +1.6k triangles of trees (shrubs 80 each, pines about 330, cypress about 570), +600 for the outcrops and +100 for the landing. High goes from about 98.6k to about 101k of 140k, and Minimal stays well under 60k. 0 extra draws and negligible shader cost.

**Verify** with b07 and b02 recaptures: the gateway, the bell and every pool must remain unobstructed.

### `isles-5-cliff-quilt` [minor] The cliff skin is a quilt: a regular 1.5 m cell net over every bed, and bed boundaries stair-stepped along the triangles

**Evidence:** b07 (cliff): a regular bright crackle net like reptile skin or chain-link over the pale beds (x 355-690 y 635-730). Bed edges zigzag along the triangles (x 428-467 y 640-651; x 483-533 y 718-735). The top bed shows vertical plank-like facets (x 300-555 y 462-623). b18 x 330-560 y 0-380. In the lower root the light and dark patches form a chequer at game view (b01 x 150-330 y 580-800; b17 x 380-560 y 600-800). Cause in createStoneMaterial: `rims` and `cups` read s2 (the stone texture's Worley channels at 0.093/m, cells about 1.5 m). Bed tone and frac come from the per-vertex aBed, which interpolates across rings 3-6 m apart; this is the skeptic's amended isles-3(b), not adopted.

**Why it matters:** The bedded cliff is the largest stone area in every frame. A regular procedural net and triangle-shaped bed edges are the giveaways that make it look generated and plastic next to himalayan-peak's eroded massif.

**Critic's fix:** In createStoneMaterial (sky-children-isles.js):
(1) Drop `rims` on the iron/lime cliff. Keep `cups` only on lime beds' undercut feet, at the s1 scale (0.028/m), weight 0.15.
(2) Compute the bed in the fragment. Bake a 256×2 RGBA8 bed LUT (Spring row and Twin row: tone, frac, hard) from cliffBeds in sky-children-core.js, beside bakeStoneNoise, into tex.beds. Sample it at (lipY − lp.y + warp)/depth, with warp = 6·(noise at the bearing − 0.5) + 0.123·lp.x, mirroring bedAt. Bed lines and cap lines become pixel-crisp on every tier. aBed then only needs its x component as the on-cliff flag.
(3) Add sparse vertical joints: 1-px dark lines where a stone.a read at about 0.05/m across falls under 0.04, faded by fwidth as the ashlar joints already are.

**Files:** src/themes/sky-children/sky-children-isles.js (createStoneMaterial, buildMassif aBed, cliffBeds); src/themes/sky-children/sky-children-core.js (new bed LUT bake beside bakeStoneNoise)

**Cost:** +1 texture read, minus the s2 net work; about +0.5 KB fragment WGSL; bake under 1 ms; 0 tris, 0 draws. Can shrink aBed from vec2 to float.

**Skeptic:** not verified (minor finding).

### `isles-6-twin-bare` [minor] The Twin Isle is a putting green on a cone, its aqueduct a face-on cardboard cutout

**Evidence:** c2 (Twin close, fov 13): a smooth kidney of lawn with one cypress and one pine visible (x 860-900 y 270-385; x 640-690 y 340-420), the same slat cascade (x 800-980 y 400-495), and the lid band (x 550-1080 y 500-560). The aqueduct is seen exactly face-on, with no pier sides or arch soffits catching the key (x 500-760 y 345-500; b01 x 1320-1405 y 575-605). It runs along the promontory at local −x, perpendicular to the line of sight, because the isle is yawed to face the eye. isleGroves gives the Twin max(4, 0.35×) trees in two back-half groves, all behind the crown's crest or the aqueduct wall.

**Why it matters:** The Twin is the right-hand counterweight to the Spring Isle and the only near isle on the HUD side. As a flat green disc with a flat cutout it reads as a lesser copy, not a place of its own, and the user named it explicitly.

**Critic's fix:** (a) Turn the aqueduct off the face-on axis. Swing TWIN_BUILD.spur from π to about π − 0.4, and run the aqueduct along it in isleAnchors (sky-children-isles.js), so it runs diagonally toward the eye and its pier reveals and soffits take the key. Then re-verify spanLip's screen position in the frame solver and composition tests.
(b) Twin grove: at least 6 trees, including a front group of 2-3 shrubs and a small pine at the promontory's root and the front rim (same groveSpots change as isles-4).
(c) The Twin takes the isles-1 apron and elliptical pools and the isles-3 rim variation through the shared builders; give it its own seed so the outline bites differ from the Spring's.

**Files:** src/themes/sky-children/sky-children-isles.js (TWIN_BUILD, isleAnchors, isleGroves, groveSpots)

**Cost:** 0 draws; about +0.5k tris for trees; 0 shader cost. Composition re-check for the span's fall.

**Skeptic:** not verified (minor finding).

## falls: 4 → 6

**What improved (the critic):** Real gains, all visible in the frames:
(1) The Mother curtain now hangs in the world and has form. The near flank turns a cool blue-grey against a lit face (critique/falls-b12-edge.png, left third). Rope tubes with darker gaps replace the noise pinstripes. The billboard "cowl" degeneracy is gone.
(2) The life now plays out on screen in every layout: sheet, then streamers, then mist inside the frame. On the phone the Mother finally reads in the left margin (b16 x0-70, y440-800, against a16's 20 px sliver). Ultrawide works too (b17).
(3) The design's signature image exists. The bow's leg is brighter and more saturated inside the spray than outside it (b02 x380-420, y690-900; b13; critique/falls-tower.png).
(4) Night spray is a luminous moonlit glow, not grey smoke (b05 x370-560).
(5) The Twin's horsetails sway, fan and keep a minimum pixel width, so they no longer read as guy-wires (b09 x790-925). Far hairlines now read (b08 x1195-1200, y220-290).
(6) Colour packets are dye in water, not an awning. At eventAge 5 the great pour runs four clean stripes (violet, cyan, red, violet) with the jets showing white through them (critique/falls-quad5-crop.png, against a13's flat flag bands). At eventAge 3 (b13) they are still bunched at the head.
(7) About 20k triangles were reclaimed: FALL_SLOTS went from 24 to 10, with per-slot meshes.

What holds the theme back now is mostly the spray. The overall score is 6/10, not higher, because problems 1-2 sit on the hero element in every landscape frame. Captures: critique/falls-tower.png (a three-line clear at 1.6 s), critique/falls-tower-vs-b03.png (side by side with rest) and critique/falls-quad5.png (the great pour at 5 s). One earlier attempt rendered "booting…" only.

### `falls-plume-swallows-the-fall` [major] The Mother's plume is an opaque, flat cumulus heap: it cuts the hero vertical in half, out-shines the curtain, and leaves the event beats no headroom

**Evidence:** b02/b06/b12 x345-560, y690-900; b08 x550-1000, y280-900 (critique/falls-b08-plume.png); b13 and b17 the same. The white water shows for only about 200 of the about 420 px of drop (lip y480, streamers end y680), where a02 ran the full height. Luminance measured in b02: curtain mean 205 (sd 28), plume mean 219 (sd 10). In b12: 210/28 against 224/12.5. So the plume is brighter than the curtain, about 3x its area and nearly textureless. At Gilded it is one peach mass, (234,196,159) to (238,209,175) across 450 px. The three-line tower (critique/falls-tower-vs-b03.png) only lifts the plume's top about 100 px and reads as the same cloud slightly taller. The great pour's dye stops dead at the plume's top (critique/falls-quad5-crop.png).

**Why it matters:** The Mother Fall was the frame's strongest vertical, the counterweight to the card. It now reads as a short spout over a cloud. The plume shares its shape language with the cumulus tower right behind it (b02 x370-620, y230-520), so the water's own spray reads as more weather. It has none of the lit-and-shaded volume of nimbus-veil's towers (r-nimbus x1180-1470). Because the rest state already fills the frame bottom, the three-line tower and the 12-row burst have nowhere to go, and the colour story ends in white.

**Critic's fix:** (a) In sky-children-world.js, SPRAY.mother plume: h [0.5,1.05] -> [0.72,1.15], size [7,17] -> [5,12], out 1.0 -> 0.55, drift 3.0 -> 1.2, rise 2.6 -> 1.4. The rest plume becomes a low boil seated under the curtain at the frame cut, and the streamers stay visible to about 80% of the visible drop. The spray (renderOrder 58) composites over the falls (55), so today the plume paints over the streamers.
(b) In sky-children-fx.js createSpray, lower the plume's alpha cap from 0.7 to 0.42. Raise it to about 0.62 only for puffs the burst throws: in sprayPuffs set role = SPRAY_ROLE.plume + 0.3 for thrown puffs, and branch on smoothstep(2.1,2.3,role) inside the plume mix. The foot role (3) stays above the 2.4 threshold. The tower then reads as an event.
(c) Give it form. diff = clamp(dot(N,U.key)*0.45+0.6) saturates at 1 for nearly every camera-facing normal. Change it to dot*0.75+0.25, weight puffN at 1.3 for billows so each billow's rim turns 30-40% toward the luminous shade, and cut keyW from 0.56 to about 0.48. Target in b02: plume mean at or below 0.9x the curtain mean, plume sd at or above 20.
(d) Optional: tint plume puffs whose source time matches a live Mother packet (CPU in sprayPuffs, stride 12 -> 16 floats: rgb, dye) so the great pour boils out coloured. Re-check b02, b08, the three-line tower and the quad at eventAge 5.

**Files:** src/themes/sky-children/sky-children-world.js (SPRAY.mother, sprayPuffs), src/themes/sky-children/sky-children-fx.js (createSpray outputNode)

**Cost:** (a) CPU constants only. 0 triangles, 0 draws, all tiers. (b, c) About +4 ALU in the spray fragment, under 0.2 KB of WGSL. Fill drops with the smaller, thinner rest plume. (d) Instance stride 12 -> 16 floats and a per-frame list of the Mother's live bands (at most 48), about 10 CPU ops per puff, about +0.2 KB of WGSL.

**Skeptic: CONFIRMED.** I couldn't refute it. The defect is visible and measurable, and the code explains it. Parts of the critic's evidence and fix are wrong, though, and they are corrected in amendedFix.

What I checked:

1. **The plume hides streamers the falls package built.** I ran a CPU probe in a scratch mirror of the theme (High tier, 1600x900): lip at y 0.532, break at 0.700, mist at 0.901, frame cut at 0.999. The plume's top (5th percentile, radius included) is at y 0.767, i.e. about 690 px. My capture without the spray (critique/refute-plume-with-vs-without.png) shows the Mother's streamers running visibly to about y 760-830, then fine threads to the frame edge. The plume starts about 50% down the visible drop, so it covers the horsetail stretch between the break (h 0.38) and the mist (h 0.8) that MOTHER's schedule was tuned to show.

2. **The plume has no form.** Luminance sd in a 140x160 block of the plume is 5.9 in b02, 4.7 in b06, 3.3 in b13 and 7.2 in b03. Nimbus-veil's tower measures 9-22 per block and has a lit/shade split of 187/162. The cause is in createSpray: the billow floor `lit = max(lit*(1-under), mistLit*0.8*billows)` sits at or above the plume's own lit face. In linear luma, face vs floor is:
   - Jade: 0.77 vs 0.71
   - Rose: 0.35 vs 0.50
   - Pearl: 0.57 vs 0.67

   At Rose and Pearl every plume pixel is clamped to a flat mistLit*0.8. At Jade only 9% of headroom is left. On top of that, diff = dot*0.45+0.6 saturates near the bow's 42° cone, and the 0.7 alpha cap makes 3+ overlapping puffs about 97% opaque.

3. **It outweighs the curtain.** At Jade the critic's "brighter than the curtain" is partly misread: the curtain mean of about 200 includes dark rock between the streamers, and the water's p90 (233) is still above the plume (221). But in the quad frame (b13, Rose) the plume (188) is brighter than the dyed curtain's p90 (176), and the great pour's stripes end where the plume starts. It is the largest flat bright mass on the left in every board frame, and it rises toward the cumulus tower directly above it.

Where the critic's fix is unsound:
- **(c) would make the plume flatter.** Cutting keyW to 0.48 puts the Jade face (0.66) below the absolute floor (0.71), so everything clamps to the floor. The sd≥20 target can't be met while that floor stays. The keyW cut would also dim the lip and the veil, which use keyW.
- **(a) wastes a third of the plume.** I probed the critic's h [0.72, 1.15]: only 64% of plume puffs are on screen at all. The other 36% (from h above about 1.06) are spent below the frame.
- **(b)'s role 2.3 trick breaks two tests.** The tower test and the carry-on test filter puffs with `q.role === SPRAY_ROLE.plume`, so they would no longer see the thrown puffs.
- **The 0.9x-curtain-mean target is mis-specified.** That mean includes rock; the comparison should be against the curtain's water.

With my amended constants, all 15 existing spray, plume, tower and fall tests pass in the mirror. Mother/Twin spray area ratio goes 17.4 → 13.4 (the floor is 2.5). The plume top moves 0.767 → 0.847, and 97% of plume puffs land on screen.

Artefacts:
- critique/refute-plume-nospray.png
- critique/refute-plume-with-vs-without.png
- refute-plume-mirror/tests/unit/probe.test.js

**Amended fix (use this):** 1. **Seat the rest plume lower and smaller** (sky-children-world.js, SPRAY.mother, plume role). Change: h [0.5, 1.05] → [0.68, 1.05], size [7, 17] → [6, 14], out 1.0 → 0.75, drift 3.0 → 2.0, rise 2.6 → 1.5. Keep share 0.36 and density 1.3.
   - Don't raise h past about 1.05: the sqrt "low" bias sends any higher puffs below the frame.
   - Probed at 1600x900: the plume's top goes from y 0.767 to 0.847 (about 67% down the visible drop, just above the mist line at 0.901). 97% of its puffs stay on screen. Spray fill drops from 1.50 to 1.19 screens.
   - On the phone (430x932) the top goes to 0.869 and fit rises from 0.34 to 0.45.
   - All existing spray, plume, tower and fall tests pass.
   - Add a test: the plume's 5th-percentile top, radius included, sits at least 62% of the way from the lip's screen y to the frame cut.

2. **Give the billows form relative to their own light** (sky-children-fx.js, createSpray outputNode; lip and veil unchanged via `billows`). The absolute floor is the real cause of the flatness.
   - Normal: `N = normalize(towerN + puffN*mix(0.65, 1.3, billows))`.
   - Diffuse: `diff = clamp(dot(N,U.key)*mix(0.45,0.7,billows) + mix(0.6,0.3,billows), 0, 1)`.
   - Lit face: `face = max(keyW*0.74, light.mistLit*0.85)`. Rose's and Pearl's key is darker than their mist, so the face is lifted to the mist's light.
   - Shade: `shadeB = face*mix(vec3(0.6), skyN*0.6, 0.3)`, where `skyN = sky/max(luma(sky),1e-3)`. This gives a cool, luminous shade at 0.6 of the face.
   - Blend: `lit = mix(mix(shade,shadeB,billows), mix(max(key,shade),face,billows), diff.pow(1.3))`.
   - Floor: replace `light.mistLit.mul(0.8).mul(billows)` with `face.mul(0.55).mul(billows)`. Night stays a pale glow: the face is 0.22 and the floor 0.12, against a darker sea.
   - Leave keyW alone (the lip and veil use it).

3. **Lower the plume's alpha cap.** In `cap`, change 0.7 → 0.5 for the plume role; the foot stays at 0.35. This is in the 0.4-0.55 band the original falls-3 skeptic set, and lets the gaps between billows read.
   - Optional, for the tower: give thrown puffs a cap of about 0.62 by pushing them with `role + 0.3`, using `mix(mix(0.5, 0.62, smoothstep(2.1,2.3,role)), 0.35, smoothstep(2.4,2.6,role))`. Then change the test filters to `Math.round(q.role) === SPRAY_ROLE.plume`, or the tower and carry-on tests fail.

4. **Optional: let the great pour colour the plume, without changing the instance stride.** Add one uniform, U.plumeDye (vec4): the mean rgb of the Mother packets crossing the frame cut now, and their strength, computed on the CPU from the live bands. Mix it into the billows by `(1-height)*dye.w*0.5`. With step 1 the dyed streamers already show to about y 0.85.

**Verify in the playground (5 captures):**
- **b02:** plume block (x400-540, y760-880) p50 at or below the curtain water's p50 (about 206) and sd ≥ 14; streamers readable to about y 780.
- **b06 and b13:** plume sd ≥ 12 (today 3-5); in b13, the plume below the curtain's p90.
- **b05:** the plume stays at least 25 luminance above the sea next to it.
- **The three-line tower** (event=clear&lines=3&eventAge=1.6): it reads clearly taller than the rest plume.
- **b16:** the plume is still on screen.

**Cost:**
- Step 1: CPU constants only; 0 triangles, 0 draws, all tiers. Spray overdraw drops about 20%.
- Steps 2 and 3: about +6 ALU in the spray fragment, under 0.3 KB of WGSL.
- Step 4: one vec4 uniform, about 3 ALU, about 10 CPU ops per frame.

### `falls-veil-detached-chimney` [major] The edge veil stands as a separate steam column beside the curtain instead of spray torn off its edge

**Evidence:** b02/b06/b12 x440-500, y515-690; b15 x440-480, y520-680; b07 x830-900, y560-900; b08 x705-830, y5-300. In critique/falls-b08-sheet.png (2x), a strip of dark sky/stone about 15 px wide (crop x310-340) separates the curtain's right edge from the column. The column's top (b08 x705-775, y5-125) is a grey puff against the storm.

**Why it matters:** A second pale pillar rises next to the fall from just under the lip. It reads as steam from a vent or smoke from a chimney, a second object beside the water. It doubles the fall's silhouette and muddies the edge where the bow's leg meets the water.

**Critic's fix:** In sky-children-world.js, SPRAY.mother veil: across [0.6,1.0] -> [0.35,0.75], past [1.0,1.5] at 34% -> [0.75,1.0] at about 20%, size [8,15] -> [4,9], density 0.9 -> 0.7, rise 0.25 -> 0. Add ride 0.6 so the veil travels down with the water like the span's lip beads, and narrow h to [0.2,0.8]. The curtain's visible edge sits at about 0.6-0.75 of the half-width (falls.js edge = 1 - smoothstep(0.6,1,|ue|+noise), fingers tear inward by grow²·0.45), so today every veil puff lands outside the edge. Optionally, in createSpray's vertexNode, stretch quads with role near 1 by 1.6 along the projected fall direction so the veil streaks with the water instead of balling up.

**Files:** src/themes/sky-children/sky-children-world.js (SPRAY.mother veil), src/themes/sky-children/sky-children-fx.js (createSpray vertexNode, optional)

**Cost:** CPU constants: 0 triangles, 0 draws. The optional stretch is about +3 vertex ALU on spray quads.

**Skeptic: CONFIRMED.** The problem is real, but the proposed fix is wrong.

What I saw in the frames:
- b07 (critique/refute-veil-b07.png) has a soft grey ball at x825-895, y555-635. It sits beside the curtain against the dark rock, about 80 px under the lip. A pale column descends from it, parallel to the curtain, with a dimmer band between the torn fingers and the column.
- b08 shows the same thing (the grey puff against the storm at x705-775).
- b02, b06, b12 and b15 show the same ball at about x437-475, y515-560. It is smaller there, so the problem is "major" in the close-up stills and closer to moderate in the gameplay frames.

I measured this without a capture. I built the world headless (vitest, High, 1600x900 rest frame plus the b07 lens) and ran sprayPuffs, then projected the veil puffs against the curtain's visible edge (0.7 of the half-width; falls.js edge = 1 - smoothstep(0.6, 1, |ue|)):
- Veil coverage peaks about 20 px outside that edge in b02, and 35-50 px outside it in b07 (0.45-0.62, against 0.12-0.33 at the edge).
- The veil's top sits 38 px under the lip in b02 (y517) and 81 px under it in b07 (y552).
- So the critic's diagnosis is right: the veil's body sits outside the edge and its head sits just under the lip. The commit that set these numbers (c764012) meant the veil to "hug" the edge, so this is a defect, not a matter of taste.

Why the proposed fix fails: I applied it in a scratch copy and captured b07 (critique/refute-veil-fixA-b07.png; side by side in refute-veil-b07-abc.png).
- The veil disappears entirely.
- The bow's leg now ends at the horizon haze, about 250 px above the plume.
- The probe agrees: veil coverage is at most 0.15 everywhere, and 0 along the leg. Today the leg has 0.14-0.40 coverage at y611-731 in b07, and 0.36 at y579 in b02.
- The cause: size [4,9], density 0.7 and a 0.6 ride together delete the veil, and the veil is the leg's only visible medium beside the curtain below the horizon.
- My own first variant (ride 0.3, size [6,12], vertical stretch; fixB capture) also deleted the veil. Shrinking the puffs is the trap.

The amended fix below moves the veil inward and removes the head, but keeps the puff size and density.

**Amended fix (use this):** Move the veil inward and remove its head, keep its size and density, and give the bow's leg an invisible medium so it does not depend on a pale column.

1) sky-children-world.js, SPRAY.mother veil row:
- `h` [0.12,0.75] -> [0.25,0.8]
- `across` [0.6,1.0] -> [0.35,0.75]
- `past` [1.0,1.5] -> [0.75,1.2], same 34% share, plus a new field `pastDensity: 0.6`
- `rise` 0.25 -> 0
- Keep size [8,15], density 0.9, out 0.4, drift 0.6. Add no ride.

2) In sprayPuffs, just before `let { bow } = e;`, add:
`if (veil) density *= smoothstep01(low / 0.35) * (past ? (e.pastDensity ?? 1) : 1);`
Here `low` is h2 for the veil and smoothstep01 is the clamped cubic. The veil then grows out of the torn edge from about the curtain's break (h ≈ 0.35-0.4), with no ball under the lip.

What the headless probe measured for this variant (C2) in the b02 rest frame:
- Coverage is 0.40-0.55 at the visible edge, 0.45-0.63 at +10 px, 0.10-0.22 at +35 px and ≤0.03 at +50 px. So it peaks on the torn fingers and fades outward, with no gap and no outer peak.
- Its top moves from y517 to y619.
- In b07 it peaks at +10-20 px and its top moves from y552 to y726.

3) Keep the bow's leg continuous without a visible column. In placeSprayColumn (world.js ~697), change `fallPoint(fall, 0.45 * fall.duration, ...)` to about `0.25 * fall.duration`. U.sprayColumn only feeds the optics' rain medium in the Deep (tsl.js sprayColumn, line 892). It adds no white, and it already spans ±(width/2 + 40 m) in bearing, which covers the leg at 2.5-3.6° off the fall in both b02 and b07. Lowering its top means the leg below the horizon stands in this invisible medium instead of in a pale pillar.

4) Optional and not verified: in createSpray's vertexNode, stretch quads with role ≈ 1 by 1.4-1.6 along screen-up, so the veil streaks instead of balling up:
`rot.mul(radius).mul(vec2(1, mix(1, 1.5, 1 - smoothstep(0, 0.5, abs(C.w - 1)))))`
Keep vLocal unstretched. It costs about +3 vertex ALU.

Do not adopt size [4,9], density 0.7 or ride 0.6.

Verify with b07 and b02 captures:
- No pale puff above h ≈ 0.3 beside the lip.
- No darker band between the fingers and the veil.
- The bow's leg runs unbroken from the horizon into the plume.

Cost: constants plus 2 CPU lines and 1 CPU line in placeSprayColumn. 0 triangles, 0 draws, no fragment change. The optional stretch adds about 3 vertex ALU.

### `falls-jets-read-as-tabs` [major] The jets are flat, square-headed white tabs all of one length: a barcode of tape strips rather than comets of water

**Evidence:** critique/falls-b07-lip.png (3x of b07 x720-820, y520-700); critique/falls-b12-edge.png (4x of b12 x380-440, y500-650); b08 x600-700, y0-280; b16 x0-60, y450-700. Each mark is a bright rectangle with a hard square head and a flat top across the rope. They are the highest-contrast marks in the fall.

**Why it matters:** The curtain's surface is the hero's texture at every distance. Rectangles read as mechanical (piano keys, tally marks), the original pinstripe complaint in a bigger form. They give the eye no teardrop shape, taper or speed cue, which is the whole point of the jets.

**Critic's fix:** In sky-children-falls.js colorNode, give the jet its own profile instead of riding the flat-topped tube: tube = 1 - smoothstep(w*0.3, w, |fract(x)-0.5|) is flat over about 60% of the rope. Use jw = w*mix(0.55, 0.25, q) (wide head, thin tail), jetTube = exp(-((fract(x)-0.5)/jw)^2), and a rounded head smoothstep(0.0, 0.07, q) in place of the 2% step. Vary the length per rope with exp(-q*(3+4*h1)). Rebalance: rope = tube*strandGain*0.55 + jetTube*jet*strandGain*0.7, roughly halving today's jet gain (jet*1.4). Keep the bead branch for unresolved ropes. Screenshot b07's lens and b02.

**Files:** src/themes/sky-children/sky-children-falls.js (createFalls colorNode)

**Cost:** About +6 ALU in the falls fragment, about +0.2 KB of WGSL. 0 triangles, 0 draws, all tiers.

**Skeptic: CONFIRMED.** The problem is real. I could not refute it, and the critic's diagnosis is half right: the shape is the cause, but the light is equally at fault.

1. **It shows in every frame named, and on the current HEAD.** I took a fresh capture at 79adc87 of the b07 view (critique/refute-jets-fc-b07.png, crop critique/refute-jets-fc-b07-crop.png). The b07, b08, b12 and b16 crops (critique/refute-jets-b07/b08/b12/b16.png) show the same thing:
   - bright, flat-sided white tabs with a hard bottom edge, all about the same length;
   - at board distance in b12 (x370-440, y480-680) and b02 they read as tally marks on the hero fall.

2. **Pixel profiles down a tab are a plateau, not a comet.** Fresh capture, x=742 and x=774:
   - base about 196 (sRGB);
   - a fast 6 px rise at the top to about 218;
   - a near-flat plateau of 218 to 227 for 24 to 50 px;
   - a hard drop at the bottom.
   An exp(-4q) tail should be steepest next to the head. This one is the reverse.

3. **Why it plateaus.** I took a false-colour capture (critique/refute-jets-fc2-b07.png, crop refute-jets-fc2-crop.png):
   - the base sheet already sits at 0.6 to 1.0 before tone mapping (yellow band), which is at or above the scFilmic knee k=0.6;
   - the jet heads sit at 1.0 to 2.5 (orange), where the shoulder's slope is only 0.37 down to 0.02.
   So the filmic curve squashes the exponential tail flat. Add the 2% smoothstep head (sub-pixel, so a hard edge) and the flat-topped tube (smoothstep(w*0.3, w), which gives straight sides), and the result is a rectangle.

4. **What is wrong with the proposed fix.** The direction is right: a Gaussian tapered profile, a softer head, varied length, less jet gain. But it raises the base from tube*strandGain*0.35 to 0.55. The false colour shows the base is already on the knee. Raising it would:
   - push the whole sheet further into the shoulder, which flattens it more;
   - increase the contrast between ropes and the gaps between them, which risks bringing back the original pinstripe complaint.

   It also has three smaller gaps:
   - **Sub-pixel tails.** At board distance a rope is about 8 px wide. A tail of 0.25w is under 1 px wide and will alias into crawling dotted lines; MSAA does not supersample shading.
   - **Length tied to width.** Driving length from h1 makes wide ropes always short.
   - **Same length all the way down a rope.** Varying length per rope only still gives each rope one comet length along its whole fall.
   - **`hot` is left out.** The dye term `hot` must move to the new profile.

The amended fix below is in budget: 0 triangles, 0 draws, about +12 ALU, one hash, about 0.3 KB of WGSL, all tiers. It follows the rendering law.

**Amended fix (use this):** All changes are in createFalls `material.colorNode`, in src/themes/sky-children/sky-children-falls.js, around lines 315-331.

(1) **Give each comet its own random values.** Add:
- `cid = mod(floor(stream*rate + h3), rate*WATER_WRAP)`. The mod keeps each comet's identity across the 50 s water-clock wrap, because rate*WATER_WRAP is a whole number.
- `hc = scHash21(vec2(rid + 11.3, cid + vFall*3.7))`
- `hc2 = fract(hc*13.7)`

(2) **Give each comet its own length and brightness.** Make the envelope `env = exp(-q*(2.5 + 4.5*hc))`. This varies the length about 2.5x, between comets on one rope as well as between ropes. Make the head `head = smoothstep(0.0, 0.07, q)`, and set `jet = head*env*(0.65 + 0.35*hc2)`.

(3) **Make each jet its own tapered teardrop instead of riding the flat-topped tube.**
- Set `jw = max(w*mix(0.28, 0.6, env), fwidth(x)*0.6)`. Using the envelope (not q) makes the taper follow the visible comet, and the fwidth floor keeps the tail from going sub-pixel.
- Set `jetTube = exp(-pow2((fract(x)-0.5)/jw)) * strandIn`.

(4) **Rebalance the gain without raising the base.** The base already sits on the knee.
- `rope = mix(beads*0.75, tube*strandGain*0.35 + jetTube*jet*strandGain*0.75, resolve)`. The jet gain goes from 1.4 to about 0.75. Heads should land at about 1.0 to 1.4 before tone mapping, where scFilmic still has slope, so the tail reads as a gradient.
- If the fall loses too much brightness, raise the base to 0.40 at most, not 0.55.
- Leave the bead branch alone.

(5) **Update the dye term.** Set `hot = jetTube*jet*resolve` so the dye keeps the heads white-hot on the new shape.

(6) **Verify with two captures.**
- The b07 query with `&falseColor=1`: jet heads should be a short orange core grading through yellow, not long solid orange plateaus.
- b12 or b02 at board distance: no tick marks, and no crawling thin lines.

Also check the b08 lower streamers. The fray-region alpha (strandD) is fed by `ropes`, so the streamers will shorten a little. If they go too sparse, lower strandD's fray thresholds by about 0.05.

Cost: about +12 ALU and one extra hash per falls fragment, about +0.3 KB of WGSL, 0 triangles, 0 draws, all tiers.

### `falls-lip-reads-as-a-lid` [major] The brink is a smooth teal dome under the turf overhang (a lid or a jellyfish bell), and the far flank is a ruled curve

**Evidence:** critique/falls-b07-lip.png (b07 x705-800, y477-497): the glass tongue is a clean-topped teal cap emerging below a dark band under the turf, with no water seen crossing the rim. critique/falls-b12-edge.png (b12 x370-440, y478-492) shows the same dome. Tinted by the pour (b13; critique/falls-quad5-crop.png), the dome plus hanging strands reads as a jellyfish. The far flank is a smooth ruled curve (b07 x795-825, y490-740; b12 4x crop, right edge) while the near flank tears.

**Why it matters:** The brink is where the eye starts reading the fall. A rounded lid with tentacles reads as an object, not water pouring over a rim. The source stays unreadable, so the narrative of the terraces emptying into the fall does not land.

**Critic's fix:** In sky-children-falls.js positionNode:
(a) arc = max(form*(smoothstep(0,1.2,t)*0.55+0.45), 0.02) gives about 0.4 rad of bulge at t=0. Seen from about 58 m below, the bulged middle projects higher than the flanks (a dome). Use arc = max(form*smoothstep(0.25,1.6,t), 0.02), and sag the brink's middle by P.y -= 0.6*(1-u²)*(1-smoothstep(0, lipT, t)) so the brink reads as a notch rather than a dome (sub-metre, so fallPoint needs no mirror).
In colorNode:
(b) Break the top silhouette: head = smoothstep(0, 0.02+0.03*n3, vS), and start the crest speck band from tau about 0.15.
(c) On the far flank, scale the edge-noise amplitude by 1/max(|dot(N,V)|, 0.35) and start the edge fade earlier where the arc foreshortens. Today the |u| 0.6-1 band collapses into 1-3 px.
(d) Take one lip close-up (icon lens, iconFov about 9 on the lip). If the dark band above the tongue is the turf overhang rather than the notch wall, move the outlet out in isles.js (outlets x/z at r+0.3) until the tongue clears it.

**Files:** src/themes/sky-children/sky-children-falls.js (positionNode, colorNode), src/themes/sky-children/sky-children-isles.js (outlets, only if (d) applies)

**Cost:** About +5 vertex ALU and +4 fragment ALU, under 0.3 KB of WGSL. 0 triangles, 0 draws, all tiers. CPU only for (d).

**Skeptic:** PENDING at export.

### `falls-thread-feet-cotton-balls` [major] Every Twin thread and the span's fall ends in a stack of hard-edged cotton balls hanging in mid-air (steam-engine smoke), not a breath of spray

**Evidence:** critique/falls-b02-twin.png (b02 x1295-1360, y720-870; x1390-1470, y740-830; x1480-1540, y790-890). The same in b05, b06, b12, b13 and b15. In b17: x1640-1720 and x1740-1880, y720-850. On the phone they become polka-dot bubbles (b16 x360-430, y380-440). The threads dangle into the puffs like strings.

**Why it matters:** This is the right third's whole water read, beside the HUD in every landscape frame. Definite-edged, under-shaded billows climbing in a diagonal chain read as cannon or locomotive smoke. The design asks that thin falls end in a breath of spray. They also compete with the Mother's plume for the 'big spray' read.

**Critic's fix:** In sky-children-world.js, SPRAY.horse and SPRAY.span foot use SPRAY_ROLE.foot (3). In fx.js that gets billows = 1 (a definite body edge, 'under' shading 0.4, rim darkening), cap 0.35, size 5-10 m (span 7-14 m), rise 1.2-1.6 m/s and drift 1.4-1.8 m/s, so each foot climbs into a lumpy chain. Make them breath instead: add a role 4 'breath' (or reuse the veil's soft branch) with no billows (the soft puff edge), cap 0.15 (span 0.22), size [3,7], rise 0.3, drift 0.8, ride 0.4, h [0.6,1.05], spread along the thread's last 40%. The thread then dissolves into its own sheath instead of ending in a ball. Check b02 at 2x and b16.

**Files:** src/themes/sky-children/sky-children-world.js (SPRAY.horse, SPRAY.span), src/themes/sky-children/sky-children-fx.js (createSpray role caps)

**Cost:** CPU constants plus one role branch in createSpray (about +2 ALU). 0 triangles, 0 draws, all tiers. Less fill.

**Skeptic: CONFIRMED.** I couldn't refute it. The problem shows in every AFTER frame that has the Twin in view, and it is a regression, not a matter of taste.

- **b02 at 2x** (x1240-1600, y560-900): each of the three horsetails and the span's fall ends in a chain of 4-8 round, lumpy balls. They have definite edges and darker undersides. The horsetail chains climb diagonally downwind (bottom right, x1480-1540, y790-890) and the threads run on through them like strings.
- **Same read across the hours**: b03, b04/b13, b05, b06 and b12 show it identically. In b05 (night) the balls are the brightest mass in the right third.
- **b17 (ultrawide)**: the same, at x1640-1720 and x1740-1880, y720-850.
- **b16 (phone)**: they turn into a field of small 5-8 px popcorn dots at x360-430, y350-450.
- **BEFORE (a02)**: the threads simply faded into the haze. That was underwhelming but never wrong-looking, so this is something new the packages introduced, and the critic did not misread the BEFORE frames.

**Why it is a problem for the picture:**
- These threads end in mid-air, with nothing for the water to land on. Billows that rise come from an impact; a free-falling thread trails sinking, widening mist. So the climbing chain reads as smoke from a stack.
- With three columns plus the span, the right side now carries a second "big spray" that competes with the Mother's plume, the one hero spray.
- It contradicts the theme's own design. The design doc says "thin falls end in a breath of spray". The code comments on `SPAN`/`HORSE` say "it ends in a breath of spray" and "the Twin's threads only end in a breath".

**Root cause, confirmed in the code:**
- `SPRAY.span[1]` and `SPRAY.horse[0]` in `sky-children-world.js` use `SPRAY_ROLE.foot` (3).
- In `createSpray` (`sky-children-fx.js`), `billows = smoothstep(1.4, 1.6, role)` is 1 for the foot. That gives it the definite `body` edge, the rim darkening, `under` 0.4 and cap 0.35.
- It is also not in `thin`, so it can render darker than the air behind it.
- In `sprayPuffs`, `heaped` covers the foot, so it gets the sqrt bias toward the bottom with the biggest puffs lowest.
- `rise` of 1.2-1.6 m/s and `drift` of 1.4-1.8 m/s over 5-8 s of life make a climb of 6-13 m and a drift of 7-14 m: the diagonal chain.

**Where the proposed fix is unsound:**
- **`ride: 0.4` would send the spray off the frame.** `ride` is in fall-time seconds. Near the foot (t of about 5 s) the water falls at about 50 m/s, so `ride` 0.4 drags each puff down at about 20 m/s. At the peak of its density (age about 3 s) a puff sits at about h 1.3, and the oldest go roughly 200 m below where the frame cuts the fall. The breath would run off the bottom of the frame as streaks, the "cable" the `SPAN`/`HORSE` comment forbids.
- **`h` up to 1.05** puts puffs past the frame cut.
- **Role 4 needs explicit decoding.** The shader's thresholds would read it as `billows` = 1 with cap 0.35, the same as now.
- **Size [3,7] m would make the phone worse.** It pushes more puffs onto the 3 px radius floor, so b16 gets more uniform dots.

**Amended fix (use this):** Keep role 3. Change what it means, so no new role is added.

**1. `sky-children-fx.js`, `createSpray` `outputNode` (about +4 ALU, all tiers, WebGL2-safe TSL math):**
- Add `const isFoot = float(1.0).sub(smoothstep(0.0, 0.5, abs(role.sub(3.0))));`.
- Set `billows = smoothstep(1.4, 1.6, role).mul(float(1.0).sub(isFoot))`. The foot then takes the soft, noise-eroded edge, with no body edge, no rim or mass darkening and no 0.4 underside.
- Set `thin = isLip.add(isVeil).add(isFoot)`. The breath then only lightens the air behind it, which also stops a grey-smoke read at night.
- Set `cap = mix(<existing cap expression>, float(0.17), isFoot)`.
- Update the comment that lists the caps ("a thread's foot 0.17, a breath").

**2. `sky-children-world.js`, `SPRAY` (CPU constants only):**
- `span` foot: `h [0.55, 0.98]`, `across [0, 0.8]`, `out 0.45`, `size [6, 11]`, `rise -0.6` (it sinks, as free-air mist does), `drift 0.6` (the veil's wind), `life [4, 7]`, `density 1.0`.
- `horse` foot: the same, with `size [4, 8]`, `out 0.35` and `density 0.9`.
- No `ride`. A negative `rise` already works: `lift = e.rise * age * …` and `y = p[1] + lift`.

**3. `sprayPuffs`:**
- Change `const low = heaped ? Math.sqrt(h2) : h2` to `e.role === SPRAY_ROLE.plume ? Math.sqrt(h2) : h2`. The foot then spreads evenly along the thread's last stretch, and `size *= 0.6 + 0.6 * low` still widens the sheath downward. Keep the ring layout from `heaped`.
- Optional, for the phone: for the foot, apply `fitN` to the count only and skip `fitR` on size. The layout then gets fewer, overlapping soft smudges instead of 3 px dots.

**4. Tests, `tests/unit/sky-children-world.test.js`:**
- Raise the Mother-to-Twin seen-area ratio from 2.5 to 4.
- Add a test: every foot puff's y is at most `fallPoint(fall, t).y + 1` m (nothing climbs), and every foot puff is on screen above the frame's lower edge.

**5. Verify** (one capture each, since only one small effect per session):
- b02 cropped at 2x around x1240-1600, y600-900: each thread should fade into a pale, downwind-leaning sheath with no discrete balls.
- b16: no dot field.
- b05: the breath is never darker than the sea behind it.
- The Mother's plume stays the only billowing spray.

**Cost:** 0 triangles, 0 draws, a few ALU in one shader, and slightly less fill and overdraw. `fitSpray`'s area drops, so `sprayFit` rises toward 1, which gives the Mother's plume a little more.

### `falls-night-grotto-lump-remains` [minor] At night an opaque orange lump still sits on the Mother Fall's head; commit be704eb claims it is gone

**Evidence:** critique/falls-b05-hearth.png (4x of b05 x385-420, y500-515): two saturated orange blobs pasted across the curtain's head. The ropes round them pick up no warmth.

**Why it matters:** The night beat, warmth seen through the water, reads instead as a lamp or visor stuck on the fall, the lit-from-behind story inverted. It is also the most saturated spot in the night frame, pulling the eye off the card.

**Critic's fix:** In sky-children-world.js emitGlows (sleepers block, about lines 2155-2167), the heap is still pushed at `through = 0.35` when the falls are visible. It is additive at renderOrder 60, after the non-depth-writing falls, so it still lands on top of the water. Only the wide soft glow was dropped. Set through = 0 when veiled. In sky-children-falls.js colorNode, make the falls' own hearth term carry it: gain 0.5 -> 1.1, falloff 22 -> 28 m, weighted by (1 - rope*0.6)*(1 - sheetAlpha*0.5) instead of thin², so amber shows between the ropes and on the lace. Re-check b05.

**Files:** src/themes/sky-children/sky-children-world.js (emitGlows sleepers), src/themes/sky-children/sky-children-falls.js (hearth term in colorNode)

**Cost:** Trivial CPU, about +1 ALU in the falls fragment. 0 triangles, 0 draws.

**Skeptic:** not verified (minor finding).

## clouds: 3 → 6

**What improved (the critic):** This dimension went from the weakest in the theme to a real sky. Before 3/10, after 6/10. The siblings (nimbus-veil's soft, glowing sea and tower) still set a clearly higher bar.

Genuinely better:
- **The Deep is now a sea of clouds, not a navy ocean.** a01 showed a flat plane with blotches all one size (sea luma median 120, p5 60, mean rgb 106/126/135). b01 shows lit domes with real relief, silhouettes and parallax (median 154, p5 81, mean 140/153/163).
  - The isles' shadow wedges finally read on it, converging toward A (b01 x900-1300 y700-790; b10 x500-900 y520-660).
  - The toll's rings and the glory lie on the cloud (b13).
  - The hard "sea horizon" line has gone: in b01 at y585-610 the deck rises softly out of the luminous mist wall, and the mist still swallows the far isles' roots.
- **The storm wall gives the frame its missing dark value mass.** The slate billows read at luma 52-80 against sky at 103-111 (b01 x520-785 y260-505). The bow's leg now burns on dark ground (b01 and b02 x480-620 y300-520), which was the comp-1 "rainbow photograph" fix. The rain hangs under a flat base, so the old "mountain range over a picket fence" is gone.
- **The world cumulus tower:**
  - It has a flat base, a lit crown and a slate lower body.
  - At Rose the Earth's shadow climbs it (b04: peach crown over a lilac body).
  - At Night it reads silver-blue against the Milky Way (b05). Night clouds and the moonlit deck now read (b05 deck mean rgb 59/69/111) instead of the old black-navy smudges.
- **Cirrus exists.** There are diagonal streaks top-left in every hour: rose-mauve at Rose (b04), silver at Night, white at Jade. They form a leading line down toward the tower.
- **Far banks:** low, round-headed, well-hazed cloud walls on the horizon (b02 x30-140 y515-555; b10 y150-185 at Gilded). They give the distance scale without inverting depth.
- **The altocumulus cells themselves** are crisp, recede in perspective and are lit on their near flank, with no zoom-blur streaks or ghost doubles. The stray top-left puff is gone.
- **One wind and one cloud light** are shared by every layer.

What still holds the dimension back:
- The holes in the sea expose the old flat shelves at A.
- The tower and the storm do not fuse into one storm.
- The altocumulus survives in board frames only as a single sticker.
- The deck's mid-distance surface aliases into contour hatching.
- At Gilded the clouds are lit by a cooler sun than the stone.

### `clouds-1-holes-at-A` [major] Holes in the cloud sea open onto the old flat 'ocean' shelf, with a jagged discard outline, and one sits at A right on the glory

**Evidence:** b13 (x1000-1170, y740-800; zoom: critique/clouds-c-glory.png): over the glory's upper rings is a dark violet blob with a stair-stepped 1-px outline, surrounded by the old shelf's soft pale streaks on flat dark. It cuts the four-line reward in half.
b01 and b02 (x850-1270, y700-790; zoom: critique/clouds-c-hole.png): the same hole next to the Twin's wedge reads as a dark pond in a snowfield. Inside it are the first audit's blotches on navy, with a crisp contour at x1030-1080, y750-770.
It is still there at t=95 on Minimal Gilded (critique/clouds-1-minimal-gilded-t95.png, x1000-1180, y740-790). The swell drifts at about 1 m/s, so the hole stays by A for the whole session.

**Why it matters:** A is where the glory, the opposition glow and the quad's wedges all point, and it is the one place the old 'navy ocean' survives. A heightfield with a Discard has no hole walls, so depth does not read and the hole looks like a puddle.
The outline comes from an optics mismatch: sea.js l.187 passes deepMist: rim, which is about 0 at the rim, so the rim pixels lose the opposition glow and glory. The dome behind the hole keeps mist of at least 0.2 and keeps them. The two sides of the discard edge therefore have different colours.
Through the hole, deepColour (tsl.js l.1036-1052) still draws shelf 1 with the old smoothstep(0.56, 0.8) blotch-and-emboss ramp.

**Critic's fix:** All in sky-children-sea.js createSea:
(a) Keep the deck closed round A and along the leg. Before the Discard (l.140): thetaA = acos(dot(V, U.A)); cover += 0.6*(1 - smoothstep(0.12, 0.26, thetaA)). The glory and opposition glow then always lie on cloud, which is also the physics.
(b) Make the rim match the dome exactly. Compute behind = deepColour(...) once. Then mistBehind = max(clamp(1 - (1 - behind.mist)/0.55, 0, 1), 0.2) * smoothstep(0, 0.03, -V.y), the same formula skyColour uses. Pass deepMist: mix(mistBehind, 1, rim) to optics. Both sides of the discard edge are then the same colour and the jagged contour disappears.
(c) Give holes walls. In positionNode, compute cover from the same level-0 fetches and sink the surface: y -= (1 - smoothstep(SEA.hole, SEA.hole + 0.25, cover))*700. The rim then curls down into a billowing wall whose far side faces the eye, lit full face by the sun behind. Shade the wall from the lit colour toward mistShade with its depth below the mean.
(d) In deepColour, light the shelves seen through holes with cloudLight at a lower key (deeper, bluer, low contrast) instead of the emboss blotches.
Verify: event=quad at hour=2 and hour=0. The glory must lie on unbroken cloud, and a luma probe on the glory must be no darker than in b13.

**Files:** src/themes/sky-children/sky-children-sea.js (createSea positionNode and colorNode l.139-187), src/themes/sky-children/sky-children-tsl.js (deepColour l.1021-1060)

**Cost:** 0 triangles, 0 draws. Sea vertex shader about +3 ALU (the fetches already exist). Sea fragment about +10 ALU. WGSL under +0.5 KB. Same on every tier. On Minimal, with 36 rings, the walls are coarser but still read.

**Skeptic:** PENDING at export.

### `clouds-2-tower-storm-cutouts` [major] Tower and storm read as two cut-outs glued side by side: a white bullet with a 150-px vertical seam against a dark slope that reads as a mountain

**Evidence:** b01 (x365-550, y200-480): the tower is a capsule, with near-vertical sides at x≈370 and x≈540, a rounded top and an even scalloped edge.
At y=320 the luma steps 166 to 52 within 4 px. The step runs along a straight vertical line from y250 to y400 (x536-540).
b11 (x190-200, y505-740; zoom: critique/clouds-c-seam.png) shows the same straight cut. The storm's billows there are uniform dark 'tombstones'.
The storm's visible right flank is a 50-degree slope from (640,300) to (785,505) over a flat base, so it reads as a dark hill or mountain shoulder (also visible in b10 at the top).
On Minimal (t=95 capture, x355-545 y225-430) the crown's puffs read as spheres, like a ball pit.
The storm top sits lower than the tower, beside it rather than under it.

**Why it matters:** The design says the tower is 'the storm's sunlit crown over its dark body'. What reads is a white cloud parked in front of a dark hill. Nothing says cumulonimbus: there is no anvil, no stepped and uneven turret flanks, and no transition from lit crown to slate across the form.
This is the largest shape in the upper-left third, right where the bow's leg climbs, so its silhouette sets the style of the whole sky. A capsule and a pyramid read as props next to nimbus's irregular stacked tower.

**Critic's fix:** (a) sky-children-cumulus.js cloudPuffs, edge() (l.117). Replace the cos^0.28 capsule with a stepped congestus profile:
- 2-3 flank turrets on the left at 0.35-0.7H, bulging 0.15-0.25 halfW.
- The right flank steps DOWN in two shelves (heads at about 0.55H and 0.3H) into the storm.
- Crown turrets at uneven heights (1.0H, 0.78H, 0.62H) so the top is asymmetric.
(b) Darken across the form, not only by height. In outputNode (l.266) take storm = max(storm, smoothstep(0.2, 0.75, tone.z)*tower*showerAmt*0.85), so the right flank's billows turn slate over 2-3 billows. In cumulusPlan (l.56) set bearing = showerBearing - 0.015 so the tower overlaps the wall's heart by 25-30% of its width. The lit-to-dark change then crosses billows, not a silhouette line.
(c) sky-children-tsl.js scStormHeight (l.555). Steepen the ends: body = smoothstep(1.0, 0.82, x).sqrt()*0.45. Add an anvil: a fifth scBillow row in stormWall at low k (about 6) with squash 0.3, crest at 1.0-1.05 of the top, spanning u from -0.2 to 0.9, with a smooth underside about 0.12 of the top below it and its brow lit by cloudLight. The silhouette is then a wall with an overhanging top, never a pyramid.
(d) Lower the puffN weight from 1.1 to 0.6 above hf 0.6 so the crown reads as one mass, not balls.
Verify: b01, b11 and combo=13 (the legs must still burn on slate).

**Files:** src/themes/sky-children/sky-children-cumulus.js (cumulusPlan l.41-60, cloudPuffs edge() l.117, outputNode l.240-300), src/themes/sky-children/sky-children-tsl.js (scStormHeight l.555, stormWall l.583-690)

**Cost:** (a), (b) and (d): CPU placement only on layout change, same puff count, about +4 ALU per puff fragment. (c): one more scBillow call in the dome, about +1 KB WGSL (about 40 to 41 KB of the 64 KB gate) and about +15 ALU per storm-window pixel. 0 triangles, 0 draws, every tier.

**Skeptic:** PENDING at export.

### `clouds-3-alto-column-and-sticker` [major] The altocumulus deck is squeezed into a vertical column at idle, and into one stray sticker puff in every board frame

**Evidence:** b01 (x1020-1310, y230-470; zoom: critique/clouds-c-alto.png): a column of flecks taller than it is wide, the same width from top to bottom (no perspective convergence). It reads as a smoke plume or a question mark.
The same column appears in b11 (x800-1090, y560-830) and in b17 (x1450-1590, y225-450) as a stacked totem between the HUD and the gate.
In b02, b03, b04, b05, b06, b12, b13, b14, b15 and my Minimal t=95 capture, the only altocumulus is one small puff at (1220-1310, 240-268) right of the HUD, plus a soft sliver at the right edge (1500-1600, 330-420). Montage: critique/clouds-c-puffs.png. That is exactly the 'isolated stray puff' the first audit asked to remove.

**Why it matters:** The upper-right sky in the game frame is the 'light mass' the design gives the deck. It is empty blue holding a single cut-out cloud, which reads as a mistake. At idle, a vertical cloud column at 10-25 degrees elevation contradicts the shell perspective the deck is built on, because a sheet on a shell foreshortens into wide, low bands.
Cause: altoDeck (tsl.js l.408-424) multiplies four masks:
- the bearing ramp smoothstep(0.3, 0.75, off-from-shower), about x875-1290 in landscape;
- inside the primary (thetaA < R1 - 0.04..0.16);
- the gate clearing (need += clear, a full +1);
- the HUD calm (+0.8).
What survives is a strip about 250 px wide between the HUD and the gate. With the board on, one cell survives.

**Critic's fix:** Compose the drift from the free room instead of subtracting masks from it.
(a) In sky-children-world.js, on each frame solve, compute a free sky box right of the HUD: bearing from the HUD's right edge + 2 degrees to the frame's right edge + 10 degrees, elevation 4-16 degrees. Pass it as U.deckZone (vec4).
(b) In altoDeck, replace zone with a soft box SDF in (bearing, elevation) whose elevation profile peaks at 6-10 degrees, so the drift is a wide low sheet, at least 3:1 on screen, running behind the gate and down into the far banks.
(c) Thin the deck at the gate instead of clearing it: need += clear*0.3. Cells behind the gate are more than 15 km out and already hazed 0.55 or more, so the gate stays legible.
(d) If the box is narrower than 12 degrees (two boards, a smile frame), set the deck's share of U.cloud to 0. Never draw a single cell.
(e) Turn the inside-primary cut into a thinning (cloudThin already keeps the bow's band dark).
Optional: a second, sparser drift upper-left outside the secondary, under the cirrus.
Verify: b02, b17 and the portrait frame.

**Files:** src/themes/sky-children/sky-children-tsl.js (altoDeck l.396-460), src/themes/sky-children/sky-children-world.js (frame solve / uniform setup)

**Cost:** One vec4 uniform, set on the CPU on layout change. Shader ALU-neutral: one box SDF replaces two smoothstep windows and the clear term. 0 fetches, 0 triangles, 0 draws. Applies on every tier that draws slices.

**Skeptic:** PENDING at export.

### `clouds-4-sea-crumpled-foil` [major] The cloud sea reads as crumpled foil or rippled sand in the middle distance: hard creases alias into contour hatching and dotted lines, and the valleys go dark instead of filling with mist

**Evidence:** b17 (x1300-1750, y600-720; zoom: critique/clouds-c-uwdeck.png): stacked wavy 1-px light and dark lines, and dash-dot runs along crease silhouettes.
b02 and b03 (y600-690): the same hatching across the full width.
b10 (the sea lens): a quilt of shallow domes cut by sharp dark seams. The near-deck luma sd is 22-36, against nimbus's soft, swelling sea at sd 15 (r-nimbus x1000-1600, y560-900).

**Why it matters:** The sea covers 40% of a landscape frame and about 85% of a phone frame (b16). In motion, the aliased crease lines will crawl and sparkle.
Cause:
- bakeSeaField (core.js l.1104-1150) unions spherical caps with a hard max in each of 4 octaves. Every head meets its neighbour in a slope discontinuity, a V crease.
- createFieldTexture (tsl.js l.134) has no mips (minFilter Linear), and the relief only settles from 9 km (SEA.settle). From about 2.5 to 9 km, the slope, crease and fuzz fetches are minified 3-10 times and alias.
- sea.js l.150-152 darkens creases and low heads (occl 0.66, crease x0.2), where real cloud seas pool bright vapour. The result reads as a solid surface, not as vapour.

**Critic's fix:** (a) core.js octave(): smooth-union the caps with a polynomial smooth max, k ≈ 0.15 of the cell radius (h = clamp(0.5 + 0.5*(b - a)/k); mix(a, b, h) + k*h*(1 - h)). Heads then nestle into rounded saddles instead of folds.
(b) Give the field mips. Box-downsample the float field on the CPU to 1x1, set map.mipmaps = levels and minFilter LinearMipmapLinear. Uploading given half-float levels is core WebGL2; only generateMipmap is not.
Cheaper alternative per tier: fade the detail by pixel footprint. tpp = length(fwidth(P.xz))*size/SEA.tile; detail = 1 - smoothstep(0.8, 2.5, tpp); multiply the slope k, crease and fuzz by detail. WGSL discard is demote-to-helper, so fwidth stays valid after it.
(c) Valley mist: lit = mix(lit, mix(light.mistLit, levelHaze, 0.5)*0.8, (1 - smoothstep(0.1, 0.45, heads))*0.5), and cut the crease darkening from 0.2 to 0.1. The seams become soft luminous lanes of vapour.
Verify: b17 and b02 at 100% crop, and two captures 0.5 s apart to check for crawl.

**Files:** src/themes/sky-children/sky-children-core.js (bakeSeaField l.1104-1180), src/themes/sky-children/sky-children-tsl.js (createFieldTexture l.134), src/themes/sky-children/sky-children-sea.js (colorNode l.145-165)

**Cost:** Bake: about +30% CPU, one-off (about 30 ms at 512²). Mips: +33% texture memory (about 2.0 to 2.7 MB at 512²). Sea fragment about +6-8 ALU, 0 extra fetches. 0 triangles, 0 draws, every tier.

**Skeptic:** PENDING at export.

### `clouds-5-two-suns` [minor] Clouds are lit by a cooler sun than the stone: at Gilded the tower and the deck are lilac-grey while the gate, isles and far mist are gold

**Evidence:** At Gilded (b03, b10) the far pieces are gold and the clouds are cool:
| Region | Frame, pixels | Mean rgb |
|---|---|---|
| Tower crown | b03 x380-500, y240-330 | 177/169/172 |
| Near deck | b03 x990-1250, y830-900 | 155/140/142 |
| Near deck | b10 x560-980, y620-880 | 139/134/157 |
| Far Gate | b03 x1250-1310, y420-520 | 191/155/123 |
| Far mist | b10 x700-1100, y200-260 | 198/166,135 |
At Jade the crown is blue-white (149/171/197) under a cream key (#ffe7c2).

**Why it matters:** The design's Gilded hour is 'gold haze and gold-lit cloud over a blue zenith'. The clouds, the largest lit masses in the frame, are the only things that do not take the hour, so the hour loses its identity.
Cause:
- cumulus.js l.284: the crown's airlight is 0.82*(1 - exp(-20000/26000)) ≈ 0.44 toward the blue skyBase at its elevation.
- sea.js l.147 and l.156: lit = pow(scWrap(dot(N, key), 0.3), 1.4) with the sun about 15 degrees up (key = -A). An up-facing top gets about 0.31, so about 70% of the deck is mistShade (#6d78b0 at Gilded). That is a Lambert surface for a medium that scatters near-isotropically.

**Critic's fix:** Warm the hue but hold the value, because the audit asked that the falls stay the brightest whites.
- Tower, cumulus.js l.284: crown air = 0.6*(1 - exp(-d/45000)), about 0.22 at 20 km. Fog the lower half toward mix(horizonHaze, skyBase, 0.5). Cut gain from 0.5 to 0.42 so the crown luma stays at or below 0.9 of the Mother Fall's (about 216 in b01).
- Sea, sea.js l.147: key = mix(0.45, 1.0, scWrap(dot(N, U.key), 0.8)) and gain 0.48 to 0.36. The deck median luma stays about 150 at Jade, but its lit hue becomes the hour's cloudLit (cream at Jade, gold at Gilded, rose at Rose). Shade stays in creases, limbs and faces turned away.
Verify: ?hour=0..4 with a luma probe on the tower, the deck and the fall.

**Files:** src/themes/sky-children/sky-children-cumulus.js (outputNode l.250-290), src/themes/sky-children/sky-children-sea.js (l.145-160)

**Cost:** ALU-neutral. 0 fetches, 0 triangles, 0 draws, every tier.

**Skeptic:** not verified (minor finding).

### `clouds-6-graphic-masks` [minor] Two masks still read as graphics: the cirrus' bow-exclusion ring, and hairline ray lanes scratched across the sea

**Evidence:** b11 (upper half): the cirrus streaks end on a perfect circle concentric with the bow. This leaves a clean annulus from y≈230 at centre to y≈500 at the edges, a halo-shaped hole in the high cloud.
b10 (x600-1100, y250-900; zoom: critique/clouds-c-rays.png): the anticrepuscular lanes on the deck are 2-6 px straight hairlines crossing the dome relief like scratches. Faint versions show at Gilded in b17 near the card.
In board frames the cirrus cut is mostly hidden, because the cirrus lives top-left.

**Why it matters:** Anticrepuscular shadows on a cloud deck are broad, soft bands several degrees wide. Thin lines read as rendering artefacts or a laser grid.
An annulus of clean sky following the bow exactly shows the mask's geometry. A painter would thin the high cloud near the bow, not cut a ring out of it.
Cause:
- cirrusLayer (tsl.js l.373): inBows zeros alpha between R1 - 0.09 and R2 + 0.09 with only a 0.035 rad feather.
- antiRays (l.335-336): an 11-per-turn fine row feeds a narrow smoothstep(0.44, 0.66), and sea.js l.172 multiplies the result by 1.6.

**Critic's fix:** Cirrus: perturb the cut with the drift noise, using thetaA + (broad.g - 0.5)*0.12 in inBows. Thin to 0.35 instead of 0 everywhere except within ±2 degrees of R1 and inside Alexander's band.
Rays on the sea (surface branch): use only the broad 5-per-turn row with smoothstep(0.35, 0.75). Fade any lane narrower than about 1 degree on screen (scale beam by smoothstep(1, 3, the lane's width in pixels from across)). Cut the depth from 1.6 to 1.0.

**Files:** src/themes/sky-children/sky-children-tsl.js (cirrusLayer l.357-394, antiRays l.327-352), src/themes/sky-children/sky-children-sea.js (l.169-173)

**Cost:** Free. A few ALU, one fewer fetch on the sea. 0 triangles, 0 draws. Only on tiers with rays and cirrus.

**Skeptic:** not verified (minor finding).

## bow: 4 → 7

**What improved (the critic):** The bow went from a decal to weather. Most of the 11 original findings are fixed in the frames. Evidence:

- **The rest bow exists.** In my capture critique/bow-c1-rest-jade.png (Jade, combo 0), a paler leg stands in the storm's rain (x 480-620, y 340-530) and in the Mother Fall's spray (x 380-450, y 620-880). The first links visibly pay it off: the red at y=420 goes from (103,89,97) at rest to (161,106,89) painted.
- **The leg against the slate storm wall is now the best passage in the theme.** b02/b04/b12, crops bow-b02-legz and bow-b04-leg: full red, orange, yellow, green and blue burning on dark cloud. It runs with no kink through the horizon foot (464,558) and down the spray (bow-b12-foot).
- **Stroke ends and joins are clean.** Ends are soft brushed tapers (b02 crest end at 1215,115; b17 crest end). There are no square cuts, no dark ticks at the joints along b12's 600 px crest, and no foot seam. The link-colour thread is gone: no ghost double band, no portrait panels. Night's moonbow is a pale ghost (b05, x 1000-1210, y 115-160) with no orange contrail.
- **Composition.** The crest now sits 115-140 px below the frame top and falls to leave the right edge at y≈210 (b12), so the circle round A reads as an arc, not a banner. The ultrawide crest (b17) clears the top.
- **Brightness against clear sky is in target.** Peak/sky is 2.1x at combo 3 (b02, x=1100) and 2.4-3.3x along the crest at combo 13 (b12), down from about 4.8x/8x.
- **Secondary and its companions are right.** The colour order is reversed correctly. Alexander's band is about 8% darker only where a bow is painted (b12 radial at r 706-760 reads (61,113,164) against b02's (67,122,176)); the unmasked ghost ring is gone. The supernumerary is one quiet lavender-pink fringe touching the violet.
- **Rose is a real sunset bow.** b04 leg at y=400 runs (153,54,51) → (158,67,50) → (146,90,49): red-orange to olive, with blue gone.
- **The glory has no sonar rim.** It shows a white heart with pink and green rings lying in the mist (b13; critique/bow-c3-quad-jade-t75.png).
- **Phone combo 12 reads.** Both smiles are visible with the secondary reversed at the bottom (critique/bow-c2-portrait-jade12.png).

What still holds it back: the antisolar point and its glory, the bow's colour over blue sky, and the phone smile at low combo.

### `bow-1` [major] The antisolar point lands in a hole of the cloud sea: no opposition glow at rest, and the quad's glory is cut by a hard chord under a hard-edged dark blob

**Evidence:** Column x=1085 through A (the solver's nominal A is (1082,797) at 16:9), in b02, b06 and c1-rest-jade:
- Sea is (134,141,147) at y=740.
- It drops to (77-94,…) for y 755-795.
- It is bright again, (158,166,170), at y=805.

So A sits right in a dark lane, beside a lobed, hard-edged hole with a 1 px dark rim at (1024-1158, 742-774); see crops critique/bow-b02-A.png and bow-b06-A.png. Pearl, whose hour row promises the brightest mist optics, shows nothing at A.

On the quad (b13 Rose; my capture critique/bow-c3-quad-jade-t75.png, crop bow-c3-glory.png):
- The rings show only on the near sea below a hard horizontal chord at y≈792.
- The upper ~40% of the glory is that dark lobed blob, with a bright speck at (1090,760).
- t=30 and t=75 give the identical hole. The sea drifts about 1.1 m/s on a 9 km tile (TUNE.wind 5 × share 0.22), so this is the state for the first several minutes of every session, not an unlucky frame.

**Why it matters:** A is where everything converges: the bow circle, the isles' wedges, the anticrepuscular rays and the glory. The four-line clear's reward currently reads as half a halo leaking out of a hole. In sea.js, the Discard at cover < SEA.hole and the `rim` that feeds deepMist cut the glory, the opposition glow and the fogbow. The shelves seen through the hole carry them only at the 0.2 mist floor, which makes the chord.

**Critic's fix:** 1. In sky-children-sea.js createSea colorNode, hoist thetaA = acos(dot(V, U.A)), which is already computed inside the `tier.rays` branch, above the hole test.
2. Close the sea round A before the Discard: cover = cover + 0.45·(1 − smoothstep(0.087, 0.175, thetaA)), i.e. 5°→10°. The antisolar point then always lies on a sunlit mist dome, and lanes and holes open only beyond about 8°. This is the cloud top the glory sits on and the wedges and rays end on.
3. Optional: in sky-children-tsl.js optics(), deep block, raise the mist floor for the glory and opposition terms only to max(mist, 0.5·(1 − smoothstep(4, 8, thetaDeg))). A residual hole edge then never draws a chord through the rings.
4. Feather the Discard edge by about 1.5 px in screen space (cover against hole ± fwidth(cover)) so the 1 px dark aliased rim goes.
5. Verify: quad at t=30 and t=75, hours 0 and 2; board=0 at rest at hour 4.

**Files:** src/themes/sky-children/sky-children-sea.js (createSea colorNode, lines ~138-140 Discard, ~167-171 rays, ~182-187 rim/optics); src/themes/sky-children/sky-children-tsl.js (optics(), glory/opposition block ~945-958)

**Cost:** About 4 ALU per sea fragment and 0 fetches (thetaA is reused). 0 draws, 0 triangles, WGSL about +0.1 KB on every tier.

**Skeptic:** PENDING at export.

### `bow-2` [major] Over clear blue sky the bow is a pastel pink-teal ribbon with no warm half, and nothing in the picture carries it

**Evidence:** b02 crest, x=1100, combo 3 (crop critique/bow-b02-crest.png). From sky through the band:
- sky (38,97,159)
- 'red' (132,120,160), lavender-pink
- 'yellow' (123,134,160), grey
- green (57,138,163), teal
- violet (79,121,179)

The blue channel stays flat at about 160 under the whole band. b12 at x=1100, combo 13, is the same: (177,123,160) → (179,143,156) → (89,171,158) (crop bow-b12-crest.png).

Compare the leg on the storm (b02, y=420): red (161,106,89), orange (152,122,84), green (79,129,76). That is the warm half the crest lacks.

At combos 1-6, which is most of play, the crest is a 200 px pastel shard on empty blue at (990-1215, 110-150) in b02/b03/b06. It is also the crest in b15 and b17.

**Why it matters:** The luminance fix (2-3x the sky) was right. But a purely additive bow over saturated blue cannot show red, orange or yellow: red plus blue reads pink, yellow plus blue reads grey. The chain's drops (chainVeil) are invisible, so the crest still reads as a hologram decal while the leg on the storm reads as weather. Irisfall's main arc should read warm-outside like a real rainbow.

**Critic's fix:** 1. In sky-children-tsl.js optics(), let the drops dim what lies behind them under the band: the rain veil's extinction, art-directed to the coloured band. Add to the returned darkening channel:
   w += medium1·0.3·band1Win + medium2·0.2·band2Win
   - band1Win = smoothstep(37.0, 39.0, t1)·(1 − smoothstep(42.4, 43.4, t1))
   - band2Win is the mirror image on t2 (49.5-51 / 53-54.5)
   - Better still, use luma(pv)/luma(pv at peak) so the dimming follows the bow's own profile.
   - All four callers already do col·(1 − w) + light: the dome at tsl.js ~1209, the sea at sea.js 188, the cumulus at cumulus.js 282, and the spray. No plumbing is needed.
   - At combo 3 this pulls the sky's blue under the red edge from about 160 to about 135, so red reads red-orange and yellow reads yellow. On the slate storm the change is negligible.
   - Scale the extinction by U.bowSat, or clamp it at Night, so the moonbow (b05) never gains a dark rim.
2. Optional, keep only after a capture shows it doesn't read as noise: in skyColour, above the horizon where chainVeil·band1 > 0.2 and t1 < 41, reuse the shower block's curtain-streak noise as faint virga. Use −3-4% luminance, slanted like the shower, ending raggedly 4-6° inside the band, so the painted crest visibly stands in rain the children brought.
3. Verify at combo 3 and 13, hours 0, 1, 3 and 4.

**Files:** src/themes/sky-children/sky-children-tsl.js (optics() ~824-960: the returned vec4(out, alexander); skyColour optics block ~1202-1211 for the optional virga)

**Cost:** Extinction: about 5 ALU per pixel where optics run, 0 fetches. Virga: +1 noise fetch gated by |t1 − 40| < 6. 0 draws, 0 triangles, WGSL +0.2-0.4 KB on every tier.

**Skeptic:** PENDING at export.

### `bow-3` [major] Phone smile: painted strokes barely read over the bright sea, while the spray's resting bow is vivid and stops dead at the puff's edge (the reward is inverted)

**Evidence:** b16 (430×932, Rose, combo 4). Per frameFor, strokes s1 0-3 paint x 51→294 at y≈797-825.
- Over the sea at x=200 the red edge is (180,122,148)/(157,104,152) against the sea's (182,142,154), a ΔL of about 0.05, which is a ghost.
- At x=100-150 over the spray puff the bow is (255,143,135)/(242,206,158), vivid.
- It ends in a hard step at x≈165, y 800-830 (crop critique/bow-b16-smile.png).
- My capture critique/bow-c2-portrait-jade12.png (Jade, combo 12) has the same step at x≈165 (crop bow-c2-smile.png).

The spray carries its bow at max(m1, rest) times 3.0, then times its alpha. The sea behind it carries veil·U.bowDeep, about 0.5-0.7 of full. a16 had a saturated, if panelled, smile.

**Why it matters:** On a phone the smile is the only bow, and its strokes are the chain's score readout. Today an unpainted puff outshines four painted links, and the bow looks as if it lives only inside the spray.

**Critic's fix:** 1. The bow-2 extinction already restores contrast over the bright sea, since the band dims the pink sea behind it by about 25%.
2. In sky-children-world.js applyFrame (~line 583), set U.bowDeep to (1.0, 1.0) for the smile. In tsl.js chainVeil(), give the smile a medium floor of about 0.75 once dial ≥ 1, for example via a uniform flag.
3. In sky-children-fx.js, at the spray's optics call (~276-283), replace the constant colour.addAssign(opt.mul(3.0)) with opt.mul(mix(1.2, 3.0, smoothstep(0.2, 0.6, alpha))), computing alpha before it. A puff's thin rim then carries about the sea's own bow and only dense cores burn, so the bow passes through the puff edge without a step.
4. Verify at 430×932 and 390×844: hour 2 combo 4, and hour 0 combo 12.

**Files:** src/themes/sky-children/sky-children-fx.js (spray outputNode, optics call ~276-283); src/themes/sky-children/sky-children-world.js (applyFrame, U.bowDeep ~583); src/themes/sky-children/sky-children-tsl.js (chainVeil ~775-785)

**Cost:** About 3 ALU per spray fragment, 0 fetches, 0 draws, 0 triangles on every tier.

**Skeptic:** PENDING at export.

### `bow-4` [minor] The secondary smears across the sunlit tower and leaves a maroon cap on a storm billow (b12, the hero combo-13 frame)

**Evidence:** b12, crops critique/bow-b12-left.png and bow-b12-shoulder.png:
- At (400-500, 255-375) a broad pastel pink-green wash lies over the white cumulus face.
- At (495-520, 245-262) the one dark billow above the tower's right shoulder is turned maroon. Row y=250 reads: cloud (191,183,197) → (143,109,132) → (122,82,113) → (104,81,118) → sky (94,114,171).

world.js bowHides() puts the tower in the stroke cut's hides, with the comment 'its sunlit cloud shows no bow'. So the cut gives that arc no quota and runs the stroke end on under it. But cumulus.js still calls optics() with the default chainVeil, so the run-on shows, interpolated per puff corner (vStrokes) into a smear. The storm wall's `rain` (bodyA·0.55 + rainA) counts the billow crowns as full rain.

**Why it matters:** This is where the eye travels from the secondary down to the Spring Isle in the theme's peak frame, and the maroon cap reads as a rendering glitch. It also contradicts the cut's own rule, so stroke ends there are not where the cut says.

**Critic's fix:** 1. In sky-children-cumulus.js outputNode (optics call ~279), pass veil: float(0.0). Only the shower's real rain in front of the lower tower carries a bow there, as the cut assumes. Also weight `rain` by (1 − smoothstep(0.3, 0.6, rise)) so crowns above the rain show none.
2. In sky-children-tsl.js stormWall() return (~687-691), use rain: bodyA·0.55·(1 − smoothstep(crownLow, crownHigh, el)) + rainA, with crownLow/crownHigh the billows' own crown elevations. Rain falls from the base, so the bow fades up a billow instead of lighting its crown.
3. Verify with the b12 query and at combo 9, when the secondary starts.

**Files:** src/themes/sky-children/sky-children-cumulus.js (outputNode ~272-282); src/themes/sky-children/sky-children-tsl.js (stormWall return ~687-691); src/themes/sky-children/sky-children-world.js (bowHides ~630-682, for reference)

**Cost:** −1 noise fetch per cumulus fragment (chainVeil skipped) and +2 ALU in the storm wall. 0 draws, 0 triangles.

**Skeptic:** not verified (minor finding).

### `bow-5` [minor] The fogbow can't be seen in any layout, yet it costs every Deep fragment

**Evidence:** From the solver at 16:9: A is at (1082,797) and Rfog = R1 − 3° ≈ 38.4°. The fogbow's only on-screen arc is the left leg below the horizon, from about (530,558) to (491,900). That is 3° inside the coloured leg, inside U.sprayColumn and behind the Mother Fall's plume (x 380-560, y 500-900), where `1 − masks.x·0.5` also halves it. The rest of the circle is off-frame. In the smile plan it lies under the card.

In b06 (Pearl, whose hours.js comment promises 'the brightest fogbow', fogbow 0.1) nothing is readable at (470-560, 560-900). The same holds in b02, b03 and c1.

**Why it matters:** The design record promises an optic that never shows, while its LUT fetch and about 15 ALU run per fragment on both the sea and the dome's Deep. Either the picture should show it or the budget should not pay for it.

**Critic's fix:** Recommended: remove it.
1. Delete the fogbow block in sky-children-tsl.js optics() (~932-945).
2. Drop the `fogbow` HOUR_SCALARS row in sky-children-hours.js (line 134) and its SCALAR_UNIFORMS entry in world.js.
3. Keep or retire LUT row 2 in core.js bakeOpticsLut, updating the OPTICS_ROWS tests together.
4. Correct the design record and the Pearl comment.

Alternative, if it must stay: give it a moment where it can be seen. For example, on the smile plan's quad, or only at board=0 idle where the plume is not between the eye and the leg, boost U.fogbow about 4x for 1.5 s, gated by the sea's cover. Verify with a capture before keeping it.

**Files:** src/themes/sky-children/sky-children-tsl.js (optics() fogbow block ~932-945); src/themes/sky-children/sky-children-hours.js (fogbow row 134); src/themes/sky-children/sky-children-core.js (bakeOpticsLut row 2); docs/SKY_CHILDREN_VISUAL_OVERHAUL_2026-10.md

**Cost:** Removal saves about 1 fetch and about 15 ALU per Deep fragment (sea and dome) and about 0.3 KB WGSL on every tier. The alternative costs 1 uniform write and nothing else.

**Skeptic:** not verified (minor finding).

## gates: 3 → 6

**What improved (the critic):** The architecture has a real vocabulary and a scale ladder now: a 17 m gateway, a ~40 m aqueduct and a 2 km gate, all one masonry family. Before, it was one naked U pasted at three sizes.

**Far Gate (b02 x1240-1450 y305-590, b09):** It went from a pale paperclip to a ruin in three planes.
- It is yawed 0.36 rad, so the soffit (b09 x690-850) and the left return take darker values than the lit face. That gives real volume.
- It has a ring of voussoirs with joints, impost slabs, an attic with a scalloped crown and a sheared right shoulder.
- It sits clear of the HUD, its head well below the altocumulus deck.
- The hours now carry it as a mass, not a ghost: a navy silhouette darker than the night sky (b05), coral at Rose (b04), cool grey at Jade.

**Spring gateway (b07 x390-475 y165-265):** The bronze croquet hoop is now a stone gateway: a 3-step plinth on a levelled pad, square piers with imposts, 11 voussoirs with a proud keystone, and the bell hanging from the keystone. It is the correct near rung.

**Twin aqueduct (b09 x665-800 y600-665; critique/gates-x1-foot.png x690-970):**
- The cardboard 'm' became a two-tier arcade: 4 + 8 bays, a string course and a channel.
- The piers are sunk into the turf along the promontory, and the span's fall leaves from the channel's broken end.
- The masonry is mid-value with courses, so the terraces stay whiter.
- It is the best piece of architecture in the theme now.

**Overlook (b18):** The levitating pancake crags are replaced by a newel, a balustrade and a ledge that runs back under the camera. A tilted lens now finds ground, and human scale exists.

**Far archipelago (b01):** It floats at many heights in bands, some crowns carry ruin stubs, and the left horizon is populated. It is no longer a fence of identical cups.

What still holds it at 6 rather than 8:
- In the gameplay frame the gate's contact with its ground is erased.
- The phone layout still crops the gate.
- The piers render as smooth tubes.
- The aqueduct sits framed in the gate's opening.
- The gate's water story (notch and drape) does not read.
- The parapet reads as dark navy primitives.

### `gates-1` [major] In every gameplay frame the Far Gate's piers fade into fog; its plinth and mesa (the ground it stands on) are never seen

**Evidence:** b02 crop (critique/gates-crop-b02-gate.png): both piers (x1255-1300, x1390-1435) fade out at y~560-570 into a milky band. The mesa crown (x1205-1560, y575-610) is a ghost plate at the mist's own value. critique/gates-x1-foot.png (iconFov 12 at the gate's foot, Jade): the piers dissolve at y480-530. The 3-step plinth is only a faint outline (x740-1340, y505-530), the mesa reads as fog, and the fallen blocks are invisible. b01, b03 and b17 show the same.

**Why it matters:** The owner asked that every arch stand on solid ground, aligned with it. The grounding audits made that true in the geometry, but the picture never shows the contact, so the colossus still reads as two shafts rising out of cloud. A visible footing (stepped plinth, block rubble, mesa edge) is also the strongest scale cue the gate could carry.

**Critic's fix:** The cause is the placement. sky-children-plan.js (gate block) sets e.pos[1] = -0.12*H = -264 m, so the mesa crown is ~1.2 deg below the horizon. That puts it inside the Deep-mist term of createStoneMaterial's far branch (sky-children-isles.js). At -264 m and 13 km, tau_mist ~1.1 plus tau_air ~1.4 gives T ~0.08, and the painter's floor smoothstep(-10,40,y)*0.22 is zero there.

Fix:
- Set e.pos[1] = +40, so the mesa crown and plinth sit just above the eye.
- Re-solve the scale as (tan(elev)*dist - e.pos[1])/(H - sink). The head stays at headY and the gate gets ~12% shorter.
- Result: the 135 m plinth (~20 px at gameplay) and the fallen blocks silhouette against the horizon sky at T ~0.27 with the 0.22 floor, and the mesa's cliff dissolves below into the Deep, so it floats like the far isles.
- Check that the Twin's crown (b02 y~590) stays below the plinth line (~y555-575). Casters 3 and 7 follow because they are entry-relative.
- Add a plan test: plinth top world y >= +20 m in leg plans.

Alternative, if the owner wants the gate low: pass a groundY option to createStoneMaterial so the mist term starts at the gate's crown, not at y=0.

**Files:** src/themes/sky-children/sky-children-plan.js (placePlan, gate block); src/themes/sky-children/sky-children-isles.js (createStoneMaterial far branch, only for the alternative)

**Cost:** CPU only (plan solve). 0 tris, 0 draws, no shader change on the main route.

**Skeptic:** PENDING at export.

### `gates-2` [major] Portrait still crops the gate: two pink shafts hang from the top edge, the head is off-frame (unchanged since a16)

**Evidence:** b16 (critique/gates-crop-b16-top.png): x305-385, y0-100. The two piers and the springing of the voussoirs run off the top edge and the head is not in frame. This is the same failure as a16 x265-360, y0-100; only the hue changed.

**Why it matters:** On a phone this is the only gate the player sees, and it reads as two light beams or pipes. A cut-off colossus also flattens the far plane and draws the eye to the frame edge, right above the card.

**Critic's fix:** Cause: the smile branch of sky-children-frame.js hard-codes out.gate = {x: 0.8, head: 0.2}. In portrait the horizon sits at y~0.115, so the head target is below the horizon. placePlan then gets elev < 0 and a raw scale < 0.12, and clamp(...,0.8,1.6) floors it to 0.8: a ~1.7 km gate taller than the whole strip above the horizon.

Fix:
- In the smile branch, set out.gate.head = max(0.025, horizon*0.35).
- In placePlan, let the scale clamp fall to ~0.25 when the frame is a smile.
- If the solved scale is still < 0.3 (a stub under ~25 px), drop the gate behind the card (x ~0.5) and skip casters 3 and 7.
- Add plan tests for 430x932 and a 2-board row: the projected gate rect has y0 >= 0.02 and lies inside the frame.

**Files:** src/themes/sky-children/sky-children-frame.js (smile branch, out.gate); src/themes/sky-children/sky-children-plan.js (gate scale clamp)

**Cost:** CPU only. 0 tris, 0 draws.

**Skeptic:** PENDING at export.

### `gates-3` [major] The Far Gate's piers render as smooth round tubes with no base or capital, so 55% of the monument is featureless pipe

**Evidence:** b02 crop: the piers (x1255-1300, x1390-1435, y375-570) shade as a soft left-to-right cylinder gradient with no planes, no base and no capital other than the impost slab. critique/gates-x1-foot.png (x440-690, x925-1170): plainly two drainpipes. b09 (x540-660, x775-880): the heavy attic block appears balanced on two stilts. Compare r-ice-temple: its octagonal columns are flat-faceted, with base and capital rings, and read in 3-4 value bands.

**Why it matters:** Against a lit sky, silhouette and big planes are all that read at 13 km. Smooth cylinders carry no masonry and no scale, and they turn the gate's lower half into an industrial or chimney read that fights the ruin above them.

**Critic's fix:** Cause: in buildFarGate the piers are 8-sided CylinderGeometry, but mergeVertices followed by computeVertexNormals averages the facet normals into a smooth cylinder.

Fix:
- Use `const w = g.toNonIndexed(); w.computeVertexNormals();` instead. With the key from behind the eye, the front facets stay lit and the oblique ones fall to ~40-60%, giving each pier 3-4 vertical value bands.
- Increase the batter from 1.18 to 1.3.
- Add a flat-shaded octagonal base (frustum radius 1.45 to 1.35, 0.03H tall) on the plinth's top course.
- Add a capital under the impost block (inverted frustum 1.0 to 1.4, 0.035H tall).
- Keep each step >= 45 m proud of the shaft, because the depth buffer resolves ~35 m at 13 km (see the overhaul doc).

**Files:** src/themes/sky-children/sky-children-isles.js (buildFarGate, battered piers block)

**Cost:** About +130 tris (base and capital, 2 frusta x 2 piers) on every tier. Vertex count +~150 from flat shading. 0 draws, no shader change.

**Skeptic:** PENDING at export.

### `gates-4` [major] The Twin's aqueduct stands centred inside the Far Gate's opening, at its foot, in every landscape frame, which collapses the scale

**Evidence:** - b02: the aqueduct (x1320-1405, y576-600) sits in the gate's opening (inner pier edges x1300-1390), and the Twin's fall drops along the left pier's inner line (x1310-1330).
- b17: aqueduct at displayed x1680-1755, opening at x1650-1745.
- critique/gates-x1-foot.png: the arcade (x690-970) is framed exactly between the piers (x690 and x925).
- b01 and b03-b06 share the layout.

**Why it matters:** Two arcades on one axis read as one structure: the gate with a little arcade at its threshold. The 820 m vs 13 km depth, which is the point of the ladder, collapses into a single object. The original gate-2 brief said explicitly that the Twin must 'never sit inside the opening'; the rebuild did not encode that rule.

**Critic's fix:** Cause: placePlan pins the Twin at x 0.89, and its aqueduct runs along local -x to land at ~0.825-0.878. gateAnchor (sky-children-frame.js) seeks GATE_ROOM.x 0.85 clear of the bow only and knows nothing of the Twin.

Fix in placePlan, after both are placed:
- Project the aqueduct's ends: entryToWorld on the twin entry at isleAnchors().aqueduct.x and x - L - stub, at its top.
- Project the gate's opening: bearing +/- atan(0.2*W*scale*cos(0.36)/dist).
- If the aqueduct's midpoint lies inside the opening (+/- 0.01), step the gate right in 0.005 steps. Today its right edge is ~0.91 and 1.03 is allowed, so ~0.04-0.05 puts the left pier over the aqueduct and the Twin's crown overlaps the gate's left foot.
- Re-check the bow clearance that gateAnchor uses. If it fails, shift the Twin to ~0.92 instead.
- Cleaner option: pass the aqueduct's projected span into gateAnchor as a second keep-out.

Add a plan test for 16:9, 21:9 and 2-board layouts: the aqueduct's midpoint is never inside the gate's opening.

**Files:** src/themes/sky-children/sky-children-plan.js (placePlan, twin and gate blocks); src/themes/sky-children/sky-children-frame.js (gateAnchor)

**Cost:** CPU only. 0 tris, 0 draws.

**Skeptic:** PENDING at export.

### `gates-5` [major] The attic skyline reads as a step and a pitched roof: the weir notch is a proud pale block, the break a straight ramp, and the water story is illegible

**Evidence:** b02 crop: at x1338-1368, y318-345 a pale block stands proud of the attic. Its top is a step below the left attic and barely below the right shoulder. At x1365-1450, y320-375 one straight 35 deg ramp runs down to the corner. b09 (critique/gates-crop-b09-attic.png): the 'drape' is a lit key block (x690-740, y68-98) and the break is a smooth sloped slab (x740-880, y70-180). Overall: a 'shed' silhouette, with no ragged courses and no rubble.

**Why it matters:** At 13 km the silhouette is the only detail that reads. A clean ramp says 'designed roof', not 'ruin'. A notch with one 36 m wall is not a notch. The weir and drape are the only thing that ties the gate to the theme's one idea (water) and to its perfect-clear spillway, and at rest nothing shows it.

**Critic's fix:** Measured in buildFarGate (W 1400, H 2200):
- notchY = atticBase + 0.55*(H - atticBase) is ~2109 m, but the right lip shoulder(notch) is ~2145 m. The notch has a 91 m left wall and a 36 m right one.
- The travertine fill is extruded W*0.34 deep centred on z = 0, so its face stands ~112 m proud of the wall face (wallFront 0.09W). It reads as a block.
- The shear is a single segment from [x0, atticBase] to [notch, shoulder(notch)].

Fix:
- **(a) A real U-notch:** notchY = atticBase + 0.15*(H - atticBase). Keep a right lip ~0.06W wide at >= 0.96H before the shear starts, so both walls rise ~150 m over the notch floor.
- **(b) The drape as a skin:** the travertine's face only ~45-50 m proud of the wall (above the ~35 m depth resolution). Widen it from +/-notch to +/-1.5 notch down over the three travertine keystones, scallop its lower edge (5 lobes, reuse buildTerraces' curtain lobes) and run 2-3 tongues down the soffit's crown.
- **(c) The break as a seeded stepped polyline:** 5-7 treads and risers along the 35 deg line. Each riser is ~40 m (~5 px at gameplay). Add 2 tilted loose blocks (hexa) on the treads.
- Update profile.topAt and floorAt so the grounding tests follow. The world's spillway lip (anchors.weir) picks up the new notchY.

**Files:** src/themes/sky-children/sky-children-isles.js (buildFarGate: notch, travertine wall, right-wall outline, profile)

**Cost:** About +100-150 tris on every tier. 0 draws, no shader change. Grounding and profile tests need updating.

**Skeptic:** PENDING at export.

### `gates-6` [minor] Near pieces are crude: the parapet reads as navy primitives with a pawn baluster, and the gateway's two upright stubs read as votive light

**Evidence:** **Parapet:**
- b02 (critique/gates-crop-b02-bl.png and -br.png): a near-black navy newel under a pale mushroom cap (x25-175, y725-900). A lone vase baluster with no rail reads as a chess pawn (x1280-1300, y825-880). A navy slab has a pale sloped top (x1365-1440, y805-900). The mortar shows as dashed lines.
- b18: the ledge is a flat untextured box (x0-880, y400-900).
- In b02/b04/b05/b17 the corners are the most saturated dark blue on screen.

**Gateway stubs:** b07 (critique/gates-crop-b07-gateway.png). In b07 frame coordinates, the two upright broken-column stubs (x413-422 and x450-458, y230-310) flank the way on the stepped plinth under the hanging bell.

**Why it matters:** Repoussoir should be dark but read as weathered stone carrying a warm sun-line. These read as stray primitives in the player's periphery in every frame. The upright pale stubs before a bell turn the gateway into a votive light shrine, which is the motif family the IP guardrail bans.

**Critic's fix:** **Parapet:**
- Cause: in createStoneMaterial's shadeBelow path the sun-line is gated by smoothstep(0.6,0.92,1-nv), so tops seen from above (nv ~0.2-0.4) get almost no key. Everything else is albedo x fill (light.shadow-weighted) x 0.4, which is saturated navy at L* ~10.
- Add a warm bounce (albedo*light.stone*0.1) and fill x1.4, so the corners sit near-neutral at L* 18-25.
- Drive the sun-line from N.y > 0.5 within 0.3 m of the piece's top (pass userData.top as sunTop), not from grazing (1-nv), so cap and rail tops carry a warm line.
- Add a `detail` multiplier (x8) to sampleStone for the corner material. At 0.028/0.093 per m a 14 m ledge gets one blotch.
- In buildLedge, raise the top fBm to ~0.25 m and give its hollows moss weight.
- In buildParapet(false), replace the lone baluster with a snapped 2-baluster rail stub.

**Gateway:** in buildGateway, replace the two upright `cols` cylinders with one drum lying on its side on the top course plus a low square trough, or remove them.

**Files:** src/themes/sky-children/sky-children-isles.js (createStoneMaterial shadeBelow path, buildParapet, buildLedge, buildGateway cols, createIsles cornerMaterial options)

**Cost:** About +40 tris. ~6 ALU, only in the corner material (JS-gated option, other materials unchanged). 0 draws.

**Skeptic:** not verified (minor finding).

## composition: 4 → 6.5

**What improved (the critic):** Landscape (16:9 and 21:9) is now a composed picture rather than mid-value stripes.

(1) A value design with a centre of interest. The left free zone has a real dark and a real light: the storm's dark heart (L* 23-35, b02 x 0.33-0.39) sits beside the cumulus head (L* 76-81), the Mother Fall (L* 86) and the spray column (L* 88). The leg burns across the storm. Left/centre/right thirds read 52/30/52, light flanks round a calm dark card (a02: 46/29/51 with no masses).

(2) The dead cobalt is gone. Combed cirrus fills the upper-left (x 0-0.33, y 0-0.3) and leads toward the isle and the card.

(3) The bow is staged. R1 solves to 41.4° (it was the 46° clamp). The crest no longer hugs the top edge (b15 y 0.07-0.13 vs a15 0.02-0.09; b17 y 0.10-0.20 vs a17 0.00-0.08). It arcs over the HUD, the leg rises out of the spray over the storm, and the glory sits at A in the card/HUD gutter (b13). At combo 13 (b12) the bow frames the board.

(4) There is a right counterweight. The Far Gate is a large ruined arch in three planes (x 0.77-0.93, y 0.34-0.64), no longer a hoop the twin's size. The archipelago floats at many heights instead of a bead string.

(5) Depth reads through a scale ladder (a 1 m baluster, the 72 m isle, the 2 km gate) and haze steps. The Spring Isle is larger and less wedged against the edge (x 0.07-0.29).

(6) 21:9 (b17) is now the strongest frame: the left 15 % is no longer empty and the crest is a clean arc right of the card.

(7) The hours keep their moods inside the same structure (b04, b05).

Still weak:
- Phone and rows of boards are unchanged aerial surveys (about 4/10).
- The new foreground parapet reads as UI furniture.
- The right group is placed at fixed frame x, so it collides with the gate's mesa at 16:9 and with the HUD at 4:3.

### `composition-1` [major] Phone and rows of boards are still the aerial-survey smile; the planned crown plan (PLAN decision 6, comp-5) was never built

**Evidence:** b16 (430x932): frameFor gives plan=smile, pitch −28.7°, horizon 0.088. About 85 % of the frame is cloud sea seen from above.
- The Spring Isle (0.07, 0.37) stands half behind the card; its crown is a flat disc and its dark root ghosts through the card (x 0.17-0.42, y 0.22-0.47).
- The gate is reduced to two pillar stumps cut by the top edge (x 0.72-0.90, y 0-0.08).
- The archipelago is a row of about 10 same-size inverted cones along y 0.04-0.13.
- The bow is a smile under the card (y 0.80-0.89). frameFor strokes1 are 7 × 0.06 frame heights, so a link paints a sliver of about 55 px.

critique/comp-x1-two-boards.png (1600x900, players=2): pitch −24.8°, horizon 0.066, the sky a 6 % strip with a bead row of cones. The Spring Isle is a green plate at the left edge. The parapet ledges become two huge navy slabs seen from above (x 0-0.33, y 0.80-1.0 and x 0.70-0.95, y 0.83-1.0), because the corners only shrink when aspect < 1. bow-c2-portrait-jade12 shows the same at Jade.

**Why it matters:** The premise is the overlook: isles in silhouette against the sky and the bow as an arch over the board. It vanishes on a phone (a primary layout) and in local multiplayer, where the frame reads as a map with UI on top. Links on a phone are too short to read as events. This is the largest gap left to the siblings.

**Critic's fix:** Build the crown plan as already decided (PLAN §P6 step 2), keeping the smile only as a fallback.

sky-children-frame.js:frameFor
- Add a 'crown' branch for a < 1 and for cards.length > 1.
- setPlan horizon 0.5 on a phone and 0.55 for rows of boards (pitch ≈ 0).
- A at x = union centre. Solve yA (depression 8-14°) so the crest's y = union.y0 − 0.035, with R1 clamped to [40°, 42°].
- A crownOrder replaces smileOrder: left margin, then the crest left to right, then the right margin.
- On a phone, 5 primary strokes on the crest, each ≥ 0.08 frame heights (exempt the crown cut from MIN_STROKE). R2 ≥ R1 + 5°.
- gloryVisible false, with the opposition glow on A's vertical in the bottom band.

sky-children-plan.js:placePlan, crown branch
- spring at x = free.left·0.3 (cropped by the left edge), y +40, full dist, with the fall down the margin
- twin mirrored at 1 − free.left·0.3
- on a phone no gate, or only its outer pier cropped at x ≈ 1.02
- archipelago at elevation 0.5-3° and at most 6 isles, in the side margins and the top band only
- the corners anchored at y ≥ 1.12 whenever pitch < −5°, so their ledges never show their tops

sky-children-world.js:applyFrame: a crown branch for the shower and the bowDeep.

Tests at 430x932, 390x844, and 2 and 4 boards:
- horizon in [0.45, 0.6]
- crest above union.y0
- legs clear of the calm rects
- every primary stroke ≥ 0.08

Capture b16 and two boards before and after.

**Files:** src/themes/sky-children/sky-children-frame.js (frameFor/setPlan, smileOrder → crownOrder, paintStrokes), src/themes/sky-children/sky-children-plan.js (placePlan smile branch, corners), src/themes/sky-children/sky-children-world.js (applyFrame shower/bowDeep/oppRest), tests/unit/sky-children-frame.test.js, tests/unit/sky-children-plan.test.js

**Cost:** CPU only: solver, plan and tests. Zero triangles, draws and shader bytes on every tier. Medium-high complexity (a new plan branch, stroke ordering, tests, 2-3 verification captures).

**Skeptic:** PENDING at export.

### `composition-2` [major] The foreground parapet reads as UI furniture: two small navy boxes of the card's value that close inside the frame and frame nothing

**Evidence:** b02 crop (critique/comp-crop-b02-BL.png, -BR.png):
- Left: a lone 2 m newel post at x 0.02-0.10, y 0.81-1.0 is a flat navy box with a pale cap. Its balustrade lies below the frame's bottom edge (the anchor is unproject(0.02, 1.07)), so not one baluster shows at 16:9 or 21:9 (only a rail sliver at x 0-0.03, y 0.92-0.95).
- Right: a slanted dark slab (x 0.85-0.92, y 0.89-1.0) plus a lone baluster at x 0.80, next to the HUD. In b17 they read as a bin and a mailbox.
- Values: post L* 15 (rgb 18,40,53) vs card L* 16 (30,40,51) and HUD L* 13-15. Across hours the post is L* 9.3 / 7.5 / 18.1 (b03 / b04 / b06) against card and HUD at 13-17, always in the same slate-violet family.
- PLAN's own rules are broken: 'silhouettes run out through the frame edges and never close inside the frame', and 'bottom-right is natural ledge rock with grass'.
- The left post also stands parallel to the isle's root tip (x 0.13-0.20), two vertical stubs side by side.

**Why it matters:** The foreground is the plane that says 'you stand here' and starts the scale ladder. As two isolated boxes in the UI's value and hue, it reads as third and fourth dark rectangles beside the card and HUD. It adds two new focal points in the bottom corners and frames nothing. The siblings' coulisses (r-golden-forest boughs, r-ice-temple columns) are big masses entering from the edges.

**Critic's fix:** Left, sky-children-isles.js:buildParapet(true):
- Newel height 2.0 → 1.25 m, so it reads as a rail post rather than a chimney.
- sky-children-plan.js:placePlan cornerL anchor (0.02, 1.07) → about (0.06, 1.0), so the rail and 3-4 balusters run in from the left edge along y ≈ 0.90-0.98.
- buildLedge x1 3.5 → about 1.5, so the ledge top stays ≥ 0.95 under the leg's x (0.22-0.29). recutStrokes already treats the parapet as an occluder.

Right, buildParapet(false): replace the stub, rail and baluster with the planned low natural ledge rock (a smoothed buildLedge slab, or a low-frequency displaced boulder). It runs out through the right and bottom edges with its top ≤ y 0.92, so there is no second masonry box beside the HUD.

Shading, createStoneMaterial shadeBelow branch: the fill is mix(light.shadow, skyUp) × 0.4, which is pure cobalt. Add a warm bounce off the sunlit overlook floor:

fill += albedo · light.key · 0.10 · (1 − N.y·0.5)

Also widen the key line along the rail's and cap's top edges, giving a warm-grey body at L* 22-30.

Acceptance:
- parapet vs card/HUD ΔL* ≥ 10 at every hour
- at least 3 balusters visible at 16:9 and 21:9
- the corners cover < 10 % of the bottom band with two boards (with composition-1's anchor rule)

**Files:** src/themes/sky-children/sky-children-isles.js (buildParapet, buildLedge, createStoneMaterial shadeBelow/fill, cornerMaterial), src/themes/sky-children/sky-children-plan.js (placePlan corners), src/themes/sky-children/sky-children-world.js (parapet hull for recutStrokes, check only)

**Cost:** About +0.3-0.6 k triangles: 3-4 more visible lathe balusters at about 160 tris each, and the ledge rock replaces the stub. Zero draws, a few ALU in one material, every tier. Low-medium complexity.

**Skeptic:** PENDING at export.

### `composition-3` [major] The right group stands at fixed frame x, not from the HUD: the Twin's crown lands on the gate's mesa line at 16:9/21:9, and at 4:3 the gate stands behind the HUD

**Evidence:** 16:9, b01/b02 crop (critique/comp-crop-b01-twinmesa.png):
- The mesa's top line is at y ≈ 0.625, the Twin's aqueduct top at 0.633 and its crown at 0.64-0.68. The aqueduct stands exactly at the gate's pier feet, so the 2 km arch seems to rise from the 46 m isle.
- frameFor/placePlan: Twin crown (0.892, 0.665) vs gate base (0.851, 0.643); at 21:9 (0.892, 0.671) vs (0.841, 0.646).
- The piers' feet dissolve into the haze (pier L* 72.0 vs sky beside 71.1), while the attic is +11 L* over the sky beside the crown, so the visible 'ground' is the Twin.

4:3, critique/comp-x2-4by3.png (1024x768, board, combo 4):
- gateAnchor finds no x with x0 ≥ HUD.x1 + 0.02 and x1 ≤ 1.03, so it returns GATE_ROOM.x 0.85. The gate spans 0.759-0.951 against HUD x1 0.834.
- Its broken shoulder and left pier stand behind the HUD and ghost through the panel (+3 L*, warm 39,38,51 against the panel's cool 26,33,53).
- Only the right pier and half the arch show.
- The Twin's left flank (x 0.835) touches the HUD's right edge.

**Why it matters:** The right group is the counterweight to the Spring Isle, and the 1 m → 46 m → 2 km ladder is the frame's depth device. A shared ground line collapses two planes into one and inverts the scale. At 4:3 (iPads, many laptops) the counterweight is cut by the UI, the worst possible tangent. It also undercuts the owner's explicit ask that every arch visibly stand on its ground.

**Critic's fix:** Twin, sky-children-plan.js:placePlan
- x = max(0.91, free.right + twinHalfWidthFrame + 0.03), not a constant 0.89.
- PLAN.twin.y −45 → about −5. Its crown and aqueduct then cross the right pier at mid-height (an arcade in front of the colossal arch), while the left pier's foot and the mesa's left half stay clear.
- This is the plan's own acceptance: 'the twin's crown overlaps the right pier and the mesa shows'.

Gate, sky-children-frame.js:gateAnchor
- When no x passes, never return a position with x0 < right + 0.02.
- First allow the outer pier to be cut by the right frame edge (x1 up to about 1.10, the comp-6 coulisse crop).
- If that still fails, shrink: lower plan.js's gate scale clamp 0.8 → 0.6, with GATE_ROOM.half scaled to match, so it fits beyond the HUD.

Tests (plan/frame) at 4:3, 16:10, 16:9 and 21:9:
- gate hull x0 ≥ hud.x1 + 0.02
- twin hull x0 ≥ hud.x1 + 0.02
- |twin crown y − mesa top y| ≥ 0.04
- the left pier's foot visible

**Files:** src/themes/sky-children/sky-children-plan.js (PLAN.twin, placePlan twin/gate scale), src/themes/sky-children/sky-children-frame.js (gateAnchor, GATE_ROOM), tests/unit/sky-children-plan.test.js, tests/unit/sky-children-frame.test.js

**Cost:** CPU placement only. Zero triangles, draws and shader bytes. Low complexity; recheck the casters' wedges (slots 3 and 7) and the twin falls' spray after the move.

**Skeptic:** PENDING at export.

### `composition-4` [minor] The altocumulus deck survives only as a residue squeezed between the HUD's calm fade and the gate's clearing, tracing the HUD's edge

**Evidence:** - b01 (no board): the deck is a vertical ribbon at x 0.64-0.82, y 0.25-0.50.
- With the HUD (b02, b03, b14, b15): a lone sticker cloud at x 0.77-0.82, y 0.27-0.30, between the HUD edge (0.735) and the gate's crown, plus a stack of flecks cut by the right frame edge at x 0.94-1.0, y 0.36-0.50.
- b17 (21:9): a vertical column at x 0.69-0.75, y 0.25-0.60, parallel to the HUD's right edge about 0.01 away, L* 67 against a sky of 43 (critique/comp-crop-b17-R.png).
- comp-x2 (4:3): flecks cut by the right edge at x 0.86-1.0, y 0.27-0.36.

**Why it matters:** What is left after calm.mul(0.8) on one side and the gate's clear on the other is a bright vertical sliver that rhymes with the HUD's edge. It is a tangent to the UI, competes with the HUD and the gate, and reads as the sticker clouds the overhaul removed elsewhere.

**Critic's fix:** sky-children-tsl.js:altoDeck. Either option works:

(a) Gate the deck by its room. In world.js:applyFrame compute the frame width between hud.x1 + the calm fade and the gate hull's x0, and between the gate hull's x1 and the frame's right edge. Pass it as one float uniform (U.deckRoom), and multiply `zone` by smoothstep(0.08, 0.16, room). The deck is then simply absent where it cannot lie as a field.

(b) Better, re-key `zone` from a bearing window to a horizontal band ABOVE the gate's crown: up between U.gateSky.z + 0.03 and the existing under-the-crest mask, across bearings right of the HUD. The deck then lies as a receding drift between the gate and the crest, never as a column.

Acceptance: no deck cell within 0.04 frame widths of a calm rect or of a frame edge, at 16:9, 21:9 and 4:3.

**Files:** src/themes/sky-children/sky-children-tsl.js (altoDeck zone), src/themes/sky-children/sky-children-world.js (applyFrame: the deck's room uniform)

**Cost:** Sky dome fragment only: one uniform and about 3-6 ALU, < 0.2 KB WGSL (about 40 of 64 KB). Zero geometry, every tier.

**Skeptic:** not verified (minor finding).

### `composition-5` [minor] The gliders are still confetti spread over every free region (comp-9b's two composed flocks not built)

**Evidence:** b02: about 20 white paper gliders of 6-10 px are spread evenly across the frame:
- over the upper-left cirrus: (220,170), (322,252), (226,286), (338,330)
- round the spray: (497,447) to (588,710)
- across the right sky: (1405-1530, 260-310) and (1525,120)
b12, b17 and comp-x2 show the same. plan.js thermals are unchanged at (0.27,0.56), (0.18,0.33), (0.86,0.3), (0.95,0.62), (0.33,0.78), and QUALITY.gliders is 28 at High.

**Why it matters:** Evenly spaced specks read as dust on the cirrus rather than a flock, and add noise to the two quiet areas the frame has (the upper-left sky and the sky over the gate). Grouped, they would be a living leading line along the bow.

**Critic's fix:** - sky-children-plan.js:placePlan thermals → two anchors: (0.20, 0.28) over the Spring crown, and (0.84, 0.18) under the crest right of the HUD. The smile/crown frame uses (0.12, 0.30) and (0.88, 0.25).
- sky-children-quality.js: gliders aloft at High 28 → 14 (Extreme 18, Minimal 8). The rest stay perched on the terraces.
- sky-children-flock.js: transit flights follow the primary's arc (bowPoint) between the two thermals.

**Files:** src/themes/sky-children/sky-children-plan.js (thermals), src/themes/sky-children/sky-children-quality.js (gliders), src/themes/sky-children/sky-children-flock.js (flight paths)

**Cost:** Data only, with fewer instances aloft. Zero draws and shader bytes; slightly fewer triangles. Low complexity.

**Skeptic:** not verified (minor finding).

## atmosphere: 4 → 6

**What improved (the critic):** The lower half of the frame is fixed. Before, the Deep was a navy void that read as water at dusk. Now it is a lit sea of cloud. In Jade the sea round the card measures (145-175, 150-175, 155-182) where a02 had (36-90, 53-107, 80-122), and the bottom half's mean OKLab L went from 0.551 to 0.628. Night is the most improved hour: the moonlit sea (76,88,134) is now brighter than the horizon sky (41,53,111), the classic moonlit cloud sea. In a05 the sea was half the sky's value. The Milky Way is grained and has dust lanes. The moss goes grey by moonlight (crown 47,56,71 in b05).

The Far Gate is a solid colossus a few shades off its sky in every hour, and at Rose it turns salmon (207,126,137) against the pink belt (gate strip, critique/atmosphere-gate-strip.png). Anticrepuscular lanes now run across the sea and converge under the HUD (b04, b06 at x 1000-1250, y 600-800). The frame has a light direction it lacked before.

The stone reads in three values. In Jade the cliff and root measure (63-99, 74-105, 83-104), with a cool sky rim and the Deep's bounce under the overhang, where the before was one flat near-black.

The hours now differ in value key as well as hue. Mean OKLab L is Jade 0.597, Gilded 0.554, Rose 0.490, Night 0.390 and Pearl 0.658: Pearl is now a high-key hour with no stars. Gilded has a real gold haze on the right horizon (220,183,131). The rose-to-night crossing (x3, hour=2.5) stays chromatic lilac and never turns to mud. Bloom headroom was reopened (threshold 1.3). On a picture-for-picture basis this moves from a tinted diorama to a lit place. What holds it under the siblings is that the light still has one geometry, the antisolar point is dark, the far isles glow like glass, and nothing is authored in HDR.

### `atmosphere-hours-one-light` [major] Five hours, one light: Rose, Pearl and Gilded are recolours of the same lighting, and the Earth's shadow is still a stripe

**Evidence:** Gilded close-up b07 vs the same lens at Rose (critique/atmosphere-x2-rose-isle.png; side by side in critique/atmosphere-b07-vs-rose.png). The Spring Isle has the same shading, terminators and cast shadows, only tinted: cliff/crown luminance ratio 0.43 (Gilded) vs 0.36 (Rose), the crown fully lit at both ((106,99,53) and (107,71,59): olive turf under a pink key reads as ochre mud). b04 at x=1000: belt 232 at y 450, then a mauve dip (169,123,162) at y 510-540 that brightens again to (191,140,171) at the horizon. The dip is not the blue #46598f the row asks for, so it reads as a stripe across a pink sky. Stars (hours.js stars 0.15 at Rose) shine over a fully sunlit crown (b04 top-left). Pearl (b06) is Jade's light under a lavender filter. Crossing x3 (hour 2.5): the whole frame is one lilac family. HOUR_REST 0.15 means about 70% of screen time is a crossing like this.

**Why it matters:** This was the time-of-day finding (atmo-4) and none of it landed. HOUR_SCALARS.keyNudge (hours.js:127) is still dead: SCALAR_UNIFORMS (world.js:71) leaves it out and applyFrame writes U.key = -A for every hour (world.js:545). No terminator exists. skyBase's earthShadow is still a Gaussian at 1.5±2.5° (tsl.js:47, 218-220), and the antisolar lobe and the Deep's luminous wall brighten the horizon again underneath it. Each hour should be a different light, not a LUT. Rose is the obvious case: pink-lit crowns and the gate's top over violet-blue roots, Twin and sea is exactly the warm/cool structure that makes r-himalayan beloved, and the subject here is built for it.

**Critic's fix:** (1) A shading key separate from the bow. Add hour rows keySwing (azimuth deg: 10, 14, 6, 0, -8) and term (weight: 0, 0, 1, 0, 0.7), and use termElev/termY (Rose 4° / +10 m, Pearl 2° / -30 m). In world.js applyHour, write U.shadeKey = -A rotated by keyNudge (elevation) and keySwing (azimuth), and U.term = vec4(Axz unit, tan termElev, termY). Read U.shadeKey instead of U.key in sky-children-isles.js:2083 (the stone's L), sky-children-sea.js:147, sky-children-cumulus.js:254, sky-children-falls.js:368 and sky-children-fx.js:253. optics(), antiRays and casterShadow keep U.A/U.key, so the bow does not move. (2) Earth's-shadow terminator: sunlit = mix(1, smoothstep(-25, 25, P.y - (U.term.w + dot(P.xz, U.term.xy)*U.term.z)), U.termWeight). It multiplies only the key term in stone, sea, cumulus and falls, never the lamps, hearth, pools or glider glow. Because the weight mixes linearly, the shadow fades in through the Gilded-to-Rose crossing instead of snapping. (3) In tsl.js skyBase, replace the Gaussian with a band rising from the horizon: shade = smoothstep(eS+1.2°, eS-0.4°, elev)*lobe*twilight. Scale the antisolar horizon lobe and deepColour's luminous wall (exp(-10*below)*0.55) by (1 - 0.7*twilight*lobe) so the blue band sits on the horizon and continues onto the sea. (4) stars row → (0, 0, 0.03, 1, 0). Add the new rows to the hours test and to SCALAR_UNIFORMS in the same change. Verify Rose and the 1.5 / 2.5 crossings in the playground.

**Files:** src/themes/sky-children/sky-children-hours.js, src/themes/sky-children/sky-children-world.js, src/themes/sky-children/sky-children-tsl.js, src/themes/sky-children/sky-children-isles.js, src/themes/sky-children/sky-children-sea.js, src/themes/sky-children/sky-children-cumulus.js, src/themes/sky-children/sky-children-falls.js, src/themes/sky-children/sky-children-fx.js

**Cost:** 0 triangles, 0 draws. 4 hour rows, 2 uniforms, one CPU vec3 rotation per frame. About 8 ALU per fragment in 5 materials and the dome, about +0.3 KB WGSL each (dome about 40 of 64 KB). All tiers.

**Skeptic:** PENDING at export.

### `atmosphere-antisolar-dark` [major] At rest the antisolar point is the darkest patch of the lower half in every hour, and even the quad's glory has a dark heart

**Evidence:** A sits at about (1080,795) (the glory's centre in b13). Column at x=1080, y 750-800: b02 Jade 79-112 against 150-190 above and below. Pearl b06 89-123 vs 160-190; Rose b04 67-94 vs 124-152; Night b05 32-49 vs 79-107. Row y=790 is dark from x 1050 to 1290. Crops: critique/atmosphere-b02-A.png (a wide dark band with a hard-edged navy hole in it) and critique/atmosphere-b13-A.png. During the quad (b13) the glory's heart at (1080,765) is still 72, with the rings visible only on the lit sea below the hole.

**Why it matters:** Everything in the frame is composed round A: the bow, the rays, the wedges, the glory. It should be the luminous centre of the cloud sea, and today it reads as a dark lake. Three causes stack. (a) The isle and overlook caster wedges (isles.js setCaster 1/2/6; the overlook's capsule is aimed straight at A) reach A at full shadowDepth. (b) The sea opens holes there (sea.js:140, SEA.hole 0.14), and in them the dome's abyss is still the pre-audit formula: tsl.js:1026-1028, where sink saturates by about 4° down, so at A's 15° depression the hole shows light.deep #132746. (c) The rest opposition glow is additive and gated by deepMist = rim (sea.js:187), and rim → 0 at hole rims, so the glow vanishes exactly where it is needed.

**Critic's fix:** In sky-children-sea.js, compute thetaA once (it already exists for the rays). (1) No holes round A: Discard(cover.lessThan(SEA.hole * smoothstep(6°, 14°, thetaA))). (2) Let the wedges dissolve into the glow at rest: lit *= 1 - shadow*U.shadowDepth*mix(smoothstep(1.5°, 7°, thetaA), 1, U.glory.z), so the quad's deepening wedges still play. (3) A multiplicative rest glow on the sea's own light, not gated by rim: lit *= 1 + (0.35*exp(-thetaDeg/10) + 0.25*exp(-thetaDeg/2.5))*U.glory.w, keeping optics()'s additive boost for the quad (glory.z) on top. (4) In tsl.js deepColour, apply the amended atmo-2 abyss so the remaining holes elsewhere read as depth, not navy water: sink = smoothstep(0.02, 0.55, below); abyss = mix(mix(haze, mistLit*keyGain*0.4, 0.5), deep*1.4, sink*0.55) * mix(0.75, 1.15, exp(-thetaA/30°)). Check b02 (a soft brightening at A) and b13 (a clear step up, glory centred on lit cloud).

**Files:** src/themes/sky-children/sky-children-sea.js, src/themes/sky-children/sky-children-tsl.js

**Cost:** Shader ALU only (about 12 ALU on the sea, about 6 in deepColour), 0 triangles, 0 draws, all tiers. WGSL about +0.3 KB.

**Skeptic:** PENDING at export.

### `atmosphere-far-ghosts` [major] Aerial perspective is inverted on the far archipelago: veiled roots glow brighter than the sea in front of them, as flat frosted-glass cones

**Evidence:** In b02, the gate mesa's root at (1265,610) is (182,206,199) while the sea behind it at (1230,700) is (133,145,158). Gilded b03: (214,176,121) vs (150,137,143), the most saturated gold below the horizon is a far isle's underside. Close-ups: b07 far isle (1020,680) is (211,174,125) against sky (157,129,110) and sea (149,132,137), 1.85x the sea's luminance. Rose x2 is 2.1x. Pixel std ≤ 1 inside those isles (no form at all). The same cones show at b02 (510-560, 520-625) and (1550-1600, 470-525), and as a row of identical lilac ghosts across the top of b16.

**Why it matters:** Mist between the eye and a far mass converges to what lies behind that mass. Here it converges to something much brighter than what lies behind it, so the far isles read as glass or ice instead of stone hanging in a sea of cloud. Because T saturates, all three distance bands collapse to one flat value, and the archipelago's depth stack disappears. Code: isles.js:2286 floors T only above y=-10 (T = max(exp(-tau), smoothstep(-10, 40, y1)*0.22)), so roots are 100% veil. isles.js:2291 veils below the horizon toward mix(light.mistLit, airColour, 0.5), and mistLit (Jade #e2f6ee, Gilded #ffd59a) is far brighter than the lit sea the mesh actually shows. The near stone's mist dissolve (isles.js:2301-2302) uses the same over-bright target.

**Critic's fix:** Export a cheap seaTone(dir, U) from sky-children-tsl.js: the sea's far-field lit colour as sea.js computes it (cloudLight(U, ~0.62, 0, farShade at that depression) blended to horizonHaze toward the horizon with the sea's own air term). In createStoneMaterial's far branch, use veil = mix(seaTone(viewDir)*0.9, skyBehind, smoothstep(-0.02, 0.02, viewDir.y)). That is the below-horizon twin of the existing 0.86 'a few shades under the sky' rule, so a far mass is never paler than what is behind it. Floor T per band (max(T, 0.15) under y=-10), or use per-channel extinction exp(-tau*(0.75, 0.9, 1.25)), so the nearest band keeps a hint of its form and the three bands stack by value. Point the near stone's mist dissolve (isles.js:2301-2302) and the falls' far air at the same seaTone.

**Files:** src/themes/sky-children/sky-children-isles.js, src/themes/sky-children/sky-children-tsl.js, src/themes/sky-children/sky-children-falls.js

**Cost:** About 15 ALU per far-stone fragment, about +0.4 KB WGSL. 0 triangles, 0 draws. All tiers.

**Skeptic:** PENDING at export.

### `atmosphere-no-glow` [major] The scene is still authored in SDR: bloom fires only on the falls' ropes and the bow's leg, and Gilded, the hazy-gold hour, does not glow

**Evidence:** critique/atmosphere-x1-gilded-false.png (falseColor, Gilded, board): nearly the whole frame is green (0.1-0.6). Only the horizon haze, the plume, the gate's piers and a few cap patches on the cumulus tower are yellow (0.6-1.0). Orange (>1.0) is only the Mother Fall's ropes and the bow's leg in the spray. Nothing is red. The Spring cliff, the storm core and the parapet are blue (<0.1). The tower stays mostly under 0.6, although tsl.js cloudLight's comment says the crowns 'run a little over white at the gilded and rose hours and bloom'. b03's mean OKLab b is -0.017 (the frame is still blue overall). The tower (182,173,177) is neutral beside gold banks (220,183,131); the fall core (227,196,166) is matte.

**Why it matters:** The threshold was lowered to 1.3 (post.js:57), but the content was never lifted to reach it. Bloom is paid for at Medium and up and does almost nothing. r-golden-forest and r-sakura get their atmosphere from small hot sources glowing through haze. Gilded is meant to be the theme's glowing hour and reads as a warm grade over a cobalt picture. The per-hour glow scalar from the audit (atmo-6) was not added.

**Critic's fix:** Lift only small hot things into HDR, and let the hour open the knee. (1) In sky-children-falls.js:369 raise keyLight's factor from 0.74 to about 1.1 on the core and ropes (2.5-3.4 at Jade and Gilded, about 1.2 at Night). (2) In cloudLight (tsl.js:260), take `gain` from a new per-hour cloudGain row (0.5, 0.62, 0.58, 0.5, 0.52) so the tower's crown, and only the crown, sits at 1.0-1.3 at Gilded and Rose while its body stays under 1.0. (3) Add a per-hour `glow` row (0, 0.5, 0.3, 0.35, 0.2), passed to the post as a separate uniform, never written into bloomBoost (events and world.js:2208 own that). In post.js:201 use glare *= 1 + (uBloomBoost + uGlow)*0.6, and lower the high-pass threshold by 0.2*uGlow (Gilded about 1.2). (4) Low and Minimal have no BloomNode: raise the falls' mist-skirt gain ×1.4 there. Verify with falseColor that only the falls, glints, crowns and hearth go orange.

**Files:** src/themes/sky-children/sky-children-post.js, src/themes/sky-children/sky-children-hours.js, src/themes/sky-children/sky-children-world.js, src/themes/sky-children/sky-children-tsl.js, src/themes/sky-children/sky-children-falls.js

**Cost:** Parameters and 2 uniforms; the bloom pass already runs at Medium and up. 0 triangles, 0 draws, no WGSL growth worth noting.

**Skeptic:** PENDING at export.

### `atmosphere-hearth-sticker` [minor] Night's only warm note is a clipped peach sticker on the face of the Mother Fall, and it lights nothing

**Evidence:** b05 (385-445, 498-512), crop critique/atmosphere-b05-hearth.png: three flat blobs clipped to (254,198,140) drawn ON the curtain's front, the same at the 2.5 crossing (x3). The stone 15 px to the left is (14,14,34), the root and the lip's underside round the grotto are navy, and nothing near it takes its colour.

**Why it matters:** Night is now good, and its one warm-against-cold accent should be a glow seen through water that warms the stone round it. Right now it reads as a UI decal. world.js:2161-2169 still pushes the heap's GLOW.glow sprites when the fall veils them (through = 0.35 only dims them). The additive glow layer draws over the transparent curtain, which writes no depth, so 'behind the water' ends up in front of it. The hearth was never added to U.lamps, although the stone material's lamp loop supports it.

**Critic's fix:** In sky-children-world.js, skip the heap sprites entirely when `veiled`; the grotto term at falls.js:445 already glimmers through the thin water (raise it ×1.5 if it needs more). In writeLamps, give the last lamp row to the hearth when U.hearth > 0.05: position = the grotto (the same point falls.js uses), radius 30 m (a.w), rgb = hour.colour.hearth*hearth*0.6. The root, the lip's underside and the curtain's flanks then warm round it at Night, Pearl and Rose. Even Minimal has 4 lamps, so one held-pool lamp yields to the hearth at night.

**Files:** src/themes/sky-children/sky-children-world.js, src/themes/sky-children/sky-children-falls.js

**Cost:** 0 draws, 0 triangles, fewer glow sprites. One lamp row; no shader change.

**Skeptic:** not verified (minor finding).

### `atmosphere-parapet-black` [minor] The overlook's coulisses are the frame's blackest values in every hour, darker than the board card

**Evidence:** Parapet shaft (90,800) and right pier (1420,860): Jade (17,39,52) / (19,43,58), Gilded (23,22,43), Rose (32,14,36), Night (1,2,15) / (1,3,17). The board card itself is (29,39,51) at Jade. They are blue (<0.1) in falseColor. Crop: critique/atmosphere-b02-BL.png (a flat dark slab under a lit cap).

**Why it matters:** In a high-key, pastel picture, two near-black slabs in the bottom corners compete with the card for the frame's one dark. They break the theme's own rule that shade is tinted, never black, and at Night they are pure black. The faces we see look back toward the sun-side sky, the brightest half of the sky. In isles.js the shadeBelow branch (2225-2229) sets sun ≈ 0, and the only light left is fill = mix(shadow, skyUp)*0.4*ao (isles.js:2232) on a dark albedo.

**Critic's fix:** In createStoneMaterial's shadeBelow branch, add a fill from the bright sky behind the eye: col += albedo*light.horizon*U.keyGain*0.12*(0.5 + 0.5*nv). Then floor at col = max(col, light.shadow*albedo*0.6). Target about L* 25-30 at Jade, around (50,65,80): still the darkest thing in the scene and still a repoussoir, but a clear step above the card and never black at Night.

**Files:** src/themes/sky-children/sky-children-isles.js

**Cost:** About 4 ALU on the parapet's fragments only. 0 triangles, 0 draws.

**Skeptic:** not verified (minor finding).

