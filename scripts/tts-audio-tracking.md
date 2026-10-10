# Hale voice: recording guide (ElevenLabs Eleven v4)

**Last updated:** October 10, 2026

Every line the breathing voice speaks is written in `scripts/tts-script.json`: 466 lines, about
2,750 words, for the nine Hale sessions and the twelve breathing worlds. `npm run tts:list` is the
live status (every line, its words, and whether it is recorded by the speaker the script names),
so this page is the how-to, not a checklist to keep in sync.

## Status

- **Speaker:** ElevenLabs **Eleven v4**, voice **olov-voice** (`oVRBQOcE5xQoswjGIb1u`), the
  game's own voice, made in ElevenLabs.
- **Recorded:** every line, in olov-voice at stability 0.5 with pauses sent as tags (chosen from
  the audition on October 10, 2026); the ten quick takes for the fire breath's out-breath
  (`cues_elixir/round_out` ..., `worlds/wim-hof_out` ...) in their own `quick` delivery, each a
  second or less. The plan has no 44.1 kHz output, so the takes are 24 kHz.
- **Breath cues are never one clip.** Every Hale session and every world has its own takes for
  the breath in, the hold, the breath out and the rest, so no two breaths in a row sound alike
  and no two sessions or worlds say the same words: see [Cue takes](#cue-takes) below.
- A line that is not recorded is never requested: the session shows its words on screen. Sessions
  learn what is recorded from `src/ui/effects/breathwork-recorded-voices.js`, which every recording
  run refreshes.

## The speaker and its delivery

`scripts/tts-script.json` → `voice`:

- **Model `eleven_v4`**, ElevenLabs' most natural model. It takes two voice settings only:
  `stability` and `similarity_boost`, at v4's defaults (0.5 and 0.75) until an audition says
  otherwise. It has no speed, style or SSML, so the slow, quiet pace comes from two places:
  - **Audio tags** before every line: *[thoughtful] [meditative] [deep]*, the tags that sounded
    right on olov-voice when tried in ElevenLabs. Each delivery (`welcome`, `guide`, `cue`,
    `still`) can have its own; today they share these, all but `quick` (below). A tag can
    occasionally be read aloud: listening back (below) catches that.
  - **The text's own pauses.** With `"pauses": "tags"` each `...` between words is sent as a
    clean `[short pause]` (after a comma, or a full stop before a new sentence), as in the line
    tried in ElevenLabs: *Observe your thoughts, [short pause] observe yourself observing your
    thoughts.* A line's closing `...` stays, drawing its last word out. `"pauses": "ellipsis"`
    sends the `...` as written. `[pause 1.5s]` becomes a `[short pause]` or `[long pause]` tag.
- **The `quick` delivery**, for the fire breath's one-second out-breath (the quick takes, which
  `tts:cues` puts on it): no tags at all, since the calm ones draw even one word out past a
  second ("Release." ran 1.4 s with them, 0.9 s without), and a short tail (`tail_ms`, below).
- **Shaping**, done by the recorder on every take: silence trimmed (90 ms kept before the first
  word, 280 ms after the last; a delivery's `tail_ms` sets that tail, 150 for `quick`), loudness
  evened to −20 LUFS (−22 for the `still` lines, which are spoken under the closing rest), peaks
  at −1.5 dBFS, short fades, then MP3 at 96 kbps. The unshaped take is kept in `tts-masters/`
  (git-ignored).
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
   npm run tts:record -- --audition=oVRBQOcE5xQoswjGIb1u --stabilities=0.4,0.5,0.65 --pauses=tags,ellipsis
   npm run tts:record -- --audition=oVRBQOcE5xQoswjGIb1u --models=eleven_v4,eleven_multilingual_v2
   npm run tts:record -- --audition="<owner id>/<voice id>,<owner id>/<voice id>"
   ```

   The first is 18 short takes (three stabilities, two ways of pausing, three lines), each in its
   own folder such as `eleven_v4-stability-0.5-pauses-tags/`.

   `--browse` prints each library voice's `<owner id>/<voice id>`; a Voice Library voice is added to
   My Voices first. A name finds a voice already in My Voices. `--only=` or `--group=` auditions
   other lines. A Professional Voice Clone speaks Eleven v4 only once it is trained for it (My
   Voices, the voice, + beside Eleven v4); the recorder says so if it is not.

4. **Choose:** set `voice.voice_id` (and `voice.voice_name`, for people reading the record), and
   the chosen `voice_settings.stability`, `pauses` or `model_id`, in `scripts/tts-script.json`.

5. **Record.** `npm run tts:list` shows the plan and its cost, then:

   ```
   npm run tts:record
   ```

   All 466 lines are about 34,000 characters with their tags and pauses: roughly $2.70 at the
   API's standard rate, or 34,000 credits. Two lines are made at a time (`--concurrency=` up to 5). Each line is
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
| `npm run tts:record -- --audition=A,B [--models=...] [--stabilities=...] [--pauses=tags,ellipsis]` | Tries voices, models, stabilities and ways of pausing on three lines. Writes only to `tts-auditions/`. |
| `npm run tts:record -- --verify` | Listens back to every recorded line and names those that differ. |
| `npm run tts:record -- --retake=group/id,...` | Records these lines again with a new seed. |
| `npm run tts:record -- --group=first,tide` / `--only=tide/r1_carry` | Only these groups or lines (a bare id matches it in every group). |
| `npm run tts:record -- --overwrite` | Retakes every selected line. |
| `npm run tts:record -- --reshape` | Re-shapes and re-encodes from `tts-masters/` after a loudness, tail or bitrate change. No requests. |
| `npm run tts:record -- --voice=... --model=...` | Overrides the speaker for one run. |
| `npm run tts:index` | Re-indexes the recorded clips. `-- --check` only checks; `-- --prune` deletes files no line plays. |
| `npm run tts:cues` | Rewrites the script's breath-cue lines from the words in the source (see [Cue takes](#cue-takes)). `-- --check` only checks. No key needed. |

**Changing a line's words:** edit its `text` in `tts-script.json`. It shows as ↻ and the next
`npm run tts:record` records it again. A stage line repeats the words the session shows on screen
(its `subPrompt` in `src/ui/effects/breathwork-session-manager.js`), so change both: a test checks
they match.

**A new line:** add it to a group in `tts-script.json` (45 words at most) and reference it from the
session data. `hale-session-audio-assets.test.js` fails for a line a session can play that is not in
the script, and for a line in the script that nothing plays.

## Cue takes

A breath has four parts: the breath **in**, the **hold** with the lungs full, the breath **out**
and the **rest** with them empty. The voice has words for all four, and never one clip for any of
them:

- **Each Hale session has its own takes** (script groups `cues_first` ... `cues_elixir`, written
  in `src/ui/effects/breathing/session-cues.js`): about six for the breath in and six for the
  breath out, and three to five for a hold or a rest its rounds have. Two of the in and out takes
  are `plain` ("Breathe in, with the sea"): a guided run opens on one of them, in turn, and its
  other breaths take the other wordings ("Gather, like the swell"), so a run never says one take
  twice. Base and Elixir have a set for their slow arrival (`settle_in` ...), one for their
  rounds (`round_in` ...) and three takes for the recovery breath's release (`release_out` ...).
- **Each world has its own words** (`worlds` group, written in `breath-catalogue.js`): five
  couplets for the breath in and out (`cues`, then `moreCues`: lines `<id>_in`/`_out`,
  `_in_2`/`_out_2` ...) and three takes each for its hold and its rest where its rhythm has them
  (`holdCues`, `restCues`: `<id>_hold`, `<id>_rest` ...). A breath speaks one couplet, its
  out-breath answering its in-breath. In a session the world's words are spoken on every fifth
  breath; in the Breathing tab they are the only words, the world's own couplet first.
- **A take is only said on a breath that holds it.** The recorded index
  (`breathwork-recorded-voices.js`) carries each clip's length, and the voice draws only from
  takes no longer than the part of the breath they are for. A hold or a rest shorter than 1.5
  seconds is never spoken. The breath in or out has room for **quick takes** down to one second:
  the fire breath (Elixir's rounds, Volcanic Fire) breathes out in one second and says so ("Out
  now", "Release"), in takes of a few short words with no comma, recorded crisply in the `quick`
  delivery, without the calm tags or a drawn-out ending (a `quick` list in `session-cues.js`; a
  world's out-words when its out-breath is under 1.5 seconds). A part shorter than that keeps its
  light and its tone.
- **Choosing a take** (`cue-variety.js`): every take of a cue is heard before one comes round
  again, the round starts with the take heard longest ago, and never the same take twice running.
- **The screen says what the voice says.** The guide's hint shows the words just spoken on that
  part of the breath (plain words are already there), and a world's own hold and rest words when
  nothing has been said.

**Writing a take.** Words live in the source, not in the script: edit `session-cues.js` or
`breath-catalogue.js`, then

```
npm run tts:cues                 # bring tts-script.json in line (a line per take)
npm run tts:record               # record what is new or reworded
npm run tts:index -- --prune     # remove the clips of takes that left
```

`tts:cues` writes each take as its words with `...` for each comma and at the end ("Breathe in,
softly" is spoken "Breathe in... softly..."), and a quick take as its words and a full stop, in the
`quick` delivery ("Let go" is spoken "Let go."); a line that already says its words is left exactly
as it is, so its recording stays current. Tests hold it together
(`hale-session-audio-assets.test.js`, `breath-cue-variety.test.js`):

- every take is a line the game plays, and a line says the words the source has;
- no two takes anywhere say the same words;
- an in-breath take never says "out" or "down", an out-breath take never "in";
- every breath the voice cues has takes that fit it (a plain one and two other wordings for the
  breath in and out, one for a pause), and no recorded take is too long to ever be said.

Four things the recordings taught: a comma costs about 0.7 seconds ("Bright, and still" ran
2.6 s where "Bright leaves" runs 1.9), so a take for a two-second pause has no comma; a calm take's
drawn-out ending costs too ("In..." runs 1.04 s, "Out..." 1.43, "Fill up..." 1.51), so a breath of
a second needs a quick take; the calm tags slow even that, so a quick take has its own delivery,
and even then only a word or two that ends softly fits a second ("Out now" 0.86 s, "Let go" 0.93),
where a third word, an "And" or a closing "out" runs over ("Let it go" 1.01 s, "Then out" 1.17,
"And release" 1.33); and words that run together are heard as others ("glow bloom" as "globe
bloom", "Ease it" as "Is it", "Rest full" as "Restful", "Sink" as "Sync"): the listen-back names
them.

## History

- December 2025: 107 lines recorded with Gemini 2.5 Pro TTS, voice Algieba.
- October 2026: the five beginner sessions written; the original four rewritten to breathe their
  worlds' techniques; world introductions and cue words added; 87 clips of lines that left the
  script pruned. The recorder moved to ElevenLabs (Eleven v4), with the Voice Library search,
  auditions, loudness shaping, MP3 and listening back. `scripts/tts-generated.log` (git-ignored)
  logs every request.
- October 10, 2026: all 175 lines recorded in olov-voice; the 20 remaining Gemini clips replaced.
  Then the breath cues became takes of their own for every session and world: the shared `cues`
  group gave way to one group per session (`cues_first` ... `cues_elixir`, 161 takes), each world
  went from one couplet to five and got words for its hold and its rest (166 lines with the twelve
  introductions), and the recorded index learned each clip's length. 456 lines in all.
  Later that day the fire breath got words for its one-second out-breath, which had none: quick
  takes for Elixir's rounds and Volcanic Fire's five out-words as lines. Recorded with the calm
  tags, every take ran 1.3 to 1.9 seconds, so they got the `quick` delivery (no tags, a 150 ms
  tail) and shorter words: Elixir's five are "Out now", "Exhale", "Sigh", "Out we go" and "Out
  again"; Volcanic Fire answers "Release", "Let go", "Settle", "Drop" and "Fall", each 0.69 to
  0.98 s. 466 lines.
