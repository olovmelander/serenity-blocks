# Odyssey Chapter 2 "Deep Ocean" — Vibrancy & Transition Plan

**Status:** Screenshot-grounded review + prioritized upgrade plan, June 15 2026.
**How it was reviewed:** the real shipping builder (`createDeepOceanEnvironment`) was mounted in
the WebGPU playground (`src/playground/effects/deep-ocean.effect.js`, flies the real Ch2 spline
corridor; `?t` scrubs the depth ladder 0→1) and captured with the chrome-devtools MCP at four
depth stations. Backend WebGPU, **clean console** (only a benign `renderAsync` deprecation warning),
**240 fps in isolation** — so every problem below is **art/readability, not perf or validation**.
**Binds to:** `docs/ODYSSEY_JOURNEY_CREATIVE_IMPLEMENTATION_PLAN.md` (art law) and
`docs/ODYSSEY_CHAPTER_MASTERPIECE_PLAN.md` (§3 Ch2 darkness inversion, §4.2 the Escort moment).

---

## The three governing laws (every item was checked against these)

1. **Darkness-inversion art law** — Ch2's #1 documented failure is the "flat bright-cyan caustic
   wallpaper." Vibrancy must come from bioluminescent/caustic **contrast against a dark abyss**,
   *never* a brighter wash. No item may lift the gradient or seabed floor.
2. **Transition continuity** — **1→2** carries the drowned First Heart (oxblood `#7a1500` + amber
   `#ffb35c`, magma→cool, vent dead ~13%, jellies in ~18%). **2→3** is the surface-breach into
   Chapter 3's *verbatim* daylight azure `#2f86d8` + horizon gold `#f0b878`.
3. **TDR/overdraw budget** — ≤3 stacked additive layers per camera ray, draws <100, zero per-frame
   allocation. The dev iGPU has TDR-bluescreened on full-journey captures: per-chapter only.

---

## Visual review — what the screenshots actually show

| Depth (`?t`) | Reads | Verdict |
|---|---|---|
| **Looking *up* the vertical tangent** | full-frame bright caustic texture | reproduces the "flat cyan wallpaper" — the **caustic ceiling's 0.42 brightness floor** is the culprit |
| **0.06 entry** (`t≈1.6`) | warm vent glow bleeds up from bottom-center; one soft god-ray column; dark abyss below | 1→2 handoff **present but faint**; kelp **floats detached** (no visible seabed) |
| **0.30 twilight** (`t≈7.2`) | 2–3 soft god-ray shafts; green kelp band; scattered cyan/magenta motes | darkness inversion **works**; bio life is **sparse small dots**, no big magenta bells |
| **0.50 mid** (`t≈12`) | top-bright ceiling → dark indigo abyss; one jellyfish; kelp | gradient structure **good**; god-rays **soft, not hero** |
| **0.92 breach** (`t≈22`) | gorgeous Gerstner water ceiling + caustics, bright teal gradient | **water ceiling is the chapter's best asset**; **skylight panes absent**, **zero Ch3 warmth** |

**The good news:** the darkness inversion *broadly works* in proper framing (top-bright/bottom-dark),
the Gerstner water ceiling on the breach approach is genuinely beautiful, and the chapter is
perf-clean. The "wallpaper" only appears when the camera stares straight up into the caustic ceiling
— which the 0.42 brightness floor lets bloom at *every* depth (fix 1.2).

### The one defect the code-read missed — broken distant creatures (NEW, screenshot-only)

The multi-agent code review concluded creature "silhouette legibility is good… passes the flat-black
test." **The screenshots prove the opposite.** At the real camera distance, the distant
whale/ray/leviathan masks (`createCreatureSilhouettes` shapes 0/1/3, `NormalBlending`, dark `aTint`
× `depthDarken`) render as **flat dark geometric polygons — triangles, parallelograms, even literal
rectangles** (raw billboard quad edges; visible in every captured frame). They look like rendering
glitches, not sea life. Causes: hard `step()` gates in the masks (`creatureMask` whale tail, ray),
no outer feather to melt the quad edge into water, and silhouettes too dark/hard to read as form.
This is the textbook "authored in code, *broken* on screen" failure — and it is **not** in the
agent synthesis tiers, so it is promoted to **Tier 1 (item 1.6)** here.

---

## TIER 1 — highest impact, low risk (do first)

- **1.1 — Wire the god-ray hero to the music.** Add 6th param `directorState` to
  `updateDeepOceanEnvironment` (`deep-ocean.js:871`; the caller `ChapterEnvironmentManager.js:1093`
  already passes it, `OdysseyDirector` publishes `post.godRay`). Add `uGodRayPulse` uniform; multiply
  the ray `alpha` (`deep-ocean.tsl.js:248`) by it, clamped 1→1.8, keeping the `clamp(alpha,0,0.92)`
  ceiling. The static hero finally breathes with the score. *Transition: none.*
- **1.2 — Kill the caustic wallpaper.** `deep-ocean.tsl.js:166` — change the caustic additive scale
  `approach.mul(0.45).add(0.42)` → `approach.mul(0.85).add(0.05)`. Drops the brightness *floor* so
  the ceiling is near-pure `uDeepColor` at the foot and the veins only ignite on the approach. The
  single biggest darkness-law correction. *Transition: 2→3 (coordinate with 2.1).*
- **1.3 — `DoubleSide` → `FrontSide` on every camera-facing additive billboard** (bubbles `:682`,
  plankton `:818`, jellies `tsl:701`, kelp `tsl:790`, panes `tsl:891`). Camera-facing quads never show
  their back face → free ~2× fill headroom that pays for everything below. Leave the water ceiling
  `DoubleSide` (camera passes through it at the breach). *Screenshot plankton first.*
- **1.4 — Two-color jelly bioluminescence.** `createJellyfishMaterial` — give the *core* a hot
  white-cyan shift `coreColor = mix(aColor, vec3(0.55,1.0,0.95), 0.55)` (bell + halo stay `aColor`).
  Each bell gains internal value structure: hot core crosses bloom, body feathers below → reads as a
  glowing *creature*, not a flat tinted disc. *Transition: none.*
- **1.5 — Desync jelly pulse RATE, not just phase.** Add per-instance `aPulseRate = 0.35+rand*0.45`;
  replace literal `time.mul(1.5/1.7)` with `time.mul(aPulseRate)`, ease via
  `pow(sin(..).mul(.5).add(.5), 1.5)` ("hold dark, snap bright"). The procession stops throbbing in
  lockstep (today it reads as one UI pulse) and becomes a field of independent living things.
- **1.6 — Fix the broken distant creatures (the screenshot defect).** In `creatureMask`
  (`deep-ocean.tsl.js`) replace hard `step()` gates with `smoothstep`, and add an **outer feather**
  (`mask.mul(softQuadEdgeFeather)`) so no quad edge ever reads as a straight line. In
  `createCreatureSilhouetteMaterial`, lift the body off pure black by tinting it toward the
  *surrounding water color* (a translucent "darker-water shape" rather than a black cutout) and
  strengthen the cool rim so far masses read as form. *Validate in the playground at `t=7.2` — the
  rectangle/triangle artifacts must be gone before anything else ships.* *Transition: none.*

---

## TIER 2 — high impact, needs care

- **2.1 — Unify the four breach windows onto one `smoothstep(0.82,1.0,uDepth)` ramp** (water ceiling
  `approach`, god-ray `breachWarm`/`ascentLight`, bubble `breachRush` gate `0.8→0.82`, pane `reveal`
  topping out at 1.0 instead of flat-lining at 0.97). The final act crests as **one** accelerating
  "we are surfacing" surge. *Do 1.2 first.* *Transition: 2→3.*
- **2.2 — Author the missing through-surface breach sun-glow (the 2→3 focal).** New
  `createBreachSunGlowTSL` (warm: core `#ffe6a8`, halo `#f0b878` = Ch3's exact gold), one sprite at
  `corridor.sample(~0.97)` just under the surface along Ch3's sun bearing, `reveal =
  smoothstep(0.86,1.0,uDepth)`, opacity ≤0.7. **Today the warm halo is born only *after* the 4000 ms
  crossfade**, so the breach reads as a scene-swap; this carries Ch3's daylight onto the Ch2 side so
  the camera rides *through* it. *Transition: 2→3 — this IS the carried element.*
- **2.3 — The scripted ESCORT moment (§4.2).** Add `uEscort` (smoothstep bump peaking at depth 0.52)
  + per-instance `aIsEscort`. In the manta branch, `mantaTravX = mix(sin(mantaPhase).mul(46),
  float(25), uEscort.mul(aIsEscort))` and damp `mantaTravY` to a slow match-drift during the hold;
  the sin arc returns (banks away) as `uEscort`→0. Today the manta is on a pure-time ellipse with **no
  progress coupling** — the hero pass lands only by luck. *Transition: none.*
- **2.4 — Backlight the escort manta against a god-ray shaft (the trailer frame).** Read the *placed*
  position of the cone nearest `t≈0.52`, seat the escort lateral 10–20u camera-side of it, lift that
  one cone's alpha + the manta's ventral `bioCyan` rim by `(1+uEscort*0.6)`. The hero image:
  ventral edge rim-lit electric cyan by a shaft behind it. *Depends on 2.3.*
- **2.5 — Make the bioluminescent reef the down-frame hero.** `createSeabedTSL` — widen `reefPocket`
  gate `(0.55,0.78)→(0.48,0.72)`, lower rise gate `(6,13)→(4,11)`, raise `reefGlow` cap `0.55→0.8`,
  add a faint cyan ground-bounce ring. Gives the darkest act a saturated focal far below. One
  already-drawn `NormalBlending` pass. *Transition: none.*
- **2.6 — Selective plankton spark.** Per-mote twinkle in the material
  (`sin(uTime*aDrift.x*3 + aDrift.y)*0.35 + 0.75`, floor 0.4) so a fraction punches through bloom and
  the rest stay sub-threshold — **sparkle against black**, not a flat dim haze. Do *not* globally
  lift the field (today's triple-multiplier means *no* mote ever crosses bloom). *Transition: none.*
- **2.7 — The thermocline shimmer beat (the missing 1→2 crossing).** New `createThermoclineTSL`: a
  narrow uDepth-banded (`0.02–0.16`) camera-facing plane whose color flips amber→teal *inside* the
  band, snoise3 UV-refraction, additive cap <0.6. The single biggest cue that makes entry read as
  **one** moment of submersion. *Transition: 1→2 — this is the crossing event.*

---

## TIER 3 — polish

- **3.1 — Deepen the progress dimming** so twilight owns the first ~35%: `ascent =
  smoothstep(0.2,0.9,uDepth)`, `lightScale = mix(0.32,1.0,ascent)`, fold a weaker scale into the
  `down` band. Floor at 0.32 (not 0) to avoid a black void. *Transition: 1→2.*
- **3.2 — Insert the missing mid-teal band** (`uColorMid 0x062a53→0x0a4a66`, `uColorBottom
  0x020510→0x04101f`); match `uDeepColor`. Three graded bands instead of indigo→teal jump.
- **3.3 — Bubbles → pearls** (in-shader specular dot + rim) and move the rise into `positionNode`
  (`mod(uTime*speed+seed,span)`), **deleting** the per-frame `baseAttr`/`needsUpdate` upload — the
  chapter's only per-frame GPU buffer traffic. *Transition: 2→3 (breach rush).*
- **3.4 — Capture-verify the seam windows** (TDR-safe desktop scrub of 0.82→1.0 + first second of
  Ch3): confirm ≥3 frames of pane buildup, the sun-glow crossing the waterline, color continuity.
- **3.5 — Widen/thicken the skylight-pane band** (count 6→~9, `t = 0.86+(i/count)*0.12`, vary depth
  + size, stagger reveal) so the fast final camera actually rides *through* it. *Transition: 2→3.*
- **3.6 — Close the 1→2 color loop**: bias the dying First Heart toward amber `#ffb35c` on its final
  exit frames (`earth-core.tsl.js createFirstHeartTSL`) so Ch2 inherits a color Ch1 actually showed.
- **3.7 — Quality-tier count scaling** (gate every instance count on `options.particleCount`, codify
  ceilings in `DEEP_OCEAN_CONFIG`). The adaptive ladder sheds render-scale/bloom but **never counts**
  — required before shipping any count-raising item (2.2 / 2.7 / 3.5).

---

## Transition alignment (explicit)

- **1→2 (from Earth Core):** color spine is already continuous (vent re-lights the Heart's exact
  `#7a1500`). Gaps: the **thermocline crossing beat is absent** (2.7), the carried light **jumps 5×
  in scale and flips position** with nothing tweened (strengthen vent entry pose), the amber is
  *asserted* not handed across (3.6), and there's a brief dead beat ~13–18% before the first bio-glow
  (close it). The darker entry from 3.1 gives the warm vent a darker field to glow against.
- **2→3 (into Surface World):** data continuity is solid (panes use Ch3's *verbatim* azure/gold and
  the same water builder), but **mechanically the breach doesn't land**: four desynced windows (2.1),
  **no through-surface sun-glow on the Ch2 side** (2.2 — the actual missing focal), and a pane band
  too thin for the fast camera (3.5). Tint the brightening ceiling toward azure on approach so the
  *water itself* begins to read as "sky seen through water."

---

## Sequencing (playground-first)

1. **Gate #1 — value/contrast core:** prototype **1.2 + 3.1 + 3.2** together (they define the value
   structure everything contrasts against). One screenshot; confirm entry = twilight (not black) and
   bottom third holds ≤ `#0a1a2e`.
2. **Gate #2 — `DoubleSide` flip (1.3):** screenshot plankton alone to confirm winding.
3. **The broken-creature fix (1.6)** and the free in-shader wins (**1.1, 1.4, 1.5, 2.6**).
4. **The escort beat (2.3 → 2.4)**, then the reef (2.5).
5. **The two seams LAST, each its own short TDR-safe capture:** 2.7 (1→2), then 2.1 + 2.2 + 3.5
   (2→3). Run **3.7 before** any count-raising item.

**Hard ordering:** 1.2 before 2.1; 2.3 before 2.4; 3.7 before 2.2/2.7/3.5.

## Rejected / flagged (adversarially)

- **Rejected — converging god-ray "fan" onto one sun point:** stacks >3 additive cones at the apex
  (TDR violation) and double-blooms exactly where 2.2's sun-glow lives. The on-budget "more hero" is
  1.1 (music swell) + 2.4 (manta backlight).
- **Rejected — god-rays visibly *widen* at the breach:** raises additive shaft energy in the frames
  already carrying ceiling + bubbles + sun-glow (highest-TDR-risk frame). `breachWarm` + 2.1 deliver
  the "opening" read without the fill spike.
- **Rejected — anything that brightens the water / lifts the gradient or seabed floor / adds bloom to
  the backstop.** Those are the dark abyss every vibrant element contrasts against. Every "make it
  brighter" is answered by raising god-ray/jelly/reef/manta **contrast**.
- **Flagged — couple the Ch2 rail orange→cyan to `uSteamEntry`:** the rail emissive lives in
  `OdysseyPathRenderer`, not `deep-ocean.tsl.js`; cross-system, uncertain reach. 2.7's thermocline
  already carries the amber→teal flip — ship only if a cheap hook exists.

## Harness

`src/playground/effects/deep-ocean.effect.js` mounts the real shipping builder and flies the Ch2
corridor (`?t` scrubs depth). It follows the committed `mountain-range.effect.js` pattern, so it is
kept as the iteration harness for the implementation passes above.
