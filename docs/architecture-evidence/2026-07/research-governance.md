# Architecture Governance for an Evolving Solo-Dev JS/TS Game Codebase

**Research report — 2026-07-02**
**Target codebase:** Serenity Blocks (Electron + Vite + Vitest, WebGPU/Three.js/TSL, ~664 source files, `src/{core,ui,themes,rendering,audio,events,utils,playground}` + `electron/` main process). Largest files today: `src/themes/neon-district/neon-district-theme.js` (10,161 lines), `src/main.js` (6,180), `src/core/game-modes/OdysseyMode.js` (5,834), `src/core/multiplayer/ffa-p2p-game-state.js` (5,116). Existing assets to build on: `.eslintrc.json`, `tsconfig.json` with an **opt-in `// @ts-check` ratchet harness already in place** (checkJs:false, allowJs:true, includes `src/core` + `src/events`), `npm run typecheck`, Vitest suite, `docs/ARCHITECTURAL_REMEDIATION_PLAN.md`.

**Framing:** every recommendation below is filtered through the solo-dev constraint. Governance tooling for teams exists mostly to stop *other people* from violating decisions; for a solo dev (plus AI agents doing large mechanical edits), it exists to stop *future-you and your agents* from silently violating decisions you made months ago. That changes the cost/benefit: automated, zero-maintenance checks in CI are worth a lot; process ceremony (review boards, heavyweight docs, dashboards) is worth almost nothing. Notably, AI-agent-driven refactoring *raises* the value of machine-enforced boundaries: an agent will happily add `import { game } from '../core/game.js'` inside a theme unless a lint/CI rule rejects it.

---

## 1. Architecture fitness functions (Building Evolutionary Architectures)

### The practice
A fitness function is "any mechanism that performs an objective integrity assessment of some architecture characteristic" — the unit test of architecture (Ford/Parsons/Kua, *Building Evolutionary Architectures*, ThoughtWorks/O'Reilly). Instead of documenting rules ("core must not touch the DOM") and hoping, you encode each rule as an executable check that runs in CI on every commit. The book's taxonomy that matters here:

- **Atomic vs. holistic** — atomic checks one characteristic (a dependency direction); holistic checks combined behavior (a perf budget under load).
- **Triggered vs. continual** — triggered runs in CI; continual runs in production (Netflix's Chaos Monkey is the canonical continual example). Solo desktop game ⇒ almost everything should be *triggered/atomic*.
- **Static vs. dynamic** — static has a fixed pass/fail (no cycles); dynamic has a moving threshold (error-count ratchets, §5).

ThoughtWorks' "fitness function-driven development" article gives the CI shape: gatekeepers are automated so they never block flow — coverage thresholds, dependency rules, performance budgets, all as pipeline stages. The Tech Radar has carried "architectural fitness functions" as a recommended technique for years.

### Why
Architecture erodes by a thousand innocent commits, not by big decisions. A solo dev doing god-class decomposition over months *will* forget which imports were supposed to be temporary. Fitness functions convert "I intend the core to stay DOM-free" into "the build fails if it isn't."

### Concrete application to Serenity Blocks
A realistic starter suite, each a CI step (GitHub Actions or a local `npm run gates` — the repo already has `check:release-gates` as a hook point):

1. **Dependency-direction rules** (§2) — the highest-value fitness function for this codebase: `src/core` must not import `src/ui`, `src/themes`, `src/rendering`, or touch `document`/`window`; themes must not import each other; `electron/` main-process code must not be imported by renderer `src/`.
2. **Cycle detection** — `dependency-cruiser` `no-circular` at `warn` first (a 664-file codebase that grew organically almost certainly has cycles; inventory before enforcing).
3. **Type-coverage ratchet** (§5) — count of files carrying `// @ts-check` may only go up; `tsc --noEmit` error count may only go down.
4. **File-size ratchet** — a 20-line script: no file already over N lines may grow; new files must stay under N. This directly serves god-class decomposition — it makes `OdysseyMode.js` and `main.js` shrink-only. (This is a classic "dynamic" fitness function; simpler than any tool.)
5. **Perf budget as holistic fitness function** — you already have `perf:odyssey:baseline` / `perf:odyssey:compare`; formalize: fail if median FPS on a fixed scene drops >10% vs. the committed baseline. Run manually/nightly, not per-commit (WebGPU capture is TDR-risky on this machine — keep it out of the hot path).
6. **Bundle/startup budget** — `vite build` output size threshold; Electron cold-start-to-menu time (you already measure a 17ms warm entry — pin it).

### Pitfalls / not worth it at this scale
- **Don't build a fitness-function "platform."** The book's enterprise examples (holistic, continual, production-monitoring functions) assume ops teams. For a desktop game, a folder of scripts + CI YAML is the whole system.
- **Don't start with 20 functions.** Start with dependency rules + one ratchet; add a function only when a real regression annoys you ("scar tissue" driven).
- **Beware flaky holistic functions.** FPS checks on a laptop iGPU are noisy; use medians over fixed seeds/time-locks (`?t=<seconds>` phase-locking already exists in the playground) and generous thresholds, or they'll train you to ignore red builds — the worst outcome of any governance tool.

**Sources:** ThoughtWorks book page (https://www.thoughtworks.com/en-us/insights/books/building-evolutionaryarchitectures-second-edition); Fitness function-driven development (https://www.thoughtworks.com/insights/articles/fitness-function-driven-development); Tech Radar entry (https://www.thoughtworks.com/radar/techniques/architectural-fitness-function); InfoQ summary (https://www.infoq.com/news/2019/02/fitness-functions-architecture/).

---

## 2. JS/TS module-boundary enforcement: dependency-cruiser, eslint-plugin-boundaries, ts-arch

Three tools, three enforcement points. For this repo the right answer is **dependency-cruiser as the CI source of truth + eslint-plugin-boundaries for in-editor feedback**; ts-arch is optional sugar.

### 2a. dependency-cruiser (CI gate — recommended primary)
Whole-graph analysis: cycles, orphans, reachability, and forbidden edges, with regex path rules and `$1` group matching. Runs as one CLI command, outputs graphs (`--output-type dot`), and validates against `.dependency-cruiser.cjs`.

Real rules, adapted to this repo's actual layout:

```js
// .dependency-cruiser.cjs
module.exports = {
  forbidden: [
    {
      name: 'core-stays-headless',
      comment: 'Game simulation must run without DOM/renderer — required for tests, bots, and MP determinism',
      severity: 'error',
      from: { path: '^src/core' },
      to: { path: '^src/(ui|themes|rendering|playground|audio)' },
    },
    {
      name: 'themes-are-islands',
      comment: 'A theme may not import another theme (copy shared code to src/rendering/shared)',
      severity: 'error',
      from: { path: '^src/themes/([^/]+)/' },
      to: { path: '^src/themes/([^/]+)/', pathNot: '^src/themes/$1/' },
    },
    {
      name: 'no-renderer-to-electron-main',
      comment: 'Renderer code must reach main process via IPC/preload only',
      severity: 'error',
      from: { path: '^src' },
      to: { path: '^electron' },
    },
    {
      name: 'no-circular',
      severity: 'warn', // inventory first; promote to error per-subtree as you clean
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      comment: 'Dead files rot — delete or wire up (LevelResultsModal.js is a known dead module)',
      severity: 'warn',
      from: { orphan: true, pathNot: '\\.d\\.ts$' },
      to: {},
    },
  ],
};
```

**Reality check + the killer feature — known-violations baselines.** As of 2026-07-03 `src/core` *already* imports from `src/ui`/`src/themes` in 9+ files (`constants.js`, all six game-mode classes, `ffa-p2p-game-state.js`, `steam-invite-manager.js`) and ~20 core files touch `window`/`document`. An `error`-severity `core-stays-headless` rule therefore fails on day one — the classic way governance tooling gets uninstalled. dependency-cruiser solves this natively: `depcruise src --output-type baseline > .dependency-cruiser-known-violations.json` records every current violation, and running with `--ignore-known` grandfathers them while **new violations still fail CI**. Fixing a violation permanently shrinks the committed baseline, so the boundary rule itself becomes a down-only ratchet — exactly the right mechanism for governing a refactor already in flight (see rules reference: https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md).

A second rule worth adding once decomposition starts — freeze the god file's *dependents* so nothing new couples to it while you strangle it (§3):

```js
{
  name: 'no-new-dependents-on-main',
  comment: 'Strangler ratchet: nothing NEW may import main.js (see ADR-XXXX)',
  severity: 'error',
  from: { pathNot: '^src/main\\.js$' },
  module: { path: '^src/main\\.js$', numberOfDependentsMoreThan: /* pin at today's count */ 0 },
}
```

DOM-freedom is a *global* concern, not just imports — a `document.querySelector` inside `src/core` has no import edge. Pair the cruiser rule with an ESLint environment restriction on the same folder:

```jsonc
// .eslintrc.json override
{ "files": ["src/core/**/*.js"],
  "env": { "browser": false },
  "globals": { "document": "off", "window": "off", "HTMLElement": "off" },
  "rules": { "no-restricted-globals": ["error", "document", "window", "navigator"] } }
```

(Real-world worked examples of this rule style: Atomic Object's dependency-cruiser writeup and Xebia's "Taking Frontend Architecture Serious with Dependency-cruiser".)

### 2b. eslint-plugin-boundaries (editor feedback)
Same intent, but violations show as red squiggles the moment you (or an agent) type the import — much shorter feedback loop than CI. Element-based model:

```js
settings: {
  'boundaries/elements': [
    { type: 'core',      pattern: 'src/core/*' },
    { type: 'events',    pattern: 'src/events/*' },
    { type: 'rendering', pattern: 'src/rendering/*' },
    { type: 'themes',    pattern: 'src/themes/*' },
    { type: 'ui',        pattern: 'src/ui/*' },
    { type: 'utils',     pattern: 'src/utils/*' },
  ],
},
rules: {
  'boundaries/element-types': [2, {
    default: 'disallow',
    rules: [
      { from: ['core'],      allow: ['core', 'events', 'utils'] },          // headless island
      { from: ['events'],    allow: ['events', 'utils'] },
      { from: ['rendering'], allow: ['rendering', 'core', 'events', 'utils'] },
      { from: ['themes'],    allow: ['themes', 'rendering', 'events', 'utils'] },
      { from: ['ui'],        allow: ['ui', 'core', 'events', 'utils'] },
    ],
  }],
}
```

`default: 'disallow'` gives allowlist semantics: any edge you didn't bless is an error. That's the right polarity for governance (new categories of dependency require an explicit decision — pair with an ADR, §6).

### 2c. ts-arch / ArchUnitTS (architecture-as-tests)
ArchUnit-style fluent assertions inside your existing Vitest suite:

```ts
import { filesOfProject } from 'tsarch';
it('core does not depend on ui', async () => {
  const rule = filesOfProject().inFolder('src/core')
    .shouldNot().dependOnFiles().inFolder('src/ui');
  await expect(rule).toPassAsync();
});
it('core is cycle free', async () => {
  await expect(filesOfProject().inFolder('src/core').should().beFreeOfCycles()).toPassAsync();
});
```

Nice property: rules live next to tests and run under `npm test` with no new CI step. But it duplicates what dependency-cruiser does with weaker diagnostics (no graph viz, slower on big projects, jest/vitest timeouts on 600+ files). **Verdict for this repo: skip ts-arch initially**; adopt only if you want boundary rules colocated with the Vitest suite instead of a second config file. arch-unit-ts / ts-arch-unit are smaller-community alternatives — same call.

### Pitfalls / not worth it at this scale
- **Running both tools with divergent rule sets.** Keep dependency-cruiser as truth; mirror only the top 3–4 rules into eslint-plugin-boundaries.
- **Enforcing `no-circular` as `error` on day one** — you'll get hundreds of legacy violations and turn the gate off. Use `warn` + count-ratchet (§5) to drain them.
- **Over-granular element types.** Six layers is plenty; per-feature micro-boundaries (Nx-style tags, module federation) are team-scale machinery.
- **Dynamic imports/global registries evade static analysis** — the playground auto-registration (`src/playground/effects/*.effect.js`) and theme registry patterns will show as orphans or missed edges; use `pathNot` carve-outs rather than weakening rules globally.

**Sources:** dependency-cruiser rules reference (https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md); eslint-plugin-boundaries (https://github.com/javierbrea/eslint-plugin-boundaries); ts-arch (https://github.com/ts-arch/ts-arch); ArchUnitTS (https://github.com/LukasNiessen/ArchUnitTS); Atomic Object on restricting imports (https://spin.atomicobject.com/dependency-cruiser-imports/); Xebia frontend-architecture writeup (https://xebia.com/blog/taking-frontend-architecture-serious-with-dependency-cruiser/).

---

## 3. Strangler fig + branch by abstraction for god-class decomposition

### The practice
- **Strangler fig** (Fowler, 2004, https://martinfowler.com/bliki/StranglerFigApplication.html): grow the new system around the old until the old is unused, then delete it. Operates at system/subsystem boundaries.
- **Branch by abstraction** (Fowler, https://martinfowler.com/bliki/BranchByAbstraction.html; Jez Humble, https://continuousdelivery.com/2011/05/make-large-scale-changes-incrementally-with-branch-by-abstraction/): the in-codebase version. Five steps: (1) insert an abstraction layer in front of the thing being replaced; (2) migrate all callers to the abstraction; (3) build the new implementation behind the same abstraction; (4) swap implementations incrementally; (5) delete the old one (and optionally the abstraction). Core commitment: *"Ensure that the system builds and runs correctly at all times, so you can continue to use Continuous Delivery while you are doing the replacement."*

### The Shopify case study (god-class specific)
Shopify's `Shop` model — 3,000+ lines, textbook God Object — was decomposed with an explicit strangler-fig recipe (https://shopify.engineering/refactoring-legacy-code-strangler-fig-pattern): (1) define a new narrow interface for one responsibility; (2) redirect every caller from the god class to the new interface (which initially still delegates to the legacy internals); (3) create the new data source/state; (4) dual-write old+new; (5) backfill; (6) switch reads to new; (7) delete the legacy path. Their stated reason for incremental over big-bang: the old system stays intact as a safety net, changes are "monitored at all times," and breakage odds stay low. Their prerequisite: *good test coverage in place first* (→ §4), and *start with a smaller extraction to learn the pattern*.

### Concrete application to Serenity Blocks
The god classes are known: `main.js` (6,180 lines — app orchestration + settings + theme switching + UI glue), `OdysseyMode.js` (5,834 — mode logic + inline modals + level lifecycle), `ffa-p2p-game-state.js` (5,116), and the 5–10k-line theme megafiles. Adaptation (no dual-write/backfill needed — that part of Shopify's recipe is for persisted data; your equivalent is save-file/settings schema stability):

1. **Pick ONE responsibility, not one class.** E.g., extract "modal management" from `OdysseyMode.js` (memory notes the live modals are inline and `LevelResultsModal.js` is dead — that's the strangler seam telling you where to grow).
2. **Define the seam as an interface/facade module** (`src/core/game-modes/odyssey/modals.js`) whose first implementation just delegates to the existing inline code. Zero behavior change, shippable immediately.
3. **Redirect callers one call-site per commit.** Trunk-based: every commit green (`npm test` + `typecheck` + dependency gates).
4. **Rewrite behind the facade** once all callers go through it; delete the inline legacy.
5. **Lock the win with a fitness function**: after extraction, add a dependency-cruiser rule or file-size ratchet so the god class can't reabsorb the responsibility — and pin the god file's dependent count with `numberOfDependentsMoreThan` (§2a) so no new code couples to it mid-strangle.
6. For **theme megafiles**, the seam is different: they're mostly *construction* code. Decompose along lifecycle phases already implied by the codebase conventions (`createScene` / update loop / quality tiers / post chain) into per-subsystem modules under `src/themes/<id>/` — and use the playground harness as the characterization test (screenshot A/B, §4), since unit tests can't see shader output.
7. **`main.js`** is the highest-leverage strangler target because everything routes through it; extract by subscription — you already have `src/events/`; move logic out by having `main.js` publish events and new modules subscribe, shrinking `main.js` toward a bootstrapper.

### Pitfalls / not worth it at this scale
- **The abstraction layer left in place forever.** For solo code, Fowler's optional step 5b (remove the abstraction) matters: an indirection layer with a single implementation is pure tax. Delete facades once migration completes unless they earn their keep (e.g., WebGL/WebGPU dual paths, which are a *legitimate* permanent branch-by-abstraction already present in the codebase).
- **Parallel-run/dual-write machinery** (Shopify steps 4–5) is overkill for in-memory game state; only the save-data schema deserves that care.
- **Strangling everything at once.** Multiple concurrent half-done extractions is worse than one god class. One seam at a time, finished (deleted legacy) before the next.
- **Big-bang temptation with AI agents.** Agents make a 5,000-line rewrite *feel* cheap; the review burden and regression risk still scale with diff size. Keep agent-driven refactors inside the strangler discipline: one seam, callers redirected mechanically, characterization tests green before/after.

**Sources:** Fowler strangler fig (https://martinfowler.com/bliki/StranglerFigApplication.html); Fowler branch by abstraction (https://martinfowler.com/bliki/BranchByAbstraction.html); Humble, Continuous Delivery blog (https://continuousdelivery.com/2011/05/make-large-scale-changes-incrementally-with-branch-by-abstraction/); Shopify engineering (https://shopify.engineering/refactoring-legacy-code-strangler-fig-pattern); trunkbaseddevelopment.com (https://trunkbaseddevelopment.com/branch-by-abstraction/).

---

## 4. Characterization / golden-master (approval) testing before refactors

### The practice
Coined by Michael Feathers (*Working Effectively with Legacy Code*): before refactoring untested code, write tests that pin down what it *does now* (not what it should do). Capture output for a wide spread of inputs, store it as the "golden master," and diff on every change. Approval testing (approvaltests.com, Llewellyn Falco) and Jest/Vitest snapshot testing are the same idea with tooling. Nicolas Carlo's key clarifications (understandlegacycode.com): the hard part is getting the code under test at all; you need a good "Printer" (serializer that strips flaky data and formats output for human diffing); and these tests are **temporary scaffolding** — change detectors requiring human judgment, not a permanent suite.

### Why
It's the prerequisite the Shopify case study names for strangler work: refactoring without a behavioral safety net is just rewriting. For a solo dev the economics are great: characterization tests are cheap to generate (loop over seeds, snapshot the result) precisely because you *don't* have to decide what correct behavior is.

### Concrete application to Serenity Blocks
The simulation core is ideal golden-master territory — deterministic, pure-data in/out:

- **Board/pieces/scoring/garbage/physics** (`src/core/board.js`, `pieces.js`, `scoring.js`, `garbage.js`, `physics.js`): a Vitest characterization suite that runs N seeded piece-sequences through lock/clear/cascade/scoring and `expect(finalState).toMatchSnapshot()`. Vitest snapshots ARE approval tests — no new tooling needed. Write this **before** decomposing `game.js`/`OdysseyMode.js`, delete or promote-to-real-tests after.
- **Multiplayer protocol** (`ffa-p2p-game-state.js`, `src/core/network`): snapshot the serialized state/event stream for a scripted match. This doubles as wire-format drift detection — the exact "snapshot/event shape-drift risk" your tsconfig comment already flags.
- **Difficulty model** (`difficulty-model.js` from `levels.js` tags): snapshot the derived difficulty table for all levels; any refactor of the model shows as a reviewable table diff.
- **Visual/WebGPU code**: the golden master is a **screenshot**, and the repo already has the machinery (`capture:themes`, playground `?t=<seconds>` phase-locked captures, `perf:odyssey:compare`). Formalize: per-theme reference PNG at fixed time/seed/resolution; a refactor of a 10k-line theme file must produce a pixel-identical (or perceptual-diff-under-threshold, e.g. pixelmatch) capture. This is exactly the "byte-identical" discipline your perf reviews already practice ad hoc — turning it into a stored golden master makes theme-file decomposition safe.

Workflow per refactor: (1) generate characterization tests for the seam; (2) commit them; (3) refactor in small green commits; (4) any diff = stop and decide expected/bug; (5) after the refactor, keep only the snapshots that earn their keep as regression tests.

### Pitfalls / not worth it at this scale
- **Snapshot blindness** — Carlo's core warning: the failure mode is reflexively re-approving changed snapshots (`vitest -u`) without reading the diff, which silently converts your safety net into noise. Mitigate: keep snapshots small and semantically formatted (a board-grid ASCII printer beats a 500-line JSON blob), and never bulk-update.
- **Characterizing non-determinism.** Game code with `Math.random()`/`performance.now()` must be seeded/injected first — that seam-creation IS step one of the refactor. Don't snapshot timestamps, FPS, or entity iteration order.
- **Keeping them forever.** Hundreds of stale golden masters make every intentional behavior change (rebalancing scoring!) a snapshot-update slog. Treat as scaffolding; delete after the refactor lands.
- **Don't buy tooling.** ApprovalTests.js/Touca add approval-file workflows and reporters that Vitest snapshots already cover at this scale.

**Sources:** Feathers via Wikipedia (https://en.wikipedia.org/wiki/Characterization_test); understandlegacycode.com on regression vs characterization vs approval (https://understandlegacycode.com/blog/characterization-tests-or-approval-tests/); Codurance golden master (https://www.codurance.com/publications/2012/11/11/testing-legacy-code-with-golden-master); approvaltests.com; Duroni golden-master walkthrough (https://www.fabrizioduroni.it/blog/post/2018/03/20/golden-master-test-characterization-test-legacy-code).

---

## 5. Incremental TypeScript adoption at scale (+ ratchets)

### The practice & the case studies
Three well-documented strategies, in increasing big-bang-ness:

1. **Gradual file-by-file (Sentry, 2019–2021)** — https://blog.sentry.io/slow-and-steady-converting-sentrys-entire-frontend-to-typescript/: 18 months, 1,100 files / 95k LOC, dozen engineers. Convert files opportunistically + dedicated pushes; new code TS-only; track % typed over time; accept imperfect types early and refine as neighboring files convert. Outcome: measurable drop in shipped frontend bugs.
2. **Automated codemod, all-in (Airbnb ts-migrate)** — https://medium.com/airbnb-engineering/ts-migrate-a-tool-for-migrating-to-typescript-at-scale-cd23bfeb5cc, https://github.com/airbnb/ts-migrate: rename `.js→.ts`, run plugins, and paper over remaining errors with `@ts-expect-error` comments so the build is green day one; then burn down the suppressions. 50k-LOC projects converted in a day. Key insight: **suppressed-error burndown is itself a ratchet**.
3. **Big-bang codemod from an existing type system (Stripe, 2022)** — https://stripe.dev/blog/migrating-to-typescript: 3.7M lines Flow→TS in ONE pull request over a weekend, after months of codemod iteration. Not applicable here (requires an existing type system to translate), but instructive: the *ergonomic cliff* of living half-migrated for years is a real cost — they chose one weekend of pain over it.

**Ratchets** make gradual adoption safe: Betterer (https://dev.to/phenomnominal/stricter-typescript-compilation-with-betterer-dp7) snapshots the current violation count for a stricter-than-enforced config (e.g. `strict: true`) and fails CI only if the count *increases*; improvements auto-update the baseline. The generic pattern ("ratchets", https://www.dustyburwell.com/2019/05/29/ratchets) needs no framework: a script that counts errors and compares against a committed number.

### Concrete application to Serenity Blocks
You are already mid-flight with the right design — the tsconfig comment documents an opt-in `// @ts-check` harness scoped to `src/core` + `src/events`, "ratchet coverage by adding `// @ts-check` once a module is clean, then eventually flip checkJs to true." Research-backed refinements:

1. **Make the ratchet mechanical, not honor-system.** Right now nothing stops a `// @ts-check` pragma from being deleted. Add a ~30-line CI script: count pragma-bearing files under `src/core`+`src/events`, compare to a committed baseline (`.quality-ratchet.json`), fail on decrease, auto-bump on increase. Same script can ratchet `tsc --noEmit` error count once you flip `checkJs: true` (flip early with a big error baseline + ratchet, rather than waiting for "clean" — Airbnb's re-ignore step is exactly this).
2. **Betterer vs. hand-rolled:** Betterer gives you multi-metric ratchets (TS strict errors, ESLint rule counts, regex counts) in one framework with per-file baselines — but it's ~another dev-dependency with its own snapshot file and occasional merge friction. Solo verdict: **hand-rolled counter first**; adopt Betterer only if you find yourself wanting per-file granularity or 3+ simultaneous ratchets (plausible: ts-errors + cycles + file-size).
3. **Priority order matches your risk:** simulation core → network protocol/event buses (shape-drift) → `src/core/types.d.ts` shared contracts → UI last. Themes/TSL code last or never — Three.js node-material types are churny and the payoff is low vs. the pure-logic core. (Tornado theme is already TS — new themes could be TS-first.)
4. **JSDoc, not rename-to-.ts, for the JS bulk** — per the official handbook (https://www.typescriptlang.org/docs/handbook/intro-to-js-ts.html), `@ts-check` + JSDoc gives ~90% of the safety with zero build/import churn, which matters in a Vite+Electron setup with playground entry points. Convert to real `.ts` only files you're actively strangler-refactoring anyway (new extracted modules TS-first).
5. **Don't do the Airbnb all-in codemod.** ts-migrate's value proposition is org-level consistency for hundreds of engineers; for one person it generates thousands of `@ts-expect-error` suppressions and `any`s you'll then live with forever. Sentry's slow-and-steady + your pragma ratchet is the right model. (ts-migrate is also effectively archived/low-maintenance now.)

### Pitfalls / not worth it at this scale
- **`any`-laden "converted" files** create false confidence — a typed signature lying about an `any` payload is worse than untyped. Ratchet `no-explicit-any`/`typeCoverage` later if this bites.
- **Chasing `strict: true` globally too early** — flip strict flags one at a time (`noImplicitAny` → `strictNullChecks`) under the ratchet, or the error count is so large the signal drowns.
- **Type gymnastics for TSL/Three.js internals** — skip; runtime screenshot validation is the actual safety net there (§4).
- **Two half-ratchets** (pragma-count AND error-count AND betterer) tracking overlapping things — pick one number per concern or you won't trust any of them.

**Sources:** Sentry (https://blog.sentry.io/slow-and-steady-converting-sentrys-entire-frontend-to-typescript/); Airbnb ts-migrate (https://medium.com/airbnb-engineering/ts-migrate-a-tool-for-migrating-to-typescript-at-scale-cd23bfeb5cc, https://github.com/airbnb/ts-migrate); Stripe (https://stripe.dev/blog/migrating-to-typescript); Betterer (https://dev.to/phenomnominal/stricter-typescript-compilation-with-betterer-dp7, https://charpeni.com/blog/enforce-best-practices-incrementally-with-betterer); ratchet pattern (https://www.dustyburwell.com/2019/05/29/ratchets); TS handbook JS projects (https://www.typescriptlang.org/docs/handbook/intro-to-js-ts.html).

---

## 6. ADR practice (adr-tools, MADR)

### The practice
An Architecture Decision Record captures one significant decision: context, decision, consequences (Michael Nygard's original: https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions; Fowler bliki: https://martinfowler.com/bliki/ArchitectureDecisionRecord.html). Kept as numbered markdown files in-repo (`docs/adr/0001-*.md`), immutable once accepted (superseded, never edited into lies). Tooling: `adr-tools` (bash, Nygard format) or the MADR template (https://adr.github.io/madr/), which adds explicit *decision drivers* and *considered options with pros/cons* — its distinctive contribution is making **rejected alternatives first-class**.

"Keeping ADRs honest": the Consequences section must contain the *negative* consequences alongside positive ones (Nygard deliberately merges them); an ADR that reads like advocacy is worthless. ADRs stay honest when they're written *at decision time* (not archaeologically), when superseding is cheap and normal, and when a CI-checked artifact references them (e.g., a dependency-cruiser rule's `comment: 'see ADR-0007'` — the fitness function enforces, the ADR explains).

### Why — and the solo-dev twist
Solo, the audience is future-you **and your AI agents**. Six months from now, neither you nor Claude will remember *why* themes are forbidden from importing each other, or why `useMRT:false` is load-bearing on Windows, or why quality reads `window.settings.graphicsQuality` and not the seeded key. This project has already independently evolved ADR substitutes: the memory system, 40+ `docs/*_PLAN.md` files, and the remarkable multi-paragraph *comment in tsconfig.json* explaining the typecheck strategy. That tsconfig comment IS an ADR — it just lives somewhere undiscoverable.

### Concrete application to Serenity Blocks
1. **Adopt MADR-lite in `docs/adr/`** — but only for *decisions that constrain future work*, not designs. The existing plan docs answer "what are we building"; ADRs answer "what will we refuse to do and why." Candidate backfills (each ~15 minutes): opt-in `@ts-check` ratchet strategy (move the tsconfig comment there, link back); layer rules for src/core headlessness (paired with the §2 rules); one-theme-one-folder isolation; WebGL fallback policy per feature; relative-not-absolute asset URLs in Electron (a memory note today — it's really an ADR); "bespoke theme code-gen pipeline REMOVED, don't rebuild" (explicitly recorded as a don't-do decision — the highest-value ADR genre for agent-assisted development).
2. **Template: trimmed MADR** — Context / Decision drivers / Options considered (1 line each) / Decision / Consequences (good AND bad) / status+date. Skip decision-makers/consulted/informed fields — meaningless solo.
3. **Skip adr-tools** — it's bash scripts for numbering files; on Windows, a `docs/adr/template.md` you copy by hand is less friction.
4. **Wire ADRs to enforcement**: every `error`-severity dependency-cruiser rule cites its ADR number in `comment:`. That's the honesty mechanism — a rule with no ADR invites deletion; an ADR with no rule invites violation.
5. **Point agents at them**: reference `docs/adr/` from CLAUDE.md so agents load the constraint set before large refactors.

### Pitfalls / not worth it at this scale
- **ADR sprawl** — writing one per feature turns them into unread changelogs. Threshold: "would violating this silently cost me a day?" If no, it's a code comment.
- **Editing accepted ADRs** to match drifted reality — supersede instead, or the record teaches you nothing.
- **Heavy templates/status workflows** (proposed→accepted→review boards, four-role RACI front matter) — team ceremony, zero solo value.
- **ADRs vs. your memory system:** memory files are session-scoped working knowledge and can be lossy; ADRs are the small permanent constitutional layer, in-repo, versioned with the code they govern. Don't merge the two.

**Sources:** Nygard (https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions); Fowler bliki (https://martinfowler.com/bliki/ArchitectureDecisionRecord.html); adr.github.io + MADR (https://adr.github.io/, https://adr.github.io/madr/); adr-tools (https://github.com/npryce/adr-tools); ADR example collection (https://github.com/architecture-decision-record/architecture-decision-record).

---

## 7. Trunk-based development + feature flags for long refactors, solo

### The practice
Trunk-based development (https://trunkbaseddevelopment.com/): everyone commits to main, in small always-green increments; long-lived branches are the enemy because they defer integration pain. Feature flags decouple *deploy* from *release* so incomplete work can merge dark. Pete Hodgson's canonical taxonomy (https://martinfowler.com/articles/feature-toggles.html): **Release toggles** (days–weeks, then DELETED), experiment toggles, ops toggles/kill-switches (may be permanent), permission toggles. Hygiene rules from Hodgson: flags are "inventory with a carrying cost"; add a removal task the day you add the flag; put **expiration dates** on flags — even "time bombs" that fail a test/refuse startup past expiry; cap total active flag count (remove one to add one). Uber automated stale-flag deletion at scale with Piranha (https://github.com/uber/piranha). Knight Capital's $460M loss via repurposed dead-flag code is the standard cautionary tale.

### Why — and what changes solo
Solo, you *are* already trunk-based by default (no one to merge with), but long refactor branches still hurt: they go stale against your own rapid main-line commits (this repo ships many perf commits per day), they block shipping fixes, and they rot when a session is abandoned. The branch-by-abstraction pattern (§3) exists precisely so the refactor lives *on main*, dark, behind a toggle or an unused-new-path.

### Concrete application to Serenity Blocks
The codebase already has an organic flag idiom: **URL params** (`?noBootWarp=1`, `?odysseyKeepBoard=0`, `?odysseyAAA=1`) and settings-gated paths. Governance is about tightening what exists:

1. **One flag registry module** (`src/core/flags.js`): every flag declared with name, default, purpose, **owner-date and expiry-date**. Grep-ability is the point — today flags are scattered string literals in URL-parsing code.
2. **Expiry as a fitness function**: a Vitest test iterates the registry and fails when `Date.now() > expiry` — Hodgson's "time bomb," 10 lines. On failure you consciously extend (new date, one-line diff = auditable) or delete the flag. This is the single highest-value flag practice for a solo dev, because nobody else will ever nag you.
3. **Refactor flags are Release toggles**: when strangling `OdysseyMode.js` or a theme megafile, land the new path dark behind a registry flag, default off; flip default when validated (screenshot golden master, §4); **delete flag + legacy path within ~2 weeks of flip**. Note the pattern already used well: `odysseyKeepBoard` default-ON with `=0` revert is exactly "flip default, keep revert lever briefly."
4. **Distinguish permanent switches from refactor flags** in the registry: WebGL-vs-WebGPU fallback, quality tiers, a11y gates are *ops/permission-style permanent config* — exempt from expiry but still declared. The expiring kind is only "old path vs new path during a migration."
5. **Branch policy**: feature branches ≤ a few days are fine (this repo's `cleanup/repository-files` style); anything you can't finish in a week goes behind a flag on main instead. Never let a refactor branch span a rebase against 50 of your own commits.

### Pitfalls / not worth it at this scale
- **A flag-management SaaS (LaunchDarkly/Unleash/DevCycle) is absurd here** — runtime targeting, percentage rollouts, and dashboards serve fleets of users; a desktop game with local settings needs a JS object.
- **Flag interaction explosion**: two overlapping refactor flags = 4 code paths to keep working; your combinatorial test surface doubles per flag. Enforce "≤2 active refactor flags" as policy.
- **Dead flags left as booby traps** (Knight Capital lesson): deleting the flag means deleting the *legacy code path too*, not just hardcoding the flag true.
- **Uber-Piranha-style automated flag cleanup** — org-scale tooling; your registry + expiry test replaces it.

**Sources:** Hodgson on martinfowler.com (https://martinfowler.com/articles/feature-toggles.html); trunkbaseddevelopment.com (https://trunkbaseddevelopment.com/, https://trunkbaseddevelopment.com/branch-by-abstraction/); Unleash flag best practices (https://docs.getunleash.io/guides/feature-flag-best-practices); Uber Piranha (https://github.com/uber/piranha).

---

## 8. Mutation testing (Stryker) — worth it for game logic?

### The practice
Mutation testing (StrykerJS, https://stryker-mutator.io/) seeds small code mutations (`<` → `<=`, `+` → `-`, delete statement) and re-runs your tests; surviving mutants = code your tests execute but don't actually *assert about*. It measures test **effectiveness**, where line coverage only measures test **execution**. StrykerJS has a first-class **Vitest runner** and, critically for cost, **incremental mode** (`--incremental`): results cached in `reports/stryker-incremental.json`, only changed mutants/tests re-run (documented example: 3,731 of 3,965 mutant results reused). Caveat: with Vitest the change detection granularity is per-test-file, not per-test.

### Verdict for this game: yes, narrowly — as an audit tool, not a gate
Honest cost/benefit:

**Where it pays:** the deterministic simulation core is the *best possible* substrate for mutation testing — pure functions, fast tests, and exactly the kind of boundary-condition logic (`scoring.js`, `garbage.js`, `board.js` line-clear/cascade, `physics.js`, anti-cheat validation, difficulty-model tier math) where an off-by-one survives playtesting for months. Before refactoring these files, a mutation run tells you whether your characterization suite (§4) would actually catch a behavior change — it is a **fitness function for your safety net**, which is precisely the governance question during god-class decomposition. Snapshot/golden-master tests tend to score *well* here (any behavior change diffs the snapshot), so the two practices compound.

**Where it doesn't:** themes, rendering, TSL, UI, Electron shell — mutants there are invisible to unit tests by construction (the observable output is pixels); you'd get a wall of survived mutants that mean nothing. Multiplayer netcode is middle-ground: protocol serialization tests benefit; timing/transport logic doesn't. And wall-clock cost is real: mutation runs are O(mutants × test-time); a 600-file unscoped run would take hours.

### Concrete application
```jsonc
// stryker.config.json
{
  "testRunner": "vitest",
  "incremental": true,
  "mutate": [
    "src/core/scoring.js", "src/core/board.js", "src/core/garbage.js",
    "src/core/pieces.js", "src/core/physics.js",
    "src/core/odyssey/data/difficulty-model.js",
    "src/core/validation/**/*.js"
  ],
  "thresholds": { "high": 85, "low": 70, "break": null } // report, don't break
}
```
Run cadence: **manually, before and after each core-module refactor** (and optionally monthly). Not in per-commit CI. Use the HTML report to add the 5–10 missing assertions it reveals, then move on. `break: null` is deliberate — a mutation-score CI gate is team-scale discipline theater; solo, the value is the survived-mutant *list*, not the number.

### Pitfalls / not worth it at this scale
- **Whole-repo mutation runs** — hours of compute for mostly-meaningless survivors in rendering code. Scope `mutate` to the pure core, always.
- **Chasing 100% mutation score** — the last survivors are usually equivalent mutants (mutations with no observable behavior change); killing them wastes days.
- **Per-commit CI gating** — even incremental mode makes commits minutes slower, and Vitest's coarse per-file change detection inflates re-runs; keep it out of the hot path.
- **Running it before you have the characterization suite** — mutation testing evaluates tests; with thin tests it just tells you "you have thin tests," which you already know.

**Sources:** StrykerJS (https://stryker-mutator.io/, https://github.com/stryker-mutator/stryker-js); incremental mode docs (https://stryker-mutator.io/docs/stryker-js/incremental/); Sparkbox intro (https://sparkbox.com/foundry/mutation_testing_with_stryker).

---

## Synthesis: a minimal governance stack for this project

Ordered by value-per-maintenance-hour for a solo dev with AI agents:

| # | Practice | Tool | Cadence | Cost |
|---|----------|------|---------|------|
| 1 | Boundary rules (core headless, themes isolated, no renderer→electron) | dependency-cruiser (CI truth) + eslint-plugin-boundaries (editor) | every commit | 1 day setup, ~0 ongoing |
| 2 | Ratchets: `@ts-check` file count up-only; tsc-error & cycle counts down-only; god-file line counts shrink-only | ~50-line script + committed baselines (Betterer only if this outgrows it) | every commit | half day |
| 3 | Characterization suite (Vitest snapshots for sim core + protocol; screenshot golden masters for themes) | Vitest + existing capture scripts | before/after each refactor | grows with refactors |
| 4 | Strangler-fig discipline: one seam at a time, facade first, callers redirected, legacy deleted, win locked by a rule | process (+ §7 flags) | per refactor | 0 tooling |
| 5 | Flag registry + expiry time-bomb test | one module + one test | every commit | hours |
| 6 | MADR-lite ADRs for constraints, cross-linked from cruiser rules and CLAUDE.md | markdown | per decision | minutes each |
| 7 | Mutation audit of core before big core refactors | StrykerJS incremental, scoped `mutate` | manual, pre-refactor | hours per run |

**Explicitly NOT worth it at this scale:** fitness-function platforms/dashboards; ts-arch alongside dependency-cruiser; Airbnb-style all-in ts-migrate codemod; Stripe-style big-bang conversion; approval-testing frameworks beyond Vitest snapshots; adr-tools; flag-management SaaS; Piranha-style flag automation; whole-repo or CI-gated mutation testing; per-feature micro-boundaries (Nx tags); ADR RACI/status ceremony; parallel-run/dual-write for in-memory state.
