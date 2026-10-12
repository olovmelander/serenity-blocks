# Sky Children — handover (2026-10-12)

Where the Sky Children ("Irisfall") rebuild stands, what is left, and how to pick it up in a new
session. The theme itself is described in the design record,
[SKY_CHILDREN_VISUAL_OVERHAUL_2026-10.md](SKY_CHILDREN_VISUAL_OVERHAUL_2026-10.md); read it first.
Appendices: [the round-3 critique and its skeptic verdicts](sky-children-handover/CRITIQUE_ROUND3.md),
[the round-3 fix packages and their workflow](sky-children-handover/ROUND3_PACKAGES.md),
[capture tools and frame sets](sky-children-handover/CAPTURE_TOOLS.md).

## State at handover

- **Merged to `main`** together with everything `main` had gained meanwhile (Painted Ages, the
  Moonlit Greenhouse and Nebula Flow rebuilds). The work was done on the branch
  `ccr-10c88c36-tbdwqd`; its last theme commit before the merge is `79adc87`.
- **Gates on the merged tree:** typecheck clean, lint ratchet 565 errors (baseline 807; the
  baseline was not lowered), dependency boundaries clean, theme lifecycle audit passed, build
  with boot closure OK, IP string gate OK, and the full unit suite (`npm test`: 861 files, 16,513
  tests, all passing; the 15 Sky Children files hold 347 of them).
- **What the theme is now:** a from-scratch rebuild under `src/themes/sky-children/` (registry id
  `sky-children`, 24 modules, about 14.9 k lines), three 0.186.1 `three/webgpu` + TSL with every
  material a `MeshBasicNodeMaterial`, WebGL2 fallback, nothing loaded from disk (all textures are
  CPU-baked). Scene triangles per tier: Minimal 45.2 k, Low 57.1 k, Medium 73.7 k, High 98.6 k,
  Ultra 127.1 k, Extreme 161.2 k (budgets 60 / 80 / 100 / 140 / 180 / 230 k); 15 draws on every
  tier, which is the cap. The sky dome's fragment WGSL is about 40 KB of its 64 KB gate.
- **Work in progress, not merged:** the branch `sky-children-r3-isles-wip` holds the first few
  minutes of the round-3 isles package (an alternating stagger of the terraces, elliptical pools
  `rx`/`rz`/`yaw` emitted by `buildCascade`, a `flow` ribbon returned for a travertine apron). It
  is unverified: no capture was taken and the tests were not run; `sky-children-water.js` and
  `placePools` do not read the new fields yet. Use it as a starting point or drop it.

## How it got here

1. **First build** (2026-10-11): the design (see the record), the core, world, sky, set pieces,
   effects and post; tests; an adversarial review whose 16 confirmed findings were fixed.
2. **Visual audit** (first round): seven critics against the repo's most loved themes, a skeptic
   per finding, a brief per dimension, then four packages built in parallel worktrees, each
   reviewed (code and art) and fixed, and merged: isles + gate + composition; sky + clouds;
   falls + spray; bow + optics.
3. **"Nothing left floating"** (the owner's request: "all the arcs are not standing on solid
   ground"; "make the islands slightly larger so the arcs fit and align the arcs with the
   ground"). The isles were enlarged (Spring 72 m across its crown, Twin 46 m), and every work now
   stands on the crown exactly as `buildMassif` lays it (`crownHeight`, levelled pads, footings).
   Two adversarial grounding audits (inspectors per structure ray-casting the built meshes on all
   six tiers, a skeptic per finding) found what still floated or sank; all of it is fixed and
   pinned by `tests/unit/sky-children-isles.test.js`. The second round's fixes: rimstone dishes
   that hold their pools (dams across the local fall line, side rims, skirts), a travertine runnel
   down the spillway's notch, outlets on the actual rim, the bell hung from a stem at the soffit
   and swinging clear of the stone, single-extrusion walls for the Far Gate laid on its voussoirs'
   chords, the spillway sized to the gate's notch, every closed stone piece wound outward (a test
   checks signed volume and edge consistency), and the camera's near plane raised to 2 m
   (`REST_RIG` in `sky-children-frame.js`), which takes the depth resolution at the Far Gate from
   about 35 m to about 5 m.
4. **Round-3 critique** (the last thing done): seven critics compared the first audit's frames
   with the same queries after round 2. Scores rose in every dimension (isles 3 → 5.5, falls
   4 → 6, clouds 3 → 6, bow 4 → 7, gates 3 → 6, composition 4 → 6.5, atmosphere 4 → 6), and 40
   findings (28 major) say what still holds each back. The skeptics had checked 8 of the 28
   majors (all four isles majors and four of the five falls majors, every one confirmed) when the
   critique was stopped for the handover; the appendix marks the other 20 PENDING.
   The six fix packages were planned and launched, then stopped for this handover before any of
   them committed.

## What to do next, in order

1. **Re-render a baseline** of the merged state with the "b" query set
   ([CAPTURE_TOOLS.md](sky-children-handover/CAPTURE_TOOLS.md)), so every change below is judged
   against today's picture, not against the critique's frames (those predate the last grounding
   fixes).
2. **Finish verifying the critique.** For each PENDING major in
   [CRITIQUE_ROUND3.md](sky-children-handover/CRITIQUE_ROUND3.md), check the claim against a fresh
   frame and the code before building it. The verdicts already in show why: every one confirmed
   the problem, and several corrected the critic's fix (the cascade's minimum drop would have
   sunk pools under their turf; the root's "support function" would have filled the saddles it
   was meant to carve; the dome exponent change would have made the cushion worse).
3. **Build the six packages** of [ROUND3_PACKAGES.md](sky-children-handover/ROUND3_PACKAGES.md)
   (isles; stone and structures; composition; sky; falls; light and bow), each in its own
   worktree, each reviewed and fixed, then merged in the order given there with every test and
   the key captures re-run after each merge. By visual impact, the largest items are:
   - the Mother Fall's plume, which swallows half the hero fall (`falls-plume-swallows-the-fall`);
   - the antisolar point A, which reads as a dark hole in the cloud sea where everything
     converges (`clouds-1`, `bow-1`, `atmosphere-antisolar-dark`: one design);
   - the cascade, which reads as a ladder of white slats (`isles-1`);
   - the crown, which sits like a lid on a dark slot (`isles-3`), and the root, a symmetric
     spinning top that touches the parapet (`isles-2`);
   - the Far Gate's foot lost in the Deep's mist and the Twin's aqueduct framed inside its opening
     (`gates-1`, `gates-4`, `composition-3`);
   - the phone and multi-board layouts, which are still an aerial survey: the planned "crown plan"
     was never built (`composition-1`);
   - every hour sharing one light geometry (`atmosphere-hours-one-light`).
4. **Run another critique round** on the result (the same seven dimensions, before/after frames,
   skeptics), and a grounding audit if any geometry moved. Loop until the critics stop finding
   majors.
5. **Close out:** re-render the design record's images (`docs/sky-children-overhaul/*.webp` still
   show the first build), update the record's numbers (triangles, tests), run the gates, merge.

## Open decisions for the owner

- **The old V2 module.** `src/themes/sky-children-v2/`, `src/themes/shared/sky-core/`,
  `public/textures/sky-children-v2/`, `src/playground/effects/sky-children-detail.effect.js` and its
  two tests are still on disk, unloaded by the registry; the build still emits a
  `theme-sky-children-v2` chunk. Delete them, or keep them?
- **`sky-children-ledger.js`** (PoolLedger, StrokeBook, Dial) is a reference model that the world
  does not import; its tests pin the model, not the world. Wire it in, or remove it?
- **Lint baseline:** the ratchet suggests lowering its baseline from 807 to 565
  (`node scripts/lint-ratchet-check.mjs --update`); that was left for the owner.

## Rules that kept the work sound

- **Verify visually.** A clean build is not proof (CLAUDE.md). Every change was judged on
  captures and a clean console. In a cloud container the `chrome-devtools` MCP did not connect, so
  frames came from Playwright on SwiftShader (WebGL2 only; see the capture tools). No frame was
  ever taken on a real GPU, and nobody has watched the theme move at speed: both are still owed.
- **Grounding is a hard requirement** from the owner: anything standing on a crown must use
  `crownHeight` (or `massifCrownAt`/`massifGround`) with the same build options the mesh was
  grown with, and the isles tests ray-cast the built meshes on every tier. Keep them green.
- **Budgets:** the triangle budgets above, at most 15 draws (all used: a new draw needs one
  removed), the dome's fragment WGSL under 64 KB and every other stage under 48 KB (the world and
  shader tests enforce them). Determinism: everything is a function of the world clock (`seek(t)`
  reproduces any frame). Flashes go through the flash governor (at most 3 onsets a second).
- **IP guardrail:** the theme is inspired by a well-known game about children of the sky. Never
  copy its names, its studio's name, its realm or collectible names, characters or signature
  motifs (carried flames and votive lights, capes, guide figures). Grep every diff for those
  before committing; the theme's own vocabulary (Irisfall, the Mother Fall, the Twin Isle, the Far
  Gate, the hours Jade Morning to Pearl Dawn) is original.
- **Parallel work:** one worktree per package with a strict file-ownership list, merged by one
  integrator. Never use `git stash` in a multi-worktree setup: the stash stack is shared by every
  worktree, and a stash pop once pulled one package's work into another's tree. Give every
  worktree its own Vite port, and let each capture start and stop its own server.
- **Adversarial checks pay:** across the rounds, skeptics refuted or corrected a large share of
  confident-sounding findings and fixes. Keep a skeptic between a critic and a builder.

## Reproduce and test

- Playground: `npm run dev:playground`, then
  `/playground.html?effect=sky-children&t=30&quality=High&board=1` (all parameters: the design
  record's Reproduce section).
- Game: `/?skipIntro=1&unlockAll=1&skyChildrenFixedDt=40`, with the theme chosen in settings.
- Theme tests: `npx vitest run tests/unit/sky-children-*.test.js` (15 files). Gates: `npm run
  typecheck`, `npm run lint:ci`, `npm run check:boundaries`, `npm run audit:theme-lifecycle`,
  `npm run build`, `npm run check:ip-strings`, `npm test`.
