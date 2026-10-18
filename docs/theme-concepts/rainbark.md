# Rainbark: theme concept reference (the winner)

| Field | Value |
|---|---|
| Name | **Rainbark** |
| Id | `rainbark` (registry group `biomes`, listed in `HEAVY_GPU_THEME_IDS`) |
| Logline | A cathedral of colossal painted giants rising out of a floor of luminous mist, in blue air. Their bark ripens through every colour of the spectrum and peels away in the sun. Every piece you set peels the grove, every line you clear makes it shed, and every chain opens the canopy one pool of sunlight at a time. |
| Status | **Built: Rainbark has replaced Cosmic Chimes.** The first pass (branch `ccr-b2364ce7-64kjge`, merged as `589ee199`) built the environment; the second, the visual overhaul of 2026-10-13 (branch `feature/rainbark-masterpiece`), drew every gameplay beat, the ambient life and the light wheel, and reworked the environment over nine rounds of an independent critic. **The record is [`docs/RAINBARK_VISUAL_OVERHAUL_2026-10.md`](../RAINBARK_VISUAL_OVERHAUL_2026-10.md)**; the first pass's state, architecture and deviations are in [`docs/RAINBARK_HANDOVER_2026-10.md`](../RAINBARK_HANDOVER_2026-10.md). Both, and the code, win over this file (including the stale "Build status" note under §7.1 and the "A2 build" notes). |
| Source | Design competition held on 2026-10-11 to replace the theme `cosmic-chimes`. Six concepts were scored by three judges (art director, rendering lead, gameplay-feel designer), 0–10 on each lens. Rainbark was entered as the **"wildcard"** seed: the proposer could pick any subject. |
| Scores | Art director **8.0** (2nd of 6) · Rendering lead **8.5** (1st of 6) · Gameplay feel **8.4** (2nd of 6) · **Total 24.9 / 30: rank 1 of 6** |
| Authoritative record | [`docs/RAINBARK_VISUAL_OVERHAUL_2026-10.md`](../RAINBARK_VISUAL_OVERHAUL_2026-10.md), the code under `src/themes/rainbark/`, and `src/playground/effects/rainbark.effect.js`. They win over this file wherever the two disagree. |
| Date | Spec written 2026-10-11 against `main` at `5d3478d`; this document 2026-10-12 |

**The six concepts and their totals**

| Rank | Concept | Art | Tech | Play | Total /30 | Build document |
|---|---|---|---|---|---|---|
| **1** | **Rainbark (being built)** | **8.0** | **8.5** | **8.4** | **24.9** | this file |
| 2 | Iris Springs | 7.5 | 6.5 | 8.6 | 22.6 | `docs/theme-concepts/iris-springs.md` |
| 3 | Painted Ages | 7.0 | 8.0 | 7.5 | 22.5 | `docs/theme-concepts/painted-ages.md` |
| 4 | Riverbloom | 6.0 | 6.0 | 8.0 | 20.0 | `docs/theme-concepts/riverbloom.md` |
| 5 | Haft Rang | 8.5 | 4.5 | 6.9 | 19.9 | `docs/theme-concepts/haft-rang.md` |
| 6 | Sunfall | 6.5 | 5.5 | 7.2 | 19.2 | `docs/theme-concepts/sunfall.md` |

> **How to use this file**
>
> 1. **Working on Rainbark?** It is built: the environment, the ambient life, the light wheel and
>    every gameplay beat. Start from
>    [`docs/RAINBARK_VISUAL_OVERHAUL_2026-10.md`](../RAINBARK_VISUAL_OVERHAUL_2026-10.md) (what is
>    drawn, how it is built, how it was verified, what the last critic left as polish), then
>    [`docs/RAINBARK_HANDOVER_2026-10.md`](../RAINBARK_HANDOVER_2026-10.md) for the first pass's
>    architecture and its §4 deviations (the code and both records win, also over the stale "Build
>    status at the time of writing" note under §7.1).
> 2. **Rebuilding Rainbark from scratch in a fresh clone?** Start a new Claude Code session with
>    the short prompt in `docs/theme-concepts/README.md` ("Start here") or the long one in
>    `docs/theme-concepts/PLAYBOOK.md` §8, filled in with this file's path. Read PLAYBOOK.md
>    first. It holds the steps every concept shares:
>    - §1 **"Choosing a slot"** (which existing theme the new one replaces, or whether it is added
>      alongside);
>    - §2 the module split and the lifecycle contract (detail in
>      `docs/theme-concepts/reference/adapter.md`, recipe in its §6);
>    - §3 the staged build order and §4 the rename and retire checklist (detail in
>      `docs/theme-concepts/reference/rename.md`);
>    - §5 visual verification in a cloud container (the headless Chromium + SwiftShader capture
>      scripts, printed in full);
>    - §6 the gates and commands, and §7 the house rules, gotcha digest and pitfalls.
>
>    Rainbark took Cosmic Chimes' slot, and that change (`585ab55`) is the worked example of a slot
>    change. The slot-specific facts in §1 (registry aliases, music retitle, Odyssey orb 47, the
>    clear colour chosen so the container fade never flashes) describe *that* change. For any
>    other slot, apply the same steps to the theme you are replacing. If Rainbark already exists in
>    your clone (the branch was merged), you are continuing, not rebuilding: use item 1.
>
>    **Build checklist from this file:** identity §1 → module list §7.1 and contracts §7.2 →
>    staged build order §7.3 (with §10 before step A1) → quality tiers §4.13 → acceptance shots
>    and the required sweep §8 → risks §9.
> 3. **Precedence.** §0–§9 are the definitive spec, exactly as written before the build started.
>    §10 (the bark lesson) was learned *after* the spec, on the CPU, before step A1. It **overrides
>    §4.3's Voronoi atlas recipe and the old end of §3.1's age ramp**. §11 is what the judges said
>    about the original proposal, §12 lists what changed between that proposal and the spec, and
>    §13 keeps the proposal's background (name, originality against the fleet, sources). Notes
>    marked **A2 build** record where the build in progress departed from the spec; the later
>    departures (A3, A4 and the sky pass) are recorded only in the handover's §4. The code, the
>    handover and the overhaul doc override everything here once they exist.
> 4. **The lesson that applies to every concept** (§10): prototype the hero material on the CPU
>    (numpy and PIL) and compare it side by side with reference photos *before* writing any shader.
>    The spec's own atlas recipe looked like stained glass the first time it was drawn.
> 5. Repo rules that apply throughout (`CLAUDE.md`): iterate in the playground first, **one small
>    effect per session**, and never call a WebGPU/TSL change done without a screenshot and a clean
>    console (ADR-0007, `docs/adr/0007-webgpu-tsl-definition-of-done.md`). Generated SFX are
>    unavailable. If a step seems to need them, stop and ask the user.
> 6. Words: never put the trademarked name of the falling-block game, or its word for a piece, in
>    code, strings, CSS or HTML (`npm run check:ip-strings`). Say "falling-block", "pieces", "four
>    lines". (The repo's own file and constant names use "tetromino", which the gate allows.)
> 7. Gotcha numbers written `#NN` are line numbers in the gotcha table of
>    `.claude/skills/webgpu-threejs-tsl/SKILL.md` ("Gotchas this repo has already paid for") as of
>    commit `585ab55`. If that file has changed, search the table for the symptom named next to
>    the number.
> 8. The two reference photos used for the bark (§10.1) are **copyrighted**. Never copy them into
>    the repo, not even into `public/playground-refs/` for a local comparison that might get
>    committed.

**Contents**

- §0 Decision, grafts and fixes
- §1 Identity
- §2 The picture
- §3 Palette
- §4 Rendering spec (TSL, three r186.1)
- §5 Environmental animation
- §6 Event language
- §7 Module plan and build order
- §8 Acceptance shots
- §9 Risks and mitigations
- §10 Art direction lesson: the bark (overrides §4.3 and the old end of the ramp)
- §11 What the judges said
- §12 What changed from the original proposal
- §13 Background from the original proposal: name, originality against the fleet, sources

---

# Part I: the definitive spec

> This part is the spec the build follows, written on 2026-10-11 against `main` at `5d3478d`
> (three r186.1 `WebGPURenderer` + TSL, WebGL2 backend fallback, desktop and phones). It replaced
> the original "wildcard" proposal; where the two disagree, this part wins (§12 lists the
> differences). These are the only edits made when it was copied here:
> - paths to working notes that no longer exist were replaced with repo paths;
> - cross-references to sections the spec never had (§7.4, §7.5) were corrected, and five that
>   pointed at the wrong section were corrected too (four "§4.3" in §0.2 and §0.3 that mean §4.2,
>   whose steps 2, 6 and 7 and art checklist hold that content, and one "§4.6" that means §4.4);
> - status notes were added where a step is already done ("Done in `585ab55`", "planned");
> - notes marked **Amended by §10** or **Superseded by §10** were added where the bark lesson
>   changes the spec, and step A1 (§7.3) and risk 1 (§9) now point to the lab's ribbon-splat model;
> - a note on capture tooling in cloud containers and the gates was added to §7.3, and a "Build
>   status at the time of writing" note to §7.1;
> - the heading of §3.5 says "Piece colours";
> - the spec's own later **A2 build** note (the Bole tide: §2.3, §3.3) was carried over, with a
>   marker in the §3.2 zone table;
> - a `|` inside a table cell was escaped so the table renders.
>
> Nothing else changed, and every number is as written.

## 0. Decision, grafts and fixes

### 0.1 The winner stands

Rainbark (wildcard) scored 24.9/30. Next were Iris Springs 22.6 and Painted Ages 22.5. The art
judge ranked Haft Rang first (8.5 against Rainbark's 8.0), but that is not enough to overrule:
- Haft Rang is an **interior**, and the brief asks for extraordinary *landscapes*.
- It carries a real cultural-reading risk: the room reads as the Nasir al-Mulk mosque.
- The rendering lead scored it lowest of the six (4.5). Its cost is a procedural Persian
  interior, a full-screen girih slab march, and the busiest backdrop behind the card.

Rainbark is the strongest landscape on art, the best on look-per-millisecond (tech 8.5), and
second on play (8.4). No judge says another concept is *clearly* more beautiful **and** original
**and** feasible. **Rainbark is built.**

### 0.2 What is grafted from the runners-up

| From | Idea | Where it lives in Rainbark |
|---|---|---|
| Sunfall | Ranked gaps in the occluder: one gap opens per combo link, in a fixed order | **Canopy gaps.** Each combo link opens a gap, which drops a big pinhole sun-pool and a short slanted shaft onto the near trunks. The chain is *counted in pools of light* (§6.6). |
| Sunfall | `dlSunlit` formulation: penumbra from the sun's 0.53° disc, read from CPU mips | `rbFleck`. One fetch gives physically sized flecks that grow softer and larger with distance below the canopy (§4.5). |
| Sunfall | Drops that exist only inside the light | Drips, the gust veil and the B2B sunshower glint only where `rbFleck > 0` (§4.8). |
| Sunfall | The exhale on chain break | The vapour roll that slides off the bark during **the Set** (§6.7). |
| Painted Ages | The shadow well: a cleared row's real 10 cell colours | The ring under a shed girdle **ripens into the cleared row's own colours**, left to right (§6.3). |
| Painted Ages | Wetness as one material parameter | Used by the B2B sunshower and the Great Moult: albedo ×(1 − 0.2·wet), chroma ×(1 + 0.3·wet), gloss up (§4.2 step 7). |
| Painted Ages | A B2B state that persists while the chain lives | **The Sunshower** (§6.8). |
| Painted Ages | `fwidth` mean-blend anti-aliasing | Far-rank bark fades to the group's mean colour by pixel footprint (§4.2 step 6). |
| Painted Ages | The reward lands on the release, sized by the peak | The curl curtain of **the Set** scales with the peak chain (§6.7). |
| Iris Springs | One discrete beat per combo link | A gap opens with a puff of leaf bits (§6.6). |
| Iris Springs | Steam underlit by the ground colour | The mist top takes a faint tint from the mean bark colour above it (§4.4, backdrop item 4). |
| Iris Springs | Saturation and colour instead of exposure flashes | The Moult's measured mean-luminance lift is capped at +0.25 stop, under an iris dip (§6.5). |
| Riverbloom | A T-spin leaves a persistent record | A helical scar plus amber resin beads that last the level (§6.9). |
| Riverbloom | A restart rite | The mist drains on the next session start, "morning returns" (§6.12). |
| Haft Rang | Cause and effect across the frame | The light source is on the open right. The light lands on the hero on the left, on the face where your peels are (§2.4). |
| Haft Rang | The board's pieces live in the world | Your last ~12 pieces stand as fresh bark bands beside the card and ripen away (§6.1). |

### 0.3 Every named weakness, and its fix

| Judge | Weakness | Fix in this spec |
|---|---|---|
| Art | Trees framing left and right round a central vista is the fleet's top cliché | **Asymmetric composition** (§2.1). One colossal, cropped Elder close on the left. Two slim Sisters set **deep** on the right (24 m and 40 m). The right half is open, sunlit air. The grove recedes on a left-to-right diagonal. There is no symmetric frame, no path and no vista. |
| Art | "It's a forest", and the fleet has five | No ground, no horizon, no canopy frame, no moon, no low golden sun, no fireflies, no path. Blue air carries a full-spectrum material, and the world is vertical. The hero is **bark**, not trees. The icon is one painted bole (§8, icon frame). The side-by-side gate is in risk 2 (§9). |
| Art | The cloud tide brushes the sea-of-clouds trope | Renamed **the mist floor**. It is only ever seen *between trunks*, steeply below, never out to a horizon. No cumulus and no peach or lavender: it is cream-white with blue shadows (§2, §4.6). |
| Art | The bark could read as camouflage, tie-dye or psychedelia | A hard art checklist (§4.2): vertical anisotropy of 4:1 or more, crisp lifted rims, seams, striation, a fresh edge round an older centre, non-monotonic lightness, and a mosaic dominated by old bark. The "aurora of bark" wording is deleted. Quickening is patch-wise and slow. |
| Art | Kino "bleeding" from a "wound" is a tonal risk | Kino is **removed**. The T-spin is **the Unwinding**: a helical apple-peel strip, then amber resin beads that glint like jewels. No red runnels and no wound language (§6.9). |
| Art | Use the rainbow at most once | Rainbark has **no rainbow anywhere**. The spectrum lives in the bark. |
| Art | Source a clear's colours from the real cells | The shadow well in the director; ring segments ripen to the row's cell colours (§6.3). |
| Tech | Patch-atlas ID filtering and far-rank shimmer | IDs are sampled nearest at `.level(0)` from a NearestFilter view. Edge AA is analytic from the linear edge-distance view plus `fwidth`. Far detail fades to the group mean by footprint (§4.2 steps 2 and 6). |
| Tech | Tide sheets show their slices at grazing angles | The mist floor is carried by the analytic height fog plus an analytic mist-top in the backdrop. Sheets are few, wide-ramped, texture only, and faded by `\|V.y\|` (§4.6). |
| Tech | "Painted pipes" | Fluting, buttresses, lean, sheen strip, seams, rims and the fresh-edge gradient are **session A1 requirements**, accepted against a reference photo (§7.3, step A1; see also §10). |
| Tech | The perfect-clear Floor is a whole extra scene | The floor is **painted in the backdrop** (ray–plane at y = 0). Trunks already reach the floor with their buttresses. No new geometry and no new pipelines (§4.4, §6.10). |
| Tech | Event loop inside a branch | Removed. The **near** trunks have their own draw and material, which includes the event loop. Far trunks have a draw with no events. Instance codes are integers, read with `floor(x + 0.5)` (§4.2). |
| Play | The combo cannot be counted | Canopy-gap sun-pools, one per link, at fixed stations. The clock quickening is kept as the secondary gauge (§6.6). |
| Play | Constant motion beside the card | **Lanes:** nothing that falls may enter the card or HUD rect plus a margin. Lock curls pop **outward** and fall **back** into depth. Ambient curls drop to ×0.35 while a run is live (§6.0). |
| Play | Lock band camouflage | A dark **peel lane** of old husk bark is where bands land. Each band has a torn-rim shadow line and a pale cambium edge, a wet gloss, +12% luminance for 3 s, and visible unzip motion (§6.1). |
| Play | Camera motion on the Climb | Delayed until 1.2 s after any clear. A 3.5 s eased rise. Under reduced motion it becomes a mist-veil crossfade (§6.11). |
| Play | B2B "Answer" is faint | Replaced by **the Sunshower**: grove-wide, persistent while the chain lives, and stepping heavier per B2B (§6.8). |
| Play | The combo break arrives one lock late | The director infers the break on the breaking lock (§7.2). |

---

## 1. Identity

| Field | Value |
|---|---|
| Display name | **Rainbark** |
| Theme id | `rainbark`. When it was chosen it was unused: not in `src/themes/theme-registry.js`, and a grep of `src docs data public tests scripts` found no "rainbark" or "deglupta". Registered since `585ab55`. |
| Class | `RainbarkTheme` (`src/themes/rainbark/rainbark-theme.js`, `export default`), with `super('rainbark')` |
| World / Post / Director | `RainbarkWorld`, `RainbarkPost`, `RainbarkDirector` |
| Constants | `RAINBARK_TETROMINOS`, `RAINBARK_PARTS`, `RAINBARK_EVENT_HANDLERS`, `LOG_PREFIX = '[Rainbark]'` |
| Capture prefix | `rainbark`, giving `?rainbarkTime=`, `?rainbarkFixedDt=`, `?rainbarkParts=`, `?rainbarkFalseColor=`, `?rainbarkForceWebGL=` |
| Registry | `group: 'biomes'` (leaves `cosmic`). Add to `HEAVY_GPU_THEME_IDS`. `RETIRED_THEME_IDS` gains `['cosmic-chimes', 'rainbark']`. (Done in `585ab55`. Rebuilding into another slot: see PLAYBOOK.md "Choosing a slot".) |
| Clear colour | `0x3a4a72`, a deep terpene shade. A mid-dark blue means the 2.5 s container fade never flashes white or black. Container CSS: `#rainbark-theme { background: #3a4a72; overflow: hidden; }` |
| Odyssey | Orb 47 keeps its slot. Rename "Singularity Gate" to **"The Painted Giants"**, use `transitionIn: 'crossfade'`, and rewrite the description as "a rare pocket of quiet before the final pull". `theme-presentation.js` key colour `'#c2f23d'`. ThemesTab fallback glyph `'bamboo'` (vertical stems). (Done in `585ab55`.) |

**Logline.** *A cathedral of colossal painted giants rising out of a floor of luminous mist,
in blue air. Their bark ripens through every colour of the spectrum and peels away in the sun.
Every piece you set peels the grove, every line you clear makes it shed, and every chain opens
the canopy one pool of sunlight at a time.*

**Seed.** *Eucalyptus deglupta*, the rainbow eucalyptus: 60–78 m, smooth bark shedding in
strips. Each fresh layer starts chartreuse and ages through green, blue, purple, ruby and
orange to maroon before it peels.

Reshaped for the theme:
- Scale ×2.3: trunks are 160–185 m, the Elder is 5.2 m thick.
- No ground and no horizon; the camera hangs among the trunks.
- Blue Mountains–style blue air.

In-game copy must not state the colour order or haze chemistry as species fact.

**Music.** (Done in `585ab55`.)
- `public/assets/music/cosmic-chimes.mp3` → `git mv` to `rainbark.mp3`.
- ID3 TIT2 becomes **"Rainbark"**, keeping the file length exactly as the murmuration rename did.
- Track key `CosmicChimes` → `Rainbark`, with `RETIRED_TRACK_KEYS` gaining `['CosmicChimes', 'Rainbark']`.
- `theme-music-catalog.js`: `rainbark: ['Rainbark', 'rainbark.mp3']`. Regenerate `songs.json` with `node generate-songs.js`.
- **The audio is unchanged.** Tell the user the recording is still the Cosmic Chimes music, retitled.
- `CREDITS.md`: `Rainbark (titled "Cosmic Chimes" until October 2026)`.

---

## 2. The picture

### 2.1 Painter's description (16:9 reference: 1920×1080, level 4, `t=55`)

We hang in the middle storey of a forest of giants, 56 m above a floor we cannot see, looking
level into blue air.

**Left: the Elder.** It is not a framing tree. It is a **wall of painted bark**:
- 5.2 m thick, 9 m away, cropped by the left edge of the frame. Its right silhouette stands at
  x = 0.27.
- It rises out of the top of the frame and dives out of the bottom.
- Its face is a mosaic of tall vertical lozenges, 0.4–1.2 m wide and 2–6 m tall, each with a
  crisp, slightly lifted rim. Chartreuse sits against teal, cobalt against pastel violet,
  ruby against burnt orange. Most of the face is old maroon and husk bark, so the bright young
  patches read as jewels, not noise.
- Fine vertical striation runs through every patch, and dark hairline seams run between them.
- The bark is satin-wet. A **sheen strip** runs down the card-facing side, reflecting the bright
  haze on the right.
- Sunflecks crawl over its right half: soft elliptical pinhole images of the sun about 1.3 m
  across. Where one rests, the patch glows and a thread of vapour lifts.
- The left half is in cool blue shade, lit from below by a warm glow off the mist floor.

**Right: the Sisters, set deep.**
- Sister One is 3.2 m thick and 24 m away, standing just right of the HUD at x ≈ 0.78–0.86.
- Sister Two is 2.4 m thick and 40 m away, at x ≈ 0.88–0.91, leaning toward her.
- A single liana sags between them, a scale cue.
- Their sunlit outer sides catch flecks. Between card and Sisters there is **nothing but luminous
  air**, which is where the HUD sits.
- This is the open, light-giving half of the picture.

**Behind the card: the receding grove.**
- Ranks of trunks stand at 45, 70, 110 and 165 m.
- They recede **diagonally** from the dense left (continuing the Elder's mass) to a sparse right,
  opening an **aisle of light** behind the HUD.
- Each rank is paler and bluer: R1 still painted, R3 pastel, R4 a blue-violet ghost.
- Beyond them the backdrop paints an endless grove of faint vertical stripes dissolving into
  bright haze.
- The card sits on the calmest part of the frame: pale blue air with only ghost verticals.

**Below** (bottom ~15% of the frame, between trunks):
- The trunks plunge into the **mist floor**: luminous cream vapour, 10–30 m below, rippled into
  soft billows.
- Broad pools of sunlight drift on it, and blue shadow fills its hollows.
- It is seen only through the gaps between trunks, never as an open vista.

**Above** (top ~12%):
- Faint at this level: the trunks recede upward into a high, dark lace of canopy, with a few
  white-blue sky gaps near the top edge.
- Short, faint shafts slant down-left through the haze on the right.

**Light.**
- **Key:** sun at elevation 55°, azimuth 70° to the right of the view axis and slightly in front.
  It is out of frame (upper right).
- **Fill:** cool skylight from above.
- **Bounce:** warm light up from the mist floor.
- Warm on cool everywhere: flecks, sheen and vapour are cream-gold, while shade and air are
  blue-violet.

**Why it has depth:**
1. Seven ranks of overlap, plus impostor ranks.
2. Blue aerial perspective strips saturation rank by rank.
3. Upward pitch converges the verticals.
4. Curls and sheets change size and haze as they sink.
5. Mist wisps hang between ranks.
6. Camera breathing gives parallax.
7. Fleck density and sheen fall off with distance.

### 2.2 Camera rig (all layouts)

The camera position is `(px, camY + breathY, 0)`, looking along −z with no roll, then pitched up:

```
k     = smoothstep(0.62, 1.50, aspect)      // portrait → landscape
w     = smoothstep(1.78, 2.40, aspect)      // landscape → ultrawide
vFov  = 64° − 14°·k − 6°·w                  // 0.46 → 64°, 1.0 → 58.4°, 1.78 → 50°, 2.37 → 44°
pitch = +9° − 3°·k − 1°·w                   // portrait 9°, 16:9 6°, 21:9 5°
REST_RIG = { near: 0.3, far: 3000, minFov: 30, maxFov: 78 }
camY(level) = 20 + 12·c,   c = (level − 1) mod 12      // L1 20 m … L12 152 m
breath: x ±0.15 m and y ±0.10 m, Lissajous at 0.05/0.037 Hz (off under reduced motion)
pointer parallax px: ±0.25 m (mouse only, not touch; off under reduced motion)
```

`fovForAspect(a)` returns `vFov`, and is valid for aspects 0.46 to 21/9.

| Layout | Buffer | vFov | hFov | Pitch | Card (fallback, fractions) | HUD (fallback) | Cell px |
|---|---|---|---|---|---|---|---|
| 16:9 | 1920×1080 | 50.0° | 79.3° | 6.0° | x .407–.593, y .149–.851 | x .635–.708, y .322–.678 | 30 |
| 21:9 | 2560×1080 | 44.0° | 87.6° | 5.0° | x .430–.570 | x .602–.656 | 30 |
| Phone portrait | 390×844 | 64.0° | 32.2° | 9.0° | x .164–.836, y .146–.854 | live rect (fallback is off-screen) | 22 |
| Short laptop | 1280×720 | 50.0° | 79.3° | 6.0° | x .391–.609 | x .648–.758 | 23.5 |

### 2.3 World layout (metres; y up, floor y = 0, camera at x = z = 0, looking −z)

The **composition solver** (`trunkBand(layout, aspect)` in `rainbark-composition.js`) places the
hero trunks from the **live** card and HUD rects every time the layout changes. The rows marked
"solved" show the 16:9 fallback result.

| Element | Position (x, z) | Radius / size | Vertical | Screen x (16:9) | Notes |
|---|---|---|---|---|---|
| **Elder** (hero) | **solved:** right silhouette at `card.x0 − card.x0·(0.08 + 0.26k)`; depth `9 − 1·w`. 16:9 gives (−6.05, −9.0). | R 2.6 at camera height. Taper: 3.1 at the floor, 1.7 at the top. | y 0 → 185 | **−0.08 … 0.27** (cropped) | Leans 2° toward −x. 11 flutes. 4 buttress fins near the floor (h_b 11 m). Draw `near`, code 1. |
| **Sister One** | **solved:** left silhouette at `max(card.x1, hud.x1) + (0.012 + 0.063k)`; depth 24. 16:9 gives (+12.9, −24). | R 1.6 | 0 → 172 | **0.783 … 0.864** | Leans 3° toward −x. The solver tests the silhouette at the HUD's and card's top and bottom and pushes out if it touches. Draw `near`, code 2. |
| **Sister Two** | (+26, −40), or solved at Sister One's right edge + 0.03 | R 1.2 | 0 → 168 | 0.875 … 0.909 | Leans 2° toward Sister One. Hidden on portrait. `near`, code 3. |
| **Liana** | Catenary from Sister One (y camY+9) to Sister Two (y camY+4), sag 3.5 m | 0.12 m thick | moves with camY | ~0.80 … 0.89, y ≈ 0.12–0.26 | Sways ±0.4 m at 0.15 Hz. |
| **R1a** | (−12.7, −45) | R 1.5 | 0 → 175 | 0.31 … 0.35 | Stands in the **left air lane** between Elder and card. `near`, code 4 (sheds at ×2). |
| **R1b** | (+19.1, −48) | R 1.4 | 0 → 170 | 0.725 … 0.755 | `near`, code 5. |
| R1c, R1d | (−30, −50), (+40, −55) | R 1.7 / 1.6 | | behind the Elder / 0.94 | Far draw (R1c shows at 21:9). |
| **R2 ×8** | z −62 … −82, seeded | R 1.2–1.8 | | | **Keep-out:** screen band card ±0.02 and the aisle 0.61–0.72. |
| **R3 ×10** | z −100 … −125 | R 1.4–2.2 | | | At most 2 may stand behind the card. |
| **R4 ×≤12** | z −150 … −185 | R 1.8–2.6 | | | Medium and up. |
| **Limbs** | From parent spines at y 110–150, 35–55° up and out | L 12–30 m, R 0.35–0.9 | | above frame until L9 | Extra instances in the trunk draws. |
| **Impostor ranks** | 300 / 420 / 600 m | stripes 2.2–3.4 m wide, spacing 11 / 13 / 15 m | | everywhere | In the backdrop. |
| **Mist floor top** | plane y = `tide` (Bole 38 ± 8; **A2 build: 26 ± 6**, see note) | — | — | bottom band | Backdrop analytic, plus 1–6 sheets. |
| **Canopy plane** | y = `yC` = 172 | gap mask tile 9 m; leaf-lace tile 12 m | — | top band | Gobo and lacework. |
| **Floor** | y = 0 | — | — | shown only by the perfect clear | Backdrop only. |

> **A2 build deviation (pending sign-off when this file was written):** the Bole tide is
> 26 ± 6 m in the build (`ZONES[1]` in `src/themes/rainbark/rainbark-core.js`: `tideTop: 26`,
> `tideAmp: 6`), not 38 ± 8. With the higher tide the mist seen between the trunks at L4 was
> 20 m below the eye and read as a near floor or lake, and L3 (44 m) could end up inside the
> mist at high tide. Cost: slightly less warm bounce on the trunks at eye height (re-check after
> A3's underglow tuning). Reverting is one line in `ZONES[1]`. The §3.2 zone table marks the
> change; the transmittance figures under it were computed for the spec's 38 m.

**Seeded grove-plan rules** (`planGrove(seed, tier)` in core, using `mulberry32`):
- Minimum spacing between trunk axes is 2.5·(Ra + Rb).
- R1/R2 keep out of the card band (card ±0.02 screen-x at the 16:9 fallback) and the aisle.
- Trunk density on the left half is twice that on the right half, giving the diagonal recession.
- Every trunk has a 32-bit `seed` (its patch-hash salt), a `group` (0 Elder, 1 Sisters plus R1
  on the right, 2 R1/R2 left and middle, 3 far), a `rank`, a lean vector, a radius taper and
  buttress parameters (count 3–5, phase, height h_b = 8–14 m).

### 2.4 Light directions

| | Value |
|---|---|
| **Key (sun)** | Azimuth fixed at **−70°** (to the right of −z), elevation per zone (Bole 55°). Bole gives `L = (0.539, 0.819, −0.196)` pointing at the sun. It drifts ±3° in azimuth over the tide cycle. |
| **Consequence** | The Elder's card-facing half and the Sisters' outer halves face the sun, with N·L up to 0.57, so the flecks land there. The Elder's left half and the Sisters' card-facing halves are in skylight shade. The haze brightens toward the right (Henyey–Greenstein forward scatter). Curls in the right lane are backlit. |
| **Fill** | Skylight from the canopy gaps: `skyCol·(0.35 + 0.35·N.y + 0.30)`, cool. |
| **Bounce** | Up from the mist top: `underglow·exp(−max(P.y − tide, 0)/25)·(0.45 + 0.55·max(0, 0.3 − N.y))`, warm. |
| **Why it changed from the concept** | The concept put the sun behind the Elder. That leaves the visible faces in silhouette and kills the bark colour where the peels happen. The light now enters from the open right and lands on the hero's card-facing face (Haft Rang's cause-and-effect split). |

### 2.5 21:9 (2560×1080)

- vFov 44°.
- The Elder moves closer (depth 8 m) and its left silhouette comes into frame (−0.055). The
  cropping softens and **one buttress flange** sweeps into the mist at the bottom left (visible
  from L1–2; at L4 the flange is below frame).
- R1c appears through the gap left of the Elder.
- A fused **Twin** stands at (+24.3, −30) and (+25.6, −30), R 1.2 and 0.9, at x ≈ 0.90–0.94.
- Sister One is at 0.73–0.80.
- The planner's azimuth spread covers ±50°.
- The extra width is deep grove and air, never a vista.

### 2.6 Phone portrait (390×844)

This is the theme's natural fit: a vertical world on a vertical screen.

| Band | What shows |
|---|---|
| **Top** (y 0–0.15) | The trunks converge upward into the brightest crown gap. Sky-white light shows behind dark canopy lace. Combo station #7 lives here. |
| **Middle** | The card fills 0.16–0.84 in x. The **Elder** is a painted band down the left edge (solved right silhouette 0.151, cell 0.31 m). **Sister One's** card-facing side is a band at 0.85–1.0. |
| **Bottom** (y 0.85–1.0) | Near and R1 trunks plunge into the glowing mist floor. Curls and sheets visibly tumble here, at their largest on screen. |

Lane rules on the phone:
- Lanes use whichever side of a trunk is on screen with a margin of 0.04 or more, so Sister One
  uses her card-facing side.
- Lock curls fall down the edge band, then swing into the bottom band where they are read.

---

## 3. Palette

### 3.1 World colours (named, sRGB hex; shaders use `srgbToLinear`)

| Name | Hex | Role |
|---|---|---|
| **Terpene Haze** | `#8FA6D8` | Blue-violet air in shade; the aerial-perspective target |
| **Sunlit Vapour** | `#F6EBCB` | Haze toward the sun, mist top, vapour |
| **Understory Indigo** | `#1E2A44` | Deepest shade; grade shadow tint |
| **First Skin** | `#C2F23D` | Fresh bark, age 0 (the I piece) |
| **Young Emerald** | `#2BCB72` | Age 0.12 (T) |
| **Glaucous Teal** | `#1A93AC` | Age 0.26 (Z) |
| **Cobalt Bark** | `#2F4CC0` | Age 0.38 (L) |
| **Bloom Violet** | `#B98AF2` | Age 0.52, the pastel purple phase (S) |
| **Ruby Bark** | `#D23468` | Age 0.66 (J) |
| **Ember Bark** | `#F07A2A` | Age 0.79 (O) |
| **Husk Maroon** | `#5E2430` | Age 0.91; the outer face of curls |
| **Old Husk** | `#3E2A26` | Age 0.98–1.0; the peel lane |
| **Fleck Gold** | `#FFE3A0` | Sunflecks, hairline splits, sun specular |
| **Skylight** | `#CFE6F6` | Crown gaps, sky fill |
| **Crown Green** | `#23452F` | Leaf lace (backlit edges `#6E9A4A`) |
| **Cambium Cream** | `#EFE7C8` | The torn edge of a peel |
| **Curl Underside** | `#DCE8B8` | The inner face of shed bark |
| **Amber Resin** | `#E7A43A` | T-spin beads (core `#B8661C`, glint `#FFE9B0`) |
| **Floor Gravel** / **Stream Glint** | `#B79A62` / `#FFF6DA` | Perfect-clear floor |

**The bark age ramp.** A 256×1 RGBA8 `DataTexture` (sRGB-decoded into linear values at bake time,
linear filter, clamp). Ramp stops, age → colour:

| Age | 0.00 | 0.12 | 0.26 | 0.38 | 0.52 | 0.66 | 0.79 | 0.91 | 0.98–1.0 |
|---|---|---|---|---|---|---|---|---|---|
| Colour | `#C2F23D` | `#2BCB72` | `#1A93AC` | `#2F4CC0` | `#B98AF2` | `#D23468` | `#F07A2A` | `#5E2430` | `#3E2A26` |
| CIE L\* | 89 | 72 | 56 | 37 | 66 | 49 | 64 | 22 | 20 |

- Lightness is deliberately **non-monotonic**, so the mosaic reads as patches, not a gradient.
- World albedo is `linear(ramp(age))·0.82` dry, with a ±6% per-patch channel jitter that keeps luminance.
- The ramp stops are **exactly the seven piece colours**: every piece is one age of the bark (§3.5).

> **Amended by §10.5.** The old end of this ramp (the stops after Ember Bark at 0.79) moves from
> maroon and brown husk to a **cool slate** matrix, so trunks read as blue-grey pillars streaked
> with jewels rather than brown trees. The lab's stops were 0.87 `#7A3A3C`, 0.93 `#5E6470` and
> 1.0 `#56606A`. The piece stops 0.00–0.79 are unchanged. Read `RAMP_STOPS` in
> `src/themes/rainbark/rainbark-core.js` for the values the build uses.

### 3.2 Level variant: **the Climb** (5 zones), plus the Mistfall look

Each level lifts the walkway one storey (12 m). The zone sets the haze, light and grade.
`c = (level − 1) mod 12`.

| # | Zone | Levels (c) | camY (m) | Tide top (m) | Sun elevation | Fleck coverage | Bark saturation | Exposure |
|---|---|---|---|---|---|---|---|---|
| 1 | **Buttress Deep** | 1–2 (0–1) | 20, 32 | 10 | 50° | 0.06 | 0.85 | 1.15 |
| 2 | **Bole** | 3–5 (2–4) | 44, 56, 68 | 38 (A2 build: 26) | 55° | 0.18 | 1.00 | 1.00 |
| 3 | **Fog Line** | 6–8 (5–7) | 80, 92, 104 | 100 (±4 breathing) | 58° | 0 inside mist → 0.10 at c=7 | 0.78 | 0.92 |
| 4 | **Limb Storey** | 9–11 (8–10) | 116, 128, 140 | 104 | 61° | 0.30 | 1.08 | 0.98 |
| 5 | **Crown Light** | 12 (11) | 152 | 108 | 64° | 0.42 | 1.00 | 0.95 |
| 6 | *Mistfall* (game over, rest) | — | — | camY + 15 | — | 0 | 0.60 | 0.95 |

Hex sets per zone (`ZONES[i]` in core, uploaded to the palette `uniformArray` and crossfaded over the Climb):

| Zone | hazeShade | hazeSun | sky (zenith) | mistTop | underglow | fleck | crown | gradeShadow | gradeLight |
|---|---|---|---|---|---|---|---|---|---|
| Buttress Deep | `#4F5F9A` | `#B9C6E4` | `#9DB4D8` | `#D5DCEB` | `#AFC0E2` | `#FFE9B8` | `#1B3326` | `#18213D` | `#E6EDF8` |
| Bole | `#8FA6D8` | `#F6EBCB` | `#CFE6F6` | `#F6EBCB` | `#F2DDB0` | `#FFE3A0` | `#23452F` | `#1E2A44` | `#FFF2D8` |
| Fog Line | `#C9D2E2` | `#F4F1EA` | `#EEF2F6` | `#F7F7F3` | `#E9E6DE` | `#FFF4DC` | `#3A5446` | `#4E5873` | `#FBFAF6` |
| Limb Storey | `#A6BEE4` | `#FFF0D2` | `#D6ECFA` | `#FFF6E2` | `#F5E2BE` | `#FFE6A6` | `#2C5A3A` | `#22314E` | `#FFF4DE` |
| Crown Light | `#9CC4EA` | `#FDF5E4` | `#8FC3EE` (`#4F93D6`) | `#FFFDF6` | `#F0E7D2` | `#FFF0C4` | `#2F6A3E` | `#28406A` | `#FFF8EA` |
| Mistfall | `#A9B2C6` | `#E6E9EE` | `#E3E8EF` | `#EEF0F3` | `#DADDE3` | — | `#3C4A44` | `#3C4560` | `#F2F3F6` |

**Air parameters per zone.** Density is `ρ(y) = σA·exp(−max(y − tide, 0)/Hs) + σM·[y < tide]`
(the step softened over −6…+2 m).

| Zone | σA (m⁻¹ at tide top) | Hs (m) | σM (in mist) |
|---|---|---|---|
| Buttress Deep | 0.016 | 30 | 0.06 |
| Bole | 0.0102 | 40 | 0.05 |
| Fog Line | 0.012 | 40 | 0.05 |
| Limb Storey | 0.0075 | 45 | 0.045 |
| Crown Light | 0.006 | 50 | 0.04 |

At the Bole reference, horizontal transmittance is about 0.77 at 45 m (R1 painted), 0.49 at
110 m (pastel) and 0.18 at 260 m (ghost).

**Zone moods:**
- **Buttress Deep:** intimate, blue, root flanges sweeping into a cool mist just below, few flecks.
- **Bole:** the reference frame.
- **Fog Line:** inside the mist. Pearly, high-key, trunks dissolving within 60 m. At c = 7 you
  break out on top.
- **Limb Storey:** first limbs crossing overhead, denser warm flecks, more sky lace.
- **Crown Light:** just under the canopy. Big crisp flecks, azure gaps, limbs and lace fill the
  top third, the mist floor 44 m below between trunks.

L13 and above wrap to Buttress Deep through a mist veil (§6.11). Modes without LEVEL_UP
(Infinity, MP) climb every 15 cleared lines.

> No zone uses golden-hour light. The sun is always at 50° elevation or higher, and the warmth
> lives only in the highlights.

### 3.3 Clock variant: **the tide** (150 s)

```
tide(t) = zone.tideTop + A·(−cos(2π·t/150))     // A = 8 m (Fog Line 4 m); t=0 low, t=75 high
```

(A2 build: the Bole's tide top is 26 m with A = 6 m, not 38 ± 8; see the note under §2.3.)

| Phase | Mist | Light |
|---|---|---|
| **Clearing** (low) | low | fleck gain ×1.15, sheen 0.6 |
| **Rising** | wisps climb | — |
| **Immersion** (high; Bole L3 can be inside the mist) | high | fleck ×0.6, sheen 1.0, σA ×1.3 |
| **Draining** | falling | — |

The shafts follow mist density. The sun azimuth drifts ±3° with the same cycle.

### 3.4 Session variant: **the grove's age**

Every patch's cyclic age is warped by a per-group bias `b`, so the grove's mean colour shows how
long ago you last cleared four lines:

```
warp(a, b) = b ≥ 0 ? 1 − (1 − a)^(1 + b) : a^(1 − b)          // monotonic in a; written with exp/log of clamped bases
b(t)       = +0.3 at session start, + 0.05 per minute, cap +1.2
            the Great Moult sets the near groups to −0.6, which relaxes back to the drift line over 360 s
```

### 3.5 Piece colours (`rainbark-tetrominos.js`, `version: 2`)

| Shape | Bark age | Name | Hex | Hue | Guideline band | In band? | CIE L\* |
|---|---|---|---|---|---|---|---|
| **I** | 0.00 | First Skin | `#C2F23D` | 75.9° | cyan 160–210 | no | 89.5 |
| **O** | 0.79 | Ember Bark | `#F07A2A` | 24.2° | yellow 32–75 | no | 63.8 |
| **T** | 0.12 | Young Emerald | `#2BCB72` | 146.6° | purple 245–315 | no | 72.5 |
| **S** | 0.52 | Bloom Violet | `#B98AF2` | 267.1° | green 90–170 | no | 65.7 |
| **Z** | 0.26 | Glaucous Teal | `#1A93AC` | 190.3° | red 320–20 | no | 56.2 |
| **J** | 0.66 | Ruby Bark | `#D23468` | 340.3° | blue 200–250 | no | 48.5 |
| **L** | 0.38 | Cobalt Bark | `#2F4CC0` | 228.0° | orange 20–50 | no | 37.1 |
| GARBAGE | 0.95 | Old Husk | `#4A2A30` | — | — | — | 21 |
| CLEAN_GARBAGE | — | Cambium | `#D8D2BE` | — | — | — | 84 |

**Palette gate: 0/7.** Checked with the exact hue maths of `scripts/palette-guideline-check.mjs`.
**All seven roles are deranged:**
- the red-adjacent piece is J;
- the orange piece is O;
- blue is L;
- purple is S;
- green is T;
- teal sits on Z;
- chartreuse is I.

**Colour-vision check.** Machado 2009 simulation, worst pair by CIELAB ΔE76:

| Vision | Worst pair | ΔE | ΔL\* |
|---|---|---|---|
| Normal | S/L | 34.6 | — |
| Protanopia | Z/J | 22.2 | 18.8 |
| Deuteranopia | T/J | 22.2 | 17.6 |
| Tritanopia | O/J | 19.4 | 13.6 |

The concept's original S `#9457DC` and L `#4069E0` were rejected: they collapsed under
protanopia (ΔE 1.3). Z and J were adjusted for the same reason.

**Cell look.** `renderMode: 'solid'`, `effects: { premium: true, phaser: { gradient: true,
highlight: 0.16, shadow: 0.20, rim: true, rimAlpha: 0.40, rimWidthFactor: 0.05, gloss: true,
glossAlpha: 0.14 } }`, `rendererOverrides: {}`.

Read as **satin bark tiles**:
- a soft top-left wet highlight;
- a slightly deeper centre (the older middle of a patch);
- a fresher rim;
- no glow, pulse, shimmer or trails, so active, ghost, next and MP previews stay crisp.

Optional stretch, only if it costs nothing per frame: 3–4 fine vertical striations at 6–8%
contrast. Garbage is matte husk with no gloss.

---

## 4. Rendering spec (TSL, three r186.1)

### 4.0 House rules and the shared plumbing

**Materials and lighting:**
- `MeshBasicNodeMaterial` everywhere, self-shaded, scene-linear HDR. No scene lights, no
  `ShaderMaterial`, no `mx_noise`, no compute.
- No `Data3DTexture` and no `lut3D`. 3D noise uses the Void Ember 2D-lattice trick
  (`u.noise3`, `src/themes/void-ember/void-ember-tsl.js:122-165` at `5d3478d`).
- **One scene pass** (MSAA 4× on High and up), the BloomNode chain (Medium and up), then **one
  output pass**. `usesMrtScenePass() === false`, `getWarmupRoots() → []`, no `buildsPipelinesAsync`.

**Uniforms:**
- **One uniform bag `u`** (`createRainbarkUniforms`): the world writes `.value`, materials only read.
- Exactly **two** `uniformArray`s: `u.events` (vec4, 112 rows, §4.11) and `u.palette` (vec4: zone
  colours, the 4 group mean colours, and 8 piece-age rows).
- Scalars and vectors are plain `uniform()` values. That stays far under 12 uniform buffers per
  stage (gotcha #102).

**Helpers:**
- Laid-out pure helpers (`setLayout`, no captured textures or uniforms; gotchas #93, #95):
  `rbHash21`, `rbHash31`, `rbQuatRotate`, `rbHgMix`, `rbWarpAge`, `rbRoundBoxSdf`, `rbFilmic`,
  `rbSchlick` (products only, gotcha #94), `rbDecodeCode`.
- Inline builders (they read `u` and textures): `rbAir`, `rbFleck`, `rbSkyLight`, `rbBackdrop`,
  `rbBark`, `rbCurlLight`.

**Pools and textures:**
- Every pool is always drawn, with dormant slots collapsed to zero size, so the first frame
  compiles every pipeline.
- Nothing is created at event time.
- Textures, all **2D** and baked on the CPU in `rainbark-bake.js` (three-free typed arrays,
  wrapped by `rainbark-tsl.js`):

| Texture | Format | Filter | Bake |
|---|---|---|---|
| `atlasNear` + `atlasLin` (same `Uint8Array`, two `DataTexture` views) | 512² RGBA8 (256² on Minimal) | Nearest (IDs) / Linear (distance); no mips | ~30 ms |
| `ramp` | 256×1 RGBA8 | Linear, clamp | <1 ms |
| `gapMask` (canopy pinholes) | 256² R8 + CPU mips | LinearMipmapLinear, repeat | ~8 ms |
| `leafLace` (lanceolate leaves, tileable) | 512² R8 + CPU mips | LinearMipmapLinear, repeat | ~15 ms |
| `fbm` | 256² RGBA8 (4 octave bands) + CPU mips | LinearMipmapLinear, repeat | ~10 ms |
| `lattice` (for `noise3`) | 256² RGBA8 | Linear, repeat | ~3 ms |

### 4.1 Elements at a glance

| Part (`RAINBARK_PARTS`) | Contents | Render order |
|---|---|---|
| `trunks` | Near draw (≤ 8 instances, events) + far draw + limbs | 10 / 11 (opaque, writes depth) |
| `sky` | Far-plane backdrop triangle: haze, impostor ranks, lace, mist top, floor | 50 (`depthTest`, `LessEqual`, no depth write) |
| `mist` | 1–6 horizontal sheets + 0–8 wisps | 60 (premultiplied over) |
| `curls` | Ambient + event curls and sheets, including helix ribbons | 65 (premultiplied over; `DoubleSide`) |
| `fx` | Flakes, drops/rain, vapour, amber beads, shaft slabs, leaf bits | 70–80 (additive `vec4(rgb, 0)` or over) |
| `life` | Liana, lorikeets | 20 (opaque) / 66 |

### 4.2 Trunks: the hero (`rainbark-trunks.js`)

**Geometry.**
- One unit tube as `InstancedBufferGeometry`. The `position` attribute holds (θ/2π, h, 0) on a
  grid of Nθ × Nh, with a closing seam at the back.
- **Two draws:**
  - `near`: Elder, Sisters, R1a, R1b, plus local-MP extras; ≤ 8 instances, fine grid, event-aware material.
  - `far`: everything else, plus limbs; coarse grid, no events.
- Per-instance data is **one `InstancedInterleavedBuffer`**, stride 16 floats (gotcha #99):

| Slots | Contents |
|---|---|
| `aBase` vec4 | base x, base z, R0, taper |
| `aSpan` vec4 | y0, y1, buttress amplitude B, buttress height h_b |
| `aLean` vec4 | lean x, lean z, curve, sway amplitude |
| `aCode` vec4 | trunk code (integer; 0 = far, 1–8 = near index), group (0–3; +4 = limb), seed (integer < 2²⁴), buttress count·16 + flute count |

  Flute and buttress phases come from `hash(seed)`, so they need no slot.

**Vertex** (`positionNode` from `positionGeometry`; no instance matrices, so the r185 ordering
trap does not apply):

```
y      = mix(y0, y1, h)
spine  = base + leanXZ·(y − y0) + curveXZ·(y − y0)²/(y1 − y0) + swayXZ(t)·((y − y0)/(y1 − y0))²
R(y)   = R0·(1 − taper·(y − y0)/(y1 − y0))
flute  = 0.035·cos(nF·θ + φF) + 0.012·fbmRow(θ·3, y·0.05)        // gentle fluting
butt   = B·max(0, cos(nB·θ + φB))³ · exp(−max(y − 0, 0)/h_b)       // flanges at the floor
r      = R(y)·(1 + flute) + butt
P      = spine + r·(cos θ, 0, sin θ)
N      = normalize(cross(∂P/∂θ, ∂P/∂y))   // analytic; ∂ terms written out, no dFdx
```

Pass to the fragment stage: `vBark = (θ, y, rRef)`, `vNrm`, `vCode = floor(aCode.x + 0.5)`,
`vSeed`, `vGroup`, and the horizontal distance to the camera (for the moult front).
**Clamp every interpolated θ and y** (gotcha #105).

**Fragment (`rbBark`):** everything below is one inline builder used by both materials; the
near material adds §4.11's overlay.

1. **Bark space.** `k_rep = max(1, round(2π·R0 / 4.8))`, `s = θ/(2π)·k_rep` (tile units around),
   `v = y / 14` (tile units up). The tile is 4.8 m × 14 m.
2. **Patch atlas.**
   - `idTex = atlasNear.sample(st).level(0)` gives R = cell id, B = neighbour id, A = lift side.
   - `dTex = atlasLin.sample(st).level(0).g` gives the edge distance (0–1 = 0–0.25 m).
   - `patchId = hash(cellId, floor(s), floor(v), seed)`.
3. **Age.**
   ```
   P_i   = 240 + 360·h1(patchId)                  // 4–10 min lifetime
   a_cyc = fract(u.groupClock[group]/P_i + h2(patchId))
   a     = rbWarpAge(a_cyc, u.ageBias[group])
   aLoc  = a + 0.05·smoothstep(0.0, 1.0, edge01)   // the older centre
   ```
4. **Peel lane** (near codes 1–5 only). An arc of θ: on the Elder, 30° (≈ 1.36 m) beginning 6°
   inside the card-facing silhouette; on Sister One, 50° (≈ 1.4 m) on her sunlit side, or her
   card-facing side when that is the only side on screen (§2.6). θ bounds are uniforms per code. Inside it,
   `aLoc = max(aLoc, 0.86 + 0.13·h3(patchId))`, giving a dark old-husk lane so peel bands pop.
5. **Colour.**
   - `albedo = ramp(aLoc)·0.82·jitter(patchId)`.
   - **Striation**: `1 + 0.07·(fbm(s·7, v·0.35).r − 0.5)` (dropped in JS on Low and Minimal, gotcha #135).
   - **Seams**: darken 25% over 6–10 mm at cell borders, AA'd `smoothstep(e − fw, e + fw, dEdge)` with `fw = fwidth(dEdge)`.
   - **Rim lift** (aLoc > 0.90; dropped in JS on Low and Minimal):
     `lift = smoothstep(0.90, 1.0, aLoc)`. On the lift side, a 45% shadow line `(0.012 + 0.03·lift)` m
     wide beyond the edge, plus a +25% lip highlight. On the stripped moult it is driven by `u.creak` (§6.5).
   - **Fresh pop**: aLoc < 0.03 gives +10% and gloss.
6. **Far anti-aliasing** (tech fix). `fp = fwidth(s)·4.8` (metres per pixel around).
   `detail = 1 − smoothstep(0.05, 0.25, fp)`. Then `albedo = mix(u.groupMean[group], albedo, detail)`,
   and seams, rims and striation are multiplied by `detail`. The group means are computed on the CPU
   each frame from the clocks and bias (ramp integral) and uploaded as palette rows.
7. **Wetness and gloss.**
   - `wet = max(u.wet, freshWet)`.
   - `rough = mix(0.25, 0.75, smoothstep(0.1, 0.9, aLoc))·(1 − 0.6·wet)`.
   - Wet albedo `×(1 − 0.2·wet)`, chroma `×(1 + 0.3·wet)` (luma-preserving mix away from grey), `u.sheenK` up.
8. **Lighting.** `Vv = normalize(camPos − P)`, `R = reflect(−Vv, N)`.
   ```
   fl      = rbFleck(P)                                         // §4.5, 0..1 (+combo pools)
   direct  = u.sunCol·fl·max(dot(N, L), 0)
   ambient = u.skyCol·(0.35 + 0.35·N.y + 0.30)·ao              // ao = 0.85 + 0.15·edge01
   bounce  = u.underglow·exp(−max(P.y − u.tide, 0)/25)·(0.45 + 0.55·max(0, 0.3 − N.y))
   F       = rbSchlick(max(dot(N, Vv), 0), 0.04)               // x2·x2·x products
   sheen   = F·u.sheenK·(1 − rough)·rbSkyLight(R, cheap)        // vertical sheen strip on cylinders
   spec    = u.sunCol·fl·ggxLite(N, normalize(L + Vv), rough)·F
   col     = albedo·(direct + ambient + bounce) + sheen + spec
   col     = rbAir(col, P)                                     // §4.4
   ```
   Sun colour (Bole, scene-linear) is about (4.2, 3.7, 2.9)·`zone.fleck` tint.

**Art checklist** (A1 acceptance, §7.3). The bark must show all of these:
- vertical anisotropy of 4:1 or more;
- crisp lifted rims with shadow lines;
- hairline seams;
- striation;
- a fresher edge round an older centre;
- non-monotonic lightness;
- 55–65% of the visible area in ages 0.66–1.0 at rest;
- the sheen strip;
- fluting and lean;
- buttresses at the floor.

It must **not** read as round blobs, tie-dye, camouflage, a smooth gradient, or "painted pipes".

| Cost | Near draw | Far draw |
|---|---|---|
| High | 8 × 48×112 (86k tris) | 24 × 24×64 (74k tris), 20 limbs (11k) |
| Texture reads | 5 (2 atlas views, ramp, fbm, gap; Ultra+ adds a 2nd gap tap) | 4–5 (fbm only for striation and moult flames) |
| Total | ~170k tris, 2 draws, 2 pipelines | |

**Tiers:** see §4.13.

### 4.3 Patch atlas bake (`bakePatchAtlas(seed, size)`)

> **Superseded by §10.** This recipe was prototyped on the CPU before step A1 and rejected: an
> anisotropic Voronoi reads as **stained glass**, because every texel belongs to a coloured
> polygon with straight edges and uniform cell size. Bake **ribbon splats over a cool slate
> matrix** instead (§10.4), with the channel layout in §10.6. The text below is kept as the
> original record. The requirements that still hold are: tileable on a torus, 2D, baked on the
> CPU, deterministic by seed, IDs never filtered.

- Tileable **anisotropic Voronoi** on a torus. Sites on an 8 × 3 jittered grid (±0.35 cell), with
  the metric scaled `(dx/0.6, dy/4.7)` so cells come out tall.
- Domain-warp the lookup by ±0.12 cell (2-octave value noise) so edges are ragged, not polygonal.
- Channels:
  - R = cell id (0–255; 24 sites × tiles salted);
  - G = distance to the nearest edge, scaled 0–255 ↔ 0–0.25 m;
  - B = id of the neighbour across that edge;
  - A = lift side code (0 top, 1 bottom, 2 left, 3 right) × 64 + lip sharpness.
- **Unit test:** the atlas tiles seamlessly, with no ID discontinuity at u = 0/1 or v = 0/1, and
  cell aspect is between 3.5 and 8.

### 4.4 Air (`rbAir(col, P)`) and the backdrop (`rainbark-sky.js`)

**Air.** A closed-form integral along camera → P of the §3.2 density:

```
V = P − camPos; d = |V|; Vy = V.y/d
a0 = clamp((camY − tide)/Hs, −8, 40); a1 = clamp((P.y − tide)/Hs, −8, 40)      // bounded (gotcha #71)
τA = |Vy| > 1e-3 ? σA·Hs·(exp(−max(a0,0)) − exp(−max(a1,0)))/Vy : σA·exp(−max(a0,0))·d
lenBelow = d·clamp((tide − 2 − min(camY,P.y))/(|P.y − camY| + 1e-3), 0, 1)      // portion inside the mist
τ = τA + σM·lenBelow;  T = exp(−min(τ, 30))
inscatter = mix(hazeShade, hazeSun, rbHgMix(dot(V/d, L), 0.55))
          + underglow·0.35·smoothstep(0.0, −0.45, Vy)                          // downward rays glow
return col·T + inscatter·(1 − T)
```

```
rbHgMix(c, g) = x·sqrt(x),  x = (1 − g)² / (1 + g² − 2g·c)    // 1 at c = 1, 0.025 at c = −1 (g = 0.55)
```

**Backdrop.** One far-plane triangle (house pattern, `vertexNode = vec4(pos.xy, 1, 1)`, order 50),
`colorNode = rbBackdrop(dir)`, with `dir = swViewRay` from the camera-basis uniforms:

1. **Haze base:** the `rbAir` inscatter for an infinite ray, plus a vertical gradient (a touch
   darker upward toward the lace, brighter downward toward the mist).
2. **Impostor ranks** (3; 2 on Low; 1 on Minimal). For rank k with D = 300/420/600 m and spacing
   S = 11/13/15 m:
   ```
   az = atan(dir.x, −dir.z)
   cell = floor(az·D/S + o_k)
   loc = fract(az·D/S + o_k) − 0.5 − 0.25·(h(cell) − 0.5)
   halfW = (1.1 + 0.6·h2(cell))/S
   aa = u.pixelAngle·D/S
   m = 1 − smoothstep(halfW − aa, halfW + aa, |loc|)
   ```
   The vertical extent is from the elevation of `tide` (where it dissolves into mist) to `yC`
   (where it dissolves into lace). The colour is the group-3 mean shaded flat (shade side), put
   through `rbAir` at distance D.
3. **Canopy lace** (dir.y > 0):
   ```
   t = (yC − camY)/dir.y
   q = camPos.xz + dir.xz·t
   lace = leafLace((q + wind)/12).level(clamp(log2(t·pixelAngle/(12/512)/|dir.y|), 0, 8))
   ```
   Leaves are `crown` with backlit edges `#6E9A4A` over the zone sky (zenith gradient). The weight
   per zone: Bole only near the top edge (`rbAir` over t fades it); Limb and Crown Light strong.
4. **Mist top** (dir.y < 0 and camY > tide):
   ```
   t = (tide − camY)/dir.y
   hit = camPos + dir·t
   billow = noise3(vec3(hit.xz·0.015 + drift(t), time·0.02)) two octaves
   top = mistTop·(0.72 + 0.45·billow)·(0.55 + 0.45·rbFleck(hit, broad))
       + hazeSun·0.25·rbHgMix(dot(dir, L), 0.6)
       + 0.08·u.groupMean[1]                    // colour bleed from the bark (Iris graft)
   ```
   Then `rbAir` along t. Inside the mist (camY < tide), downward rays give a mist interior that
   darkens with depth.
5. **Floor** (only while `u.drain > 0`):
   - Ray–plane at y = 0, `P = camPos + dir·(−camY/dir.y)`.
   - Gravel, with a **braided stream**: a warped noise band with sun glints, `Stream Glint`, inside flecks.
   - A **curl carpet**: 0.35 m cell dots, ramp-coloured by hash, density `u.carpet = 1 − exp(−sheds/400)`.
   - **Fleck pools**: `rbFleck` at floor depth, broad and soft by physics.
   - All through `rbAir` (with `u.clearAir`), blended under the draining mist transmittance.
6. **No sun disc** in any zone. The sun at azimuth −70° and elevation 50° or more is always out of
   frame, which also avoids gotcha #153.

**Cost.** One full-screen function where no geometry covers it: 3 impostor loops, 1–2 texture
reads up and 2 down. Minimal uses 1 rank and drops the billow's second octave.

### 4.5 Sunflecks (`rbFleck(P)`), the analytic canopy gobo (Sunfall formulation)

```
dC   = (yC − P.y)/L.y                       // distance along the sun ray to the canopy plane
q    = P.xz + L.xz·dC                       // where that ray crosses the canopy
pen  = 0.0093·dC                            // the sun's 0.53° disc → pinhole-image size (m)
lod  = clamp(log2(max(pen, 0.035)/0.035), 0.0, 7.0)     // 0.035 m = 9 m / 256 texels
m    = gapMask.sample(q/9 + u.wind).level(lod)
fl   = smoothstep(u.fleckThr, u.fleckThr + 0.25, m·exp2(0.85·lod))   // gain keeps pinhole images bright discs
// combo pools, max-combined (never summed):
Loop({ start: 0, end: u.gapCount, name: 'gp' }, ({ gp }) => {
    d    = |q − (gap[gp].xy + u.wind·9)|;  r = gap[gp].z
    pool = (1 − smoothstep(r − 0.5·pen, r + 0.5·pen, d))·gap[gp].w
    fl   = max(fl, pool·1.6)                // brighter than ambient flecks
})
```

- Oblique surfaces stretch flecks into ellipses automatically.
- As you climb, `dC` shrinks, so flecks get **smaller and crisper**: about 1.3 m soft at Bole,
  0.2 m crisp at Crown Light. Physically right, and a readable progression.
- **Wind:**
  ```
  u.wind = (0.020·sin(2πt/5.3) + 0.012·sin(2πt/2.9 + 1.7),
            0.016·sin(2πt/6.7 + 0.4) + 0.010·sin(2πt/3.7))  tiles
  ```
  plus a **gust** every 15–25 s: a 1.2 s eased offset of 0.15 tile. Any pixel crosses a fleck
  edge at under 2 Hz (photosensitivity).
- `fleckThr` per zone sets coverage (§3.2).
- Low and Minimal use one read at a fixed `lod = 3` (no per-pixel LOD).
- A **CPU mirror** (`fleckAt(x, y, z)` in core, using the baked mask array) drives vapour spawning
  and drop placement.

### 4.6 Mist floor (`rainbark-mist.js`)

The base look is analytic: `rbAir`'s mist term on trunks plus the backdrop's mist top (§4.4).
Geometry adds **parallax only**:
- **Sheets** (1/2/3/4/5/6 by tier): horizontal 600 m quads centred on the camera's xz, at
  `tide − 4 + 3i`.
  - Density `u.noise3(xz·0.02 + drift, i·0.37)` (2D lattice), with wide ramps
    (`smoothstep(0.25, 0.75)`, gotcha #116).
  - Alpha `= (1 − exp(−σ·3))·density·smoothstep(0.04, 0.22, |V.y|)`, the **grazing fade** (tech fix).
  - Lit `mistTop·(0.6 + 0.4·rbHgMix(dot(V, L), 0.6))`, cooler when seen from below.
  - Premultiplied over.
- **Wisps** (0/1/2/4/6/8): camera-facing quads 20–40 m tall, seeded in the gaps between ranks.
  - Noise-shaped vertical curls rising 0.3 m/s, living 8–14 s.
  - Alpha ≤ 0.25; **keep-out:** collapsed if their screen x falls inside the card ±0.03.

### 4.7 Curls and sheets (`rainbark-curls.js`)

**Geometry.** Instanced strips of 14 length segments × 1 width segment. **Two pools in one draw**
(an `aKind` code): ambient slots `[0, A)` and event slots `[A, A + E)`, with one interleaved
16-float buffer:

| Slots | Contents |
|---|---|
| `aP0` vec4 | spawn xyz, t0 |
| `aDir` vec4 | out x, out z, back z, lane |
| `aDim` vec4 | length L, width W, roll ρ0, rollAmt |
| `aLook` vec4 | outer age, seed (integer), kind (0 ambient, 1 lock curl, 2 sheet, 3 helix, 4 moult sheet), spin |

**Vertex.** Arc-length roll, then tumble, then fall, all closed form. `exp` arguments are bounded.

```
age  = time − t0                                        // dormant slots: age < 0 or > life → scale 0
ρ    = ρ0·(1 − 0.55·s)
φ    = (s·L)/max(ρ, 0.01)
rolled = vec3(w·W, ρ·sin φ, ρ·(1 − cos φ));  flat = vec3(w·W, s·L, 0)
local = mix(flat, rolled, rollAmt(age))                 // sheets unroll→drape, lock curls roll tighter
q     = quat(normalize(vec3(sin(Ωage + α), 0.35, cos(Ωage + α))), ω·age + β)   // precessing tumble
fall  = vT·(age − τF·(1 − exp(−age/τF)))                // eases to terminal speed
out   = outDir·vOut·τO·(1 − exp(−age/τO))
P     = p0 + rbQuatRotate(q, local) + out − fall·Y + backDir·vB·age
        + side·A·sin(2π·0.3·age + 6.28·seed)            // flutter
```

Defaults:

| Kind | vT (m/s) | τF (s) | vOut (m/s) | τO (s) | Spin (rev/s) | A (m) |
|---|---|---|---|---|---|---|
| Lock curl | 1.4 | 0.6 | 0.9 | 0.35 | 0.8 | 0.25 |
| Ambient | 1.2 | — | — | — | 0.6–1.4 | — |
| Sheet | 1.0 | — | — | — | 0.7 (one turn over 1.4 s) | — |
| Helix ribbon | 1.6 | — | — | — | 0.5 | — |

**Keep-out:** the world clamps spawn points and `outDir` so paths stay in the lanes (§6.0). The
vertex stage also fades alpha to 0 where the projected position falls inside `u.cardRect`
expanded by 0.02.

**Fragment.**
- `frontFacing` selects the outer face (old-bark ramp at `outerAge` with a seam texture) or the
  inner face (`Curl Underside`, `DoubleSide`, gotcha #92).
- Backlit translucency: `+ u.sunCol·rbFleck(P)·0.55·(1 − |N·L|)·rbHgMix(dot(V, L), 0.6)·thin`.
  Curls glow ember or ruby **only where they cross the sun**.
- Then `rbAir`. Premultiplied over, alpha 1 except edge AA.

**Ambient curls.** Closed-form periodic schedule per slot (period 6–12 s from the hash). Spawned
on near and mid trunk surfaces above the frame. Slots with `hash > u.ambientRate` collapse:
`u.ambientRate` is 1.0 in menus and 0.35 while a session is live (§6.0).

Seeds are stored as integers (gotcha #87).

### 4.8 FX (`rainbark-fx.js`)

| Pool | Technique | Notes |
|---|---|---|
| **Flakes** | Instanced quads with ballistic paths from knock and moult points; bark-chip shapes 0.04–0.12 m | Spin ≤ 1.5 rev/s (no twinkle strobing); `rbAir` |
| **Drops** (drips, gust veil, B2B rain) | Instanced streaks 0.5 m long at 7 m/s | **Vertex-collapsed where the CPU-mirror or GPU `rbFleck` < 0.05** (only glints in light). Rain: 15% visibility against shade. Desynchronised phases. Keep-out band. |
| **Vapour** | Additive noise wisps rising 0.4 m/s, life 2–4 s | Spawned at CPU-mirror-lit points on near trunks (≤ 10). Off on Low and Minimal. |
| **Amber beads** | Sphere impostors (quad, analytic sphere normal), ≤ 14 per helix | Core `#B8661C` → rim `#E7A43A`; spec glint `#FFE9B0` in flecks; persistent |
| **Shafts** | 3 ambient slabs (Medium+) + 7 combo slabs | Quads oriented along L. Additive `noise·hazeDensity·0.12`. Length fades within 5 m of the pool for combo shafts. **Combo shafts are kept on Low** (pools alone on Minimal). |
| **Leaf bits** | 12 per gap opening, dark green, drifting from the top edge above the station | 1.2 s |

### 4.9 Life (`rainbark-life.js`)

- **Liana:** an instanced catenary ribbon with a tube look, 24 segments, vertex sway. Kept on every tier as a scale cue.
- **Lorikeets** (Medium+, optional cut, §9):
  - 2 birds, rarely 5. Low-poly body plus two wing quads, flapping at 9 Hz (small area).
  - A closed-form spline crossing a gap at 30–80 m every 40–70 s, taking 1.5 s.
  - Colours: green body, blue head, orange breast.

### 4.10 Combo shafts and pool stations

Solved on the CPU by `solveComboGaps(layout, sunDir, camera)`:
- Each station is a world point P on a lane.
- Its gap centre is `q = P.xz + L.xz·(yC − P.y)/L.y`.
- Radius is 0.35 m (Bole; pools come out about 2 m) and 0.25 m from Limb Storey up.
- Written into the `gaps` rows (§4.11).

### 4.11 The event table (`u.events`, 112 vec4 rows; live rows compacted each frame, counts in int uniforms)

| Block | Slots × rows | Row A | Row B | Row C |
|---|---|---|---|---|
| peels | 16 × 3 | trunkCode, yTop, yBot, t0 | θc, θHalf, pieceAge, hard (0/1) | tKill, glossBoost, distance01, — |
| girdles | 12 × 3 | trunkCode, yC, halfH, t0 | codesLo, codesHi (5 × 3-bit codes each, exact in float32), θL, θR | strength, tKill, aftershedT, — |
| helices | 6 × 2 | trunkCode, yTop, turns, t0 | pitch, θ0, width, tKill | |
| knocks | 4 × 1 | trunkCode, y0, t0, strength | | |
| gaps | 7 × 1 | qx, qz, radius, open (eased 0–1) | | |
| moult | 1 × 1 | t0, active, rankDelay, frontDur | | |

Total 48 + 36 + 12 + 4 + 7 + 1 = **108 rows** (round the array to 112).

The **near material's overlay** (`rbEvents`) runs after step 3 of `rbBark`, before colour:

- **Root-pin** shared nodes with `.toVar()` before any `If` (gotcha #68). Every texture read inside
  a branch uses `.level()`.
- Four `Loop`s with distinct names (gotcha #110, #155): `pl < u.peelCount`, `gl < u.girdleCount`,
  `hl < u.helixCount`, `kl < u.knockCount`. Each begins with
  `If(row.trunkCode == vCode && |y − band| < half + 0.5, …)`.
- **Peel:**
  ```
  inBand = θ-window(θc, θHalf) · y-window(yBot, yTop)
  frontY = yTop − (yTop − yBot)·easeOut(clamp((time − t0 − 0.04)/0.36, 0, 1))  // hard: /0.12
  revealed = inBand·[y > frontY]
  ```
  - Revealed: `aLoc = pieceAge + (time − t0)/240` (natural ripening from the piece's own age),
    gloss up, luminance ×(1 + 0.12·exp(−age/3)).
  - Torn rim (±2.5 cm outside the band): 45% shadow line plus a 1 cm `Cambium Cream` edge.
  - At the front: a bright Fleck Gold hairline (≤ +0.2) for the first 60 ms.
  - Erosion: the band mask shrinks by fBm over 1.0 s after tKill, or over 90–150 s naturally.
- **Girdle:**
  - A split hairline at the top edge, 0–100 ms.
  - The lifting band darkens below the descending lip front, 100–420 ms.
  - Then the ring shows First Skin, and segment `i = floor((θ − θL)/(θR − θL)·10)` ripens:
    `aLoc = cellAge_i·smoothstep(0, 1, (time − t0 − 0.6 − 0.04·i)/1.0)`.
  - `cellAge` comes from `rbDecodeCode` (biased `floor(x + 0.5)`, gotcha #88) via the palette
    piece-age rows.
- **Helix:**
  ```
  u_h = (yTop − y)/pitch + (θ − θ0)/(2π)
  strip = [0 ≤ u_h ≤ turns·reveal(t)]·[fract(u_h)·pitch < width]
  ```
  The revealed strip ripens 0 → 0.12 (T's Young Emerald) over 3 s. Bead positions are driven
  from the CPU.
- **Knock:** `sheenK ×= 1 + 0.8·strength·band(y − (y0 + 22·(time − t0)), ±0.5 m)` for 450 ms.
- **Moult** (no loop; also in the **far** material, since it is a single uniform record):
  - `frontElev(t) = 35° − 70°·ease((time − t0 − 0.3 − rank·rankDelay)/frontDur)`
  - `frontY = camY + distH·tan(frontElev)`
  - Above the front, `aLoc → 0` and `wet → 1`.
  - Then the flames: `aLoc = a·smoothstep(0, 1, (time − t0 − 2.0 − 0.25·rank − delayFlame)/2.5)`
    with `delayFlame = (y − yVisBottom)/14 + 0.6·fbm(θ·2, y·0.15)`.

Features a tier does not have (beads, vapour and so on) are not built at all: they are gated in JS,
never multiplied by zero. The overlay itself (peel, girdle, helix, knock, moult) exists on every tier.

### 4.12 Post (`rainbark-post.js`): one output pass

```
RenderPipeline; scenePass = pass(scene, camera, { samples: look.msaa ? 4 : 0 })
bloom (Medium+): BloomNode with house highPassFn (max-channel knee, hue-preserving clamp at 7);
   BLOOM_THRESHOLD 1.25 / max(0.2, exposure) (follows the iris); KNEE 0.5; RADIUS 0.75 (humid halation)
outputFn:
  1 calm zones: house rbRoundBoxSdf over ≤ 5 rects (cards + HUD), radius 16·(H/1080)
      inside: desaturate 40% toward luma, soft clip  m' = min(m, 0.30 + 0.12·m),  mix strength 0.85·calm
      calm also scales: bloom glare ×(1 − 0.85·calm), grain ×(1 − 0.7·calm)
  2 + bloom·strength
  3 exposure (world), iris
  4 rbFilmic: house shoulder k = 0.48, whitening smoothstep(4, 30, peak)·0.7, applied once
  5 grade: shadows → zone.gradeShadow by (1 − luma)²·0.12; highlights → zone.gradeLight by luma²·0.08;
      saturation u.sat (zone × Mistfall), vignette smoothstep(0.5, 1.1, |cv·1.5|)·0.22 (light: high-key)
  6 sRGB encode (renderOutput, NoToneMapping); grain 0.010 (24 fps hash); dither ±1/255
  7 FXAA wraps outputFn on Low/Medium when MSAA is off (Sunset precedent)
falseColor: house bands. Fallback: createPassThroughPipeline + AgX.
outputColorTransform = false.
```

- No screen-space god rays (shafts are geometry, gotcha #103).
- `update({ exposure, iris, sat, zoneA, zoneB, zoneT, bloomBoost, time })`, `setCalmRects`,
  `setSize(w, h, bw, bh)`, `render`, `dispose` (with `disposeBloomNodeDeep`).

### 4.13 Quality tiers ("every tier keeps the whole picture and every event")

| Key | Minimal | Low | Medium | High | Ultra | Extreme |
|---|---|---|---|---|---|---|
| Trunk instances (near ≤ 8 + far) | 12 | 16 | 24 | 32 | 42 | 54 |
| Near grid θ×h | 24×48 | 32×64 | 40×88 | 48×112 | 56×136 | 64×160 |
| Far grid θ×h | 12×24 | 16×32 | 20×48 | 24×64 | 28×80 | 32×96 |
| Limbs | 0 | 6 | 12 | 20 | 28 | 36 |
| Atlas | 256² | 512² | 512² | 512² | 512² | 512² |
| Striation, rim lift | off | off | on | on | on | on |
| Fleck LOD | fixed | fixed | per-pixel | per-pixel | per-pixel + 2-tap penumbra | same |
| Impostor ranks | 1 | 2 | 3 | 3 | 3 | 3 |
| Mist sheets / wisps | 1/0 | 2/1 | 3/2 | 4/4 | 5/6 | 6/8 |
| Curls ambient / event | 40/48 | 80/64 | 160/96 | 260/128 | 360/192 | 480/256 |
| Flakes / drops | 32/64 | 48/96 | 64/160 | 96/240 | 128/320 | 160/400 |
| Vapour / beads | 0/0 | 0/18 | 4/36 | 6/54 | 8/72 | 10/84 |
| Shafts ambient / combo | 0/0 | 0/7 | 3/7 | 3/7 | 3/7 | 3/7 |
| Lorikeets | off | off | 2 | 2–5 | 2–5 | 2–5 |
| MSAA / FXAA | –/– | –/on | –/on | 4×/– | 4×/– | 4×/– |
| Bloom strength @ resolution | – | – | 0.45 @ 0.33 | 0.50 @ 0.45 | 0.55 @ 0.5 | 0.55 @ 0.5 |
| Pixel-ratio cap | 0.7 | 0.85 | 1.0 | 1.15 | 1.35 | 1.6 |

**What Minimal and Low drop** (terms removed in JS, never multiplied by zero, gotcha #72 and #135):
- striation and rim-lift terms;
- per-pixel fleck LOD;
- billow octave 2;
- vapour;
- ambient shafts;
- lorikeets;
- bloom;
- MSAA;
- limbs (Minimal);
- beads (Minimal);
- wisps (Minimal).

**Every event survives:** peel, knock, shed with row colours, moult, gap pools (shafts too on Low),
the Set, helix, sunshower, floor, Climb.

**Budgets** (measure in the playground with `profile=1`):

| Target | Budget |
|---|---|
| High, iGPU 1080p × 1.15 | ≤ 6 ms GPU |
| Medium | ≤ 4.5 ms |
| Low, phone portrait × 0.85, WebGL2 leg | ≤ 9 ms |
| Minimal, phone | ≤ 6 ms |
| First-frame compile | about 10 pipelines (2 trunks, sky, mist, curls, 4 fx, liana, birds) + post |

**Phone strategy:**
- The quality plumbing defaults phones to Low or Medium.
- The portrait composition puts the expensive near trunks in thin edge bands, and the card
  calm-clips the centre.
- Mist sheets scale first.
- No render targets except the bloom chain, so there is no float-target dependency.

### 4.14 WebGL2 and WebGPU guards (checklist)

- **Gotcha #89:** never nest `select` round `Fn` calls; fold to one `select(a.and(b), v, f)` with
  `v.toVar()`. Applies to `rbWarpAge`, girdle decode and lane selection.
- **#99:** one interleaved instance buffer per pool.
- **#102:** two uniform arrays only.
- **#94:** Fresnel and HG written as products; cosines clamped; `pow` bases clamped to [1e-4, 1].
- **#71:** every `exp` argument bounded. Capture portrait early.
- **#105:** clamp interpolated θ, y and strip coordinates.
- **#87 / #88:** integer codes with `+0.5` bias.
- **#68:** root-pin before branches.
- `.level()` on every texture read inside `If` and `Loop`.
- **#117:** captures of additive parts use `parts=sky,…`.
- **Capture both backends** (`&forceWebGL=1`) before anything is called done.

---

## 5. Environmental animation (everything that moves)

All motion is closed-form in time, or integrated where its rate changes (group clocks). That makes
`seek(t)` plus a fixed-step replay deterministic.

| What moves | How | Rate |
|---|---|---|
| **Bark ripening** | Each patch ages along the ramp; it wraps to First Skin with a rim-lift build-up | Lifetime 240–600 s. One clearly visible ambient wrap every 6–10 s somewhere in view. |
| **Group clocks** | `clock_g += dt·rate_g` (rate 1 at rest; quickening §6.6); wrapped at 65 536 s | Uploaded as one vec4 |
| **Grove age drift** | `ageBias` +0.05/min (cap +1.2); Moult resets near groups to −0.6 | 1 ramp stage per ~4 min |
| **Ambient curls** | Shed strips tumbling into the mist | 1–3/s in menus (tier-scaled); **×0.35 while a session is live**; spin 0.6–1.4 rev/s; terminal 1.2 m/s; 0.3 Hz flutter |
| **Sunflecks** | Gobo wind (2 octaves) + gust scramble | Periods 2.9–6.7 s; gust every 15–25 s (1.2 s); any pixel < 2 Hz |
| **Mist floor** | Tide ±8 m (150 s), billow drift 0.4 m/s, sheets drift | Wisp life 8–14 s, rising 0.3 m/s |
| **Bark vapour** | Threads from fleck-lit wet bark (CPU mirror) | 2–4 s each, ≤ 6 (High) |
| **Drips** | Glints falling through flecks only | ~2/s |
| **Liana** | Catenary sway | 0.15 Hz, ±0.4 m |
| **Shafts** | Strength follows mist density | Tide cycle |
| **Sheen** | 0.6 (clearing) to 1.0 (immersion) | Tide cycle |
| **Sun azimuth** | ±3° | Tide cycle |
| **Lorikeets** (Medium+) | A pair crossing a gap | Every 40–70 s, 1.5 s |
| **Camera** | Breath ±0.15/±0.10 m; mouse parallax ±0.25 m | 0.05/0.037 Hz; off under reduced motion |

**Idle and menus (no play).** Ambient curls at full rate, ambient wraps, flecks crawling, tide
breathing, drips, liana, lorikeets. After **60 s with no events** the grove "dozes": the tide
rises 5 m, shafts drop 30%, and gust frequency halves. Any event wakes it over 3 s.

---

## 6. Event language

**Grammar: peel, shed, moult, open, set, rain, unwind, drain, climb.** Every effect is a material
event on bark already in the picture, or a change in the light and air of the grove.

What is absent:
- nothing leaves the card as light;
- no site holds a colour for ~30 s and releases it on a clear (bands **ripen** by the world's own clock);
- no blades of light, no wave per line, no hush-then-flare;
- no spiral or wheel round the card;
- no hour wheel, no camera dip, no rainbow.

### 6.0 Global rules (readability, lanes, safety)

**Anchors:**
- `pickTrunkFace(layout, player, u, rows)` returns `{ trunkCode, θc, yTop, yBot }`.
- **Columns 0–4** go to the Elder lane, **5–9** to the Sister One lane.
- Within a lane, the column maps across its θ width, with the column nearest the card at the
  lane's card-side edge.
- Rows map to world height by casting the camera ray through the row's screen y onto the lane
  surface (`screenToTrunk`).
- MP: the trunk lane nearest that card on the piece's side; if none is free, the nearest R1 near
  code visible outside every card.

**Lanes and keep-out:**
- Falling things (curls, sheets, flakes, drops, wisps) spawn on lane trunks and fall in world
  lanes whose screen projection stays at least 0.02 outside the card and HUD rects.
- The vertex stage also fades anything that would cross.
- **Lock curls pop outward (away from the card) and drift back (−z)**, never across the board.

**Calm and budgets:**
- Ambient curl rate ×0.35 while a session is live: layout live and a lock in the last 20 s.
- Event lights are multiplied by `u.iris` (gotcha #134) and combined with `max()`, never summed.
  Luminance behind the card is calm-clipped.

**Photosensitivity** (WCAG 2.3.1):
- No flash frames.
- Only two events lift **measured mean frame luminance**: the Moult (≤ +0.25 stop, rise ≥ 400 ms,
  decay τ ≥ 800 ms) and the Floor (≤ +0.2 stop, rise 1.2 s).
- Hairline splits are ≤ +0.2 luminance on less than 0.3% of the frame.
- Glints are tiny, spatially random and desynchronised.
- No large area modulates at 3 Hz or more.
- No red full-field: ruby only ever appears in bark patches.
- HDR is clamped hue-preservingly before bloom.

**Reduced motion:**
- the Climb becomes a 1.2 s mist-veil crossfade;
- curl and sheet fall speed ×0.5;
- the moult front runs at half speed;
- quickening is capped at the ×4 behaviour;
- the helix unwinding becomes a 0.6 s reveal;
- camera breath and parallax are off;
- rain streak length ×0.5.

**Settings:**
- `pieceLockRipple` off: no Peel and no Knock.
- `backgroundComboEffects` off: no event reactions at all; the ambient world continues.

**Summary of where each beat plays** (16:9 reference):

| Beat | Where | Scale |
|---|---|---|
| Peel / Knock | Elder lane (x .19–.26) or Sister lane (x .82–.86), at the piece's rows | Small, tactile |
| Shed | Rings across both near trunks at each cleared row (+R1 at ×2, sheets in depth at ×3) | Medium |
| Moult | Every trunk in view | Largest |
| Gap pools | 7 fixed stations on the lanes | Counted |
| Set | Curtain of curls in both outer lanes | Sized by peak |
| Sunshower | The whole grove's air and gloss | Persistent |
| Unwinding | One near trunk at the T's rows | Persistent scar |
| Floor | Lower half, between trunks | Rare |
| Climb | Whole world slides down | Rare |

### 6.1 Lock: **the Peel**

- **Where:** the lane at the piece's occupied rows (`rows` min to max).
  - Strip height = the rows' screen span cast to the trunk (Elder 2–4 rows = 0.5–1.0 m).
  - Strip width 0.45 m on the Elder, 0.6 m on Sister One.
  - Phone: the edge-band lanes. The curl's fall swings into the bottom band.

| Time | What happens |
|---|---|
| 0–60 ms | A **hairline split** opens across the strip's top edge (Fleck Gold, ≤ +0.2). |
| 40–400 ms | The strip **unzips downward**, rolling into a curl at its front (an event curl slot rides the front, rollAmt 0 → 0.9). Under it a band of the **piece's colour** appears, which is the bark at that piece's age (§3.5), wet. A **sheen sweep** follows the front. A **torn-rim** shadow line and a cambium-cream edge frame the band. |
| 400–550 ms | The curl **detaches**, pops 0.35 m **outward**, and starts its tumble (0.8 rev/s). |
| 0.55–4.0 s | It falls (terminal 1.4 m/s, flutter ±0.25 m), drifting back 0.4 m/s. It glows ember or ruby where it crosses flecks or shafts, then blues and dissolves into the mist. |
| 0–3 s | Band luminance +12% (τ 3 s); gloss decays over 20 s. |
| ongoing | The band **ripens** from the piece's age at the natural rate (1/240 per s). Its edge erodes into the mosaic over 90–150 s, or over 1.0 s when its slot is recycled (16 slots; at most 12 visible). |

- **Colours:** the band is the piece colour. Curl outer is Husk Maroon/Old Husk; inner is Curl
  Underside. The rim is Cambium Cream.
- **Mechanism:** the bark sheds a strip; fresh bark at that age is exposed.
- **Reads as:** "my piece peeled a strip off the giant, and its colour is underneath." Your last
  dozen pieces stand as a vertical column of fresh bands in the dark peel lane.
- **Safety:** no flash; at most 3 strips animate per lane.

### 6.2 Hard drop: **the Knock** (folded into the same lock)

| Time | What happens |
|---|---|
| 0–120 ms | The strip **tears off whole** (no slow unzip). The curl ejects at 1.5× speed and 1.4 rev/s. |
| 0–450 ms | A **knock pulse** runs **up** the trunk from the impact: a gloss band ±0.5 m at 22 m/s. Strength `k = 0.4 + 0.6·min(1, distance/18)`, sheen ×(1 + 0.8k). |
| 0–2.5 s | **4 + round(10k) flakes** and 3–6 beaded drops shake down from 2–6 m above the impact. Drops glint only inside flecks. |

- **Rate limit:** one knock per trunk per 250 ms (a new one restarts the slot).
- **No camera motion.**
- **Reads as:** "thump: the giant shook."

### 6.3 Line clear ×1/2/3: **the Shed**

- **Where:** at each cleared row's screen height, on **both** near trunks (the full visible arc).
- Ring height is 1.25 rows, cast to the trunk: Elder ≈ 0.31 m, Sister One ≈ 0.87 m.
- Rows come from `clearedRows − 4`, or `viewportOrigin` in Infinity, or bottom rows `19 − i` when
  rows are empty (Odyssey synthetic clears).
- Lowest row first, **120 ms stagger**.

| Time (per row) | What happens |
|---|---|
| 0–100 ms | A hairline splits along the girdle's top edge, round the visible arc. |
| 100–420 ms | The girdle **sheet** peels down and outward: two wide sheet strips per trunk drape off the arc. |
| 420 ms | The sheet drops free, turning once over 1.4 s, falling outward and back, backlit where lit. |
| 420–600 ms | The exposed **ring blazes First Skin**: wet chartreuse, luminance capped at 1.1·iris pre-tone-map. |
| 600–1600 ms | **The ring ripens into the cleared row's own colours**, left to right across the visible arc. Segment i (of 10) ripens to cell i's bark age (I stays chartreuse, T emerald, Z teal, L cobalt, S violet, J ruby, O ember, garbage or unknown husk), 40 ms stagger. |
| ongoing | Natural ageing; erosion after 60–120 s or on slot recycle (12 slots). |

- **×2:** the near R1 trunks (codes 4/5) shed fainter rings at the same screen heights, +150 ms.
- **×3:** R2 trunks drop sheets too (sheets only, no reveal). The bottom band below the card fills
  with a slow cascade of maroon, ember and violet sheets.
- **Cascade waves k ≥ 2:** an **aftershed** 600 ms after each wave. The same girdles drop a
  second, smaller sheet, plus 20% more curls; there is no new ring.
- **Colours:** First Skin, then the row's piece colours, from the director's **shadow well** (§7.2).
- **Reads as:** "one bright ring per line, and it turns into my row." Rings are countable.
- **Safety:** no exposure change; ring brightness is capped through the iris.

### 6.4 (no separate soft-drop or hold beats; neither mechanic exists on the bus)

### 6.5 Four lines: **the Great Moult**

| Time | What happens |
|---|---|
| 0–300 ms | **The creak** (native anticipation, no darkening). Every old rim in view lifts a little: `u.creak` 0 → 1 → 0.3, rim-lift term ≥ 0.35·creak. Thousands of lips catch the light as a random-phase shiver (≤ +0.08 luminance per lip, frame mean ≤ +3%). |
| 300–1200 ms | **The moult front** sweeps down every trunk from the top of frame, in screen angle (elevation 35° → −35° over 0.9 s), near ranks first, +50 ms per rank. At the front, old bark comes away in sheets: 64–200 moult sheets and curls by tier (ember, ruby, violet, maroon) pour into the abyss, glowing where backlit. |
| 0.6–2.0 s | The grove stands **naked in First Skin**: every trunk luminous wet lime, `wet = 1`. Vapour lifts from all lit near trunks; the mist sheets brighten. Exposure is handled by the iris (`exposure·2^(−0.25·env)`) so First Skin never clips; measured mean lift ≤ +0.25 stop. |
| 2.0–8.0 s | **The ripening.** Colour climbs each trunk from the bottom of the frame in **flame-shaped fingers** (§4.11), through emerald, teal, cobalt, violet, ruby and ember, rank by rank (+0.25 s per rank), until each patch rejoins its own steady age. |
| after | Near `ageBias` is −0.6, so the grove is visibly **younger**: greens, teals and blues. It relaxes back over 6 min, then drifts older. |

- **Reads as:** "the whole forest changed its skin." The grove's colour temperature is also a
  readable record of how long ago you last cleared four lines.
- The board's own gold flash (0.4) stacks; we add **no** flash.

### 6.6 Combo chain (true combo, `ComboTracker` per player slot): **Opening the canopy** plus **Quickening**

**The counter: canopy gaps.** Link n ≥ 2 opens **gap n − 1** (max 7):

| Time | What happens |
|---|---|
| 0–500 ms | A branch high in the canopy shifts. A puff of 12 leaf bits drifts down from the top edge above the station (1.2 s). A **big pinhole sun-pool** (≈ 2 m on the Elder, elliptical, ×1.6 brighter than ambient flecks) slides onto its fixed **station**. A short slanted **shaft** lights the haze for 5 m above it. |

| Station | Elder high | Sister One high | Elder mid | Sister One mid | Elder low | Sister One low | Sister Two mid (+R1b) |
|---|---|---|---|---|---|---|---|
| Opened at | ×2 | ×3 | ×4 | ×5 | ×6 | ×7 | ×8+ |
| Screen y | 0.24 | 0.30 | 0.50 | 0.55 | 0.76 | 0.80 | 0.50 |

- Phone: stations sit in the edge bands at y 0.20/0.25/0.45/0.50/0.68/0.72, and #7 brightens the
  top-band crown gap.
- **A glance counts the chain: big pools with beams = chain − 1.**
- Pools land on the peel lanes, so they **light your stack's bands** (bands flare where a pool rests).

**The gauge: quickening.** Integrated group-clock rates, eased with τ 0.8 s:

| Group | Rate | Joins at |
|---|---|---|
| Elder (g0) | `1 + 1.6·(n − 1)` | ×2 |
| Sisters (g1) | same | ×3 |
| R1/R2 (g2) | ×0.6 of that | ×5 |
| Far (g3) | ×0.4 of that | ×7 |

Rates cap at n = 8 (×12.2).

| Chain | Escalation |
|---|---|
| ×2 | Patches near the card visibly ripen. Colour drifts up as slow flame. |
| ×3 | Ambient wraps double on the near trunks. |
| ×4 | Fleck wind amplitude ×1.5: restless, crawling light. |
| ×5 | Vapour lifts from every lit near trunk. |
| ×6 | A canopy gust: a 3 s veil of glinting drops in the outer lanes. |
| ×7+ | Patch UVs scroll up 0.12 m/s on the near trunks. Colour **climbs** the bark, patch-wise. Never a global hue cycle. |

### 6.7 Combo release (`combo(0)` after peak p ≥ 2; delivered on the breaking lock, §7.2): **the Set**

| Time | What happens |
|---|---|
| 0–600 ms | The time-lapse snaps back (rates → 1, τ 0.25 s). The quickened patches **set**: sheen −30% for 4 s. |
| 0 to 0.12·(p − 1) s | Gaps close in reverse order, 120 ms apart, each with a puff of leaf bits. |
| 200–3200 ms | A **curtain of curls** falls from both near trunks in the outer lanes, spawned top to bottom over 1.2 s. Count = `min(4·(p − 1), tierCap)`: ×2 gives 4, ×5 gives 16, ×8 gives 28 (Extreme cap 40). The curls glow as they cross the remaining light. |
| 300–2300 ms | A **vapour roll** slides down off the Elder and Sister One into the mist (the exhale). |

- **Reads as:** a full stop that celebrates the chain you built.
- **Resume:** a combo rise within 0.6 s of a release (async MP clears) reopens gaps without
  restarting the curtain.

### 6.8 Back-to-back (B2B live state): **the Sunshower**

- The director reports `b2b(level)`: 1–3 for successive B2B events, and 0 when it infers a break
  (a wave-1 clear with lines < 4 and no T-spin; no producer sends `active:false`).

| Time | What happens |
|---|---|
| 0–2 s (on level ≥ 1) | A **sunshower** fades in: `120·level` drops (tier-scaled) of 0.5 m streaks at 7 m/s. Fully visible only inside flecks and shafts; 15% against shade; in the outer lanes and in depth. |
| 0–3 s | **Wetness** → `0.5 + 0.2·level`: albedo ×(1 − 0.2·wet), chroma ×(1 + 0.3·wet), gloss and sheen up. The grove's colours deepen and glisten ("the colours are richest wet"). The Elder's sheen gains slow vertical **runnels** (scrolling 0.4 m/s). |
| while live | Each new B2B steps rain and wetness heavier. |
| break | Rain stops over 2 s. Wetness decays (τ 8 s), with faint vapour from lit bark as it dries. |

- **Reads as:** "my back-to-backs brought the rain, and the forest glows." Persistent, grove-wide,
  unmistakable, and there is no rainbow.

### 6.9 T-spin (1/2/3 lines): **the Unwinding**

- **Where:** on the T's side (u < 0.5: Elder, else Sister One), starting at the T's top row.

| Time | What happens |
|---|---|
| 0–150 ms | A diagonal hairline splits (spiral grain). |
| 150–1550 ms | A **helical strip** (0.30 m wide on the Elder, 0.6 m on Sister One) **unwinds** down the trunk like an apple peel, for **1/2/3 turns** (pitch 0.9 m/turn on the Elder, 2.2 m on Sister One). The freed strip coils into a **corkscrew ribbon** (event curl kind 3) that drops and tumbles into the mist. |
| 150–4500 ms | The exposed helix ripens from First Skin to **Young Emerald** (the T piece's own age) over 3 s. |
| 0.9–2.5 s | **Amber resin beads** well up along the helix edges (6/10/14 beads): glossy, translucent, glinting gold in flecks. |
| rest of the level | Scar and beads stay; a slow natural ripen. ≤ 6 helix slots; the oldest heals over 4 s. |

- **Reads as:** "the tree twisted out of its bark." **Count the diagonal stripes = T-spin lines.**
  It never circles the card, and there is no red and no wound language.

### 6.10 Perfect clear (standalone, a later frame, `rows: []`): **the Floor**

| Time | What happens |
|---|---|
| 0–1.2 s | The **mist drains**: `tide` eases to −40 m, σA ×0.35 ("the air clears"), mist sheets fade. |
| 1.2–9 s | For the first time you see the **forest floor**, 20–150 m below depending on the zone. Buttress roots like cathedral foundations (real trunk geometry). A braided stream glinting over golden gravel. The floor is **carpeted with every curl shed this session**, density `1 − exp(−sheds/400)`. Every fleck in the grove gathers into broad soft pools on the floor. Exposure lift ≤ +0.2 stop (rise 1.2 s). |
| 9–15 s | Mist and air return. |

- **Reads as:** "the world opened downward." The rarest event pays off the floating tension, and
  it is session-aware.

### 6.11 Level up: **the Climb**

- **Start:** delayed until **1.2 s after the latest clear**. LEVEL_UP arrives in the same tick as
  its wave's LINE_CLEAR, so the shed always reads first at a still camera.

| Time | What happens |
|---|---|
| 0–3.5 s | `camY += 12 m` (smootherstep). The giants slide down past you, and your old peel bands slide out of frame below (the record stays on the bark). The mist floor falls away. Entering a new zone crossfades its hex set, air, sun elevation and tide top over the rise. |
| c 11 → 0 (L13+) | **Mist veil.** The tide rises past the camera (1.5 s), the camera resets to 20 m inside the veil, and the veil drains (2.5 s). It reads as the mist swallowing the view, not a cut. |

- **Reduced motion:** a 1.2 s crossfade through a mist veil; the camera never moves.
- A silent level-up on rebuild jumps straight to the right height.
- Modes without LEVEL_UP: climb every 15 cleared lines; LEVEL_UP resyncs.

### 6.12 Game over / top-out (window `gameOver`, `modeStopped`): **Mistfall**

| Time | What happens |
|---|---|
| 0–4 s | The mist rises past the camera (`tide → camY + 15`). The grove softens to blue silhouettes, saturation −40% (Mistfall hex set), the last curls settle, ambient rate → 0.2. |
| Next session (first lock, `modeStarted`, or `resetSession` + layout live) | **Morning returns:** the mist drains back to the zone tide over 3 s. |

### 6.13 Other modes

- **Meditation (`serenity`):** no board. A click or tap **peels a strip at the nearest lane point**
  to the click's screen y, cycling through the 7 bark ages. Click combos (`comboCount`) open gaps
  and quicken. Rate-limited to 4 peels/s.
- **Local MP** (up to 4 cards): per-card lanes (§6.0); the world opens gaps and quickens to the
  **maximum** chain on screen. MP sends no TSPIN, B2B or LEVEL_UP, so it uses clock climbs.
  Cascade depth arrives only as COMBO, emitted before that wave's LINE_CLEAR, so the director
  stashes it and attaches it to the next LINE_CLEAR (`docs/theme-concepts/reference/events.md`
  §11, item 3).
- **Online MP:** slot 0; add `#online-main-board canvas` to the solo selectors.
- **Infinity:** `viewportOrigin` for rows and u.
- **Odyssey:** synthetic clears with empty rows fall back to rows `19 − i`; the goal flourish
  (comboCount 6) opens 5 gaps.

---

## 7. Module plan and build order

### 7.1 Files (`src/themes/rainbark/`)

| File | Role |
|---|---|
| `rainbark-core.js` | Three-free:<br>- `ZONES`, `RAMP_STOPS`, `PIECE_AGE`/`PIECE_CODE` (I0 T1 Z2 L3 S4 J5 O6 G7), `TIMING`, `EVENT_ROWS`, `climbHeight(level)`, `tideAt(t, zone)`<br>- `planGrove(seed, tier)`, `screenToTrunk(trunk, cam, sx, sy)`, `pickTrunkFace(layout, player, u, rows)`, `solveComboGaps(...)`<br>- group-clock helpers, `warpAge`, `groupMean(ramp, clock, bias)`, `fleckAt(x, y, z)` (CPU mirror), `packCodes`/`unpackCodes`<br>- `cellsFromMatrix`, `approach`, `smooth`, `mulberry32` |
| `rainbark-bake.js` | Three-free typed-array bakes: `bakePatchAtlas`, `bakeGapMask` (+ CPU mips), `bakeLeafLace` (+ mips), `bakeFbm` (+ mips), `bakeLattice`, `bakeRamp`. Deterministic by seed. |
| `rainbark-tsl.js` | `createRainbarkUniforms` (`u`, `events`, `palette`, counts); `DataTexture` wrappers; laid-out pure helpers; inline builders `rbAir`, `rbFleck`, `rbSkyLight`, `rbBackdrop`, `rbBark`, `rbEvents`, `rbCurlLight`; `rbFxMaterial` (premultiplied), `rbPart`. Also `export *` from core. |
| `rainbark-sky.js` | Backdrop: haze, impostors, lace, mist top, floor |
| `rainbark-trunks.js` | Near and far instanced draws, limbs, bark materials (near with `rbEvents`) |
| `rainbark-mist.js` | Sheets and wisps |
| `rainbark-curls.js` | Ambient and event curl pool (lock curls, sheets, helix ribbons, moult sheets) |
| `rainbark-fx.js` | Flakes, drops/rain, vapour, beads, shafts, leaf bits |
| `rainbark-life.js` | Liana, lorikeets |
| `rainbark-world.js` | `RainbarkWorld`:<br>- **`WORLD_METHODS`**: `build, bindCamera, showOnlyParts, setViewport, setLayout, setReducedMotion, seek, resetSession, restCamera, updateCamera, onLock, onClear, onCombo, levelUp, update, getPostState, getState, dispose`<br>- plus `onB2B(level)`, `onGameOver()`, `onSessionStart()`<br>- the camera rig (Climb, breath, parallax); timed queue; slot rings; group clocks; session counters (sheds); writes `u`<br>- exports `REST_RIG`, `fovForAspect`, `RAINBARK_PARTS = ['sky','trunks','mist','curls','fx','life']` |
| `rainbark-director.js` | Clone of ocean's director (try/finally delivery, `broke` flag) plus serenity-warp's `shape`/`cells`. Adds:<br>(a) **shadow well**: 5 slots × 10×24 codes, filled from PIECE_LOCK snapshots, collapsed on clears; unknown cells = code 7, with a ring fallback of the last 8 lock codes; Infinity keys sparse absolute rows (last 64)<br>(b) `sink.clear(...).rowCodes` (≤ 4 × 10 codes, lowest row first)<br>(c) **combo-break inference**: at `flush()`, a slot with a staged lock, no staged clear and reported combo > 0 sends `combo(0)` now; the tracker's later 0 is suppressed; a late clear before the next lock resumes<br>(d) **B2B live level** with break inference → `sink.b2b(level, player)`<br>(e) the MP pending-COMBO stash<br>(f) `distance` on hard drops |
| `rainbark-composition.js` | Cloned compositor + `'#online-main-board canvas'` + `trunkBand(layout, aspect)` (§2.3 solver: Elder, Sisters, lanes, keep-out rects, station screen points) |
| `rainbark-post.js` | `RainbarkPost`, `POST_LOOK` per tier, `createPassThroughPipeline` |
| `rainbark-quality.js` | `QUALITY` (§4.13), `QUALITY_NAMES`, `tierFor` |
| `rainbark-theme.js` | Clone of serenity-warp's adapter: ids, flags, the `CLEAR_COLOR` 0x3a4a72 renderer and GPU loss handling, layout reads, calm zones, settings. **Sink:** `lock`, `clear`, `combo` → `reportCombo` (max over players), `levelUp`, **`b2b` → `world.onB2B` (max over players)**. Also `gameOver` / `modeStopped` → `world.onGameOver(); resetSession()`, and `modeStarted` → `world.onSessionStart()`. |
| `rainbark-tetrominos.js` | §3.5 |
| `rainbark-theme-icon.png` | 512² circular, from the icon frame (§8). Copy to `public/assets/themes/rainbark-theme-icon.png`. |
| `src/playground/effects/rainbark.effect.js` | Mounts the same `RainbarkWorld` + `RainbarkPost` (`capture: true`), imports only `three/webgpu` + its own modules |

> **Build status at the time of writing (2026-10-12).** Committed on the branch (`585ab55`):
> `rainbark-core.js`, `-tsl.js`, `-sky.js` (zone-air placeholder), `-world.js`, `-director.js`,
> `-composition.js`, `-post.js`, `-quality.js`, `-theme.js`, `-tetrominos.js`, the icon and the
> playground effect, with tests for the theme, world, core, director, composition and the rename
> migration. In progress and **uncommitted**: `rainbark-bake.js` and `rainbark-trunks.js` (steps
> A1–A2, with `rainbark-bake`, `rainbark-grove` and `rainbark-trunks` tests) and the backdrop's
> impostor ranks and canopy in `rainbark-sky.js`. Not started:
> `rainbark-mist.js`, `-curls.js`, `-fx.js`, `-life.js`. Where the in-progress work already
> departs from this spec (re-check each against the code before relying on it):
> - the old end of the age ramp is cool slate (§10.5), not maroon and brown husk;
> - `bakePatchAtlas` lays ribbon splats over a matrix (§10.4), with a matrix share of 40–48% and a
>   few pale old-skin islands laid first, not the anisotropic Voronoi of §4.3;
> - the canopy is a **crown mask** (`bakeCrownMask`: crowns 15–25 m across with channels of crown
>   shyness and a few big holes, on a 72 m tile) plus the leaf lace, where §4.0 lists a 9 m
>   `gapMask` of pinholes; check how `rbFleck` (§4.5) reads it before building step A4;
> - the Bole tide is 26 ± 6 m, not 38 ± 8 (note under §2.3).

**Playground parameters** (all catalogued in `src/ui/url-parameters/playground-parameters.js`,
each with `scope` naming `rainbark` and `sources` naming the effect file):

| Param | Meaning |
|---|---|
| `t` | Fixed time |
| `quality` | Minimal…Extreme; default High |
| `level` | 1–13; default 4 |
| `board`, `statsHud` | Mock board with the real selectors (calm zones and lanes exercised) |
| `locks=<n>` | Pre-play n locks (alternating lanes and pieces) |
| `event` | `lock`, `drop`, `clear`, `quad`, `tspin`, `perfect`, `levelUp`, **`release`**, **`b2b`**, **`gameOver`** |
| `eventAge` | s, default 0.4 |
| `eventLevel` | Default level + 1 |
| `lines` | 1–4, default 2 |
| `row` | Default 9 |
| `u` | Default 0.3 |
| `piece`, `turns`, `color` | Piece shape, quarter turns, colour override |
| **`dist`** | Hard-drop distance, default 14 |
| **`cascade`** | Waves for `clear`, default 1 |
| `combo=<n>` | Hold a chain |
| **`peak=<n>`** | For `release`, default 6 |
| **`b2b=<0–3>`** | Hold the sunshower |
| **`session=<min>`** | Grove age drift, default 2 |
| **`sheds=<n>`** | Floor carpet, default 400 |
| `reduce`, `parts`, `noPost`, `falseColor`, `bloom` | Reduced motion, part filter, post off, false colour, bloom override |
| `px`, `py` | Hold the pointer |
| `icon`, `iconFov`, `iconYaw`, `iconPitch` | Icon frame |
| `demo` | 40 s loop of locks, clears, chains, quad, T-spin and B2B |

**URL catalogue row** (`theme-parameters.js` `captureThemes`): `['rainbark', 'rainbark', 'Rainbark', 'sky, trunks, mist, curls, fx, life']`.

**Tests** (clone serenity-warp's five plus):

| Test | What it covers |
|---|---|
| `rainbark-core` | Palette gate 0/7; ramp stops equal the piece colours; `warpAge` monotonic; `packCodes` round-trip; `planGrove` keep-outs; `screenToTrunk`; `climbHeight`; `tideAt` |
| `rainbark-bake` | Atlas tiles seamlessly; cell aspect 3.5–8; mips present |
| `rainbark-director` | Shadow-well row colours; combo break on the breaking lock; B2B break inference; MP COMBO stash; empty-row fallback |
| `rainbark-composition` | Elder and Sister silhouettes never intersect card or HUD rects at 0.46, 1.0, 1.78 and 2.37 aspects |
| `rainbark-world` | `WORLD_METHODS`; dormant pools; seek determinism |
| `rainbark-theme` | Node graphs built for all six tiers with `forceWebGL: true` and no GPU; banned-API greps; flag literals |
| `rainbark-playground` | Params equal the catalogue |

Also the rename migration test (rename stage).

### 7.2 Director and sink contract (deltas against serenity-warp)

```
sink.lock({ player, rows, u, hardDrop, distance, color, shape, cells, screen })
sink.clear({ player, rows, lines, combo, cascade, tspin, perfect, b2b, rowCodes, screen })
sink.combo(n, player)            // 0 = broke; inferred on the breaking lock (same-tick rule: PIECE_LOCK and
                                 // wave-1 LINE_CLEAR share one synchronous tick, so "lock without clear in this
                                 // flush" = chain broken); idempotent against the tracker's late 0
sink.b2b(level, player)          // 0..3; 0 inferred from a non-difficult wave-1 clear
sink.levelUp(level)
```

### 7.3 Staged build order

Each step is **one small effect per session** (CLAUDE.md). Every step ends with a
playground screenshot via chrome-devtools (wait for `__PLAYGROUND_READY__`, then a few rAFs or
`__PLAYGROUND__.seek(t)`), a clean console, and one Low-tier capture.

> In a cloud container the chrome-devtools MCP may not connect. Use the headless Chromium +
> SwiftShader capture tooling in `docs/theme-concepts/PLAYBOOK.md` §5 (`shot.mjs` for playground
> captures, `game.mjs` for the real game, `switch-away.mjs` for the switch-away check, all printed
> in full; save them in your scratchpad, never in the repo). It includes a harness-only
> `GPUTexture.createView` swizzle shim that Chromium 141 needs with three r186. Run the gates in
> PLAYBOOK §6.1 before every commit and §6.2 before asking to merge.

**Stage 0: scaffold** (before A; done in `585ab55`). Clone the adapter, director, composition and quality.
Build a minimal world (sky only) satisfying `WORLD_METHODS`. Do the registry, alias, container
CSS, URL rows, music retitle and Odyssey orb rename. Delete `src/themes/cosmic-chimes/` and the
obsolete tests (see `docs/theme-concepts/PLAYBOOK.md` §2–§4, `docs/theme-concepts/reference/adapter.md`
§6 and `docs/theme-concepts/reference/rename.md`).

**Stage A: environment**

| Step | Work | Acceptance |
|---|---|---|
| **A1** | **The bark on ONE trunk** (`parts=trunks`, Elder only via `?solo=elder` debug, not catalogued; remove before merge or catalogue it). Atlas bake (start from the CPU lab in §10: ribbon splats over a slate matrix, not Voronoi), age ramp, rims, seams, striation, sheen strip, fluting, buttress. Iterate against a reference photo of real *E. deglupta* bark with `ref=/playground-refs/rainbark-bark.jpg&refMode=split`, using a user-supplied or licence-clear image that is **never shipped** (`public/playground-refs/` is served, so never commit the file there; the photos in §10.1 are copyrighted). | §4.2 checklist; reads as bark at 9 m **and** at 45 m. |
| **A2** | Grove plan + composition solver + backdrop (haze, impostor ranks, lace). | Shot 1 composition at 16:9, 21:9 and portrait. |
| **A3** | `rbAir` + mist top + sheets/wisps + underglow; zones via `level=`. | Rank-by-rank desaturation; no slices at grazing angles. |
| **A4** | `rbFleck` gobo (wind, gust) + specular + tide clock + group clocks and age drift. | Flecks shrink and sharpen with level. |
| **A5** | Ambient curls, liana, drips, vapour (CPU mirror), shafts, limbs. | — |

**Stage B: gameplay FX**

| Step | Work |
|---|---|
| **B1** | Peel + Knock + event curl slots + peel lane + lanes and keep-out |
| **B2** | Shed: girdle overlay, sheets, shadow-well row colours (director), cascades |
| **B3** | Great Moult: creak, front, sheets, flames, age-bias reset, iris |
| **B4** | Combo: gaps and pools, stations, shafts, leaf bits, quickening, the Set; director break inference |
| **B5** | Unwinding (helix, ribbon, beads) + Sunshower (rain, wetness, runnels) + director B2B level |
| **B6** | Floor (backdrop), Climb (+ veil wrap, reduced-motion crossfade), Mistfall/morning, meditation, MP lanes |

**Stage C: post, tiers, phone, icon**

| Step | Work |
|---|---|
| **C1** | Post: calm zones tuned with `board=1`, bloom knee and iris, grade per zone, FXAA/MSAA, falseColor |
| **C2** | Quality tiers; Minimal and Low captures; the WebGL2 leg on every event shot |
| **C3** | Portrait and 21:9 passes (lanes, stations, keep-out) |
| **C4** | Icon frame, theme adapter end-to-end in the game, tests, docs (`docs/RAINBARK_VISUAL_OVERHAUL_2026-10.md` + `docs/rainbark-captures/`, both planned) |

---

## 8. Acceptance shots

All shots use `/playground.html?effect=rainbark&…`. Default viewport **D** = 1920×1080. **W** =
2560×1080. **P** = 390×844 (DPR 1). `quality=High` unless stated. Capture both backends for the
starred shots.

| # | Proves | Query (after `effect=rainbark&`) | VP |
|---|---|---|---|
| 1★ | Reference picture: hero bark, asymmetric composition, blue air, ranks, mist floor, flecks | `t=55&level=4` | D |
| 2★ | Board readability: card on calm luminous haze, lanes clear, HUD on air | `t=55&level=4&board=1` | D |
| 3 | Peel mid-unzip, curl forming, torn rim | `t=55&level=4&board=1&event=lock&piece=L&u=0.15&row=12&eventAge=0.3` | D |
| 4 | Band column in both lanes; a curl falling **outward** | `t=55&level=4&board=1&locks=10&event=lock&piece=I&u=0.85&row=15&eventAge=1.4` | D |
| 5 | Knock pulse and flakes | `t=55&level=4&board=1&event=drop&piece=O&u=0.3&row=17&dist=18&eventAge=0.25` | D |
| 6★ | Shed ×3: rings blazing, sheets falling | `t=55&level=4&board=1&locks=10&event=clear&lines=3&row=16&eventAge=0.75` | D |
| 7 | Rings ripened into the rows' colours | same as 6 with `eventAge=1.8` | D |
| 8★ | Great Moult: naked First Skin, sheets pouring | `t=55&level=4&event=quad&row=16&eventAge=1.3` | D |
| 9 | Great Moult: ripening flames | `t=55&level=4&event=quad&row=16&eventAge=4.2` | D |
| 10★ | Combo ×6: five counted pools with beams, quickening | `t=55&level=4&board=1&combo=6` | D |
| 11 | The Set after ×7: gaps closing, curl curtain, vapour roll | `t=55&level=4&board=1&event=release&peak=7&eventAge=1.2` | D |
| 12 | Unwinding: two diagonal stripes and amber beads | `t=55&level=4&board=1&event=tspin&lines=2&u=0.2&row=13&eventAge=2.0` | D |
| 13★ | The Floor: drained mist, roots, stream, curl carpet | `t=55&level=4&event=perfect&eventAge=5&sheds=700` | D |
| 14★ | Phone portrait: edge-band lanes, top crown gap, bottom mist, lock legible | `t=55&level=4&board=1&event=lock&piece=T&u=0.2&row=10&eventAge=0.5` | P |

**Required sweep** (not counted above, all must pass):
- Zones: `t=55&level=1`, `level=7`, `level=10`, `level=12`.
- Sunshower: `t=55&level=4&b2b=2`.
- Ultrawide: `t=55&level=4&board=1` @ W.
- Low on WebGL2: `quality=Low&forceWebGL=1&board=1&t=55&level=4&event=clear&lines=2&eventAge=0.8` @ P.
- Minimal: `quality=Minimal&t=55&level=4&board=1` @ D.
- False colour: `falseColor=1&t=55&level=4` (only flecks, sheen and backlit curls exceed the knee).
- Reduced motion: `reduce=1&event=levelUp&eventAge=0.6`.

Each sweep needs a clean console (no WGSL or validation errors) and `__PLAYGROUND__.diagnostics()`
read back.

**Icon frame** (square 512×512, circular crop):
`t=55&level=4&icon=1&iconFov=30&iconYaw=24&iconPitch=8&event=lock&piece=I&u=0.2&row=8&eventAge=0.35`.

What it must show: the Elder's painted face filling the circle; one chartreuse strip peeling into
a curl inside a sunfleck; a wedge of blue air and a ghost trunk behind; a hint of glowing mist at
the bottom. That is one hero motif, no tree silhouette, no moon and no sun disc. Tune
yaw and pitch so the curl sits on the lower-third intersection.

---

## 9. Risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | **The bark reads as camouflage, tie-dye or painted pipes** | A1 is a dedicated session against a reference photo, with the §4.2 checklist as the gate. A ribbon-splat atlas over a slate matrix (§10; the spec's anisotropic warped Voronoi was prototyped and rejected), rims, seams, striation, sheen strip, fluting. Old-dominant age distribution (55–65% in ages 0.66–1.0). The far footprint fade stops noise turning into confetti. |
| 2 | **"Another forest"** | No ground, horizon, canopy frame, moon, low golden sun or fireflies. Blue high-sun air, vertical abyss, bark as hero. Before Stage B, compare shot 1 side by side with fall, forest, golden-forest, moonlit-forest and stillwater screenshots. The icon is a bark face, not a tree. |
| 3 | **Flanking-tree cliché returns** | The solver keeps the Elder cropped and near, the Sisters deep, and the right half open. `rainbark-composition` tests pin the silhouettes. |
| 4 | **Mist floor reads as a cloud sea** | Only seen between trunks, steeply below, no horizon line: the impostor ranks and trunks always occlude the far mist, and at 21:9 more trunks fill in. Cream and blue, no cumulus, no peach or lavender. |
| 5 | **Lock legibility** (camouflage, phone slivers) | Dark peel lane, torn rim and cambium edge, gloss, +12% luminance, unzip motion, strips sized to at least 1 cell. The phone curl swings into the bottom band. Shots 3, 4 and 14 gate it. |
| 6 | **Peripheral motion fatigue at 1–3 locks/s** | Lanes and keep-out. Lock curls fall outward and back. Ambient ×0.35 while live. ≤ 3 strips animating per lane. The knock is rate-limited. No camera motion except the rare, delayed Climb. |
| 7 | **Patch-atlas aliasing and far shimmer** | Nearest-ID view at `.level(0)`, analytic edge AA, `fwidth` mean fade, MSAA on High+, FXAA on Low and Medium. Check under camera breath in a live (unfixed `t`) capture. |
| 8 | **Mist sheets slicing at grazing angles** | The analytic fog and backdrop mist top carry the look; sheets are few, wide-ramped and grazing-faded. |
| 9 | **Fill cost on phones and iGPUs** | Near and far draws split (events only on ≤ 8 instances). Tier table. Portrait edge bands. Measure Low on the WebGL2 phone viewport with `profile=1&trackTimestamp=1`. The first cuts if over budget: wisps, then limbs, then impostor rank 3. |
| 10 | **Shader size and compile time** | Laid-out pure helpers. Inline builders used once per material. One bark builder shared by two materials (near adds `rbEvents`). Gate the WGSL size with the capture script's `--shaders`. About 10 pipelines. |
| 11 | **WebGL2-only and WebGPU-only failures** | §4.14 checklist. Every starred shot is captured on both backends. |
| 12 | **Combo inference wrong in async modes** (online MP) | Idempotent `combo(0)`, a resume rule within 0.6 s, and director tests for an async clear. |
| 13 | **Climb disorientation** | Rare (every 15 lines), delayed 1.2 s after clears, 3.5 s eased, trunks continuous. Reduced-motion crossfade. |
| 14 | **Photosensitivity** | §6.0 rules. `max()` combining. Moult and Floor lifts measured on mean frame luminance in a capture test. Creak and glint phases random. No red fields. |
| 15 | **CVD collisions** | Palette verified (worst ΔE 19.4). Re-run the simulation if any piece hex changes. Board check under protanopia and deuteranopia filters. |
| 16 | **Tone** | No bleeding or wounds (Kino removed); amber resin is "jewels". In-game copy states no species facts. |
| 17 | **Scope creep** | Optional cuts in order: lorikeets, then leaf-bit puffs (the pool alone still counts), then limb count, then Ultra/Extreme extras. Never cut: peel, shed with row colours, moult, gap pools, set, unwinding, sunshower, floor, climb. |
| 18 | **Determinism** | Group clocks integrated and wrapped. Ambient schedules closed-form. Event slots seeded. `seek(t)` plus a fixed-step replay. A world test compares two seeks. |
| 19 | **Odyssey tonal mismatch** (orb 47 in the space chapter) | Rename to "The Painted Giants" with crossfade and a "pocket of quiet" description. The alias keeps saves and rewards. The frozen V2 table stays untouched. |
| 20 | **Headless verification** | 2D textures only (no `Data3DTexture` or `lut3D`). Bakes are synchronous and deterministic. No fetches, so the prewarm never sees the theme "busy". |

---

# Part II: what was learned, what was said, what changed

## 10. Art direction lesson: the bark

**The lesson in one line:** the bark is the whole theme, and the spec's recipe for it (§4.3,
anisotropic Voronoi) looked like **stained glass** the first time anyone drew it. Six CPU
prototypes in numpy and PIL, each compared side by side with photographs of the real tree, found a
model that reads as bark: **ribbon splats over a cool slate matrix**. This happened before step A1,
so no shader time was spent on the wrong model. Do the same for any concept whose hero is a
material.

### 10.1 The reference

- Two photographs of real *Eucalyptus deglupta* bark from TopTropicals' plant catalogue page for
  the species (<https://toptropicals.com/catalog/uid/eucalyptus_deglupta.htm>; checked on
  2026-10-12: it opens, titled "Eucalyptus deglupta (Rainbow Eucalyptus) | Top Tropicals Plant
  Encyclopedia"):
  - a close view of a trunk about 0.5 m wide (viewed at 675×900);
  - a whole young trunk (viewed at 397×900).
- **They are copyrighted (© TopTropicals.com). View them only, and never copy them into the repo.**
  For comparisons, build a PIL montage (render | render | photo) **outside** the repo, for example
  in the session's scratchpad. Do not use them as playground refs under `public/`. For step A1's
  `ref=…&refMode=split`, use a licence-clear image or one the user supplies, and never commit it.

### 10.2 What makes it read as *this* bark (and not camouflage, tie-dye or a painted pipe)

1. **Long vertical streaks and lozenges** with pointed or ragged ends, 3:1 to 10:1 tall. Some
   patches are broad slabs and others thin slivers. The edges are irregular and torn, not smooth
   Voronoi polygons.
2. **The old bark is the matrix.** In the photos the dominant mass is a cool slate blue-grey or
   grey-green (old smooth bark weathering to grey), with maroon-brown in places. The vivid colours
   (neon chartreuse, emerald, orange-red, rust) are streaks **inside** that matrix. The cool matrix
   is exactly what makes the tree look magical in blue air. So keep Husk Maroon for some patches,
   but let a large share of the old bark sit at a cool slate (for example `#59636F` … `#4E5A63`,
   blue-grey, L\* 38–42). The trunks then read as **blue-grey pillars streaked with jewels**, not
   brown trees.
3. **Edges.** Where an older patch meets a newer one there is a thin darker line. Where the old
   patch is still lifting there is a slightly lighter lip. Sometimes there is a long thin crack or
   curl (the close photo's right side shows a brown vertical curl strip with a dark gap).
4. **Fresh patches are flat, bright and satin** (green or orange), with little texture. Old patches
   carry faint vertical striation, mottling and tiny lighter flecks.
5. **Colour inside a patch is not flat.** There is a soft gradient (fresher toward one end or
   edge) and very slight value noise. Adjacent patches differ in **value** as much as in hue.
6. **On a whole trunk** the streaks run the full height in long ribbons, wider low and narrower
   high. The overall cylinder shading, from the light side to the shade side, is strong and smooth.

### 10.3 The CPU lab: six versions

Each version renders one 4.8 m × 14 m bark tile (the §4.2 tile) at 360×1050 px, about 1.33 cm per
pixel, with the spec's ramp, and is compared with the photos side by side.

| Version | Model | Verdict |
|---|---|---|
| **v1** | **Anisotropic Voronoi**: the §4.3 recipe as written. Sites on an 8×3 jittered grid, the metric stretched tall, domain-warped lookup. | **Stained glass / tie-dye.** Every texel belongs to a coloured polygon, the edges are straight, and the cells are all the same size. **Rejected.** |
| **v2** | Thresholded fBm contours | Organic edges, but nested contours make **topographic rainbow rings**. **Rejected.** |
| **v3** | Pointed lozenge splats | **Candy leaves / feathers.** **Rejected.** |
| v4 | Ribbon splats, first pass: widths 0.12–0.55 m, heights 2.5–11 m, centre-line wobble 0.03–0.18 m over 2–6 m wavelengths, width profile `sin(πt)^0.45` (tapered ends), ages uniform then skewed old (`1 − (1 − r)^1.5`), a ragged edge of 0.10 m (fBm) + 0.035 m (fine) | Intermediate step |
| v5 | Wider and straighter ribbons: widths 0.25–1.1 m, heights 3–12 m, wobble 0.01–0.06 m over 4–9 m, width profile `min(1, 3·sin(πt))^0.6` (blunt ends), the mixed age distribution of §10.4, a finer ragged edge of 0.08 m (higher-frequency fBm) + 0.035 m | Intermediate step |
| **v6** | v5 plus a low-frequency 0.22 m edge term; the ragged edge scaled by `0.6 + 0.8·(1 − 4t(1 − t))` (0.6× mid-patch, 1.4× at the ends); the end cut-off weight lowered from 0.25 to 0.12 so the ends fray | **Chosen.** Closest to the photos. The chosen render is seed 21, N = 16, chroma 0.78. |

Two failure lessons generalise. A tessellation (every texel in some cell) can never read as bark,
because the real bark is *streaks on a matrix*. And a uniformly distributed age gives a rainbow:
the age mixture has to be skewed, with mid ages rare.

### 10.4 The chosen model ("ribbon splats", v6)

- **16–22 vertical ribbon patches per 4.8 × 14 m tile**, laid **over a cool grey matrix**. The
  matrix share (texels no ribbon covers) is **30–45%**.
- Ribbon widths **0.25–1.1 m**, heights **3–12 m**.
- Centre-line wobble only **0.01–0.06 m over 4–9 m wavelengths**: ribbons are nearly straight.
- **Blunt, ragged ends.**
- A **multi-scale ragged edge**: 0.22 m amplitude at low frequency + 0.08 m at mid frequency +
  0.035 m fine. It is **stronger near the patch ends**.
- **Later patches overwrite earlier ones**, so B (the patch underneath at an edge) is well defined.
- **Age mixture (not uniform):**

  | Share | Age range | Reads as |
  |---|---|---|
  | 28% | 0–0.14 | fresh lime and emerald |
  | 38% | 0.60–0.84 | ruby and ember |
  | 16% | 0.84–0.95 | maroon and old |
  | 18% | 0.14–0.60 | teal, cobalt and violet: the **rare** accents |

- **Ambient bark chroma ≈ 0.75–0.8 of the ramp** (a mix toward luma that keeps value). **Gameplay
  bands** (peel and girdle reveals) use the **full** piece colour, so they stand out from the
  ambient mosaic.
- The matrix is cool slate with a **low-frequency tint drift** (blue-grey ↔ green-grey ↔
  purple-grey), plus mottling and striation.

### 10.5 The old end of the ramp: cool slate

The spec's ramp (§3.1) ends in Husk Maroon `#5E2430` at 0.91 and Old Husk `#3E2A26` at 0.98–1.0,
which gives brown trees. The lab used this old end instead:

| Age | 0.87 | 0.93 | 1.0 |
|---|---|---|---|
| Colour | `#7A3A3C` (maroon) | `#5E6470` (slate) | `#56606A` (cool blue-grey slate: the matrix) |

- The piece stops 0.00–0.79 are **unchanged**, so the piece palette, the palette gate (0/7), the
  colour-vision check and the "every piece is one age of the bark" rule all still hold.
- At the time of writing, the build in progress (not yet committed) had refined this to
  `0.84 #B04C2E` (Rust), `0.885 #7A3A3C` (Husk Maroon), `0.93 #5E6573` (Weathered Slate) and
  `1.0 #56616F` (Old Slate, the matrix) in `RAMP_STOPS` (`src/themes/rainbark/rainbark-core.js`).
  **The code is authoritative.** Read `RAMP_STOPS` there before changing anything.
- **Check that follows from this:** the peel lane (§4.2 step 4) pins ages to 0.86–0.99, which now
  lands on maroon to slate rather than dark brown husk. Re-check lock legibility (risk 5, shots 3,
  4 and 14) against the slate lane. Husk Maroon and Old Husk are still the named colours for curl
  outer faces and garbage cells (§3.1, §3.5).

### 10.6 Atlas channels for this model (replace §4.3's channel list)

| Channel | Contents |
|---|---|
| R | Id of the **top** patch (**0 = matrix**) |
| G | Signed distance to that patch's edge (0–0.25 m) |
| B | Id of the patch **underneath** at that edge |
| A | Lift side / lip sharpness |

The atlas is **tileable on the torus**: the splats wrap in both directions. The §4.3 unit test
("cell aspect between 3.5 and 8") was written for Voronoi cells. Re-express it for ribbons: the
tile still wraps seamlessly, the matrix share stays within 30–45%, and the vertical anisotropy is
at least the §4.2 checklist's 4:1. Everything §4.2 does with the atlas (nearest-filtered IDs at
`.level(0)`, analytic edge AA from the distance channel, the far footprint fade) carries over
unchanged.

### 10.7 What the CPU lab does not do (the GPU build must add it)

- lifted old-bark lips and shadow lines at patch edges;
- hairline seams;
- faint lighter flecks and mottles in the matrix;
- a soft colour gradient inside each patch, fresher toward one edge;
- sheen;
- cylinder lighting.

(bark6.py fakes a seam, a lip and a cylinder shade so the preview can be compared with a photo.
In the real atlas these are shader terms, §4.2 steps 5–8, and the atlas stores only ids and
distances.)

### 10.8 Re-running the lab

Requirements: Python 3 with `numpy` and `Pillow`. Save the script below as `bark6.py` anywhere
outside the repo and run:

```bash
python3 bark6.py bark6b.png 21 16 0.78
# argv: <output.png> <seed> <N ribbons> [chroma, default 0.7]
# prints the matrix share (texels no ribbon covers); aim for 0.30–0.45
```

With these arguments the script prints a matrix share of 0.416 and reproduces the chosen render
byte for byte (checked on 2026-10-12). The output is one 4.8 m × 14 m tile at 360×1050 px. Try seeds and N in 16–22, then compare with a
reference photo in a montage. The preview's colouring (ramp, chroma mix toward luma, matrix tint
drift, striation, mottling, seam, lip, cylinder shade) is a **look reference for `rbBark`**, not
something the atlas bakes.

```python
import numpy as np, sys
from PIL import Image
W, H = 360, 1050; TW, TH = 4.8, 14.0
def hexrgb(h): h=h.lstrip('#'); return np.array([int(h[i:i+2],16)/255 for i in (0,2,4)])
def s2l(c): return np.where(c<=0.04045, c/12.92, ((c+0.055)/1.055)**2.4)
def l2s(c): c=np.clip(c,0,1); return np.where(c<=0.0031308, c*12.92, 1.055*c**(1/2.4)-0.055)
STOPS=[(0.0,'#C2F23D'),(0.12,'#2BCB72'),(0.26,'#1A93AC'),(0.38,'#2F4CC0'),(0.52,'#B98AF2'),(0.66,'#D23468'),(0.79,'#F07A2A'),(0.87,'#7A3A3C'),(0.93,'#5E6470'),(1.0,'#56606A')]
ra=np.array([a for a,_ in STOPS]); rc=np.array([s2l(hexrgb(h)) for _,h in STOPS])
def ramp(a):
    a=np.clip(a,0,1); o=np.zeros(a.shape+(3,))
    for k in range(3): o[...,k]=np.interp(a,ra,rc[:,k])
    return o
def vnoise(x,y,seed,px,py):
    r=np.random.default_rng(seed).random((py,px))
    xi=np.floor(x).astype(int); yi=np.floor(y).astype(int); fx=x-xi; fy=y-yi
    fx=fx*fx*(3-2*fx); fy=fy*fy*(3-2*fy)
    a=r[yi%py,xi%px]; b=r[yi%py,(xi+1)%px]; c=r[(yi+1)%py,xi%px]; d=r[(yi+1)%py,(xi+1)%px]
    return a+(b-a)*fx+(c-a)*fy+(a-b-c+d)*fx*fy
def fbm(x,y,seed,px,py,oct=4):
    s=0; amp=0.5; tot=0
    for o in range(oct):
        s=s+amp*vnoise(x*2**o,y*2**o,seed+o,px*2**o,py*2**o); tot+=amp; amp*=0.5
    return s/tot
ys,xs=np.mgrid[0:H,0:W].astype(float); X=xs/W*TW; Y=ys/H*TH
rag=(fbm(xs/W*12, ys/H*10, 5, 12, 10, 4)-0.5)*0.22 + (fbm(xs/W*24, ys/H*14, 15, 24, 14, 4)-0.5)*0.08 + (vnoise(xs/W*96, ys/H*60, 7, 96, 60)-0.5)*0.035
seed=int(sys.argv[2]); N=int(sys.argv[3]); chroma=float(sys.argv[4]) if len(sys.argv)>4 else 0.7
rng=np.random.default_rng(seed)
top=np.full((H,W),-1); sd=np.full((H,W),-9.0)
ages=[]
for k in range(N):
    w0=rng.uniform(0.25,1.1); h=rng.uniform(3.0,12.0); cx=rng.uniform(0,TW); cy=rng.uniform(0,TH)
    ph=rng.uniform(0,6.28); A=rng.uniform(0.01,0.06); lam=rng.uniform(4.0,9.0)
    dy=(Y-cy+TH/2)%TH-TH/2; t=np.clip(dy/h+0.5,0,1)
    centre=cx + A*np.sin(dy/lam*6.28+ph)
    dx=(X-centre+TW/2)%TW-TW/2
    prof=np.minimum(1,np.sin(np.pi*t)*3.0)**0.6*(0.8+0.4*vnoise(np.full_like(t,k*3.7), dy/2.3+50, 100+k, 32, 64))
    hw=w0*0.5*prof
    d=np.minimum(hw-np.abs(dx), (h/2-np.abs(dy))*0.12)+rag*(0.6+0.8*(1-t*(1-t)*4))
    inside=(d>0)&(np.abs(dy)<h/2)
    top=np.where(inside,k,top); sd=np.where(inside,d,sd)
    r=rng.random(); ages.append(rng.uniform(0.0,0.14) if r<0.28 else (rng.uniform(0.6,0.84) if r<0.66 else (rng.uniform(0.84,0.95) if r<0.82 else rng.uniform(0.14,0.6))))
ages=np.array(ages)
a=np.where(top>=0, ages[np.maximum(top,0)], 0.97)
dist=np.where(top>=0, sd, 9.0)
e01=np.clip(dist/0.15,0,1)
aloc=np.where(top>=0, a+0.05*e01, a)
base=ramp(aloc)
# chroma control: mix toward luma (keeps value)
lum=(base*np.array([0.2126,0.7152,0.0722])).sum(-1,keepdims=True)
col=(lum+(base-lum)*chroma)*0.82
# matrix tint variation (blue-grey / green-grey / purple-grey)
oldk=np.clip((aloc-0.82)/0.18,0,1)
tint=fbm(xs/W*4,ys/H*3,21,4,3,3)
tintc=np.stack([1+0.10*(tint-0.5)*2, 1+0.06*(0.5-tint), 1+0.12*(0.5-tint)*2],-1)
col=np.where(oldk[...,None]>0, col*(1+(tintc-1)*oldk[...,None]), col)
stri=vnoise(xs/W*120,ys/H*5,9,120,5); mott=fbm(xs/W*24,ys/H*40,11,24,40,3)
col*=(1+(0.04+0.10*oldk)[...,None]*(stri-0.5)[...,None]*2)
col*=(1+0.25*oldk[...,None]*(mott-0.5)[...,None])
seam=np.clip(1-np.abs(dist)/0.006,0,1)*(top>=0)
col*=(1-0.5*seam)[...,None]
lip=np.clip(1-np.abs(dist+0.010)/0.006,0,1)          # just outside the patch: the lifted older lip catches light
col*=(1+0.20*lip)[...,None]
shade=0.45+0.55*np.cos((xs/W-0.62)*np.pi*0.95); col*=shade[...,None]
Image.fromarray((l2s(col)*255).astype(np.uint8)).save(sys.argv[1])
print('matrix share', float((top<0).mean()))
```

The GPU port of this model is `bakePatchAtlas` in `src/themes/rainbark/rainbark-bake.js`
(three-free typed arrays, deterministic by seed). At the time of writing it was in progress and
uncommitted. Its header describes "ribbon splats" laid in order onto a torus over the matrix, with
a few pale old-skin islands in the matrix laid first.

---

## 11. What the judges said

The judges scored the **original proposal** ("RAINBARK: design proposal (seed: WILDCARD)"), not
the spec. Every weakness below was answered in the spec; §0.3 maps each one to its fix.

### 11.1 Art director: 8.0 (2nd of 6; Haft Rang was 1st at 8.5)

**Lens:** beauty, originality against the 61-theme fleet (setting, palette, composition, motifs
and FX grammar), wow factor, depth, atmosphere and lighting, how it reads still and in motion,
surprise, and the name. The judge was strict about resemblance.

**Strengths.**
- **The most "real but impossible" image on the table:** a cathedral of rainbow-barked giants,
  scaled up, with no ground and no horizon, plunging into a glowing cloud tide.
- **Blue aerial perspective.** Terpene-blue haze strips the saturation rank by rank, so a
  full-spectrum material is tamed by atmosphere. The best depth device in the slate, and no theme
  uses blue air on warm colour.
- **Distinctive lighting, never the standard low-sun-and-god-rays rig.** Elliptical pinhole
  sunflecks crawl over wet satin bark, and the cloud tide lights the trunks from below.
- **The only vertical world**, which makes it ideal for upright phones.
- **The freshest material grammar.** Peel, shed, moult, kino and climb need no rainbow, ring,
  spark or wave. A strip unzipping and curling off a trunk is a deeply satisfying motion.
- **The Great Moult** (the whole forest changes skin, then ripens back in flames of colour) and
  **the Floor** (the perfect clear reveals a forest floor carpeted with every curl shed this
  session) are both unforgettable.
- **Level up as a climb up the forest** is a genuinely new level metaphor.

**Weaknesses.**
- **The composition is the fleet's top cliché:** trees framing left and right with a central vista
  (7 themes use it). Softened because the "vista" is haze and more trunks.
- **It is a forest**, and the fleet has five: forest, fall, moonlit-forest, golden-forest and
  stillwater.
- **The cloud tide brushes the sea-of-clouds trope** of nimbus-veil and rainbow-terraces.
- **The bark mosaic could read as camouflage, tie-dye or psychedelia.** The proposal itself called
  the combo "a living aurora of bark".
- **Kino "bleeding" from a "wound"** is a tonal risk in a game named Serenity Blocks.
- **The name** is clever and memorable, but a little whimsical.

**Worth grafting from Rainbark** (into other concepts; the sibling concept docs say which of these
they must not duplicate): blue haze as the aerial-perspective target for saturated material; the
canopy-gap sunfleck gobo with pinhole penumbra; the peel as a tactile reveal of the piece's
colour; the Great Moult as a four-line clear that resets the world young; the perfect clear that
reveals a floor carpeted with the session's sheds; the Climb as the level metaphor; the grove's
age as a readable record of time since the last four-line clear; underglow from a bright floor of
mist.

**Verdict on this lens.** Haft Rang won the lens (the most original and surprising, the best lit,
and the only concept that fully breaks the fleet's "hold the colour" grammar). **"Rainbark is the
strongest landscape and the safe second.** It brings the freshest material grammar, blue-haze depth
and phone-native verticality. It should break the flanking-tree symmetry (for example, the Elder
close and cropped, the Sisters set deep) and lose the 'wound/bleed' framing of kino." For
whatever won: use the rainbow at most once; keep the decay world-native (bleach, green, ripen),
never "held then released"; and source a clear's colours from the real cells of the cleared row
(Painted Ages' shadow well).

**Slate-wide findings that bear on Rainbark:**
- The rainbow had become the slate's own cliché (three concepts used a placed bow as a headline
  payoff; the fleet already has bows in tornado, chromadelic-highway and singing-bowl). Rainbark
  has none.
- Almost every lock was a softened version of the house "the world holds the colour": Rainbark's
  bands included. The spec answers this by letting bands **ripen on the world's own clock**
  rather than hold and release (§6.0, §6.1).
- Every concept put a hero on the left and a secondary on the right. The spec makes Rainbark's
  split carry cause and effect: light from the open right lands on the hero's card-facing face
  (§2.4).
- Golden hour is the fleet's most overused light (halcyon, himalayan, sunset, summer, fall,
  tornado, golden-forest, waves, shifting-sands, nimbus, rainbow-terraces). High sun is the open slot,
  and Rainbark's sun never drops below 50° elevation (§3.2).

### 11.2 Rendering lead: 8.5 (1st of 6)

**Lens:** can it be built in three r186 TSL so that it looks right on WebGPU and on the WebGL2
backend? Cost on phones and iGPUs, procedural without models, how cheap it looks if it falls
short, compile and pipeline cost, board readability. **Look-per-millisecond** is the main reward.
Beauty that depends on volumetrics, refraction passes or extra render targets is penalised.

**One line:** "The best look-per-ms of the six. The beauty is a fragment-shader *material* on cheap
instanced tubes, plus analytic air. No volumetrics, no extra RT, and the best calm zone of the
six."

**Why it wins on this lens.**
- **The hero is a material, not a volume.** One `InstancedBufferGeometry` draws every trunk: a unit
  tube deformed along a cubic spine in the vertex stage, with analytic normals and one interleaved
  buffer (gotcha #99). The bark is a 2D atlas lookup in bark space, an age read from a ramp, and a
  few ALU terms for the rim lift, striation and sheen: four texture reads for the full-spectrum
  hero. The real tree *is* a smooth cylinder covered in patches, so the subject matches what can
  be rendered.
- **Everything around the hero is analytic.** `rbAir` is a closed-form height-fog integral shared
  by every surface, with bounded exponents (#71). Sunflecks come from a projected canopy gobo,
  with penumbra from the mip level. Infinite deep ranks are impostors drawn in direction space on
  the backdrop, at zero geometry cost. Shafts are three faint quads, not a post march. Nothing is
  marched, and there is no render target except the bloom chain.
- **Events are almost free.** Peel, girdle, kino and the moult front are rows read by the trunk
  shader, so only near instances pay. The curls are one instanced rolled-and-tumbled ribbon pool.
  The quickened combo is four integrated group clocks in one vec4. Very few new pipelines.
- **Readability is the best of the six.** The card sits on the brightest, lowest-contrast part of
  the frame, a pale blue haze field. Near trunks are placed outside the card and HUD rects. The
  calm zone has almost nothing to do.
- **Phones.** A vertical world suits an upright screen; near trunks shrink to thin edge bands and
  the tide drops to 1–2 sheets. The cost estimates (High ≈ 5 ms class) are credible.

**Risks and corrections to carry into the build** (all adopted in the spec):
1. **Patch-atlas aliasing.** The cell-ID and neighbour-ID channels must never be linearly filtered
   or mipmapped (a mip of an ID is garbage). Sample IDs nearest at `.level(0)`, do edge AA
   analytically from the edge-distance channel and `fwidth`, and on far ranks fade toward the ramp
   mean by footprint, or the 110–260 m ranks shimmer under camera breathing. → §4.2 steps 2 and 6.
2. **Tide sheets at grazing angles** show their slices. Let the analytic height fog carry the
   density; keep sheets few, wide-ramped (#116) and texture only; fade each by grazing angle. → §4.6.
3. **"Painted pipes."** Untextured tubes in fog read as columns. Fluting noise, buttress flanges,
   lean, sheen strip and the fresh-edge-to-old-centre gradient are hard requirements in session 1,
   iterated on one trunk against a reference (`refMode=split`). → §4.2 art checklist, §7.3 A1.
4. **The perfect-clear Floor as a whole extra scene** adds pipelines and first-frame compile.
   Paint it in the backdrop below the tide instead: buttress silhouettes, the stream glint, and a
   curl carpet from noise times a session-shed density uniform. → §4.4 item 5, §6.10.
5. **Event loop in a branch.** The near flag should be an integer-coded instance attribute (#87),
   and every sample inside the branch must use `.level()`. → The spec goes further: separate near
   and far draws (§4.2).

**Graftable ideas the judge ranked for the winner** (most were adopted; see §0.2): Sunfall's
`dlSunlit` projected-occluder mask with mip-LOD penumbra and its ranked gap channel (→ canopy gaps
counting the chain); Sunfall's vertex-stage culling of unlit drops (→ drops only in flecks);
Painted Ages' `fwidth` mean-blend AA (→ far-rank fade); Painted Ages' wetness as one global
material parameter, with its formula albedo ×0.65, chroma ×1.35 at full wetness (→ Moult and
Sunshower; the spec uses albedo ×(1 − 0.2·wet), chroma ×(1 + 0.3·wet)); Iris Springs' underlighting from the ground colour
(→ mist top tinted by the bark); Riverbloom's "surface as a function" (shade thin layers inside
the host material); Haft Rang's Sun Rug (already covered by the bands of the last pieces).

**Verdict:** "Build Rainbark, with Painted Ages as the strong runner-up." Its risks are
concentrated and can be tested in session 1: patch-atlas ID filtering and far-rank AA, bark that
reads as bark rather than painted pipes, and grazing-angle tide sheets.

### 11.3 Gameplay feel: 8.4 (2nd of 6; Iris Springs was 1st at 8.6)

**Lens:** how spectacular, colourful, satisfying and world-native each event is; readability at
1–3 locks per second; whether combos escalate and release clearly; novelty against the house FX
grammar; mapping to board positions; photosensitivity; how the theme feels after 20 minutes. A
20-minute session has roughly 600–900 locks, 150–250 clears, 10–40 four-line clears, a few T-spins
and almost no perfect clears, so **lock and clear set the feel** and were weighted most.

**One line:** "The most satisfying lock (the peel) and the most memorable four-line clear (the
Great Moult). No rainbows at all. The combo is a gauge you cannot count, and every lock adds
motion next to the card."

- **Lock (the Peel).** A hairline split opens on the trunk face nearest the piece (Elder for
  columns 0–4, Sister for 5–9), and the strip's height spans the piece's rows: the most precise
  board mapping of any lock except Haft Rang's mirror. It unzips downward, curls, reveals a wet
  band in the piece's colour and tumbles away (in the proposal, past the card). Tactile and
  satisfying in an ASMR way; never a spark or a held light.
- **Clear (the Shed).** In the proposal, a girdle at each cleared row's height peels off as a
  draped sheet and drops away, revealing First Skin chartreuse that ripens in a 1.5 s time-lapse;
  two or three lines reach deeper ranks. One countable ring per line. A horizontal mark at row
  height on both sides is close to the house "blades at the cleared rows" placement, but the verb
  is material, which saves it.
- **Four lines (the Great Moult)** is the most memorable four-line clear on the table: a 0.3 s
  creak as native anticipation without darkening, a moult front down every trunk, the grove naked
  in lime, then colour climbing in flames. It also resets the grove's age, so **the grove's colour
  temperature tells you how long ago you last cleared four lines.**
- **T-spin (Kino)** (ruby gum running down in 1, 2 or 3 runnels, glowing garnet where backlit,
  hardening into scars that last the level) was world-native, countable and persistent.
  **Perfect clear (the Floor):** the cloud tide drains to reveal a forest floor carpeted with
  every curl shed this session; the best session-aware payoff in the set. **Level (the Climb):**
  each level lifts the walkway one storey into a new light zone; strong progression.
  **Photosensitivity:** no flash frames; the moult's +0.3 stop was held under an iris dip (the
  spec tightened it to ≤ +0.25 stop of measured mean luminance).
- **The release (the Set)**, curls scaled by chain length, was judged good as proposed.

**Problems on this lens** (all fixed in the spec):
1. **The combo cannot be counted.** Quickening speeds up a clock; ×3 and ×5 are hard to tell apart
   and there is no discrete per-link beat. → Canopy-gap sun-pools, one per link (§6.6).
2. **Motion beside the card.** Lock curls tumbling past the card on every lock, on top of 1–3
   ambient curls per second, is a constant peripheral flicker in fast play. Curls should fall away
   from the card, and ambient curls should thin out during a run. → Lanes and keep-out, ambient
   ×0.35 while live (§6.0).
3. **Camouflage.** The bark already shows every hue, so a band in the piece's colour has weak
   figure-ground contrast. The peel motion and the sheen sweep must carry it; slightly brightening
   the newest band and darkening the patches next to it would help. → Dark peel lane, torn rim,
   cambium edge, +12% luminance (§6.1).
4. **Camera motion.** The Climb is the only concept that moves the camera on a gameplay event.
   Acceptable because it is rare and slow, but never in the second after a clear. → Delayed 1.2 s,
   reduced-motion crossfade (§6.11).
5. **B2B ("the Answer")** was a faint echo in a far rank. → The Sunshower (§6.8).

**Worth grafting from Rainbark** (this judge's list, for other concepts): the lock spans the
piece's rows (the peel band); four lines resets the world's age, so it reads as "time since the
last four-line clear"; a perfect clear that reveals what the session accumulated; a T-spin scar
that lasts the level; native anticipation (the creak) instead of a hush.

**Engineering note the judge gave every concept:** the house `ComboTracker` reports a chain break
one lock late. PIECE_LOCK and wave 1's LINE_CLEAR are emitted in the same synchronous tick, so the
director can infer at `flush()` that a lock with no clear in the frame breaks the chain, and
deliver `combo(0)` on the breaking lock itself. → §7.2 and the director's combo-break inference.

---

## 12. What changed from the original proposal

The original "wildcard" proposal is summarised by the judges' notes in §11. These are the
differences between it and the spec (§0–§9), plus the two later changes from §10.

1. **Composition.** Was: an Elder on the left (4.5 m thick, 11 m away, x ≈ 0–0.25) and two Sisters
   on the right (2.4 m and 2.0 m at 15 m and 24 m), round a central vista. Now: **asymmetric**. A
   cropped Elder (5.2 m, 9 m, right silhouette at x 0.27), Sisters set deep (3.2 m at 24 m, 2.4 m at
   40 m), the right half open sunlit air, a left-to-right diagonal recession, and placement solved
   from the live card and HUD rects (`trunkBand`).
2. **Scale and height.** ×1.9 (Elder 4.5 m, grove about 90 m tall, camera about 34 m up) became
   **×2.3** (trunks 160–185 m, Elder 5.2 m). The camera height is now `20 + 12·c` m: 56 m at the
   reference (level 4).
3. **Light direction.** The sun was upper left, behind the Elder, which left the visible faces in
   silhouette exactly where the peels happen. Now the sun sits at **azimuth −70° (right), elevation
   55°**, and its light lands on the Elder's card-facing face (§2.4).
4. **Cloud tide → mist floor.** It is seen only between trunks, steeply below, never out to a
   horizon. Cream-white with blue shadows, no cumulus, no peach or lavender. The tide swing went
   from ±10 m to **±8 m** (Fog Line ±4 m).
5. **Zones.** Crown (9–11) and Emergent (12+) became **Limb Storey (9–11)** and **Crown Light
   (12)**. Fog Line lost its pale sun disc: **no zone draws a sun disc**, and the sun is always at
   50° or higher. Every zone gained a full hex set and air parameters, and **Mistfall** gained its
   own hex set.
6. **Combo counter.** Quickening alone, which could not be counted, became **canopy gaps**: one
   pinhole sun-pool and a short shaft per link at 7 fixed stations (grafted from Sunfall), with
   quickening kept as the secondary gauge. The ×4 "bark rain past the card" was removed; the gust
   veil at ×6 stays in the outer lanes.
7. **The Set.** The curtain went from 6–60 curls to `min(4·(p − 1), tierCap)` (Extreme cap 40). Gaps
   close in reverse order. It is delivered **on the breaking lock** by director inference instead
   of one lock late.
8. **B2B.** "The Answer" (a far-rank echo with gold rims) became **the Sunshower**: grove-wide rain
   that is visible only in light, plus wetness, persistent while the chain lives and heavier with
   each B2B.
9. **T-spin.** **Kino** (ruby gum bleeding from a wound in 5/9/14 m runnels, hardening to scars) became
   **the Unwinding**: a helical apple-peel strip of 1/2/3 turns that ripens to Young Emerald, with
   6/10/14 amber resin beads. The colour "Kino Ruby" became Ruby Bark, and all wound language went.
10. **Lock.** Curls had tumbled past the card's flank. Now there are lanes and a keep-out, curls pop
    **outward** and fall **back**, and the band lands in a dark peel lane with a torn rim, a
    cambium edge and +12% luminance. The band ripens from the piece's age at 1/240 per second and
    erodes over 90–150 s (it was about 90 s). Peel slots went from 12 to 16.
11. **Shed.** The ring had ripened to emerald and teal over 1.5 s. Now it **ripens into the cleared
    row's own cell colours**, left to right (the shadow well, grafted from Painted Ages). Cascade
    waves add an aftershed.
12. **Great Moult.** The exposure cap went from +0.3 stop to **≤ +0.25 stop of measured mean frame
    luminance**, with an explicit iris formula. Near `ageBias` is set to −0.6 and relaxes back over
    360 s.
13. **Perfect clear (the Floor).** No longer a separate scene: it is **painted in the backdrop**
    (ray–plane at y = 0), with no new geometry or pipelines. The floor is 20–150 m below depending
    on the zone (was 60–90 m).
14. **Climb.** "Never during the 1 s after a clear" became **delayed until 1.2 s after the latest
    clear**. Under reduced motion it is a 1.2 s mist-veil crossfade.
15. **Piece palette.** S `#9457DC` → `#B98AF2` and L `#4069E0` → `#2F4CC0` (the old pair collapsed
    under protanopia, ΔE 1.3). Also Z `#2DB0C6` → `#1A93AC`, J `#D63A6E` → `#D23468`, T `#22C46E` →
    `#2BCB72`, O `#EE7A2C` → `#F07A2A`. The ramp stops are now **exactly** the seven piece colours,
    on a 256×1 ramp (was 64×1). The per-patch jitter is now ±6% per channel, luminance-preserving (was ±6° of hue). A clean-garbage colour (Cambium `#D8D2BE`)
    was added. Colour vision was verified (worst ΔE 19.4, tritanopia O/J). The palette gate stays
    at 0/7.
16. **Rendering structure.** One trunk draw with an `If(aNear)` event branch became **separate near
    and far draws**, with events only in the near material and integer instance codes. Atlas IDs
    are sampled nearest at `.level(0)` from their own `DataTexture` view, with analytic edge AA and
    a far footprint fade to the group mean. The fleck penumbra now comes from the sun's 0.53° disc
    (`pen = 0.0093·dC`), not `.level(clamp(dCanopy/18, 0, 4))`. Mist sheets got a grazing fade.
    There are two `uniformArray`s (events and palette) where the proposal had one event table, plus
    a full 112-row event layout. A new `rainbark-bake.js` holds the bakes. FXAA was added on Low
    and Medium. Tier trunk counts went from 10/14/22/30/40/52 to 12/16/24/32/42/54 (near ≤ 8), and
    combo shafts survive on Low.
17. **Group clocks.** Near-left, near-right, mid and far became Elder, Sisters, R1/R2 and far. Each
    has an explicit rate `1 + 1.6·(n − 1)`, joins the chain at a set link, and caps at n = 8 (×12.2).
18. **Odyssey.** The proposal only flagged the tonal mismatch. The spec decided it: orb 47 is
    renamed "The Painted Giants" (one of the proposal's fallback names) and uses
    `transitionIn: 'crossfade'`.
19. **Wording and safety.** "A living aurora of bark" was deleted. The photosensitivity rules
    became measurable (mean-luminance caps, `max()` combining, < 3 Hz). Lanes and keep-out rules
    were added for every falling thing.
20. **After the spec (§10).** The anisotropic Voronoi atlas (§4.3) was replaced by **ribbon splats
    over a slate matrix**. The ramp's old end moved from maroon and brown husk to **cool slate**.

---

## 13. Background from the original proposal: name, originality against the fleet, sources

The spec (§0–§9) supersedes the proposal's design, but the proposal's reasoning about the name,
the subject and the fleet still holds. It is kept here so a rebuild can defend the same choices.

### 13.1 Name and seed

- **Rainbark** carries three readings: rainbow bark; bark in the rain (the colours are richest
  wet, which the Sunshower uses); and *rain of bark* (the grove sheds). When it was proposed, no
  theme, Odyssey chapter, doc or source file used it (a grep of `src/`, `docs/` and `data/` for
  `rainbark`, `deglupta` and `painted giant`).
- **Fallback names:** Deglupta (the species name, Latin for "peeled off"), Painted Giants (now the
  Odyssey orb's title, §1) and Ripening Grove.
- **The proposal's logline** (the spec's in §1 replaced it): *A forest of colossal painted giants
  rising out of a sea of blue haze. Their bark ripens through every colour of the spectrum and
  peels away in the sun. Every piece you set peels the grove, every line you clear makes it shed,
  and a chain of clears speeds up its clock.*
- **The seed.** *Eucalyptus deglupta*, the rainbow eucalyptus: a 60–78 m rainforest giant from
  Mindanao, Indonesia and New Guinea whose smooth bark sheds in strips. Each freshly exposed layer
  starts chartreuse and ages through dark green, blue, pastel purple and rusty red to burnt
  orange and maroon before it peels in turn, so the trunk is a mosaic of patches of different
  ages: a living colour clock that people often take for paint or photo editing.
- **Why this subject** (chosen over about 40 other wildcards). It is all three things the brief
  named: a **living material** (the bark makes its own colour); an **impossible-but-natural
  landscape** (pillars of every colour, scaled up until mist drifts between them); and a
  **physics that is already a game grammar** (peel, shed, ripen, moult). Nothing in the fleet or
  among the sibling concepts used these verbs. The fleet catalogue's note that "no theme here is
  vertical; composition is always a horizon or a tunnel" made the vertical abyss an open slot.
- **The blue air** is the cool haze of Australia's Blue Mountains. It is popularly put down to
  eucalyptus terpene aerosols; physically it is fine-particle scattering. Either way it gives an
  aerial perspective that is blue-violet rather than golden.

### 13.2 Why it should be breathtaking (the proposal's case)

- **It is real and looks impossible.** People who see a rainbow eucalyptus think it is painted;
  Rainbark shows a sky-high cathedral of them.
- **The colour belongs to the world.** The full spectrum lives in a material that ages and peels,
  so it is never neon, never a gel and never a hue cycle.
- **The lighting is unusual:** elliptical sunflecks on wet satin bark, thin curls glowing like
  embers when backlit, the mist underlighting the trunks, blue air taking the colour away rank by
  rank. None of it is the standard low-sun-and-god-rays rig.
- **Huge depth, calm board:** painted ranks fall away into a luminous blue field that sits exactly
  behind the card.
- **Tactile events:** a strip unzipping and curling off a trunk; a forest changing its skin in a
  breath and re-ripening in flames of colour.
- **The only vertical world**, made for upright phones.

### 13.3 The closest existing themes, and the precise differences

Use this list with `docs/theme-concepts/reference/catalog.md` (and `catalog.json`) for the
side-by-side check in risk 2 (§9).

| Theme | Shared | Different |
|---|---|---|
| **fall** ("the enchanted grove": a backlit maple and oak wood in golden haze, leaves swirling) | A grove; warm falling material | Fall's hero is the **canopy** under a low golden sun, with trees framing a path vista; it throws leaf puffs and jets from the card and winds a leaf vortex round the board; amber monochrome. Rainbark's hero is **bark** on colossal boles under high sun in **blue** air, with no ground, path or horizon; it peels and sheds bark on trunks already in the picture and never circles the board; a full spectrum in blue haze. |
| **chiral-gold** ("the two towers": mirror-image vertical towers either side of the board) | Vertical forms flanking the card | Chiral-gold has two **metal** towers in a dark hall on black mirror water, with rings, bokeh, gold leaf and sparks corkscrewing into the towers. Rainbark has **living**, irregular trunks at many depths in daylight haze, with no mirror, ring or metal, and material peels for events. |
| **forest** ("the firefly night": an elder spruce frames the left, mist banks, a moonlit ride) | An elder tree on the left; mist | Forest is **night**: monochrome moonlight, fireflies, a moon vista, the elder a silhouette frame. Rainbark is humid day with a full-spectrum material, sunflecks and a vertical abyss; the Elder is the canvas. |

Also checked: **ice-temple** (colossal columns in a nave; Rainbark's grove is irregular, alive and
warm, with no nave axis and no glowing crystal at the end); **moonlit-forest** (trunk layers into
fog, but a night, low-poly scene); **bioluminescence** (organic glow in darkness; Rainbark has no
glow on darkness); **singing-bowl** (its avoid list includes rainbow hue-cycling; Rainbark's colour
is patch-wise ageing, so the grove never cycles as a whole). The art judge added golden-forest and
stillwater to the forest list (§11.1), and the spec's risk 2 gate compares against all five.

**Against the sibling concepts:** Sunfall is a cave with a jungle seen from above, a sunbeam, a
waterfall, rainbows and swiftlets; Rainbark has no cave, no beam hero, no waterfall, no rainbow
and no leaf flush. Riverbloom is water and fronds; Rainbark has no water spectacle. Painted Ages
writes the board's rows into the world as strata; Rainbark ripens and sheds them (its shadow-well
graft colours a ring that then ages away, §6.3). Iris Springs and Haft Rang share nothing with it.

### 13.4 Other wildcards the proposer rejected

| Rejected wildcard | Why |
|---|---|
| Reverse waterfalls on emerald pali cliffs | Narrow palette; would be the fourth rainbow concept |
| Macaw clay-lick cliff | The house "held colour until a clear" grammar; creature risk |
| Laguna Colorada | Overlaps Iris Springs' mineral colour basin |
| White Desert chalk | Desert collisions |
| Antelope Canyon | Shifting-sands, Painted Ages, and the roof-shaft cliché |
| Seashell cellular-automaton growth | The same "record" metaphor as Painted Ages |
| Qinglü blue-green painted peaks | Layered ridges with mist; painting overlap with chromatic-impasto |
| Pop-up paper | Layered-silhouette cliché |
| Coloured smoke | Nebula look-alike |
| Physarum | Off-putting |
| Aerochrome infrared | Reads as a filter gimmick |
| Lichen macro | Too obscure |
| Fata Morgana | Mirror trope |

The wider research (33 candidates, rejects and the top five) is in
`docs/theme-concepts/reference/research.md`.

### 13.5 Scientific licence (why in-game copy states no species facts)

- The colour order varies between sources (Science Friday omits blue). The ramp in §3.1 is an art
  direction choice grounded in the real behaviour, not a measured sequence.
- Kino (the red gum that the proposal's T-spin used and the spec removed) is documented for
  eucalypts generally ("bloodwoods"), not specifically for *deglupta*.
- The blue-haze explanation is popular and hedged.
- The scale (×2.3), the missing ground and the mist floor are invented.

### 13.6 Sources the proposal used (external; cite, never copy images)

- [Eucalyptus deglupta, Wikipedia](https://en.wikipedia.org/wiki/Eucalyptus_deglupta): 60–78 m
  height, 240 cm trunks, 4 m buttresses, native range and habitat; bark sheds in strips revealing
  pale green, red, orange, grey and purplish brown; *deglupta* means "peeled off".
- [Rainbow in a Tree, Science Friday](https://www.sciencefriday.com/articles/rainbow-in-a-tree/):
  chartreuse → dark green → pastel purple → rusty red → burnt orange; David Lee's mechanism
  hypothesis (a one-cell transparent layer over chlorophyll, plus tannins); peeling discourages
  epiphytes; diffuse rain light makes the colours "pop".
- [Rainbow eucalyptus, ExplorersWeb](https://explorersweb.com/rainbow-eucalyptus/): a green →
  blue → purple → orange → maroon sequence and the anthocyanin note.
- [Blue Mountains (New South Wales), Wikipedia](https://en.wikipedia.org/wiki/Blue_Mountains_(New_South_Wales)),
  [Scenic World](https://www.scenicworld.com.au/why-are-the-blue-mountains-blue) and
  [How It Works](https://www.howitworksdaily.com/what-makes-australias-blue-mountains-blue/): the
  blue haze attributed, with hedging, to eucalyptus terpenes and scattering.
- [Kino, Victoria's Forestry Heritage](https://victoriasforestryheritage.org.au/activities1/producing/751-kino.html),
  [What Kind of Tree Has Red Sap?, Hunker](https://www.hunker.com/13429173/what-kind-of-tree-has-red-sap)
  and [Botany Bay Kino, Britannica](https://www.britannica.com/topic/Botany-Bay-Kino): eucalypt
  kino oozes dark red from bark wounds; thin pieces are ruby; it hardens and seals. (Background
  for why the spec removed it: §0.3, §6.9.)
- [Shadows and the Sun, Nature Institute](https://natureinstitute.org/in-context-48/henrike-holdrege/shadows-and-the-sun),
  [Tree physiology shines a light on the understory, Botany One](https://www.botany.one/tree-physiology-shines-a-light-on-the-understory/)
  and [Light regimes beneath closed canopies, Andrews Forest](https://andrewsforest.oregonstate.edu/node/13447):
  canopy gaps act as pinholes and project sun images that are elliptical on oblique surfaces;
  penumbra grows with gap-to-surface distance; sunflecks last seconds to minutes. This is the
  physics behind `rbFleck` (§4.5).
- The bark reference photos: TopTropicals (§10.1), copyrighted, view only.
