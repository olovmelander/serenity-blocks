# Odyssey charms: audit and recommended redesign (2026-10-20)

An audit of the two power-up systems built for Odyssey in October 2026, measured against one
brief: *the campaign stays challenging; a stuck player can get help; using help must not feel
like cheating; help must be earned; gathering it must need no thinking or choosing; the whole
thing must be smooth, visually clear and easy to understand.*

Audited: the live charm system (`src/core/odyssey/odyssey-charms.js`,
`odyssey-charm-effects.js`, `src/ui/odyssey/odyssey-charm-carry.js` and their UI), the gem
system it replaced (commit `c2ca89f`, removed in `564ff0b`), the shipped level data (all 60 orbs
as `LEVEL_CONFIGS` resolves them), the in-orb HUD, the outcome sheets, keyboard and controller
input, the clock/replay model, and the VFX/SFX hooks an in-orb effect can use.

---

## 1. Verdict

**Neither system is the right shape for the brief, and for opposite reasons.**

- The **live charm system** (passive charms, pick-one drafts, three carry slots) fails the
  "no thinking, no choices" bar outright: it puts a decision in front of the player at three
  points, its effects are invisible while playing, and its mercy runs dry for exactly the player
  who needs it. It is also the larger of the two (≈2,250 lines with tests, wired into 11 files).
- The **gem system** had the right play-time shape (consumable, pressed mid-orb, a HUD tray,
  keys 1–3, well tested) and the wrong price: a used gem capped the orb at **one star** and
  marked the orb "aided" on the map. That penalty is what made it feel like a tax, and it is the
  stated reason it was removed.

**Recommendation:** rebuild as **Charms v3: gather, keep, spend.** Typed consumables, dropped
automatically by clearing orbs, kept in a capped bag for the journey, used during an orb with
one key press, used up on use, no star penalty. Reuse the gem system's effects, input and tray
(all still in git); delete the drafts, slots and pre-orb rewrites. Details in §5.

---

## 2. The bar

| # | You asked for | What it means for the design |
|---|---|---|
| B1 | Odyssey stays **challenging** | help must be bounded: finite, one-shot, no permanent passives |
| B2 | help for a **stuck** player | help must be strong enough to break a wall when used well |
| B3 | not **cheating** | earned, scarce, intentional (the player acts), and the game never punishes the use |
| B4 | **work** to gather | drops come from clearing orbs, never from falling |
| B5 | **no thinking or choosing** when gathering | automatic pickups; no draft cards, no slots, no toggles |
| B6 | **smooth, clear, visually good** | one press to use, loud feedback, plain words, one line to announce a pickup |

---

## 3. The live charm system against the bar

Catalogue: 8 charms in 3 kinds. Kindle, Swell, Afterglow pay points; Keel, Long Breath, Still
Air, Low Tide ease the orb before it starts; Hearth absorbs one top-out per orb. Each chapter's
arrival offers a draft of 3 (take one or pass); after the third fall on one orb the failure
sheet offers a draft (take or "Not now"); what is taken stays for the journey; up to 3 are
carried, chosen with toggles on the map panel.

| # | Finding | Evidence | Bar |
|---|---|---|---|
| F1 | **Three decision points.** Chapter arrival: pick 1 of 3 or pass, and *Begin chapter* and *Map* refuse until you do ("Take a charm or pass to go on."). Failure sheet: pick or "Not now". Map panel: carry toggles with a "set one down to carry another" notice. | `JourneyFlowOverlay.js:532-535`, `FailureModal.js:72-122`, `odyssey-charm-carry.js:88-97` | B5 ✗ |
| F2 | **Effects are invisible in play.** Keel lowers the goal number, Low Tide removes rows before you see the well, Still Air changes gravity, Long Breath adds 30 s to the clock: all applied before the orb loads (`applyOdysseyCharmsToLevel`). The player never *does* anything, so the help is not felt as help; the orb just got quietly easier. That is a difficulty slider in disguise, which reads more like cheating than an earned, visible consumable does. | `odyssey-charms.js:310-358`, `OdysseyMode.js:2173-2176` | B3 ✗, B6 ✗ |
| F3 | **Permanent, unlimited passives.** Carry Hearth and every attempt forever has a free top-out; carry Keel and every orb asks 15% less, for the rest of the journey. Nothing is spent. The doc itself worried that "eight permanent charms would stack into an ease the late chapters were never authored for" and answered with slots, which added F1 rather than removing the problem. | `odyssey-charm-effects.js:104-120`, `docs/ODYSSEY_UX_OVERHAUL_2026-10.md` §Charms | B1 ✗ |
| F4 | **Mercy runs dry.** The failure-sheet draft only offers charms *not yet in the bag*. Once the easing charms are gathered, a stuck player gets a hint line instead ("In your bag, not carried: …"), and if they already carry them, nothing at all. The player deep in chapters 6–7, where the walls are (see §6), is the one left without mercy. | `odyssey-charms.js:181-185`, `odyssey-charm-carry.js:120-133` | B2 ✗ |
| F5 | **"Not now" means never.** Passing the mercy draft settles it for that orb for good (`drafts[key] = null`); the label promises a later chance. | `odyssey-charms.js:272-276`, `FailureModal.js:81` | B6 ✗ |
| F6 | **Copy is hard to read quickly.** "A cascade two waves deep or more scores half again", "Eases the ask", "Keeps you in", "the one carried longest is set down". The calm register is right for this game; the phrasing hides the rule. | `odyssey-charms.js:29-56`, `ODYSSEY_CHARM_KIND_LABELS` | B6 ✗ |
| F7 | **Three of eight charms do not help a stuck player.** Kindle, Swell and Afterglow pay points. They exist so each draft can show "three kinds"; on a line, cascade, timed or duel orb they do nothing for a wall. | catalogue | B2 — |
| F8 | **Doc and code disagree on leaderboards.** The doc says a charmed clear "holds its stars and its leaderboard time"; the code keeps charmed runs off the orb time board (added the same day by audit fix `9332803`). The code is right; the doc is stale. | `OdysseyMode.js:3771-3773`, `tests/unit/odyssey-charm-leaderboard.test.js` | — |
| F9 | **Footprint and fragility.** ≈2,250 lines across 3 modules and 8 test files (63 tests), plus wiring in `OdysseyMode`, `OdysseyStateManager`, `odyssey-physics-callbacks`, `odyssey-completion`, `GameplayHybridEngine`, `OdysseyBotMatch`, `JourneyFlowOverlay`, `FailureModal`, `ResultsModal`, `odyssey-level-panel`, `odyssey-first-arrival`, `BoardInfoOverlay`, `odyssey-navigator-list`, and two stylesheets. The "orb as the carried charms make it" is computed in three places (map panel, HUD briefing, engine config) that must agree. | `grep -rln odyssey-charm src tests` | B6 — |

**Worth keeping from it:** Hearth's well rewrite through `restoreBoardState` (the replay-safe
boundary); the duel handling (your well only, the rival gets no knockout, `topOutGuard`);
the per-orb `falls` counter; the save normaliser pattern; the HUD `charms-section` slot and
chip styling; the `sb-ody-note` block and `role=status` pattern on the sheets; the time-board
exclusion.

---

## 4. The gem system (`c2ca89f`) against the bar

One wallet (cap 9). +1 gem for a clear, +1 for a fall. Three abilities, each once per attempt,
spent with keys 1/2/3, a chip click, or spare pad buttons: **Tide** (sweep the lowest 4 rows,
nothing it clears counts), **Still Air** (20 s of the slowest fall, or +30 s on a timed orb),
**Second Breath** (arm: one top-out empties the well). A clear with any gem used was capped at
**one star**, flagged `aided` in the save, and the map panel said "Cleared with a gem's help. An
unaided clear earns its stars."

| # | Finding | Bar |
|---|---|---|
| G1 | **Right shape.** Pressed during play, immediate and visible, once per attempt, a tray with states (ready / active 13 s / armed / used / empty), key and pad hints. 35+ unit tests pinned the edge cases (refused mid-cascade, during the victory lap, while paused, on an empty floor; Still Air re-slows after a level-up; Second Breath fires once). | B2 ✓, B6 ✓ |
| G2 | **Wrong price.** The one-star cap and the "aided" mark on the map turn help into a confession. The handover doc names this as the reason gems went: "taxed every orb with a tray, three keys and a one-star penalty." Of those three, only the penalty is a real tax; the tray and the keys are the feature. | B3 ✗ |
| G3 | **A gem for a fall is farmable** and rewards failure. The doc admitted "the farmable exploit (deliberate quick falls)" and relied on the cap to bound it. Nine instant top-outs fill the wallet. | B4 ✗ |
| G4 | **One currency, not items.** The player never "finds" anything; the counter ticks. No variety, no small moment of "oh, a Tide". You asked to gather *different* charms. | B5 ~ |
| G5 | **Hidden conditional in Still Air** (slow fall, *or* +30 s on a timed orb). One sentence, but a surprise at the moment of use. | B6 ~ |
| G6 | **Still Air's clock rode the HUD refresh.** Expiry and re-pacing ran inside the 250 ms HUD sync, not the game tick. Works, but imprecise and coupled to presentation. | — |
| G7 | **Good anti-cheat detail:** Tide bypassed the line-clear path entirely, so nothing it removed counted toward lines, score or cascades; a deadline extension went through the evaluator (`timeLimitBonus`) and the HUD together. | B1 ✓ |

---

## 5. Recommended design: Charms v3, "gather, keep, spend"

### 5.1 Principles

1. **Pickup is automatic and typed.** You clear an orb, you find a charm. One line says which.
   Never a card, never a pass, never a slot.
2. **Use is one press, visible and loud.** The effect happens now, on the well, with VFX and
   sound; the chip shows what it is doing.
3. **Scarcity is the legitimacy.** A capped bag, one use of each charm per attempt, and a used
   charm is gone even if the attempt fails. Using one is a bet, not a cheat.
4. **No penalty, ever.** Full stars. The only competitive guard is the one already in code: a
   run that used a charm does not post to the orb's time leaderboard. Silent, no shame.
5. **Help is authored without choosing.** Drops lean toward what the road ahead needs (a timed
   chapter drops Long Breath). The player gets the right tool without picking it.

### 5.2 The catalogue: four charms

Every failure in the campaign is a top-out, a clock, or a rival (§6). Four charms cover all
three; no points charm is needed, because score orbs fail by top-out or by clock too.

| Charm | Key | Press it to… | Why it breaks a wall | Duels | Cannot be used |
|---|---|---|---|---|---|
| **Tide** | 1 | clear the bottom 4 rows of the well, now | a dense stack or heavy rubble (26 orbs start with rubble, up to 10 rows; Indra's Net 30) | your well only | mid-cascade; on an empty floor |
| **Still Air** | 2 | slow the fall to the gentlest pace for 20 s | the pace (chapters 6–8 start at L8–L13, 48–73 ms a row) | your well only; the rival keeps the pace | — |
| **Long Breath** | 3 | add 30 s to the clock | the 11 timed orbs, including the three brutal score-under-a-clock walls (33, 45, 59) | no (duels have no clock) | on an orb without a clock (chip reads "no clock here") |
| **Hearth** | 4 | arm it: your next top-out empties the well and play goes on | the one mistake that ends a long attempt | yes; the rival gets no knockout | — |

Numbers are the gem system's, proven in its tests; they are tuning knobs, not commitments.
Nothing a charm clears counts toward a goal (Tide bypasses the line-clear path, as before).

*Not included:* Keel and Low Tide (they can only act before the orb starts, which is F2);
Kindle/Swell/Afterglow (F7). If a points charm is wanted later, "Kindle: clears score ×1.5 for
30 s" fits the same shape; it is the one optional fifth.

### 5.3 Gathering: the work

- **Every orb clear drops one charm. A three-star clear drops two.** Replays count: going back
  to restock on earlier orbs is honest work, the way an RPG lets you grind before a boss.
- **A fall drops nothing.** This closes the gem system's farm (G3) and stops rewarding failure.
- **The drop is picked for the road ahead:** uniformly among the charms that *do something* on
  the next uncleared orb (Tide, Still Air and Hearth always; Long Breath only if that orb has
  a clock), skipping any charm already at its cap. No seed, no draft, one line of code.
- **After three falls in a row on one orb, you find one charm that helps *that* orb** (clock →
  Long Breath; rubble or a tall board → Tide; duel → Hearth; otherwise Still Air). Once per
  three falls, and only while you hold fewer than two of it. This replaces the mercy draft (F4,
  F5) with no choice to make. It is the only "targeting" in the system.
- **Cap: 3 of each** (a bag of at most 12). The cap makes hoarding pointless and nudges spending.
- **A new journey empties the bag.** Charms belong to the journey, like stars.

### 5.4 Using: the play

- Keys **1–4** (Digit and Numpad), a **click/tap on the chip**, or spare controller buttons
  (LB / RB / LT / RT, skipping any the player rebound), with the hint shown on each chip. A
  key the player has bound to a move stays a move (checked against live `settings.keyBindings`).
- **One use of each charm per attempt.** Pressing again does nothing and the chip says "used".
- **Used on press, kept used.** Retry does not refund it. Pity (above) and restocking keep a
  stuck player moving without making charms free.
- **Refused presses cost nothing**: paused, countdown, victory lap, `levelCompleting`,
  mid-cascade (`isProcessingPhysics`), tower-look exploration, Long Breath on an untimed orb,
  Tide over an empty floor. The chip gives a short reason ("no clock here", "mid-cascade").
- **Feedback, per charm** (all hooks exist in `shared-effects.js` and `sound-effects.js` and
  honour reduced motion):

  | Charm | Well | Sound | Chip |
  |---|---|---|---|
  | Tide | `triggerLineClearFlash` on the 4 rows + `spawnLineClearParticles` + `playLineClearImpact(4,1)` | `playLineClear` | "used" |
  | Still Air | a calm tint on the well border (new, CSS) while active | `playLevelUp` | countdown "14 s" → "used" |
  | Long Breath | the HUD clock flashes and jumps +30 | `playCascadeChime` | "used" |
  | Hearth armed | `createShockwaveRing` once; a soft ring on the chip | `playLevelUp` | "armed" |
  | Hearth fires | `playPerfectClear(0)` (as today) | `playPerfectClear` | "used" |

### 5.5 Fairness: why this will not feel like cheating, and will stay hard

- **Earned** (clears only), **scarce** (cap, one of each per attempt, lost on a failed attempt),
  **intentional** (you press it, you see it), **unpunished** (full stars). Those four are what
  separate a potion from a cheat code.
- **Bounded help.** 4 rows once, 20 s once, 30 s once, 1 life once. Orb 51 (66 lines in 150 s at
  L13) stays orb 51; a charm turns "impossible for me" into "possible with a good run and a
  safety net", which is the stated goal.
- **No permanent ease** anywhere in the system, so the late road is the climb it was written to be
  (the worry that produced the slots in v2 disappears with the passives).
- **Stars count in full.** Stars are progression, not competition. The gem system's star cap
  was the tax; dropping it is the single biggest change in feel.
- **Time leaderboards stay clean**, silently: a run that used a charm is not posted to the orb's
  time board (already in code). The results sheet lists "Charms used · Tide" as a fact, in the
  same row style as Score and Lines, not as a warning.
- **Duels:** your well only. The rival never slows, never loses rows, never loses a knockout to
  Hearth being absent; Hearth absorbing your top-out costs the rival a knockout they did not
  earn, which is the point of the charm.

### 5.6 Where it shows up

| Surface | What the player sees | Notes |
|---|---|---|
| **In-orb HUD** (existing `charms-section` slot, left column; bottom dock ≤860 px) | "Charms" · a chip per charm you hold: `[1] ◆ Tide ×2`, state text (ready / 14 s / armed / used). Hidden when the bag is empty and nothing was used this attempt. | Polite live region for state changes (the current list is silent). Horizontal row in the dock. Disabled while paused. |
| **Completion sheet** (`JourneyFlowOverlay` variant `completion`, after the theme reward) | one line: "◆ Found: Tide" (two-star) / "◆ Found: Tide · Hearth" (three-star). First pickup of the journey adds: "Press 1 during an orb to use it." | Add its `readingWords` so auto-continue waits for it. Also a `Charms` fact row on `ResultsModal`. |
| **Failure sheet** (`sb-ody-note` after the lede) | nothing on falls 1–2. On the third fall in a row: "◆ After three falls here, the road leaves you Long Breath. Press 3 for 30 more seconds." | Replaces the draft cards, "Not now", and the hint block. |
| **Map header** (`#odyssey-header-charms`) | "◆ 5 charms" with a tooltip listing them | Replaces the carried/bag line. |
| **Orb panel** | no toggles. Optional one line: "Charms that help here: Long Breath, Tide." | Read-only; keeps `renderOdysseyLevelPanel` pure. |
| **First arrival** orientation | rewrite the charm note: "Clearing an orb leaves you a charm. Press 1–4 during an orb to use one; it is spent when used." | `odyssey-first-arrival.js:20-21` |
| **Chapter arrival** | no charm block | `JourneyFlowOverlay` loses ~90 lines |

Copy stays in the game's calm voice but says the rule plainly. Chip titles:
"Tide · clears the bottom 4 rows. Once an attempt." · "Still Air · slows the fall for 20
seconds." · "Long Breath · adds 30 seconds to the clock." · "Hearth · arm it, and your next
top-out clears the well instead of ending the orb."

### 5.7 What is removed

Drafts (chapter and mercy), `ODYSSEY_CHAPTER_CHARMS`, carry slots and `toggleCarriedCharm`,
`applyOdysseyCharmsToLevel` and the three places that call it, `paceFactor` plumbing in
`GameplayHybridEngine` and `OdysseyBotMatch._configurePlayer`, the panel toggles and hints, the
map header bag line, the arrival charm block, the failure-sheet draft, the `charmDraft` /
`charmHint` session fields, `odyssey-charm-carry.js`, the score-charm callback wrapper, and the
eight charm test files (rewritten, not kept). Expected net: ≈900 fewer lines, and `OdysseyMode`
shrinks (its architecture-fitness baseline is 4365 lines; keep new wiring in modules).

### 5.8 Engineering notes

- **Reuse from `c2ca89f`** (`git show c2ca89f:<path>`): `sweepLowestRows`, `applyOdysseyTide`,
  `beginOdysseyStillAir` / `tickOdysseyStillAir`, `reviveOdysseyWell`, `odyssey-gem-input.js`
  (keyboard + pad, rename), `createOdysseyGemPadControls` + `setOdysseyGemControls` in
  `gamepad-controller.js`, the HUD tray (`_createGemsSection` / `updateGems` /
  `setGemPadHints` / `extendTimeLimit`), the `VictoryConditionEvaluator.timeLimitBonus` +
  `GameplayHybridEngine.extendTimeLimit` pair, and most of the four test files. The current
  `tryOdysseyHearth` and `topOutGuard` wiring already exist and stay.
- **No runtime time-extension exists today** (`extendTimeLimit` has no matches in `src`); it
  must be re-added to the evaluator, the engine and the HUD together, as the gem commit did.
- **Move Still Air's clock off the HUD sync** (G6): tick it from the gameplay loop's update or
  the physics callbacks, so expiry is exact whatever the HUD throttle does.
- **Clocks.** Odyssey records no demos, so no replay fidelity work is needed now. Fixed-tick
  sessions (`fixed60-v1`, dev flag `?fixedTick=1`, unranked, never saved) are the one case
  where a DOM-driven well rewrite is off-tick: hide the tray and refuse charms there for now,
  and note that a future fixed-tick path routes the use through `applyOdysseyFixedCommand`.
  Duels always run on the legacy clock.
- **Save (additive, no version bump):** `charms: { bag: { tide: n, 'still-air': n,
  'long-breath': n, hearth: n }, found: n, used: n, streak: { levelId, falls } }`, normalised on
  load (unknown ids dropped, counts whole and capped). Old saves: convert each charm in the old
  `gathered` list to one charm of the new catalogue, round-robin, so nobody loses what they
  gathered. The old `drafts` and `carried` are dropped.
- **Steam:** results already carry `charms`; send the used list in the details; keep the time
  board exclusion; a "charms found" stat is a cheap achievement later.
- **Controller conflicts:** on tall wells R3 and the right stick drive the tower look, and LB/RB
  send the view home during exploration, so charm input must be blocked while
  `mode.isInExplorationMode`. Select (8) is the victory-lap Finish; leave it out of the spare list.
- **Tests to carry:** bag normalise/cap/add/spend; drop pick (context, cap, two on three stars);
  pity (third consecutive fall, resets on a clear or another orb, stops at two held); each
  effect's refusals; one-of-each per attempt; consumed on failure; duel guard; input mapping and
  rebinding; HUD states; sheets' lines and `readingWords`; save round-trip and migration;
  leaderboard exclusion.
- **Visual verification** needs a GPU machine per `CLAUDE.md`: the tray in both layouts, each
  chip state, and each charm's well effect. Not possible from this session (no browser tool).

### 5.9 Decisions for you (my default first)

1. **Points charm (Kindle)?** Default **out**: four charms cover every failure type; fewer chips
   read faster. Add later if score orbs still wall players.
2. **Drops on replays?** Default **yes**: it is the restock path and it is work. Alternative:
   first clears only, with the pity drop as the only restock.
3. **Consumed on a failed attempt?** Default **yes**: it is what makes a use a decision.
   Alternative: refund on failure (makes charms free to spam).
4. **Hearth: press to arm, or automatic on top-out?** Default **press**: consistent with the
   others, and arming is a visible bet. Automatic reads as extra lives and removes the moment.
5. **Cap 3 of each?** Default yes. Lower (2) if the late game feels too cushioned in play.

### 5.10 Plan

| Phase | Work | Size |
|---|---|---|
| 1 | Core: catalogue, bag, drops, pity, normalise, migration. Effects: Tide, Still Air (loop-ticked), Long Breath (evaluator + engine + HUD), Hearth (keep). Tests. No UI yet. | ≈500 lines + tests |
| 2 | Input (keys, chips, pad) and the HUD tray; completion/failure/results lines; map header; panel line; first-arrival note. Remove drafts, slots, panel toggles, pre-orb rewrites and their tests. | ≈350 lines, ≈2,000 removed |
| 3 | Save round-trip, Steam details, doc updates (`ODYSSEY_UX_OVERHAUL_2026-10.md` charm section → pointer here; `ARCHITECTURE_INDEX.md` row; fix F8). `npx vitest run`, `tsc`, `check:boundaries`, lint ratchet, fitness. | small |
| 4 | GPU pass on your machine: tray, chip states, four effects, reduced motion. | screenshots |

---

## 6. Evidence: the campaign's walls (shipped `LEVEL_CONFIGS`)

60 orbs. Primary goals: score 19, lines 18, cascade 15, duel 8. Failure: top-out 41, time 11,
rival 8. Rubble on 26 orbs (159 rows). Difficulty bands: gentle 19, standard 12, tough 16,
brutal 13.

- **Timed orbs** (seconds): 15 (270), 23 (240), 31 (210), 33 (180), 38 (210), 40 (180),
  45 (150), 50 (180), 51 (150), 55 (480), 59 (210). Every chapter from 3 on has one.
- **Walls:** 31–34 (first real gauntlet; 33 asks 71,000 in 180 s at L11); 38–42 (five tough or
  brutal in a row; 40 is a line every 3.5 s); 45 (90,000 in 150 s at L13, 8 rubble); 47 (cascade
  25, 10 rubble, 460 ms); 51 (66 lines in 150 s, a line every 2.3 s); 52; 55 (250,000 on a
  10×100 well with 30 rubble rows); 56 and 60 (duels at scalar 1.0 and .70); 59 (160,000 in 210 s).
- **Duels** (5, 10, 18, 26, 34, 48, 56, 60): two 10×20 wells, first to 3 knockouts, chapter
  gravity 1000 → 650 ms; stars are win / ≤1 top-out / 0 top-outs. An unassisted top-out only
  resets the round, which is why Hearth in a duel is "the rival gets no knockout".

What this says about the catalogue: every wall is a stack, a clock, a pace or a rival. Tide,
Still Air, Long Breath and Hearth answer those four; a points charm answers none of them directly.

## 7. Evidence: surfaces and plumbing

- **HUD:** `#odyssey-hud`, left column (`clamp(210px,17vw,260px)`), bottom dock at ≤860 px.
  Sections: header, goal, guide, progress, time, stars, bonuses, **charms** (hidden until held),
  finish hint, pause hint. Updates on a 250 ms throttled `statsCallback`.
- **Success path:** `JourneyFlowOverlay` (completion) is the main sheet; `ResultsModal` only when
  there is no next orb or the player opens Results. Auto-continue hold is computed from reading
  words (`journey-pacing.js`).
- **Input:** digits 1–5 unbound by default in all handlers; gameplay keys are rebindable
  (`settings.keyBindings`); spare pad buttons by default: LB 4, RB 5, LT 6, RT 7, L3 10. No touch
  controls exist in-orb.
- **Clock:** legacy variable clock by default and always for duels; fixed 60 Hz only behind a
  dev flag, unranked. No demo recording in Odyssey.
- **Hooks:** `sharedEffects` (flash, particles, impact, shockwave, perfect clear, level up,
  garbage heave) and `sfxPlayer` (line clear, cascade chime, perfect clear, level up) all honour
  reduced motion / exist today.
