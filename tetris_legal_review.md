# Serenity Blocks — Tetris Intellectual-Property Legal-Risk Review

**Version:** 3.0 — current-state repository and web-research review

**Prepared:** 2026-07-15

**Repository:** `olovmelander/serenity-blocks`

**Branch / commit reviewed:** `main` at `4127ae2fc2babe329928d20a4873b5a4a644f286`

**Primary focus:** U.S. trademark, copyright, trade dress, sound-mark, and platform-enforcement risk relating to Tetris

**Decision posture:** pre-release risk triage; not a freedom-to-operate opinion

> **Important: not legal advice.** This is an engineering-led issue-spotting report, not a legal opinion, a prediction of litigation, or a substitute for advice from qualified IP counsel. It does not create an attorney-client relationship. The conclusions are deliberately expressed as risk assessments, not findings of infringement. A lawyer should review the exact playable build, final store materials, launch territories, contracts, and asset provenance before release.

---

## 1. Executive conclusion

### Overall current Tetris-related posture: **MEDIUM (provisional)**

Static source and asset evidence indicates that Serenity Blocks is materially less similar than the near-identical game adjudicated in *Tetris Holding, LLC v. Xio Interactive, Inc.*, 863 F. Supp. 2d 394 (D.N.J. 2012). Because this review did not run the build or perform a frame-by-frame comparison, that conclusion is provisional. The source shows a distinctive name; a scrambled first-run color map; fused, borderless pieces and a transparent playfield in the primary renderer; elaborate themed environments; three next previews; no hold system; custom cascade physics; different scoring; no deliberate lock-down recolor; and no Tetris-style bottom-to-top game-over fill. Those are material differences if consistently realized in the shipping build; a gridded legacy canvas fallback is separately flagged in AV-2.

The residual problem is the **combined impression**, not any isolated mechanic. The current product still combines:

- the exact seven conventional I/O/T/S/Z/J/L four-square pieces;
- an exact 10-wide × 20-visible-high field;
- the overlapping visual/UI features discussed in *Xio*—falling and rotating pieces, line-clear presentation, ghost, next-piece display, and garbage—plus primarily functional modern rules such as seven-bag, SRS, T-spins, back-to-back scoring, hard drop, and lock delay; the latter group was not adjudicated as protected expression in *Xio*;
- numerous selectable themes whose shape-to-hue assignment follows all or nearly all of the familiar modern Tetris color roles;
- prominent decorative startup pieces drawn from the complete conventional seven-type repertoire around the `SERENITY BLOCKS` wordmark;
- an exact four-square T-piece as the main-menu Single Player icon; and
- two remaining ordinary player-visible uses of the word `Tetris`.

The best on-point U.S. decision treated an overlapping **cluster** of audiovisual choices as protectable when the accused game reproduced their total concept and feel. The court also emphasized that individual elements might not infringe standing alone and relied on Mino's near identity and unusually damaging copying admissions. That makes the present case materially better than Xio's, but not clean enough to call low risk.

### Release recommendation: **conditional no-go**

Do not submit the current build or gameplay imagery for a commercial storefront until the P0 work in §11 is complete and counsel has reviewed a representative playable build and store-asset set against the specific Tetris works and current source-identifying materials plausibly relevant to a claim. This is a risk-management recommendation, not a conclusion that the present code infringes.

### Highest-priority conclusions

| Area | Current rating | Why | Cheapest meaningful reduction |
|---|---:|---|---|
| Audiovisual copyright | **Medium, provisional** | Exact seven-piece/10×20/ghost/next cluster remains; fused rendering, themes, cascades, and other differences materially mitigate; the current rendered result was not compared | Remove canonical pieces from branding; derange palettes as a conservative separation measure; conduct playable total-look review; redesign the cluster as a whole where practical |
| Trade dress / storefront appearance | **Medium, provisional** | Startup code and the T-piece menu icon use tetromino imagery as branding; final rendered startup/store imagery was unavailable | Replace branding glyphs; curate clean store screenshots; retain transparent, fused, distinctive presentation |
| TETRIS word mark | **Low–Medium** | Product title and package metadata are clean; two Odyssey tips use `Tetris` descriptively, and public source/docs contain extensive named references | Replace the two tips and public playground metadata as hygiene; reserve one counsel-approved plain-text legal notice if desired |
| Sound mark | **Low, unverified** | No textual evidence of Korobeiniki/Type-A use, but no listening or acoustic comparison was performed | Musicologist/human listen plus chroma/fingerprint check; preserve provenance |
| Mechanics/source code in isolation | **Low** | Rules, methods, and systems are generally excluded from copyright by 17 U.S.C. §102(b) | Preserve independent implementation evidence; avoid treating mechanics as branding |
| Platform takedown / business continuity | **Unquantified likelihood / High impact** | Public takedown notices show enforcement capability and examples, not the probability that this project will be targeted; platform removal may precede merits review | Finish cheap cleanup, keep response dossier and counsel contact, and avoid launch-day dependency on disputed imagery |

### Consolidated Tetris risk register

| ID | Issue | Merits likelihood | Potential impact | Overall treatment |
|---|---|---:|---:|---:|
| TM-1 | `Serenity Blocks` name and generic package metadata | Low | High if challenged | **Low** |
| TM-2 | Two player-visible Odyssey uses of `Tetris` | Low | Medium | **Low merits risk; remove as hygiene** |
| TM-3 | Production-bundled playground metadata and comments/examples | Low | Medium | **Low; remove as hygiene** |
| TM-4 | Hundreds of internal/public-repository competitor references | No standalone claim identified | Context-dependent | **No standalone infringement rating; clean prospectively** |
| TM-5 | Non-affiliation disclaimer | N/A | N/A | **Mitigating, not curative** |
| AV-1 | Exact seven pieces plus exact 10×20 field | Medium in aggregate | High | **Medium contextual factor; rendered total look controls** |
| AV-2 | Fused, borderless, transparent primary rendering | N/A | N/A | **Strong mitigation in primary path; legacy fallback caveat** |
| AV-3 | Ghost, next, garbage, and conventional movement cluster | Medium in aggregate | High | **Medium factor** |
| AV-4 | No lock recolor or square-fill end animation | N/A | N/A | **Strong mitigation** |
| AV-5 | Cascade physics, custom scoring/modes/progression | N/A | N/A | **Material mitigation** |
| AV-6 | Complete seven-piece repertoire in startup branding code | Medium, provisional | High | **Provisional Medium; capture and redesign** |
| AV-7 | Exact T-piece main-menu icon | Low | Medium–High | **Low–Medium; redesign** |
| AV-8 | Favicon mosaic and `Tetris-like` source comment | Low | Medium | **Low; replace/clean** |
| AV-9 | Distinctive scenic theme art | Low | Medium | **Low / mitigating** |
| PAL-1 | Ten active 7/7 familiar hue-role palette screens plus near matches | Unverified without rendered context | High if part of a close overall look | **Potentially Medium in an otherwise similar screenshot** |
| CODE-1 | SRS, seven-bag, lock timing, T-spin, B2B and other rules | Low in isolation | Medium | **Low mechanics / audiovisual caveat** |
| SND-1 | Possible registered tune or similar cue | Low on static evidence; unverified | High | **Verify before release** |
| ENF-1 | Repository/storefront/platform takedown | Unquantified | High interruption cost | **Material business-continuity exposure** |

“Merits likelihood” estimates the chance that the current fact could materially support a claim, not the probability that a claimant will sue or ultimately win. “Impact” assumes a commercial launch and includes injunction/takedown cost, rework, delay, and defense expense.

### Separate copyright-release blockers

The repository-wide asset review also found **non-Tetris-specific** licensing and provenance problems: apparent byte-identical SynthCity assets without the required MIT notice; a live CC-BY Fox model absent from credits; incomplete Solar System Scope attribution; credits excluded by the current Electron packaging configuration; and unsupported or incomplete provenance claims for Suno music, Gemini TTS, several generated 3D assets, and intro sounds. These issues are detailed in §13 and should be treated as release blockers independently of the Tetris analysis.

---

## 2. Scope, methodology, and limitations

### 2.1 Repository work performed

The audit covered all **2,313 tracked files** at the commit identified above, with focused review of:

- gameplay rules and state in `src/core/`;
- board, piece, ghost, queue, effects, and multiplayer rendering;
- startup, main-menu, favicon, and product-name presentation;
- all **59** `*-tetrominos.js` theme configurations;
- the theme registry and runtime theme-color resolution path;
- **60** theme icons, five repository screenshots, and all 36 embedded music cover images;
- music filenames, manifests, MP3 metadata, durations, and textual generation records;
- GLB metadata and asset attribution files;
- distribution settings for Vite, GitHub Pages, Electron, NSIS, and Steam integration;
- README, package metadata, store-style copy, current design plans, archived plans, comments, tests, and playground content; and
- third-party license and notice coverage.

The text scan found **637 case-insensitive standalone `Tetris`/`Tetrises` tokens in 172 files**, excluding this report and installed dependencies. Thirty occurrences of `Tetris Effect` appear across 13 files. Counts are inventory facts, not a legal test; most occurrences are comments, tests, or design documents rather than consumer-facing uses.

### 2.2 Web research performed

Research prioritized primary and official sources:

- the full *Xio* opinion and federal docket sources;
- 17 U.S.C. §§102, 107, 412, 504, and 512;
- 15 U.S.C. §§1116–1118 and 1125;
- U.S. Supreme Court and Third Circuit trademark/trade-dress authorities;
- U.S. Copyright Office game and uncopyrightable-material guidance;
- USPTO/TTAB records showing current TETRIS registrations and a public registration record for the sound mark;
- The Tetris Company's current owner statements and contact page; and
- published GitHub and itch.io takedown notices.

The key sources are linked where used and collected in §15.

### 2.3 What was not done

- The application was not successfully built or run in this environment, so this report does not claim a live frame-by-frame visual comparison. Dependency installation stopped on audit-environment cache/tarball errors; that failure was not treated as evidence that the project itself is unbuildable. Source, generated assets, existing screenshots, and static media were reviewed.
- No musicologist review, melody recognition, audio fingerprinting, or acoustic comparison was performed.
- No Copyright Office deposit copies were obtained and compared to the build.
- No consumer survey, actual-confusion study, market survey, or expert trade-dress study was performed.
- No privileged communications, contracts, source licenses, Steam store drafts, trailers, capsules, unpublished art, or final `build/icon.ico` were available.
- No exhaustive trademark clearance was performed in every territory. The analysis is U.S.-focused, with international launch cautions.
- No conclusion is offered on patent, contract, publicity, privacy, export, consumer-protection, or platform-policy compliance except where incidentally relevant.

---

## 3. Risk-rating method

Ratings combine practical likelihood and impact; they are not numerical probabilities.

| Rating | Meaning in this report |
|---|---|
| **Low** | A defensible position with limited current enforcement indicators, though not zero risk |
| **Medium** | A material issue that warrants remediation or counsel review before launch |
| **Medium–High** | Several meaningful risk factors accumulate, or a cheap fix is available for a potentially costly dispute |
| **High** | Close alignment with asserted/protected matter, direct brand use, or a clear release-compliance defect |
| **Unverified** | Static evidence is insufficient; the absence of a detected issue is not clearance |

Where helpful, each section distinguishes:

- **Repository fact** — directly observed in the reviewed commit;
- **External fact** — reflected in a cited statute, record, case, or notice; and
- **Risk inference** — this report's application of those facts, which counsel may assess differently.

---

## 4. Governing U.S. legal framework

### 4.1 Copyright: rules are not protected; audiovisual expression can be

**External law.** [17 U.S.C. §102(b)](https://uscode.house.gov/view.xhtml?edition=prelim&num=0&req=granuleid%3AUSC-prelim-title17-section102) excludes ideas, procedures, processes, systems, methods of operation, concepts, principles, and discoveries from copyright protection. The U.S. Copyright Office similarly states that a game's idea, title, and methods of play are not protected, although copyright can protect original text, artwork, music, and audiovisual expression. See the [Copyright Office game-registration page](https://www.copyright.gov/register/tx-games.html) and [Circular 33](https://www.copyright.gov/circs/circ33.pdf). The foundational system/expression distinction appears in [*Baker v. Selden*, 101 U.S. 99 (1879)](https://tile.loc.gov/storage-services/service/ll/usrep/usrep101/usrep101099/usrep101099.pdf).

For a falling-block game, the abstract rules—pieces falling, player movement and rotation, completed rows disappearing, scoring, increasing speed, and top-out—are therefore not owned merely because Tetris used them first. The source code implementing those rules can still be copyrighted as code, and the resulting graphics, animations, sounds, selection, arrangement, and sequence may be protected as an audiovisual work.

**Fair-use caution.** A commercial or free entertainment substitute serving the same purpose is not placed in a safe harbor merely because it uses independently written code or is distributed as open source. Fair use under [17 U.S.C. §107](https://uscode.house.gov/view.xhtml?edition=prelim&num=0&req=granuleid%3AUSC-prelim-title17-section107) is fact-specific and is not a sound primary launch strategy here.

### 4.2 The central case: *Tetris Holding v. Xio*

The closest reported U.S. decision is [*Tetris Holding, LLC v. Xio Interactive, Inc.*, 863 F. Supp. 2d 394 (D.N.J. 2012)](https://law.justia.com/cases/federal/district-courts/new-jersey/njdce/3%3A2009cv06115/235418/61/); an [official GovInfo package](https://www.govinfo.gov/app/details/USCOURTS-njd-3_09-cv-06115/USCOURTS-njd-3_09-cv-06115-0) is also available.

The court granted Tetris Holding summary judgment on federal copyright and trade-dress claims. Its analysis is highly relevant but must be kept in context:

- It is a published federal **district-court** opinion, not a Third Circuit appellate holding and not formally binding on other courts.
- Xio admitted purposeful copying, downloaded and used the official iPhone game during development, sought a license, and conceded that the products looked alike.
- The court found the games so visually close that an ordinary user could not tell them apart without being told which was which.
- The opinion repeatedly described **wholesale copying** and an overwhelming overall similarity.
- The court expressly said discrete elements standing alone might not establish infringement; their combination and context mattered.

#### What *Xio* treated as abstract rules

The court described the unprotected idea at an abstract level: differently shaped square-block pieces fall from the top and accumulate; the user moves and rotates them; full horizontal lines erase and score; and reaching the top ends the game. That is the safe doctrinal foundation for implementing a falling-block game.

#### What *Xio* treated as expressive on its record

In the context of near-identical games, the court relied on:

- the style, design, and movement of the pieces;
- similar bright colors;
- separately delineated component squares, interior borders, texture, shading, and gradation;
- use of the same seven pieces;
- the exact 20×10 field;
- garbage lines;
- ghost/shadow presentation;
- next-piece presentation;
- lock-down color change; and
- squares automatically filling the board at game over.

The court did **not** establish that every one of Tetris Holding's 14 pleaded features is an independent monopoly, nor that any game containing one of them infringes. Its decisive statement was that the wholesale look, not each item in isolation, was troubling.

### 4.3 Trademark: TETRIS and related source identifiers

Trademark law targets likely confusion over source, sponsorship, affiliation, or approval; dilution can separately protect a qualifying famous mark. See [15 U.S.C. §1125](https://uscode.house.gov/view.xhtml?edition=prelim&num=0&req=granuleid%3AUSC-prelim-title15-section1125) and the [USPTO's likelihood-of-confusion guidance](https://www.uspto.gov/trademarks/search/likelihood-confusion).

An official [USPTO TTABVUE record](https://ttabvue.uspto.gov/ttabvue/v?pno=91249666&pty=OPP), current when reviewed on 2026-07-15, lists numerous pleaded TETRIS registrations as registered and renewed, including Registration Nos. 2,362,238; 3,396,574; 1,657,499; 4,592,832; 4,592,985; 4,845,377; 3,518,292; and 4,313,472. The record is not a complete clearance search, but it is strong official evidence of a live portfolio in directly relevant game categories.

The product name **Serenity Blocks** is facially distinct from TETRIS. The greatest word-mark risks instead come from using `Tetris` as a title, badge, keyword, tag, SEO term, comparative hook, or unnecessary in-game vocabulary.

#### Nominative reference is not a blanket license

In the Third Circuit, [*Century 21 Real Estate Corp. v. LendingTree, Inc.*, 425 F.3d 211 (3d Cir. 2005)](https://www2.ca3.uscourts.gov/opinarch/034700p.pdf), places the initial likely-confusion burden on the mark owner and then asks the user to show that use of the mark is necessary to describe both parties' products, uses no more of the mark than needed, and accurately reflects the relationship.

**Risk inference.** `Falling-block puzzle game` describes Serenity Blocks without using TETRIS. Repeated public uses are therefore harder to justify as necessary. A single plain-text legal notice or genuine comparison may be defensible after counsel review; a disclaimer helps but is not dispositive and cannot cure copyright or trade-dress similarity.

Use the generic mathematical spelling `tetromino`. No proprietary-looking `Tetrimino` spelling was found in the repository.

### 4.4 Trade dress: narrower than “owning the look”

Unregistered trade dress requires a claimant to define the asserted dress and prove nonfunctionality, distinctiveness, and likely confusion. Product-design dress cannot be inherently distinctive and needs secondary meaning. See [*Wal-Mart Stores, Inc. v. Samara Brothers, Inc.*, 529 U.S. 205 (2000)](https://supreme.justia.com/cases/federal/us/529/205/) and [*TrafFix Devices, Inc. v. Marketing Displays, Inc.*, 532 U.S. 23 (2001)](https://supreme.justia.com/cases/federal/us/532/23/).

In *Xio*, the asserted dress was brightly colored four-block, individually delineated pieces plus a tall rectangular field as used in advertising and packaging. The opinion states that Xio apparently did not challenge secondary meaning or likelihood of confusion; the contested trade-dress analysis focused on functionality. The judgment therefore is not a fully litigated holding on all trade-dress elements. The court found the styling and field choices nonfunctional on that record and granted summary judgment.

Under [*Dastar Corp. v. Twentieth Century Fox Film Corp.*, 539 U.S. 23 (2003)](https://tile.loc.gov/storage-services/service/ll/usrep/usrep539/usrep539023/usrep539023.pdf), §43(a) cannot be used merely to police authorship or create perpetual copyright-like control. *Xio* distinguished *Dastar* because the trade-dress claim targeted source confusion in advertising and packaging.

**Risk inference.** *Xio* is strongest against near-identical storefront screenshots, icons, packaging, and promotional arrangements. It is weaker as proof that every tall board or every four-square shape, in isolation, is protected trade dress. Serenity Blocks' startup ident, menu icon, theme selection, and store images deserve more attention than internal mechanics because they are used to identify and sell the product.

### 4.5 Design and sound marks

Public USPTO-derived records identify registered T-shaped composite TETRIS logos, including [Registration No. 2,362,250](https://trademarks.justia.com/757/82/tetris-75782993.html) and [Registration No. 3,818,232](https://trademarks.justia.com/778/90/tetris-77890492.html). These are particular composites, not ownership of every T tetromino. A T-piece used as a competing game's menu or logo is nevertheless avoidable association risk.

A [public registration record](https://www.trademarkia.com/tetris-90670731) also reports Registration No. 6,704,948 / Serial No. 90670731, registered April 19, 2022, for a particular composite depicting a tall bordered field, multicolored TETRIS lettering, and colored four-square shapes. It does not register every tall field or tetromino in isolation. Recheck the [official TSDR record](https://tsdr.uspto.gov/#caseNumber=90670731&caseSearchType=US_APPLICATION&caseType=DEFAULT&searchType=statusSearch) immediately before launch.

A [public USPTO-derived record for U.S. Registration No. 3,517,007 / Serial No. 77037539](https://trademarks.justia.com/770/37/n-77037539.html), whose displayed status date is November 5, 2018, reports a registered-and-renewed sound mark for an electronic sine wave performing a specified tune based on the Russian folk song *Korobeiniki*, covering computer/video game software, handheld games, and online games. Recheck the [official TSDR record](https://tsdr.uspto.gov/#caseNumber=77037539&caseSearchType=US_APPLICATION&caseType=DEFAULT&searchType=statusSearch) before launch. The underlying folk melody's age does not eliminate same-market source-identification risk or possible rights in a particular recording/arrangement.

### 4.6 Enforcement and remedies

The [2023 GitHub Apotris notice](https://github.com/github/dmca/blob/master/2023/02/2023-02-10-tetris.md) alleged copying of piece movement, bright colors, field dimensions, ghost, and next display. A [2021 GitHub notice](https://github.com/github/dmca/blob/master/2021/07/2021-07-16-tetris.md) targeted a repository using the Tetris name and alleged copyright and trade-dress copying. The [2023 itch.io Setris notice](https://itch.io/takedowns/2073998) alleged word-mark, audiovisual, and Korobeiniki sound-mark infringement. These are claimant allegations, not adjudications, but they demonstrate practical takedown risk.

The notices' descriptions of *Xio* are claimant advocacy, not neutral holdings. For example, the Apotris notice paraphrases the protected field dimension as merely “longer than it is wide,” whereas the opinion's copyright analysis focused on the exact 20×10 field and the wholesale combination. The notices establish enforcement examples, not the probability that Serenity Blocks will be targeted.

The Setris notice contains apparent registration-number errors; this report does not rely on those numbers for status. Official USPTO records should control clearance work.

Copyright remedies can include actual damages/profits or statutory damages of $750–$30,000 per work, with up to $150,000 for willful infringement and possible reduction for qualifying innocent infringement. See [17 U.S.C. §504](https://uscode.house.gov/view.xhtml?edition=prelim&num=0&req=granuleid%3AUSC-prelim-title17-section504); eligibility and timing limitations appear in [§412](https://uscode.house.gov/view.xhtml?edition=prelim&num=0&req=granuleid%3AUSC-prelim-title17-section412). Trademark remedies can include injunctions, damages/profits/costs, and destruction of infringing articles under [15 U.S.C. §§1116](https://uscode.house.gov/view.xhtml?edition=prelim&num=0&req=granuleid%3AUSC-prelim-title15-section1116), [1117](https://uscode.house.gov/view.xhtml?edition=prelim&num=0&req=granuleid%3AUSC-prelim-title15-section1117), and [1118](https://uscode.house.gov/view.xhtml?edition=prelim&num=0&req=granuleid%3AUSC-prelim-title15-section1118).

Platform removal may occur before a merits decision. A copyright counter-notice under [17 U.S.C. §512](https://uscode.house.gov/view.xhtml?edition=prelim&num=0&req=granuleid%3AUSC-prelim-title17-section512) carries identity, jurisdiction, and timing consequences; trademark/platform complaints may not offer the same statutory process.

---

## 5. Current repository findings — product name and word marks

### Finding TM-1 — Core product naming is clean and distinctive

**Repository fact.** The product is consistently identified as `Serenity Blocks`:

- `package.json:2-4, 41-44` — generic falling-block description, `com.serenityblocks.game`, and `Serenity Blocks` product name;
- `package.json:113-120` — generic keywords with no `Tetris` keyword;
- `index.html:7, 1401` — `Serenity Blocks` title/wordmark;
- `README.md:1-3` and `game_description.md` — generic falling-block language; and
- `README.md:58-63` — non-affiliation notice and a plain-text TETRIS registration acknowledgment.

**Risk inference.** The name alone presents **Low** TETRIS word-mark confusion risk. It should be retained, subject to an ordinary full trademark clearance for `SERENITY BLOCKS` against all third parties.

### Finding TM-2 — Two player-visible Odyssey tips still use TETRIS

**Repository fact.** Two live level tips remain:

- `src/core/odyssey/data/levels.js:3846` — `Focus on efficient Tetris clears...`
- `src/core/odyssey/data/levels.js:4373` — `...where your Tetris lane will live.`

`src/core/game-modes/OdysseyMode.js:3866-3883` injects `level.metadata.tip` into the selected-level panel, so these are not merely comments or dead identifiers.

**Risk inference.** These two phrases do not appear to use TETRIS as Serenity Blocks' source identifier and, standing alone, present **Low** infringement risk. They are unnecessary in a directly competing game and trivially replaceable, so removal remains prudent hygiene.

**Recommended text:**

- `efficient four-line clears` or `efficient quad clears`; and
- `four-line well`, `quad lane`, or `open scoring lane`.

### Finding TM-3 — A production-bundled playground metadata field uses the mark

**Repository fact.** `src/playground/effects/starlight-reactions.effect.js:26-30` publishes metadata reading `Scripted locks/clears/Tetris/combo/apex...`. The file also contains several Tetris references in comments. `vite.config.js:60-65` includes `playground.html` as a production entry, and `.github/workflows/pages.yml:63-89` builds and deploys `dist` to GitHub Pages.

`src/playground/main.js:506-511` exposes the metadata programmatically through `window.__PLAYGROUND__.listEffects()`, but the current HUD renders only each effect's title, not its description (`src/playground/main.js:401-415`). It is therefore public bundle/API metadata, not visible page copy.

**Risk inference.** Rating: **Low**. Replace the description with `four-line clear` or `quad` and clean the public URL examples/comments as ordinary hygiene.

### Finding TM-4 — Repository/design-history references are extensive but mostly not direct mark use

**Repository fact.** The scan found 637 standalone `Tetris`/`Tetrises` tokens in 172 files. Examples include:

- `docs/ODYSSEY_AAA_MASTER_PLAN.md:3` — the stated “one ambition” is *Tetris Effect: Connected — Journey Mode*;
- `:38, 223-225, 298-303` — named “synesthetic coupling,” “north star,” and technique adoption;
- `src/rendering/draw.js:380-506` and `src/rendering/phaser/board-juice.js:1-9` — effects described as Tetris Effect-inspired/signature;
- `src/ui/multi-player-canvas-layout.js:1-19` — layout described as inspired by Tetris 99/Jstris;
- tests describing SRS tables as Guideline-exact and citing Tetris community sources; and
- internal metric keys such as `tetris-count`, `tetrises`, and `isTetris` that are not rendered under current formatters.

**Risk inference.** No standalone infringement rating is assigned to comments, internal identifiers, or design research. These materials may contextualize intent if protectable expressive similarities are first shown, but access to the famous Tetris game is unlikely to be disputed and intent does not substitute for substantial similarity or likely confusion. Public indexing and future accidental publication remain practical hygiene concerns.

Do not rewrite Git history or destroy records. Preserve the existing history under counsel guidance, but write future design requirements in independent functional/visual terms and neutralize current public-facing prose where cheap. Renaming internal identifiers is P2 hygiene, not a prerequisite to ship.

### Finding TM-5 — The disclaimer helps but is limited

**Repository fact.** `README.md:58-63` and `CREDITS.md:100-105` state that Serenity Blocks is independent and not affiliated with, endorsed by, or sponsored by The Tetris Company or Tetris Holding. Neither file is included by the current Electron packaging list, and no in-app Legal/Credits screen was found.

**Risk inference.** The notice is useful on the public repository and is evidence of the true relationship, but it currently provides little direct notice to packaged-app users. Even if shipped, a disclaimer would not authorize use of a mark, cure a substantially similar audiovisual work, cure confusing trade dress, or neutralize the branding cluster. Rating: **Low/mitigating in the repository; not yet an in-product mitigation**.

---

## 6. Current repository findings — audiovisual copyright and trade dress

### Finding AV-1 — Exact seven-piece family and 10×20 visible field remain

**Repository fact.** `src/core/constants.js:11-13` defines `COLS = 10`, `ROWS = 20`, and four hidden rows. `src/core/constants.js:62-98` defines the conventional I/O/T/S/Z/J/L matrices, and `:103` defines the seven keys. Spawn orientation/placement appears in `src/core/game.js:356-380`.

**Legal context.** *Xio* treated the exact 20×10 field and the style/design of the same seven pieces as part of the protected audiovisual cluster on its record, while recognizing the abstract falling-block rules as unprotected.

**Risk inference.** The exact dimensions plus complete seven-piece family are a **Medium contextual factor**, not automatic infringement. Risk falls if the remainder of the presentation is strongly distinct and rises if a screenshot also uses familiar colors, preview/ghost treatment, delineated squares, and conventional framing.

### Finding AV-2 — Rendering materially diverges through fused, borderless silhouettes

**Repository fact.** The primary Phaser renderer has unusually strong distinctions:

- `src/rendering/phaser/base-board-scene.js:702-714` intentionally removes locked-piece outlines and states that pieces render as fused shapes with no internal borders;
- `:800-811` uses a fully transparent board with no background/grid fill;
- `:844-869` overlaps cell rectangles and applies a continuous light ramp so adjoining same-color cells have no seam;
- `:872-919` draws only the outer perimeter of a fused same-color region;
- `:1029-1053` renders the ghost as a single translucent white silhouette with one faint cyan contour; and
- `:1056-1069, 1165-1169, 1458-1476` renders the active piece as one continuous gradient/gloss/outer-rim silhouette.

**Fallback caveat.** The legacy canvas path draws a full vertical/horizontal grid (`src/rendering/canvas-utils.js:33-64`), and `SinglePlayerMode` invokes that renderer whenever no board scene is available (`src/core/game-modes/SinglePlayerMode.js:306-313, 906-913`). That fallback needs separate visual clearance or remediation; it does not share the primary renderer's gridless-field distinction.

**Risk inference.** The primary path is one of Serenity Blocks' most important defenses. It directly departs from the separately delineated, internally bordered, textured, and shaded component bricks emphasized in *Xio*. Rating: **material mitigation when that path is used**. The fallback prevents treating the distinction as universal; preserve or implement it consistently in every renderer, preview, icon, screenshot, and fallback path.

### Finding AV-3 — Ghost, three-piece next queue, garbage, and conventional motion remain

**Repository fact.** The product retains:

- a ghost landing calculation at `src/core/game.js:522-545`;
- a three-slot next queue at `src/ui/next-queue-ui.js:226-256` and `index.html:565-579`;
- gravity, horizontal movement, hard/soft drop, line clearing, and top-out;
- garbage rows and multiplayer attack systems; and
- SRS-style 90° kick tables at `src/core/game.js:140-160, 963-989`.

The expression differs:

- the ghost is a fused translucent contour rather than a grid of delineated blocks;
- the queue shows three previews, with the first highlighted;
- garbage uses custom gray/matte and footprint/multi-hole behavior in `src/core/garbage.js:24-48, 640-699`; and
- the project adds a 180° rotation path and legacy kick fallback.

No functional gameplay hold state, binding, or hold panel was found.

**Risk inference.** Presence of ghost/next/garbage adds to the *Xio* cluster, but the treatments and overall interface are meaningfully different. Rating: **Medium aggregate contribution; Low–Medium individually**.

### Finding AV-4 — No lock recolor and no bottom-to-top game-over fill

**Repository fact.** Active-piece color is resolved at creation (`src/core/game.js:36-57, 356-380`), but lock-down re-resolves the then-current theme color rather than copying `lockedPiece.color` (`src/core/game.js:1213-1220`). Absent an intervening theme/settings change, the role color is the same; no deliberate lock-down recolor effect was found.

Top-out stops play and displays a statistics modal or other custom elimination effects (`src/core/game.js:809-851`; `src/core/game-modes/SinglePlayerMode.js:1310-1437`). The repository contains no Tetris-style routine that automatically fills the board with squares from bottom to top on game over. Multiplayer elimination uses custom flash/fade/skull/`ELIMINATED` presentation rather than the *Xio* feature (`src/core/game-modes/LocalMultiplayerMode.js:3875-3976`).

**Risk inference.** These are **strong mitigating differences** because *Xio* specifically identified lock color change and bottom-to-top fill as expressive choices.

### Finding AV-5 — Cascade physics, progression, and modes are substantial gameplay differences

**Repository fact.** After a line clear, locked material is split into connected components and independently falls, potentially causing recursive cascades (`src/core/physics.js:789-804`; connectivity logic in `src/core/board.js:312-365`). Other differences include:

- custom scoring of 250/500/1000/2000 plus cascade/perfect-clear/level modifiers (`src/core/constants.js:109-125`; `src/core/scoring.js`);
- a custom speed curve and 15-line level progression;
- Infinity mode with a possible 1,000-row vertical board (`src/core/game.js:551-567`);
- Odyssey objectives/modifiers and themed world progression; and
- Serenity mode's calm/breathwork/music focus.

**Risk inference.** These changes meaningfully distinguish the play experience and event sequence. They do not alone erase a similar static screenshot or startup ident, because copyright/trade dress can focus on presentation. Rating: **material mitigation**.

### Finding AV-6 — Startup branding draws from the complete conventional seven-type repertoire

**Repository fact.** The default intro draws decorative pieces from a repertoire containing all seven conventional types; randomized spawning does not guarantee that all seven appear simultaneously:

- `src/ui/threejs-intro-renderer-webgpu.js:49` defines all seven keys;
- `:195-203` assigns the deliberately scrambled default colors;
- `:849-900` creates extruded, beveled, glossy/emissive meshes;
- `:1080-1109` seeds them around the visible frame and keeps the title readable;
- `:1123-1156` draws the exact seven fused contours;
- `src/ui/intro-tetromino-compute.js:41-59` supports up to 50 drifting pieces; and
- the WebGL fallback defines all seven keys and constructs the same fused contours (`src/ui/threejs-intro-renderer.js:87-107, 686-704, 939-1052`), then chooses among them randomly at spawn (`:849-855`).

**Risk inference.** This is more concerning than unavoidable in-game geometry because it is decorative, highly visible, and used beside the wordmark before gameplay. The cosmic glass/extruded treatment and scrambled colors are meaningful differences, but branding drawn from the complete seven-type repertoire has abundant alternatives. Rating: **Provisional Medium**; a rendered capture is required before assigning Medium–High.

**Recommendation.** Replace the startup shapes with a distinct visual grammar—petals, waves, stones, constellations, irregular polyforms, pentominoes, shards, or a cascade motif that does not use the complete conventional seven-type repertoire as brand language.

### Finding AV-7 — Main-menu T-piece icon is avoidable branding

**Repository fact.** `index.html:1404-1410` uses four equal rounded squares in an exact T shape for the Single Player card. `public/styles/menu-aaa.css:347-387` calls the components tetromino blocks and animates their assembly.

**Risk inference.** A single T shape is weak in isolation and is materially different from the registered composite TETRIS logos. Used prominently in a competing falling-block game's main menu, it adds avoidable association to the overall branding cluster. Rating: **Low–Medium**; logo placement and the surrounding cluster justify removal, not a conclusion of likely infringement.

**Recommendation.** Use a lotus, breath ring, orbit, wave, path, or non-four-unit play glyph.

### Finding AV-8 — Favicon art is lower risk; its comment is adverse hygiene

**Repository fact.** `public/favicon.svg:1-21`, used by `index.html:82`, shows a cyan-purple circular gradient with seven white rounded squares in a non-tetromino mosaic. Its source comment says `Tetris-like blocks`.

**Risk inference.** The art itself is not one of the seven tetrominoes and is visually distinctive, so direct risk is **Low**. The comment is unnecessary evidence of intended association. Replace the favicon with a distinctive Serenity mark and remove competitor-referential drafting going forward.

### Finding AV-9 — Theme and icon art is otherwise strongly differentiated

**Repository fact.** Manual review of 60 theme icons found scenic/circular imagery—planets, forests, lakes, caves, auroras, bowls, and other environments—rather than TETRIS wording, an official-looking matrix logo, or a complete conventional seven-piece array. The inspected theme screenshots show distinctive environments but do not include the current game board.

**Risk inference.** Theme/world art is a strong source of original expression and receives a **Low** Tetris-specific risk rating. It cannot by itself clear the total gameplay view, which is why current board screenshots are required.

---

## 7. *Xio* feature-to-repository matrix

This matrix is deliberately granular, but the legal comparison must return to the total concept and feel. “Present” does not mean “infringing,” and “different” does not guarantee clearance.

The starting-orientation, full-line disappearance/consolidation, and multiplayer-layout rows were among Tetris Holding's pleaded features; the court expressly did not need to decide every pleaded feature separately.

| *Xio*-associated feature | Serenity Blocks evidence | Current comparison | Risk effect |
|---|---|---|---|
| Seven standard four-square pieces | `src/core/constants.js:62-103` | **Present:** exact I/O/T/S/Z/J/L family | Raises aggregate risk |
| Bright distinct piece colors | Default at `constants.js:31-40`; theme files | **Mixed:** default is scrambled; numerous selectable themes track familiar hue roles | Raises selected-theme/store-image risk |
| Individually delineated component squares | `base-board-scene.js:702-714, 844-919, 1165-1169` | **Absent in main renderer:** fused/no seams/internal borders | Strong mitigation |
| Exact 10×20 field | `constants.js:11-13` | **Present:** plus four hidden rows | Raises aggregate risk |
| Fall from top and lateral movement | `game.js` spawn/movement/gravity | **Present:** rules-level core | Low alone; aggregate factor |
| Rotation appearance/behavior | `game.js:140-160, 917-989` | **Visible rotation is present; Guideline-value 90° kick-table data is functional rule data not adjudicated as protected in *Xio***; 180° and legacy fallback also exist | Mechanics low alone; motion expression matters in video |
| Next-piece display | `next-queue-ui.js:226-256` | **Present but three previews**, fused styling | Moderate aggregate factor |
| Conventional starting orientations | `constants.js:62-98`; spawn state `game.js:356-380` | **Mixed:** I/O/S/Z match common spawn silhouettes; T/J/L are stored in 180°-flipped silhouettes as rotation state 0 | Contextual aggregate factor |
| Ghost/shadow piece | `game.js:522-545`; renderer `:1029-1053` | **Present but fused white translucent contour** | Moderate aggregate factor, treatment mitigates |
| Lock-down color change | `game.js:356-380, 1213-1220` | **Absent** | Strong mitigation |
| Full-row disappearance/consolidation | `physics.js:738-804` | **Present, then custom connected-component gravity/cascades** | Functional core plus materially distinct aftermath |
| Bottom-to-top square fill at game over | game-over/elimination paths | **Absent** | Strong mitigation |
| Garbage lines | `garbage.js:24-48, 640-699` | **Present, custom multi-hole/footprint behavior and matte styling** | Moderate factor, custom treatment mitigates |
| Prominent player field plus smaller opponent fields | `multi-player-canvas-layout.js` and multiplayer UI | **Partly present; custom implementation**, docs name Tetris 99/Jstris inspiration | Contextual storefront factor; not separately held protectable in *Xio* |
| Packaging/ads use similar field and pieces | intro/menu and future store assets | **Current startup and T icon use tetrominoes as branding; final store set unavailable** | Principal trade-dress review target |

### Matrix conclusion

Serenity Blocks retains enough of the *Xio* cluster that a simple “mechanics are free” conclusion would be unsafe. It also removes or transforms several of the most visually specific features. The current static record supports a **provisional Medium aggregate rating**. It could rise to Medium–High if representative gameplay or store captures reproduce the overall visual impression of a plausibly asserted Tetris work or current source-identifying presentation.

---

## 8. Theme-palette audit

### 8.1 Method and caveat

All 59 `src/themes/*/*-tetrominos.js` configurations were parsed. For a reproducible screening heuristic, the first six-digit I/O/T/S/Z/J/L color in each config was converted to HSL and compared to broad familiar hue-role bands:

| Piece | Screening band |
|---|---|
| I | cyan / blue-cyan, 160°–210° |
| O | yellow / gold, 32°–75° |
| T | purple / magenta, 245°–315° |
| S | green / mint, 90°–170° |
| Z | red / pink, 320°–360° or 0°–20° |
| J | blue / indigo, 200°–250° |
| L | orange / amber, 20°–50° |

This is a **conservative engineering screen, not a legal standard**. It ignores saturation, lightness, material, animation, context, and exact color values. Some pale gold, pink, mint, or indigo colors may look materially different in play. The *Xio* opinion discussed similar bright colors and an overall presentation; it did not judicially establish these hue bands or hold that every modern color-role assignment infringes.

Theme-based pieces are enabled by default (`src/ui/settings.js:44-45`). Runtime code obtains the active theme's config when available (`src/rendering/tetromino-style-manager.js:213-250`; `src/core/game.js:36-57`), and active/locked pieces use those resolved colors (`src/core/game.js:356-380, 1213-1220`). Thus selectable palettes are not dead configuration.

Three legacy files—`aether-tides-tetrominos.js`, `luminous-tides-tetrominos.js`, and `stellar-velocity-tetrominos.js`—store colors as top-level `I: { color: ... }` objects rather than under `config.colors`. The main-board resolvers read only `config.colors?.[shapeKey]` (`src/core/game.js:36-57`; `src/rendering/tetromino-style-manager.js:242-250`), so those three main-board palettes currently fall back to the scrambled defaults unless separately normalized. This is a runtime-accuracy point, not a recommendation to activate their configured mappings without screening them.

### 8.2 Ten active/selectable configurations screen 7-of-7

| Theme | I | O | T | S | Z | J | L |
|---|---|---|---|---|---|---|---|
| Astral Weave | `#7deeff` | `#ffd86e` | `#ee79ff` | `#6cf9d5` | `#ff7ccf` | `#6ca8ff` | `#ffab63` |
| Cosmic Chimes | `#8fffff` | `#ffd666` | `#c9a8ff` | `#6fffc4` | `#ff8fc8` | `#6b7fff` | `#ffcc6b` |
| Crystal Cave | `#70f0ff` | `#ffc860` | `#c080ff` | `#50ffc0` | `#ff60c0` | `#6080ff` | `#ffa060` |
| Electric Dreams | `#62f6ff` | `#ffb347` | `#ff66f0` | `#94ffb3` | `#ff5c7c` | `#8a8dff` | `#ffe066` |
| Misty Lake | `#b1e5ff` | `#ffd59a` | `#cfc2ff` | `#9efad2` | `#ffa9c4` | `#7a92d5` | `#ffe388` |
| Moonrise Summit | `#bfe9ff` | `#ffe7b3` | `#c9b2ff` | `#d3fff1` | `#ffb0c9` | `#8aa4d5` | `#ffd089` |
| Shifting Sands | `#7ec8ff` | `#ffd06a` | `#c9a0ff` | `#7fffb8` | `#ff9070` | `#8090ff` | `#ffb855` |
| Singing Bowl | `#b5fff2` | `#fdda9b` | `#e5b6ff` | `#a9ffd0` | `#ff9fbf` | `#8d99ff` | `#ffe8aa` |
| Swedish Forest | `#9be8ff` | `#ffd27a` | `#c7b5ff` | `#7ff4c9` | `#ff9fc0` | `#6479d8` | `#ffe8a6` |
| Tornado | `#87CEEB` | `#FFD700` | `#E6A8D7` | `#98FB98` | `#FFB7C5` | `#9DC8E8` | `#FFCC5C` |

Evidence resides in each theme's same-named `*-tetrominos.js` file, generally within its first 10–21 lines. All ten themes are in `src/themes/theme-registry.js` and their theme classes import/use the configuration.

### 8.3 Six active configurations screen 6-of-7 or near-full

| Theme | Screening result | Main divergence |
|---|---:|---|
| Galaxy | 6/7 by strict cutoff; visually near-full | L hue is approximately 19.6°, just outside the 20° cutoff |
| Geode | 6/7 | J is pink, not blue |
| Himalayan Peak | 6/7 | O is snow white / pale blue rather than yellow |
| Koi Pond | 6/7 | T is blossom pink rather than purple |
| Lunara | 6/7 under strict bands; visually near-full | O is amber near the lower cutoff |
| Moonlit Greenhouse | 6/7 | I is mint rather than cyan |

`src/themes/rainy-window/rainy-window-tetrominos.js` also screens 7/7, but `rainy-window-theme.js` neither imports `RAINY_WINDOW_TETROMINOS` nor overrides `getTetrominoConfig()`. The inherited method returns `null` (`src/themes/base-theme.js:781-798`), causing the runtime fallback (`src/rendering/tetromino-style-manager.js:220-232`; `src/core/game.js:48-57`). Treat it as dormant risk: either wire it only after derangement or remove it.

### 8.4 Palette conclusion

**Repository fact.** The first-run fallback is deliberately scrambled: I green, O orange, T blue, S cyan, Z red, J yellow, L purple (`src/core/constants.js:31-40`). But the prior proposition that the palette issue was resolved across the product is not supported by the current theme set.

**Risk inference.** The hue-role screen identifies contextual similarity worth human review, but the broad and partly overlapping ranges—and the omission of saturation, lightness, material, motion, layout, and adjacent colors—cannot independently support a Medium–High legal rating. Treat a 7/7 result as a **potential Medium contextual factor only when the rendered screen is otherwise close**; treat a 6/7 result as **Low–Medium**. No palette is declared infringing, and the *Xio* opinion did not establish these bands or a monopoly over a seven-role color mapping.

**Recommendation.** As a conservative product-separation measure—not a conclusion that the role mapping itself is protected or infringing—derange at least two, preferably three, role assignments in every active theme that screens 7/7 or near-full. Do not merely change hex values while retaining the same semantic order. Add a CI release gate that:

1. enumerates every selectable theme;
2. obtains the actual runtime config rather than filenames alone;
3. converts colors to HSL/Lab;
4. fails on a full familiar role mapping and warns at 6/7;
5. exempts only a documented counsel-approved case; and
6. produces swatches for human review because color context cannot be reduced to hue alone.

---

## 9. Mechanics and code-implementation findings

### Finding CODE-1 — Modern Tetris-like mechanics are extensive

**Repository fact.** The code implements:

- a Fisher–Yates seven-bag queue (`src/core/game.js:778-800`);
- Guideline-value JLSTZ and I 90° kick tables, followed by a legacy fallback (`src/core/game.js:140-160, 963-989`);
- 500 ms lock delay and 15 reset limit (`src/core/constants.js:166-167`);
- hard/soft drop and ghost (`src/core/game.js:522-545, 1000-1162`);
- T-spin three-corner detection (`src/core/game.js:1263-1282`);
- back-to-back difficult-clear tracking (`src/core/physics.js:712-727`);
- conventional `T-SPIN`, `BACK-TO-BACK`, and `PERFECT CLEAR` banners (`src/rendering/phaser/shared-effects.js:931-981, 1353-1424`); and
- DAS/ARR-style controls and familiar keyboard/gamepad actions (`src/core/constants.js:225-226, 271-310`; `src/ui/controls.js:100-132, 339-350`).

Tests describe the kick-table values as Guideline-exact (`tests/unit/srs-kick-tables.test.js:21-41, 83-92`) and validate deterministic behavior of the active bag path (`tests/unit/ffa-demo-replay-determinism.test.js:74-82`). The full spawn/rotation behavior is not uniformly Guideline-exact because the stored state-0 geometry and legacy fallback differ.

### Legal assessment

These are mainly rules, methods, timing policies, and data needed to produce a functional result. In isolation they present **Low copyright risk** under §102(b). Their expressive animation and interface treatment remains relevant to the audiovisual comparison, and literal copying of another codebase would be a separate source-code issue.

**Recommended controls:**

- keep provenance showing independent implementation and test development;
- do not copy comments, code structure, art, sound, or proprietary documentation from official products;
- describe mechanics generically in public materials;
- retain the custom 180° rotation, cascade physics, scoring, modes, and UI differences; and
- avoid overclaiming that every feature is categorically free merely because it has a functional role.

---

## 10. Audio and sound-mark review

### Repository facts

- The music manifest and 36 MP3 filenames use original/generic theme names and contain no `Tetris`, `Korobeiniki`, or `Type A` reference.
- Gameplay sound effects are largely procedurally synthesized in `src/audio/sound-effects.js` and `src/audio/sound-manager.js`.
- `CREDITS.md:76-82` categorically says no track uses the *Korobeiniki* / “Tetris Type-A” melody.
- Static tags show at least `aether-tides.mp3` and `black-hole.mp3` were made with Suno and contain output metadata, which makes the broader “project-owned original” language a chain-of-title issue discussed in §13.
- Intro sounds `begin.ogg` and `warp.ogg` have no sufficient provenance record in the repository.

### Assessment

No textual or metadata evidence of the registered sound was found, but a static scan cannot hear a melody. Current Tetris-specific sound-mark rating: **Low, unverified**. A recognizable *Korobeiniki* passage would require immediate review, but recognition alone is not trademark liability. Risk depends on similarity to the registered mark as a whole, use in the game context, whether the sound functions as a source cue, and likely consumer confusion; on strongly source-identifying facts it could become High. Copyright in a particular recording or arrangement is a separate question.

### Required verification

1. Have a musically competent reviewer listen to every shipped track and cue.
2. Use chroma/melody fingerprinting only as a screening tool; have a qualified reviewer assess the mark as a whole, the specific recording/arrangement, placement, and source-identifying context.
3. Check intro, menu, line-clear, level-up, game-over, and promotional/trailer audio—not just background MP3s.
4. Preserve DAW sessions, stems, prompts, output IDs, generation dates, service terms, licenses, and human edits.
5. Replace the categorical no-Korobeiniki statement with a verified, documented conclusion after review.

---

## 11. Prioritized Tetris remediation plan

### P0 — before any public commercial/store submission

#### P0.1 Remove residual public mark uses

- Replace the two Odyssey tips at `levels.js:3846` and `:4373`.
- Replace the playground metadata at `starlight-reactions.effect.js:29` and public URL/comment examples.
- Add an automated production-string scan that distinguishes legal notices from UI, metadata, pages, and store-copy sources.
- Keep the product title, package description, keywords, URLs, executable name, and store tags free of TETRIS and `Tetrimino`.

**Acceptance test:** a production build and Pages artifact contain no case-insensitive standalone `Tetris` except a single, counsel-approved plain-text legal notice, if one is retained.

#### P0.2 Remove standard tetrominoes from product identity

- Replace the startup decoration drawn from the complete conventional seven-type repertoire.
- Replace the exact T-piece Single Player icon.
- Replace the favicon mosaic/comment with a distinctive Serenity glyph.
- Inspect and replace any matching installer, executable, splash, Steam capsule, library hero, trailer card, or social avatar.

**Acceptance test:** no product-identifying surface uses one conventional tetromino as a logo or draws its decorative identity from the complete conventional seven-type repertoire.

#### P0.3 Derange runtime palettes

This is a conservative product-separation measure, not a conclusion that the hue-role mapping itself is protected or infringing.

- Reassign colors in all ten 7/7 themes and the six near-full themes.
- Resolve or remove the dormant Rainy Window config.
- Add the runtime-aware CI palette gate described in §8.4.

**Acceptance test:** no selectable theme reproduces the complete familiar I/O/T/S/Z/J/L hue-role mapping; 6/7 cases require documented human review.

#### P0.4 Review the actual total look

Capture, for every shipping theme and mode:

- spawn and active fall;
- rotation/wall kick;
- ghost at rest;
- next queue;
- stack at low/mid/high height;
- single through four-line clears;
- cascades;
- garbage insertion;
- pause, game over, and elimination;
- multiplayer overview; and
- startup/menu/store capsule contexts.

For copyright, have counsel compare the build against the specific registered/deposited Tetris audiovisual works plausibly asserted; current products do not by themselves define the scope of older registrations. For trademark and trade dress, compare final store art and gameplay captures against current marketplace packaging, advertising, and source-identifying presentation. Use the *Xio* features only as a fact-specific analytical guide. Static code review cannot substitute for this.

#### P0.5 Complete sound review

Perform the listening/fingerprint work in §10 and correct the credits claim.

### P1 — coordinated design separation

These changes should be evaluated as a coordinated package; no single checkbox guarantees clearance.

1. **Preserve and enforce the strongest current differences:** fused seamless silhouettes, no internal cell grid, transparent field, noncanonical colors, three-preview layout, no hold, no lock recolor, no square-fill game-over animation, custom cascade gravity, unique stats, and atmospheric environments.
2. **Consider field differentiation:** a visibly different width/height/aspect, shaped boundary, split field, changing topology, or mode-specific dimensions. Because 10×20 was expressly discussed in *Xio*, changing it is one of the strongest available separation levers, but it should be balanced against gameplay goals.
3. **Consider a broader piece vocabulary:** additional polyforms, non-four-unit pieces, asymmetric custom forms, mode-specific sets, or a placement/elimination rule that changes the visual grammar. A complete departure from the conventional seven provides more separation than restyling alone.
4. **Differentiate entry and rotation expression:** distinctive spawn path, easing, deformation, trail, pivot visualization, landing behavior, and lock feedback rather than merely applying conventional motion under a new skin.
5. **Differentiate aid/UI expression:** reconsider ghost contour, preview placement/order, garbage visualization, opponent-board arrangement, labels, and board frame as a coherent Serenity interface.
6. **Differentiate clear/end sequences:** make cascade separation, breath/release, world reaction, and end-state presentation central and unmistakably project-specific.
7. **Market the differences:** screenshots and trailers should foreground cascade physics, breath/serenity modes, transparent fused shapes, worlds, and custom effects—not a conventional clean 10×20 stack with familiar colors.

### P2 — governance and evidentiary hygiene

- Establish a trademark/style guide requiring `tetromino`, never `Tetrimino`, and generic public copy.
- Stop using named competitors as “north star,” “direct analogue,” “signature,” or “exact” requirements in new design documents.
- Preserve old history; do not rewrite or destroy records without counsel.
- Create an independent-design log explaining artistic reasons for major visual decisions and alternatives considered.
- Add a release checklist for product title, metadata, store tags, icons, screenshots, trailer audio, palette, dimensions, UI, and notices.
- Maintain a counsel-ready evidence packet: commit hash, build hash, screenshots, videos, source provenance, music review, asset notices, and final store copy.
- Re-run USPTO and launch-territory clearance immediately before release.

### Optional licensing route

If the business goal is to use TETRIS branding or retain presentation that counsel concludes is likely to reproduce protected expression or trade dress, seek a license. A license is not legally required merely to use unprotectable falling-block mechanics. The Tetris site provides a [contact page](https://tetris.com/contact-us); no assumption should be made that a license is available or economically suitable.

---

## 12. Verification checklist after remediation

### Trademark and branding

- [ ] `Serenity Blocks` remains the only game/product title.
- [ ] No TETRIS/Tetrimino keyword, tag, slug, badge, menu term, objective, tip, or source-identifying use exists.
- [ ] Any retained legal notice is plain text, accurate, proportionate, and counsel-approved.
- [ ] Startup, menu, favicon, executable, installer, Steam capsules, library art, trailer cards, and social avatars contain no conventional tetromino logo/full seven-piece ident.
- [ ] Final word-mark clearance is documented.

### Total audiovisual presentation

- [ ] Every runtime theme is captured with current board, ghost, queue, stack, clear, and end states.
- [ ] No selectable palette maps all seven pieces to familiar hue roles.
- [ ] Fused/no-seam rendering is consistent across active, locked, ghost, preview, multiplayer, fallback, screenshots, and icons.
- [ ] No lock-down recolor or bottom-to-top square-fill end state has been introduced.
- [ ] Custom cascade/Serenity expression is prominent in store media.
- [ ] Counsel has reviewed side-by-side stills and motion.

### Audio

- [ ] Every music and SFX asset has been listened to and fingerprinted for the registered tune.
- [ ] Intro, trailer, menu, and promotional audio are included.
- [ ] Results and reviewer are recorded.
- [ ] Provenance/terms/stems/edits are retained.

### Release response readiness

- [ ] Final build/store hashes and dated captures are archived.
- [ ] Copyright and trademark registrations/clearance were rechecked.
- [ ] A designated contact can respond promptly to a platform complaint.
- [ ] Counsel has a ready factual response packet and understands the commercial interruption plan.

---

## 13. Separate repository-wide copyright and licensing findings

These findings are **not evidence of Tetris infringement** and do not increase the Tetris-specific rating. They arose from the requested thorough copyright review and are material to release readiness.

### GEN-1 — SynthCity assets lack the required MIT notice — **High**

**Repository fact.** `public/textures/synthcity/` contains 109 files (~38 MB). Exact comparison with the public [`jeffbeene/synthcity`](https://github.com/jeffbeene/synthcity) repository found 79 common files byte-for-byte identical and no differing common files. A large subset is live-loaded by `src/themes/neon-district/neon-district-assets.js:14, 255-289`; all 109 files reside under `public/` and therefore are distribution inputs. Comments at `:4-5, 65-67` expressly reference replicating SynthCity. The five Quaz30/Deckard textures appear unreferenced by source code but remain distributable public assets.

The upstream MIT license is © 2024 Jeff Beene and requires preservation of its copyright and permission notice. No SynthCity notice exists in the tracked repository or configured Electron packaging inputs; no final packaged artifact was built or inspected. The Quaz textures' separate license and need should be verified.

**Remediation.** Bundle the complete upstream MIT text, title/source/version attribution, and any separately required notices; document every copied file; remove unused Quaz textures unless rights are established.

### GEN-2 — Live CC-BY Fox and unidentified landscape model — **High**

**Repository fact.** `src/themes/sakura-twilight/assets/Fox.glb` embeds a CC-BY 4.0 attribution including PixelMannen and additional source/author information. It is imported by `src/themes/sakura-twilight/sakura-twilight-theme.js:16-17` but is absent from `CREDITS.md`. The same theme imports `landscape-glb.glb`, for which sufficient source/license evidence was not found.

**Remediation.** Add the complete title, author(s), source, CC-BY 4.0 link, and modification statement to shipped notices. Quarantine the landscape model until ownership/license evidence is obtained.

### GEN-3 — Solar System Scope attribution is incomplete — **High**

`CREDITS.md:21` lists only `2k_saturn.jpg`, `2k_moon.jpg`, and `2k_mars.jpg` and assigns them to Stellar Drift, but current Stellar Drift instead loads unlisted `2k_jupiter.jpg` (`src/themes/stellar-drift/stellar-drift-theme.js:3091`). Chromadelic Highway loads Neptune, Venus atmosphere, Mars, Mercury, Saturn, Saturn ring alpha, and Uranus (`src/themes/chromadelic-highway/chromadelic-highway-theme.js:3021, 3130, 3191, 3244, 3296, 3313, 3369`). Lunara loads Moon, Mars, Saturn, and Saturn ring alpha (`src/themes/lunara/lunara-theme.js:922-923, 1033, 1042`). Moon is also loaded by Sakura Twilight (`src/themes/sakura-twilight/sakura-twilight-theme.js:1533`), Sunset (`src/themes/sunset/sunset-theme.js:719`), Wolfhour (`src/themes/wolfhour/wolfhour-theme.js:1911`), and the public playground effect `src/playground/effects/wolfhour-lunar-sigil.effect.js:117`. The [official Solar System Scope texture page](https://www.solarsystemscope.com/textures/) states the attribution basis.

**Remediation.** Inventory every derived file and runtime use, identify modifications/recoloring, and include complete CC-BY attribution in shipped notices.

### GEN-4 — Electron packaging configuration excludes the credits file — **High**

**Repository fact.** `CREDITS.md:3-6` calls itself the user-facing source of truth, but `package.json:50-53` packages only `dist/**/*`, `electron/**/*`, and `package.json`. `scripts/beforeBuild.cjs` and `scripts/afterPack.cjs` contain no path that copies `CREDITS.md`, and no in-app Legal/Credits reader was found. The configured build therefore excludes it, although a final installed artifact was not inspected. README likewise is absent from the configured file list.

**Remediation.** Generate `THIRD_PARTY_NOTICES` with required full license texts, copy it into application resources, expose an accessible in-app Legal/Credits screen, and verify it exists in the unpacked and installed artifacts.

### GEN-5 — Music ownership language conflicts with Suno provenance — **Medium–High**

`CREDITS.md:76-82` says all music is project-owned, uses no third-party/library material, and is nonderivative. At least `aether-tides.mp3` and `black-hole.mp3` contain `made with suno`, generation timestamps, and output IDs; archived prompt documents confirm a Suno workflow. All 36 MP3s also contain cover art with undocumented provenance.

AI generation does not itself establish infringement. The issues are contractual rights, generation-date plan/terms, input/output provenance, human-authorship/copyrightability, and overbroad ownership assertions.

**Remediation.** Correct the credits to match the facts; preserve subscription/payment evidence, terms snapshots, output IDs, prompts, stems, edits, and evidence of human contribution; document cover-art origin; obtain counsel's chain-of-title assessment.

### GEN-6 — Gemini TTS and intro-sound provenance are incomplete — **Medium**

`scripts/tts-script.json:1-6` and `scripts/generate-tts.js` identify Google AI Studio, `gemini-2.5-pro-preview-tts`, and the Algieba voice. There are 107 bundled WAVs, while the tracking document reports 95; CREDITS does not address them. `begin.ogg` and `warp.ogg` have no sufficient output/license record, despite a workflow document requiring retention.

**Remediation.** Reconcile the asset inventory and record service, model/voice, generation date, applicable terms, output IDs/seeds, prompts, authorization, and post-processing.

### GEN-7 — Generated 3D-model ownership claims need input provenance — **Medium**

`CREDITS.md:57-72` categorically calls numerous TRELLIS/TripoSR outputs project-owned. Several asset notes identify only a “single photo” or generation tool, not the source/license of the input image. A tool's open-source code license does not establish rights in the input or automatically establish human-authored copyright in the output.

**Remediation.** For every generated asset, document input source/license, generation service/model/terms/date, modifications, and human contribution. Avoid categorical ownership statements unsupported by records.

### GEN-8 — Root-license documentation is ambiguous — **Low–Medium**

`package.json:122` declares MIT, but no root `LICENSE` or `COPYING` file was found and the author field is blank. An owner's failure to include a standalone license file is not infringement of its own copyright; it creates ambiguity about who grants what rights to users and contributors.

**Remediation.** Confirm the copyright owner and intended scope, then add an accurate root license and contributor policy.

### GEN-9 — Required third-party notice coverage is incomplete — **Unverified; potentially High**

Confirmed omissions for SynthCity, the Fox model, and Solar System Scope materials appear in GEN-1 through GEN-4. Other distributed/vendored material also requires an obligation-by-obligation audit: for example, `public/vendor/webgpu-inspector.js` contains a minified vendor bundle, and `public/basics/basis/` contains Basis Universal transcoders plus a README that points to Apache-2.0. Lockfile metadata or an upstream README alone is not a complete shipped-code notice audit.

**Remediation.** Identify the exact source/version and license for every distributed third-party file, generate a complete notice bundle, preserve any required copyright/license/NOTICE text, and inspect the actual packaged source and binaries. The final rating depends on verified license obligations; an omission can be High when a license condition is clear and the file is distributed.

### General-release conclusion

The missing SynthCity/Fox/Solar System Scope notices and the exclusion of credits from the current packaging configuration are the clearest non-Tetris defects. They should be corrected before distribution even if every Tetris-specific recommendation is completed.

---

## 14. International and procedural caution

Copyright and trademark rights are territorial. A global Steam or web launch may trigger EU, UK, Canadian, Japanese, and other local regimes, including registered marks, passing off/unfair competition, and design rights that do not map perfectly onto U.S. doctrine.

At minimum, obtain launch-territory clearance for the United States, European Union, United Kingdom, and Canada. Do not describe this U.S.-focused report as a worldwide freedom-to-operate opinion. The exact launch date also matters because trademark registrations, platform policies, and product designs change.

If a complaint arrives:

1. preserve source, design records, communications, build artifacts, and store materials;
2. do not delete history or make admissions in public;
3. notify counsel and applicable insurers immediately;
4. separate copyright, trademark, and platform-policy allegations;
5. calendar takedown/counter-notice deadlines precisely; and
6. assess whether a rapid visual/metadata patch can reduce interruption without prejudicing defenses.

---

## 15. Source register

### Core Tetris authority and docket

- [*Tetris Holding, LLC v. Xio Interactive, Inc.*, full opinion (D.N.J. 2012)](https://law.justia.com/cases/federal/district-courts/new-jersey/njdce/3%3A2009cv06115/235418/61/)
- [Official GovInfo opinion package](https://www.govinfo.gov/app/details/USCOURTS-njd-3_09-cv-06115/USCOURTS-njd-3_09-cv-06115-0)
- [CourtListener docket](https://www.courtlistener.com/docket/4309852/tetris-holding-llc-v-xio-interactive/)

### Copyright statutes and official guidance

- [17 U.S.C. §102 — subject matter and idea/system exclusion](https://uscode.house.gov/view.xhtml?edition=prelim&num=0&req=granuleid%3AUSC-prelim-title17-section102)
- [17 U.S.C. §107 — fair use](https://uscode.house.gov/view.xhtml?edition=prelim&num=0&req=granuleid%3AUSC-prelim-title17-section107)
- [17 U.S.C. §412 — limits on statutory damages and fees](https://uscode.house.gov/view.xhtml?edition=prelim&num=0&req=granuleid%3AUSC-prelim-title17-section412)
- [17 U.S.C. §504 — damages and profits](https://uscode.house.gov/view.xhtml?edition=prelim&num=0&req=granuleid%3AUSC-prelim-title17-section504)
- [17 U.S.C. §512 — online service-provider safe harbors and counter-notices](https://uscode.house.gov/view.xhtml?edition=prelim&num=0&req=granuleid%3AUSC-prelim-title17-section512)
- [U.S. Copyright Office — Games](https://www.copyright.gov/register/tx-games.html)
- [U.S. Copyright Office Circular 33 — Works Not Protected by Copyright](https://www.copyright.gov/circs/circ33.pdf)
- [*Baker v. Selden*, official U.S. Reports PDF](https://tile.loc.gov/storage-services/service/ll/usrep/usrep101/usrep101099/usrep101099.pdf)

### Balanced game-clone authorities

- [*Atari, Inc. v. North American Philips Consumer Electronics Corp.*, 672 F.2d 607 (7th Cir. 1982)](https://law.justia.com/cases/federal/appellate-courts/F2/672/607/331150/)
- [*Data East USA, Inc. v. Epyx, Inc.*, 862 F.2d 204 (9th Cir. 1988)](https://law.justia.com/cases/federal/appellate-courts/F2/862/204/20289/)
- [*Incredible Technologies, Inc. v. Virtual Technologies, Inc.*, 400 F.3d 1007 (7th Cir. 2005)](https://law.justia.com/cases/federal/appellate-courts/F3/400/1007/606294/)
- [*DaVinci Editrice S.r.l. v. ZiKo Games, LLC*, 183 F. Supp. 3d 820 (S.D. Tex. 2016)](https://law.justia.com/cases/federal/district-courts/texas/txsdce/4%3A2013cv03415/1134359/73/)
- [*Upper Deck Co. v. Miller*, W.D. Wash. Oct. 3, 2025](https://law.justia.com/cases/federal/district-courts/washington/wawdce/2%3A2023cv01936/329581/184/)

### Trademark and trade dress

- [15 U.S.C. §1125 — false designation, trade dress, and dilution](https://uscode.house.gov/view.xhtml?edition=prelim&num=0&req=granuleid%3AUSC-prelim-title15-section1125)
- [15 U.S.C. §1116 — injunctions](https://uscode.house.gov/view.xhtml?edition=prelim&num=0&req=granuleid%3AUSC-prelim-title15-section1116)
- [15 U.S.C. §1117 — profits, damages, costs, and fees](https://uscode.house.gov/view.xhtml?edition=prelim&num=0&req=granuleid%3AUSC-prelim-title15-section1117)
- [15 U.S.C. §1118 — destruction of infringing articles](https://uscode.house.gov/view.xhtml?edition=prelim&num=0&req=granuleid%3AUSC-prelim-title15-section1118)
- [USPTO — Likelihood of Confusion](https://www.uspto.gov/trademarks/search/likelihood-confusion)
- [USPTO TTABVUE — Tetris Holding pleaded registrations/current status](https://ttabvue.uspto.gov/ttabvue/v?pno=91249666&pty=OPP)
- [*Interpace Corp. v. Lapp, Inc.*, 721 F.2d 460 (3d Cir. 1983)](https://law.justia.com/cases/federal/appellate-courts/F2/721/460/162480/)
- [*Century 21 Real Estate Corp. v. LendingTree, Inc.*, official Third Circuit opinion](https://www2.ca3.uscourts.gov/opinarch/034700p.pdf)
- [*Wal-Mart Stores, Inc. v. Samara Brothers, Inc.*, 529 U.S. 205 (2000)](https://supreme.justia.com/cases/federal/us/529/205/)
- [*TrafFix Devices, Inc. v. Marketing Displays, Inc.*, 532 U.S. 23 (2001)](https://supreme.justia.com/cases/federal/us/532/23/)
- [*Dastar Corp. v. Twentieth Century Fox Film Corp.*, official U.S. Reports PDF](https://tile.loc.gov/storage-services/service/ll/usrep/usrep539/usrep539023/usrep539023.pdf)
- [T-shaped composite mark, Registration No. 2,362,250](https://trademarks.justia.com/757/82/tetris-75782993.html)
- [T-shaped composite mark, Registration No. 3,818,232](https://trademarks.justia.com/778/90/tetris-77890492.html)
- [Composite field/word-and-shapes mark, Registration No. 6,704,948 / Serial No. 90670731](https://www.trademarkia.com/tetris-90670731) and [official TSDR lookup](https://tsdr.uspto.gov/#caseNumber=90670731&caseSearchType=US_APPLICATION&caseType=DEFAULT&searchType=statusSearch)
- [Sound mark, Registration No. 3,517,007 / Serial No. 77037539](https://trademarks.justia.com/770/37/n-77037539.html)
- [Official TSDR lookup for Serial No. 77037539](https://tsdr.uspto.gov/#caseNumber=77037539&caseSearchType=US_APPLICATION&caseType=DEFAULT&searchType=statusSearch)

### Owner statements and enforcement evidence

- [Tetris Terms of Use, updated May 1, 2025](https://tetris.com/terms-conditions)
- [Tetris corporate information](https://tetris.com/corporate-bios)
- [Tetris contact/licensing page](https://tetris.com/contact-us)
- [GitHub-published 2023 Apotris DMCA notice](https://github.com/github/dmca/blob/master/2023/02/2023-02-10-tetris.md)
- [GitHub-published 2021 Tetris notice](https://github.com/github/dmca/blob/master/2021/07/2021-07-16-tetris.md)
- [itch.io 2023 Setris takedown notice](https://itch.io/takedowns/2073998)

---

## 16. Final assessment

Serenity Blocks has already moved away from the riskiest literal presentation: the name and package metadata are generic; the primary renderer fuses cells into seamless silhouettes; its board is transparent; default colors are scrambled; the visual worlds are highly original; and several Tetris-specific end-state/lock features are absent. Those are real legal-risk mitigations, although the gridded legacy canvas fallback needs separate attention.

The static codebase nevertheless implements the complete seven-piece family on an exact 10×20 field with an overlapping visual/UI feature cluster, and it draws startup/menu branding from conventional tetromino forms. Ten selectable themes also screen as preserving all seven familiar hue roles under a deliberately broad heuristic. The current static record therefore supports a **provisional Medium aggregate rating**, not a conclusion of infringement. It could rise to Medium–High if representative gameplay or store captures reproduce the overall visual impression of a plausibly asserted Tetris audiovisual work or current source-identifying presentation.

The fastest responsible path is: remove the residual word mark, remove tetromino branding, derange the flagged palettes, verify all audio, capture the complete current product, fix the unrelated asset-notice blockers, and obtain a playable-build/storefront review from qualified game-IP counsel. After those steps, the remaining mechanics-heavy similarity should be substantially easier to defend as use of unprotectable rules within a distinct expressive work.
