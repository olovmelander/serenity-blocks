# Stillwater — the troll and the spirit

> 2026-10-23: how the two look (a look held a while; a quick run watched as one place), their own life between the moments play gives them, their gestures, and a story that grows across the night are in `docs/STILLWATER_FIGURES_LIFE_2026-10.md`. The figures, the story's beats, the heart's flight and the path of light below still stand; the "Idle glances" of this record are now one of the things each of them may look at, chosen with the rest.

Implemented 2026-10-18 on `feature/stillwater-story`, on top of the tarn rebuilt on 2026-10-09
(`docs/STILLWATER_VISUAL_OVERHAUL_2026-10.md`, whose place, water, wood, hours and event language
stand). This pass rebuilt the two figures and gave them a story. It supersedes that record's
sections on the figures (the lathe spirit, the troll's walk clip and his lantern on a staff carried
at the shoulder).

What the author asked for: better-looking figures; animations and an interaction between them that
tell a story with some depth; movement that is natural instead of "hacky and wacky"; a theme that is
mystical, with a spiritual atmosphere.

![The story, start to end (the game camera; the board is a DOM overlay and not in these frames)](stillwater-story/story.jpg)

## What was wrong

- **The troll** was a TRELLIS reconstruction whose pelt is a soup of thin triangle shards. It drew
  as torn paper and flickered as he moved. His rig was thirteen bones weighted by distance, with one
  `Walk` clip played by the ground covered: the legs stretched like rubber, standing still snapped
  him back into the sculpt's pose, and the staff was fixed in model space, not to his hand.
- **The spirit** was a lathe silhouette with no limbs. She slid along a curve, rings were dropped
  at "footfalls" she did not have, and her gown and hair were moved by a single trailing vector.
- **Behaviour** followed the combo number directly. In this game every clear reports a combo of
  at least 1, so the two lurched toward each other at every clear and back at the next lock, and
  nothing happened between them.

![The troll's sculpt as it shipped (left: the shard pelt) and rebuilt (right: one solid surface; green = pelt, pink = skin)](stillwater-story/troll-rebuild.jpg)

## The story

Long ago the princess dropped her gold heart into the tarn, and she has stayed, a pale spirit on
her stone, looking down into the water for it. The old troll of the wood keeps a lantern lit on the
far bank. They have never crossed the water.

| Gameplay | What the two do |
| --- | --- |
| At rest | She kneels on the water off her stone, her gown pooled round her, trailing her fingertips in it (a ring now and then), looking down for her heart. He sits on his stone with his staff planted beside him, the lantern hanging at his side; fireflies circle it; after a long calm he nods off. Now and then one looks across; sometimes the other is looking back, and both lights warm a little. |
| Lock | The light falls; the one on that side follows it down. A hard drop turns them both, and wakes him with a start. Falling pieces do not call her up from the water. |
| Clear | Both look out to where the swells come from. The lights gathered home go to her hands (she lifts them, cupped) and to his lantern (he lifts it). A single clear is not a chain: nobody leaves their place for it. |
| Chain | Two clears in a row get him up off his stone (he leans in, pushes up, straightens) and her up off the water, drifting out. Three walk him down to the water's edge; five into the shallows, his steps ringing the water. She drifts out over the tarn toward him, gown and hair trailing, a soft wake behind her. From four he holds his lantern out to her and she holds out her hand; light runs out on the water from each toward the other and motes drift between them. |
| Four lines | The night holds its breath; the heart wakes gold on the bed. If he is at the water he crouches and lays his lantern out over it; the heart rises out of the tarn, crests, crosses to her, and she takes it to her breast and blazes. He lifts his lantern high. |
| Chain breaks | They do not turn at once: they hold each other's eyes a while (2.6 s). Then he trudges home slower, bowed, carrying his lantern up where she can see it; she drifts back to her stone looking over her shoulder at him. A chain that breaks and begins again holds them in that look, then settles them where the new chain has them; a growing chain never sends them back. |
| Level up | Both look up at the turning sky. |
| Game over | They go home at once, without the long look. |

![In the game: at rest, a chain, four lines, the parting](stillwater-story/ingame.jpg)

## How it moves

No clips. Both figures are posed every frame from what they mean to do (`stillwater-story.js`
decides, in the stage's coordinates; the world converts to true metres; the bodies carry it out):

- **The troll** (`stillwater-troll-body.js`): feet planted where they landed; a step is taken only
  when a foot has fallen behind where it should be (walking, turning, shifting his weight), one foot
  at a time, heel first off and last down, landing on the real ground (`groundHeight`); legs solved
  onto the feet by a two-bone IK with the knees forward and a little out; hips carried by the legs
  (rising as a leg passes under, sinking as a foot lands, rolling over the bearing leg); the head
  leads a look, the neck and chest follow; acts (sit down, stand up, crouch, rise) are short
  timelines that lean in first and can be turned back halfway, eased so a reversal does not jump;
  breath slower seated and deeper after a walk; standing still he rests on one leg, then the other.
  The staff is placed first, like a third foot that steps with his right foot, and his left hand
  takes it; held, it raises the lantern, holds it out, lays it out over the water, or carries it up
  on the way home. The lantern hangs from the crook on a cord as a damped pendulum.
- **The spirit** (`stillwater-spirit-body.js`): she drifts on a slow spring and leans into the way
  she goes; her gown's four panels (skirt bones) trail her motion, stir in the air and spread on the
  water when she kneels; her two hair links always hang with the weight of hair and stream behind
  her; her hands are placed by a two-bone IK for what she does with them (folded, cupped, held out,
  open wide, crossed on her breast, trailing in the water); a soft S of a stance that shifts hips now
  and then; breath; a look the head leads.
- Springs are critically damped and stepped in closed form (`stillwater-motion.js`), so a long frame
  never overshoots and a replay at another step lands on the same pose. Everything is a function of
  the clock and the events: `seek(t)` plus the fixed-step replay reproduces any frame.

![His walk, 0.15 s a frame: planted feet, bending knees, the staff and the swinging lantern](stillwater-story/gait.jpg)

## The figures

- **Troll** (`assets/troll-lod0..3.glb`, `scripts/blender/stillwater/troll_shape.py` and
  `troll.py`): redrawn clean from numbers in the character of the author's sculpt (see "The troll,
  redrawn" below); four LODs (32,000 / 17,000 / 9,700 / 3,700 triangles), the same 21-bone skeleton,
  baked occlusion. He is coloured as a troll of the wood (`TROLL_LOOKS`, default `forest`) in a few
  big masses: moss for his mane, beard and brows (each lock its own shade), an earthen hide, a ruddy
  face, a dark leather loincloth, small mushrooms in his moss that glow and wake with the chain as
  the ones on the banks do. His own lantern's light on him is whitened toward a neutral white so
  those masses stay apart; a moonlit edge finds his outline; his eyes catch the lantern and the moon.
- **Spirit** (`assets/spirit-lod0..1.glb`, `scripts/blender/stillwater/spirit.py`): built from
  numbers: a slender body, a gown with a train, bell sleeves, gold hair to her knees, a circlet; 19
  bones; 11,166 / 5,582 triangles. Lit from within (brightest at the breast), thin cloth glowing
  edge-on, gold hair with a sheen, her hem dissolving into the mist on the water; a halo and motes of
  light rising round her.
- Both files are compact (quantised, no clips; the skeleton rides in the extras) and are written by
  `scripts/blender/stillwater_assets.py`; provenance in `src/themes/stillwater/assets/ATTRIBUTION.md`.

![The troll: seated, getting up, holding his lantern out, crouched to the water for the heart](stillwater-story/troll.jpg)

![The spirit: her hand held out, the heart crossing to her, the heart taken, kneeling on the water](stillwater-story/spirit.jpg)

![The spirit as built in Blender](stillwater-story/spirit-build.jpg)

### The troll, redrawn (second pass, the same day)

The author's answer to the first pass: "Can we improve the design on the troll more? It feels a
bit messy!" It did: his body was still the reconstruction's surface, and its pelt, however
thickened and remeshed, read as torn sheets with pale ragged edges, white flecks of noise over the
moss, and a face that ran into one lump with his head.

He is now drawn from numbers, keeping the sculpt's character: a stocky old troll, his head carried
low and forward, a long drooping nose under a heavy brow, long ears held out to the sides, big
hands and feet, a hunched back under a mane to his knees.

- **One signed distance field** (`troll_shape.py`): smooth masses blended into one another (Quilez
  round cones and ellipsoids joined by smooth minimum) laid along the skeleton's rest pose, so the
  bodies pose him as before; eye sockets and nostrils taken out; eyes under heavy, sleepy lids; a
  bark-cloth wrap round his hips with a rope belt; flat soles.
- **The mane is draped**, not placed: each lock falls from its root under gravity, is pushed out of
  his body (and the locks before it), drawn back toward him and flared a little at the hem. A mantle
  falls from a yoke round the base of his neck down his back (his shoulders and arms are left free:
  a mantle over the shoulders read as a slab once he moved); the crown's locks flow from his head
  over it; a moss beard falls on his chest; two bushy moss brows are drawn over his eyes. The locks
  are many and thin and fused into one matted mass with grooves, not separate tubes.
- **A few mushrooms** grow in his moss on his shoulders and back. They replace the noise "caps" of
  the first pass.
- The field is meshed once with OpenVDB (bundled with Blender 4.5) at 0.003 of his height; only the
  outer shell is kept (pockets sealed between the mantle and his back mesh as small inside-out
  shells, which after decimation carried zero-length normals). Every vertex is told what it is by
  its nearest primitive and packs it into its colour: r = 1 his face, 0.65 his hide, 0.2 an eye;
  b = moss; a = the lock's own shade (0..0.6), 0.7 an eye, 1 a mushroom; g = baked occlusion.
- Weights: bone heat for the body; the beard and brows on his head; the crown's locks from his head
  down his torso; the mantle by height down his torso, its outer locks partly on his collarbones.
- The shader lost its noise: no lichen flecks, no noise caps, the strand relief a quarter of what it
  was. The shapes carry the detail.

![Before (left two: the reconstruction's surface) and after (right two), the same cameras](stillwater-story/troll-redrawn.jpg)

![The design in Blender: clay and colour, front, three-quarter, the game's angle, behind](stillwater-story/troll-design.jpg)

![In play: High on WebGPU, and Minimal on the WebGL2 backend (the 3,700-triangle file)](stillwater-story/troll-in-play.jpg)

## Atmosphere

- The heart's flight (`createHeartOrb`, uniform `orbAt`): a bead of gold with a halo and slow rays,
  lighting the night as it goes and laying its own long reflection on the water.
- The path of light (uniforms `path`, `pathEnds`, drawn by the water): while a chain holds them near,
  a glittering band runs out on the water from each of them, her pale light from her side, his
  lantern's from his, flowing toward the middle; and motes drift from her breast and his lantern
  toward each other behind the board.
- A meeting of eyes (`story.gaze`): both lights warm a little.
- Fireflies: about one in eight circles the troll's lantern, wherever he carries it.
- Her hem leaves a soft wake as she drifts; his steps in the water ring it; her fingertips ring it.

## Tiers

Every tier keeps both figures and the whole story. The troll's LOD follows `troll` (3 on Minimal
and Low, 2 Medium, 1 High, 0 Ultra/Extreme); the spirit's `spirit` (1 on Minimal and Low, else 0);
her motes `motes` (0, 16, 20, 32, 40, 40).

![Minimal, Low, Medium, Ultra (WebGPU), High and Minimal on the WebGL2 backend](stillwater-story/tiers.jpg)

## Icon

Re-captured: the gold heart crossing the water to her as she opens her arms (512 x 512, a full-bleed
circle on a transparent ground; both copies replaced).

![The icon at picker size](stillwater-story/icon-at-picker-size.png)

## Verification

- **Unit tests:** the Stillwater suite is 482 tests in 16 files, all passing. New: motion 17, rig 15,
  troll body 18, spirit body 15, story 24; reworked: the world 85 (its loader mock now parses the real
  figure files), the figures' assets 21 (all six LODs: bands, skeleton, joints, weights), core,
  meshes, quality, playground. They were written by a helper that was not allowed to touch the source
  and pinned what it found with `it.fails`; all thirteen pins were real faults and are fixed (among
  them: the troll's knees and elbows never bent, because both turns of a limb shared one scratch
  quaternion; a reset kept his walk; on narrow frames the story mixed the stage's coordinates with
  the world's, so he never arrived home and the heart landed 1.6 m short; a chain that broke and began
  again pulled the bond the wrong way; her float hopped; the lantern's cord stretched; two pairs of
  blended draws shared a render order). The pins are now plain tests.
- **Static gates** on the worktree: typecheck, ts-ratchet, the lint ratchet (575 against a baseline of
  599; the baseline is not changed here), architecture fitness, the theme lifecycle audit,
  boundaries, the palette screen, perf budgets; the production build with its boot-closure guard,
  ip-strings, pages-artifact, release-gates. ESLint: 0 errors in the theme, the playground effect and
  the Stillwater tests.
- **Playground on the RTX 3070 (Electron, WebGPU)** and on the WebGL2 backend: every tier, a tall
  frame with and without the board, reduced motion, close-ups of both figures in every act, strips of
  consecutive frames (the gait at 0.15 s, the sit-down, the whole story); consoles clean. A
  `story=` parameter (events at absolute times, replayed from 0 for every frame) makes such strips
  one continuous story.
- **The real game** (dev server, scratch Electron harness, `unlockAll=1`), at High on WebGPU: real
  hard drops from the keyboard, clears, a chain, four lines, a break and a level through the app's
  own event bus, a live tier change, leaving the theme (no canvas left behind). Both figures load;
  the story's states follow (seated / kneeling at rest, the bank on a chain, the crouch for the heart,
  home after the break). About 130 frames a second (this machine's display cadence): an observation
  on a shared machine, not a measurement.
- **Node probes** of the troll's body through a scripted night: planted feet slide 0.00000 m; no NaN.
- **The redrawn troll:** the Stillwater suite again (482 tests, among them the figure files byte by
  byte, the rig's widening with unit normals and whole weights, and the world loading the real files);
  review sheets rendered in Blender (Cycles, CPU) for every design round; on the RTX 3070 (WebGPU):
  seated, getting up, holding his lantern out, crouched for the heart, walking (a strip at 0.15 s a
  frame), sitting down (a strip), High and Ultra close-ups, the wide frame with the board; Minimal on
  the WebGL2 backend; consoles clean.

### Not verified, and what is open

- No ADR-0016 perf-lane reading; nothing on an integrated GPU or a real phone.
- On an upright phone frame with the board up, the board hides the spirit (as it hid her before).
- The redrawn troll's design (the face, the mane's cut, the mushrooms, the colours) is my reading of
  "messy", not reviewed by the author yet. From straight behind, his head's hair and the mantle
  still read as two masses (hair over a shawl); the game never shows him from there.
- The spirit's face is a quiet egg with a nose and brow; it is never more than a few pixels in play.
- Multiplayer and Odyssey layouts were not captured with the new figures.
- The paces, the story's timings (the 2.6 s parting, 6 s before he sits, 9 s before she kneels),
  the palettes of the figures and the icon are choices made here.
