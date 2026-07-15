# Serenity Blocks — Intellectual-Property Legal-Risk Review (v2)

**Prepared:** 2026-07-15
**Version:** 2.1 (v2.0 expanded scope from Tetris-only to Tetris **+ Quadra**; v2.1 adds a completeness-review pass — corrected/sourced the *Korobeiniki* sound-mark and *Ackerman* citations, softened the audio conclusion to the evidence actually held, and added jurisdiction/patent/AI-authorship scope, monetary-damages exposure, LGPL-compliance mechanics, and netcode-originality evidence)
**Scope:** Trademark, copyright, and trade-dress exposure of the *Serenity Blocks* codebase relative to **two distinct third-party IP estates**:
  1. **Tetris® IP** held by Tetris Holding, LLC and enforced through The Tetris Company, LLC ("TTC") — trademark, copyright (audiovisual expression), and trade dress.
  2. **Quadra IP** — the open-source game *Quadra* (© 1998–2000 **Ludus Design**), licensed under the **GNU LGPL v2.1-or-later**, whose scoring/speed/garbage/physics logic Serenity Blocks self-describes as having "ported." This is an **open-source copyleft / license-compatibility** question, entirely separate from Tetris.

**Repository reviewed:** `olovmelander/serenity-blocks` (branch `claude/serenity-blocks-tetris-legal-4985pp`), full working tree including `src/`, `docs/`, assets, and package metadata.

> ⚠️ **Not legal advice.** This document is an engineering-led risk assessment intended to help prioritize remediation before a commercial release. It is **not** a legal opinion and does not create an attorney–client relationship. Tetris IP is among the most aggressively enforced in the games industry, and the Quadra copyleft question turns on fact-specific provenance. Before shipping commercially (especially on Steam, which the build config targets), have a qualified IP/open-source attorney review the product. Several findings below are judgment calls only counsel can resolve, and this memo flags its own uncertainty where the facts are ambiguous.

---

## 1. Executive summary

Serenity Blocks is, functionally, a near-complete implementation of modern "Guideline" Tetris (10×20 field, seven standard tetrominoes, Super Rotation System with canonical wall-kick tables, 7-bag randomizer, ghost piece, hard drop, lock delay, T-spin and Back-to-Back detection), whose *multiplayer/scoring/physics layer* is in turn modeled on the open-source game **Quadra**.

The central legal reality is that **most of what Serenity Blocks reproduces is legally free to reproduce.** Game rules, mechanics, systems, mathematical formulas, numeric constants, wall-kick tables, and randomizer algorithms are **not** protected by copyright (17 U.S.C. § 102(b); *Tetris Holding v. Xio*; *Baker v. Selden*; *Feist*). This memo's deep, adversarially-verified review **dismissed the large majority of initially-flagged "copied code" items** — including the SRS tables, the 7-bag, lock-delay constants, T-spin detection, and every one of the "Quadra port" formulas — as non-infringing reproduction of ideas and functional data. See §7 ("Considered and dismissed").

The **real, surviving exposure is narrow and concentrated:**

- **Trademark use of "Tetris"** in *published, user-facing* surfaces (store copy, package metadata/keyword, in-game scoreboard, Odyssey objective text). This is the highest-confidence, cheapest-to-fix risk.
- **A small number of themes that reproduce the Guideline color-to-shape palette**, which is the one visual element the *Xio* court actually held protectable as trade dress/expression.
- **Asset-provenance hygiene** (music provenance; CC-BY attribution consolidation) — **both now addressed** this session (see Findings G, H); copyright-compliance items unrelated to Tetris.
- **A residual factual/documentation question on Quadra**: the substantive copyleft exposure is **LOW** (only formulas/mechanics appear to be reused, which LGPL cannot restrict), but the code's self-labeling as an "exact port" citing Quadra source-line ranges is evidentiarily awkward and should be cleaned up and provenance-audited.

**Mitigations already in place (genuine legal assets):** a distinctive product name ("Serenity Blocks"); a *deliberately scrambled* default piece palette; no Korobeiniki / "Type A" / Russian-folk music **by name** (the audio binaries were not decoded — a one-time listen-through is the single open verification item, per §3 and Finding G); fully procedural sound effects; OFL/system fonts only; no ripped Tetris sprites, block skins, or textures. Serenity Blocks is in a **materially stronger position than the infringing "Mino" game** that lost *Xio*.

### Overall risk posture: **MODERATE**, driven almost entirely by trademark hygiene and a handful of themes — not by mechanics or by Quadra code.

| # | Finding | Estate | Type | Verified risk | Fix cost |
|---|---------|--------|------|---------------|----------|
| A | "Tetris" in publishable metadata/marketing: `package.json` **keyword** + `game_description.md` **store copy** | Tetris | Trademark | **HIGH** | Trivial |
| B | In-game UI string literally labeled **"Tetris"** (multiplayer scoreboard) | Tetris | Trademark | **HIGH** | Trivial |
| C | `package.json` description + `README.md` say "**Tetris-inspired**" | Tetris | Trademark | **MEDIUM** | Trivial |
| D | Odyssey/level user-facing text renders "**Tetrises**" as an objective | Tetris | Trademark | **MEDIUM** | Low |
| E | Themes reproducing the Guideline color-to-shape palette (`voltage-storm`, `neon-dusk`, `neon-district`, + `aether-tides`, `nebula-flow`, `starlight`) | Tetris | Trade dress | **MEDIUM** | Low |
| F | **Quadra (LGPL-2.1) lineage** — scoring/speed/garbage/physics self-described as an "exact port"; provenance & documentation | Quadra | Copyleft / license | **LOW** (residual provenance question) | Medium |
| G | Music provenance — confirmed **original**, now recorded in `CREDITS.md` | Third-party | Copyright hygiene | **RESOLVED** | Done |
| H | CC-BY attribution — consolidated into `CREDITS.md` | Third-party | Copyright compliance | **RESOLVED** | Done |
| I | On-screen Guideline terms ("T-SPIN," "BACK-TO-BACK") | Tetris | Trade dress (weak) | **LOW** | Low |
| J | No `LICENSE` file (MIT declared); no non-affiliation disclaimer | Hygiene | — | **LOW** | Trivial |
| — | SRS tables, 7-bag, lock delay, T-spin, board dims, "tetromino," Quadra **formulas** | Both | Copyright (ideas/formulas) | **DISMISSED** — see §7 | N/A |

**Top actions before any public/commercial release:** (1) strip "Tetris" from all published metadata, store copy, and in-game UI (A–D); (2) re-hue the ~6 themes that adopt the Guideline palette and vary board presentation (E); (3) document music provenance and consolidate CC-BY attribution into `CREDITS.md` (G, H); (4) add a non-affiliation disclaimer and a real `LICENSE` file (J); (5) run a one-time Quadra provenance audit and scrub the "exact port / from canvas.cc:NNN" comments (F).

> **Remediation status (applied on this branch, 2026-07-15).** **Already done:** "Tetris" removed from `package.json`, `README.md`, and `game_description.md` (A, C); the in-game scoreboard label and Odyssey objective/tip text changed from "Tetris"/"Tetrises" to "Quad"/"Quads" (B, D); the Quadra provenance-admission **comments** (named `canvas.cc`/`player.cc` source lines, "exact port", "QUADRA-ACCURATE", `net_version`) scrubbed to neutral behavioral descriptions across `garbage.js` / `physics.js` / `constants.js` / `scoring.js` / `cascade-resolver.js` / `game.js` (F, the documentation-hygiene half); non-affiliation disclaimer added to `README.md` and `CREDITS.md` (J, partial); CC-BY attribution consolidated into `CREDITS.md` (H); music provenance recorded as **original, project-owned** (G). **Still open:** re-hue the ~6 Guideline-palette themes (E); the *substantive* Quadra provenance sign-off + a real `LICENSE` file (F, J); optional on-screen term renames (I) and internal-identifier renames. None of the applied edits change gameplay, logic, or visuals — they touch metadata, docs, comments, and display strings only.

---

## 2. Legal framework

Four distinct doctrines are in play across two IP estates. They protect different things and demand different remediation.

### 2.1 Copyright — mechanics/formulas are free; *audiovisual expression* is not

The idea/expression dichotomy is codified at **17 U.S.C. § 102(b)**: copyright protection "in no case" extends to "any idea, procedure, process, system, method of operation, concept, principle, or discovery." Courts apply the **abstraction-filtration-comparison** test (*Computer Associates Int'l v. Altai*, 982 F.2d 693 (2d Cir. 1992)), filtering out ideas, functionally-dictated expression (**merger**), stock/genre-standard elements (**scènes à faire**), and public-domain material before comparing what remains.

**The controlling video-game authority is *Tetris Holding, LLC v. Xio Interactive, Inc.*, 863 F. Supp. 2d 394 (D.N.J. 2012) (Wolfson, J.).** Xio's "Mino" conceded copying Tetris but argued it took only unprotectable rules. The court granted Tetris summary judgment on **both** copyright and trade dress, drawing a precise line:

| **Unprotectable (idea / rules / function) — free to copy** | **Protectable (specific audiovisual expression) — Mino infringed** |
|---|---|
| Geometric pieces falling from the top | The seven distinct tetromino piece **designs** (four equal square blocks) |
| Rotating/moving pieces to form & clear full horizontal lines | The **bright, distinct colors** assigned to the pieces |
| Line-based scoring; speed increase; game-over on stack-to-top | **Individually delineated bricks** with interior borders/shading |
| The abstract rules and functionality generally | The specific **10-wide × 20-tall** field appearance |
| A "next piece" preview *as a concept* | The display of the next-piece preview, garbage lines, and **ghost/shadow** piece |
| — | Pieces **changing color on lock-down**; the board **auto-filling on game over** |

Critically, the court **foreclosed the two doctrines cloners rely on**: **merger** failed because a falling-block game can be expressed in "almost limitless" visual ways (different colors, shapes, dimensions, styling were all available); **scènes à faire** failed because Tetris was a "wholly fanciful," genre-defining creation with no pre-existing conventions compelling its look — its choices were "arbitrary flourishes," not conventions.

**Supporting precedents (the mechanics-are-free line runs consistently):**
- *Atari, Inc. v. Amusement World, Inc.*, 547 F. Supp. 222 (D. Md. 1981) — 22 similarities between *Asteroids* and *Meteors* were inherent to the unprotectable idea; no infringement.
- *Midway Mfg. Co. v. Artic Int'l, Inc.*, 704 F.2d 1009 (7th Cir. 1983) — video games are copyrightable as audiovisual works, but the holding concerns the *audiovisual work*, not the rules.
- *Data East USA, Inc. v. Epyx, Inc.*, 862 F.2d 204 (9th Cir. 1988) — karate-game similarities (moves, scoring, referee, two-fighter layout) were scènes à faire; not protectable.
- *Capcom U.S.A. v. Data East Corp.*, 1994 WL 1751482 (N.D. Cal. 1994) — even deliberate imitation of *Street Fighter II* was non-infringing where copied elements were stock fighting-game features.
- *Incredible Techs. v. Virtual Techs. (Global VR)*, 400 F.3d 1007 (7th Cir. 2005) — *Golden Tee*'s golf imagery was standard to the sport; control-panel dress was functional.
- *Spry Fox, LLC v. LOLApps, Inc.*, 2012 WL 5290158 (W.D. Wash. 2012) — contemporaneous with *Xio*; a game's expressive selection/arrangement can be infringed even without copied code (motion to dismiss denied; later settled).
- *DaVinci Editrice S.r.l. v. ZiKo Games, LLC*, 183 F. Supp. 3d 820 (S.D. Tex. 2016) — post-*Xio*, the rule "structure" of a card game is a function of the rules, not protectable expression.

**Non-copyrightability of formulas, data, and mechanics (the doctrine that dismisses most Quadra/Guideline findings):** *Baker v. Selden*, 101 U.S. 99 (1879) (copyright in a description of a system confers no monopoly over the system or its "necessary incident" forms — that is the domain of patent); *Feist Publ'ns v. Rural Tel.*, 499 U.S. 340 (1991) (facts and functionally-dictated data lack originality; "sweat of the brow" earns nothing); *Lotus Dev. Corp. v. Borland Int'l* (methods of operation not copyrightable); *Google LLC v. Oracle Am., Inc.*, 141 S. Ct. 1183 (2021) (functional interfaces/APIs re-implementable for interoperability). The U.S. Copyright Office is administratively aligned: it will not register a game's rules, methods of play, or "any idea, system, method, [or] device" (Circulars 31 & 33).

**Takeaway:** Serenity Blocks may implement every Tetris and Quadra *rule, formula, and numeric constant* it likes. Copyright liability attaches only if (a) the **audiovisual presentation** converges on Tetris's protected look, or (b) **literal code text** was copied/translated from a copyrighted source. The defense is **expressive divergence** and **independent authorship** — both of which Serenity Blocks largely already has.

### 2.2 Trademark — the word "TETRIS" and related marks

`TETRIS` is a live, multi-class registered trademark of Tetris Holding, LLC — core software/entertainment registration **U.S. Reg. No. 4,592,985** (Serial 86205967, Classes 9 & 41), plus a family spanning Classes 9, 28, and 41 (e.g., Reg. Nos. 3,396,574 and 5,617,892). TTC also treats the coined term **"Tetrimino"** (note the *-i-* spelling, deliberately distinct from the public-domain math term **"tetromino"**) as proprietary, and holds a registered **sound mark** — **U.S. Reg. No. 3,517,007** (Serial 77037539) — covering the *Korobeiniki*-based "Type A" tune rendered as an electronic sine-wave arrangement. Note the boundary: the underlying 19th-century *Korobeiniki* folk melody is itself **public domain**; what is registered is TTC's specific arrangement functioning as a source identifier in the video-game market (so an *original* composition that merely evokes "folk puzzle music" is fine; a recognizable rendition of TTC's Type-A arrangement is not).

Liability turns on **likelihood of consumer confusion** and is triggered by *use of the mark*, independent of copyright. Risk escalates sharply with **where** the mark appears: highest in a product **title/app name** or on-screen UI (source-identifying use); meaningful in **store descriptions and package metadata/keywords**. **Nominative/descriptive fair use** is a narrow shelter — it permits accurate, minimal reference to the genuine product without the Tetris logo/font and without implying sponsorship, but it does **not** license putting "Tetris" (or even "Tetris-inspired") in a title, store name, or UI as a source identifier.

### 2.3 Trade dress — the overall "look and feel"

Tetris's trade dress — **distinct, brightly-colored blocks** plus a **vertically-rectangular playfield** — is standardized through the licensed **Tetris Guideline**, which fixes the color-to-shape mapping: **I = cyan, O = yellow, T = purple, S = green, Z = red, J = blue, L = orange**. In *Xio* the court found this presentation non-functional, distinctive, and likely to confuse, and rejected functionality/merger defenses. Reproducing the exact Guideline palette alongside the standard board proportions moves toward the protected zone even when the product name differs.

### 2.4 Open-source copyleft — Quadra is **LGPL-2.1-or-later** (a correction to v1)

Quadra is **not** GPL, as v1 assumed. Every source file in the canonical repository (`github.com/quadra-game/quadra`, e.g. `source/canvas.cc`, `source/player.cc`) carries: *"Copyright (C) 1998-2000 Ludus Design … under the terms of the GNU **Lesser** General Public License … version 2.1 of the License, or (at your option) any later version"* (**SPDX: LGPL-2.1-or-later**). The copyright holder of record is the corporate entity **Ludus Design** (the v1/premise attribution to "Jani Nurminen" is **not** corroborated by the source headers).

For the specific question here the GPL-vs-LGPL distinction is largely immaterial: **LGPL's only real relaxation is for *linking* against the library**; it offers no relief when you **copy or translate the source text**. Under 17 U.S.C. §§ 101 & 106(2), a "translation" (including transliterating C++ into JavaScript, or carrying over expressive structure, comments, and idiosyncratic naming) is a **derivative work** that must stay LGPL-2.1-or-later, ship corresponding source, and preserve the Ludus Design notices. **MIT is a one-way incompatibility**: permissive code can flow *into* copyleft, but LGPL-derived code cannot be re-licensed under MIT. **However**, § 102(b), *Baker*, *Feist*, and the merger doctrine mean Quadra's **formulas, numeric constants, and game rules are outside copyright entirely** — re-deriving identical numeric behavior in independently-written code is **not** a derivative work and triggers **no** LGPL obligation. The bright line is **expression (copied code) vs. function (re-derived math/rules)**. See §5 (Quadra section) for the fact-specific application.

### 2.5 Enforcement history — why the hygiene items matter

TTC is unusually aggressive and enforces overwhelmingly by **platform DMCA/takedown** (Steam, App Store, Google Play, itch.io, GitHub), which pulls a title during any dispute and drains indie revenue, reserving litigation for contested/high-value targets. Documented actions: 1990s C&D campaigns against freeware clones (some with no "Tetris" name); Apple pulling "Tris" (2008); a 2010 DMCA that removed **~35 Android titles at once** — several with **no "Tetris" reference at all**; "Tetrada" pulled from Windows Phone (2011); a GitHub repo takedown (2021); "Playtris" (itch.io, 2022, copyright-based); and **"Setris" → "Sandtrix" (2023)**, whose notice cited copyright registrations, the *Korobeiniki* **sound mark**, and the TETRIS word marks ("nearly identical except for one letter"). Setris got back online **the same day** after dropping the near-identical name and the folk-song music. The March 2025 S.D.N.Y. dismissal — *Ackerman v. Pink*, No. 1:23-cv-06952 (S.D.N.Y. Mar. 6, 2025) (Failla, J.), author Dan Ackerman's copyright suit against Apple **and TTC** over the Apple TV+ *Tetris* film — is **not** an enforcement retreat: TTC was a co-*defendant*, not the enforcer, and dismissal turned on the non-fiction fact/expression line (book vs. film), unrelated to clone enforcement. **For a Steam-targeted commercial build, a platform takedown is a business-continuity risk, not merely a legal one — and should a dispute escalate to litigation, monetary exposure follows: copyright statutory damages up to $150,000 per work *willfully* infringed plus possible attorney's-fee shifting (17 U.S.C. §§ 504–505), and trademark remedies reaching the infringer's profits. That is precisely why the willfulness-flavored items (documented imitation of a named product, the self-labeled "exact port") are worth neutralizing even though each is individually defensible.**

### 2.6 Scope notes — jurisdiction, patents, and AI-authorship

**Jurisdiction (US-law floor, not ceiling).** This memo analyzes **U.S. law** (federal copyright; Lanham Act trademark/trade dress). Because the build targets **Steam — a global storefront** — exposure is not US-only. TTC enforces the TETRIS marks in the EU, UK, Japan and elsewhere, and several non-US regimes supply theories a US court would not: the EU **unregistered Community design** right can protect the piece/board *appearance* for three years from disclosure; UK/Commonwealth **passing off** and broad **unfair-competition** doctrines can reach look-and-feel without a registered mark. The remediation here (genericize name/palette, add a disclaimer, document provenance) lowers exposure under all of them, but a territory-specific launch should get local counsel review. Treat the US analysis as the floor.

**Patents — noted and dismissed.** No live patent exposure was identified. The original Tetris (1984) and Quadra (1998–2000) long predate any enforceable patent term for their mechanics, game *rules/mechanics* are rarely patentable in the first place, and no in-force Tetris/Quadra utility or design patent relevant to this codebase was found. The category is disposed of.

**AI-authored code & chain-of-title.** The working branch (`claude/…`) reflects AI-assisted authorship, which raises two points orthogonal to Tetris/Quadra but bearing on Findings J and G. (1) **Ownership behind the MIT grant:** under current U.S. Copyright Office guidance, output lacking sufficient *human* authorship may be **uncopyrightable** — you cannot license under MIT what no one owns — so a human-authorship/editorial record supports the declared license and any future enforcement of it. (2) **Third-party reproduction risk:** generative tools can occasionally emit third-party-protected code or assets; the Quadra provenance audit (F) and the music listen-through (G) already target the highest-risk surfaces, and a general human review of AI-generated assets is prudent. Neither point is a Tetris matter; both feed the `LICENSE`/chain-of-title cleanup in Finding J.

---

## 3. Methodology

This v2 is the product of a **multi-agent deep review**: seven specialist audit passes over distinct surfaces, each producing file:line evidence, followed by an **adversarial verification pass** in which every material finding was re-checked against the source and against controlling doctrine, with a verdict of **CONFIRMED / REFUTED / UNCERTAIN** and, where warranted, a **corrected risk**. This memo reports only what survived verification at HIGH/MEDIUM; refuted items are disclosed transparently in §7 rather than silently dropped.

**Audit surfaces covered:**
1. **Core game logic** (`src/core`) — Guideline mechanics & expression replication (SRS, 7-bag, T-spin, lock delay, board dims, shapes, default colors).
2. **Quadra lineage & LGPL-vs-MIT provenance** (`src/` runtime + `docs/`) — every "Quadra"/`canvas.cc`/`player.cc`/`net_version`/"exact port" reference.
3. **Piece-color trade-dress audit** — all **59** `src/themes/*/*-tetrominos.js` files graded against the Guideline mapping (EXACT / NEAR / DIVERGENT).
4. **User-facing strings & branding** — `package.json`, `README.md`, `game_description.md`, UI, HUD, scoreboards, Odyssey objectives.
5. **Documented imitation intent** — `docs/` design plans referencing named commercial products (Tetris Effect, Tetris 99, Jstris, TETR.IO).
6. **Audio & asset provenance** — music manifest + binaries, SFX synthesis, fonts, textures, 3D models, `CREDITS.md`, all `ATTRIBUTION.md` files.
7. **Multiplayer/netcode derivation** — `src/core/multiplayer/`, `network/`, `steam/`.

**Verification of the three v1 headline items directly in source:** SRS kick tables (confirmed byte-exact to the Guideline SRS, but legally = uncopyrightable data), the "Tetris" scoreboard label (confirmed, trademark), and the theme palettes (confirmed via the full 59-theme sweep).

**Limitation (disclosed):** the audio audit was static/textual — the ~36 `.mp3` binaries were **not decoded/listened to**, so name-level evidence is strongly original but a one-time human listen-through remains the only way to fully exclude an unbranded track containing a *Korobeiniki* arrangement.

---

## 4. Tetris findings

Each finding lists **evidence** (file:line + quote), **analysis**, and a **verified risk rating**. Ratings reflect adversarial verification; items whose theory was refuted appear in §7.

### Finding A — "Tetris" in publishable metadata and store copy — **HIGH (trademark)**

**Evidence**
- `package.json:114` — `keywords` array contains `"tetris"` (ships in the published/distributed artifact; indexable SEO/discovery use).
- `game_description.md:5` — store/marketing copy: *"Serenity Blocks is a modern, **Tetris-inspired** block puzzle game…"* (paired with `steam_appid.txt`).

**Analysis.** These are the two highest-confidence trademark items: a **keyword** deliberately capturing searchers of a famous mark, and **storefront pitch copy** for a directly competing block-puzzle product. The keyword is exactly the metadata capture TTC targets; the store copy is the most enforcement-prone surface of all. Neither is shielded by the mechanics/idea doctrine (that is copyright, not trademark) and both are trivially removable. Verification rated the keyword **HIGH** (intentional use of a famous mark to divert its audience in a distributed product) and the store copy **HIGH**.

**Risk: HIGH.** Fix cost: trivial.

### Finding B — In-game UI text literally labeled "Tetris" — **HIGH (trademark)**

**Evidence**
- `src/core/game-modes/LocalMultiplayerMode.js:3776` — end-of-match scoreboard renders a row labeled **`'Tetris'`** for 4-line-clear counts, adjacent to `'Single'`/`'Double'`/`'Triple'`:
  ```js
  ${genRow(rowIcon.tetris, 'Tetris', (p) => p.clears[4] || 0)}
  ```

**Analysis.** A rendered, user-visible string using the registered mark **inside the shipping product**, in the very market (tetromino games) where the mark is protected and confusion is most likely. Community parlance for a four-line clear does not immunize commercial UI use. Rename to a **fully self-coined, generic** label — e.g. **"Quad," "Quad Clear," or "Four-Line."** (The codebase's existing internal term is *"Quadra,"* but note the tension: *Quadra* is itself a third-party game name (§5); keep it out of *user-facing* UI and use a neutral term instead — internal identifiers are fine.) Verification: **CONFIRMED, HIGH.**

**Risk: HIGH.** Fix cost: trivial.

### Finding C — "Tetris-inspired" in package description and README — **MEDIUM (trademark)**

**Evidence**
- `package.json:4` — `"description": "A modern Tetris-inspired puzzle game built with Phaser 4"`
- `README.md:3` — "Serenity Blocks is a **Tetris-inspired** game with a Phaser-first gameplay renderer…"

**Analysis.** Both use the mark in published text for a competing game. "Tetris-inspired" reads as descriptive/nominative reference rather than branding the product *as* Tetris, and a `package.json` field / developer README are lower-visibility, lower-confusion surfaces than a storefront or in-game title. Verification **CONFIRMED both but corrected the risk from HIGH to MEDIUM** on exactly that basis. Still a real, addressable exposure: reword to a generic descriptor ("falling-block puzzle").

**Risk: MEDIUM.** Fix cost: trivial.

### Finding D — User-facing "Tetrises" in Odyssey/level objective text — **MEDIUM (trademark)**

**Evidence**
- `src/ui/odyssey/OdysseyHUD.js:289` — `parts.push(\`${value}+ tetrises\`);` — rendered to the player as an objective label (e.g. "4+ tetrises"); the return value is assigned to `reqText.textContent`.
- `src/core/odyssey/data/levels.js:446` — user-facing objective `description: 'Clear 3 Tetrises'`; `:2917` — tip text "use **Tetrises** (4-line clears)…". ~40 `'tetris'`/`'tetrises'` occurrences in this file (many internal, some user-facing).

**Analysis.** "Tetrises" is a plural derivative of the registered mark used in published, player-visible objective/tip copy of a commercial product. Verification **CONFIRMED, MEDIUM** — a real but minor, incidental use that is easily remediated by substituting a neutral term ("quad"/"four-line clear"). Internal identifiers (`type: 'tetris-count'`, `isTetris` flags, metric keys) are **not** user-facing and carry little standalone risk; rename for consistency only.

**Risk: MEDIUM** (user-facing strings); **LOW** (internal identifiers). Fix cost: low.

### Finding E — Themes reproducing the Guideline color-to-shape palette — **MEDIUM (trade dress)**

This is the finding most directly analogous to what sank Mino, because piece coloring is the **one visual element the *Xio* court actually held protectable**. The full 59-theme audit is in **§6**; the surviving MEDIUM-risk themes are:

**Evidence (verified)**
- **`src/themes/voltage-storm/voltage-storm-tetrominos.js:11-17`** — I `#00ffff` cyan, O `#ffff00` yellow, T `#b000ff` purple, S `#00ff00` green, Z `#ff0000` red, J `#0088ff` blue, L `#ff8800` orange. This **is** the exact Guideline mapping, all seven pieces. *(Verified: CONFIRMED, MEDIUM.)*
- **`src/themes/neon-dusk/neon-dusk-tetrominos.js:14-20`** and **`src/themes/neon-district/neon-district-tetrominos.js:9-15`** — neon variants landing in every Guideline hue family (T/Z shifted to magenta/pink but in-family). *(neon-dusk CONFIRMED MEDIUM; neon-district characterized as "EXACT" but is more precisely a hue-order match — UNCERTAIN, MEDIUM.)*
- **`src/themes/aether-tides/aether-tides-tetrominos.js:2-8`** (6/7 full-saturation primaries) and **`src/themes/nebula-flow/nebula-flow-tetrominos.js:12-18`** (6/7) — CONFIRMED MEDIUM.
- **`src/themes/starlight/starlight-tetrominos.js:11-17`** — pastel but tracks the full Guideline shape→hue order — CONFIRMED MEDIUM.
- **Board dimensions match the Guideline** exactly: `src/core/constants.js:11-13` — `COLS = 10; ROWS = 20; HIDDEN_ROWS = 4;` (largely functional; a weak *individual* factor).

**Why these six (selection criterion).** The three **EXACT** themes (`voltage-storm`, `neon-district`, `neon-dusk`) are included because they reproduce the Guideline shape→hue mapping across all/nearly-all seven pieces. The three **NEAR** themes elevated here — `aether-tides`, `nebula-flow`, `starlight` — are the *closest* of the 26 NEAR cases: each preserves 6–7 Guideline hue *families at high saturation* (near-primary cyan/yellow/green/red/blue/orange), which is what pushes them toward the protected palette. The remaining 23 NEAR themes were left at **LOW** (see §6) because they diverge materially further — pastel/atmospheric washes, only the hue-*order* with shifted shades (Z→pink, L→gold), or partial mappings — and so do not, individually, approach Mino-level palette identity.

**Analysis.** *Xio* aggregated the vivid piece coloring **and** the field appearance into its trade-dress holding. A theme pairing the exact/near-exact Guideline palette with the exact 10×20 field is Serenity Blocks' closest approach to Mino. **However**, verification tempered every one of these from HIGH to **MEDIUM**, for principled reasons: (1) most "matches" replicate only the abstract *hue-to-shape mapping*, not the exact Guideline hex values (the themes use neon/pastel re-shades); (2) a color-to-shape mapping has itself become a de-facto industry convention used across many falling-block games, with a real functionality argument (piece distinguishability), weakening non-functionality and secondary-meaning; and (3) trade dress turns on aggregate look-and-feel confusion, not a single theme's color list in isolation. The **scrambled default palette** and the **30 DIVERGENT themes** are strong mitigations.

**Risk: MEDIUM** for the ~6 named themes; **LOW** for the theme set overall. Fix cost: low (re-hue ~6 themes; optionally vary board framing/borders/cell styling).

### Finding I — On-screen Guideline terminology — **LOW (trade dress)**

**Evidence**
- `src/rendering/phaser/shared-effects.js:1364` — HUD banner labels `['T-SPIN', 'T-SPIN\nSINGLE', 'T-SPIN\nDOUBLE', 'T-SPIN\nTRIPLE']` (drawn via `scene.add.text()`).
- `src/rendering/phaser/shared-effects.js:1412` — HUD banner `'BACK-TO-BACK'`.

**Analysis.** These are Guideline-vocabulary gameplay descriptors, not famous marks. Verification rated **"T-SPIN" UNCERTAIN/LOW** (a weak, descriptive term for a mechanic; protectability doubtful, and it does not contain "Tetris") and **"BACK-TO-BACK" REFUTED/LOW** (a plain descriptive English phrase for a scoring mechanic — not a protectable mark). They contribute marginally to the aggregate "this is Tetris" impression; a cautious commercial product *may* rename them ("Spin"/"T-Twist"; "Streak"/"Chain") but this is low priority.

**Risk: LOW.** Fix cost: low.

### Finding J — Missing LICENSE file and non-affiliation disclaimer — **LOW (hygiene)**

**Evidence**
- `package.json` declares `"license": "MIT"` but there is **no `LICENSE` file** on disk.
- No "not affiliated with The Tetris Company" disclaimer anywhere (`CREDITS.md` covers only two 3D-model entries).
- `steam_appid.txt` = `480` (Valve's public **Spacewar** test App ID — a harmless placeholder, but it confirms commercial-storefront intent).

**Analysis.** A prominent non-affiliation disclaimer does not cure infringement but reduces the confusion factor and demonstrates good faith. The MIT-declared/`LICENSE`-absent mismatch is a packaging bug that interacts with the Quadra question (F) *and* with **chain-of-title** (§2.6): resolve Quadra provenance and confirm the code is authored/owned such that MIT is the developer's to grant (relevant given both the Quadra lineage and the AI-assisted authorship) **before** committing a `LICENSE`.

**Risk: LOW.** Fix cost: trivial.

> **Note on the branch name** `claude/serenity-blocks-tetris-legal-4985pp`: internal VCS metadata only, never shipped — no external exposure.

---

## 5. Quadra IP (LGPL-2.1, third party) — dedicated analysis

**This section is entirely separate from Tetris.** It concerns whether Serenity Blocks' reuse of the open-source game **Quadra** creates a copyleft/license-compatibility problem.

### 5.1 What Quadra is, and its license

*Quadra* is an action puzzle game **© 1998–2000 Ludus Design** (a now-defunct Canadian studio), first released May 25, 1999, source opened ~2000. Canonical repo: **`github.com/quadra-game/quadra`** (last tag v1.3.0, 2014); previously on Google Code; formerly a Debian package (since removed). **License: GNU LGPL v2.1-or-later** (SPDX `LGPL-2.1-or-later`) — confirmed by the file headers and GitHub's license detector, and **recorded correctly in the project's own governance doc** (`docs/local-multiplayer-bot-ai-plan.md:205`: *"LGPL-2.1 according to local `LICENSE` and GitHub API | Do not copy or link code. Study behavior only."*). Ludus Design is defunct and there is **no history of Quadra enforcement/litigation** — practical enforcement risk is low, though absence of enforcement does not waive the license.

**Correction to v1:** v1 described Quadra as "GPL v2." It is **LGPL-2.1-or-later**. Either way it is copyleft and incompatible with the project's declared MIT, so the remediation logic is unchanged — but the memo should state the license accurately.

### 5.2 The decisive distinction: copied code vs. re-derived formula

| | **What was reused** | **Legal status** |
|---|---|---|
| **Copyrightable — would trigger LGPL** | Literal source *text*: copied lines, expressive structure, comments, idiosyncratic variable naming, or a mechanical C++→JS **transliteration** | Derivative work (17 U.S.C. § 106(2)) → must be LGPL-2.1-or-later, ship source, preserve Ludus notices; **cannot be MIT** |
| **Not copyrightable — no LGPL obligation** | **Formulas, numeric constants, game rules, algorithms, wire-encoding conventions** re-implemented in independently-written code to reproduce the same input/output | Ideas/procedures under § 102(b); facts/values under *Feist*; merged terse formulas under *Baker*/*Lotus* → **free to reproduce; may be MIT** |

### 5.3 Per-file evidence (from the Quadra-derivation audit)

The runtime code is candid — arguably too candid — about its Quadra lineage. Representative evidence:

- **`src/core/garbage.js:421-464`** — *"CRITICAL FORMULAS (from Quadra canvas.cc:477-648): 1. Base attack lines: depth - 1; 2. Clean bonus: (1 + depth) / 2 (integer division)"*; `:32-62` — reproduces Quadra's hole-encoding convention (MSB-first, column0→bit9) and magic constants **72 / 585**; `:17-27` — handicap levels tied to *"net_version 24."*
- **`src/core/constants.js:127-152`** — *"Based on Quadra's canvas.cc:calc_speed() and player.cc:calc_by()"* — transcribes the two-branch speed formula (`level ≤ 10: 4 + (level-1)*5`; `level > 10: 50 + (level-10)*3`) and the fixed-point conversion (`<<4`, 288 sub-units); `:155` — *"Quadra-authentic values."*
- **`src/core/physics.js:480-487`** — *"QUADRA-ACCURATE IMPLEMENTATION … Quadra's exact hole position tracking"* (describes the `moved[][]`/`hole_pos` buffer semantics); `:666` — *"Quadra: 15 lines per level."*
- **`src/core/scoring.js:10-58`** — *"Implements the complete Quadra scoring formula"* (250/500/1000/2000; cascade `200*(complexity-1)²`; perfect-clear `depth*1250`; +10% additive level multiplier); constants in `constants.js:106-125` (`QUADRA_SCORING`).
- **`src/core/game.js:1198-1200`** — *"Quadra-style time-based lock bonus: max(0, 100-frames)/2."*
- **`src/core/cascade-resolver.js:14-20`** — *"must remain a bit-exact port of processPhysics … identical by construction … replicate physics.js line-for-line."* (In context this asserts parity with Serenity's *own* `physics.js` refactor and reuse of Serenity's *own* exported functions — **not** a direct copy of Quadra source — but it preserves the Quadra-derived machinery.)
- **Docs:** `docs/quadra-adoption-plan.md:3-9` — *"ported roughly 90% of Quadra's distinctive gameplay mechanics — often faithfully"*; `docs/ONLINE_MP_QUADRA_PARITY_PLAN_2026-06-24.md:44-49` — dense `canvas.cc`/`random.cc`/`player.cc` file:line citations with literal constants (LCG `seed*0x41c64e6d+0x3039`, `%7`, `<<4`).

### 5.4 Verified assessment — LOW substantive risk, real hygiene concern

The adversarial verification pass **REFUTED every one of these as an infringement/LGPL exposure and corrected each to LOW.** The reasoning is consistent and, in this reviewer's judgment, correct: what the code actually reproduces is **arithmetic formulas, numeric game-balance constants, a functional bit-encoding/wire convention, and game rules** — all non-copyrightable under § 102(b), *Baker*, and *Feist*. The surrounding implementation is idiomatic JavaScript, **not** a literal transcription of Quadra's C++ statements; the magic numbers (72/585, `4/5/50/3`) appear in *comments and re-derived data*, and no verbatim C++ was found merely reformatted. Reusing only formulas/values from LGPL code is **not** a derivative work and triggers **no** copyleft obligation, so the MIT declaration is not, on the current evidence, violated.

**Two residual concerns nonetheless warrant action:**

1. **A genuine factual question counsel should close.** The distinction between "re-derived the math" (safe) and "translated the source" (LGPL-triggering) is fact-specific. The code's own labels — *"exact port," "identical by construction," "from canvas.cc:477-648,"* reproduction of internal buffer names (`moved[][]`, `hole_pos`) — describe *intent to reproduce faithfully*, which is exactly the framing a rights-holder would cite to argue translation. The audit found no literal code, but a one-time **provenance audit** (ideally clean-room-documented) should confirm this and rebut any "access + substantial similarity" inference.

2. **Documentation hygiene / self-created evidence.** The in-code citations of specific Quadra source-line ranges directly contradict the project's own guardrail ("Do not copy or link code. Study behavior only."). Whether or not the underlying reuse is lawful, this paper trail is needlessly adverse. **Scrub the "exact port / from canvas.cc:NNN-NNN / QUADRA-ACCURATE" comments** in favor of neutral behavioral descriptions, and record that the values were independently re-derived from observed behavior.

**Risk: LOW** (substantive copyleft exposure), with a **residual provenance question** and a **documentation-hygiene** item. Fix cost: medium (provenance audit + comment scrub; clean-room re-derivation only if the audit finds literal translation).

> **Interface/format note:** the `.qrec` replay concept (`src/core/game-modes/SinglePlayerMode.js:611`, *"like Quadra's automatic last.qrec"*) and the `net_version` protocol are functional interface specifications; re-implementing them for interoperability is permissible under § 102(b) and *Google v. Oracle*, and no evidence was found that Quadra's binary `.qrec` format is actually reproduced.

> **Netcode originality (evidence for §11's "original work" conclusion).** The multiplayer audit confirmed the snapshot/binary-protocol layer is **not** Quadra-derived: `src/core/network/binary-encoding.js`, `message-types.js`, `snapshot-frame-v2.js`, `protocol-version.js`, and `host-migration.js` contain **no** `Quadra`/`TETR.IO`/`net_version`/`canvas.cc` reference (the only "derive" hit was the English verb in `snapshot-frame-v2.js:113`). The sole Quadra-derived data reaching multiplayer is the garbage/attack **formula** (§5.3); `TETR.IO` appears only in comparative comments ("Quadra/TETR.IO style"), never as a copied wire/replay format, and no `.ttr`/`.ttrm` format was found. On this evidence the wire protocol and snapshot format are original.

> **If literal translation *were* found (LGPL-2.1 compliance mechanics).** The audit found only re-derived formulas, so this is contingency guidance: were a provenance audit to conclude that any module is a translation of Quadra's C++, LGPL-2.1 compliance for that module would require shipping its **complete corresponding source**, **preserving the © 1998–2000 Ludus Design notices and the LGPL text**, and providing the module in a **relinkable/replaceable** form (or licensing it LGPL-2.1-or-later) — none of which is compatible with folding it into a closed, MIT-declared Electron/Steam binary. **Clean-room re-derivation from a behavioral spec avoids all of this** and is the recommended path if the audit surprises.

---

## 6. Trade-dress theme-color audit (full results)

All **59** `src/themes/*/*-tetrominos.js` files were graded against the Guideline mapping (I=cyan, O=yellow, T=purple, S=green, Z=red, J=blue, L=orange). The 21 `*-materials.js` files only mirror their own theme's colors and add no independent risk. The app-wide **default** (`src/core/constants.js:31-41`) is a **scrambled, non-Guideline** mapping (only Z=red coincides) — a deliberate and valuable divergence.

| Grade | Count | Themes |
|---|---|---|
| **EXACT** | **3** | `voltage-storm`, `neon-district`, `neon-dusk` |
| **NEAR** | **26** | `aether-tides`, `astral-weave`, `shifting-sands`, `tornado`, `nebula-flow`, `galaxy`, `crystal-cave`, `geode`, `waves`, `cosmic-chimes`, `misty-lake`, `swedish-forest`, `moonrise-summit`, `lunara`, `starlight`, `singing-bowl`, `rainy-window`, `moonlit-greenhouse`, `koi-pond`, `aurora`, `stellar-drift`, `electric-dreams`, `black-hole`, `summer`, `chromatic-impasto`, `supernova` |
| **DIVERGENT** | **30** | `fluid-dreams`, `synthwave-sunset`, `chromadelic-highway`, `pyrestorm`, `cinder-drift`, `fall`, `chiral-gold`, `blood-moon`, `cosmic-noir`, `wolfhour`, `mountain`, `himalayan-peak`, `serenity-warp`, `vesper-chrysalis`, `solar-eclipse`, `ice-temple`, `winter`, `nimbus-veil`, `moonlit-forest`, `sakura-twilight`, `sky-children`, `sky-children-v2`, `sunset`, `stillwater`, `ocean`, `halcyon-apex`, `stellar-velocity`, `luminous-tides`, `bioluminescence`, `bioluminescence-2` |

> **What "EXACT" means here (grading nuance).** Of the three EXACT themes, only **`voltage-storm`** reproduces all seven pieces at *near-canonical Guideline hues* (literal cyan/yellow/purple/green/red/blue/orange). **`neon-district`** and **`neon-dusk`** match the Guideline shape→hue *order* and hue *families* but shift T and Z to in-family magenta/pink neon — so they are "EXACT" on *mapping* rather than on exact hex. That is why Finding E treats `neon-district` as a **borderline/UNCERTAIN** match rather than a literal reproduction; all three are still grouped as the top-priority reskin targets.

**Interpretation.** The single largest driver of NEAR matches is a recurring "serene pastel" template — **I=cyan, O=amber/gold, T=lavender/purple, S=mint/green, Z=rose/pink, J=indigo/blue, L=warm gold** — which preserves the Guideline shape→hue *order* while shifting the actual shades (Z softened to pink, L drifted to gold). Under adversarial verification, most NEAR themes were **downgraded to LOW** precisely because they match only the (functional, industry-standard) hue *ordering* and not the Guideline hex values. The **DIVERGENT** themes escape entirely via monochrome palettes (`blood-moon` all-red, `chiral-gold` all-gold, `cosmic-noir`/`wolfhour` grayscale, `luminous-tides`/`bioluminescence` all-cyan-green) or fully reshuffled mappings (`ocean`, `stellar-velocity`, `serenity-warp` = the scrambled default). The residual MEDIUM exposure is concentrated in the six themes named in Finding E; re-hueing those is the targeted fix.

---

## 7. Considered and dismissed (refuted findings)

Transparency requires disclosing what the deep review flagged and then **rejected** on verification. These are **not** risks; they are recorded so the analysis is honest and so effort is not wasted "fixing" defensible design.

### 7.1 Mechanics, formulas, and functional data are not copyrightable (DISMISSED)

The following were flagged as "verbatim Guideline copying" and **all refuted to LOW** as uncopyrightable ideas/procedures/functional data (§ 102(b), *Baker*, *Feist*; *Xio* protects expression, **not** mechanics):

- **SRS wall-kick tables** — `src/core/game.js:140-160` (`JLSTZ_KICKS`, `I_KICKS`). Verified byte-exact to the Guideline SRS, but wall-kick offset tables are a functional rotation *system* and functionally-dictated numeric data. Byte-exact reproduction of a functional table does not make it protectable. **DISMISSED.**
- **7-bag "Random Generator"** — `src/core/pieces.js:34-39`. An algorithm/method of operation. **DISMISSED.**
- **Lock delay 500 ms / 15-move reset** — `src/core/constants.js:167-168`. Functional tuning parameters. **DISMISSED.**
- **T-spin 3-corner detection** — `src/core/game.js:1263-1282`. A recognition *rule*. **DISMISSED.**
- **Back-to-Back chain** — `src/core/physics.js:712-727`. A scoring *mechanic*. **DISMISSED.**
- **Board dimensions 10×20 + 4 hidden rows** — `src/core/constants.js:11-13`. Functional/near-universal. **DISMISSED** (relevant only as a weak trade-dress aggregation factor).
- **Rotation-state notation `['0','R','2','L']`** — `src/core/game.js:137`. Notation, not expression. **DISMISSED.**

### 7.2 Every "Quadra port" formula (DISMISSED as copyleft exposure)

All Quadra scoring/speed/garbage/physics **formulas and constants** in §5.3 were refuted to LOW: they are non-copyrightable formulas/values, the implementation is independent JS (not literal C++), and reusing formulas/values from LGPL code triggers no copyleft. **DISMISSED as infringement** — but note the residual *provenance/hygiene* action retained in Finding F (the factual question and the comment scrub are prudence, not a confirmed violation).

### 7.3 "Documented imitation intent" (Tetris Effect / Tetris 99) — DISMISSED to LOW

The design docs repeatedly name **Tetris Effect: Connected — Journey Mode** as the Odyssey "north star" (`docs/ODYSSEY_CINEMATIC_JOURNEY_PLAN.md:9`; `docs/ODYSSEY_AAA_MASTER_PLAN.md:302`; `docs/gameplay-effects-plan.md:42`) and cite Tetris 99 / Jstris / TETR.IO as multiplayer references. v1 rated this MEDIUM (willfulness). **Verification refuted it to LOW**, and the reasoning is sound: what these docs aspire to reproduce are **uncopyrightable ideas, mechanics, and aesthetic goals** ("synesthesia," "music-reactive particles," "seamless world dissolves," "the Zone" time-stop) — abstract game-feel, not concrete copied expression. Willfulness evidence only aggravates an *underlying* act of infringement of protected expression; absent that, intent to build "in the vein of" a competitor is standard, non-actionable industry practice. The docs are **internal, non-user-facing**, so there is no trademark-in-commerce exposure either.

- **Residual (LOW, optional):** because these files are committed to git history and are cheap to neutralize, it remains *prudent* to reframe design language generically and to ensure the *executed* effects are original expression — but this is defensive polish, not a live risk.

### 7.4 "Tetromino," the seven shapes, "BACK-TO-BACK," internal identifiers — DISMISSED

- **"Tetromino"** is a public-domain geometry term (coined by Solomon Golomb); the trademarked spelling **"Tetrimino" appears nowhere** (confirmed). **DISMISSED.**
- **The seven tetromino shapes** (`src/core/constants.js:62-98`) are functionally constrained; T/J/L spawn orientations even deviate from Guideline. **DISMISSED** (mildly protective).
- **"BACK-TO-BACK"** HUD banner — a generic descriptive phrase, not a protectable mark. **DISMISSED.**
- **Internal `'tetris'` code tokens / `'Quadra'` UI labels** (bot tier "Quadra Ace," "Quadra Blind," match-config help text) — "Quadra" is the project's own coined term for a 4-line clear, not a Tetris mark; these are LOW/negligible. **DISMISSED** (rename for consistency only).

---

## 8. Audio & asset provenance (copyright, non-Tetris)

**Reassuring negatives (verified):**
- **No Korobeiniki / "Type A" / Russian-folk melody** by name anywhere — `src/audio/music-manifest.js:42-83` lists ~36 tracks with original ambient/nature names; grep for `korobeiniki`/`type-a`/`russian`/`folk`/`kalinka`/`troika` returned **zero** hits. *(Limitation: binaries not decoded — one human listen-through recommended.)*
- **SFX are fully procedural** Web Audio synthesis (`src/audio/sound-effects.js:20-52`) — no ripped samples.
- **Fonts** are Google Fonts Orbitron + Space Mono (OFL) and system fonts (`index.html:84`); **no bundled font binaries**.
- **No ripped Tetris sprites/block skins/textures** — pieces render procedurally.

**Two genuine gaps (both CONFIRMED, MEDIUM):**

### Finding G — Music provenance — **RESOLVED** (was MEDIUM, copyright hygiene)
As originally flagged, `CREDITS.md` documented only two 3D-model entries and did not mention the ~36 shipped music tracks — no composer, source, or license record — so nothing in the repo established that the tracks were original, licensed, or AI-generated. **Status (2026-07-15): RESOLVED.** The project owner confirms **all ~36 tracks are original compositions owned by the project** (no stock/library music, and no *Korobeiniki* / Type-A arrangement), and this is now recorded in `CREDITS.md` §4 with a proprietary/project-owned license statement. A one-time human listen-through before release remains prudent QA, but the provenance-record gap is closed.

### Finding H — CC-BY attribution fragmented — **RESOLVED** (was MEDIUM, copyright compliance)
As originally flagged, genuinely CC-BY assets ship and **require** attribution reaching end users — Solar System Scope planet textures and six Poly Pizza CC-BY 3D models (plus the Sea Turtle model) — but were recorded only in ~14 scattered per-folder `ATTRIBUTION.md` files while the top-level `CREDITS.md` listed just two entries. **Status (2026-07-15): RESOLVED.** All CC-BY sources are now consolidated into `CREDITS.md` §1 (Solar System Scope; the Sea Turtle; and the six MiniPoly/Laney XR Labs/Poly-by-Google/Christopher F ocean models), with CC0 and project-original assets separated out. **Remaining action:** ensure the shipped build actually surfaces `CREDITS.md` (or an in-app credits screen derived from it) to end users.

---

## 9. Risk assessment matrix

| Finding | Estate | Category | Enforcement likelihood | Severity | Verified risk | Priority |
|---|---|---|---|---|---|---|
| A — "Tetris" keyword + store copy | Tetris | Trademark | High | Takedown / C&D | **HIGH** | P0 |
| B — In-game "Tetris" label | Tetris | Trademark | Med-High | Takedown / C&D | **HIGH** | P0 |
| C — "Tetris-inspired" (desc/README) | Tetris | Trademark | Medium | C&D | **MEDIUM** | P0 |
| D — "Tetrises" in objective text | Tetris | Trademark | Medium | C&D | **MEDIUM** | P1 |
| E — Guideline-palette themes (×6) | Tetris | Trade dress | Medium | Injunction / reskin | **MEDIUM** | P1 |
| G — Music provenance (now original + recorded) | Third-party | Copyright hygiene | — | — | **RESOLVED** | Done |
| H — CC-BY attribution (now consolidated) | Third-party | Copyright compliance | — | — | **RESOLVED** | Done |
| F — Quadra LGPL provenance | Quadra | Copyleft / license | Low | Rewrite / comply | **LOW** (residual) | P1 |
| I — On-screen Guideline terms | Tetris | Trade dress (weak) | Low-Med | Minor redesign | **LOW** | P2 |
| J — No LICENSE / no disclaimer | — | Hygiene | Low | Good-faith / confusion | **LOW** | P2 |
| §7 items | Both | Copyright (ideas/formulas) | — | Defensible | **DISMISSED** | — |

**How Serenity Blocks compares to the losing party in *Xio*:** Mino used the Tetris name/style in marketing, copied the exact piece colors, and was audiovisually indistinguishable from Tetris. Serenity Blocks has a distinctive name, a scrambled default palette, original music, procedural SFX/blocks, and 30 divergent themes — **most Mino risk factors are already mitigated.** The remaining gaps (name in metadata/UI, ~6 Guideline-palette themes) are the items a plaintiff would cite; they are the focus of remediation.

---

## 10. Recommended remediation plan

### P0 — Before any public build or store submission (hours)
1. **Purge "Tetris" from all published surfaces (A, C).** `package.json:4` description → *"A modern falling-block puzzle game built with Phaser 4"*; remove `"tetris"` from `package.json:114` keywords (use `"puzzle"`, `"falling-blocks"`, `"block-puzzle"`); `README.md:3` and `game_description.md:5` → "falling-block / block-stacking puzzle."
2. **Rename the in-game "Tetris" label (B)** at `LocalMultiplayerMode.js:3776` → a generic self-coined label (`'Quad'` / `'Quad Clear'` / `'Four-Line'`). **Avoid `'Quadra'` in *user-facing* text** — it is a third-party game name (§5); it is fine as an internal identifier only. Rename the internal `'tetris'` effect-tier tokens for consistency.
3. **Add a non-affiliation disclaimer (J)** to README, an in-app About/credits screen, and any store page: *"Serenity Blocks is an independent game and is not affiliated with, endorsed by, or sponsored by The Tetris Company, LLC or Tetris Holding, LLC. TETRIS® is a registered trademark of Tetris Holding, LLC."*

### P1 — Before commercial release (days)
4. **Scrub user-facing "Tetris/Tetrises" from gameplay copy (D)** — `OdysseyHUD.js:289`, `levels.js` objective descriptions/tips → "quads"/"four-line clears."
5. **Re-hue the ~6 Guideline-palette themes (E)** — `voltage-storm`, `neon-dusk`, `neon-district`, `aether-tides`, `nebula-flow`, `starlight` — so no shipped skin reproduces the I-cyan/O-yellow/T-purple/S-green/Z-red/J-blue/L-orange mapping. Keep the scrambled default as canonical identity. Optionally vary board framing/borders/cell styling so no theme reads as "stock Guideline Tetris."
6. ✅ **DONE — Close the audio & CC-BY gaps (G, H).** Music provenance recorded as **original / project-owned** in `CREDITS.md` §4 (owner-confirmed); all CC-BY sources (Solar System Scope, Sea Turtle, six Poly Pizza ocean models) consolidated into `CREDITS.md` §1. **Residual:** a one-time human listen-through of the ~36 tracks + intro `.ogg`s (QA), and ensure the build surfaces `CREDITS.md` to players.
7. **Run the Quadra provenance audit + scrub (F)** — confirm (ideally clean-room-documented) that only formulas/rules were re-derived, not literal source; replace "exact port / from canvas.cc:NNN / QUADRA-ACCURATE / identical by construction" comments with neutral behavioral descriptions; then add the `LICENSE` (MIT) file once provenance is confirmed. If the audit finds literal translation, either clean-room re-derive from a behavioral spec or bring the affected modules into LGPL-2.1 compliance (see §5 for what that concretely requires — corresponding source, preserved Ludus notices, relinkable form; incompatible with a closed MIT binary).

### P2 — Defensive depth / polish
8. **Optionally rename on-screen Guideline terms (I)** — "T-SPIN" → "Spin"/"T-Twist"; "BACK-TO-BACK" → "Streak"/"Chain."
9. **Neutralize documented imitation framing (§7.3)** — reframe design-doc language away from "the Tetris-Effect signature/magic" toward generic effect descriptions; ensure executed effects are original expression. (Prudence, not a live risk.)

### P3 — Cosmetic
10. Optionally rename `*-tetrominos.js` / `tetromino` identifiers to neutral terms ("blocks," "pieces"). Legally optional — "tetromino" is public-domain — do it only for brand consistency.

### Cross-cutting
11. **Engage IP/open-source counsel** before commercial launch given TTC's enforcement posture, the Steam target, and the Quadra LGPL question. Have counsel confirm the trademark cleanup, the trade-dress divergence, the audio provenance, and the Quadra provenance conclusion.

---

## 11. What is already safe / defensible (keep it this way)

- **Distinctive product name** "Serenity Blocks" — no similarity to "Tetris."
- **Scrambled default piece palette** + **30 DIVERGENT themes** — only Z(red) coincides in the default; a deliberate, valuable divergence.
- **No Tetris music** — the ~36 tracks are confirmed **original, project-owned compositions** (owner-confirmed; recorded in `CREDITS.md` §4); none uses *Korobeiniki* / "Type A", so the sound mark (Reg. No. 3,517,007) is not implicated. *(A one-time human listen-through remains prudent QA, since this review did not decode the audio binaries.)*
- **Fully procedural SFX**; **OFL/system fonts only**; **no ripped Tetris sprites/skins/textures** — piece rendering is generated in code.
- **Generic "tetromino" terminology** (never the trademarked "Tetrimino").
- **Mechanics, formulas, and numeric constants** (SRS, 7-bag, ghost, lock delay, T-spin, B2B, and the Quadra scoring/speed/garbage math) — legal to implement; **not copyrightable**, and not LGPL-triggering when re-derived rather than copied.
- **Independent implementation** — the audit found idiomatic JavaScript, not literal C++ translation, and the netcode/snapshot layer is original work (no `Quadra`/`TETR.IO`/`net_version`/`canvas.cc` references in the `src/core/network/` protocol files; evidence in §5).

Maintaining strong **expressive divergence** and **documented independent authorship** is the single most important ongoing defense. The remediation above tightens the few places where the product still points back at "Tetris" by name or palette, closes two asset-provenance gaps, and removes needlessly adverse Quadra self-labeling.

---

## 12. Sources

### Tetris — case law, trademark, enforcement
- [Tetris Holding, LLC v. Xio Interactive, Inc. — Wikipedia](https://en.wikipedia.org/wiki/Tetris_Holding,_LLC_v._Xio_Interactive,_Inc.)
- [Tetris Holding, LLC v. Xio Interactive, Inc., 863 F. Supp. 2d 394 (D.N.J. 2012) — Google Scholar](https://scholar.google.com/scholar_case?case=18064882260025243346)
- [Tetris Holding v. Xio Interactive — Loeb & Loeb LLP](https://www.loeb.com/en/insights/publications/2012/06/tetris-holding-llc-v-xio-interactive-inc)
- [Cloning Video Games is Copyright Infringement — Stone's Law](https://www.stoneslaw.net/cloning-video-games-is-copyright-infringement/)
- [Tetris Gets Permanent Injunction Against Xio — IPWatchdog](https://ipwatchdog.com/2013/02/12/tetris-gets-permanent-injunction-against-xio/id=34996/)
- [Atari, Inc. v. Amusement World, Inc., 547 F. Supp. 222 (D. Md. 1981) — Justia](https://law.justia.com/cases/federal/district-courts/FSupp/547/222/1478917/)
- [Midway Mfg. Co. v. Artic Int'l, Inc., 704 F.2d 1009 (7th Cir. 1983) — OpenJurist](https://openjurist.org/704/f2d/1009/midway-mfg-co-v-artic-international-inc)
- [Data East USA, Inc. v. Epyx, Inc., 862 F.2d 204 (9th Cir. 1988) — Justia](https://law.justia.com/cases/federal/appellate-courts/F2/862/204/20289/)
- [Capcom U.S.A. Inc. v. Data East Corp. — Wikipedia](https://en.wikipedia.org/wiki/Capcom_U.S.A._Inc._v._Data_East_Corp.)
- [Incredible Techs. v. Virtual Techs. (Global VR), 400 F.3d 1007 (7th Cir. 2005) — Justia](https://law.justia.com/cases/federal/appellate-courts/F3/400/1007/606294/)
- [Spry Fox, LLC v. LOLApps, Inc. — Wikipedia](https://en.wikipedia.org/wiki/Spry_Fox,_LLC_v._Lolapps,_Inc.)
- [DaVinci Editrice S.r.l. v. ZiKo Games, LLC (S.D. Tex. 2016) — Game Developer](https://www.gamedeveloper.com/business/texas-court-affirms-game-mechanics-not-protected-under-copyright-law)
- [How Courts View Copyright Protection For Video Games — Frankfurt Kurnit Klein & Selz](https://fkks.com/news/how-courts-view-copyright-protection-for-video-games)
- [Clone Games on Trial: What U.S. Copyright Law Protects — Pillar Legal (2023)](https://www.pillarlegalpc.com/wp-content/uploads/2024/07/Pillar-Legal-Clone-Games-on-Trial-2023-5-23-1.pdf)
- [The Tetris Company — Wikipedia (enforcement history)](https://en.wikipedia.org/wiki/The_Tetris_Company)
- [TETRIS Trademark Reg. No. 4,592,985 — Trademarkia](https://www.trademarkia.com/tetris-86205967)
- [TETRIS Trademark Reg. No. 5,617,892 — TrademarkElite](https://www.trademarkelite.com/trademark/trademark-detail/87069698/TETRIS)
- [TETRIS Trademark Reg. No. 3,396,574 — Justia Trademarks](https://trademarks.justia.com/789/79/tetris-78979550.html)
- [TETRIS HOLDING *Korobeiniki* "Type A" sound mark — Reg. No. 3,517,007 / Serial 77037539 — Justia Trademarks](https://trademarks.justia.com/770/37/n-77037539.html)
- [Ackerman v. Pink, No. 1:23-cv-06952 (S.D.N.Y. Mar. 6, 2025) (Failla, J.) — docket/opinion, Justia](https://law.justia.com/cases/federal/district-courts/new-york/nysdce/1:2023cv06952/603847/58/)
- [Apple defeats copyright suit over the *Tetris* film (Ackerman v. Pink) — Reuters via TradingView](https://www.tradingview.com/news/reuters.com,2025:newsml_L2N3PP0ZH:0-apple-defeats-tech-writer-s-copyright-lawsuit-over-tetris-movie/)
- [Tetris Guideline — TetrisWiki](https://tetris.wiki/Tetris_Guideline)
- [Tetromino / Tetrimino terminology — TetrisWiki](https://tetris.wiki/Tetromino)
- [Takedown notice for Setris (June 2023) — itch.io](https://itch.io/takedowns/2073998)
- [Takedown notice for Playtris (June 2022) — itch.io](https://itch.io/takedowns/1478297)
- [Viral sand Tetris game Setris reborn as Sandtrix — AUTOMATON West](https://automaton-media.com/en/news/20230704-19918/)
- [Tetris Clones Pulled From Android Market (2010 DMCA) — Slashdot](https://games.slashdot.org/story/10/05/28/079200/tetris-clones-pulled-from-android-market)
- [Tetrada developer receives cease & desist — Windows Central](https://www.windowscentral.com/tetrada-developer-receives-cease-desist-tetris-company)
- [Is TETR.IO legal? — osk blog](https://blog.osk.sh/post.php?p=643dbb578e1ba3.57021842)

### Non-copyrightability of mechanics, formulas, and data
- [17 U.S.C. § 102 — subject matter; § 102(b) exclusions — Cornell LII](https://www.law.cornell.edu/uscode/text/17/102)
- [17 U.S.C. §§ 101 & 106 — "derivative work" includes translation — Cornell LII](https://www.law.cornell.edu/uscode/text/17/101)
- [Baker v. Selden, 101 U.S. 99 (1879) — Justia](https://supreme.justia.com/cases/federal/us/101/99/)
- [Feist Publications, Inc. v. Rural Telephone Service Co., 499 U.S. 340 (1991) — Cornell LII](https://www.law.cornell.edu/supremecourt/text/499/340)
- [Computer Associates Int'l v. Altai, 982 F.2d 693 (2d Cir. 1992) — Justia](https://law.justia.com/cases/federal/appellate-courts/F2/982/693/137252/)
- [Lotus Development Corp. v. Borland International — Wikipedia](https://en.wikipedia.org/wiki/Lotus_Dev._Corp._v._Borland_Int%27l,_Inc.)
- [Google LLC v. Oracle America, Inc. (2021) — Wikipedia](https://en.wikipedia.org/wiki/Google_LLC_v._Oracle_America,_Inc.)
- [U.S. Copyright Office, Circular 33 — Works Not Protected by Copyright](https://www.copyright.gov/circs/circ33.pdf)
- [U.S. Copyright Office — Games: rules/methods of play not protected](https://www.copyright.gov/register/tx-games.html)
- [ABA Landslide — Why Videogame Rules Are Not Expression Protected by Copyright Law](https://www.americanbar.org/groups/intellectual_property_law/resources/landslide/archive/why-videogame-rules-are-not-expression-protected-copyright-law/)

### Jurisdiction, AI-authorship & patents (scope notes, §2.6)
- [U.S. Copyright Office — Copyright and Artificial Intelligence (registration guidance)](https://www.copyright.gov/ai/)
- [EUIPO — Community Designs (unregistered look-and-feel protection in the EU)](https://www.euipo.europa.eu/en/designs)

### Quadra — license & provenance
- [Quadra canonical source repository (quadra-game/quadra) — LGPL-2.1](https://github.com/quadra-game/quadra)
- [Quadra source/canvas.cc — LGPL-2.1 header & Canvas::calc_speed()](https://raw.githubusercontent.com/quadra-game/quadra/master/source/canvas.cc)
- [Quadra source/player.cc — "Copyright (C) 1998-2000 Ludus Design", Player_base::calc_by()](https://raw.githubusercontent.com/quadra-game/quadra/master/source/player.cc)
- [Google Code Archive — original Quadra project hosting](https://code.google.com/archive/p/quadra)
- [Internet Archive — Quadra v1.3.0 (Ludus Design)](https://archive.org/details/quadra-1.3.0)
- [Debian package tracker — quadra (removed from Debian)](https://tracker.debian.org/pkg/quadra)
- [GNU Lesser General Public License, version 2.1 (full text)](https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html)
- [GNU license compatibility / license list (one-way permissive→copyleft)](https://www.gnu.org/licenses/license-list.html)

---

*End of review (v2.1). This assessment reflects the repository state on branch `claude/serenity-blocks-tetris-legal-4985pp` as of 2026-07-15, incorporates a multi-agent deep audit, an adversarial verification pass, and a completeness-review pass, and should be **re-run if the piece palettes, playfield presentation, branding/marketing copy, audio assets, CC-BY assets, or the Quadra-derived code provenance change materially** before release.*
