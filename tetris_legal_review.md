# Serenity Blocks — Preliminary Tetris IP Risk Review

**Version:** 4.0 — full re-audit at current HEAD, with first rendered-product evidence
**Prepared:** 2026-07-16
**Repository:** `olovmelander/serenity-blocks`
**Commit reviewed:** `853d40e17e8ce25e6fab9786a151e5f41e30acd5` (branch tip at audit time)
**Supersedes:** v3.0 (2026-07-15, reviewed `main@4127ae2`) and its remediation appendix. The full v3.0 text is preserved in git history (this file's prior revision). Finding IDs are kept stable with v3.0 where the underlying issue is the same.

> **Important — not legal advice.** This is an engineering-led, evidence-based issue-spotting
> report prepared for review by qualified intellectual-property counsel. It is not legal
> advice, a legal opinion, or a trademark-clearance opinion, and it does not create an
> attorney-client relationship. Nothing here declares Serenity Blocks "legal," "safe,"
> "infringing," or "non-infringing." Risk ratings are triage estimates, not conclusions.

---

## Executive Summary

Serenity Blocks is a falling-block puzzle game (Phaser 4 board renderer, Three.js/WebGPU
theme backgrounds, Electron/Steam packaging scaffolding). This audit re-verified every
prior factual claim at the current commit, ran the actual product in a browser for the
first time (ten captures in `docs/legal/audit-evidence-2026-07-16/`), re-pulled the
governing case law from official sources, and re-verified the TETRIS trademark portfolio
record-by-record in USPTO TSDR on 2026-07-16.

**Overall Tetris-related posture: MEDIUM — improved since v3.0, still a conditional
no-go for commercial storefront submission pending counsel review.**

What improved (verified at HEAD, most confirmed in rendered captures):

- **No player-visible use of "Tetris" remains anywhere in the product.** The two Odyssey
  tips, the bundled playground metadata, and scoreboard labels now use "four-line clears,"
  "quad lane," and "Quad" (Findings TM-2/TM-3).
- **Product branding no longer uses tetromino imagery** on the surfaces this audit could
  render: the Single Player menu icon is a person-in-a-ring "solo focus" mark, the favicon
  is a single S-wave, and the startup ident shows a diamond glyph plus the wordmark
  (captures 01–03; Findings AV-7/AV-8).
- **Theme palettes were deranged at the source level** (16 theme files in PR #286); none of
  the sampled selectable themes still tracks the familiar Guideline shape→color mapping
  (Finding PAL-1). One wiring gap and one default-palette caveat remain (below).
- **The legacy gridded canvas renderer is deleted**; the fused, borderless, transparent-field
  Phaser scene is the sole board renderer, and the rendered gameplay captures confirm the
  fused presentation, the absence of a hold feature, the three-slot top preview row, no
  lock-down recolor, and a custom statistics game-over screen with no board-fill animation
  (captures 04–08; Findings AV-2/AV-3/AV-4).

What remains (the reasons the aggregate rating is still Medium):

- **The exact seven-tetromino family on an exact 10×20 visible field, with ghost, next-piece
  preview, and garbage** — the combined cluster that *Tetris Holding, LLC v. Xio
  Interactive, Inc.*, 863 F. Supp. 2d 394 (D.N.J. 2012), treated as protectable expression
  when reproduced wholesale (Findings AV-1/AV-3). The rendered gameplay, while materially
  differentiated in treatment, still presents a tall bordered dark field with bright,
  saturated multi-colored four-square pieces (captures 04–07).
- **The startup intro still draws decorative pieces from the complete conventional
  seven-tetromino repertoire in source** (both WebGPU and WebGL paths). They did not appear
  in this audit's software-rendered captures, so their rendered prominence on real hardware
  remains unverified (Finding AV-6 — retained by explicit product decision per v3.0
  appendix).
- **Total-look review is still incomplete:** one theme, one mode, no line-clear/cascade
  capture, no WebGPU rendering, no store assets. A composite TETRIS trade-dress
  registration covering a game-screen presentation (Reg. 6,704,948) and a second TETRIS "T"
  design registration in classes 9/41 (Reg. 6,707,167, found new in this audit) make the
  final rendered comparison a counsel-level task.
- **Enforcement exposure is real and current:** every core TETRIS registration checked is
  live; Tetris Holding filed a TTAB opposition against a third party's "DEPTHRIS" game mark
  in June 2025 pleading both confusion and dilution; and its DMCA program (Apotris 2023,
  tetris-os 2021, Setris/itch.io 2023) shows platform takedowns can precede any merits
  review (Finding ENF-1).

Also material, new in this audit: a live third-party registration **WORD SERENITY**
(Reg. 6,138,055, class 9 downloadable video game software, owner Aero Isle Inc) is the
closest mark found to "Serenity Blocks" — a non-Tetris clearance question counsel should
resolve before launch (Finding TM-6).

---

## Purpose, Jurisdictions, and Limitations

**Purpose.** Preliminary, evidence-based issue-spotting for qualified IP counsel ahead of
any commercial release. Review-only: no source code, assets, listings, or configuration
were modified. The only files added are this report and the evidence folder
`docs/legal/audit-evidence-2026-07-16/`.

**Jurisdictions and commercial context.** The engagement template's fields (launch
jurisdictions, product status, channels, monetization, marketing URLs) were not filled in,
and no answer was available at audit time. Per the engagement's stated fallback, this is a
**preliminary U.S. federal-law review only**. Non-U.S. regimes (EU, UK, Canada, Japan,
etc.), state-law claims, and passing-off/unfair-competition theories are out of scope and
flagged as open questions. Observable repository context suggests: **pre-release**
(placeholder `steam_appid.txt` = 480, the Valve test app ID; no store listing found in
scope), intended channels **Steam (Windows/Linux Electron builds) and web (GitHub Pages)**,
monetization unknown, and no public marketing materials in scope beyond
`game_description.md` and repository text.

**Material limitations (each affects specific findings below):**

1. **Rendering was software-only.** Captures used headless Chromium on SwiftShader;
   **WebGPU was unavailable**, so the WebGPU intro and Odyssey chapter visuals were not
   rendered; Three.js ran WebGL2 fallbacks. Intro tetromino decor never appeared on screen
   in this environment despite being live in source — unresolved (AV-6).
2. **Coverage of rendered states is partial:** default theme only; no line-clear, cascade,
   garbage, multiplayer, Odyssey, or Serenity-mode captures; no packaged Electron/Steam
   artifact was built or inspected.
3. **No store or marketing assets exist in scope** (no Steam capsule, screenshots, trailer,
   or listing copy). Trade-dress analysis of *packaging and advertising* — the strongest
   part of *Xio* — therefore cannot be completed yet.
4. **Trademark searching was preliminary.** USPTO's name/similarity search (tmsearch)
   is a JavaScript-only application and could not be queried from this environment; TSDR
   per-record status pages (official) were used instead. State registries, WIPO, EUIPO,
   UKIPO, and common-law marketplace searches were not performed. This is documented per
   record in the Source and Search Log; it is **not a clearance search**.
5. **No musicologist review or audio fingerprinting** was performed; the audio finding
   rests on file/metadata review plus the owner's documented listen-through (SND-1).
6. **No Copyright Office deposit copies** of asserted Tetris works were obtained; the
   comparison baseline is the *Xio* record and current marketplace presentation.
7. Some legal-history points rest on labeled secondary sources (e.g., "no appeal in *Xio*"
   — Wikipedia; *DaVinci v. ZiKo* — vLex/law-firm commentary).

---

## Product and Evidence Inventory

**Repository facts (verified 2026-07-16 at `853d40e`):**

| Area | Evidence |
|---|---|
| Identity | `package.json:2-4` name `serenity-blocks`, description "A modern falling-block puzzle game built with Phaser 4"; `build.appId` `com.serenityblocks.game`, `productName` "Serenity Blocks" (`package.json:42-43`); `index.html:7` title; generic keywords (`package.json:113+`) |
| Board | `src/core/constants.js:11-13` — `COLS = 10`, `ROWS = 20`, `HIDDEN_ROWS = 4` |
| Pieces | `src/core/constants.js:62-98` — conventional I/O/T/S/Z/J/L matrices (T/J/L stored in a 180°-flipped spawn orientation); `PIECE_KEYS = 'IOTZSLJ'` at `:103` |
| Default colors | `src/core/constants.js:31-41` — I green, O orange, T blue, S cyan, Z **red**, J yellow, L purple: 6 of 7 roles differ from the Guideline mapping; **Z=red matches** |
| Mechanics | 7-bag (`src/core/pieces.js:31-39`); SRS 90° kick tables (`src/core/game.js:140-159`) + 180° rotation with legacy kicks (`:130-134, 948-953`); lock delay 500 ms / 15 resets (`constants.js:166-167`); ghost (`game.js:525-546`); T-spin 3-corner (`game.js:1263-1281`); back-to-back (`physics.js:720-726`); scoring 250/500/1000/2000 (`constants.js:109-114`); cascade connected-component gravity (`board.js:313-364`, `cascade-resolver.js`, `physics.js`) |
| Rendering | Fused, seam-free, internally borderless pieces; transparent field, no grid (`src/rendering/phaser/base-board-scene.js:702-720, 800-811, 844-919`); ghost = single translucent white silhouette with faint cyan contour (`:1033-1058`); legacy 2-D canvas board renderer deleted (`src/rendering/canvas-utils.js` gone; `draw.js:1-6` header) |
| UI | Three-slot next queue (`src/ui/next-queue-ui.js:237`); **no hold feature anywhere**; DAS/ARR sliders (capture 06); custom stats (Score/Lines/Level/Next Lv/Speed/BPM/PPM) |
| Branding | Menu Single Player icon = person-in-ring "solo focus" mark (`index.html:1402-1412`; `public/styles/menu-aaa.css:358-372`); favicon = single S-wave (`public/favicon.svg`); startup ident = diamond glyph + wordmark (capture 01); intro renderers still define all seven tetromino contours in scrambled colors (`src/ui/threejs-intro-renderer-webgpu.js:196-203, 1123-1157`; `src/ui/threejs-intro-renderer.js:87-107`; `src/ui/intro-tetromino-compute.js:73-88`) |
| Strings | Standalone "Tetris" tokens: `src/` 136, `docs/` 346, `tests/` 20, `index.html` 0, `public/` 2 (both CSS comments, `public/styles/main.css:12460, 12535`). **Zero player-visible UI hits.** Former tips now read "four-line clears" (`src/core/odyssey/data/levels.js:3846`) and "quad lane" (`:4373`); internal victory-condition key `'tetris-count'` renders as "Clear N Quads"; multiplayer badge key `tetris:` renders label "Quad" (`LocalMultiplayerMode.js:3301, 3776`). No "Tetrimino" spelling anywhere in code |
| Legal text | Non-affiliation disclaimers: `README.md:58-63`, `CREDITS.md:139-144`; both files ship in web (`vite.config.js:36-46`) and Electron (`package.json` extraResources) builds; **no in-app legal/credits screen exists** |
| Audio | 36 Suno-generated MP3s with thematic names; SFX procedurally synthesized (`src/audio/sound-effects.js`); owner listen-through recorded 2026-07-15 finding no Korobeiniki/Type-A melody (`CREDITS.md:98-137`) |
| Provenance | Quadra rules/constants reuse documented in signed attestation (`quadra-provenance-attestation.md`, pinned to upstream commit `d6c7226`); Quadra-derived identifiers renamed (PRs #288/#290/#293) |

**Rendered-product evidence (new in v4.0)** — `docs/legal/audit-evidence-2026-07-16/`,
captured from the live dev build at HEAD (method and limits in that folder's README):

| Capture | Observation |
|---|---|
| 01–02 | Startup: diamond logo, `SERENITY BLOCKS` wordmark, "press any key" — **no tetromino imagery on screen** |
| 03, 09, 10 | Main menu: six mode cards, person-in-ring solo icon, tagline "STACK · BREATHE · ASCEND"; no tetromino decor appeared even after 40 s idle (software renderer; see AV-6) |
| 04 | Gameplay start: tall purple-bordered dark field (10×20), horizontal 3-slot preview row **above** the board (first slot highlighted), gray fused ghost silhouette, right-side stat cards |
| 05, 07 | Mid/late stacks: bright saturated pieces (orange O, cyan S, green I, yellow J, magenta/purple, red, blue), fused per-piece rendering with no internal cell borders, no hold UI |
| 06 | Escape opens a Settings panel (DAS delay/interval, soft-drop interval) |
| 08 | Game over: custom "The cycle ends." statistics modal (performance/rates/career/session), "press any key to restart" — **no bottom-to-top board-fill animation** |

**Not in evidence (and material):** line-clear/cascade animation, garbage insertion,
multiplayer views, non-default themes, WebGPU surfaces, packaged builds, store assets.

---

## Research Methodology and Source Hierarchy

Sources were used in this order of authority, and each proposition below is tagged to its
tier: (1) statutes and controlling judicial opinions (Cornell LII texts; GovInfo official
opinion PDF for *Xio*); (2) official court/docket materials (TTABVUE/ESTTA filings;
CourtListener metadata); (3) U.S. Copyright Office and USPTO records and guidance (TSDR
per-record status pages — official; copyright.gov circulars); (4) state/international
registries — **not searched this pass** (documented); (5) credible secondary sources for
background only (labeled: Wikipedia, press, law-firm commentary, vLex, Justia/Trademarkia
aggregators); (6) rights-holder materials (tetris.com pages, DMCA notices) treated as
**evidence of marketplace presentation and asserted rights, not statements of law**.
All web sources were accessed 2026-07-16. Repository facts were verified directly at
commit `853d40e`, with exact file:line citations. Three independent verification passes
were run (repository facts; case law/statutes; trademark records), and the rendered
product was exercised end-to-end in a browser (startup → menu → single-player → game
over) with console monitoring.

Throughout, statements are labeled as **Repository fact**, **Rendered observation**,
**External record/holding**, **Rights-holder assertion**, or **Risk inference** (this
report's reasoning, which counsel may weigh differently).

---

## Relevant Tetris Rights and Trademark Records

All statuses verified in **official USPTO TSDR status pages on 2026-07-16** unless noted.
Registration status is distinct from ownership, validity, enforceability, marketplace use,
and scope; nothing below assumes a record's assertions are correct or incontestable.

### TETRIS word marks — Tetris Holding, LLC (all LIVE)

| Reg. No. | Serial | Classes / key goods | Registered | Latest renewal |
|---|---|---|---|---|
| 2,362,238 | 75/781,744 | 9 video game cartridges/software (cl. 16 pens cancelled §8); 25 | 2000-06-27 | 2020 |
| 3,396,574 | 78/979,550 | 35 online retail, computer/video games | 2008-03-11 | 2018 |
| 1,657,499 | 74/036,747 | 28 video games, cartridges, handheld electronics | 1991-09-17 | 2021 |
| 4,592,832 | 86/178,470 | 11 lamps | 2014-08-26 | 2024 |
| 4,592,985 | 86/205,967 | 9, 41 sound recordings; concerts | 2014-08-26 | 2024 |
| 4,845,377 | 86/577,062 | 30 confectionery | 2015-11-03 | 2026 |
| 3,518,292 | 78/811,849 | 38, 41 online computer-game entertainment services | 2008-10-14 | 2018 |
| 4,313,472 | 85/159,237 | 28 handheld gaming; **tabletop vertical-matrix drop games; 3-D block stacking games** | 2013-04-02 | 2023 |
| 5,617,892 | 87/069,698 | 41 gambling-game software (cl. 28 cancelled §8) | 2018-11-27 | §8/15 2025 |
| 6,707,498 | 97/095,586 | 9 phone cases, wallpapers; 21; 32 | 2022-04-19 | — |

(Additional live word registrations in classes 14/16/18/25/28 pleaded in Opp. 91299921;
one cosmetics registration, 5,893,160, is DEAD — cancelled 2026-05-08.)

### Design, composite, and sound marks (all LIVE; owner Tetris Holding, LLC)

| Reg. No. | Serial | Mark | Classes |
|---|---|---|---|
| 2,362,250 | 75/782,993 | TETRIS in red-orange-yellow gradient inside a blue **T-tetromino** background | 9, 28 active |
| 3,818,232 | 77/890,492 | Blue T-shaped field outlined red, TETRIS gradient lettering (colors claimed) | 41 |
| 6,704,948 | 90/670,731 | **TETRIS lettering within a black rectangular playfield bordered light blue, tetrimino pieces below**; colors claimed | 9, 41 |
| 6,707,167 | 90/746,082 | **TETRIS "T" design** (word inside large T, gradient) — *new since v3.0's list* | 9 downloadable/recorded video game programs; 41 online games |
| 3,517,007 | 77/037,539 | **Sound mark**: electronic sine-wave tune based on the Russian folk song *Korobeiniki* (notes/durations specified) | 9, 28, 41 |

### Enforcement and marketplace posture (external records; rights-holder assertions)

- **TTAB Opposition 91299921 (filed 2025-06-25)** against "DEPTHRIS" (Ser. 98/026,195,
  class 9 game software): pleads §2(d) confusion **and §43(c) dilution by blurring** on 16
  registrations; states "there are no other granted registrations for the TETRIS mark
  other than those owned by Opposer." Terminated 2025-07-10, dismissed without prejudice.
  Earlier Opp. 91249666 ("TETRIS MOVING," 2019) was sustained. Pattern: active opposition
  to "-TRIS"-formative names through 2025.
- **DMCA/platform notices (verified primary):** GitHub 2021-07-16 (tetris-os — word mark,
  copyright regs. PAu 1,214,036/035 and PA 412,169/170, dilution, trade dress); GitHub
  2023-02-10 (Apotris — expressly cites *Xio* and recites the piece design/movement,
  bright colors, field "longer than it is wide" [an overclaim vs. the opinion's exact
  20×10 holding], ghost, and next-piece elements); itch.io 2023-06-05 (Setris — word mark,
  copyright, **and the Korobeiniki sound mark**; game re-released same day as "Sandtrix").
  These are claimant allegations, not adjudications; they evidence takedown capability.
- **tetris.com (2026-07-16):** promotes current official titles (Tetris Block Party, the
  mobile app, Tetris Forever, Tetris Effect: Connected, TGM4). Footer asserts: "Tetris
  logos, Tetris theme song and **Tetriminos** are trademarks of Tetris Holding" — a
  rights-holder assertion of piece-design and theme-song rights beyond the registrations
  above. Notices of suit are recorded on Regs. 3,396,574 and 6,707,498 (2022–2024).
- **No TETRIMINO/TETRIMINOS federal registration was found** (secondary/inferential —
  see search limits).

### Third-party record relevant to the product's own name

- **WORD SERENITY**, Reg. 6,138,055 (Ser. 88/692,337), owner **Aero Isle Inc.**, class 9
  "downloadable video game software," "WORD" disclaimed; registered 2020-08-25; §8 filing
  received 2026-06-04 (LIVE). Closest mark found to "SERENITY BLOCKS" in a preliminary
  (non-knockout) search. "Serenity Forge" (game publisher) shows marketplace use with no
  federal registration located — common-law question open.

---

## Applicable Legal Framework

*(External law; all texts verified 2026-07-16. U.S. federal only.)*

### Copyright

- **17 U.S.C. §102(b)** excludes ideas, procedures, processes, systems, and methods of
  operation from copyright. The Copyright Office confirms a game's idea, name, and
  "methods for playing it" are unprotected, while text, artwork, music, and audiovisual
  expression are protectable (copyright.gov games page; Circular 33 (rev. 2021)).
- ***Tetris Holding, LLC v. Xio Interactive, Inc.*, 863 F. Supp. 2d 394 (D.N.J. 2012)**
  (Wolfson, J.; published; cross-motions; summary judgment for Tetris Holding on copyright
  and trade dress; **no appeal taken** [secondary source]; persuasive authority only —
  binding on no court). Key verified points:
  - *Unprotected idea:* pieces of square blocks in different shapes falling from the top
    and accumulating; rotation to fill horizontal lines that erase; top-out ends the game.
    "Tetris Holding has given the rules of its game to the public domain, but has kept the
    rights to its expression."
  - *Protected expression on that record:* "The style, design, shape, and movement of the
    pieces are expression"; individually delineated bricks with interior borders/texture,
    similar bright colors, the same seven pieces ("Xio was also free to design a puzzle
    game using pieces of different shapes"), the exact 20×10 field ("it is not a rule to
    have the playfield be exactly 20 units by 10 units"), plus garbage lines, ghost pieces,
    next-piece display, lock-down color change, and game-over fill.
  - *Two limits:* the court cautioned that "standing alone, these discrete elements might
    not amount to a finding of infringement" — the holding rested on "wholesale copying of
    the Tetris look"; and it **expressly declined to hold** the remaining asserted
    features (e.g., starting orientations, multiplayer layout) "wholly expressive."
  - *Methodology:* reconciled *Whelan* with *Altai* abstraction-filtration-comparison;
    lay-observer comparison of "gross features"; "total concept and feel" (quoting
    *Atari*). Mino was near-identical: "Without being told which is which, a common user
    could not decipher between the two games."
  - *Merger rejected* (an "almost unlimited number" of alternative designs, per Xio's own
    expert; Dr. Mario cited as a differently-expressed rules-sharing game) and *scènes à
    faire rejected* ("Tetris is a wholly fanciful presentation"). Fair use failed.
  - *Copying admissions:* Xio "readily admits that its game was copied from Tetris,"
    downloaded the iPhone app for development, and its brief conceded "There is no
    question that Mino and Tetris look alike."
- **Balancing authorities:** *Atari v. N. Am. Philips*, 672 F.2d 607 (7th Cir. 1982)
  (idea/scènes à faire free; distinctive character expression protected); *Data East v.
  Epyx*, 862 F.2d 204 (9th Cir. 1988) (karate-game commonalities unprotected); *Incredible
  Techs. v. Virtual Techs.*, 400 F.3d 1007 (7th Cir. 2005) (realistic golf presentation =
  scènes à faire; control layout functional); *DaVinci Editrice v. ZiKo Games*, 183 F.
  Supp. 3d 820 (S.D. Tex. 2016) (reskinned clone of card-game roles/mechanics did not
  infringe) [secondary-verified]. *Xio* distinguishes the scènes-à-faire line because
  Tetris has no real-world referent — the axis that matters for Serenity Blocks is how far
  its *presentation* departs from Tetris's specific fanciful choices.
- **Remedies context:** §504 statutory damages $750–$30,000/work (to $150,000 willful);
  §412 registration timing limits; §512(c)/(g) notice, counter-notice (identity/forum
  consequences), §512(f) misrepresentation liability. The *Xio* case itself began as an
  Apple takedown → counter-notice → forced suit sequence.

### Trademark

- **15 U.S.C. §1114 / §1125(a):** likelihood of confusion as to source, sponsorship,
  affiliation, or approval. Third Circuit: ten *Lapp* factors (721 F.2d 460, 463 (3d Cir.
  1983)). **Nominative fair use** (*Century 21 v. LendingTree*, 425 F.3d 211 (3d Cir.
  2005)): plaintiff first shows confusion; defendant then must show the use of the mark is
  *necessary* to describe both products, uses *no more* of the mark than needed, and
  *accurately reflects* the relationship. "Falling-block puzzle game" describes this
  product without the mark, which weakens any necessity argument for non-essential uses.
- **Dilution — §1125(c):** requires a mark "widely recognized by the general consuming
  public"; six blurring factors. TETRIS's fame is likely to be pleaded successfully
  (Tetris Holding pleads dilution routinely, e.g., Opp. 91299921 and the 2021/2023
  notices). Dilution does not require confusion or competition — relevant chiefly to any
  TETRIS-evoking *naming* ("-tris" formatives), which Serenity Blocks does not use.
- **Remedies:** §1116 injunctions (with the TMA 2020 irreparable-harm presumption), §1117
  profits/damages/fees, §1118 destruction of articles.

### Trade dress

- **Product-design dress requires secondary meaning** (*Wal-Mart v. Samara Bros.*, 529
  U.S. 205, 216 (2000)); packaging/décor dress may be inherently distinctive (*Two
  Pesos*, 505 U.S. 763 (1992)). **Functionality** is an absolute bar, and the §43(a)(3)
  burden of proving non-functionality sits on the claimant (*TrafFix*, 532 U.S. 23
  (2001)).
- In *Xio*, the asserted dress was "the brightly-colored Tetriminos … formed by four
  equally-sized, delineated blocks, and the long vertical rectangle playfield," as used in
  **advertising and packaging**. Xio contested only functionality (secondary meaning and
  confusion effectively conceded), and the court found those choices "arbitrary
  flourishes," not functional. The registered composites (Regs. 6,704,948; 2,362,250;
  3,818,232; 6,707,167) now give Tetris Holding *registered* dress/design positions in
  game classes — but each registers a particular composite, not every tall field or
  four-square shape in isolation.

---

## Copyright Analysis

Protectability is analyzed before similarity, layer by layer.

**1. Abstract rules, mechanics, and systems — unprotectable layer.**
Falling tetrominoes, movement/rotation, line clears, scoring, acceleration, top-out,
seven-bag randomization, SRS-style kicks, lock delay, T-spins, back-to-back, hard/soft
drop, DAS/ARR: these are rules, methods, and functional data under §102(b) and the *Xio*
court's own idea framing. **Finding CODE-1 (OBSERVED; Risk Low; Confidence High):** the
implementation is independent JavaScript; the numeric scoring/speed/attack constants
reused from the LGPL game Quadra are documented as rules/formula reuse in a signed,
commit-pinned attestation (`quadra-provenance-attestation.md`), with identifier renames
completed. Caveat: mechanics' *animated presentation* still feeds the audiovisual
comparison below; and independent implementation is a defense to code copying, not to
audiovisual similarity.

**2. Source code — no material concern identified within scope.** No copied Tetris code,
comments, or structure was found; provenance records exist. (Not a forensic code
comparison against any official Tetris codebase, which was unavailable.)

**3. Individual visual/audio assets.** Theme worlds, icons, and music are original or
AI-generated with provenance issues tracked separately (v3.0 §13 GEN findings — most
resolved or in progress; the remaining chain-of-title items are non-Tetris release
blockers and are outside this report's Tetris scope). No Tetris-derived asset was found.
**SND-1 (OBSERVED source-level; Risk Low; Confidence Medium):** no textual/metadata trace
of *Korobeiniki*; owner listen-through (2026-07-15) found no match; independent
musicologist/fingerprint verification remains outstanding. The live sound-mark
registration (3,517,007) and the tetris.com "theme song" assertion make this worth closing
properly before launch.

**4. The audiovisual combination — the operative risk.**

*Similarities to the Xio-protected cluster (Repository fact + Rendered observation):*
the exact seven-piece family (`constants.js:62-98`); the exact 10×20 visible field
(`:11-13`); bright, saturated, distinct piece colors (captures 04–07); ghost piece;
next-piece preview; garbage lines (multiplayer); falling/rotating motion.

*Material differences (each verified at HEAD; most confirmed rendered):*

- **No individually delineated bricks:** pieces render as fused, seam-free silhouettes with
  no interior borders, on a transparent field with no grid (`base-board-scene.js:702-720,
  844-919`; captures 04–07). This directly negates the "individually delineated bricks,
  each … given an interior border" element the *Xio* court emphasized.
- **Scrambled shape→color mapping** by default (6/7 roles differ; Z=red retained —
  `constants.js:31-41`) and deranged mappings in the sampled selectable themes (PAL-1).
- **Three-slot preview row placed horizontally above the board** (capture 04) versus the
  conventional right-side vertical queue; **no hold feature at all**.
- **No lock-down color change** (`game.js:1214` re-resolves the same theme color) and **no
  game-over board-fill** — game over is a statistics modal (capture 08); multiplayer
  elimination is a gentle fade overlay (`LocalMultiplayerMode.js:4024-4090`). Both were
  named expressive elements in *Xio*; both are absent.
- **Cascade connected-component gravity** producing visibly different post-clear behavior;
  custom scoring/progression/stats (BPM/PPM); Serenity/Odyssey/Infinity modes; atmospheric
  scenic themes as the dominant visual identity.

**Finding AV-1 (OBSERVED; Risk Medium as an aggregate contextual factor; Confidence
High):** the seven-piece family plus exact 10×20 field remain, by explicit product
decision. Under *Xio* these are part of a protectable *combination* even though "standing
alone … might not amount to … infringement." **Finding AV-3 (OBSERVED; Risk Medium
aggregate / Low–Medium individually; Confidence High for captured elements, Medium for
uncaptured garbage/multiplayer):** ghost/preview/garbage cluster present but differently
treated. **Findings AV-2/AV-4/AV-5 (OBSERVED; mitigating; Confidence High for rendered
confirmations):** fused rendering, absent lock-recolor/game-over-fill, cascades.

*Arguments supporting concern:* a claimant would assemble the retained cluster
(7 pieces + 10×20 + ghost + preview + garbage + bright colors) and argue total-concept-
and-feel similarity to a Tetris audiovisual work; access is indisputable (the repo's own
design docs name Tetris Effect and Tetris 99 as references); the 2023 Apotris notice shows
the rights holder asserting exactly this cluster against far-less-similar targets.

*Counterarguments and distinctions:* *Xio* turned on near-identity and admitted copying —
"a common user could not decipher between the two games"; no ordinary observer would
confuse capture 05 with a current official Tetris product's screen; the most specific
expressive choices *Xio* listed (delineated/bordered bricks, Guideline colors, lock
recolor, game-over fill, right-side queue, hold) are each absent or replaced; merger/
scènes à faire remain rejected defenses here too, but the filtered comparison operates on
a much thinner set of shared expression; and the balancing cases (*Data East*, *Incredible
Techs.*, *DaVinci*) support genre-level freedom where specific expression diverges.

**Finding AV-6 — intro seven-piece decoration (POTENTIAL CONCERN; Risk Medium; Confidence
Medium — rendered evidence unavailable).** Source still spawns drifting decorative pieces
from the complete conventional seven-type repertoire around the wordmark in both intro
paths (`threejs-intro-renderer-webgpu.js:1123-1157`; `threejs-intro-renderer.js:99-107`).
They never appeared in this audit's software-rendered captures (01–03, 09, 10), so their
on-hardware prominence is unverified. Because this is *branding/identity* use of the
conventional piece repertoire (not gameplay necessity), it is the highest-leverage
remaining visual item: abundant alternatives exist, and it sits exactly where trade-dress
and packaging comparisons focus. Retained by product decision per the v3.0 appendix — that
decision should be revisited with counsel once a hardware capture exists.

**Unresolved facts for the copyright analysis:** rendered line-clear/cascade sequences;
all other themes (do any read closer to Guideline colors in situ?); WebGPU surfaces;
packaged-build parity; which specific registered/deposited Tetris works a claimant would
assert (deposit copies not obtained).

---

## Trademark Analysis

**Name, logo, icon, branding.** "SERENITY BLOCKS" shares no sound, appearance, meaning, or
commercial impression with TETRIS; it is not a "-tris" formative (the naming pattern
Tetris Holding actively opposes, per Opp. 91299921). The wordmark, diamond ident, S-wave
favicon, and solo-ring icon (captures 01, 03; `index.html:1402-1412`; `favicon.svg`) bear
no resemblance to the registered TETRIS word or design marks. **Finding TM-1 (NO MATERIAL
CONCERN IDENTIFIED WITHIN SCOPE for Tetris conflicts; Risk Low; Confidence High).**
Separately, **Finding TM-6 (NEEDS COUNSEL; Risk unrated; Confidence Medium):** the live
third-party registration WORD SERENITY (Reg. 6,138,055, cl. 9 downloadable video game
software) and the unregistered "Serenity Forge" marketplace presence are the closest marks
to the product's own name found in a preliminary search; ordinary clearance for "SERENITY
BLOCKS" (including a proper knockout search, which this environment could not run) should
be completed before launch.

**Public uses of "Tetris."** At HEAD there are **zero player-visible uses** (verified by
string classification; Product and Evidence Inventory above). What remains: (a) two CSS
comments in a shipped stylesheet (`public/styles/main.css:12460, 12535`), (b) internal
identifiers (`'tetris-count'`, badge key `tetris:`, playground event kind `'tetris'`) that
never render, and (c) extensive references in `docs/` and git history. **Findings TM-2/
TM-3 (remediated; residual Risk Low; Confidence High):** none of these is trademark *use*
in commerce as a source identifier; the shipped-comment and identifier hygiene items are
cheap to finish. **Finding TM-4 (OBSERVED; no standalone infringement rating):** internal
design documents naming Tetris Effect/Tetris 99 as references are evidence of access and
could color intent narratives if expressive similarity were first shown; they are not
themselves actionable uses. Do not rewrite history; write future design docs in
independent terms.

**Metadata, keywords, domains, SEO.** `package.json` keywords are generic; no store
listing exists yet to review. No Tetris keyword/tag/SEO use found in scope. Store metadata
must be re-audited when drafted (see Remediation). Nominative-use note: under *Century 21*,
even a truthful comparative reference ("like Tetris") in store copy must be necessary,
minimal, and accurate — the safer course this repo already follows is the generic
"falling-block puzzle game."

**Confusion factors (Lapp) sketch, for counsel's structure, not a conclusion:** mark
similarity (factor 1) is near-zero for the name and current branding; TETRIS's strength
(2) is very high; goods identity (9) and channels (7) would overlap fully at launch —
which is why factor 1 and the trade-dress presentation carry the analysis; intent (5)
would be contested on the design-doc references vs. the documented divergence program.

**Dilution.** No TETRIS-evoking name or mark is used; blurring/tarnishment exposure from
naming is not indicated. Dilution reappears only if branding were to re-adopt
tetromino-repertoire identity (AV-6 is the open item adjacent to this).

**Disclaimers.** The README/CREDITS non-affiliation notices (shipped as files in both
build targets, but with **no in-app surface**) are accurate-relationship evidence that
supports a nominative posture and undercuts affiliation claims; they cannot cure
confusion, copyright, or trade-dress problems. **Finding TM-5 (OBSERVED; mitigating;
Confidence High).** An in-app legal/credits screen would make the notice actually reach
users of packaged builds.

---

## Trade Dress Analysis

**Defining the asserted dress precisely** (as required — not "look and feel"): the
plausible assertions are (i) the *Xio* dress — brightly colored four-square pieces of
equally sized, delineated blocks plus a tall vertical rectangular playfield, as used in
advertising/packaging; (ii) the registered composite Reg. 6,704,948 — TETRIS lettering
within a black rectangular field bordered light blue with tetrimino pieces below (colors
claimed); (iii) the registered T-composites (2,362,250; 3,818,232; 6,707,167); and (iv)
the registered sound mark (3,517,007).

**Functionality and distinctiveness.** Under *TrafFix*/*Xio*, the specific colors,
delineated-brick styling, and exact 20×10 proportion were held non-functional "arbitrary
flourishes" on that record; a tall-rectangle playfield *as such* sits closer to function
(it is where the game happens) and *Xio* is weaker authority for it in isolation. As
product-design/screen dress, secondary meaning would be required (*Wal-Mart*) — likely
provable for Tetris's classic presentation given fame, but that is a claimant's burden,
not an assumption.

**Comparison of overall commercial impression (rendered evidence vs. records):**

| Asserted dress element | Serenity Blocks at HEAD | Assessment |
|---|---|---|
| Brightly colored four-square pieces | Present in gameplay (captures 05, 07) — but fused/seamless, no delineated blocks, scrambled color roles | Partial overlap; the *delineation* half of the *Xio* dress is absent |
| Individually delineated, bordered blocks | Absent (`base-board-scene.js:713`) | Material difference |
| Tall vertical rectangular playfield | Present: 10×20, purple-glow border, transparent dark field (capture 04) | Overlap on the weakest (most function-adjacent) element |
| Black field bordered light blue + TETRIS lettering + piece row (Reg. 6,704,948) | Dark field bordered **purple**; no lettering; no piece row; preview row is inside the frame, top | Gestalt overlap limited to "dark tall bordered field with colored pieces"; composite's dominant features absent — but this comparison is exactly what counsel should make against final store art |
| T-tetromino composites (2,362,250; 3,818,232; 6,707,167) | No T-piece branding remains (menu icon replaced; capture 03) | No current overlap; AV-6 intro pieces are the nearest open surface |
| Korobeiniki sound mark | No textual/metadata trace; owner listen-through negative; independent verification pending | Low, unverified |
| Packaging/advertising presentation | **Does not exist yet** — no store assets in repo | INSUFFICIENT EVIDENCE — the decisive trade-dress surface is still unbuilt |

**Alternative designs** (relevant to both functionality and remediation): different field
proportions/shapes, non-four-unit or expanded polyform vocabularies, non-repertoire
branding glyphs — all available, several already adopted (S-wave, solo ring, diamond).

**Consumer context.** Free/impulse game marketplaces (Steam, web) mean low purchaser care;
surrounding branding (name, wordmark, tagline, scenic themes) is strongly differentiated;
no evidence of actual confusion exists (pre-release).

**Finding TD-1 (POTENTIAL CONCERN; Risk Medium, driven by the unbuilt store surface and
the retained field/piece cluster; Confidence Medium):** current in-game presentation shows
material, verified differences from the asserted dress, but (a) only one theme/mode was
rendered, (b) store/packaging assets do not exist to review, and (c) screenshots chosen
for marketing could easily foreground the most Tetris-like view (a clean stack of bright
pieces in a tall bordered field) rather than the differentiators. Marketing curation is
therefore a primary control point.

---

## Side-by-Side Feature Comparison

"Present" ≠ infringing; "different" ≠ cleared. The legal comparison returns to the total
concept and feel of specific asserted works. Rows marked ⚠ were expressly *not* resolved
as protectable in *Xio*.

| Xio-discussed element | Tetris reference treatment | Serenity Blocks at HEAD (evidence) | Effect |
|---|---|---|---|
| Seven tetromino pieces | Same seven, Guideline colors | Same seven (`constants.js:62-98`); scrambled/deranged colors | Raises aggregate risk |
| Bright distinct colors | Bright, shape-locked palette | Bright but role-scrambled (captures 05/07; PAL-1) | Partial overlap |
| Individually delineated, bordered bricks | Core visual signature | **Absent** — fused seamless silhouettes (`base-board-scene.js:702-919`; captures 04–07) | Strong mitigation |
| Exact 20×10 field | Exact | **Exact 10×20** + 4 hidden (`constants.js:11-13`; capture 04) | Raises aggregate risk |
| Piece movement/rotation | Standard | Standard + 180° rotation (`game.js:130-134`) | Rules-level; motion expression for counsel video review |
| Next-piece display | Right-side vertical queue | **Top horizontal 3-slot row**, first highlighted (`next-queue-ui.js:237`; capture 04) | Overlap, different treatment |
| Hold queue | Standard in modern Tetris | **Absent entirely** | Mitigation |
| Ghost piece | Delineated ghost | Fused translucent silhouette, faint cyan contour (`:1033-1058`; capture 04) | Overlap, different treatment |
| Lock-down color change | Present | **Absent** (`game.js:1214`) | Strong mitigation |
| Game-over board fill | Squares fill bottom-to-top | **Absent** — stats modal "The cycle ends." (capture 08) | Strong mitigation |
| Garbage lines | Present | Present, custom multi-hole/matte (`garbage.js`) — not rendered this audit | Moderate factor |
| ⚠ Starting orientations | Guideline spawn | T/J/L stored 180°-flipped (`constants.js:73-97`) | Left open in *Xio*; minor |
| ⚠ Multiplayer layout (big player + small opponents) | Tetris 99-style | Custom implementation; docs name Tetris 99/Jstris as inspiration | Left open in *Xio*; storefront factor |
| Post-clear behavior | Rows consolidate downward rigidly | **Connected-component cascade physics** (`board.js:313-364`) — not rendered this audit | Material mitigation (unverified rendered) |
| Branding with pieces/field | TETRIS composites; piece-forward packaging | Wordmark, diamond, S-wave, solo ring (captures 01/03); **intro seven-piece decor live in source, unrendered** (AV-6) | Main open branding item |
| Theme song (Korobeiniki) | Registered sound mark | No trace; owner listen-through negative; independent check pending | Low, unverified |

---

## Consolidated Risk Register

Risk = plausibility that the fact pattern could materially support a claim (not
probability of suit or loss). Confidence = strength of this audit's evidence.

| ID | Status | Theory | Issue | Risk | Confidence | Counsel review? |
|---|---|---|---|---|---|---|
| TM-1 | NO MATERIAL CONCERN WITHIN SCOPE | Trademark | "Serenity Blocks" name & metadata vs. TETRIS | Low | High | At clearance |
| TM-2 | Remediated (was concern in v3.0) | Trademark | Player-visible "Tetris" strings — none remain | Low | High | No |
| TM-3 | OBSERVED | Trademark | Bundled non-rendered strings (2 CSS comments; internal keys) | Low | High | No — hygiene |
| TM-4 | OBSERVED | Trademark (evidence) | Docs/history references to Tetris products as design targets | Low (no standalone claim) | High | Contextual |
| TM-5 | OBSERVED | Mitigation | Disclaimers ship as files; no in-app surface | Mitigating | High | Approve final text |
| TM-6 | NEEDS COUNSEL | Trademark (3rd party) | WORD SERENITY Reg. 6,138,055 (cl. 9); Serenity Forge common-law | Unrated | Medium | **Yes — before launch** |
| AV-1 | OBSERVED / POTENTIAL CONCERN | Copyright | Exact 7-piece family + exact 10×20 field retained (product decision) | Medium (aggregate) | High | **Yes** |
| AV-2 | OBSERVED (mitigating) | Copyright/dress | Fused borderless rendering, transparent field — rendered-confirmed | Mitigating | High | With captures |
| AV-3 | OBSERVED / POTENTIAL CONCERN | Copyright | Ghost + preview + garbage cluster (different treatments) | Medium aggregate | High (captured) / Medium (garbage) | **Yes** |
| AV-4 | OBSERVED (mitigating) | Copyright | No lock recolor; no game-over fill — rendered-confirmed | Mitigating | High | With captures |
| AV-5 | OBSERVED (mitigating) | Copyright | Cascade physics, scoring, modes, progression | Mitigating | High (source) / Medium (rendered) | With captures |
| AV-6 | POTENTIAL CONCERN | Copyright + dress | Intro decor drawn from complete 7-piece repertoire (source-live; not rendered in this environment; retained by owner decision) | Medium | Medium | **Yes** |
| AV-7 | Remediated | Dress/branding | T-piece menu icon → solo-ring mark (rendered-confirmed) | Low | High | No |
| AV-8 | Remediated | Dress/branding | Favicon → S-wave; packaged `build/icon.ico` regeneration still pending (`docs/desktop-icons.md`) | Low | High (favicon) / Medium (packaged icon) | No |
| PAL-1 | OBSERVED, mostly remediated | Copyright/dress | Palettes deranged at source; **open:** rainy-window config not wired (falls back to default), default keeps Z=red (6/7), no runtime CI gate, no rendered per-theme review | Low–Medium | High (source) / Low (rendered) | With theme captures |
| TD-1 | POTENTIAL CONCERN / INSUFFICIENT EVIDENCE | Trade dress | Total store/packaging impression — store assets don't exist yet; composite Reg. 6,704,948 & Reg. 6,707,167 are the records to compare against | Medium | Medium | **Yes — gate store art** |
| CODE-1 | OBSERVED | Copyright (§102(b)) | Mechanics/rules implementation; Quadra formula reuse (attested) | Low | High | Confirm attestation |
| SND-1 | OBSERVED / INSUFFICIENT EVIDENCE | Sound mark / © | No Korobeiniki trace; owner-only listen-through; Reg. 3,517,007 live; tetris.com asserts "theme song" | Low (unverified) | Medium | **Yes — verification protocol** |
| ENF-1 | OBSERVED (external) | Enforcement | Active portfolio, 2025 TTAB opposition practice, DMCA program; takedown may precede merits | Unquantified likelihood / High impact | High | Response-plan review |

---

## Recommended Remediation Plan

*(Reference-only; no changes were made. Ordered by leverage per unit cost.)*

**P0 — before any storefront submission or public commercial release**

1. **Counsel total-look review with real hardware captures** (AV-1/AV-3/AV-6/TD-1): capture
   every shipping theme and mode — spawn, rotation, ghost, stack heights, 1–4-line clears,
   cascades, garbage, pause, game over, multiplayer, startup/menu — on a WebGPU-capable
   machine, plus the packaged build. Compare against the specific Tetris works counsel
   expects to be asserted and against Regs. 6,704,948/6,707,167/2,362,250. This audit's
   captures (default theme, software renderer) are a floor, not a substitute.
2. **Resolve AV-6 with counsel:** obtain a hardware capture of the intro; if the drifting
   pieces are prominent, replace the repertoire with a non-tetromino visual grammar
   (petals, stones, waves, shards, pentomino-excluding polyforms). Currently retained by
   product decision — document the rationale either way.
3. **Store-asset gate (TD-1):** when Steam/web listing art is drafted, require screenshots
   that foreground the differentiators (fused silhouettes, cascades, scenic worlds, top
   preview row, breath/serenity framing) and avoid a clean bright stack in a tall bordered
   field as the hero image; run the trademark/string scan over all listing copy, tags, and
   keywords; no TETRIS or "-tris" tokens, no "Tetrimino."
4. **Finish palette work (PAL-1):** wire or delete the dead `rainy-window-tetrominos.js`
   config (`rainy-window-theme.js` currently falls back to the default palette); decide
   whether the default's Z=red should also be deranged; add the runtime-aware CI palette
   gate (enumerate selectable themes, resolve actual runtime configs, fail on a full
   Guideline role mapping); render-review swatches per theme.
5. **Independent audio verification (SND-1):** musicologist or fingerprint pass over all 36
   tracks + all cues + any trailer audio against the Reg. 3,517,007 tune; retain the
   evidence with the CREDITS record.
6. **Name clearance for "SERENITY BLOCKS" (TM-6):** proper knockout + full search
   (word/phonetic/design), with WORD SERENITY (Reg. 6,138,055) and Serenity Forge
   addressed explicitly; extend to launch territories when defined.
7. **Production-string release gate (carried from v3.0 P0.1):** automated scan of built
   artifacts (web `dist/`, Electron package) rejecting case-insensitive standalone
   `tetris`/`tetrimino` outside a single counsel-approved legal notice; also strip the two
   shipped CSS comments (`public/styles/main.css:12460, 12535`) and the stale
   `menu-aaa.css:351` comment as part of normal build hygiene.

**P1 — coordinated separation and product hardening**

8. Revisit the retained 7-piece/10×20 cluster as a *package* with counsel (field
   proportions, piece vocabulary, entry/rotation expression, clear/end sequences) — *Xio*
   makes the exact field dimension and same-seven-pieces choice the two strongest
   remaining levers; changing either is a product decision with real design cost, which is
   why it needs a counsel-informed risk/benefit call rather than a default.
9. Add an in-app Legal/Credits screen surfacing the non-affiliation notice and
   attributions (TM-5); generate the packaged `build/icon.ico` from the S-wave master and
   visually inspect favicon at 16/32 px, menu icon states, and installed shortcut/taskbar
   icons (AV-8 residue; `docs/desktop-icons.md`).
10. Replace `steam_appid.txt` placeholder before any Steam build leaves the dev machine;
    re-run this audit's string/branding checks on the final Steam metadata.

**P2 — governance**

11. Style guide: "tetromino" only; no competitor names as requirements/"north stars" in new
    design docs; preserve history (no rewrites); maintain the independent-design log and
    counsel evidence packet (commit hash, captures, provenance, this report).
12. Re-verify TSDR records and re-run searches immediately before launch (registrations,
    oppositions, and marketplace change; this audit's snapshot is 2026-07-16).

---

## Pre-Launch Counsel Review Items

1. Total-look comparison (P0.1 captures) against the specific asserted Tetris audiovisual
   works and registered composites — the single decision this audit cannot make.
2. The retained 7-piece + 10×20 cluster: acceptable residual risk or redesign (AV-1)?
3. Intro tetromino decoration: retain, restyle, or replace (AV-6)?
4. Store art and listing copy approval against trade-dress and nominative-use standards
   (TD-1), including any comparative or genre references.
5. "SERENITY BLOCKS" clearance opinion (TM-6) and launch-territory extension.
6. Audio verification protocol sufficiency (SND-1) and the CREDITS music chain-of-title
   items carried from v3.0 §13.
7. Quadra attestation adequacy and LGPL non-derivation conclusion (CODE-1).
8. Platform-takedown response plan: designated contact, counter-notice calculus under
   §512(g) (the *Xio* litigation began exactly this way), preservation duties, and a
   rapid visual/metadata patch strategy that doesn't prejudice defenses (ENF-1).
9. Whether a license inquiry is commercially sensible for any retained presentation
   counsel judges too close (tetris.com/contact-us) — noting a license is not required for
   unprotectable mechanics.

---

## Missing Evidence and Open Questions

- Hardware/WebGPU captures: intro (AV-6), Odyssey chapters, every selectable theme,
  line-clear/cascade/garbage/multiplayer sequences, packaged builds.
- Final store listing, capsule/hero art, trailer, screenshots, keywords — none exist yet.
- Launch jurisdictions, product status, channels, and monetization — unanswered engagement
  fields; non-U.S. analysis not started.
- Deposit copies of asserted Tetris copyright registrations (e.g., PA 412,169/170,
  PAu 1,214,035/036 cited in the 2021 notice) for a work-specific comparison.
- Full trademark knockout search (tmsearch unavailable headlessly); state registries;
  WIPO/EUIPO/UKIPO; common-law sweep for both TETRIS-adjacent and SERENITY-adjacent uses.
- Independent audio analysis; cover-art provenance for the 36 music files.
- Whether any *Xio* post-judgment materials (permanent injunction text) matter for scope —
  PACER not accessed.
- Non-Tetris release blockers tracked in v3.0 §13 (GEN-2 landscape model, GEN-6 TTS
  records, GEN-7 generated-3D inputs, GEN-8 root LICENSE, GEN-9 vendor notices) — several
  were fixed in PRs #285–#293 but the set was not re-audited this pass and should be
  re-verified before release.

---

## Source and Search Log

All accessed 2026-07-16 unless noted. **Official/primary:**

- *Tetris Holding v. Xio* opinion (official PDF): govinfo.gov/content/pkg/USCOURTS-njd-3_09-cv-06115/pdf/USCOURTS-njd-3_09-cv-06115-0.pdf
- Statutes (Cornell LII texts): law.cornell.edu/uscode/text/17/102, /107, /412, /504, /512; law.cornell.edu/uscode/text/15/1114, /1116, /1117, /1118, /1125
- Copyright Office: copyright.gov/register/tx-games.html; copyright.gov/circs/circ33.pdf (rev. 2021)
- Supreme Court (LII): *Wal-Mart v. Samara* 99-150; *TrafFix* 99-1571; *Two Pesos* 91-971
- Third Circuit: *Interpace v. Lapp*, 721 F.2d 460 and *Century 21 v. LendingTree*, 425 F.3d 211 (law.resource.org official-reporter mirrors)
- USPTO TSDR status pages (tsdr.uspto.gov/statusview/…): rn2362238, rn3396574, rn1657499, rn4592832, rn4592985, rn4845377, rn3518292, rn4313472, rn2362250, rn3818232, rn6704948, rn3517007, rn5617892, rn5893160, rn7037163, sn90746082, sn97095586, sn88692337, sn86390148
- TTABVUE: oppositions 91249666 and 91299921; ESTTA1444843 (2025 notice of opposition PDF)
- DMCA/takedown notices: github.com/github/dmca 2021/07/2021-07-16-tetris.md and 2023/02/2023-02-10-tetris.md (raw-verified); itch.io/takedowns/2073998

**Secondary (labeled where relied on):** CourtListener metadata (Xio parallel cites; case
metadata); Wikipedia (Xio: no appeal — sole source for that point); vLex + fkks.com
(*DaVinci v. ZiKo*); press coverage (Setris→Sandtrix; *Ackerman v. Apple/TTC* dismissal,
S.D.N.Y. Mar. 2025); Justia/Trademarkia/LegalHoop/uspto.report aggregators (supplemental
trademark data). **Rights-holder materials (marketplace evidence only):** tetris.com,
/terms-conditions, /contact-us (footer asserts "Tetris logos, Tetris theme song and
Tetriminos are trademarks of Tetris Holding").

**Fetch failures / substitutions:** Justia opinion pages (HTTP 403 → GovInfo/LII);
CourtListener full-text API (401 → metadata only); OpenJurist (403 → law.resource.org);
TSDR XML API (404 without key → official statusview HTML); tmsearch.uspto.gov (JS-only →
**no systematic similarity search performed**).

**Not searched:** USPTO name/similarity search, state trademark registries, WIPO Global
Brand DB, EUIPO/UKIPO or any non-U.S. register, PACER, Copyright Office deposit copies,
common-law/app-store sweeps. This log is what makes the search *preliminary*.

**Repository evidence:** commit `853d40e17e8ce25e6fab9786a151e5f41e30acd5`; rendered
captures + method notes in `docs/legal/audit-evidence-2026-07-16/`; string-scan counts and
file:line citations as given inline; git range examined for delta since v3.0:
`4127ae2..853d40e` (11 remediation PRs, +1177/−1250 across 56 files, no risk-increasing
additions found).

---

## Attorney Handoff

**Most important evidence to review first:** (1) the ten rendered captures in
`docs/legal/audit-evidence-2026-07-16/` against current official Tetris products and Reg.
6,704,948 — then demand the missing hardware/theme/line-clear captures before forming a
view; (2) `src/core/constants.js:11-13, 31-41, 62-98` (the retained cluster) next to
`src/rendering/phaser/base-board-scene.js:702-919` (the divergent presentation); (3) the
intro renderers (`src/ui/threejs-intro-renderer*.js`) pending a hardware capture; (4) the
TSDR snapshot above; (5) `quadra-provenance-attestation.md` and `CREDITS.md:98-144`.

**Most important questions:** Is the retained 7-piece/10×20 + ghost/preview/garbage
combination, as *actually rendered across all themes*, far enough from the asserted works
under *Xio*'s total-concept-and-feel comparison? Should the intro's seven-piece decor
survive? What store-art constraints should bind marketing? Does "SERENITY BLOCKS" clear
against Reg. 6,138,055 and common-law users?

**Proposed changes awaiting a legal read before implementation:** the P0 list above —
counsel should confirm priority and sufficiency rather than treat it as a compliance
checklist. This report deliberately keeps risk ratings (plausibility) separate from
evidence confidence; the Medium aggregate rating reflects a genuinely improved but
incompletely verified position, not a clearance.

*Prepared by an automated audit agent from repository, rendered-product, and public-record
evidence; all limitations disclosed above. Not legal advice.*
