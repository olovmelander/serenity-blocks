# Hale sessions, the practice pass — capture evidence (2026-10-05)

Captures for [docs/HALE_SESSIONS_2026-10.md](../../docs/HALE_SESSIONS_2026-10.md), taken in the real
game by `scripts/capture-hale-sessions.mjs`: boot `index.html?skipIntro=1`, enter Serenity Mode
through the menu, open the Hub's Hale tab, and drive the flow with clicks. A real session is twenty
minutes, so stages were stepped through the session manager and each was held still for its
screenshot; a few days of practice were seeded first so the streak and best-hold lines have
something to show. Headless Chromium on SwiftShader (no GPU in the cloud container), WebGPU backend:
pixels, not timings (ADR-0016). The "before" of this pass is in
[reports/breathing-overhaul-2026-10](../breathing-overhaul-2026-10/README.md) (`game-hale-*.jpg`,
`phone-hale-hold.jpg`).

## Desktop, 1440 × 900

| File | Step |
| --- | --- |
| [game-hale-catalogue.jpg](game-hale-catalogue.jpg) | Hub → Hale sessions: your practice (3 days in a row, the week, totals) and each card's own line ("You · 1 completed · best hold 1:42"); "Holds at your pace" |
| [game-hale-prepare-base.jpg](game-hale-prepare-base.jpg) | Preparation for Hale Base: the journey with the world of each stage, your best hold, an intention chosen, the remembered switches, and the safety note that must be read once before Begin |
| [game-hale-countdown.jpg](game-hale-countdown.jpg) | The countdown, with the intention |
| [game-hale-arrive.jpg](game-hale-arrive.jpg) | The arrival card over Ancient Forest; the stage header steps back while it shows |
| [game-hale-round-card.jpg](game-hale-round-card.jpg) | Round 1's card over Ocean Tide ("Rhythmic Breathing · 30 breaths"), the counted breath below |
| [game-hale-hold-open.jpg](game-hale-hold-open.jpg) | An open hold at 0:42 over Cosmic Nebula: the dial filling toward its suggested 1:00, "Press Space or click to breathe in", the Breathe in button, "Held 0:42" |
| [game-hale-hold-ready.jpg](game-hale-hold-ready.jpg) | The same hold at 1:12, past its suggestion: the ring full and glowing, "Breathe in when ready" |
| [game-hale-recovery.jpg](game-hale-recovery.jpg) | After breathing in: the recovery breath over Heart Glow (2 s in, 11 s held, 2 s out) |
| [game-hale-rest-natural.jpg](game-hale-rest-natural.jpg) | The rest over Moonlit Waters: its card, and "Breathe naturally" with no count |
| [game-hale-closing.jpg](game-hale-closing.jpg) | Fourteen seconds before the end: "Coming back", "Come back gently" |
| [game-hale-result.jpg](game-hale-result.jpg) | The result: a new best hold (2:11, was 1:42), measured time, rounds and breaths, the holds round by round against their suggested lengths, the streak, the intention |
| [game-hale-rest-pause.jpg](game-hale-rest-pause.jpg) | Hale Rest's soft pause over Zen Garden: "Pause", a dial counting down 0:12, "Rest on empty, softly" |
| [game-hale-flow-carry.jpg](game-hale-flow-carry.jpg) | Hale Flow's stretch after a round over Crystal Prism: "Keep the rhythm", no counts, "On your own · 0:18 left" |
| [game-hale-catalogue-after.jpg](game-hale-catalogue-after.jpg) | The catalogue after the session above: 4 days in a row, today lit, "You · 2 completed · best hold 2:11" |

## Phone, 390 × 844 (touch)

| File | Step |
| --- | --- |
| [phone-hale-prepare-base.jpg](phone-hale-prepare-base.jpg) | Preparation in one column |
| [phone-hale-hold-ready.jpg](phone-hale-hold-ready.jpg) | A ready hold on the phone tier (Low, post pipeline on): "Tap anywhere to breathe in", the button clear of the Hub's corner buttons |
| [phone-hale-result.jpg](phone-hale-result.jpg) | The result in two columns, with the holds chart |

## Notes

- Every run reported no console errors and no warnings from the breathing or session code. One
  desktop run logged the game's own theme start guard ("Theme already active or paused, stopping
  before restart: forest"), a timing message from the background theme under software rendering;
  this branch does not touch theme code, and the two earlier runs of the same flow did not log it.
- A software screenshot takes seconds, longer than some stages and every title card: the driver
  holds the session's timers and the card's timer still for each shot, sets the stage's clock
  (`phaseStartTime`) to the moment shown, and loads each stage's world before entering it. The
  times on screen (0:42, 1:12) are those set moments, not timings.
- How the bells and breath tones sound, vibration on a physical phone and the wake lock were not
  checked here (headless Chromium has no audio output and no vibration motor).
