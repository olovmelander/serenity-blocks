# Local multiplayer Infinity audit — 2026-10-07

Status: **Reference**. Records a focused repair of local Infinity LMS at base commit
`abad15d9`; it is not a new multiplayer roadmap. The owner reported pieces stacking
in midair, early player deaths and other inconsistent behavior with bots, including
stacking without attacks.

## Findings and repairs

| Failure | Reproduction and cause | Repair |
|---|---|---|
| Floating locked blocks after garbage | In a 44-row Infinity grid, garbage settlement rebuilt a standard 24-row board. An unsupported block at row 20 stopped at row 23 while garbage occupied the actual bottom at row 43. | Rebuild temporary occupancy from locked pieces with the real playfield height for both insertion and every settlement step. |
| Garbage at the wrong floor | The shared garbage boundary omitted the actual grid dimensions. An empty 44-row Infinity board received garbage at row 23. | Pass the actual board and Infinity rules through `applyGarbage`; local multiplayer now uses this shared mutation boundary. |
| Early hidden-row death | A garbage push to Infinity row 1, 2 or 3 failed the standard four-hidden-row cutoff. Local callbacks repeated that cutoff. | Use Infinity's row-zero roof rule and remove the duplicate standard-board check. Standard boards retain their hidden rows. |
| Camera-dependent spawn failure | With the camera still at row 24 and a quickly built tower starting at row 20, the next piece spawned into the tower from the lagging animated camera. | Latch existing `board-anchor-v1` rules on every local Infinity reset; live and predicted spawns use occupied-board truth. Presentation interpolation cannot overwrite the simulation anchor. |
| Expansion loses a race with top-out | Growth waited for every thirtieth render frame, needed an active piece and a scene, and the roof check ran even during a pending clear. A stack could reach the current roof while unused capacity remained. | Expand at each stable loop boundary and before spawn, independently of the renderer. Reserve enough capacity before an entire garbage burst, capped at the configured maximum. Test the roof only after pending physics settles. |
| Playable roof rows never clear | Both cascade paths excluded rows 0–3 as if Infinity had hidden rows. The synchronous no-clear shortcut and bot simulator repeated this assumption. | Pass the first playable row through legacy physics, resolved physics, shadow comparisons and bot simulation; Infinity scans from row zero. |
| Bots predict the wrong board rules | Bot lookahead used the current presentation camera for a future board and evaluated Infinity's top rows as hidden. | Resolve future spawns from each predicted board. Carry the playable-row rule through evaluation, cascade preparation, side lanes and latent-trigger probes; retain danger scoring for touching row zero. |
| Old camera survives a reset | Local matches reuse their GameState objects. The scene compared mutable mode flags, so a fresh 44-row board could inherit camera bounds and position from a previous expanded tower. | Remember previous board dimensions and placement count separately; reset Infinity camera state on a new board/round while preserving smoothing across ordinary growth. |

`rowsAdded` is the garbage boundary's presentation handoff. Local camera compensation
shifts its rendered window by that amount once; spawn coordinates remain board-derived.
Expansion also preserves maximum-row statistics, including a burst that fills the
remaining expansion budget.

## Verification

Regression coverage exercises actual locks/spawns and wave commits, rather than only
checking helper outputs:

- Thirty consecutive attack-free O-piece locks remain connected to the actual floor
  across grid growth, without a scene or camera interpolation.
- All four players can spawn above a tower with a deliberately lagging camera.
- First-frame headless expansion precedes the roof check, and pending cascades get
  to resolve before elimination.
- Garbage inserts and settles on 44- and 100-row grids; playable rows 1–3 survive;
  large bursts reserve multiple growth batches and still fail at an exhausted roof.
- Both physics paths and shadow comparisons clear roof rows with matching results;
  the bot simulator agrees with live cascade resolution.
- Camera tests cover expanded and same-sized round resets and retained smoothing.
- Standard hidden-row behavior and the whole-match fixed-tick fallback are retained.

The full repository run passed **7,960 tests across 620 files**. After the final bot
roof-risk refinement, the focused gameplay, garbage, camera and complete bot suites
passed **110 tests across seven files**. This audit adds 39 regression cases.

The production build (including boot-closure checks), TypeScript check and repository
lint gate pass. Lint remains at its existing baseline of 816 errors, with no added
errors.

Browser evidence is in `artifacts/local-infinity-audit/summary.json` and the accompanying
screenshots. The production configuration form started a two-player Infinity match
with tier-four bots, Peaceful attacks, a 100-row maximum, Forest background and Minimal
effects. At 31 and 27 placed pieces, both players remained alive with no completely
unsupported locked pieces; one grid naturally grew from 44 to 54 rows. Four deliberately
queued garbage entries per player then passed through the production next-lock path:
both grids were 54 rows tall, garbage occupied rows 50–53 and both players survived.

The production new-round path was also checked after expanding both fixtures to 100
rows and putting their cameras at row 70 under exploration control. Both reset to a
fresh 44-row grid, camera/target row 24, exploration off and spawn row 22. The gameplay
console had zero errors or warnings. These were bounded development-browser checks;
long match soaks and Electron/gamepad acceptance were not exercised in this audit.

## Scope and limits

This repair does not activate fixed-tick local Infinity or change the migration
constraints in ADR-0012. Bots continue to use the normal gameplay input APIs.
The renderer changes are Phaser camera lifecycle work; no WebGPU theme or shader
is changed.

The configured maximum remains a real roof. Reaching it, overflowing it with garbage,
or having no legal spawn space at that maximum can still eliminate a player. The
existing blocked-spawn rule is retained. Online rules and other local variants are
covered by regression tests but are not the subject of this audit.
