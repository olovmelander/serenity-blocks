# Thermal Bloom handover — capture sets and critic prompts

Appendix to [THERMAL_BLOOM_HANDOVER_2026-10.md](../THERMAL_BLOOM_HANDOVER_2026-10.md). The capture
tool is PLAYBOOK §5.3's `shot.mjs` (kept in a scratchpad, not the repo): `node shot.mjs
[--backend=webgl2] [--w=W --h=H] --out=<dir> NAME='<query>' …`, default 1920×1080 WebGPU. Each
shot takes 1–3 minutes on the container's CPU rasteriser; batch several names a call. `--w/--h`
and `--backend` apply to the whole call, so phone, 21:9 and WebGL2 shots go in their own calls.

## The environment set (A3–A5)

`E='effect=thermal-bloom&t=40'`

| Name | Query | Size / backend |
|---|---|---|
| D-gpu | `$E` | 1920×1080 |
| D-board | `$E&board=1` | 1920×1080 |
| D-gust | `$E&gust=0.5` | 1920×1080 |
| D-minimal | `$E&quality=Minimal` | 1920×1080 |
| D-level2 … D-level5 | `$E&level=2` … `level=5` (Straw Gold, First Frost, Deep Cold, Thaw) | 1920×1080 |
| D-erupt | `effect=thermal-bloom&t=176` (the idle eruption) | 1920×1080 |
| D-mirror | `$E&board=1&hudSide=left` (the HUD mirror rule) | 1920×1080 |
| D-nosteam | `$E&parts=sky,basin,terraces,geyser,flora` | 1920×1080 |
| D-gl, D-gl-minimal | `$E`, `$E&quality=Minimal` | WebGL2 |
| P-gpu, P-board | `$E`, `$E&board=1` | 390×844 |
| P-low | `$E&quality=Low` | 390×844, WebGL2 |
| W-gpu | `$E&board=1` | 2560×1080 |
| R43 | `$E&board=1` | 1440×1080 |

## The gameplay set (B1–B5)

`E='effect=thermal-bloom&t=40&board=1'`; `eventAge` is seconds since the event.

| Name | Query (after `$E&`) |
|---|---|
| B1-scour / B1-bloom | `event=lock&piece=L&u=0.15&row=12&eventAge=0.25` / `…eventAge=1.5` |
| B1-right (the Stair side) | `event=lock&piece=S&u=0.85&row=8&eventAge=1.5` |
| B1-bleach | `event=lock&piece=T&u=0.2&row=15&eventAge=20` |
| B1-pressure | `locks=12&event=lock&piece=T&u=0.2&row=15&eventAge=6` |
| B1-jet (hard drop) | `event=drop&piece=O&u=0.3&row=17&dist=18&eventAge=0.25` |
| B2-lips / B2-fills | `locks=10&event=clear&lines=3&row=16&eventAge=0.5` / `…eventAge=1.6` |
| B2-stripes | `locks=10&event=clear&lines=2&row=17&eventAge=4` |
| B2-cascade | `event=clear&lines=1&row=18&cascade=3&eventAge=2` |
| B2-record | `record=40` |
| B3-combo4 / B3-combo7 | `combo=4` / `combo=7` |
| B3-release2 / B3-release10 | `event=release&peak=6&eventAge=2` / `…eventAge=10` |
| B4-dome / -column / -flood / -steam | `event=quad&row=16&eventAge=0.2` / `1.4` / `3` / `9` |
| B4-false | `event=quad&row=16&eventAge=1.4&falseColor=1` |
| B5-devils / B5-rosettes | `event=tspin&lines=2&u=0.2&row=13&eventAge=3` / `…eventAge=9` |
| B5-consort / B5-double | `b2b=2` / `b2b=1&event=quad&row=16&eventAge=1.6` |
| B5-sleeper / B5-renewed | `event=perfect&eventAge=2.5` / `event=perfect&eventAge=13&record=30` |
| B5-levelup | `event=levelUp&eventLevel=3&eventAge=3` |
| B5-gameover | `event=gameOver&eventAge=4` |
| B5-reduce | `reduce=1&event=tspin&lines=1&eventAge=3` |
| B1-P, B4-P (390×844) | `event=lock&piece=T&u=0.2&row=10&eventAge=1.2`, `event=quad&row=16&eventAge=1.4` |
| B4-gl-column, B2-gl-fills, B5-gl-devils (WebGL2) | as B4-column, B2-fills, B5-devils |

## Critic prompts

Give each to a fresh agent with the shot folder filled in; it must not edit anything.

**Environment re-check.** "You are an independent art director doing a RE-CHECK. Do not edit any
code or repository file. Judge the environment stages A3 (steam), A4 (geyser and flora) and A5
(seasons, composition presets, HUD mirror, Sleeper/Consort placement) of the Thermal Bloom theme
(spec: `docs/theme-concepts/iris-springs.md` — §1.2, §1.3, §1.4, §3.3, §3.6.1, §3.6.2, §3.15 and
the A3/A4/A5 rows of §5.6). Shots: `<dir>` (names as in the environment set). [List what changed
since the last round and what to check.] Known accepted deviations: the p10 L* ≤ 25 target is
replaced by 'steam lifts p10 by ≤ ~3 L*'; on the phone the Chalice/Stair/Sleeper stand in the
right margin and the Consort in the left. Look at every image (half-size or cropped previews; crop
at 2× for detail). Judge only what you see. Return a verdict per stage (PASS or REVISE), then a
ranked defect list (blocking / major / minor) with shot, pixel box, what is wrong, what the spec
says, and a concrete fix direction. Under 900 words."

**Gameplay.** "You are an independent art director and gameplay-feel reviewer. Do not edit any
code or repository file. Judge Stage B (B1–B5) of the Thermal Bloom theme against
`docs/theme-concepts/iris-springs.md`: §1.5, §3.4, §3.5, §3.7, §3.8, §3.9, §3.10, §3.11, §3.12 and
the B1–B5 rows of §5.6. Shots: `<dir>` (names as in the gameplay set; board=1, so the dark
rectangles are the mock card and HUD, not art). A rest frame for comparison: `<D-board.png>`. For
each beat ask: does it read at a glance, is it in the world (not a decal or UI), does it stay out
of the card and HUD, does it match the spec's timing and look, and is it beautiful? [For a
re-check: list the previous findings and ask, for each, whether it is fixed.] Return a verdict per
step (PASS or REVISE), then one ranked defect list (blocking / major / minor) with shot, pixel box,
what is wrong, what the spec says, and a concrete fix direction. Under 1100 words."

## Parallel fix agents: the ownership split that worked

Two fix agents and the main session edited the theme at once without collisions, each told to
re-read a file right before every edit, lint after each, and not to commit (the main session
commits):

- **Columns and steam events:** `thermal-bloom-geyser.js`, `-devils.js`, `-fumaroles.js`; in
  `thermal-bloom-world.js` only `writeColumns`, `writeSteamOverrides`, `sustainedHeight`,
  `spawnDevils`, `writeDevils`, `addRosette` (positions), `onCombo`, `onB2B`, `buildGeyser`; in
  `thermal-bloom-core.js` only `ERUPTIONS`, `columnState`, `CHALICE` and the idle/preplay
  constants; in `thermal-bloom-steam.js` only the column/thread kinds.
- **Ground effects:** in `thermal-bloom-tsl.js` only `tbBlooms`, `tbFills`, `tbGlint`; the
  blooms, Seal, record, rosettes, flood, front and jewels in `thermal-bloom-basin.js` and
  `thermal-bloom-terraces.js`; in `thermal-bloom-world.js` only `aimRow`, `spill`,
  `writeBlooms`, `seal`, `pushFill`, `writeFills`, `layStripe`, `clearRecord`, `primeRecord`,
  `FOSSIL`, the clear/flood bookkeeping and the season front.
- **Main session:** everything else (sky, flora, motes, post, composition, the dome, seasons).

All shared one dev server on 5173 and captured into separate folders.
