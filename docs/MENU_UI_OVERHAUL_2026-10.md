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
| `.sb-eyebrow` (`--quiet`) | Spaced capitals with a tile bullet; colour from `--sb-accent-rgb` |
| `.sb-panel` (`--open`) + `.sb-key` | Night-glass panel; `--open` masks the top-right corner for the keystone sibling |
| `.sb-btn` (`--primary`, `--quiet`) | 48 px buttons; primary is the coral keystone |
| `.sb-kbd[data-key]` / `.sb-kbd[data-pad]` | Keycaps; the body class `sb-input-gamepad` swaps key hints for pad hints |
| `.sb-hints` | Footer hint list (`<ul class="sb-hints"><li><kbd …>Enter</kbd>Play</li>…`) |
| `.sb-chip` | Rounded-square tag |
| `.sb-meter > i` (`.is-filled`, `.is-current`, `.is-break`) | Progress drawn as cells; the current cell is the keystone |
| `.sb-divider` | A cleared line of tile dots |
| `input[type=checkbox].sb-toggle` | Switch whose knob is a tile; on = keystone |
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
  are hidden on the menu and restyled as keystone tiles in game.
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
| Tabbing to "Back to Map" in the Odyssey failure sheet and pressing Enter retried the level | A focused button owns Enter/Space; Retry takes focus when the sheet opens |
| The Odyssey HUD progress fill filled its whole section (an unscoped absolute `.progress-fill` in `serenity-hub.css`) | The HUD keeps its fill in flow inside the track |
| The countdown plate, Odyssey HUD and single-player stat rail blurred the live scene every frame | Opaque layered fills |
| Odyssey results, failure, navigator and board views each injected a `<style>` block at runtime | Styles live in `keystone-overlays.css` |

---

## 5. Surfaces

| Surface | Layer | Status |
|---|---|---|
| Main menu, dock, corner tiles, player card | `keystone-menu.css` | Shipped |
| Settings (also the pause sheet), Records, Replays, game over, replay complete | `keystone-settings.css`, `keystone-modals.css` | See below |
| Serenity Hub (Themes, Music, Breathing, Hale sessions, Hale flow) | `keystone-hub.css` | See below |
| Multiplayer (local setup, lobby browser, create match, waiting room, results) | `keystone-multiplayer.css` | See below |
| Loading, countdown, Odyssey overlays and HUD, single-player and Infinity HUD type | `keystone-overlays.css` | Shipped |

### 5.1 In-game overlays (`keystone-overlays.css`)

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

Kept for JavaScript and tests: `#odyssey-results-modal`, `#odyssey-failure-modal`,
`#goal-complete-overlay`, `#odyssey-level-select` and its `#odyssey-*` value ids,
`data-odyssey-wheel-lock`, `.steam-leaderboard-panel`, the "Back to Map" label.

`odyssey-aaa.css` went from 1,317 to about 400 lines: the preview, results and
level-card rules left with the markup they styled. What remains is the navigator's
show/hide base and the HUD layout.
