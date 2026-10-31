# Odyssey orb copy: every orb's words, rewritten and in one place

Status: **Implemented.** Date: 2026-10-31.

The owner asked for the text, titles and descriptions on all Odyssey orbs to be written well.
Every orb's name, card description and tip was reviewed against what the orb shows and how it
plays; all 60 descriptions and 54 tips were rewritten and 11 orbs renamed. The words now live in
one table, so what is in that table is exactly what ships.

## What was wrong

The copy was spread over five layers in `src/core/odyssey/data/`: the base level list, the
phase-2 overrides, the rival template in `applyBotChallenge`, a late `correctObjectiveDescription`
pass and the two orbs `campaign-order.js` inserts. Later steps overrode or outdated earlier
ones, and nothing checked the result. Examples from the audit:

| Kind | Example |
|---|---|
| Design notes shipped as copy | "This is a release beat." "Treat this as a reset level." "Let the first abstract chapter beat feel strange, but not yet hostile." |
| Claims the reordering broke | Orb 47 said "Chapter 6 finale" and orb 59 "The encore finale"; since the 2026-10-18 rotation a rival duel follows each of them. |
| Words for a swapped-out world | Orb 7, a night beach of glowing surf, was "Sunken Depths" about "layered reef structures"; orb 32's halo and sundogs were "Cosmic Threshold" in the sky chapter; orb 58's neon ridges were "towering skyscrapers". |
| False pace | Orb 8 promised "the slower rhythm", but it opens at 320 ms a row after orb 7's 800 ms. |
| One text for eight rivals | Every duel read "<Orb name>: <Rival>, the chapter's rival, waits at the end of the path..." and its tip restated the rules and star limits. |
| Repeated names | "Koi Sanctuary" then "Stillwater Sanctuary"; "Electric Apex" then "Electric Nights"; "Celestial Loom" two orbs before "Celestial Chrysalis". |
| Numbers that drift | Descriptions repeated goal targets, so `correctObjectiveDescription` had to rewrite three of them after tuning. |
| Too long for the card | The navigator card shows two lines on a 1366×768 screen; at least 18 old descriptions were cut off with an ellipsis (the longest was 273 characters). |

## What changed

**One table.** `src/core/odyssey/data/orb-copy.js` holds every orb's `name`, `description` and
`tip`, keyed by the orb's theme (each orb has its own world, and the world travels with its orb
when the campaign is reordered). `levels.js` applies it after `assembleOdysseyCampaign`. The old
text fields were removed from `levels.js` and `campaign-order.js`, and `correctObjectiveDescription`
is gone. The file header states the voice rules.

**The voice.** What you see, then what the orb asks of you; no numbers (the goal and star lines
carry them); plain US English; no design vocabulary; no claim to be "last" or "final" unless the
orb ends its chapter; pace and clock claims that match the orb's real speed and failure rule; a
rival's card names the rival and says how it plays, from its tier in `bot-difficulty.js`.

**Renamed orbs.** Saves, boards and theme rewards use orb ids, so names are display only.

| Orb | Was | Now | Why |
|---|---|---|---|
| 4 | Crystal Cavern | The Living Grotto | A glowing-mushroom cave, and orb 2 is already the crystal cave. |
| 7 | Sunken Depths | Night Surf | The world is a night beach of glowing surf. |
| 9 | Stillwater Sanctuary | Tarn of Wisps | Followed "Koi Sanctuary"; the tarn's wisps fly home on every clear. |
| 19 | Mountain Base | Blossom Foothills | Named the cherry garden instead of a placeholder. |
| 27 | Cloud Walker | Lantern Sky | Clears lift paper lanterns into the sky. |
| 28 | Starlight Reverie | Mirror of Stars | A lake that doubles the sky; "Reverie" was used at orb 14. |
| 32 | Cosmic Threshold | Ice Halo | An ice-crystal halo with sundogs, in the sky chapter. |
| 39 | Ember Core | Dying Ember | Followed "Galaxy Core" in the same chapter. |
| 41 | Celestial Loom | Loom of Heaven | The theme's own name for it; "Celestial" was used at orb 43. |
| 59 | Electric Apex | Rainlit Streets | The rain canyon of shop signs, and "Electric" was orb 60's word too. |
| 60 | Electric Nights | Last Light | The journey ends at a pier at sunset. |

**Shared lines** (`src/ui/odyssey/objective-copy.js`, `odyssey-level-briefing.js`, `OdysseyHUD.js`):

- Bonus goal labels are written from the bonus's type and number, so the same goal reads the
  same everywhere and a retune cannot leave stale words: "No single-line clears",
  "Clear 6 Quads", "Finish in under 1:30". The authored `description` only names unknown types.
- Star lines capitalize "Quads", say "1 Quad" rather than "1+ quads", and duels read
  "Win the match + At most 1 top-out". A bonus the star's other goals already guarantee is not
  named again (orb 16 listed its Quads twice; orb 4's bonus is guaranteed outright).
- The duel rule says what was missing: a single sends nothing ("Clear two or more lines with one
  piece to send attack rows"), and both wells reset after every top-out, not only knockouts.

**Data.** Orbs 33 and 45 lost a "Complete in under 3 minutes" bonus written when their limit was
five minutes; after the retune to 3:00 and 2:30 it was met by every clear. No star used it.

**Phone layout.** The navigator card's copy column is a size container, so it has no width of its
own; the ≤640 px layout centred it and it collapsed to 0 px, setting the orb's name and
description one word to a line. It now stretches across the card
(`public/styles/odyssey-navigator.css`).

## Verification

- `tests/unit/odyssey-orb-copy.test.js` checks every orb: copy exists for its theme and none is
  left over, unique names with no word repeated inside a chapter, description length (at most 108
  characters, measured below), no digits, no design vocabulary, US spelling, no genre mark, place
  claims only on chapter ends, rival names only in duels, and speed, clock and showcase claims
  against the orb's real drop interval, failure rule and victory-lap policy.
- Tests pinned to the old words were updated; new cases cover the generated bonus labels, the
  star lines and the next-star explanation.
- Render check: the real navigator card and map panel (real markup, CSS and campaign data) for
  all 60 orbs in headless Chromium at 1920×1080, 1366×768, 1024×768 and 390×844. No description is
  clipped (two lines, three on a phone) and there are no console errors. At 1366×768, 108
  characters always fit the two-line clamp and 120 never did.
- No theme, chapter or WebGPU code changed, so no world capture was needed.

## Left for the owner

- Orb 4's third star: its bonus ("Trigger 3 cascades") is guaranteed by the star's own
  "3+ cascades", so three stars means 40 lines and 3 cascades. Retune the bonus if a harder star
  was intended.
- Several timed orbs show three times (a bonus, two star times) besides the limit, for example
  Gathering Storm: bonus under 2:00, stars under 2:30 and 1:45, limit 4:30.
- The final rival is named Neon, two orbs after Neon Dusk (named for its theme).
- Chapter text was out of scope: chapter 7 is "Black Hole & Abstract Transcendence" though the
  black hole orb is in chapter 6, chapter 6's outro still says the event horizon awaits, and the
  chapter 5 intro spells "coloured".
