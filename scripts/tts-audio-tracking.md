# Hale voice: recording guide (ElevenLabs Eleven v4)

**Last updated:** October 10, 2026

Every line the breathing voice speaks is written in `scripts/tts-script.json`: 175 lines, about
1,775 words, for the nine Hale sessions and the twelve breathing worlds. `npm run tts:list` is the
live status (every line, its words, and whether it is recorded by the speaker the script names),
so this page is the how-to, not a checklist to keep in sync.

## Status

- **Speaker:** ElevenLabs **Eleven v4**, voice **olov-voice** (`oVRBQOcE5xQoswjGIb1u`), the
  game's own voice, made in ElevenLabs.
- **Recorded:** 20 lines in the old Gemini voice (Algieba), kept until the new speaker replaces
  them. Every line is to be recorded again by the new speaker.
- A line that is not recorded is never requested: the session shows its words on screen. Sessions
  learn what is recorded from `src/ui/effects/breathwork-recorded-voices.js`, which every recording
  run refreshes.

## The speaker and its delivery

`scripts/tts-script.json` → `voice`:

- **Model `eleven_v4`**, ElevenLabs' most natural model. It takes two voice settings only:
  `stability` 0.6 (steady, but still alive) and `similarity_boost` 0.8. It has no speed, style or
  SSML, so the slow, quiet pace comes from two places:
  - **Each delivery's audio tag**, put before the line: `welcome` *[Warm, gentle, unhurried
    narration]*, `guide` *[Calm, soothing, slow narration]*, `cue` *[Soft, slow voice]*, `still`
    *[Very soft, slow, peaceful voice]*. ElevenLabs advises tags that describe the voice, and
    warns that a tag can occasionally be read aloud: listening back (below) catches that.
  - **The text's own pauses:** `...` is a beat, and `[pause 1.5s]` becomes a `[short pause]` or
    `[long pause]` tag.
- **Shaping**, done by the recorder on every take: silence trimmed, loudness evened to −20 LUFS
  (−22 for the `still` lines, which are spoken under the closing rest), peaks at −1.5 dBFS, short
  fades, then MP3 at 96 kbps. The unshaped take is kept in `tts-masters/` (git-ignored).
- `speed`, `style` and `use_speaker_boost` stay in the file for `eleven_multilingual_v2`: change
  `model_id` back to it and they apply.

The direction the voice serves (one calm guide, no hype, fewer words deeper) is in
`docs/BREATH_EXPERIENCE_DIRECTION.md`.

## Recording, step by step

1. **The key.** In a Claude Code cloud session, add it in the environment's settings (the
   environment menu in the session's title bar, then Edit): a **network secret** for
   `api.elevenlabs.io` with the header `xi-api-key`, or an **environment variable**
   `ELEVENLABS_API_KEY`. A new session picks it up. On a computer, `.env.local` at the repository
   root (git-ignored) works too: `ELEVENLABS_API_KEY=...`. Never paste a key into a chat or a
   commit. The recorder checks the key itself and says what is missing. A restricted key needs
   Text to Speech, Speech to Text, Voices (read, and write to add Voice Library voices) and User
   (read, for the credits left).

2. **Find candidates** in the Voice Library, if another voice is wanted (the game's own voice is
   already set). Free: nothing is generated.

   ```
   npm run tts:record -- --browse
   npm run tts:record -- --browse=gentle,whisper,narrator --gender=female
   ```

   The default search is *meditation, calm, soothing, sleep*. It lists the most used matching
   voices (a voice many people use is a proven one), shows a voice with its own higher rate after
   the others, and saves each voice's preview to `tts-auditions/library/`. Previews are the
   owner's sample, not our lines.

3. **Audition** on our own lines (First Breath's welcome, a soft cue and the sleep closing),
   written to `tts-auditions/<voice>/<model>/`. The game is untouched. For the game's own voice,
   compare stabilities (v4's main control besides its tags) and the two models:

   ```
   npm run tts:record -- --audition=oVRBQOcE5xQoswjGIb1u --stabilities=0.45,0.6,0.75
   npm run tts:record -- --audition=oVRBQOcE5xQoswjGIb1u --models=eleven_v4,eleven_multilingual_v2
   npm run tts:record -- --audition="<owner id>/<voice id>,<owner id>/<voice id>"
   ```

   `--browse` prints each library voice's `<owner id>/<voice id>`; a Voice Library voice is added to
   My Voices first. A name finds a voice already in My Voices. `--only=` or `--group=` auditions
   other lines. A Professional Voice Clone speaks Eleven v4 only once it is trained for it (My
   Voices, the voice, + beside Eleven v4); the recorder says so if it is not.

4. **Choose:** set `voice.voice_id` (and `voice.voice_name`, for people reading the record), and
   the chosen `voice_settings.stability` or `model_id`, in `scripts/tts-script.json`.

5. **Record.** `npm run tts:list` shows the plan and its cost, then:

   ```
   npm run tts:record
   ```

   All 175 lines are about 15,000 characters with their tags: roughly $1.20 at the API's standard
   rate, or 15,000 credits. Two lines are made at a time (`--concurrency=` up to 5). Each line is
   saved as soon as it is made and its take noted in `scripts/tts-recordings.json`, so a run that
   stops (credits, a lost connection) continues where it stopped when run again. The recorder
   adapts to the plan on its own: 44.1 kHz WAV, else 24 kHz WAV, else 24 kHz PCM; a model that
   refuses a language code or context is asked without them.

6. **Listen back.** Every line a run records is heard again by ElevenLabs Speech to Text
   (`scribe_v2`) and compared with its words. A tag read aloud, a skipped or an invented word is
   flagged, kept in the record (`"heard": "differs"`), and the run ends with the command that
   records those lines again:

   ```
   npm run tts:record -- --retake=cues/breathe_in_soft,tide/r1_active
   ```

   A retake asks for a new seed. `npm run tts:record -- --verify` listens to every recorded line
   again; `--no-verify` skips listening on a record run.

7. **Check and commit.** `npm run tts:list` shows every line ✓. Then run
   `npx vitest run tests/unit/hale-session-audio-assets.test.js tests/unit/tts-recordings.test.js`
   (every clip a few seconds long, the index matching the files), listen to a session or two, and
   commit together: `public/assets/audio/breathwork/voices/`,
   `src/ui/effects/breathwork-recorded-voices.js`, `scripts/tts-recordings.json` and
   `scripts/tts-script.json`. `npm run tts:index -- --prune` removes the old voice's files that no
   line plays any more.

## Commands

| Command | What it does |
| --- | --- |
| `npm run tts:list` | Every line and its state: ✓ this speaker, ↻ another speaker, other settings or older words, · not recorded, ? made elsewhere. No key needed. |
| `npm run tts:record` | Records every · and ↻ line, then listens back to them. Run it again to continue a run that stopped. |
| `npm run tts:record -- --browse[=words] [--gender=] [--limit=12]` | Voice Library voices that match, with previews. Free. |
| `npm run tts:record -- --audition=A,B [--models=...] [--stabilities=...]` | Tries voices, models and stabilities on three lines. Writes only to `tts-auditions/`. |
| `npm run tts:record -- --verify` | Listens back to every recorded line and names those that differ. |
| `npm run tts:record -- --retake=group/id,...` | Records these lines again with a new seed. |
| `npm run tts:record -- --group=first,tide` / `--only=tide/r1_carry` | Only these groups or lines (a bare id matches it in every group). |
| `npm run tts:record -- --overwrite` | Retakes every selected line. |
| `npm run tts:record -- --reshape` | Re-shapes and re-encodes from `tts-masters/` after a loudness or bitrate change. No requests. |
| `npm run tts:record -- --voice=... --model=...` | Overrides the speaker for one run. |
| `npm run tts:index` | Re-indexes the recorded clips. `-- --check` only checks; `-- --prune` deletes files no line plays. |

**Changing a line's words:** edit its `text` in `tts-script.json`. It shows as ↻ and the next
`npm run tts:record` records it again. A stage line repeats the words the session shows on screen
(its `subPrompt` in `src/ui/effects/breathwork-session-manager.js`), so change both: a test checks
they match.

**A new line:** add it to a group in `tts-script.json` (45 words at most) and reference it from the
session data. `hale-session-audio-assets.test.js` fails for a line a session can play that is not in
the script, and for a line in the script that nothing plays.

## History

- December 2025: 107 lines recorded with Gemini 2.5 Pro TTS, voice Algieba.
- October 2026: the five beginner sessions written; the original four rewritten to breathe their
  worlds' techniques; world introductions and cue words added; 87 clips of lines that left the
  script pruned. The recorder moved to ElevenLabs (Eleven v4), with the Voice Library search,
  auditions, loudness shaping, MP3 and listening back. `scripts/tts-generated.log` (git-ignored)
  logs every request.
