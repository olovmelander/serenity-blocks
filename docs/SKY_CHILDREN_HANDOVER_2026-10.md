# Sky Children — handover (2026-10-12)

Where the Sky Children ("Irisfall") rebuild stands, what is left, and how to pick it up in a new
session. The theme itself is described in the design record,
[SKY_CHILDREN_VISUAL_OVERHAUL_2026-10.md](SKY_CHILDREN_VISUAL_OVERHAUL_2026-10.md); read it first.
Appendices: [the round-3 critique and its skeptic verdicts](sky-children-handover/CRITIQUE_ROUND3.md),
[the round-3 fix packages and their workflow](sky-children-handover/ROUND3_PACKAGES.md),
[capture tools and frame sets](sky-children-handover/CAPTURE_TOOLS.md).

## State at handover

- **Merged to `main`**, together with everything `main` had gained meanwhile (Painted Ages, the
  Moonlit Greenhouse and Nebula Flow rebuilds, Sunset's 24-hour day). The work was done on the
  branch `ccr-10c88c36-tbdwqd`; its last theme commit is `79adc87`, and the theme's code on `main`
  is byte-identical to it.
- **Gates on the final merged tree:** typecheck clean, lint ratchet 565 errors (baseline 807; the
  baseline was not lowered), dependency boundaries clean, theme lifecycle audit passed, build with
  boot closure OK, IP string gate OK (it scans only for the Tetris marks), and the full unit suite
  (`npm test`: 861 files, 16,519 tests, all passing; the 15 Sky Children files hold 347 of them).
  A playground frame of the merged tree renders as before, with a clean console.
- **What the theme is now:** a from-scratch rebuild under `src/themes/sky-children/` (registry id
  `sky-children`, 24 modules, about 14.9 k lines), three 0.186.1 `three/webgpu` + TSL with every
  material a `MeshBasicNodeMaterial`, WebGL2 fallback, nothing loaded from disk (all textures are
  CPU-baked). Scene triangles per tier (the world test's census, instances at capacity): Minimal
  47.6 k, Low 59.8 k, Medium 76.4 k, High 101.7 k, Ultra 130.8 k, Extreme 165.0 k (budgets 60 /
  80 / 100 / 140 / 180 / 230 k); 15 draws on every tier, which is the cap. The sky dome's fragment
  WGSL is about 55 KB at High of its 64 KB gate (55,074 of 65,536 bytes: about 10 KB of headroom); every other stage is
  under 35 KB of its 48 KB.
- **Work in progress, not merged:** the branch `sky-children-r3-isles-wip` holds the first minutes
  of the round-3 isles package: an alternating stagger of the terraces, elliptical pools (`rx`,
  `rz`, `yaw`) emitted by `buildCascade`, the cascade's `flow` ribbon, and an apron block (a `flow`
  option) in `createStoneMaterial` that `createIsles` does not pass yet. It branches from
  `79adc87` (merge `main` into it before use) and **fails the isles grounding test on all six tiers**
  ("spring pool on terrace N held at k"): the test samples each pool's rim from `buildCascade`'s own
  output at 1.11 × `radius`, and `radius` is now `max(rx, rz)`. Sampling the yawed ellipse at
  1.11 × (rx, rz) instead (the test change in isles-1's amended step 2) clears five tiers; Medium
  still fails (terrace 2, k 22, 0.33 m) on a pool that stays a circle, so the alternating stagger
  also unseats a pool there and needs its own fix. `createPools.set` and `placePools` must also take
  rx/rz/yaw before the pools render as ellipses. No capture was taken. Use it as a starting point
  or drop it.
- **The attic:** the branch `sky-children-attic` keeps, as patch files, the only states that existed
  nowhere but in the session's container (a stray stash and two dirty worktrees from a round-1
  stash-pop accident). The theme does not need them; `attic/README.md` says what each is.

## How it got here

1. **First build** (2026-10-11): the design (see the record), the core, world, sky, set pieces,
   effects and post; tests; an adversarial review whose 16 confirmed findings were fixed.
2. **Visual audit** (first round): seven critics against the repo's most loved themes, a skeptic
   per finding, a brief per dimension, then four packages built in parallel worktrees, each
   reviewed (code and art) and fixed, and merged: isles + gate + composition; sky + clouds;
   falls + spray; bow + optics.
3. **"Nothing left floating"** (the owner's request: "all the arcs are not standing on solid
   ground"; "make the islands slightly larger so the arcs fit and align the arcs with the
   ground"). The isles were enlarged (the Spring's radius to 72 m, about 140 m across its crown;
   the Twin's to 46 m), and every work now stands on the crown exactly as `buildMassif` lays it
   (`crownHeight`, levelled pads, footings). Two adversarial grounding audits (inspectors per
   structure ray-casting the built meshes on all six tiers, a skeptic per finding) found what
   still floated or sank; all of it is fixed and pinned by `tests/unit/sky-children-isles.test.js`.
   The second round's fixes: rimstone dishes that hold their pools (dams across the local fall
   line, side rims, skirts), a travertine runnel down the spillway's notch, outlets on the actual
   rim, the bell hung from a stem at the soffit and swinging clear of the stone, single-extrusion
   walls for the Far Gate laid on its voussoirs' chords, the spillway sized to the gate's notch,
   every closed stone piece wound outward (a test checks signed volume and edge consistency), and
   the camera's near plane raised to 2 m (`REST_RIG` in `sky-children-frame.js`), which takes the
   depth resolution at the Far Gate from about 35 m to about 5 m.
4. **Round-3 critique** (the last thing done): seven critics compared the first audit's frames
   with the same queries after round 2. Scores rose in every dimension (isles 3 → 5.5, falls
   4 → 6, clouds 3 → 6, bow 4 → 7, gates 3 → 6, composition 4 → 6.5, atmosphere 4 → 6), and 40
   findings (28 major) say what still holds each back. The skeptics had checked 8 of the 28
   majors (all four isles majors and four of the five falls majors, every one confirmed) when the
   critique was stopped for the handover; the appendix marks the other 20 PENDING. The six fix
   packages were planned and launched, then stopped before any of them committed.

## What to do next, in order

0. **Remove the gateway's two upright column stubs first** (`buildGateway`, the `cols` block).
   gates-6 found that, standing before the bell, they read as a shrine of votive lights: the motif
   family the IP guardrail bans. Remove them (or lay one drum on its side on the top course). The
   isles test "stacks the gateway" probes for air under each column at their two positions: drop
   those two probes with the stubs (or move them to the drum), keep the rest of the grounding tests
   green, and look at the b07 crown lens. It is one small change and should not wait for a package.
1. **On a machine with a GPU, check the theme on hardware once.** Nobody has: every frame so far
   is SwiftShader WebGL2, and the WebGPU backend has never rendered a frame. With the
   `chrome-devtools` MCP (CLAUDE.md's loop), capture b02, b05 and b13 one at a time, read the
   console for WebGPU validation errors, and check the calm zones over the card and HUD, the bloom
   and the grade. Then watch the theme move at speed for a minute in the game. On the dev machine's
   iGPU take one view per capture: CLAUDE.md warns that heavy WebGPU captures have crashed it.
2. **Render a baseline** of the merged state with the b query set
   ([CAPTURE_TOOLS.md](sky-children-handover/CAPTURE_TOOLS.md)), so every change is judged against
   today's picture, not against the critique's frames (taken at `e680429`, before the last
   grounding fixes).
3. **Finish verifying the critique.** Run one skeptic per PENDING major (20 of them). The skeptic
   tries to refute the finding from fresh captures of its views and from the code, measuring where
   it can (a headless probe, see CAPTURE_TOOLS.md, is faster than a frame). If the finding survives,
   it writes an "Amended fix (use this)" with files, cost and a verify list, as the 8 landed verdicts
   do. Write each verdict into [CRITIQUE_ROUND3.md](sky-children-handover/CRITIQUE_ROUND3.md) in
   place of its "PENDING at export" line, and update the index row and the count, so the package
   builders read it. The verdicts already in show why this step matters: each confirmed the problem
   but corrected the critic's fix (the cascade's minimum drop would have sunk pools under their
   turf; the root's "support function" would have filled the saddles it was meant to carve; the
   dome exponent change would have made the cushion worse; the plume's luminance targets were
   mis-specified). Read the corrections at the top of that file first.
4. **Build the six packages** of [ROUND3_PACKAGES.md](sky-children-handover/ROUND3_PACKAGES.md)
   (isles; stone and structures; composition; sky; falls; light and bow), each in its own
   worktree, reviewed and fixed, then merged in the order given there, with the hooks applied in
   one integration pass and every test and the key captures re-run after each merge. By visual
   impact, the largest items are:
   - the Mother Fall's plume, which swallows half the hero fall (`falls-plume-swallows-the-fall`,
     confirmed);
   - the cascade, which reads as a ladder of white slats (`isles-1`, confirmed);
   - the crown, which sits like a lid on a dark slot (`isles-3`, confirmed), and the root, a
     symmetric spinning top that touches the parapet (`isles-2`, confirmed);
   - the antisolar point A, which reads as a dark hole in the cloud sea where everything
     converges (`clouds-1`, `bow-1`, `atmosphere-antisolar-dark`: one design; PENDING, verify first);
   - the Far Gate's foot lost in the Deep's mist and the Twin's aqueduct framed inside its opening
     (`gates-1`, `gates-4`, `composition-3`; PENDING, verify first);
   - the phone and multi-board layouts, which are still an aerial survey (`composition-1`, the
     "crown plan", whose only spec is that finding's critic's fix; PENDING, verify first);
   - every hour sharing one light geometry (`atmosphere-hours-one-light`; PENDING, verify first).
5. **Run another critique round** on the result (the same seven dimensions, before/after frames,
   skeptics), and a grounding audit if any geometry moved. Loop until the critics stop finding
   majors.
6. **Close out:** re-render the design record's images (`docs/sky-children-overhaul/*.webp` still
   show the first build) and the theme icon (both copies, see below), update the record's numbers
   (triangles, tests), check the real game (`/?skipIntro=1&unlockAll=1&skyChildrenFixedDt=40`:
   locks fill pools, console clean), run the gates, merge.

## Open decisions for the owner

- **The old V2 module.** `src/themes/sky-children-v2/`, `src/themes/shared/sky-core/`,
  `public/textures/sky-children-v2/`, `src/playground/effects/sky-children-detail.effect.js` and the
  V2 module's two tests (`tests/unit/sky-detail-texture-lifecycle.test.js`,
  `tests/unit/sky-mood-director-accumulation.test.js`) are still on disk, unloaded by the registry;
  the build still emits a `theme-sky-children-v2` chunk. Delete them, or keep them? Deleting them
  also means removing the four `sky-children-detail` entries from
  `src/ui/url-parameters/playground-parameters.js`, and the registry's `sky-children-v2` →
  `sky-children` alias (`RETIRED_THEME_IDS` in `theme-registry.js`) must stay for old saves.
- **`sky-children-ledger.js`** (PoolLedger, StrokeBook, Dial) is a reference model that only its own
  test imports; the world keeps its own pool choice, release and dial. Wire it in, or remove it?
- **The icon** is still the first build's (`src/themes/sky-children/sky-children-theme-icon.png`,
  with an identical copy at `public/assets/themes/sky-children-theme-icon.png`), picked with the
  query in the record's "Not verified". Re-render both at close-out and confirm the pick.
- **Design changes the critique proposes:** bow-5 removes the fogbow (one of the record's optics),
  and gates-1 lifts the Far Gate's mesa above the horizon. Both change the shipped design: decide
  before they are built.
- **Lint baseline:** the ratchet suggests lowering its baseline from 807 to 565
  (`node scripts/lint-ratchet-check.mjs --update`); that was left for the owner.

## Rules that kept the work sound

- **Verify visually.** A clean build is not proof (CLAUDE.md). Every change was judged on captures
  and a clean console. In a Linux container the `chrome-devtools` MCP cannot start (`.mcp.json`
  launches it through Windows' `cmd /c`), so frames came from Playwright on SwiftShader (WebGL2
  only; see the capture tools). No frame was ever taken on a real GPU, and nobody has watched the
  theme move at speed (step 1 above).
- **The rendering law** (the tests enforce most of it):
  - every material is a `MeshBasicNodeMaterial` with its light written by hand in TSL;
  - every texture is a CPU-baked `DataTexture` and nothing is loaded (the world test fails on any
    loader or fetch);
  - one TSL source serves both backends (the shaders test runs every material through the WGSL and
    GLSL node builders);
  - loops over strokes, casters and lamps are real shader loops, never JS-unrolled (an unrolled loop
    shows up as about 100 KB of WGSL);
  - no texture sampling or derivatives inside non-uniform branches;
  - hours and events only move uniforms (every colour a row of one `uniformArray`), so nothing
    rebuilds a shader at run time;
  - the same 15 meshes on every tier, and `dispose()` frees every geometry, material and texture;
  - the near plane is 2 m (`REST_RIG`): nothing the camera sees may come nearer (mind it when
    rebuilding the overlook).
- **Grounding is a hard requirement** from the owner: anything standing on a crown must use
  `crownHeight` (or `massifCrownAt`/`massifGround`) with the same build options the mesh was grown
  with, and the isles tests ray-cast the built meshes on every tier. Keep them green.
- **Budgets:** the triangle budgets above, at most 15 draws (all used: a new draw needs one
  removed), the dome's fragment WGSL under 64 KB (about 10 KB left) and every other stage under
  48 KB (the world and shader tests enforce them). Determinism: everything is a function of the
  world clock (`seek(t)` reproduces any frame). Flashes go through the flash governor (at most 3
  onsets a second).
- **IP guardrail:** the theme is inspired by a well-known game, deliberately not named here. Never
  copy its names, its studio's name, its realm, collectible or currency names, its characters or
  its signature motifs (carried flames and votive lights, capes, guide figures). The denylist is
  deliberately not written in the repo, because writing it would put the names here: at the start
  of a session, build it in your scratch space from your own knowledge of the game (its title words,
  its studio, every realm's name, its collectibles and currencies, its named characters, and the
  motif words above), and run `git diff <base> | grep -inE '<list>'` before every commit. `npm run
  check:ip-strings` does not cover this: it scans only for the Tetris marks. The theme's own
  vocabulary (Irisfall, the Mother Fall, the Twin Isle, the Far Gate, the hours Jade Morning to
  Pearl Dawn) is original.
- **Parallel work:** one worktree per package with a strict file-ownership list, merged by one
  integrator. Never use `git stash` in a multi-worktree setup: the stash stack is shared by every
  worktree, and a stash pop once pulled one package's work into another's tree. Give every worktree
  its own Vite port and dependency cache, and let each capture start and stop its own server.
- **Adversarial checks pay:** across the rounds, skeptics refuted or corrected a large share of
  confident-sounding findings and fixes, and a check of this very handover found stale numbers in
  it. Keep a skeptic between a critic and a builder, and measure before writing a number down.

## Reproduce and test

- Playground: `npm run dev:playground`, then
  `/playground.html?effect=sky-children&t=30&quality=High&board=1` (every parameter: the header of
  `src/playground/effects/sky-children.effect.js`; the common ones are in the design record's
  Reproduce section and in CAPTURE_TOOLS.md).
- Game: `/?skipIntro=1&unlockAll=1&skyChildrenFixedDt=40`, with the theme chosen in settings.
- Theme tests: `npx vitest run tests/unit/sky-children-*.test.js` (15 files, 347 tests); lint the
  theme with `npx eslint src/themes/sky-children/ tests/unit/sky-children-*.test.js` (0 errors).
  Gates: `npm run typecheck`, `npm run lint:ci`, `npm run check:boundaries`, `npm run
  audit:theme-lifecycle`, `npm run build`, `npm run check:ip-strings`, `npm test`.
