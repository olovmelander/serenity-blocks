# Serenity Blocks — Tetris Intellectual-Property Legal-Risk Review

**Prepared:** 2026-07-15
**Scope:** Trademark, copyright, and trade-dress exposure of the *Serenity Blocks* codebase relative to the Tetris® intellectual-property portfolio held by Tetris Holding, LLC and licensed/enforced through The Tetris Company, LLC ("TTC").
**Repository reviewed:** `olovmelander/serenity-blocks` (branch `claude/serenity-blocks-tetris-legal-4985pp`), full working tree including `src/`, docs, and package metadata.

> ⚠️ **Not legal advice.** This document is an engineering-led risk assessment intended to help prioritize remediation before a commercial release. It is **not** a legal opinion and does not create an attorney–client relationship. Tetris IP is among the most aggressively enforced in the games industry; before shipping commercially (especially on Steam, which is explicitly targeted by the build config), have a qualified IP attorney review the product. Several findings below are judgment calls that only counsel can resolve.

---

## 1. Executive summary

Serenity Blocks is, functionally, a near-complete implementation of modern "Guideline" Tetris: 10×20 playfield, the seven standard tetromino shapes, the Super Rotation System with the canonical wall-kick tables, a 7-bag randomizer, ghost piece, hard drop, lock delay, T-spin and Back-to-Back detection. **Functionally cloning Tetris is not, by itself, illegal** — U.S. copyright does not protect game rules or mechanics (*Tetris Holding, LLC v. Xio Interactive, Inc.*, 863 F. Supp. 2d 394 (D.N.J. 2012)). The legal exposure lies elsewhere: in **trademark use of the word "Tetris,"** in **audiovisual/trade-dress expression** that overlaps with Tetris's protected "look and feel," and in the **evidentiary record of intentional imitation** scattered through the code comments and design docs.

The good news is that the project's *branding* is already genericized ("Serenity Blocks," "blocks," "pieces"), the *default* piece-color mapping is deliberately scrambled away from the Guideline palette, no Tetris music (Korobeiniki / "Type A") is present, and no official Tetris art or audio assets were found. This puts Serenity Blocks in a **materially better position than the infringing "Mino" game** that lost the Xio case. It is not, however, risk-free.

### Overall risk posture: **MODERATE**, with a small number of **HIGH**, cheap-to-fix items.

| # | Finding | Type | Risk | Fix cost |
|---|---------|------|------|----------|
| A | "Tetris" in publishable metadata & marketing copy (`package.json` description + keyword, README, `game_description.md`) | Trademark | **HIGH** | Trivial |
| B | In-game UI string literally labeled **"Tetris"** (multiplayer scoreboard) | Trademark | **HIGH** | Trivial |
| C | Themes reproducing the exact Guideline 7-color piece palette (`voltage-storm`, `neon-district`) combined with exact 10×20 field | Trade dress | **MEDIUM–HIGH** | Low |
| D | Documented intent to imitate specific commercial products ("Tetris Effect," "Tetris 99") as design "north star" | Copyright / trade dress (willfulness) | **MEDIUM** | Low |
| E | "Quadra"-derived scoring/speed/physics — Quadra is a **GPL** clone; project declares MIT | Copyright / license (non-Tetris) | **MEDIUM** | Medium |
| F | Guideline mechanics & terminology surfaced on-screen ("T-SPIN," "BACK-TO-BACK") | Trade dress (weak) | **LOW–MEDIUM** | Low |
| G | Verbatim Guideline SRS wall-kick tables; 7-bag; ghost; lock-delay constants | Copyright (mechanics = ideas) | **LOW** | N/A (defensible) |
| H | Generic "tetromino" naming; the 7 tetromino shapes; internal `'tetris'` code identifiers | Trademark / copyright | **LOW** | Cosmetic |
| I | No `LICENSE` file (MIT declared) and no non-affiliation disclaimer | Hygiene | **LOW** | Trivial |

**Top four actions before any public/commercial release:** (1) strip "Tetris" from all publishable metadata and in-game UI (A, B); (2) add a prominent non-affiliation disclaimer (I); (3) reskin or retire the two themes that copy the Guideline palette, and vary the playfield presentation (C); (4) resolve the Quadra/GPL license question with counsel (E).

---

## 2. Legal framework

Three distinct bodies of law are in play. They protect different things and require different remediation.

### 2.1 Copyright — mechanics are free, *expression* is not

The controlling authority for Tetris clones is **Tetris Holding, LLC v. Xio Interactive, Inc.**, 863 F. Supp. 2d 394 (D.N.J. 2012). Xio's "Mino" copied Tetris's gameplay. The court held:

- **Not protectable (ideas / rules / function):** the concept of a falling-block game, clearing full horizontal lines, a grid, a "next piece" preview box, and the *rules* of movement and rotation. "There is no copyright in game mechanics or rules."
- **Protectable (expression):** *the specific way those mechanics are expressed audiovisually.* The court expressly listed: the **composition of the tetriminos** (four delineated square blocks forming the seven shapes) and their **vivid coloring**; the **dimensions of the playing field**; the way pieces **fall, rotate, and change appearance on lock-down**; the display of upcoming/locked pieces; and the **game-over screen**. Mino copied these "wholesale," and a layperson could not tell the two games apart — so it infringed.

**Key takeaway for Serenity Blocks:** you may implement every Tetris *rule* you like. Liability attaches when the *audiovisual presentation* is so close that an ordinary observer would confuse the two. The defense is **expressive divergence** — different piece colors, board styling, effects, fonts, and overall visual identity. Serenity Blocks already does much of this (heavy per-theme reskin, scrambled default colors), which is its main protective asset.

### 2.2 Trademark — the word "TETRIS" and related marks

`TETRIS` is a live, incontestable registered trademark of Tetris Holding, LLC (e.g., USPTO Reg. No. 4,592,985; multiple additional registrations covering downloadable game software and entertainment services). TTC also asserts rights in the coined term **"Tetrimino"/"Tetriminos"** (note the *i* spelling — distinct from the generic mathematics term "tetromino").

Trademark liability turns on **likelihood of consumer confusion**, and it is triggered by *use of the mark*, independent of copyright. Using "Tetris" in a product title, store description, keyword/metadata, or on-screen text to identify or market a competing falling-block game is the single most reliable way to draw a cease-and-desist. "Tetris-inspired" may arguably be *nominative/descriptive* use (referring to the genre), but it is legally risky in commercial marketing and is exactly the kind of usage TTC pursues.

### 2.3 Trade dress — the overall "look and feel"

Tetris's trade dress — the **distinct brightly-colored blocks** and the **vertically-rectangular playfield** — is owned by Tetris Holding and licensed by TTC. In *Xio*, the court **also** found trade-dress infringement: Mino's marketing used "the same color and style of the pieces," creating a likelihood of confusion. Trade dress protects the combination of visual elements that identify the source, so replicating the **standard Guideline color-to-shape mapping** (I-cyan, O-yellow, T-purple, S-green, Z-red, J-blue, L-orange) plus the standard board proportions moves toward the protected zone even if the name is different.

### 2.4 Enforcement history — why this matters

TTC is unusually aggressive. Documented enforcement includes: cease-and-desist campaigns against freeware/shareware clones (late 1990s); Apple pulling "Tris" (2008); a DMCA notice to Google that removed **~35** Android clones at once (2010) — some of which reportedly contained **no reference to the word "Tetris" at all**; a claim that forced "Tetrada" off Windows Phone (2011); and the *Xio* litigation (2009–2012). The practical lesson: **TTC files DMCA/complaints first and asks questions later, and storefronts (Apple/Google/Valve) tend to comply on receipt.** For a Steam-targeted commercial build, a takedown is a business-continuity risk, not just a legal one.

---

## 3. Methodology

- Full read of branding/metadata surfaces: `package.json`, `README.md`, `game_description.md`, `CREDITS.md`, `steam_appid.txt`.
- Case-insensitive repository sweeps for: `tetris`, `tetromino`, `tetrimino`, `korobeiniki`, SRS / wall-kick, `t-spin`, `back-to-back` / `b2b`, `7-bag`, `ghost`, `hard drop`, `lock delay`, and the Guideline piece-color hex values.
- First-hand inspection of the authoritative game-logic modules: `src/core/constants.js`, `src/core/pieces.js`, `src/core/scoring.js`, `src/core/physics.js`, `src/core/game.js` (SRS tables), and representative theme `*-tetrominos.js` files.
- Verification of the three highest-risk items directly in source (SRS kick tables, the "Tetris" UI label, the `voltage-storm` palette).
- Web research on the *Xio* ruling, the TETRIS/Tetrimino trademark registrations, the Tetris Guideline color standard, and TTC's enforcement history (sources in §8).

---

## 4. Findings

Each finding lists **evidence** (file:line + quote), **analysis**, and a **risk rating**.

---

### Finding A — "Tetris" in publishable metadata and marketing copy — **HIGH (trademark)**

**Evidence**
- `package.json:4` — `"description": "A modern Tetris-inspired puzzle game built with Phaser 4"`
- `package.json:113-119` — keyword array includes `"tetris"`
- `README.md:3` — "Serenity Blocks is a **Tetris-inspired** game…"
- `game_description.md:5` — "Serenity Blocks is a modern, **Tetris-inspired** block puzzle game…" (reads as store/marketing copy)

**Analysis.** These are commercial, outward-facing uses of a registered mark to describe and position a competing product. The `package.json` keyword `"tetris"` is precisely the metadata/search-capture use TTC targets, and it ships in any published npm/build artifact. "Tetris-inspired" *might* be defensible as nominative use, but the safer and industry-standard practice is to describe the genre generically ("falling-block puzzle," "block-stacking puzzle") and never use the mark in metadata. This is the highest-probability trigger for a complaint and is trivial to fix.

**Risk: HIGH.** Likelihood of drawing enforcement: high if published as-is. Severity: takedown / C&D. Fix cost: trivial.

---

### Finding B — In-game UI text literally labeled "Tetris" — **HIGH (trademark)**

**Evidence**
- `src/core/game-modes/LocalMultiplayerMode.js:3776` — multiplayer results scoreboard renders a row labeled **`'Tetris'`** for 4-line-clear counts, alongside `'Single'`/`'Double'`/`'Triple'` (lines 3773-3775):
  ```js
  ${genRow(rowIcon.tetris, 'Tetris', (p) => p.clears[4] || 0)}
  ```

**Analysis.** This is a rendered, user-visible string using the mark inside the shipping product. "Tetris" as the informal name for a four-line clear is common community parlance, but on a **commercial** product it is trademark use and it reinforces a source-confusion narrative. Rename to a non-infringing term already used elsewhere in this codebase — the scoring layer calls it **"Quadra"** and the constants comment it as a **"Quad"** — e.g., `'Quad'` or `'Quadra'`.

Related internal (non-UI) uses of the token `'tetris'` as an effect-tier identifier exist and are lower risk but worth renaming for consistency: `src/themes/starlight/sim/starlight-reaction-director.js:43` (`TETRIS: 'tetris'`), `src/themes/winter/composition/storm-director.js:134` (`tier = 'tetris'`), `src/themes/lunara/lunara-reaction-particles.js` (palette `'tetris'`).

**Risk: HIGH** for the rendered label; **LOW** for the internal identifiers. Fix cost: trivial.

---

### Finding C — Themes replicating the Guideline piece palette + exact board — **MEDIUM–HIGH (trade dress)**

**Evidence**
- **Default mapping is *deliberately scrambled* (protective):** `src/core/constants.js:31-41`
  ```js
  I:'#00ff00' Green   O:'#ff9900' Orange  T:'#0000ff' Blue
  S:'#00ffff' Cyan    Z:'#ff0000' Red     J:'#ffff00' Yellow  L:'#cc00cc' Purple
  ```
  Only **Z (red)** coincides with the Guideline. This divergence is a genuine legal asset.
- **But two themes reproduce the exact Guideline color-to-shape mapping:**
  - `src/themes/voltage-storm/voltage-storm-tetrominos.js:10-18` — I `#00ffff` cyan, O `#ffff00` yellow, T `#b000ff` purple, S `#00ff00` green, Z `#ff0000` red, J `#0088ff` blue, L `#ff8800` orange. This **is** the Guideline standard (I-cyan, O-yellow, T-purple, S-green, Z-red, J-blue, L-orange).
  - `src/themes/neon-district/neon-district-tetrominos.js:9-15` — I cyan, O yellow, S green, J blue, L orange (T/Z re-hued to magenta/pink) — near-Guideline.
- **Board dimensions match the Guideline exactly:** `src/core/constants.js:11-13` — `COLS = 10; ROWS = 20; HIDDEN_ROWS = 4;`
- Most of the ~70 themes re-tint to atmospheric palettes but tend to **preserve the relative Guideline associations** (I→cyan-family, S→green, Z→red, J→blue, L→orange, O→yellow, T→purple).

**Analysis.** The *Xio* court identified both the **vivid coloring of the specific pieces** and the **playfield dimensions** as protected expression, and found the color/style copying central to its trade-dress holding. A theme that pairs the exact Guideline palette with the exact 10×20 field is the closest Serenity Blocks comes to the situation that sank Mino. Standing alone, 10×20 is near-universal and arguably functional (a weak individual factor), and the seven shapes are geometrically constrained — but the *combination* of exact palette + exact proportions + standard shapes is what trade-dress law aggregates. The scrambled default and the heavy per-theme reskinning are strong mitigations; the two exact-palette themes undercut them.

**Risk: MEDIUM–HIGH** for `voltage-storm`/`neon-district`; **LOW–MEDIUM** for the overall theme set given the deliberate default divergence. Fix cost: low (re-hue two themes; optionally vary board aspect/margins/styling so no single skin reads as "stock Tetris").

---

### Finding D — Documented intent to imitate specific commercial Tetris products — **MEDIUM (willfulness / trade dress)**

**Evidence**
- `docs/ODYSSEY_CINEMATIC_JOURNEY_PLAN.md:9` — "North star (unchanged): **Tetris Effect: Connected — Journey Mode**."
- `docs/gameplay-effects-plan.md` — repeated "**Tetris-Effect** signature/magic" (multiple lines); `docs/tetromino-visual-upgrade-plan.md:287` — "the **Tetris-Effect signature**."
- `docs/.../PHASE_4_5_COMPLETION_REPORT.md:450` — "inspired by **Tetris 99** and Jstris."
- `docs/gameplay-effects-plan.md:72` — round corners so a piece "reads as one glossy shape (**modern Tetris standard**)."
- `docs/quadra-cascade-bot-tactics-plan.md` — cites `tetris.wiki`, `harddrop.com`, `tetrisconcept.net`, "Tetris Worlds."
- `src/rendering/draw.js` and `src/rendering/phaser/board-juice.js` — numerous "Tetris Effect-inspired/-style" comments.

**Analysis.** These are internal documents, not shipped to users, so they carry **no direct trademark exposure**. Their risk is *evidentiary*: in any copyright/trade-dress dispute, a documented intent to reproduce the "signature" of a specific commercial product (Tetris Effect) helps a plaintiff argue **willful** copying and rebut an independent-creation defense. "Tetris Effect: Connected" is a Guideline-licensed commercial product whose distinctive audiovisual style is exactly the kind of *expression* that is protectable. Aiming to reproduce its "signature" is riskier than merely implementing generic falling-block mechanics.

**Risk: MEDIUM** (indirect). Recommendation: neutralize the framing (describe target aesthetics generically — "reactive particle bloom on large clears" rather than "the Tetris-Effect signature") and ensure the *executed* effects are your own expression, not recreations of Tetris Effect's specific sequences.

---

### Finding E — "Quadra"-derived scoring/speed/physics (GPL lineage) — **MEDIUM (copyright/license, non-Tetris)**

**Evidence**
- `src/core/scoring.js:1-5` — "Implements **Quadra-style** scoring system."
- `src/core/constants.js:120-165` — `QUADRA_SCORING`; `getQuadraDropInterval` with comments "Based on **Quadra's canvas.cc:calc_speed()** and player.cc:calc_by()," reproducing the level-speed formula and the 250/500/1000/2000 line-clear values.
- `src/core/physics.js` — extensive "**QUADRA METHOD**," "**QUADRA-ACCURATE IMPLEMENTATION**," "Quadra's exact hole position tracking," "mirrors Quadra's legacy logic."
- `src/core/cascade-resolver.js:17` — "identical by construction."
- `src/core/multiplayer/*` — "Quadra/TETR.IO style" garbage cancellation and netcode.
- `package.json:121` — `"license": "MIT"`.

**Analysis.** This is **not** a Tetris-Company issue — Quadra is a separate, third-party open-source game — but it is a genuine **copyright/licensing** risk and the user asked about copyright risk broadly. Quadra is distributed under the **GNU GPL (v2)**. If the Serenity Blocks scoring/speed/physics were **copied or closely translated** from Quadra's source (the comments — "based on canvas.cc," "identical by construction," "Quadra's exact") suggest more than coincidental similarity), then that code is a derivative of GPL software, and shipping it under an **MIT** license (and inside a proprietary Steam/Electron binary) would be a GPL violation. Note also that **mathematical formulas, numeric constants, and game rules are not themselves copyrightable** — if only the *formulas/values* were reused (not Quadra's actual code text), the copyright exposure drops substantially. The distinction (idea/data vs. copied code) is fact-specific and should be resolved with counsel and, if needed, a clean-room reimplementation.

**Risk: MEDIUM.** Fix cost: medium (confirm provenance; clean-room re-derive or comply with GPL). This is **out of scope of Tetris IP** but is the most concrete copyright exposure found and should not be ignored.

---

### Finding F — Guideline terminology surfaced on-screen — **LOW–MEDIUM (trade dress)**

**Evidence**
- `src/rendering/phaser/shared-effects.js:1363-1364` — user-facing banner: `['T-SPIN', 'T-SPIN\nSINGLE', 'T-SPIN\nDOUBLE', 'T-SPIN\nTRIPLE']`.
- `src/rendering/phaser/shared-effects.js:1412` — user-facing banner `'BACK-TO-BACK'`.
- T-spin/B2B are also Steam stats (`src/core/steam/steam-config.js:171`, `total_tspins`).

**Analysis.** "T-Spin" and "Back-to-Back" are Guideline vocabulary popularized by TTC's licensed games. They are gameplay-feature descriptors rather than famous trademarks, so displaying them is **lower** risk than displaying "Tetris." However, they contribute to the aggregate "this is Tetris" impression that matters for trade dress, and TTC's Guideline is licensed terminology. Many independent stackers ship these terms, but a cautious commercial product can rename them (e.g., "T-Twist," "Chain" / "Streak") to further distance the look and feel. Low priority relative to A–C.

**Risk: LOW–MEDIUM.** Fix cost: low.

---

### Finding G — Verbatim Guideline SRS tables and standard mechanics — **LOW (copyright: mechanics = ideas)**

**Evidence**
- `src/core/game.js:137-160` — `ROTATION_NAMES = ['0','R','2','L']`, `JLSTZ_KICKS`, and `I_KICKS` containing the **canonical Guideline SRS wall-kick offset tables** (verified against the standard SRS data; the project's own `tests/unit/srs-kick-tables.test.js` cross-references `tetris.wiki/Super_Rotation_System` as the golden source).
- `src/core/pieces.js:34-39` — 7-bag randomizer; `:124-132` — ghost piece; `src/core/constants.js:167-168` — `LOCK_DELAY_MS = 500`, `LOCK_RESET_LIMIT = 15` (Guideline "infinity" lock convention).

**Analysis.** These are **game rules and functional data**. Under *Xio* and settled copyright doctrine, rules, systems, methods of operation, and the numeric data that implement them are **not** protected by copyright — that is the idea/function side of the line. Copying the SRS kick tables makes the game *play* like Tetris but does not, by itself, infringe copyright. (SRS is not patented in any currently-enforceable way, and these tables are widely published.) The residual risk is only that identical mechanics reinforce the overall-similarity story for trade dress — mitigated by divergent *expression* (Findings A–C). No remediation required for legality; this is a **defensible** design choice.

**Risk: LOW.** No fix required; keep the expressive divergence strong.

---

### Finding H — Generic "tetromino" naming, the seven shapes, internal identifiers — **LOW**

**Evidence**
- ~70 `src/themes/*/*-tetrominos.js` files; `src/rendering/tetromino-style-manager.js`; `src/ui/intro-tetromino-*.js`; the `SHAPES` matrices in `src/core/constants.js:62-98`. **No** occurrence of the trademarked spelling "**Tetrimino/Tetriminos**" anywhere (confirmed).

**Analysis.** "**Tetromino**" is a generic geometry term (a four-cell polyomino, coined by mathematician Solomon Golomb) and is **public domain** — its use is fine and is *not* the TTC-coined "Tetrimino." The seven one-sided tetromino shapes are dictated by the underlying idea (four connected squares) and are effectively *scènes à faire* / functionally constrained; while *Xio* found the *depiction* of the pieces protectable, the *shapes themselves* are unavoidable for any tetromino game. Internal `'tetris'` code tokens (Finding B list) are not user-visible. All low risk; renaming is cosmetic hygiene, not a legal necessity.

**Risk: LOW.**

---

### Finding I — Missing LICENSE file and non-affiliation disclaimer — **LOW (hygiene)**

**Evidence**
- `package.json:121` declares `"license": "MIT"` but there is **no `LICENSE` file** on disk.
- No "not affiliated with The Tetris Company / Tetris Holding" disclaimer exists anywhere (`CREDITS.md` covers only 3D-model attribution; the only "trademark" mention in docs is unrelated art-direction guidance).
- `steam_appid.txt:1` = `480` — Valve's public **Spacewar** test App ID (placeholder), so no real store identity is baked in yet. Harmless.

**Analysis.** A prominent non-affiliation disclaimer does not cure infringement but reduces confusion (a trademark factor) and demonstrates good faith. The MIT/LICENSE mismatch is a packaging bug and interacts with Finding E (you cannot ship Quadra-derived GPL code under MIT). The Steam placeholder is fine but confirms commercial-storefront intent, which raises the stakes of A–C.

**Risk: LOW.** Fix cost: trivial.

> **Note on the branch name** `claude/serenity-blocks-tetris-legal-4985pp`: internal VCS metadata only, never shipped to users — no external exposure.

---

## 5. Risk assessment matrix

| Finding | Category | Likelihood of enforcement | Severity if enforced | Overall | Priority |
|---|---|---|---|---|---|
| A — "Tetris" in metadata/marketing | Trademark | High | Takedown / C&D | **HIGH** | P0 |
| B — In-game "Tetris" label | Trademark | Medium-High | Takedown / C&D | **HIGH** | P0 |
| C — Guideline palette themes + 10×20 | Trade dress | Medium | Injunction / redesign | **MED-HIGH** | P1 |
| E — Quadra GPL lineage | Copyright/license (non-Tetris) | Medium | License breach / rewrite | **MEDIUM** | P1 |
| D — Documented imitation intent | Copyright/trade dress (willfulness) | Low (indirect) | Amplifies other claims | **MEDIUM** | P2 |
| F — On-screen Guideline terms | Trade dress | Low-Med | Minor redesign | **LOW-MED** | P2 |
| I — No LICENSE / no disclaimer | Hygiene | Low | Good-faith / confusion | **LOW** | P2 |
| G — SRS tables / mechanics | Copyright (ideas) | Low | Defensible | **LOW** | — |
| H — "tetromino" / shapes / internal ids | TM/Copyright | Low | Defensible | **LOW** | P3 (cosmetic) |

**How Serenity Blocks compares to the losing party in *Xio*:** Mino used the Tetris name/style in marketing, copied the exact piece colors, and was audiovisually indistinguishable from Tetris. Serenity Blocks has a distinctive name, a scrambled default palette, original music, original effects, and heavy reskinning — **most of the Mino risk factors are already mitigated.** The remaining gaps (name in metadata/UI, two exact-palette themes, documented imitation) are the items that would let a plaintiff argue the product still trades on Tetris. They are the focus of remediation.

---

## 6. Recommended remediation plan

### P0 — Before any public build or store submission (hours of work)

1. **Purge "Tetris" from all publishable surfaces.**
   - `package.json:4` description → e.g. *"A modern falling-block puzzle game built with Phaser 4."*
   - `package.json` keywords → remove `"tetris"`; use `"puzzle"`, `"falling-blocks"`, `"block-puzzle"`.
   - `README.md:3`, `game_description.md:5` → replace "Tetris-inspired" with "falling-block puzzle" / "block-stacking puzzle."
2. **Rename the in-game "Tetris" label** (`LocalMultiplayerMode.js:3776`) to `'Quad'` (or `'Quadra'`, already used by the scoring layer). Rename the internal `'tetris'` effect-tier tokens for consistency (Finding B list).
3. **Add a non-affiliation disclaimer** to the README, an in-app About/credits screen, and any future store page: *"Serenity Blocks is an independent game and is not affiliated with, endorsed by, or sponsored by The Tetris Company, LLC or Tetris Holding, LLC. TETRIS® is a registered trademark of Tetris Holding, LLC."*
4. **Add the missing `LICENSE` file** — but only after resolving Finding E (do not ship Quadra-derived GPL code under MIT).

### P1 — Before commercial release (days of work)

5. **Reskin the two Guideline-palette themes** (`voltage-storm`, `neon-district`) so no shipped skin reproduces the standard I-cyan / O-yellow / T-purple / S-green / Z-red / J-blue / L-orange mapping. Keep the scrambled default as the canonical identity.
6. **Differentiate the playfield presentation** — vary aspect framing, borders, cell styling, and background so no theme reads as "stock Guideline Tetris." (You may keep 10×20 logic; change its *appearance*.)
7. **Resolve the Quadra/GPL question (Finding E).** Determine whether actual Quadra *code* was copied vs. only formulas/constants. If code: clean-room reimplement the scoring/speed/physics from a specification, or bring the project into GPL compliance. Remove "identical by construction"/"Quadra's exact" comments once the code is independently authored, and document provenance.

### P2 — Polish / defensive depth

8. **Neutralize documented imitation intent** (Finding D): reframe design-doc language away from "the Tetris-Effect signature/magic" toward generic descriptions of the effects you actually built; confirm executed effects are original expression.
9. **Optionally rename on-screen Guideline terms** ("T-SPIN" → "T-Twist"/"Spin"; "BACK-TO-BACK" → "Streak"/"Chain") to further distance trade dress.
10. **Audit music/SFX asset provenance at build time.** The manifest names are original and no Korobeiniki was found, but the actual `assets/music/*.mp3` binaries were not in the tree reviewed — verify every shipped audio file is original or properly licensed, and record it in `CREDITS.md`.

### P3 — Cosmetic

11. Optionally rename `*-tetrominos.js` / `tetromino` identifiers to a neutral term ("blocks," "pieces"). Legally optional ("tetromino" is public-domain); do it only for brand consistency.

### Cross-cutting

12. **Engage IP counsel** before commercial launch, given TTC's enforcement posture and the Steam target. Have counsel confirm the trademark cleanup, the trade-dress divergence, and the Quadra license resolution.

---

## 7. What is already safe / defensible (keep it this way)

- **Distinctive product name** "Serenity Blocks" — no similarity to "Tetris."
- **Scrambled default piece palette** — only Z(red) coincides with the Guideline; this is a deliberate, valuable divergence.
- **No Tetris music** — no Korobeiniki / "Type A" / Russian-folk theme anywhere; ~35 original, theme-named tracks.
- **No official Tetris art or audio assets** — piece rendering is generated in code; 3D assets are third-party non-Tetris and attributed in `CREDITS.md`.
- **Generic "tetromino" terminology** (not the trademarked "Tetrimino").
- **Original, heavily-reskinned per-theme visual effects** — the core of a trade-dress defense.
- **Mechanics (SRS, 7-bag, ghost, lock delay, T-spin, B2B)** — legal to implement; not copyrightable.

Maintaining strong expressive divergence is the single most important ongoing defense. The remediation above tightens the few places where the product still points back at "Tetris" by name, palette, or documented intent.

---

## 8. Sources

Legal research underpinning §2 and §4:

- [Tetris Holding, LLC v. Xio Interactive, Inc. — Wikipedia](https://en.wikipedia.org/wiki/Tetris_Holding,_LLC_v._Xio_Interactive,_Inc.)
- [Tetris Holding v. Xio Interactive — The IT Law Wiki](https://itlaw.fandom.com/wiki/Tetris_Holding_v._Xio_Interactive)
- [Tetris Defeats the Clones in Copyright Infringement Battle — Cole Schotz](https://www.coleschotz.com/tetris-defeats-the-clones-in-copyright-infringement-battle/)
- [Tetris Holding, LLC v. Xio Interactive, Inc. — Loeb & Loeb LLP](https://www.loeb.com/en/insights/publications/2012/06/tetris-holding-llc-v-xio-interactive-inc)
- [Tetris ruling stacks up arguments against videogame clones — Lexology](https://www.lexology.com/library/detail.aspx?g=8442b899-6e7e-423a-9076-43396012b4bf)
- [Looks like Tetris? Video game clones and copyright law — Lexology](https://www.lexology.com/library/detail.aspx?g=0be0efb0-f968-4e76-b85b-e6c83280e46a)
- [Tetris Copyright Decision Shows How Complicated Copyright for Games Can Be — Public Knowledge](https://publicknowledge.org/tetris-copyright-decision-shows-how-complicated-copyright-for-games-can-be/)
- [How Courts View Copyright Protection For Video Games — Frankfurt Kurnit Klein & Selz](https://fkks.com/news/how-courts-view-copyright-protection-for-video-games)
- [The Tetris Company — Wikipedia (enforcement history)](https://en.wikipedia.org/wiki/The_Tetris_Company)
- [Tetris Clones Pulled From Android Market — Slashdot](https://games.slashdot.org/story/10/05/28/079200/tetris-clones-pulled-from-android-market)
- [TETRIS trademark record (USPTO Reg. 4,592,985) — Trademarkia](https://www.trademarkia.com/tetris-86205967)
- [TETRIS trademark record — uspto.report](https://uspto.report/TM/90746082)
- [Tetris Guideline (standard tetromino colors) — TetrisWiki](https://tetris.wiki/Tetris_Guideline)
- [Tetromino (colors & shapes) — Hard Drop Tetris Wiki](https://harddrop.com/wiki/Tetromino)
- [Legality of Cloning Games: Dire Decks, Wildcard, and Tetris — Argo Law](https://argolawyer.com/legality-of-cloning-games/)

---

*End of review. This assessment reflects the repository state on branch `claude/serenity-blocks-tetris-legal-4985pp` as of 2026-07-15 and should be re-run if the piece palettes, playfield presentation, branding, or audio assets change materially before release.*
