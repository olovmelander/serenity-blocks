# Hale voice: status and recording guide

**Last updated:** October 10, 2026

Every line the Hale sessions speak is written in `scripts/tts-script.json`: 156 lines, about 1,250
words. `npm run tts:list` is the live status (every line, its words, and whether it is in the
speaker that `voice_config` names), so this page is the how-to, not a checklist to keep in sync.

## Status

- **107 recorded** in the current voice: Gemini TTS, voice **Algieba**, model
  `gemini-2.5-pro-preview-tts`, style `[Speak calmly and meditatively, like a peaceful breathing guide]`.
- **49 written, not recorded yet:**
  - the five beginner sessions (47): five session intros, 22 stage lines and 20 intentions, in the
    groups `session_intros`, `first`, `tide`, `roots`, `unwind`, `sunrise` and `intentions`;
  - two lines every session shares: `transitions/breathe_when_ready.wav` ("Breathe in... whenever
    you're ready.", when an open hold reaches its suggested length) and `transitions/closing.wav`
    (as the closing rest turns to coming back).
- A line that is not recorded is never requested: the session shows its words on screen, and the
  recorded shared lines (soft breath cues, round openings, encouragement, the rest's lines) carry
  the voice meanwhile. Sessions learn what is recorded from
  `src/ui/effects/breathwork-recorded-voices.js`, which recording refreshes.

## A new speaker for every session

1. **Key.** Get one at <https://aistudio.google.com/apikey> and put it in a file named `.env.local`
   at the repository root (git-ignored, read by the script on Node 20.12 or later):

   ```
   GEMINI_API_KEY=your-key
   ```

   Or set it in the shell for the session: PowerShell `$env:GEMINI_API_KEY = "your-key"`, bash
   `export GEMINI_API_KEY=your-key`.

2. **Audition** voices on three lines (First Breath's intro, a soft breath cue and the closing),
   written to `tts-auditions/<voice>/`. Nothing in the game changes.

   ```
   npm run tts:record -- --audition=Achernar,Vindemiatrix,Sulafat,Despina
   ```

   Gemini has 30 prebuilt voices. Google's descriptions of a few calm ones: Achernar (soft),
   Vindemiatrix (gentle), Sulafat (warm), Despina and Algieba (smooth), Enceladus (breathy), Schedar
   (even). Add `--style="[...]"` to try another delivery, or `--group=` / `--only=` to audition other
   lines.

3. **Set the speaker** in `scripts/tts-script.json` → `voice_config`: `voice_name`, `model` and the
   `style` prompt that sets the delivery. If Google has replaced the preview model, name the current
   Gemini TTS model; a model that is not found stops the run straight away with a message.

4. **Record.** `npm run tts:list` shows the plan: every line now reads ↻ (in another voice) or
   · (not recorded). Then:

   ```
   npm run tts:record
   ```

   One line every 7 seconds, so about half an hour for all 156. Each line is saved as soon as it is
   made, and its take is noted in `scripts/tts-recordings.json`. If the run stops (Gemini's daily
   quota, a lost connection, a closed window), run the same command again: it continues where it
   stopped. A refused key, an unknown model or three failures in a row stop the run with a reason
   instead of failing every remaining line.

   Until the run has finished, the sessions mix the old and the new voice.

5. **Check and commit.** `npm run tts:list` shows every line ✓. Then
   `npx vitest run tests/unit/hale-session-audio-assets.test.js tests/unit/tts-recordings.test.js`
   (every recorded clip lasts between half a second and 25 seconds, the index matches the files),
   listen to a session or two, and commit these together:
   `public/assets/audio/breathwork/voices/`, `src/ui/effects/breathwork-recorded-voices.js` and
   `scripts/tts-recordings.json`. Delete `tts-auditions/` when you are done with it.

## Commands

| Command | What it does |
| --- | --- |
| `npm run tts:list` | Every line and its state: ✓ in this voice, ↻ in another voice or from older words, · not recorded, ? made elsewhere. No key needed. |
| `npm run tts:record` | Records every · and ↻ line. Run it again to continue a run that stopped. |
| `npm run tts:record -- --group=first,tide` | Only these groups. |
| `npm run tts:record -- --only=tide/r1_carry.wav` | Only these lines. A bare file name (`r1_active.wav`) matches it in every group. |
| `npm run tts:record -- --overwrite --only=...` | Retakes lines that are already in this voice. |
| `npm run tts:record -- --voice=... --model=... --style=...` | Overrides `voice_config` for one run. |
| `npm run tts:record -- --audition=A,B` | Tries voices. Writes only to `tts-auditions/`. |
| `npm run tts:index` | Re-indexes the recorded clips after you add or remove files by hand. `-- --check` only checks. |

`node scripts/generate-tts.js ...` takes the same flags.

**Changing a line's words:** edit its `text` in `tts-script.json`. It shows as ↻ and the next
`npm run tts:record` records it again. A stage line repeats the words the session shows on screen
(its `subPrompt` in `src/ui/effects/breathwork-session-manager.js`), so change both.

**A new line:** add it to a group in `tts-script.json` (45 words at most) and reference it from the
session data. `hale-session-audio-assets.test.js` fails for a clip a session can play that is not
in the script.

**Another TTS tool:** save each clip as a WAV file at the path `tts:list` prints, under
`public/assets/audio/breathwork/voices/`, then run `npm run tts:index`. Those clips show as
? (made elsewhere), and `tts:record` leaves them alone unless you pass `--overwrite`.

## History

- December 2025: 107 lines recorded with Gemini 2.5 Pro TTS, voice Algieba: the four sessions,
  their intros and intentions, transitions, cues, fillers and encouragement.
- October 2026: two Elixir clips trimmed from nine minutes to their speech (see
  `docs/HALE_SESSIONS_2026-10.md`). The five beginner sessions and two shared lines were written,
  and the script was made resumable, keeps the take of each clip and runs auditions, ready for a new
  speaker.
- `scripts/tts-generated.log` (git-ignored) logs every request the script makes.
