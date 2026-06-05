# Menu Design-Language Audit — Cosmic Serenity "AAA"

**Date:** 2026-06-04
**Branch:** `development_phaser_20251011`
**Question:** Are we using the latest design language in *every* menu?
**Short answer:** **No — not yet.** Most primary menus are migrated, but Odyssey mode and several modals/overlays are still legacy.

---

## What "the latest design language" means

The current design system is **Cosmic Serenity "AAA"**, defined in two layers:

- **[cosmic-tokens.css](public/styles/cosmic-tokens.css)** — the single source of truth: the `--cs-*` accent palette
  (cyan / indigo / teal / violet / pink / gold / lavender / amber), neutral primitives (`--cs-soft-rgb`, `--cs-ink`,
  `--cs-ink-soft`), the floating-HUD glass recipe (`--cs-hud-*`), and the shared `cs-shimmer` title keyframe.
- **Per-surface `*-aaa.css` override layers** — apply the glassmorphism recipe scoped to each surface's container.

**The AAA recipe** (what a fully-migrated surface looks like, distilled from the gold-standard
[settings-aaa.css](public/styles/settings-aaa.css) → `#settings-modal`):

1. A dedicated `*-aaa.css` layer scoped to the surface, loaded in `index.html` after `cosmic-tokens.css`.
2. Per-surface accent identity: `--cs-accent` / `--cs-accent-rgb` pointing at a cosmic token.
3. Glassmorphism panel — `backdrop-filter: blur()+saturate()`, layered radial-gradient (accent glow) + linear-gradient
   (deep navy), `rgba(var(--cs-soft-rgb)…)` borders, ~20–24px radius, accent-glow + inset box-shadow, `::before`
   gradient-border mask.
4. Entrance animation with `cubic-bezier(0.22, 1, 0.36, 1)` "pop"; `cs-shimmer` / gradient-text titles.
5. Consistent `--cs-*` tokens for text and panels.

**Legacy (non-AAA) stylesheets** to watch for: `main.css` (570 KB grab-bag), `multiplayer-ui.css`,
`serenity-hub.css` (the *old* hub CSS), `lobby-styles.css`, `match-config-styles.css`, `next-queue.css`,
and hard-coded inline `cssText` in JS.

---

## Scorecard

**26 surfaces audited: 6 full · 12 partial · 8 legacy.**

### Navigated menus / screens / modals (17)

| Surface | Status | Notes |
|---|---|---|
| Main menu / mode select | ✅ **aaa-full** | `#start-modal` via `menu-aaa.css`, per-mode accents, parallax tilt |
| **Settings (reference)** | ✅ **aaa-full** | `#settings-modal` via `settings-aaa.css` — per-tab accent via `:has()` |
| High scores | ✅ **aaa-full** | `#high-scores-modal` via `high-scores-aaa.css` (gold accent) |
| Demo / replay browser | ✅ **aaa-full** | `#demo-browser-modal` via `demo-browser-aaa.css` (cyan) |
| Lobby waiting room | ✅ **aaa-full** | `#lobby-waiting-room` via `lobby-room-aaa.css` (teal) |
| Game-over modal | ✅ **aaa-full** | `#game-over-modal` via `game-over-aaa.css` (lavender/cyan) |
| Serenity Hub | ⚠️ **aaa-partial** | Secondary text (`--hub-secondary`) + vinyl disc (`--music-vinyl`) still legacy |
| Online match config | ⚠️ **aaa-partial** | Entrance anim, form-row stagger & input padding from `match-config-styles.css` |
| Local match config | ⚠️ **aaa-partial** | `.team-selection-area` / `#player-team-assignments` styled by legacy `multiplayer-ui.css` |
| Lobby browser | ⚠️ **aaa-partial** | Minor — legacy `.btn::before` ripple bleeds in from `lobby-styles.css` |
| Online match results | ⚠️ **aaa-partial** | Inner panels use hard-coded **inline** colors; no glass recipe — only chrome restyled |
| Generic dialogs | ⚠️ **aaa-partial** | **demo-complete modal is fully legacy** (no AAA layer); start/game-over are full |
| Pause / in-game settings | ✅ ≈full | Is the settings modal (Esc). Note: `settings-aaa.css` drops `display:flex` that `main.css` set — verify layout |
| **Odyssey level select** | ❌ **legacy** | 100% inline `cssText`, hard-coded `rgba(180,130,255…)`, no tokens |
| **Odyssey level preview** | ❌ **legacy** | 100% inline styles, no AAA layer |
| **Odyssey level results** | ❌ **legacy** | 100% inline styles, no AAA layer |
| **Steam leaderboard panel** | ❌ **legacy** | `main.css:24278+` only, hard-coded colors, no tokens |

### In-game HUDs / overlays (9)

| Surface | Status | Notes |
|---|---|---|
| Single-player HUD (stats bar) | ⚠️ **aaa-partial** | Visual-only reskin; layout/typography/pulse anim still `main.css` |
| Online multiplayer HUD | ⚠️ **aaa-partial** | Chrome restyled; opponent mini-boards left legacy **deliberately** (readability) |
| Infinity HUD + minimap | ⚠️ **aaa-partial** | Uses cosmic tokens + glass, but via inline styles — no scoped CSS layer |
| Chat (in-game / online) | ⚠️ **aaa-partial** | Container is AAA; message rows use inline styles + legacy `multiplayer-ui.css` |
| Next-piece queue | ⚠️ **aaa-partial** | Container AAA; individual piece cards still `main.css` nth-child rules |
| **FFA / battle HUD + scoreboard** | ❌ **legacy** | `#ffa-hud` + `#multiplayer-scoreboard-overlay` via `multiplayer-ui.css` only |
| **Odyssey HUD** | ❌ **legacy** | 100% inline `cssText`, hard-coded purple, no tokens |
| **Replay playback controls** | ❌ **legacy** | `#playback-controls` via `main.css:23551+`, hard-coded colors |
| **Invite toast** | ❌ **legacy** | Inline `<style>` injection, hard-coded colors, no tokens |

---

## Biggest finding

The single largest gap is **Odyssey mode** — its *entire* UI (level select, preview, results, in-game HUD) was built
with inline `cssText` and hard-coded purple `rgba()` values, predating the AAA system. It is the most visible
inconsistency a player will encounter.

---

## Recommended remediation order

1. **Odyssey screens** — biggest visible inconsistency (level select / preview / results / HUD). Needs new scoped
   `odyssey-*-aaa.css` layers (suggest `--cs-violet` / `--cs-indigo` identity) and removal of inline styles.
2. **Quick wins** — demo-complete modal + Steam leaderboard panel. Both reuse markup that already has AAA siblings, so
   they just need a small scoped `*-aaa.css`.
3. **Finish the partials** — match-results inner panels (replace inline colors with glass + `--cs-ink`), local-match
   team area, Serenity Hub secondary text + vinyl disc, online match-config entrance animation.
4. **Overlays** — FFA HUD, playback controls, invite toast (each needs a small scoped `*-aaa.css`).

---

## Method

Audited via a 52-agent run: one auditor + one adversarial verifier per surface, each reading the surface's JS,
its `index.html` markup, and the relevant CSS, judged against the `settings-aaa.css` recipe. Two verdicts were
downgraded by the verifier from `aaa-full` → `aaa-partial` (Serenity Hub, Lobby browser) after finding legacy
bleed-through the first pass missed.
