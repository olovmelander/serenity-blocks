# Neon District — the rain canyon

> Shown to players as **Neon Quarter** since 2026-10-26 (theme picker, music, Odyssey, the
> district's own posters). The id `neon-district`, its folders, files and URL parameters are unchanged.

Implemented 2026-10-05 on `feature/neon-district-masterpiece`, with Three.js 0.186.1. A
from-scratch rebuild: it replaces the earlier theme in full (the 9,600-line theme class, the
SynthCity materials and LOD chain, the pooled event effects, the post stack, the validation
script and the tests). The district keeps its identity — the rain, the wet street, the painted
shopfronts and billboards — and everything else is new. This document records the shipped
design and what was verified. It is a reference, not a backlog.

## The picture

A street canyon in the rain, seen from its centre line a little above head height, looking up
it. The city flows past for ever: painted shopfronts at the foot of the walls, blades of tube
neon over the pavement, a room behind every lit window, lanterns and cables across the road,
skybridges and signal gantries overhead, megatowers standing in the smog beyond the roofs. The
whole city stands upside down in the wet road.

![The street at rest](neon-district-captures/desktop-street.webp)

The gameplay card covers the canyon's vanishing point, so the picture is built for what stays
visible: the walls sliding past on both sides, the street below, and whatever bursts out from
behind the card.

![In game](neon-district-captures/desktop-ingame.webp)

## The one idea

The district is a circuit and the board is its power source. Everything a player does on the
board is answered by light that starts at the board and travels through the street.

## Event language

| Event | Response |
| --- | --- |
| Piece lock | The piece lands in the street under the foot of the board, at its own column. A ring runs out through the puddles in the piece's colour and bends the reflections as it passes; a shell of light climbs the walls and switches dark windows on for a moment; the rain inside the shell lights up, so the shell reads as a dome; sparks skid out across the road and a comet runs down the kerb strips. |
| Hard drop | The same, harder: a wider ring, more sparks, a camera dip. Since 2026-11-17 its shock also breaks against the kerbs either side of the board: a column of light and a crown of sparks at each. |
| Line clear | The cleared rows fire out of the card as beams at their own heights. Then a wave bursts out of the vanishing point and rushes up the street at the viewer, one front per line: each sign flares as a front reaches it, the windows it passes stay lit, the kerb strips light, sparks kick off both kerbs, and the canyon's rays flood as it arrives. One line answers in the district's first accent, two in the second, three in both at once. |
| Combo | The district charges. More windows are lit, the trim on the towers climbs like level meters, the kerb strips chase faster, the city flows past faster, flying traffic speeds up and the palette warms from the level's accents to gold. A hologram beside the board counts the chain ("×3"), punched larger with each step. When the chain breaks the district browns out and drains. |
| Four lines / perfect clear | Blackout: every light in the district drops to a ghost for a fifth of a second, signs tearing. Then the wave comes back gold with four fronts, sheet lightning runs through the smog, and a drone-show dragon flies into the street, never the same way twice (see "The living night"). The district stays in overdrive while the dragon is in the street. A perfect clear calls two dragons and a volley of rockets, and opens the sky. |
| T-spin | The signs and screens glitch, and spinning hoops of light run away up the canyon. |
| Level up | The district changes colours: five palettes, cycled (signal, harbour, arcade, lantern, ultraviolet). Rockets burst between the walls in the new palette's colours. |

Combo here is the true consecutive-clear combo (one `ComboTracker` per player in
`NeonDistrictDirector`); the bus's `COMBO` event is cascade depth (ADR-0011). With several
boards on screen each lock lands under its own board, and the district charges to the longest
chain any board is holding.

![Lock, clear, combo and the four-line overdrive](neon-district-captures/desktop-events.webp)

## Shops and campaigns (2026-10-18)

The owner asked for better shopfronts and for neon and adverts that fit the game. Two changes
answer that.

![The street in game framing, with the campaigns](neon-district-captures/campaigns-street.webp)

**The shops are set into the walls.** Every block's ground floor is lined with shops, side by
side. Each is one flat quad, and its shader builds the depth behind it:

- The window and door are set back 0.3 to 0.55 m. The view ray is traced into that recess, so
  its jambs, soffit and threshold slide past in parallax and catch the shop's light.
- Wet glass stands at the back of the recess. At a glancing look it mirrors the far wall's neon.
  Up close, beads and runners sit on it and bend what is behind. Far off, where a bead would be
  smaller than a pixel, it is only wet.
- Behind the glass is the shop, interior-mapped like the rooms upstairs and furnished by trade
  (nine archetypes):
  - a noodle counter under pendant lamps
  - a laundromat's wall of turning drums
  - a mart's fridge wall and aisles
  - an arcade's cabinets
  - lit cubbies under spotlights
  - a bar's backlit bottles
  - a gym
  - a service counter
  - a calm room of round lamps for Sukha and the sauna

The painted shopfronts keep their paintings. Their signs and walls stay flush, and their windows
and door (`neon-district-openings.js`) are set back behind the same wet glass. The generated
shops have more parts:

- a fascia that spells the name in tubes, a lit box or channel letters, with its animated tube
  logo
- tiled piers
- a framed glazing with a door and a hanging sign (OPEN, 24H, OPEN LATE, WELCOME)

About a fifth of the trade shops have a roller shutter part or all the way down. Light leaks out
under it, and a closed one is tagged and fly-posted.

![Shops: both Combo Noodles branches, a closed arcade fly-posted with Cascade Cola, the noodle
chain's fascia, logo and blade](neon-district-captures/campaigns-shops.webp)

**The district runs its own campaigns** (`neon-district-campaigns.js`). There are three
families, and every surface that advertises carries them:

- **District brands**: eight local businesses named for what a player does on the board:
  - Cascade Cola: "Let it fall"
  - Combo Noodles: "Keep the chain going"
  - Stack Savings: "Build on solid ground"
  - Drop Couriers: "Hard and fast"
  - Level Gym: "One more level"
  - Next Taxi: "Always one more coming"
  - Clear Optics: "See every line"
  - Spin Cycle: "Wash dry fold"

  Each has a mark, two colours and a slogan. Most have a branch on the street, so the noodle chain
  on the billboards has a noodle bar under them. Cascade Cola is in most vending machines.
- **Sukha**: the breathing guide's campaign, the calm spot in a loud street. Its screens draw a
  ring in the space the advert leaves for it. The ring breathes on the game's breath (4 s in,
  6 s out, `breathFill`) and follows the guide's breath (`readBreathSignal`) while a session leads
  one. Sukha's tube logo breathes the same way.
- **Serenity Transit**: travel posters for the game's other worlds and modes, each framed around
  a render of the world it sells:
  - worlds: Koi Pond, Sakura Twilight, Crystal Cave, Golden Forest, Summer, Ocean, Winter and
    Stillwater
  - modes: Infinity, Stillfall and Odyssey (Stillfall took the Waystones poster's place
    when that mode was removed, 2026-10-18)

The surfaces:

| Surface | What it shows |
| --- | --- |
| LED screens (15 a period) | A playlist of three adverts of one shape, each on for 9 to 14 s, changing with a wipe, a block dissolve or a slide. Travel posters drift a few percent as they show. Some hang high off the corners of the towers. |
| Roof boards | The rooftop scaffolds now face the street (they used to show the street their backs) and carry a printed campaign under three floodlights. |
| Paste-up posters | Hoardings and closed shutters, fly-posted two to five of one poster side by side, then the next. They are paper, lit by the street rather than glowing, wet, and some are torn. |
| Tube logos | Each campaign's mark bent in tube, animated frame by frame (drops falling, steam rising, coins stacking, a drum turning), over its name. They hang over most branded shops and on some walls. |
| Blades | About one Latin blade in six spells a campaign's word in its colour: NOODLES, TAXI, BREATHE and so on. |

![Sukha's breathing screen and tube logos, Spin Cycle on a fascia, a logo and a tower screen, a
roof board](neon-district-captures/campaigns-adverts.webp)

The artwork is drawn by the atlas bake, not painted, so every campaign is one identity across
its billboard, poster, logo and fascia. No real company, film or game is named or drawn. No mark
is built from four squares or any other piece shape. Two of the
December 2025 images left the atlases because they carry third-party marks:

- the Retro Replay arcade, whose sign shows another company's video-game characters
- the Aurelia Colonies advert, signed with a famous film company's name and logo

The user's other adverts stay in the screens' playlists. (Since 2026-11-03 those are gone too:
ten street adverts painted by the bake took their slots; see
`scripts/neon-district/source-art/README.md`.)

## The street comes alive (2026-10-18, second pass)

The owner asked for the adverts, posters, shopfronts, neon signs and the shop rooms to feel more
alive. Everything below is a function of the world clock (and the breath), like the rest of the
district, so `seek(t)` still reproduces any frame.

![Fly-posted walls with the new poster designs, a bar and a noodle bar with people in them](neon-district-captures/alive.webp)

**People in the shops.** Since 2026-10-26 the people are a cast of neon-noir characters baked in
Blender, cel-shaded and inked, and lit by each room (they were flat signed-distance silhouettes,
`ndFigure`, until then); see [NEON_DISTRICT_PEOPLE_2026-10.md](NEON_DISTRICT_PEOPLE_2026-10.md).
Each room has up to four:

- **Staff** behind the counter, so the counter hides their legs: a cook, a bartender, a clerk,
  stepping along it between spots.
- **Elsewhere at the back:** runners on the gym's treadmills, players at the arcade cabinets, and a
  monk in Sukha's calm room who breathes with the game's breath.
- **In front of the counter:** a diner on a stool eating, a patron leaning on the bar, shoppers at
  the shelves, someone lifting dumbbells, people waiting on their phones, and customers crossing the
  room, stopping at its end to look round, and walking back.
- A shop with its shutter down is empty.

**Life in the rooms:**

- steam curling up off the noodle counter into the lamplight
- ceiling fans turning in the diner and the bar
- a wall television changing picture
- clothes tumbling in the running washer drums
- a fridge door with a failing tube in the mart
- attract modes on the arcade screens (rolling bars, a bouncing ball)
- scrolling rows on the office's queue screens
- Sukha's round lamps brightening and dimming with the breath

**Neon.**

- One sign or fascia in three switches itself back on now and then (every 25 to 55 s): its
  letters light one by one, then it flashes twice and stays on. A lit box does it all at once.
- One blade in seven is two-tone and swaps colour every few seconds.
- Most lit-box blades carry marquee bulbs round their edge, the lit ones chasing.
- Some framed tube signs have a brighter run of light travelling round the frame.
- Some window signs blink.

**Adverts.**

- Every advert creeps in a little as it shows; travel posters, a little more.
- A gloss of light sweeps across each LED wall now and then.
- Most street screens run a ticker under the advert: its slogan in amber LEDs ("COMBO NOODLES ·
  KEEP THE CHAIN GOING", "SERENITY TRANSIT · NOW BOARDING: KOI POND", Sukha's "INHALE 4 · EXHALE
  6"), or one of the district's own lines under the street adverts.
- Text lines are now up to 48 characters.

**Posters.** Rain runs down the paste-ups in streaks that darken and shine the paper, and a torn
flap's edge stirs, catching the light and losing it.

**More worlds, more designs.** There are now 34 Serenity Transit world posters (26 new), each
framed around a render of its world from the docs captures. Seven layouts take turns, so no two
neighbours share one:

- vintage framed
- full-bleed with the name set vertically
- Swiss colour field with a line number
- art-deco arch with a sunburst
- duotone screen print
- boarding pass with flap letters
- porthole with orbiting text

Each poster's colours are sampled from its own image. Every brand has a second poster in a
different design (a bottle close-up, a comic strip, a type-only stack, a parcel label, a price
tag, a roof sign, an eye chart, a wall of washer doors). The mode posters have three layouts of
their own.

The billboard atlas is 4096 × 3584 (half size 2048 × 1792 on the low tiers). Adverts are dealt
by campaign family first:

- on the screens and roof boards: brands 42 %, transit 38 %, the street adverts 12 %, Sukha 8 %
- on the paste-up walls: transit 60 %, brands 40 %

About 26 of the 34 world posters are up in any one period of street. A final pass makes sure
every campaign is on at least one screen.

**Cost.** The first version of the rooms traced the whole room and its people for every pixel of
every shop quad. In-game at Ultra on WebGPU (RTX 3070, 1584 × 813, two alternating rounds) that
read about 79 fps with the shops against 95 without. Now the room is traced only where it can be
seen: through the glass (not the fascia, piers, reveal or a shutter), and near enough for its
detail to show. A person who is not there is skipped. The same A/B then read 129.2 and 130.6 fps
with the shops against 129.9 and 130.1 without, at Electron's frame cap. All shots of the pass
(every tier, forced WebGL2, the four-line overdrive, rooms, frame strips of the people, poster
walls, screens) have clean consoles on WebGPU.

## Rain on the glass (2026-10-19)

The owner asked for realistic raindrops on the screen, pointing at a DaVinci Resolve rain-on-lens
tutorial. The district is now seen through a pane of glass in the rain
(`neon-district-glass.js`), drawn in the post's one output pass, before the bloom is added:

- **Beads.** Drops of two sizes on a jittered grid. Each is born (a raindrop lands), sits, and
  shrinks as it evaporates, then another lands elsewhere in its cell (a cell's lifetime is 9 to
  23 s).
- **Runners.** Heavier drops, one per column, running down the pane in stick-slip runs, wiping a
  trail through the mist that grows back behind them (how they move: "How the water moves" below).
- **Mist.** Fine condensation, heavier toward the foot and the sides of the pane, softens the
  street behind the glass. On High and up it mixes toward a quarter-resolution Gaussian blur of
  the scene (`GaussianBlurNode`); on Medium it only lifts the darks. The trails wipe it, and it
  thins round the drops.
- **Optics.** Every drop is a small lens. The scene is sampled at an offset against the drop's
  outward normal, five drop radii at the rim, so the street is seen through it upside down and
  shrunk. The inside gathers a little light. The rim darkens where the light turns away, a glint
  coloured by the neon behind sits on the shoulder facing the lamps overhead, and the foot
  catches a little caustic.

Placement and switches:

- It stays off the board card and HUD (the post's calm zones).
- It has its own clock in the world's post state (`rainTime`), which holds still under reduced
  motion.
- Tiers: two layers of each kind on High, Ultra and Extreme; one on Medium; none on Low and
  Minimal (`POST_LOOK[tier].glass` and `glassBlur`).
- `?neonDistrictGlass=0` (game) and `glass=0` (playground) take it off for an A/B.

Written for this theme. The best-known real-time shader of this effect is licensed for
non-commercial use only, so none of its code is used.

![Rain on the glass: the street at High, and in game beside the board](neon-district-captures/glass.webp)

Verified on WebGPU (RTX 3070): clean consoles at every tier, on forced WebGL2 and in the
four-line overdrive. In game at Ultra (1584 × 813, two alternating rounds) the street read 131.0
and 131.2 fps with the glass against 130.9 and 131.1 without, at Electron's frame cap.

### How the water moves (2026-10-19)

The owner liked the glass and asked for the dripping and the water running down it to look more
natural. The first runners slid in eight equal jerks, round, down the same sine-wave path every
run, and their trail beads moved with them. Now:

- **Each run is its own.** A run (16 to 30 s per column) has its own size, start height, path and
  kind. The drop gathers out of nothing where it starts and swells while it is pinned.
- **Stick-slip with an uneven rhythm.** Four runs in five rest at eight heights jittered so every
  slip is its own length. In each rest the drop breaks loose at its own moment, eases into the
  slide and stops short; heavier drops slide faster. It swells while pinned and is thinner after a
  slip, having left water behind. From the last rest, near the foot of the pane, it slips out of
  the frame, and its trail fades over the rest of the run.
- **Heavy runs.** One run in five is a heavier drop that gathers, then goes the whole way in one
  run, gaining speed.
- **A teardrop.** The head is a circle joined to a smaller circle up the tail by the lines tangent
  to both, so it stays a true lens. At rest it is a slightly egg-shaped drop, fuller at the foot.
  Sliding, the tail stretches to nearly three radii and points up the way it came (along the
  path). As it stops it squashes and stretches for half a second.
- **A kinked path.** The path is a slow wander plus sharper turns between straight runs, where the
  water was held up. It stays inside the column, so a head is never cut off at a column edge.
- **Film, then beads.** Behind a slip a thin film of water necks between bead sites and swells at
  them, then breaks up within about half a second (behind a heavy runner, a few drop-lengths
  back). It leaves trail beads fixed to the glass where they were left, of uneven size and a
  little off the line, drying as the drop goes on. Where the drop rested it leaves a bigger
  bead.
- **It sweeps up beads.** A bead the head comes down over since it landed is taken up, and
  shrinks back in as that trail dries.
- **Beads land and creep.** A landing bead spreads past its size and settles back, and the
  heaviest beads slip a little way down their cell in a jerk or two.

All of it is still a function of screen position and time: no particles and no state. It shows
the same at any `seek` and holds still under reduced motion. A run's slips need no loop: each
rest height is the even split plus a jitter of under half a step, so the rests stay in order and
each slot reads only its own two rests.

![A heavy runner, 0.3 s apart: the glass alone (playground glassDebug=1) and over the street](neon-district-captures/glass-flow.webp)

`glassDebug=1` on the playground draws the glass alone: the drops pale, and the mist with
the trails wiped through it violet. It is how this pass was judged. Through the street the
drops are easy to lose; on their own their shapes and timing read at once.

Verified on WebGPU (RTX 3070): clean consoles on High and Medium, on forced WebGL2, and in game.
In game at Ultra (1584 × 813, two alternating rounds) the street read 130.7 and 131.0 fps with
the glass against 130.8 and 130.6 without, at Electron's frame cap.

## The living night (2026-11-17)

The owner asked for an audit of the whole theme and a pass that makes it one of the game's most
striking: varied over time, an effect of its own for every event, the biggest moments the most
spectacular, and above all a dragon that is different every time it appears. The street, the
shops, the signs, the people and the rain on the glass were kept as they are. This section
records what the audit found and what the pass added.

### What the audit found

- **The dragon was one animation.** One closed-form curve with constants in it: out of the haze,
  down the left wall, over the camera, every time. Its drones sat at random along their lines and
  each was a round dot, so in the game it read as a string of fairy lights, not as a body.
- **The night never changed.** The palettes turn on the clock, but they tint only the haze, the
  sky and the waves; the signs keep their own colours. Every minute of play had the same rain,
  the same visibility and the same grade.
- **Events shared effects.** A hard drop was a harder lock. A twist was a sign glitch. A new
  level was a flash and sheet lightning. A perfect clear was a four-line clear with a brighter
  dragon.
- **The frame decides what is seen.** The card covers the canyon's vanishing point and most of
  the sky. What a solo game shows is two wedges of street beside the card, about 6 to 30 m
  deep on the left and 6 to 14 m on the right (the stats bar takes the rest). Anything that
  happens under the board, far up the street or in the sky is behind the card.

### The dragon never flies the same way twice

![Six flights: a spire climbed, a figure of eight, a dive to the street, a burst, the swarm gathered again in the other lane, and a ring in the real game](neon-district-captures/night-dragon.webp)

Every call plans a new flight (`neon-district-dragon.js`, three-free and pure) from a seed and
from what the frame leaves free.

- **The stage.** `dragonLane` turns the live card and HUD rects into lanes: the wedge of air
  beside the cards on each side that has room, or, on a tall frame with none, the band over the
  card. Every figure is laid out inside a lane, sized to it, and the way from one lane to the
  other runs behind the card.
- **A flight is a recipe.** Twelve of them: `serpent` (a weave behind the card and a close pass
  on the far side), `spire` (a coil climbed round an upright axis), `ouroboros` (a ring flown
  facing the viewer, which bursts and gathers again), `skimmer` (a dive and a run along the wet
  road in a sheet of spray), `borer` (a corkscrew bored away down the lane), `phoenix` (gathered
  out of sparks into a ring), `leap` (a loop over on its back), `vanish` (a figure, a burst, and
  the swarm gathers again in the other lane), `lantern` (a ring that dissolves into rising
  sparks), `gyre` (a corkscrew flown at the camera), `eight` and `comet`.
- **Each deal is its own.** A recipe draws its way in (out of the far haze round the card's edge,
  down out of the smog, past the camera from behind, low along the street, or gathered out of
  sparks), its way out (over the camera, into the haze, straight up, or dissolved), its depths,
  turns, directions, size and one of six colour schemes. The world deals the recipes from a
  shuffle bag: all twelve fly before any comes round again, and a new deal never opens with the
  one just flown. A session shuffles its own order; a capture keeps one.
- **Bursts.** The swarm leaves its seats for a cloud of glittering sparks and comes back: in
  place, or while the head jumps to another piece of the curve, so it gathers somewhere else.
- **It reads as a dragon.** The drones of a line are dealt evenly along it and each is drawn out
  along its line as the screen sees it, so a row of drones is one neon tube: six contours down
  the body, hoops round it, a sawtooth crest. The head is drawn 1.4 times the body's scale, with
  jaws that open in a roar, teeth, forked antlers, a mane, whiskers; four legs with claws; a
  tail fan; embers that hang where the body shed them. A low tier has fewer drones and longer
  dashes, and is still tubes.
- **How it is drawn.** The planner bakes the curve to 192 knots one step of arc apart, with a
  frame at each (carried along the curve without twist, then eased upright, so the body banks
  through a loop and levels out). Both go into one float texture the vertex stage reads by
  index (`textureLoad`); a table of rows holds the head's place, the burst and the colours. One
  mesh flies two dragons.
- **A perfect clear calls two**: one white-gold, one in the district's colours.

In the playground: `dragon=<recipe>`, `dragonSeed=`, `dragonScheme=0..5`, `dragonSide=-1|1`,
and `dragonCam=<m>` for a camera that rides beside it.

### A sharper window

The owner liked the rain on the glass and asked for the window to be a little sharper, so the
theme behind it shows better. The drops, the runners and their trails are as they were. The mist
between them now blends at most 34 % of the blurred street over the picture (it was 70 %):
`GLASS_MIST_SOFTEN` in `neon-district-post.js`.

### The night turns

![Rain, a downpour, a clear spell and a bank of fog](neon-district-captures/night-weather.webp)

Beside the palettes, the weather turns on a clock of its own (`neon-district-night.js`), 470 s
round against the palettes' 500, so a palette meets a weather again only after hours.

| State | Seconds | What it looks like |
| --- | --- | --- |
| rain | 84 | Today's look, where every night starts. |
| downpour | 72 | It comes down hard and leans in the wind, the haze thickens, sheet lightning walks, the grade cools to steel. |
| easing | 46 | The rain thins and the first gaps open in the smog. |
| clear | 108 | The rain stops. The air is washed clean and the far street stands sharp, the smog parts over the moon and a few stars, the drops dry off the glass, and the neon is at its most saturated over indigo shadows. The street stays wet. |
| fog | 92 | A bank of fog rolls down the canyon: everything past the near shops dissolves, every lamp wears a wide halo, and the fog glows warm with the city. |
| mizzle | 68 | The fog lifts into a fine rain. |

Each state is held for two thirds of its span and melts into the next. Play pushes on top: hot
play still brings the downpour, even into a clear spell, and a perfect clear's crown still opens
the sky. `u.rain` is now how wet the surfaces are and the new `u.fall` is how much rain is
falling, so the road keeps its mirror through a dry spell.

**Passers-by.** About every 27 s something flies down the street past the camera, low between
the walls: a cab, a patrol whose lights turn slowly from red to blue, a freighter hung with
marker lamps, a string of courier drones. Each is one card that faces the camera, a dark hull
with its lamps on it. Its light is the district's own (`ndGlow` reads `u.pass`), so the walls,
the rain and the wet road all show it go by. Never the same kind twice running; none under
reduced motion.

### An effect of its own for every event

![A hard drop at the kerbs, a twist's gyre, a new level's rockets, a perfect clear's white-gold dragon, a patrol passing, and a level-up in the real game](neon-district-captures/night-events.webp)

| Event | What is new |
| --- | --- |
| Hard drop | The shock breaks against the kerbs either side of the board: a column of light stands up out of each in the piece's colour for a third of a second, with a crown of sparks thrown straight up. (The first version put one column at the landing, which is under the card.) |
| Twist | The circuit turns over: three spinning hoops of light run away up the canyon round its walls, the other way round each time. |
| New level | Rockets climb between the walls and burst in the colours of the palette the district is turning to. The wet road shows every star again. |
| Perfect clear | Two dragons, a volley of white-gold rockets, and the sky opens. |
| Four lines | The dragon, in a flight of its own. |

Locks, clears, combos, cascades and back-to-backs keep their effects.

### Verified

- Playground captures on WebGPU (RTX laptop GPU), all with clean consoles: all twelve flights as
  frame strips at High; every weather state; four passers-by; hard drop, twist, new level and
  perfect clear; the dragon on forced WebGL2, at Low and Medium; rockets and the kerb columns at
  Minimal; a perfect clear at Ultra; a 430 x 932 portrait frame through a four-line clear and a
  new level (the dragon and the rockets take the band over the card).
- The real game (the dev server in headless Chrome, single player, WebGPU, High): the theme
  starts with a live layout, takes real bus events (hard drop, twist, level up, four lines),
  counts them, flies the dragon beside the real board and logs nothing.
- 163 tests in the theme's files and their neighbours pass, among them two new files:
  `neon-district-dragon.test.js` (every recipe on a wide, a two-lane and a tall stage stays
  inside the canyon; frames are unit vectors square to the curve; the head only moves forward;
  bursts, jumps, gathering and dissolving; the bag deals every recipe once; the new parts build
  to WGSL and GLSL) and `neon-district-night.test.js` (the weather's states and melts, what the
  world does with them, the passers-by, and each event's own effect).
- Typecheck, the lint and type ratchets, the fitness ratchets, dependency boundaries, the theme
  lifecycle audit, the IP-string gate and the production build with its boot-closure guard pass.
- The whole suite, run twice: 1,411 of 1,418 files and 25,573 of 25,615 tests passed on the
  second run. Six files failed, none of them this theme's: `records-view` and
  `game-over-modal-result-compatibility` (this machine prints `8 025`, the tests expect `8,025`),
  `tts-recorder-e2e` (a symlink Windows refuses in a worktree), and `local-versus-cameras`,
  `odyssey-layout-editor` and `stellar-drift-build-steps`, which pass when run on their own here
  and on untouched `main` (the first run failed a different handful under the same load).
- Cost, measured cool (the playground at 30 fps, 1920 x 1080, High, the same GPU): 1.43 ms of GPU
  time a frame on `main` against 1.46 ms here at rest, 1.45 against 1.48 through the demo's
  events. Time to the first frame did not differ beyond the noise between runs.

Not verified: the cost on an integrated GPU and an uncapped frame rate (the owner is asked
before any uncapped run); local multiplayer and Infinity layouts in a capture (the lanes follow
the live rects; only the solo and tall layouts were looked at); reduced motion and reduce
flashing in a capture (unit-tested).

Open calls for the owner:

- The line clears' waves still wash the near street pale as they arrive. It is the look the
  first build chose; it could be made a sharper band.
- The passers-by are simple shapes (a rim-lit hull with lamps). They read at the speed they
  pass; a closer look would want modelled vehicles.
- The megatower skyline and the sky are almost wholly behind the card in a solo game, so this
  pass left them alone apart from the clear spell's stars and moon.
- The theme icon still shows the two-line wave, not the new dragon.

## More colour (2026-11-17, evening)

After the living night landed, the owner asked for a "slightly more colorful and fun" street:
the buildings, the storefronts, the colour grading, the colours, and the shop, restaurant and
store rooms, "more varied, fun and more visually stunning". Two smaller requests came first and
are recorded here too.

![The street, a bar and a gym up close, and two views in game](neon-district-captures/colour.webp)

- **The combo hologram is never cut.** The "×5" hung among the buildings of the free zone and
  was depth-tested, so a corner could pass in front of it, and its size ignored how wide the
  zone really is. It is now drawn over the city (and kept out of the street's mirror) and sized
  from the projection so that, at its largest, it fits the zone with a margin.
- **Buildings.** About two in three wear a paint of their own (`FACADE_PAINTS`: teal, coral,
  mustard, plum, mint, cobalt, rose, lilac), which shows where the street's light falls on it
  and stays night-dark elsewhere; some change colour halfway up. Some carry a line of light
  under every third floor. One room in five is lit in colour (the building's accent, or a pink,
  cyan or violet strip of LEDs), and a few more windows are lit.
- **Storefronts.** Most generated shops are tiled in a glaze of one of their own colours, the
  small tiles in a chequer of it and cream. About half have a tube of neon bent round the
  opening. Some hang a string of warm, pink and cyan bulbs under the fascia. Door and window
  frames are painted in the shop's second colour.
- **Rooms.** The street sees a shop at 45 to 85 degrees, so most of what it sees of a room is a
  side wall, and those were flat grey. Every room now has a paint of its own, darker below a
  dado rail; two sconces that throw pools of light on the wall; framed posters; a tube of neon
  bent into a ring, a zigzag or three bars; a wash of the shop's colour down the back wall from
  the ceiling line; and a floor laid in two tones.
- **The street.** Canopies and vending machines are painted the colour of their own lamp, the
  canopies striped with cream. The paper lanterns are no longer all red and orange: among them
  hang pink, jade and yellow ones.
- **The grade.** Saturation is up by about a tenth in every weather (1.12 to 1.23 in the rain,
  1.37 in a clear spell) and the picture is bent a little toward an S-curve
  (`GRADE_CONTRAST`), so the darks are a shade deeper and the colour has something to burn
  against.

Verified: captures of the street at six moments, six rooms up close, the game view in rain, a
clear spell and fog, a four-line clear, Low, Medium and Minimal, and forced WebGL2, all with
clean consoles; the hologram at nine moments, whole in each. The theme's 157 tests, the
typecheck and the lint ratchet pass. Cost on the same GPU, measured cool: 1.49 ms a frame
against 1.46 before this pass. Not verified: an integrated GPU, and the real game after this
pass (the shaders it changes are the ones the playground mounts).

## How it is built

| File | Role |
| --- | --- |
| `neon-district-core.js` | Three-free constants and maths shared by the plan, the choreography and the shaders: the street's dimensions, the scroll wrap, the lock shell and clear wave timings. |
| `neon-district-layout.js` | The city plan for one 320 m period, seeded and deterministic: blocks, towers, shopfronts, signs and what they spell, screens, hardware, cables, lamps, megatowers, and the glow map. |
| `neon-district-glyphs.js` | The sign-maker's alphabet: stroke lists for digits, Latin capitals and 28 characters of the district's own script, baked to a distance-field atlas. |
| `neon-district-atlas.js` | Generated cell table for the shopfront and billboard atlases. |
| `neon-district-tsl.js` | Hashes, the baked noise texture, the shared uniforms, the district's light (glow map, haze, lock shells, clear waves). |
| `neon-district-facades.js` | Every building: one instanced box each, the facade drawn in the fragment shader with interior-mapped rooms. |
| `neon-district-street.js` | The wet street: asphalt, paint, puddles, the planar mirror, rain rings, lock rings, kerb strips. |
| `neon-district-campaigns.js` | Three-free: what the district sells. The eight brands, Sukha, Serenity Transit, the trade shops, the shop archetypes and their light. |
| `neon-district-shops.js` | The shops: painted shopfronts and generated shops, each a flat quad that traces its recess, wet glass and an interior-mapped room by trade. |
| `neon-district-people.js` | The people in the shops: roles by trade, the table the shader reads (clips, palettes), reading the sprite sheets and lighting a person by the room ([NEON_DISTRICT_PEOPLE_2026-10.md](NEON_DISTRICT_PEOPLE_2026-10.md)). |
| `neon-district-people-atlas.js` | Generated by `scripts/blender/neon_district_people.py`: the people's sprite sheet layout, views and clip timing. |
| `neon-district-openings.js` | Where each painted shopfront's windows and door are, so that part can be set back. |
| `neon-district-text.js` | Lines of text for the shaders: one row of glyph ids per line in an R8 texture. |
| `neon-district-logos.js` | Three-free: the tube logos as strokes in four channels (the tube and three animation frames), baked to a distance-field atlas. |
| `neon-district-signs.js` | Tube signs, billboard screens with playlists, tube logo signs. |
| `neon-district-prints.js` | Printed campaigns: floodlit roof boards and paste-up posters, lit by the street. |
| `neon-district-kit.js` | The street's hardware: awnings, vending machines, fire escapes, pipes, skybridges, gantries, tanks, masts, condensers, scaffolds. |
| `neon-district-lights.js` | Halos, street lamps and their cones, cables and lanterns, beacons, flying traffic. |
| `neon-district-weather.js` | Rain and steam. |
| `neon-district-sky.js` | The smog ceiling, the veiled moon, sheet lightning. |
| `neon-district-fx.js` | Sparks, row beams, the combo hologram, the hard drop's columns, the twist's gyre, fireworks, and the dragon's drones. |
| `neon-district-dragon.js` | Three-free: the dragon's flights. The lanes the frame leaves free, the figures and recipes, the planner (knots, frames, times, bursts), and the drones' seats. |
| `neon-district-night.js` | Three-free: the night's weather on its clock, and the passers-by. |
| `neon-district-flyby.js` | The passers-by: one camera-facing card with a hull and its lamps. |
| `neon-district-world.js` | Owns the uniforms, the parts, the camera rig and the choreography. Shared with the playground effect, so what is iterated there ships. |
| `neon-district-director.js` | Renderer-free: stages bus events per player and resolves one lock and one clear per frame. |
| `neon-district-composition.js` | Three-free: reads the live card, board and HUD rects and maps board columns and rows onto the screen. |
| `neon-district-post.js` | One scene pass, bloom, and one output pass. |
| `neon-district-theme.js` | Lifecycle, renderer selection, settings, layout watch, GPU-loss recovery, capture flags. |

Techniques worth knowing before changing it:

- **One node renderer on both backends.** `WebGPURenderer` on WebGPU, its WebGL2 backend
  otherwise (or `?forceWebGL`). There is no `ShaderMaterial`, so `neon-district` is off the
  dual-state allowlist. Nothing uses compute.
- **The city scrolls, the camera does not.** Every scrolling object carries a layout depth in
  one period and is drawn at `ndWrapZ(z + scroll)`. Objects leave 24 m behind the camera and
  re-enter inside the far haze, so the seam is never seen. Megatowers do not scroll. Every
  pattern laid along the street repeats in a whole number of periods, so the world drops eight
  periods from the scroll whenever it grows past that and nothing is anchored to it; the scroll
  stays small enough for a 32-bit float however long the session.
- **About thirty draws, and again in the mirror.** Each kind of thing is one instanced draw. A
  building is one instance of a five-quad box: bays, floors, window frames, mullions, sills,
  cladding, air-conditioning units and rain sheen are drawn in the fragment shader from the
  wall's own metres, and fade to their true average where a cell is smaller than a pixel.
- **Interior mapping.** Behind each lit window the view ray is intersected with a room (back
  wall, side walls, floor, ceiling), so rooms slide past in true parallax: furniture, a door or
  a picture on the back wall, a light panel in the ceiling, blinds or a curtain in some.
- **Nothing is lit by a light.** Every material shades itself (`MeshBasicNodeMaterial`). The
  district's light is the glow map (a 160 × 2 texture of what each stretch of each wall's signs
  throw, baked from the plan), the haze, the lamps' analytic pools and the gameplay pulses. That
  keeps the mirror's second render cheap and makes walls, road, rain, steam and hardware agree
  on the colour of every stretch of street.
- **The mirror.** On Medium and up a planar `reflector()` renders the district from the
  mirrored camera at reduced resolution with a mip chain. The street reads it sharp in the
  puddles and, on rough wet asphalt, as a short vertical run of taps at a blurred mip: the long
  streak under every sign. Rain, steam and the row beams live on layer 1, which the mirror's
  camera does not render. Low and Minimal mirror the glow map instead.
- **Closed form first.** Rain, steam, traffic, lock shells, clear waves, sparks, row beams and
  the dragon are functions of the world clock and event timestamps. Nothing is created at event
  time: events write numbers into ring-buffered uniform slots and one preallocated spark pool.
  `seek(t)` plus a fixed-step replay reproduces any frame, and a test proves the same state at
  30 and 240 frames a second.
- **The dragon is drawn with lines of drones**, as a drone show draws: six contours down the
  body, hoops round it, a sawtooth crest, jaws, a mane, whiskers, antlers, legs, a tail fan, each
  drone drawn out along its line so a row is one tube. Each drone's place is a function of the
  clock, its seat and the flight's curve, which is planned for every call inside the lanes the
  frame leaves free (see "The living night").
- **HDR, single output.** The scene is scene-linear; a max-channel knee selects what blooms (no
  MRT), and one output pass does the lens fringe, the calm zones on the card and HUD, bloom,
  anamorphic streaks and canyon rays (the bloom dragged sideways, and radially out of the
  vanishing point), a hue-preserving filmic curve, grade, vignette, grain and dither. An iris
  closes as the district flares so its colours survive the surge. `usesMrtScenePass()` is
  false.
- **No MaterialX noise.** One tileable fBm texture is baked on the CPU with its own mip chain;
  every shared `Fn` carries `setLayout`.

Two shader lessons from this build are in the repo's TSL skill gotcha table: a per-instance
value read in the fragment stage is interpolated, so seeds are integers and are rounded before
they reach a hash; and a `floor()` of an exactly dividing quotient of such values needs a bias.

## Tiers

Since 2026-11-17 the drone counts below are per dragon (one mesh seats two), and a firework
shell has 24, 48, 80, 120, 160 and 200 stars from Minimal to Extreme.

| Tier | Rooms | Mirror | Rain streaks | Sparks | Dragon drones | Bloom, streaks, rays | Scene MSAA |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Minimal | flat panes | glow map | 1,400 | 96 | none | off | off |
| Low | flat panes | glow map | 2,600 | 160 | 900 | off | off |
| Medium | interior-mapped | 0.36 scale, 3 taps | 5,200 | 320 | 2,600 | on | off |
| High | interior-mapped | 0.5 scale, 3 taps | 9,000 | 512 | 5,200 | on | 4× |
| Ultra | interior-mapped | 0.6 scale, 5 taps | 13,000 | 768 | 8,400 | on | 4× |
| Extreme | interior-mapped | 0.75 scale, 5 taps | 18,000 | 1,024 | 12,000 | on | 4× |

Halos, lamp cones and steam are Medium and up. Low and Minimal load the half-size atlases.

## Assets

The shopfronts and billboards are two WebP atlases under `public/textures/neon-district/`
(with half-size copies), baked by `scripts/neon-district/build-atlases.mjs`: the shopfronts
from the paintings in `scripts/neon-district/source-art/`, the billboards painted by the bake. The bake is deterministic. The atlases
load off the frame: the district stands dark where they go and powers up when they arrive.

Everything else is generated: the facades, the signs' glyphs, the hardware (boxes and
cylinders merged at build time) and the noise. No model is loaded, and Blender was not needed.

The SynthCity texture set, the asphalt textures and the HDR environment the earlier theme read
are no longer used and were removed from `public/` (about 38 MB of the shipped build).

## Verification

- Unit tests: 84 new tests in four files (layout, glyphs and atlases 18; director and
  composition 19; world 29; theme 18). The three test files of the earlier theme were retired
  with it, `portable-theme-renderers.test.js` no longer lists Neon District, and the dual-state
  allowlist lost its entry. Whole suite: 552 files, 6,133 tests. Every Neon District test
  passes. On the build machine, which was busy with other sessions, between three and five
  time-budget tests in unrelated Odyssey and Stellar Drift files failed in the full run (a
  different handful each run); all of them pass when run on their own.
- Gates: lint ratchet (964 errors against a baseline of 1,070: removing the old theme took about
  a hundred with it; the baseline was left as it is), typecheck, production build with the
  boot-closure guard, dependency boundaries, theme lifecycle audit, IP-string gate and the Pages
  artifact check all pass. The palette gate fails on `main` and here for the same unrelated
  reason (Stillwater); Neon District scores 0/7 on it.
- Playground captures on WebGPU (RTX 3070 Laptop): rest, lock, hard drop, clears of one to three
  lines, a held combo, and the four-line blackout, wave and dragon, at High; rest at Minimal,
  Low and Medium; High and Low on the forced WebGL2 backend; a 430 × 932 portrait frame at rest
  and through a four-line clear. No console errors or warnings in any of them.
- In the real game (Electron, dev server, single player): the theme starts on WebGPU, aims its
  events at the live board, takes real hard drops and bus-injected clears, survives a live
  quality change (High to Medium) and lets go of its canvas when another theme takes over.
  Observed frame rate of the whole game at 1584 × 813: about 125 to 130 fps at High on the
  RTX 3070; on the integrated AMD GPU, 61 fps at High, 119 at Medium and 163 at Low (Low renders
  at 0.85 scale). The same harness measured the earlier theme at 42 fps at High on the RTX 3070,
  with its dynamic resolution already down to 1346 × 691.

Not verified: GPU cost per tier through the theme perf lane (the figures above are observed
frame rates, not ADR-0016 measurements, and they moved by tens of fps between runs); physical
phones; Ultra and Extreme in a capture (Ultra ran in game); local multiplayer and Infinity
layouts in a capture (their routing is unit-tested only); reduced motion in a capture; sessions
of several hours (the scroll rebase is unit-tested only).

**The shops and campaigns pass (2026-10-18):**

- **Unit tests.** New tests cover:
  - the shops: they line every block, never overlap, have valid openings, and every painting is
    dealt once a period
  - the campaigns: every brand with a shop has a branch, every campaign is on a screen or a wall,
    and every trade shop appears
  - screens: three different adverts of one shape, Sukha's at most once
  - prints: never a ring advert, and every roof board sits on a scaffold
  - logos: the atlas and its animation table (16 logos)
  - every line of text spells with glyphs the atlas has

  The Neon District files pass. The whole suite: 995 files, 18,800 tests, all green except four
  tests that fail on `main` too (`tts-recorder-e2e`, `game-over-modal-result-compatibility`,
  `odyssey-level-briefing`, `records-view`).
- **Gates.** All pass: lint ratchet (575 against a baseline of 599, left as it is), typecheck,
  production build with the boot-closure guard, dependency boundaries, architecture fitness,
  IP-string gate, Pages artifact and release gates.
- **Playground captures on WebGPU (RTX 3070 Laptop).** Clean consoles at every tier from Minimal
  to Ultra, on the forced WebGL2 backend, in the four-line overdrive and in a hard drop. Close-ups
  covered a Sukha screen breathing, poster walls, roof boards, logo signs and both Combo Noodles
  branches.
  - The first GPU run caught what software rendering could not. The generated shops and the
    screens had 11 and 9 separate instance attributes, and WebGPU allows 8 vertex buffers, so
    both pipelines failed on WebGPU only. Their instance data is now one interleaved buffer
    (`ndQuadGeometry(…, { interleave: true })`).
- **In the real game** (Electron, dev server, single player, RTX 3070, 1584 × 813): the theme
  starts on WebGPU with all 57 shops and logs no errors.
  - High: 129.6 fps.
  - Ultra: four alternating runs, with the new shops, logo signs and prints and without them,
    read 130.6 and 130.7 against 130.5 and 130.6 fps. That is Electron's frame cap (about 131 Hz
    here), so the new parts' cost is below what this can see. A single earlier Ultra reading of
    106 fps did not repeat.
  - These are observed frame rates, not perf-lane (ADR-0016) measurements.

## Reproduce

Run `npm run dev:playground`, then:

`/playground.html?effect=neon-district&t=30&quality=High&board=1`

Add `event=lock|drop|clear|quad|twist|perfect|levelUp` with `eventAge=<s>` (or `eventAt=<s>`,
which fires it at that time on the clock so one page load shows it at any age), and `combo=<n>`,
`level=<n>`, `lines=<n>`, `u=<0..1>`, `color=<hex>`. `weather=rain|downpour|easing|clear|fog|mizzle`
holds the weather; `dragon=<recipe>`, `dragonSeed=`, `dragonScheme=`, `dragonSide=` and
`dragonCam=<m>` choose and follow a flight. `demo=1` (without `t`) plays a looping
script. `parts=` draws only the named parts; `falseColor=1` bands the pre-tone-map peak;
`noPost=1` shows the raw scene; `forceWebGL=1` uses the WebGL2 backend. In the game:
`?neonDistrictTime=`, `?neonDistrictFixedDt=`, `?neonDistrictParts=`,
`?neonDistrictFalseColor=1`.

The theme icon is the two-line clear wave through the playground's icon lens
(`/playground.html?effect=neon-district&t=100&quality=High&icon=1&event=clear&lines=2&eventAge=0.8&combo=1&glass=0`
in a square window), cropped to 74% of the frame around (0.5, 0.56), given a colour lift
(contrast 1.22, saturation 1.55, brightness 1.06) and baked as a 512 px circle. Re-baked on
12 Nov 2026 from the current district (its street adverts drawn by the build script), with the
rain on the glass off so the small icon stays clear.

## Captured previews

![The dragon in game](neon-district-captures/desktop-dragon.webp)

![Portrait: at rest and a four-line clear](neon-district-captures/portrait.webp)
