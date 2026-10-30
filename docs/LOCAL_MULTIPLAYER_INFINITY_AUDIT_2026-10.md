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

## 2026-10-30: the camera and the tower map

The owner reported that Infinity in local versus "does not work properly with the camera
alignment" and asked whether the tower map should scroll there.

### What each board's camera did

Measured in the real game (2 bots, Peaceful and Standard attacks, Forest, Chrome at ~166 Hz) by
sampling every board's `cameraSettings.currentTopRow` against its tower and piece each frame.

| Failure | Measured | Cause |
|---|---|---|
| The view only climbed | 0 downward moves in 60 s on either board | `_updatePlayerCamera` moved up when the tower passed 30 % and down only to chase a falling piece; after a clear it never came back down to the tower |
| The tower sat low | Tower top 30–75 % down the view (median 40–55 %); Infinity holds it at 20 % | The same 30 % rule, against the spawn anchor's 20 %: new pieces appeared inside the view instead of entering from above |
| A board's camera stood still all match | Player 2's camera did not move in 31 s | It moved only when one of its two thresholds was crossed |
| Speed tied to the frame rate and to the other players | 8 % of the distance per call | The lerp ran in `_syncBoardScenes`, which every player's physics `draw` also calls, so a camera moved again each time any board drew |
| Rows cut at the well's edges | The view came to rest between rows (33.85, 23.89) | The lerp stopped wherever its threshold stopped holding |
| A deep landing or clear never shown, a followed piece left behind | A piece followed down held its bottom at 50 % (its landing out of sight in a deep shaft); after its lock nothing brought the view back | No beats and no home |

### What the tower map did

Pressing a board's map paused that player alone (`playerPaused`) while the others played on:
pressed for 3 s, Player 2's clock stood still while Player 1 placed three pieces. In Last One
Standing that is a way never to top out, and anyone holding the mouse could freeze or scroll any
board, bots included. Every seat plays on keys or a pad, so no player has a hand free for it.
On release the view jumped and rested between rows.

### Repairs

- **Each board gets Infinity's play camera** (`src/ui/infinity/local-versus-cameras.js`): one
  `InfinityPlayCamera` per board, the same framing (`playFramingTop`: the tower's top 20 % down,
  a piece followed down a shaft until its landing shows), the same spring and the same beats
  (a followed lock, a landing out of sight, a clear out of sight held until its cascade
  settles). It steps on the clock, so the extra syncs in one frame do not move it again.
  main.js's multiplayer physics callbacks send it locks, flashes, cascade completions and hard
  drops (`_infinityCameraEvent`). Moves and turns have no callbacks in local versus, so it watches
  the piece; pieces come from a pool (the next spawn can be the same object back at the spawn
  column), so a piece is known by `piecesPlaced`, not identity. Grid growth shifts a held beat;
  a new match or round resets every camera. Reduced motion cuts long trips.
- **The tower map is read-only in local versus** (`InfinityMinimap` `explorable: false`): no
  drag, no pause, no hint, no hover zoom, `pointer-events: none`. Infinity and Odyssey keep their
  look-around. The exploration handlers, `_updatePlayerCamera` and
  `_calculateGameplayCameraPosition` are gone (LocalMultiplayerMode 2434 → 2304 lines).

### Verification

In the real game after the change:

- **Framing.** The off-floor board held its tower's top 20 % down (median and 90th
  percentile). The view moved down as well as up, never came to rest between rows, and stepped at
  most 0.32 rows a frame.
- **Events.** Locks, flashes and cascade completions all reached the cameras.
- **Hard drop down a shaft.** A vertical I hard-dropped 77 rows below the view made a four-line
  clear. The view was on it within ~0.3 s, held until the cascade settled, and was home by
  ~1.2 s.
- **Soft drop down a shaft.** At ~20 rows/s the view followed with the piece's top 41–44 % down
  (11 rows ahead on screen). It stopped at the floor with the landing in view, held 150 ms on the
  lock, and was home in ~0.6 s. These are the single-player figures.
- **Read-only map.** Pressing either map hits the card behind it; both boards' clocks ran on.
- **New match.** "Play again" started both boards on fresh 44-row wells at the floor, with no
  beat left over from a 100-row tower.
- **Console.** Clean but for Chrome's own `powerPreference` notice.

The first hard-drop run found the pooled-piece trap above: the respawn read as a move and ended
the landing beat before it showed.

`tests/unit/local-versus-cameras.test.js` (13 new) covers:
- the framing, and coming down to the tower after a clear as well as up;
- 60 vs 165 Hz, and repeated syncs in one moment;
- the landing and clear beats, input ending a beat, a pooled respawn not counting as input;
- rows added, reduced motion, a view held by hand;
- the mode stepping every board once a moment and routing beats to the right board.

`infinity-minimap-presentation` adds the read-only map. Gates green locally: typecheck,
boundaries, IP strings, TS ratchet (+1 checked file), lint ratchet (512 → 510), fitness
(LocalMultiplayerMode and main.js line counts lowered). The full suite is green but for the four
known local-only failures.

Not exercised: gamepad seats, three and four boards, and Electron (blocked on this machine).
