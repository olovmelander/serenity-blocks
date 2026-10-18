# Odyssey UX overhaul (2026-10-18)

Status: Reference. The record of one session's answer to the Odyssey audit
(`ODYSSEY_UX_AUDIT_2026-10-17`, kept in the session scratchpad; its ten findings are
restated below with what changed). Eight commits on `ccr-e2e07e06-hg3pbp`, each one package,
each with tests. Read this before touching the campaign order, the save format, gems, the
map's input, or the completion sequence.

## What changed, by finding

| Finding | What the game does now | Where |
|---|---|---|
| Boards without a minimap on scrolling wells | Every well taller than the 20 visible rows is a tall board: tower layout and minimap. One threshold, `ODYSSEY_VISIBLE_ROWS + 1`, shared by the mode and the layout. | `core/odyssey/odyssey-board-shape.js`, `OdysseyMode`, `ui/odyssey/odyssey-board-layout.js` |
| Duels mid-chapter, first to seven | Every chapter ends on its rival. Duels are a race to **three knockouts** on two empty wells at the chapter's own pace (`getOdysseyDuelGravity`); stars are win / at most one top-out / no top-outs. Whole orbs were reordered (identity intact), so the save moved to **v5** with a frozen v4→v5 id table and chapter-scoped unlock fill; Steam board names bumped (`OdysseyTotalStars_v3`, `OdysseyLevelTime_v4_`). `boardSeedId` keeps each orb's opening garbage. | `core/odyssey/data/{campaign-order,duel-rules,levels,chapters}.js`, `odyssey-progress-schema.js`, `steam-config.js` |
| Stars you cannot earn or understand | Mastery orbs retuned (`MASTERY_RETUNE`), chain goals harmonised so one metric is never asked twice. The map panel lists the goal, all three star goals, what changes from the orb before, the tip and how a locked orb opens. The ceremony and results mark each star goal earned or not and name the next star's shortfall in the player's numbers. | `ui/odyssey/{odyssey-level-panel,odyssey-star-notes,objective-copy}.js` |
| Two vocabularies, an off-tone one | Orb everywhere (Level only in developer logs), Goal, Map, knockouts and top-outs, Rival. All 35 shouting tips and descriptions rewritten in the ceremony's register; the false "keep playing after the goal" sentence removed from the 56 orbs that end at the goal. | `levels.js`, HUD, results, failure, briefing, records, menu |
| No onboarding, thin pause, no reset | A fresh journey is welcomed by the Chapter 1 arrival with a four-line orientation (once per journey, remembered in the save). The pause sheet offers **Retry orb** and **Back to map** while an orb is in progress and names the orb. The navigator offers **Start a new journey** as a two-step reset that keeps earned themes. | `ui/odyssey/{odyssey-first-arrival,odyssey-pause-actions,odyssey-new-journey,odyssey-navigator-list}.js`, `settings.js`, `index.html` |
| Hard walls, skip-after-three-failures wanted | **Gems** (below). | `core/odyssey/{odyssey-gems,odyssey-gem-effects}.js`, `ui/odyssey/odyssey-gem-input.js` |
| Map without keys or pad; locked orbs inert; no duel markers | Arrows and the D-pad step orbs, Up/Down jump chapters, Home/End, Enter/A plays. Locked orbs hover and open a read-only panel. Rival duels and chapter bosses wear a marker under the orb. | `ui/odyssey/odyssey-map-input.js`, `rendering/odyssey/LevelNodeManager.js`, `gamepad-controller.js` |
| Completion cut straight to a sheet | The goal plays the theme's showpiece reel (quad, six-wave cascade, perfect clear, from the Serenity catalogue, re-timed to about 1.5 s); the ceremony dims in through its afterglow. | `ui/odyssey/{odyssey-showpiece,odyssey-goal-flourish}.js`, `odyssey-flow.css` |

## Gems: the mercy that keeps the challenge

- **Earning.** Finishing an orb earns one gem; falling on it earns one gem. The wallet holds
  at most nine (`ODYSSEY_GEM_CAP`), so gems are spent, not hoarded. A fall that is retried
  from the pause sheet earns nothing (only a recorded attempt does).
- **Spending.** During an orb, keys `1` `2` `3` (or three spare controller buttons, never a
  gameplay binding) spend one gem on an ability, each ability once per attempt:
  - **Tide** sweeps the lowest four rows away. Nothing it clears counts toward the goal; it
    is refused mid-cascade, after a top-out, and over an empty floor (no gem spent).
  - **Still Air** gives twenty seconds of the slowest fall (1.5 s drops, following any
    level-up or duel round underneath); on a timed orb it adds thirty seconds to the deadline
    instead (evaluator `timeLimitBonus`, HUD clock extended).
  - **Second Breath** arms the well: one top-out empties it and play goes on. In a duel the
    rival gets no knockout (`OdysseyBotMatch.topOutGuard`). Once per attempt.
- **The price.** An orb cleared with a gem's help counts as cleared and opens the path, but
  holds **one star** and stays off the time leaderboard. The completion is marked `aided`
  until the orb is cleared unaided; the panel, ceremony, results and HUD say so.
- **Why this shape.** A skip-after-three-failures would make the wall vanish; a gem per fall
  erodes it with persistence while every unaided clear still means something. The once-per-
  attempt rule and the nine-gem cap bound the farmable exploit (deliberate quick falls).
- **Implementation notes.** Tide and Second Breath rewrite `lockedPieces` through
  `restoreBoardState` (the replay boundary), so the grid, caches and the Infinity camera stay
  in step. Gems live in the save (`gems: {count, earned, spent}`, additive to v5); the first
  arrival mark (`onboarding.arrivalSeen`) rides on the next save rather than forcing one, so
  read-only experimental sessions never write the campaign file.

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

- `npx vitest run`: see the session's final summary (full suite).
- `npx tsc --noEmit` clean; `npm run check:boundaries` clean; `npm run build` (boot closure OK);
  `check:ip-strings` and `check:palette` OK.
- Lint ratchet lowered 599 → 574 (`lint-ratchet.json`).
- Architecture fitness: `lines:OdysseyMode` 4397 → 4367 (baseline 4391). The pre-existing
  `lines:LocalMultiplayerMode = 2475 > 2471` failure predates this branch and is untouched.

## Not verified here, needs a GPU machine

- The rival and boss **markers** on the map (`LevelNodeManager`): billboards built exactly like
  the lock and star indicators, but this environment has no WebGPU and the chrome-devtools
  server did not connect, so no screenshot exists. Check placement under the orb at the
  chapters' different camera angles and the near-lens fade.
- The **showpiece reel** per theme: every theme plays the default reel. `ODYSSEY_THEME_SHOWPIECES`
  is the place to give a theme its strongest reaction (ids from `serenity-effects.js`); tune in
  the playground (`?effect=<id>`) with screenshots.
- The **afterglow** ceremony entrance and the gem tray's look in the HUD column.

## Follow-ups worth doing

- Steam achievement or stat for gems earned/spent (the wallet is in the save; `_syncSteamStats`
  is the hook).
- A short hint on the first gem earned (the failure sheet names it; the HUD tray could pulse).
- Cloud sync already carries the v5 save; the Steam Cloud test suite passes unchanged.
