# The breathing experience: direction (October 2026)

One direction for everything a player meets when they breathe in Serenity Blocks: the twelve
breathing worlds, the Hale sessions, the words on screen, the voice, the motion and how the worlds
and sessions are found. Copy, voice lines, ElevenLabs delivery and interface changes follow it. The
mechanics live in [HALE_SESSIONS_2026-10.md](HALE_SESSIONS_2026-10.md) and
[BREATHING_WORLDS_MASTERPIECE_2026-10.md](BREATHING_WORLDS_MASTERPIECE_2026-10.md).

## The idea: every world breathes

The twelve worlds are places, and each place has its own way of breathing: the lotus opens over
five seconds and folds over five, the tide runs up the sand and slides back, the moon-path opens,
rests and narrows. That rhythm *is* the technique. A **Hale session** is a guided journey through
these places with a voice beside you. The **Odyssey** is how you find the places. Once you have
breathed in a world, it is yours.

So the parts are one thing seen from three sides:

| | What it is | Where you meet it |
| --- | --- | --- |
| A world | A place and its rhythm (the technique) | Breathing tab, chapter arrival, inside sessions |
| A session | A journey through worlds, with a voice | Hale tab |
| The Odyssey | Where the worlds are found | Each finished chapter opens a world and the session that features it |

## The guide: one voice

- **One companion.** The same speaker in every world and session. Warm, low-to-middle, unhurried,
  close, as if sitting beside you. Never theatrical, never a coach.
- **To one person, now.** "You", present tense, short sentences, one instruction per sentence,
  plain words.
- **The world carries the instruction.** "Breathe in… let the petals open." The voice teaches with
  plain words first ("breathe in", "breathe out"), then hands you to the world's own cues once you
  have the rhythm.
- **Never a loop.** A cue is a handful of takes, not one clip, and every session and every world
  has its own: Tide breathes "with the sea", Roots "up from the ground", Flow "for the count".
  A guided run opens on plain words and goes on in others; a world has five couplets ("Open the
  lotus… close it softly"). No take is heard twice running, no two sessions or worlds say the
  same words, the out-breath answers the in-breath it follows, and every take ends inside the
  breath it is spoken on.
- **All four parts of the breath have a voice.** The hold, with the lungs full, and the rest, with
  them empty, are named in their own words ("Across the top… along the base"; "Hold the moon
  still"), wherever a rhythm has a pause long enough to say them in.
- **Fewer words as you go deeper.** The welcome explains; the rounds instruct; a hold gets a few
  words; the rest is mostly silence. Silence is part of the script.
- **Steady, not strong.** No "push your limits", "unstoppable", "give everything". Effort words
  become steadiness words: "full, never forced", "steady and easy".
- **Safety in the same calm voice.** "If you need a breath, take one." "If you feel light-headed,
  breathe normally." Said where it matters, once.
- **No promises about the body.** No claims about nerves, hormones or health. The voice invites,
  notices and allows.
- **Endings fit the hour.** Sessions for the evening end into sleep ("stay as you are… let sleep
  come"). The others come back ("move your fingers and toes… open your eyes when you're ready").

## The words on screen

- **The screen says what the voice says.** A player with the sound off gets the same guidance. Both
  come from one line in `scripts/tts-script.json`: the screen shows it without its pause marks.
- **Three levels.** Eyebrow (where you are: session, round), title (a place or an action in one to
  three words: "The Long Ebb", "Take Root"), line (the instruction).
- **Sentence case** everywhere ("Find inner peace", not "Find Inner Peace"). Numbers are words in
  prose and speech ("in for four"); digits only in counters and rhythm diagrams.
- **Name the technique** where it helps. A session says which world's rhythm you are breathing
  ("This is the Heart Glow rhythm: five in, five out"), so the Breathing tab feels familiar.

## Speech: how the voice is recorded

Every line has a **delivery**, which sets its pace and loudness when recorded with ElevenLabs:

| Delivery | Lines | Pace | Loudness |
| --- | --- | --- | --- |
| `welcome` | Session and world introductions | natural | −20 LUFS |
| `guide` | Stage instructions, transitions, intentions | a little slow | −20 LUFS |
| `cue` | Breath cues ("Breathe in…", a world's cue words) | slow, even | −20 LUFS |
| `still` | Holds, the rest, fillers, closings | slowest | −22 LUFS |

Pauses are written into the line: `…` is a short beat, `[pause 1.5s]` a longer one. The voice is
the game's own, olov-voice, on Eleven v4, which has no speed control: its unhurried pace comes from
the tags *[thoughtful] [meditative] [deep]* and from each `…` between words sent as a clean
`[short pause]`. Every take is trimmed, brought to its loudness and faded by the recorder, and heard
back by Speech to Text, so all lines play as one speaker and say their words. See
[scripts/tts-audio-tracking.md](../scripts/tts-audio-tracking.md).

## Motion and sound

- **Everything moves with the breath:** the world, the ring and the words. A title card arrives with
  an in-breath and leaves with an out-breath; nothing snaps.
- **Stillness is visible.** During a hold the world goes still, and the counting stops.
- **The breath has a sound.** A soft tone rises on every breath in and falls on every breath out
  that the voice leaves quiet: in the Hale sessions and, with the Breathing tab's *Breath tones*
  switch, in every world you breathe on your own.
- **Sound marks the structure.** A singing bowl opens a session and each round and closes the
  session. A small bell marks a hold's suggested length. Soft tones mark slow breaths when the voice
  is quiet. The voice never speaks over itself.

## Techniques inside sessions

A session's rounds breathe the techniques of the worlds they are set in, or a gentler form of
them, named as such:

| Session | Features | Rounds |
| --- | --- | --- |
| First Breath | The four starter worlds | Heart Glow's even breath, Sacred Geometry's square made gentle |
| Tide | Ocean Tide | The tide's even breath, then a longer ebb |
| Roots | Ancient Forest | The forest's rhythm, built up to its full shape |
| Unwind | Aurora Dreams | Longer out-breaths, then the aurora's full rhythm |
| Sunrise | Solar Flare | The flare's brisk rhythm, then quicker and lighter |
| Rest | Moonlit Waters, Cosmic Nebula | 4-7-8 learned step by step, drifting among the stars between rounds |
| Flow | Sacred Geometry, Crystal Prism | The square, the triangle, the wider square |
| Base | Electric Storm | Steady breathing that charges the storm, then stillness you end yourself |
| Elixir | Volcanic Fire | The fire's power breathing, then deep holds |

## Finding the worlds

- Four worlds and First Breath are open from the start: Heart Glow, Moonlit Waters, Sacred Geometry
  and Zen Garden. Someone who opens the game to sleep or to calm down finds the right world ready.
- Each Odyssey chapter you finish opens one world and the session that features it.
- Practice opens them too, so nobody who only breathes is ever blocked.
- Nothing you have already used is taken away.
- A world you have not found yet is shown, not hidden: its artwork, dimmed, and where it is found
  ("Found in the Deep Ocean").
