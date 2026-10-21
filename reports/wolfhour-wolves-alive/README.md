# Wolfhour: the wolves move like wolves

A second pass on Wolfhour's wolves, after [the moonlit night](../wolfhour-moonlit-night/README.md).
The first pass gave them a repertoire; this one makes every move read as an animal's: they turn
round instead of flipping, sit, lie and get up the way wolves do, and do more.

- [gpu-moments.jpg](gpu-moments.jpg): the real renderer (playground, WebGPU on the RTX, High, 16:9,
  zoom lens): the young wolf turning round through a look at you, the lead listening with a paw
  raised, the bow and the hind stretch, the sitter scratching, a howl the young wolf turns to the
  moon for, the scout's lookout (a sniff, a raised paw, a look at you with its head tilted, a
  glance back over its shoulder, turning round to go), the far wolf scratching.
- [turn-and-pounce.png](turn-and-pounce.png): CPU frames of the young wolf turning round to pace
  (frames 1-8), then its pounce: turn, stalk, spring, leap, dive, shake, turn, walk home.
- [postures-and-actions.png](postures-and-actions.png): CPU frames of the lead circling once and
  lying down, the sitter lying down (forepaws walking out) and scratching, the lead listening and
  looking back, the young wolf digging.

## What changed

- **A rig in three dimensions** (`wolfhour-wolf-rig.js`). The capsules are built with depth (near
  legs, ear and eye on the side facing you) and projected. `yaw` turns the whole wolf about its
  middle, so a wolf turns round through a view of its face (or back) instead of its quad flipping
  in one frame; `turn`/`headYaw`/`neckYaw` turn the head and part of the neck for real, `roll`
  tilts the head. The eyes glint on whichever side faces you. A turn of half a circle is the same
  wolf mirrored, so the facing swaps back to a plain mirror at the end without a seam.
- **Continuous posture.** `sit` (haunches) and `down` (forequarters) blend the three builds'
  joints, bone lengths and paw places bilinearly, and every leg is solved by the same IK at any
  blend (a sitting or lying leg is foreshortened because it splays to the side). A wolf sits down
  haunches first, gets up forequarters first, and lies down by walking its forepaws out, two steps
  each, the far paw after the near (`foreDown`, `foreLift`). The old capsule-by-capsule cross-fade
  is gone; the tail lays itself along the ground continuously too.
- **New limbs and actions** (`wolfhour-wolf-behaviour.js`): scratching (sitting, the near hind paw
  comes up in front of the chest to the jaw the head has lowered and tilted into it, three bursts
  of strokes), alert (ears up, a forepaw raised), look back over the shoulder, a curious head tilt
  in some looks, circling once on the spot before lying down, digging (forepaws scraping, snow
  thrown back between the legs, nose down the hole), the stretch after the bow (hind legs out
  behind), and a play spin. Lead: + alert, look back, circle, scratch. Sitter and far wolf: +
  scratch. Young wolf: + dig, look back, scratch; its slot is 11 s.
- **The scout's lookout** (`scoutLookout` in `wolfhour-wolves.js`): it slows into the lookout,
  looks over the valley, sniffs the snow, lifts a paw to listen, looks at you with a tilt one way
  and the other, glances back over its shoulder, turns round through a look at you, and trots off
  from a standstill. The pause is 12 s.
- **Walking.** Walks speed up and slow down (`glide`); while they do, the cadence holds and the
  stride shortens with the speed (`glidePace`), so planted paws stay planted and every walk starts
  and ends with the legs at rest. Turning on the spot steps in place.
- **Small life.** The wolves blink (`blinkAt`), each ear flicks on its own, and their breath smokes
  faintly in the cold as each breath goes out (pack, far wolf and scout; not under Reduce motion).
- **Gameplay.** A howl turns a wolf that faces away round to the moon and back as the note ends; a
  lying wolf sits up for it as before. A combo now makes the young wolf's own clock wait (as a howl
  does): whatever it was doing pauses while it bows and wags, then carries on. Overlapping waits
  merge, so its clock never runs backward.
- **Reduce motion** leaves the lively actions (pace, pounce, play, shake, stretch, rise, scratch,
  circle, dig) out when the action is drawn, so each slot's posture follows on from the last.

## Pops fixed

A scan of every capsule end over 15 minutes of play at 30 fps, with howls, glances and combos,
found frame-to-frame jumps; the ones the old code had too are fixed with the new ones:

- every turn (the quad's scale flipped from one frame to the next);
- the pounce's takeoff (the body pitched up 22 degrees and the head jumped 14 in one frame) and
  its landing (the body dropped 3.5 units); a 0.3 s spring now carries the stalk into the leap;
- the end of an excitement (the bow was switched off when the young wolf started to move);
- the idle sniff (it switched on mid-way when an idle slot began inside its window);
- the start and end of every walk and the scout's switch to a trot (the legs jumped into and out
  of the gait cycle).

What is left is motion that is fast by design (the leap, a turn into a howl, the play spin):
under 6.5 units a frame at 30 fps, under 3 with Reduce motion. A unit test pins both.

## Verification

- `wolfhour-wolves.test.js`: 46 tests (7 new: no frame-to-frame jumps with and without Reduce
  motion, turning round through a view of the face, posture order and forepaw steps, every new
  action and the scout's lookout, walks from and to a standstill, Reduce motion, blinking). All 9
  Wolfhour test files pass (143 tests). Typecheck and lint clean on the touched files.
- Playground captures, Electron 38 on the RTX 5080 (WebGPU), High and Low, 1600 x 900: 16
  captures, zero GPU validation errors, device losses or console errors. The wolf shader is
  unchanged (everything new is per-frame uniform values and vapour puffs).

## Harness

`harness/wolf-preview.mjs` poses the real pack (or a single rig) on the CPU and rasterises the
same smooth capsule union the shader draws, with the moon rim, into a contact sheet PNG, in about a
second, with no GPU: the fast loop for animation work. Run it from the repository root:
`node reports/wolfhour-wolves-alive/harness/wolf-preview.mjs <spec.json> <out.png>` (the
`*.json` files here are the specs of the two CPU sheets). GPU captures use
`../wolfhour-moonlit-night/harness/cap.sh` with the zoom lens (`zoom`, `zoomX`, `zoomY`: the
window's centre in world units; the pack is near the camera + (612, -176), the scout's lookout
near + (530, -330), the far wolf near + (-770, -182)). `harness/sheet.mjs` (Electron) crops and
labels captures into a JPEG contact sheet (`gpu-moments.json`).
