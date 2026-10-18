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
| Hard walls, skip-after-three-failures wanted | **Charms** (below): each chapter's arrival offers three charms authored for its road, and after the third fall on one orb the road offers the charms that would ease that orb; what is taken is gathered for the whole journey, and three are carried onto an orb, chosen on the map. | `core/odyssey/{odyssey-charms,odyssey-charm-effects}.js`, `ui/odyssey/{odyssey-charm-carry,odyssey-level-panel,JourneyFlowOverlay,FailureModal,odyssey-first-arrival}.js` |
| Map without keys or pad; locked orbs inert; no duel markers | Arrows and the D-pad step orbs, Up/Down jump chapters, Home/End, Enter/A plays. Locked orbs hover and open a read-only panel. Rival duels and chapter bosses wear a marker under the orb. | `ui/odyssey/odyssey-map-input.js`, `rendering/odyssey/LevelNodeManager.js`, `gamepad-controller.js` |
| Completion cut straight to a sheet | The goal plays the theme's showpiece reel (quad, six-wave cascade, perfect clear, from the Serenity catalogue, re-timed to about 1.5 s); the ceremony dims in through its afterglow. | `ui/odyssey/{odyssey-showpiece,odyssey-goal-flourish}.js`, `odyssey-flow.css` |

## Charms: gathered along the road, three carried at a time

- **The shape.** A charm is a passive taken once and kept: an id, a name, a kind and one
  line. Odyssey's catalogue is its own, eight charms of three
  kinds (`ODYSSEY_CHARMS`):
  - *Pays points.* **Kindle** (a cascade two waves deep or more scores half again), **Swell** (a
    triple or quad scores 40% more), **Afterglow** (a perfect clear pays 1,500 more). Paid after
    each lock's cascade settles (`wrapOdysseyCharmCallbacks`);
    never in a duel, whose score is its own.
  - *Eases the ask.* **Keel** (every orb asks 15% less; a cascade or chain goal one fewer; the
    star tier that mirrors the goal follows it), **Long Breath** (a timed orb gives thirty more
    seconds), **Still Air** (pieces fall a quarter slower on every orb,
    `mechanics.speed.paceFactor`, through every level-up; the duel's human well only), **Low
    Tide** (every orb begins with two fewer rows of rubble). Written into the orb before the
    engine is configured (`applyOdysseyCharmsToLevel`), so the HUD, the map panel and the
    briefing describe the orb as it will be played.
  - *Keeps you in.* **Hearth** (once an orb, a top-out empties the well and play goes on; in a
    duel the rival gets no knockout, `OdysseyBotMatch.topOutGuard`).
- **Authored, not drawn.** Odyssey is an authored campaign of sixty orbs, so its charms are
  authored too:
  - *Chapter offers.* Each chapter's arrival offers the three charms that suit its road
    (`ODYSSEY_CHAPTER_CHARMS`: the first chapter teaches the three kinds, the first deadline
    chapter offers Long Breath, the rubble chapters Low Tide, the fast ones Still Air). Charms
    already in the bag are left out and the offer is topped up from the catalogue, so an arrival
    offers three while charms remain and a pass is never a loss: every charm is offered in at
    least two chapters.
  - *The bag and the three slots.* What is taken is gathered for the whole journey; up to three
    (`ODYSSEY_CHARM_SLOTS`) are carried onto an orb. A taken charm is carried from that moment
    (the one carried longest is set down when the slots are full, and the sheet says so); the
    map panel shows the bag as carry toggles above the goal, and the goal, star goals and rules
    beneath them describe the orb as the carried charms make it, with a line naming any uncarried
    charm that would ease this orb and what it would do here. Without the slots, eight permanent
    charms would stack into an ease the late chapters were never authored for.
  - *The road's mercy.* After the third fall on one orb (`ODYSSEY_MERCY_FALLS`) the failure
    sheet offers the charms that would ease that very orb and are not yet gathered: its clock
    (Long Breath), its rubble (Low Tide), its ask (Keel), then Hearth and Still Air; a duel offers
    Hearth and Still Air alone. When the bag already holds what would help, the sheet says which
    charm and what it would do, and where to carry it. Offered on every fall after the third
    until taken or passed; never for a cleared orb.
  - *Arrivals.* The chapter flow's arrival, the fresh journey's Chapter 1 welcome, or, when the
    player left the ceremony for the map first or the save predates charms, the arrival returning
    on the map as "the road offers a charm" (`presentOdysseyArrival`, `_offerPendingArrival`).
    Begin chapter and Map wait until a draft is taken or passed.
- **No price.** Charms are legitimate: an orb cleared with charms holds its stars and its
  leaderboard time; the results sheet and the Steam details record which charms were carried.
  The challenge is kept by the slots (three at a time), the pace of gathering (one per chapter,
  one per three falls on an orb) and the catalogue's restraint (a 15% ease, thirty seconds, a
  quarter slower, one saved top-out).
- **Why this shape.** A skip-after-three-failures would make the wall vanish. The first answer
  on this branch, consumable gems spent mid-orb, taxed every orb with a tray, three keys and a
  one-star penalty. A kept charm is a decision made at a rest, read once and felt everywhere
  after; the mercy draft turns a wall into a choice without erasing it, and the slots keep the
  late road the climb it was written to be.
- **Implementation notes.** Charm state lives in the save, additive to v5
  (`charms: { gathered, carried, drafts, falls }`, normalised on load; a save that only names
  what was gathered carries the last three taken). `prepareLevelStart` derives the played orb
  from the authored one (`getCarriedCharms`) and keeps the authored identity for its own
  cancellation check. The mode's charm wiring (header line, panel toggles, what take and pass
  do, the mercy) lives in `ui/odyssey/odyssey-charm-carry.js`. Hearth's well rewrite goes
  through `restoreBoardState` (the replay boundary), so the grid, caches and the Infinity camera
  stay in step. The first arrival mark (`onboarding.arrivalSeen`) rides on the next save rather
  than forcing one, so read-only experimental sessions never write the campaign file.

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

- `npx vitest run`: 1007 files, 18883 tests, all passing at the charm-bag commit.
- `npx tsc --noEmit` clean; `npm run check:boundaries` clean; `npm run build` (boot closure OK);
  `check:ip-strings` and `check:palette` OK.
- Lint ratchet lowered 599 → 574 (`lint-ratchet.json`).
- Architecture fitness: `lines:OdysseyMode` 4397 → 4365 (baseline lowered to 4365); the other
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
- A controller way to carry and set down charms on the map (today the panel's toggles take the
  mouse or keyboard; a pad player carries the last three taken).
- Cloud sync already carries the v5 save; the Steam Cloud test suite passes unchanged.
