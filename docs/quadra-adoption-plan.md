# Quadra → Serenity Blocks: Feature Adoption Plan

> **Headline finding:** Serenity Blocks has already ported roughly **90% of Quadra's distinctive
> gameplay mechanics** — often faithfully (the code cites `net_version 24` and reproduces Quadra's
> exact bitfield hole-encoding and clean-line column patterns). This plan is therefore
> **completion-focused**: surface what's already half-built, finish the one genuine stub, and add
> optional depth. It is *not* a "build from scratch" plan.

_Compared against the open-source Quadra (Ludus Design, C++/SDL2) at `C:/Users/olovm/repositories/quadra`._

---

## Already implemented — do NOT rebuild

| Quadra feature | Status | Location |
|---|---|---|
| Attack/garbage ruleset + **clean lines** + authentic hole encoding | ✅ Done | `src/core/garbage.js` (`calculateGarbage`, `CLEAN_PATTERN_EVEN/ODD`) |
| **Handicap** (5 levels) + **crowd handicap** (= Quadra "boringrules") | ✅ Done | `src/core/garbage.js:18`, `src/core/game.js:462` |
| **Deterministic shared-seed** piece queue ("same pieces for all") | ✅ Done | `src/core/multiplayer/ffa-p2p-game-state.js:119` (`sharedSeed`, `createSeededRNG`) |
| Configurable **end conditions** (frags/time/points/lines/rounds) + team matches | ✅ Done | `src/core/game-modes/LocalMultiplayerMode.js:2431` |
| **Blind / Full-Blind** attacks | ✅ Done | `src/core/garbage.js:12`, `src/core/game.js:453` (`blindTimers`) |
| **Replay record + browser** ("Demo Central" equivalent) | ✅ Done | `src/core/demo/DemoManager.js`, `src/ui/demo-browser.js`, `src/ui/playback-controls.js` |
| Many-player FFA, online MP, frag tracking, kill feed, lobby/chat/spectate, leaderboards | ✅ Done | `src/core/multiplayer/ffa-p2p-game-state.js`, `src/core/multiplayer/frag-tracker.js` |

---

## Tier 1 — Surface mechanics that are already coded (high value, low effort)

> **Status:** attack-style selector ✅ done · Peace preset ✅ done ·
> end-condition selectors ✅ already existed · Survivor ≈ existing "Infinity LMS" mode ·
> per-player handicap ✅ done (local path, end-to-end).

### 1.1 Expose rule variants in the match-config UI  _(effort: S — highest leverage)_
The engine already supports Blind/Full-Blind, clean-line attacks, and five end-conditions — but
`src/ui/local-match-config-modal.js` exposed **none** of them as player choices.

- **✅ Done:** Added an **Attack Style** selector (Standard / Blind / Full Blind / Peaceful) to
  `src/ui/local-match-config-modal.js`, producing `config.attackRules`, and threaded those rules
  into the local garbage path at `src/core/multi-player-state.js` `handleGarbageSummary`
  (`calculateGarbage(summary, rules)` + a peaceful early-return + a guard fix so Full-Blind fires).
  Blind/Full-Blind were already handled on the receive side. Added tests in
  `src/core/__tests__/garbage.test.js`.
- **✅ Already present:** end-condition + value selectors (frags/time/points/lines/never) in the modal.
- **✅ Done — per-player handicap (local path, end-to-end):** the handicap pipeline was previously
  dormant (`accumulateHandicapStamps`/`applyHandicap` were never called). Now wired:
  - **UI:** per-player handicap dropdowns (Beginner→Grandmaster) in `src/ui/local-match-config-modal.js`
    → `config.playerHandicaps`.
  - **Setup:** `MultiPlayerState.setPlayerHandicaps()` applies levels after reset/seed
    (`src/core/game-modes/LocalMultiplayerMode.js`).
  - **Accumulate:** `MultiPlayerState.accumulateHandicap(playerIndex)` runs on every piece lock via
    the `onPieceLock` callback in `src/main.js` (no-op when levels are equal).
  - **Apply:** `handleGarbageSummary` now expands entries **per target** and reduces normal garbage
    lines per opponent via `_applyHandicapForTarget` (clean lines bypass handicap, matching Quadra).
  - **Tests:** stamp accumulation/cap/consumption + clean bypass in `garbage.test.js`; end-to-end
    reduction in `src/core/__tests__/multi-player-handicap.test.js`.
  - **Note:** scoped to the local path; the online/FFA path still routes through `ffa-attack-router.js`
    and would need the same wiring once its reconciliation blocker is fixed.

### 1.2 Named competitive presets — Survivor, Peace  _(effort: S)_

- **✅ Peace** = the new "Peaceful" attack style (`config.attackRules.disableAttacks`) — no garbage
  is ever sent.
- **Survivor** = last-player-standing rounds, which the modal **already offers** as the
  "Infinity LMS (Last Standing)" game mode. A dedicated best-of-N "Survivor" label on top of the
  existing `rounds` end-condition (`src/core/game-modes/LocalMultiplayerMode.js:2433`) remains optional.

---

## Tier 2 — Finish the one genuinely unimplemented mechanic

### 2.1 Hot Potato  _(effort: M)_
**✅ Done:** `ATTACK_TYPES.POTATO` is now a selectable Hot Potato attack style for local and online
match config. The holder gets a visible local HUD badge/countdown, clears pass the potato instead of
sending normal garbage, and expiry queues a deterministic penalty burst on the holder before passing
to the next living player.

- **Core:** `src/core/garbage.js` handles Potato params and deterministic fixed-column penalty attacks.
- **Local:** `src/core/multi-player-state.js` owns holder/timer/pass/detonation state; `LocalMultiplayerMode`
  ticks the timer and updates the HUD badge.
- **Online/FFA:** `src/core/multiplayer/ffa-attack-router.js` owns host-authoritative holder/timer routing,
  and `ffa-p2p-game-state.js` snapshots the potato state to peers.
- **Tests:** `garbage.test.js` and `multi-player-handicap.test.js` cover Potato params, pass, and detonation.

---

## Tier 3 — Depth & polish (optional)

### 3.1 Per-game statistics screen (Quadra `stats.cc` parity)  _(effort: M)_
**✅ Done:** local match results now aggregate/display PPS, APM, attacks sent/received, attack lines
sent/received, clean lines sent/received, max combo/depth, and Hot Potato pass/hit stats. Online FFA
results now include PPS, attacks sent, and attack lines sent from the existing attack router stats.
`GameState.reset()` also resets piece/line-clear counters so multi-round stats do not double-count.

### 3.2 Replay determinism hardening  _(effort: M–L)_
**✅ Hardened:** the Online-MP reconciliation blocker is fixed: host snapshots now apply the
authoritative local board for reconciliation and replay unacknowledged local inputs via
`_reconcileLocalPlayer()`. Replay proofing now requires a recorded seed and monotonic input log,
hashes deterministic initial settings/drop interval/rules version, and has focused tests in
`src/core/__tests__/replay-proof.test.js`.

> Remaining optional depth: multiplayer matches still do not have Demo Browser-style persisted
> replay files. The hardening here fixes determinism proofing and online reconciliation drift; full
> MP replay capture/playback would be a separate feature.

---

## Explicitly NOT recommended
- **Importing Quadra's art / audio / bitmap-font assets** — aesthetic mismatch with the Three.js
  look; the value was the *mechanics*, and those are largely in. (At most, study Quadra's *sound-cue
  design* — which events get audio feedback — not the WAV files.)
- **Re-building handicap / determinism / clean-lines / garbage** — already done.
- **Adding more themes/modes** — runs counter to the "lock scope and finish" takeaway.

---

## Suggested sequencing
1. **Phase 1:** Rule-variant config UI (1.1) — unlocks the most for the least.
2. **Phase 2:** Survivor/Peace presets (1.2) + Hot Potato (2.1) — complete.
3. **Phase 3:** Stats screen (3.1); replay determinism hardening (3.2) — complete, with MP replay capture optional.

## Caveats
- The code review flagged real integration gaps (e.g., dropped reconciliation), so **confirm each
  "✅ Done" item is fully wired end-to-end** before treating it as shippable — "defined in the
  engine" is not the same as "playable."
