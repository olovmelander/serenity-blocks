# Sunfall: the living doline (2026-11-17)

An audit of the whole theme and a pass on what it found, on branch `feature/sunfall-masterpiece`.
It builds on [SUNFALL_VISUAL_OVERHAUL_2026-10.md](SUNFALL_VISUAL_OVERHAUL_2026-10.md) (the
authored chamber, the canopy, the light in the air), which still describes how the world is made.

## The audit: what was weak

Judged from playground captures of the rest frame, the five sun stations, the four weathers and
every event, with and without the board (`effect=sunfall&t=40&level=1`).

- **The frame was murk.** Without the air the rock and the canopy were good; the haze, the
  valley mist and the cloud deck laid a grey-green veil over them. In false colour almost
  everything outside the column sat under 0.1 HDR. The vault was a khaki blur, the deck a band of
  horizontal smears across the middle of the frame.
- **The column was one frosted sheet.** The rim's vines blur out over 250 m of penumbra and the
  boughs leave the opening's middle clear, so its body was evenly lit: no shafts.
- **Nothing changed with time.** The five stations differed by a few degrees and a few percent of
  tint; the four weathers by numbers no one could see. No cloud ever crossed the sun.
- **Most events were invisible.** A lock was one small leaf on a wire-thin strand; a hard drop the
  same leaf; a clear changed nothing that showed; a twist turned a fringe no one could see; a
  broken chain's breath did not show. The four-line cataract fell *inside* the column, where the
  air's light is added over it: white on white, a few threads among the shafts, with a short flat
  band of bow at its foot. The combo narrowed the sunfall into fingers, so the hero light went
  *out* as a chain grew. A perfect clear widened the column a little.
- **The vines were wires** with a leaf every few metres.

## What changed

### The picture

- **Light.** The rock gets the chamber's own daylight (`SUNFALL_LIGHT.fill`, cool, from all
  round), more of the baked sky, a stronger pool bounce and column light that keeps to its side of
  the chamber: warm gold round the column against blue-green depth. The air is thinner and
  luminous (`airLight`), the valley mist lies in banks that drift over the crowns, the grade has
  more contrast, saturation and teal in the shade.
- **Shafts.** The sun mask carries a **dapple** in the oculus's plane (`sfMaskAt`): the rim
  forest's leaves and the thin cloud outside as one drifting fBm read, constant along the sun, so
  the column is combed into shafts that wander and the pool is dappled by the same pattern.
  Surfaces read it at the penumbra's LOD; the column's march reads it along each step with
  explicit anisotropic gradients (as it does the rim), so there is no grain.
- **The hanging garden.** Strands are braided, mossed stems with a tendril beside each, lit on
  the side turned toward the sunfall; they carry sprays of drip-tipped leaves with a midrib,
  veins and gloss, lit through when turned away from the column.

### Variation over time

- **Five hours** (the stations, by the clock and a level on top): rose-gold morning into
  blue-violet shade, white-gold noon into teal, soft white afternoon, silver-jade, deep amber.
- **Five weathers** (`SUNFALL_WEATHERS`, 48–88 s each, 14 s crossfades): *Clear Beam* (no deck,
  blades with dark lanes), *Chamber Mist* (the column a pillar, the far doline lost), *Rim Shower*
  (rain in the light, a silver sun, the deck half drawn), *Steam Hour* (vapour rising round the
  pool), *Cave Cloud* (the full deck, pearl banks lit from below). The deck hangs only as far as
  the weather says (`cloudOpacity` past 0.35).
- **A cumulus crosses the sun** every 64–108 s (`passCloud`): its shadow sweeps the opening as a
  soft band, the shafts go out from one side, the cave turns blue, and the light floods back.
- **On its own clock**: a strand lets a leaf go, a few white birds cross the light, the mist
  banks drift, the shafts wander.

### Every event its own effect

| Event | What shows |
|---|---|
| Piece lock | Four young leaves at the piece's rows on its side's strand, and one **blossom** of its pigment among them; a shoot flushes crowns in the pool. |
| Hard drop | The strand snaps and flings **beads of water** off it (drawn out by their fall); the same leaves and blossom. |
| Clear (1–3) | **Petals** let go at the cleared rows on both sides of the card, in the pigments of the pieces cleared; a blossom on a cleared row bursts; rain glitters in the light; leaves at the rows ripen. |
| Four lines | **The cataract**: white water from the rim's left, blazing where it leaves the rim and falling beside the column, silver against the dark wall; its spray boils up over the pool and carries the theme's one **double bow** as an arch across the free space; every blossom bursts. |
| Combo | **One more shaft of sun per link** through cracks in the vault (`SUNFALL_SHAFTS`: five in a fan right of the card, one at the left edge), each lighting its own patch of canopy. With the sunfall a chain of seven stands in seven shafts. The sunfall keeps all its light. |
| Chain breaks | The shafts close from the last opened back and the gathered mist is **breathed out** up the column in puffs. |
| Twist | **The Turning**: the dapple turns with the fringe, so the shafts wheel about the column, and leaves are wound up round it, flashing as they turn. |
| Back-to-back | Threads of water hang beside the cataract's place while the chain lives; the far doline's shaft swells. |
| Perfect clear | The sun at the zenith: the column widens and burns gold, all six shafts open, **petals of every pigment rain down the whole column**, the vines shed along their length, the pool flushes in seven colours. |
| Level up | The light walks to its next hour **under a passing cloud**, and white birds are lifted out of the canopy, spiralling up the light. |
| Game over | The deck closes over the oculus, the cave sinks to dusk, the vines let their leaves go. |

## How it is built

- `sunfall-flora.js` (new): **flora**, one instanced mesh of small blades (petal, bead, whirl,
  bird), each a record written once and moved in closed form from the clock; and **vapour**, soft
  puffs (steam, spray, a chain's breath). Both read the sun mask. Slots by tier
  (`floraSlots`, `vapourSlots`).
- `sunfall-strands.js`: the strands, leaves and blossoms (`blossomSlots`); `anchorAt(side, row)`
  tells the flora where a side's strand hangs at a board row.
- `sunfall-post.js`: the chain's shafts as closed-form Gaussian columns in one `Loop` over the
  live rows of `u.shaftRows` (idle slots cost nothing), each lighting what it lands on from the
  scene's depth; the cataract's spray and the bow as two closed-form Gaussians (`SUNFALL_SPRAY`).
- `sunfall-director.js`: the weather's new fields, the cloud's pass, `shaftOpen`, and `beats`
  (one-off moments with a serial: quad, twist, perfect, levelUp, release, over). A session's
  serial is now unique across directors.
- Playground: `weather=steam`, `cloud=<-1..1>` (a cloud's shadow placed over the opening).

## Traps

- **White on white.** Anything bright drawn inside a column the post integrates is lost in the
  glow added over it. The cataract alone (`parts=sky,cave,water`) was a brilliant fall; in the
  frame, threads. It hangs from the rim's left now, where the column leans away from it. Steam
  rises round the pool's rim for the same reason; leaves in the light flash rather than glow.
- **Counting by subtraction** dims the hero at the moment of reward: count with added shafts.
- **Tinted shafts dimmer than the hero** read as stage lights or timber: pale gold, a stain of
  pigment under 0.2.
- **Scaling a closed-form glow volume** with the weather made a neon blob at the foot: transient
  vapour is particles.
- Parallel shafts converge on screen toward the sun: place them by projecting foot and top.
- A world's per-session state keyed by a serial two directors can share is never reset by the
  second (found by a test).

## Verification

- **Playground** (private server, headless Chrome, `maxFps=30`; console clean on every capture):
  rest with and without the board, levels 1/4/5, the five weathers, `cloud=-0.45`, `locks=9`,
  `event=drop`, `event=clear&lines=3`, `event=quad` at 1.3 s and 3.2 s, `combo=3/5/7`,
  `event=release`, `event=twist`, `b2b=3`, `event=perfect`, `event=levelUp`, `event=over`, steam
  run live for 16 s, `quality=Low`, `quality=Minimal`, `forceWebGL=1`, 390 × 844.
- **In the game** (`/?skipIntro=1&unlockAll=1&themeValidation=1`, single player, WebGPU, High):
  seven real hard drops, then a clear, a chain, four lines, a twist, a perfect clear, a level,
  steam and game over through the theme's own director: all drawn, console clean.
- **Tests**: `tests/unit/sunfall-*.test.js` (99, with the new `sunfall-living.test.js`); the
  shader gate builds the flora, the vapour, the blossoms and the new air for WGSL and GLSL at
  High and Minimal, under the stage budgets.
- **GPU time** (playground `profile=1&trackTimestamp=1&maxFps=30`, 1920 × 1080, RTX 5080 Laptop,
  branch and `main` interleaved from two private servers, p50 at rest): Low 1.21 vs 1.05–1.21 ms,
  Medium 1.64–1.71 vs 1.42–1.58, High 2.13 vs 2.02–2.21, Ultra 2.06 vs 2.10. Other sessions were
  on the GPU (single runs swung to 5 ms on either arm), so these are the steadier runs. A chain's
  shafts and the spray add their arithmetic only while they stand.

## Open

- Portrait: the strands near the card fall behind it, so locks and clears show little there.
- The integrated GPU and phones are not measured (as before this pass).
- The theme's icon and `docs/theme-screenshots/sunfall.png` still show the old look.
- The vault away from the pool is still soft, mossy limestone without much form.
- Steam is modest; the whirl reads better in motion than in a still.
- The stations' sun directions are the five baked ones (a few degrees apart): the hours differ
  by colour and air, not by where the column stands.
