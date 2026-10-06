# Serenity Hub

The sheet that holds everything around a calm game: the world you play in (themes), what
you hear (music), rhythms to follow (breathing worlds) and guided journeys (Hale sessions).
It opens over Serenity mode (H, Y on a pad, or the lotus tile) and from the main menu.

The visual language is **Keystone** — see
[docs/MENU_UI_OVERHAUL_2026-10.md](../../../docs/MENU_UI_OVERHAUL_2026-10.md) for the
tokens and primitives (`.sb-panel`, `.sb-key`, `.sb-btn`, `.sb-kbd`, `.sb-hints`, `.sb-chip`,
`.sb-meter`, `.sb-toggle`). Breathing content follows
[docs/BREATHING_OVERHAUL_2026-10.md](../../../docs/BREATHING_OVERHAUL_2026-10.md) and
[docs/HALE_SESSIONS_2026-10.md](../../../docs/HALE_SESSIONS_2026-10.md).

## Files

| File | Role |
|------|------|
| `SerenityHub.js` | The sheet: lotus tile, Hale sessions tile, backdrop, header, tab strip, footer hints, open/close, keyboard and gamepad routing, the controls overlay (`/` or Select). |
| `ThemesTab.js` | Theme browser: labelled search, category chips, Random theme, card grid, the current theme, Tornado's live controls. |
| `theme-card-interactions.js` | Pointer spotlight on theme cards (writes `--mx` / `--my`). |
| `theme-thumbnail-manifest.js` | Resolves bundled theme thumbnails for the cards. |
| `MusicTab.js` | Now playing, seek slider, transport, volume sliders, playlist. |
| `BreathingTab.js` | The twelve breathing worlds and the guide's settings. |
| `SessionsTab.js` | The Hale catalogue and its full-screen flow (prepare, countdown, complete). |
| `hub-scroll-utils.js` | Wheel / gamepad scrolling of the shared `.hub-tab-content` scroller. |

`SerenityMode.js` creates the hub for the mode; `main.js` (`initializeGlobalSerenityHub`)
creates a shared one for the menu and other modes with a small `deps` wrapper.

## Sheet structure

```
.serenity-hub-backdrop                 solid night scrim, data-wheel-lock
#serenity-hub-panel.serenity-hub       role=dialog aria-modal, data-tab=<current tab>
  .hub-key                             the keystone in the open top-right corner
  header.hub-panel-header
    .hub-eyebrow                       "Breath · …", follows the tab
    h2#hub-title                       "Serenity Hub" (focused on open)
    button.hub-close-btn               "Close" + Esc / B keycaps
  nav.hub-tabs[role=tablist]           #hub-tab-<id>, roving tabindex
  .hub-tab-content                     the one scroller (is-scrolling mode, lazy panels)
    #tab-<id>.tab-panel[role=tabpanel] aria-labelledby="hub-tab-<id>"
  footer.hub-footer > ul.sb-hints      input hints (keyboard or pad by body class)
```

Tab ids are `themes`, `music`, `breathing`, `sessions` (see `HUB_TABS`). Each tab module
builds its content on first use; `switchTab()` remembers each tab's scroll position.

The `.serenity-hub` class is load-bearing: SerenityMode ignores clicks inside it (the
sheet, the lotus and Hale tiles, the controls overlay). Keep it on anything new that floats
over the game.

## Input

| Keyboard | Pad | Action |
|----------|-----|--------|
| H | Y | Open or close the hub |
| ← → on the title or a tab, Home / End on a tab | LB / RB | Switch tabs |
| Tab | D-pad | Move between controls |
| Enter / Space | A | Choose |
| Esc | B | Close (in search, Esc first clears the text) |
| ← → / Page Up / Page Down / Home / End on the seek bar | | Seek 5 s / 30 s / to either end |

While the search field has focus, typed letters stay in the field (Serenity's single-key
shortcuts are not fired). Bindings for the controls overlay come from
`settings.serenityKeyBindings` / `serenityGamepadBindings` over `DEFAULT_*_BINDINGS`.

## Styles

| Sheet | Scope |
|-------|-------|
| `public/styles/keystone-hub.css` | The sheet, Themes, Music, Hale tile, controls overlay, responsive, reduced motion. Loaded after `keystone.css` and `keystone-menu.css`. |
| `public/styles/breathing-library.css` | Breathing tab (`.breath-lib`). |
| `public/styles/breathwork-sessions.css` | Hale catalogue and `.hale-flow`. |
| `public/styles/breathing-guide.css` | The guide's DOM chrome (`#breathing-guide`). |
| `public/styles/serenity-hub.css` | Floating icons only (lotus, records, replays, navigator). |

Rules stay scoped under `#serenity-hub-panel`, `.hale-flow` or `#breathing-guide`; do not add
bare generic class rules (`.progress-fill`, `.section-title`, …) — they leak onto other
screens. No `backdrop-filter`; motion is transform / opacity only, and everything has a
`prefers-reduced-motion` path. Focus is drawn by the shared Keystone focus marker: give
controls the cream `:focus-visible` outline and mark a control `data-keystone="none"` only
when the marker looks wrong on it.

## Performance

- Panels render lazily; theme thumbnails hydrate through an IntersectionObserver rooted on
  `.hub-tab-content` (first visible row eagerly).
- Theme cards use `content-visibility: auto` (the current card switches it off so its
  keystone can overhang).
- While the content scrolls, `.is-scrolling` on the panel pauses hover and spotlight work.
- Filtering updates existing cards in place (`applyThemeCardFilter`).

## Tests

`tests/unit/serenity-hub-performance.test.js`, `serenity-hub-hidden-work.test.js`,
`music-tab-lifecycle.test.js`, `theme-selection-event-isolation.test.js`,
`breathing-library.test.js`, `breathwork-sessions-presentation.test.js`,
`hale-session-entry.test.js`, `breathing-guide.test.js`, `menu-coverage.test.js`.

## Adding a tab

1. Add an entry to `HUB_TABS` in `SerenityHub.js` (id, label, eyebrow, icon).
2. Create `<Name>Tab.js` with `constructor(hub)`, `render()` returning markup, and
   `destroy()`; build it in `loadTabContent()` and clean it up in `destroy()`.
3. Give the tab a hue in `keystone-hub.css` (`#serenity-hub-panel[data-tab='<id>']`).
4. Verify at 1600×900 and 390×844 before calling it done.
