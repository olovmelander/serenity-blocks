# Breathing overhaul — capture evidence (2026-10-05)

Captures for [docs/BREATHING_OVERHAUL_2026-10.md](../../docs/BREATHING_OVERHAUL_2026-10.md).
All were taken in Electron against the Vite development server.

## The twelve worlds (playground, `?effect=breathing`)

| File | What it shows | Backend |
| --- | --- | --- |
| [breathing-pairs.jpg](breathing-pairs.jpg) | Every world with empty lungs and with full lungs, 1280×720, High tier | WebGPU (nvidia ampere) |
| [breathing-webgl.jpg](breathing-webgl.jpg) | Every world at 70 % breath with `forceWebGL=1`, Medium tier | WebGL2 |
| [breathing-portrait.jpg](breathing-portrait.jpg) | Every world at 390×844, Low tier (no post pipeline) | WebGPU |

Scene time is pinned to 12 s. Each sheet is one page: the effect's `window.__BREATH_LAB__`
switches world and breath, `__PLAYGROUND__.seek()` draws the frame, and the canvas is copied in
the same task. The three runs reported no console errors or warnings.

Reproduce with `scripts/capture-breathing.mjs` (see the document above).

## The real game

Driven from a scratch Electron script: boot with `?skipIntro=1`, start Serenity Mode, then
operate the shipping UI through its own elements.

| File | Step |
| --- | --- |
| [game-guide.jpg](game-guide.jpg) | Standalone guide, Aurora Dreams, 1440×900 |
| [game-breathing-tab.jpg](game-breathing-tab.jpg) | Hub → Breathing |
| [game-hale-catalogue.jpg](game-hale-catalogue.jpg) | Hub → Hale sessions |
| [game-hale-prepare.jpg](game-hale-prepare.jpg) | Preparation for Hale Base, one intention chosen |
| [game-hale-session.jpg](game-hale-session.jpg) | Round 1 of Hale Base in the guide |
| [game-hale-complete.jpg](game-hale-complete.jpg) | Result |
| [game-guide-over-single-player.jpg](game-guide-over-single-player.jpg) | The guide over a paused single-player game: nothing of the board shows through |
| [phone-guide.jpg](phone-guide.jpg) | Standalone guide, Heart Glow, 390×844 |
| [phone-hale-hold.jpg](phone-hale-hold.jpg) | A hold in Hale Base, 390×844 |

Both walkthroughs (1440×900 and 390×844) ran every step without a console error. State read
back from the page during them:

- guide: stage live on `webgpu`, `window.isThemeCovered === true`; High tier on desktop, Low
  tier (direct render, no pipeline) at phone size;
- preparation open: `serenityHub.holdsGameplay() === true`;
- session: active, first stage set in `forest-breath` (Hale Base's arrival world);
- Pause from the guide: `sessionManager.isPaused === true`;
- after dismissing the result: nothing holds gameplay, the guide is stopped, the flow is closed.

**Pause ownership in single-player** ([pause-ownership.json](pause-ownership.json)): twelve
checks read from `gameModeManager.getCurrentMode().isPaused`, all true. Opening the Hub pauses;
starting a practice from the Breathing tab keeps the game paused after the Hub closes; a direct
`resumeGame()` during the practice is refused; ending the practice resumes play. For a Hale
session the game stays paused through preparation, the session and its result, and resumes when
the result is dismissed.

The walkthrough steps stages with the manager's own `_nextPhase()` and ends with
`_completeSession()`, so the result screen's time reads seconds, not a real session's length.
Voice guidance was switched off for the run.

## Limits

These captures show that the artwork renders, composes and responds to the breath on both
backends and at phone size. They are not frame-time measurements: nothing here says how the
worlds perform on an integrated GPU or a physical phone.
