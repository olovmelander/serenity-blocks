# Sunbraid — a new theme in Rainy Window's place (2026-10-20)

`sunbraid` replaces the legacy `rainy-window` theme (the old id is retired to it: saves, the
collection, Odyssey completions and the music key all resolve; `RETIRED_THEME_IDS`,
`RETIRED_TRACK_KEYS`, `tests/unit/sunbraid-rename-migration.test.js`). Asked for as a complete
visual remake with a free choice of subject and name: "a stunning theme that will be remembered as
one of the greatest themes in this game when it comes to visuals, atmosphere and effects ...
colorful and unique ... a unique theme concept not made in the game already", and mid-research,
"do nothing about places on earth".

Module map: `src/themes/sunbraid/` (`sunbraid-core.js` constants, the suns and the braid's
geometry; `sunbraid-braid.js` the braid's state and every gameplay answer; `sunbraid-plan.js` the
valley and where the towers stand; `sunbraid-spire-shape.js` the towers' shapes and shadow
proxies; `sunbraid-noise.js` the baked noise shared by CPU and GPU; `sunbraid-glide.js` the
gliders' flight; `sunbraid-tsl.js` the uniforms, the light of the three suns, the shadows, the sky,
the mist; one module per part (`-land`, `-spires`, `-gliders`, `-sky`); `sunbraid-world.js` the
world; `sunbraid-post.js` the post stack with the mist's light; `sunbraid-theme.js` the BaseTheme
shell and `sunbraid-director.js` the gameplay director, both cloned from Grainfields).
Playground: `?effect=sunbraid` (`src/playground/effects/sunbraid.effect.js`).

## The subject

A pale world under a close triple star. Three suns, coral, jade and cobalt, wheel round one
another low in the sky to the left of the board (the braid). The eye hovers seventy metres over a
valley of white gypsum, where towers and buttes of pale bedded sandstone stand.

Because each sun is a different colour, everything casts three shadows. Where all three suns reach
the floor it is white; where one is hidden the floor shows what the other two make (cyan where the
coral sun is hidden, magenta where the jade one is, gold where the cobalt one is); where two are
hidden it is the third's own colour; where all three are hidden it is dark. Lit from in front, every
tower stands against the suns with coloured rims and throws a fan of graphic coloured bands toward
the eye. As the suns wheel the fans swing and recolour, and the whole valley's balance moves.

The subject is new to the fleet: no theme lights its world with coloured light sources or makes
colour out of shadow. Its one shared motif is a multi-sun sky (Shifting Sands has twin suns over
orange dunes); Sunbraid's are three coloured stars over a white floor, and it has no dunes, mesas of
sand, sandworm or golden dusk. References used: the additive colour model behind coloured shadows (red, green and blue lamps
casting cyan, magenta and yellow shadows, a classic science-museum demonstration) and the first planet
found in a triple star system (HD 188753, announced 2005).

## The design process (what was tried and why it changed)

1. Three suns spread a third of a turn apart round the whole sky, a pale rolling plain with
   standing stones: the era idea worked (which sun stands in front sets the palette) but every
   rounded form read as a debug render of normals and everything was lit from somewhere.
2. A high hovering view over a valley of towers: the coloured shadows read as stripes, but the forms
   were toy-like (rounded tops read as pegs) and the light was a flat pastel wash.
3. Faceted towers (polygonal sections, so each face is one colour) and a tonal pass (brighter suns,
   almost no fill): colour, but still no drama, because the suns lit every face.
4. **The triple star in front of the eye**: the suns as a close cluster low in the sky on the left.
   The towers stand backlit with coloured rims and every one throws a fan of coloured shadows to the
   eye. This is the theme's image.
5. An independent art critique (fresh context, judged only the frames) drove the next pass: crisp
   penumbrae (graphic bands, not a rainbow smear), a lit floor near white with saturated bands,
   coloured sun discs, a dome with colours of its own, fewer and more massive forms, and the ideas of
   selenite glitter and coloured shadow wedges in the mist.

## The picture

- **The eye** hovers 70 m over the valley floor (`EYE_ALTITUDE`), looking down 4.5° with a 46° lens on a
  landscape screen. On an upright phone the lens yaws 20° toward the suns and looks down 20°, so the suns
  ride in the band above the card and the fans lie in the band below it (`rigFor`).
- **The suns** (`SUNS`, `BRAID`): coral, jade and cobalt, their colours times power summing to a neutral
  white. A close triple star: they wheel on an ellipse 4.8° wide (flattened to 0.62 of that, so an opened
  braid never sets a sun) round a centre 27° left of the view axis and 9.4° up, nodding ±1.5° over 22
  minutes. Discs are a white-hot core with a limb of the sun's own colour (1.45°, 1.1° and 0.95°); each has
  a corona, a broad lobe that tints the whole dome, and a glow along the horizon on its side.
- **The light** (`sunbraid-tsl.js`): every surface is lit by the three suns as Σ colour · max(N·S, 0) ·
  visibility, with almost no fill, so a face turned from all three suns goes dark and a shadow band is a
  saturated mix of the other two. `LIGHT_GAIN` 3.1 puts the open floor near white before tone mapping.
  Shadows are analytic: each tower is a stack of flat-topped vertical cylinders, one per tier, built from
  the same profile that draws it (`spireProxies`), each glider a disc; a point's visibility is the ray's
  angular clearance against a 0.42° penumbra, so the bands are graphic near the towers and soften with
  distance.
- **The towers** (`sunbraid-spire-shape.js`, `sunbraid-spires.js`): eight shapes swept round their axis on
  the CPU (towers, buttes, mittens): polygonal sections (so every cliff is a plane and a block of colour),
  setbacks, cap rocks, flutes and cracks, a scree apron; pale bedded stone (cream, ochre, rose, lilac) with
  streaks, pale turf on the flat tops, darker in the setbacks' inner corners; a relief bump from the noise
  by screen derivatives; a sheen round the silhouettes when the eye looks toward a sun; light thrown up off
  the white floor onto the lower cliffs. Fourteen towers in a composed layout (`SPIRE_LAYOUT`): a broad
  mesa and a tall tower under the suns on the left (the hero fan), a stepped butte and a tall tower on the
  right, mittens and towers further along the valley, two more at the sides for 21:9.
- **The floor** (`sunbraid-land.js`): one fan of ground round the eye; white gypsum with warm patches,
  polygon crusts and drifts of pale scrub; selenite crystals in cells laid out in the coordinates the eye
  projects along (a few pixels at any range), each catching one sun's glint, so the glints of a hidden sun
  go out in its band. A far rim of terraced escarpments.
- **The air**: a high cloud deck (domain-warped octaves, lit by each sun with a two-lobe phase and a tap
  toward it, silver-lined, never brighter than 1.5) drifting on a steady wind, whose broad masses cast faint
  coloured shadows; aerial haze coloured by the sky low along the same bearing; and a valley mist whose
  light the post adds at reduced resolution with every tower's shadow wedges taken out of it per sun, in
  closed form (`sbShadowSpan`, `mistLight`), so the fans stand in the air.
- **Life**: gliders (`sunbraid-glide.js`, `sunbraid-gliders.js`), broad translucent-winged creatures riding
  figure-of-eight loops 150–330 m over the floor, banking into their turns, lit on either face and glowing
  where they stand before a sun; each throws three coloured shadows that sweep the floor.
- **The pieces** (`sunbraid-tetrominos.js`) are the braid's colours: the three suns (I coral, O cobalt,
  J jade), the shadows they make (Z cyan, S magenta, T gold) and L the far sky's lilac. Palette gate 0/7;
  every pair at least ΔE 13 under protanopia, deuteranopia and tritanopia, separated by value as well as hue.

## Gameplay: everything is said by the suns

| Event | What the world does |
|---|---|
| Lock | The braid ticks a notch (a hard drop further): every fan in the valley swings. Play winds the sundial. |
| Line clear (1–3) | The suns are drawn together for a breath and let go: the fans narrow toward one dark shadow and open again, deeper with more lines. |
| Four lines | The suns come together into one white sun: the colour leaves the world, every shadow is one black shadow; they hold, then part wide and the colour floods back. |
| Chain | The braid turns faster and opens wider (the fans fan out); ribbons of light braid between the suns in the sky. A break lets it ease back. |
| T-spin | The braid twists a third of a turn per spin-turn: the suns change places and every fan's colours turn. |
| Back-to-back | The ribbons between the suns brighten. |
| Perfect clear | Noon: the suns climb high, the shadows shrink to the towers' feet and the floor blazes white; then they sink back. |
| Level up | The braid winds on a sixth of a turn over a few seconds. The clock turns it as well (one turn every 330 s), so the light changes by itself at any level. |
| Game over | The suns set below the rim; their colours linger on the horizon as afterglow. A new run raises them. |

## Verification

(To be completed.)
