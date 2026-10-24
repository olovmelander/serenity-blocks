# Release trailer (2026-10)

The first release trailer for Serenity Blocks, and the tooling that makes it: an 89-second cut of
the real game, captured frame by frame from the built web app, timed to the game's own music,
with a title layer in the game's own fonts and logo. Everything is in `scripts/trailer/`;
nothing in `src/` changed.

**Status (2026-10-24):** the tooling is in place and verified piece by piece (a single-player
shot captured through the virtual clock, the title layer rendered, the cut assembled with stand-in
clips landing every cut on its bar); the first full capture of every shot is in progress.

## The cut

Music: **"Falling Pieces"** (`public/assets/music/falling-pieces.mp3`, the project's own Suno
track, see CREDITS.md §4), ≈130.8 BPM, one bar ≈ 1.834 s. It is cut on downbeats into four pieces
so the trailer gets the track's whole arc in 89 s: the riser and first groove, the build into the
first breakdown and drop, the second breakdown and drop, and the last hit with its tail. Every
picture cut lands on a bar line.

All eight modes are in it, and 29 different themes plus a breathing world and the Odyssey journey, none shown twice.

| Trailer time | Music | Picture | Copy |
|---|---|---|---|
| 0:00–0:07 | riser | Serenity Mode, Koi Pond, out of black, letterboxed | FIND YOUR FLOW |
| 0:07–0:12 | groove starts | same | Logo · STACK · BREATH · ASCEND |
| 0:12–0:22 | groove | Single Player in Aurora, Neon District, Sakura Twilight | STACK — Clear lines. Raise the level. Chase your best. |
| 0:22–0:36 | 8-bar build | Infinity (Galaxy, a 19-row stack), Stillfall (the tier-12 Watchtower puzzle in Crystal Cave: its last piece fires four waves), Local Versus with four bots (Synthwave Sunset), Online Versus, a two-seat lobby (Tornado) | each mode's wordmark with the menu's own line |
| 0:36–0:42 | breakdown | Painted Ages | 63 living worlds · Each one answers the way you play. |
| 0:42–0:56 | drop | **the world flip**: one game, the same board, and the world around it changes on every half-bar through 16 themes (Golden Forest, Kaleidosonic, High Coast, Chromadelic Highway, Pyrestorm, Ocean, Winter, Nebula Flow, Rainbow Terraces, Chromatic Impasto, Vesper Chrysalis, Midsommar, Ice Temple, Blood Moon, Sunbraid, Wolfhour) | each world's name |
| 0:56–1:04 | second breakdown | Serenity Mode (Stillwater), a Hale session | BREATH — Nothing to play. A living world and its music. · HALE SESSIONS — Nine voice-guided breathing sessions. |
| 1:04–1:18 | second drop | Odyssey, letterboxed: the journey flown from the Earth's core up through the ocean to the surface; the orbs Ashen Dawn (the core) and Sunken Depths (a cascade goal on a glowing night beach); then the journey flown again, the last air into space and the climb into the black hole | ASCEND — From the molten core of the Earth to the edge of a black hole. · ODYSSEY — Eight chapters. Sixty orbs. · …and beyond. |
| 1:18–1:29 | last hit, tail | Sunset under a dark scrim | Logo · COMING SOON · PC · Steam |

Every shot but the world flip and the flyover carries a slow camera move made in post (push,
pull, drift, rise; `MOVES` in assemble.mjs), resampled at sub-pixel positions so it glides.

Every claim comes from the build: the mode lines are the menu's own copy
(`src/ui/main-menu/main-menu.js`), 63 is the theme registry's count, eight chapters and sixty
orbs are `src/core/odyssey/data/chapters.js` and the campaign. **"COMING SOON · PC · Steam" is a
placeholder** for the store line; there is no store page yet (`steam_appid.txt` is still Valve's
test id). Change it in `OVERLAY` before the trailer goes anywhere public.

The legal review's store-asset guidance (`tetris_legal_review.md`, TD-1) shaped the picture: the
scenic worlds, the cascades and the breathing modes lead; no shot is a bright stack in a bare
bordered well; no copy names another game.

## How it is made

1. **`build.mjs`** builds the game for capture into `artifacts/trailer-build` (git-ignored): the
   production build plus the console test harness (`VITE_DEV_HARNESS=1`), whose mock transport
   runs the real Online Versus netcode between windows of one browser. `--serve` serves it.
2. **`capture.mjs`** boots that build in Chromium with capture flags (`skipIntro`, `unlockAll`,
   no warm-up, no frame cap, every adaptive-quality loop held), sets each shot up through
   `window.serenityBlocks` (mode, theme, the game's own CPU bot on the board) and records it.
3. **The virtual clock** (`virtual-clock.js`) is what makes that possible without a GPU. It is
   injected before any page script and replaces `requestAnimationFrame`, `performance.now`,
   `Date`, timers and idle callbacks. Thawed, it passes everything through so the game boots and
   loads at full speed; frozen, time moves only when the capture script calls `step(1000/30)`.
   One step fires the timers that fall due, runs one animation frame inside a real browser frame,
   and advances every CSS animation by hand (the document timeline is paused through CDP). Each
   captured frame is therefore exactly 1/30 s of game time after the last, however long
   SwiftShader took to draw it, and the clip plays at the game's real speed.
4. **Autoplay** (`autoplay-entry.js`, bundled with esbuild at capture time) is
   `PuzzleBotController`, the Local Versus CPU opponent, driving the player's board through the
   keyboard's own entry points (`window.move/rotate/softDrop/hardDrop`), ticked from
   `requestAnimationFrame` so it plays on the virtual clock. Before recording it places a number
   of pieces at once (its plan applied immediately, the drop's animations skipped as a replay
   seek skips them) so a shot opens on a lived-in board. Stillfall plays the puzzle's stored
   solution, pausing over each choice.
5. **Online Versus** is hosted by the capture page over the mock transport; a small peer window
   joins, every seat a bot, and the peer is stepped in lockstep with the host under the same
   virtual clock, so the netcode sees one consistent time. While one window is held still (or
   draws a frame for seconds on SwiftShader) the others would take it for gone, so the capture
   has each page's transport report no silence. Each peer window costs about ten minutes of
   boot on SwiftShader and slows every frame, hence two seats; on a GPU, raise `players`.
6. **The world flip** holds the game (`gameState.isPaused`) and the bot, thaws time while the
   next theme loads behind the board, then freezes again and steps frames, still held, until the
   theme manager has revealed the new world and it is on screen (a theme reports itself running
   while its in-play switch still builds it hidden). Only then does play resume: the board and
   the bot continue exactly where they were, and the world has changed on the beat.
7. **`render-overlay.mjs`** draws the title layer (`overlay.mjs`: an HTML page positioned purely
   from the timeline, fonts and artwork inlined from `public/`) to a transparent PNG sequence.
8. **`assemble.mjs`** cuts the clips, the camera moves, the overlay and the music edit together
   with ffmpeg (crossfades straddle their cut so cuts stay on the beat; 20 ms fades at each music
   splice; loudness normalised to −14 LUFS) into `artifacts/trailer/serenity-blocks-trailer.mp4`.

```bash
npm run trailer:build -- --serve &                  # the capture build on :4174
npm run trailer:capture -- --render-scale=0.75      # every shot → artifacts/trailer/shots/*.mp4
npm run trailer:capture -- --only=online,ody-c      # re-take some shots (--missing: only absent ones)
npm run trailer:overlay                             # title layer → artifacts/trailer/overlay/
npm run trailer:assemble                            # → artifacts/trailer/serenity-blocks-trailer.mp4
```

On a machine with a GPU, `--gpu` drops the SwiftShader flags and opens a headed window, and
`--quality=Extreme --render-scale=1` lift the picture; the virtual clock makes the timing the same
either way. `artifacts/` is git-ignored: the trailer and its clips are build outputs.

## Changing it

All of it is data in `scripts/trailer/trailer-config.mjs`:

- **A shot**: its `kind`, `theme`, `level` (Odyssey orb), bot `difficulty`, `prefill` pieces,
  `worlds` (a world flip). Re-take only what changed with `--only`.
- **A cut**: move an `EDIT` entry's `at`; keep it on a bar time (listed in the file's header).
  `fade` makes the entry cross-dissolve in, `move` picks its camera move.
- **Copy**: the `OVERLAY` list (types `scrim`, `letterbox`, `logo`, `section`, `mode`, `line`,
  `flash`).
  `node scripts/trailer/render-overlay.mjs --still=12.6` renders one moment to check a card.
- **Music**: `TRAILER.music.segments` (source in/out points on downbeats).

## Known limits

- Captured on SwiftShader: WebGPU runs on the CPU (about 6 s a frame at 1080p for a heavy
  theme), so the first cut draws the themes' 3D at 0.75 render scale on the High tier (the board
  and HUD stay at full resolution). A GPU capture at Extreme and full scale will be richer;
  timing is unaffected.
- SwiftShader needs more real time than the game allows a GPU: the capture raises the theme
  start limit and each theme's renderer bring-up limit to 120 s (`pagePrepare`). At the game's
  own 5.5 s a renderer queued behind the outgoing theme's device falls back to WebGL2, which
  draws nothing under SwiftShader (a blank world); the capture logs any such fallback.
  Voltage Storm still never draws here, so Chromadelic Highway stands in for it in the flip.
- Audio is the music only; the game's sound effects are muted during capture (the analyser
  sits before the music gain, so music-reactive visuals are still while muted).
- The music was chosen and cut from analysis (beat tracking, bar energy, bass onsets), not by
  ear. Listen before publishing; any other track works by changing `music` and the bar times.
