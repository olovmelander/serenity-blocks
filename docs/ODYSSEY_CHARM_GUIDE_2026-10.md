# Odyssey charm guide: the bag at a glance (2026-10)

**Status:** Reference (record of shipped work). Surface: the charm guide that opens over the
Odyssey map (`#odyssey-charm-guide`) from the map header's charm chip and from Y on the
controller. Language: the navigator's ([ODYSSEY_NAVIGATOR_2026-10.md](ODYSSEY_NAVIGATOR_2026-10.md)),
on Keystone ([MENU_UI_OVERHAUL_2026-10.md](MENU_UI_OVERHAUL_2026-10.md)). Rules:
[ODYSSEY_CHARMS_AUDIT_2026-10.md](ODYSSEY_CHARMS_AUDIT_2026-10.md).

## 1. Why (audit, 2026-10-21)

The guide was a 720 px sheet of four equal cards and a box of five bullets.

- **The art was a thumbnail.** The four charms are live three.js sculptures (an aqua chrome
  wave, a lavender leaf, a glass hourglass, an obsidian ember), drawn at 44 px beside 13 px
  copy. The navigator makes an orb's world the hero; the guide had no hero.
- **The bag had no picture.** How many charms you hold, the thing a player opens it for, was
  a sentence in the lede and a 10 px caption at each card's foot.
- **The rules were a wall.** Five sentences of equal weight in a bordered box took a quarter
  of the sheet and read like terms of service.
- **Nothing to explore.** Only Back to map took focus; the keyboard and the pad could not
  reach a charm, and nothing responded to hover.
- **No identity.** Still Air's lavender was the sheet's own, the other tones a 6 % tint on
  held cards, and not-held cards read as broken (grey icon, grey text).
- **Not the navigator's family.** A generic modal beside a full-page journey view, and "Back
  to map" where the navigator says "Back to the map".

## 2. The surface

- **Header.** "Your bag · Charms" with the lede in words; the bag as figures (held of twelve,
  found and used this journey) and a meter of twelve cells, three per charm in its own tone,
  the selected charm's cells raised (a press on a charm's cells shows it); "Back to the map"
  (Esc, B).
- **The rail.** The four charms in key order, as a vertical tab list: the live icon in a gem
  of its tone (dashed and grey while none is held), the name, the key, the pips and "2 of 3"
  or "None in your bag". The selected row carries the tone like the navigator's chapter.
- **The card.** The selected charm's live icon at hero size (`--charm-art`, up to 300 px) in a
  halo and orbit, lit and breathing when held, at rest with a dashed orbit when not; "In your
  bag" or "Not in your bag yet", the name, three large pips with "n of 3", what it does; beside
  it "To use" (Press 1 during an orb, or tap its tile) and "When it helps".
- **How charms work.** The five rules as steps on a path (Find, Use, Keep, Mercy, Stars), a
  numbered gem each, joined gem to gem, under the rail and the card.
- **The light.** The selected charm lends the page `--charm-rgb` (Tide aqua, Still Air
  lavender, Long Breath gold, Hearth coral): the sky, the card's edge, the selection, the path;
  a glow behind the art blooms again on each change. Opaque night sky, no backdrop blur.

## 3. Behaviour

| Input | What happens |
|---|---|
| ↑ ↓ (also ← →), D-pad | Walk the rail, round its ends. Focus is the selection. |
| Home / End | Tide / Hearth. |
| 1–4 | Show the charm that key uses during an orb. |
| LB / RB | The previous / next charm (`switchMainTab` calls `modal.stepCharm`). |
| Click a row or a charm's meter cells | Show it. |
| Esc, B, Back to the map | Close; focus returns to the header chip. |

- Opening focuses the selected charm (the bag's first, Tide while empty), so the arrows answer
  at once (`odysseyCharms` in `src/ui/sheet-input.js`).
- One hero icon slot per charm, the others `hidden`: the icon stage skips zero-size slots, so
  only the shown one draws, and a change of charm lands on the next frame. The hero's glyph
  fallback waits 0.5 s before showing, so it never flashes between frames.
- Layout: rail beside the card from 1101 px, the page's measure capped at 1680 px and centred;
  below that the rail is a row of four chips and the page scrolls; five steps in a row down to
  861 px, three below; below 641 px the card stacks, the rail is two by two without keycaps and
  the steps are a list. Short windows (≤ 780 px) tighten the art and the card. The header wraps
  instead of colliding (32 px root text). Reduced motion keeps the layout and drops the
  entrances, the bloom and the breathing.

## 4. Code

| File | Role |
|---|---|
| `src/ui/odyssey/odyssey-charm-guide.js` | What the guide says (pure `describeOdysseyCharmGuide`: charms, totals, the default selection, the steps) and the page (`createOdysseyCharmGuideSheet`): header, rail, card, path, footer, selection and keys. Open/close contract unchanged. |
| `public/styles/odyssey-charms.css` | The look (`#odyssey-charm-guide`), loaded after `keystone-overlays.css`, whose old charm-guide block moved here. |
| `src/ui/sheet-input.js` | Initial focus on the selected tab. |
| `src/ui/gamepad-controller.js` | LB / RB step the charms. |

## 5. Verification (2026-10-21)

- `tests/unit/odyssey-charm-guide.test.js`: the copy, the default selection, the steps, the
  card following focus and clicks, arrows round the ends, Home/End, 1–4, the shoulders, close.
- A DOM harness (real stylesheets in `index.html` order, the real module and icon stage on the
  WebGL2 backend under SwiftShader, the real `sheet-input.js`) at 1600 × 900, 1440 × 900,
  1280 × 720, 1920 × 1080 (pad hints, reduced motion), 2560 × 1440, 1024 × 768, 390 × 844,
  320 × 568 and 1280 × 800 with 32 px root text, empty, partial and full bags: no horizontal
  overflow, all icons live, focus on open, keys, Escape and focus back to the chip checked.
- The real game on SwiftShader WebGL2: map → the header chip → the guide (focus on the bag's
  first charm, all icons live) → arrows → Escape, focus back on the chip, no console errors.
- Not yet: the same on a GPU with the WebGPU backend (headless Chromium here fails three r186's
  texture-view swizzle, so the icon stage ran on its WebGL2 fallback).
