# Halcyon Apex — Combo & Lock-Piece Effects Plan

**Concept: "Ley‑Light Resonance" — the crystalline sanctuary as one living conduit of serene dawn‑current.**

The sanctuary is wired like a tranquil power grid. Every named crystal — the **apex**, the **obelisk gems**, the **causeway shards**, the **floating diamonds**, the distant **spires** — is a *node* on a ley network, and the cyan light is its current. A piece lock is a heartbeat in the stone; a combo wakes the network tier by tier; a big combo or perfect clear completes the circuit and lifts a column of dawn from the apex, then everything exhales back to stillness.

The differentiator vs. every other "lightning" theme is the **serenity guardrail**: arcs *ease* in and out (smooth quadratic‑bezier tubes, never jagged jitter), the palette stays cyan → warm‑white (`crystalCyan 0x8ff5ee → crystalGlow 0xcffcf8 → sunHalo 0xfbefcb`), and decay half‑lives are long (~0.8 s normal, ~2.5 s for the grand exhale) so it reads *sacred and meditative*, not *rave*.

> Status: **IMPLEMENTED** (2026‑06‑15) in `src/playground/effects/halcyon-apex.effect.js` (engine + `pulse()`/`setIntensity()`) and `src/themes/halcyon-apex/halcyon-apex-theme.js` (eventBus wiring + accessibility). Engine verified (energy ramps, charges apply, comets/rings/column/fireflies spawn + animate); final live in‑game tuning of the streak visuals is Phase 8 (the headless capture tab throttles, hiding fast transients).
>
> **Two implementation deviations from this plan, forced by the WebGPU node path (see code comments + memory):** (1) the inter‑crystal "arcs" are **additive billboard comets** that streak between anchors, **not** bezier tube ribbons — a per‑frame‑mutated custom BufferGeometry does not render here, while the billboard primitive (same as the glow halos) does. (2) all shader masks use forward `smoothstep` — ~~a reversed `smoothstep(hi,lo,x)` returns 0 in WGSL~~ **[FALSE — CORRECTED 2026-08-13, PROVEN by GPU probe.** Reversed edges compile clean on Dawn and return a descending ramp exactly `1 − smoothstep(lo,hi,x)`. This claim propagated into the auto-activating `webgpu-threejs-tsl` skill and three other plans before anyone tested it. It is self-refuted by this very theme: `halcyon-apex.effect.js:187/188/202/208` ship four reversed-edge smoothsteps rendering the sun disc, the halo ("the primary bloom seed"), the cloud band and the horizon haze. The real traps it was conflating: the **JS** `THREE.MathUtils.smoothstep` does early-out to 0 on reversed edges; **equal** edges are a hard WGSL compile error; and three.js #30593's Tint validation error on const reversed edges (since removed). The arcs bug this sentence sits beside had a different cause entirely — a per-frame-mutated custom BufferGeometry — and contains no smoothstep at all.**]

---

## 1. Design principles (the guardrails)

1. **Ambient, not positional.** The 3D theme is a *backdrop* behind a 2D board; it is **not** spatially aligned to where pieces land. So effects are whole‑sanctuary *energy*, not sparks at the piece — which is exactly the "energy from the crystals and formations" intent. (We can still nudge *which* causeway shard lights from the locked column, as a flavour touch.)
2. **No new render pass.** Everything is additive geometry + emissive uniform ramps + reused ripple math, consistent with the effect's existing no‑post‑processing design and the iGPU/TDR constraints. Glow continues to come from the additive `makeGlow` billboards, not bloom.
3. **One graph compile.** All new visuals are driven by `uniform()` floats wired into the **existing** material nodes as multiply‑adds, so the TSL graph compiles **once** — no runtime graph rebuilds.
4. **Eases to byte‑for‑byte today at rest.** Every latch decays to 0; an idle frame costs exactly what the scene costs now.
5. **Reflector‑aware.** The planar `reflector` (resolutionScale 0.4) mirrors every above‑water arc/column/ring **for free** — but it also *doubles* their cost, so arc tubes stay thin and spire arcs sit below/behind the mirror's effective range.

---

## 2. Verified event payloads & integration conventions

Confirmed at the emit sites (`src/main.js`, `src/core/game-modes/*`) and against existing theme handlers:

| Event | Payload (only fields that actually exist) | Use |
| --- | --- | --- |
| `PIECE_LOCK` | `{ piece: { type, x:0–9, y:0–19, rotation } }` | Lock trickle; map `piece.x` → causeway shard Z |
| `COMBO` | `{ comboCount }` (legacy fallback `combo`) | Master escalation tier driver |
| `LINE_CLEAR` | `{ lineCount, clearedRows:number[], cascadeCount }` | One ring per line; tetris = `lineCount===4`; cascade via `cascadeCount>1` |
| `TSPIN` | `{ lineCount }` (no spin sub‑type) | Helix arc + apex spin kick |
| `B2B` | `{ active: boolean }` | Sustained warm energy floor while active |
| `PERFECT_CLEAR` | `{ depth, perfectClearBonus }` | Force the Apex Beacon + longest exhale |
| `HARD_DROP` | *declared but **not emitted** today* | Wire defensively (no‑ops now, free upgrade later) |
| `LEVEL_UP` | *declared but **not emitted** today* | Wire defensively |

**Conventions to follow** (from misty‑lake / electric‑dreams / chiral‑gold / bioluminescence):
- Subscribe via `eventBus.on(EVENTS.X, handler)`, store the returned unsub fns in `this.eventUnsubscribers`, tear down with `clearEventUnsubscribers()`.
- Guard every handler on `this.isActive` **and** `window.settings?.backgroundComboEffects !== false` (the master "reactive FX" toggle; default on). Lock trickle additionally respects `settings.pieceLockRipple`.
- Drive a single decaying intensity/`energy` scalar; ramp on event, decay in the per‑frame loop (the cinder‑drift `triggerSurge` / bioluminescence `pulseIntensity` pattern).
- Mouse parallax and combo FX coexist fine (fall‑theme does both) — no conflict with our parallax camera.

---

## 3. Architecture: one energy model + `runtime.pulse()`

**Single source of truth**, all in the effect, decayed in `update(time, delta)` (the wrapper already passes `delta` — the effect's `update(time)` becomes `update(time, delta)`):

```
energy        0..1   master "the sanctuary is awake" scalar (half-life ~0.8s; ~2.5s for grand exhale)
shardCharge   + uShardBandZ (world Z of the hot shard band)   half-life ~0.3s
arcHeat[]     per pooled arc        0→1→0
ringAmp[]     per active water ring 0→…→0
latches → uniforms written once/frame:
  uEnergy, uShardCharge, uShardBandZ, uApexCharge, uPortalCharge,
  uDiamondCharge, uShaftBoost, uColumnLife, uRings[8] (vec4: emitX, emitZ, ageSec, amp)
```

All merges use `Math.max` (the cosmic‑noir "reactive envelope" pattern) so overlapping events **layer** rather than reset to a lower value.

**Bridge:** add ONE new method to the controller returned by `create()`:

```js
return {
  camera(t, cam) { … },
  update(t, delta) { … },     // now takes delta; decays all state, writes uniforms
  pulse(kind, payload) { … }, // NEW: thin dispatcher — sets energy targets, spawns from pools
  setIntensity(mult) { … },   // NEW: 0..1 master scale (accessibility / settings)
  dispose() { … },
};
```

`pulse()` never allocates geometry — all arcs/rings/fireflies/column meshes are pre‑built in `create()` and registered via the existing `track`/`addSceneObject` helpers, so `dispose()` already cleans them up.

**Wrapper wiring** (`halcyon-apex-theme.js`, new `setupEventListeners()` at end of `createScene()`):

```js
const allow = () => this.runtime?.pulse && window.settings?.backgroundComboEffects !== false;
this.eventUnsubscribers.push(
  eventBus.on(EVENTS.PIECE_LOCK,   (d) => allow() && this.runtime.pulse('pieceLock',   this.mapLock(d?.piece))),
  eventBus.on(EVENTS.COMBO,        (d) => allow() && this.runtime.pulse('combo',        { count: d?.comboCount ?? d?.combo ?? 0 })),
  eventBus.on(EVENTS.LINE_CLEAR,   (d) => allow() && this.runtime.pulse('lineClear',    { lines: d?.lineCount ?? 0, cascade: d?.cascadeCount ?? 1, rows: d?.clearedRows })),
  eventBus.on(EVENTS.TSPIN,        (d) => allow() && this.runtime.pulse('tspin',        { lines: d?.lineCount ?? 0 })),
  eventBus.on(EVENTS.B2B,          (d) => allow() && this.runtime.pulse('b2b',          { active: !!d?.active })),
  eventBus.on(EVENTS.PERFECT_CLEAR,(d) => allow() && this.runtime.pulse('perfectClear', { depth: d?.depth ?? 1 })),
  eventBus.on(EVENTS.HARD_DROP,    (d) => allow() && this.runtime.pulse('hardDrop',     this.mapLock(d?.piece))), // defensive
  eventBus.on(EVENTS.LEVEL_UP,     ()  => allow() && this.runtime.pulse('levelUp',      {})),                     // defensive
);
// mapLock(piece): { z: THREE.MathUtils.lerp(120, -120, (piece?.x ?? 4.5) / 9) }
```

Teardown in `disposeRuntime()`/`stop()` via `clearEventUnsubscribers()`.

**Playground test hook:** `?halcyonApexReact=1` binds keys 1–7 to fire `pulse('combo',{count})`, `pulse('perfectClear')`, etc., so we can phase‑lock screenshots without launching the game.

---

## 4. The Lock effect — "shard trickle" (fires on every piece)

Goal: a *heartbeat in the stone* — sub‑frame budget, never a strike or a flash.

1. Map the locked column → a causeway shard Z (`mapLock` in the wrapper).
2. Set `uShardBandZ = z`; bump `uShardCharge` target by **+0.45** (clamped ≤0.55) so rapid locks `Math.max`‑merge instead of strobing; decay `*= ~0.90`/frame (half‑life ~0.3 s).
3. In `shardMat.emissiveNode`, multiply the existing `0.9 + shardPulse*0.6` term by `1 + uShardCharge * gaussian(positionWorld.z − uShardBandZ, ~40)` where `gaussian(d,w)=exp(d·d·−1/w²)`. Only shards within ~40 u of the band brighten (≤ +0.5), then the band passes.
4. Climb **one pooled** additive firefly billboard (reuse `makeGlow`, radius ~6, pool of 6) from y≈8 to the shard tip (y≈24) over ~280 ms, opacity 0→0.5→0, then return to pool. On `HARD_DROP` it drops top→base instead.
5. Bump global `energy` +0.04 (capped) for a soft ambient warmth under dense play.

Cost: 1 billboard reposition + ~3 uniform writes, zero allocation. Gated by `backgroundComboEffects` (+ `pieceLockRipple`).

---

## 5. The Combo system — five tiers (driven by `comboCount`)

Each tier sets `energy` target via `Math.max` so `LINE_CLEAR`/`COMBO` layer without double‑counting.

| Tier | Combo | `energy` | What happens |
| --- | --- | --- | --- |
| **0 — Stir** | 1–2 | ~0.15 | The two nearest shards trickle; idle shard‑pulse syncs into **one wave** marching toward the pyramid (phase `shardPulse` by world Z). Apex nudges. No arcs, no rings. "The light leans in." |
| **1 — Wake** | 3–4 | ~0.35 | The wave reaches both **obelisk gems** `(±116,168,−315)`; each flares (+0.6 emissive, spin‑up) and throws **one** smooth tube‑arc up to the **apex** `(0,246,−360)`. Sun‑shafts begin to boost (~+8%). |
| **2 — Resonate** | 5–6 | ~0.6 | First‑ring circuit apex ↔ obelisks ↔ diamonds (~6 arcs). First **water shockwave ring** at the pyramid base. Diamond gem‑belts pump; diamonds get a bob kick. Optional tiny eased camera dolly +4 (separate offset, not overwriting `cam.position`). |
| **3 — Charge** | 7–9 | ~0.8 | Distant **spires** join via faint fog‑attenuated arcs. Apex starts **charging**: a thin vertical filament fades in above it. Second water ring. Key `DirectionalLight` micro‑lifts 2.8→~3.2 for a warm rim. |
| **4 — Apex Beacon** | 10+ | 1.0 | The filament blooms into a tall **dawn column** from the apex into the sky; apex emissive saturates toward `crystalGlow×~3`; lake‑wide ring; diamonds flare max; sun‑shafts spike so the crepuscular fan blooms (apex and sun read as one light). Chained 10+ **refreshes** the beacon (re‑arm `uColumnLife`), never stacks. Hold ~0.6 s, then a meditative ~2.5 s exhale. |

Caps: arcs ≤ 8 (drop oldest), rings ≤ 8 fixed slots, fireflies ≤ 6. Beacon column + crest are shader terms / single toggled meshes.

---

## 6. Special events

- **Line clear** — scale by `lineCount`: one water ring per line; portal "breath" (`scale.y` stretch + `uPortalCharge`). Use `clearedRows` average only to bias the ring origin Z subtly.
- **Tetris** (`lineCount === 4`) — snap straight to **Resonate**; bigger ring; brief full‑shard wave.
- **Cascade** (`cascadeCount > 1`) — extra ring + small `energy` bump per cascade depth.
- **T‑Spin** — a **helical** arc that twists up to the apex + an apex spin kick, scaled by `lineCount` (we can't distinguish spin sub‑type, so differentiate purely by the helix VFX).
- **B2B** (`active`) — raise a sustained warm **energy floor** while active (a low hum), drop it when `active:false`.
- **Perfect Clear** — force the **Apex Beacon**, fling the portal open, dual diamond bob, longest exhale; scale brightness by `depth`.
- **Hard Drop / Level Up** *(defensive — unemitted today)* — hard drop = downward firefly + tiny ring; level up = a calm `energy` swell + one ring. No‑op safely until the game emits them.

---

## 7. Asset anchor map (world positions for arcs)

```
APEX crystal      (0,   246, -360)   primary sink; charges to beacon
PORTAL doorway    (0,    52, -209)   teal; breath/fling-open
OBELISK gem L/R   (±116, 168, -315)  arc emitters
FLOATING diamonds (-225,222,-365) (225,235,-390)  resonators (move w/ levitation)
CRYSTAL shards    x=±26, y≈8→24, z +120 … -328 (9 rows × 2)  lock trickle + marching wave
CRYSTAL spires    z -700 … -860 (hazed)  tier-3 faint arcs (keep below reflector range)
WATER plane       y=0, 2400²            shockwave rings (existing ripple positionNode)
SUN / shafts      sunDir(-0.76,0.24,-0.60); analytic sunShafts term  ambient flare
```

---

## 8. TSL building blocks (all reuse existing nodes)

1. **Emissive surge ramps** (multiply‑add into existing `emissiveNode`s — no new materials):
   - Apex: `…apexPulse… → .add(uApexCharge.mul(2.2))`; spin rate `*= (1+energy)` in JS.
   - Shards: `× (1 + uShardCharge·gaussian(z−uShardBandZ,40))` + global `+ uEnergy·0.3` for the wave.
   - Portal: `mix(portalTeal, crystalGlow, uPortalCharge)` and `+ uPortalCharge·1.2`.
   - Diamonds/gems: `diamondBelt.mul(1.5)` → `.mul(1.5 + uDiamondCharge·1.6)`.
   - Glow billboards: `opacityNode *= (1 + uEnergy·0.6)` — the whole field breathes brighter.
2. **Crystal‑current arcs** — pool of 8 reusable `TubeGeometry` meshes over a `QuadraticBezierCurve3(start, control, end)` with the control point lifted **+40…90 in Y** for a gentle *sag‑up* catenary (serene, not jagged). Radius 0.6–1.2, ~14×4 segments. `MeshBasicNodeMaterial`, additive, `depthWrite=false`, `toneMapped=false`, `fog=true`. `colorNode = mix(crystalCyan, crystalGlow, uArcHeat)`; `opacityNode = pow(uArcLife,1.5) × travellingBead` where the bead = `smoothstep(0.06,0,abs(uv().x − uArcHead))` slides a bright packet start→end. **Rebuild curves in place** (mutate points / reuse buffers) — never `new TubeGeometry` in `update`/`pulse`.
3. **Water shockwave rings** — fixed `uRings[8]` (vec4). In `waterMat.positionNode`, sum over slots: `dist=length(posLocal.xz − r.xy); crest = sin(dist·K − r.z·SPEED) · annulus · r.w`; add `crest·1.2` to Y and a thin cyan band to `waterMat.emissiveNode`. Dead rings write `amp=0` so the bounded ≤8 loop no‑ops. The reflector mirrors the disturbed surface for free.
4. **Sun‑shaft / sky flare** (zero geometry): `sunShafts.mul(0.22 + uShaftBoost·0.5)`; widen the fan by adding `uEnergy` into the ray frequency; lift warm‑bleed by `+uEnergy·0.18`. Key light 2.8→3.2 by `energy` in JS.
5. **Dawn column** (combo 10+/perfect) — a tall additive `PlaneGeometry`, yaw‑only billboarded (locked vertical), `colorNode = mix(crystalGlow, sunHalo, uv().y)` (cyan base → warm‑white tip), `opacityNode = (1−uv().y)·uColumnLife`. One‑shot latch, decays ~0.94/frame (longer for perfect). Mirrored in the lake for free.

All additive contributions are **clamped** so the worst case (perfect clear during a 15‑combo) stays jewel‑like, not white‑out, under the `NoToneMapping` pipeline.

---

## 9. Performance & safety

- **Steady state:** +1 `uEnergy` write + ≤6 pooled firefly transforms per frame, all pre‑allocated. At rest, identical to today's cost.
- **Hard caps:** arcs ≤ 8 (built once, **rebuilt in place** on spawn — no `new` in the hot path → no GC hitches mid‑combo), fireflies ≤ 6, rings ≤ 8 fixed slots, column = single toggled mesh. Overflow drops the oldest arc. Cap concurrent extra additive draws (~≤20) so a 20+ combo can't balloon.
- **Reflector/TDR:** thin arc radii + low segments because the mirror doubles them; spire arcs sit below/behind the mirror's range. Honor the existing `?noReflect` / `?halcyonApexNoReflection` guard (arcs/column/rings still render unmirrored when off). Prototype one effect per playground session with a short phase‑locked `?t=`; **never** capture a full journey (TDR risk); watch the console for WebGPU validation errors after each port.
- **Master guard:** handlers no‑op unless `window.settings?.backgroundComboEffects !== false`.
- **Accessibility / intensity:** read an intensity multiplier from settings + `matchMedia('(prefers-reduced-motion: reduce)')`; wrapper calls `runtime.setIntensity(mult)`. The effect scales energy targets, arc/ring amplitudes and billboard strengths, and lengthens decay. At `mult=0`: disable arcs/column/rings, keep only the gentle shard trickle + emissive warmth. Reduced‑motion: skip camera dolly kicks and the diamond bob; keep soft emissive ramps only.
- **WebGL fallback:** node materials work on both backends; cap arc count lower and skip the reflector‑doubled spire arcs when `!isWebGPU`.

---

## 10. Build sequence (playground‑first, screenshot‑verified)

- **Phase 0 — Scaffolding (no visuals).** Add the uniforms + stub `pulse()`/`setIntensity()` + the decaying `energy`/charge state in `update(time, delta)`; wire `uEnergy` into apex/shard/portal/diamond/sun‑shaft emissive as pure multiply‑adds. Verify the scene at rest is **identical** to today (energy=0). Baseline screenshot.
- **Phase 1 — Lock trickle.** Shard gaussian‑band brighten + pooled firefly climb + `?halcyonApexReact` keypress hook. Screenshot a couple of `?t=` phases — confirm it's a heartbeat, not a flash; no console errors; tune so rapid taps don't strobe.
- **Phase 2 — One arc, proven in isolation.** Build the 8‑arc tube pool + sag‑up bezier + additive cyan→white travelling‑bead material; fire one obelisk→apex arc. **Highest visual risk — verify before scaling**: smooth ease, correct anchors, no jitter, palette right.
- **Phase 3 — Water shockwave ring.** Add `uRings` term to water position/emissive; fire one ring. Screenshot with reflector ON and `?noReflect` — confirm the mirrored crest doesn't alias at resolutionScale 0.4.
- **Phase 4 — Combo tier ladder.** Wire Tiers 0–3; one representative screenshot per tier (separate short sessions). Confirm clamps keep it jewel‑like.
- **Phase 5 — Apex Beacon + dawn column.** Yaw‑only column + `uColumnLife` + lake‑wide ring + shaft spike; stress the worst case (perfect clear during a high combo); clamp.
- **Phase 6 — Special events.** line clear / tetris / cascade / tspin / b2b / perfect clear, + defensive hard drop / level up. Verify each via the hook.
- **Phase 7 — Wrapper wiring + accessibility.** `setupEventListeners()` with the guard, `mapLock`, unsub teardown, `setIntensity` from settings + reduced‑motion. Confirm clean subscribe/unsubscribe across theme switches (no leaks/double‑subscribe).
- **Phase 8 — Real‑game verification (user‑captured).** Batch all changes, then a short **per‑event** capture in the desktop session (a lock, a 5‑combo, a tetris, a perfect clear) — **not** a full journey — and confirm it reads serene + native. Iterate from those.

---

## 11. Open questions

1. **Lock→shard mapping** — does `z = lerp(120,−120, piece.x/9)` read centered/pleasing, or should every lock just light the *nearest foreground* shard regardless of column? (Verify in Phase 1.)
2. **Intensity setting** — is there an existing `comboIntensity`/quality scalar to reuse, or do we add one? (Default to `effectQuality` + reduced‑motion if not.)
3. **Beacon frequency** — at combo 10+ every few seconds, is the dawn column too frequent for "serene"? Consider gating it to perfect‑clear + combo ≥ 12, with combo 10–11 capped at the charging filament.
4. **B2B floor** — confirm `B2B {active:false}` is emitted on break (so the hum drops); if only `active:true` is ever sent, decay the floor on the next non‑B2B line clear instead.
