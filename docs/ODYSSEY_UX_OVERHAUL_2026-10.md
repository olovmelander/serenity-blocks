# Odyssey UX overhaul (2026-10-18)

Status: Reference. The record of one session's answer to the Odyssey audit
(`ODYSSEY_UX_AUDIT_2026-10-17`, kept in the session scratchpad; its ten findings are
restated below with what changed). Eight commits on `ccr-e2e07e06-hg3pbp`, each one package,
each with tests. Read this before touching the campaign order, the save format, charms, the
map's input, or the completion sequence.

## What changed, by finding

| Finding | What the game does now | Where |
|---|---|---|
| Boards without a minimap on scrolling wells | Every well taller than the 20 visible rows is a tall board: tower layout and minimap. One threshold, `ODYSSEY_VISIBLE_ROWS + 1`, shared by the mode and the layout. | `core/odyssey/odyssey-board-shape.js`, `OdysseyMode`, `ui/odyssey/odyssey-board-layout.js` |
| Duels mid-chapter, first to seven | Every chapter ends on its rival. Duels are a race to **three knockouts** on two empty wells at the chapter's own pace (`getOdysseyDuelGravity`); stars are win / at most one top-out / no top-outs. Whole orbs were reordered (identity intact), so the save moved to **v5** with a frozen v4→v5 id table and chapter-scoped unlock fill; Steam board names bumped (`OdysseyTotalStars_v3`, `OdysseyLevelTime_v4_`). `boardSeedId` keeps each orb's opening garbage. | `core/odyssey/data/{campaign-order,duel-rules,levels,chapters}.js`, `odyssey-progress-schema.js`, `steam-config.js` |
| Stars you cannot earn or understand | Mastery orbs retuned (`MASTERY_RETUNE`), chain goals harmonised so one metric is never asked twice. The map panel lists the goal, all three star goals, what changes from the orb before, the tip and how a locked orb opens. The ceremony and results mark each star goal earned or not and name the next star's shortfall in the player's numbers. | `ui/odyssey/{odyssey-level-panel,odyssey-star-notes,objective-copy}.js` |
| Two vocabularies, an off-tone one | Orb everywhere (Level only in developer logs), Goal, Map, knockouts and top-outs, Rival. All 35 shouting tips and descriptions rewritten in the ceremony's register; the false "keep playing after the goal" sentence removed from the 56 orbs that end at the goal. | `levels.js`, HUD, results, failure, briefing, records, menu |
| No onboarding, thin pause, no reset | A fresh journey is welcomed by the Chapter 1 arrival with a four-line orientation (once per journey, remembered in the save). The pause sheet offers **Retry orb** and **Back to map** while an orb is in progress and names the orb. The navigator offers **Start a new journey** as a two-step reset that keeps earned themes. | `ui/odyssey/{odyssey-first-arrival,odyssey-pause-actions,odyssey-new-journey,odyssey-navigator-list}.js`, `settings.js`, `index.html` |
| Hard walls, skip-after-three-failures wanted | **Charms** (below): a draft of three at every chapter's arrival and as the road's mercy after the third fall on one orb; take one and keep it for the rest of the road. | `core/odyssey/{odyssey-charms,odyssey-charm-effects}.js`, `core/seeded-stream.js`, `ui/odyssey/{JourneyFlowOverlay,FailureModal,odyssey-first-arrival}.js` |
| Map without keys or pad; locked orbs inert; no duel markers | Arrows and the D-pad step orbs, Up/Down jump chapters, Home/End, Enter/A plays. Locked orbs hover and open a read-only panel. Rival duels and chapter bosses wear a marker under the orb. | `ui/odyssey/odyssey-map-input.js`, `rendering/odyssey/LevelNodeManager.js`, `gamepad-controller.js` |
| Completion cut straight to a sheet | The goal plays the theme's showpiece reel (quad, six-wave cascade, perfect clear, from the Serenity catalogue, re-timed to about 1.5 s); the ceremony dims in through its afterglow. | `ui/odyssey/{odyssey-showpiece,odyssey-goal-flourish}.js`, `odyssey-flow.css` |

## Charms: picked at the road's waystones, kept for the rest of the road

- **The shape.** A charm is Waystones' charm (`core/waystones/charms.js`: id, name, kind, one
  line): a passive taken once and kept. Odyssey's catalogue is its own, eight charms of three
  kinds (`ODYSSEY_CHARMS`):
  - *Score.* **Kindle** (a cascade two waves deep or more scores half again), **Swell** (a triple
    or quad scores 40% more), **Afterglow** (a perfect clear pays 1,500 more). Paid after each
    lock's cascade settles, exactly as Waystones pays them (`wrapOdysseyCharmCallbacks`); never
    in a duel, whose score is its own.
  - *Goal.* **Keel** (every orb asks 15% less; a cascade or chain goal one fewer; the star tier
    that mirrors the goal follows it), **Long Breath** (a timed orb gives thirty more seconds),
    **Still Air** (pieces fall a quarter slower on every orb, `mechanics.speed.paceFactor`,
    through every level-up; the duel's human well only), **Low Tide** (every orb begins with two
    fewer rows of rubble). Written into the orb before the engine is configured
    (`applyOdysseyCharmsToLevel`), so the HUD, the map panel and the briefing describe the orb
    as it will be played.
  - *Safety.* **Hearth** (once an orb, a top-out empties the well and play goes on; in a duel the
    rival gets no knockout, `OdysseyBotMatch.topOutGuard`).
- **Gathering.** Drafts of three, take one or pass. At every chapter's arrival: the chapter
  flow's arrival, the fresh journey's Chapter 1 welcome, or, when the player left the ceremony
  for the map first or the save predates charms, the arrival returns on the map as "the road
  offers a charm" (`presentOdysseyArrival`, `_offerPendingArrival`). And the road's mercy: a
  draft on the failure sheet after the third fall on one orb (`ODYSSEY_MERCY_FALLS`), offered on
  every fall after until taken or passed. Begin chapter and Map wait until a draft is settled
  (Waystones' precedent). A charm is never offered twice; drafts are seeded by the journey
  (`core/seeded-stream.js`, the stream Waystones' road draws from), so a draft offers the same
  three however often it is looked at.
- **No price.** Charms are legitimate: an orb cleared with charms holds its stars and its
  leaderboard time; the results sheet and the Steam details record which charms were held. The
  challenge is kept by the draft's scarcity (eight charms, one per chapter, one per three falls
  on an orb) and by the catalogue's restraint (a 15% ease, thirty seconds, a quarter slower,
  one saved top-out).
- **Why this shape.** A skip-after-three-failures would make the wall vanish. The first answer
  on this branch, consumable gems spent mid-orb, taxed every orb with a tray, three keys and a
  one-star penalty. A kept charm is a decision made at a rest, read once and felt everywhere
  after; the mercy draft turns a wall into a choice without erasing it.
- **Implementation notes.** Charm state lives in the save, additive to v5
  (`charms: { seed, owned, drafts, falls }`, normalised on load; a save without it draws a
  fresh seed). `prepareLevelStart` derives the played orb from the authored one and keeps the
  authored identity for its own cancellation check. Hearth's well rewrite goes through
  `restoreBoardState` (the replay boundary), so the grid, caches and the Infinity camera stay in
  step. The first arrival mark (`onboarding.arrivalSeen`) rides on the next save rather than
  forcing one, so read-only experimental sessions never write the campaign file.

## Decisions not to re-litigate

- Duels end chapters by **reordering whole orbs** (not swapping gameplay into other orbs), so
  every orb keeps its theme, name and copy; the cost was a save migration (v5), which is
  frozen in `odyssey-progress-schema.js` with tests.
- Three knockouts, not seven: the audit found seven turned a mid-chapter orb into a wall; at
  the chapter's end, at the chapter's pace, three is a climax that a bot of that skill can
  still take from you.
- Star notes trust the engine's star count and never invent a shortfall from a metric the
  attempt did not report (`met: null`).
- The orb panel is rendered by id from `renderOdysseyLevelPanel`; OdysseyMode only selects.

## Verification

- `npx vitest run`: 1006 files, 18868 tests, all passing at the charm commit.
- `npx tsc --noEmit` clean; `npm run check:boundaries` clean; `npm run build` (boot closure OK);
  `check:ip-strings` and `check:palette` OK.
- Lint ratchet lowered 599 → 574 (`lint-ratchet.json`).
- Architecture fitness: `lines:OdysseyMode` 4397 → 4372 (baseline lowered to 4372); the other
  baselines that shrank with the `origin/main` merge were locked in.

## Not verified here, needs a GPU machine

- The rival and boss **markers** on the map (`LevelNodeManager`): billboards built exactly like
  the lock and star indicators, but this environment has no WebGPU and the chrome-devtools
  server did not connect, so no screenshot exists. Check placement under the orb at the
  chapters' different camera angles and the near-lens fade.
- The **showpiece reel** per theme: every theme plays the default reel. `ODYSSEY_THEME_SHOWPIECES`
  is the place to give a theme its strongest reaction (ids from `serenity-effects.js`); tune in
  the playground (`?effect=<id>`) with screenshots.
- The **afterglow** ceremony entrance, the charm cards on the arrival and the failure sheet
  (`.ody-charm`, `.sb-ody-charm`) and the charm chips in the HUD column.

## Follow-ups worth doing

- Steam achievement or stat for charms taken (the owned list is in the save; `_syncSteamStats`
  is the hook; the results already send `charms`).
- Curated drafts per chapter (today a draft is drawn at random from what remains, seeded by
  the journey), and a charm the map could name on hover.
- Cloud sync already carries the v5 save; the Steam Cloud test suite passes unchanged.
