# Stillwater — the John Bauer plan

**Date:** 2026-07-28  
**Status:** Waves 1-9 built and verified, with the residual items in 5/6/8/9 listed per wave below.
**Supersedes as art direction:** the aesthetic sections of
[STILLWATER_MASTERPIECE_PLAN_2026-07.md](STILLWATER_MASTERPIECE_PLAN_2026-07.md).
That document remains the engineering/lifecycle ledger; this one governs how the
theme should LOOK and what it should MEAN.

## How this plan was made

Five parallel research agents covered John Bauer's measured visual language,
stylised real-time water, tree/terrain authoring, ambient environmental
storytelling and Nordic folklore, and three r181 WebGPU/TSL capability. The Bauer
agent did not describe him from memory — it pulled eight public-domain scans from
Wikimedia Commons and ran luminance percentiles, HSV saturation percentiles,
k-means palettes and local-gradient histograms. The numbers in §2 are measurements,
not taste.

The r181 API surface quoted throughout was verified directly against
`node_modules/three@0.181.2` before synthesis, so the plan does not depend on
recalled API names.

## 1. North star

Stillwater's problem is not fidelity, it is grammar. Bauer's pictures are measurably flat shape plus hard boundary — median luma ~L30, median saturation ~0.25, and 50-66% of pixels carrying essentially zero local gradient — while a clean real-time render is the exact inverse: mid-frequency gradient everywhere, values smeared across the full range, three or four competing bright notes. So the north star is a single sentence: **compress the entire world into one dark, desaturated, flattened field, and spend the whole remaining contrast budget on one small pale figure who is being watched and does not turn around.** Every wave below either removes gradient and chroma from the field, or adds meaning to the one thing left bright. The story is the same idea in time: a troll who carries his lantern to the water, reaches, withdraws before she answers, and must be gone before dawn — Tuvstarr's gaze into the tarn, staged as a four-minute loop inside a twenty-five-minute one-way arc. We are 15x under GPU budget, so nothing here is rationed for performance; the only real costs are authoring time, temporal stability in the painterly pass, and the discipline to *subtract*. The failure mode to fear is not "too expensive" — it is "more detail", which in this art direction is the same as "worse". If the finished frame does not survive being reduced to five flat black masses and one white one, it has failed regardless of how it renders.

## 2. Art direction

### 2.1 Palette

Field (never accents). Percentages are of BACKGROUND pixels at the solo camera (0,14.5,39)->(0,3.8,-15), fov 46; the board overlays the centre 36% of width.
- Water body, near->deep: #23272A -> #1E191D — ~30% of frame. Largest single mass; must stay the calmest.
- Deep forest / near silhouette: #2E2E28, #37362E, #2B3230 — ~26%. This is the repoussoir arch and the near bank treeline.
- Mid forest mass: #464337, #4A5044 — ~12%.
- Far mist / ridge plate: #6A6E6B with an ochre bias toward #6E6545 — ~10%. HARD CAP L55; the far valley must never be brighter than the midground.
- Bank terrain: olive shadow #4A462B, lit moss #62603F — ~9%.
- Rock / troll skin: #3D372A and #504B3F, roughness 0.85-0.95, metalness 0 — ~5%.
- Warm bark accent (near trunks only, lantern-side): #64472B — ~3%.
Accents (the entire emotional budget):
- Lantern flame + warm spill: #C8933F — ~1.5% including the water column.
- Spirit robe #E7E4DA, highlight #FAF1E4 (NEVER pure white), motes #C6E08A for fireflies / cold white for shaft motes — ~2% including the reflection.
- One crimson note, anywhere, optional: #993B33 — <=0.3%.
Chroma law, baked into the 16^3 LUT (rebake, do not add a pass): S = min(S, 0.30 + 0.30*smoothstep(0.75, 1.0, V)) so only near-white accents may keep chroma. Hue funnel: field hues rotated into 150-200 deg (cool blue-green), accents into 30-45 deg (amber). Two families, nothing between them.

### 2.2 Value structure

Measured targets, enforced by scripts/bauer-metrics.mjs on every capture (Rec.709 luma, 0-100):
- Scene p50 28-34, p25 >= 15, p75 <= 50, p95 <= 62. Blacks lifted to ~0.06 linear (nothing is pure black; Bauer's darks are washes, not holes).
- Exactly one thing above L80: the spirit's robe (L85-92) plus its water reflection. Combined <= 5% of pixels, and >= 85% of all L>80 pixels must fall inside the spirit+reflection bounding box.
- Ceilings on the historic offenders: moon disc L<=70, moon specular lane peak clamped and narrowed to the reflection lane only, far mist plate L<=55, lantern core L<=78 (its power comes from hue, not value), firefly peak L<=72.
- Tone curve after ACES: lift 0.06, hard shoulder from 0.62 — EXCEPT where the existing selective-bloom MRT emissive mask says 'spirit'/'lantern', which bypass the shoulder. Reuse the mask you already ship; do not add a second one.
- Depth is quantised, not continuous: 4 washes with 1.5u soft blends — 0-25u silhouette #2B3230 at fog 0.0; 25-60u #4A5044 at 0.45; 60-110u #6A6E6B at 0.75; >110u flat #7B7F79, no gradient. Applied once in post from linear view depth so trees, terrain, rock and water can never disagree.
- Structural target: frac(|grad L| < 4) >= 0.45 (Bauer measures 0.50-0.66). This single number is the pass/fail for 'reads as painting'.

### 2.3 Silhouette and composition

- Hero trunks EXIT the top of frame. The two nearest trees show no crown at all; 0.9-1.4u trunk thickness at 12-20u from camera. A cropped tree is a world; an uncropped tree is a prop.
- Canopy arch owns the top 22-28% of frame height and the outer 18% of each side. The centre 36% of width, full height, is a hard no-geometry zone (assert it in a layout test by projecting instance bounds against the solo camera).
- Foreground repoussoir in the lowest 15% of frame, hugging the left and right thirds: a boulder shoulder and a fern frond overlapping the bank edge and waterline, albedo x0.25 so they read as VALUE shapes, not lit objects.
- Characters <= 7% of frame height. They are small because the forest is enormous; that ratio IS the loneliness.
- >= 30% of frame must be uninterrupted flat region, with the largest single connected flat region >= 18%. Negative space is a deliverable, not a leftover. Any 'add detail' proposal that lowers this number is rejected by definition.
- All featured character action happens in the outer thirds (screen x < 0.30 or > 0.70), in profile or three-quarter-BACK, never facing camera, never reaching along the camera axis.
- Permanent QA tool: ?silhouette=1 sets scene.overrideMaterial to flat black on white. Every beat's key pose must be readable as pure contour, and the frame must resolve into <= 6 separable masses. If it doesn't read in black, it does not exist during gameplay — the player's fovea is on the falling piece and the periphery resolves contour and motion only.

### 2.4 Painterly rules — what to flatten, what to model

FLATTEN (aggressively): everything past 25u — forest, ridges, mist, the water body term. Anisotropic Kuwahara at full strength, 8 sectors, radius 5*(height/1080) px, polynomial weights eta=0.1 lambda=0.5, structure tensor from 3x3 Sobel blurred at sigma 2, ellipse anisotropy clamped 4:1. Foliage shading posterised to 2 bands with a soft terminator: stepped = smoothstep(0.30,0.62, NdotL)*0.75 + 0.25, then mix(shadowTint, albedo, stepped). Water body luminance quantised to 5 bands with mixBack 0.35 and 3-6 deg of hue shift per band (cooler/greener deeper, warmer/browner shallower), the band domain warped by analytic curl noise (0.8u offset, 0.03 Hz) so boundaries wander like brush shape instead of tracking iso-depth contours.
MODEL (keep gradient): the spirit's robe column, the troll's head/shoulder mass, and the lantern's falloff on bank and water. Kuwahara strength drops to 0.5 on characters (MRT id mask) and to 0.0 over the board rect + 1.2x safe margin with a 6px feather. Never run a painterly filter full-screen — at radius 5 it smears falling blocks and gameplay legibility is non-negotiable.
HOW 3D READS AS ILLUSTRATION — the four mechanisms, in order of power:
1. Normal authoring, not geometry. Crowns get sphere/ellipsoid-projected normals (Blender Data Transfer -> Face Corner Data -> Custom Normals, mix 0.75, shade-smooth kept ON or glTF drops them; or procedurally normalNode = mix(normalGeometry, normalize(positionGeometry - crownCentre), 0.75) — positionGeometry, NOT positionLocal, because r181 InstanceNode reassigns positionLocal first). One crown = one smooth ramp = one painted mass. This deletes the exact mid-frequency band Bauer has none of.
2. Region flattening + boundary sharpening (Kuwahara). Interiors go constant, silhouettes get sharper. It also eats the terrain shading seam for free, because a seam is a low-variance gradient.
3. Watercolour boundary behaviour (Curtis '97, minus the fluid sim). Edge darkening x0.78-0.88 over 2-3px at every depth/normal discontinuity — this is what makes a flat region read as a wash rather than as untextured shading. Plus paper granulation that pools MORE in darks: v *= mix(1.0, 0.90+0.20*grain, saturate(1.0 - L*1.6)), grain sampled by screenCoordinate/1024 at NATIVE resolution (sample it in a downscaled buffer and it crawls as noise instead of sitting as paper). Amplitude <= 0.08.
4. Variable, tinted contour — never uniform ink. Width mix(3.0, 1.0, viewDist/60) px, colour = pixel*0.55 with hue pushed +8 deg warm, and SUPPRESSED where the neighbouring value difference already exceeds 0.25 (Bauer doesn't outline what already contrasts). A constant black cel outline reads as cartoon and kills the melancholy instantly; so does any banded toon ramp, which reads as anime, not Swedish watercolour.
Reflections obey painting law, not optics: value x0.62, +0.03 lift, desaturated 0.35 toward the water body colour, smeared vertically (v' = hV + (v-hV)*1.25), and BLURRED NEAR / SHARP FAR (mip LOD mix(3.5, 0.2, dist/45)) — the opposite of a mirror, exactly what a painter does.

## 3. The story

THE OFFERING LOOP — 240s base + 20-40s randomised tail, so the cycle boundary never lands on a predictable clock. Folkloric spine: the troll is the landscape made animate and is unmade by the first ray of dawn; the ra/skogsra aids those who show the forest respect; an offering left at the water is the transaction with nacken. One relationship, never consummated.

BEAT 1 — REST (90s). Troll seated on the right bank, fused into the hillside silhouette, lantern at 0.35 intensity. Spirit absent or barely present in the far fog. Intimacy scalar I = 0.05, character separation 22u. featureToken = null. Nothing moves faster than 0.6 u/s. This beat is long on purpose: dead air is what makes the next movement register as an event.

BEAT 2 — NOTICE (25s). Spirit drifts onto the far bank and stops, facing the water. She never faces him. Troll's head turns toward her over 2.2s (critically damped, omega 4.5 — heavy, reluctant), holds, then looks away first. Lantern warms to 0.6. I -> 0.25, separation 18u. featureToken = 'spirit' for the drift-in, then 'troll' for the head turn — never both.

BEAT 3 — APPROACH (35s). Troll rises and walks his bank path to the water's edge at 1.45 u/s with the walk clip locked to ground speed. Lantern 0.85. I -> 0.60, separation 12u. Nacken's fiddle enters, sourced from the water surface (not from either character), 2-4 notes with long silences. featureToken = 'troll'; spirit clamped to 0.15x amplitude, gaze on him.

BEAT 4 — OFFER / THE ALMOST-TOUCH (45s). He sets the lantern down at the waterline (this is the loop's one permitted CLAIM: fast onset < 250ms, >1.5x luminance step, routed through selective bloom). He extends a hand toward it and toward her, holds 0.9s at full extension, then withdraws over 1.4s — the withdraw MUST be slower than the reach; that asymmetry is the entire characterisation. She reacts only 0.6s AFTER he has given up, drifting 1.2u closer to where the hand was. He retreats two paces the instant she moves. I peaks at 0.85, separation 9u. Never below 7u, ever — they never enter personal distance and never touch.

BEAT 5 — RETURN (45s + 20-40s jitter). She lingers, then recedes into the fog. He retrieves the lantern, walks back, sits, dims to 0.35. Fiddle stops. I decays to 0.05, separation 22u. featureToken released.

ONE SCALAR DRIVES EVERYTHING: I in [0, 0.85] feeds path anchor remap, lantern intensity 0.35->1.0, spirit emissive 0.6->1.0, mote orbit radius 1.4->0.9 (they draw inward), troll shoulder droop, and the mist density in the channel between them (thick->thin). Eight consumers, one float — that is what makes the scene read as authored rather than assembled.

THE DAWN CLOCK (the loop is not a loop): a monotonic session scalar D in [0, 0.94] advancing over ~25 minutes of play, nudged faster by rising stack height. D shifts sky hue paler, drops fog, raises horizon glow, and progressively narrows what the troll is willing to do: D > 0.7 disables BEAT 3's approach (he rises and sits back down); D > 0.9 forces PETRIFY — he retreats to the hillside, mixer.timeScale -> 0.05, roughness lerps to 0.95, saturation to 0.25, and the world-up moss mask creeps over his body until his shoulders resolve into the rock silhouette he always resembled. The spirit dims and thins as D rises. Sunrise NEVER arrives; D caps at 0.94. The viewer discovers the relationship has a deadline without ever being told.

GAMEPLAY PERTURBATION — accumulated, jittered, refractory; never 1:1. Line clears feed a leaky accumulator (tetris +3.0, t-spin +2.5, combo step +1.0, single +0.6, decay 0.35/s). Crossing 6.0 arms a response, which fires after a randomised 0.8-2.2s latency and then locks out for 45s. Responses are drawn WITHOUT REPLACEMENT from a pool of five: (a) troll head-snap toward the board then slow look-away, (b) lantern flare + water ripple via the existing fixed-slot wake system, (c) spirit motes surge outward then draw inward, (d) troll takes one step closer (I += 0.05, decays over 20s), (e) fireflies scatter and re-gather. HARD RULE: gameplay may NEVER change the beat — it only adds a gesture inside the current beat. The single exception, capped at once per loop: a fire during REST may early-exit REST into NOTICE. 1:1 coupling reads as a slot machine and destroys the sense that the characters have volition; accumulation makes the world respond to how you are PLAYING, and the latency jitter is what makes the look-up feel chosen rather than triggered.

## 3a. Build status (2026-07-28)

| Wave | State | Notes |
|---|---|---|
| 1 — The Key | **Built** | Metrics harness, chroma ceiling, offender pass. Targets recalibrated — see below. |
| 2 — The Frame and the Mass | **Built** | Crown normals, canopy doming, foreground repoussoir, two cropped framing trunks, `?silhouette=1`, and `stillwater-composition-layout.test.js` (4 tests). |
| 3 — The Offering Loop | **Built** | `sim/stillwater-offering-loop.js`, 12 tests, wired to the runtime and driving the lantern. |
| 4 — The Brush | **Built** | `post/stillwater-painterly.js`: 8-sector Kuwahara + watercolour edge darkening + static paper granulation, board-masked with a 1.2x margin and soft feather, premium tiers only. `?painterly=0` toggles it for A/B. Temporal crawl measured and refuted — see below. |
| 5 — The Water as Paint | **Mostly built** | Painted-mirror reflection transform, shore-weighted `viewportSharedTexture` refraction, and two-band shoreline foam. Flow-map cycling, hex-tiled detail normal, value quantisation and the contact map are NOT done. |
| 6 — Moonbeams and Living Air | **Mostly built; shafts blocked** | Height-integrated exponential fog (Quilez) with the horizontal-ray singularity guarded, bounded valley mist, and moon-direction warm inscatter. GPU-compute fireflies NOT done (the existing system was already depth-graded). Volumetric shafts are IMPLEMENTED in `rendering/stillwater-shafts.js` but gated OFF behind `?shafts=1` — see below. |
| 7 — The Trees | **Built** | `assets/hero-trees.glb` — three gnarled trunks authored in Blender (kinked spine, elephant-foot flare, geometric bark ridges, low reaching boughs), merged to ONE draw at load, sharing the wood material with loader-supplied `aPhase`/`aSway`. Procedural heroes remain as fallback; `draws.authoredHeroes` reports which is live. |
| 8 — The Land | **Mostly built** | Multi-scale ground detail (3 octaves) and — the important part — the moss mask moved from a world-HEIGHT band to SLOPE. The old mask was a horizontal contour crossing the bank's geometry bands, which IS the shading seam; a mask whose domain is the surface itself cannot cross it. Vertex-baked AO/cavity and hex-tiled triplanar are NOT done. |
| 9 — The Dawn Clock | **Mostly built** | Dawn scalar D drives petrify, approach-gating and lantern taper, and now feeds the grade (`pipeline.setDawn`) so the arc is visible in the IMAGE, not only in behaviour. Two-tap bloom shipped: a wide warm halo plus a tight neutral core, because one bloom must choose between a foggy veil and hot dots. Näcken's fiddle audio is NOT done. |

**Correction to §2, made by measurement.** The absolute Bauer scan values in §2.2
cannot be chased directly. Measuring the shipped frame gave p50 13.2 against a
"target" of 28-34 — the scene was already less than half Bauer's key, so
compressing further was backwards. Bauer is watercolour on aged paper: paper-white
shows through every wash, lifting median luma and suppressing HSV saturation.
Proof: this project's own concept reference fails the raw Bauer band in the same
direction as our render. `scripts/bauer-targets.json` therefore gates on
same-medium operational targets calibrated against that reference, and keeps the
scan values as provenance only.

**Wave 4 temporal verification.** Kuwahara's characteristic failure is sector
crawl, which a `?t=` capture cannot show because it freezes `dt`.
`scripts/dev/stillwater-temporal.mjs` samples 8 consecutive live frames and
reports per-pixel luma standard deviation. Measured A/B at 1419x746:

| | painterly ON | painterly OFF |
|---|---|---|
| mean SD | 0.889 | 0.921 |
| max SD | 70.2 | 74.3 |
| fraction SD>2 | 0.107 | 0.106 |

The pass produces *lower* mean temporal variance than the unfiltered build —
region flattening suppresses per-pixel noise rather than introducing crawl. The
residual variance in both columns is the scene's own motion (fireflies, flow,
the walking troll), which is why the A/B rather than an absolute threshold is
the meaningful test. `flatFraction` rose 0.9545 -> 0.9615 and the largest
connected flat region 0.894 -> 0.948.

Two metrics are tracked but NOT gated (`diagnostics` in that file): `luma.p95`
and `luma.topSpread`. Meeting them needs a highlight shoulder, and a global
shoulder also crushes the spirit — measured, `bright.fraction` fell to 0.0000.
Revisit once Wave 4 changes the top end.

## 3c. Screenshot-driven correction pass (2026-07-28)

Six issues read off a finished capture rather than off the plan, in the order
they cost the image the most. All six are fixed and re-measured.

| # | Issue | Fix | Evidence |
|---|---|---|---|
| 1 | **Reflections gone.** Wave 5's painted-mirror pulled the reflection 62% toward luminance and multiplied by 0.66 — tuned to stop the lake reading as a mirror, overshot into it reading as nothing. The lake is ~55% of frame: the largest area doing the least work. | Retention 0.62 -> 0.88 toward raw, 0.66 -> 1.02, weight floor 0.20 -> 0.42. Desaturation and the toe lift are kept; only the value came back. | `six-fixes-final.png` — inverted treeline and bank mass legible in the channel. |
| 2 | **One value band.** p25 10 / p50 15 / p75 21: near bank, far bank, ridges and mid-forest within a few luma of each other. Aerial perspective existed but was too gentle to separate planes. | `groundNear` deepened, `groundFar` and `AERIAL_MIST` lifted, far-haze multiplier 0.55 -> 0.42, mist add 0.85 -> 1.05. | p75 21 -> 23.2 with p50 held at 15.6 — the spread widened without the frame getting lighter. |
| 3 | **Forest was wallpaper.** Every mid tree had a mirrored twin at the same depth, heights confined to 21-34, crowns one shape at one size on an even grid. | `MID_TREE_LAYOUT` rebuilt as six clumps of 2-4 with real empty passages (notably x 30..70 at z -70..-95, which lets the ridges read *through* the wood); heights 17-38. Crowns are now DERIVED from the trunk table so the two cannot drift, each with a seeded +-35% scale draw and one of two lobe silhouettes (`CANOPY_LOBE_SHAPES`). Far trees and boulders de-mirrored and clumped. | Still 12 forest draws / 42k tris at High — the variety is instance data, not new draws. |
| 4 | **Spirit did not command the frame.** ~1.5% of frame height, competing on equal terms with the lantern and the moon. | Anchors pulled ~12u toward camera with x scaled to hold screen position, then pushed a further ~4u outboard for board clearance; scale 1.34 -> 1.95; lantern dimmed to 0.72; moon core 1.28 -> 0.98 so the top of the value range belongs to her. | Bright-cluster analysis: she was *not a pole at all* before (1 pole, 12.2% stray); she is now one of exactly 2 poles with 4.3% stray. |
| 5 | **Mountains were cut paper.** Three ranges fogging to similar values, flat faces, hard top edge. | Explicit value ladder by range (dark / mid / pale) instead of leaving recession to a fog term, plus slope-based internal shading so steep faces fall away and shelves hold light. | Three separable planes with visible internal form in the capture. |
| 6 | **Midground had no rhythm.** Mushrooms, lilies, reeds and tufts at one scale, evenly scattered — texture, not composition. | Lilies raft in four groups of three with the water between them left empty and pad scale spread 0.7-2.5; mushroom clusters de-mirrored; boulders clumped with size variance. | — |

Two defects surfaced by the fixes, both fixed:

- **Fireflies rendered as faceted white pebbles near camera.** The mote size ramp
  reached 1.9x with a 0.30 ceiling, which puts a 0.6-unit *icosahedron* a few
  metres from the lens. Ramp softened to 1.15x / 0.15, plus a sphere-normal
  falloff and a near fade. Pre-existing; only became visible once the eye had
  somewhere else to be.
- **The spirit's reflection was a hard octagonal disc** — the reflector's own
  resolution made legible, reading as a lantern floating on the water. Fixed with
  a two-tap vertical smear (what rippled water actually does to a bright source),
  a highlight knee on the reflected range only, and reflector resolution 0.48 ->
  0.60 at High.

### The `bright.spreadFraction` gate was replaced, not relaxed

The one metric that would not come into band was `bright.spreadFraction`. Before
touching it the bright pixels were mapped: moon disc 2114 px, spirit head 837 px,
lantern 85 px, **fireflies zero** — verified, not assumed.

`spreadFraction` is the bounding-box AREA over all bright pixels, so it cannot
tell "highlights sprinkled across the frame" from "two deliberate light notes far
apart". It is also perverse to tune against: for a two-note frame the score peaks
when the notes carry *equal* weight, so brightening the intended subject pushes it
UP, and the only way down is to delete the second note. Widening the ceiling to
fit the current build would have been fitting the ruler to the result — it was
widened once to 0.20 and immediately drifted to 0.2021, which is the tell.

It is now a diagnostic. The gate is three cluster statistics computed by
8-connected flood fill over the bright mask: `poleCount` (notes holding >=8% of
bright pixels), `poleSpread` (size-weighted mean footprint of those notes), and
`strayFraction` (light loose in the frame). This asks what the original gate meant.
Current frame: **2 poles, poleSpread 0.0016, stray 4.3%** — all in band. The new
gate was verified to still FAIL: a synthetic frame of 40 scattered specks scores
`strayFraction` 1.00 and is rejected.

### Frame time, measured (2026-07-28)

The mirror work — reflector resolution 0.48 -> 0.60 at High, plus two extra
reflector taps on ~55% of the frame — was shipped unmeasured. It has now been
measured, and the answer is that **it is below the noise floor, because the scene
is CPU-bound.**

Two false starts are worth recording, because both produce numbers that look real:

1. `scripts/playground-capture.mjs` creates its window with `show: false` unless
   `--show` is passed, and a hidden Electron window has rAF throttled to ~1 Hz.
   Every "1 fps" HUD reading through that path is the throttle, not the scene.
2. Wall-clock rAF deltas measure host scheduling as much as rendering. A first
   sweep using them ranked the *cheapest* configuration as the slowest, twice —
   background load moved more than the effect did. Wall-clock A/B is not a valid
   instrument for a change this small.

`scripts/dev/playground-frametime.mjs` drives the playground's own bounded
profiler (`?profile=1&trackTimestamp=1`), which drains WebGPU timestamp queries.
`gpuMs` is measured on the device and is immune to host contention.
`?reflectScale=<0..1>` and `?reflectSmear=0` were added to `stillwater-water.js`
so the two halves of the change can be priced separately; both default to the
shipped values.

High tier, 1578x918 internal, RTX 5080. Re-measured on a quiet machine AFTER the
fog defect below was fixed — the first sweep priced zero fog, because the fog was
not running, and was taken while four review agents loaded the same CPU:

| Cell | reflectScale | taps | GPU p50 | frame p50 | CPU p50 |
|---|---|---|---|---|---|
| A - pre-change | 0.48 | 1 | 0.197 ms | 1.6-1.7 ms | 1.5 ms |
| C - **shipped** | 0.60 | 3 | 0.197 ms | 2.0-3.8 ms | 1.8-3.5 ms |
| D - stress | 1.00 | 3 | 0.262 ms | 4.9 ms | 4.7 ms |

The GPU timer quantises to 0.0655 ms. A and C are **identical** — both exactly
three quanta — and the stress cell at 2.8x the shipped reflection pixel count
costs exactly one more. The shipped change is a fraction of that and is not
resolvable by this instrument.

Do not read the frame column across rows. The SAME configuration (C) measured
2.0 ms in one launch and 3.8 ms in another; wall-clock varies about 2x between
Electron launches regardless of what is being rendered, which is the same effect
that made the first sweep rank the cheapest cell slowest. Only `gpuMs` is
comparable across runs.

What IS robust across every run is the ratio: `cpuMs` tracks `frameMs` almost
exactly in all of them (1.5/1.6, 3.5/3.8, 4.7/4.9), while GPU sits at
0.20-0.26 ms. **The CPU accounts for ~95% of frame time and the GPU is busy
roughly 5-12% of it.** Fill-rate is not the constraint here and was not the
constraint when the mirror was added. Anyone chasing performance should profile
the per-frame JS in the runtime update and the character state machine, not the
shaders. The tier gates added for the refraction and the fog noise are prudence
for weaker GPUs, not a fix for a measured problem on this one.
## 3d. Adversarial review of the correction pass (2026-07-28)

Four independent review lenses (TSL correctness, GPU cost, test contracts, the
metric harness itself) over the changed modules, each finding then put to a
separate agent prompted to REFUTE it. 10 of 38 survived. Every one below was then
verified by hand before being acted on — the agents were right about all of them,
but two of the three "high" perf items were design observations rather than
defects, and one proposed reproduction was simply mis-placed.

**The fog was completely dead.** `distanceFactor` read

    float(1).sub(pow(float(Math.E), integrated.negate().abs())).clamp()

`.negate().abs()` is `abs(-x)` = `+|x|`, so the negation the exponential needed was
cancelled by the `abs` that followed it. `integrated` is provably non-negative, so
this evaluated to `1 - e^(+x) <= 0` and the trailing `clamp(0,1)` floored it to
exactly **zero**. Height fog, the valley mist that multiplies it, and the moonward
inscatter contributed nothing on any fragment at any tier. This is the same family
as the reversed-`smoothstep` trap: an expression that reads correctly, compiles
clean, and silently evaluates to zero.

Switching it on immediately exposed a second problem: `FOG_DENSITY = 0.030` had been
authored **blind** and put 42% fog on the near bank at 40 units, burying the whole
value ladder in a uniform veil. Calibrated against the scene's real depth range to
0.008 — 13% near bank, 35% mid-forest, 50% first ridge, 71% furthest. The fog hue
was then pushed to a more saturated version of the same colour, because live fog
pulled measured chroma from 0.44 to 0.31, one nudge off the floor: aerial perspective
should cost value and shift hue, not neutralise colour.

Worth recording: **the metric gates passed the over-fogged frame.** `flatFraction`
even *improved*, to 0.9935 — because everything had been flattened into mush. The
harness cannot tell "beautifully simplified" from "washed out". Only the screenshot
caught it.

| # | Finding | Verification | Fix |
|---|---|---|---|
| 1 | Height fog identically zero | Traced the sign by hand; `integrated >= 0` proven from both branches of the ray-Y division | Operand order corrected to `.abs().negate()`, density recalibrated, fog hue re-saturated |
| 2 | `BOULDER_COUNT` 16 vs 15 layout entries | Counted programmatically; `detailScale` is exactly 1 on High/Ultra/Extreme, so the draw asked for 16 matrices from a 15-matrix buffer | `BOULDER_COUNT` now DERIVED as `BOULDER_LAYOUT.length` — the two can no longer drift |
| 3 | Flood-fill queue one slot short | Reproduced the exact pattern in isolation: `Int32Array(count)` with `queue[tail += 1]` writes 1..count, and index `count` is silently DISCARDED by a typed array. Bites when one cluster holds every bright pixel — i.e. the single-focal-note ideal the metric exists to reward | `count + 1`; same `+1` applied to `largestFlatRegion` |
| 4 | Board-aperture test inspects zero objects | Measured: 12 meshes, 3 non-instanced, **0** surviving both filters. The test could never fail | Rewritten — see below |
| 5 | Troll contact shadow pinned at the pre-move anchor | Disc was a world-space distance from a hardcoded (18.2, -19.2); new waypoints start at x 22.2, so it sat ~4u from a 3u falloff — detached at every beat | Falloff moved to disc-LOCAL coordinates and the mesh now tracks him each frame |
| 6 | Refraction ran on all six tiers | Confirmed ungated; the three lean tiers have no reflector *precisely because* their GPUs cannot afford one | Gated to `qualityProfile.bloom === true` |
| 7 | Fog's 2-octave fractal ran per fragment on every fogged material at every tier | Confirmed ungated, and it became a real cost the moment the fog started working | Lean tiers keep the mist SHAPE and lose only its internal turbulence |
| 8 | Procedural hero trunks resurrect on any quality change | The GLB loader trims `heroWood.count` to 2 so the authored trunks do not z-fight the procedural ones, but `applyQualityProfile` reassigns that count unconditionally — so changing graphics quality after load put the duplicates straight back | Count clamps to 2 while `authoredHeroReady`. Measured side effect: removing the doubled trunks lifted saturation p50 from 0.32 to 0.47, which also retired the concern about sitting on the chroma floor |

Not addressed: the authored hero trunks are not on the reflection layer, so they
do not appear in the lake. They are cropped framing elements at the frame edges,
largely outside the water, and adding them is a composition decision rather than
a defect fix — left for a deliberate pass.

### The composition guard was ceremonial in both directions

The board-aperture test skipped `isInstancedMesh` and then dropped anything wider
than 60u. Every discrete prop in this forest is instanced and every remaining mesh
is a spanning surface, so it inspected nothing. The runtime's `focalIntrusions`
diagnostic is little better: a world-space `|x|` check over three hardcoded magic
numbers plus the mushroom cluster x's.

It also asked the wrong question. The scene is a backdrop and the board is a
translucent overlay in front of it, so props legitimately appear behind the play
field — **105 instances project inside the rect**, nearly all distant reeds and
lilies down the channel. What would damage the product is a prop near and large
enough to CROWD the board.

A flat apparent-size threshold cannot express that: a legitimate treetop on the
horizon subtends 0.064 of frame width and a boulder dropped in the middle of the
lake subtends 0.068. What separates them is DEPTH. Measured worst case inside the
rect, by distance band at Extreme:

| distance | worst apparent radius | what it is |
|---|---|---|
| 0-60 | 0.028 | lilies |
| 60-90 | 0.023 | lilies |
| 90-140 | 0.043 | shore roots |
| 140+ | 0.064 | far forest |

The gate is now `0.02 + distance * 0.0003`, roughly 35% above each band, evaluated
per INSTANCE from the real instance matrices. Verified in both directions: it
passes the clean scene and **fails** on a boulder planted mid-lake
(`r=0.062 > 0.038`). The first attempt to prove it could fail used a boulder that
projected off the bottom of the frame at screenY 1.68 — a reminder that a test
which has never been seen to fail has not been tested.

## 3b. Character locomotion (2026-07-28)

The beat structure in §3 says WHERE the characters are; this says how they get
there. The original implementation moved the troll along a single X axis at
constant speed, which traces an identical line every cycle and reads as a rig on
a rail rather than a creature.

**Troll** — waypoints are now `[x, z]` pairs with +-1.6u per-arrival scatter, so
he never stands in the same spot twice. Legs ease in from a standstill and out
into the arrival instead of snapping to full pace, with a 35% chance of a
0.8-2.4s mid-leg hesitation. Facing follows velocity while walking and blends
toward the spirit as stride falls to zero — a character that walks sideways
while facing camera is the loudest tell of a rig on a track.

**Spirit** — she drifts rather than walks, so she gets the opposite treatment:
no weight, no footfall, no eased stop. A slow two-component perpendicular sway
(detuned so it never resolves into a visible circle) plus a vertical bob, applied
to POSITION rather than to the target so it never fights the approach or leaves
her short of where the composition wants her. Anchor scatter is +-0.9u, smaller
than his because her anchors are compositional.

**Determinism.** The wander RNG is seeded and owned by the state machine's
closure. Two things were caught here and both mattered: `Math.random()` would
make two runs of the same seed diverge, which breaks phase-locked capture and
replay; and putting the RNG *on the state object* breaks the determinism test's
deep comparison, because function identities never match across instances.
Natural variation and reproducibility are not in tension — the randomness just
has to be owned rather than ambient.

Measured with a path-curvature probe over 60s: troll z-range 5.99 (previously
zero — it was a pure X line) and spirit z-range 10.25. Note that tortuosity is a
poor measure for these paths because both are closed loops, so net displacement
tends to zero by construction; average speed is the honest number (~1.2 u/s
drift against a 1.45 u/s walk).

### Volumetric shafts — blocked, and why it is off rather than shipped

`rendering/stillwater-shafts.js` is complete and carries two r181 findings that
cost real time to establish:

1. `VolumetricLightingModel` early-returns for any light whose `.distance` is
   `undefined` (`three/src/nodes/functions/VolumetricLightingModel.js:149`), so a
   DirectionalLight — the obvious choice for a moon — is silently skipped with no
   error and an empty volume. It must be a SpotLight with a finite distance.
2. `material.scatteringNode` is not a node. It is invoked as
   `scatteringNode({ positionRay })` and its result MULTIPLIES the accumulated
   light, so it must sample `positionRay` (not `positionWorld`, which is not the
   march sample point inside the loop) and sit around unity. A small absolute
   value does not mean "thin fog", it means "no shafts".

With both corrected the graph still emits `scatteringDensity * null` in WGSL.
Four hypotheses have since been eliminated by bisection, each reproducing the
identical error: this module's scattering graph (a trivial `() => float(1.5)`
fails the same way), `material.steps`, the shadow map, and raw-function versus
`Fn` form. The fault is inside three r181's volumetric plumbing for this
configuration, not in how this module uses it.

It is gated behind `?shafts=1` rather than shipped: a broken shader in the
default path is worse than a missing feature, and marking the wave "done" over a
live WebGPU error would be a false report. The next step is a minimal
reproduction OUTSIDE the theme — bare scene, `VolumeNodeMaterial`, one SpotLight
— to establish whether this is r181 generally or an interaction with this theme's
PostProcessing/MRT chain. The four eliminations are recorded in the module so
they are not repeated.

## 4. Waves

Ordered by emotional/visual payoff per unit of risk. Waves 1-3 are all
transformative/low-risk and add no assets — do those first.

| # | Wave | Payoff | Risk |
|---|---|---|---|
| 1 | The Key (value ladder, chroma funnel, quantised depth) | transformative | low |
| 2 | The Frame and the Mass (composition + crown normals, zero new assets) | transformative | low |
| 3 | The Offering Loop (story, pure JS, zero GPU) | transformative | low |
| 4 | The Brush (background-only Kuwahara + watercolour edge + granulation) | transformative | high |
| 5 | The Water as Paint | strong | medium |
| 6 | Moonbeams and Living Air | strong | medium |
| 7 | The Trees (authored assets) | strong | medium |
| 8 | The Land, and the evidence of a thousand nights | moderate | medium |
| 9 | The Dawn Clock, the fiddle, and final calibration | strong | medium |

### Wave 1 — The Key (value ladder, chroma funnel, quantised depth)

**Payoff:** transformative · **Risk:** low

**Goal.** Force the entire frame into Bauer's measured value and saturation band and flatten depth into four washes, so the spirit becomes the only bright thing in the picture. This is the single change that most transforms the feeling and it adds no geometry, no assets and no draw calls.

**Work.**

1) scripts/bauer-metrics.mjs — loads a PNG, prints Rec.709 luma percentiles (p5/p25/p50/p75/p95), HSV saturation p50/p99, frac(|grad L|<4), largest connected flat-region %, count and centroid map of pixels above L80. Seed scripts/bauer-targets.json from the eight Wikimedia Bauer scans so the target band is data, not taste.
2) Rebake the shipped 16^3 LUT (scripts/bake-stillwater-lut.mjs -> public/assets/luts/stillwater-bauer-16.png): per cell, HSV, S = min(S, 0.30 + 0.30*smoothstep(0.75,1.0,V)); hue funnel field->150-200 deg, accents->30-45 deg. Zero runtime cost over what you already pay for Lut3DNode.
3) src/themes/stillwater/stillwater-post.js — post-ACES tone curve node: black lift 0.06, hard shoulder from 0.62, bypassed where the existing selective-bloom MRT emissive mask flags spirit/lantern.
4) Author-side clamp: terrain, tree, rock and mushroom colorNodes clamped to HSV V <= 0.55 so no albedo can ever be light.
5) Quantised aerial plates as ONE post function from linear view depth (not per-material — per-material authoring will desync): bands 0-25u #2B3230 fog 0.0; 25-60u #4A5044 0.45; 60-110u #6A6E6B 0.75; >110u flat #7B7F79; 1.5u smoothstep blends at each edge.
6) Offender pass: moon disc emissive down to L70, moon specular lane narrowed to the reflection lane and peak-clamped, fog plate capped L55, firefly brightness -40%, replace the troll's foxfire eyes with 2 dots each <=0.4% of head silhouette area at #C8933F, emissive just above the shoulder.

**Acceptance.** Six phase-locked captures (?t=0,12,37,61,94,140) run through scripts/bauer-metrics.mjs: p50 in 28-34, p25 >= 15, p75 <= 50, p95 <= 62; S p50 in 0.19-0.32, S p99 <= 0.55; pixels above L80 <= 5% of frame AND >= 85% of them inside the spirit+reflection bbox. Split-screen against the Tuvstarr tarn scan in the playground (?ref=...&refMode=split). Ship the metrics run as a repeatable npm script so every later wave re-proves it.

### Wave 2 — The Frame and the Mass (composition + crown normals, zero new assets)

**Payoff:** transformative · **Risk:** low

**Goal.** Make the forest colossal and the figures tiny, crop the hero trunks out of frame, and kill blobby crown shading with a four-line normal override — the two cheapest 'this is a painting' levers left.

**Work.**

1) Re-layout the existing instanced trees against the solo camera: two hero trunks at 12-20u, 0.9-1.4u thick, scaled so their crowns exit the top of frame entirely; canopy arch confined to the top 22-28% of frame height and the outer 18% per side; centre 36% of width kept clear. Freeze transforms into a reviewable JSON, and add a layout unit test that projects instance bounds and asserts zero intersection with the board safe rect.
2) Two foreground repoussoir occluders in the lowest 15% of frame at the left/right thirds, folded into the existing rock instance set (zero extra draws), albedo x0.25.
3) Procedural sphere-projected crown normals on the instanced tree material: normalNode = mix(normalGeometry, normalize(positionGeometry.sub(uCrownCentreLocal)), 0.75). MUST source positionGeometry — r181's InstanceNode reassigns positionLocal before positionNode runs (the trap this repo has already hit twice).
4) Foliage 2-band posterisation with soft terminator: stepped = smoothstep(0.30,0.62, moonDir dot normalWorld * 0.5 + 0.5) * 0.75 + 0.25; colorNode = mix(shadowTint, albedo, stepped). Distance chroma loss mix(1.0, 0.35, d) applied BEFORE the LUT so the LUT still gets to do its teal-shadow/warm-highlight work.
5) Permanent QA: ?silhouette=1 flag (scene.overrideMaterial = black MeshBasicNodeMaterial, white background).

**Acceptance.** Silhouette capture resolves into <= 6 separable masses with the two heroes cropped at frame top. frac(|grad L|<4) >= 0.45. Total flat area >= 30%, largest connected flat region >= 18%. Layout test green. Character height <= 7% of frame height. Wave 1 metrics still in band.

### Wave 3 — The Offering Loop (story, pure JS, zero GPU)

**Payoff:** transformative · **Risk:** low

**Goal.** Convert two idling props into a relationship the viewer completes themselves. Highest emotional payoff per line of code in the entire plan, and it cannot break a pixel.

**Work.**

1) src/themes/stillwater/stillwater-director.js — renderer-free pure module, same pattern as vesper-chrysalis-director.js / storm-director.js. FSM over the five beats (90/25/35/45/45s + 20-40s jitter) writing a blackboard: {trollPathU, trollFacing, lanternIntensity, lanternWorldPos, spiritPathU, spiritGlow, gazeTarget, I, featureToken, D}.
2) Two-bone additive look-at (neck 0.35, head 0.65), cone clamp +/-55 deg yaw / +/-25 deg pitch, critically damped slerp alpha = 1-exp(-omega*dt), omega 4.5 troll / 9.0 spirit. Saccades: hold 2.5-6s then flick in 120-180ms. CRITICAL ORDERING: apply AFTER mixer.update(dt) and BEFORE scene.updateMatrixWorld(true), post-multiplying Bone.quaternion in parent-bone space — doing it before mixer.update is silently overwritten every frame and is the #1 reason additive look-at 'does nothing' in three.
3) Additive idle noise layer: 6-10 single-frame poses per character authored in Blender, exported in the same glTF, AnimationUtils.makeClipAdditive + AdditiveAnimationBlendMode, weights w_i = 0.5+0.5*sin(t*f_i + phi_i) with f_i drawn from 0.07-0.31 Hz deliberately non-harmonic, global amplitude 0.25. Breath 0.18 Hz troll / 0.42 Hz spirit.
4) featureToken enforcement: the non-featured character is clamped to 0.15x animation weight and translation speed.
5) claim(kind, amount) helper gating all ambient intensity/position changes: QUIET = ramps >= 2.5s and translation < 0.6 u/s; CLAIM = fast onset allowed, budget 1 per 60s, refilled on a timer, violations logged in dev.
6) Gameplay accumulator subscribed to src/events/gameplay-events.js (weights and refractory as in the story arc).
7) tests/stillwater-director.test.js — no renderer.

**Acceptance.** Unit tests: featureToken never dual-held in any frame; 20 rapid tetrises produce <= 1 response fire; 45s refractory holds under adversarial input; I never exceeds 0.85 and separation never drops below 7u; a simulated 40-minute run produces no repeated 60s response sequence and no visible loop boundary (beat phase offsets verified). Visual: five phase-locked captures at beat midpoints, each readable under ?silhouette=1.

### Wave 4 — The Brush (background-only Kuwahara + watercolour edge + granulation)

**Payoff:** transformative · **Risk:** high

**Goal.** Change the image's grammar: flatten interiors into brush-shaped patches while sharpening silhouettes, then add wash-boundary darkening and paper tooth. This is the technique that makes a render read as paint rather than as a photo of a model.

**Work.**

1) src/themes/stillwater/stillwater-painterly.tsl.js, four chained Fn graphs over pass() textures, applied to the BACKGROUND render target only; board and pieces composite on top afterwards.
   Pass A: structure tensor into RGBA16F — 3x3 Sobel -> vec3(gx.gx, gy.gy, gx.gy) + luma.
   Pass B: gaussianBlur(tensor, null, 2). This sigma is the real temporal-stability knob; Kyprianidis's anisotropic variant is temporally coherent precisely because orientation comes from the SMOOTHED tensor, so tune here before reaching for TAA.
   Pass C: analytic eigen-decomposition -> orientation + anisotropy; ellipse a = alpha/(alpha+aniso), b = (alpha+aniso)/alpha clamped to 4:1; Loop over 8 sectors, radius = 5*(height/1080) px (scale with resolution or the LOOK changes with window size), polynomial weights eta=0.1 lambda=0.5, min-variance sector by luminance dot(var, vec3(0.299,0.587,0.114)).
   Pass D: watercolour edge darkening x0.78-0.88 over 2-3px from max(sobel(viewportDepthTexture), sobel(MRT view normal)) through smoothstep(0.02,0.12); variable tinted contour width mix(3.0,1.0, viewDist/60) px, colour = col*0.55 with hue +8 deg warm, multiplied by 1-smoothstep(0.15,0.25, dLuma) so already-contrasting boundaries get no line; then granulation from a 1024^2 tileable paper texture sampled by screenCoordinate/1024 at NATIVE res, v *= mix(1.0, 0.90+0.20*grain, saturate(1-L*1.6)), amplitude <= 0.08.
2) Masking: strength = depthMask (0 inside 25u, 1 past 40u) x boardMask (0 over the board rect + 1.2x margin, 6px feather) x charMask (0.5 on troll/spirit via MRT id).
3) Ordering: after bloom, before LUT/grain. Never full-screen.
4) Temporal insurance: add velocity to the existing mrt({...}) and wire traa(color, depth, velocity, camera). Cheaper fallback if velocity proves painful: feed Kuwahara a boxBlur(color, {size:int(1), separation:int(1)}) and raise polynomial hardness.

**Acceptance.** Judged in MOTION, not in a ?t= shot — the repo's ?t= freezes dt and hides exactly this artefact. 10s 60fps capture: per-pixel temporal luma variance in static regions (water body, far ridge) < 2/255, i.e. no sector crawl. Board legibility A/B: measured piece-edge contrast within 1% of the unfiltered build, and a human play session confirms no perceived smear. Frame cost < 2.0ms at 1440p on the 5080. frac(|grad L|<4) rises by >= 0.10 over Wave 2.

### Wave 5 — The Water as Paint

**Payoff:** strong · **Risk:** medium

**Goal.** Stop the lake being a mirror with fresnel and make it a dark field with a few muffled shapes in it — the lower half of frame must stop reading as 'more scene' and start reading as air the eye can rest on.

**Work.**

Iterate in src/playground/effects/stillwater-water.effect.js, then port.
1) Painted-mirror transform on the reflector RT: col = mix(luminance(refl)*bodyColour, refl, 0.65) * 0.62 + 0.03; vertical smear v' = hV + (v-hV)*1.25; mip-LOD ramp level = mix(3.5, 0.2, saturate(dist/45)) via texture level or textureBicubic — blurred NEAR, sharp FAR. Do NOT run a gaussian pass over a 0.30-scale RT.
2) Flow-warped distortion sharing the SAME flow normal as the specular (mismatch is the classic tell): offset = flowN.xz * 6.0 / max(-positionView.z, 1.0), wrapped in viewportSafeUV.
3) Per-channel Beer-Lambert: sigma = (0.30, 0.55, 1.10) per unit, d = viewportLinearDepth - surface depth, clamped [0,8]; plus in-scattering bodyColour #1B2420->#2A2B22 with sigma_s 0.8. This is the tannin-lake signature: warm touchable shallows, true black by 4-6u.
4) Shore-weighted screen-space refraction: viewportSharedTexture(viewportSafeUV(...)), weight exp(-0.9d), offset <= 0.03 UV. Spend it only where the bed is close.
5) Two-phase flow-map cycling (Vlachos/Portal 2): 512^2 linear non-sRGB flow map, mostly 0.50 +/- 0.02, speeds 0.02-0.06 u/s, two normal samples at phases offset 0.5, weight = |1-2*frac(p)|, cycle 0.06-0.12 Hz, per-texel noise offset so texels don't reset in lockstep.
6) Hex-tiled (Mikkelsen 3-tap) detail normal + amplitude ramp mix(vec3(0,0,1), n, smoothstep(45,12,viewDist)) — far water must be a single flat value.
7) Curl-warped 5-band value quantisation on the BODY term only (never specular or the moon lane, or you get banding that looks like a bug); analytic curl from two offset noise samples e=0.05; tune AFTER the LUT because ACES+LUT move the band positions.
8) Faint foam: intersection band [0, 0.12] and swash [0.10, 0.45], peak 0.30, tint #8C9A8E, never white.
9) Wet-edge on the BANK (the other half of the shoreline): 0.15-0.60u above uWaterY, albedo x0.60, saturation +20%, roughness -> 0.15, feathered by the foam noise, sharing the water plane's uWaterY uniform so they can never desync.
10) Contact map: 256^2 R8 top-down ortho splat baked once at scene build; water albedo x(1 - contact*0.45); meniscus rim on props = smoothstep(0.03, 0.0, |positionWorld.y - uWaterY|) * localLightColour * 0.8 into emissive.

**Acceptance.** Split against the Tuvstarr tarn. Reflection p95 luma <= 0.62x the source geometry's p95. No visible tiling across the full 60u lake at the solo camera. Foam never exceeds L60. Animating uWaterY +/-0.3u moves the wet band and the foam together. Wave 1 metrics still in band with the water now at ~30% of frame.

### Wave 6 — Moonbeams and Living Air

**Payoff:** strong · **Risk:** medium

**Goal.** Make the light visible and genuinely occluded by the canopy, pool the mist in the valley instead of over everything, and give the glade a slow biological pulse. This is the Bauer image: light carved by branches.

**Work.**

1) THREE.VolumeNodeMaterial box spanning the canopy gap: steps 12, offsetNode = bayer16(screenCoordinate) from three/addons/tsl/math/Bayer.js (documented in-source as letting you use fewer steps without hurting visuals), depthNode from the scene pass depth so the volume respects occlusion. GOTCHA that will cost you a day if missed: VolumetricLightingModel early-returns for lights with distance === undefined — drive it with a SpotLight with a finite .distance placed along the moon direction, castShadow, shadow.mapSize 2048 tightly framed on the arch. NOT a DirectionalLight.
2) Render it in its own pass at setResolutionScale(0.25) (setResolution is deprecated in r181), gaussianBlur(volTex, null, 4), additive composite. The low-res+blur path is MORE painterly than a sharp march.
3) scene.fogNode = fog(colorNode, factorNode) with Quilez height-integrated exponential: a=0.22, b=0.055, rd.y guarded by sign(rd.y)*max(|rd.y|,1e-4); colour = mix(#3A4A63, #C8B48C, pow(max(dot(rd, moonDir),0), 8)). rangeFog/densityFog are deprecated since r171.
4) Bounded valley mist inside scatteringNode: smoothstep(4.0, 0.0, y) * smoothstep(28.0, 8.0, |x|) * (triNoise3D(p*0.04, 0.12, time) + 0.5). Mist that lies IN the valley creates layers; mist over everything flattens the frame.
5) GPU-compute fireflies: instancedArray(240,'vec3') pos/vel + seed, Fn().compute(240) per frame. Drift = mx_noise_vec3(p*0.35 + time*0.08) as pseudo-curl + weak spring to 8-12 baked cluster centres near the bank grass and mushrooms. Flash envelope: ph = fract(time/5.5 + hash(instanceIndex)), flash = smoothstep(0.055,0,ph)*smoothstep(0,0.012,ph) — ~0.3s lit per 5.5s, matching Photinus pyralis — plus a 0.15 idle floor and a small +Y impulse during flash for the J-hook. REPO GOTCHA: positionNode = buffer.element(index) collapses every vertex to a point; use positionLocal.add(buffer.element(index)).
6) Second draw, 400 cold-white dust motes <= 2px at 0.02-0.05 u/s, brightness multiplied by the volumetric density sampled through viewportSharedTexture of the vol RT. This one coupling is worth more than doubling any particle count.

**Acceptance.** Moving a tree instance visibly changes the shaft's dapple pattern (proves real shadow-map occlusion, not a billboard). Motes measure <= 0.02 brightness outside the beam vs >= 0.6 inside. No banding at 12 steps. Volumetric pass < 0.8ms at 0.25 scale on the 5080. Of 240 fireflies, <= 6 lit in any frame and each dark >= 90% of the time. Fog does not raise the far-plate ceiling above L55.

### Wave 7 — The Trees (authored assets)

**Payoff:** strong · **Risk:** medium

**Goal.** Replace displaced-cylinder blobs with hand-modelled gnarled trunks and plate-massed leaf cards, and light the canopy from behind with the moon. Species read comes from silhouette, not from polycount or bark texels.

**Work.**

BLENDER: 3 hero trunks, 8-14k tris each — pronounced elephant-foot root flare, 2-3 thick low limbs reaching horizontally before turning up, one dominant lean, bark ridges as real geometry on the camera-facing side only (Modular Tree as skeleton, then sculpt). Crowns = 20-60 alpha-tested cards clustered into 5-9 DENSE OPAQUE plates with real air between them; even scattering stays lacy at any card count (the PineHero finding). 2048^2 atlas: 6 leaf-cluster variants + 2 twig variants. Data Transfer custom normals from an ellipsoid at 1.15x crown bounds, mapping 'Nearest Corner and Best Matching Normal', mix 0.75, applied — and keep shade-smooth ON or the split normals never reach the glTF NORMAL accessor. Vertex colours: R = detail-bend stiffness, G = per-leaf phase, B = trunk mask (trunks painted pure blue -> zero detail motion). LODs 15-25k / 3-8k / 500-1500. Export to public/assets/themes/stillwater/ and git add explicitly (this repo has lost untracked chapter GLBs before).
THREE: alphaTest 0.4, DoubleSide, transparent FALSE (alpha-test only sidesteps all WebGPU sort pain), alphaToCoverage with a 4x MSAA target so card edges dissolve softly. Backface fix: normalNode = spherized.mul(frontFacing.select(1,-1)). Moon transmission into emissiveNode: pow(saturate(dot(-viewDir, uMoonDirView)), 3.0) * thickness (from vertex-colour alpha or the atlas green channel) * uMoonColour * 0.9, plus a weaker warm copy from the lantern. Crytek two-tier wind: quadratic-in-height main bend with length renormalisation, 4-sine detail at 1.975 / 0.793 / 0.375 / 0.193 Hz gated by vertex colours; per-instance phase dot(instancePosition, vec3(1)); gust from a panning fbm so gusts travel across the treeline. Read colours via attribute('color','vec4') — do NOT set material.vertexColors = true or it tints albedo.

**Acceptance.** normalWorld rendered as colour shows each crown as a single smooth ramp, no facet noise. Wind at strength 0 is bit-identical to static (no drift). Three trunk meshes with varied scale 0.85-1.25 / Y-rotation / XZ squash 0.92-1.08 read as >= 10 distinct trees in a capture. Transmission emissive measured below the bloom threshold (it must glow, not bloom). Wave 2 composition asserts still green with the new bounds.

### Wave 8 — The Land, and the evidence of a thousand nights

**Payoff:** moderate · **Risk:** medium

**Goal.** Make the bank read as ground rather than a coloured plane, kill the moss shading seam at its root cause, and dress the scene so the four-minute loop implies years.

**Work.**

1) Delete the world-space moss term (this is the seam: a world/object-space mask crossing geometry bands). Replace with baked vertex data: Blender Cycles bake AO + a Geometry Nodes 'Pointiness' capture into COLOR_0 on a 40-80k-vert terrain (still 10x under budget). mossMask = smoothstep(0.35, 0.75, cavity) * slopeMask; diffuse *= mix(0.55, 1.0, ao). An attribute baked per-vertex cannot cross geometry, because it IS the geometry.
2) Hex-tiled (Mikkelsen 3-tap, no histogram LUT) triplanar bank material over one 2k albedo+normal; plain planar XZ UVs where slope < 35 deg to save the projection blend. Recompute the lattice once and reuse the weights/offsets for albedo and normal.
3) Four layers — wet dark mud / moss / exposed granite / leaf litter — combined by HEIGHT-MAP blending with k = 0.10 (not linear lerp, which is what produces the mush), slope mask smoothstep(0.55, 0.85, normalWorld.y), height mask + low-freq fbm at 0.8u amplitude so the shoreline band is irregular rather than a contour line. Litter mask painted as a vertex-colour channel under the canopy arch.
4) Four sculpted boulder variants 800-2500 tris, sunk 25-40%, lower band vertex-coloured dark to blend into the terrain (authored hard line, no depth read), with skirt debris cards. Ferns and tall grass clustered on the bank SILHOUETTE edge — the edge against water and fog is where the eye judges 'is this a place'.
5) Evidence props (Carson's rule, zero animation): a worn bare path vertex-colour-baked along the troll's exact walk spline; 4 extinguished lanterns half-sunk at the shoreline as one InstancedMesh with varied tilt/sink; a flattened grass patch where the spirit stops (reuse the clump system at 0.3 scale, rotated flat); a ring of pale stones on his bank facing the water.

**Acceptance.** Seam gone: diff the pre/post capture in the seam region, max delta L < 3. No visible repeat across the full bank at the solo camera. Draw count +<= 6. Retuning the director's walk spline visibly moves the worn path (proves the shared source). Wave 1 metrics still in band with the bank now textured.

### Wave 9 — The Dawn Clock, the fiddle, and final calibration

**Payoff:** strong · **Risk:** medium

**Goal.** Give the loop a one-way arc so it has no seam, put the music in the water rather than in a character, and re-prove the whole grade at every point of the arc.

**Work.**

1) Session scalar D in [0, 0.94] over ~25 min, nudged by stack height, feeding: LUT blend weight, fog density, horizon colour node, and beat-availability gates in the FSM (D>0.7 disables APPROACH; D>0.9 triggers PETRIFY — roughness -> 0.95, saturation -> 0.25, world-up moss mask creeping over the body via saturate(dot(normalWorld, up))^2.5 broken up by triplanar noise, mixer.timeScale -> 0.05, held pose). Spirit emissive and mote count taper with D. Never reach sunrise.
2) Nacken's fiddle: THREE.PositionalAudio on an empty at the water centre, refDistance 12, sparse nyckelharpa/fiddle, 2-4 notes with long silences, active ONLY during APPROACH and OFFER, routed through src/audio/sound-effects.js with a ducking gain node at -6 dB under gameplay SFX. MUST be opt-out — the visual loop has to be complete with audio off.
3) Two-tap bloom off the emissive MRT: halo = bloom(em, 0.6, 1.0, 0.0) tinted warm + core = bloom(em, 1.2, 0.25, 0.85) neutral. A single bloom is either foggy screen or hot dots; two taps give the lantern a crisp warm core and a large soft glow, which is how a painter renders a light at night. Optional anamorphic(em, 0.9, 3.0, 32) at mix <= 0.15 on the MOON ONLY.
4) Radial chromatic aberration: 0 inside screen radius 0.28 (the board), ramping to 0.0015 at the corners. Far-ridge softening via mix(out, gaussianBlur(out,null,2), smoothstep(60,120, -viewZ) * 0.4) — never dof(), never near-field blur.
5) Re-run scripts/bauer-metrics.mjs across D = 0, 0.35, 0.70, 0.94 and at all five beat midpoints.

**Acceptance.** Every Wave 1 metric stays in band at all four D values and all five beats — 20 captures, one table, all green. A 40-minute recorded session contains no repeated frame-pair and no perceivable loop boundary. Audio muted: the arc still reads. Petrify state is readable under ?silhouette=1 as the troll merging with the hillside mass.

## 5. What we are deliberately NOT doing

Every item below is a standard 'more quality' instinct that actively fights the measured target. They all add mid-frequency gradient or a second bright note — precisely the two things Bauer's pictures do not contain. Declining them is what funds the Kuwahara/edge/granulation stack that does show.

1. Bark albedo + normal textures on trees. At p50 L30 with a 0.62 shoulder, and after a radius-5 Kuwahara, high-frequency bark is invisible mid-frequency noise. You would pay authoring time and VRAM for a texture the grade deletes. Keep bark as GEOMETRY on the two near trunks only, and keep any bark normal intensity <= 0.5.

2. Full-screen painterly post. Non-negotiable: at radius 5 the Kuwahara smears falling blocks and the anisotropic ellipse will streak along piece edges. Background-only, with a board mask at 1.2x safe margin. Gameplay legibility outranks art direction at the exact moment they conflict.

3. Lake-bed caustics. Physically near-invisible here (full moon ~0.1-0.3 lux vs ~100,000 for sun) and tannin water absorbs far more than it refracts. Worse, bright caustics would puncture the dark water field the whole composition rests on. If you want the read at all, cap it at 0.03-0.06 intensity, restricted to depthDiff < 0.8 AND inside the existing moon lane, using min(c1,c2) of two samples rather than a sum. The honest substitute — already funded in Wave 5 — is the shoreline wet-edge band, ~6 TSL nodes and visible in every single frame.

4. Physically accurate refraction as a headline feature. Bauer's water refracts the LACK of light. Screen-space refraction is worth doing ONLY shore-weighted (exp(-0.9d)); in the deep channel extinction eats it entirely. Also be honest about the limit: without a depth prepass, viewportSafeUV mitigates but does not eliminate foreground bleed, so keep the offset <= 0.03 and expect the troll's silhouette to smear if he ever stands between camera and water.

5. Any cel/toon ramp or hard banded lighting. Reads as Japanese anime, not Swedish watercolour, and it kills the melancholy instantly. The permitted flattening is a 2-band posterisation with a SOFT terminator (smoothstep 0.30-0.62) and region-flattening via Kuwahara — never a stepped light ramp.

6. Uniform black cel outlines. Bauer is not Kittelsen; his boundaries are wash edges and value shifts. Uniform ink reads as cartoon. Only variable-width, hue-warmed, contrast-suppressed contour ships.

7. SSGI, high-radius denoise(), and DepthOfFieldNode. SSGI adds exactly the smooth mid-frequency bounce gradient we are spending three waves removing. denoise() at high radius is Kuwahara's worse-looking cousin at similar cost. dof() produces photographic bokeh, which announces a camera lens; and near-field blur would fight the board. Use a depth-ramped gaussianBlur on the far ridge only.

8. GPU ping-pong water height field (512^2 R16F). Genuinely sub-0.1ms on a 5080, so this is NOT a perf refusal — it is a complexity refusal. The only thing it buys over the existing analytic fixed-slot wakes is ripples that reflect off the banks and interfere; it costs ~150 lines and a new determinism surface for replays. Ship Wave 5's curl-quantisation first and re-judge. Analytic wakes remain strictly better for discrete gameplay events: cheaper, deterministic, individually art-directable.

9. Cloth simulation on the spirit's robe, or a wide rim-light halo. Her silhouette must be a simple unbroken vertical column; a fluttering hem breaks the one clean shape in the picture and a fat halo dilutes the only bright note. Rim <= 3px.

10. Big glowing foxfire eyes on the troll. The fastest possible way to make him read as menace and destroy Bauer's whole register — his trolls are shy, lumbering and more curious than bloodthirsty. Two dots, each <= 0.4% of head silhouette area, deep under a heavy brow, in occlusion.

11. Dense constant fireflies and any bright twinkling particle field. Uniform sine twinkle at uniform density is the tell that they are decoration, and every extra lit mote is another pixel competing with the spirit. Sparse, rare, mostly dark.

12. FilmNode / film() for the paper grain. It is animated scanline grain and it will crawl. Paper is static and locked to screen pixels: sample by screenCoordinate/1024, never screenUV, or it swims on resize.

13. 1:1 gameplay-to-character mapping (line clear -> troll reacts). Reads as a slot machine and destroys the illusion of volition. Accumulator + jitter + 45s refractory + draw-without-replacement, or nothing.

14. Chasing texel density anywhere. If a proposal lowers frac(|grad L|<4) below 0.45 or raises the flat-area fraction below 30%, it is rejected on the metric regardless of how good the asset is. The scene is finished by subtraction.

Sources: [three.js r181 release / WebGPURenderer volumetric lighting PR #30530](https://github.com/mrdoob/three.js/pull/30530); [VolumetricLightingModel docs](https://threejs.org/docs/pages/VolumetricLightingModel.html); [Kyprianidis et al., Image and Video Abstraction by Anisotropic Kuwahara Filtering (PG2009) — temporally coherent via the smoothed structure tensor](https://www.kyprianidis.com/p/pg2009/index.html); [Maxime Heckel, On Crafting Painterly Shaders](https://blog.maximeheckel.com/posts/on-crafting-painterly-shaders/); [Curtis et al., Computer-Generated Watercolor, SIGGRAPH 97](https://grail.cs.washington.edu/projects/watercolor/paper_small.pdf); [Vlachos, Water Flow in Portal 2, SIGGRAPH 2010](https://cdn.akamai.steamstatic.com/apps/valve/2010/siggraph2010_vlachos_waterflow.pdf); [Mikkelsen, Practical Real-Time Hex-Tiling (JCGT)](https://jcgt.org/published/0011/03/05/paper-lowres.pdf); [Quilez, Better Fog](https://iquilezles.org/articles/fog/); [Lagarde, Physically based wet surfaces](https://seblagarde.wordpress.com/2013/04/14/water-drop-3b-physically-based-wet-surfaces/); [Helder Pinto, smooth foliage via sphere-projected normals (Polycount)](https://polycount.com/discussion/209623/smooth-foliage-like-in-breath-of-the-wild-europa-by-helder-pinto-mini-tutorial); [Carson, Environmental Storytelling](https://www.gamedeveloper.com/design/environmental-storytelling-creating-immersive-3d-worlds-using-lessons-learned-from-the-theme-park-industry); [Game AI Pro 2 Ch.36, noise-based additive idle layering](https://www.gameaipro.com/GameAIPro2/GameAIPro2_Chapter36_Realizing_NPCs_Animation_and_Behavior_Control_for_Believable_Characters.pdf); [John Bauer — Wikipedia](https://en.wikipedia.org/wiki/John_Bauer_(illustrator)); [Britannica, Photinus pyralis flash timing](https://www.britannica.com/animal/Photinus-pyralis).
