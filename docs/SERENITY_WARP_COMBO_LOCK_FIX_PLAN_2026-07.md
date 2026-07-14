# Serenity Warp — Combo + Lock Effects Fix Plan (Hybrid Direction)

- **Status:** Waves 1–3 IMPLEMENTED + playground-verified (2026-07-13); Waves 4/6 (board-rect placement + in-game capture) remain — need the real game with a board. See §12 Progress.
- **Scope:** `src/themes/serenity-warp/` lock and combo reactions, plus a small **opt-in, default-identity** reactive surface on the shared intro renderer. The intro's own visuals must stay byte-identical when the theme is not driving them.
- **Governance:** `CLAUDE.md` (intro is the single source of visual truth; validate WebGPU/TSL with screenshots before "done"), `docs/ARCHITECTURE_INDEX.md`, `docs/adr/`, `docs/WEBGPU_THREEJS_WORKFLOW.md`.
- **Visual thesis:** **Chromatic Warp Response — Phase Seal (bold piece stamp) → Tunnel Surge (whole scene reacts) → Sevenfold Spectrum Gate (hero portal).**
- **Direction chosen:** Hybrid. Combos manifest primarily as the **warp tunnel itself surging** (bloom swell, warp kick, chromatic bleed, all-piece flash), with a **redesigned hero gate** at high tiers; locks become a **bold, solid, readable stamp** of the actual locked tetromino in a board gutter — not a wireframe.

---

## 1. Current-state diagnosis (evidence-backed)

The FX system from the prior investigation was **fully built and wired**:

- `serenity-warp-fx-controller.js` — renderer-neutral event → bounded command translation (Phase Seal, Spectrum Gate, Möbius Twist, Perfect Clear, B2B), per-player state, milestones `[2,3,6,10]`, deterministic envelopes.
- `serenity-warp-gameplay-fx.js` — six fixed instanced pools (seals, rings, nodes, links, ellipses, streaks), WebGPU node materials + WebGL fallback, reduced-motion, quality tiers, compile warm-up, oldest-slot reclamation.
- `serenity-warp-theme.js` — subscribes to `PIECE_LOCK/LINE_CLEAR/COMBO/TSPIN/PERFECT_CLEAR/B2B`, drains commands each frame ([serenity-warp-theme.js:346](../src/themes/serenity-warp/serenity-warp-theme.js#L346)), pushes a decaying `reactivePulse` into `setAudioPulse` ([serenity-warp-theme.js:405](../src/themes/serenity-warp/serenity-warp-theme.js#L405)).

**The architecture is sound; the *visual result* fails.** Confirmed against saved artifacts:

### Lock — "Phase Seal" reads as a glitch
Evidence: [`serenity-warp-real-phase-seal.png`](../artifacts/playground/serenity-warp-real-phase-seal.png) — four tiny hollow blue wireframe squares near center-left.

- **Too small.** Placed on a world plane at `effectPlaneZ = 4`, ~36u from the camera (camera `z = 40`, [threejs-intro-renderer-webgpu.js:223](../src/ui/threejs-intro-renderer-webgpu.js#L223)). With `cellSize ≈ 0.86` view units the whole glyph is **~3–4% of screen height**; each of the four cells is ~1%. Below the threshold of "I noticed something happened."
- **Hollow + cold + additive.** The fragment builds `outline = max(outer - inner, 0)` — a thin *outline only* ([serenity-warp-gameplay-fx.js:290-306](../src/themes/serenity-warp/serenity-warp-gameplay-fx.js#L290)) — in cool blue over a bright purple nebula. Near-zero contrast; no solid body, no emissive punch. It looks like a debug wireframe, matching the user report that "lock effects are non-existent."

### Combo — "Spectrum Gate" reads as an isolated widget
Evidence: [`serenity-warp-real-spectrum-gate.png`](../artifacts/playground/serenity-warp-real-spectrum-gate.png) — a small concentric-ring "roulette wheel" floating off to the side.

- **Disconnected.** Anchored at the last lock's side-lane origin, ~10% of screen, unrelated to the falling tetrominos or the tunnel. Reads as a pasted-on UI element rather than the scene celebrating.
- **Busy/cheap.** Thin rainbow ellipse rings + radial hatching + a few perimeter dots. It's competent but not cinematic.

### The core mismatch
The **background is the artwork** — a beautiful warp tunnel of glowing tetrominos in a breathing nebula. Best-in-class themes (Winter blizzard `storm-director`, Vesper `vesper-chrysalis-director`, Sky Children `MoodDirector`) drive **the scene itself** via an eased scalar. Serenity Warp instead pastes small geometry on a plane, and the one whole-scene lever it uses (`setAudioPulse`) has **negligible coefficients** — bloom `+audioPulse*0.05`, fringe `+audioPulse*0.03` ([threejs-intro-renderer-webgpu.js:1269-1275](../src/ui/threejs-intro-renderer-webgpu.js#L1269)). Even a maxed pulse barely moves the frame. So both halves under-deliver: the overlay is invisible/disconnected, and the scene doesn't react.

### Occlusion caveat
The saved "real" artifacts were captured in **background/menu mode with no game board**. In real single-player, the board occupies the center; a center-anchored gate would be **occluded by the board DOM** (the theme canvas is `zIndex 0`, [serenity-warp-theme.js:150](../src/themes/serenity-warp/serenity-warp-theme.js#L150)). This makes the scene-surge approach *more* important (it fills the whole frame around the board) and constrains discrete geometry to the **gutters / upper corridor**.

---

## 2. Decision — one connected response language

Build a single escalating response, not three unrelated bursts. Hierarchy by **structure and scene-reaction magnitude**, not brightness alone:

1. **Lock (frequent, ~0.5s):** a bold solid stamp of the exact locked tetromino in a gutter — instant "that placed."
2. **Line clear (immediate beat):** the existing ring keeps its role; owns the discrete clear feedback.
3. **Combo (evolving, ~0.8–1.4s):** the **tunnel surges** — escalating bloom/warp-kick/chromatic-bleed/piece-flash — and at tier 6+ a **hero gate** forms in the upper corridor.
4. **Combo 10+ (rare hero):** **Sevenfold Spectrum Gate** — a large luminous portal with all seven piece colors; the tunnel does one "hyperspace" inhale→exhale; camera leans toward it.

### Non-negotiable constraints
- Preserve center-board / ghost / next-piece readability. Discrete geometry lives in gutters or the upper corridor; the scene-surge is symmetric and never darkens or strobes the play area.
- The intro renderer's default output is **unchanged**. New reactive levers default to identity (0) and are only ever non-zero while Serenity Warp drives them, mirroring the existing `setTetrominoTitleAvoidanceEnabled` opt-out pattern ([serenity-warp-theme.js:225](../src/themes/serenity-warp/serenity-warp-theme.js#L225)).
- Effects must be complete in direct rendering (the theme's own bloom path, not the disabled intro MRT selective bloom).
- Accessibility: reduced-motion removes travel/surge and leaves short opacity snaps; tiers must be orderable in grayscale (shape/size/completeness carry meaning, hue supports). No strobe; stay within WCAG flash guidance. Cap surge frequency so rapid cascades can't stack into a flash.

---

## 3. Effect specification

### 3.1 Lock — Phase Seal v2 (bold piece stamp)

**Purpose:** acknowledge every lock in <100 ms with a recognizable silhouette, without masking the next piece.

**Form (fixes vs. today):**
- **Solid emissive cells**, not a hollow outline. Filled rounded-square SDF per cell with a bright rim and inner glow, in the **piece's own color** (keep `resolvePieceColor` from the controller).
- **~3–4× larger.** Target glyph height ≈ **10–14% of screen height** so it reads instantly. (Raise default `cellSize` and/or move the FX plane closer / scale per depth — see §5.)
- Placed in the **nearest board gutter**, vertically aligned to the lock centroid (keep `sideLane` mapping, [serenity-warp-fx-controller.js:257](../src/themes/serenity-warp/serenity-warp-fx-controller.js#L257)); alternate sides when centered.
- A single **thin shock-ring** in the piece color expands behind it (keep, but scale with the larger glyph).

**Envelope (keep the timing hypothesis; fix the visuals):**

| Age | Visual |
|---:|---|
| 0–60 ms | crisp emissive rim snap; solid cells appear at ~1.12 scale |
| 60–160 ms | four motes converge inward; glyph compresses 1.12 → 1.0 |
| 40–280 ms | one thin color shock-ring expands behind it |
| 450–550 ms | motes + glyph fade completely |

**Do not:** camera shake, white flash, meteor, hit-stop, or full-screen bloom on a *lock*. Lock stays crisp and small-footprint; the *scene* reaction is reserved for combos.

### 3.2 Combo — Tunnel Surge (primary) + Spectrum Gate (hero at 6+)

**Primary channel = the scene reacts.** Each newly-crossed milestone drives a bounded, eased **reaction surge** scalar into the renderer (§5), escalating by tier:

| `comboCount` milestone | Scene surge | Discrete geometry | Target duration |
|---:|---|---|---:|
| 2 (`echo`) | small bloom+fringe lift; brief all-piece emissive bump | faint delayed echo ring confirms the chain | 0.6–0.8 s |
| 3–5 (`constellation`) | moderate surge + gentle warp-kick (tunnel accelerates briefly) | recent Phase-Seal colors become constellation nodes + thin links in the upper corridor | 0.8–1.0 s |
| 6–9 (`aperture`) | strong surge; chromatic bleed; nebula pulse | the constellation closes into a **hero gate** (2–3 clean chromatic ellipses) in the upper corridor; bounded streaks converge | 1.0–1.2 s |
| 10+ (`sevenfold`) | **hyperspace beat**: one big warp inhale→exhale, bloom swell, all-piece flash, subtle hue-temp shift | **Sevenfold Spectrum Gate**: all seven piece colors form the portal, inhale ~120 ms, exhale one soft spectrum wave; camera leans toward it | 1.1–1.4 s |

- **Only newly-crossed milestones** add expensive geometry; repeats **refresh held energy** (keep the `reachedMilestones` gate, [serenity-warp-fx-controller.js:589](../src/themes/serenity-warp/serenity-warp-fx-controller.js#L589)). `LINE_CLEAR` owns the immediate ring; `COMBO` owns the evolving surge+gate.
- **Gate redesign:** fewer, thicker, cleaner ellipses; brighter piece-colored nodes; place in the **upper corridor** (above the board) so it's never board-occluded, and so the tunnel appears to flow *through* it. Kill the "roulette hatching" look.

### 3.3 Möbius Twist (T-spin) and Perfect Clear
Keep as gate variants but re-tune to the new scale/placement and give Perfect Clear the strongest (but still bounded) hyperspace surge + full sevenfold portal.

---

## 4. Spatial contract

1. Controller extracts the normalized lock centroid + silhouette from the canonical `PIECE_LOCK` payload (already done, [serenity-warp-fx-controller.js:357](../src/themes/serenity-warp/serenity-warp-fx-controller.js#L357)).
2. **Gutter/upper-corridor placement only** for discrete geometry. Resolve the actual on-screen board rect (selector order `#p${player}-phaser-container canvas` → `#phaser-game-container canvas` → `#main-game-canvas` → `#single-player-game-canvas`, reject hidden/tiny), cache it, refresh on `ResizeObserver` + layout/mode change. Map lock seals to the nearer gutter; combo gate to the upper corridor above the board.
3. If no board rect is resolvable (menu background), fall back to the current side-lane mapping.
4. The scene-surge is **global and symmetric** — it needs no board rect and cannot be occluded, so it is the reliable "big" feedback even before board-rect resolution lands.
5. Per-`(player)` stream isolation stays; a new lock resets the stream, non-monotonic combo or inactivity starts fresh (already implemented).

---

## 5. Renderer reactive surface (opt-in, default-identity)

Add a single theme-only reaction state to **both** intro renderers. Default zero → intro output identical.

**WebGPU renderer (`threejs-intro-renderer-webgpu.js`):**
- New state: `this.reactionSurge = 0` (0..1), plus optional `reactionBloom`, `reactionChroma`, `reactionHue`, `pieceFlash` (all default 0).
- Public API: `setReactionState({ surge, bloom, chroma, hue, pieceFlash })` (clamped) and/or `pulseReaction(kind, amount, durationMs)` for transient bell-curve surges. The theme decays them each frame (like `reactivePulse` today).
- **Tap `uWarp` cleanly:** compute an effective warp `warpEff = this.uWarp.value + this.reactionSurge` and feed `warpEff` to the camera dolly, bloom (`+ warpEff*0.1`), DoF, and `particleCompute.setWarpFactor(warpEff)` at [threejs-intro-renderer-webgpu.js:1265-1287](../src/ui/threejs-intro-renderer-webgpu.js#L1265). **Do not** touch `updateWarp`/dismiss logic — surge is additive and independent.
- Boost bloom/fringe with the reaction terms behind the same additive path (e.g. `+ reactionBloom*0.25`, `+ reactionChroma*0.12`) so combos actually move the frame, while `audioPulse`'s tiny coefficients stay for ambient audio.
- **All-piece flash:** reuse the existing per-piece `rotation.w` flash channel (the 20% scale-up + emissive bump already used by `triggerTetrominoBounceAt`, [threejs-intro-renderer-webgpu.js:912-916](../src/ui/threejs-intro-renderer-webgpu.js#L912)) via a compute impulse, or add a global `uPieceFlash` uniform multiplying emissive. Prefer a global uniform for zero readback cost.
- Optional hue-temp shift for tier 10 via a bounded post uniform.

**WebGL fallback (`threejs-intro-renderer.js`):** implement `setReactionState`/`pulseReaction` as at least a bloom/scene-brightness nudge, or a documented near-no-op, so the theme can call the same API unconditionally.

**Theme wiring (`serenity-warp-theme.js`):** replace the single `setAudioPulse(reactivePulse)` push with a reaction envelope: the FX controller emits per-milestone surge targets; the theme eases `reactionSurge`/`reactionBloom`/etc. toward them and decays (respecting reduced-motion + `backgroundComboEffects`).

---

## 6. Reuse vs. rewrite

- **Reuse wholesale:** the pool infrastructure, ring allocator, command flush, warm-up, quality tiers, WebGL fallback scaffolding, controller event routing + milestone/stream logic, envelopes.
- **Rewrite:** `createPhaseSealSystem` fragment (solid fill + rim + glow, larger default), gate emission (fewer/cleaner ellipses, upper-corridor placement, sevenfold hero), and the theme's reactivity push (single pulse → reaction envelope).
- **Add:** renderer reaction surface (§5); board-rect resolver for gutter/corridor placement (§4).
- Keep the "at most three incremental draw calls" discipline; no per-event allocation; preallocate the small Extreme maxima once.

---

## 7. Playground-first execution plan

Per `CLAUDE.md`: one small effect per session; screenshot-verify with `chrome-devtools` MCP; no full-journey WebGPU captures (iGPU TDR risk). Existing harnesses `serenity-warp.effect.js` and `serenity-warp-reactions.effect.js` already exist — extend them.

### Wave 0 — Freeze baseline + contract
- Re-capture the current broken lock + gate in the **real theme with a board present** (single-player) so occlusion is on record, plus phase-locked isolated shots.
- Confirm/extend unit coverage: controller milestones/streams, envelope sampling, board-rect resolver (pure), reaction-envelope easing (pure). Existing tests: `serenity-warp-fx-controller.test.js`, `serenity-warp-gameplay-fx.test.js`, `serenity-warp-theme.test.js`.
- **Gate:** deterministic fixtures repeat; no source visual change yet.

### Wave 1 — Phase Seal v2 (isolated)
- In `serenity-warp-reactions.effect.js` (or a dedicated `serenity-warp-phase-seal.effect.js`), prototype the solid, larger stamp.
- Diagnostic contract: `playground.html?effect=serenity-warp-phase-seal&piece=T&side=left&t=0&fxAge=0.12`.
- Capture `T`, `I`, `O`, `S` at left/right gutters and ages ~0.06 / 0.22 / 0.50; WebGPU first, then `forceWebGL=1`, Low quality, reduced motion.
- **Gate:** silhouette recognizable in <100 ms, reads over the nebula, clean console. Do not port before this.

### Wave 2 — Tunnel Surge (isolated, renderer levers)
- Add the `reactionSurge`/bloom/chroma/pieceFlash levers to the WebGPU renderer; drive them from the playground harness against the real intro scene.
- Capture surge at combo tiers 2 / 5 / 8 / 10 at peak and decay; verify the tunnel accelerates + blooms + pieces flash without strobing; verify intro output identical at surge 0.
- **Gate:** scene reaction is clearly tiered and calm; no validation errors; identity at 0.

### Wave 3 — Spectrum Gate v2 + Sevenfold hero (isolated)
- Redesign gate geometry (upper corridor placement, cleaner ellipses, sevenfold portal, camera-lean at 10+).
- Capture combos 3 / 6 / 10 at gather / bloom / settle; reference-split for palette.
- **Gate:** tiers orderable in grayscale; board center stays clear; hero 10+ feels exceptional without washing out the scene.

### Wave 4 — Production wiring
- Port proven shaders/levers into `serenity-warp-gameplay-fx.js` + renderer + `serenity-warp-theme.js`; add board-rect resolver; wire reaction envelope; live settings, quality, reduced-motion, disposal, generation fencing.
- **Gate:** unit tests pass; theme switch leaves no listeners/resources/active slots; console clean.

### Wave 5 — Quality, accessibility, fallback
- Tune Low/Medium/High budgets and surge magnitudes from captures; verify reduced-motion form, `forceWebGL=1`, resize, pause/resume, hidden-tab recovery, multiplayer origin isolation, theme-switch cleanup.
- **Gate:** semantic parity across tiers; no motion-only/color-only meaning; surge frequency-capped (no flash under rapid cascades).

### Wave 6 — Short production validation
- Capture individual real-game events **with a board present**: lock, combo 2/5/8/10, T-spin, perfect clear, rapid-cascade stress. Record renderer, viewport, DPR, quality, reduced-motion, commit SHA under `artifacts/themes/serenity-warp/combo-lock/`.
- **Gate:** acceptance matrix passes; only then is the visual work "done."

---

## 8. Acceptance matrix

| Dimension | Required cases |
|---|---|
| Piece shape | `T`, `I`, `O`, `S`; silhouette recognizable as a solid stamp |
| Origin | gutter mapping stable at columns near 0 / 4–5 / 9; vertical top/mid/bottom; never off-screen |
| Combo | 2, 5, 8, 10; correct scene-surge magnitude + gate structure per tier |
| Occlusion | board present: no discrete geometry hidden behind the board; surge fills around it |
| Renderer identity | intro output unchanged at reaction 0 (byte-identical spot check) |
| Renderer | WebGPU and `forceWebGL=1` |
| Quality | Low and High; semantic parity |
| Motion | normal, OS reduced motion, in-game reduced motion |
| Settings | `backgroundComboEffects` + `pieceLockRipple` off/on live |
| Load | rapid locks, cascade storm, pool saturation, combo-10 refresh, surge frequency cap |
| Lifecycle | resize, pause/resume, hidden tab, repeated theme switch/dispose, GPU-loss recovery |
| Multiplayer | per-player stream routing or explicit fence |

**Visual pass/fail:** lock reads in <100 ms as a solid piece (not a wireframe or a splash); combos 2/5/8/10 orderable from a still frame without relying on hue; the tunnel visibly reacts on combo; hero 10+ feels exceptional; reduced-motion keeps the hierarchy; rapid events settle gracefully, never strobe.

---

## 9. Definition of done

- Lock produces a **bold, solid, recognizable** four-cell stamp of the actual piece in a gutter.
- Combos 2–10 escalate one coherent system: **scene surge** + (6+) **hero gate**, refreshing rather than stacking.
- The intro renderer's default visuals are provably unchanged (identity at reaction 0).
- Structurally readable on Low quality, reduced motion, WebGPU, and WebGL2 fallback; complete with the intro MRT selective-bloom disabled.
- No center-board/ghost/next-piece contrast regression, no strobe, no board occlusion of cues.
- Pools bounded, idle work ~zero, disposal clean, surge frequency-capped.
- Phase-locked playground **and** short real-game captures (with a board) exist for the acceptance matrix. Until those captures exist, the design is approved but the visual feature is not finished.

---

## 10. Rejected / deferred

| Direction | Reason |
|---|---|
| Keep the hollow-wireframe Phase Seal | Reads as a debug glitch; the core failure |
| Center-anchored combo gate | Occluded by the board in real gameplay |
| Drive only `setAudioPulse` harder | Coefficients too small and entangled with ambient audio; use a dedicated additive surge |
| Rewrite the pools from scratch | Existing pool/allocator/fallback infra is good; only shaders + placement + wiring need change |
| Rebuild the intro renderer's warp/dismiss | Surge must be additive and independent; never touch dismiss |
| Full-screen flash / camera shake on every lock | Violates calm brand + accessibility; reserve bounded surge for combos only |

---

## 11. Cross-theme best-in-class synthesis (Starlight / Electric Dreams V3 / Blood Moon / Vesper Chrysalis)

Source-verified studies of the four themes the user cites as the quality bar. They **converge on one architecture**, and it sharpens Waves 2–3.

### The convergent pattern
Every one of them drives the **whole scene from one eased "director" scalar** (or a tiny set), decayed each frame, that *many* subsystems read at once — so a combo makes the entire world surge together. Serenity Warp instead pastes discrete geometry and its one whole-scene lever (`setAudioPulse`) is coefficient-starved (+0.03–0.05). **This is the gap.**

| Theme | Director scalar | Whole-scene reaction | Notable extra |
|---|---|---|---|
| **Vesper** | `sBaseline + sCombo + sFlare → sEased` (accumulate+hold+decay, critically-damped) | thresholded beats `uAscend=(S-0.5)/0.35`, `uCosmos=(S-0.85)/0.15`; every material reads `uS` | pure `-director.js` (5 fns) + unit tests; baked 3D-LUT grade; board-wedge luminance dead-zone |
| **Starlight** | reactor scalars + a screen-space **twinkle-WAVE** (one gaussian, angular distance, `invert` for T-spin) | sky ripples where you played; decayed post punches | **dominance ladder** `_resolve` (one dominant cue/resolution); `StarlightReactionDirector` + `stellar-seal.js` is a ready model |
| **EDv3** | `fxState` (sustained `comboIntensity/rewardPulse` + fast `chroma/bloom/vignettePunch`) | fluid turbulence + nebula + camera + post all move | persistent GPU-compute fluid; energy=f(speed)→emissive so impulses self-light |
| **Blood Moon** | `moonPulseIntensity` (`×0.95`/frame) | moon rim, glow layers, nebula, star twinkle all sample it | idle-slot scan so bursts **accumulate**; GPU-timer particle bursts |

### Techniques to adopt, mapped to Serenity Warp waves

1. **[Wave 2 — highest leverage] Compose a real director scalar, not a single pulse.** Replace the theme's single decaying `reactivePulse` with a Vesper-style `sBaseline + sCombo + sFlare → sEased` (accumulate-and-hold combo energy via `max(current, count*rate)` capped; fast `sFlare` transients; critically-damped ease; all fps-independent). Feed it into the intro renderer's opt-in additive `reactionSurge` (§5) with **real coefficients** (warp-kick, bloom swell, chroma bleed, all-piece flash), plus decayed **post punches** (`bloomPunch/flashPunch/chromaPunch`, ×0.78–0.86/frame). This is the single change that turns "decals on a plane" into "the world reacts."
2. **[Wave 2] Selective MRT-emissive bloom.** Serenity's FX already tag `material.userData.emitsBloom = true` but nothing consumes it — the intro bloom is non-selective. Route reactive glints through emissive-only bloom (or a theme-owned punch) so combos brighten the frame while the backdrop stays calm. (Verify the intro's `useMRT`; if absent, drive a composite bloom punch instead.)
3. **[Wave 0/2 — controller] Dominance arbitration.** Add Starlight's `_resolve` ladder (perfectClear > combo-apex > T-spin > Tetris > line clear > lock) with a same-frame coalescing window, so simultaneous events collapse to **one dominant cue + modifiers** instead of today's lock+clear+combo+T-spin+B2B all firing at once. Move choreography onto a theme-time timeline (`_at(offset,fn)` / `update(dt)`), not ms timestamps, so it pauses with the render gate. Add an **apex cooldown** (~6s) so combo-10 can't spam.
4. **[Wave 0 — controller] Accumulate-and-hold + stack-don't-clobber.** Adopt Vesper's `accumulateComboBoost` (held, capped), `comboMilestonesCrossed` (per-event cap = FPS-spike guard), `resolveComboProgress` (chain-break resets gate), and `pickExpiringSlotIndex` (bias to the slot NEAREST death, strength tie-break) — replacing `gameplay-fx.js` `_acquireSlot`'s "soonest-ending" steal that can clobber a livelier effect. Extract these as a pure `serenity-warp-reaction-director.js` with renderer-free tests (Vesper/Starlight both do this).
5. **[Wave 3] Spring-damped, hard-clamped camera director** (dolly/vertigo/fovPunch/shake, caps ~6°/0.5u, delta-normalized, critically damped) reserved for Tetris / T-spin / perfect-clear / sevenfold — Serenity has *no* camera choreography. The intro camera is driven in `update()` (idle Lissajous + warp dolly); add an additive clamped impulse offset like the reactionSurge.
6. **[Wave 3] A volumetric burst for the hero beats.** The geometric gate is thin/graphic; add a Blood-Moon/Starlight-style GPU-timer particle burst (single uniform drives the whole explosion) or a Starlight ATTRACTOR-inhale→RADIAL-bloom two-beat via the intro particle compute, for perfect-clear / sevenfold "volume."
7. **[Wave 1 — done, refine] Keep locks subtle with an energy handoff.** Phase Seal v2 is right (bold, solid, restrained). Borrow Starlight's release-wave handoff: at ~220 ms the lock hands a small ripple to the scene wave (`boost≈0.4`) — a causal chain that reads as intentional — and keep locks strictly camera-/flash-free.
8. **[Wave 4/5] Post framing so the spectacle reads intentional.** ACES + vignette + a **board-wedge luminance dead-zone** (Vesper effect.js:1692) that protects the playfield, and a palette-grade so the 7-hue spectrum reads cohesive, not busy.

### What NOT to regress (Serenity Warp is already ahead here)
Real `prefers-reduced-motion` shortening, quality-tiered instanced budgets, the renderer-neutral command queue, and **precise board→world origin projection** — EDv3/Blood Moon lack these. Add the director/post/camera drama *without* losing them.

### Sharpened priority
The four studies unanimously point at the same #1 lever: **Wave 2's scene-wide director surge.** It is where the "wow" gap lives; the discrete gate redesign (Wave 3) is secondary. Build the director scalar + renderer surge levers first, screenshot the tunnel actually surging, then layer the hero gate and camera on top.

---

## 12. Progress (2026-07-13)

**Waves 1–3 implemented and playground-verified. 49 Serenity Warp unit tests pass, lint clean.**

### Wave 1 — Phase Seal v2 (lock) ✅
- `src/playground/effects/serenity-warp-phase-seal.effect.js` — solid rounded-rect stamp (fill + piece-tinted rim + core glow + halo), converging motes, shock-ring, reduced-motion form, `pieces=all` silhouette gallery.
- Verified WebGPU (T + all 7 silhouettes + birth/settle/fade envelope), reduced-motion, `forceWebGL=1` (backend WebGL2, clean). Artifacts `serenity-warp-phase-seal-v2-*.png`.

### Wave 2 — Tunnel Surge (whole-scene reaction) ✅
- `threejs-intro-renderer-webgpu.js`: opt-in `setReactionState({surge,bloom,chroma,cameraKick})` — `warpEff = min(1, uWarp+reactionSurge)` threads through camera dolly / bloom / DoF / fringe / particle warp; `reactionCameraKick` adds a clamped big-beat impact wobble. **Default 0 → intro byte-identical** (verified).
- `serenity-warp-reaction-director.js` (NEW, pure): `sBaseline+sCombo+sFlare→sEased` (critically-damped, accumulate-and-hold, one-dominant-cue-per-frame), reduced-motion + intensity scaling. **16 renderer-free tests.**
- `serenity-warp-theme.js`: director created, `pulse` on events, `update(delta)`+`setReactionState` each frame, configure + dispose.
- Verified on the REAL renderer via `serenity-warp-tunnel-surge.effect.js` (mounts `IntroWebGPUVisual` on an overlay canvas): surge=0 identity vs surge=0.6 = camera dollies in + pieces rush forward + central bloom swell. 122 fps. Artifacts `serenity-warp-tunnel-surge-{0,6}.png`.

### Wave 3 — Production port + hero gate + camera ✅
- Ported the Phase Seal v2 solid-stamp shader (WebGPU + WebGL) into `serenity-warp-gameplay-fx.js` `createPhaseSealSystem`, replacing the hollow wireframe; `DEFAULT_SEAL_CELL_SIZE = 2.4` (was 0.86) so it reads at the ~36–38u FX-plane distance. Verified in the reactions harness: bold solid T-stamp + shock-ring. Artifact `serenity-warp-reactions-lock-v2b-t022.png`.
- Redesigned the Spectrum Gate: tier-scaled radius (`4.6 + tier*0.9`), rounder ratio (0.62→0.78), thicker rings (width 0.045→0.07), fewer/cleaner ellipses (sevenfold 4→3, aperture 3→2), fewer streaks (34→16 / 18→8), bigger brighter nodes (`0.55 + tier*0.09`). Verified combo-6 (clean double-ring portal) and combo-10 (big rounded 3-ring + 7-node heptagon), plus reduced-motion (streaks suppressed, dimmed/shortened) and `forceWebGL=1`. Artifacts `serenity-warp-reactions-combo{6,10}-v2*.png`.
- Camera kick: implemented + director-tested; a shake is motion so live confirmation is deferred to gameplay.

### Remaining (need the real game with a board — desktop session)
- **Wave 4** — resolve the on-screen board rect and place the combo gate in the upper corridor / seals in the nearer gutter so nothing is board-occluded (current placement is side-lane/center, fine in the boardless playground).
- **Wave 6** — short in-game captures WITH a board: lock, combo 2/6/10, T-spin, perfect clear, rapid cascade; confirm seal + surge + gate together and no board occlusion.
