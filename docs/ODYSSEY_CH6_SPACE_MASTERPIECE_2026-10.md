# Odyssey chapter 6: a space masterpiece (2026-10-31)

Olov: *"how can we make chapter 6 less clutterly and more visually impressive? I want a more epic
visually experience in chapter 6."*, then *"Now start improving this chapter so it becomes a space
masterpiece experience. You can start working on all steps."* Along the way:
- *"I guess the black hole in the black hole theme looks like the gargantua in interstellar."*
- *"And remember, chapter 7 are 'inside' the black hole."*
- *"why do we need this neon line into the black hole, cant just the orb path go into the black
  hole???"*
- *"how can we make the galaxy more impressive? can we be inspired from the galaxy theme?"*
- *"The galaxy feels to much as a photo right now! We can do better so it feels like in the galaxy
  theme! and can we have it a bit more down to the left????"*

![Chapter 6 at p 0.81, 0.83, 0.845 and 0.862. Left: before. Right: after](images/odyssey-space-2026-10-31/ch6-before-after.jpg)

## 1. A sky, not a crowd (`CH6_AMBIENT`, cosmic-expanse.js)

From ~p 0.81, one frame held all of these at once, so nothing led and nothing was big:
- the black hole, the ringed giant and the galaxy;
- a lumpy violet gas field, drawn over the giant's lower half;
- a garland of twelve red rocks round the hole;
- near dust like falling snow, glitter in the disk's plane, and a comet.

The layers that only added noise are no longer built: the gas field (the dome's painted Milky Way
and nebulosity carry the colour), the rock garland, the near dust and the disk glitter. The far fine
dust stays for parallax, the streaks for the pull, and the comet. `?odysseyCh6Clutter=1` (or
`options.ambient`) builds them all again for a side by side. Tests that cover those layers build
with `CH6_AMBIENT_ALL`.

## 2. The black hole, traced (odyssey-gargantua-lens.tsl.js, odyssey-gargantua-gas.js)

The hole (chapter 6's omen and chapter 7's Gargantua) was painted from parts:
- a black sphere and a thin ring mesh;
- two torus arcs standing in for the disk's far side;
- a flat band for the disk.

Up close it read as a target of glowing hoops. It is now the Black Hole theme's hole, re-derived for
Odyssey (theme code is never imported): one material that traces every view ray through
Schwarzschild spacetime. The photon path x'' = -(3/2) h² x / |x|⁵ is stepped symplectically inside
a bounding sphere, with the closed-form bend outside it. Everything that makes Gargantua read comes
out of the bend:
- the far side of the disk arching over the shadow and tucked under it;
- the thin photon ring;
- the brighter approaching side (beaming);
- the glowing gas (a Gaussian sheet integrated in closed form along each step).

The disk is the theme's gas texture (re-baked in steps), sheared Keplerian and lit by a blackbody
ramp.

**What is different from the theme.** The theme's material is the whole sky; here the sky is
already drawn and the board's post lens bends it, so the lens draws only the hole's light, on a
sphere round it, premultiplied:
- **Escaping rays:** what is behind shows through what the gas leaves of it.
- **Rays that fall in:** the chapter's own black shadow sphere shows through what the near gas
  leaves, so chapter 7's window into the singularity (on that sphere) still opens.
- **One shadow edge:** Rs = shadow radius / (3√3/2), so the traced edge and the sphere are the
  same circle.
- **The disk's plane:** the disk pivot's, the pose the painted band had.
- **Its glowing gas:** at 0.55 of the theme's, so the haze does not wash past the disk.
- **The painted hole:** `?odysseyPaintedHole=1` builds it again.

**Chapter 7 is inside the hole.** The 6→7 hand-over changes nothing: both chapters use the same
lens round the same shadow, in the same pose. The lens marches from a sphere ~4.5 shadow radii out
and the eye must stay outside it, which it leaves at ~12.9° of hole. So on the dive (the glide from
orb 49 to 50), between 8.5° and 12° (`CH7_TRACED_HOLE`), the traced hole hands over to the painted
parts that carry the plunge:
- the photon ring on the silhouette;
- the band sweeping through edge-on, with its embers.

The window then opens onto the tunnel. Before the dive, the painted far-side arcs, the band and the
embers are hidden.

![The traced hole at p 0.845](images/odyssey-space-2026-10-31/traced-gargantua.jpg)

![The 6->7 hand-over (p 0.85-0.872), the dive's tunnel (0.88) and the fold (0.89-0.91)](images/odyssey-space-2026-10-31/handover-and-inside.jpg)

## 3. The orb path goes into the hole (odyssey-path-inflow.js, createPathInflowTSL)

Through chapter 6 the rail ends at chapter 7's first orb (the mouth), and the inflow carries it on
into the hole's centre. The inflow was a neon thread:
- a hot white core in a glow four times its width;
- heating to the disk's amber;
- flaring white at the photon ring.

It is drawn as the rail now:
- **Shape:** the ribbon's chapter-6 recipe, read across the strip as across a tube; the rail's own
  width (outerRadius 0.4, coreTail 1, thinning only with distance); a gentler curve (pitch
  0.42 → 0.15).
- **Colour:** an indigo body, the lavender line along its middle, the violet haze shell out to two
  radii, stardust riding in.
- **Blending:** blended over what is behind, like the rail, and swallowed into the dark toward the
  centre.

![The orb path from the mouth orb into the hole (p 0.866)](images/odyssey-space-2026-10-31/path-into-hole.jpg)

## 4. The galaxy, as the Galaxy theme draws one (odyssey-spiral-galaxy*.js)

It was one quad painted with a 2D spiral: thin rings of blue with pink dots. It is now the Galaxy
theme's galaxy, re-derived.

**The disc** (galaxy-disc.js in its thin-disc form) is shaded per view ray in the galaxy's own frame:
- **Old disc:** the warm light of the old stars.
- **Arms:** two logarithmic arms of young blue light, torn into clumps along their own spiral.
- **Nurseries:** pink knots on the arms' trailing edges.
- **Dust:** feathered lanes on their inner edges that take the blue first.
- **Bar and bulge:** the bar, and the bulge in closed form, split at the midplane so the lanes
  cross its near side.

It uses the theme's tileable four-channel noise, re-baked in steps with its own mip chain.

**The suns** (galaxy-stars.js) were added after *"feels too much as a photo"*:
- 12,000 on High (5,000 on Low), in the theme's four populations (arms, disc, bulge, halo);
- each one point of light, never under a pixel (what the clamp adds in area it pays back in light);
- twinkling, the old ones streaming round and brightening as they cross an arm (the density wave).

**Placement:**
- **Seat:** the disc faces +Z, so the chapter seats and turns it as it did the quad (the galaxy at
  infinity, `GALAXY_SKY_SEAT`).
- **Size:** 10° now, from 7°.
- **Position:** lower left of the frame (ndc ~(-0.53, 0.33) at 16:9, from ~(-0.5, 0.65)), inside
  the frame at 4:3 too.
- **Before the planetrise ends:** while the view leans over the Earth it may wait past the left
  edge; the framing test checks it from there on.

`?odysseyCh6PaintedGalaxy=1` builds the quad again.

![The galaxy: the painted quad (left) and the theme's disc (right)](images/odyssey-space-2026-10-31/galaxy-quad-vs-disc.jpg)

![The disc before (left) and after (right) its suns](images/odyssey-space-2026-10-31/galaxy-suns.jpg)

## Draw order in space

stars (-0.95) → galaxy disc (-0.9) and suns (-0.89) → the ringed giant (-0.8 / -0.75 / -0.7) → the
Earth's backdrop (-0.5) → everything at 0 and above (the orbs, the rail, the hole's lens).

## Tests

- **tests/unit/odyssey-space-masterpiece.test.js:**
  - the gas, the galaxy grain and the suns plan are seeded and in range;
  - the traced shadow is the chapter's own;
  - the lens, the galaxy disc and suns, and the inflow all build for WGSL and GLSL without a word.
- **The bisect levers and the environment tests:** the new default, with the old layers opt-in.
- **The framing test:** the galaxy's frame check now starts after the planetrise.

## Not done yet

- **One hero per stage:** the giant still hangs lower right all chapter.
- **The giant flyby:** tried 2026-11-01 and left out. A nearer seat (same rise, shrunk to the same
  angle) sank it out before the hole's light, but from chapter 5's eye it showed over the Earth's
  limb before its rise and came inside the Earth's near disc
  ([ODYSSEY_FINALE_AND_SMOOTHNESS_2026-11.md](ODYSSEY_FINALE_AND_SMOOTHNESS_2026-11.md) §5).
- ~~**The plunge's painted band** could take the traced gas's look.~~ Done 2026-11-01: the band is
  the traced disk's own gas, drawn flat (same doc, §4).
