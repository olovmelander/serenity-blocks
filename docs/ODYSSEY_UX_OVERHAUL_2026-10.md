# Odyssey UX overhaul (2026-10-18)

Status: Reference. The record of one session's answer to the Odyssey audit
(`ODYSSEY_UX_AUDIT_2026-10-17`, kept in the session scratchpad; its ten findings are
restated below with what changed). Eight commits on `ccr-e2e07e06-hg3pbp`, each one package,
each with tests. Read this before touching the campaign order, the save format, the map's
input, or the completion sequence. For charms, read
[ODYSSEY_CHARMS_AUDIT_2026-10.md](ODYSSEY_CHARMS_AUDIT_2026-10.md) instead: the system this
session built was replaced on 2026-10-20 (see the Charms section below).

## What changed, by finding

| Finding | What the game does now | Where |
|---|---|---|
| Boards without a minimap on scrolling wells | Every well taller than the 20 visible rows is a tall board: tower layout and minimap. One threshold, `ODYSSEY_VISIBLE_ROWS + 1`, shared by the mode and the layout. | `core/odyssey/odyssey-board-shape.js`, `OdysseyMode`, `ui/odyssey/odyssey-board-layout.js` |
| Duels mid-chapter, first to seven | Every chapter ends on its rival. Duels are a race to **three knockouts** on two empty wells at the chapter's own pace (`getOdysseyDuelGravity`); stars are win / at most one top-out / no top-outs. Whole orbs were reordered (identity intact), so the save moved to **v5** with a frozen v4→v5 id table and chapter-scoped unlock fill; Steam board names bumped (`OdysseyTotalStars_v3`, `OdysseyLevelTime_v4_`). `boardSeedId` keeps each orb's opening garbage. | `core/odyssey/data/{campaign-order,duel-rules,levels,chapters}.js`, `odyssey-progress-schema.js`, `steam-config.js` |
| Stars you cannot earn or understand | Mastery orbs retuned (`MASTERY_RETUNE`), chain goals harmonised so one metric is never asked twice. The map panel lists the goal, all three star goals, what changes from the orb before, the tip and how a locked orb opens. The ceremony and results mark each star goal earned or not and name the next star's shortfall in the player's numbers. | `ui/odyssey/{odyssey-level-panel,odyssey-star-notes,objective-copy}.js` |
| Two vocabularies, an off-tone one | Orb everywhere (Level only in developer logs), Goal, Map, knockouts and top-outs, Rival. All 35 shouting tips and descriptions rewritten in the ceremony's register; the false "keep playing after the goal" sentence removed from the 56 orbs that end at the goal. | `levels.js`, HUD, results, failure, briefing, records, menu |
| No onboarding, thin pause, no reset | A fresh journey is welcomed by the Chapter 1 arrival with a four-line orientation (once per journey, remembered in the save). The pause sheet offers **Retry orb** and **Back to map** while an orb is in progress and names the orb. The navigator offers **Start a new journey** as a two-step reset that keeps earned themes. | `ui/odyssey/{odyssey-first-arrival,odyssey-pause-actions,odyssey-new-journey,odyssey-navigator-list}.js`, `settings.js`, `index.html` |
| Hard walls, skip-after-three-failures wanted | **Charms** (below): since 2026-10-20, typed consumables found by clearing orbs and spent with one key press during an orb. The design and its reasons are in [ODYSSEY_CHARMS_AUDIT_2026-10.md](ODYSSEY_CHARMS_AUDIT_2026-10.md). | `core/odyssey/{odyssey-charm-bag,odyssey-charm-use}.js`, `ui/odyssey/{odyssey-charm-input,odyssey-charm-copy,OdysseyHUD,JourneyFlowOverlay,FailureModal}.js` |
| Map without keys or pad; locked orbs inert; no duel markers | Arrows and the D-pad step orbs, Up/Down jump chapters, Home/End, Enter/A plays. Locked orbs hover and open a read-only panel. Rival duels and chapter bosses wear a marker under the orb. | `ui/odyssey/odyssey-map-input.js`, `rendering/odyssey/LevelNodeManager.js`, `gamepad-controller.js` |
| Completion cut straight to a sheet | The goal plays the theme's showpiece reel (quad, six-wave cascade, perfect clear, from the Serenity catalogue, re-timed to about 1.5 s); the ceremony dims in through its afterglow. | `ui/odyssey/{odyssey-showpiece,odyssey-goal-flourish}.js`, `odyssey-flow.css` |

## Charms

The charm system this session built (eight passives, a draft of three at each chapter's
arrival, three carry slots chosen on the map, a mercy draft after three falls) was audited on
2026-10-20 and replaced by **Charms v3: gather, keep, spend**. The audit, the design, the
decisions and the open visual checks live in
[ODYSSEY_CHARMS_AUDIT_2026-10.md](ODYSSEY_CHARMS_AUDIT_2026-10.md); read that, not this section,
before touching charms. In short: four typed consumables (Tide, Still Air, Long Breath, Hearth)
on keys 1–4; every orb clear drops one (two for three stars, replays included), picked among
what helps on the next uncleared orb; after three falls in a row on one orb the road leaves the
one charm that helps there; the bag holds three of each for the journey; a charm is used once an
attempt, is spent on use whatever the attempt comes to, and the stars count in full. The one
competitive guard: a run that used a charm is not posted to the orb's time leaderboard. (The
earlier version of this section said a charmed clear "holds its leaderboard time"; the code has
kept charmed runs off the time board since the same day, audit finding F8, and the words now
match it.) The save is additive to v5: `charms: { bag, found, used, streak }`, normalised on
load, with the older gathered list converted so nobody loses what they gathered. Modules:
`core/odyssey/odyssey-charm-bag.js` (the rules), `core/odyssey/odyssey-charm-use.js` (the
effects, ticked from the gameplay loop), `ui/odyssey/odyssey-charm-input.js` (keys and pad),
`ui/odyssey/odyssey-charm-copy.js` (the words). What survives from this session's system:
Hearth's well rewrite through `restoreBoardState`, the duel's `topOutGuard`, the HUD's
`charms-section` slot, the `sb-ody-note` pattern on the sheets, the time-board exclusion, and the
first arrival mark (`onboarding.arrivalSeen`) riding on the next save rather than forcing one.

The in-orb presentation, settled later the same day: the tray is a **hotbar** (one tile per
charm, its three.js r186 icon drawn by `ui/odyssey/odyssey-charm-icon-stage.js` from the scenes
in `rendering/odyssey/odyssey-charm-icons.js`: chrome, brushed metal, bronze, glass and obsidian
reflecting one small studio baked in that module and sampled by hand on basic materials, so the
tray costs no standard-material compiles mid-play; the key on its shoulder, the count on the other,
one caption line under the row for the charm that matters: a refused press, the tile under the
pointer, Still Air's countdown, Hearth armed), and the HUD column **never scrolls**: it is laid
out to fit beside a full-height well on a 900 px screen, and `ui/odyssey/odyssey-hud-fit.js`
draws it smaller (never below two thirds) when a shorter window or the unfolded guide would
make it taller than the well. The ≤860 px dock flows its sections into columns for the same
reason; only a strip too short even for that scrolls, without a scrollbar.

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
- The **afterglow** ceremony entrance. (The charm surfaces changed with Charms v3; their open
  visual checks are listed in the audit.)

## Follow-ups worth doing

- Steam achievement or stat for charms found (`getCharmStats()` on the state; `_syncSteamStats`
  is the hook; the results already send the charms used in the details).
- Cloud sync already carries the v5 save; the Steam Cloud test suite passes unchanged.
