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

| Trailer time | Music | Picture | Copy |
|---|---|---|---|
| 0:00–0:07 | riser | Serenity Mode, Koi Pond, out of black | FIND YOUR FLOW |
| 0:07–0:12 | groove starts | same | Logo · STACK · BREATH · ASCEND |
| 0:12–0:22 | groove | Single Player in Aurora, Neon District, Sakura Twilight | STACK — Clear lines. Raise the level. Chase your best. |
| 0:22–0:36 | 8-bar build | Infinity (Galaxy), Stillfall (Crystal Cave), Local Versus with four bots (Synthwave Sunset), Pyrestorm, Ocean | mode wordmarks with the menu's own lines |
| 0:36–0:42 | breakdown | Black Hole | 63 living worlds · Each one answers the way you play. |
| 0:42–0:56 | drop | one bar each: Golden Forest, Kaleidosonic, High Coast, Voltage Storm, Winter, Nebula Flow, Midsommar, Wolfhour | theme names |
| 0:56–1:04 | second breakdown | Serenity Mode (Aurora), a Hale session | BREATH — Nothing to play. A living world and its music. · HALE SESSIONS |
| 1:04–1:18 | second drop | Odyssey: the journey map, then orbs across the chapters | ASCEND — From the molten core of the Earth to the edge of a black hole. · ODYSSEY — Eight chapters. Sixty orbs. · …and beyond. |
| 1:18–1:29 | last hit, tail | Sunset under a dark scrim | Logo · COMING SOON · PC · Steam |

Every claim comes from the build: the mode lines are the menu's own copy
(`src/ui/main-menu/main-menu.js`), 63 is the theme registry's count, eight chapters and sixty
orbs are `src/core/odyssey/data/chapters.js` and the campaign. **"COMING SOON · PC · Steam" is a
placeholder** for the store line; there is no store page yet (`steam_appid.txt` is still Valve's
test id). Change it in `OVERLAY` before the trailer goes anywhere public.

The legal review's store-asset guidance (`tetris_legal_review.md`, TD-1) shaped the picture: the
scenic worlds, the cascades and the breathing modes lead; no shot is a bright stack in a bare
bordered well; no copy names another game.

## How it is made

1. **`capture.mjs`** boots the built game (`npm run build`, `npx vite preview`) in Chromium with
   capture flags (`skipIntro`, `unlockAll`, no warm-up, no frame cap, every adaptive-quality loop
   held), sets each shot up through `window.serenityBlocks` (mode, theme, the game's own CPU bot
   on the board), and records it.
2. **The virtual clock** (`virtual-clock.js`) is what makes that possible without a GPU. It is
   injected before any page script and replaces `requestAnimationFrame`, `performance.now`,
   `Date`, timers and idle callbacks. Thawed, it passes everything through so the game boots and
   loads at full speed; frozen, time moves only when the capture script calls `step(1000/30)`.
   One step fires the timers that fall due, runs one animation frame inside a real browser frame,
   and advances every CSS animation by hand (the document timeline is paused through CDP). Each
   captured frame is therefore exactly 1/30 s of game time after the last, however long
   SwiftShader took to draw it, and the clip plays at the game's real speed.
3. **Autoplay** (`autoplay-entry.js`, bundled with esbuild at capture time) is
   `PuzzleBotController`, the Local Versus CPU opponent, driving the player's board through the
   keyboard's own entry points (`window.move/rotate/softDrop/hardDrop`), ticked from
   `requestAnimationFrame` so it plays on the virtual clock. Before recording it places a number
   of pieces at once (its plan applied immediately, the drop's animations skipped as a replay
   seek skips them) so every shot opens on a lived-in board. Stillfall plays the puzzle's stored
   solution, pausing over each choice.
4. **`render-overlay.mjs`** draws the title layer (`overlay.mjs`: an HTML page positioned purely
   from the timeline, fonts and artwork inlined from `public/`) to a transparent PNG sequence.
5. **`assemble.mjs`** cuts the clips, the overlay and the music edit together with ffmpeg
   (crossfades straddle their cut so cuts stay on the beat; 20 ms fades at each music splice;
   loudness normalised to −14 LUFS) into `artifacts/trailer/serenity-blocks-trailer.mp4`.

```bash
npm run build && npx vite preview --port 4173 &   # the built game
npm run trailer:capture                            # every shot → artifacts/trailer/shots/*.mp4
npm run trailer:capture -- --only=m3,m4            # re-take some shots
npm run trailer:overlay                            # title layer → artifacts/trailer/overlay/
npm run trailer:assemble                           # → artifacts/trailer/serenity-blocks-trailer.mp4
```

On a machine with a GPU, `--gpu` drops the SwiftShader flags and opens a headed window, and
`--quality=Extreme` lifts the effect tier; the virtual clock makes the result the same timing
either way. `artifacts/` is git-ignored: the trailer and its clips are build outputs.

## Changing it

All of it is data in `scripts/trailer/trailer-config.mjs`:

- **A shot**: its `kind`, `theme`, `level` (Odyssey orb), bot `difficulty`, `prefill` pieces.
  Re-take only what changed with `--only`.
- **A cut**: move an `EDIT` entry's `at`; keep it on a bar time (listed in the file's header).
  `fade` makes the entry cross-dissolve in.
- **Copy**: the `OVERLAY` list (types `scrim`, `logo`, `section`, `mode`, `line`, `flash`).
  `node scripts/trailer/render-overlay.mjs --still=12.6` renders one moment to check a card.
- **Music**: `TRAILER.music.segments` (source in/out points on downbeats).

## Known limits

- Captured on SwiftShader: WebGPU runs on the CPU, so the picture is the game's real renderer
  but at the High tier; a GPU capture at Extreme will be richer. Timing is unaffected.
- Audio is the music only; the game's sound effects are muted during capture (the analyser
  sits before the music gain, so music-reactive visuals are still while muted).
- The music was chosen and cut from analysis (beat tracking, bar energy, bass onsets), not by
  ear. Listen before publishing; any other track works by changing `music` and the bar times.
