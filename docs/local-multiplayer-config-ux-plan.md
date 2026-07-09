# Local Multiplayer Config Modal — UX Overhaul + Cosmic Cursor Fix

> **✅ IMPLEMENTED (2026-06-07).** Phase 0: native-`<select>` cursor safety-net in
> [`custom-cursor.js`](../src/ui/components/custom-cursor.js) (reveals the OS pointer while any
> non-enhanced native select popup is open, restores on pointermove/change). Phase 1: reusable
> [`cosmic-select.js`](../src/ui/components/cosmic-select.js) (`enhanceSelect` dropdown +
> `enhanceSegmented` button-group, APG combobox/radiogroup, keyboard + ARIA, keeps the native
> `<select>` as the synced form source of truth) + [`cosmic-select.css`](../public/styles/cosmic-select.css)
> (linked in `index.html`) + registered in the cursor's interactive/magnetic selectors. Phases 2-3:
> [`local-match-config-modal.js`](../src/ui/local-match-config-modal.js) rewritten — every dropdown
> is now a CosmicSelect/segmented control, per-player **slot cards** consolidate kind/skill/handicap/team
> (deleting the 3 fragmented sections), two-zone layout + sticky footer, friendlier named bot tiers,
> mid-tier + P2-bot defaults. Phase 4: the config builder was extracted to a pure
> `buildLocalMatchConfig(values)` and unit-tested (6 tests) to guarantee the emitted config is
> **byte-identical** to the old form — full suite 330/330 green, touched files lint-clean.
> **Scoped down vs plan:** the "Empty" slot state was deferred (it needs game-mode changes; Human/Bot
> kept to preserve the contract); numeric fields kept as native inputs (they don't break the cursor)
> rather than steppers. DOM/cursor visuals need in-app verification (no jsdom in the test env).
>
> **Status:** plan (research-backed, adversarially verified). Implemented per the above.
> **Targets two things at once:** (1) the cosmic cursor breaks/freezes over dropdowns, and (2) the
> match-config modal's UX is a long, fragmented native-`<select>` form now that bots exist. The
> *same* change — replacing native `<select>` with a themed in-DOM dropdown — fixes both.
>
> **Grounding (code read):** modal [`src/ui/local-match-config-modal.js`](../src/ui/local-match-config-modal.js)
> (796 lines, ~8 native selects + per-player select builders), cursor
> [`src/ui/components/custom-cursor.js`](../src/ui/components/custom-cursor.js), styles
> [`public/styles/custom-cursor.css`](../public/styles/custom-cursor.css),
> [`public/styles/match-config-styles.css`](../public/styles/match-config-styles.css).

---

## 1. The two problems

### 1a. The cosmic cursor "switches" over dropdowns (the bug you hit)
The cosmic cursor is an in-page `<div>` overlay; the native pointer is hidden globally by
[`custom-cursor.css:317-321`](../public/styles/custom-cursor.css#L317-L321):
`body.custom-cursor-active * { cursor: none !important }`.

**Root cause (confirmed against Chromium's own design docs):** a native `<select>`'s open option
list is **rendered as a separate native OS window above the page**, not as page DOM. Chromium's
"Displaying a web page in Chrome" doc: select boxes "must be rendered using a native window so that
they can appear above everything else." Consequences, all verified:
- The cosmic-cursor `<div>` (any `z-index`) is **occluded** by the OS popup — it can't paint over it.
- `cursor: none` **does not reach** the OS popup, so the real OS arrow shows.
- While the popup is open the renderer **stops receiving `pointermove`**, so the cosmic cursor
  *freezes* at its last position. (This is worst on Chromium/Electron/Windows — exactly our target.)

So when you expand the bot-level dropdown, the OS arrow takes over and the cosmic cursor stops
tracking. **This is architecturally impossible to fix while using a native `<select>`.**

### 1b. The UX is a long, fragmented form
Every control is a native `<select>` or number input stacked vertically, and **per-player config is
split across three separate sections**: player kind/skill (`updatePlayerSlotUI`,
[modal:360-417](../src/ui/local-match-config-modal.js#L360-L417)), team assignments, and handicaps
(`updateHandicapUI`, [modal:419-460](../src/ui/local-match-config-modal.js#L419-L460)). A 4-player
setup repeats each player **three times in three places**. Bots have no visual identity, the skill
selector is a bare "Level 1–10" with no tier names, and there's no scannable layout or match summary.

---

## 2. The fix strategy (decision)

**Primary: a reusable themed in-DOM dropdown component (`CosmicSelect`)** built to the W3C APG
*Select-Only Combobox* pattern. Because its option list is ordinary page DOM:
- `cursor: none` applies and the cosmic cursor paints over it ✅
- `pointermove` fires over the options, so the cursor tracks + magnetism/states work ✅
- it's fully themeable to the cosmic aesthetic, and **reusable app-wide** (settings, other modals).

**Why not `appearance: base-select`?** Chromium 135+ (shipped 2025) *does* move the picker into the
page top layer and would fix the cursor with near-zero JS — and since we ship a known Chromium in
Electron it's tempting. But it is **not Baseline** (Firefox/Safari don't support it) and this app
also runs in the browser, so it can't be the sole solution. Treat it as an *optional future
simplification* behind `@supports(appearance: base-select)`; the custom component is the cross-target
answer and gives full theming control regardless.

**Plus a global safety-net (ship first, cheap):** extend the cursor system so that whenever **any**
native `<select>` is activated, the cosmic cursor gracefully hides and the OS pointer is restored,
then re-syncs on close. This kills the "freeze / two cursors" jank app-wide *immediately* — even for
native selects elsewhere we haven't converted yet — and is the permanent fallback for the web build
where a stray native select might remain. Verified trigger details:
- **Hide custom cursor on:** the select's `mousedown`/`focus` (NOT `window blur` or document
  `mouseleave` — those are unreliable/browser-specific as open signals).
- **Restore custom cursor on:** the select's `change`/`blur`, window `focus`, `visibilitychange`.

---

## 3. `CosmicSelect` component spec (the reusable dropdown)

New module: `src/ui/components/cosmic-select.js` (+ styles in a new `public/styles/cosmic-select.css`).
APG Select-Only Combobox — verified roles/keys/states:

**Markup / ARIA**
- **Trigger:** a `<div>` (styleable; not `<input>`/`<button>`) with
  `role="combobox"`, `tabindex="0"`, `aria-controls="<listboxId>"`, `aria-expanded="false|true"`,
  `aria-labelledby="<labelId>"` (or `aria-label`), and `aria-activedescendant="<activeOptionId>"`
  **set only while open**. It is the **only** focusable element. (No `aria-haspopup` needed for a
  listbox popup.)
- **Popup:** a `<div role="listbox" id tabindex="-1">`, `display:none`/`hidden` when collapsed (so it
  leaves the a11y tree). Positioned in-page (absolute within the modal, or `position-anchor` later).
- **Options:** `<div role="option" id="<unique>">` with static text only, `aria-selected="true"` on
  the chosen one, **no tabindex**.

**Three tracked states** (don't conflate them):
1. `expanded` → `aria-expanded`
2. `activeOptionId` (transient keyboard/hover highlight) → `aria-activedescendant` + a highlight class
3. `selectedOptionId` (committed value) → `aria-selected` + the trigger's displayed text

**Keyboard (required):** open on Enter/Space/↓/↑; navigate ↑/↓/Home/End + typeahead; Enter/Space
commits the active option; Esc closes and returns focus to the trigger; Tab closes; outside-click and
blur close.

**Form compatibility (critical):** the modal reads values via `new FormData(form)` and
`area.querySelectorAll('select')` + `sel.name`/`sel.value`
([modal:368-371, 685-699](../src/ui/local-match-config-modal.js#L368-L371)). So **keep a hidden real
`<select>` (or `<input type="hidden">`) with the same `name`, synced on every commit**, underneath
each `CosmicSelect`. This preserves all existing form-reading logic with zero changes to the submit
path, and gives a native fallback.

**Cursor integration:** the trigger and each option should read as interactive to the cursor. Add
the component's class to the cursor's `INTERACTIVE_SELECTOR` / `MAGNETIC_SELECTOR`
([custom-cursor.js:32-76](../src/ui/components/custom-cursor.js#L32-L76)) (e.g. `.cosmic-select__trigger`,
`.cosmic-select__option`), so hover gives the INTERACTIVE state + magnetism over the open list.

**Theming:** drive colors from the same theme palette the cursor uses
(`getOdysseyThemePresentationPalette`), with an open/close micro-animation, selected check, and the
cosmic accent — so the dropdown feels native to the game, not a browser control.

> Build it generically (label, options `[{value,label,hint?,icon?}]`, `value`, `onChange`,
> `disabled`) so Settings and other modals can adopt it later.

---

## 4. Redesigned modal layout

Verified lobby/match-config UX principles applied. **Two zones + sticky footer:**

```
┌─ 🎮 Local Multiplayer Setup ───────────────────────────────  [✕] ─┐  (fixed header)
│                                                                   │
│  PLAYERS                                       [ 2 ][ 3 ][ 4 ]    │  segmented control
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────┐  │
│  │ ● P1  [name]│ │ ● P2  [name]│ │ ● P3  [name]│ │  + Empty  │  │  SLOT CARDS (grid)
│  │ Human|Bot|∅ │ │ Human|Bot|∅ │ │ Human|Bot|∅ │ │  (P4)     │  │  3-state segmented
│  │  (host)     │ │ Skill ▾ Ace │ │ Skill ▾ Norm│ │           │  │  Skill shown only
│  │ Team ▢ Hcap▾│ │ Team ▢ Hcap▾│ │ Team ▢ Hcap▾│ │           │  │  when Bot
│  └─────────────┘ └─────────────┘ └─────────────┘ └───────────┘  │
│                                                                   │
│  MATCH RULES                                                      │
│   Mode      [ FFA ][ Infinity LMS ]      Attack [ Std|Blind|… ]   │  segmented / radio-cards
│   Win by    [ Frags ▾ ]   to  [ − 7 + ]                           │  stepper for the value
│                                                                   │
│  ▸ Advanced rules (start level, level progression, boring rules)  │  accordion, collapsed
│ ─────────────────────────────────────────────────────────────── │
│                                   [ Cancel ]   [ 🚀 Start Match ] │  (sticky footer)
└───────────────────────────────────────────────────────────────────┘
```

### 4a. Player slot cards (the core consolidation)
One self-contained card per slot with **identical anatomy**, replacing the three fragmented sections:
- **Header:** color swatch/avatar + `P1–P4` + **editable name** (defaults "Player N" / "Bot N").
- **Dominant control:** 3-state segmented toggle **Human / Bot / Empty**.
- **Conditional (Bot only, progressive disclosure):** **Skill** dropdown with **named tiers**, not
  bare "Level N" — e.g. map the existing 10 tiers to labels (we already have `bot-difficulty.js`
  labels Level 1…10; surface friendlier groupings like *Rookie · Skilled · Expert · Quadra Ace ·
  Machine* with the numeric tier as a hint). Default a new bot to a **mid tier**.
- **Per-card secondary:** **Team** color chip (only when team mode on) and **Handicap** dropdown —
  moved **onto the card**, deleting the separate team + handicap sections entirely.

### 4b. Match rules zone
- **Mode** (FFA / Infinity LMS): segmented control (2 segments). Mode-specific fields (Infinity row
  cap) appear conditionally only when LMS is chosen.
- **Attack style** (5 options): radio-cards with a one-line descriptor each (they already have
  descriptions in the current `<option>` text), or a `CosmicSelect` — both fix the cursor; radio-cards
  are more scannable for 5 options with descriptions.
- **Win condition** (Frags/Time/Points/Lines/Never): `CosmicSelect`; the **value** uses a **stepper**
  (`− N +` with editable field + min/max), not a bare number box.
- **Advanced** (start level, level progression, boring rules, team mode): accordion collapsed by
  default; level via stepper; toggles stay checkboxes (committed on Start, not instant).

### 4c. Defaults, gating, spacing
- **Immediately playable defaults:** P1 = Human (host), P2 = Bot mid-tier, P3/P4 = Empty; distinct
  colors (Red/Blue/Yellow/Green); no handicap. User can hit **Start** with zero edits.
- **Primary action:** sticky-footer **Start Match** (accent/green), Cancel to its left, reachable
  without scrolling; gate only on minimum valid config (≥2 participants) with an inline hint when
  disabled — never silently fail.
- **Spacing scale:** 4–8px label↔control inside a card, 16–24px between cards, 32px+ between the
  player zone and the rules zone; rely on whitespace + card accent borders, not heavy dividers.
- **Modal:** fixed header + scrollable body + sticky footer; fixed responsive width sized to content;
  no horizontal scroll; edge-fade to signal overflow.

---

## 5. Setting → control mapping (verified)

| Setting | Today | Recommended control |
|---|---|---|
| Number of players (2/3/4) | `<select>` | **Segmented control** (3 segments) |
| Player kind (Human/Bot) | `<select>` | **3-state segmented** Human/Bot/Empty on the slot card |
| Bot skill (1–10) | `<select>` "Level N" | **`CosmicSelect`** with named tiers + numeric hint (or radio-cards) |
| Game mode (FFA/LMS) | `<select>` | **Segmented control** (or 2 radio-cards) |
| Attack style (5) | `<select>` | **Radio-cards** w/ descriptor (or `CosmicSelect`) |
| Win condition (5) | `<select>` | **`CosmicSelect`** |
| Win value / level / row cap | number input | **Stepper** (`− N +`, editable, min/max) |
| Handicap (5 tiers) | `<select>` ×N (separate section) | **`CosmicSelect`** on each slot card |
| Team assignment | `<select>` ×N (separate section) | **Color chip** on each slot card |
| Level progression / boring rules / team mode | checkbox | **Checkbox** (keep; committed on Start) |

Every remaining dropdown becomes a `CosmicSelect` → the cosmic cursor works everywhere in the modal.

---

## 6. Cursor system changes

1. **Register the new component** in `INTERACTIVE_SELECTOR` and `MAGNETIC_SELECTOR`
   ([custom-cursor.js:32-76](../src/ui/components/custom-cursor.js#L32-L76)) so triggers + options get
   the interactive/magnetic state.
2. **Global native-`<select>` safety-net** (small, ships first): a tiny module (or a few listeners in
   `CustomCursor.attachListeners`) that, on any `select` `mousedown`/`focus`, sets a flag that
   suppresses the custom cursor and restores `cursor:auto`; clears it on `change`/`blur` + window
   `focus`/`visibilitychange`. This removes the freeze/double-cursor for any native select anywhere,
   independent of the modal work.
3. No change needed to the modal-active detection — the modal already toggles `.modal.visible`
   which the cursor reads ([custom-cursor.js:683-686](../src/ui/components/custom-cursor.js#L683-L686)).

---

## 7. Implementation phases

- **Phase 0 — Safety-net (tiny):** native-`<select>` cursor reveal/restore. Immediately fixes the
  "switches/freezes" jank app-wide. Independently shippable.
- **Phase 1 — `CosmicSelect` component:** build `cosmic-select.js` + `cosmic-select.css` to the APG
  spec (ARIA, keyboard, hidden-native-select sync, theming, cursor classes). Unit-test the value
  sync + keyboard + ARIA states.
- **Phase 2 — Swap modal dropdowns:** replace the 4 static selects + the per-slot/handicap selects
  with `CosmicSelect`/segmented/stepper/radio-cards. Keep `name`s + `FormData`/`querySelectorAll`
  reads intact via the hidden synced selects, so `handleConfigurationComplete`/`buildConfig` is
  untouched.
- **Phase 3 — Slot-card layout:** consolidate kind/skill/team/handicap onto per-player cards; delete
  the separate team + handicap sections; restructure into two zones + sticky footer; apply defaults,
  gating, spacing.
- **Phase 4 — Polish + a11y + tests:** focus trap, Esc-to-close, keyboard tab order, reduced-motion,
  responsive sizing; manual cursor verification over every dropdown (Electron + browser); regression
  test that the emitted `config` (playerSlots/handicaps/teams/rules) is byte-identical to today's.

---

## 8. Accessibility & test checklist
- Keyboard-only: open/close, navigate, select, Esc, Tab order through cards and rules.
- Screen-reader: combobox name + expanded state + active/selected option announced.
- The emitted `config` object is unchanged (snapshot test of `buildConfig` output for representative
  inputs) — UX changes must not alter the match-start contract.
- Cursor: cosmic cursor visible + tracking + magnetic over every dropdown's open list, in **Electron
  on Windows** and a browser build; native-select safety-net verified for any unconverted control.
- `prefers-reduced-motion` respected for the dropdown open animation.

---

## 9. Sources
**Cursor / native controls:** Chromium "Displaying a web page in Chrome" (select = native window);
MDN *Customizable select*; MS Edge "Styling select elements for real"; Chrome for Developers
"A customizable select" (`appearance: base-select`, Chrome 135); caniuse `appearance: base-select`;
Mozilla bug 1555018 (no `mouseover` over native option list).
**Accessible dropdown:** W3C ARIA APG *Combobox* + *Select-Only Combobox example*; MDN combobox role;
LogRocket / freeCodeCamp custom-select guides; Downshift / Radix Select (vetted implementations).
**Lobby / form UX:** NN/g, GOV.UK/GDS, Carbon/Material/HIG on segmented controls vs dropdowns,
steppers, radio-cards, progressive disclosure, modal header/body/footer; couch-co-op lobby patterns.
