# Cosmic Cursor — Game-Wide Fix Plan (all menus, dropdowns, buttons)

> **✅ IMPLEMENTED (2026-06-07).** Phase 1: `installCosmicSelects()` + a `MutationObserver` in
> [`cosmic-select.js`](../src/ui/components/cosmic-select.js) — enhances every existing `<select>` and
> auto-enhances any added later (and refreshes one whose options change), wired once at startup in
> [`main.js`](../src/main.js) next to the cursor mount; guards skip `<select multiple>` and
> `[data-cosmic-skip]`. So **every dropdown in the game — present and future — is themed and the
> cosmic cursor works over it.** Phase 2: the cursor safety-net in
> [`custom-cursor.js`](../src/ui/components/custom-cursor.js) now covers **all native popups** (the
> renamed `nativePopupOpen` triggers on non-enhanced `<select>` *and* `date/datetime-local/time/
> month/week/color/file` pickers) — revealing the OS pointer instead of a frozen cursor, restored on
> pointermove/change. Phase 3: the cursor's interactive selectors now include semantic ARIA roles
> (`tab/menuitem/option/switch/radio/checkbox/combobox/link`, …) plus the existing
> `[data-cursor-interactive="true"]` convention, so buttons/controls everywhere read as interactive
> and new widgets get it for free. Tests: full suite **330/330 green**, touched files lint-clean; the
> local-MP config contract test still passes. **Layered defense:** the safety-net alone removes the
> freeze game-wide; auto-enhance adds the premium cosmic-cursor-over-dropdown experience. **Deferred
> (optional, low cursor priority):** themed replacements for the native color picker and
> `alert/confirm/prompt` (their cursor impact is transient). **Needs in-app verification** (no jsdom in
> the test env): online match config, demo playback controls, generic modals, theme color picker.
>
> **🔧 CORRECTION (2026-06-07).** The first attempt blanket-applied the *destructive* CosmicSelect
> (wrap select + themed trigger) to every menu — which **broke layouts** (e.g. the Settings modal:
> labels overlapped the trigger, the open list was clipped), because each menu styles its native
> `<select>` with its own grid/layout that a wrapper can't inherit. Reverted that. The correct
> game-wide mechanism is **non-destructive**: `enhanceSelectOverlay()` in `cosmic-select.js` leaves
> every native `<select>`'s closed box **exactly as the host menu styled it** (zero layout change),
> and only (a) suppresses the native OS popup on mouse-open and (b) renders the open option list as a
> themed listbox **portaled to `<body>` (`position: fixed`)** so it's never clipped and the cosmic
> cursor paints over it. Keyboard/screen-reader use stays fully native (the freeze is pointer-only),
> so a11y is unchanged. `installCosmicSelects()` now applies this overlay to every `<select>` (current
> + future via the observer), skipping multi-selects, `[data-cosmic-skip]`, and already-enhanced
> selects — so the **local-MP modal keeps its purpose-built destructive themed triggers** (which were
> approved) while every other menu gets the cosmic cursor over its dropdown with no layout change.
> Failure mode is now safe: worst case the open list mispositions; closed menus always look native.
> Tests: 330/330 green, `cosmic-select.js` lint-clean. **Needs an in-app re-check** of Settings/other
> menus (the prior break was visual; no jsdom to auto-verify).
>
> **Status:** plan (no code yet) → implemented + corrected per the above.
>
> **Recap of the root cause (verified previously):** a native `<select>` option list — and other
> native popups (date/color/file pickers, `alert`/`confirm`/`prompt`) — is rendered as a **separate
> OS-level window above the page**. The cosmic cursor is an in-page `<div>` overlay with the native
> pointer hidden via `cursor: none`, so it can't paint over those OS surfaces and `pointermove` stops
> firing → the cursor freezes / the OS arrow takes over. This is architecturally unavoidable for
> native popups. See [`docs/local-multiplayer-config-ux-plan.md`](local-multiplayer-config-ux-plan.md)
> and memory `cosmic-cursor-native-select`.
>
> **What we already built (reuse, don't rebuild):**
> - [`cosmic-select.js`](../src/ui/components/cosmic-select.js) — `enhanceSelect` (themed in-DOM
>   dropdown) + `enhanceSegmented` (button group), enhancing a native `<select>` in place and keeping
>   it as the synced form source of truth. The cosmic cursor works over its in-page option list.
> - A **global safety-net** in [`custom-cursor.js`](../src/ui/components/custom-cursor.js): while a
>   *non-enhanced* native `<select>` popup is open, the OS pointer is revealed instead of a frozen
>   cosmic cursor; restored on `pointermove`/`change`.
>
> So the freeze for native `<select>` is *already* mitigated game-wide. This plan makes the cosmic
> cursor *actually work* over every dropdown, extends the safety-net to the remaining native popups,
> and confirms buttons/clickables everywhere read as interactive.

---

## 1. Audit — every cursor-affecting surface in the game

| Surface | Where | Cursor impact today | Plan |
|---|---|---|---|
| Native `<select>` (local MP) | `local-match-config-modal.js` | ✅ Fixed (CosmicSelect) | done |
| Native `<select>` (online MP) | `match-config-modal.js` (×5) | Safety-net degrades; cursor doesn't work over list | Auto-enhance |
| Native `<select>` (demo playback) | `playback-controls.js` (×1) | "" | Auto-enhance |
| Native `<select>` (generic modals) | `modals.js` (×2) | "" | Auto-enhance |
| Native **color** picker | `serenity-hub/ThemesTab.js` (`type="color"`, L588) | OS picker → cursor breaks | Safety-net (extend) + optional themed picker |
| `alert` / `confirm` / `prompt` | 25 calls across 9 files (`main.js`, `lobby-*`, `*MultiplayerMode`, `demo-browser`, etc.) | Synchronous → cursor freezes during the native dialog, self-recovers on dismiss | Low cursor priority; (optional) themed dialog util |
| Buttons / links / cards / toggles | app-wide | In-DOM → cursor works; interactive state depends on selector coverage | Audit selector coverage + convention |
| `<iframe>` menus | none found | n/a | n/a |

**Key insight:** there are only a handful of native `<select>` call-sites, but new ones will keep
appearing. Rather than hunt-and-convert forever, install a **global auto-enhancer** so every current
*and future* `<select>` is themed automatically.

---

## 2. Strategy

### 2a. Global auto-enhance of ALL `<select>` (the core fix)
Add `installCosmicSelects()` (in `cosmic-select.js`), called once at startup next to the cursor mount
([main.js:856](../src/main.js#L856)):
- On init, `enhanceAllSelects(document)` (already exists) enhances every existing `<select>`.
- A **`MutationObserver`** on `document.body` watches for added nodes and enhances any new
  `<select>` (and selects inside added subtrees) automatically — covering every dynamically-built
  menu (online match config, lobby, hub, demo browser, future modals) with zero per-screen work.
- Variant: a `<select data-cosmic-variant="segmented">` becomes a segmented control; everything else
  a dropdown (already supported by `enhanceAllSelects`).

This single hook makes the cosmic cursor work over **every dropdown in the game**, present and future.

### 2b. Extend the safety-net to all native popups (the fallback)
Generalize the cursor safety-net selector from `select:not([data-cosmic-enhanced])` to also match
native pickers that open OS popups:
`input[type=date], [type=datetime-local], [type=time], [type=month], [type=week], [type=color], [type=file]`.
While any of these is open, reveal the OS pointer (same mechanism). This guarantees graceful behavior
for surfaces we don't (or can't sensibly) replace — e.g. the native color picker — and for any
`<select>` that opts out of enhancement or hasn't been enhanced yet (race before the observer runs).

### 2c. Guards & edge cases (build into `enhanceSelect` / the observer)
- **Skip `<select multiple>`** — CosmicSelect is single-select; leave native + rely on safety-net.
- **Opt-out** — honor `data-cosmic-skip` (or `[multiple]`) so a screen can keep a native select.
- **Touch / coarse pointer** — the cosmic cursor is desktop-only (`pointer: fine`). On touch, native
  pickers are better; gate auto-enhance to fine-pointer environments (reuse `isFinePointerEnvironment`)
  and fall back to native + safety-net on touch. (CosmicSelect still works on touch, but native mobile
  pickers are nicer — decide per preference; defaulting to enhance-everywhere is also fine since the
  cursor simply isn't shown on touch.)
- **Already-enhanced** — `enhanceSelect`/`enhanceSegmented` already no-op on `[data-cosmic-enhanced]`.
- **Re-render churn** — the observer re-enhances re-added selects; detached old enhancers are GC'd.
- **Disabled / form semantics** — preserved (native `<select>` stays the source of truth; `FormData`,
  `change`, `.value`, `.disabled`, `querySelectorAll('select')` all keep working — proven in the
  local-MP refactor's contract tests).

### 2d. Buttons / clickables read as interactive everywhere
The cursor's `INTERACTIVE_SELECTOR` / `MAGNETIC_SELECTOR`
([custom-cursor.js](../src/ui/components/custom-cursor.js)) already covers `a[href]`, `button`,
`input`, `select`, `[role="button"]`, `summary`, and many app classes (+ the CosmicSelect classes we
added). To make coverage exhaustive and future-proof:
- **Audit** for clickable elements that are *not* semantic and *not* in the selector list (e.g. `div`
  with a click handler and no `role`). Convert them to `<button>`/`role="button"` or tag them
  `data-cursor-interactive="true"` (already honored).
- **Standardize the convention** in a short doc note so new UI gets the interactive cursor for free.
- Confirm form controls that *don't* open OS popups (checkbox, radio, range, text/number inputs) keep
  working with the cursor (they're in-DOM; `input` is already in the selector) — no change needed.

### 2e. (Optional, separate from the cursor goal) themed dialogs & color picker
`alert`/`confirm`/`prompt` are native (ugly + block JS); their *cursor* impact is transient
(frozen-then-restored on dismiss), so they're **low priority for this fix**. If desired later, replace
them with a small themed modal/confirm utility (also improves UX). Likewise a themed color picker
could replace the native one in ThemesTab; until then the safety-net (2b) handles its cursor.

---

## 3. Implementation phases
- **Phase 1 — Global auto-enhancer:** add `installCosmicSelects()` + MutationObserver to
  `cosmic-select.js`; call it once at startup (main bootstrap, near the cursor mount). Add the
  `multiple`/`data-cosmic-skip`/fine-pointer guards. → every dropdown game-wide is themed.
- **Phase 2 — Extend the safety-net** to native pickers (date/color/file/…) in `custom-cursor.js`.
- **Phase 3 — Interactive-coverage audit:** find non-semantic clickables lacking cursor coverage;
  tag/convert them; document the `data-cursor-interactive` convention.
- **Phase 4 (optional):** themed color picker + themed `confirm`/`alert` utility to retire native
  dialogs (UX win; minor cursor win).
- **Phase 5 — Verify** (see §4) and remove the now-redundant per-modal manual `enhance*` calls in
  `local-match-config-modal.js` if the global auto-enhancer covers them (keep its explicit
  *segmented* calls, or mark those selects `data-cosmic-variant="segmented"` and let the global pass
  handle them).

## 4. Testing & verification
- **Unit (node, no DOM):** keep the `buildLocalMatchConfig` contract test; add a guard test that
  `enhanceSelect` skips `[multiple]` / `[data-cosmic-skip]` (pure-ish, or note as DOM-only).
- **In-app (the real check — needs the running app, no jsdom in the test env):** open each menu that
  has dropdowns — **online match config, demo playback controls, generic modals, settings/hub, theme
  tab color picker** — and confirm the cosmic cursor tracks + is interactive over every dropdown's
  open list, and reveals the OS pointer (no freeze) over the native color picker. The dev server runs
  on `localhost:5173`.
- **Regression:** confirm form submissions still read the right values everywhere (the enhanced
  selects keep native `<select>` as the source of truth).

## 5. Sources
Reuses the prior verified research (Chromium "Displaying a web page in Chrome" — select = native
window; MDN *Customizable select*; W3C ARIA APG combobox/listbox; `appearance: base-select`). No new
external research required — this is an inventory + applying the existing solution globally.
