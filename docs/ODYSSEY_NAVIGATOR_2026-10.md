# Odyssey navigator: the journey at a glance (2026-10)

**Status:** Reference (record of shipped work). Surface: the chapter list that opens over the
Odyssey board (`#odyssey-level-select`) from the play rail's Chapters tile and from Chapters on
Settings' journey strip. Language: Keystone ([MENU_UI_OVERHAUL_2026-10.md](MENU_UI_OVERHAUL_2026-10.md)).

## 1. Why

The navigator was a scrolling column of chapter panels with numbered tiles. An orb's name and
world showed only in a hover tooltip, locked chapters looked like open ones, a tile press
launched straight away, and after Play the screen sat frozen for the whole board travel
(0.9 to 3.5 s behind an opaque overlay). Escape opened Settings on top of it, there was no
visible way back to the map, and keys and the controller had no part in it.

## 2. The surface

- **Header.** "Ascend · Chapters", the wordmark, three figures (stars, orbs cleared, chapters
  complete) and a journey meter: every orb as a cell, grouped by chapter, each chapter in its
  own light, the orb the journey waits on in coral. "Back to the map" (Esc, B) stands beside
  the play rail, which keeps its corner.
- **The ascent** (left rail, a vertical tab list). The chapters read from the bottom up, as
  the climb goes and as the map's keys go (Up is the next chapter). Each row: a gem in the
  chapter's light (lit when the chapter is complete, dashed with a lock while shut, a
  breathing ring on the chapter you are in, with "You are here"), the short name (the part
  before " & "), the orbs as cells and the stars. A line joins the gems, lit up to the
  furthest chapter reached.
- **The stage.** The chapter (number, subtitle, name, its narrative intro, stars, orbs and
  the previous/next steps), then the **card** of the selected orb: its theme artwork as the
  hero (frosted with a lock while shut; the orbit ring coral on the next orb, gold once
  cleared), its kind (chapter boss, rival duel, showcase) and state, the stars, the
  description, Play (Play again, or a neutral Locked) and Show on the map; beside it the
  goal, what each star asks, your best score and the reward (the theme and its song,
  "Collected" once cleared). The goal and star copy use the carried charms, as the map's
  panel does. Under the card, the chapter's **route**: every orb as its world in a ring,
  joined centre to centre (lit between cleared orbs, dashed toward shut ones), with the
  number, the name, the stars, a crown on the boss, VS on the rival and a Next flag.
- **The light.** `--nav-hue-rgb` per chapter (ember, ocean, meadow, glacier, dusk, starlight,
  violet, neon) colours the sky, the card's edge, the selection and the route; the selected
  orb's artwork, blurred, bleeds through the sky behind the card. The blur is one static
  image layer, never a backdrop filter, because the map keeps rendering underneath.

## 3. Behaviour

| Input | What happens |
|---|---|
| Click / tap an orb | Shows it on the card. Pressing the orb the card already shows sets out. |
| ← → (D-pad) | Walk the orbs, across chapter seams. Focus is the selection. |
| ↑ ↓, Page Up/Down (LB/RB) | Climb down and up the chapters. |
| Home / End | The first orb / the orb the journey waits on. |
| Enter, Space (A) | Play the focused orb (a key or pad press on an orb its focus already showed). |
| Esc (B) | Back to the map. Settings no longer opens over the navigator. |
| Show on the map | Closes the navigator and travels the board to the orb; the panel fills. |

- **Setting out** fades the navigator away at once ("Setting out" on the button, input
  blocked) while the board travels to the orb, then the journey entry plays. A launch that
  does not start brings the navigator back.
- Opening focuses the shown orb without scrolling; closing returns focus to the page, so the
  map's own keys answer again.
- The navigator is a Keystone sheet (`odysseyNavigator` in `src/ui/sheet-input.js`): Escape
  goes to its back control, Tab stays inside, and the controller's menu navigation is scoped
  to it (`processOdysseySheetInput`). LB/RB press the chapter steps (`switchMainTab`).
- Layout: rail beside the stage from 1101 px; below that the ascent becomes a strip of
  chapter chips above the stage, the card's facts move under it, and the page scrolls; below
  641 px the card stacks. The route lays out in balanced rows (fourteen orbs as 7 + 7). Short
  windows (≤ 780 px) tighten the card and route; tall ones grow the art and orbs and centre
  the ascent and the stage. Reduced motion keeps the layout and drops the breathing, the
  entrances and the departure fade.

## 4. Code

| File | Role |
|---|---|
| `src/ui/odyssey/LevelSelectOverlay.js` | The shell (header, rail, stage, footer). |
| `src/ui/odyssey/odyssey-navigator-model.js` | Pure: chapters, orbs and their states; where a look lands; what a key or a press does. |
| `src/ui/odyssey/odyssey-navigator-list.js` | Draws the model, runs selection, keys and the launch; `showOdysseyNavigator` / `hideOdysseyNavigator`. |
| `public/styles/odyssey-navigator.css` | The look (`#odyssey-level-select`), loaded after `keystone-overlays.css`. |
| `src/core/game-modes/OdysseyMode.js` | Unchanged contract: `openOdysseyNavigator`, `closeOdysseyNavigator`, `_launchLevelFromNavigator`, `navigateToChapter`. 69 lines lighter. |

Kept for JavaScript and tests: `#odyssey-level-select`, `#odyssey-chapters`,
`.odyssey-level-btn` (an orb), `.odyssey-level-stars`, `#odyssey-total-stars`,
`#odyssey-max-stars`, `#odyssey-back-btn` and the new-journey ids. Gone:
`#odyssey-progress-pct` and `#odyssey-progress-fill` (nothing read them).

## 5. Verification (2026-10-19)

- `tests/unit/odyssey-navigator-model.test.js`: states, chapter landing, selection, stepping
  across seams, press and key resolution against the real level registry.
  `odyssey-mode-level-entry.test.js` keeps the mode's half (travel, close, then the shared
  launcher).
- A DOM harness (real stylesheets, real registry, stub save) at 1600 × 730, 1600 × 900,
  1280 × 720, 1440 × 900, 1920 × 1080, 2560 × 1440, 1024 × 768, 844 × 390, 390 × 844,
  320 × 568 and 1280 × 800 with 32 px root text: no horizontal overflow, keys, clicks,
  Escape, the launch fade and reduced motion checked.
- The real game on SwiftShader WebGL2: map → navigator → keys → Escape → Enter → orb entry.

## 6. Open

- The board keeps rendering under the opaque navigator; pausing it while the navigator is
  open would save GPU time, but the board's pause and resume interact with prewarm and the
  reveal, so it is left for a measured pass.
- The ascent order (bottom-up) and select-then-play are design choices; both are one rule
  each to change (`flex-direction` on `.odyssey-chapters`, `resolveOdysseyOrbPress`).
