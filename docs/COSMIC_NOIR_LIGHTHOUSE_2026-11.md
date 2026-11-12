# Cosmic Noir — the last lighthouse (2026-11)

Status: **Reference** (design and evidence of the 2026-11-12 pass; branch
`feature/cosmic-noir-lighthouse`, **not merged**). It replaces the picture of
[COSMIC_NOIR_VISUAL_OVERHAUL_2026-10.md](COSMIC_NOIR_VISUAL_OVERHAUL_2026-10.md) and keeps that
build's film (the stocks, the grade, the flashbulb, the reel change), its event rules, its director,
its composition module and its adapter. Sections 4 to 6 of the October document still describe
those parts.

Evidence: [reports/cosmic-noir-lighthouse/](../reports/cosmic-noir-lighthouse/) (listed in §7).

## 1. The ask and what changed

Olov, 2026-11-12: "visually make the theme Cosmic Noir the most impressive and visually stunning
theme in this game", with the design left to the build.

The October picture was a striped drum hanging in soft smoke, and half the frame was empty stars
(`before-2026-10-lantern.jpg`). Its idea was sound: a lighthouse in the dark, light through blinds.
This pass keeps the idea and gives it a world.

**The new picture: the last lighthouse.** A lighthouse stands on a shard of rock in a sea of
interstellar smoke, at the edge of the dark. The home galaxy rises over the sea's horizon, and
another light flashes far out under it. A captive pulsar turns in the lantern room behind a ring of
shutter slats. One beam rakes the sea, its opposite searches the sky, and the lamp's own light
leaves between the slats as a fan of shafts. It is still a black-and-white print on one film stock
at a time.

| | October | Now |
| --- | --- | --- |
| Subject | A slatted drum in open smoke | A lighthouse on a rock: banded tower, gallery, lantern room, dome, a lit window |
| Ground | None | A sea of smoke to the horizon, lit by the beam and the slats' shadows |
| Sky | Hashed stars | Few stars, a deep field, a tipped spiral galaxy, a far lighthouse on the horizon |
| Smoke | A 30-step march at reduced resolution | The sea found per pixel at full resolution; the light in the air in closed form |
| Lock | A white puff at the card's edge | An ember under the sea beside the card, a puff, ripples |
| Clear | Shells that lit the smoke as discs | A ring of light over the sea to the horizon, a ring in the air, a flash down the tower |

## 2. The picture

**The stage** (`cosmic-noir-core.js`). Units are scene units, y up, the eye at the origin.
- The lighthouse's axis is the vertical through (0, ·, −24). Its lamp is `PULSAR.height` = 8.4 above
  the eye. `TOWER` holds the lighthouse's own measures.
- The sea's mean surface is `SEA.level` = −2.6. It never reaches the eye, at any heave (tested).
- `lampPose()` turns and tilts a level camera so the lamp lands exactly on `pulsarAnchor()`: left of
  the card on a landscape screen (x 0.2, y 0.265 at 16:9), above the board on an upright phone.
  With no roll the sea's horizon is a level line, at about two thirds of the way down a 16:9 frame.
- The galaxy stands 59° right of the lighthouse and 12.6° up (`GALAXY`), which puts its core in the
  free zone right of the solo HUD. The far light (`FAR_LAMP`) is under it on the horizon.

**The light** (`PULSAR`, `CAGE`). The beams leave 54° from the upright axis, so one looks 36° down
and meets the sea about 15 units from the rock, and its opposite looks 36° up. The eye is 19° below
the lamp, so the lower beam passes about 17° from the lens once a turn (14 s at rest). The world
closes the iris for that pass, at rest too. The lantern room lets the lamp's own light out between
20 slats, in a band of about ±43° of elevation; the roof and the gallery shadow the rest.

**What makes it read as noir**: most of the frame stays black. The lamp's glow in the air falls
off within a few units (`AIR_REACH`), the air right at the lens is clear, and the sea shows by the
beam, the slats' spokes, the galaxy's faint light and events.

## 3. Drawing it

Two passes a frame, as before, with the work divided differently.

**The backdrop** (`cosmic-noir-volume.js`, one full-screen triangle at the screen's resolution):
1. **The lighthouse and its rock** (`cosmic-noir-lighthouse.js`). One distance field, a laid-out
   shader function, walked only inside an upright cylinder and a ball. The rock is six lumps, each
   the meeting of planes laid on an ellipsoid, in a space bent by two sines so no face is flat.
   The tower is lit as a silhouette: the lamp lights what looks at it from outside the lantern's
   shadow, the galaxy is the key light from behind, an echo flashes down it. Edges are anti-aliased
   by how near the ray came, in pixels.
2. **The sea of smoke** (`cosmic-noir-sea.js`). A surface, not a volume.
   - One baked, tileable half-float field (`bakeSeaField`: height, its own slope, a calm share, with
     a CPU mip chain) read as three layers drawn out along the wind: swells, billows, wisps.
   - A view ray finds it with steps as long as its clearance allows, then a secant. Far out the
     swells sink into a level sea.
   - On the way the walk sums the **fringe**: loose smoke lying on the surface, thicker where the
     sea is heaped. A ray that only grazes a crest takes some of its light, which is what stops
     the sea reading as dunes.
   - It is lit softly: the lamp through the slats (wide wrap, no hard terminator), a swell's
     shadow from a few reads toward the lamp, crests that glow through when they stand between
     the eye and the lamp, the galaxy, and the smoke's own streaks.
3. **The sky** (`cosmic-noir-sky.js`): three lattices of stars, a deep field of spindle galaxies,
   the galaxy (a logarithmic spiral with clouds, knots and near-side dust lanes), the far light.
4. The glow inside the lantern, the air's target over it all, and the lens (halo, star-filter
   spikes, glare).

**The air** (a reduced-resolution target, `scale` of the drawing buffer). Nearly all closed form:
- **The lamp's own light.** Seen from the lamp, the points of a view ray sweep one arc of
  directions, and the light scattered per unit of arc is the lamp's over the ray's nearest
  distance. The arc is cut into `air` spans. Across each span the slats' share of the wall is taken
  exactly (`cnSlatShare`), so the shafts have no grain.
- **The beams' cores**, where the ray passes nearest the beam's line (kept from October).
- **An echo's ring**: a shell of gaussian thickness, with what a ray through its middle would add
  taken off, so it is a ring and not a bubble.
- **The mist on the sea**: an exponential layer, lit where the ray comes down. It is kept in its
  own channel, because the lighthouse and the rock stand in front of it.
- **Puffs** as gaussians along the ray, and **smoke past the lens** as a few fixed shells.

The target's channels are (air light, mist light, how much of the sea the mist hides, what the air
lets through). There is no compute and no MRT. The WebGL2 backend draws the same picture.

### Traps found

- **A rock of random planes is not closed.** Ten random half-spaces left whole directions open, and
  the "rock" filled a quarter of the frame. The flanks now go all the way round.
- **The beam's skirt greyed the whole frame.** Per unit of arc the skirt outweighs the lamp's own
  light many times at range. The air shows 30 % of it (`SKIRT_AIR`).
- **A black needle up the frame over the roof.** A ray in the upright plane through the lantern's
  axis looks along one slat's shadow for its whole length. Within 1.5 units of that plane the slats
  are taken at their average.
- **Horizontal lines across the sea.** A shell of near smoke was dropped whole where the ray's end
  came nearer than it. Each shell now thins out toward the ray's end.
- **The rock as a ghost.** The mist's light was added over the rock. See the mist's own channel.
- **An echo as a glass bubble**, again. See the ring above.
- **A jittered six-step walk shows its jitter.** The near smoke is fixed shells instead.

## 4. Event language

Rules, queueing, accumulation and the heat of play are October's (`cosmic-noir-world.js`). What is
drawn changed:

| Event | Response |
| --- | --- |
| Lock | The piece goes under the sea beside the card (left half of the board to the left, right half to the right; a low lock lands near the eye, a high one further out). An ember glows up through the smoke, a puff rises off it and drifts away, and ripples run out. |
| Clear | The lamp flares. Per line, a ring of light runs out over the sea from the rock, under the eye and on to the horizon (`echoSeaRadius`), a ring goes out in the air, and the shell flashes down the tower and the rock. |
| Chain | The lighthouse spins up and the blinds open (unchanged). |
| Four lines | The flashbulb (unchanged), and the far lighthouse answers 0.9 s later. |
| Perfect clear | The crown (unchanged), and the far light answers. |
| T-spin | The slats spin: their shadows wheel over the sea. |
| Level up | The reel change (unchanged). |
| Heat | As before, and the sea runs faster before the wind and heaves higher. |

The far light keeps its own character: two flashes every 11 s. Under reduced motion it is held
steady.

## 5. Tiers

| Tier | Sea steps | Shadow taps | Wisps and ripples | Tower steps | Air arcs | Near smoke | Galaxy detail | Sea field |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Minimal | 20 | — | — | 40 | 8 | — | — | 128² |
| Low | 28 | 4 | — | 48 | 10 | — | — | 128² |
| Medium | 40 | 6 | yes | 56 | 12 | 4 | yes | 256² |
| High | 52 | 8 | yes | 64 | 14 | 6 | yes | 256² |
| Ultra | 64 | 10 | yes | 72 | 16 | 6 | yes | 256² |
| Extreme | 76 | 12 | yes | 80 | 18 | 8 | yes | 256² |

Every tier keeps the whole picture and every event (`minimal-playground.jpg`).

## 6. Validation

**Playground** (`?effect=cosmic-noir`, sheets from `window.__cosmicNoir.sheet()`, WebGPU on the RTX
5080 laptop, 30 fps cap):
- `sweep-high-playground.jpg`: one turn of the beam and the stocks at 112 s and 212 s.
- `events-playground.jpg`: every event.
- `minimal-playground.jpg`, `webgl2-playground.jpg` (`forceWebGL=1`, High). No console messages on
  either backend.
- An upright 430 × 900 window was looked at once: the lantern stands over the board and the sea
  shows round it. The galaxy is outside that lens.

**The real game** (the dev server in the MCP browser, single player, High, WebGPU):
- `ingame-play-high.jpg`: after five real hard drops through the keyboard (`counts.locks` rose with
  them, so the director reaches the world).
- `ingame-clear3-high.jpg`: a three-line clear fired on the theme's world (`world.onClear`), not
  played.
- Not done in the game: a played clear or four lines, a level-up, versus, Infinity, a quality
  change while it runs, a lost GPU device.

**Tests** (`tests/unit/cosmic-noir-*.test.js`, 167 tests in 7 files, all passing):
- New `cosmic-noir-shaders.test.js`: both shaders through three's WGSL and GLSL builders at High,
  Low and Minimal, gated for warnings, unassigned reads, undeclared bindings, size, and that the
  distance field is one function.
- New in the core, world and bake suites: the camera pose, the horizon, where a lock lands, the
  echo's two radii, the far light, the sea's clock and heave, the sea bake.
- Gates run: `tsc`, the lint, TypeScript and architecture ratchets, `depcruise`, the theme
  lifecycle audit, the IP string gate (without `dist/`).

**Cost.** Measured only at the 30 fps cap, so treat it as an order of magnitude. Playground,
`demo=1`, High, a 2001 × 1125 buffer, GPU timestamps, 7 or 8 samples a round:

| | GPU p50 per round (ms) | CPU p50 (ms) |
| --- | --- | --- |
| October (main, served beside it) | 1.84, 1.44, 1.44 | 0.7 |
| Now | 1.64, 1.77, 1.84, 1.64 | 0.6 |

About the same. The backdrop's fragment is 58 KiB of WGSL at High and the air's 21 KiB. Not
measured: an uncapped frame rate, the fleet bench, an integrated GPU, a phone, how long the two
pipelines take to compile on a first visit.

## 7. Files

`src/themes/cosmic-noir/`:
- new: `cosmic-noir-sea.js`, `cosmic-noir-lighthouse.js`, `cosmic-noir-sky.js`;
- rewritten: `cosmic-noir-volume.js` (the air and the backdrop's assembly), `cosmic-noir-tsl.js`;
- extended: `cosmic-noir-core.js` (`TOWER`, `SEA`, `GALAXY`, `FAR_LAMP`, `lampPose`,
  `echoSeaRadius`, `farLampAt`), `cosmic-noir-bake.js` and its worker (`bakeSeaField`),
  `cosmic-noir-quality.js`, `cosmic-noir-world.js` (the camera, where locks land, the sea's clock,
  the far light);
- unchanged: the post, the director, the composition, the adapter's logic.

`?cosmicNoirParts` and the playground's `parts` now take `sky`, `smoke`, `sea`, `tower`.

**Icon.** Re-baked: `?effect=cosmic-noir&t=41.2&icon=1&iconFov=37&quality=Extreme&grain=0` in a
720 × 720 window (the lens now looks 3 units below the lamp), centre square at 92 % dropped 3 %,
luminance only, black point 0.05, gamma 1.35, gain 1.75, a disc. `icon-at-230-and-88px.png`. It
supersedes the October icon recipe.

## 8. Open

- Olov has not seen it. The calls that are his: the lighthouse itself, the sea in place of open
  smoke, the galaxy's size and place, the far light, the new icon.
- The checks listed as not done in §6.
- The phone lens shows no galaxy.
- The rock's silhouette is still plainly faceted where the flash lights it.
