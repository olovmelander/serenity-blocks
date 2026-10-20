# 0021 — The photosensitivity warning is the first screen of every launch; flashing has its own setting

- **Status:** accepted
- **Date:** 2026-10-20
- **Plan hook:** platform certification and accessibility (console health-and-safety screens are a
  certification requirement; PC storefronts expect them). Builds on ADR-0020 (the loading screen's
  compositor-only motion) and the Keystone interface language (`docs/MENU_UI_OVERHAUL_2026-10.md`).

## Context

The worlds flash. Voltage Storm's lightning flickers at 2–10 Hz, Supernova detonates, Pyrestorm and
Kaleidosonic throw frame-wide sheets, Chromadelic Highway strobes, and every theme's post stack has
an event flash on the frame (`post.update({ flash })` in every `*-post.js`). Several themes already
ration themselves (Rainbow Terraces runs a WCAG 2.3.1 flash governor; Pyrestorm and Kaleidosonic keep
a minimum gap between sheets), and **Reduce motion** softens flashes with everything else, but:

- nothing told a player before the first frame that the game flashes;
- a photosensitive player had no switch of their own. Reduce motion is the motion-sensitive
  player's switch: it holds the worlds still, which is the opposite of what someone who wants the
  spectacle but not the strobe asked for;
- the first thing on screen was the loading screen, itself alive with rising light and motes.

Rapidly flashing lights and certain high-contrast patterns can trigger seizures in people with
photosensitive epilepsy, including people with no history of it, and migraines, nausea or sensory
overload in others. The industry's answer is a static warning on the very first screen, before any
logo or cinematic, held long enough to read or until a button, plus a setting that lets the
player play safely and a note on the store page.

## Decision

### 1. The warning is the first screen, every launch, and the boot never waits for it

- `index.html`: `#photosensitivity-warning` is **the first element of `<body>`**, before the
  loading screen (`#startup-shell`) and every logo, with the industry's wording (the two
  paragraphs are kept as they are), the way to the setting, a Continue button and the "Press any
  key or button, or tap" prompt. Its style is **inline in `<head>`**, so it paints with the first
  frame and owes nothing to the stylesheets or the bundle: plain white on black, no animation on
  it, and none behind it (`body.photosensitivity-warning-active` pauses the loading screen's
  loops from their first frame and keeps the custom cursor away:
  `public/styles/photosensitivity.css`).
- `src/ui/photosensitivity-warning.js` runs its clock and owns its input. It is imported by an
  inline module script in index.html, so it runs the moment the page has parsed, and it is
  **dependency-free** so it stays off the main bundle's graph (`scripts/check-boot-closure.mjs`).
  It leaves on the first of: a key, a pad button, a click or a tap once **2.5 s** have passed (a
  press before that is remembered and honoured at the minimum, so a launch-time key mash cannot
  skip it unread and no press is seen to do nothing); or **10 s** on screen by itself, time while
  the window is hidden not counting, so an unattended launch never sits on it. While it is up,
  every key and pointer event is its own (a press that continues the warning must not also skip
  the title); function keys and Ctrl/Alt/Meta shortcuts pass through.
- **The boot never waits for it.** The game keeps loading underneath (a synchronous shader
  compile behind a still, opaque screen freezes nothing that is seen), and only what the player
  must *see* follows it: main.js moves the loading screen's clock (`startupShellShownAt`, the
  ident's 4 s minimum and its 1.65 s reveal) to the moment the warning lifts, and parks the hold
  (`.sb-lit`) for then. The watchdogs and the warp are untouched.
- **It is shown every launch.** The only skips are a harness's: `?photosensitivityWarning=0`,
  the saved `serenity.photosensitivityWarning=0` (the shared flag idiom, the developer's toggle
  in an installed game) and `?skipIntro=1`. No "don't show again" is offered.

### 2. Reduce flashing effects is its own setting, read live, and never folded into Reduce motion

- `reduceFlashing` (off by default) sits beside `reducedMotion` in `SettingsManager`, in the
  Steam cloud's settings keys, and in Settings › Visual › Effects. The help text says what it
  does and that the worlds keep moving.
- `src/core/photosensitivity.js` is the one reader: `prefersReducedFlashing(settings?)` and
  `flashScale(settings?)` (1, or `REDUCED_FLASH_SCALE` = 0.08 under the setting: under the 10 %
  relative-luminance step that WCAG 2.3.1 counts as a flash). It reads `window.settings`, which
  main.js keeps current, so a world may call it every frame. `applyReduceFlashingClass` mirrors
  the setting on `<html>` (`html.sb-reduce-flashing`) for the DOM flashes.
- Where it applies: **every theme post stack** multiplies the frame-wide flash it is handed
  (`this.uFlash.value = flash * flashScale()`, the one shared line of every `*-post.js`); the
  sky and world flash sites outside the post stack do the same (Crystal Cave, Solar Eclipse,
  Starlight, Summer, Murmuration, Fluid Dreams); lightning fires **one stroke** and the bolts'
  own beat calms (Voltage Storm); a strobe becomes steady light (Chromadelic Highway); Rainbow
  Terraces' governor takes its reduced mode (a flash becomes a glow); the board's screen flash
  (`SharedEffects._screenFlash`) becomes a slow, soft glow: a tenth of the board at most, no
  hold, a fall of at least 700 ms; the CSS flashes (line-clear bars, meters, HUD chips, the
  lantern) are stilled by the stylesheet. Reduce motion is left exactly as it was.
- A new theme's post stack **must** scale its flash the same way; the fitness test fails
  otherwise. A flash written anywhere else is multiplied by `flashScale()` where it is written.

### 3. The store page says so

The README's Accessibility section carries the wording for the store page: that the game contains
flashing lights and effects, that a warning opens every launch, and that Reduce flashing effects
exists. Keep the two in step.

## Consequences

- The first interaction of a launch is at least 2.5 s away, and an unattended launch reaches the
  loading screen 10 s later than before. The boot's own work is not delayed; on a cold boot
  (10–14 s, ADR-0020) the warning is read while the shaders compile.
- Harnesses that measure or screenshot the opening skip the warning explicitly
  (`boot-smoothness-probe`, `windows-menu-visual-validation`, `wolfhour-phase6-validation`);
  everything that boots with `skipIntro=1` is covered already.
- `startupDebug` traces gain `photosensitivity-warning:observed` and `:dismissed`
  (`reason`, `via`, `visibleMs`), and the performance monitor records
  `photosensitivity_warning_dismissed`.
- Under Reduce flashing a frame-wide event keeps 8 % of its flash: still an acknowledgement, not
  a flash. Small, local lights (a lock's glow, the Neon District beacons, a row's band) are
  below WCAG's area threshold and are left alone; a theme that adds a frame-wide flash outside
  its post stack scales it at the write site.

## Enforcement

- `tests/unit/photosensitivity-warning.test.js`: the controller (the minimum, the queued press,
  the auto-continue and hidden time, pad buttons, swallowed and passed-through keys, the fade,
  the skips) and index.html (the warning is the first element of `<body>`, before the loading
  screen; the wording; inline, still, white on black; the Visual tab's row).
- `tests/unit/reduce-flashing.test.js`: the reader and the scale; the board flash under the
  setting (and that Reduce motion alone leaves it); **every** `*-post.js` scales its flash and
  the world/sky sites do; the default, persistence and cloud key.
- `tests/unit/flag-registry.test.js`: the `photosensitivityWarning` flag (permanent-ops, local
  reader); Settings › URL parameters documents it.
