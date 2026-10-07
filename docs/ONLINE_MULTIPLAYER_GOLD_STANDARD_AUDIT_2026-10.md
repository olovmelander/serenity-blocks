# Online multiplayer: the gold-standard audit and plan (October 2026)

**Date:** 2026-10-07 · **Baseline:** `d01643b` (main after the online versus redesign) · **Status:** Reference
(an audit and a plan; harvest the roadmap into the umbrella plan before executing it).

This is a full audit of online versus: how it feels, how it recovers, how sessions live and
die, the rules and their fairness, the Steam transport and its trust boundaries, client
performance, and how all of it is tested. It sets out what the best games in the genre do,
defines the gold standard for Serenity Blocks, and orders the work to reach it. The defects that
needed no decision from you and could be fixed safely were fixed in this pass; §3 lists them.

---

## 1. The short version

The foundations are stronger than most indie netcode. Every message type has a sender role
and is denied by default. Both sides negotiate a protocol version. Round and migration fences
stop stale state. The exact resync carries a checksummed sidecar and a two-phase input
barrier. Garbage holes are deterministic, and snapshots are compact binary.

What kept it from feeling smooth, tight and fair:

1. **Recovery punished players for the network** *(fixed in this pass).* On any lossy link a
   keyframe sometimes arrives after the deltas that need it. Each time it did, the transport
   asked for an exact resync, and that resync freezes the player's input while it runs. In the
   soak, the second player's board changed 14% less than the host's on a 5% loss link, and a
   third less on a bad Wi‑Fi link, where 5 of 16 test key presses did nothing (§4).
2. **Opponents moved in quarter-second steps** *(fixed in this pass).* The host's snapshot
   deltas compared each board with itself, so opponents' boards and falling pieces only moved
   with the keyframes, four times a second. Now they move with every snapshot, thirty times a
   second. On a clean link the host's board reaches the other player in about half the time
   it did (§4).
3. **Players who leave never leave** *(open, Phase 1).* No departure is detected anywhere.
   A leaver stays on every screen as a ghost board that keeps falling, soaks garbage, blocks the
   last-player-standing win and revives every round. If the host leaves outside play, everyone
   is stranded. Host migration can split the survivors into two matches.
4. **Each peer's board exists twice, and the copies drift** *(open; needs your decision,
   Phase 2).* The host re-simulates every peer's board on its own clock. Garbage lands at
   different moments on the two copies, and some inputs are deferred or dropped on one side
   only. The host decides deaths and attack credit on its copy, so players get snapped to a
   board they never played.
5. **Rules bugs double and corrupt attacks** *(the first two fixed in this pass; the rest
   open).*
   - A clear that locks by gravity sent its garbage twice.
   - The host inserted garbage in the middle of a cascade.
   - Line clears shift locked-piece fragments.
   - Blind mode is broken online.
   - Cancelling only works on the host's copy of your board.
6. **Lobby data could inject markup** *(escaping fixed in this pass; CSP open).* Lobby names,
   host names and host-supplied colours and numbers reached HTML unescaped. The packaged
   app's Content Security Policy probably does not apply to `file://` pages. Together these
   would have let any lobby owner run script in every player's lobby browser.
7. **Not yet a Steam game** *(open, Phase 3; needs your decisions).*
   - The release build runs as Spacewar (AppID 480).
   - The P2P API is Valve's deprecated one, which can expose players' IP addresses.
   - Invites, the overlay and "Join game" do not work.
   - Leaderboards, cloud saves and achievements are wired to functions that do not exist.

Against the genre leaders, the missing product pieces are:
- quick match;
- rematch in seconds;
- a reconnect window;
- a visible connection and ping indicator;
- targeting and counterplay in free-for-all;
- replays.

§6 summarises the research; §7 is the target.

**Decisions only you can make** (§9): the Steam AppID; the transport library; amending
ADR‑0004 so each player's own board is authoritative; a rules-version bump; the free-for-all
battle rules; the leaver and reconnect policy; private-lobby semantics; and `wireV2`, whose
flag expires on **2026‑10‑31** and turns CI red the next day.

---

## 2. How this audit was done

- **Six code audits** ran in parallel, each reading HEAD and building scratch repros:
  - netcode feel and sync;
  - session lifecycle (28 scenarios on real `FFAGameStateP2P` instances over a serialized
    loopback wire with fake timers);
  - rules, garbage and fairness (repro scripts and a 40,000-lock fuzz);
  - Steam transport and trust boundaries;
  - client performance (Node microbenchmarks of the real modules);
  - tests and tooling.
- **Two research reports:** genre netcode practice, from TETR.IO's 124 versions of patch
  notes, Quadra's GPL source, the steamworks.js 0.4 typings, Valve's documentation, GGPO and
  GGRS; and the product and UX of online block battlers.
- **A browser soak harness:** one Chromium with 2–4 windows on the mock transport. A bot
  plays in every window for 45 s after 16 probe key presses. The harness records:
  - each window's own board;
  - every opponent board it displays;
  - frame timing;
  - net counters;
  - why inbound messages fail validation.

  From these it derives input-to-board time, how late each player sees each other board,
  flicker (an older board shown again after a newer one), input freezes and resyncs.

**What the numbers mean (ADR‑0016).** The soak ran on one 4‑vCPU container with software
rendering, so frames took 33–67 ms at the median. Absolute latencies are therefore inflated,
and none of them is a claim about real hardware. Compare them only with each other: the same
harness, the same seed, before against after. Nothing was run on real Steam or on two
machines. That run remains the release gate (§10, L4).

**The harness was not telling the truth, so it was fixed first.** Its "reliable" lane reordered
and duplicated messages, which real Steam never does. The receiver's replay guard then dropped
them, so "reliable" messages were silently lost: the tests audit measured 145 of 300 lost under
50–150 ms jitter. That had produced false storms of input gaps. The reliable lane now behaves
like Steam:
- each message arrives exactly once and in order;
- a lost datagram costs about one round trip of resend, and later messages wait behind it;
- broadcasts stay in order with direct messages;
- messages are handed over in planned order, not by racing timers.

The old behaviour is still there as an opt-in (`reliableChaos`). The `badwifi` preset no longer
adds an artificial extra delay to the reliable lane. Every measurement below uses the corrected
harness.

---

## 3. Fixed in this pass

Each fix carries its own unit tests. The netcode fixes were also measured with the soak (§4).
None has been run on real Steam.

| # | What was wrong | What changed | Proof |
|---|---|---|---|
| F‑1 | **A late keyframe froze the player.** A delta that overtook its keyframe (routine under loss, since keyframes are reliable and resent, while deltas are unreliable), or arrived before any keyframe, made the transport ask the host for an exact resync. The host answered with the input barrier: the player's input froze, then their board was replaced. On a lossy link this happened several times a minute (N1, T9). | The peer drops a delta it cannot decode yet and waits. Keyframes are reliable, ordered and due every 250 ms, so the next one heals the stream. Only a run of 60 undecodable deltas (about 2 s) still asks for a resync. `steam-networking.js` `_awaitKeyframe`. | Unit: `steam-networking-binary-snapshot`, `steam-networking-raw-snapshot-v2`. Soak: transport resync requests went from 11–17 per 45 s (6–8 exact resyncs) to 0 (§4). |
| F‑2 | **Opponent boards flickered on every lock.** Two writers fed each opponent tile. The 30 Hz snapshot handler wrote the newest grid; the per-frame path wrote the interpolated grid from about 90 ms earlier. Each lock flicked new → old → new and could show the locked piece twice (N8, P3). | The snapshot handler passes metadata only. The render frame draws the grid and falling piece from one interpolated moment. `OnlineMultiplayerMode._handleStateUpdate`. | Unit: `online-opponent-board-writer`. Soak: flicker went from 17–27 per 45 s to 0. |
| F‑3 | **Opponents' rotated pieces were drawn unrotated.** The wire carries a piece's rotation, but the decoder always returned the spawn-orientation shape. Every rotated opponent piece, and its ghost, was wrong until it locked (N7). | The decoder turns the shape to the carried rotation, from a table built once per type. `binary-encoding.js` `_decodePiece`. | Unit: `binary-encoding-roundtrip` (vertical I, flipped T, full and delta). |
| F‑4 | **Opponents' pieces sat half a cell between rows.** The tile repaints when the piece's whole cell changes but drew the interpolated fractional y (N9, P2). | The piece, its ghost and the ghost's drop are drawn at the same rounded cell the repaint check uses. `opponent-watch-manager.js`. | Unit: `opponent-piece-whole-cells`, `opponent-watch-animation`. |
| F‑5 | **Big unreliable packets were refused by Steam.** Legacy `SendP2PPacket` refuses unreliable packets over 1,200 bytes, so storm deltas (1,361 bytes at two players on protocol v1, 2,821 at eight on v2) never left the machine (T8). | The Electron send handler sends an unreliable body over 1,200 bytes as reliable, which Steam fragments. `electron/p2p-packet-codec.js` `resolveP2PSendType`. | Unit: `steam-p2p-packet-codec`. |
| F‑6 | **Lobby and host strings reached markup unescaped (T2).** The places that leaked: the lobby browser escaper (quotes passed through into attributes); Battle Log colours and counts; scoreboard row colours; results placement and score; the watch picker's ids. | One quote-safe escaper (`dom-safety.js`). Colours must be hex and counts must be numbers. | Unit: `online-peer-markup-escaping`, `online-results`. |
| F‑7 | **The test harness lost reliable messages** (§2). | Steam-faithful reliable lane in `network-impairment.js` and the mock send path. | Unit: `network-impairment` (order, once, resend, broadcasts). |
| F‑8 | **The divergence alarm fired on a host that was merely behind.** A peer compared its board with the host's copy whenever the host had applied all its inputs. But gravity locks are not inputs, so a lock the host's copy had yet to make read as a divergence — one lock bonus (50 points) apart, even on a clean link — and froze the player for an exact resync (N5). | The peer records its own score and lines per piece and compares the host's copy against the record for the piece that copy is playing. Three differing comparisons in a row and a 3 s rate limit remain. `ffa/peer-board-agreement.js`. | Unit: `ffa-peer-board-agreement` (one lock behind is not a divergence; a different score at the same piece is; round reset). |
| F‑9 | **Clears that lock by gravity sent their garbage twice** (G1). The host's copy of a peer's board routed the attack, and the peer reported it as well. | The host's copy of a peer's board gets the remote callbacks, so the peer's own report is the only one; host-authoritative attacks (flag) keep routing. `ffa-p2p-game-state.js` `createPhysicsCallbacks`. | Unit: `ffa-attack-once`. |
| F‑10 | **The host inserted garbage in the middle of a cascade** (G2). Garbage went in at once whenever the victim had no falling piece, which includes the whole line-clear animation. | Garbage waits for the victim's next spawn, as on peers and in local play. `ffa-attack-router.js`. | Unit: `ffa-attack-once`. |
| F‑11 | **Opponent boards updated four times a second, not thirty** (N17, found while verifying F‑8). The host built each snapshot from live objects, and its delta baseline kept those references: every board's grid, falling piece and next queue. Each later delta compared the live board with itself, found no change, and left grid, piece and queue out, so they only moved with the keyframes (4 Hz). With the host moving its piece 30 times in 3 s, the other player saw it change 8 times. | The baseline keeps a copy of the keyframe's values. `steam-networking.js` `freezeSnapshotBaseline`. | Unit: `steam-networking-binary-snapshot` (fails without the fix). Browser: the same 3 s now shows 33 changes. Soak: host board on the peer, median 165–211 ms → 89 ms on a clean link (§4). |
| F‑12 | **Rounds began a lock apart** (N18). Each side carried its own board's score into the next round, and a peer's board can end a round one lock away from the host's copy, so the backstop fired at the first piece of the next round. | The round restart carries each player's totals as the host counts them, and peers adopt them. `ffa-round-policy.js` `roundCarryTotals` / `readRoundCarry`. | Unit: `ffa-round-carry`. |

---

## 4. What players experience: measured

**Setup.** Each run uses two windows (four in the last table) on the mock transport, with the
Steam-faithful harness (§2). The tool presses 16 probe keys, then a bot plays in every window
for 45 s (`scripts/mp-soak.mjs`).

**Metrics:**
- **Board changes** count every change to a player's own board (locks, clears, garbage). Over
  the same 45 s, that measures how much the player got to play.
- **Staleness** is the median delay from one player's board changing to another player first
  seeing it.

**Three builds:**
- **A — before:** this pass's harness, with the transport's old resync-on-late-keyframe
  restored by a switch used only for these runs.
- **B — after F‑1 to F‑4:** keyframe wait, a single writer, turned pieces, whole cells.
- **C — after all fixes**, adding F‑8, F‑11 and F‑12.

| Link (each direction) | Build | Second player's board changes (host's) | Probe keys applied in their own keydown | Exact resyncs (requested by the transport) | Staleness: host's board on the peer / peer's on the host |
|---|---|---|---|---|---|
| `lossy`: 5% loss, 10% reorder, 50–150 ms | A | 44 (51) | 15/16 | 6 (11) | 264 / 254 ms |
| | B | 49 (48) | 16/16 | 1 (0) | 301 / 280 ms |
| | **C** | **51 (50)** | **16/16** | **0 (0)** | **203 / 283 ms** |
| `badwifi`: 8% loss plus bursts, 15% reorder, 2% duplicates, 80–240 ms | A | 34 (51) | 11/16 | 8 (17) | 402 / 356 ms |
| | B | 49 (50) | 16/16 | 1 (0) | 339 / 345 ms |
| | **C** | **48 (48)** | **16/16** | **0 (0)** | **268 / 378 ms** |
| clean | B | 49 (50) | 16/16 | 2 (0) | 165 / 172 ms |
| | **C** | **49 (51)** | **16/16** | **0 (0)** | **84 / 177 ms** |

**What the numbers show:**
- **Every exact resync froze a player.** Its barrier stops input until the transfer completes.
  On bad Wi‑Fi with build A, 5 of the 16 probe keys did nothing, and the second player made a
  third fewer board changes than the host. With all fixes, no run of any kind asked for a
  resync.
- **The resyncs left in build B were divergence alarms.** Tracing them found two bugs behind
  them (F‑11, F‑12) and one false alarm (F‑8). The two copies of a board can still drift on a
  lossy link — garbage timing, deferred inputs (N4) — and Phase 2 removes that by design.
- **The host's board on the peer roughly halved** on a clean link (165 → 84 ms), because
  opponent boards now move with every snapshot (F‑11). The peer's board on the host is
  dominated by the host's 67–100 ms input buffer (N6, Phase 1).
- **The price is bytes.** Deltas now carry what changed: on protocol v1 the delta's p95 grew
  from about 550 to 900 bytes at two players, and from 610 to 980 at four. That makes
  protocol v2 (D1, 3–6× smaller) more valuable. F‑5 sends any packet over 1,200 bytes
  reliably rather than losing it.
- **Flicker went to zero.** Before F‑2, the second player saw the host's board go back to an
  older state 27 times in 45 s on a clean link, 26 under 40–60 ms jitter and 17–22 under
  `lossy`. With F‑2 it was 0 in every run.

**Four players, clean link.**

| Build | Staleness, host → peers | Staleness, peer → peer | Flicker per pair | Resyncs |
|---|---|---|---|---|
| A | 124–139 ms | 227–263 ms | 2–5 | 3 |
| **C** | **104–116 ms** | **177–231 ms** | **0** | **0** |

Every probe key applied in its own event in both builds. With four software-rendered windows
sharing 4 vCPUs, the host's frames ran at a median of 67–100 ms, so treat four-player numbers as
relative.

**A note on validity.** In one clean run the browser throttled the host's window to about one
frame a second. The match went into slow motion for everyone: the host's copies, its
snapshots and its decisions all ran on that window. That is what a minimized or starved host
does to a real match (L15, P12). The tool now flags such runs as invalid, and that run is
excluded above.

---

## 5. Findings

**Severity:** P0 breaks matches, fairness or safety; P1 clearly hurts feel or reliability; P2
polish; P3 minor. **Status:** *Fixed* (in this pass, §3), *Open*, or *Partial*. Line
references are to `d01643b`. **Abbreviations:**
- ffa = `src/core/multiplayer/ffa-p2p-game-state.js`
- OMM = `src/core/game-modes/OnlineMultiplayerMode.js`
- SN = `src/core/steam/steam-networking.js`
- OWM = `src/ui/opponent-watch-manager.js`

### 5.1 Netcode feel and sync

| ID | Finding | Sev | Status | Fix · effort · decision |
|---|---|---|---|---|
| N1 | A lost or late keyframe sends the peer into an exact resync that freezes its input and replaces its board. | P0 | **Fixed** (F‑1) | — |
| N2 | With auto-repeat or soft-drop interval at 0, a held key floods the host's 140 inputs/s limit. The host's own drops and rotations are then rejected, and peer commands are acknowledged but discarded, so the boards diverge. Cause: the online input hooks return `undefined`, so instant repeat never stops (OMM:2466-2497, das.js:83-88, input-validator.js:93-108). | P0 | Open | Hooks return the predicted result; host-local input is exempt; only state-changing commands count · S · engineering |
| N3 | A peer whose OS clock is more than 5 s off has every command rejected but still acknowledged (input-validator.js:115-131). | P0 (rare) | Open | Drop the absolute wall-clock check; the sequence and round fences already stop replays · S · engineering |
| N4 | **The peer's board and the host's copy are not deterministic on the default clock.** Garbage enters at each side's own spawn, or immediately on the host (G2). Inputs that land on the host during an async lock are deferred (move and rotate capped at 4) or dropped (soft drops). Gravity and lock delay run in milliseconds against jittered input arrival. Deaths are decided on the host's copy; attacks come from the peer's own board. | P0 | Open | Make garbage acceptance and deferral outcomes events in the peer's input stream; buffer soft drops; long term, piece-indexed garbage (G3) and the fixed tick online · M then L · **decision: amend ADR‑0004** |
| N5 | The divergence check compares only score and lines, after the host has caught up, three snapshots in a row, at most every 3 s. A board that differs only in placement goes unnoticed; when it is noticed, the resync freezes input. | P1 | **Partial** (F‑8 compares at the same piece; a board digest is still open) | Board digest per lock, compared at equal lock counts; count desyncs per match · M · engineering |
| N6 | The host's jitter buffer delays every peer input by 67–100 ms on the default clock and absorbs no jitter. Inputs are labelled with the tick on which they arrive, so the buffer cannot smooth them. This regressed with the July host-input fix. | P1 | Open | Apply peer inputs on arrival on the default clock (or 60 Hz, depth 1) · S · engineering |
| N7 | Opponents' rotated pieces were drawn in spawn orientation. | P1 | **Fixed** (F‑3) | — |
| N8 | Two writers with different ages fed each opponent tile, so tiles flickered on every lock. | P1 | **Fixed** (F‑2) | — |
| N9 | Opponents' pieces were drawn off the grid. | P2 | **Fixed** (F‑4) | — |
| N10 | A host stall moves every board at once: the simulation runs on animation frames with an unclamped frame delta (unified-game-loop.js:157-199). | P1 | Open | Clamp and rebase per ADR‑0012; a timer-driven simulation online · M · engineering |
| N11 | `adaptiveInterp` (off) times its playback in simTick × 16.67 ms, but on the default clock simTick counts host frames. With a 144 Hz host, opponents would run about 820 ms stale. | P1 (trap) | Open | Gate it on the fixed clock · S · engineering |
| N12 | Dead time and lost input around line clears and hit-stop. A clearing lock costs at least 200 ms, plus 128 ms for each extra wave. Presses during 30/70/110 ms of hit-stop are thrown away (OMM:2468-2495; single player does the same). | P2 | Open | Buffer input during hit-stop instead of dropping it · M · **decision (timing is design)** |
| N13 | There is no usable ping. RTT is overwritten 30 times a second with a cross-clock snapshot age (about 0 on protocol v2), and nothing shows a connection indicator. Pings ride the reliable lane, which inflates them under loss. | P2 | Open | Smoothed RTT from ping/pong on an unreliable lane, shown per player · S · **decision (UI)** |
| N14 | With the fixed clock on, host input lags two ticks again (ffa:1499). | P1 | Open | Apply host-local input on the tick it is issued · S · engineering |
| N15 | Flag hygiene. `deterministicGarbage` and `rngV2` have no reader. `garbageDrainAll`, `garbageIdempotent` and `cascadeV2` must match across machines but are per-machine localStorage. `rulesHash` is computed but never checked. | P3 | Open | Delete the dead flags; carry rule switches in `matchConfig` · S · engineering |
| N16 | Packets are read one IPC call at a time on a 16 ms timer, with one IPC send per peer, which quantizes arrival by 0–16 ms. | P2 | Open | Batched read/send · M · engineering |
| N17 | **Opponent boards updated at 4 Hz.** The host's delta baseline held references to the live board, so deltas never carried grid, piece or queue changes. | P0 | **Fixed** (F‑11) | — |
| N18 | Each side carried its own score into the next round, so rounds began a lock apart. | P1 | **Fixed** (F‑12) | — |

### 5.2 Rules, garbage and fairness

| ID | Finding | Sev | Status | Fix · effort · decision |
|---|---|---|---|---|
| G1 | **A peer's clear that locks by gravity or lock delay sends its garbage twice.** The host routes it from its copy, and the peer reports it too. Only input-driven locks skip routing. | P0 | **Fixed** (F‑9) | — |
| G2 | **The host inserts garbage in the middle of a victim's cascade.** Garbage goes in immediately when the victim has no piece, and there is no piece for the whole clear animation. A garbage row is deleted instead of the full row, and a phantom wave scores and attacks. This only happens on the host's copy, so the peer later snaps. | P0 | **Fixed** (F‑10) | — |
| G3 | **Cancelling runs only on the host, against its copy.** Either the host cancels while the peer's board still takes every row (4 vs 1, never detected), or the report arrives after the host's copy spawned and the attack goes through uncancelled. | P0 | Open | Piece-indexed garbage: the host stamps each line with the victim's piece index, and both sides cancel and insert at the same piece, after a deliberate counter window · M · **decision: ADR + rules-version bump** |
| G4 | The host decides where garbage lands and inputs bypass its buffer, so the host has an edge. Model: about 170 ms at 100 ms RTT; about 25% of attacks land one piece apart on the two boards. | P1 | Open | G3 · M |
| G5 | Line clears shift locked-piece fragments up (cascade-helpers.js:154-173). Fuzz over 40,000 locks: 5–6% of clearing locks get wrong hole masks, 1.5–2% send different garbage, 0.4% gain or lose a wave, about 0.1% delete a block. | P1 | Open | Keep absolute rows, plus a cell-conservation property test · S · **rules-version bump** |
| G6 | Every attack goes to every opponent, and the 1-line minimum flattens big clears. At 8 players a double, a triple and a quad all send 1 line to 7 opponents. There is no target choice and so no counterplay. | P1 | Open | One target per attack, with TETR.IO / Tetris 99 targeting modes; or fractional lines if broadcast stays · M · **decision: battle rules** |
| G7 | Kill credit goes to whoever's garbage was inserted last and never expires. | P1 | Open | Quadra-style decaying credit ledger · M · **decision** |
| G8 | Peer attack reports are rate-limited but never checked against the host's copy: a modified client can claim 35 lines per request. | P1 | Open | Depth ≤ occupied rows; a perfect clear only if the copy is empty; quarantine on mismatch · S · engineering |
| G9 | Blind and Full-blind modes are broken online: peers never insert the rows, and counters never cancel. | P1 | Open | Take leading blind entries on peers; skip non-line entries when cancelling · S · engineering |
| G10 | Top-out after garbage uses piece bounding boxes (`y <= 4` vs local `< 4`), so a player can die with every piece still spawnable. | P2 | Open | Kill only when cells overlap the spawn area · S · rules-version bump |
| G11 | Same-tick deaths broadcast "P wins" and then "Draw" twice; ties in time, points and lines modes go to the first player who joined (the host). | P2 | Open | Batch deaths per tick; idempotent `endMatch`; one tie rule · S · **decision (tie rule)** |
| G12 | T, J and L wall kicks are mirrored: they spawn in SRS state 2, but kicks are looked up as state 0. 30–32 of 32 kick cases land off-guideline. | P2 | Open | Offset the lookup by 2 · S · rules-version bump |
| G13 | Local and online play use different rules. Local never applies scaling, has no cancelling, and has a handicap. Online ignores `levelProgression:false` and keeps level across rounds. | P2 | Open | One rules table shared by both · M · **decision** |
| G14 | Little attack depth. T-spins, back-to-back, combos and extra cascade waves add nothing. There is no per-spawn cap, so bursts from 7 opponents land at one spawn. | P2 | Open | Part of the battle-rules decision (G6) · M |
| G15 | Hot potato only bounces between the first two players and carries its timer into the next round. | P2 | Open | Pass to the next seat; reset every round · S · engineering |
| G16 | `registerAttackerIds` is never called, so peers see attackers as `unknown_<hash>`, and after a migration kills credit nobody. | P3 | Open | Call it on roster change · S · engineering |

### 5.3 Session lifecycle

| ID | Finding | Sev | Status | Fix · effort · decision |
|---|---|---|---|---|
| L1 | **Departures are never detected.** Nothing sends `LOBBY_PLAYER_LEFT`, so `removePlayer` is unreachable. The transport's disconnect monitor has no callers. Electron registers no `LobbyChatUpdate`, and `P2PSessionConnectFail` is only logged. Peers merge the host's roster but never remove anyone. | P0 | Open | Forward the Steam member and connection callbacks; track last-seen per peer on every inbound packet; send a keepalive from the welcome onward; best-effort leave message; peers adopt the host's roster wholesale · M · **decision: rejoin window** |
| L2 | **Ghosts break matches.** Every round revives every player. Targeting, scaling, the alive count and the capacity check all count ghosts, and after a migration the dead old host stays live. In a duel the round never ends. | P0 | Open | Exclude disconnected players everywhere; the last player standing wins · S–M · **decision: duel-leaver policy** |
| L3 | Host loss is only noticed while playing. If the host leaves in the waiting room, the countdown, the round-over beat or the results, peers are stuck. | P0 | Open | Monitor in every phase: migrate, or go back to the browser saying "host left" · M |
| L4 | An election has no timeout and can pick a departed or kicked candidate; survivors then wait forever. | P0 | Open | Live candidates only; time out to the next candidate · S |
| L5 | Survivors can split. A claim is ignored unless the receiver's own election has already started, and the candidate claims only once. Any survivor whose 1 s monitor fires late is cut off: it keeps sending to the dead host and drops the new one. | P0 | Open | A claim from the expected candidate starts or joins the receiver's election; re-broadcast claim and sync for about 5 s · S–M |
| L6 | False migrations, and the old host never steps down. Liveness comes from heartbeats only, with a 5 s timeout; packets from the wrong host are dropped silently; `migrationEpoch` is off. A 7 s blip leaves two hosts. | P0 | Open | Any host packet counts as liveness; suspect, then confirm; a "superseded" notice; turn on epoch fencing · M · **decision: timeouts** |
| L7 | Post-migration state is incomplete. Spectators are not carried over. The new host's copies use a different random stream. The Steam lobby owner and the game host diverge, so joins after a migration hang. Nobody sees "X hosts now". | P1 | Partial | Hand the canonical state and random cursor to the successor; carry spectators; a banner; make the Steam owner the host · M–L · **decision: host = Steam owner** |
| L8 | Joining during the start countdown or the round-over beat adds a live player with no board, who never gets the match start. The round can then never end by last-standing. | P0 | Open | A "match active" flag instead of the phase; send the in-progress match start · S |
| L9 | A mid-match rejoin lands in waiting-room limbo with no board, its inputs ignored until the next round. The 10 s grace period is dead code. | P1 | Partial | Reset the player's input transport; send the match start; restore the board or drop in · M · **decision: rejoin semantics** |
| L10 | Anyone can enter. Hellos are admitted without a lobby-membership check, P2P sessions are auto-accepted, kicks leave no ban, and "invite only" creates a friends-joinable lobby. | P1 | Open | Admit only lobby members; a session ban set; a true private lobby; cap spectators · S–M · **decision: private semantics** |
| L11 | Join failures throw the player to the main menu; incompatible lobbies are listed as joinable. | P2 | Open | Grey out incompatible lobbies; show the reason inline · S |
| L12 | Timers and listeners outlive teardown. One peer's rematch vote can restart a live match. A disposed host keeps broadcasting. The migration monitor re-arms without clearing. The chat's key listener leaks once per lobby. | P2 | Partial | Fence or clear all of them; phase-gate the vote; destroy the chat · S |
| L13 | Reliable-queue noise. Two `GAME_SYNCPOINT` messages per line clear per peer, which nobody reads (about 280 per 20 clears at 8 players). About 2 messages a second keep going to each departed peer. | P2 | Open | Stop the broadcast; prune departed peers · S |
| L14 | Steam invites. The `+connect_lobby` launch argument is never parsed; a queued invite never joins at match end; "Join Game" from the friends list does nothing. | P2 | Open | Parse argv; join queued invites at the results · S |
| L15 | A minimized or sleeping host freezes the authoritative simulation while heartbeats continue; sleep over 5 s gives the L6 split. | P2 | Open | Timer-driven simulation online; pause or hand off on suspend · M |
| L16 | A peer's ready toggle is not relayed; no AFK handling; no load barrier at start (`readyBarrier` is off). | P3 | Open | Relay ready; AFK to spectator; a load barrier · S · **decision: AFK policy** |

### 5.4 Steam transport, platform and trust

| ID | Finding | Sev | Status | Fix · effort · decision |
|---|---|---|---|---|
| T1 | **The release build runs as Spacewar (AppID 480).** `init(480)` overwrites the environment Steam sets, so even a launch from Steam becomes 480. | P0 | Open | One AppID constant; `restartAppIfNecessary` before the window; `init()` without an argument when Steam launched the game; packaged builds go offline instead of falling back to 480; a release gate on 480 literals · S · **decision: AppID** |
| T2 | Lobby-owner and host strings reached HTML attributes unescaped. | P0 | **Fixed** (F‑6) | Follow-up: sanitise at ingestion (roster, snapshot, finalStats, lobby list) and a lint rule for template-literal `innerHTML` · S |
| T3 | **The Content Security Policy probably has no effect in packaged builds.** It is set only as a response header, and the app loads with `loadFile` (Electron documents header CSP as unavailable for `file://`). This turns any markup injection into script execution with the preload API. | P0 | Open | A build-time `<meta>` CSP with script hashes (or an `app://` protocol); a packaged smoke test that `eval` throws · S |
| T4 | Admission: see L10. | P1 | Open | — |
| T5 | The transport is Valve's deprecated legacy ISteamNetworking. Relays are only a fallback, `GetP2PSessionState` exposes the remote IP, there are no channels and no session close. | P1 | Open | ISteamNetworkingMessages over Steam Datagram Relay, relay-only for non-friends, behind the existing `SteamNetworking` interface · L · **decision: library** |
| T6 | Departures and connection failures are invisible to gameplay (see L1); a failed reliable send only bumps a counter. | P1 | Open | Forward member-state and connection-failure callbacks; treat a failed reliable send as peer loss · S–M |
| T7 | The Steam lobby owner and the game host diverge after a migration (see L7). | P1 | Open | M |
| T8 | Unreliable deltas over 1,200 bytes were refused by Steam. | P1 | **Fixed** (F‑5) | — |
| T9 | A late keyframe triggered the exact-resync barrier (same as N1). | P1 | **Fixed** (F‑1) | — |
| T10 | One reliable stream, no arbitration. App-level retransmit runs on top of a reliable channel; resync windows can duplicate about 88 KB on slow uploads; control messages wait behind bursts. | P2 | Open | No app-level retransmit on reliable sends; pace by byte budget; prioritise control · M |
| T11 | One IPC round trip per packet (see N16). | P2 | Open | M |
| T12 | Peer strings are unbounded and floods are unthrottled. A 50 KB name was accepted, and a ~60 KB one black-holes roster and match-end packets. Chat is relayed with no size or rate limit. The sequence map grows per sender-chosen channel. | P2 | Open | Cap lengths at ingestion; per-sender token bucket before `JSON.parse`; channel whitelist; throttled logging · S |
| T13 | Host-reported stats are added to every peer's lifetime Steam stats, unclamped (negative values allowed). | P2 | Open | Count only locally observed events; clamp per match · S |
| T14 | Electron hardening. No fuses. Packaged builds honour `STEAMWORKS_MODULE`, `SERENITY_ENABLE_DIAGNOSTICS` and `SERENITY_DISABLE_CSP`. Any http(s) URL goes to `openExternal`. F12 (DevTools, also Steam's screenshot key) and F5 (reload) work in release. | P2 | Open | Fuses; gate env hooks on `!isPackaged`; allowlist `openExternal`; no accelerators in packaged builds · S |
| T15 | Friends can't reliably join. The overlay is never enabled, argv is ignored, accepted invites need a second click within 10 s, `steam_display` is raw text instead of a localisation token, and the lobby list has no filters or distance. | P1 | Open | Parse argv; auto-join accepted invites; rich-presence tokens; A/B the overlay switches · M · **decision: overlay vs WebGPU stability** |
| T16 | Leaderboards, cloud and achievements are dead (probed names don't exist); the Linux build can't start Steam. | P1 (launch) | Open | `client.achievement` / `client.cloud`; leaderboards via ez-steam-api or a new library · M · **decision: Linux target** |
| T17 | **`wireV2` expires on 2026‑10‑31.** From 2026‑11‑01 `flag-registry.test.js` fails, so CI goes red and Pages deploys stop. Nothing changes at runtime. | P1 (process) | Open | Graduate after a one-hour two-machine soak (recommended), or re-date it with an ADR‑0013 note · S · **decision** |

**Wire sizes**, measured with the real encoders:

| Players | Packet | Protocol v1 (JSON + base64) | Protocol v2 (raw frame) |
|---|---|---|---|
| 2 | quiet delta | 472 B | 81 B |
| 2 | keyframe | 966 B | 449 B |
| 8 | quiet delta | 703 B | 165 B |
| 8 | keyframe | 2,685 B | 1,649 B |

Every control message still carries about 250 B of JSON envelope.

**Estimated bandwidth** (not measured): 8 players at 30 Hz with four reliable keyframes a second
need about 1.7–2.0 Mbit/s of host upload on v1, and about 0.7–0.9 Mbit/s on v2.

### 5.5 Client performance (eight players)

JS cost was measured with Node microbenchmarks of the real modules (M). Browser cost — canvas,
layout, GPU — is estimated (E) and not claimed (ADR‑0016).

| ID | Finding | Sev | Status | Fix · effort |
|---|---|---|---|---|
| P1 | Every opponent repaint redraws every block group through the full "premium" piece path: gradients, a clipped sheen and a traced rim. M: about 1,430 canvas calls and 400–600 KB of garbage per repaint, 1.9–2.9 ms of JS when all seven tiles repaint. | P1 | Open | Cache each board's settled stack; draw the falling piece and ghost on a top layer; flat fills or sprites on small tiles · M |
| P2 | Pieces drawn off-grid. | P1 | **Fixed** (F‑4) | — |
| P3 | Two writers per opponent tile. | P1 | **Fixed** (grid, F‑2) | Follow-up: the garbage meter's two feeds still rebuild 60 times a second per opponent with pending garbage · S |
| P4 | The snapshot interpolator is never reset between lobbies. A new host restarts snapshot numbering at 0, so the buffers drop every new snapshot and show the previous match's boards. | P1 | Open | Reset at match setup and per player on roster change · S |
| P5 | The Battle Log rebuilds all its rows (up to 200) on every event. E: 3–7 ms of parse and layout per event late in a match. | P1 | Open | Insert one row per event · S |
| P6 | The peer receive path still deep-copies the world per snapshot. M: 205–315 KB per delta at 8 players, mostly rebuilt one-cell "locked pieces". | P2 | Partial | Skip locked pieces for opponents; read-only views · M |
| P7 | The host allocates a fresh object graph and a zeroed 64 KB buffer per broadcast and makes one IPC call per peer. | P2 | Open | One encode buffer; batched IPC · S–M |
| P8 | The receive poll makes one awaited IPC call per packet (N16). | P2 | Open | Batched read · S |
| P9 | Unchanged dead-state styles are rewritten every frame (about 2.5–4.3k inline style writes a second). | P2 | Open | Return early when nothing changed · S |
| P10 | Loop layout. Four permanent animation loops plus one per effect tile. Phaser and the opponent tiles show the previous tick. Phaser is capped at 60 fps, so a 144 Hz screen alternates 13.9/20.8 ms frames. | P2 | Partial | One online frame driver; cap Phaser at a refresh-rate divisor · M |
| P11 | On integrated GPUs the theme never yields (suspension is a hidden localStorage key), and 52 of 58 piece styles use `shadowBlur` on every tile. | P1 (iGPU) | Open | No blur on tiles; an automatic match-quality governor with a visible setting · S–M |
| P12 | Everything renders at full rate while minimized. | P2 | Open | Timer-driven simulation online (N10); pause visual layers when hidden · M–L |
| P13 | The chat listener leaks once per lobby (L12). | P3 | Open | S |

Online-only work in a typical 8-player frame is about 0.6–3.5 ms (E), with spikes from full-tile
repaints (4–8 ms, E) and Battle Log rebuilds. Allocation runs at about 16–60 MB/s (M bytes × E
rates), which means a minor GC every 0.3–1 s. At two players the overhead is small: 17–25 µs
per broadcast.

### 5.6 Verification and tooling

| ID | Finding | Sev | Status | Fix · effort |
|---|---|---|---|---|
| V1 | 117 multiplayer test files (1,332 tests) pass in about 32 s. But the 4,500-line game state is constructed for real in only 2 files. No test runs game-loop frames on two endpoints, drives more than two endpoints, runs longer than a few virtual seconds, or applies impairment end to end. | P1 | Open | An in-process multi-peer simulation harness (real game states, a virtual clock, Steam-faithful links, a seeded bot), and a lifecycle scenario suite on it · M |
| V2 | The impairment harness was not Steam-faithful. | P1 | **Fixed** (F‑7) | — |
| V3 | `TWO_MACHINE_STEAM_VALIDATION.md` cannot be run as written. Its counters (`desyncsDetected`, `desyncRecoveries`) don't exist; scenario B edits the wrong field; scenario E's URL never turns the harness on. Its run log is empty. | P1 | Open | Rewrite it against a single `getNetHealth()` report · S |
| V4 | No lifecycle coverage. `LOBBY_PLAYER_LEFT` has a handler but no sender; `NET_ERROR` is sent but never handled. | P1 | Open | A static check that every handled wire type has a sender, and every sent type a handler · S |
| V5 | The network budgets in `perf-budgets.json` are never enforced (`snapshotDeltaWireBytesP95` would fail: baseline 490 vs max 80). | P2 | Open | A budget gate fed by the soak · S |
| V6 | Fuzzing covers only one-player empty-board snapshots: not frame v2, the sidecar, chunk assembly, input batches or envelopes. | P2 | Open | fast-check over those; multi-player and garbage-heavy corpora · S–M |
| V7 | Online matches are never recorded, so there is nothing to replay when a desync is reported. | P2 | Open | Log seeds and inputs per match (cheap: the simulation is deterministic) · M |

---

## 6. What the best games do

Two research reports fed this section; the sources are listed under each part. "TN x.y" means
[TETR.IO's patch notes](https://tetr.io/about/patchnotes/) for that version. Claims marked
*(community)* come from reverse-engineering or wikis rather than the developers.

### 6.1 Netcode

- **Each player's own board answers to its own player.** Battlers interact only through garbage,
  so the norm is independent simulations plus a few arbitrated events, not shared-state
  rollback. TETR.IO clients simulate their own boards at 60 fps and send batched input frames
  plus targeting and garbage events. Opponent boards are re-simulated from the relayed inputs;
  they hold when out of data and "speed up slightly to catch up" (TN 3.0.0) *(community, for
  the mechanism)*. Quadra, the original cascade game, exchanges placements (x, y, rotation),
  and every peer replays them deterministically, cascades included
  ([Quadra source](https://github.com/quadra-game/quadra/tree/master/source)).
- **A delay before garbage lands is the fairness and latency buffer.**
  - TETR.IO: garbage travels 20/30/40 frames (333–666 ms) by size (TN 4.2.0); it can be
    cancelled in flight and tanked only when it lands (TN 6.1.0).
  - Tetris 99: incoming lines turn red after 2.5 s (less near the top)
    ([Hard Drop](https://harddrop.com/wiki/Tetris_99)) *(community)*.
  - Puyo: nuisance drops when the receiver's chain ends, giving "exactly one chain to try to
    mitigate" ([Offset rule](https://puyonexus.com/wiki/Offset_rule)).
- **Crossing attacks cancel symmetrically.** Each TETR.IO attack carries its own id and the last
  attack id it had seen from the target, so "attacks sent at the same time (during lag…) cancel
  each other out"; the passthrough variant was dropped as "far too unpredictable" (TN 6.3.4;
  [TetrisWiki](https://tetris.wiki/TETR.IO)). Tetris Effect: Connected patched a lag bug that
  "only registered one player's attack" when both attacked together
  ([1.0.8](https://www.tetriseffect.game/patch-note/xbox-win-10-pc-patch-1-0-8/)).
- **Garbage holes are decided once and sent explicitly.** TETR.IO has "seeded and synchronized"
  hole columns (TN 2.2.5); Quadra sends hole masks. Serenity already does this.
- **Fixed timestep, deterministic simulation, periodic checksums.**
  - [Gaffer on fixed timesteps](https://gafferongames.com/post/fix_your_timestep/).
  - GGRS compares checksums between peers periodically
    ([DesyncDetection](https://docs.rs/ggrs/latest/ggrs/enum.DesyncDetection.html)).
  - Quadra drops a player on an invalid placement.
- **Remote playback.** Source renders 100 ms in the past so one lost snapshot is survivable
  ([Valve](https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking)). Gaffer's
  rule of thumb is about three send intervals plus jitter
  ([snapshot interpolation](https://gafferongames.com/post/snapshot_interpolation/)).
  [Unity Netcode](https://docs.unity3d.com/Packages/com.unity.netcode@1.5/api/Unity.NetCode.ClientTickRate.html)
  adapts the delay. For boards, never extrapolate a lock or a clear: hold, then catch up.
- **Deltas against what the receiver has acknowledged**; every unacknowledged critical event is
  repeated in each packet, de-duplicated by id
  ([Gaffer](https://gafferongames.com/post/snapshot_compression/);
  [Overwatch GDC](https://www.gdcvault.com/play/1024001/-Overwatch-Gameplay-Architecture-and)).
- **Disconnects in two stages.** GGPO shows "interrupted" at 750 ms and disconnects at 5 s
  ([p2p.cpp](https://github.com/pond3r/ggpo/blob/master/src/lib/ggpo/backends/p2p.cpp)).
  TETR.IO gives a ranked player "at minimum 45 seconds" to reconnect, once per match
  (TN 1.2.0). Quadra holds a slot for 180 s.
- **Host advantage is neutralised, not ignored.** "Time delay" equalises latency
  ([Tokey et al.](https://web.cs.wpi.edu/~claypool/papers/adaptive-fdg-26/paper.pdf)), and
  local-lag trades a little responsiveness for consistency
  ([Mauve](https://publications.cs.hhu.de/Mauve2004a.html)).
- **Steam.**
  - Legacy ISteamNetworking is deprecated: unreliable packets are capped at 1,200 B, and relays
    are only a fallback ([docs](https://partner.steamgames.com/doc/api/ISteamNetworking)).
  - ISteamNetworkingMessages adds channels and session handling over Steam Datagram Relay
    ([docs](https://partner.steamgames.com/doc/api/ISteamNetworkingMessages)). The relay never
    reveals IP addresses
    ([SDR](https://partner.steamgames.com/doc/features/multiplayer/steamdatagramrelay)).
  - The Rust crate under steamworks.js already wraps it
    ([steamworks-rs](https://github.com/Noxime/steamworks-rs/blob/master/src/networking_messages.rs)),
    but steamworks.js 0.4 exposes only the legacy calls
    ([typings](https://unpkg.com/steamworks.js@0.4.0/client.d.ts)).
  - The lobby owner is reassigned automatically when the owner leaves, and only the owner sets
    lobby data
    ([ISteamMatchmaking](https://partner.steamgames.com/doc/api/ISteamMatchmaking)).

### 6.2 Product and UX

- **One or two inputs to a game, seconds to the next.**
  - TETR.IO Quick Play is one persistent free-for-all you can "jump in at any time" (TN 1.0.0).
  - Jstris drops you into a live room on load.
  - Tetris 99 is one button and "another game within seconds"
    ([review](https://vooks.net/tetris-99-switch-eshop-review)).
  - Rematches are nearly frictionless: EXIT returns to the room lobby (TN A5.2.3), and "Stride
    Mode" speeds up everything between games (TN A2.2.7).
- **Don't fragment a small population.** The top Steam complaint about Puyo Puyo Tetris 2,
  Puyo Puyo Champions and Tetris Effect is dead or split queues ("the online is DEAD AF", 112
  helpful votes). Leaders keep one casual queue, one ranked queue and private rooms, concentrate
  players with events, and label any bots.
- **Lobby browser.**
  - Show ping (Steam ping locations), region, players out of the maximum, round state and
    rules.
  - Let players spectate a full room.
  - Widen the distance step by step. Valve calls Worldwide "not recommended, expect multiple
    seconds of latency"
    ([ISteamMatchmaking](https://partner.steamgames.com/doc/api/ISteamMatchmaking)).
- **Idle lobbies.** Auto-start when ready, use a ready timeout (TE:C: 20 s), and move AFK
  players to spectator (TN Infdev 0.5.0).
- **Connection UX.** A per-player connection icon, your own ping, and "reconnecting…"
  (TN A2.5.4–5, A4.2.0).
- **Readable threat and fair free-for-all.**
  - Tetris 99's incoming column goes yellow → red → flashing.
  - TETR.IO shows "how many people target you", has payback and defence bonuses (TN A6.4.0),
    and weighted targeting "to fix the insane pileons".
- **Leavers.** Dim a dropped board, give a rejoin window, then count it as a KO credited to the
  last attacker, and show DNF in the results. A disconnect that denies the winner credit is a
  recurring Tetris Effect complaint.
- **Spectating and replays.**
  - TETR.IO lets you watch a game already underway, pin a player, and replay matches with a
    seekable timeline (TN A5.2.0).
  - A Puyo community essay calls spectator mode "the only one that must be included" for
    tournaments and streaming.
- **Accessibility.** No information by colour alone, and an option against flicker
  ([Game Accessibility Guidelines](https://gameaccessibilityguidelines.com/full-list/));
  colour-blind modes and shake toggles (TE:C); fewer effects on small opponent boards at 5+
  players (TN Infdev 0.2.1).
- **Integrity.** Steam Datagram Relay hides IP addresses. Never trust client-reported results,
  and publish conduct rules ([TETR.IO rules](https://tetr.io/about/rules/)).

---

## 7. The gold standard for Serenity Blocks

**Principles.**

1. **Your board is yours.** Input applies in the same event handler with no added latency. The
   network never freezes your input or snaps your board in normal play. A correction happens
   only on proven divergence, and that should be rare.
2. **What you see of others is fresh and honest.** Opponent boards arrive as soon as the link
   allows, never flicker, and show pieces as they are: turned, on whole cells.
3. **Every attack counts exactly once and lands at the same piece on both copies of a board,**
   after a visible counter window. Crossing attacks cancel symmetrically.
4. **Sessions survive real life.** Leavers are detected in seconds, and blips get a reconnect
   window. Losing the host, in any phase, converges on one host or ends cleanly with a reason.
5. **Fair by construction.** The host has no timing edge on garbage; deaths, credit and ties
   follow one written rule shared by local and online play.
6. **Safe.** Nothing from the network reaches markup, the filesystem or Steam stats unvalidated;
   IP addresses stay hidden; only lobby members enter.
7. **Observable.** One network-health report per match; desyncs, resyncs, input gaps and bytes
   counted; budgets gated in CI.
8. **Quick to play.** A game is one or two inputs away; a rematch takes under 10 seconds.

**Budgets.** Each is checked on the soak harness (L3) and confirmed on two machines (L4).
"Today" figures are from the soak harness after this pass (§4), so their absolute latencies are
inflated by software rendering.

| Area | Gold standard | Today |
|---|---|---|
| Own input → own board | Applied in the keydown handler, drawn on the next frame | Met (16 of 16 probes) |
| Input freezes in normal play | 0 per match, up to 5% loss and 250 ms jitter | 0 after F‑1 (6–14 per 45 s before) |
| Exact resyncs | Proven divergence only; ≤ 1 per 10 min at 2% loss | 0 in every soak after this pass; drift by design remains possible on lossy links (N4) |
| Opponent board staleness | One-way latency + ≤ 50 ms at the median and + ≤ 100 ms at p95 on a clean link; hold, never extrapolate | Clean link, harness: host's board on a peer 84 ms median, a peer's board on the host 177 ms (the 67–100 ms input buffer, N6) |
| Flicker and off-grid pieces | None | None after F‑2 and F‑4 |
| Departure detection | "Interrupted" at 0.75 s; departed in ≤ 2 s from Steam's callback or ≤ 5 s of silence; slot held for the rejoin window | Never detected |
| Host loss | One host within 3 s, every survivor, no duplicate garbage; outside play, a clean exit with a reason | Can strand, hang or split |
| Join | Lobby click → waiting room ≤ 3 s; joins in countdown included; mid-match joins at the next round | Countdown joins break the round (L8) |
| Attack accounting | Each attack once; same landing piece on both copies; symmetric cancel; visible counter window | Once after F‑9; host-only cancel (G3) |
| Unreliable packet size | ≤ 1,200 B | Met after F‑5 |
| Host upload at 8 players | ≤ 1 Mbit/s | About 1.7–2.0 Mbit/s on v1 (estimate) |
| Online frame overhead at 8 players | p95 ≤ 2 ms; no UI spike over 4 ms | About 0.6–3.5 ms, spikes of 4–8 ms (estimate) |
| Trust | Peer strings never reach markup raw; CSP effective; lobby members only; stats observed locally | Escaping met after F‑6; the rest open |

---

## 8. Roadmap

The phases are ordered by what players feel and by what the later phases depend on.
Effort: S ≈ a day, M ≈ a week, L = several weeks.

**Phase 0 — this pass (done).** F‑1 to F‑12 (§3).

**Phase 1 — correctness and safety, engineering only.**
- *Lifecycle:*
  - L1, L2: departure detection end to end, ghosts excluded everywhere;
  - L3–L5: host loss in every phase, live candidates with a timeout, claims that converge;
  - L8: countdown joins;
  - L12, L13: teardown hygiene and the `GAME_SYNCPOINT` noise.
- *Rules (no rules change):*
  - G8: plausibility checks on peer attack reports;
  - G9: Blind mode;
  - G15: hot potato;
  - G16: attacker ids.
- *Feel:*
  - N2: ARR = 0;
  - N3: clock skew;
  - N6: apply peer inputs on arrival;
  - N10: clamp the frame delta;
  - N11: gate adaptive interpolation;
  - N14: host input on the fixed clock.
- *Safety:*
  - T3: an effective CSP;
  - T12: string caps and flood buckets;
  - T13: stats observed locally;
  - T14: Electron hardening;
  - L10: lobby-member admission and bans.
- *Performance:*
  - P3: the garbage meter's second feed;
  - P4: interpolator reset;
  - P5: an incremental Battle Log;
  - P9: dead-state writes;
  - P11: no blur on tiles.
- *Verification:*
  - V1: the multi-peer simulation harness and lifecycle suite;
  - V3: a runnable two-machine checklist;
  - V4: the wire-liveness check;
  - V5: the budget gate;
  - and the `wireV2` decision (T17) before 2026‑10‑31.
- **Exit:**
  - The lifecycle scenarios (§10) all end the gold-standard way.
  - Soak matrix, 2–4 players × clean, 50 ms jitter, lossy, bad Wi‑Fi and burst: zero input
    freezes, zero transport resyncs, zero input gaps.
  - One two-machine run is recorded.

**Phase 2 — fair by design** *(needs ADR‑0004 amended and a rules-version bump).*
- N4/G3/G4: piece-indexed garbage. The host stamps each line with the victim's piece index; both
  copies cancel and insert at the same piece after a counter window, and crossing attacks
  cancel by acknowledgement ids.
- N5: a per-lock board digest.
- The fixed tick online: clears resolve synchronously with a deterministic spawn tick, and N14.
- G5, G10, G12: the rules fixes.
- G11: one tie rule.
- Neutralise host advantage: order attacks by the sender's tick.
- **Exit:**
  - Two-sided garbage tests give equal boards for both arrival orders.
  - Desyncs ≈ 0 per hour on the soak; a two-machine hour with digests matching.

**Phase 3 — a real Steam game** *(needs the AppID and a library decision).*
- T1: AppID and `restartAppIfNecessary`.
- T5: ISteamNetworkingMessages over Steam Datagram Relay, behind today's `SteamNetworking`
  interface, with batched IPC (N16).
- L7/T7: the game host follows the Steam lobby owner.
- T15: invites, argv, rich-presence tokens, the overlay A/B.
- T16: achievements, cloud and leaderboards.
- Lobby filters by version and distance, and ping in the browser.
- **Exit:** two machines on different networks show a relayed connection with no remote IP; a
  cold-start invite lands in the lobby; the overlay opens.

**Phase 4 — the product.**
- Quick match: join the fullest compatible room, or create one with auto-start.
- Rematch in under 10 s; a fast-transition option.
- A reconnect window with "interrupted / reconnecting" states and DNF in the results.
- A connection indicator (N13).
- The battle-rules decision: targeting modes and "N targeting you" (G6), decaying kill credit
  (G7), attack depth and a per-spawn cap (G14).
- Spectator tools: follow a player, the KO feed.
- Match recording and replays (V7).
- A rules card and a short attack/cascade tutorial before the first online match.
- Accessibility: shape markers, fewer effects on small tiles.

**Phase 5 — performance at eight players.**
- P1: cached tile stacks.
- P6, P7: allocation.
- P8/N16: batched IPC.
- P10: one frame driver.
- P12: minimized behaviour.
- An integrated-GPU match governor.

---

## 9. Decisions for you

| # | Decision | Recommendation | Blocks |
|---|---|---|---|
| D1 | `wireV2` (expires 2026‑10‑31) | **Graduate it.** Run a one-hour two-machine soak first and keep an undated v1 rollback switch; it makes the main snapshot 3–6× smaller. If the soak can't happen in time, re-date it with an ADR‑0013 note. | CI on 2026‑11‑01 |
| D2 | Steam AppID | Provide it; nothing ships as 480. | Phase 3 |
| D3 | Amend ADR‑0004 | **Each player's board is authoritative for its own placements.** The host arbitrates garbage timing as piece-indexed events, validates placements and attacks for plausibility, and keeps snapshots for joins, spectators and recovery. | Phase 2 |
| D4 | Rules-version bump | One bump containing: line clears keep absolute rows (G5), top-out by cell overlap (G10), T/J/L kicks (G12), and piece-indexed garbage with a counter window (G3). | Phase 2 |
| D5 | Free-for-all battle rules | One target per attack, with modes (random, attackers, KOs, even) and "N targeting you". A per-spawn cap of about 8 lines. A cascade-wave bonus — the game's identity. Decaying kill credit. Online handicap available. | Phase 4 |
| D6 | Leavers and reconnects | "Interrupted" at 0.75 s, departed at 5 s, slot held 45 s, one rejoin per match. A leaver counts as KO'd (credit to the last attacker). In a duel, leaving loses. | Phase 1 (defaults), Phase 4 (UI) |
| D7 | Private lobbies | "Invite only" becomes a truly private lobby; friends-only is a separate option. | Phase 1 |
| D8 | Host = Steam lobby owner | Yes: Steam already hands ownership over when the owner leaves, and only the owner can update lobby data. | Phase 3 |
| D9 | Transport library | Fork steamworks.js to expose the networking-messages and utils modules that steamworks-rs already has, plus lobby filters and `SetLobbyOwner`. The alternative, steamworks-ffi-node, is a new dependency that would need vetting. | Phase 3 |
| D10 | Hit-stop and clear timing online (N12) | Keep hit-stop as a visual, but buffer input during it instead of dropping it, in every mode. | Phase 2 |
| D11 | Ties (G11) | A tie is a draw, as in local play. | Phase 1 |
| D12 | Overlay vs WebGPU stability (T15), Linux target (T16) | A/B the overlay switches on a test branch; decide Linux after Windows ships. | Phase 3 |

---

## 10. Verification ladder

A change to online play is done when it has climbed every rung its risk calls for.

| Rung | What | When |
|---|---|---|
| L0 static | Lint, types, architecture fitness. Planned: the wire-liveness check (every handled type has a sender, and every sent type a handler) and flag-expiry hygiene. | Every PR |
| L1 unit | The 1,100+ online tests. Planned: one that pins the harness to Steam's reliable lane (added in this pass). | Every PR |
| L2 simulation | Planned (V1). 2–8 real game states over a Steam-faithful virtual link, a fake clock and a seeded bot, checking invariants. About 60 s on fixed seeds per PR, random seeds nightly. | Every PR touching `src/core/{multiplayer,network,steam}` |
| L3 browser soak | `scripts/mp-soak.mjs`: N windows on the mock transport, a bot, a preset network. It reports input-to-board time, opponent staleness, flicker, own-board corrections, resyncs by reason, validation failures and frame pacing (§11). | Nightly, and before every release, × the impairment matrix |
| L4 two machines on Steam | A rewritten `TWO_MACHINE_STEAM_VALIDATION.md` (V3) run on packaged builds, with the same probes pasted into DevTools. | Each release candidate |

**The scenarios Phase 1 must turn green**, from the lifecycle audit's repro set. Each one is
written today as a demonstration of the failure; port them failing-first.

| Code | Scenario |
|---|---|
| S1 | waiting-room leave |
| S2 | mid-match crash leaves a ghost |
| S3b, M2 | claim race splits survivors |
| S4 | ghost candidate hangs the election |
| S5 | host dies in the round beat |
| S6 | host leaves the waiting room |
| M1 | old host stays alive on the new host |
| M3 | orphaned monitor interval |
| R1 | mid-match rejoin limbo |
| K1 | kick without a ban |
| K2 | kicked player persists and is elected |
| A1 | a stranger is admitted |
| T1 | rematch vote mid-match, plus a zombie timer |
| T2 | barrier timer on a disposed peer |
| B1 | `GAME_SYNCPOINT` count |
| W1 | duel host crash leaves a ghost |
| SP1 | spectator orphaned after migration |
| SP2 | departed spectator never removed |
| N1 | duel peer 7 s blip splits the session |
| N2 | host 7 s blip: the old host never steps down |
| J1 | join during the countdown |
| G1 | new host lacks the survivors' random cursor |
| C1 | +6 s clock skew |
| RD1 | ready not relayed |

---

## 11. Evidence and how to reproduce it

- **Browser soak:** `scripts/mp-soak.mjs` (§10, L3) with the dev server running. Example:
  `node scripts/mp-soak.mjs --out=artifacts/mp-soak/lossy --players=2 --seconds=45 --impair="netImpair=lossy"`.
  It prints the report and writes `raw.json`; `--report=<dir>` re-prints the report.
- **Harness presets** (`src/core/network/network-impairment.js`), with delays one way per leg:

  | Preset | Delay | Loss | Other |
  |---|---|---|---|
  | `lossy` | 50–150 ms | 5% (unreliable only) | 10% reorder |
  | `burst` | 40–120 ms | 2%, plus bursts of 4 | 8% reorder |
  | `badwifi` | 80–240 ms | 8%, plus bursts of 3 | 15% reorder, 2% duplicates |

  - Reliable messages are never lost or reordered. A loss costs them a resend of about one
    round trip, plus queueing behind it.
  - `reliableChaos` restores the old non-Steam behaviour for stress tests.
- **Unit tests added or changed in this pass:**
  - `network-impairment`;
  - `steam-networking-binary-snapshot`;
  - `steam-networking-raw-snapshot-v2`;
  - `steam-p2p-packet-codec`;
  - `binary-encoding-roundtrip`;
  - `online-opponent-board-writer`;
  - `opponent-piece-whole-cells`;
  - `opponent-watch-animation`;
  - `online-peer-markup-escaping`;
  - `online-results`;
  - `ffa-peer-board-agreement`;
  - `ffa-desync-detection`;
  - `ffa-attack-once`.
- **The audit's scratch repros were not committed.** These were the 28 lifecycle scenarios,
  the rules fuzz and repro scripts, and the performance microbenchmarks. Each one is described
  in its finding above with enough detail to rebuild it. The lifecycle scenarios used real
  `FFAGameStateP2P` instances over mock `SteamNetworking` objects. A loopback "wire" between
  them serialized every message and could cut, blackhole or restore a node, with fake timers
  and the game loop stubbed. That design is the seed for V1.
- **Earlier documents** this audit builds on:
  - `REPOSITORY_AUDIT_2026-10-03.md` (§2–§4: online lifecycle, Steam, trust);
  - `ONLINE_MP_PERFORMANCE_REVIEW_2026-07-18.md` (its P0-1 to P0-3 landed; P0-6 to P0-8 are
    partial: N16, P6, P8);
  - `ARCHITECTURAL_REMEDIATION_PLAN.md` §5–§6 (fixed tick, determinism, transport);
  - `TWO_MACHINE_STEAM_VALIDATION.md` (to be rewritten, V3).
