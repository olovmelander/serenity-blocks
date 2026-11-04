# Suno prompts for the placeholder songs

Date: 2026-10-24. 32 of the 63 themes played Blood Moon's recording as a placeholder
(`placeholder: true` in `public/assets/music/songs.json`). This file has one instrumental Suno
prompt for each, written from what the theme shows today (its theme file header and
`docs/theme-concepts/reference/catalog.md`).

**Status (2026-11-04):** 29 are recorded and in the game. Each one is wired to its theme in
`AUTHORED_SONGS` and titled as its placeholder was, so saved track keys still hold. **Still
placeholders:** Tornado, Void Ember, Voltage Storm. Their prompts were rewritten on 2026-11-04
(see *The calm brief*). **Abyme** gets a prompt here too: the theme is
not in the game yet, and it will play the placeholder when it lands unless a song is ready.

## How to use

1. Suno → **Create** → **Custom**, and turn **Instrumental** on.
2. **Title:** the theme's song name as written in the heading below. The game builds a song's
   save key from its title, so keeping the name means nothing has to be migrated.
3. **Style of Music:** paste the theme's *Style* block.
4. **Exclude styles** (under More options): paste the theme's *Exclude* block.
5. Pick a take of 3–5 minutes that does not stop abruptly: when a track ends the game goes
   straight into the next collected song, and an Odyssey level repeats its own.
6. *Optional, only for a song with a drop (the prompts still to record have none):* the Lyrics box disappears while Instrumental is on. To
   place the drop yourself, turn Instrumental off and paste the section tags below as the
   lyrics (vocals stay excluded). If a take comes back with a voice in it anyway, turn
   Instrumental back on and leave the tags out.

```
[Intro]
[Build]
[Drop]
[Breakdown]
[Build]
[Drop]
[Outro]
```

## The calm brief (2026-11-04)

The owner asked for the remaining songs to be calmer, with better atmosphere and bass, and to
fit the game. These prompts replace the earlier ones for Chromatic Impasto, Tornado, Void Ember
and Voltage Storm, and Abyme's is written the same way.

- **What the takes that worked measure.** Verdant Hills, Vesper Chrysalis and Winter have almost
  nothing above 2 kHz (-51 to -58 dB, against -34 to -40 dB for Pyrestorm, Supernova, Chromadelic
  Highway and Stellar Velocity), their level below 60 Hz sits within about 3 dB of the 120-500 Hz
  band, and their loudness range is a narrow 4.6-5.9 LU. Chromatic Impasto's take, made after
  this brief, sits on the same bass at -62 dB above 2 kHz, the darkest of the four.
- **What the prompts do.** They open as those three did: *deep <place> ambient*, then a *warm
  deep sub-bass drone felt in the whole body*. There is no beat, build or drop: *beatless* and
  *steady and soft* say so in the Style box, and the Exclude box holds the rest. *Cinematic, dark,
  ominous, massive, huge, heavy, tension, ostinato* and *drop* are gone, because those words ask
  for trailer brass and drums.
- **Still varied.** Each song has one lead shape over the same floor: held low piano chords
  (Chromatic Impasto), long lap steel notes (Tornado), one breathing drone (Void Ember), a slow
  bass pulse (Voltage Storm), a falling motif (Abyme). Each keeps its theme's field recording.
- **Choosing a take.** Prefer the steadiest one: no kick, no surge, nothing that would pull the
  eye off the board. Judge the bass on headphones or a subwoofer, not on laptop speakers.

## The sound

The 2026-10-24 brief, which the recorded songs follow.

Slow, dark and deep: a drone underneath and a sub-bass you feel in the whole body, 46–76 BPM,
with few bright sounds. **Astral Weave** and **Chiral Gold** came out right and are kept as they
were. The beat-driven version before this one came out too fast and too bright.

- **Beat:** none at all (Golden Forest, Kaleidosonic, Nebula Flow, Sakura Twilight, Solar Eclipse,
  Summer, Vesper Chrysalis); a slow kick heartbeat or muffled hand drum (Fall, Halcyon Apex,
  Koi Pond, Painted Ages, Sunfall, Thermal Bloom, Verdant Hills); or a slow heavy half-time beat
  (Chromadelic Highway, Luminous Tides, Pyrestorm, Serenity Warp, Supernova).
- **Drops:** about a third build into a deep sub-bass drop (Chromadelic Highway, High Coast,
  Pyrestorm, Serenity Warp, Solar Eclipse, Stellar Velocity, Sunfall, Supernova, Thermal Bloom).
- **Colour:** each theme keeps its own instrument, played low: koto, shakuhachi, guzheng,
  nyckelharpa, handpan, lap steel, cello, low piano. Its field recording stays too: surf,
  thunder, ice, dripping caves, steam.
- **Mood:** warm (Sunset, Golden Forest, Summer), cold (Winter, High Coast), ominous
  (Pyrestorm), sacred (Halcyon Apex, Kaleidosonic), cosmic (Nebula Flow, Solar Eclipse).
- **Film-score weight** in the vast themes, in the spirit of a Hans Zimmer score: huge low
  brass, a deep pipe organ, pulsing low string ostinatos, a ticking clock pulse, slow
  crescendos (Chromadelic Highway, Golden Forest, Halcyon Apex, High Coast, Luminous Tides,
  Nebula Flow, Nimbus Veil, Painted Ages, Pyrestorm, Rainbow Terraces, Serenity Warp, Solar
  Eclipse, Stellar Velocity, Sunfall, Supernova, Winter). The intimate themes stay small: Fall,
  Kaleidosonic, Koi Pond, Sakura Twilight, Summer, Sunset, Synthwave Sunset, Thermal Bloom,
  Verdant Hills, Vesper Chrysalis.

Every *Exclude* block shuts out vocals, fast and upbeat styles, and the bright end (sparkle,
glockenspiel, celesta, chimes, high leads), plus whatever that theme could pull Suno toward.
The prompts name no artists, because Suno rejects artist names.

## Placing a finished track

Save it as `public/assets/music/<theme-id>.mp3` (for example `astral-weave.mp3`) with its title
tag set to the song's name, add `'<theme-id>': ['<Song Name>', '<theme-id>.mp3']` to
`AUTHORED_SONGS` in `src/core/progression/theme-music-catalog.js`, and run
`node generate-songs.js`. Then update the counts and the placeholder list in
`tests/unit/theme-music-catalog.test.js`, the count and the list in `CREDITS.md`, and
`scripts/validate-theme-music.mjs` if the theme is the placeholder it plays (Void Ember today).

---

## Abyme
`abyme`: the board carved in black stone at every scale; the view sinks for ever into one cell,
and each larger scale replays the play later and slower. *(Not in the game yet. Prompt not yet
tried.)*

**Style**
```
deep minimal ambient, instrumental, sinking slowly and endlessly through carved black stone, a warm deep sub-bass drone felt in the whole body, a low tone that keeps falling and never arrives, a few soft felted low piano notes that return lower and slower each time, a soft distant pipe organ, polished cavernous reverb, beatless, weightless, hypnotic and still, steady and soft, 50 BPM, G-sharp minor
```
**Exclude**
```
vocals, singing, voice, choir, humming, lyrics, drums, percussion, drop, build-up, climax, trailer music, brass, horror, fast tempo, upbeat, bright, sparkly, glockenspiel, celesta, chimes, high-pitched lead
```

## Astral Weave
`astral-weave`: a great string-art loom hangs in a river of nebula; each clear weaves a petal
and warms the weave from pearl to gold. *(Generated and approved.)*

**Style**
```
celestial minimalist ambient, instrumental, interlocking harp and plucked-string ostinatos weaving like threads on a loom, slow-blooming pearl synth pads that warm into golden brass-like swells, soft kalimba glints, deep warm sub-bass, gently evolving patterns, hypnotic and serene, wide stereo, spacious uncluttered mix, steady energy, 72 BPM, D major
```
**Exclude**
```
vocals, singing, voice, choir, humming, lyrics, spoken word, heavy drums, distorted guitar, EDM drop
```

## Chiral Gold
`chiral-gold`: a dark hall over still black water; two mirror-image towers of braided gold
turn in opposite directions under a half-sunk golden ring. *(Generated and approved.)*

**Style**
```
dark elegant ambient, instrumental, a vast hall over still black water, slow cello and bowed double bass drones, shimmering metallic gold chimes and struck bells, mirrored arpeggios panned left and right turning in opposite directions, glinting crystal plucks, low sub-bass, polished, regal and mysterious, cinematic, spacious reverb, steady pulse, 68 BPM, C minor
```
**Exclude**
```
vocals, singing, voice, choir, humming, lyrics, spoken word, distorted guitar, EDM drop, upbeat pop
```

## Chromadelic Highway
`chromadelic-highway`: a prism-glass rainbow highway through a neon-lit cosmos past planets.

**Style**
```
hybrid cinematic bass ambient, instrumental, a slow night drive through a dark neon cosmos, massive warm sub-bass you feel in the chest, a pulsing low synth-string ostinato, slow detuned analog drones shifting colour, a heavy half-time beat with a soft deep kick, low filtered swells passing like distant lights, dark, hypnotic and smooth, slow build into a deep sub-bass drop, 70 BPM, E minor
```
**Exclude**
```
vocals, singing, voice, choir, humming, lyrics, fast tempo, upbeat, happy, bright, sparkly, glockenspiel, celesta, chimes, high-pitched lead, trance, synthwave
```

## Chromatic Impasto
`chromatic-impasto`: a thick oil canvas under a studio lamp; the board paints it stroke by
stroke, and every level is a new painting period.

**Style**
```
deep studio ambient, instrumental, a quiet painter's studio at night under one warm lamp, a warm deep sub-bass drone felt in the whole body, soft felted low piano chords left to ring and blur, slow bowed cello held long and low, tape-saturated pads smearing into each other like wet oil paint, faint brush on canvas and room tone, beatless, unhurried, intimate and warm, steady and soft, 58 BPM, F minor
```
**Exclude**
```
vocals, singing, voice, choir, humming, lyrics, drums, percussion, glitch, drop, build-up, climax, fast tempo, upbeat, bright, sparkly, glockenspiel, celesta, chimes, high-pitched lead, jazz, EDM
```

## Fall
`fall`: an enchanted autumn grove; a low sun through an old maple and oak, backlit leaves
drifting down a leaf path.

**Style**
```
dark organic ambient, instrumental, an old autumn forest at dusk, deep rumbling sub-bass, slow cello drones, muted low nylon guitar notes, rustling leaves and creaking wood textures, a slow heavy kick heartbeat, melancholic and warm, body-resonating low end, 64 BPM, A minor
```
**Exclude**
```
vocals, singing, voice, choir, humming, lyrics, fast tempo, upbeat, happy, bright, sparkly, glockenspiel, celesta, chimes, high-pitched lead, folk song, EDM
```

## Golden Forest
`golden-forest`: a Nordic lake at the golden hour; sunlight on spruce and pine, a path of
light over mirror-still water.

**Style**
```
cinematic Nordic drone, instrumental, a still lake as the last golden light fades, a warm sub-bass drone felt in the whole body, a simple low piano motif that slowly grows, swelling cello and contrabass, lapping water and distant forest textures, beatless, glowing, deep and reflective, 56 BPM, E-flat minor
```
**Exclude**
```
vocals, singing, voice, choir, humming, lyrics, fast tempo, upbeat, happy, bright, sparkly, glockenspiel, celesta, chimes, high-pitched lead, drums, EDM
```

## Halcyon Apex
`halcyon-apex`: a windless dawn over a clear lagoon; a terraced pyramid, a floating crystal
and a great diamond before the rising sun, all mirrored in the water.

**Style**
```
ritual cinematic drone, instrumental, first light over a windless lagoon, a deep pipe organ swelling under a low tanpura-like drone, deep handpan notes in the low register, massive soft sub-bass swells, a slow muffled frame drum heartbeat, still water textures, sacred, still and immense, 60 BPM, G minor
```
**Exclude**
```
vocals, singing, voice, choir, humming, lyrics, fast tempo, upbeat, happy, bright, sparkly, glockenspiel, celesta, chimes, high-pitched lead, chanting, EDM
```

## High Coast
`high-coast`: a granite summit over a Baltic bay of pine islands; red cottages, sailboats and
a lighthouse under a turning midsummer day.

**Style**
```
cinematic Nordic dark ambient, instrumental, a granite summit over the Baltic at dusk, deep rumbling sub-bass like the sea against rock, a pulsing low string ostinato, huge low brass swells, sparse low piano notes, a distant foghorn, sea wind textures, a slow heavy kick pulse, vast, cold and majestic, slow build into a deep sub-bass drop, 62 BPM, D minor
```
**Exclude**
```
vocals, singing, voice, choir, humming, lyrics, fast tempo, upbeat, happy, bright, sparkly, glockenspiel, celesta, chimes, high-pitched lead, EDM, fast drums
```

## Kaleidosonic
`kaleidosonic`: a temple of folded light, the shape of a sound; jewel-toned fractal stone
veined with standing waves, its moods turning like a wheel.

**Style**
```
meditative drone, instrumental, deep singing bowls and low gong swells, overtone-rich drones, body-resonating sub-bass, slow folding harmonic textures, a soft slow pulse underneath, trance-like stillness, beatless, cavernous temple reverb, 50 BPM, C-sharp minor
```
**Exclude**
```
vocals, singing, voice, choir, humming, lyrics, fast tempo, upbeat, happy, bright, sparkly, glockenspiel, celesta, chimes, high-pitched lead, drums, chanting
```

## Koi Pond
`koi-pond`: a moonlit garden pond seen from above; the moon in the water, a stone lantern,
an old maple, and koi rising from the dark basin.

**Style**
```
deep zen ambient, instrumental, a dark garden pond at night, low koto notes, a deep warm sub-bass drone, slow water ripple textures, muffled wooden clicks, a soft slow heartbeat pulse, calm and intimate, body-resonating low end, 58 BPM, pentatonic, A minor
```
**Exclude**
```
vocals, singing, voice, choir, humming, lyrics, fast tempo, upbeat, happy, bright, sparkly, glockenspiel, celesta, chimes, high-pitched lead, taiko, EDM
```

## Luminous Tides
`luminous-tides`: a night beach where the surf flashes blue with plankton; palms on a dark
headland, a warm far coast on the horizon.

**Style**
```
deep nocturnal ambient, instrumental, a dark beach at night with glowing surf, slow rolling waves of sub-bass felt in the body, a slow repeating low piano motif over swelling strings, low reverb-washed guitar swells, surf and swash textures, a slow half-time beat like breaking waves, dark and hypnotic, 68 BPM, F-sharp minor
```
**Exclude**
```
vocals, singing, voice, choir, humming, lyrics, fast tempo, upbeat, happy, bright, sparkly, glockenspiel, celesta, chimes, high-pitched lead, tropical house, EDM
```

## Nebula Flow
`nebula-flow`: a stellar nursery seen face on; pillars of dust lit by hidden young stars,
glowing gas flowing out between them.

**Style**
```
cosmic cinematic drone, instrumental, a stellar nursery of dark dust pillars, a vast deep pipe organ, massive deep sub-bass that rumbles through the body, slow granular textures flowing like gas, distant huge low brass swells, awe and stillness, beatless, infinite reverb, 50 BPM, B-flat minor
```
**Exclude**
```
vocals, singing, voice, choir, humming, lyrics, fast tempo, upbeat, happy, bright, sparkly, glockenspiel, celesta, chimes, high-pitched lead, drums, EDM
```

## Nimbus Veil
`nimbus-veil`: above a golden sea of clouds at sunset; towering cumulus, light rays, drifting
veils of mist and floating golden motes.

**Style**
```
cinematic atmospheric ambient, instrumental, above a dark sea of clouds after sunset, weightless low pads, slow soaring low strings and French horns, deep soft sub-bass swells, drifting wind and mist textures, a slow heavy pulse, floating and warm, a long slow crescendo, 60 BPM, D-flat major
```
**Exclude**
```
vocals, singing, voice, choir, humming, lyrics, fast tempo, upbeat, happy, bright, sparkly, glockenspiel, celesta, chimes, high-pitched lead, EDM, trance
```

## Painted Ages
`painted-ages`: rainbow-striped badlands from an overlook; a boardwalk to a pavilion, golden
poplars by the river, snow peaks far off, under a turning day.

**Style**
```
cinematic landscape ambient, instrumental, painted badlands at dusk, low guzheng notes, a breathy low dizi flute, a deep earthy sub-bass drone, huge low brass swells, a slow heavy frame drum heartbeat, wind across the ridges, ancient and grand, body-resonating low frequencies, 62 BPM, pentatonic, D minor
```
**Exclude**
```
vocals, singing, voice, choir, humming, lyrics, fast tempo, upbeat, happy, bright, sparkly, glockenspiel, celesta, chimes, high-pitched lead, EDM, fast drums
```

## Pyrestorm
`pyrestorm`: night, from a tephra ridge; a volcano fountains fire, lava runs in braided rivers
and the ash cloud above it crackles with lightning.

**Style**
```
dark cinematic volcanic drone, instrumental, a night volcano making its own weather, massive rumbling sub-bass felt in the chest, deep low brass blasts, slow massive percussion hits, smouldering cello and contrabass drones, crackling ember and distant thunder textures, ominous and powerful, slow build into a huge deep sub-bass drop, 60 BPM, D minor
```
**Exclude**
```
vocals, singing, voice, choir, humming, lyrics, fast tempo, upbeat, happy, bright, sparkly, glockenspiel, celesta, chimes, high-pitched lead, fast drums, metal
```

## Rainbow Terraces
`rainbow-terraces`: floating sky islands of white travertine terraces; waterfalls pour into
the deep, rainbows stand in the spray, paper gliders circle.

**Style**
```
cinematic ethereal ambient, instrumental, floating sky islands and falling water at dusk, slow low harp notes, warm deep sub-bass swells, distant rushing waterfall textures, low strings slowly swelling into a vast crescendo, a soft slow pulse, vast and calm, body-filling low end, 64 BPM, E minor
```
**Exclude**
```
vocals, singing, voice, choir, humming, lyrics, fast tempo, upbeat, happy, bright, sparkly, glockenspiel, celesta, chimes, high-pitched lead, EDM, pop
```

## Sakura Twilight
`sakura-twilight`: a moonlit cherry garden; a torii in a still lake, lanterns afloat, foxes
in the grass and petals falling.

**Style**
```
deep twilight ambient, instrumental, a moonlit cherry garden, a breathy low shakuhachi, a deep warm sub-bass drone, slow low string pads, a distant temple gong, still lake textures, beatless, tender and melancholic, 54 BPM, pentatonic, E minor
```
**Exclude**
```
vocals, singing, voice, choir, humming, lyrics, fast tempo, upbeat, happy, bright, sparkly, glockenspiel, celesta, chimes, high-pitched lead, drums, taiko
```

## Serenity Warp
`serenity-warp`: a wormhole in blue-violet space; gas winds into it in two arms, and glass
pieces spiral in toward another sky.

**Style**
```
cinematic space bass ambient, instrumental, a wormhole in dark blue-violet space, a deep pipe organ, an endlessly rising tension swell, swirling slow detuned drones, a massive sub-bass pulse you feel in the body, a slow heavy half-time beat, dark and hypnotic, slow build into a deep warping sub-bass drop, 70 BPM, A minor
```
**Exclude**
```
vocals, singing, voice, choir, humming, lyrics, fast tempo, upbeat, happy, bright, sparkly, glockenspiel, celesta, chimes, high-pitched lead, trance, EDM
```

## Solar Eclipse
`solar-eclipse`: the moment of totality over mountain ranges; a black sun with a streaming
corona, the planets out, light all round the horizon.

**Style**
```
cinematic eclipse drone, instrumental, the moment of totality, a deep pipe organ under suspended low drones, a deep hushed sub-bass that swells through the body, huge distant low brass, slow bowed metal resonances, held-breath stillness releasing into a vast beatless sub-bass drop, majestic and eerie, 50 BPM, F minor
```
**Exclude**
```
vocals, singing, voice, choir, humming, lyrics, fast tempo, upbeat, happy, bright, sparkly, glockenspiel, celesta, chimes, high-pitched lead, drums, EDM
```

## Stellar Velocity
`stellar-velocity`: gliding down a canyon of luminous cloud toward one far sun; rings of
plasma open ahead, and a clear fires the drive through them.

**Style**
```
hybrid cinematic downtempo, instrumental, gliding down a dark canyon of cloud toward a distant sun, a pulsing low string ostinato, a ticking clock pulse, a steady slow deep kick, heavy rolling sub-bass felt in the chest, long low pads streaming past, hypnotic forward motion without hurry, a growing crescendo into a deep drop, 76 BPM, B minor
```
**Exclude**
```
vocals, singing, voice, choir, humming, lyrics, fast tempo, upbeat, happy, bright, sparkly, glockenspiel, celesta, chimes, high-pitched lead, trance, EDM
```

## Summer
`summer`: a summer's eve by a Swedish lake; a flowering meadow, the maypole, a red cottage
and a jetty in the endless evening light.

**Style**
```
deep Nordic folk drone, instrumental, a lake in the pale light of a midsummer night, a slow low nyckelharpa drone, bowed folk fiddle in the low register, a warm deep sub-bass, distant meadow and lake textures, beatless, nostalgic, warm and still, body-filling low end, 58 BPM, G minor
```
**Exclude**
```
vocals, singing, voice, choir, humming, lyrics, fast tempo, upbeat, happy, bright, sparkly, glockenspiel, celesta, chimes, high-pitched lead, drums, polka
```

## Sunfall
`sunfall`: sunlight pours like a waterfall into the world's largest cave; a lost jungle grows
in it, and the cave breathes out its own clouds.

**Style**
```
cinematic cave ambient, instrumental, a column of light falling into a vast dark cave, cavernous sub-bass that rumbles through the body, huge low brass swells echoing off stone, low wooden marimba notes, a slow heavy log-drum heartbeat, dripping water textures, distant jungle sounds, ancient and immense, slow build into a deep echoing drop, 62 BPM, G minor
```
**Exclude**
```
vocals, singing, voice, choir, humming, lyrics, fast tempo, upbeat, happy, bright, sparkly, glockenspiel, celesta, chimes, high-pitched lead, tribal drums, EDM
```

## Sunset
`sunset`: an open sea at the end of the day; the sun sets on its road of light, and paper
lanterns float on the swell and rise on the evening wind.

**Style**
```
deep warm ambient, instrumental, a dark open sea after sunset, slow low piano chords, warm swelling cello drones, deep sub-bass swells like the ocean, soft sea swell textures, a slow lazy pulse, peaceful and romantic, body-resonating warmth, 58 BPM, C minor
```
**Exclude**
```
vocals, singing, voice, choir, humming, lyrics, fast tempo, upbeat, happy, bright, sparkly, glockenspiel, celesta, chimes, high-pitched lead, EDM, country
```

## Supernova
`supernova`: a massive star burns inside the shells of nebula it has thrown off; the board
feeds it until it collapses, detonates and leaves a spinning pulsar.

**Style**
```
dark cinematic cosmic drone, instrumental, a massive star burning in the dark, a slow throbbing sub-bass heartbeat you feel in the chest, huge low brass blasts, a heavy deep kick at half-time, glowing low synth drones, a faint low pulsar tick, immense and ominous, slow build into a massive deep sub-bass drop, 64 BPM, E minor
```
**Exclude**
```
vocals, singing, voice, choir, humming, lyrics, fast tempo, upbeat, happy, bright, sparkly, glockenspiel, celesta, chimes, high-pitched lead, trance, hard techno
```

## Synthwave Sunset
`synthwave-sunset`: a retro seaside at dusk; the sun sinks behind a lit ferris wheel on a
pleasure pier, palms and deco hotels round the bay.

**Style**
```
dark slow retro ambient, instrumental, a deserted seaside pier at dusk, warm dark analog sub-bass drones, slow low polysynth chords, a slow heavy beat with a soft deep kick, distant surf textures, faded neon nostalgia, wistful and deep, 66 BPM, F minor
```
**Exclude**
```
vocals, singing, voice, choir, humming, lyrics, fast tempo, upbeat, happy, bright, sparkly, glockenspiel, celesta, chimes, high-pitched lead, synth-pop, outrun
```

## Thermal Bloom
`thermal-bloom`: a hydrothermal basin at late morning; a cobalt hot spring ringed with
coloured mats, a white geyser cone and travertine terraces.

**Style**
```
deep geothermal ambient, instrumental, a steaming hot-spring basin, deep bubbling sub-bass rumbles, slow low vibraphone notes, steam-hiss and boiling water textures, a slow muffled hand-drum pulse, a deep swell building like a geyser into a sub-bass drop, earthy and immersive, 62 BPM, A minor
```
**Exclude**
```
vocals, singing, voice, choir, humming, lyrics, fast tempo, upbeat, happy, bright, sparkly, glockenspiel, celesta, chimes, high-pitched lead, EDM, dubstep
```

## Tornado
`tornado`: a wheat field at the end of the day under a supercell; a rope funnel comes down,
the low sun lights the field through rain shafts.

**Style**
```
deep prairie ambient, instrumental, a wheat field in the last golden light with a storm turning slowly far away, a warm deep sub-bass drone felt in the whole body, thunder so distant it is only a low roll, long soft low lap steel notes fading into reverb, slow low bowed strings, wind moving through the wheat, beatless, patient, wide and still, steady and soft, 54 BPM, D minor
```
**Exclude**
```
vocals, singing, voice, choir, humming, lyrics, drums, percussion, drop, build-up, climax, tension, ostinato, trailer music, brass, fast tempo, upbeat, bright, sparkly, glockenspiel, celesta, chimes, high-pitched lead, country, rock
```

## Verdant Hills
`verdant-hills`: a bright, windy day on the downs; a sea of grass, an old oak, a white
windmill, kites and cloud shadows drifting over the hills.

**Style**
```
deep pastoral ambient, instrumental, wind over rolling green hills under a big drifting sky, slow low acoustic guitar harmonics, a warm deep sub-bass drone, wind through tall grass textures, distant low bowed strings, a soft slow kick heartbeat, calm and open, body-filling warmth, 60 BPM, G minor
```
**Exclude**
```
vocals, singing, voice, choir, humming, lyrics, fast tempo, upbeat, happy, bright, sparkly, glockenspiel, celesta, chimes, high-pitched lead, folk dance, country
```

## Vesper Chrysalis
`vesper-chrysalis`: a still lake at dusk under a ringed world and the evening star; a crystal
chrysalis on silk threads hatches wings of light.

**Style**
```
deep dusk ambient, instrumental, a still dark lake under a ringed planet, bowed low glass tones, a slow deep sub-bass drone, soft fluttering low string tremolo like moth wings, faint low synth swells, beatless, hushed wonder, body-resonating stillness, 54 BPM, B minor
```
**Exclude**
```
vocals, singing, voice, choir, humming, lyrics, fast tempo, upbeat, happy, bright, sparkly, glockenspiel, celesta, chimes, high-pitched lead, drums, EDM
```

## Void Ember
`void-ember`: a dying star like a banked coal in an empty sky, fire in the cracks of its
crust; a belt of cinders and one dead world far off.

**Style**
```
deep space ambient, instrumental, a dying star glowing like a banked coal in an empty sky, a warm deep sub-bass drone that swells and sinks as slowly as breathing, felt in the whole body, one low tape-saturated pad, faint ember crackle, a soft bowed metal resonance far away in a huge reverb, beatless, weightless, melancholy and warm, steady and soft, 46 BPM, C minor
```
**Exclude**
```
vocals, singing, voice, choir, humming, lyrics, drums, percussion, drop, build-up, climax, trailer music, brass, horror, fast tempo, upbeat, bright, sparkly, glockenspiel, celesta, chimes, high-pitched lead, heavy metal
```

## Voltage Storm
`voltage-storm`: a supercell over a flooded plain at dusk; storm-collector towers stand in
the water and take the lightning, rain and reflections everywhere.

**Style**
```
deep electric ambient, instrumental, soft rain on a flooded plain at dusk with a storm far out on the horizon, a warm deep sub-bass pulse as slow as breathing, felt in the whole body, a low transformer hum tuned to the key, slow analog synth pads, faint static crackle, rain on still water and distant thunder, beatless, hypnotic and hushed, steady and soft, 62 BPM, F-sharp minor
```
**Exclude**
```
vocals, singing, voice, choir, humming, lyrics, drums, percussion, drop, build-up, climax, tension, ticking, ostinato, trailer music, brass, fast tempo, upbeat, bright, sparkly, glockenspiel, celesta, chimes, high-pitched lead, hard techno, industrial
```

## Winter
`winter`: a snowfield by a frozen lake in the polar twilight; snow-loaded spruces, a ringed
moon, and an arctic fox whose tail lights the fox fires in the sky.

**Style**
```
arctic cinematic ambient, instrumental, a frozen lake in the polar night, a deep cold sub-bass drone felt in the whole body, slow low strings swelling into soft huge brass, creaking ice and wind textures, slow crunching-snow percussion, faint low aurora-like swells, hushed and vast, 56 BPM, E minor
```
**Exclude**
```
vocals, singing, voice, choir, humming, lyrics, fast tempo, upbeat, happy, bright, sparkly, glockenspiel, celesta, chimes, high-pitched lead, sleigh bells, Christmas
```
