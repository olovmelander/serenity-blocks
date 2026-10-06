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
- `src/ui/keystone/` — input mode, the focus marker and the in-game play rail.
- `src/ui/local-versus-hud.js` and `src/ui/local-versus-layout.js` — local versus: the
  match bar, the name plates, the stats lines and the board sizing (§5.6), out of
  `LocalMultiplayerMode.js` (−569 lines).
- `src/ui/main-menu/main-menu.js` — the main menu (imported by `main.js` in place of
  `menu-card-interactions.js`, which it imports in turn; `main.js` stays at its line
  ceiling). It also imports `components/toast.js`, so the `serenity:toast` listener is
  installed at boot.
- Shared input: `src/ui/sheet-input.js` (Settings, Records, Replays, results: Escape / B
  back, focus trap, initial focus), `src/ui/components/mp-sheet.js` (multiplayer back
  stack, in-app confirm), `src/ui/odyssey/keystone-sheet.js` (Odyssey sheets). The
  gamepad controller scopes navigation to whichever of these is on top.
- A legacy layer is deleted once its surface's keystone layer fully replaces it. Gone:
  `menu-aaa.css`, `settings-aaa.css`, `high-scores-aaa.css`, `demo-browser-aaa.css`,
  `game-over-aaa.css`, `serenity-hub-aaa.css`, `lobby-browser-aaa.css`,
  `lobby-room-aaa.css`, `match-config-aaa.css`, `lobby-styles.css`,
  `match-config-styles.css`, `scroll-opt.css`. Still loaded for structure and layout,
  with their dead rules pruned: `odyssey-aaa.css` (navigator base, HUD layout),
  `overlays-aaa.css`, `multiplayer-ui.css`, `multiplayer-hud-aaa.css`,
  `single-player-hud-aaa.css`, `serenity-hub.css` (floating icons only) and `main.css`.
- Pruning was mechanical and conservative: a rule went only when a class or id it needs
  appears nowhere in `src/`, `index.html`, `electron/` or `public/` scripts, and was not
  built from a template. In `main.css` only menu-related dead rules went (−1,482 lines);
  the ~400 dead tokens left there belong to the old DOM theme effects and are the theme
  owners' call.

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
  the existing global controls, so every existing handler keeps working; in game those
  controls live in the play rail (§5.5). Desktop builds end the
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
| The floating Hale sessions pill crowded every mode (Serenity most), and with the corner tiles covered the online chat and, on phones, the board | One play rail; Hale lives in the Hub (§5.5) |
| The controls took the online chat's corner (the chat column was shortened for them) and sat on player 4's board in 4-player local versus | One identical tray at the top-right in every mode; the layouts keep that corner free (§5.5) |
| Rotating left with Y opened the Serenity Hub mid-run in every mode; LB/RB, LT/RT, L3 and R3 reached the Hub's music, volume, random-theme and fullscreen shortcuts during play | Serenity's pad shortcuts apply in Serenity Mode (and in the open Hub) only |
| A controller could not reach the Hub outside Serenity | Serenity Hub on the pause sheet (Start, then the button) |
| The D-pad stuck on the pause sheet's Resume: the focus finder's `[href]` matched the buttons' SVG `<use href>` icons | One `FOCUSABLE_SELECTOR` (`a[href]`, not `[href]`) for spatial navigation and the sheets' Tab trap |
| Opening the Hub in an Odyssey level left the level running behind it | The Hub pauses Odyssey as Settings does |
| The online scoreboard hid every name at ≤1200 px windows (0 px left for them), cut names to six letters at 1600 px, and its status pill spilled out of the row | Names take the row's free width (about 19 characters at 1024 px; with frags and score both shown in every window wider than 1200 px, 17 at 1280–1366 px, 19 at 1600 px and about 29 at 1920 px; longer names end in an ellipsis with the full name on hover); status always shows (§5.2) |
| Timed matches are won on score, but both scoreboards ranked them by frags (the gold leader could be the wrong player); a lines match never showed lines | Both rank and lead with the number that decides the match (`src/ui/scoreboard-metrics.js`) |
| Local versus showed every number twice — a standings bar on top (frags, score, level, lines) and a six-icon bar under each board (frags, deaths, score, lines, level, incoming) — named players only by a colour square, and ranked a 0–0 start 1st, 2nd, 3rd, "4th" | One place per number: the deciding number on each board's name plate, ranked only once someone leads (ties share a place); the rest on one labelled line under the board; the match in one bar (§5.6) |
| Local boards said only "P1"–"P4": no names, no sign of a bot, no hint of who plays on which keys | Each plate names the player, their keys or controller, or the bot and its skill; each human board shows its controls for the first seconds (§5.6) |
| Four-player local versus overflowed a 1024 px window (the stage had `min-width: 1200px`) and its standings bar ran under the tray | The boards are sized to the window for 2–4 players, 1024 px to 4K, the next queue in a row above each board (§5.6) |
| The local next previews were fitted to the pieces' rotation matrices (the I piece's 4 × 4, the others' 3 × 3), so the I drew at a quarter of its room and every piece sat off-centre | They fit and centre the piece itself, with the single-player queue's trim (now shared, `trimShape` in `canvas-drawing-utils.js`) |
| Local garbage was a slab in the attacker's own colour, so it read like a stack of their pieces | Solid slate, faintly tinted by the attacker; holes stay plain to see (§5.6) |
| The falling piece showed faint bright lines between its cells: its gloss was drawn cell by cell with overlapping rects in additive blend, so every overlap doubled | The gloss is one exact rect per run of cells; every mode's pieces are seamless (`glossPass` in `base-board-scene.js`) |
| The garbage meter sat inside the well as a dark channel: the stack met the right wall but stopped short of the left one, and an empty meter could not be seen | The meter stands outside the left wall as a visible track; the pieces meet both walls (§5.6) |
| Local timed matches promised "the highest score when time runs out wins", but the standings ranked by frags and the match went to whoever won the last round | Timed matches rank, lead and are won on score, for players and teams; the clock is in the match bar and turns to "Last round" at zero |
| In team play a frag goal counts rounds won, but the standings summed players' frags | The match bar races teams by their rule (rounds won, or the team's points or lines); each teammate's goal bar fills by the team |
| A knock-out showed a 💀 emoji and "ELIMINATED" in red Arial | A Keystone card: "Out", the seat's colour, "Back next round" |
| A "NET" badge of raw network numbers (RTT, loss, snapshot rate) sat over every online match | Removed; the numbers stay in the console's network summary for diagnosis |
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
| A Hale flow or breathing guide opened from the main menu let Space/Enter reach the menu (and reopen the Hub), and the menu kept animating underneath | The menu stands down while either is open; both count as menu surfaces, so the menu behind them is marked covered |
| A global `.gamepad-focused { outline: … !important }` drew an indigo ring over every focus style | Removed; the cream outline and the keystone mark focus |
| Hub tab panels were labelled by themselves; `serenity-hub.css` redefined `@keyframes pulse` for the whole game | Labelled by their tabs; Hub keyframes are its own |
| Tabbing to "Back to Map" in the Odyssey failure sheet and pressing Enter retried the level | A focused button owns Enter/Space; Retry takes focus when the sheet opens |
| The Odyssey HUD progress fill filled its whole section (an unscoped absolute `.progress-fill` in `serenity-hub.css`) | The HUD keeps its fill in flow inside the track |
| The countdown plate, Odyssey HUD and single-player stat rail blurred the live scene every frame | Opaque layered fills |
| The online countdown named four keyframes that were never defined (it never animated), blurred the board at 15 px and counted in a traffic light to a green "GO!" | Keyframes defined (scale only — its inline opacity/transform are `!important`); the spectrum walks to a coral GO, Unbounded, no blur |
| The Steam player card said "Offline" twice (status line and pill) in Orbitron with pill chips | One "Offline" with the reason in its tooltip; Keystone type and tile chips |
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
| In-game controls (the play rail: Levels, Serenity Hub, Settings) | `keystone-overlays.css`, `src/ui/keystone/play-rail.js` | Shipped |
| Local versus (match bar, name plates, boards, stats lines, knock-out and controls cards) | `keystone-versus.css`, `src/ui/local-versus-hud.js`, `src/ui/local-versus-layout.js` | Shipped |

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
  ("Single Player waits where you left it"), Resume as the primary (focused first),
  Serenity Hub and Main menu. From the main menu the strip is hidden.
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
- **Scoreboard** (`src/ui/online-scoreboard.js`, rules in `src/ui/scoreboard-metrics.js`
  shared with the Tab scoreboard): ranked by the number that decides the match — frags,
  score for points and timed matches, lines — shown first in bold, with the second number
  beside it when the info column is at least 300 px, which it is in every window wider
  than 1200 px (the Tab scoreboard always shows both). The head and every row share one
  grid (subgrids): the number and status columns are as wide as their widest entry, each
  keeping room for its usual size from the start (`data-primary`), and names take the
  rest — with both numbers about 17 characters at 1280–1366 px and 19 at 1600 px (one
  fewer in timed matches, whose score leads). A name ends in an ellipsis only when it must
  (the full name is the cell's title); "You" is a tag that never covers your name's start.
  Every row ends in its status (Alive, Out, Waiting). Rank is a numeral, gold / cream /
  bronze for the top three, so the trophy keeps meaning score as it does under the
  boards; the metric heads use the stat bar's icons, named for screen readers. The info
  column is the container (`container: sb-info`): below 300 px (260 px at ≤1200 px
  windows) the second number steps aside and names get about 19 characters (14 when a
  score leads), and up to 309 px the panel's sides tighten to 12 px; with five or more
  players the rows tighten so the battle log and chat keep their room.

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
  controller hints. The unranked notice ("Experimental Session · Unranked") is kept, and
  the Steam leaderboard panel uses the same Keystone treatment as on game over.
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

---

### 5.5 In-game controls: the play rail (`src/ui/keystone/play-rail.js`)

**Before:** separate floating tiles stacked up the right edge (the Serenity Hub lotus, the
settings gear, Odyssey's navigator) plus a 190 px "Hale sessions" pill beside them in
every mode. A first rail gathered them into one row in the bottom-right corner — the right
idea in the wrong place: online versus shortened its chat column to make room, the row sat
on player 4's board in 4-player local versus, the lotus and gear were the old filled
drawings with an idle blurred glow, and nothing named them.

**After:** one tray at the top-right, identical in every mode — the same place (16 px
from the top and right edges), size, icons, names and keys. The bottom of the screen
belongs to the game: boards, chat, stats, touch controls and toasts.

| Control | Shown | Name and keys |
|---|---|---|
| Levels | Odyssey's board view | "Levels" |
| Serenity Hub | every mode | "Serenity Hub"; H in every mode (the Hub key, rebindable), Y on a pad in Serenity |
| Settings | every mode, outermost | "Settings"; Esc / ☰ (no Esc in Serenity, where Escape goes back to the menu). While a game runs it opens the pause sheet |

- **The tray:** a small night tile in the corner holding the main-menu dock's line icons. It rests at 72 % opacity and wakes under
  the pointer or focus; names and keys appear beneath it on hover or focus. No idle motion
  (the lotus glow is gone); a mint ring breathes in the Hub tile only while a breathing
  session runs. In Serenity the tray leaves with the cursor (`cursor-hidden`).
- **Named on the first runs:** the first three runs of each mode unroll the names inside
  the tray for 3.6 s once the tray is actually in view (after the loading veil and the
  countdown), then fold them back (`serenity.playRail.peeks`). Not on touch screens, not
  in Odyssey's board view.
- **The layouts make room, the tray never moves.** Online versus gives its grid a toolbar
  row (`auto 1fr`, the opponents column a subgrid): the spectator toolbar on the left and,
  on the right, `.sb-play-room`, an empty slot the tray floats in, so the scoreboard starts
  below it and the chat runs to the bottom corner; below 901 px the stacked spectator row
  ends before the tray. Local versus puts its match bar in the tray's row and starts the
  boards below it (§5.6). Odyssey's board header lines up with the tray and ends its chips
  before it; there the tray sits above the board overlay (whose header takes the
  pointer) and the level list it opens (z-index 1003). The metrics are tokens on `:root`
  (`--sb-play-tile`, `--sb-play-inset`, `--sb-play-tray`) so every reservation follows
  the tray.
- **Differences kept on purpose:** Levels shows on the Odyssey map alone (it does nothing
  elsewhere); touch screens get 44 px tiles and no keyboard keys; phones a 6 px corner,
  with the single-player board starting beneath the tray; Serenity fades the tray while
  the cursor rests.
- **Every input reaches both:** pointer and touch through the tiles; keyboard Esc and H;
  a controller through Start, then the pause sheet's **Serenity Hub** (it closes the sheet
  as Resume does and opens the Hub as its tile does, in one task, so no frame of play runs
  between; the Hub pauses again). Serenity keeps Y and Start. H leaves text fields alone,
  steps aside when a player has the key bound, and closes an open Hub.
- **Fixed with it:** Serenity's pad shortcuts were live in every mode (the always-loaded
  Hub registers them at startup); they now apply in Serenity Mode and in the open Hub
  only (`GamepadController.serenityShortcutsLive`). The Hub now pauses an Odyssey level
  as Settings does. The D-pad no longer sticks on the pause sheet
  (`FOCUSABLE_SELECTOR`, `src/ui/spatial-navigation.js`).
- The rail **adopts** the existing controls (`#odyssey-navigator-btn`,
  `#serenity-hub-icon`, `#settings-btn-global`): ids, handlers and the code that shows,
  hides or activates them are unchanged. It is hidden on the main menu (the dock replaces
  it) and while the breathing guide or a Hale flow is open.

### 5.6 Local versus (`keystone-versus.css`)

Couch play for two to four people, so every board answers "whose is this, how do they
play, and how are they doing" at a glance, and every number lives in one place.

- **The top row:** the match bar, centred in the tray's row (the tray keeps the right):
  the mode (Free-for-all, Teams, Hot potato, Infinity) after the keystone tile, the goal
  ("First to 7 frags", "First team to 7 rounds", "Highest score in 3 min", "Last one
  standing"), the round, the clock in a timed match (coral under 30 s, "Last round" at
  zero) and, in team play, each team's total by the team rule. Below 861 px it keeps the
  goal and the clock.
- **A station per player** (`.player-card[data-player]`, which themes read for their
  composition, keeps its name and box): a name plate, the next queue in a row over the
  well's open top, the well (the board between its walls) with the incoming-garbage
  meter just outside its left wall, and one line of stats under the board.
- **The name plate:** the seat (P1–P4) in its colour, the name, how they play ("Arrow
  keys", "WASD", "Controller 3", "Bot · Master", read from the key bindings), a team chip
  in team play, the rank once someone leads (gold, cream, coral; ties share a place;
  teams are ranked in the bar instead) and the number that decides the match with its
  unit (Frags, Points, Lines, To roof), a bar along its foot filling toward the goal (by
  the team's total in team play). An eliminated player's plate dims until the round ends.
- **The next queue:** above the board, "Next", then the next piece in a tile lit with the
  seat's hue and the two after it smaller and quieter, standing in line on the well's
  mouth. The tiles are wide, as pieces are, and each preview fits and centres the piece
  itself (not its rotation matrix), so it draws at about half a block.
- **The well:** the board has no lid. Its walls rise from the floor in the seat's hue and
  fade out toward the top, the glass is plain (no lines on the board), and the pieces
  meet both walls. The garbage meter stands just outside the left wall: a quiet track
  that fades in from the open top like the walls and fills from the floor with incoming
  garbage (20 lines fill it; from 8 it glows); an attack lands in it with a flash and a
  "+n" on the board beside it. When the stack is within five rows of the top the walls
  turn coral and breathe, and they calm only once it is three rows lower (no flicker at
  the line). A knocked-out well goes quiet. The whole well, meter included, shakes and
  dips with the board's juice.
- **The boards' look (`src/rendering/phaser/versus-board-style.js`, local versus only):**
  pieces and the stack keep the game's solid, fused shapes. Garbage is one solid slate
  fill faintly tinted by the attacker, so it never passes for a stack of pieces and its
  holes stay plain to see. The ghost is the piece's own colour, faint inside and
  outlined, where it will land. Single player and the themes keep the base look
  (`BaseBoardScene.setVersusStyle`, turned on by `local-board-hosts.js`).
- **The match told as it happens:** a streak flies from the attacker's board to each
  target's meter with the lines it carries; a frag pops "+1" on the plate; the
  knock-out card names who did it ("By Ada" in their colour) or says "Topped out"; and as
  the next round starts a banner gives the result ("Round 2 · Ada takes it", "A draw",
  "Topped out, no frag"). Reduced motion keeps the facts and drops the flight.
- **The stats line** shows what the plate does not: level, lines, score or frags. Deaths
  and incoming garbage left the live HUD (the results keep deaths; the meter shows
  garbage).
- **Sizing (`local-versus-layout.js`):** the largest block that fits below the top row
  with the queue above every board; stations wrap onto two rows on tall windows. Plates
  and type scale with the block (×0.85–1.6), the smallest type never below 8 px. The
  sizes reach the stylesheet as variables on `#multiplayer-container` (`--lv-block`,
  `--board-width`, `--lv-next-w`, …, `data-rows`), never on `:root`, so other modes'
  boards never inherit them. Board sizes (px): with the queue above every board, two and
  three players give up about a tenth of the height the queue beside the board allowed
  (1920 × 1080: 440 × 880 before), and four players gain or keep theirs, the tiles being
  wider than tall:

  | Window | 2 players | 3 players | 4 players |
  |---|---|---|---|
  | 1024 × 768 | 270 × 540 | 270 × 540 | 210 × 420 (overflowed before the redesign) |
  | 1280 × 720 | 250 × 500 | 250 × 500 | 250 × 500 (was 240 × 480) |
  | 1366 × 768 | 270 × 540 | 270 × 540 | 270 × 540 (was 260 × 520) |
  | 1920 × 1080 | 410 × 820 | 410 × 820 | 410 × 820 (was 390 × 780) |
  | 2560 × 1440 | 560 × 1120 | 560 × 1120 | 560 × 1120 (was 530 × 1060) |

- **Knock-out:** the board fades and dims as before, and a card rises: "Out", a stroke of
  the seat's colour, who did it, "Back next round".
- **Controls card:** for the first six seconds of a match each human board shows its
  keys as keycaps on the board's foot (Move ← →, Turn ↑ Z, Drop ↓ Space; a controller's
  D-pad, A Y, ↓ B). The setup sheet says the same under each seat ("Arrow keys ·
  Controller 1", "Controller 3", a bot "Plays on its own"); both read
  `src/ui/local-seat-controls.js`.
- **Hot potato:** the holder's plate glows coral and a chip on its top edge, over the
  deciding number's corner, counts down.
- **Rules made consistent:** timed matches are won on score (what the setup sheet
  promises), for teams on the team's score; the results say the same goal as the bar.
- Hooks kept: `#p{n}-phaser-container`, `#p{n}-next-0…2`, `#p{n}-garbage-bar`,
  `.player-card[data-player]`, `.hot-potato-holder` / `data-potato-time`,
  `.infinity-lms` (the minimap sits beside the board). Gone with the old HUD:
  `#global-standings-hud` and its CSS in four stylesheets, the per-board six-stat bars
  (`#p{n}-frags` …), the avatar header, the inline colours `_applyPlayerColors` wrote (it
  now sets the seat's hue variables only), the queue beside the board (`data-queue`), and
  the mode's own garbage-meter writes (the HUD fills the meter from `incoming`).
- **Online:** the "NET" network badge (`src/ui/network-qos.js`) and its styles are gone.

## 6. Verification

- Every surface captured with Playwright (Chromium, WebGPU) at 1600 × 900 and 390 × 844,
  most also at 1280 × 720, before and after; controller paths driven with a simulated
  standard pad (game over B / A, multiplayer back, sheet focus).
- The play rail: every mode's layout measured for free zones (single, Infinity, Serenity,
  local versus for 2–4, online for 2 and 4) at 1024 × 768, 1280 × 720, 1366 × 768,
  1600 × 900, 1920 × 1080, 820 × 1180 and 390 × 844, then the result captured in each;
  Odyssey's board header rendered on its own (its world needs a GPU). The pad drove
  Y in play (no Hub), Start → D-pad → Serenity Hub → A (Hub open, game paused) → B
  (resumed); the keyboard drove H, Esc and the pause sheet's Serenity Hub.
- Gates on the final tree: `npm test` (579 files), `npm run typecheck`,
  `node scripts/ts-ratchet-check.mjs`, `npm run lint:ci` (baseline lowered 1,033 → 831),
  `node scripts/architecture-fitness-check.mjs` (ceilings lowered),
  `npm run audit:theme-lifecycle`, `npm run check:boundaries`,
  `npm run perf:budgets:gate`, `npm run check:release-gates`, `npm run build` (boot
  closure), `npm run check:ip-strings`, `npm run check:pages-artifact`.
- Local versus (§5.6): 2–4 players captured and measured at 1024 × 768, 1280 × 720,
  1366 × 768, 1600 × 900, 1920 × 1080, 2560 × 1440, 3840 × 2160 and 390 × 844 (no station
  past the window at any size), and a knock-out, team play, Hot potato, a timed match to
  its last round and results, a score race and Infinity captured from real matches set
  up through the sheet; unit tests for the layout and the HUD
  (`tests/unit/local-versus-*.test.js`). The well, the queue above the board and the
  boards' look captured again from all-bot and human-seat matches at 1024 × 768,
  1280 × 720, 1366 × 768, 1600 × 900, 1920 × 1080 and 1080 × 1920 (2–4 players, Infinity,
  Hot potato), with the danger walls checked against the stacks' heights; preview fit in
  `tests/unit/next-preview-presentation.test.js`.
- No `backdrop-filter` remains on any Keystone surface.

## 7. Open follow-ups

- **One sheet primitive.** `keystone-modals.css` (`#… .sb-sheet`-style rules for
  Settings, Records, Replays, results), `mp-sheet.js` and `keystone-sheet.js` grew the
  same anatomy three times (open-corner panel, key, head, title, close, body, foot).
  Promote it to `keystone.css` as `.sb-sheet` and give multiplayer the labelled Close
  the other sheets use (it has an icon ✕ plus a footer Back).
- **More primitives** suggested by the surface work: segmented control, stepper,
  `.sb-sr-only`, `.sb-empty`, `.sb-tabs`, `.sb-chip--gold/--accent`, and a player-colour
  helper (`color-mix(in oklab, var(--player-color) 58%, #fff6e9)`).
- `main.js` writes inline colours on the controller status lines (Settings overrides
  them with `!important`); move them to classes when `main.js` has room.
- `SerenityMode._onKeyPress` should ignore keys typed into text fields centrally (the
  Hub's search guards itself today).
- The breathing guide's ELIXIR accent (255, 150, 120) sits close to coral and is pinned
  by a test; the Hub uses gold for ELIXIR. Moving the guide to gold would keep coral
  for the keystone alone.
