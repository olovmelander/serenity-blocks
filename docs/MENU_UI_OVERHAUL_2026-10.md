# Menu and UI overhaul — the Keystone interface language (2026-10)

**Status:** Reference (record of shipped work). Owner surfaces: every DOM menu, sheet,
modal and overlay. Not covered: WebGPU/TSL themes, Odyssey chapters, Phaser board art.

The menus worked but looked like a generic sci-fi kit: centred glass boxes, Orbitron
titles in a different accent per screen, monospace copy with wide tracking, unlabelled
icon buttons, and at least seven button systems. This pass gives the whole game one
interface language that grows out of the Serenity Blocks logo itself.

---

## 1. The language

### 1.1 Origin

The logo (`public/assets/branding/serenity-blocks-logo.svg`) has one signature: the
coral tile that completes the **O** of BLOCKS. A calm, cool structure — cream
lettering over a lavender → aqua → mint spectrum — completed by one warm block falling
into place. That gesture *is* the game (stack, breath, ascend), so the interface is built
from it and the language is named after it: **Keystone**.

### 1.2 Five rules

1. **One warm block.** Night ink, cream type, spectrum light. Coral appears only as the
   keystone: where you are (focus, current item) and what happens next (the one primary
   action). If two things on a screen are coral, one of them is wrong.
2. **Built from tiles.** Rounded squares, never pills. Corners follow the logo's soft
   block lettering. Meters are rows of cells; separators are cleared lines of tile dots.
3. **Open corners.** Hero panels leave the top-right corner open, like the O, and the
   keystone sits in that gap (`.sb-panel--open` + `.sb-key`).
4. **Breathe, then lock.** Ambient light breathes slowly (5.5 s, sine). Interactions drop
   and lock: short, crisp ease-out (`--sb-ease-lock`). Nothing bounces or spins. Reduced
   motion keeps the lock and drops the breathing.
5. **Say it plainly.** Words over icons; every icon has a visible label or an accessible
   name; one primary action per screen; a visible way back; input hints in the footer
   that switch between keys and controller buttons.

### 1.3 Tokens (`public/styles/keystone.css`)

| Group | Token | Value | Use |
|---|---|---|---|
| Brand | `--sb-cream` | `#fff6e9` | All primary text |
| | `--sb-lavender` / `--sb-aqua` / `--sb-mint` | `#b8a4ff` / `#9ee8ed` / `#c5f1cf` | The spectrum (`--sb-spectrum`), identity tints |
| | `--sb-coral` = `--sb-keystone` | `#ffac88` | Focus marker, primary button, "current" cells only |
| Support hues | `--sb-gold` / `--sb-rose` / `--sb-sky` | `#f3d28d` / `#f5aed0` / `#94c8ff` | Per-mode identity (tints and lines, never fills) |
| Surfaces | `--sb-surface`, `--sb-surface-raised`, `--sb-surface-hover` | night glass fills | Panels, rows, hover |
| Lines | `--sb-line`, `--sb-line-strong` | cream at 10 % / 20 % | Hairlines |
| Text | `--sb-text`, `--sb-text-muted`, `--sb-text-faint` | cream at 100 / 70 / 46 % | Hierarchy |
| Status | `--sb-success`, `--sb-warning`, `--sb-danger` | pastel | Never harsh red |
| Type | `--sb-font-display` | Unbounded | Titles, labels, numbers, buttons, tabs |
| | `--sb-font-text` | Manrope | Descriptions, rows, body |
| Shape | `--sb-r-xs … --sb-r-xl` | 6 / 10 / 14 / 20 / 28 px | Radii |
| Motion | `--sb-ease-lock`, `--sb-ease-breathe`, `--sb-dur-1/2/3`, `--sb-breath` | | See rule 4 |

Per-mode identity: Single Player aqua, Infinity lavender, Local Versus rose, Online Versus
sky, Serenity and Hale Sessions mint, Odyssey gold.

The legacy `--cs-*` tokens (`cosmic-tokens.css`) now carry brand values too, so anything
still built on them reads as the same family.

### 1.4 Type

Fonts are vendored (`public/fonts/unbounded`, `public/fonts/manrope`, OFL-1.1) and declared
in `fonts.css` with **relative** URLs — absolute `/fonts/...` URLs break under `file://`
(packaged Electron) and a GitHub Pages sub-path.

- **Unbounded** (wide, soft-cornered) echoes the logo's block lettering: screen titles,
  labels/eyebrows (small caps, `0.2em` tracking), numbers (`tabular-nums`), buttons, tabs.
- **Manrope** is for reading: descriptions, setting rows, helper text, chat.
- Orbitron and Space Mono stay loaded only for canvas/HUD code that names them; new UI
  never uses them. `Inter` and `Rajdhani` were referenced but never bundled — do not use.
- Titles in sentence case ("Settings", "Records"); labels without trailing colons;
  buttons start with a verb ("Play", "Find a match", "Choose a session").
- The tagline is **Stack · Breath · Ascend** (the brand's wording, kept as is).

### 1.5 Primitives (`keystone.css`)

| Class | What |
|---|---|
| `.sb-eyebrow` (`--quiet`) | Spaced capitals with a tile bullet; colour from `--sb-accent-rgb`; line height 1.5 so a wrapped eyebrow never overlaps itself |
| `.sb-panel` (`--open`) + `.sb-key` | Night-glass panel; `--open` masks the top-right corner for the keystone sibling |
| `.sb-btn` (`--primary`, `--quiet`) | 48 px buttons; primary is the coral keystone |
| `.sb-kbd[data-key]` / `.sb-kbd[data-pad]` | Keycaps; the body class `sb-input-gamepad` swaps key hints for pad hints |
| `.sb-hints` | Footer hint list (`<ul class="sb-hints"><li><kbd …>Enter</kbd>Play</li>…`) |
| `.sb-chip` | Rounded-square tag |
| `.sb-meter > i` (`.is-filled`, `.is-current`, `.is-break`) | Progress drawn as cells; the current cell is the keystone |
| `.sb-divider` | A cleared line of tile dots |
| `input[type=checkbox].sb-toggle` | Switch whose knob is a tile; on = a lit cream tile on the spectrum track (not coral: toggles stack) |
| `.sb-keystone` | The focus marker (below) |

### 1.6 The keystone focus marker

`src/ui/keystone/keystone-focus.js`: one coral tile follows keyboard and controller focus
across every menu and drops onto the focused control's top-right corner (Web Animations,
240 ms). It is decorative (`aria-hidden`) — controls keep their own `:focus-visible`
outline. It ignores pointer users, text fields and anything marked
`data-keystone="none"` or `.game-mode-card` (which draws its own). No per-frame work at
rest: it is placed on focus changes, scroll and resize, with a short settle burst.

`src/ui/keystone/input-mode.js` publishes the current input as `sb-input-keyboard |
sb-input-pointer | sb-input-gamepad` on `<body>` (the gamepad poll reports activity only
while the mode is not already gamepad). A controller moves focus with `.focus()`, which
never matches `:focus-visible` once the mouse has been used — the marker uses the input
mode instead, so controller players always see where they are.

### 1.7 Performance rules (unchanged from CORE_UI_PERFORMANCE_FIXES_2026-10)

- **No `backdrop-filter` on menu shells, rows or tiles.** Menus float over live WebGPU
  scenes; depth comes from layered fills, hairlines and shadow.
  `scripts/windows-menu-visual-validation.mjs` asserts this for the mode list.
- Animate `opacity` and transforms (including `translate`) only.
- No per-frame layout reads; covered menus pause their animations (`.menu-covered`).

---

## 2. Architecture

- `public/styles/keystone.css` — tokens and primitives.
- `public/styles/keystone-<surface>.css` — one layer per surface, linked **last** in
  `index.html`, scoped by the surface root id so it wins over the older layers without
  `!important`.
- `src/ui/keystone/` — input mode and the focus marker.
- `src/ui/main-menu/main-menu.js` — the main menu (imported by `main.js` in place of
  `menu-card-interactions.js`, which it imports in turn; `main.js` stays at its line
  ceiling).
- A legacy `*-aaa.css` layer is deleted once its surface's keystone layer fully replaces
  it (`menu-aaa.css` is gone; its animated mode icons and corner tiles moved into
  `keystone-menu.css`).

Ids, classes and copy that JavaScript or tests depend on are preserved (each surface's
section lists them).

---

## 3. Main menu (`#start-modal`)

**Before:** a 2 × 3 grid of near-identical glass cards; monospace descriptions; four
unlabelled icon tiles on the right edge; a floating "Hale sessions" pill.

**After:**

- **Brand** top left: the DOM wordmark is the menu logo on every platform (the path
  packaged Electron already used). The intro title still flies into it — the handoff
  targets `.main-menu-logo img` whenever the shrunken intro title is not displayed.
- **Modes as a list grouped by the tagline:** Stack (Single Player, Infinity, Local
  Versus, Online Versus), Breath (Serenity, Hale Sessions), Ascend (Odyssey). The current
  item carries the coral keystone. Every `.game-mode-card` keeps its id and `data-mode`
  (game-mode-ui.js, gamepad card navigation, tests). Hale Sessions is now a list entry
  (`#hale-card-btn`, `data-mode="hale"`) that opens the guided sessions; the floating pill
  is hidden on the menu.
- **Stage** for the current mode: the custom-lettered mode wordmark (the same alphabet as
  the logo, `public/assets/branding/modes/`), what the mode is, the player's own facts
  (best score and games from Records; Odyssey levels, stars and chapter from the save;
  Hale streak and practice time), a 59-cell Odyssey meter grouped by chapter with the
  keystone on the next level, and one primary action. The panel keeps one height so the
  button never moves. Odyssey's level and chapter counts are read from the registry
  (lazy-loaded — `levels.js` alone is 142 KB) instead of hard-coded copy; the old card
  said "56 levels across 7 chapters", the game has 59 in 8.
- **Dock** with labelled buttons (Serenity Hub, Records, Replays, Settings) that proxy to
  the existing global controls, so every existing handler keeps working; the corner tiles
  are hidden on the menu and restyled as keystone tiles in game. Desktop builds end the
  dock with **Quit** (`desktop:quit` over the preload bridge); it asks for a second press
  ("Press again to quit", resets after 4 s or when focus leaves), so a stray controller
  press never closes the game.
- **Hints** footer (↑↓ Choose · Enter Play · Esc Settings; controller glyphs when a pad is
  in use). Arrow keys walk the list, → reaches the stage button, Home/End jump, and Enter
  with nothing focused plays the mode the stage is showing.
- Under 900 px wide the stage folds away and each row shows its description; the dock
  becomes a four-column bar.

---

## 4. UX defects fixed along the way

| Defect | Fix |
|---|---|
| A background click on the main menu started a game | `controls.js` restarts on tap only from game over |
| Enter/Space on any focused menu button (Replays, game-over Main Menu) also started a game | `controls.js` leaves Enter/Space to the focused control |
| Gamepad B never closed Settings or High Scores (`.active` vs `.visible`) | `navigateMenuBack` checks `.visible` |
| `.modal p` made every paragraph in every menu pulse and turn violet | Scoped to the game-over restart prompt |
| Font URLs were absolute (`/fonts/...`) | Relative to the stylesheet |
| Odyssey copy promised 56 levels in 7 chapters | Read from the level registry (59 in 8) |
| The desktop game had no way to quit from its menus (Alt+F4 only, in fullscreen) | Quit in the main menu dock, two presses |
| A failed game start raised a browser `alert` | A Keystone toast (the toast listener now installs at boot, with the main menu) |
| On game over every controller face button restarted, B included, and a button still held from play fired at once | B is Main menu (like Escape); A, X, Y or Start play again; the sheet arms only after a neutral release |
| Controller B ignored the multiplayer back stack | B goes back like Escape, and pad navigation stays inside the top multiplayer surface |
| The floating Hale sessions tile covered the versus chat column and, on phones, the replay bar | It steps aside during versus matches and replays (the lotus tile still opens the Hub) |
| Cancel or Escape from Create match left a blank screen; Escape over the multiplayer menus opened Settings | One back stack for every multiplayer sheet |
| A failed create or join hid its sheet and said nothing (or used `alert`) | The sheet stays open with the reason |
| `serenity:toast` events ("removed by the host", lobby full, version mismatch) had no listener | Keystone toasts |
| `player-card.js` injected global CSS that hit the boards' `.player-card`; lobby CSS enlarged the HUD scoreboard header | Scoped |
| Results chat showed empty messages; non-hex player colours fell back to one colour | Fixed |
| Escape on Records, Replays or game over opened Settings on top | Escape goes back (game over: to the main menu) |
| Any click inside the game-over sheet restarted the game | Only Play again, Enter/Space or a controller face button restart |
| A controller A that started a key capture was bound immediately; B or Escape during a capture closed Settings; Escape with an option list open closed Settings | Captures and lists own their keys |
| "Reset all bindings" only reset gamepads; resetting keys left the key tiles stale | "Reset controller bindings", tiles refresh |
| An imported replay's `gameMode` was inserted as HTML | Escaped |
| Replays: focus was lost after a delete; the browser never fired `modalShown`/`modalHidden` | Focus moves on; events fire |
| Typing in the theme search fired Serenity's shortcuts (B random theme, T, F, H, Space) | The search owns its keys; the first Esc clears it, the second closes the Hub |
| Space/Enter on a Hub button also reached the game; the closed Hub could still take focus | Contained in the Hub; the closed Hub is inert |
| A Hale flow or breathing guide opened from the main menu let Space/Enter reach the menu (and reopen the Hub) | The menu stands down while either is open |
| A global `.gamepad-focused { outline: … !important }` drew an indigo ring over every focus style | Removed; the cream outline and the keystone mark focus |
| Hub tab panels were labelled by themselves; `serenity-hub.css` redefined `@keyframes pulse` for the whole game | Labelled by their tabs; Hub keyframes are its own |
| Tabbing to "Back to Map" in the Odyssey failure sheet and pressing Enter retried the level | A focused button owns Enter/Space; Retry takes focus when the sheet opens |
| The Odyssey HUD progress fill filled its whole section (an unscoped absolute `.progress-fill` in `serenity-hub.css`) | The HUD keeps its fill in flow inside the track |
| The countdown plate, Odyssey HUD and single-player stat rail blurred the live scene every frame | Opaque layered fills |
| The online countdown named four keyframes that were never defined (it never animated), blurred the board at 15 px and counted in a traffic light to a green "GO!" | Keyframes defined (scale only — its inline opacity/transform are `!important`); the spectrum walks to a coral GO, Unbounded, no blur |
| Replay controls were emoji glyphs named only by `title`, and the speed menu kept showing the last speed after a new replay reset to 1× | SVG buttons with labels; the speed row follows the player |
| Odyssey results, failure, navigator and board views each injected a `<style>` block at runtime | Styles live in `keystone-overlays.css` |

---

## 5. Surfaces

| Surface | Layer | Status |
|---|---|---|
| Main menu, dock, corner tiles, player card | `keystone-menu.css` | Shipped |
| Settings (also the pause sheet), Records, Replays, game over, replay complete | `keystone-settings.css`, `keystone-modals.css` | Shipped |
| Serenity Hub (Themes, Music, Breathing, Hale sessions), Hale flow, breathing guide chrome, Serenity controls overlay | `keystone-hub.css`, `breathwork-sessions.css`, `breathing-library.css`, `breathing-guide.css` | Shipped |
| Multiplayer (local setup, lobby browser, create match, waiting room, results, toasts, invite, in-game HUD type) | `keystone-multiplayer.css` | Shipped |
| Loading, countdown, Odyssey overlays and HUD, replay playback bar, single-player and Infinity HUD type | `keystone-overlays.css` | Shipped |

### 5.1 Settings, pause, Records, Replays, results (`keystone-settings.css`, `keystone-modals.css`)

Shared behaviour lives in `src/ui/sheet-input.js`: Escape and controller B go back on
every sheet, Tab and gamepad navigation stay inside the open sheet (the mode list behind
used to take the input), each sheet focuses its main control on open and hands focus back
on close.

- **Settings** is one sheet with icon tabs (full ARIA tabs; arrows, Home/End, Q/E or
  LB/RB switch section). Every row is a label, a line of help (`aria-describedby`) and
  its control: switches say On/Off, sliders fill with the spectrum and show a unit chip,
  selects use the restyled option list. Controls is rebuilt: player-coloured navigation,
  key tiles with arrow glyphs and spoken labels, a controller status list, Detect and
  Reset in the overview.
- **Pause:** pausing opens Settings as a "Paused" sheet — a strip with the mode
  ("Single Player waits where you left it"), Resume as the primary (focused first) and
  Main menu. From the main menu the strip is hidden.
- **Records:** "Your best", a ranked list (rank tiles in gold/silver/bronze for 1–3,
  level · lines, date, Watch when a replay exists) and six statistics as fact tiles;
  empty and error states.
- **Replays:** cards with a mode chip, date, time and four stats; icon buttons with
  names; Import in the header; a status line instead of `alert`/`confirm`; delete asks
  for a second press; empty, loading and error states.
- **Game over** keeps "The cycle ends." with a hero score, rank chips (no "New record"
  for a 0-point game), four cards (Performance, Pace, Career best, Session), an unranked
  variant, the Steam leaderboard restyled, and **Play again** as the primary with Main
  menu beside it. **Replay complete** uses the same layout: Watch again, Browse replays,
  Main menu.

`settings-aaa.css`, `high-scores-aaa.css`, `demo-browser-aaa.css` and `game-over-aaa.css`
are deleted (their structural rules ported first); the demo-complete and `.demo-btn`
rules left `overlays-aaa.css`.

### 5.2 Multiplayer (`keystone-multiplayer.css`)

Sheets share `src/ui/components/mp-sheet.js` (layers with a back stack: Escape, ✕ and
Back always return to the screen you came from) and an in-app confirm in place of
`window.confirm`.

- **Local setup** ("Local versus"): seat cards in the team hues (sky, rose, mint, gold)
  with kind, bot skill, team and handicap; rules as segmented controls and steppers with
  "More rules"; Start match as the primary, Back quiet; inline errors; the last setup is
  remembered (`serenity.localMatch.lastSetup`). `buildLocalMatchConfig` is unchanged.
- **Lobby browser** ("Online versus"): Create match, Refresh, Join by ID; rows with a
  capacity meter and "2/4", the win condition in words, a status chip and Join / Drop
  in / Watch / Full with drawn icons; empty state and a match count.
- **Create match** returns to the browser on Cancel/✕/Escape; a failed create keeps the
  sheet open with the reason, a failed join keeps the browser open with the reason.
- **Waiting room:** three columns; player cards in their colour with ready / host / you
  states; Ready ↔ Not ready; the host's Start match is the primary; Leave and Kick
  confirm in-app.
- **Results:** online results lead with the winner and a standings table (player
  colours, tabular numbers); local results moved out of `LocalMultiplayerMode` into
  `src/ui/local-match-end-overlay.js`. Rematch / Play again takes focus; Escape is Main
  menu.
- **Toasts** (`src/ui/components/toast.js`): `serenity:toast` events now show —
  bottom-centre, announced politely, auto-dismiss, no blur. The invite toast is an
  alert with focusable Decline and Join and a draining bar.
- **In-game HUD:** type and colour only. Every panel box was compared against HEAD's
  stylesheets at 1600 × 900 and 1280 × 720 and matches; `.player-card[data-player]` and
  `.single-player-stats-bar` keep their names (themes read them).

`lobby-styles.css`, `match-config-styles.css`, `match-config-aaa.css`,
`lobby-browser-aaa.css` and `lobby-room-aaa.css` are deleted (3,537 lines);
`multiplayer-ui.css` went from 4,470 to 3,426 lines. `LocalMultiplayerMode.js` dropped
from 3,822 to 3,198 lines (the dead `_showRoundEnd` and the extracted results overlay);
the fitness ceilings are lowered to match.

### 5.3 Serenity Hub (`keystone-hub.css`)

**Before:** a centred glass box titled in spaced Orbitron, mono copy, a red ✕, pill chips
and saturated purple/teal/green thumbnail backdrops behind every theme orb.

**After:**

- **One sheet** with the open corner and keystone, an eyebrow per tab ("Breath · The world
  you play in", "What you hear", "Rhythms to follow", "Guided journeys"), the title
  "Serenity Hub", a labelled Close (Esc / B) and a solid scrim. Tabs are an ARIA tab strip
  with a spectrum underline (←/→, Home/End, LB/RB; Tab still moves between controls), each
  tab keeps its scroll position, and the footer carries the hints. Focus lands on the
  title when the Hub opens.
- **Themes:** a labelled search that also matches categories ("Nature" finds the biomes),
  category chips with counts (`aria-pressed`), "Try a random theme", the current theme's
  card carries the keystone and a "Current" label, an empty state with "Clear filters".
  The 3D tilt is gone; lazy thumbnails and `content-visibility` stay.
- **Music:** the track in Unbounded with "Track 09 of 36", a keyboard-operable seek
  slider (arrows ±5 s, Page Up/Down ±30 s) that fills with the spectrum, a coral
  play/pause between named previous/next, labelled volume sliders, playlist rows as
  buttons with `aria-current` on the playing track.
- **Breathing:** one coral Begin, the keystone on the chosen world, Keystone toggles.
- **Hale sessions and the flow:** catalogue, a prepare panel with the open corner, a
  four-beat meter on the countdown and a completion screen with the holds as bars.
- **Breathing guide chrome and the Serenity controls overlay (`/`):** keycaps for every
  key, the controls overlay built from the player's own bindings, the end confirmation's
  controller line as A / B keycaps.

`serenity-hub.css` went from 2,576 to 412 lines (only the floating icons remain);
`serenity-hub-aaa.css` (1,297) and the unreferenced `scroll-opt.css` are deleted. Every
bare generic rule the Hub used to leak (`.progress-*`, `.section-title`, `.control-btn`,
keyframes `pulse`/`spin`/`float`) is gone.

### 5.4 In-game overlays (`keystone-overlays.css`)

**Before:** Orbitron and Space Mono over violet glass; every Odyssey view injected its
own styles from JavaScript; the countdown was a traffic light (green, amber, red, then
a gold "GO!") on a plate blurring the scene at 24 px; "VICTORY LAP" / "COMPLETE!"
shouted from the HUD.

**After:**

- **Countdown** walks down the spectrum: 3 lavender, 2 aqua, 1 mint, then **GO** in
  coral as the keystone tile drops into the plate's open corner (one Web Animations
  drop per count; `data-count="high|two|one|go"` on the layer drives the CSS). The plate
  is opaque; nothing blurs the scene that is about to start.
- **Odyssey results and failure** are Keystone sheets built by
  `src/ui/odyssey/keystone-sheet.js` (`createKeystoneSheet`, `appendKeyHint`): the
  level's name is the hero, earned stars land in gold one beat apart, score / lines /
  time are fact tiles, and there is one coral action (Continue, Retry) with key and
  controller hints. The unranked notice ("Experimental Session · Unranked") is kept.
- **Goal complete** is a quiet banner at the top with the keystone and an
  `Enter Finish` hint; play continues underneath.
- **Navigator** (`#odyssey-level-select`): chapters as panels, levels as tiles, the next
  level carries the keystone, Odyssey's gold identity, and the real star total
  (`★ earned / max` from the progress summary).
- **Board view** (`#odyssey-board-overlay`): header bar, chapter arrival card and level
  panel restyled; the level panel's tip is a `.level-tip` line, not inline styles.
- **Odyssey HUD**: Unbounded numbers, Manrope text, a gold chapter label, a spectrum
  bar in a tile-cornered track, sentence-case copy ("Clear 32 lines", "Victory lap",
  "Complete") and a keycap for Enter. READY / GO cues use the same type (READY aqua,
  GO coral).
- **Single-player stat rail and Infinity HUD**: Unbounded numbers, Manrope labels, no
  backdrop blur. The rail keeps its sizes — themes read its rect for composition.
- **Replay playback bar** (`#playback-controls`, `src/ui/playback-controls.js`): a
  two-row card in the bottom-left corner beside the board (at 1280 × 720 only ~40 px
  remain under the board, so a centred bar would cover cells). Play/pause is the coral
  primary with a visible label, Stop is quiet, "Replay 01:23 / 04:56" in Unbounded, the
  position fills with the spectrum, and speed is a radio row of tiles (0.5× 1× 2× 4×,
  arrow keys move it) that follows the player — a new replay starts at 1×.

Kept for JavaScript and tests: `#odyssey-results-modal`, `#odyssey-failure-modal`,
`#goal-complete-overlay`, `#odyssey-level-select` and its `#odyssey-*` value ids,
`data-odyssey-wheel-lock`, `.steam-leaderboard-panel`, the "Back to Map" label.

`odyssey-aaa.css` went from 1,317 to about 400 lines: the preview, results and
level-card rules left with the markup they styled. What remains is the navigator's
show/hide base and the HUD layout.
