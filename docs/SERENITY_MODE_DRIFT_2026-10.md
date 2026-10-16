# Serenity Mode: watch, drift, rest (October 2026)

Serenity Mode is the theme, its music and your breath with nothing to play. Before this pass it
was three separate rooms: the theme (changed only by **B**, at random), the Hub (a large sheet over
a dark scrim, choosing worlds from thumbnails while the real one was hidden) and breathing (a
full-screen world of its own, with the theme stopped behind it). Nothing on screen said what you
were watching, nothing moved on by itself, and several inputs misfired. This pass makes it one
place you can drift through.

The audit that led here (2026-10-16, in conversation) found the problems listed under
[What was wrong](#what-was-wrong); everything in it is fixed below.

## What you see

Everything Serenity Mode says over the theme speaks the **breathing guide's language**
(2026-10-16, after Olov found the guide's words and presentation finer than the bar's purple
cards): words on the world itself, never panels, carried by soft night shades that come and go
with them; the guide's three levels (an eyebrow with its small square, a title in Unbounded, a
line in Manrope); quiet tiles for what you can do; and each theme's **own light** as its accent,
as each breathing world has one. The accent is read from the theme's artwork, its round icon: the
most vivid bright hue in it, lifted to read on the shade (`serenity-theme-accent.js`, worked out
once per theme; the category's hue stands in until then or where the picture cannot be read). It
colours the eyebrow, the music note, the lit cell of the strip, a tile that is on, the arrows
under the pointer, the notices' square, the effects tray and the controls card.

**The world caption** (top centre, `src/ui/serenity-mode/serenity-world-bar.js`):

```
                    ■ NATURE · 7 OF 10
        ‹              Crystal Cave               ›
                     ♪ Crystal Cave
                   ▪▪▪▪▪▪█▪▪▪

   [ ◌ DRIFT · WITH THE MUSIC ]  [ ☾ REST OFF ]  [ ✦ EFFECTS ]      (the dock, bottom centre)
```

- It names the theme, its category and its place among yours, and the song; its arrows step
  between the themes you have collected, in the Hub's order, the way the breathing guide's
  arrows step between its worlds.
- The strip under it is your collection at a glance, like the guide's breath: one cell per theme,
  the one on screen lit. While the world drifts, that cell fills toward the next theme: with the
  music, as the song plays; on a timer, by the clock (a compositor animation, restarted only when
  it is shown).
- What you can do sits along the bottom in the guide's tiles: Drift, Rest, Effects. A layer the
  size of the screen holds both, but only its buttons take the pointer, so a press anywhere else
  still touches the world.
- It is there when you reach for it (pointer movement, a key, a press on it) and when something
  changes (a theme or a song, by you or by drift, and the theme you arrive in); it leaves after a
  few still seconds, with the cursor and the play rail. It never shows over the Hub, the breathing
  guide or the rest veil. On a phone it sits below the play rail across the width; in a window
  under 1200 px it steps below the rail while the rail unrolls its names on the first visits.
- Browsing is instant and cheap: a press names the next theme at once and the switch waits
  420 ms for the next press, so passing three themes builds only the one you stop on. While a
  theme is being built its name breathes.
- A theme you step to is your choice, as in the Hub: saved as the background in every mode.
- With only one theme collected (every new profile) the arrows are dimmed and say where more
  come from, instead of doing nothing.

**Notices** are one line of words above the dock, with the theme's square, over a soft round
shade, and name what happened ("Music 60%", "Drift · every 20 min", "Ocean Tide · Space to
begin"); a newer one replaces an older one with its own full time.

**First visits** (the first three) show one line of keycaps just above the dock for nine seconds,
in the input you use (keyboard, controller or touch), once the mode's loading veil has gone.

**The controls card** (`/`, Select) is a title card over the dimmed world: the eyebrow in the
theme's light, "Serenity controls", the keys in two columns under hairline section names. A press
anywhere, the key again, or ten seconds, and it is gone.

## Keys

| Key | Action | Controller |
|---|---|---|
| ← → | Previous / next theme (in a practice: its breathing world, as before) | D-pad ← → (with the Hub closed) |
| B | Random theme (kept as your choice) | L3 |
| D | Drift on / off (at the last pace chosen) | the Hub's Themes tab |
| E | The effects tray: every reaction the theme has to play (focus moves into it) | — |
| ↑ ↓ | Music volume (repeats while held) | LT / RT (one step every 60 ms) |
| , . | Previous / next song | LB / RB |
| M | Mute music | — |
| Media keys | Play / pause, next / previous song (Media Session) | — |
| Space, T | Breathing guide, next breathing world (with the guide closed it chooses the world it opens on) | X, D-pad ↑ ↓ |
| H, F, /, Esc | Hub, full screen, all controls, back to the menu | Y, R3, Select |
| — | Touch the world | A (with the Hub closed and no session) |

All keys are rebindable (Settings > Controls > Serenity on a keyboard). Shortcuts are bare keys:
Ctrl, Alt or Meta with a key, and typing in a field, are left alone. Held keys repeat only for the
volume. While the Hub is open it owns the keyboard (its arrows walk tabs and cards); only H, F
and / reach the mode. While the rest veil is down any key or button only brings the world back.

## Drift

`src/ui/serenity-mode/serenity-drift.js`. Off, **with the music**, or every 10, 20 or 30 minutes;
the world bar's chip cycles them, **D** turns drift on and off, and the Hub's Themes tab has the
same choices as pills a controller can reach (shown only in Serenity Mode). Saved as
`serenityDrift` and `serenityDriftPace`.

- **With the music**: the world follows the song. When a song ends the next starts
  (`SoundManager.onAudioEnded` → `nextTrack`) and its theme comes with it; choosing a song (`,`
  `.`, the Music tab) brings its world too. If no song changes for eight minutes (music muted or
  paused) the world moves on anyway. With theme-linked music on (the default), stepping the theme
  brings its song, so world and song travel as pairs.
- **A timer**: the next theme from the shuffle deck, counted from the last change, so a theme you
  just chose gets its full time.
- Drift holds while the theme is covered or you are choosing (the Hub, Settings, breathing in its
  own world, a Hale session, the rest veil) and keeps the time it had left. Breathing over the
  theme does not hold it. Drift's own changes are not saved as your background.

## Rest

`src/ui/serenity-mode/serenity-rest.js`, `serenity-rest-veil.js`. Choose 15, 30, 45 or 60 minutes
(the bar's chip, or the Hub). When the time is up the music fades and the screen dims to night over
45 seconds; then the music pauses, the theme stops drawing (`window.isThemeCovered`, as under the
breathing guide) and the screen wake lock is released, so the machine can rest too. Any key,
pointer or button brings everything back at the volume you had. A Hale session running when the
time is up finishes first. The rest timer lasts for one visit; it is not saved.

**The screen stays awake** while Serenity Mode is watched (Screen Wake Lock, asked for again when
the page comes back from hidden; Electron grants it). Before this, only Hale sessions held it.

## Breathing over the theme

The breathing guide (`src/ui/effects/breathing/breathing-guide.js`) has two places to breathe in a
practice of your own:

- **Its own world** (the default, unchanged): the twelve breathing worlds, opaque, the theme
  stopped behind them.
- **Over the theme** (Serenity Mode only): no world of its own and no second renderer. The theme
  keeps drawing beneath a light veil that opens on the in-breath and closes on the out-breath, a
  glow in the world's accent, and the guide's words with enough shade behind them to read on any
  theme. The guide publishes the lungs' fill (`src/core/breath-signal.js`) and **every theme's
  camera breathes with you**: the shared camera breath (`src/themes/shared/camera-breath.js`,
  which every theme but Wolfhour uses) follows the guide's breath instead of its own 4 s / 6 s
  clock, with the lift and lean ×1.75 so it can be followed and the wander ×0.35 so a hold is
  still, eased over two seconds of the theme's clock in and out. Reduced motion leaves the camera
  still, as before.

Choose it with the guide's own **Over the theme** / **Own world** button (top right, beside the
arrows) or the Breathing tab's **Over the theme** switch; saved as `breathingOverTheme`. A Hale
session always breathes in its worlds. A world parked behind the veil gives its GPU device back
after 45 s. Drift and the theme arrows keep working while you breathe over the theme (← → change
the breathing world, as in the guide).

## Touching the world

`src/ui/serenity-mode/serenity-touch.js`. A press where nothing else is (mouse, pen, finger, or A
on a controller) sends one soft ring of light and the theme's gentlest line-clear reaction
(`lineCount: 1`, no combo). There are no counts, combos or cooldown messages; past eight touches
in twelve seconds the ring still answers and the theme rests. On a touch screen a horizontal swipe
changes the theme. Presses on any control (the bar, the play rail, the Hub, dialogs, the guide)
are theirs alone.

## Theme effects

`src/ui/serenity-mode/serenity-effects.js` (the effects), `serenity-effects-tray.js` (the tray).
Everything a theme does when you play, on demand, so you can watch each world's reactions without
playing a game. **E**, or the dock's **Effects** tile, opens the tray. It holds the right edge over
its own night shade, deepening toward the edge, in the guide's words and tiles (along the bottom
on a phone); while it is open the caption and the dock centre on the rest of the screen:

```
■ EFFECTS                                 [ PLAY ALL ]  [ × ]
Forest
What it does when you play
Pieces       [Lock] [Hard drop]
Line clears  [Single] [Double] [Triple] [Quad]
Cascades     [3 waves] [6 waves] [10 waves]
Chains       [Combo ×5] [Back-to-back]
Moments      [T-spin] [Perfect clear] [Level up]
← → another theme · E closes
```

- **Press an effect** and the theme on screen plays it; the button stays lit while it runs. The
  arrows still change the theme, so one effect can be compared across worlds: press, →, press.
  **Play all** walks through every effect with a quiet pause after each and names each one in a
  notice ("Quad · four lines · 6 of 14"); press it again, or any effect, to stop.
- **What the themes receive is what play sends.** Each effect is a short script of the gameplay
  events in the pinned physics order (ADR-0011, `physics-callback-schedule.test.js`): HARD_DROP
  and PIECE_LOCK in one tick; then per wave COMBO (the cascade depth, from the second wave),
  LEVEL_UP when the clear crosses a level, LINE_CLEAR, TSPIN, B2B; PERFECT_CLEAR once the last
  wave has settled. Waves are 360 ms apart (the rows' 160 ms hold and the fall), combo locks
  720 ms. Payloads go through the canonical emitters (`src/events/gameplay-events.js`) with real
  pieces (shape, position on the 10 × 24 matrix, the theme's own tetromino colour) and real
  cleared rows; the one addition is `source: 'serenity-effects'`, which no theme reads. Only
  themes listen to these events, so nothing is scored, saved or unlocked.
- **Each effect stands on its own.** Themes count combos from the lock sequence
  (`src/core/combo-tracker.js`), so a Double right after a Single would be the second step of a
  combo. When the last lock cleared lines, a clearing effect first sets down one plain piece
  (900 ms before), as play would. Back-to-back puts a plain piece between its two quads for the
  same reason. Repeated presses vary: Lock walks through the seven shapes and the columns, Level
  up climbs one level each time.
- One effect at a time: a new one ends the one before it (play never overlaps two locks).
- The tray stands at the right edge on a wide screen, clear of the middle where the board would
  be and where themes play their effects; on a phone it lies along the bottom, each group one row
  that scrolls sideways, and notices step up above it. It stays until closed (E, Esc, its ×, the
  chip), steps aside with the world bar whenever something else has the screen (the Hub, the
  breathing guide, a Hale session, the rest veil) and ends what it was playing. Drift holds while
  it is open, so the world you are trying stays. While it is in view it owns Esc, as the Hub
  does (it listens on the way down, before Settings' handler in `controls.js`).
- If **Background reacts to combos** is off (Settings › Visual), the tray says so: themes ignore
  these events then.
- For captures and scripts: `serenityBlocks.gameModeManager.getCurrentMode().playEffect('quad')`
  plays one effect (ids in `EFFECTS`), with or without the tray.

Not here yet: a controller path into the tray (the pad's D-pad and A keep their theme and touch
meanings), and the game's own sound effects with each effect.

## What was wrong

| Found | Now |
|---|---|
| Every controller shortcut (Y Hub, X breathing, LB/RB songs, LT/RT volume, A in the Hub) also fired a theme click effect: the mode polled buttons 0–7 every 100 ms with no check for the Hub or the guide, and twelve presses showed "Max Combo! Cooling down…" mid-Hub | No polling; A with nothing else to do is the one touch |
| Pressing Settings in the play rail fired a theme effect (seen in a run) | Presses on controls never touch the world |
| Volume from a controller jumped from 0 to about half (`musicVolume \|\| 0.5`) and swept 0 → 1 in under half a second | The real volume, one step every 60 ms, saved like the slider |
| Keys fired on auto-repeat and with Ctrl/Alt (holding Space flickered the guide, Ctrl+F toggled full screen) | Bare keys; only the volume repeats |
| B's random theme was not saved (the Hub's Random was) | Saved, as any choice |
| B did nothing and said nothing with one collected theme | Says where more themes come from |
| A second notice within two seconds was cut short by the first one's timer | Each notice gets its full time |
| "Theme Changed" never said which theme | The bar names it, and its song |
| The keyboard had no music controls | ↑ ↓ , . M and the media keys |
| Clicks counted "3x / 6x / 9x Combo!" and cooled down with red rings | One soft ring; no scoring |
| The screen could dim or sleep while you watched | Wake lock while the mode runs |
| T with the guide closed said "Enable breathing guide first (Space)", whatever Space was bound to | Chooses the world the guide opens on, and says how to begin it with your key |
| Nothing on screen named the theme or the keys; the idle screen gave no way in | The world bar and the first-visit hints |
| Breathing was a hard cut away from the theme | Over the theme, with the camera breathing with you |
| No way to drift between themes or rest | Drift and Rest |

## Modules

| File | Role |
|---|---|
| `src/core/game-modes/SerenityMode.js` | Lifecycle and the key map; calls into the UI below. Lost its DOM work (notices, ripples, the old shortcuts overlay, button polling) and the combo state. |
| `src/ui/serenity-mode/serenity-mode-ui.js` | Everything on screen and beside the theme, in one place: wires the modules below to the theme manager, the sound manager, the Hub and the guide. |
| `serenity-world-bar.js`, `serenity-world-stepper.js` | The bar; stepping through your themes with the delay and the save. |
| `serenity-drift.js`, `serenity-options.js` | Drift (timers injected); the choices and their words, shared with the Hub. |
| `serenity-rest.js`, `serenity-rest-veil.js` | The rest clock; the dimming layer. |
| `serenity-touch.js`, `serenity-notice.js` | Touching the world; notices and the first-visit hints. |
| `serenity-effects.js`, `serenity-effects-tray.js` | The theme effects as event scripts and their player (timers injected); the tray. |
| `serenity-wake-lock.js`, `serenity-media-session.js` | Screen wake lock; media keys and system media controls. |
| `src/ui/serenity-hub/serenity-drift-panel.js` | The Themes tab's Serenity Mode panel. |
| `src/core/breath-signal.js` | The breath being followed: no DOM, no clock, no imports (boot-safe). |

Styles: `public/styles/keystone-overlays.css` (bar, notices, hints, rest veil, ripple, effects tray),
`breathing-guide.css` (over the theme), `keystone-hub.css` (the drift panel). Motion is opacity
and transform only, every piece has a reduced-motion path, no backdrop blur.

Architecture fitness: `core-dom-globals` and `core-nondeterminism` went down (the DOM and the
clocks moved out of `src/core`).

## Tests

`tests/unit/serenity-mode-keys.test.js` (the key map, rebinding, the Hub's keys, resting, the
D-pad, waking from rest on a controller), `serenity-mode-drift.test.js` (drift paces and holds,
the arrows' order, delay and save, the rest timer, touch rhythm), `camera-breath-signal.test.js`
(the signal, the camera following and returning without a jump, holds, reduced motion),
`breathing-guide.test.js` (over the theme: no stage, the theme drawing, the signal, moving
between the two places, GPU release, never in a session or outside Serenity),
`serenity-effects.test.js` (every effect's events against the physics order, through the real
emitters and the consumer-audit payload rules, effects standing on their own against
`ComboTracker`, the player's timing, Play all, stopping), and the updated
`serenity-random-theme.test.js` / `serenity-breathing-session-input.test.js`.

## Verification

**The real game on SwiftShader** (WebGL2 backend, no GPU lock),
`index.html?skipIntro=1&forceWebGL=1&unlockAll=1`, 1600×900 and 390×844, through a scratch
Playwright driver, with no console errors or warnings: the bar on entry with the first-visit
hints; ← naming "Theme 2 of 63 · Halcyon Apex" at once (the bar marked arriving) and the theme
then built and shown, its song following; the volume and drift notices; the controls overlay
with the new keys; the Hub's drift panel (desktop and phone); breathing in its own world, then
over the theme from the guide's button (`isOverTheme` true, `isThemeCovered` false, the signal
live); the rest veil part-way through its fade, and "Welcome back" at full brightness after a
key. On the phone the bar sits below the play rail across the width.

**The real game on the RTX 3070** (WebGPU, `nvidia ampere`; Electron under the shared GPU lock,
`index.html?skipIntro=1&unlockAll=1`, 1600×900): the bar names Forest and its song on entry,
beside the play rail's first-visit names and above the key hints; breathing over the theme keeps
Forest on screen under the veil. Forest's camera, sampled every frame for 12 s at 130 fps while
Heart Glow breathed (five in, five out): its pitch followed the published breath with
**r = −0.9995** over the full 0..1 range, and the largest step between frames was 0.5 % of the
breath's travel (no jump on arrival). That run also found a real fault, fixed here: the guide is
created by deferred boot, so entering Serenity quickly left it unaware the mode allowed breathing
over the theme; it now asks the page when it was not told.

**Theme effects on SwiftShader** (same URL, 1280×720 and 390×844 with touch, Forest and Aurora;
SwiftShader in that container drew about one frame a second, so captures show an effect's early
frames): the chip and E open the tray (E puts focus on Lock; Tab and Enter play the next one); the
playing button lights; Forest's fireflies swarm on 6 and 10 waves and glow on Combo ×5; the bus
carried PIECE_LOCK, LINE_CLEAR, COMBO and PERFECT_CLEAR in the scripted order to the theme's two
listeners each; Esc closed the tray both with focus inside it and on the page, and only the next
Esc opened Settings; no horizontal scroll on either size; no console errors or warnings besides
SwiftShader's own driver notes. The phone pass found group labels running into the buttons, fixed
before commit.

Captures were taken in the session's scratch space and are not committed.

Not measured: frame cost (nothing here adds GPU work; breathing over the theme removes the
guide's second renderer), a physical phone, a real controller (the controller paths are covered
by unit tests against the controller module).
