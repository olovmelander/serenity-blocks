# PLAN-odyssey-texture-leaks — dispose TSL node-graph textures so chapter eviction can graduate

**Rank: 5 of 5.**
Source of truth: `ODYSSEY_MODE_PERFORMANCE_AUDIT.md` finding **OD-11** (§11 and §13) and
its Batch 5 sequencing. Read both first.

## Goal

The centralized chapter disposal traverse
(`src/rendering/odyssey/ChapterEnvironmentManager.js:~728-804`) frees geometry, materials,
material `map` textures, uniform `.isTexture` values, and `userData` render targets — but
**textures bound only inside TSL node graphs** (via `texture(someCanvasTexture)` in a
`colorNode`/`emissiveNode`/etc.) are invisible to that traverse, because they live in the
node graph, not in `.map` or `.uniforms`. At least 7 `CanvasTexture` instances across
chapters 1–3 leak on every dispose/evict cycle.

This is harmless today only because eviction is off and the board is parked-not-disposed.
It **blocks `?odysseyChapterEvict=1` (bounded VRAM on min-spec) from ever becoming
default** — the audit's Batch 5. Deliverable: every chapter-owned texture is registered and
disposed; a leak test pins it; eviction graduation itself (soak + default flip) stays
owner-gated and is NOT part of this plan.

## Files to touch

| File | What changes |
|---|---|
| `src/rendering/odyssey/ChapterEnvironmentManager.js` | Disposal traverse (~743–804): also dispose `root.userData.ownedTextures`; call a chapter-level `dispose()` if the environment object exposes one |
| `src/rendering/odyssey/chapter-environments/earth-core.js` | Register the textures created at ~1361 (`createRockTexture`-style), ~1712 (`createGlowTexture`), ~1734 (`createLavaGlowTexture`) — find every call site of these creators |
| `src/rendering/odyssey/chapter-environments/deep-ocean.js` | Texture created at ~751 |
| `src/rendering/odyssey/chapter-environments/surface-world.tsl.js` | Texture created at ~1030 |
| Other `chapter-environments/*.js` | Sweep: `grep -rn "new THREE.CanvasTexture\|new THREE.DataTexture\|new THREE.Texture(" src/rendering/odyssey/` and audit each hit the same way |
| `src/rendering/odyssey/chapter-environments/*.tsl.js` | The audit notes two chapters ship never-wired `dispose()` methods — wire them (see step 3) |
| `tests/unit/odyssey-chapter-texture-disposal.test.js` | New leak-pinning test |
| `ODYSSEY_MODE_PERFORMANCE_AUDIT.md` | Tick OD-11 with a dated note |

## Guardrails

- Gates after every commit: `npm test`, `npm run typecheck`, `npm run lint:ci`,
  `npm run check:boundaries`, `node scripts/architecture-fitness-check.mjs`, plus
  `npm run audit:theme-lifecycle` (it's in CI; make sure it still passes).
- **Do NOT flip `odysseyChapterEvict` default** — graduation needs an owner-run soak on
  real hardware (audit Batch 5). This plan only removes the blocker.
- **Do NOT run full-journey GPU captures** — CLAUDE.md TDR warning. Disposal changes don't
  alter rendered output; the pilot-page check in acceptance 5 is owner-optional.
- Land as: (1) registry + traverse support, (2) per-chapter registrations + wiring, (3)
  test. Small commits per chapter are fine.

## Steps

### Step 1 — Ownership registry + traverse support
1. Read the disposal region of `ChapterEnvironmentManager.js` (~728–804) until you can
   name: (a) the function shared by eviction and full dispose, (b) what it already
   disposes, (c) what object is the chapter "root" being traversed.
2. Add support: after the existing traverse steps, if
   `root.userData.ownedTextures` is an array, call `.dispose()` on every entry that has
   `isTexture`, then **empty the array** (`length = 0`) so a double-dispose call is a no-op
   and nothing retains the disposed textures.
3. Also add: if the chapter environment instance/module exposes a `dispose()` function
   (the never-wired tsl `dispose()`s — verify with
   `grep -n "dispose" src/rendering/odyssey/chapter-environments/*.tsl.js` and read each),
   call it from the same shared teardown path, wrapped in try/catch with a `console.warn`
   (one bad chapter must not abort the traverse).

**Edge cases:** the disposal path is a *superset* shared by eviction
(`disposeChapterEnvironment`) and full `dispose()` — hook the shared helper, not just one
caller, or eviction and shutdown will behave differently.

### Step 2 — Register every chapter-owned texture
For each creation site (start from the table above, then do the full sweep grep):
1. Trace where the created texture ends up. If it is bound via a TSL `texture(...)` node
   (imported from `three/tsl`), it is invisible to the traverse → **must be registered**.
   If it ends up as a material `.map` or a uniform `.value.isTexture`, the traverse already
   frees it → do NOT register it too (double-dispose is safe on three textures, but the
   registry should stay an honest list of otherwise-leaked resources; note skipped sites in
   the commit message).
2. Register at the point where the chapter root group is available:
   `(root.userData.ownedTextures ||= []).push(tex)`. If the creator function doesn't see
   the root, return the texture up to the builder that does — follow the existing code
   style; keep diffs minimal.
3. `earth-core.js` specifics: `createGlowTexture()` (~1693–1712) memoizes the **canvas** at
   module scope but returns a **fresh `CanvasTexture` per call** — the comment at ~1688
   explains this is deliberate so disposal can't poison a later session. Preserve exactly
   that split. Register each returned texture instance. Do NOT dispose or null the
   module-level `_glowCanvas`.

**Edge cases a weaker model would miss:**
- **Never register a texture created from a memoized/shared module-level *texture*** (if
  any site caches the `CanvasTexture` itself rather than the canvas): disposing it on
  evict would hand every later `create()` a dead texture → black sprites on re-entry. If
  you find such a site, first convert it to the earth-core pattern (cache the canvas,
  fresh texture per call), then register.
- Textures also referenced by the shared GLB cache (`fromSharedGltfCache`) are skipped by
  the traverse **on purpose** — the same rule applies to the registry: never register a
  texture the chapter doesn't exclusively own.
- Re-entry is the real test: after evict, the chapter's `create()` runs again and must
  produce working textures. Any texture created once at module import time (rather than
  inside `create()`) must NOT be registered — it would be disposed on first evict and
  never recreated.
- `surface-world.tsl.js` (~1030) sits in the `.tsl` twin — confirm which twin is actually
  active at runtime (grep for how the chapter picks `.tsl` vs legacy) and register in the
  active one; registering in dead code fixes nothing.

### Step 3 — Wire the orphan `dispose()` methods
For each `chapter-environments/*.tsl.js` exposing a `dispose()` that nothing calls: hook it
into the environment object the manager sees (step 1.3). Read what those `dispose()`
bodies free — if they already free the textures you registered in step 2, don't do both
for the same texture; prefer the chapter's own `dispose()` and use `ownedTextures` for
chapters that have no dispose method. State per-chapter which mechanism is in effect in
the commit message.

### Step 4 — Leak-pinning test
New `tests/unit/odyssey-chapter-texture-disposal.test.js`, following the mocking pattern of
the existing `src/rendering/odyssey/ChapterEnvironmentManager.test.js` (it runs in the
normal vitest environment — read it first; `CanvasTexture` needs a DOM canvas, so either
the existing test setup provides one or stub `document.createElement`).
Assertions:
1. Create a chapter environment (pick earth-core; if constructing the real chapter in the
   test env is impractical, test the manager mechanism instead: a fake environment whose
   root has `userData.ownedTextures = [fakeTexA, fakeTexB]` and a `dispose()` spy).
2. Run the manager's evict/dispose path → every registered texture's `dispose()` was
   called exactly once, the array is empty, and the chapter `dispose()` spy fired.
3. Run the teardown a second time → no throw, no second `dispose()` call.
4. Re-create after evict → the new root gets a fresh, non-empty `ownedTextures` (mechanism
   proves re-entry works). If real-chapter construction is possible, additionally assert
   `ownedTextures.length >= 3` for earth-core (its 3 creator sites).

### Step 5 — Close the loop
Update `ODYSSEY_MODE_PERFORMANCE_AUDIT.md` §13 OD-11 row: dated note, list of registered
textures per chapter, and the remaining owner step ("eviction soak on real GPU → flip
default with `?odysseyChapterEvictOff` escape — audit Batch 5").

## Acceptance criteria

1. All gates green, including `npm run audit:theme-lifecycle`.
2. The sweep grep (`new THREE.CanvasTexture|new THREE.DataTexture|new THREE.Texture(`
   under `src/rendering/odyssey/`) is reproduced in the final commit message as a table:
   site → disposition (registered / already-traversed / module-lifetime / dead twin), with
   zero unexplained rows.
3. The leak test passes and pins: dispose-once semantics, idempotent re-dispose, and
   working re-creation after evict.
4. `?odysseyChapterEvict` default is unchanged (grep proves it).
5. Owner-optional real-GPU check (document, don't block): run the pilot page
   (`odyssey-webgpu-pilot.html?chapter=1`), toggle create→evict ×8 via the eviction flag,
   and confirm `renderer.info.memory.textures` returns to its baseline each cycle — flat,
   not stair-stepping. Provide the exact steps in the commit/PR description.
