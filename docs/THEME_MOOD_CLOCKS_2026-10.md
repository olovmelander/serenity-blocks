# Theme mood clocks (2026-10-25)

Olov: *"In many of our themes, the only way to change mood and lighting and time of day is to level
up ... in some game modes we do not play with leveling up ... make sure all themes can be seen in
different lighting regardless of leveling up. But I also want to keep the level up effect of each
theme."*

## Which modes level up

`EVENTS.LEVEL_UP` comes from two places only: single-player runs (`SinglePlayerMode.onLevelUp` →
`emitLevelUp`) and the Odyssey (`odyssey-physics-callbacks.js`). Everywhere else a theme never sees
one:

| mode | level-ups |
| --- | --- |
| Single player | yes, every 15 lines (`physics.js`) |
| Odyssey | yes |
| Infinity | none (`InfinityMode` keeps `onLevelUp` as a no-op "for compatibility") |
| Local / online versus | none by default (`match-level-rule.js`: a fixed start level unless the host turns "Level up as you clear" on) |
| Serenity | none from play; only the Effects tray's "level up" button |
| Stillfall, menus, the hub | none |

So a theme whose light turned only with a level stood in one light forever in most of the game.

## The rule

Every theme's light now follows the rule the clock-driven themes already used:

    phase = level step (eased, the short way round) + clock drift(time)

- **The clock turns the mood in every mode.** The world's own time (the clock `seek(t)` sets and a
  rebuild carries), at about 80-150 s a mood, resting on each before it melts into the next.
- **A level is still a level.** Every level-up effect stays (bursts, swells, rings, sounds, the
  surge), and a level-up moves the light one whole mood on, on top of the clock.
- **Today's look is mood 0**: at time 0 on level 1 every theme opens as it did.
- **Deterministic and ungated**: a function of the time, so seeks, replays and rebuilds agree; not
  gated behind reduced motion or the background-effects setting (a slow change of light is not
  motion, and that setting gates reactions, not the world's light).

`src/themes/shared/mood-clock.js` holds the few lines the clock-driven themes each carried a copy
of (Geode's `mineralDrift`, Bioluminescence's `paletteDrift`, Winter's `hourDrift`): `moodDrift`,
`easeStep`/`nearestStep`, `wheelAt`, `pingPong`, and `meltPalettes`/`meltColour` (palettes melt
the short way round the colour wheel; a straight mix of violet and amber is grey).

## Audit (63 themes, at `ae251940`)

### Already turning by the clock in every mode (38)

| theme | moods | pace (s/mood, full cycle) |
| --- | --- | --- |
| Bioluminescence | 5 grotto palettes | 100, 500 |
| Blood Moon | the eclipse (totality, limbs) | 240-s cycle; level-up is a burst |
| Chromadelic Highway | 6 spectrum movements | ~90 by road distance, ~540 |
| Cosmic Noir | 5 film stocks, there and back | 100, 800 |
| Forest | 5 hours of the night | 120, 600 |
| Geode | 6 minerals | 90, 540 |
| Grainfields | 5 stations of the day | 100, 500 |
| High Coast | 6 stations | 100, 600 |
| Himalayan Peak | 5 hours | 140, 700 |
| Kaleidosonic | 6 moods | 100, 600 |
| Koi Pond | 6 nights | 90, 540 |
| Luminous Tides | 6 nights | 100, 600 |
| Moonlit Greenhouse | 6 nights | 150, 900 |
| Murmuration | 8-stop hue cycle | ~167 a cycle |
| Nebula Flow | 6 palettes, there and back | 95, 950 |
| Ocean | 6 hours | 100, 600 |
| Painted Ages | 6 hours | 100, 600 |
| Pyrestorm | 5 watches, there and back | 100, 800 |
| Rainbow Terraces | 5 hours | 110, 550 |
| Serenity Warp | 6 palettes, there and back | 90, 900 |
| Solar Eclipse | 6 palettes | 100, 600 |
| Spring | 6 stations | 100, 600 |
| Starlight | 6 hours of the night | 100, 600 |
| Stellar Drift | 6 palettes | 90, 540 |
| Stellar Velocity | 6 nebulae, there and back | 85, 850 |
| Stillwater | 7 hours of the night | 110, 770 |
| Summer | 5 hours | 240, 1200 |
| Sunbraid | 3 eras of the braid | 110, 330 |
| Sunfall | 5 sun stations + 4 cave weathers | 110, 550 (see the fix below) |
| Sunset | 11 stations of the day | a 565-s day |
| Supernova | 5 elements | 80, 400 |
| Thermal Bloom | 6 seasons | 100, 600 |
| Tornado | 4 hours | 100, 400 |
| Vesper Chrysalis | 6 hours | 120, 720 |
| Void Ember | 5 palettes, there and back | 80, 640 |
| Voltage Storm | 6 palettes | 80, 480 |
| Waves | 6 hours | 100, 600 |
| Winter | 5 hours of the polar day | 96, 480 |

Rainbark's light also turns by the clock (4 moods, 100 s each), so it is seen in every light; its
Climb (the walkway rising a storey into a new zone) still comes only with a level. That moves the
camera and the grove, so it was left as it is (see Open).

### Light that turned only with a level (12)

Ten cycled palettes by `(level - 1) % 5` with nothing on the clock: Aether Tides, Chiral Gold,
Chromatic Impasto, Cinder Drift, Fluid Dreams, Galaxy, Halcyon Apex, Ice Temple, Lunara, Neon
District. Two pushed one axis with the level until it topped out: Parhelion (the Lower Sun's warmth,
capped at level 11) and Shifting Sands (golden hour to dusk, capped at level 15).

### No lasting mood at all (10)

A level-up fired only a burst and the light never changed: Aurora (its sky weather varies the
display, but the palette and time of night never changed), Black Hole, Crystal Cave, Fall, Golden
Forest, Neon Dusk, Nimbus Veil, Sakura Twilight, Verdant Hills, Wolfhour. In several of these
`frame.level` is the heat of play (GameplaySurge), which fades in seconds; it is not the game level.

### Otherwise (2 + 1)

- Synthwave Sunset: dusk deepened only while someone played (and on level-ups), and pinned at full
  dusk; in Serenity and the menus it never moved. The wheel's neon changed only on level-ups.
- Astral Weave: a level-up changed only the loom's figure (saturating at level 4); no mood.
- Sunfall: clock-driven, but both its clocks stopped under reduced motion, so for those players the
  sun moved only on level-ups and the weather froze.

## What changed, theme by theme

Every theme below: today's look is its first mood; a level-up keeps every burst it had and moves
the light one mood on (eased over a few seconds, the short way round); seeks, new runs and
rebuilds follow the clock (a new run drops only the level's share).

### Palettes the level used to turn alone (10)

The existing level palettes are now the moods, turned by the clock as well. All melt the short
way round the colour wheel (`meltPalettes`), so a melt is as vivid as its ends.

| theme | moods | pace | notes |
| --- | --- | --- | --- |
| Aether Tides | aether, carina, rosette, lagoon, ember | 100 s, rest 0.35 | a clock melt also lets the fluid heal gently (at most +0.04 at mid-melt) so the gas takes the new colours; a level turn keeps its fast 9-s heal |
| Chiral Gold | fine, rose, white, green, red gold | a pour every 100 s | the clock pours the next alloy up the towers (~2.8 s, quiet: no comets or flare); a level pours one more with its burst; one pending target, so pours never pile up; the hall's glow now melts with the pour instead of snapping |
| Chromatic Impasto | Lindström, fauve, nocturne, ember, spring | a 12-s over-paint every 100 s | the painter goes over the canvas in the next period's tubes (no sheen or flash); the level's quick 2.6-s over-paint keeps its burst; the lamp key melts instead of switching |
| Cinder Drift | ember, crimson, gold, forge, rose | 100 s, rest 0.35 | |
| Fluid Dreams | amethyst dusk, lagoon, rose gold, ultraviolet, aurora mint | 100 s, rest 0.35 | the world now keeps its own clock |
| Galaxy | andromeda, whirlpool, sombrero, emerald, ultraviolet | 100 s, rest 0.35 | the level's meteors take the new nucleus colour; the straight RGB mix (grey between violet and amber) is gone |
| Halcyon Apex | golden dawn, rose hour, clear morning, amber haze, blue hour | 100 s, rest 0.35 | colour only (the sun's direction is fixed); the line-clear ley colour follows the live hour |
| Ice Temple | boreal, amethyst, glacier, rose, solar | 100 s, rest 0.35 | the solar-to-boreal melt goes by an ice violet (the short way passes the orange the temple never shows) |
| Lunara | amethyst, rose quartz, glacier, ember, ultraviolet | 100 s, rest 0.35 | glacier-to-ember and ember-to-ultraviolet melt by violet/lilac (the short way passed lime curtains and a lime moon) |
| Neon District | signal, harbour, arcade, lantern, ultraviolet | 100 s, rest 0.35 | two melts go by violet instead of chartreuse; heat still warms whatever the clock shows toward gold |

### One axis the level pushed until it topped out (3)

Each axis is now a walk there and back on the clock (`pingPong`), resting at both ends and at the
middle, with the level a step along the same walk, so it never pins at the end.

| theme | walk | pace | notes |
| --- | --- | --- | --- |
| Shifting Sands | golden hour → sinking gold → deep dusk (both suns low, stars) → back | 100 s a stop, ~6.7 min round | a level is still 1/14 of a leg; game over walks the level's steps back the near way |
| Synthwave Sunset | the sun on the sea → half sunk → afterglow → back | 120 s a stop, 8 min round | the play-only clock (`fullAfter`/`activeFor`/`notePlay`) and the clears' nudges are gone; the wheel's neon flips pink ↔ mint at every stop by way of blue-violet (a `wheelNeon` colour uniform), a level flips it once more; `createScene` keeps the clock (`takeRestartTime`) |
| Parhelion | today's cold high noon → a pale golden afternoon → a late, low amber sun under a deep blue zenith → back | 100 s a stop, ~6.7 min round | the walk runs out to warmth 0.95 (`LOWER_SUN_LIGHT`; today's level 10 was 0.6, too close to noon to read), and a low-sun grade on `smoothstep(0.12, 0.95, warmth)` warms the lit snow to peach-gold over cobalt-violet shade, the low sky to amber-rose, the ridges to alpenglow, the halo and sun dogs brighter and warmer; 0 at level 1 through the ±8 % breath, so today's opening is pixel-identical; a level is still 0.055 of warmth over 3 s, so it shifts the grade a little too; the theme now keeps its level and clock through a rebuild |

### Themes with no lasting mood: moods made for them (10 + Astral Weave)

| theme | moods (the first is today's look) | pace |
| --- | --- | --- |
| Aurora | quiet night; crowned night (taller rays, red crown); deep midnight (display low, airglow, the Milky Way at its brightest); moonlit night (a small pale moon over the range, silvered ridges, paler display); blue hour (luminous blue sky, twilight rim) | 110 s, rest 0.35, under the existing sky weather |
| Astral Weave | teal river; rose veil; sapphire deep; jade veil; amethyst drift (the gas, the dark, the band, both lamps, filaments, stars; the weave's gain balanced to each) | 100 s, rest 0.35; the level still also changes the loom's figure |
| Black Hole | gold accretion; blue-white furnace; nebula field; red quiescence; starved ring | 112 s, rest 0.35; scales what the director computes from play, so heat still builds on top; no shader change |
| Crystal Cave | pale day; noon blaze; amber evening; moonlit cave (the crystals' glow leads); glow-worm night (the shaft all but gone) — the day above, seen through the roof | 100 s, rest 0.35 |
| Fall | quiet afternoon; amber hour; rose dusk; blue mist; bright October | 110 s, rest 0.35; colour only (static shadow map); play still warms the sun toward late amber |
| Golden Forest | golden hour; ember sunset; alpenglow; white night (midsummer midnight, mist over the lake); morning gold | 120 s, rest 0.35; the mood is the rest that play deepens from |
| Neon Dusk | magenta dusk; violet twilight; teal night; ultraviolet midnight; amber dawn | 105 s, rest 0.35; the hard-coded sky/haze/sun/mountain colours became mood uniforms; `comboShift` untouched |
| Nimbus Veil | golden sunrise; pearl morning; white noon; rose evening; blue hour (an ember sun, first stars behind a uniform `If`) | 110 s, rest 0.35; the sun stays at 9.5° (colour only) |
| Sakura Twilight | afterglow; blue hour; lantern night; moonlit night; plum dawn | 110 s, rest 0.35; colour only (static moon shadow) |
| Verdant Hills | kite day; honey afternoon; long gold; showers coming (slate cumulus); after the rain (deep blue, sharp ridges) | 110 s, rest 0.35; moods also set cloud cover and exposure; the sun never moves (the oak's shadow is drawn once) |
| Wolfhour | silver moon; deep midnight; the wolf's hour (grey before dawn); alpenglow; hunter's moon (honey gold, never red — Blood Moon's colour) | 100 s, rest 0.35; the table lives in `wolfhour-hours.js`, used by the theme and the playground alike |

Where the level used to need the background-effects setting on to reach the world (the themes
that subscribe to `LEVEL_UP` themselves), the level's step now always lands; only the bursts keep
that gate. These themes now keep the level on the theme too, so `captureRestartRun` carries it.

### Sunfall

Its station clock (110 s a station) and weather clock (holds of 48-88 s) no longer stop under
reduced motion: a station turns too slowly to read as motion. The playground's seek now replays
the station clock (before, every `t` showed the same station).

## Verification

- **Playground captures** of every changed theme (Electron, RTX 5080, private Vite servers): today's
  look before the change against mood 0 after it (identical in all 25), every mood at its rest, a
  mid-melt, and `level=2` showing the next mood on top of the clock. No WebGPU validation or
  console errors in any capture. Contact sheets were reviewed per theme; Parhelion's first walk
  (the far end at today's level-10 warmth) was too subtle to read and was widened (see above).
- **The real game, Infinity mode** (no level-ups; level stayed 1): Galaxy turned from andromeda
  into whirlpool (mood 0 → 0.52) and Neon Dusk from its magenta dusk toward violet twilight
  (0 → 0.45) in 65 s of play, with the board in front.
- **Tests:** each theme gained tests that the clock alone turns its moods (exact at whole periods,
  never backward, no jumps), that a level-up still steps on top and still fires its burst, and that
  seeks, new runs and rebuilds follow the clock; `tests/unit/mood-clock.test.js` covers the shared
  module. Full suite: 1182 of 1196 files passed under load; of the 14 others, the four known
  local-only ones failed (sv-SE number formatting in records-view, game-over-modal and
  odyssey-level-briefing; tts-recorder's symlink EPERM in a worktree), and the other ten were
  timeouts or wall-clock budgets that all passed when rerun alone.
- **Gates:** `tsc --noEmit`, lint ratchet (at baseline), ts-ratchet (six new `@ts-check` mood modules
  added to the baseline), architecture fitness, depcruise, theme-lifecycle audit, `npm run build`
  (boot closure OK), `check:ip-strings`, `perf:budgets:gate`, `check:release-gates`. Parhelion's
  shader size gates pass (two colour mixes simplified to fit).
- **Cost:** colour work only. The palette themes mix a few colours on the CPU per frame; the new
  moods turn hard-coded shader constants into uniforms (Neon Dusk ~34 vec3, Nimbus Veil ~25) with
  no new passes or texture reads; Nimbus Veil's blue-hour stars sit behind a uniform `If`. No GPU
  timings: the machine's GPUs were shared with other sessions.

## Open

- Judgement calls to look at in the game: Verdant Hills' "showers coming" (faint bright lines on
  cloud edges at higher cover) and its moods are the gentlest of the set; Golden Forest's white
  night and Sakura's plum dawn carry mist over the lake (checked: not a milky wash); Nimbus Veil's
  white noon is the brightest mood; Aurora's moonlit hour adds a small moon; Crystal Cave's moods
  live mostly in the light shaft and the air, since the crystals fill the frame; Wolfhour's legacy
  non-node WebGL path (not WebGPURenderer) has no moods.
- A quality change still restarts the clock in Sakura Twilight and Crystal Cave (as it did); the
  level is kept, and the other changed themes carry the clock.

- Rainbark's Climb is still level-only (the light turns by the clock). A clock-driven climb would
  move the camera every few minutes in Infinity and Serenity; ask before doing it.
- Several themes keep no `this.level` on the theme, so the menu's restart-behind-rebuild
  (`captureRestartRun`) carries the clock but drops the level's step (Bioluminescence, Geode,
  Himalayan Peak, Waves, Winter, Supernova, Koi Pond among the clock-driven ones). The clock hides
  most of it; the level's own step is lost until the next level-up.
- Cosmic Noir's own `carry` is overwritten by `BaseTheme.applyRestartRun` (`{time, level}`), so a
  restart-behind-rebuild loses its `levelSteps` and never applies the time.
