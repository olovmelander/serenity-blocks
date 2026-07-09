# Odyssey AAA Visual Experience Review

**Status:** Creative/visual review, June 13 2026.
**Evidence base:** `docs/ODYSSEY_WAVE_V_CAPTURE_REPORT.md`, the Wave V review sheets in `artifacts/odyssey/wave-v/review-sheets/`, and the recent 5-6 seam work.
**Purpose:** Convert the chapter-by-chapter capture findings into an implementation-ready visual roadmap for layout, assets, spline staging, level orbs, completion stars, and the overall Odyssey "wow" factor.

---

## 1. Executive Verdict

Odyssey has the ingredients for a high-end cinematic journey: eight distinct worlds, a continuous spline, chapter-specific atmospheres, material-driven path styles, diegetic level nodes, and a WebGPU/TSL renderer that can carry the art direction. The current weakness is not lack of systems. It is hierarchy and staging.

The captures repeatedly show the same problem:

1. The path, marble/orb glow, and completion indicators often become the brightest, sharpest, most repeated visual read.
2. The world hero in each chapter is often authored in code but not staged as the thing the player remembers.
3. Several seams still behave like theme changes instead of physical transitions through one continuous world.
4. Some chapters use strong materials, but the camera samples them like wallpaper rather than as composed vistas.

The AAA target is simple: the world must win first, the spline must guide second, and the level objects must feel like precious markers inside the world rather than UI pasted over it.

---

## 2. The AAA Visual Contract

### 2.1 One Postcard Per Chapter Act

Every chapter needs three postcard frames:

- **Entry postcard:** what world am I entering?
- **Body postcard:** what is the central fantasy of this chapter?
- **Exit postcard:** what is being handed to the next chapter?

Acceptance: the hero landmark must be recognizable at roughly 10%, 50%, and 90% local chapter progress without relying on the path or level orb.

### 2.2 World, Then Path, Then Orb

The sustained focal hierarchy should be:

1. Chapter hero or vista.
2. Near/midground scale cue.
3. Spline/path.
4. Level orb.
5. Completion stars and micro detail.

The path may pulse bright for a beat, but it cannot be the brightest sustained object through the body of a chapter. The current global path work in `src/rendering/odyssey/odyssey-path-renderer.tsl.js` is a strong foundation; the next pass should make this law measurable per chapter.

### 2.3 The Spline Is Cinematography

The spline is not only a route. It should work like a storyboard rail:

- Approach a hero from an oblique angle.
- Pass near a foreground occluder.
- Reveal a vista after compression.
- Cross under/over a landmark.
- Rest briefly on a clean composition before the seam.

Implementation hook: `src/rendering/odyssey/OdysseyCameraController.js` already has chapter framing overrides. The next step is adding per-chapter "shot beats" with local progress windows, not only static chapter bias.

### 2.4 Progress Objects Must Be Diegetic

The current node-shell direction in `src/rendering/odyssey/chapter-environments/shared/chapter-profile.js` is correct: magma geode, bubble pearl, seed lantern, cairn lantern, cloud wisp, starlit orb, lensed shard, neon sign. The problem is not the concept. The problem is that the repeated orb/glow/star read still risks flattening the journey into a map UI.

Level objects should look collected from the biome:

- Earth Core: cracked magma geode in a basalt pocket.
- Deep Ocean: bubble pearl suspended in a current.
- Surface: seed lantern in grass and leaf motes.
- Mountains: cairn lantern with ice/snow rim.
- Sky: cloud wisp with aurora fringe.
- Space: starlit orb with tiny orbit traces.
- Black Hole: lensed shard bending the path light.
- Urban Encore: neon sign/gate marker in a city frame.

### 2.5 Completion Stars Are Prestige, Not Confetti

The current stars are three billboard icons arced over completed nodes in `src/rendering/odyssey/LevelNodeManager.js`. They are readable, but the AAA version should feel like earned constellations:

- Replace or augment the three flat star sprites with a tiny orbital constellation halo.
- One star = one bright anchor point.
- Two stars = two anchors with a faint curved line.
- Three stars = a triangular constellation crest around the orb.
- Completed-but-distant nodes fade stars sooner than the orb, so old completion detail does not sparkle over the world.
- The current/next uncompleted node remains visually dominant over all past completion stars.

Acceptance: stars read at 720p as prestige marks, not a cloud of noisy yellow UI.

### 2.6 Seams Carry Matter Across the Boundary

Every seam needs one carried material:

- 1-2: ember turns to steam and plankton.
- 2-3: water surface becomes shoreline and meadow mist.
- 3-4: distant mountains seen early become real mountains, not a pop-in.
- 4-5: snow plume becomes cloud/aurora vapor.
- 5-6: Chapter 5 aurora stays until the camera passes it; Chapter 6 must not create a square fake aurora.
- 6-7: starfield bends into lensing/disk material.
- 7-8: accretion light becomes neon city signage and Retrosun haze.

The recent 5-6 seam change is directionally right: keep the real Chapter 5 aurora alive through the crossing, then let Space reveal itself gradually.

---

## 3. Chapter Review And Best-In-Class Improvements

### Chapter 1: Earth Core

**Current read:** strong molten material, but too many repeated orange/rail/orb compositions and not enough destination clarity.

**AAA target:** a primal descent into a living magma vault. The First Heart should feel like a sacred furnace seen through basalt architecture.

**Improvements:**

- Isolate the First Heart with a darker/cooler basalt cone around it instead of making it brighter.
- Add a near-camera lava-surf breach moment: a molten swell rises, throws embers past the camera, then releases.
- Use foreground basalt ribs to frame the path and hide/reveal the orbs.
- Make the exit steam quench visible as a material event before Deep Ocean appears.
- Reduce repeated two-sphere/orb compositions by offsetting level markers into pockets and alcoves.

### Chapter 2: Deep Ocean

**Current read:** cyan caustic wallpaper, rail/ring dominance, manta/creature fantasy not yet readable.

**AAA target:** a dark-to-luminous descent through a layered abyss, with one large creature escort that sells scale and grace.

**Improvements:**

- Start darker than feels comfortable: indigo abyss first, then teal surface shafts.
- Stage a manta/large-ray escort beside the camera for several seconds, wing filling a meaningful part of frame, then banking away.
- Turn caustics into accents on surfaces and bodies, not a full-screen wallpaper.
- Make the path feel like a current ribbon, with particulate drifting across it.
- Give the Pearl Gate a darker silhouette/backplate so it reads as a destination, not a glowing ring in cyan fog.

### Chapter 3: Surface World

**Current read:** much improved after the blue-water and foliage pass, but still too washed in places. The rail remains too strong, mountains can still feel late, and the trees/birds need higher-quality asset grounding.

**AAA target:** open-air adventure: blue water, warm grass, readable tree masses, distant mountains planted early, birds that feel alive, and a route that invites exploration instead of drawing a lime line over everything.

**Improvements:**

- Keep water blue through the whole river/sea read; prevent the brown/orange wash from returning after early frames.
- Bring the far mountains into the horizon much earlier at low opacity, then strengthen them gradually so they never pop in.
- Use the Chapter 4 mountain range as the canonical modeled range across Chapters 3, 4, and 5. Chapter 3 now previews that exact range at the same world coordinates; Chapter 5 recedes the same range instead of swapping to a two-ridge substitute.
- Use darker foreground grass/reeds/tree trunks to create value grouping and reduce the pastel-white wash.
- Lower rail luminance and push it toward sun-warmed green/gold, never neon lime.
- Implemented local Quaternius CC0 asset layer for Chapter 3:
  - Tree: https://poly.pizza/m/qZtx0AHhcy
  - Trees cluster: https://poly.pizza/m/jUzojhHoYR
  - Pine Trees cluster: https://poly.pizza/m/oYtDty0fR6
  - Pine variants: https://poly.pizza/m/igSu0cPoBz, https://poly.pizza/m/79gmlLnweB, https://poly.pizza/m/699sFuLCN2
  - Twisted Tree accents: https://poly.pizza/m/edSPJNECM7, https://poly.pizza/m/9aWlx82xUf
  - Supporting Tree: https://poly.pizza/m/t9KbsfYdXz
  - Bush with Flowers, Flower Group, Fern, Clover, Rock Medium, Pebble Round.
  - Bird and animated Pigeon: https://poly.pizza/m/gYYC0gYMnw and https://poly.pizza/m/9NGlBTpDEr
- The GLB layer now replaces the procedural tree/bird fallbacks when loaded; fallbacks remain for non-browser tests or asset failure. Bird crossers use the CC0 Bird model with a local wing rig so the flight reads as volume instead of flat V silhouettes.
- Removed the old Chapter 3 aurora-preview curtain and fixed the mountain-mist mask so the 3-4 handoff is mountains/valley haze rather than hard-edged translucent cards.
- Gated the Chapter 4 aurora curtains off until late Mountains / the 4-5 seam so they no longer appear as a square card during the 3-4 mountain arrival.
- Bird research update: the prettiest flying gull/eagle/hawk search hits are generally Creative Commons Attribution, not CC0. For the current CC0-only constraint, keep using Quaternius Bird/Pigeon from Poly Pizza, with the local wing rig for flight readability, unless we later add attribution handling.
- Treat Poly by Google gull/seagull models as optional only if attribution support is added, because those are Creative Commons Attribution rather than CC0.
- Next visual check: tune individual tree scale/spacing after the next full visual review so the new foliage frames the land without cluttering the mountain horizon.

### Chapter 4: Mountains

**Current read:** readable peaks/flags/cairns, but still pale, rail-bright, and short on dramatic scale.

**AAA target:** a crisp alpine ascent with a blue-shadow snow floor, warm alpenglow, cloud sea below, and a summit wall that grows in frame.

**Improvements:**

- Make snow shadow blue, not grey-white. This is the chapter's entire de-wash.
- Use a close cliff-wall pass before the summit reveal to create compression and release.
- Keep prayer flags/cairns as scale cues, not bright decorations.
- Let eagles/birds cross at large scale once, then remain tiny against the peak.
- Cap the white rail and node bloom so the summit silhouette owns the strongest edge.

### Chapter 5: Sky And Drift

**Current read:** the end is loved and should be protected. The real Chapter 5 aurora is the good aurora; the old Chapter 6 square/filament bridge should not return.

**AAA target:** a luminous sky cathedral where cloud strata, aurora curtains, and the final lifted atmosphere carry us to Space without a hard theme swap.

**Improvements:**

- Keep the Chapter 5 aurora visible until the camera physically passes it.
- Improve the Chapter 5 aurora shape/mask so the real curtain never exposes a rectangular card edge.
- Implemented: Chapter 5 aurora ribbons now have four-sided/corner feathering, the late noctilucent veil has stronger edge fade, and the old canvas cloud-deck sprite ring has been retired to a compatibility group because it could reveal flat rectangular panels in WebGPU captures.
- Add the corona-overhead event: the camera rolls under the aurora crown as vertical light streaks fall past.
- Keep stars out of the Sky body except at the seam; the chapter identity is atmosphere, not space.
- Tame rail/marble brightness during the aurora body so the curtain and cloud backstop remain the read.

### Chapter 6: Space

**Current read:** old captures show clutter and black void; the recent continuity changes now stage the opener better, but this chapter still needs a stronger 10/50/90 hero read.

**AAA target:** the aurora falls behind, silence opens, then stars, dust, planet/galaxy, and black-hole direction reveal in layers.

**Improvements:**

- Do not add a Chapter 6 aurora bridge. Let Chapter 5 aurora be the carried element.
- Stage entry in order: carried aurora tail, faint star floor, hero destination, then nebula/clutter.
- Implemented: Chapter 6 no longer pre-ignites into the tail of Chapter 5. The manager now holds Chapter 5 dominant through the 5-6 boundary, delays Chapter 6 environment opacity until after the crossing, and drives the Chapter 6 void dome with its own opacity uniform so hard vacuum does not appear as a dark block before the aurora has passed.
- Reduce early opener clutter so the transition feels vast, not busy.
- Aim the hero/black-hole direction toward the path vanishing point earlier.
- Use crisp star depth and slow parallax, not lots of bright sprite noise.
- Keep red/pink nebula pockets as late body accents, not immediate entry wash.

### Chapter 7: Black Hole

**Current read:** improved midsection floor/fold/dust, but still very dark and missing a clear authored disk-plane crossing moment.

**AAA target:** existential dark with one unforgettable gravitational event. The black hole should feel like it changes the camera's physics.

**Improvements:**

- Add a disk-plane crossing: accretion disk compresses into a razor line, then reopens below.
- Keep a deep violet floor/ambient wash so black frames are designed darkness, not empty render.
- Use lensing arcs to bend around the path and current orb, but keep them below the hero's contrast.
- Pull path brightness down during the disk-plane event so gravity, not UI, wins.
- Add one high-parallax near-dust/fragment pass for scale.

### Chapter 8: Urban Encore

**Current read:** facade/path pass helped, but the Retrosun and Gate Bridge event are not yet dominant enough. The city still risks reading as fragments on black.

**AAA target:** warm neon homecoming: a sunlit city canyon, layered skyline, wet reflections, bridge shadow, and final megastructure payoff.

**Improvements:**

- Make the Retrosun warm and persistent in body frames, independent of the 7-8 seam.
- Put skyline tiers in front of the sun with clear silhouette separation.
- Turn the Gate Bridge into a true event: path glow dips, bridge shadow swallows the lane, neon returns after the pass.
- Use window tiers and warm haze to create city mass, not salt-and-pepper confetti.
- Pull the final camera back/up enough that the city reads as a destination, not a wire in darkness.

---

## 4. Spline And Layout Upgrade

The current spline should become a "shot rail." Add a lightweight chapter shot map:

```js
{
  chapter: 3,
  beats: [
    { t: 0.08, role: 'entry-postcard', look: 'river-open', pathLuma: 0.75 },
    { t: 0.42, role: 'hero-pass', look: 'great-tree-left-third', pathLuma: 0.62 },
    { t: 0.82, role: 'exit-preview', look: 'distant-mountains', pathLuma: 0.68 }
  ]
}
```

Implementation direction:

- Add chapter-local shot beats beside the existing framing overrides in `OdysseyCameraController.js`.
- Let each beat drive look bias, camera side, FOV, path luminance scalar, and optional occluder emphasis.
- Put hero landmarks on thirds most of the time; center them only for reveal peaks.
- Use foreground occlusion deliberately: trees, basalt ribs, snow walls, aurora veils, asteroids, lensing arcs, bridge shadows.
- Avoid uniform spacing of orbs in the camera read. They can be mathematically on the path but compositionally offset into pockets, shelves, currents, cairns, clouds, and city frames.

---

## 5. Level Orbs And Completion Stars

### 5.1 Orb Scale Law

- Current/next playable node: largest readable glow, but still below the chapter hero.
- Nearby unlocked nodes: medium, material-specific, low bloom.
- Completed nodes: calmer shell plus constellation prestige.
- Distant nodes: silhouette/glint only, no active star sparkle.
- Locked nodes: physical occlusion or dim material state, not a big red UI lock unless the node is close and interactable.
- Implemented first global cap: the live node glow radius/alpha and sparkle opacity are reduced, and completed-star sprites are smaller and less opaque. This keeps the current node readable without letting the orb halo become the sustained chapter hero in the sky/aurora captures.

### 5.2 Completion Constellations

Replace the flat "three icons above every completed orb" read with a constellation rig:

- Keep the current instanced-star path as a fallback.
- Add a new instanced constellation mesh with 3 tiny points per node plus up to 3 faint connecting line segments.
- Points orbit slowly around the orb in camera-facing space, but only when the node is within the near update threshold.
- Lines are chapter-tinted gold/white, opacity capped low.
- Distant completed nodes collapse to a single subtle glint.

Files likely touched:

- `src/rendering/odyssey/LevelNodeManager.js`
- `src/rendering/odyssey/level-node-manager.tsl.js`
- `src/rendering/odyssey/chapter-environments/shared/chapter-profile.js`

### 5.3 Orb Integration

Each chapter should get one small piece of environmental seating:

- Core nodes sit in basalt bowls.
- Ocean nodes sit in bubble rings or current eddies.
- Surface nodes sit in grass/flower/stone pockets.
- Mountain nodes sit on cairns or icy ledges.
- Sky nodes sit in cloud wisps.
- Space nodes sit in a tiny orbit trace.
- Black Hole nodes sit in lensing ripples.
- Urban nodes sit in signage frames or suspended street fixtures.

This turns orbs from UI into world artifacts.

---

## 6. Asset Direction

### 6.1 Import Policy

Use third-party assets only when they add silhouette credibility faster than procedural primitives:

- One hero asset family per chapter maximum in the next wave.
- Prefer CC0 assets for frictionless shipping.
- Record every imported asset in an asset manifest with source URL, author, license, date downloaded, original format, converted format, and any modifications.
- Convert to GLB, simplify materials, center pivots, author LODs/impostors, and instance aggressively.

### 6.2 Immediate CC0 Candidates

Quaternius is a clean source for the next Ch3 pass. Their FAQ states the assets are CC0 and usable commercially without attribution, and Poly Pizza lists the individual Quaternius models below as Public Domain (CC0):

- Pine: https://poly.pizza/m/Zt62gceKXZ
- Twisted Tree: https://poly.pizza/m/8oraKn9m0x
- Bird: https://poly.pizza/m/gYYC0gYMnw
- Quaternius FAQ/license reference: https://quaternius.com/faq.html

Use the Quaternius Bird as the first CC0 bird candidate. The Poly by Google flying gull/seagull models are visually relevant but CC BY, so they require attribution support before use.

### 6.3 Poly Pizza Intake Workflow

Poly Pizza should be the first stop when a chapter needs a small silhouette asset, especially for Ch3 trees/birds, Ch4 rocks/cairns/flags, Ch6 asteroids, and Ch8 street/signage props.

Rules for use:

- Treat the model page, not the website, as the license source of truth.
- Accept **Public Domain (CC0)** assets immediately.
- Defer **CC BY** assets unless the game has an attribution manifest and credits surface.
- Reject or quarantine anything without a clear commercial-use license.
- Save source URL, author, license, and download date in the asset manifest before wiring it into a chapter.
- Run every imported GLB through the same optimization path: normalize scale, center pivot, remove unused materials, generate LOD/impostor if repeated, then `gltfpack`.

Best first search terms by chapter:

- Ch2: `ray`, `manta`, `fish`, `coral`, `kelp`, `shell`
- Ch3: `Quaternius bird`, `Quaternius tree`, `pine`, `grass`, `flower`
- Ch4: `rock`, `cairn`, `flag`, `eagle`, `snow`
- Ch6: `asteroid`, `satellite`, `space rock`
- Ch8: `sign`, `building`, `antenna`, `street`, `neon`

---

## 7. Implementation Waves

### Wave A: Hierarchy And Continuity

Goal: the journey immediately feels more premium without new heavy assets.

1. Add path/orb/star luminance hierarchy caps by chapter.
2. Prototype completion constellations and distant-star fade.
3. Keep the 5-6 seam on the current direction: real Ch5 aurora persists until passed, Ch6 reveals slowly, no Ch6 square aurora.
4. Add Ch3 far-mountain early visibility and water color continuity guard.
5. Add Ch6 staged-entry density gating and hero aim polish.
6. Recapture chapters 3, 5, 6 and seam 5-6.

### Wave B: Hero Moments

Goal: each chapter has one trailer-quality event.

1. Ch2 manta escort.
2. Ch7 disk-plane crossing.
3. Ch8 Gate Bridge shadow/reveal plus warm Retrosun.
4. Ch1 lava-surf breach and First Heart isolation.
5. Ch4 near cliff-wall pass and summit growth.
6. Ch5 corona-overhead event.
7. Ch3 Great Tree/bird flock pass.
8. Ch6 near asteroid or deep-space parallax pass.

### Wave C: Spline Storyboard

Goal: the path becomes a composed camera rail.

1. Add per-chapter shot beats.
2. Add local FOV/banking/roll windows for hero moments.
3. Route attention with foreground occluders.
4. Add camera acceptance screenshots at 10/50/90 plus three-frame motion bursts.

### Wave D: Asset Integration

Goal: Ch3 and selected chapters gain credible silhouettes without performance drift.

1. Add an asset manifest.
2. Import CC0 Quaternius Ch3 tree/bird candidates.
3. Build instanced tree and bird placement helpers.
4. Add LOD/impostor fallback for weak GPUs.
5. Capture High and Minimal to verify silhouettes survive quality scaling.

### Wave E: Final Polish

Goal: one cohesive, high-end journey.

1. Global grade/LUT pass.
2. Selective bloom audit.
3. Seam timing and visual continuity recapture.
4. Full journey review sheet.
5. Final "no accidental UI hero" pass.

---

## 8. Acceptance Gates

Every chapter must pass:

- **Hero read:** recognizable at 10%, 50%, and 90% local progress.
- **Value hierarchy:** the chapter hero has the strongest sustained contrast, not the path/orb/stars.
- **Spline composition:** at least one foreground compression/reveal beat.
- **Motion:** one three-frame motion burst reads as an intentional authored event.
- **No square artifacts:** aurora, nebula, stars, thresholds, and billboards show no rectangular card edge in captured frames.
- **Seam continuity:** one carried material remains visible across the seam before the new chapter fully asserts itself.
- **Progress clarity:** current node is clear, completed stars are legible, old completion sparkle does not fight the world.
- **Performance:** High and Minimal both preserve the chapter's visual identity; no new system creates per-frame allocation or capture instability.

---

## 9. Recommended Next Work Order

1. **Finish the 5-6 continuity polish** already started: keep the Chapter 5 aurora, clean any remaining square/threshold artifacts, recapture the seam.
2. **Global path/orb/star hierarchy pass:** path luma caps, current-node dominance, completed-star constellation prototype.
3. **Ch6 entry staging:** aurora tail, star floor, hero/destination, then nebula/clutter.
4. **Ch8 Retrosun/Gate Bridge structural pass.**
5. **Ch2 darkness inversion plus manta escort.**
6. **Ch3 asset import pass:** CC0 trees/bird, early mountains, rail/cloud subordination.
7. **Ch7 disk-plane crossing.**
8. **Ch1/Ch4 hero event polish.**

This order gives the biggest whole-journey quality lift first, then attacks the chapters with the highest capture failures and the strongest wow-factor upside.
