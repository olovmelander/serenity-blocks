# Hale sessions — the practice pass (October 2026)

The four guided Hale sessions (Base, Elixir, Rest, Flow) rebuilt around what the practice actually
is: holds you end when you need to breathe, stages that do what their voice says, an intention that
is used, a real ending, and a result that measures what you did. It replaces the "Hale sessions"
part of [BREATHING_OVERHAUL_2026-10.md](BREATHING_OVERHAUL_2026-10.md); the worlds the sessions
pass through are described by
[BREATHING_WORLDS_MASTERPIECE_2026-10.md](BREATHING_WORLDS_MASTERPIECE_2026-10.md).
Captures: [reports/hale-sessions-2026-10](../reports/hale-sessions-2026-10/README.md).

## What the player gets

**Holds at your own pace (Base and Elixir).** After the breathing round you hold on empty lungs
for as long as feels good. A ring fills toward the suggested length (1:00, 1:30, 2:00), the time
counts up inside it, and at the suggestion a small bell rings and the ring glows. You end the hold
with Space, a click or tap anywhere on the world, the **Breathe in** button, or a gamepad's A; the
recovery breath follows at once. A hold cannot run past twice its suggestion (four minutes at most):
the voice brings you back. *Breathe in when you are ready* can be switched off for the old timed
holds.

**Every stage does what its voice says.**

| Session | Stillness after each round | Arrival | Rest |
| --- | --- | --- | --- |
| Hale Base | A hold you end yourself | Paced 5 · 2 · 5 · 2 | Natural breath, no counts |
| Hale Elixir | A hold you end yourself | Paced 4 · 1 · 4 · 1 | Natural breath, no counts |
| Hale Rest | A soft 20–30 s pause, opened with "Rest in the pause…" | Paced 4 · 1 · 7 · 2 (long out-breath) | Natural breath, no counts |
| Hale Flow | The box goes on uncounted: "Keep the rhythm" | Paced 5 · 2 · 5 · 2 | Natural breath, no counts |

Before, Flow's "Let the rhythm continue in your body" and Rest's "Gentle Pause" ran as empty-lung
holds announced with "Now… empty… and hold.", and the closing rest of every session ("Return to
natural breath") was paced with words and counts. Rest's and Flow's final rounds no longer open with
"Final round… give everything"; they get "Almost there… one more round."

**A recovery breath lets go.** Its "Release." cue now plays on the out-breath that ends it (it was
scheduled at the start of the stage, where the voice always silenced it).

**Your intention is used.** The one you choose is spoken once you are breathing in the arrival, and
shown under the stage title as you arrive and as you rest. Before, the choice was spoken on the
preparation screen and then a random intention (sometimes another session's) played in the session.

**A real ending.** The rest's spoken lines are spread across it, the last one about half a minute
before the end; fourteen seconds before the end the words turn to coming back ("Move your fingers
and toes. Open your eyes when you are ready."); the session closes on a bell. Before, the last two
minutes were silent and the session ended abruptly.

**Sound you can practise to with your eyes closed** (*Bells and breath tones*, on by default): a
singing-bowl bell opens the session and each round and closes the session, a small bell marks a
hold's suggested length, and soft rising and falling tones mark slow breaths (phases of 2.5 s and
longer) when the voice is quiet. On phones that can vibrate, light pulses mark the same moments
(*Gentle vibration*, offered on touch devices only).

**Title cards.** Each round opens with a large card over the world ("Round 2 of 3 · Go Deeper ·
40 breaths"), as do the arrival and the rest; the header steps back while it shows.

**The result measures what you did:** time for yourself, rounds and breaths completed, and your
holds round by round as a chart beside their suggested lengths. A hold longer than your best in that
session is a **new best**; the result says by how much. Then your streak and totals. Before, three
of the four figures were constants from the session's definition.

**Your practice in the catalogue:** days in a row, the last seven days, sessions completed and time
practised, and on each card what you have done in it ("You · 3 completed · best hold 1:42"). A
session you end after a minute or more still counts as practice (not as completed).

**Preparation:** the journey shows the world each stage is set in; *Voice guidance*, *Bells and
breath tones*, *Breathe in when you are ready* and *Gentle vibration* are remembered between visits;
before the first Base or Elixir session the safety note must be acknowledged once ("Holding your
breath after fast breathing can make you light-headed. Sit or lie down. Never practise in or near
water, while driving, or standing.").

**The session waits for you.** It pauses while the Hub is open over it and continues when the Hub
closes; it pauses while it asks whether to end (and continues on *Keep going*); it pauses when the
page is hidden and waits for you to resume (hidden pages throttle timers, and a session must not run
on without you). The Hub's own *End session* asks for a second press. The screen is kept awake while
a session runs (Screen Wake Lock, where the browser has it).

**Controls:** Space ends an open hold, otherwise pauses; P pauses; Esc asks to end. Gamepad: A ends
an open hold or pauses (and presses the focused button on the session screens), B asks to end and B
again ends (and steps back on the session screens).

## Fixes

- `elixir/r3_hold.wav` and `elixir/r3_recovery.wav` were 9.4 and 9.1 minutes long: about 9 s of
  speech followed by near-silent noise, 53 MB between them, preloaded at every Elixir start and
  keeping the voice "playing" for the whole stage. Trimmed to their speech with a short fade
  (9.5 s and 6.2 s). The voice folder is 29 MB instead of 79 MB.
- The session's own start clip and the chosen intention are now preloaded with the rest.
- The Breathing tab said "16 to 27 minutes"; the sessions run 19 to 26.
- The spoken-cue counter was never reset between sessions.
- The guide's *Resume* label survived a session that ended while paused.
- The per-cue `console.log` stream is gone.

## How it works

| File | Role |
| --- | --- |
| `src/ui/effects/breathwork-session-manager.js` | Session data and runner. A retention stage's `hold` is `'open'` or `'timed'`; Flow's stillness is a `carry` stage with the round's box pattern. Measures breaths, rounds and holds; `breathe()`, `snapshot()`, `suspend()`/`unsuspend()`; wake lock; bells. |
| `src/ui/effects/breathwork-practice-log.js` (new) | The practice log: entries, totals, streak, the week, best open hold per session, personal-best detection. Pure functions over a storage object. |
| `src/ui/effects/breathwork-chimes.js` (new) | Bells, breath tones and vibration, synthesised on the game's AudioContext through its effects bus (so the game's mute and effects volume apply). No audio files. |
| `src/ui/effects/breathing/breathing-guide.js` | Guidance modes (`paced`, `open-hold`, `timed-hold`, `carry`, `natural`, `closing`), the hold dial, the Breathe-in button, title cards, the intention line, a screen-reader announcer, the end confirmation that holds the session, gamepad actions. |
| `src/ui/serenity-hub/SessionsTab.js` | Catalogue with your practice, preparation (journey with worlds, remembered switches, one-time safety note), countdown, result with the holds chart, best and streak; records ended sessions; holds the session under the Hub. |
| `src/ui/gamepad-controller.js`, `SerenityHub.js` | A and B reach a session when the Hub is closed. |
| `public/styles/breathing-guide.css`, `breathwork-sessions.css` | The new pieces' styles, with phone and short-landscape layouts and reduced motion. |

**The practice log** stays under `localStorage['serenity.haleSessions']`, now version 2: the old
totals (`count` completed, `seconds`, `last`) are kept, so an existing record carries over, and
`entries` hold one line per sitting (`id`, `at`, `seconds`, `completed`, `rounds`, `breaths`, `holds`,
`intention`), the newest 200. Preferences are `localStorage['serenity.halePrefs']`.

**Timing.** The journey and "minutes to go" are laid out by plan (open holds at their suggestion); a
hold held past its suggestion waits at the end of its mark. What is reported at the end is measured
on the session clock, pauses excluded.

**The world during each stage** (`calm` in the stage): a hold is stillest (1), the rest 0.8, Flow's
carry 0.45, the recovery 0.35, the arrival 0.25, the breathing rounds 0.

## Verification

- **Unit tests:** `hale-session-practice.test.js` (open holds: Space/tap/limit/pause/timed; Rest's
  soft pause; the release cue; the intention; the closing and the spacing of the rest's lines; round
  cards; measured results; `snapshot()`; suspensions for the Hub, the end question and a hidden page;
  wake lock), `breathwork-practice-log.test.js`, `breathwork-chimes.test.js`,
  `hale-session-audio-assets.test.js` (every clip a session can play exists and is seconds long:
  it fails on the two nine-minute clips this pass trimmed), and new cases in
  `breathing-guide.test.js` and `breathwork-sessions-presentation.test.js`. Existing tests updated
  where the behaviour changed on purpose (Flow's carry stage, the stage data, the practice strip, the
  Hub's two-press End, the end question holding the session).
- **The real game**, driven by `scripts/capture-hale-sessions.mjs` in headless Chromium on
  SwiftShader at 1440 × 900 and 390 × 844 (touch): catalogue, preparation, countdown, arrival, a
  round card, an open hold before and after its suggestion, the recovery, the natural rest and its
  closing, the result with a new best, Rest's pause, Flow's carry stage, the catalogue afterwards.
  No console errors; the captures also caught a real bug (a session started straight after another
  inherited its intention), fixed and tested. See the report for the files.
- **Gates:** the full unit suite (579 files, 7,647 tests), typecheck, the TS ratchet, dependency
  boundaries, architecture fitness, the theme lifecycle audit, the lint ratchet (no new errors; none
  in the session code), the perf-budget and release gates, the production build with its boot
  closure, the IP-string and Pages-artifact checks. The shipped voice folder is 29 MB.

Not verified: how the bells and tones *sound* (headless Chromium has no audio output; the tests pin
the node graph, levels and gating, not the timbre), vibration and the wake lock on a physical phone,
and a full session played in real time (stages were stepped).

## Open

- **New spoken lines** would help: the hold's "breathe in when you are ready", the closing words,
  Flow's carry. The voice is pre-recorded TTS (`scripts/generate-tts.js`, Gemini, needs an API key),
  so these are written on screen and in bells for now.
- **The voice files are uncompressed WAV** (29 MB). A compressed format would cut a session's
  preload several times over, especially on phones.
- **History** beyond the week strip (a calendar, every hold over time) would use the entries the log
  already keeps.
