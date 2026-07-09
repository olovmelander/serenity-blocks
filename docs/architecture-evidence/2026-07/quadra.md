# Quadra deep-dive: additional architecture patterns worth importing

Source: `C:/Users/olovm/repositories/quadra` (Quadra 1.3.0, C++/SDL2, Ludus Design 1998–2000, LGPL). This pass goes beyond the five takeaways already in `docs/ARCHITECTURAL_REMEDIATION_PLAN.md` ("Quadra reference takeaways (2026-06-30)": recording format, stats decoder-ring, late-join sync points, packet range validation, rule/protocol version gates). Everything below is *additional* or a materially deeper mechanism behind one of those five. Patterns are described with file references, why they matter for Serenity Blocks (Electron/JS, Steam P2P, host-authoritative), and which plan phase they feed. Import patterns, not source — LGPL, different era.

## 0. Quadra's actual sync model, in one paragraph (context for everything else)

Quadra is **not** lockstep-deterministic across the wire. Each client simulates *only its own player* authoritatively at a fixed 100 Hz tick; everything about remote players is reconstructed from an ordered, server-relayed **event stream** (block stamped, lines sent, died, respawned) plus a **cosmetic input stream** used purely to animate remote pieces. Fairness comes from a shared RNG seed (every player's `Canvas` is constructed with the same `game_seed`, so everyone draws the identical piece sequence — `game.cc:146`, `net_server.cc:428`). Consistency comes from every peer applying the same authoritative events to its replica boards, with a hard plausibility check on each event. This is *exactly* the model Serenity Blocks has converged on (host-relayed events + local sim + snapshots), which is why Quadra's edge-case machinery maps so cleanly.

---

## 1. Fixed-timestep accumulator loop with an explicit catch-up policy

**Mechanism.** `main_loop()` (`source/quadra.cc:410-507`) runs a classic accumulator: `while (acc >= 10) { acc -= 10; overmind.step(); }` — one logical frame per 10 ms (100 Hz), with rendering (`ecran->draw_zone()`, `video->end_frame()`) decoupled and run once per outer iteration. The interesting parts are the two overload valves (`quadra.cc:497-505`): if the accumulator exceeds 300 ms, the game *jumps `overmind.framecount` forward* and clamps `acc` to 300 (accepting a small time-warp instead of a spiral-of-death); past 10 s it logs "Not enough CPU time to be server!" and forfeits nearly all owed frames. Debug keys and UI buttons implement slow-mo/turbo by scaling accumulator inflow (`TIME_SLOW`/`TIME_FAST`, `quadra.cc:487-496`), and `TIME_FREEZE` pins `acc = 10` so menu fades run exactly one tick per render. `Overmind` itself (`overmind.cc:53-74`) is trivially simple: a monotonically increasing `framecount` and a list of `Executor`s stepped in order — the *whole game* (each player, the recorder, the net pump) is executors on this one clock, and `framecount` is the only timestamp used by recording, playback, and scheduling.

**Relevance.** Serenity Blocks' Phase 5 determinism program needs precisely this: one logical clock owned by the simulation, render decoupled, and a *written-down* catch-up policy (when do we warp, when do we drop, what does the host do during a 2 s GC pause). Quadra shows the policy can be three lines — but it must exist and be logged, because "framecount jumps forward on overload" is a semantic decision that affects garbage timing and match timers. The slow-mo/turbo lever is also worth keeping: driving the same `step()` from a scaled accumulator gives replay scrubbing and fast-forward for free.

**Plan hook.** Phase 5 (deterministic core loop, tick ownership, replay fast-forward); Phase 3c perf budgets (the 300 ms / 10 s thresholds are budget enforcement inside the loop).

## 2. Headless accelerated replay verification with a CI-able exit code

**Mechanism.** `quadra -debug -verify <file.qrec>` (`quadra.cc:674-682`) sets `no_video/no_sound`, loads the demo, and the main loop switches to `acc=500; while (acc--) overmind.step();` (`quadra.cc:417-420`) — 500 simulation ticks per outer loop, no rendering: *the same binary* re-simulates the match as fast as the CPU allows. At demo end, `Playback::verify_summary()` (`recording.cc:171-182`) calls `Game::verifygameinfo(sum)` (`game.cc:716-755`), which compares re-simulated score/lines/level against the summary hunk stored in the file, and the *process exit code* is the verdict: `return !demo_verif || demo_verified_and_valid ? 0 : 1;` (`quadra.cc:796`). The comment at `game.cc:718-722` is candid about scope: only single-player runs are verified ("Verifying multi-player games could be done by a hypothetical qserv.pl that gathers demos… but it's a lot simpler to set up trusted servers").

**Relevance.** This is the missing keystone behind the plan's "replay verifier" line: verification is not a separate tool, it is the game with rendering amputated, driven fast, ending in a boolean. Requirements it implies for Serenity Blocks: (a) the core sim must run in Node/Vitest with zero DOM/Phaser/Electron imports (Phase 4 boundary work is a prerequisite); (b) the match artifact must end with a summary block (final scores, per-player stats) that re-simulation is compared against; (c) `npm run verify-replay <file>` exits non-zero on divergence and gates CI over a corpus of golden replays. Quadra also states the honest trust boundary out loud: replay verification proves *self-consistency*; only a trusted machine re-running it proves anything to others — the right posture for the plan's ranked-trust discussion.

**Plan hook.** Phase 5 (replay verifier + golden replay corpus in CI); Phase 8 ("demo or it didn't happen" evidence for ranked/high scores).

## 3. Late join, demo playback, and reconnection are ONE code path

**Mechanism.** Deeper than the harvested "late joins wait for a sync point": the recording file *begins with the exact packet a late joiner would receive*. `Game::prepare_recording()` calls `Net_pendingjoin::load_packet_gameserver(&p)` and writes that `Packet_gameserver` as the first hunk (`game.cc:843-847`). Playback then constructs the game with the same constructor a network client uses — `new Game(packet_gameserver)` (`recording.cc:360-372`, `game.cc:112-164`) — and `Net_list::step_all()` feeds recorded packets into `game->net_client->net_call(...)` when their frame stamp comes due (`net_list.cc:419-438`). Demo playback literally *is* a client joining a server whose relay stream happens to come from disk. Reconnection reuses the same machinery: a returning player with the same name + `player_hash` gets `accepted=4` ("replace this guy"), and a `P_REJOIN` rebinds the existing canvas to the new connection while preserving stats (`net_server.cc:356-395`).

**Relevance.** Serenity Blocks currently has three separately-implemented flows (downloadJoin, spectator join, and a nascent replay idea). Quadra proves they can be one: define the join-snapshot message once, make the recorder write it as record zero, and make playback a `NetAdapter` that reads from a file instead of Steam. That collapses three test surfaces into one and turns every recorded match into a regression test for the late-join path itself.

**Plan hook.** Phase 6 (download-join/resync extraction — design the join snapshot as the recording header); Phase 5 (match artifact format = join snapshot + frame-stamped events + summary).

## 4. The join snapshot's exhaustive checklist (what "board state" really means)

**Mechanism.** `Net_pendingjoin::step()` (`net_server.cc:654-764`) refuses to snapshot until: nothing is pending on the packet stack, `syncpoint == Canvas::LAST`, and every canvas is idle and not dying (`net_server.cc:670-685`). It then sends, per player, a `Packet_download` (`packets.h:427-449`) containing: the 32×10 block/occupied/blinded grids; the **current cursor of that player's RNG** (`d.seed = c->rnd.get_seed()`, `net_server.cc:711`); current/next/next2/next3 piece ids; the full pending-garbage queue with per-line hole bitmasks, blind timers and `final` flags (`bon[20]`); the per-opponent attack-credit table `attacks[MAXPLAYERS]` and `last_attacker` (`net_server.cc:740-742`); followed by a `Packet_stat` carrying every stat counter, with the stat-table length itself gated by protocol version (`net_server.cc:747-752`).

**Relevance.** The two most common late-join desyncs in this genre are (a) serializing the RNG *seed* but not its *position*, and (b) forgetting in-flight garbage and attack-attribution state. `Packet_download` is a ready-made field checklist for the Phase 6 snapshot schema: grid, RNG cursor, piece pipeline, pending garbage with exact hole data, causality tables, stats. Rule of thumb it encodes: anything the sim reads that is not in the snapshot is a future desync.

**Plan hook.** Phase 6 (snapshot schema/field audit); Phase 3 (test that diffs "state after snapshot-join" vs "state after simulating from the start").

## 5. Cosmetic input stream vs validated authoritative events (`DROP_INVALID_BLOCK`)

**Mechanism.** Local play encodes inputs one byte per tick as a bitmask (1=down, 2=left, 4=right, 8=rotL, 16=rotR, 32=rot180, 64=drop — `player.cc:147-208`), flushed every 50 bytes or at piece lock (`canvas.cc:1108-1118`, `player.cc:479`). Remote canvases replay these bytes one per tick purely to animate the falling piece (`Player_wait_block::step`, `player.cc:1288-1358`, with a 4000-byte buffer cap at `player.cc:1312` and a 50-byte jitter reserve during playback at `player.cc:1291-1295`). The *authoritative* action is `Packet_stampblock` — final x/y/rotation plus rotation-count and time-held telemetry (`player.cc:480-499`). On receipt, every peer teleports the piece to the stamped pose and validates it: `if(canvas->collide(p->x,p->y,p->rotate) || !canvas->collide(p->x,p->y+1,p->rotate))` — the placement either overlaps the stack or floats — and the **server drops the player with `DROP_INVALID_BLOCK`** and a user-facing support message (`player.cc:1410-1421`). Divergence in the cosmetic stream is expected and tolerated because the stamp resynchronizes the piece; the server won't even relay move packets under 25 bytes (`net_server.cc:566-583`).

**Relevance.** The strongest single import. It names the layering the plan gropes toward: **inputs are animation, placements are truth, and truth is checked against the receiver's replica**. The "collides OR floats" check is a two-line semantic firewall that catches desyncs *and* trivial cheats at one choke point, and converts them into an attributable, logged, user-explained drop rather than a silently corrupted match. Serenity Blocks equivalent: the host validates every `piece-locked`/garbage event against its replica of that board; on failure it logs a `desync_or_cheat` event with both board hashes and quarantines the player. This directly addresses the plan's "raw 30 Hz snapshots stomping interpolated currentPiece" bug class: snapshots/inputs are cosmetic, lock events are truth.

**Plan hook.** Phase 6 (protocol roles: cosmetic vs authoritative messages; the bit-packed input byte is also a wire-compaction blueprint); Phases 1/8 (trust: plausibility firewall + attributable drops).

## 6. Attack causality as a decaying credit ledger (kill attribution done cheaply)

**Mechanism.** Every canvas keeps `attacks[MAXPLAYERS]` and `last_attacker` (`canvas.h:119`). When garbage arrives, the sender's slot gains `2×lines` (saturating at 255) and `last_attacker` moves to whoever holds the highest credit (`Canvas::add_packet`, `canvas.cc:417-427`). Each time the victim locks a piece, all credits decay by 1, and a sender whose credit reaches zero stops being `last_attacker` (`player.cc:1446-1452`). On death, `last_attacker` gets the frag, with "overkill" stats for garbage beyond death (`player.cc:1144-1202`). Two correctness subtleties are preserved in comments: credits are deliberately *not* flushed on drop/rejoin, because peers may be mid-death and would disagree on frag counts (`net_list.cc:1270-1301`); and the entire ledger ships in the join snapshot (§4).

**Relevance.** Serenity Blocks FFA needs kill/assist attribution for the battle log, badges, and eventual elimination modes. The decaying ledger is O(players) memory, deterministic, replays cleanly from the event stream, and answers "who eliminated whom" without timestamps or heuristics. The rejoin comment is a warning to steal verbatim: attribution state must survive player churn or peers will disagree.

**Plan hook.** Phase 5 (attribution as a pure function of the event stream — golden tests); Phase 6 (ledger in snapshot); battle-log feature backlog.

## 7. Interest management: spectating as per-board subscription

**Mechanism.** Watchers don't get everything. A client sends `P_CLIENTSTARTWATCH {player, stop}` and the server maintains a `watchers` list *per canvas* (`net_server.cc:549-564`, `canvas.cc:1072-1083`); the high-rate move stream is then relayed **only to connections watching that board** (`Net_server::clientmoves`, `net_server.cc:566-583`). Low-rate authoritative events (stamps, lines, deaths) go to everyone via `Net::dispatch`, which excludes the originating connection and filters through `is_dispatchable` (joined-or-chat only — `net.cc:1084-1094`, `net_stuff.cc:209-219`). UI panes subscribe/unsubscribe as boards are shown/hidden (`pane.cc:2043-2060`). A game-level `wants_moves` capability flag in the join packet (`packets.h:176`) can disable input streaming entirely; playback games set it false (`recording.cc:371`).

**Relevance.** Serenity Blocks broadcasts 30 Hz opponent snapshots to all peers regardless of what's on screen. Quadra's pattern — cheap events for everyone, expensive streams only for subscribed viewers, subscription driven by UI layout — maps directly onto Steam P2P bandwidth budgets (the plan's "snapshot bytes / reliable-message volume" invariant), especially at 6–8 players where most boards render as thumbnails that don't need per-tick fidelity.

**Plan hook.** Phase 6 (subscription tiers for opponent state; `wants_moves`-style capability flags in the join handshake); Phase 3c (bandwidth budget tests).

## 8. Server-relay hygiene: rename-on-relay, sender binding, pre-join allowlist, record-at-relay

**Mechanism.** Every client→server packet type has a distinct id (`P_CLIENTSTAMPBLOCK`) from its server→clients rebroadcast (`P_STAMPBLOCK`); the relay is a *rename*: `net->dispatch(p2, P_STAMPBLOCK, p2->from)` (`net_server.cc:293-343`; enum at `packets.h:37-88`). Clients only register handlers for the server-flavored ids (`Net_client` constructor, `net_server.cc:33-57`), so a malicious peer cannot inject "the server said" messages — they'd arrive with a client-flavored id and be ignored. Before relaying, the server checks: (a) the packet's player id maps to a live canvas; (b) **the originating connection owns that player** — `c->remote_adr != p2->from` → logged and dropped (`net_server.cc:244-268`); (c) un-joined connections may only send `P_WANTJOIN`/`P_CLIENTCHAT` (`net_server.cc:270-275`). Recording happens at the relay point (`record_packet` beside each `dispatch`), so the artifact is exactly the stream clients saw.

**Relevance.** Maps one-to-one onto the Steam P2P host: message envelopes should encode direction in the *type* (`c2h_*` vs `h2p_*`), the host must bind Steam identity → player slot at join and enforce it on every message, and a pre-join message-type allowlist is the cheapest confusion/DoS firewall available. "Record at the relay point" is also the correct tap for the Phase 5 match artifact — at the host, not per client.

**Plan hook.** Phase 6 (protocol schema: direction-typed messages, sender-binding table, pre-join allowlist); Phase 1 (host-side identity checks are release blockers for a paid product).

## 9. Typed structured log events as first-class packets (`Packet_serverlog`)

**Mechanism.** Beyond raw packet recording, Quadra defines `Packet_serverlog` — an event-type string plus ordered name/value vars (`packets.h:660-692`) — emitted at every semantically interesting moment: `player_join` (team/handicap/name), `player_attacked` (attacker id, type, size — `canvas.cc:405-411`), `player_stampblock` (block, rotations, time held — `player.cc:1430-1437`), `player_snapshot` (an ASCII board snapshot logged on personal-best moves — `give_line`, `canvas.cc:500-509`), `potato_given/potato_done` with reasons (`game.cc:522-558`), `pause`/`unpause` with actor id, `player_drop` with a reason enum, `playing_end` with winner (`net_list.cc:723-761`). These flow into the same recording file as gameplay packets. `stats/decoder_ring.txt` (454 lines, ngLog 1.2) documents every event and argument, and `stats/RecReader.pm` + `parserec.pl` reconstruct full match pages offline — including board images from the embedded snapshots.

**Relevance.** The plan harvested the decoder ring as documentation; the deeper pattern is that analytics events are (a) typed objects in the protocol module, not ad-hoc logs, (b) emitted from the authoritative site (host), and (c) interleaved into the match artifact so telemetry, replay, and support bundles are one file with one schema. The snapshot-on-personal-best trick is cheap and high-value: embed a board snapshot in the log at notable moments so support and leaderboard tooling can render them without re-simulation.

**Plan hook.** Phase 5 (match artifact = packets + typed log events); Phase 3 (golden parser tests against the documented schema); Phase 8 (support bundle / privacy docs mirror the decoder ring).

## 10. Protocol version chosen as "minimum required by the configured rules" — and honored inside the sim

**Mechanism.** The harvested "version gates" go further than gating packet reads. When *hosting*, `Game::Game(Game_params*)` starts from `Config::net_version` and **escalates only if the chosen rules require it**: stay at 20 unless hot-potato / non-line attacks / points-or-lines endgames are enabled, then 22 (`game.cc:171-181`). During old-demo playback, `net_version()` reports 20 (`game.cc:595-600`), and *simulation behavior* — not just wire format — branches on it: three generations of handicap algorithms (`net_list.cc:161-198`, `player.cc:1454-1471`), two scoring formulas, and a deliberately-preserved v23 crowd-adjustment bug — "this is a bug… but it must remain as is for network compatibility" (`canvas.cc:534-556`). The `-boringrules` flag (NEWS.md 1.2.0) was added explicitly so servers could opt out of a balance change, "removing any need to run older versions of Quadra for rule purposes."

**Relevance.** For Serenity Blocks this argues for a single `simVersion` stamped into every match artifact and *branched on inside the sim* (a rules-module registry), so old replays verify bit-exact forever and balance patches don't invalidate ranked evidence. The "minimum version needed by the selected rules" trick keeps older clients joinable when a lobby doesn't use new features — relevant once Steam builds exist in the wild at mixed versions.

**Plan hook.** Phases 3/5 (rule fixtures keyed by simVersion; frozen bug-compatible branches when a fix would break old replays); Phase 6 (capability/version negotiation at join).

## 11. Host-side statistical and operational guardrails

**Mechanism.** `Net_list::step_all` runs continuous server policies (`net_list.cc:453-556`): keepalive pings and periodic stat refreshes; a **lag limit** — connections silent past `lag_limit` are messaged then disconnected (`net_list.cc:488-498`); a **PPM limit** — after 4 minutes, players exceeding a points-per-minute ceiling are auto-dropped with "please join an expert server" (`net_list.cc:499-512`) — i.e., a *statistical* outlier gate independent of per-event validation; and a **gone-time limit** reaping departed-but-slot-holding players every 2.55 s (`net_list.cc:513-526`). Identity across rejoins is name + MD5 `player_hash` of a local password (`cfgfile.cc:224-243`, checked at `net_server.cc:360`). Admin access flips `nc->trusted` via password (`net_list.cc:1538-1552`); trusted connections bypass start/pause restrictions (`net_server.cc:517-519`) and lag limits. There is an IP allow/deny list with mask matching (`net_list.cc:1404-1426`), and a complete remote-admin console over *plain telnet on the game port* — the server detects packet-based vs line-based connections and serves `/help /list /drop /laglimit /ppmlimit /autorestart /motd /endgame /score …` (`net_list.cc:1368-1402`, help text at `1510-1537`). Backpressure has a policy too: a connection whose outgoing buffer exceeds 256 KiB is force-disconnected (`net.cc:589-595`).

**Relevance.** The host in a Steam P2P session is a de-facto server and needs the same guardrail *shape*: heartbeat/lag eviction (partially landed), gone-slot reaping, bounded send queues with a disconnect policy, and — the novel import — statistical outlier gates (APM/PPM ceilings) as a complement to per-event validation, since they catch cheats that pass plausibility checks. The trusted flag maps to lobby-host powers (kick, start-without-all, already in the Phase A–D work); the telnet console maps to a host-side ops/debug overlay (`netDiag` is its seed). Do **not** copy MD5-password identity — Steam identity solves that properly.

**Plan hook.** Phase 6 (host policy module: lag/gone/outlier eviction + send-queue caps, with tests); Phase 8 (host moderation/ops surface).

## 12. Coordinated randomness: reseed only in the "dead space" between sync points

**Mechanism.** Survivor rounds restart via the syncpoint ladder in `check_first_frag` (`net_list.cc:802-917`): when all alive players reach `WAITFORWINNER`, the server broadcasts a sync to `WAITFORRESTART`; when all reach that — and **only then** — it broadcasts `Packet_serverrandom` with a fresh seed, applies it to every canvas, and syncs to `PLAYING` (`net_list.cc:841-853`). The packet header codifies the rule: "This should be sent in the dead space between two syncpoints because there's no Packet_clientrandom" (`packets.h:601-603`). Sync transitions are single-byte `P_SERVERSTATE` broadcasts (`Net_list::syncto`, `net_list.cc:1035-1045`), and clients deliberately poll for them only every 5 frames (`net_list.cc:359-371`) so in-flight gameplay packets drain first. The same idle state (`syncpoint == LAST`) also gates late-join admission (§4).

**Relevance.** Serenity Blocks' restart/rematch flow has already produced this bug class (restart clearing jitter buffers, heartbeat re-arming across gaps). The generalizable rule: *shared-RNG mutations and rule changes may only occur inside a barrier where no gameplay events are in flight*, barrier states are tiny enumerated broadcasts, and the barrier's idle state doubles as the only join/snapshot window. This is the formal skeleton for the plan's default-off `readyBarrier` flag.

**Plan hook.** Phase 6 (ready-barrier protocol: enumerate barrier states, forbid gameplay messages inside them, admit joins only at idle); Phase 5 (record seed changes as events so replays reproduce them).

## 13. Behavior-stack game logic with local/remote sibling state machines

**Mechanism.** All gameplay is hierarchical stack machines: an `Executor` holds a stack of `Module`s; `step()` runs the top module once per tick, `call()` pushes, `ret()` pops (`overmind.cc:91-155`). Local player flow is `Player_normal → Player_process_key → Player_stamp → Player_check_line → …`; remote players run a *sibling* stack over the same `Canvas` (`Player_wait_block`, `Player_dead`, `Player_first_frag`, `Player_gone`), consuming network data instead of keyboard data at identical tick granularity. Asynchronous server work is just another module polled on the same clock (the pending-join handler wakes every 128 frames, `net_server.cc:655`).

**Relevance.** Modern JS would use state enums or generators rather than module stacks, but the discipline is the import: per-player state machines with *identical tick granularity* for local and remote variants, where network data is merely an input to the remote machine — never a direct write into board/piece state. That structure is what prevents the "snapshot stomps interpolated piece" family of bugs.

**Plan hook.** Phase 4 (extract per-player sim state machines with local/remote variants sharing one interface).

---

## Anti-patterns — observed, and explicitly not to copy

1. **Client-computed score/time inside authoritative events.** Pre-v23, `Packet_clientstampblock.score` was computed by the *client* and added to everyone's stats (`player.cc:485-490`, applied at `player.cc:1426-1428`); `time_held` is still client-reported into `PLAYING_TIME`. Quadra itself zeroed the score field at v23 — evidence that client-supplied derived values are a trap. Events should carry *actions*; every receiver's sim derives values.
2. **Global mutable singletons.** `game`, `net`, `overmind`, `recording`, `playback` are globals; the `Game` constructor self-registers with an apology ("Ok, we all know this sucks", `game.cc:113-116`; "Gotchas" note at `game.h:46-48`). Exactly the hidden coupling Phase 4 exists to prevent.
3. **Head-of-line-blocking single packet queue.** `Game::peekpacket(type)` inspects only `stack.front()` (`game.cc:572-581`); an unconsumed packet at the head stalls everything behind it, forcing special flush loops for dropped players' packets (`net_list.cc:373-403`). Use per-topic queues or a dispatch map.
4. **Fixed-size everything with sentinel values.** `MAXPLAYERS` arrays, `char name[32/40]`, a `static uint8_t outbuf[1026]` in the TCP send path (`net.cc:556`); `255` means no-team/no-player/no-attacker, `lx=127` is a magic "new format present" marker (`net_list.cc:117`), and `accepted` is a six-value int with meanings scattered across call sites (`net_server.cc:352-420`). Keep the *caps and backpressure policies*; replace sentinels with schema enums.
5. **Era security.** MD5 identity hashes (`crypt.cc`), plaintext telnet admin with a shared password on the game port, no transport encryption, UDP discovery guarded by a bare magic number. Steam networking + real identity replaces all of it; only the trusted-role concept survives.
6. **Version branches sprinkled through the sim.** The right goal (bit-exact old replays) but `if(game->net_version()>=23)` scattered through `give_line`, `send`, `add_packet` is unmaintainable. Centralize per-version rules in a table; Phase 3 fixtures make that testable.
7. **Fail-soft buffer reads returning 0.** `Net_buf::read_*` clamp at the buffer end and return zeros (`net_buf.h:60-121`); combined with `read()` returning false on range violations this is mostly safe, but silent-zero reads can mask truncation bugs. Prefer schema decoding that throws/rejects.

## Honest non-transfers

- **Relay server vs P2P mesh.** Quadra has a real TCP server: ordering and a single source of truth are free, and there is *nothing* on host migration — `migrationEpoch` remains Serenity-specific. The relay-hygiene patterns (§8) apply to the host role only.
- **C++ integer determinism.** An integer-only sim plus one shared PRNG made cross-machine determinism trivial. JS needs the Phase 5 program (integer math, seeded RNG discipline, no float truth paths) before §2's verifier means anything.
- **100 Hz per-tick input streaming over TCP** fit LAN/dial-up; over Steam P2P, Serenity's 30 Hz interpolated snapshots are the better cosmetic channel. Import the subscription model (§7) and the authoritative/cosmetic split (§5), not the byte-per-tick encoding.
- **Multiplayer verification was never built.** Quadra verified only single-player demos and punted competitive trust to "trusted servers" (`game.cc:718-722`). Its architecture supports host-side re-validation better than it exploited; don't over-claim what the reference proves.

## Summary mapping to plan phases

| # | Pattern | Plan phase |
|---|---|---|
| 1 | Fixed-tick accumulator + explicit catch-up policy | 5, 3c |
| 2 | Headless accelerated verify with exit code | 5, 8 |
| 3 | Late-join = playback = reconnect, one code path | 5, 6 |
| 4 | Join-snapshot field checklist (RNG cursor, garbage queue, ledger) | 6, 3 |
| 5 | Cosmetic inputs vs validated stamps (`DROP_INVALID_BLOCK`) | 6, 1, 8 |
| 6 | Decaying attack-credit ledger for kill attribution | 5, 6 |
| 7 | Watcher subscriptions / capability flags | 6, 3c |
| 8 | Direction-typed relay, sender binding, pre-join allowlist, record-at-relay | 6, 1 |
| 9 | Typed serverlog events inside the artifact | 5, 3, 8 |
| 10 | Rules-driven minimum protocol version; sim honors it | 3, 5, 6 |
| 11 | Lag/PPM/gone guardrails; trusted-host powers; send-queue caps | 6, 8 |
| 12 | Reseed only inside sync barriers | 6, 5 |
| 13 | Local/remote sibling state machines on one tick | 4 |
