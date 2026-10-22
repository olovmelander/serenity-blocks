# Infinity: the play camera, 2026-10-22

**What changed.** Infinity's camera follows play with one rule and one motion. In play, the
tower's top sits a fifth of the way down the view, as before. A piece you take down a shaft is
now followed with the rows ahead of it on screen, and the view stops lowering once its landing
shows. A piece you followed down is shown locking before the view goes home. A piece
hard-dropped out of sight, or a clear deep down the tower, is gone to, shown, and the view
comes home. Every move starts and stops smoothly, at the same speed on a 60 Hz or a 165 Hz
screen. Moving or turning the next piece ends any of these moments at once.

`src/ui/infinity/infinity-play-camera.js` replaces InfinityMode's per-frame follow, its
cascade tracker, its post-cascade adjustment and its snap-to-top, along with their timers,
cooldowns and lerp overrides.

## The audit: what each event did before

Measured in the real game (Electron, WebGPU, 1280×800, this machine's display at ~165 Hz) with a
frame-by-frame recorder. Each scenario builds a board in a fresh run and plays one event. The
camera's row, the piece, the stack's top and every physics event are logged each frame.

| Event | Before |
|---|---|
| Spawning, moving, turning | Camera still; pieces enter two rows above the view (Single Player's convention too). Fine. |
| Hard drop onto the tower, Tetris or cascade in view | Camera still; all cleared rows on screen (Stillfall's eight-wave Cornerstone: 8/8 rows flashed in view). Fine. |
| Soft drop down a deep shaft | Followed, but with the piece's bottom held at 80–89 % of the view: 2–4 rows ahead visible, never its landing. |
| Lock after a deep soft drop | The view whipped home: 66 rows in about 100 ms (a quarter of the way per frame at 165 Hz, then frozen for 8 frames), no moment at the landing. |
| Hard drop down a deep shaft | The piece landed 82 rows below the view and was never shown. |
| Tetris 80 rows below the view | 0 of 4 cleared rows ever on screen. Two camera controllers fought: the per-frame follow pulled to the tower's top while the gravity-step tracker pulled to the clear. The view jumped 8 rows in one frame and back, three times in 100 ms. |
| Cascade in a tall well | The view stepped down with the stack, one row a wave. Fine. |
| The well growing (rows added above) | Compensated exactly. Fine. |
| Every glide | A fraction of the distance *per frame* (0.08, 0.15, 0.25), so 2.75× faster at 165 Hz than at 60 Hz. At 60 Hz a soft drop's lag pushed the piece to the view's bottom edge. |

## How it is built

- **One framing** (`playFramingTop`). The tower's top sits `TOWER_TOP_SHARE` (20 %) down the
  view; an empty well rests on its floor. A piece deeper than that is followed with its top
  `PIECE_LEAD_SHARE` (30 %) down the view, but the view goes no lower than it needs to show
  the piece's landing (the ghost row from `getGhostLandingY`) with a row to spare. A piece
  hovering over a shaft changes nothing until it goes down. `_calculatePieceCameraPosition` is
  this framing, so the ascent's flight home lands on the same rows play uses.
- **One spring.** `springStep` (the ascent's critically damped spring: exact for any dt). It
  starts from rest, never overshoots, and moves the same at any frame rate. A gap over 250 ms
  (a pause, a look around) starts it from rest again.
- **Beats.** Moments when the view holds on something, then goes home:

| Beat | When | Holds |
|---|---|---|
| Lock | A piece the view had followed down locks (its framing was below home) | 150 ms |
| Landing | A piece locks out of sight both now and from home (a deep hard drop) | 220 ms once it is on screen |
| Clear | A wave clears rows out of sight both now and from home | until its cascade settles, then 300 ms |

  A beat counts as shown once its rows are on screen with a row to spare, while the spring is
  still settling. A clear beat keeps watching while later waves stay in sight. Moving, turning
  or dropping the next piece ends a beat. A clear beat yields only once its cascade has settled.
- **Physics events only inform it.** Lock, flash and cascade-complete callbacks tell the camera;
  gravity steps no longer move it. The draw callback steps it once a frame on both clocks. It
  is presentation only: board-anchored spawns never read it.
- **The well growing** shifts a held beat's rows with the camera (`shift`).

### The feel

| Constant | Value | What it is |
|---|---|---|
| `OMEGA_FOLLOW` | 16 /s | Following a piece and the stack: a 20 rows/s soft drop lags ~2.5 rows |
| `OMEGA_DIVE` | 15 /s | Going to a beat |
| `OMEGA_HOME` | 12 /s | Trips home longer than 6 rows: 64 rows in ~0.45 s, smooth at both ends |
| `PIECE_LEAD_SHARE` | 0.3 | A followed piece's top on screen |
| `ACTION_SHARE` | 0.6 | A beat frames its rows this far down (the shaft they came down above them) |

## Seen in game, after

| Event | After |
|---|---|
| Soft drop down an 80-row shaft | The piece rides 40–45 % down the view (8–9 rows of 20), 11 rows ahead visible. At the floor the view stops and shows the landing |
| Its lock | Held 150 ms at the floor, then home in ~0.45 s; the next piece out of sight ~0.6 s in all (was ~0.95 s, after a whip) |
| Deep hard drop | Dives to the landing (on screen within ~0.3 s), holds, comes home; the next piece out of sight ~0.8–1 s; a key press ends it |
| Tetris 80 rows down | One dive, no reversals. The view reaches the floor as the stack settles, with the clear's debris still flying and "Quad" showing |
| Everything in view | Unchanged: camera still (zero frames of motion in the spawn/move, top hard drop, top Tetris, both cascades and growth runs) |
| Cascade in a tall well | Follows the stack down; every wave's row flashes 6–7 rows down the view |

A deep flash itself is over before the view arrives: cascade animation runs on wall-clock
time, and holding it for the camera would change gameplay timing. The aftermath (the stack
dropping, debris, the clear's banner) is what the dive shows.

## Reduced motion

With `reducedMotion` (setting or OS), there are no beats, and any trip longer than a view is a cut
rather than a flight. Short moves still glide.

## Tests

`tests/unit/infinity-play-camera.test.js` covers:
- the framing (floor, tower, a piece hovering, a piece deep in a shaft, its landing, the floor);
- frame-rate independence (60 vs 165 Hz);
- a long trip starting from rest without overshoot, and rest after a pause;
- each beat, a piece passed on the way home (no beat), input ending a beat, a clear in sight
  (no beat), the well growing, and reduced motion.

`infinity-result-lifecycle` checks that:
- an old run's callbacks cannot touch a new run's camera;
- the end of a look hands the view back with no timer;
- every run gets its own camera.

## Re-running the audit

The recorder and its scenarios were scratch tools for this pass (Electron probe + analyzer).
Build the board in-page (grow the grid with `expandGridIfNeeded`, set `lockedPieces`, rebuild),
wrap `mode.physicsCallbacks` to log events, and sample `boardScene.cameraSettings.currentTopRow`
on every `requestAnimationFrame`. When loading a Stillfall board, offset its piece ids:
cells join by id, so a clash with the live counter welds the next lock to an existing body. That
made Cornerstone cascade once instead of eight times in the first run.

## Open

- Odyssey's Infinity wells and Infinity local multiplayer still move their cameras with a
  per-frame lerp (frame-rate bound). Both could adopt this camera.
