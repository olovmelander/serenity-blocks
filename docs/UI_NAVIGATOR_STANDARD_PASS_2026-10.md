# UI pass: every surface to the navigator's standard (2026-10)

**Status:** Reference (record of shipped work). Surfaces: the Odyssey map's header and orb
panel, the failure and results sheets, the journey flow (completion ceremony, chapter and
first arrival, travel cover, start cue), the campaign finale, the goal banner, the Stillfall
puzzle atlas, and the global menus (player card, main-menu light, Hale sessions, Replays, play
rail). Standard: the Odyssey navigator ([ODYSSEY_NAVIGATOR_2026-10.md](ODYSSEY_NAVIGATOR_2026-10.md))
and the charm guide ([ODYSSEY_CHARM_GUIDE_2026-10.md](ODYSSEY_CHARM_GUIDE_2026-10.md)), on Keystone
([MENU_UI_OVERHAUL_2026-10.md](MENU_UI_OVERHAUL_2026-10.md)).

## 1. Why (audit, 2026-10-21)

Every surface was captured in the real game (SwiftShader WebGL2) or in a DOM harness built from
its real modules and stylesheets with level data from the real registry, at 1600 x 900 and
1280 x 720, and measured. The navigator and the charm guide set a standard (the world as the
hero in a halo and orbit, a light per chapter or item, figures and cell meters, keycaps for
keyboard and pad, staged entrances) that the surfaces shown most often did not meet, and the
audit found these defects:

- **Map orb panel** centred with no height limit: boss, locked and rival panels grew over the
  header's chips and under the play rail at 1600 x 900, an ordinary orb did at 1280 x 720; no
  art, text glyph stars, the same orb drawn two different ways (navigator card, map panel).
- **Results sheet**: the leaderboard mounted before the buttons in a 500 px scrolling panel, so
  Continue sat below the fold at 1600 x 900; "You (pending)" pinned above #1.
- **Failure sheet** (every fall): a 500 px modal that never named or showed the orb; the road's
  mercy a two-line note; a lost duel nearly empty.
- **Completion ceremony** at short laptop heights: the "Found: ..." charm line broke the
  two-column grid into a staircase and cut off auto-continue, which kept counting.
- **Chapter and first arrival** at 701-820 px tall (Steam Deck 1280 x 800 included): Begin
  chapter and Map cut off; the first screen a new player sees.
- **Campaign finale**: eight identical numbered rings, the small reward card, every button below
  the fold at 1280 x 720.
- **Goal banner** covered the next-piece queue for the whole victory lap at 1280 x 720.
- **Start cue** used `backdrop-filter: blur` over the live game, against the overlay rule.
- **Player card** said "Loading... / Connecting..." forever in every browser build (the live
  Pages site): with no Electron IPC `steamService` went offline without an event, and
  `main.js` never initialises it there; it also injected violet, blurred pre-Keystone styles.
- Smaller: Hale sessions' Begin below the fold, a Replays sheet 300 px taller than its empty
  state, the play rail's labels overlapping, the HUD's Finish button's pad cap shrinking under
  its label, flow buttons without keycaps, the travel cover's empty lower half.

## 2. What changed

### Shared: one orb art for every surface that shows one orb
`src/ui/odyssey/odyssey-orb-art.js` builds the navigator's art (world, halo, orbit, lock, crown,
VS, number tab; states open, next, cleared, locked, failed) and its star row, and finds an orb's
theme the navigator's way (`odysseyLevelThemeId`: icon theme, path icon, primary).
`public/styles/odyssey-shared.css` holds it and the chapters' light (`data-ody-chapter` sets
`--ody-hue-rgb`). The map panel, both outcome sheets, the travel cover, the ordinary completion
and the finale use it.

### Map header and orb panel (`BoardInfoOverlay.js`, `odyssey-level-panel.js`, `odyssey-map.css`)
- The panel is a docked navigator card: the orb's world above its title (beside it below 820 px
  tall, a bottom sheet on phones), eyebrow and kind, chapter line, star row, the goal and star
  goals as facts, the charm line with live icons, Play (Play again, Locked) with Enter/A.
- It lives between the header and the bottom edge; its story scrolls on its own and Play stays
  in view. The flow preference is one quiet switch at its foot.
- The header: stars, orbs cleared and chapter as figures over a cell meter (each orb a cell in
  its chapter's light, the next orb coral), and the charm chip as a tile with live icons. It is
  drawn at most once a frame (`scheduleOdysseyMapHeader`) from OdysseyMode's progress update
  and selection; the mode's old text lines stay as the fallback.
- After a launch that does not start, a cleared orb's button says Play again (it said Play);
  Launching... reads Setting out, as in the navigator.

### Failure and results (`FailureModal.js`, `ResultsModal.js`, `odyssey-outcome-sheet.js`, `odyssey-outcome.css`)
- Both are wide sheets with the orb's world as the hero in the chapter's light; the eyebrow
  names orb, chapter and attempt, the orb's name is the title.
- Failure: the goal as a hero figure over a cell meter, the next-attempt tip beside it, the
  road's mercy as a gift card with the charm's live icon in its tone; a lost duel is a
  scoreboard (you, the rival, a cell per knockout). Retry (R/A) and Back to map (Esc/B) in a
  sticky footer.
- Results: art, result (stars, star notes, score/lines/time as figures, charms used, then the
  first-clear reward) and the leaderboard in its own column; Continue in a footer that never
  scrolls away. The pending row sits where its time ranks (`sortOrder`, `pendingLabel` in
  `steam-leaderboard-panel.js`; game over keeps its defaults); a charmed run gets none on the
  orb-time board, which does not take charmed times.

### Journey flow (`JourneyFlowOverlay.js`, `odyssey-start-cue.js`, `odyssey-flow.css`)
- Ceremony: named grid areas put the charm line under the reward and the next orb beside both;
  the side-by-side layout reaches 860 px tall; auto-continue holds while any control, the
  reward, the charm line or the next orb is cut off.
- Arrivals: a sticky action bar at every height and spacing that scales with the window; both
  fit 1280 x 720 and 1280 x 800. The New-breath pill moved out of the head.
- Keycaps (appendKeyHint) on Continue / Begin chapter / Resume (Enter/A) and Map (Esc/B), only
  where a key does that; during travel Enter pauses even with focus elsewhere.
- The ordinary completion and the travel cover show the orb's world (cleared / next), centred.
- The start cue's veil is a gradient (no blur) and its plate is measured to the well.

### Campaign finale (`CampaignFinale.js`, `odyssey-campaign-finale.js`, `odyssey-finale.css`)
The eight chapters climb as an ascent of their boss worlds, each named, in its light, with its
stars, joined by a line in their hues; the final theme takes the large reward card; orbs,
chapters and stars are figures over a 60-cell meter; every action has its key and pad button
(Explore Enter/A, Follow the next star N/X, View this orb's results R/Y); it fits 1280 x 720 and
1600 x 900 without scrolling and stacks on phones and with large text.

### Goal banner and HUD (`GoalCompleteOverlay.js`, `keystone-overlays.css`)
The banner sits in the play rail's top band, one line, centred over the well and clear of the
queue at every size; at 860 px and narrower it docks top-left. The HUD's Finish button lets a
long pad cap ("View / Back") take its own line instead of shrinking under the label.

### Stillfall puzzle atlas (`src/ui/stillfall/stillfall-atlas*.js`, `stillfall.css`)
The 116 puzzles in 10 tiers, once a text list in the side panel, are a full-page atlas in the
navigator's grammar: figures and a cell meter, the tiers as "The descent" (gems, cells, lock
notes that say what opens them), the tier's light on the page, the selected puzzle's card with
a preview of its starting structure drawn from the puzzle data, goal and pieces, and the tier's
puzzles as cards with previews. Keyboard, pointer and pad (Select opens, D-pad walks, LB/RB
tiers, A plays, B/Select closes) as before, with the press latching unchanged; P opens it. The
atlas module loads when Stillfall shows its first puzzle, not at boot (the main menu imports the
HUD for its counts), so the boot bundle does not carry it.

### Global menus
- **Player card**: browser builds show none (no Steam client, nothing to connect to; Online
  Versus already says Steam required). In the desktop app it reads `steamService` on build and
  on every show, so no missed event leaves it on its skeleton; the browser path emits
  `INIT_FAILED { source: 'no-ipc' }`. Restyled as a Keystone tile in `keystone-menu.css` (the
  injected style block is gone); hidden while a sheet covers the menu.
- **Main-menu light** (`src/ui/main-menu/menu-light.js`): the selected mode's hue lights the
  page around the stage, cross-fading on change (opacity only), reduced motion respected.
- **Hale sessions**: title beside its lede and shorter pictures on short sheets; Begin is in
  view at 1600 x 900 and 1280 x 720.
- **Replays**: the sheet sizes to its content (empty 720 to 440 px) with a proper empty state.
- **Play rail**: only the tile under the pointer shows its label; a label hides at once and
  only fades in; reduced motion turns the rail's transitions off.

## 3. Verification (2026-10-21)
- Unit tests: the whole suite (1,116 files, 21,225 tests) passed except two 3D-world tests that
  timed out while a build ran beside them and pass alone; the 248 files for the touched areas
  (3,271 tests) pass on the final tree. New tests cover the orb art, the map header (figures,
  meter, once a frame), the panel's Play label after a failed launch, the outcome sheets, the
  pending row, the finale's journey and keys, the goal banner, the flow's keycaps, cue fitting
  and auto-continue holds, the atlas model, the menu light and the player card.
- Gates: typecheck, TS ratchet, lint ratchet (525 errors, baseline lowered from 529),
  architecture fitness (OdysseyMode at its 4296 ceiling, core DOM globals 365 to 364), theme
  lifecycle, boundaries, perf budgets, release gates, build, IP strings, Pages artifact.
  The boot bundle's main closure is 1226 KB (1231 KB before).
- Screenshots of every surface before and after at 1600 x 900 and 1280 x 720, and where it
  applies 1280 x 800, 1024 x 768, 1920 x 1080, 2560 x 1440, 390 x 844, 844 x 390, gamepad mode,
  32 px root text and reduced motion; no overflow, clipping or overlap.
- The real game on SwiftShader: menu without the card in the browser build, map header and panel
  with art, the charm guide and the navigator, Stillfall's atlas over the board with the piece
  untouched; no page or console errors.

## 4. Open
- All captures ran the icon stage on its WebGL2 fallback (headless Chromium fails three r186's
  texture-view swizzle on WebGPU); a GPU look at the large live icons is still owed.
- With 32 px root text the completion ceremony scrolls without a sticky bar (auto-continue
  holds). (The main menu's overlap at large text was fixed in the 2026-10-21 audit:
  [MENU_UI_OVERHAUL_2026-10.md](MENU_UI_OVERHAUL_2026-10.md) §8.)
- The mercy card names the keyboard key only: a pad's charm button depends on the bindings.
- The board keeps rendering under the opaque navigator, charm guide and atlas.
- Not re-audited: online versus (needs Steam), game over, the local match results.
