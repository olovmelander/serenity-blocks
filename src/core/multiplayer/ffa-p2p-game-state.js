// @ts-check
/**
 * FFA P2P Game State - Host-Authoritative Multiplayer
 *
 * This manages the game state for Free-For-All multiplayer using P2P.
 * The host is authoritative (validates all moves, broadcasts state).
 */

import { MessageTypes } from '../network/message-types.js';
import {
    GameState,
    fillBag,
    spawnPiece,
    move,
    rotate,
    softDrop,
    hardDrop,
    canPlacePiece,
    applyGarbage,
    restoreBoardState,
} from '../game.js';
import { GarbageQueue } from '../garbage.js';
import { InputValidator } from '../validation/input-validator.js';
import { PLAYER_COLORS } from '../constants.js';
import { FFAAttackRouter } from './ffa-attack-router.js';
import { FragTracker } from './frag-tracker.js';
import { HostMigration } from '../network/host-migration.js';
import { InGameChat } from '../../ui/ingame-chat.js';
import { unifiedLoop } from './unified-game-loop.js';
import { emitMultiplayerEvent, MULTIPLAYER_EVENTS } from '../../events/multiplayer-events.js';
import { InputJitterBuffer } from '../network/input-jitter-buffer.js';
import {
    applyBlindEffect, applyFullBlindEffect, createBlindTimers, restoreBlindTimers,
} from '../blind.js';
import { readFlag as readNetFlag } from '../flags.js';
import { FIXED_TICK_HZ, FIXED_TICK_MS } from '../fixed-tick-clock.js';
import { hasActiveHitStop } from '../simulation-tick.js';
import {
    readFfaFixedTick,
    resetFfaFixedClockProjection,
    rollbackFixedTickOnPromotion,
    transitionFfaSimulationClock,
} from './ffa-fixed-tick-policy.js';
import {
    handleFfaRoundRestart,
    normalizeFfaRoundSeed,
    parseFfaRoundGeneration,
    readFfaRoundAdvance,
} from './ffa-round-policy.js';
import { runFfaFixedTicks } from './ffa-fixed-tick-runner.js';
import { drainFfaBufferedInputs, resolveFfaBufferedInputTick } from './ffa-input-scheduling.js';
import {
    acknowledgeFfaInput, flushFfaInputBatches, processFfaInputBatch,
    resetFfaInputEpoch, resetFfaInputTransport,
} from './ffa-input-batching.js';
import {
    disposeResyncState,
    drainPendingInboundResyncApply,
    getDownloadJoinBlockedPeers,
    handleResyncChunk,
    RESYNC_CHUNK_SIZE,
    RESYNC_MAX_RETRIES,
    RESYNC_TIMEOUT_MS,
    RESYNC_WINDOW,
    resetInboundResyncState,
    sendResyncChunk,
    sendResyncWindow,
    shouldDropLiveSnapshotDuringDownload,
    tickResyncTransfer,
} from './ffa/resync-coordinator.js';
import { createNetworkHandlerRegistry } from './ffa/network-handler-registry.js';
import { createFfaResyncContext } from './ffa/resync-context.js';
import * as resyncRequest from './ffa/resync-request-handler.js';
import * as resyncInputBarrier from './ffa/resync-input-barrier-adapter.js';
import {
    adoptFfaJoinSyncpoint,
    computeFfaJoinSyncpoint,
    drainFfaPendingResyncs,
    publishFfaJoinSyncpoint,
    queueFfaResync,
} from './ffa/join-syncpoint.js';
import * as joinLifecycle from './ffa/join-lifecycle.js';
import {
    broadcastSessionWelcome,
    buildJoinProtocolOffer,
    registerJoinHandshakeHandlers,
} from './ffa/join-handshake.js';
import { buildFfaResyncPayload } from './ffa/resync-payload.js';
import * as resyncSidecar from './ffa/resync-sidecar.js';
import {
    countOccupiedFfaCells,
    ffaCounterDelta,
    sanitizeFfaNetEventData,
    stableFfaRuleHash,
} from './ffa/net-diagnostics.js';
import { garbageBurstKey, drainAllLineBursts } from './ffa/garbage-helpers.js';
import { checkTopOut, serializeBoardGrid } from './ffa/board-helpers.js';
import { seededRandom } from '../../utils/helpers.js';

const JOIN_EVENTS = joinLifecycle.JOIN_LIFECYCLE_EVENTS;
// Runtime flags resolve via the central registry reader (src/core/flags.js,
// Phase 0.6): URL `?name=1`/`?name=0` → localStorage `serenity.<name>` → default.
// The former local readNetFlag clone was consolidated there.

export class FFAGameStateP2P {
    constructor(steamNetworking, localPlayerId, options = {}) {
        this.network = steamNetworking;
        this.localPlayerId = localPlayerId;
        this.isHost = steamNetworking.isHost;
        this._disposed = false;

        // SPECTATOR (watch-only): a client that consumes the host's all-boards snapshot
        // stream and renders every player, but is NEVER in the simulated roster
        // (this.players) — so it has no board, sends no input, and is auto-excluded from
        // ready/win/elimination/attack/loop-registration (all of which iterate this.players).
        this.isSpectator = !!options.asSpectator;
        // Host-side: steamIds that joined as spectators (kept OUT of this.players).
        /** @type {Set<string>} */ this.spectators = new Set();
        // Spectator count for display on EVERY client (host = spectators.size; peers adopt
        // it from the host's player-list broadcast). See broadcastPlayerList / getSpectatorCount.
        /** @type {number} */ this.spectatorCount = 0;

        // All player states (Map<steamId, PlayerState>)
        this.players = new Map();

        // Initialize local player — EXCEPT a spectator, which owns no board.
        if (!this.isSpectator) {
            this.addPlayer(localPlayerId, steamNetworking.playerName, true);
        }

        // Lobby Info
        this.lobbyId = null;
        this.lobbyName = null;

        // Match state
        /** @type {GamePhase} */
        this.gamePhase = 'waiting';
        this.sharedSeed = 0; // Deterministic RNG seed (same pieces for all)
        this.matchConfig = {
            endCondition: 'frags', // 'frags', 'time', 'points', 'lines', 'never'
            endConditionValue: 10,
            startLevel: 1,
            levelProgression: false,
            allowHandicap: true,
            boringRules: false,
            garbageCancellation: 'full', // 'full' (modern Quadra/TETR.IO) | 'disabled' (classic)
            attackStyle: 'standard',
            attackRules: null,
            hotPotato: false,
            potatoDurationMs: 12000,
            potatoPenaltyLines: 6,
            simulationClock: 'legacy-variable-v1',
        };
        this.winner = null;
        this.matchStartTime = 0;
        this.lastMatchResults = null;
        this.hotPotatoState = null;
        this.rematchVotes = new Set(); // Track steamIds who voted for rematch

        // Input validation (host only)
        this.inputValidator = this.isHost ? new InputValidator() : null;
        this.debugGarbage = typeof window !== 'undefined'
            && window.__MULTIPLAYER_DEBUG_GARBAGE__ === true;

        // State sync (host broadcasts at 30Hz)
        this.stateSyncInterval = null;
        this.STATE_SYNC_RATE = 30; // Hz
        this._lastStateBroadcastTime = 0;
        this._stateBroadcastAccumulator = 0;

        // Track last state for delta detection (reduces network spam)
        this.lastBroadcastState = new Map(); // steamId -> last state snapshot

        // Phase 3 systems
        this.attackRouter = new FFAAttackRouter(this);
        this.fragTracker = new FragTracker(this);
        // Monitor host health (Peers only)
        this.hostMigration = new HostMigration(this);
        if (!this.isHost) {
            this.hostMigration.startMonitoring();
        }

        // Heartbeat (Host only)
        this.heartbeatInterval = null;
        if (this.isHost) {
            this.startHeartbeatLoop();
        }

        // Chat UI
        this.chat = new InGameChat(this);
        this.chatHistory = []; // Unified chat history

        const fixedTickEnabled = readFfaFixedTick();
        const adaptiveInputJitterEnabled = readNetFlag('adaptiveInputJitter', false);

        // Phase 4: Input jitter buffer (host only)
        // Smooths input timing for fair gameplay across varying latencies
        this.inputJitterBuffer = this.isHost ? new InputJitterBuffer({
            bufferDepth: 2,
            tickRate: fixedTickEnabled ? 60 : 30,
            adaptive: adaptiveInputJitterEnabled,
        }) : null;
        this.useJitterBuffer = this.matchConfig?.useJitterBuffer !== false; // Enable by default

        // Game loop (unified RAF-driven loop)
        this.unifiedLoop = unifiedLoop;
        this.loopRunning = false;
        this.loopCallbacksConfigured = false;
        this.setLocalInputHooks();

        // === PERFORMANCE OPTIMIZATIONS ===
        // Pre-allocated render payload - reused every frame (saves ~360 allocations/sec)
        this._renderPayload = {
            players: new Array(8).fill(null).map(() => ({
                steamId: null,
                name: null,
                color: null,
                gameState: null,
                garbageQueue: null,
                isLocal: false,
                isAlive: true,
                awaitingSpawn: false,
                frags: 0,
            })),
            playerCount: 0,
            fromLoopFrame: false, // stamped unconditionally in renderAllPlayers (§2.2)
        };
        this.hostTick = 0;
        this.simTick = 0;
        this.snapshotSeq = 0;
        this._attackSeq = 0;
        this._networkDispatch = {
            depth: 0,
            onDrained: () => {
                this._processPendingResyncInputBarrier();
                this._processPendingInboundResyncApply();
                this._processPendingResyncs();
            },
        };
        this.joinSyncpoint = computeFfaJoinSyncpoint(this);
        this.syncpoint = this.joinSyncpoint.status;
        this.pendingResyncs = [];
        this.resyncTransfers = new Map();
        this.resyncBuffers = new Map();
        this.completedResyncs = new Map();
        this.pendingInboundResyncApply = null;
        this.lastAppliedResyncFence = null;
        this.hostResyncInputBarriers = new Map();
        this.peerResyncInputBarrier = null;
        this.resyncInputFrozen = false;
        this.resyncRequestAtByPeer = new Map();
        this.resyncChunkSize = RESYNC_CHUNK_SIZE;
        this.resyncWindow = RESYNC_WINDOW;
        this.resyncTimeoutMs = RESYNC_TIMEOUT_MS;
        this.resyncMaxRetries = RESYNC_MAX_RETRIES;
        this.joinState = joinLifecycle.createJoinState({ isHost: this.isHost });
        this._announceTimer = null; // join-announce resend timer (peer side)
        // Monotonic round counter. Stamped into every snapshot + the round-restart
        // message so a peer can FENCE OFF stale authoritative state: a late
        // (unreliable, deferred) snapshot from a finished round must not clobber the
        // freshly-revived next round. Bumped by the host on each round restart.
        this.roundGeneration = 0;

        // Quadra-style reliable LOCK-EVENTS: on every piece lock the host sends a
        // reliable authoritative board snapshot so opponent boards SNAP to truth.
        // DEFAULT OFF (2026-06-23 audit): _applyAuthoritativeLock snaps the grid and
        // calls renderAllPlayers(), but opponents are rendered from the snapshot
        // INTERPOLATOR which lock-events never feed — the two writers fight for up to
        // the interp delay (~90ms) → opponent glitch / can't-see-movement. Re-enable
        // only after the lock-event is routed through the same interpolator path
        // (see docs/ONLINE_MP_CURRENT_STATE_FIX_PLAN_2026-06-23.md, Phase B4).
        // Toggle ON: ?lockEvents=1 or localStorage 'serenity.lockEvents'='1'.
        this._lockEventsEnabled = readNetFlag('lockEvents', false);
        this._authoritativeAttacksEnabled = readNetFlag('authoritativeAttacks', false);
        this._deterministicGarbageEnabled = readNetFlag('deterministicGarbage', false);

        // LOCAL-BOARD HOLD — fixes the joiner's "pieces flicker / feel sluggish &
        // weird" under real network latency. The local player runs a full local
        // prediction: it locks its own piece into the SETTLED grid and spawns the
        // next piece immediately. But _applySnapshotState then re-bases that board
        // from the host's authoritative 30Hz frame every snapshot. Under real RTT
        // the host frame is ~latency BEHIND and has NOT yet processed the peer's
        // most recent input(s), so re-basing to it (verified in the local harness
        // with simulated 70–110ms latency):
        //   • erases a just-locked piece for ~RTT (board "regression"), and
        //   • reverts the freshly-spawned active piece back to the host's stale
        //     pre-lock piece on ~30% of post-hard-drop snapshots.
        // Both thrash the joiner's board on essentially every placement; the host
        // never sees it because its own grid IS the truth. Fix: while the host has
        // not yet acknowledged the peer's latest input (snapshot.lastInputSeq < our
        // sent inputSequence) KEEP the locally-predicted board (grid + lockedPieces
        // + preview + active piece) instead of re-basing it to stale truth, then
        // re-base the instant the host catches up. A consecutive-hold cap means a
        // genuine divergence still reconciles. Toggle OFF: ?localBoardHold=0.
        this._localBoardHoldEnabled = readNetFlag('localBoardHold', true);
        this._localBoardHoldCount = 0;
        // ~1s at 30Hz. Long enough that continuous fast play (the host stays a few
        // frames behind the whole time) is pure local prediction — the Quadra model;
        // short enough that a genuine stuck divergence still force-reconciles (the
        // digest-resync path catches real desyncs faster).
        this._LOCAL_BOARD_HOLD_MAX_FRAMES = 30;
        // Set (peer only) the instant local prediction locks a piece — see Signal 3 in
        // _applySnapshotState. Holds the board over the brief post-lock window before
        // the host's settle for that lock propagates back, even when the lock CLEARED a
        // line (board ends smaller, not larger) and the input was already acked.
        this._lastLocalLockTime = 0;
        this._RECENT_LOCK_MS = 250;
        // Phase 0 (CLEAR/CASCADE/COMBO consistency): a line clear / cascade / combo is an
        // async, multi-frame ANIMATION (physics.js processPhysics: staged 30/20/20ms fades
        // + gravity per cascade). The shipped LOCAL-BOARD HOLD froze only the GRID; SCORE/
        // LINES/LEVEL and the GARBAGE queue were still adopted from the host EVERY snapshot,
        // so on the peer the counter regressed to the host PRE-clear total then jumped and
        // the garbage meter churned — "clears feel way off". `holdStats` extends the hold to
        // cover score/lines/level + the garbage queue (adopted ATOMICALLY with the grid on
        // release). Toggle OFF: ?holdStats=0.
        this._holdStatsEnabled = readNetFlag('holdStats', true);
        // Signal 4 uses the local player's isProcessingPhysics (true for the WHOLE cascade)
        // to hold across the entire animation; a deep cascade outlasts the 30-frame (~1s)
        // cap, so while physics is animating use a generous safety cap (~3s) instead.
        this._LOCAL_BOARD_HOLD_MAX_PHYSICS_FRAMES = 90;
        // Stamped to the current roundGeneration the first time we hold in a round; a
        // mismatch (new round) lazily clears stale hold state so a round-1 tail lock can
        // never bridge into round 2.
        this._localBoardHoldRoundGen = null;
        // ⭐ PEER-OWNS-BOARD (Quadra model) — the durable cure for the residual "stack gets
        // higher then resets / tetrominos glitch + jump / small lag" on the peer. Those are
        // ALL artifacts of re-basing the peer's OWN board against the host's ~RTT-stale 30Hz
        // snapshot every frame (the LOCAL-BOARD HOLD only band-aided the timing). The host
        // and local feel perfect because they're a single sim that's NEVER overwritten.
        // Determinism is verified feasible: the piece RNG is a SHARED-seed integer LCG that
        // advances once per spawn on both sides (identical stream), clears/cascades are pure
        // integer logic, and hard-drops are provably bit-identical (ffa-demo-replay test).
        // So when ON, the peer FULLY OWNS its grid/piece/nextPieces/dropCounter/score/lines/
        // level/dropInterval as a local sim — NEVER re-based per-frame. The host snapshot for
        // the local player supplies ONLY: incoming garbage (the queue), frags/isAlive/win
        // (host verdicts), lastInputSeq (input pruning) and blindTimers — plus the existing
        // score/lines/garbage DESYNC DIGEST as the backstop: on a genuine (rare) divergence
        // — e.g. gravity-lock timing under frame-cadence skew, or a host-dropped input — the
        // digest triggers ONE clean forceLocal resync instead of a continuous soft glitch.
        // The local board then renders exactly like LocalMultiplayerMode (direct from
        // gameState each frame, instant input). Supersedes the LOCAL-BOARD HOLD when on.
        // Toggle OFF: ?peerLocalSim=0.
        this._peerLocalSimEnabled = readNetFlag('peerLocalSim', true);
        // DESYNC BACKSTOP re-armed (plan §1.2): both divergence branches in
        // syncFromHost gate on this flag, but it was never initialized and
        // setDesyncDetection had zero callers — the safety net the design note
        // above calls load-bearing was silently dead, so a genuine divergence
        // produced a permanently drifted peer board. Default ON; ?desyncCheck=0
        // to disable. Requires 3 (peer-local-sim) / 5 (legacy) consecutive
        // confirmed mismatches before triggering, so snapshot-adoption races
        // cannot false-positive.
        this._desyncCheckEnabled = readNetFlag('desyncCheck', true);
        this._desyncCount = 0;
        // Phase 1+2 (OPPONENT CLEAR FEEDBACK): opponents currently teleport between 30Hz
        // settled grids with ZERO clear feedback. The host (which simulates every player)
        // broadcasts a tiny grid-FREE GAME_LINES_CLEAR event per clear; peers replay it as
        // a transient row-FLASH overlay on that opponent's mini-board (a separate overlay
        // canvas — never writes the grid, so it CANNOT refight the snapshotInterpolator like
        // the old grid-snapping lock-events did). Toggle OFF: ?opponentClearEvents=0.
        this._opponentClearEvents = readNetFlag('opponentClearEvents', true);
        // IDEMPOTENT GARBAGE ADOPT (fixes "garbage looks strange on the peer"): the peer
        // predict-consumes a burst instantly while the host consumes it ~½RTT later, so the
        // host snapshot re-lists (and a blind replace re-adds) a burst the peer already
        // inserted → double rows + meter churn. We dedupe by attackId:lineIndex. Toggle
        // OFF: ?garbageIdempotent=0.
        this._garbageIdempotentEnabled = readNetFlag('garbageIdempotent', true);
        this._peerConsumedBursts = new Set();
        // DRAIN-ALL to match LOCAL MP: local drains the ENTIRE garbage queue per spawn
        // (one dump), while online dequeued only ONE burst per spawn → garbage trickled in
        // piece-by-piece and topped out on different timing. Drain the whole queue per spawn
        // on BOTH host and peer (they must flip together) so online garbage dumps + kills
        // exactly like local. The per-line attackId:lineIndex dedup still filters every
        // drained entry, so idempotent-adopt is unaffected. Toggle OFF: ?garbageDrainAll=0.
        this._garbageDrainAll = readNetFlag('garbageDrainAll', true);
        this._fixedTickEnabled = fixedTickEnabled;
        this._adaptiveInputJitterEnabled = adaptiveInputJitterEnabled;
        this._downloadJoinEnabled = readNetFlag('downloadJoin', false);
        this._migrationEpochEnabled = readNetFlag('migrationEpoch', false);
        this.migrationEpoch = 0;
        this.SIM_TICK_RATE = FIXED_TICK_HZ;
        this.SIM_TICK_MS = FIXED_TICK_MS;
        this.MAX_SIM_STEPS_PER_FRAME = 5;
        this._simTickAccumulatorMs = 0;
        this._fixedTickApplicationDepth = 0;
        this._fixedInputTimeMs = null;
        this._peerFixedInputSimTick = null;
        this._activeFixedInputStamp = null;
        this.downloadJoinPeers = new Map();
        /** @type {DownloadJoinProgress|null} */ this.downloadJoinInProgress = null;

        // Quadra-style ALL-PLAYERS-READY round syncpoint: instead of the host
        // instant-starting the next round and resuming 30Hz broadcasts before the
        // peer has even processed the restart (a freeze/desync risk), the host waits
        // for every player to ack GAME_ROUND_READY, then GAME_ROUND_START fires for
        // everyone together. Host-driven (the restart message carries `awaitReady`),
        // so only the host's flag matters. A host timeout + peer backstop mean it can
        // never hang. DEFAULT OFF for now: it's new and sits on the round-restart path
        // that has been failing, and can't be two-machine tested here — the simpler
        // instant-restart path (+ gen-fence + keyframe reset + the delta-baseline fix)
        // is the safer baseline. Re-enable with ?readyBarrier=1 or
        // localStorage 'serenity.readyBarrier'='1' once base gameplay is confirmed.
        this._readyBarrierEnabled = readNetFlag('readyBarrier', false);

        // Peer-side network health diagnostic: one concise 📡 [NET] summary line per
        // ~second (snapshot arrival rate, boards applied, gen-drops, lock-skips,
        // opponent cell count, phase/gen). Discriminates connectivity vs decode vs
        // apply vs render when the game "isn't working" without flooding the console.
        // ON by default; silence with ?netDiag=0 / localStorage 'serenity.netDiag'='0'.
        this._netDiagEnabled = readNetFlag('netDiag', true);
        this._netDiag = {
            rx: 0,
            boardsApplied: 0,
            genDrops: 0,
            lockSkips: 0,
            decodeErrors: 0,
            lastLogAt: 0,
            lastPacketStats: null,
        };
        this._netEventLogEnabled = readNetFlag('netEventLog', true);
        this._netEventLogLimit = 512;
        this._netEventLogSeq = 0;
        this._netEventLog = [];
        this.READY_BARRIER_TIMEOUT_MS = 2500;
        this._roundReady = null; // Set of player ids that have acked the pending round (host)
        this._roundReadyExpected = null; // Snapshot of player ids expected to ack the pending round
        this._pendingRoundStart = null; // deferred startRound() thunk, fired on GAME_ROUND_START
        this._readyBarrierTimer = null;
        this._countdownGeneration = 0;

        // Phase 5: Input Batching
        this.pendingInputs = []; // Array of inputs to send this tick
        this.inputSequence = 0; // Local input sequence number
        this.lastAckedTick = -1; // Tick of last acknowledged input
        this.gameTick = 0; // Local simulation tick

        // Setup network handlers
        this.setupNetworkHandlers();
    }

    _logGarbage(...args) {
        if (this.debugGarbage) {
            console.log(...args);
        }
    }

    get handshakeComplete() {
        return joinLifecycle.isJoinHandshakeComplete(this.joinState);
    }

    /** @param {any} event @param {Record<string, unknown>} [details] */
    _transitionJoin(event, details = {}) {
        return joinLifecycle.transitionFfaJoinState(this, event, details);
    }

    setLocalInputHooks(hooks = {}) {
        this.localInputHooks = {
            advance: typeof hooks.advance === 'function' ? hooks.advance : null,
            advanceFixed: typeof hooks.advanceFixed === 'function' ? hooks.advanceFixed : null,
            applyFixed: typeof hooks.applyFixed === 'function' ? hooks.applyFixed : null,
            reset: typeof hooks.reset === 'function' ? hooks.reset : null,
        };
    }

    _setUnifiedLoopExternalPlayerUpdate(enabled) {
        if (!this.unifiedLoop) return;
        if (typeof this.unifiedLoop.setExternalPlayerUpdate === 'function') {
            this.unifiedLoop.setExternalPlayerUpdate(enabled === true, this.SIM_TICK_MS);
        } else {
            this.unifiedLoop.externalPlayerUpdate = enabled === true;
        }
    }

    _transitionSimulationClock(simulationClock) {
        return transitionFfaSimulationClock(this, simulationClock);
    }

    /**
   * Add a player to the match
   */
    addPlayer(steamId, name, isLocal = false) {
        if (this.players.has(steamId)) {
            const existing = this.players.get(steamId);
            // RECONNECTION LOGIC: Revive player if they are in grace period
            if (existing.isDisconnected) {
                console.log(`♻️ Player reconnected during grace period: ${name}`);
                clearTimeout(existing.disconnectTimeout);
                existing.isDisconnected = false;
                existing.disconnectTimeout = null;

                // Broadcast update so everyone knows they are back
                if (this.isHost) {
                    this.broadcastPlayerList();
                    resyncRequest.routeFfaResync(this, steamId, 'reconnect');
                }
                return true; // revived → present in the roster
            }

            console.warn(`⚠️ Player ${steamId} already exists`);
            return false; // not newly added
        }

        // Enforce the host's configured capacity. Steam enforces the lobby cap for real
        // play, but the mock transport (2-window tests) and any in-app add path do not —
        // and exceeding 8 wraps the 8-colour palette (two players share a colour). The
        // host is authoritative for the roster, so reject the join here. (A future
        // spectator role will bypass this — spectators don't occupy a player slot.)
        if (this.isHost && !isLocal) {
            const cap = this.matchConfig?.maxPlayers || 8;
            if (this.players.size >= cap) {
                console.warn(`🚫 Join rejected: lobby full (${this.players.size}/${cap}) — ${name} (${steamId})`);
                this.network.sendP2PMessage?.(steamId, MessageTypes.JOIN_REJECTED, {
                    reason: 'lobby_full',
                    cap,
                });
                return false; // rejected — NOT added to the roster
            }
        }

        // Check if PLAYER_COLORS is available
        if (!PLAYER_COLORS || PLAYER_COLORS.length === 0) {
            console.error('❌ PLAYER_COLORS is not available!', PLAYER_COLORS);
            return false;
        }

        // DROP-IN MID-MATCH JOIN: a player joining while a match is in progress can't be
        // spawned mid-round (their shared-seed RNG stream wouldn't align with the others).
        // Add them as a WAITING/dead roster member: the unified loop skips isAlive:false
        // boards (and the next round restart re-inits EVERY player with the same seed, so
        // they spawn perfectly aligned). Until then they watch via the spectate view.
        const midMatchJoin = this.isHost && !isLocal && this.gamePhase === 'playing';

        // Assign color based on join order (wraps around if > 8 players)
        const colorIndex = this.players.size % PLAYER_COLORS.length;
        const playerColor = PLAYER_COLORS[colorIndex];

        console.log(`🎨 Assigning color to ${name}: index=${colorIndex}, color=${playerColor}`);
        console.log('   Available colors:', PLAYER_COLORS);
        console.log('   PLAYER_COLORS type:', typeof PLAYER_COLORS, Array.isArray(PLAYER_COLORS));

        const playerState = {
            steamId,
            name,
            color: playerColor, // NEW: Assign unique player color
            isLocal,
            gameState: new GameState({ lockBonusPolicy: 'legacy-max' }),
            garbageQueue: new GarbageQueue(),
            isAlive: !midMatchJoin, // mid-match joiner waits (dead) until the next round
            // Distinguishes a late joiner WAITING to spawn next round from a player who was
            // alive and got ELIMINATED — both are isAlive:false, but the UI must show them
            // differently (waiting vs skull). Cleared when they're (re)initialized at a round.
            awaitingSpawn: midMatchJoin,
            isReady: false,
            frags: 0,
            joinedAt: Date.now(),
            lastAttackerId: null, // Track who last sent garbage to this player (for kill attribution)
            isDisconnected: false, // Reconnection tracking
            lastInputSeq: 0, // Last processed input sequence number
        };

        this.players.set(steamId, playerState);
        if (midMatchJoin) {
            console.log(`⏳ Mid-match drop-in: ${name} (${steamId}) joins as WAITING — spawns next round`);
        }
        console.log(`✅ Player added: ${name} (${steamId})${isLocal ? ' [LOCAL]' : ''} - Color: ${playerColor}`);
        console.log(`   Total players: ${this.players.size}`);
        console.log('   All player colors now:', Array.from(this.players.values()).map((p) => ({ name: p.name, color: p.color })));

        // Trigger UI update event
        emitMultiplayerEvent(MULTIPLAYER_EVENTS.PLAYER_LIST_CHANGED, {
            players: this.players,
        });

        // Host broadcasts updated player list
        if (this.isHost) {
            this.broadcastPlayerList();
            if (this.loopRunning) {
                this.syncUnifiedLoopPlayers();
            }
            // Mid-match joiners need the live match metadata before their resync baseline.
            if (midMatchJoin) {
                this.network.sendP2PMessage?.(steamId, MessageTypes.LOBBY_GAME_START, {
                    sharedSeed: this.sharedSeed,
                    config: this.matchConfig,
                    inProgress: true,
                    roundGeneration: this.roundGeneration,
                });
            }
        }
        return true; // successfully added
    }

    /**
     * Register a WATCH-ONLY spectator (host only). Spectators are kept OUT of this.players
     * — so they're auto-excluded from ready/win/elimination/attack/loop-registration — but
     * they're a connected peer, so the live GAME_STATE_FULL stream already reaches them. We
     * just hand them the current roster + a baseline snapshot so they can render immediately.
     */
    _registerSpectator(steamId, name) {
        if (!this.isHost || !steamId || steamId === this.localPlayerId) return;
        if (this.spectators.has(steamId)) {
            // Re-announce (NET_HELLO retries until handshakeComplete) — just re-baseline.
            this.queueResync(steamId);
            return;
        }
        this.spectators.add(steamId);
        console.log(`👁 Spectator joined: ${name || 'Spectator'} (${steamId}) — ${this.spectators.size} watching`);
        this.broadcastPlayerList(); // give the spectator the full player roster to render
        this.queueResync(steamId); // + a current board baseline; then it rides the live stream

        // A live spectator needs the match metadata before its resync baseline.
        if (this.gamePhase === 'playing') {
            this.network.sendP2PMessage(steamId, MessageTypes.LOBBY_GAME_START, {
                sharedSeed: this.sharedSeed,
                config: this.matchConfig,
                roundGeneration: this.roundGeneration,
            });
        }
    }

    /** Spectator count for display (host owns the set; peers mirror the broadcast value). */
    getSpectatorCount() {
        return this.isHost ? (this.spectators?.size || 0) : (this.spectatorCount || 0);
    }

    /**
     * HOST admin: kick a player or spectator from the match. Tells the target to leave,
     * then removes it from the roster IMMEDIATELY (no disconnect grace period — a kick is
     * deliberate) and broadcasts the updated list. Host-only; can't kick yourself.
     */
    kickPlayer(steamId, reason = 'kicked_by_host') {
        if (!this.isHost || !steamId || steamId === this.localPlayerId) return false;
        console.log(`👢 Host kicking ${steamId}`);
        this.network.sendP2PMessage?.(steamId, MessageTypes.PLAYER_KICKED, { reason });
        if (this.spectators?.has(steamId)) {
            this.network?.clearNegotiatedProtocol?.(steamId);
            this.spectators.delete(steamId);
            this.broadcastPlayerList(); // refresh the spectator count for everyone
            return true;
        }
        if (this.players.has(steamId)) {
            this._finalizeRemovePlayer(steamId); // immediate removal + broadcastPlayerList
            return true;
        }
        return false;
    }

    /**
   * Remove a player from the match
   */
    removePlayer(steamId) {
        // Spectators live in a SEPARATE set (never in this.players), so the player-removal
        // path below would early-return and leak them. Clean them out here on disconnect —
        // a spectator has no board, so there's no grace period to honour.
        if (this.spectators && this.spectators.has(steamId)) {
            this.network?.clearNegotiatedProtocol?.(steamId);
            this.spectators.delete(steamId);
            console.log(`👁 Spectator left: ${steamId} — ${this.spectators.size} watching`);
            return;
        }

        const player = this.players.get(steamId);
        if (!player) return;

        // Grace Period Logic:
        // If match is in progress, don't remove immediately. Mark as disconnected.
        if (this.gamePhase === 'playing' && player.isAlive && !player.isDisconnected) {
            if (this.isHost) resyncInputBarrier.retireFfaPeerResync(this, steamId, 'disconnect');
            console.log(`⚠️ Player disconnected during match: ${player.name} - Entering Grace Period (10s)`);
            this.network?.clearNegotiatedProtocol?.(steamId);
            player.isDisconnected = true;
            player.disconnectTime = Date.now();

            // Auto-remove after 10s if not reconnected
            player.disconnectTimeout = setTimeout(() => {
                console.log(`🛑 Grace period expired for ${player.name} - Removing player`);
                this._finalizeRemovePlayer(steamId);
            }, 10000);

            // Notify others of disconnect status
            if (this.isHost) {
                this.broadcastPlayerList();
            }
            return;
        }

        this._finalizeRemovePlayer(steamId);
    }

    _finalizeRemovePlayer(steamId) {
        const player = this.players.get(steamId);
        if (!player) return;
        if (this.isHost) resyncInputBarrier.retireFfaPeerResync(this, steamId, 'removed');

        if (player.disconnectTimeout) {
            clearTimeout(player.disconnectTimeout);
        }

        console.log(`👋 Player permanently removed: ${player.name}`);
        this.network?.clearNegotiatedProtocol?.(steamId);
        resetFfaInputTransport(this, steamId);
        this.inputJitterBuffer?.removePlayer?.(steamId);
        this.players.delete(steamId);

        if (this.isHost && this.inputValidator) {
            this.inputValidator.resetPlayer(steamId);
        }

        // Broadcast updated player list
        if (this.isHost) {
            this.broadcastPlayerList();
            if (this.loopRunning) {
                this.syncUnifiedLoopPlayers();
            } else if (this.unifiedLoop) {
                this.unifiedLoop.unregisterPlayer(steamId);
            }
        }

        // Notify the UI locally so the lobby Activity Log records "<name> left" on EVERY
        // node — including the HOST. _logRosterChanges only runs on PLAYER_LIST_CHANGED;
        // without this the host broadcasts the new roster to peers but never logs the
        // departure itself, so its Activity Log diverged from the peers'.
        emitMultiplayerEvent(MULTIPLAYER_EVENTS.PLAYER_LIST_CHANGED, { players: this.players });
    }

    /**
   * Announce joining to host (peer only)
   */
    announceJoin() {
        if (this.isHost) return;
        this._transitionJoin(JOIN_EVENTS.ANNOUNCE);
        this._joinHandshakeNonce = this.network.createHandshakeNonce?.() ?? null;
        this._lastJoinProtocolOffer = null;
        this._lastJoinRejection = null;

        // Legacy Steam P2P drops the FIRST packet to a peer until the receiver
        // accepts the session, so we resend the join announce until the host
        // replies NET_WELCOME (sets handshakeComplete). NET_HELLO is the sole
        // roster admission path and carries identity plus the supported protocol
        // range; retries cover first-packet loss without bypassing negotiation.
        if (this._announceTimer) { clearTimeout(this._announceTimer); this._announceTimer = null; }
        let attempts = 0;
        const maxAttempts = 12;
        const send = () => {
            if (this.handshakeComplete) { this._announceTimer = null; return; }
            const hostId = this.network.hostSteamId;
            if (hostId) {
                console.log(`📢 Announcing join to host ${hostId} (attempt ${attempts + 1}/${maxAttempts})...`);
                const protocolOffer = buildJoinProtocolOffer(this);
                this.network.sendP2PMessage(hostId, MessageTypes.NET_HELLO, {
                    ...protocolOffer,
                    clientVersion: this.network.protocolVersion,
                    name: this.network.playerName,
                    asSpectator: this.isSpectator, // host keeps spectators OUT of the roster
                    featureFlags: [],
                });
            } else {
                console.warn('⚠️ Cannot announce join yet — host Steam ID not resolved');
            }
            attempts += 1;
            if (attempts < maxAttempts && !this.handshakeComplete) {
                this._announceTimer = setTimeout(send, 700);
            } else {
                this._announceTimer = null;
            }
        };
        send();
    }

    /**
   * Setup network message handlers
   */
    setupNetworkHandlers() {
        this._networkHandlerRegistry?.dispose();
        const registry = createNetworkHandlerRegistry(this.network, this._networkDispatch);
        this._networkHandlerRegistry = registry;

        // === INPUT MESSAGES (Peer → Host) ===

        registerJoinHandshakeHandlers(this, registry);
        resyncInputBarrier.registerFfaResyncInputBarrierHandlers(this, registry);

        registry.register(MessageTypes.GAME_INPUT_BATCH, (msg) => {
            if (this.isHost) {
                this.processInputBatch(msg.from, msg.data, msg.timestamp);
            }
        });

        // === STATE SYNC MESSAGES (Host → Peers) ===

        registry.register(MessageTypes.GAME_STATE_FULL, (msg) => {
            if (!this.isHost) {
                if (this._shouldDropLiveSnapshotDuringDownload(msg.data, msg)) return;
                this._transitionJoin(JOIN_EVENTS.LIVE_STATE_ACCEPTED, { snapshotSeq: msg.data?.snapshotSeq ?? null });
                this.syncFromHost(msg.data);
            }
        });

        registry.register(MessageTypes.GAME_PLAYER_LOCK, (msg) => {
            this._applyAuthoritativeLock(msg.data);
        });

        registry.register(MessageTypes.GAME_LINES_CLEAR, (msg) => {
            this._applyPlayerClear(msg.data);
        });

        registry.register(MessageTypes.GAME_STATE_RESYNC, (msg) => {
            if (!this.isHost) {
                this._handleResyncChunk(msg);
            }
        });

        registry.register(MessageTypes.GAME_STATE_RESYNC_ACK, (msg) => {
            if (this.isHost) {
                this._handleResyncAck(msg);
            }
        });

        registry.register(MessageTypes.GAME_SYNCPOINT, (msg) => {
            if (!this.isHost) {
                adoptFfaJoinSyncpoint(this, msg.data);
            }
        });

        registry.register(MessageTypes.LOBBY_PLAYER_JOINED, (msg) => this._handleLobbyPlayerJoined(msg));

        registry.register(MessageTypes.LOBBY_PLAYER_LEFT, (msg) => this._handleLobbyPlayerLeft(msg));

        registry.register(MessageTypes.LOBBY_GAME_START, (msg) => this._handleLobbyGameStart(msg));

        // HOST admin kicked us → bubble up so the mode can tear down + return to menu.
        registry.register(MessageTypes.PLAYER_KICKED, (msg) => {
            if (this.isHost) return; // a host can't kick itself
            // Only the HOST can kick — ignore a spoofed PLAYER_KICKED from a peer (only
            // block when we KNOW the sender isn't the host, so a missing from/host can't
            // break a legit kick).
            if (msg.from && this.network.hostSteamId && msg.from !== this.network.hostSteamId) {
                console.warn(`🚫 Ignoring PLAYER_KICKED from non-host ${msg.from}`);
                return;
            }
            console.warn(`👢 Kicked by host${msg.data?.reason ? ` (${msg.data.reason})` : ''}`);
            if (this._announceTimer) { clearTimeout(this._announceTimer); this._announceTimer = null; }
            this._transitionJoin(JOIN_EVENTS.REJECT, { reason: msg.data?.reason || 'kicked' });
            emitMultiplayerEvent(MULTIPLAYER_EVENTS.KICKED, { reason: msg.data?.reason || 'kicked' });
        });

        registry.register(MessageTypes.LOBBY_PLAYER_READY, (msg) => this._handleLobbyPlayerReady(msg));

        // === HOST MIGRATION ===

        registry.register(MessageTypes.NET_HEARTBEAT, (msg) => this._handleNetHeartbeat(msg));

        registry.register(MessageTypes.GAME_HOST_MIGRATION_CLAIM, (msg) => {
            if (this._disposed) return;
            this.hostMigration.handleClaim(msg);
        });

        registry.register(MessageTypes.GAME_HOST_MIGRATION_SYNC, (msg) => {
            if (this._disposed) return;
            const newHostId = msg.data?.newHostId;
            if (!this._verifyHostReassignment(msg.from, newHostId)) {
                console.warn(`🛑 Rejecting migration sync from ${msg.from} (claimed new host: ${newHostId})`);
                return;
            }
            console.log(`📦 Received migration sync from new host ${newHostId}`);
            const migrationEpoch = msg.data?.migrationEpoch ?? msg.data?.snapshot?.migrationEpoch;
            if (!this._acceptMigrationEpoch(migrationEpoch, { source: 'migration_sync', from: msg.from })) {
                console.warn(`[FFA] Rejecting migration sync from ${msg.from}: stale migration epoch ${migrationEpoch}`);
                return;
            }
            // The successor is verified; adopt it as host and take its snapshot.
            const previousHostId = this.network.hostSteamId;
            this.network.hostSteamId = newHostId;
            this.onHostAuthorityChanged({
                previousHostId,
                newHostId,
                source: 'migration_sync',
            });
            const simulationClock = msg.data?.simulationClock;
            if (['fixed60-v1', 'legacy-variable-v1'].includes(simulationClock)) {
                this._transitionSimulationClock(simulationClock);
            }
            if (msg.data.snapshot) {
                this.syncFromHost(msg.data.snapshot);
            }
        });

        // === PHASE 3: FFA COMBAT & HOST MIGRATION ===

        registry.register(MessageTypes.GAME_PLAYER_DIED, (msg) => {
            console.log(`💀 ${msg.data.playerName} died`);
        });

        registry.register(MessageTypes.GAME_PLAYER_FRAG, (msg) => {
            console.log(`🏆 ${msg.data.killerName} fragged ${msg.data.victimName}!`);
        });

        registry.register(MessageTypes.GAME_MATCH_END, (msg) => {
            const data = msg.data || {};
            const winnerName = data.winnerName || 'Draw';
            console.log(`🎊 MATCH OVER! Winner: ${winnerName}`);

            this.gamePhase = 'finished';
            this.winner = data.winner
                ? (this.players.get(data.winner) || { steamId: data.winner, name: winnerName })
                : { steamId: null, name: winnerName };
            this.lastMatchResults = data;

            this.stopGameLoop();
            this.stopStateSyncLoop();

            if (data.isGameOver) {
                emitMultiplayerEvent(MULTIPLAYER_EVENTS.GAME_OVER, {
                    winner: this.winner,
                    winnerName,
                    finalStats: data.finalStats || [],
                    endCondition: data.endCondition,
                    endConditionValue: data.endConditionValue,
                    duration: data.duration,
                    killFeed: data.killFeed || [],
                    isGameOver: true,
                });
            }
        });

        registry.register(MessageTypes.GAME_GARBAGE_SENT, (msg) => {
            console.log(`💥 ${msg.data.fromName} sent ${msg.data.totalLines} lines to ${msg.data.targetCount} players`);
        });

        // Handle attack requests from peers (host routes attacks)
        registry.register(MessageTypes.GAME_ATTACK_REQUEST, (msg) => {
            if (!this.isHost) return; // Only host routes attacks

            const attackerSteamId = msg.from; // from is set by steam-networking
            const { cascadeSummary } = msg.data;

            if (attackerSteamId && cascadeSummary) {
                if (this._authoritativeAttacksEnabled) {
                    this._recordNetEvent?.('attack_request_ignored', {
                        attackerSteamId,
                        reason: 'authoritative_attacks',
                        cascadeSummary,
                    });
                    return;
                }
                console.log(`⚔️ Routing attack from peer ${attackerSteamId}`);
                this._recordNetEvent?.('attack_request', {
                    attackerSteamId,
                    cascadeSummary,
                });
                this.attackRouter.routeAttack(attackerSteamId, cascadeSummary);
            }
        });

        registry.register(MessageTypes.GAME_ROUND_RESTART, (msg) => handleFfaRoundRestart(this, msg));

        // Ready-barrier: HOST collects per-player readies for the pending round.
        registry.register(MessageTypes.GAME_ROUND_READY, (msg) => {
            this._handleRoundReady(msg);
        });

        // Ready-barrier: PEER starts the round only when the host says everyone is go.
        registry.register(MessageTypes.GAME_ROUND_START, (msg) => this._handleRoundStartSignal(msg));
        // PHASE 4.4: Chat messages
        registry.register(MessageTypes.GAME_CHAT, (msg) => {
            const resolved = { ...msg.data };
            if (this.isHost) {
                const rosterPlayer = this.players?.get(msg.from);
                const knownSpectator = this.spectators?.has(msg.from);
                if (!rosterPlayer && !knownSpectator) return;

                // Peer submissions never choose their relayed identity. Bind it
                // to the Steam-authenticated transport sender before history/UI
                // adoption and host rebroadcast.
                resolved.steamId = msg.from;
                resolved.playerName = rosterPlayer?.name || 'Spectator';
                if (rosterPlayer?.color) resolved.color = rosterPlayer.color;
            }
            console.log(`💬 Chat from ${resolved.playerName}: ${resolved.message}`);

            if (!resolved.color && this.players) {
                let player = this.players.get(resolved.steamId);
                if (!player) {
                    for (const [id, p] of this.players) {
                        if (String(id) === String(resolved.steamId)) {
                            player = p;
                            break;
                        }
                    }
                }
                if (!player && resolved.playerName) {
                    for (const p of this.players.values()) {
                        if (p.name === resolved.playerName) {
                            player = p;
                            break;
                        }
                    }
                }
                if (player?.color) {
                    resolved.color = player.color;
                }
            }

            // Add to centralized history
            this.chatHistory.push(resolved);
            if (this.chatHistory.length > 100) this.chatHistory.shift();

            // Show in In-Game UI
            if (this.chat) {
                this.chat.addMessage(resolved);
            }

            // Dispatch to UI (Lobby sees this too)
            if (resolved.steamId !== this.localPlayerId) {
                emitMultiplayerEvent(MULTIPLAYER_EVENTS.CHAT_MESSAGE, {
                    playerName: resolved.playerName,
                    message: resolved.message,
                    steamId: resolved.steamId,
                    timestamp: resolved.timestamp,
                    color: resolved.color,
                });
            }

            // If host, rebroadcast to other peers — excluding the original sender,
            // who already showed their own message locally (prevents a duplicate).
            if (this.isHost) {
                this.broadcastToPeers(MessageTypes.GAME_CHAT, resolved, msg.from);
            }
        });

        // Rematch Voting
        registry.register(MessageTypes.GAME_REMATCH_VOTE, (msg) => {
            const voterId = msg.from;
            if (!this.players.has(voterId)) return;

            console.log(`🗳️ Rematch vote from ${this.players.get(voterId).name}`);
            this.rematchVotes.add(voterId);

            // Broadcast vote update
            if (this.isHost) {
                this.broadcastRematchStatus();
                this.checkRematchThreshold();
            }
        });

        registry.register(MessageTypes.GAME_REMATCH_STATUS, (msg) => {
            this.rematchVotes = new Set(msg.data.votes);
            this.checkRematchThreshold();
            // Emit event for UI
            emitMultiplayerEvent('rematch_status', {
                votes: msg.data.votes,
                total: this.players.size,
                required: Math.ceil(this.players.size / 2),
            });
        });
    }

    // === SENDER-VALIDATED LOBBY/ROUND HANDLERS (plan §1.3) ===
    // Previously any peer could start a match on another peer, release the
    // ready-barrier early, evict anyone from every roster, rewrite a peer's
    // roster, toggle another player's ready state, and refresh host liveness /
    // suppress elections. Each handler now binds authority to the transport
    // sender identity (msg.from is stamped from the transport-level Steam id in
    // _dispatchEnvelope — never attacker-writable payload). Guards fail-open
    // like PLAYER_KICKED: block only when we KNOW the sender is wrong, so a
    // missing from/hostSteamId can't break legit traffic (mock transports may
    // omit `from`). Structural replacement: plan §6A.3 default-deny role table.

    _isFromHost(msg) {
        return !(msg?.from && this.network?.hostSteamId && msg.from !== this.network.hostSteamId);
    }

    /** Sender may act on `steamId` only for itself, unless sender is the host. */
    _isSelfOrHost(msg, steamId) {
        if (!msg?.from) return true; // fail-open: transport didn't stamp a sender
        if (steamId && msg.from === steamId) return true;
        return this._isFromHost(msg);
    }

    _rejectSpoof(type, msg) {
        this._spoofDrops = (this._spoofDrops || 0) + 1;
        console.warn(`🚫 [FFA] Ignoring ${type} from unauthorized sender ${msg?.from}`);
    }

    _handleLobbyPlayerJoined(msg) {
        console.log('📬 LOBBY_PLAYER_JOINED received:', msg);

        // Host receives join announcement from peer — a peer may only announce
        // ITSELF (§1.3 hole d: forged joins under another id).
        if (this.isHost && msg.data.steamId && msg.data.name) {
            if (msg.from && msg.data.steamId !== msg.from) {
                this._rejectSpoof('LOBBY_PLAYER_JOINED (forged join id)', msg);
                return;
            }
            if (!this.network.hasNegotiatedProtocol?.(msg.from)) {
                this._rejectSpoof('LOBBY_PLAYER_JOINED (handshake incomplete)', msg);
                return;
            }
            console.log(`📢 Host received join from: ${msg.data.name} (${msg.data.steamId})`);
            if (msg.data.steamId !== this.localPlayerId) {
                if (msg.data.asSpectator) {
                    this._registerSpectator(msg.data.steamId, msg.data.name);
                } else {
                    const knownPlayer = this.players.has(msg.data.steamId);
                    if (this.addPlayer(msg.data.steamId, msg.data.name) && !knownPlayer) {
                        resyncRequest.routeFfaResync(this, msg.data.steamId, 'join');
                    }
                }
            }
        }

        // Peers receive player list update — roster adoption is host-authoritative
        // (§1.3 hole d: any peer could rewrite a peer's roster).
        if (!this.isHost && msg.data.players) {
            if (!this._isFromHost(msg)) {
                this._rejectSpoof('LOBBY_PLAYER_JOINED (roster from non-host)', msg);
                return;
            }
            console.log('📢 Peer received player list update from host:', msg.data.players);
            if (typeof msg.data.spectatorCount === 'number') {
                this.spectatorCount = msg.data.spectatorCount; // mirror host's count for display
            }
            msg.data.players.forEach((p) => {
                if (!this.players.has(p.steamId)) {
                    console.log(`   Adding player: ${p.name} with color from host: ${p.color}`);
                    this.addPlayer(p.steamId, p.name, p.steamId === this.localPlayerId);
                    // Override auto-assigned color with host's color
                    const player = this.players.get(p.steamId);
                    if (player && p.color) {
                        console.log(`   🎨 Overriding color for ${p.name}: ${player.color} → ${p.color}`);
                        player.color = p.color;
                    }
                    // Adopt the host's authoritative alive/late-joiner state so a drop-in
                    // late joiner isn't briefly shown alive (then skull) before the snapshot.
                    if (player) {
                        if (p.isAlive !== undefined) player.isAlive = p.isAlive;
                        if (p.awaitingSpawn !== undefined) player.awaitingSpawn = p.awaitingSpawn === true;
                    }
                } else {
                    // Update existing player
                    console.log(`   Updating existing player: ${p.name}`);
                    const player = this.players.get(p.steamId);
                    player.isReady = p.isReady;
                    player.isAlive = p.isAlive;
                    // Late joiner waiting state (≠ eliminated) — keep the ⏳ overlay in sync.
                    if (p.awaitingSpawn !== undefined) player.awaitingSpawn = p.awaitingSpawn === true;
                    // Update color if provided (ensures consistency)
                    if (p.color) {
                        player.color = p.color;
                    }
                }
            });
        }
        // Peer received the host's authoritative roster (joins / ready / color
        // updates). Emit so the PEER's Activity Log records host/other ready changes
        // — the host's broadcast updates isReady in place and otherwise never fires
        // PLAYER_LIST_CHANGED on the peer.
        emitMultiplayerEvent(MULTIPLAYER_EVENTS.PLAYER_LIST_CHANGED, { players: this.players });
    }

    _handleLobbyPlayerLeft(msg) {
        // §1.3 hole c: any peer could evict ANY player (steamId comes from
        // attacker-controlled data). A peer may only remove itself; the host may
        // remove anyone.
        if (!this._isSelfOrHost(msg, msg.data?.steamId)) {
            this._rejectSpoof('LOBBY_PLAYER_LEFT', msg);
            return;
        }
        this.removePlayer(msg.data.steamId);
    }

    _handleLobbyGameStart(msg) {
        if (this.isHost) return;
        // §1.3 hole a: any peer could force every other peer into a match.
        if (!this._isFromHost(msg)) {
            this._rejectSpoof('LOBBY_GAME_START', msg);
            return;
        }
        // Seed zero is valid. Missing seed is not: reject before adopting the
        // generation or clearing retained input for a match that cannot start.
        const roundSeed = normalizeFfaRoundSeed(msg.data?.sharedSeed);
        if (roundSeed === null) return;
        console.log('📬 Peer received game start from host!');
        const generation = parseFfaRoundGeneration(msg.data?.roundGeneration);
        if (
            generation === null
            || generation < this.roundGeneration
            || generation === this._lastLobbyStartGeneration
        ) return;
        resetFfaInputEpoch(this);
        this.roundGeneration = generation;
        this._lastLobbyStartGeneration = generation;
        this.startMatch(roundSeed, msg.data.config, { inProgress: !!msg.data.inProgress });
        // MATCH_STARTED emits after the startMatch countdown completes.
    }

    _handleLobbyPlayerReady(msg) {
        // Same class as hole c: ready state may only be toggled by the player
        // itself (or relayed by the host).
        if (!this._isSelfOrHost(msg, msg.data?.steamId)) {
            this._rejectSpoof('LOBBY_PLAYER_READY', msg);
            return;
        }
        const player = this.players.get(msg.data.steamId);
        if (player) {
            player.isReady = msg.data.isReady;
            console.log(`${player.name} is ${msg.data.isReady ? 'ready' : 'not ready'}`);
            // Notify the lobby UI so the host's Activity Log records the peer's
            // ready change. (Player cards update via the 1s interval, but
            // _logRosterChanges only runs on PLAYER_LIST_CHANGED — so without this
            // the host never logs "<peer> is ready".)
            emitMultiplayerEvent(MULTIPLAYER_EVENTS.PLAYER_LIST_CHANGED, { players: this.players });
        }
    }

    _handleNetHeartbeat(msg) {
        // §1.3 hole e: host liveness must only refresh on the HOST's heartbeat —
        // otherwise a peer spamming net:heartbeat keeps a dead host "alive"
        // forever and vetoes every election. Silent drop (heartbeats are 0.5 Hz
        // per peer); counted for netDiag.
        if (!this._isFromHost(msg)) {
            this._heartbeatSpoofsIgnored = (this._heartbeatSpoofsIgnored || 0) + 1;
            return;
        }
        this.hostMigration.onHeartbeat();
    }

    _handleRoundStartSignal(msg) {
        if (this.isHost) return;
        // §1.3 hole b: any peer could release the ready-barrier prematurely.
        if (!this._isFromHost(msg)) {
            this._rejectSpoof('GAME_ROUND_START', msg);
            return;
        }
        const gen = msg.data?.roundGeneration;
        if (typeof gen === 'number' && gen !== this.roundGeneration) return;
        if (this._readyBarrierTimer) {
            clearTimeout(this._readyBarrierTimer); // GO arrived — cancel the local fallback
            this._readyBarrierTimer = null;
        }
        const startThunk = this._pendingRoundStart;
        this._pendingRoundStart = null;
        if (startThunk) {
            console.log(`🚦 [FFA] Peer round-start (gen ${this.roundGeneration})`);
            startThunk();
        }
    }

    performRoundRestart(data) {
        // Defensive direct-call fence in addition to handleFfaRoundRestart's
        // wire seam. Never reset a live round around an absent seed; zero is valid.
        const roundSeed = normalizeFfaRoundSeed(data?.newSeed);
        if (roundSeed === null) return;
        const isFullReset = data.fullReset === true;
        const prefixText = data.prefixText || 'ROUND OVER';
        const countFrom = data.countFrom !== undefined ? data.countFrom : 3;
        const includeZero = data.includeZero === true;
        const instantStart = data.instantStart === true;

        const generation = readFfaRoundAdvance(this.roundGeneration, data?.roundGeneration);
        if (generation === null) return;
        this.roundGeneration = generation;
        // `sharedSeed` is the current round's seed. Adopt it before any reset,
        // ready-barrier deferral, or resync-visible download window opens.
        this.sharedSeed = roundSeed;
        // Drop the stale receive baseline so a delta from before the restart can't
        // decode against round-1 data; the peer waits for the host's fresh keyframe.
        this.network.resetSnapshotBaselines?.();
        console.log(`🔄 [FFA] Peer round restart → generation ${this.roundGeneration}`);

        // ... (Same reset logic as before) ...
        console.log('🔄 Host performing local restart...');

        // Stop current game
        this.stopGameLoop();
        this.stopStateSyncLoop();
        resetFfaInputEpoch(this);

        // Reset trackers
        if (this.fragTracker) {
            this.fragTracker.reset();
        }
        if (this.attackRouter) {
            this.attackRouter.clearHistory();
        }

        // Reset ALL players. Reset the board IN PLACE (gameState.reset()) — never
        // replace the object with `new GameState()`, which orphans references held by
        // the unified-loop registration / BoardScene / render slots and breaks the
        // LOCAL player's board after a restart (the host-side "topped out on spawn,
        // 0 lines" bug; the peer's local board glitches the same way).
        this.players.forEach((player) => {
            player.isAlive = true; // Revive everyone
            player.awaitingSpawn = false; // a waiting late-joiner spawns this round
            player.garbageQueue.clear();
            player.lastAttackerId = null;

            if (isFullReset) {
                player.frags = 0;
                player.gameState.reset();
                player.gameState.level = this.matchConfig.startLevel;
            } else {
                const oldScore = player.gameState.score;
                const oldLines = player.gameState.lines;
                const oldLevel = player.gameState.level;

                player.gameState.reset();
                player.gameState.score = oldScore;
                player.gameState.lines = oldLines;
                player.gameState.level = oldLevel;
            }
        });

        this.winner = null;
        this.gamePhase = 'waiting';

        emitMultiplayerEvent(MULTIPLAYER_EVENTS.ROUND_RESTART, {
            players: Array.from(this.players.keys()),
        });

        const startRound = () => {
            this.gamePhase = 'playing';
            this.players.forEach((player) => {
                player.gameState.randomGenerator = this.createSeededRNG(roundSeed);
                fillBag(player.gameState.nextPieces, player.gameState.randomGenerator);
                spawnPiece(player.gameState, null, null);
            });
            this.startGameLoop();
            this.startStateSyncLoop(); // Host needs to start sync loop!
        };

        // Ready-barrier (host-driven): the peer has finished resetting, so tell the
        // host it's ready and WAIT for GAME_ROUND_START rather than starting now. The
        // host won't resume 30Hz broadcasts until everyone (incl. this peer) is ready.
        if (data.awaitReady) {
            this.hideCountdownOverlay();
            this._pendingRoundStart = startRound;
            const host = this.network.hostSteamId;
            if (host) {
                this.network.sendP2PMessage(host, MessageTypes.GAME_ROUND_READY, {
                    roundGeneration: this.roundGeneration,
                });
            }
            // Safety net: if the host's GAME_ROUND_START is somehow lost, start anyway
            // after a margin so a peer can never hang in 'waiting'. The margin is past
            // the host's own timeout so, in the normal degraded case, the host starts
            // first and the peer follows it rather than racing ahead.
            if (this._readyBarrierTimer) clearTimeout(this._readyBarrierTimer);
            this._readyBarrierTimer = setTimeout(() => {
                const thunk = this._pendingRoundStart;
                if (thunk) {
                    console.warn('⏱️ [FFA] Peer never received round-start — local fallback start');
                    this._pendingRoundStart = null;
                    this._readyBarrierTimer = null;
                    thunk();
                }
            }, this.READY_BARRIER_TIMEOUT_MS + 1500);
            console.log(`🚦 [FFA] Peer ready → waiting for round-start (gen ${this.roundGeneration})`);
            return;
        }

        if (instantStart) {
            this.hideCountdownOverlay();
            startRound();
            return;
        }

        this.showCountdown(startRound, prefixText, countFrom, includeZero);
    }

    sendRematchVote() {
        if (this.isHost) {
            this.rematchVotes.add(this.localPlayerId);
            this.broadcastRematchStatus();
            this.checkRematchThreshold();
        } else {
            this.network.sendP2PMessage(this.network.hostSteamId, MessageTypes.GAME_REMATCH_VOTE, {});
        }
    }

    broadcastRematchStatus() {
        if (!this.isHost) return;
        this.broadcastToPeers(MessageTypes.GAME_REMATCH_STATUS, {
            votes: Array.from(this.rematchVotes),
        });
        // Also update local UI
        emitMultiplayerEvent('rematch_status', {
            votes: Array.from(this.rematchVotes),
            total: this.players.size,
            required: Math.ceil(this.players.size / 2),
        });
    }

    checkRematchThreshold() {
        if (!this.isHost) return;
        const total = this.players.size;
        const votes = this.rematchVotes.size;

        // If majority voted
        if (votes >= Math.ceil(total / 2)) {
            console.log('✅ Rematch threshold reached! Restarting...');
            // Route through the CANONICAL full-restart path (restartFullGame → startMatch):
            // it broadcasts LOBBY_GAME_START with a host seed, re-inits every player via
            // initializePlayerForMatch, and re-arms the sync+heartbeat loops. The old
            // startNewMatch() duplicated this but with NO ready-barrier and NO host-stamped
            // roundGeneration (peers incremented it independently → drift), so it's removed.
            this.rematchVotes.clear();
            setTimeout(() => this.restartFullGame(), 1000);
        }
    }

    broadcastToPeers(type, data, excludeId = null) {
        if (!this.isHost) return;
        this.players.forEach((p, steamId) => {
            if (steamId !== this.localPlayerId && steamId !== excludeId && !p.isDisconnected) {
                this.network.sendP2PMessage(steamId, type, data);
            }
        });
    }

    _applyInputToPlayer(steamId, inputType, data, physicsCallbacks, timing = {}) {
        const player = this.players.get(steamId);
        if (!player || !player.isAlive) {
            return false;
        }
        const { gameState } = player;
        if (this._fixedTickEnabled && hasActiveHitStop(gameState)) {
            if (this.isHost) acknowledgeFfaInput(player, data?.seq);
            this._recordNetEvent?.('input_rejected', {
                steamId, inputType, seq: data?.seq, reason: 'hit_stop',
            });
            return false;
        }
        if (
            timing.inputPhase === true
            && gameState._fixedInputSpawnFrame === gameState.simFrame
        ) return false;
        // Buffer move/rotate while physics owns the piece; spawnPiece consumes the queue.
        if (gameState.isProcessingPhysics || !gameState.currentPiece) {
            if (inputType === 'move' || inputType === 'rotate') {
                const queued = {
                    type: inputType,
                    dir: data.direction,
                };
                if (Array.isArray(gameState.inputQueue)) {
                    if (gameState.inputQueue.length < 4) {
                        gameState.inputQueue.push(queued);
                    }
                } else if (gameState.inputQueue) {
                    gameState.inputQueue = [gameState.inputQueue, queued].slice(0, 4);
                } else {
                    gameState.inputQueue = queued;
                }
            }
            return false;
        }
        const callbacks = physicsCallbacks || this.buildPhysicsCallbacks(steamId);

        switch (inputType) {
        case 'move':
            move(gameState, data.direction, null, null);
            break;
        case 'rotate':
            rotate(gameState, data.direction, null, null);
            break;
        case 'drop':
            if (data.type === 'soft') {
                softDrop(gameState, null, callbacks, timing);
            } else if (data.type === 'hard') {
                const dropCallbacks = {
                    ...callbacks,
                    onHardDrop: (dropData) => {
                        if (callbacks.onHardDrop) callbacks.onHardDrop(dropData);
                        emitMultiplayerEvent('hard_drop_effect', { steamId, dropData });
                    },
                };
                hardDrop(gameState, null, dropCallbacks, timing);
            }
            break;
        default:
            return false;
        }
        return true;
    }

    _resolveBufferedInputTick(steamId, data = {}, policy = {}) {
        return resolveFfaBufferedInputTick(this, steamId, data, policy);
    }

    /**
    * Process player input (HOST ONLY)
    */
    processPlayerInput(steamId, inputType, data, timestamp, policy = {}) {
        if (!this.isHost) {
            console.warn('⚠️ Only host can process inputs');
            return;
        }

        const player = this.players.get(steamId);
        if (!player) return;
        if (!player.isAlive) { acknowledgeFfaInput(player, data?.seq); return; }

        // Validate input (anti-cheat)
        const validation = this.inputValidator.validateInput(
            steamId,
            inputType,
            data,
            timestamp,
            {
                fixedTick: this._fixedTickEnabled === true
                    && (steamId === this.localPlayerId || policy.fixedTickCanonical === true),
            },
        );
        if (!validation.valid) {
            acknowledgeFfaInput(player, data?.seq);
            this._recordNetEvent?.('input_rejected', {
                steamId,
                inputType,
                seq: data?.seq,
                reason: validation.reason || 'validator',
            });
            console.warn(`⚠️ Invalid input from ${player.name}: ${validation.reason}`);
            // TODO: Could kick player for repeated violations
            return;
        }

        // Track input for pattern detection
        this.inputValidator.trackInput(steamId, inputType, data);

        // JITTER BUFFER INTEGRATION
        // When the jitter buffer is enabled, buffer the input and let
        // processBufferedInputs() apply it on its scheduled tick. We must NOT
        // also apply it here: applying in both places double-applies every input
        // (a single "move left" would travel two cells, a rotate would
        // double-rotate), corrupting host-authoritative state and desyncing
        // client prediction.
        // NOTE: temporary correctness fix. The structural fix is tick-boundary
        // input application in the fixed-tick sim refactor (see
        // docs/ARCHITECTURAL_REMEDIATION_PLAN.md Phase 5).
        // P0-1 (perf review §2.1): the HOST'S OWN legacy-path input SKIPS the
        // buffer and falls through to the immediate branch below — buffering it
        // cost the host ~2-3 display frames of self-latency while peers predict
        // locally. A bypassed input is never inserted into the buffer, so the
        // double-apply hazard above cannot occur. Remote inputs still buffer;
        // under fixedTick the host input stays buffered (the dark fixed adapter
        // owns tick-aligned application — do not change its semantics here).
        if (this.useJitterBuffer && this.inputJitterBuffer
            && (steamId !== this.localPlayerId || this._fixedTickEnabled === true)) {
            // Label the input with the jitter buffer's OWN per-frame clock, not
            // hostTick / the client tick. The buffer's processCursor advances once
            // per loop frame (advanceTick in processBufferedInputs), but hostTick
            // only increments inside broadcastGameState (<=30Hz, gated on a
            // significant state change) and a peer's hostTick never advances at
            // all (peers don't broadcast) — so labeling with those clocks lets
            // processCursor overtake the labels within a few frames and every
            // input is then rejected as stale (tick < processCursor). Using the
            // buffer's currentTick guarantees each input is accepted and applied
            // exactly once, bufferDepth frames later. (Discarding data.tick also
            // drops the broken adaptive-offset signal, which was measured against
            // the same stale peer clock.)
            const schedule = this._resolveBufferedInputTick(steamId, data, policy);
            if (schedule.reject) {
                acknowledgeFfaInput(player, data?.seq);
                if (this.inputJitterBuffer.stats) this.inputJitterBuffer.stats.inputsDropped += 1;
                this._recordNetEvent?.('input_rejected', {
                    steamId,
                    inputType,
                    seq: data?.seq,
                    tick: schedule.tick,
                    rawTick: schedule.rawTick,
                    schedule: schedule.source,
                    lateBy: schedule.lateBy,
                    reason: 'adaptive_input_tick',
                });
                return;
            }

            const accepted = this.inputJitterBuffer.addInput(steamId, schedule.tick, {
                type: inputType,
                data,
                timestamp,
            }, {
                jitterTick: schedule.jitterTick ?? schedule.rawTick,
                scheduleSource: schedule.source,
                lateClamped: schedule.lateClamped,
                maxFutureTicks: schedule.maxFutureTicks,
                receivedAt: Date.now(),
            });
            this._recordNetEvent?.(accepted ? 'input_buffered' : 'input_rejected', {
                steamId,
                inputType,
                seq: data?.seq,
                tick: schedule.tick,
                rawTick: schedule.rawTick,
                schedule: schedule.source,
                lateClamped: schedule.lateClamped,
                reason: accepted ? 'buffered' : 'jitter_buffer',
            });
            if (!accepted) acknowledgeFfaInput(player, data?.seq);
            return; // Buffered — applied later by processBufferedInputs().
        }

        // No jitter buffer, or host-local bypass (§2.1): apply immediately.
        // - Local player (host): full callbacks including garbage routing
        // - Remote player (peer): no garbage routing (peer sends their own game:attack:request)
        const isRemotePlayer = steamId !== this.localPlayerId;
        const callbacks = isRemotePlayer
            ? this.buildRemotePlayerCallbacks(steamId)
            : this.buildPhysicsCallbacks(steamId);

        const applied = this._applyInputToPlayer(
            steamId,
            inputType,
            data,
            callbacks,
        );

        // Sequence acknowledgement means the validated command was consumed,
        // even when gameplay disposition rejects it (matching the fixed adapter).
        acknowledgeFfaInput(player, data?.seq);

        if (!applied) {
            return;
        }

        this._recordNetEvent?.('input_applied', {
            steamId,
            inputType,
            seq: data?.seq,
            buffered: false,
        });

        // CRITICAL: Force immediate visual update after input
        // Don't wait for next state sync (30Hz) - render immediately (60Hz)
        this.renderAllPlayers();
    }

    /**
     * Send local player input to host (batched)
     */
    sendInput(inputType, data) {
        if (this.isSpectator) {
            return; // Spectators own no board and never send input (authoritative gate).
        }
        if (this.gamePhase !== 'playing') {
            return; // Can't send inputs if game isn't playing
        }
        if (this.players.get(this.localPlayerId)?.isAlive === false) return;
        if (this.resyncInputFrozen) return;

        const timestamp = Date.now();

        if (this.isHost) {
            // Host processes its own input immediately
            this.processPlayerInput(this.localPlayerId, inputType, data, timestamp);
        } else {
            const seq = ++this.inputSequence;
            const fixedStamp = this._fixedTickEnabled === true
                && this._activeFixedInputStamp
                && Number.isInteger(this._activeFixedInputStamp.simTick)
                && Number.isInteger(this._activeFixedInputStamp.ordinal)
                ? this._activeFixedInputStamp
                : null;
            // Peer queues input for batch sending
            const queuedInput = {
                type: inputType,
                data,
                tick: this.hostTick, // Use estimated host tick
                simTick: fixedStamp?.simTick ?? (this.simTick || 0),
                seq,
                timestamp,
            };
            if (fixedStamp) queuedInput.fixedTickOrdinal = fixedStamp.ordinal;
            this.pendingInputs.push(queuedInput);

            if (!this.inputHistory) this.inputHistory = [];
            this.inputHistory.push(queuedInput);
            if (this.inputHistory.length > 4096) {
                this.inputHistory.splice(0, this.inputHistory.length - 4096);
            }

            this._applyLocalPrediction(inputType, data);
        }
    }

    /**
     * Flush pending inputs to host (called per tick/frame)
     */
    flushInputBatch() {
        if (this.isHost || this.pendingInputs.length === 0) return;
        flushFfaInputBatches(this);
    }

    /**
     * Process a batch of inputs from a peer (HOST ONLY)
     */
    processInputBatch(steamId, batchData, timestamp) {
        processFfaInputBatch(this, steamId, batchData, timestamp);
    }

    _applyLocalPrediction(inputType, data) {
        if (this.isHost) {
            return;
        }

        const applied = this._applyInputToPlayer(
            this.localPlayerId,
            inputType,
            data,
            this.buildLocalPredictionCallbacks(this.localPlayerId),
            this._activeFixedInputStamp ? { fixedTick: true, inputPhase: true } : undefined,
        );

        if (applied) {
            this.renderAllPlayers();
        }
    }

    /**
    * Insert pending garbage for a player (after piece spawns)
    * HOST ONLY
    */
    insertPendingGarbage(steamId) {
        if (!this.isHost) return;

        const player = this.players.get(steamId);
        if (!player || !player.isAlive) return;

        const { garbageQueue } = player;

        // Apply Quadra blind attacks FIRST. This both triggers the blackout
        // and removes leading blind/full_blind entries that would otherwise
        // block dequeueLineBurst() (which bails on a non-'line' head).
        const blindBurst = garbageQueue.takePendingBlindBurst?.() || [];
        blindBurst.forEach((entry) => {
            if (entry.type === 'full_blind') {
                applyFullBlindEffect(player.gameState, entry.duration);
            } else {
                applyBlindEffect(player.gameState, entry.duration);
            }
        });

        const totalLines = garbageQueue.getTotalLines();

        if (totalLines === 0) return;

        this._logGarbage(`💥 Inserting ${totalLines} garbage lines for ${player.name}`);
        this._logGarbage(`💥 Queue has ${garbageQueue.entries.length} total entries before dequeue`);

        // Take lines from queue — DRAIN-ALL to match local (one dump), else one burst.
        const burst = this._garbageDrainAll
            ? drainAllLineBursts(garbageQueue)
            : garbageQueue.dequeueLineBurst();

        if (!burst || burst.length === 0) return;

        this._logGarbage(`💥 Dequeued ${burst.length} entries from garbage queue`);

        // Log all entries in burst to debug attackerId
        burst.forEach((entry, idx) => {
            this._logGarbage(`  Entry ${idx}: type=${entry.type}, attackerId=${entry.attackerId || 'MISSING'}, color=${entry.color}`);
        });

        // Track who sent the garbage for kill attribution
        // Use the last garbage entry's attacker (most recent attacker gets the frag)
        const attackerId = burst.length > 0
            ? (burst[burst.length - 1].attackerId || burst.find((entry) => entry.attackerId)?.attackerId || null)
            : null;
        const attackerName = burst.length > 0
            ? (burst[burst.length - 1].attackerName || burst.find((entry) => entry.attackerName)?.attackerName || null)
            : null;

        if (attackerId) {
            const attacker = this.players.get(attackerId);
            this._logGarbage(`💥 ✅ Garbage from ${attacker?.name || attackerId} is being inserted into ${player.name}'s board`);
            // Track this attacker as the last one who sent garbage to this player
            player.lastAttackerId = attackerId;
        } else {
            this._logGarbage('💥 ❌ NO ATTACKER FOUND in garbage burst! This will be a self-kill.');
        }

        const killerId = attackerId || null;
        const killerName = attackerName || (killerId ? this.players.get(killerId)?.name : null);
        const isSelfKill = !killerId || killerId === steamId;

        // Board mutation + grid/cache repair live in the ONE boundary (§5.1).
        const result = applyGarbage(player.gameState, burst, { debug: this.debugGarbage });

        if (!result || result.topOut) {
            this._logGarbage(`💀 ${player.name} topped out from garbage insertion!`);
            player.isAlive = false;
            player.gameState.isGameOver = true;
            this._recordNetEvent?.('garbage_inserted', {
                targetSteamId: steamId,
                targetName: player.name,
                lines: burst.length,
                attackerId,
                topOut: true,
            });

            if (attackerId) {
                const attacker = this.players.get(attackerId);
                this._logGarbage(`🏆 Kill attributed to: ${attacker?.name || attackerId}`);
            } else {
                this._logGarbage('💀 Self-kill (no attacker found in garbage entries)');
            }

            this.fragTracker.recordDeath(steamId, attackerId, attackerName);
            this._recordNetEvent?.('death', {
                deadSteamId: steamId,
                deadName: player.name,
                killerSteamId: attackerId,
                killerName,
                reason: 'garbage_insert',
            });

            emitMultiplayerEvent(MULTIPLAYER_EVENTS.PLAYER_TOPPED_OUT, {
                steamId,
                playerName: player.name,
                killer: killerId,
                killerId,
                killerName,
                isSelfKill,
                isLocal: steamId === this.localPlayerId,
            });
            return;
        }

        // PHASE 3.2: Dispatch garbage insertion event for visual effects
        emitMultiplayerEvent(MULTIPLAYER_EVENTS.GARBAGE_INSERTED, {
            steamId,
            playerName: player.name,
            linesInserted: burst.length,
            isLocal: steamId === this.localPlayerId,
        });
        this._recordNetEvent?.('garbage_inserted', {
            targetSteamId: steamId,
            targetName: player.name,
            lines: burst.length,
            attackerId,
            topOut: false,
        });

        // Check if player topped out
        if (checkTopOut(player.gameState)) {
            this._logGarbage(`💀 ${player.name} topped out!`);
            player.isAlive = false;
            player.gameState.isGameOver = true;
            this._recordNetEvent?.('death', {
                deadSteamId: steamId,
                deadName: player.name,
                killerSteamId: attackerId,
                killerName,
                reason: 'topout_after_garbage',
            });

            // Award frag to the player who sent the garbage
            if (attackerId) {
                const attacker = this.players.get(attackerId);
                this._logGarbage(`🏆 Kill attributed to: ${attacker?.name || attackerId}`);
            } else {
                this._logGarbage('💀 Self-kill (no attacker found in garbage entries)');
            }
            this.fragTracker.recordDeath(steamId, attackerId, attackerName);

            // Dispatch top-out event
            emitMultiplayerEvent(MULTIPLAYER_EVENTS.PLAYER_TOPPED_OUT, {
                steamId,
                playerName: player.name,
                killer: killerId,
                killerId,
                killerName,
                isSelfKill,
                isLocal: steamId === this.localPlayerId,
            });
        }
    }

    /**
    * PHASE 3.5: Cancel garbage with outgoing attacks (garbage counter)
    * Modern competitive mechanic where outgoing lines cancel incoming garbage first.
    * Only the remainder is sent to opponents (Quadra/TETR.IO style).
    * @param {string} attackerSteamId - The player clearing lines
    * @param {number} outgoingLines - Lines the player would send
    * @returns {number} Lines cancelled (to be subtracted from outgoing attack)
    */
    applyGarbageCounter(attackerSteamId, outgoingLines) {
        if (!this.isHost) return 0;

        // Check if garbage cancellation is enabled (default: full/enabled)
        if (this.matchConfig.garbageCancellation === 'disabled') {
            return 0; // Classic mode - no cancellation
        }

        const attacker = this.players.get(attackerSteamId);
        if (!attacker || !attacker.isAlive) return 0;

        const incomingLines = attacker.garbageQueue.getTotalLines();

        if (incomingLines === 0) {
            return 0; // No incoming garbage to counter
        }

        // Calculate how many lines can be countered (1:1 ratio - Quadra/TETR.IO style)
        const canceledLines = Math.min(incomingLines, outgoingLines);

        if (canceledLines > 0) {
            // Remove canceled lines from queue
            let removed = 0;

            while (removed < canceledLines && attacker.garbageQueue.entries.length > 0) {
                const entry = attacker.garbageQueue.entries[0];
                if (entry.type === 'line') {
                    attacker.garbageQueue.entries.shift();
                    removed++;
                } else {
                    break; // Don't remove non-line entries
                }
            }

            this._logGarbage(`🛡️ ${attacker.name} countered ${removed} garbage lines (${incomingLines} → ${attacker.garbageQueue.getTotalLines()})`);

            this._recordNetEvent?.('garbage_countered', {
                steamId: attackerSteamId,
                linesCanceled: removed,
                incomingLines,
                remainingGarbage: attacker.garbageQueue.getTotalLines(),
            });

            // Dispatch counter event for visual/audio feedback
            emitMultiplayerEvent(MULTIPLAYER_EVENTS.GARBAGE_COUNTERED, {
                steamId: attackerSteamId,
                playerName: attacker.name,
                linesCanceled: removed,
                remainingGarbage: attacker.garbageQueue.getTotalLines(),
                isLocal: attackerSteamId === this.localPlayerId,
            });

            return removed;
        }

        return 0;
    }

    /**
    * Start the match (host initiates, peers receive)
    */
    startMatch(seed = null, config = null, options = {}) {
        // inProgress: a mid-match DROP-IN joiner. It sets up its game UI but does NOT spawn
        // a board (it joins as a dead/waiting roster member) and skips the "get ready"
        // countdown — it watches via the spectate view until the next round restart re-inits
        // it with the shared seed. (Host marks it isAlive:false in addPlayer.)
        const inProgress = !!options.inProgress;
        const seedWasProvided = seed !== null && seed !== undefined;
        const suppliedSeed = normalizeFfaRoundSeed(seed);
        // Invalid explicit values fail closed. Only an absent host seed means
        // "generate one"; peers always require an authoritative wire seed.
        if ((seedWasProvided && suppliedSeed === null) || (!this.isHost && suppliedSeed === null)) {
            return;
        }

        if (this.isHost) {
            // Hosts own seed selection. An explicit seed (including zero) is
            // preserved; ordinary starts generate the unchanged legacy seed.
            this.sharedSeed = suppliedSeed ?? Math.floor(Math.random() * 1000000);

            // Apply config if provided
            if (config) {
                this.matchConfig = { ...this.matchConfig, ...config };
            }
            this._transitionSimulationClock(
                this._fixedTickEnabled ? 'fixed60-v1' : 'legacy-variable-v1',
            );

            // Initialize all players with shared seed
            this.players.forEach((player) => {
                this.initializePlayerForMatch(player, this.sharedSeed);
            });
            this.attackRouter.resetHotPotato();

            const session = this.network.refreshMatchSession();
            broadcastSessionWelcome(this, session);

            this.network.broadcastToAll(MessageTypes.LOBBY_GAME_START, {
                sharedSeed: this.sharedSeed,
                config: this.matchConfig,
                roundGeneration: this.roundGeneration,
            });

            // Start state sync loop (30Hz)
            this.startStateSyncLoop();
            this.startHeartbeatLoop();
        } else {
            // Peer receives seed and config from host
            this.sharedSeed = suppliedSeed;
            if (config) {
                this.matchConfig = { ...this.matchConfig, ...config };
            }
            this._transitionSimulationClock(this.matchConfig.simulationClock);

            // Initialize local player — a SPECTATOR owns no board, so skip it (otherwise
            // initializePlayerForMatch(undefined) crashes). A mid-match DROP-IN joiner also
            // skips board init: it joins dead/waiting and is re-inited (aligned, shared seed)
            // at the next round restart. Both still fall through to MATCH_PREPARING so their
            // watch UI sets up like everyone else.
            if (!this.isSpectator && !inProgress) {
                const localPlayer = this.players.get(this.localPlayerId);
                this.initializePlayerForMatch(localPlayer, suppliedSeed);
                this.attackRouter.resetHotPotato();
            } else if (inProgress) {
                // Mark our own board dead immediately (the host already has us isAlive:false)
                // so the loop skips it and the watch view shows without a flicker of play.
                const localPlayer = this.players.get(this.localPlayerId);
                if (localPlayer) localPlayer.isAlive = false;
            }
        }

        console.log('🎮 Match starting...');
        console.log(`   Seed: ${this.sharedSeed}`);
        console.log(`   End Condition: ${this.matchConfig.endCondition} = ${this.matchConfig.endConditionValue}`);
        console.log(`   Players: ${this.players.size}`);

        // Emit MATCH_PREPARING to set up UI BEFORE countdown
        // This allows the game layout to be visible behind the countdown overlay
        emitMultiplayerEvent(MULTIPLAYER_EVENTS.MATCH_PREPARING, { gameState: this });

        const beginPlaying = () => {
            this.gamePhase = 'playing';
            this.matchStartTime = Date.now();

            // Advertise the match as in-progress so the lobby browser shows late arrivals
            // "Join (next round)" / Watch instead of a normal Join (host-only, no-op for peers).
            this._advertiseLobbyState();

            // Spectators don't simulate a board, so they don't run the game loop.
            if (!this.isSpectator) {
                this.startGameLoop();
            }

            console.log('🎮 Match started!');

            // Dispatch match started event for UI (both host and peer/spectator)
            emitMultiplayerEvent(MULTIPLAYER_EVENTS.MATCH_STARTED, { gameState: this });
        };

        // A SPECTATOR (or a mid-match drop-in joiner) is just watching — no "get ready"
        // countdown (it would be misleading mid-match). Everyone else gets the "GAME START"
        // countdown before the game becomes active.
        if (this.isSpectator || inProgress) {
            beginPlaying();
        } else {
            this.showCountdown(beginPlaying);
        }
    }

    /**
    * Initialize a player for the match with deterministic RNG
    */
    initializePlayerForMatch(player, seed) {
        const roundSeed = normalizeFfaRoundSeed(seed);
        if (roundSeed === null) return false;
        // Reset game state
        player.gameState.reset();
        player.garbageQueue = new GarbageQueue();
        player.isAlive = true;
        player.awaitingSpawn = false; // they're spawning now — no longer a waiting late-joiner
        // DO NOT reset frags here - they persist across rounds until full game reset

        // Set deterministic RNG (same seed = same pieces for ALL players)
        // CRITICAL: All players must use the EXACT same seed for fair play
        player.gameState.randomGenerator = this.createSeededRNG(roundSeed);

        // Fill initial bag with deterministic pieces
        fillBag(player.gameState.nextPieces, player.gameState.randomGenerator);

        // Spawn first piece (no game over callback needed at start)
        spawnPiece(player.gameState, null, null);

        console.log(`✅ Player ${player.name} initialized with seed ${roundSeed}`);
        return true;
    }

    /**
    * Create seeded random number generator — all players get the same piece
    * sequence. Delegates to the ONE LCG (utils/helpers.js, plan §5.6a): the
    * former inline clone here drew the identical sequence but returned a bare
    * function with NO getState/setState/.seed seam, so demo-snapshot RNG
    * capture was silently null for FFA boards (restore was a no-op). The §5.6
    * sfc32 replacement (src/core/rng.js) adopts behind the rngV2 flag.
    */
    createSeededRNG(seed) {
        const roundSeed = normalizeFfaRoundSeed(seed);
        if (roundSeed === null) throw new TypeError('Invalid FFA round seed');
        return seededRandom(roundSeed);
    }

    /**
    * Start broadcasting game state at 30Hz (host only)
    */
    startStateSyncLoop() {
        if (!this.isHost) return;

        // Keep the keepalive heartbeat tied to the state-sync lifecycle. stopStateSyncLoop()
        // calls stopHeartbeatLoop(), and the round restart paths only re-call
        // startStateSyncLoop() — so without this the heartbeat dies at the first round end
        // and never restarts, and the peer false-migrates ~5s into round 2 (only
        // NET_HEARTBEAT refreshes HostMigration). startHeartbeatLoop() is idempotent.
        this.startHeartbeatLoop();

        // Clear any existing interval
        if (this.stateSyncInterval) {
            clearInterval(this.stateSyncInterval);
        }

        // Low-frequency fallback; normal snapshots are RAF-aligned in onUpdate.

        this.stateSyncInterval = setInterval(() => {
            if (this.gamePhase === 'playing') {
                const now = Date.now();

                if ((now - this._lastStateBroadcastTime) > 500) {
                    this.broadcastGameState();
                    this._lastStateBroadcastTime = now;
                }

                this._updateSyncpoint();
                this._processPendingResyncs();
            }
        }, 500);

        console.log(`📡 State sync started (${this.STATE_SYNC_RATE}Hz with delta optimization)`);
    }

    /**
    * Stop state sync loop
    */
    stopStateSyncLoop() {
        if (this.stateSyncInterval) {
            clearInterval(this.stateSyncInterval);
            this.stateSyncInterval = null;
            console.log('📡 State sync stopped');
        }

        this.stopHeartbeatLoop();
    }

    /**
     * Start heartbeat loop (Host only)
     * Sends keepalive every 1 second
     */
    startHeartbeatLoop() {
        if (!this.isHost) return;
        this.stopHeartbeatLoop();

        this.heartbeatInterval = setInterval(() => {
            this.network.broadcastToAll(MessageTypes.NET_HEARTBEAT, {
                timestamp: Date.now(),
            });
        }, 1000);

        console.log('💓 Heartbeat loop started');
    }

    stopHeartbeatLoop() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    _updateSyncpoint() { publishFfaJoinSyncpoint(this); }

    _processPendingResyncInputBarrier() {
        return resyncInputBarrier.drainFfaPeerResyncInputBarrier(this);
    }

    _getSatisfiedResyncInputRequirement(steamId) {
        return resyncInputBarrier.getFfaSatisfiedResyncInputRequirement(this, steamId);
    }

    _processPendingResyncs() {
        const send = (id, _marker, barrier) => resyncInputBarrier.startFfaResyncTransfer(this, id, barrier);
        drainFfaPendingResyncs(this, send);
    }

    /** @returns {AuthoritativeStateSnapshot} */
    buildStateSnapshot() {
        const players = Array.from(this.players.entries()).map(([steamId, player]) => ({
            steamId,
            name: player.name,
            color: player.color,
            score: player.gameState.score,
            lines: player.gameState.lines,
            level: player.gameState.level,
            frags: player.frags,
            isAlive: player.isAlive,
            awaitingSpawn: player.awaitingSpawn === true, // late joiner waiting to spawn (≠ eliminated)
            garbagePending: player.garbageQueue.getTotalLines(),
            lastAttackerId: player.lastAttackerId || null,
            lockSeq: player._lockSeq || 0,
            grid: player.gameState.boardGrid,
            currentPiece: player.gameState.currentPiece,
            nextPieces: player.gameState.nextPieces,
            dropCounter: player.gameState.dropCounter,
            dropInterval: player.gameState.dropInterval,
            garbageEntries: player.garbageQueue.entries.map((entry) => ({
                type: entry.type,
                attackerId: entry.attackerId,
                attackerName: entry.attackerName,
                color: entry.color,
                holeMask: entry.holeMask,
                variant: entry.variant,
                duration: entry.duration,
                isLastInBurst: entry.isLastInBurst === true,
                attackId: entry.attackId,
                attackSeq: entry.attackSeq,
                lineIndex: entry.lineIndex,
                targetId: entry.targetId,
                createdSimTick: entry.createdSimTick,
                sourceSimTick: entry.sourceSimTick,
                sourceLockSeq: entry.sourceLockSeq,
                applyAfterLockSeq: entry.applyAfterLockSeq,
                applySimTick: entry.applySimTick,
                rulesHash: entry.rulesHash,
                clearSummary: entry.clearSummary,
            })),
            lockedPieces: player.gameState.lockedPieces.map((piece) => ({
                x: piece.x,
                y: piece.y,
                shape: piece.shape,
                color: piece.color,
                shapeKey: piece.shapeKey,
            })),
            blindTimers: player.gameState.blindTimers ? {
                field: player.gameState.blindTimers.field,
                fieldMax: player.gameState.blindTimers.fieldMax,
                pending: player.gameState.blindTimers.pending,
                pendingMax: player.gameState.blindTimers.pendingMax,
            } : null,
            lastInputSeq: player.lastInputSeq,
        }));
        // Phase 4: Calculate state digest for desync detection
        const stateDigest = this._calculateStateDigest(players);
        return {
            players,
            gamePhase: this.gamePhase,
            roundGeneration: this.roundGeneration, // fence: peers drop snapshots from an older round
            hotPotatoState: this.hotPotatoState ? { ...this.hotPotatoState } : null,
            winner: this.winner ? {
                steamId: this.winner.steamId,
                name: this.winner.name,
            } : null,
            timestamp: Date.now(),
            tick: this.hostTick,
            simTick: this.simTick,
            snapshotSeq: this.snapshotSeq,
            migrationEpoch: this.migrationEpoch || 0,
            // Phase 4: State digest for desync detection
            digest: stateDigest,
        };
    }

    /**
     * Phase 4: Calculate a digest of the critical game state for desync detection
     * Uses a simple hash of scores, frags, and alive status - fast to compute
     */
    _calculateStateDigest(players) {
        // Build a string of critical state values
        const stateString = players
            .sort((a, b) => a.steamId.localeCompare(b.steamId)) // Deterministic order
            .map((p) => `${p.steamId}:${p.score}:${p.lines}:${p.frags}:${p.isAlive ? 1 : 0}:${p.garbagePending}`)
            .join('|');

        // Simple hash (DJB2 algorithm)
        let hash = 5381;
        for (let i = 0; i < stateString.length; i++) {
            hash = ((hash << 5) + hash) + stateString.charCodeAt(i);
            hash &= hash; // Convert to 32-bit integer
        }
        return (hash >>> 0).toString(16); // Unsigned hex string
    }

    /** @returns {AuthoritativeStateSnapshot} */
    getFullState() {
        return this.buildStateSnapshot();
    }

    /**
    * Check if any player state has changed significantly
    * Used to avoid broadcasting when nothing has changed
    */
    hasSignificantStateChanges() {
        if (!this.isHost) return false;

        for (const [steamId, player] of this.players) {
            const lastState = this.lastBroadcastState.get(steamId);

            if (!lastState) {
                return true; // No previous state, so broadcast
            }

            const currentState = player.gameState;

            // Check for significant changes
            const hasChanges = (
                lastState.score !== currentState.score
                || lastState.lines !== currentState.lines
                || lastState.level !== currentState.level
                || lastState.currentPieceY !== currentState.currentPiece?.y
                || lastState.currentPieceX !== currentState.currentPiece?.x
                || lastState.dropCounter !== currentState.dropCounter
                || lastState.garbagePending !== player.garbageQueue.getTotalLines()
                || player.frags !== lastState.frags
                || player.isAlive !== lastState.isAlive
                || lastState.hotPotatoGeneration !== (this.hotPotatoState?.generation || 0)
            );

            if (hasChanges) {
                return true;
            }
        }

        return false; // No changes detected
    }

    maybeBroadcastPostPhysics(delta) {
        if (!this.isHost || this.gamePhase !== 'playing') return;

        this._stateBroadcastAccumulator += delta;
        const minBroadcastInterval = 1000 / this.STATE_SYNC_RATE;
        if (this._stateBroadcastAccumulator < minBroadcastInterval) {
            return;
        }

        this._stateBroadcastAccumulator %= minBroadcastInterval;
        if (this.hasSignificantStateChanges()) {
            this.broadcastGameState();
            this._lastStateBroadcastTime = Date.now();
        }

        this._updateSyncpoint();
        this._processPendingResyncs();
    }

    /**
    * Broadcast current game state to all peers (host only)
    * Enhanced to include full board state for accurate rendering
    */
    broadcastGameState() {
        if (!this.isHost) return;
        this.hostTick += 1;
        this.snapshotSeq += 1;
        this._lastStateBroadcastTime = Date.now();

        // Update last broadcast state snapshots
        for (const [steamId, player] of this.players) {
            this.lastBroadcastState.set(steamId, {
                score: player.gameState.score,
                lines: player.gameState.lines,
                level: player.gameState.level,
                currentPieceY: player.gameState.currentPiece?.y,
                currentPieceX: player.gameState.currentPiece?.x,
                dropCounter: player.gameState.dropCounter,
                garbagePending: player.garbageQueue.getTotalLines(),
                frags: player.frags,
                isAlive: player.isAlive,
                awaitingSpawn: player.awaitingSpawn === true,
                hotPotatoGeneration: this.hotPotatoState?.generation || 0,
            });
        }

        const state = this.buildStateSnapshot();
        const skipPeers = this._getDownloadJoinBlockedPeers();
        this.network.broadcastSnapshot(MessageTypes.GAME_STATE_FULL, state, skipPeers.size > 0 ? { skipPeers } : {});
        if (this._netDiagEnabled) {
            this._maybeFlushNetDiag();
        }
    }

    /** Sync state from the host and render it. @param {StateSnapshot} state */
    syncFromHost(state) {
        if (this.isHost) return;

        // Phase 4: Desync detection — the backstop for prediction divergence.
        if (this._desyncCheckEnabled && this._peerLocalSimEnabled) {
            // PEER-OWNS-BOARD backstop. The peer's board is a local sim that runs AHEAD of
            // the host's ~RTT-lagged snapshot, so the old "peer-current vs host-previous"
            // digest would false-fire every frame. Instead compare ONLY when the host has
            // CAUGHT UP to all our inputs (lastInputSeq >= our inputSequence) AND both sides
            // are SETTLED (peer not mid-cascade) — at that instant our OWNED score/lines MUST
            // equal the host's authoritative result (deterministic sim). A mismatch is a TRUE
            // divergence (rare: gravity-lock timing under frame-cadence skew, or a host-
            // dropped input). N consecutive + a 3s rate-limit → ONE clean forceLocal resync,
            // not a continuous soft glitch. (Score is fully deterministic — the time-based
            // lock bonus is a constant 50 since simTimeMs never advances in the MP path.)
            const lp = this.players.get(this.localPlayerId);
            const lpData = state.players && state.players.find((p) => p.steamId === this.localPlayerId);
            const caughtUp = lpData && typeof lpData.lastInputSeq === 'number'
                && lpData.lastInputSeq >= (this.inputSequence || 0);
            const settled = !!(lp && lp.gameState && lp.gameState.isProcessingPhysics !== true);
            if (lp && lpData && caughtUp && settled) {
                const diverged = (lpData.score !== lp.gameState.score) || (lpData.lines !== lp.gameState.lines);
                if (diverged) {
                    this._desyncCount = (this._desyncCount || 0) + 1;
                    if (this._desyncCount >= 3 && (Date.now() - (this._lastResyncAt || 0)) > 3000) {
                        console.warn('⚠️ [peerLocalSim] divergence after host caught up '
                            + `(score ${lp.gameState.score}/${lpData.score}, lines ${lp.gameState.lines}/${lpData.lines}) → resync`);
                        this._lastResyncAt = Date.now();
                        this._requestResync();
                        this._desyncCount = 0;
                    }
                } else {
                    this._desyncCount = 0;
                }
            } else {
                this._desyncCount = 0; // not caught up / mid-cascade → running ahead is expected
            }
        } else if (state.digest && this._lastHostDigest) {
            // Legacy path (peerLocalSim OFF): compare current local digest to host's previous.
            const expectedDigest = this._lastHostDigest;
            const localDigest = this._calculateStateDigest(
                Array.from(this.players.entries()).map(([steamId, player]) => ({
                    steamId,
                    score: player.gameState.score,
                    lines: player.gameState.lines,
                    frags: player.frags,
                    isAlive: player.isAlive,
                    awaitingSpawn: player.awaitingSpawn === true,
                    garbagePending: player.garbageQueue?.getTotalLines() || 0,
                })),
            );
            // HOLD-AWARE: while LOCAL-BOARD HOLD keeps our board a few frames ahead, our local
            // score/lines/garbage legitimately run ahead of the host's PREVIOUS digest — that
            // is the expected cost of the hold, not a real desync. Skip the tally during a hold.
            const holdingAhead = this._localBoardHoldEnabled && (this._localBoardHoldCount || 0) > 0;
            if (localDigest !== expectedDigest && this._desyncCheckEnabled && !holdingAhead) {
                this._desyncCount = (this._desyncCount || 0) + 1;
                if (this._desyncCount >= 5) {
                    console.warn(`⚠️ Desync detected: local=${localDigest}, expected=${expectedDigest}`);
                    this._requestResync();
                    this._desyncCount = 0;
                }
            } else {
                this._desyncCount = 0; // Reset on successful sync (or while holding ahead)
            }
        }

        // Store host digest for next comparison
        this._lastHostDigest = state.digest;

        this._applySnapshotState(state, { forceLocal: false, reconcileLocal: true });
        // The local falling piece is now locally OWNED (see _reconcileLocalPiece): the
        // snapshot no longer resets it, so the old reset+replay reconciliation would
        // DOUBLE-APPLY inputs. _reconcileLocalPlayer is prune-only now — it only bounds
        // the unacked-input history; the piece pose is never yanked by a stale host frame.
        this._reconcileLocalPlayer();
    }

    /**
     * Prune acknowledged inputs from the local input history.
     *
     * Previously this RESET the local board to the host snapshot and REPLAYED unacked
     * inputs (classic server reconciliation). That fought the local simulation: the
     * snapshot clobbered the predicted x/rotation/y every frame and the replay was
     * silently swallowed whenever a lock/line-clear animation set isProcessingPhysics —
     * the visible "rotation snaps / feels off" on the peer's own board. The local
     * falling piece is now LOCALLY OWNED (see _reconcileLocalPiece / _applySnapshotState),
     * Quadra-style: never yanked by a remote frame. So this only bounds inputHistory.
     */
    _reconcileLocalPlayer() {
        if (this.isHost) return;
        const player = this.players.get(this.localPlayerId);
        if (!player || !player.gameState) return;
        const serverLastSeq = player.lastInputSeq || 0;
        if (!this.inputHistory) this.inputHistory = [];
        this.inputHistory = this.inputHistory.filter((input) => input.seq > serverLastSeq);
    }

    /**
     * Reconcile the LOCAL player's falling piece against the host snapshot WITHOUT
     * clobbering smooth local control. The active piece is locally simulated; we adopt
     * the host's authoritative pose ONLY when:
     *   - the host shows a different piece TYPE (a lock happened → fresh spawn at the
     *     top, nothing to "snap"), or
     *   - the locally-predicted pose is now ILLEGAL in the freshly-adopted authoritative
     *     grid (host inserted garbage / cleared lines under us → genuine divergence).
     * Otherwise the local x / rotation / y are kept exactly as predicted — no snap on
     * rotate/move/fall. (Grid/garbage/stats are already adopted by the caller; a sustained
     * digest desync still force-corrects via the forceLocal resync path.)
     */
    _reconcileLocalPiece(gs, hostPieceData) {
        const local = gs.currentPiece;
        const host = hostPieceData ? { ...hostPieceData } : null;
        // Host has no active piece (mid lock / line-clear): keep the local piece — the
        // peer locks its own piece via local prediction and re-bases at the next spawn.
        if (!host) return;
        if (!local) { gs.currentPiece = host; return; }
        // Piece identity changed → host advanced to a new piece. Adopt the fresh spawn.
        if (host.type !== local.type) { gs.currentPiece = host; return; }
        // Same piece, still falling: trust local x/rotation/y. Only snap if the local
        // pose no longer fits the new authoritative grid (rare: garbage/line-clear under us).
        if (!canPlacePiece(gs, local, local.x, local.y)) {
            gs.currentPiece = host;
        }
    }

    /**
     * Phase 4: Request resync from host when desync detected
     */
    _requestResync(reason = 'desync_detected') {
        return resyncRequest.requestFfaAuthoritativeResync(this, reason);
    }

    /**
     * Phase 4: Enable/disable desync detection
     */
    setDesyncDetection(enabled) {
        this._desyncCheckEnabled = enabled;
        this._desyncCount = 0;
    }

    _sanitizeNetEventData(value, depth = 0) {
        return sanitizeFfaNetEventData(value, depth);
    }

    _recordNetEvent(type, data = {}) {
        if (!this._netEventLogEnabled || !type || (!this.isHost && type !== 'sim_clock_warp')) return null;
        if (!Array.isArray(this._netEventLog)) this._netEventLog = [];
        const nextId = (Number(this._netEventLogSeq) || 0) + 1;
        this._netEventLogSeq = nextId;
        const event = {
            id: nextId,
            at: Date.now(),
            tick: this.hostTick || 0,
            simTick: this.simTick || 0,
            gen: this.roundGeneration || 0,
            phase: this.gamePhase || 'unknown',
            type,
            data: this._sanitizeNetEventData(data),
        };
        this._netEventLog.push(event);
        const limit = Math.max(1, this._netEventLogLimit || 512);
        if (this._netEventLog.length > limit) {
            this._netEventLog.splice(0, this._netEventLog.length - limit);
        }
        return event;
    }

    getNetEventLogSnapshot(limit = this._netEventLogLimit || 512) {
        const events = Array.isArray(this._netEventLog) ? this._netEventLog : [];
        const max = Math.max(0, Number(limit) || 0);
        return events.slice(Math.max(0, events.length - max)).map((event) => ({
            ...event,
            data: this._sanitizeNetEventData(event.data),
        }));
    }

    clearNetEventLog() {
        this._netEventLog = [];
        this._netEventLogSeq = 0;
    }

    _countOccupiedCells(grid) {
        return countOccupiedFfaCells(grid);
    }

    _stableRuleHash(value) {
        return stableFfaRuleHash(value);
    }

    _createAttackMetadata(attackerSteamId, cascadeSummary = {}) {
        const attacker = this.players.get(attackerSteamId);
        const attackSeq = (Number(this._attackSeq) || 0) + 1;
        this._attackSeq = attackSeq;
        return {
            attackId: `r${this.roundGeneration || 0}-a${attackSeq}`,
            attackSeq,
            attackerId: attackerSteamId,
            sourceSimTick: this.simTick || 0,
            createdSimTick: this.simTick || 0,
            sourceLockSeq: attacker?._lockSeq || 0,
            clearSummary: this._sanitizeNetEventData(cascadeSummary),
            rulesHash: this._stableRuleHash(this.matchConfig?.attackRules || {}),
        };
    }

    _netDiagCounterDelta(current, previous, key) {
        return ffaCounterDelta(current, previous, key);
    }

    prepareMigrationClaim() {
        if (!this._migrationEpochEnabled) return this.migrationEpoch || 0;
        this.migrationEpoch = (Number(this.migrationEpoch) || 0) + 1;
        this._recordNetEvent?.('migration_epoch_advanced', {
            migrationEpoch: this.migrationEpoch,
            reason: 'claim',
        });
        return this.migrationEpoch;
    }

    _acceptMigrationEpoch(epoch, meta = {}) {
        if (!this._migrationEpochEnabled) return true;

        const nextEpoch = Number(epoch);
        if (!Number.isFinite(nextEpoch)) {
            this._recordNetEvent?.('migration_epoch_rejected', {
                reason: 'missing',
                source: meta.source,
                from: meta.from,
                current: this.migrationEpoch || 0,
            });
            return false;
        }

        const current = Number(this.migrationEpoch) || 0;
        if (nextEpoch < current) {
            this._recordNetEvent?.('migration_epoch_rejected', {
                reason: 'stale',
                source: meta.source,
                from: meta.from,
                current,
                incoming: nextEpoch,
            });
            return false;
        }

        if (nextEpoch > current) {
            this.migrationEpoch = nextEpoch;
            this._recordNetEvent?.('migration_epoch_accepted', {
                source: meta.source,
                from: meta.from,
                migrationEpoch: nextEpoch,
            });
        }
        return true;
    }

    /**
     * Peer net-health: emit one concise summary line per ~second, then reset the
     * window counters. Counting opponent non-empty cells distinguishes "applied a
     * real board" from "applied an empty board" without dumping whole grids — the
     * single most discriminating signal for connectivity vs decode vs apply vs render.
     */
    _maybeFlushNetDiag() {
        const d = this._netDiag;
        const now = Date.now();
        if (!d.lastLogAt) { d.lastLogAt = now; return; }
        if (now - d.lastLogAt < 1000) return;

        let oppCells = 0;
        let oppPlayers = 0;
        this.players.forEach((player, steamId) => {
            if (steamId === this.localPlayerId) return;
            oppPlayers += 1;
            const grid = player.gameState && player.gameState.boardGrid;
            if (Array.isArray(grid)) {
                for (let r = 0; r < grid.length; r += 1) {
                    const row = grid[r];
                    if (Array.isArray(row)) {
                        for (let c = 0; c < row.length; c += 1) if (row[c]) oppCells += 1;
                    }
                }
            }
        });

        const myPlayer = this.players.get(this.localPlayerId);
        const mySeq = myPlayer ? (myPlayer.lastInputSeq ?? '?') : 'n/a';
        const packetStats = this.network?.getPacketStats?.() || {};
        const previousPacketStats = d.lastPacketStats || {};
        const packetDelta = (key) => this._netDiagCounterDelta(packetStats, previousPacketStats, key);
        const impairmentStats = packetStats.netImpairment || {};
        const previousImpairmentStats = previousPacketStats.netImpairment || {};
        const impairmentDelta = (key) => this._netDiagCounterDelta(impairmentStats, previousImpairmentStats, key);
        const backpressure = this.network?.getBackpressureStats?.() || {};
        const backpressurePeers = Object.values(backpressure);
        const sendRate = backpressurePeers.length > 0
            ? Math.min(...backpressurePeers.map((s) => Number(s.currentRate || 30)))
            : 0;
        const queueDropped = backpressurePeers.reduce((sum, s) => sum + Number(s.totalDropped || 0), 0);
        const queueSent = backpressurePeers.reduce((sum, s) => sum + Number(s.totalSent || 0), 0);
        const queueDropRate = queueSent > 0 ? Math.round((queueDropped / Math.max(1, queueDropped + queueSent)) * 100) : 0;
        const jitterStats = this.inputJitterBuffer?.getStats?.() || null;
        const heartbeatAge = !this.isHost && this.hostMigration?.lastHeartbeatTime
            ? Math.max(0, now - this.hostMigration.lastHeartbeatTime)
            : 0;
        const resyncInFlight = (this.resyncTransfers?.size || 0) + (this.resyncBuffers?.size || 0);
        const bytesRxP95 = packetStats.snapshotDeltaWireBytesReceived?.p95 || packetStats.snapshotBytesReceived?.p95 || 0;
        const bytesTxP95 = packetStats.snapshotDeltaWireBytesSent?.p95 || packetStats.snapshotBytesSent?.p95 || 0;
        const impairmentText = impairmentStats.enabled
            ? `imp=drop${impairmentDelta('dropped')}/dup${impairmentDelta('duplicated')}/reord${impairmentDelta('reordered')}/delay${impairmentDelta('delayed')} `
            : '';
        const lastEvent = Array.isArray(this._netEventLog) && this._netEventLog.length > 0
            ? this._netEventLog[this._netEventLog.length - 1]
            : null;
        const eventText = this._netEventLogEnabled
            ? `events=${this._netEventLog?.length || 0}${lastEvent ? `:${lastEvent.type}` : ''} `
            : '';
        const jitterText = jitterStats
            ? `${jitterStats.bufferDepth}t/${Math.round(jitterStats.avgJitterMs || 0)}ms`
                + (this._adaptiveInputJitterEnabled ? `/off${Number(jitterStats.avgOffsetTicks || 0).toFixed(1)}t` : '')
            : '-';
        console.log(
            `📡 [NET] role=${this.isHost ? 'host' : 'peer'} phase=${this.gamePhase} gen=${this.roundGeneration} `
            + `tick=${this.hostTick} sim=${this.simTick || 0} snap=${this.snapshotSeq || 0} rx/s=${d.rx} kf=${packetDelta('keyframesReceived')}/${packetDelta('keyframesSent')} `
            + `del=${packetDelta('deltasReceived')}/${packetDelta('deltasSent')} stale=${packetDelta('staleDeltasDropped')} `
            + `miss=${packetDelta('missingBaselineDeltas')} ahead=${packetDelta('aheadOfBaselineDeltas')} `
            + `decErr=${packetDelta('decodeFailures')} resync=${packetDelta('resyncRequestsSent')}/${resyncInFlight} `
            + `boards=${d.boardsApplied} lockSkips=${d.lockSkips} oppCells=${oppCells}(${oppPlayers}p) `
            + `rate=${sendRate || '-'}Hz qDrop=${queueDropRate}% bytesP95 rx/tx=${bytesRxP95}/${bytesTxP95} `
            + impairmentText
            + eventText
            + `jit=${jitterText} `
            + `inDrop=${jitterStats?.inputsDropped ?? 0} future=${jitterStats?.inputsTooFuture ?? 0} `
            + `hbAge=${heartbeatAge}ms myLastSeq=${mySeq}`,
        );

        d.lastPacketStats = { ...packetStats };
        d.rx = 0; d.boardsApplied = 0; d.genDrops = 0; d.lockSkips = 0; d.decodeErrors = 0;
        d.lastLogAt = now;
    }

    /** @param {StateSnapshot} state @param {{forceLocal: boolean, reconcileLocal?: boolean, render?: boolean}} options */
    _applySnapshotState(state, options) {
        const { forceLocal, reconcileLocal = false, render = true } = options;
        if (this._netDiagEnabled) {
            this._netDiag.rx += 1;
            this._maybeFlushNetDiag();
        }
        // A4c RESTART-RACE GUARD (peer): once we've reset for the next round and are
        // waiting for the host's authoritative GAME_ROUND_START (ready-barrier path),
        // DROP every snapshot — even one already stamped with the NEW generation. A host
        // frame that arrives out-of-order BEFORE GAME_ROUND_START would otherwise overwrite
        // the just-reset board (the verified "stack jumps taller then resets" RTT hole).
        // The ready-barrier becomes the SOLE resume gate: GAME_ROUND_START (or the peer's
        // fallback timer) clears _pendingRoundStart, after which snapshots apply normally.
        // forceLocal (a digest resync) is the one correction path allowed to pass.
        if (!this.isHost && this._pendingRoundStart && !forceLocal) {
            if (this._netDiagEnabled) this._netDiag.genDrops += 1;
            return;
        }
        // ROUND FENCE: ignore authoritative state from a round we've already left.
        // After a restart, a stale round-N snapshot (unreliable, deferred) can land
        // AFTER the reliable round-(N+1) restart; applying it would re-set
        // isAlive=false / gamePhase='finished' and permanently freeze the next round.
        if (typeof state.roundGeneration === 'number'
            && state.roundGeneration < this.roundGeneration) {
            if (this._netDiagEnabled) this._netDiag.genDrops += 1;
            console.warn(`⏮️ [FFA] Dropped stale snapshot: gen ${state.roundGeneration} < current ${this.roundGeneration}`);
            return;
        }

        if (this._acceptMigrationEpoch
            && !this._acceptMigrationEpoch(state.migrationEpoch, { source: 'snapshot' })) {
            console.warn(`[FFA] Dropped stale migration snapshot: epoch ${state.migrationEpoch} < current ${this.migrationEpoch}`);
            return;
        }

        if (typeof state.simTick === 'number') {
            this.simTick = Math.max(this.simTick || 0, state.simTick);
        }
        if (typeof state.snapshotSeq === 'number') {
            this.snapshotSeq = Math.max(this.snapshotSeq || 0, state.snapshotSeq);
        }

        // Phase 0: a new round clears stale LOCAL-BOARD HOLD state so a round-1 tail
        // lock (its recentlyLocked window / hold count) can never bridge into round 2
        // and spuriously hold round-2's first frames. Robust to every restart path.
        if (this._localBoardHoldRoundGen !== this.roundGeneration) {
            this._localBoardHoldRoundGen = this.roundGeneration;
            this._localBoardHoldCount = 0;
            this._lastLocalLockTime = 0;
            // New round: forget consumed-garbage keys so a fresh round's queue adopts cleanly.
            this._peerConsumedBursts?.clear();
        }
        // A hard digest resync (forceLocal) re-adopts the authoritative queue wholesale —
        // drop the consumed-set so nothing is incorrectly filtered out of the resync.
        if (forceLocal) this._peerConsumedBursts?.clear();

        // Update all player states from host
        state.players.forEach((playerData) => {
            const player = this.players.get(playerData.steamId);
            if (player) {
                const isLocalPlayer = playerData.steamId === this.localPlayerId;

                if (playerData.color) {
                    player.color = playerData.color;
                }

                // ── LOCAL-BOARD HOLD decision — computed BEFORE stats so SCORE/LINES/
                // LEVEL and the GARBAGE queue can be gated by the SAME hold as the grid
                // (Phase 0). The LOCAL player owns its falling piece AND, during a predicted
                // clear/cascade/combo, its score/lines/garbage: re-basing any of them to a
                // latency-stale host frame mid-animation is what made clears "feel way off"
                // on the peer. forceLocal (hard digest resync) bypasses the hold entirely.
                const ownsLocalPiece = isLocalPlayer && reconcileLocal && !forceLocal;
                // PEER-OWNS-BOARD: the local player's entire sim (grid/piece/nextPieces/
                // dropCounter/score/lines/level/dropInterval) is NEVER re-based per-frame —
                // it's a pure local sim, corrected only by the forceLocal digest-resync.
                // Supersedes the LOCAL-BOARD HOLD heuristic below.
                const peerOwns = ownsLocalPiece && this._peerLocalSimEnabled;
                let holdLocalBoard = false;
                if (ownsLocalPiece && !peerOwns && this._localBoardHoldEnabled) {
                    // Signal 1: host hasn't applied our latest INPUT (hard-drop/move locks
                    // advance inputSequence).
                    const hostBehindInput = typeof playerData.lastInputSeq === 'number'
                        && playerData.lastInputSeq < (this.inputSequence || 0);
                    // Signal 2: our settled board has cells the host frame lacks — catches
                    // GRAVITY locks (which don't advance inputSequence): we hold so a stale
                    // pre-lock host frame can't erase our just-locked piece. BUT only when
                    // the host is NOT ahead on CLEARS — if the host cleared MORE lines than
                    // we predicted (host lines > ours) its shorter grid is the authoritative
                    // truth and our extra cells are an UNDER-prediction we must adopt, not a
                    // lock we should protect. (Without this guard a host-cleared-more frame
                    // mis-trips localAhead and the peer clings to its taller wrong board.)
                    const localAhead = !hostBehindInput
                        && playerData.grid
                        && (typeof playerData.lines !== 'number' || playerData.lines <= (player.gameState.lines || 0))
                        && this._countOccupiedCells(player.gameState.boardGrid)
                            > this._countOccupiedCells(playerData.grid);
                    // Signal 3: we locked very recently — covers clearing locks where the
                    // board ends SMALLER than the host's pre-clear frame (localAhead false)
                    // and the input was already acked at low latency (hostBehindInput false).
                    const recentlyLocked = (Date.now() - (this._lastLocalLockTime || 0)) < this._RECENT_LOCK_MS;
                    // Signal 4 (Phase 0): the local clear/cascade ANIMATION is still running.
                    // processPhysics holds isProcessingPhysics=true for the WHOLE multi-stage
                    // cascade, so this ties the hold to the actual animation length instead
                    // of a fixed 250ms/30-frame window — a deep cascade no longer releases
                    // the board mid-fade. Local-only flag (set by our own prediction path,
                    // self-clears when the animation ends).
                    const localProcessingPhysics = player.gameState.isProcessingPhysics === true;
                    // Signal 5: the host has NOT yet caught up to our predicted cleared line
                    // count, so its snapshot grid is a STALE PRE-CLEAR / mid-cascade frame
                    // (taller, un-cleared). This is the "stack gets higher for a second then
                    // resets" bug: the host acknowledges our lock input (hostBehindInput goes
                    // false) but its OWN async cascade for our board is still in flight ~RTT
                    // behind, and lines is the clean monotonic signal for "host finished the
                    // clear" (it isn't bumped until detectFullLines runs on the host). Keep
                    // holding our predicted (cleared) grid until the host's lines reach ours,
                    // then adopt the matching final grid — no taller-then-reset flicker.
                    // host-AHEAD (host cleared MORE than we predicted) leaves this false, so
                    // we still adopt the host's (more-cleared) grid normally.
                    const hostClearPending = typeof playerData.lines === 'number'
                        && playerData.lines < (player.gameState.lines || 0);
                    // While the cascade animates, use a generous safety cap so the hold
                    // spans the whole clear; otherwise the normal cap bounds divergence.
                    const effectiveCap = localProcessingPhysics
                        ? this._LOCAL_BOARD_HOLD_MAX_PHYSICS_FRAMES
                        : this._LOCAL_BOARD_HOLD_MAX_FRAMES;
                    if ((hostBehindInput || localAhead || recentlyLocked || localProcessingPhysics || hostClearPending)
                        && this._localBoardHoldCount < effectiveCap) {
                        holdLocalBoard = true;
                        this._localBoardHoldCount += 1;
                        if (this._netDiagEnabled) this._netDiag.boardHolds = (this._netDiag.boardHolds || 0) + 1;
                    } else {
                        this._localBoardHoldCount = 0;
                    }
                }
                // While holding, also hold SCORE/LINES/LEVEL and the GARBAGE queue (gated
                // below) so the predicted clear stays a single self-consistent window — they
                // adopt ATOMICALLY with the grid on the release frame (holdLocalBoard=false).
                // ?holdStats=0 reverts to per-frame stat adoption.
                const holdLocalStats = ownsLocalPiece && holdLocalBoard && this._holdStatsEnabled;

                // Stats: authoritative for everyone EXCEPT the local player mid-hold, and
                // EXCEPT peerOwns (the peer owns its own score/lines/level — the local sim
                // computes them; the desync digest still compares them as a backstop).
                // MONOTONIC for the local player under holdStats: score/lines/level never
                // decrease within a round, so a latency-lagged host frame can't pull them
                // BELOW our prediction (the regress-then-jump on hold release); a genuinely
                // AHEAD host still wins via max(). forceLocal hard resync sets
                // ownsLocalPiece=false and hard-adopts. Writes live in the §5.1 boundary.
                /** @type {'hold'|'monotonic'|'adopt'} */
                let statsMode = 'hold';
                if (!peerOwns && !holdLocalStats) {
                    statsMode = (ownsLocalPiece && this._holdStatsEnabled) ? 'monotonic' : 'adopt';
                }
                player.frags = playerData.frags;
                player.isAlive = playerData.isAlive;
                // Adopt the late-joiner waiting flag from the host (≠ eliminated). Without this the
                // peer's player object keeps a stale value, so renderAllPlayers feeds the UI the
                // wrong state and a late joiner renders as 💀 ELIMINATED instead of ⏳ NEXT ROUND.
                if (playerData.awaitingSpawn !== undefined) {
                    player.awaitingSpawn = playerData.awaitingSpawn === true;
                }
                player.gameState.isGameOver = !playerData.isAlive;
                if (playerData.lastAttackerId !== undefined) player.lastAttackerId = playerData.lastAttackerId;
                if (playerData.lockSeq !== undefined) player._lockSeq = playerData.lockSeq;

                // Sync the input-ack sequence (drives reconciliation pruning + the hold's
                // own release). ALWAYS adopted (never held); != null so an explicit 0 is
                // honored — this is what stops the peer replaying its WHOLE input history.
                if (playerData.lastInputSeq != null) {
                    player.lastInputSeq = playerData.lastInputSeq;
                }

                // Lock-events: skip overwriting an OPPONENT board with a 30Hz snapshot
                // older than the last lock-event we already snapped (no-op when flag off).
                const staleVsLock = this._lockEventsEnabled
                    && !isLocalPlayer
                    && typeof state.tick === 'number'
                    && typeof player._lastLockHostTick === 'number'
                    && state.tick <= player._lastLockHostTick;
                const shouldApplyBoardState = !staleVsLock
                    && (forceLocal || !isLocalPlayer || (reconcileLocal && isLocalPlayer));
                if (this._netDiagEnabled && !isLocalPlayer) {
                    if (staleVsLock) this._netDiag.lockSkips += 1;
                    else if (shouldApplyBoardState) this._netDiag.boardsApplied += 1;
                }

                // Board grid: authoritative for everyone EXCEPT peerOwns (the peer owns its
                // own grid/piece as a local sim — re-basing it per-frame to a stale host
                // frame is the root of the higher-then-reset / glitch / jump artifacts).
                // Speed (dropInterval) + preview queue are authoritative; the gravity phase
                // (dropCounter) stays LOCAL for the local player so its fall stays smooth
                // and prediction-driven. (peerOwns: the peer derives dropInterval/nextPieces/
                // dropCounter from the shared seed + its own level, matching the host
                // deterministically.) All WRITES live in the §5.1 restore boundary; only
                // the policy is computed here.
                const adoptBoard = shouldApplyBoardState && !holdLocalBoard && !peerOwns;
                restoreBoardState(player.gameState, {
                    grid: playerData.grid,
                    lockedPieces: playerData.lockedPieces,
                    currentPiece: playerData.currentPiece,
                    nextPieces: playerData.nextPieces,
                    dropInterval: playerData.dropInterval,
                    dropCounter: playerData.dropCounter,
                    score: playerData.score,
                    lines: playerData.lines,
                    level: playerData.level,
                }, {
                    statsMode,
                    adoptBoard,
                    mirrorGrid: true,
                    keepCurrentPiece: ownsLocalPiece,
                    adoptSpeed: adoptBoard,
                    adoptDropCounter: !ownsLocalPiece,
                });
                if (adoptBoard && ownsLocalPiece) {
                    this._reconcileLocalPiece(player.gameState, playerData.currentPiece);
                }

                // Reconstruct the garbage queue from the host snapshot (drives the GARBAGE
                // meter + the peer's predicted insertion). The peer NEVER enqueues locally
                // (the attack router is host-only), so this is its only queue source.
                //
                // IDEMPOTENT ADOPT — fixes "garbage looks strange on the peer". The peer
                // PREDICT-CONSUMES a burst instantly (_insertLocalGarbagePrediction on its
                // own spawn), but the HOST consumes that same burst ~½RTT later (it must
                // receive+replay the peer's input first). In that window the host's
                // serialized queue STILL lists the burst the peer already inserted, so a
                // blind wholesale replace RE-ADDS it → the next predicted spawn double-
                // inserts the rows and the meter drops-then-rebounds. (The old "post-
                // consumption, no double-insert" comment here was wrong.) We track the
                // bursts we've locally consumed by attackId:lineIndex and FILTER them out
                // of the adopted queue. The settled grid stays host-authoritative (adopted
                // separately above), so this only stops the QUEUE re-add, never repositions
                // rows. The consumed-set self-prunes the instant the host stops listing an
                // entry (it consumed/cancelled it too) and is cleared on round-reset/
                // forceLocal, so a genuine re-attack with a fresh attackId still lands.
                // (Supersedes the Phase-0 `!holdLocalStats` queue freeze: filtering keeps
                // the meter clean AND lets incoming garbage appear immediately, no hold delay.)
                if (playerData.garbageEntries && player.garbageQueue && (!isLocalPlayer || reconcileLocal)) {
                    let gbEntries = playerData.garbageEntries;
                    if (isLocalPlayer && this._garbageIdempotentEnabled && this._peerConsumedBursts && this._peerConsumedBursts.size) {
                        const hostKeys = new Set();
                        for (const e of gbEntries) hostKeys.add(garbageBurstKey(e));
                        // Forget consumed keys the host no longer lists — both sides agree they're gone.
                        for (const k of this._peerConsumedBursts) {
                            if (!hostKeys.has(k)) this._peerConsumedBursts.delete(k);
                        }
                        // Don't re-add bursts we already predict-consumed (host is still catching up).
                        gbEntries = gbEntries.filter((e) => !this._peerConsumedBursts.has(garbageBurstKey(e)));
                    }
                    player.garbageQueue.entries = gbEntries.map((e) => ({
                        type: e.type,
                        attackerId: e.attackerId,
                        color: e.color,
                        holeMask: e.holeMask,
                        variant: e.variant,
                        duration: e.duration,
                        attackerName: e.attackerName,
                        isLastInBurst: e.isLastInBurst, // needed for correct burst grouping on peers
                        attackId: e.attackId,
                        attackSeq: e.attackSeq,
                        lineIndex: e.lineIndex,
                        targetId: e.targetId,
                        createdSimTick: e.createdSimTick,
                        sourceSimTick: e.sourceSimTick,
                        sourceLockSeq: e.sourceLockSeq,
                        applyAfterLockSeq: e.applyAfterLockSeq,
                        applySimTick: e.applySimTick,
                        rulesHash: e.rulesHash,
                        clearSummary: e.clearSummary,
                    }));
                }

                // Sync blind timers
                if (playerData.blindTimers !== undefined) {
                    restoreBlindTimers(player.gameState, playerData.blindTimers);
                } else if (!player.gameState.blindTimers) {
                    player.gameState.blindTimers = createBlindTimers();
                }
            }
        });

        this.gamePhase = state.gamePhase;
        if (state.hotPotatoState !== undefined) {
            this.hotPotatoState = state.hotPotatoState ? { ...state.hotPotatoState } : null;
        }
        this.winner = state.winner;

        if (render) this.renderAllPlayers();
    }

    _getDownloadJoinBlockedPeers() {
        return getDownloadJoinBlockedPeers(this, {
            now: () => Date.now(),
            recordEvent: (event, details) => this._recordNetEvent?.(event, details),
        });
    }

    _shouldDropLiveSnapshotDuringDownload(state, msg = {}) {
        return shouldDropLiveSnapshotDuringDownload(this, state, msg, {
            now: () => Date.now(),
            recordEvent: (event, details) => this._recordNetEvent?.(event, details),
            onDownloadTimeout: (details) => this._transitionJoin(JOIN_EVENTS.DOWNLOAD_TIMED_OUT, details),
        });
    }

    queueResync(steamId) {
        const send = (id, _marker, barrier) => resyncInputBarrier.startFfaResyncTransfer(this, id, barrier);
        queueFfaResync(this, steamId, send);
    }

    _buildResyncPayload(meta = {}) {
        return buildFfaResyncPayload(this, meta);
    }

    _createResyncContext() {
        return createFfaResyncContext(this);
    }

    onHostAuthorityChanged({ previousHostId, newHostId, source }) {
        if (previousHostId === newHostId) return false;
        resyncInputBarrier.cancelResyncInputBarriers(this, 'host_changed');
        const retired = resetInboundResyncState(this);
        if (previousHostId) {
            this.network.incomingSnapshotBaselines?.delete(previousHostId);
            this.network.lastResyncRequestAt?.delete(previousHostId);
        }
        this._recordNetEvent?.('resync_inbound_retired', {
            previousHostId: previousHostId || null,
            newHostId,
            source,
            ...retired,
        });
        if (retired.discardedDownload) {
            this._transitionJoin(JOIN_EVENTS.HOST_CHANGED, {
                previousHostId: previousHostId || null,
                newHostId,
                source,
            });
        }
        return true;
    }

    _sendResyncToPeer(steamId) { this.queueResync(steamId); }

    _sendResyncWindow(transfer) {
        sendResyncWindow(this._createResyncContext(), transfer);
    }

    _sendResyncChunk(transfer, chunk) {
        sendResyncChunk(this._createResyncContext(), transfer, chunk);
    }

    _tickResyncTransfer(transfer) {
        if (this._disposed) return;
        tickResyncTransfer(this._createResyncContext(), transfer);
        if (!this.resyncTransfers.has(transfer.resyncId)) {
            resyncInputBarrier.retireFfaTransferBarrier(this, transfer, 'transfer_ended');
        }
    }

    _handleResyncAck(msg) {
        if (this._disposed) return;
        resyncInputBarrier.handleFfaResyncAck(this, msg);
    }

    _handleResyncChunk(msg) {
        if (this._disposed) return;
        const expectedHostId = this.network?.hostSteamId;
        if (this.isHost || !msg?.from || !expectedHostId || msg.from !== expectedHostId) {
            let reason = 'non_host_sender';
            if (this.isHost) reason = 'host_receiver';
            else if (!expectedHostId) reason = 'host_unresolved';
            this._recordNetEvent?.('resync_chunk_rejected', {
                from: msg?.from || null,
                expectedHostId: expectedHostId || null,
                reason,
            });
            return;
        }
        handleResyncChunk(this._createResyncContext(), msg);
    }

    _processPendingInboundResyncApply() {
        if (this._disposed || this.isHost || !this.pendingInboundResyncApply) return false;
        return drainPendingInboundResyncApply(this._createResyncContext());
    }

    /** @param {ResyncSnapshotState} state */
    _applyResyncState(state) {
        const carriesSharedSeed = Object.hasOwn(state, 'sharedSeed');
        const resyncSeed = carriesSharedSeed
            ? normalizeFfaRoundSeed(state.sharedSeed)
            : null;
        if (carriesSharedSeed && resyncSeed === null) {
            this._recordNetEvent?.('resync_apply_rejected', { reason: 'invalid_round_seed' });
            return false;
        }
        const inputPreflight = resyncInputBarrier.preflightFfaResyncInputBarrier(this, state);
        if (!inputPreflight.accepted) {
            this._recordNetEvent?.('resync_apply_rejected', inputPreflight);
            return false;
        }
        const preflight = resyncSidecar.preflightFfaResyncApply(this, state);
        if (!preflight.accepted) {
            this._recordNetEvent?.('resync_apply_rejected', preflight);
            return false;
        }
        let clockProjectionReset = false;
        if (state.matchConfig) {
            this.matchConfig = { ...this.matchConfig, ...state.matchConfig };
            clockProjectionReset = this._transitionSimulationClock(this.matchConfig.simulationClock);
        }
        if (carriesSharedSeed) {
            this.sharedSeed = resyncSeed;
        }
        if (Object.hasOwn(state, 'matchStartTime')) {
            this.matchStartTime = state.matchStartTime;
        }
        // A resync is authoritative current state — adopt its generation so the
        // forced apply below isn't fenced and future snapshots stay aligned.
        if (typeof state.roundGeneration === 'number' && state.roundGeneration > this.roundGeneration) {
            this.roundGeneration = state.roundGeneration;
        }

        state.players.forEach((playerData) => {
            if (!this.players.has(playerData.steamId)) {
                this.addPlayer(playerData.steamId, playerData.name || 'Player');
            }
        });

        this._applySnapshotState(state, { forceLocal: true, render: false });
        if (state.resyncSidecar) {
            resyncSidecar.applyFfaResyncSidecar(this, state.resyncSidecar, {
                preservePlayerInputFor: this.localPlayerId,
            });
        }
        if (!clockProjectionReset) resetFfaFixedClockProjection(this);
        resyncInputBarrier.completeFfaResyncInputBarrier(this, inputPreflight.completion);
        try { this.renderAllPlayers(); } catch (error) {
            this._recordNetEvent?.('resync_render_failed', { message: String(error?.message || error) });
        }
        if (this._downloadJoinEnabled && state.downloadEpoch) {
            this._recordNetEvent?.('download_applied', {
                downloadEpoch: state.downloadEpoch,
                resyncId: state.resyncId || null,
                snapshotSeq: state.snapshotSeq,
                simTick: state.simTick,
                roundGeneration: state.roundGeneration,
            });
            if (this.downloadJoinInProgress?.downloadEpoch === state.downloadEpoch) {
                this.downloadJoinInProgress = null;
            }
        }

        if (this.gamePhase === 'playing' && !this.loopRunning) {
            this.startGameLoop();
        }
        return true;
    }

    /**
    * Broadcast player list (host only)
    */
    broadcastPlayerList() {
        if (!this.isHost) return;

        const playerList = Array.from(this.players.values()).map((p) => ({
            steamId: p.steamId,
            name: p.name,
            color: p.color, // NEW: Include player color
            isReady: p.isReady,
            isAlive: p.isAlive,
            // Reliable carrier for the late-joiner waiting state so the peer has it the moment it
            // builds the mini-board (before the first snapshot decodes) — no skull→waiting flicker.
            awaitingSpawn: p.awaitingSpawn === true,
            isDisconnected: p.isDisconnected || false, // Broadcast disconnect status
        }));

        const roster = /** @type {LobbyRosterSnapshot} */ ({
            players: playerList,
            spectatorCount: this.spectators?.size || 0, // so every client can show "N watching"
        });
        this.network.broadcastToAll(MessageTypes.LOBBY_PLAYER_JOINED, roster);

        // Keep the discoverable lobby entry's player count + status current so the
        // lobby browser shows Join / "Join (next round)" / Watch correctly for late arrivals.
        this._advertiseLobbyState();
    }

    /**
    * Advertise this room's live lifecycle (player count + status) to the lobby list.
    * Host-only — peers don't own the lobby entry. Status maps the in-match gamePhase to
    * the browser's join semantics: a match in progress advertises 'playing' (→ drop-in /
    * watch), everything else advertises 'open' (normal Join from the waiting room).
    */
    _advertiseLobbyState() {
        if (!this.isHost || !this.network) return;
        const status = this.gamePhase === 'playing' ? 'playing'
            : this.gamePhase === 'finished' ? 'finished'
                : 'open';
        // Count active roster seats (spectators are not players and don't fill slots).
        this.network.setLobbyPlayerCount?.(this.players.size);
        this.network.setLobbyStatus?.(status);
    }

    /**
    * Set local player ready status
    */
    setReady(isReady) {
        const localPlayer = this.players.get(this.localPlayerId);
        if (localPlayer) {
            localPlayer.isReady = isReady;

            // Broadcast to everyone
            if (this.isHost) {
                this.broadcastPlayerList();
            } else {
                this.network.sendP2PMessage(this.network.hostSteamId, MessageTypes.LOBBY_PLAYER_READY, {
                    steamId: this.localPlayerId,
                    isReady,
                });
            }
            // Reflect the local player's OWN ready toggle in this client's Activity Log.
            emitMultiplayerEvent(MULTIPLAYER_EVENTS.PLAYER_LIST_CHANGED, { players: this.players });
        }
    }

    /**
    * Reset all player ready states (host broadcasts)
    */
    resetReadyStates() {
        this.players.forEach((player) => {
            player.isReady = false;
        });

        if (this.isHost) {
            this.broadcastPlayerList();
        }
    }

    /**
    * Check if all players are ready
    */
    allPlayersReady() {
        if (this.players.size < 2) return false; // Need at least 2 players

        return Array.from(this.players.values()).every((p) => p.isReady);
    }

    /**
    * Get player by Steam ID
    */
    getPlayer(steamId) {
        return this.players.get(steamId);
    }

    /**
    * Get local player
    */
    getLocalPlayer() {
        return this.players.get(this.localPlayerId);
    }

    /**
    * Send garbage attack to all opponents (after line clear)
    *
    * @param {Object} cascadeSummary - Summary of cascade (lines, colors, etc.)
    */
    sendGarbageAttack(cascadeSummary) {
        if (!this.isHost) {
            // Peers send attack info to host
            this.network.sendP2PMessage(this.network.hostSteamId, MessageTypes.GAME_ATTACK_REQUEST, {
                cascadeSummary,
                timestamp: Date.now(),
            });
            return;
        }

        // Host routes attack
        this._recordNetEvent?.('attack_local', {
            attackerSteamId: this.localPlayerId,
            cascadeSummary,
        });
        this.attackRouter.routeAttack(this.localPlayerId, cascadeSummary);
    }

    /**
    * Record player death (host only)
    *
    * @param {String} deadPlayerSteamId - Steam ID of dead player
    * @param {String} killerSteamId - Steam ID of killer (null for self-kill)
    */
    recordPlayerDeath(deadPlayerSteamId, killerSteamId = null) {
        if (!this.isHost) {
            console.warn('⚠️ Only host can record deaths');
            return;
        }

        this.fragTracker.recordDeath(deadPlayerSteamId, killerSteamId);
    }

    /**
    * Get current kill feed
    */
    getKillFeed() {
        return this.fragTracker.getKillFeed();
    }

    /**
    * Get current standings (ranked by frags, then score)
    */
    getStandings() {
        return this.fragTracker.getStandings();
    }

    /**
    * Handle host disconnection (peer only)
    */
    handleHostDisconnect() {
        if (this.isHost) {
            console.warn('⚠️ You are the host');
            return;
        }

        // Was this.hostMigration.handleHostDisconnect() — a method that does not
        // exist on HostMigration (guaranteed TypeError). The correct entry point
        // for "the host is gone, start a successor election" is initiateElection().
        this.hostMigration.initiateElection();
    }

    /**
    * Final stateful guard after the Phase 6A.3 transport route check. A current
    * host may name a planned successor; a peer may name itself only while this
    * receiver has an active election and that peer is the expected candidate.
    * This is the election proof the static protocol catalog cannot express.
    */
    _verifyHostReassignment(senderId, claimedNewHostId) {
        if (!senderId || !claimedNewHostId) return false;

        const currentHost = this.network?.hostSteamId;
        // The trusted current host may hand authority to any named successor
        // (a planned handoff) without an election.
        if (senderId === currentHost) return true;

        // A peer may assert authority ONLY while a successor election is active
        // — i.e. this peer's own host-liveness monitor has declared the host gone.
        // Otherwise a healthy host cannot be displaced by a peer.
        if (!this.hostMigration?.isElectionInProgress) return false;

        // ...and only by naming itself as the expected (lowest-id) candidate. It
        // is "expected" if it is still the lowest-id candidate (SYNC arrived
        // before CLAIM) or if CLAIM already promoted it to current host.
        const expectedCandidate = this.hostMigration?._getExpectedHostCandidateId?.();
        return senderId === claimedNewHostId
            && (claimedNewHostId === currentHost || claimedNewHostId === expectedCandidate);
    }

    /**
    * Get attack statistics
    */
    getAttackStats() {
        return this.attackRouter.getStats();
    }

    /**
    * Force end match (host only)
    */
    forceEndMatch() {
        if (!this.isHost) {
            console.warn('⚠️ Only host can force end match');
            return;
        }

        // Get top player as winner
        const standings = this.fragTracker.getStandings();
        const winner = standings.length > 0 ? this.players.get(standings[0].steamId) : null;

        if (winner) {
            this.fragTracker.endMatch(winner);
        }
    }

    /**
    * Configure unified loop callbacks once
    */
    configureUnifiedLoopCallbacks() {
        if (this.loopCallbacksConfigured || !this.unifiedLoop) {
            return;
        }

        this._setUnifiedLoopExternalPlayerUpdate(this._fixedTickEnabled);

        this.unifiedLoop.onRender = () => {
            this.renderAllPlayers(true); // loop-frame emit → consumers process synchronously (§2.2)
        };

        this.unifiedLoop.onUpdate = (currentTime, delta) => {
            this._processPendingResyncInputBarrier();
            if (this._processPendingInboundResyncApply()) return;
            if (this.gamePhase !== 'playing') return;
            const hostWallTime = this.isHost ? Date.now() : 0;

            if (!this._fixedTickEnabled) this.localInputHooks.advance?.(currentTime, delta);
            if (!this.isHost && !this._fixedTickEnabled) this.flushInputBatch();

            if (this._fixedTickEnabled) {
                const ownership = [this.roundGeneration, this.unifiedLoop.runGeneration];
                runFfaFixedTicks(this, delta, currentTime, hostWallTime);
                if (
                    this.gamePhase !== 'playing' || !this._fixedTickEnabled
                    || this.roundGeneration !== ownership[0]
                    || this.unifiedLoop.runGeneration !== ownership[1]
                ) return;
                if (!this.isHost) this.flushInputBatch();
            } else if (this.isHost) {
                this.simTick = (Number(this.simTick) || 0) + 1;
                this.processBufferedInputs(delta); // Wall-clock jitter cadence (§2.3)
                this.updateAllPlayers();
                this.attackRouter.updateHotPotato(hostWallTime);
            }
            if (this.isHost) {
                this.maybeBroadcastPostPhysics(delta);
            }
        };

        this.loopCallbacksConfigured = true;
    }

    /**
     * Process inputs from the jitter buffer (HOST ONLY)
     * P0-3 (perf review §2.3): given the loop's frame delta, the buffer advances
     * on WALL CLOCK at its configured tickInterval — not once per display frame —
     * draining due inputs once per advanced tick (a heavy frame applies its 2
     * ticks in order; a 144Hz frame may advance none and inputs simply wait).
     * Catch-up is capped inside advanceByWallClock (rebase on hitch, no burst).
     * Called without a delta it single-steps (one drain + one advanceTick),
     * preserving the legacy per-call contract for tests/tools.
     * @param {number} [frameDeltaMs] - Elapsed ms from the unified loop's onUpdate.
     */
    processBufferedInputs(frameDeltaMs) {
        if (!this.useJitterBuffer || !this.inputJitterBuffer) return;
        const buffer = this.inputJitterBuffer;
        if (Number.isFinite(frameDeltaMs) && typeof buffer.advanceByWallClock === 'function') {
            buffer.advanceByWallClock(frameDeltaMs, () => drainFfaBufferedInputs(this));
            return;
        }
        drainFfaBufferedInputs(this);
        buffer.advanceTick();
    }

    /**
    * Create physics callbacks for unified game loop player registration
    */
    createPhysicsCallbacks(steamId) {
        return this.buildPhysicsCallbacks(steamId);
    }

    buildPhysicsCallbacks(steamId) {
        const isLocal = () => steamId === this.localPlayerId;
        const getPlayer = () => this.players.get(steamId);

        return {
            onGarbageReady: (summary) => {
                this._recordNetEvent?.('attack_ready', {
                    attackerSteamId: steamId,
                    cascadeSummary: summary,
                });
                this.attackRouter.routeAttack(steamId, summary);
            },
            triggerFlash: (clearedRows = []) => {
                const player = getPlayer();
                if (!player) return;

                const rows = Array.isArray(clearedRows) ? clearedRows.slice() : [];
                const linesCleared = rows.length || (Array.isArray(clearedRows) ? 0 : Number(clearedRows) || 0);

                emitMultiplayerEvent(MULTIPLAYER_EVENTS.LINE_CLEAR, {
                    steamId,
                    playerName: player.name,
                    rows,
                    linesCleared,
                    isLocal: isLocal(),
                });
            },
            onLineClearImpact: (lineCount = 1) => {
                const player = getPlayer();
                if (!player) return;

                const settings = (typeof window !== 'undefined' && window.settingsManager) ? window.settingsManager.get() : {};
                const prefersReducedMotion = settings.reducedMotion || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
                if ((!prefersReducedMotion || this._fixedTickEnabled) && player.gameState) {
                    let hitStop = 0;
                    if (lineCount >= 4) {
                        hitStop = 70;
                    }
                    if (hitStop > 0) {
                        player.gameState.hitStopRemaining = hitStop;
                    }
                }

                emitMultiplayerEvent(MULTIPLAYER_EVENTS.LINE_CLEAR_IMPACT, {
                    steamId,
                    playerName: player.name,
                    linesCleared: lineCount,
                    isLocal: isLocal(),
                });
            },
            triggerCombo: (comboCount) => {
                if (comboCount > 1) {
                    const player = getPlayer();
                    if (!player) return;

                    emitMultiplayerEvent(MULTIPLAYER_EVENTS.COMBO, {
                        steamId,
                        playerName: player.name,
                        comboCount,
                        isLocal: isLocal(),
                    });
                }
            },
            // Phase 1+2: HOST emits a discrete authoritative CLEAR event per cleared
            // cascade so OPPONENT mini-boards can animate (peers don't simulate each
            // other). The host runs buildPhysicsCallbacks for EVERY player; every player
            // is an opponent to SOME peer (the host included), so broadcast for all and
            // let each peer skip its own clear. Carries rows + cascadeCount (this is the
            // only callback that has BOTH). Grid-FREE + reliable (GAME_LINES_CLEAR is in
            // HOST_AUTHORITATIVE_MESSAGE_TYPES). On peers this is a no-op (gated by isHost),
            // so a peer's own local-prediction clear never broadcasts.
            onLineClear: (linesCleared, holeColumns, waveHoleMasks, fullLines, cascadeCount) => {
                if (!this.isHost || !this._opponentClearEvents) return;
                const player = getPlayer();
                if (!player) return;
                const rows = Array.isArray(fullLines) ? fullLines.slice() : [];
                if (rows.length === 0) return;
                player._clearSeq = (player._clearSeq || 0) + 1;
                this.network.broadcastToAll(MessageTypes.GAME_LINES_CLEAR, {
                    playerSteamId: steamId,
                    clearSeq: player._clearSeq,
                    roundGeneration: this.roundGeneration,
                    rows,
                    lineCount: linesCleared,
                    cascadeCount: cascadeCount || 1,
                });
                // The host never receives its own broadcast — drive the host's OWN watcher
                // locally for its opponents (non-local players). The host's own full board
                // flash comes from triggerFlash→LINE_CLEAR(isLocal) and is unchanged.
                if (steamId !== this.localPlayerId) {
                    emitMultiplayerEvent(MULTIPLAYER_EVENTS.OPPONENT_CLEAR, {
                        steamId,
                        playerName: player.name,
                        rows,
                        linesCleared,
                        cascadeCount: cascadeCount || 1,
                    });
                }
            },
            onPieceLock: (piece) => {
                const player = getPlayer();
                if (!player) return;

                // Peer prediction: remember when WE locked a piece so reconciliation
                // can hold our board over the brief window before the host's settle for
                // that lock propagates back (prevents the post-lock piece revert / grid
                // flicker — see LOCAL-BOARD HOLD, Signal 3).
                if (!this.isHost && isLocal()) {
                    this._lastLocalLockTime = Date.now();
                }

                emitMultiplayerEvent(MULTIPLAYER_EVENTS.PIECE_LOCK, {
                    steamId,
                    playerName: player.name,
                    piece,
                    isLocal: isLocal(),
                });
            },
            onHardDrop: (dropData) => {
                const player = getPlayer();
                if (!player) return;

                const settings = (typeof window !== 'undefined' && window.settingsManager) ? window.settingsManager.get() : {};
                const prefersReducedMotion = settings.reducedMotion || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
                if ((!prefersReducedMotion || this._fixedTickEnabled) && player.gameState) {
                    player.gameState.hitStopRemaining = Math.max(player.gameState.hitStopRemaining || 0, 30);
                }

                emitMultiplayerEvent('game:hard_drop', {
                    steamId,
                    playerName: player.name,
                    dropData,
                    isLocal: isLocal(),
                });
            },
            onPerfectClear: (depth, perfectClearBonus) => {
                const player = getPlayer();
                if (!player) return;

                const settings = (typeof window !== 'undefined' && window.settingsManager) ? window.settingsManager.get() : {};
                const prefersReducedMotion = settings.reducedMotion || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
                if ((!prefersReducedMotion || this._fixedTickEnabled) && player.gameState) {
                    player.gameState.hitStopRemaining = 110;
                }

                emitMultiplayerEvent(MULTIPLAYER_EVENTS.PERFECT_CLEAR, {
                    steamId,
                    playerName: player.name,
                    depth,
                    perfectClearBonus,
                    isLocal: isLocal(),
                });
            },
            spawnPiece: () => this._spawnNextPieceForPlayer(steamId),
        };
    }

    buildLocalPredictionCallbacks(steamId) {
        const callbacks = this.buildPhysicsCallbacks(steamId);
        // Peers send their attack info to the host for routing
        callbacks.onGarbageReady = (summary) => {
            this.sendGarbageAttack(summary);
        };
        // Peers handle their own piece spawning and garbage insertion locally
        // This is necessary because we don't sync board state from host for local player
        callbacks.spawnPiece = () => {
            const player = this.players.get(steamId);
            if (!player) return;

            const { gameState } = player;
            // Don't spawn if piece already exists or game is over
            if (gameState.currentPiece || gameState.isGameOver) {
                return;
            }

            // Insert local garbage prediction on piece lock
            this._insertLocalGarbagePrediction(steamId);

            // Check if garbage insertion caused game over
            if (gameState.isGameOver) {
                return;
            }

            // Spawn next piece locally (peers manage their own piece spawning)
            spawnPiece(gameState, null, null);
        };
        return callbacks;
    }

    /**
     * Build callbacks for processing REMOTE player input on the host
     * These callbacks do NOT route garbage attacks because remote players
     * send their own game:attack:request messages
     */
    buildRemotePlayerCallbacks(steamId) {
        const callbacks = this.buildPhysicsCallbacks(steamId);
        if (!this._authoritativeAttacksEnabled) {
            // Don't route garbage - remote players send their own attack requests
            callbacks.onGarbageReady = () => { };
        }
        return callbacks;
    }

    /**
     * Insert garbage locally for visual prediction (peers only)
     * Host's broadcast will overwrite with authoritative state
     */
    // Stable identity for a garbage line across the peer's predicted consume and the
    // host's serialized queue. attackId is `r{round}-a{seq}` (always non-empty for routed
    // attacks); lineIndex disambiguates lines within one attack. Falls back to attackSeq.
    _insertLocalGarbagePrediction(steamId) {
        if (this.isHost) return; // Host uses _spawnNextPieceForPlayer

        const player = this.players.get(steamId);
        if (!player || !player.isAlive) return;

        const { garbageQueue, gameState } = player;
        const totalLines = garbageQueue.getTotalLines();

        if (totalLines > 0) {
            // Take lines from queue and insert locally — DRAIN-ALL to match local (one
            // dump), else one burst. Both host and peer flip together via the flag.
            const burst = this._garbageDrainAll
                ? drainAllLineBursts(garbageQueue)
                : garbageQueue.dequeueLineBurst();
            if (burst && burst.length > 0) {
                // Idempotent-adopt: remember these bursts so the next host snapshot (which
                // still lists them until the host consumes them ~½RTT later) does NOT re-add
                // them in _applySnapshotState → no double-insert / meter rebound.
                if (this._garbageIdempotentEnabled && this._peerConsumedBursts) {
                    for (const entry of burst) this._peerConsumedBursts.add(garbageBurstKey(entry));
                }
                const normalizedBurst = burst.map((entry) => ({
                    ...entry,
                    holeMask: typeof entry.holeMask === 'number' ? entry.holeMask : 0,
                    variant: entry.variant || 'normal',
                }));

                // Board mutation + grid/cache repair live in the ONE boundary (§5.1).
                // Peer prediction ignores topOut — death is host-authoritative.
                applyGarbage(gameState, normalizedBurst, { debug: this.debugGarbage });

                // Dispatch event for UI feedback
                emitMultiplayerEvent(MULTIPLAYER_EVENTS.GARBAGE_INSERTED, {
                    steamId,
                    playerName: player.name,
                    linesInserted: burst.length,
                    isLocal: true,
                });
            }
        }

        // Trigger render to show the garbage
        this.renderAllPlayers();
    }

    _spawnNextPieceForPlayer(steamId) {
        const player = this.players.get(steamId);
        if (!player) return;

        const { gameState } = player;
        if (gameState.currentPiece || gameState.isGameOver) {
            return;
        }

        // CRITICAL: Insert garbage BEFORE spawning new piece
        // This ensures garbage appears on the board at the same time the meter goes down
        this.insertPendingGarbage(steamId);

        // Check if garbage insertion caused top-out
        if (gameState.isGameOver) {
            if (this.isHost && this._lockEventsEnabled) this._emitAuthoritativeLock(steamId);
            return;
        }

        spawnPiece(
            gameState,
            null,
            () => {
                const latestPlayer = this.players.get(steamId);
                if (!latestPlayer) {
                    return;
                }

                console.log(`💀 ${latestPlayer.name} topped out on spawn!`);
                gameState.isGameOver = true;
                latestPlayer.isAlive = false;

                const { lastAttackerId } = latestPlayer;
                const lastAttacker = lastAttackerId ? this.players.get(lastAttackerId) : null;
                if (lastAttackerId) {
                    console.log(`🏆 Death on spawn attributed to last attacker: ${lastAttacker?.name || lastAttackerId}`);
                } else {
                    console.log('💀 Death on spawn with no attacker tracked (self-kill)');
                }

                // TODO: Store lastAttackerName on player too? For now, we rely on ID lookup for this edge case
                this.fragTracker.recordDeath(steamId, lastAttackerId);

                emitMultiplayerEvent(MULTIPLAYER_EVENTS.PLAYER_TOPPED_OUT, {
                    steamId,
                    playerName: latestPlayer.name,
                    killer: lastAttackerId || null,
                    killerId: lastAttackerId || null,
                    killerName: lastAttacker?.name || null,
                    isSelfKill: !lastAttackerId || lastAttackerId === steamId,
                    isLocal: steamId === this.localPlayerId,
                });
            },
        );

        // Board is now settled (garbage inserted + next piece spawned, or topped
        // out) — send a reliable authoritative lock-event so opponent boards snap to
        // truth instead of waiting for the next lossy 30Hz frame.
        if (this.isHost && this._lockEventsEnabled) {
            this._emitAuthoritativeLock(steamId);
        }
    }

    /**
     * HOST: broadcast a reliable, self-contained authoritative board for one player
     * the instant its piece settles. Idempotent on the receiver via a per-player
     * monotonic lockSeq; fenced by roundGeneration; carries hostTick so a stale 30Hz
     * snapshot can't "un-lock" the snapped board.
     */
    _emitAuthoritativeLock(steamId) {
        const player = this.players.get(steamId);
        if (!player || !player.gameState) return;
        player._lockSeq = (player._lockSeq || 0) + 1;
        this._recordNetEvent?.('lock', {
            playerSteamId: steamId,
            lockSeq: player._lockSeq,
            topOut: !!player.gameState.isGameOver,
            occupiedCells: this._countOccupiedCells?.(player.gameState.boardGrid) ?? 0,
        });
        this.network.broadcastToAll(MessageTypes.GAME_PLAYER_LOCK, {
            playerSteamId: steamId,
            lockSeq: player._lockSeq,
            roundGeneration: this.roundGeneration,
            hostTick: this.hostTick,
            grid: serializeBoardGrid(player.gameState.boardGrid),
            currentPiece: player.gameState.currentPiece ? { ...player.gameState.currentPiece } : null,
            topOut: !!player.gameState.isGameOver,
        });
    }

    /**
     * PEER: snap an OPPONENT's board to the authoritative locked state. Never snaps
     * the local board (which uses prediction + reconciliation).
     */
    _applyAuthoritativeLock(data) {
        if (this.isHost || !this._lockEventsEnabled || !data) return;
        // Round fence: ignore a lock-event from a round we've already left.
        if (typeof data.roundGeneration === 'number' && data.roundGeneration < this.roundGeneration) return;
        if (data.playerSteamId === this.localPlayerId) return; // local = prediction, never snapped
        const player = this.players.get(data.playerSteamId);
        if (!player || !player.gameState) return;
        // Idempotent + ordered: drop replays/old locks.
        if (typeof data.lockSeq === 'number' && data.lockSeq <= (player._lastAppliedLockSeq || 0)) return;
        player._lastAppliedLockSeq = data.lockSeq;
        // Record the lock tick so _applySnapshotState won't overwrite this snapped
        // grid with an older (in-flight) 30Hz snapshot.
        if (typeof data.hostTick === 'number') player._lastLockHostTick = data.hostTick;

        // Writes live in the §5.1 restore boundary (lock-events adopt board +
        // piece only; stats ride the 30Hz snapshots).
        restoreBoardState(player.gameState, {
            grid: Array.isArray(data.grid) ? data.grid : null,
            currentPiece: data.currentPiece,
        }, { adoptBoard: true, mirrorGrid: true });
        player.gameState.isGameOver = !!data.topOut;

        emitMultiplayerEvent(MULTIPLAYER_EVENTS.PIECE_LOCK, {
            steamId: data.playerSteamId,
            playerName: player.name,
            piece: null,
            isLocal: false,
            source: 'authoritative-lock',
        });
        this.renderAllPlayers();
    }

    /**
     * PEER: an OPPONENT cleared lines — drive a transient staged FLASH on that
     * opponent's mini-board (Phase 1+2). PURELY ADDITIVE: this NEVER writes the grid
     * (boardGrid/grid) and never calls renderAllPlayers, so it cannot refight the
     * snapshotInterpolator the way the grid-snapping lock-events did — the flash is an
     * overlay; the next 30Hz snapshot renders the collapse. Idempotent + round-fenced.
     */
    _applyPlayerClear(data) {
        if (this.isHost || !this._opponentClearEvents || !data) return;
        // Round fence: ignore a clear from a round we've already left.
        if (typeof data.roundGeneration === 'number' && data.roundGeneration < this.roundGeneration) return;
        // The local board owns its own clear (Phase 0 prediction) — never opponent-flash it.
        if (data.playerSteamId === this.localPlayerId) return;
        const player = this.players.get(data.playerSteamId);
        // Idempotent + ordered via a DEDICATED _clearSeq (NOT _lockSeq, which is serialized
        // into snapshots and used for attack ordering — sharing it would corrupt both).
        if (player && typeof data.clearSeq === 'number') {
            if (data.clearSeq <= (player._lastAppliedClearSeq || 0)) return;
            player._lastAppliedClearSeq = data.clearSeq;
        }
        emitMultiplayerEvent(MULTIPLAYER_EVENTS.OPPONENT_CLEAR, {
            steamId: data.playerSteamId,
            playerName: player?.name,
            rows: Array.isArray(data.rows) ? data.rows : [],
            linesCleared: data.lineCount,
            cascadeCount: data.cascadeCount || 1,
        });
    }

    /**
    * Register all players with the unified multiplayer loop (host only)
    */
    syncUnifiedLoopPlayers() {
        if (!this.unifiedLoop) {
            return;
        }

        this.unifiedLoop.clearPlayers();

        if (!this.isHost) {
            return;
        }

        this.players.forEach((player, steamId) => {
            if (!player) return;
            const physicsCallbacks = this.createPhysicsCallbacks(steamId);
            this.unifiedLoop.registerPlayer(steamId, player.gameState, physicsCallbacks, null);
        });
    }

    promoteToHost() {
        const previousHostId = this.network.hostSteamId;
        this.isHost = true;
        this.network.isHost = true;
        this.network.hostSteamId = this.localPlayerId;
        this.network.seedNegotiatedProtocolPeers?.(this.players.keys());
        this.onHostAuthorityChanged({
            previousHostId,
            newHostId: this.localPlayerId,
            source: 'promotion',
        });
        this._transitionJoin(JOIN_EVENTS.PROMOTE, { previousHostId: previousHostId || null });
        this.attackRouter.isHost = true;
        const fixedTickAfterPromotion = rollbackFixedTickOnPromotion(
            this._fixedTickEnabled,
            this._recordNetEvent?.bind(this),
        );
        this._transitionSimulationClock(
            fixedTickAfterPromotion ? 'fixed60-v1' : 'legacy-variable-v1',
        );
        if (!this.inputValidator) {
            this.inputValidator = new InputValidator();
        } else {
            this.inputValidator.reset();
        }

        if (!this.inputJitterBuffer) {
            this.inputJitterBuffer = new InputJitterBuffer({
                bufferDepth: 2,
                tickRate: this._fixedTickEnabled ? 60 : 30,
                adaptive: this._adaptiveInputJitterEnabled === true,
            });
        } else {
            this.inputJitterBuffer.adaptiveEnabled = this._adaptiveInputJitterEnabled === true;
            this.inputJitterBuffer.tickRate = this._fixedTickEnabled ? 60 : 30;
            this.inputJitterBuffer.tickInterval = 1000 / this.inputJitterBuffer.tickRate;
            this.inputJitterBuffer.clear();
        }

        this.players.forEach((_player, steamId) => {
            this.inputJitterBuffer?.addPlayer(steamId);
        });

        this.startHeartbeatLoop();
        this.syncUnifiedLoopPlayers();
        this.startGameLoop();
        this.startStateSyncLoop();
    }

    /**
    * Start the game loop (runs on both host and peer)
    */
    startGameLoop() {
        this.configureUnifiedLoopCallbacks();
        this._setUnifiedLoopExternalPlayerUpdate(this._fixedTickEnabled);

        if (this.isHost) {
            this.syncUnifiedLoopPlayers();
        } else if (this.unifiedLoop) {
            this.unifiedLoop.clearPlayers();
            const localPlayer = this.players.get(this.localPlayerId);
            if (localPlayer) {
                const physicsCallbacks = this.buildLocalPredictionCallbacks(this.localPlayerId);
                this.unifiedLoop.registerPlayer(
                    this.localPlayerId,
                    localPlayer.gameState,
                    physicsCallbacks,
                    null,
                );
            }
        }

        if (this.unifiedLoop && !this.loopRunning) {
            if (this._fixedTickEnabled) {
                this._simTickAccumulatorMs = 0;
                this._fixedInputTimeMs = null;
                this._activeFixedInputStamp = null;
            }
            this.localInputHooks.reset?.();
            // Competitive online MP must NEVER pause (a pause desyncs the netcode) — latch the
            // loop so no menu / visibility / background-tab path can freeze a live match.
            this.unifiedLoop.setNeverPause?.(true);
            this.unifiedLoop.start();
            this.loopRunning = true;
            console.log(`🎮 Unified game loop started (${this.isHost ? 'HOST' : 'PEER'} mode)`);
        }
    }

    /**
    * Render all player game boards (HOST & PEER)
    * This is called every frame to update visuals
    * PERF: Uses pre-allocated payload to avoid object creation every frame
    * @param {boolean} [fromLoopFrame] - True ONLY when called from the unified
    * loop's own rAF (onRender); consumers then process synchronously (§2.2).
    */
    renderAllPlayers(fromLoopFrame = false) {
        // PERF: Reuse pre-allocated slots instead of creating new objects
        let i = 0;
        this.players.forEach((player, steamId) => {
            const slot = this._renderPayload.players[i];
            if (slot) {
                slot.steamId = steamId;
                slot.name = player.name;
                slot.color = player.color;
                slot.gameState = player.gameState;
                slot.garbageQueue = player.garbageQueue;
                slot.isLocal = steamId === this.localPlayerId;
                slot.isAlive = player.isAlive;
                // Late joiner WAITING to spawn (≠ eliminated) — drives the ⏳ "NEXT ROUND"
                // overlay instead of the 💀 skull on opponents' mini-boards. Dropping this here
                // is why even the HOST (whose players carry the flag) still showed the skull.
                slot.awaitingSpawn = player.awaitingSpawn === true;
                slot.frags = player.frags;
                i++;
            }
        });
        this._renderPayload.playerCount = i;
        // Stamp UNCONDITIONALLY: the payload object is reused every frame, so a
        // stale true from a loop emit must never leak into an out-of-frame emit.
        this._renderPayload.fromLoopFrame = fromLoopFrame === true;

        // Emit with pre-allocated payload (consumers should use playerCount, not players.length)
        emitMultiplayerEvent(MULTIPLAYER_EVENTS.RENDER_FRAME, this._renderPayload);
    }

    /**
    * Stop the game loop
    */
    stopGameLoop() {
        this._setUnifiedLoopExternalPlayerUpdate(false);
        // Release the never-pause latch so the loop can be paused/reused normally once the
        // online match is over (and other modes sharing the loop instance aren't affected).
        this.unifiedLoop?.setNeverPause?.(false);
        if (this.unifiedLoop && this.loopRunning) {
            this.unifiedLoop.stop();
            this.loopRunning = false;
            console.log('🛑 Game loop stopped');
        }

        this.localInputHooks.reset?.();

        if (this.unifiedLoop) {
            this.unifiedLoop.clearPlayers();
        }
    }

    /**
    * Update all players' game states (HOST ONLY)
    */
    updateAllPlayers() {
        this.players.forEach((player, steamId) => {
            if (!player) return;

            const { gameState } = player;
            if (gameState.isGameOver && player.isAlive) {
                const { lastAttackerId } = player;
                const attacker = lastAttackerId ? this.players.get(lastAttackerId) : null;
                if (attacker) {
                    console.log(`🏆 Death attributed to last attacker: ${attacker.name || lastAttackerId}`);
                } else {
                    console.log('💀 Death with no attacker tracked (self-kill)');
                }

                this.fragTracker.recordDeath(steamId, lastAttackerId);
                this._recordNetEvent?.('death', {
                    deadSteamId: steamId,
                    deadName: player.name,
                    killerSteamId: lastAttackerId || null,
                    killerName: attacker?.name || null,
                    reason: 'game_over',
                });

                // Emit the local death event too. recordDeath broadcasts to PEERS,
                // but the host never receives its own broadcast, so without this the
                // Battle Log misses natural top-outs caught here (the host's only
                // death path that previously emitted nothing).
                emitMultiplayerEvent(MULTIPLAYER_EVENTS.PLAYER_TOPPED_OUT, {
                    steamId,
                    playerName: player.name,
                    killer: lastAttackerId || null,
                    killerId: lastAttackerId || null,
                    killerName: attacker?.name || null,
                    isSelfKill: !lastAttackerId || lastAttackerId === steamId,
                    isLocal: steamId === this.localPlayerId,
                });
            }
        });

        // Check win condition
        this.fragTracker.checkMatchEnd();
    }

    /**
    * Restart the match (new round with same players)
    * HOST ONLY - Instant restart (no between-round countdown)
    */
    restartMatch() {
        if (!this.isHost) {
            console.warn('⚠️ Only host can restart match');
            return;
        }

        console.log('🔄 Restarting match...');

        // Select and publish ownership of the next round seed before reset or
        // any ready-barrier/resync-visible waiting window. This is deliberately
        // still the legacy LCG seed source; rngV2 remains dark.
        const newSeed = Math.floor(Math.random() * 1000000);
        this.sharedSeed = newSeed;

        // Stop current game
        this.stopGameLoop();
        this.stopStateSyncLoop();
        resetFfaInputEpoch(this);
        // stopStateSyncLoop() also stops the heartbeat, but the round doesn't actually
        // start (which re-arms it via startStateSyncLoop) until AFTER the ready-barrier
        // wait / countdown — a multi-second window. Without a heartbeat in that window the
        // peer false-migrates (HostMigration only refreshes on NET_HEARTBEAT). Re-arm now
        // so the host keeps beating throughout the restart. Idempotent + host-only.
        this.startHeartbeatLoop();

        // Reset trackers
        if (this.fragTracker) {
            this.fragTracker.reset();
        }
        if (this.attackRouter) {
            this.attackRouter.clearHistory();
        }

        // IMPORTANT: Reset ALL players (including dead ones) but KEEP FRAGS/SCORES.
        // Reset the board IN PLACE (gameState.reset()) — do NOT replace the object
        // with `new GameState()`. Replacing it orphaned every reference still holding
        // the old gameState (the unified-loop player registration, the input jitter
        // buffer, the BoardScene, the render slots), so on round 2+ the LOCAL player's
        // input/gravity drove a detached board: ~15 pieces fell, 0 lines cleared, and
        // it "topped out on spawn". In-place reset mirrors the proven initial path
        // (initializePlayerForMatch → gameState.reset()).
        this.players.forEach((player) => {
            player.isAlive = true; // Revive everyone
            player.awaitingSpawn = false; // a waiting late-joiner spawns this round
            // DO NOT RESET FRAGS - they accumulate across rounds!
            player.garbageQueue.clear();
            player.lastAttackerId = null; // Clear last attacker for new round

            // Reset board/pieces/flags in place but preserve cumulative stats.
            const oldScore = player.gameState.score;
            const oldLines = player.gameState.lines;
            const oldLevel = player.gameState.level;

            player.gameState.reset();
            player.gameState.score = oldScore; // Keep score across rounds
            player.gameState.lines = oldLines; // Keep lines across rounds
            player.gameState.level = oldLevel; // Keep level progression
        });

        // Clear buffered inputs/ticks from the finished round (the jitter buffer is
        // otherwise only reset at match start), so round-2 host input isn't dropped
        // as stale or applied out of order.
        if (this.inputJitterBuffer) {
            this.inputJitterBuffer.clear();
            this.players.forEach((_p, id) => this.inputJitterBuffer.addPlayer(id));
        }

        // Reset match state (but keep matchStartTime for time-based win conditions)
        this.winner = null;
        this.gamePhase = 'waiting';

        console.log('🎮 Starting next round...');

        // Bump the round generation BEFORE broadcasting so every snapshot built
        // from here on is fenced as "newer", and any round-N snapshot still in
        // flight (gen < this) is dropped by peers.
        this.roundGeneration += 1;

        // Force the next snapshot to be a fresh keyframe — otherwise the first
        // post-restart packet is a delta against the pre-restart keyframe and the
        // peer decodes round-2 against round-1 data.
        this.network.resetSnapshotBaselines?.();

        // Broadcast round restart to all peers BEFORE starting the next round
        // With the ready-barrier ON the host defers the start until every player has
        // acked (GAME_ROUND_START), so the peers must NOT instant-start — they reset,
        // send GAME_ROUND_READY, and wait. With it OFF this is the legacy instant path.
        const useBarrier = this._readyBarrierEnabled;
        const instantStart = !useBarrier;
        this._recordNetEvent?.('round_restart', {
            roundGeneration: this.roundGeneration,
            seed: newSeed,
            readyBarrier: useBarrier,
            playerCount: this.players.size,
        });
        console.log(`🔄 [FFA] Round restart → generation ${this.roundGeneration} (seed ${newSeed})${useBarrier ? ' [ready-barrier]' : ''}`);
        this.network.broadcastToAll(MessageTypes.GAME_ROUND_RESTART, {
            newSeed,
            instantStart,
            awaitReady: useBarrier,
            roundGeneration: this.roundGeneration,
        });

        // Dispatch event to clear death visuals for all players
        emitMultiplayerEvent(MULTIPLAYER_EVENTS.ROUND_RESTART, {
            players: Array.from(this.players.keys()),
        });

        const startRound = () => {
            this.gamePhase = 'playing';
            this._recordNetEvent?.('round_start', {
                roundGeneration: this.roundGeneration,
                seed: newSeed,
                readyBarrier: useBarrier,
            });

            // Re-initialize players for next round (use the same seed we broadcast)
            // CRITICAL: All players must use the EXACT same seed for fair play
            this.players.forEach((player) => {
                // Set new deterministic RNG for this round - same seed for all players
                player.gameState.randomGenerator = this.createSeededRNG(newSeed);

                // Fill bag and spawn first piece
                fillBag(player.gameState.nextPieces, player.gameState.randomGenerator);
                spawnPiece(player.gameState, null, null);
            });

            // Start game loop
            this.startGameLoop();

            // Host: Start state sync loop (30Hz broadcasts to peers)
            if (this.isHost) {
                this.startStateSyncLoop();
            }

            console.log('🎮 Round started!');
        };

        if (useBarrier) {
            // Defer the local start: arm the barrier and wait for every player to ack
            // (or the timeout). _finalizeRoundStart() runs this thunk + broadcasts GO.
            this._beginReadyBarrier(startRound);
            return;
        }

        if (instantStart) {
            this.hideCountdownOverlay();
            startRound();
            return;
        }

        this.showCountdown(startRound, 'ROUND OVER', 3, false);
    }

    /**
     * HOST: arm the all-players-ready barrier for the pending round. The host counts
     * itself ready immediately; once every expected player has acked GAME_ROUND_READY
     * (or READY_BARRIER_TIMEOUT_MS elapses) the round starts for everyone together.
     */
    _handleRoundReady(msg) {
        if (!this.isHost) return;
        const gen = msg.data?.roundGeneration;
        // Drop a ready from an already-superseded round so it can't satisfy the
        // current barrier prematurely.
        if (typeof gen === 'number' && gen !== this.roundGeneration) {
            this._recordNetEvent?.('round_ready_ignored', {
                steamId: msg.from,
                reason: 'generation',
                incomingGeneration: gen,
                roundGeneration: this.roundGeneration,
            });
            return;
        }
        if (!this._pendingRoundStart) {
            this._recordNetEvent?.('round_ready_ignored', {
                steamId: msg.from,
                reason: 'no_pending_barrier',
                roundGeneration: this.roundGeneration,
            });
            return;
        }
        const expected = this._expectedReadyPeers();
        if (!expected.has(msg.from)) {
            this._recordNetEvent?.('round_ready_ignored', {
                steamId: msg.from,
                reason: 'unexpected_peer',
                expected: Array.from(expected).sort(),
                roundGeneration: this.roundGeneration,
            });
            return;
        }
        if (!this._roundReady) this._roundReady = new Set();
        if (this._roundReady.has(msg.from)) {
            this._recordNetEvent?.('round_ready_duplicate', {
                steamId: msg.from,
                roundGeneration: this.roundGeneration,
            });
            return;
        }
        this._roundReady.add(msg.from);
        const status = this._readyBarrierStatus();
        this._recordNetEvent?.('round_ready', {
            steamId: msg.from,
            readyCount: status.readyCount,
            expectedCount: status.expectedCount,
            missing: status.missing,
            roundGeneration: this.roundGeneration,
        });
        console.log(`🚦 [FFA] Round-ready from ${msg.from} (${status.readyCount}/${status.expectedCount})`);
        this._maybeFinalizeRoundStart();
    }

    _beginReadyBarrier(startThunk) {
        this.hideCountdownOverlay();
        this._pendingRoundStart = startThunk;
        this._roundReadyExpected = new Set(this.players.keys());
        this._roundReady = new Set([this.localPlayerId]); // host is ready the instant it resets
        const status = this._readyBarrierStatus();
        this._recordNetEvent?.('round_barrier_begin', {
            roundGeneration: this.roundGeneration,
            expected: status.expected,
            ready: status.ready,
            missing: status.missing,
            expectedCount: status.expectedCount,
        });
        if (this._readyBarrierTimer) clearTimeout(this._readyBarrierTimer);
        this._readyBarrierTimer = setTimeout(() => {
            const timeoutStatus = this._readyBarrierStatus();
            this._recordNetEvent?.('round_barrier_timeout', {
                roundGeneration: this.roundGeneration,
                ready: timeoutStatus.ready,
                missing: timeoutStatus.missing,
                readyCount: timeoutStatus.readyCount,
                expectedCount: timeoutStatus.expectedCount,
            });
            console.warn('⏱️ [FFA] Ready-barrier timeout — starting round without all readies');
            this._finalizeRoundStart();
        }, this.READY_BARRIER_TIMEOUT_MS);
        // A host-only / solo game (no peers to wait on) starts immediately.
        this._maybeFinalizeRoundStart();
    }

    /** Players the host waits on before starting a round (all current players). */
    _expectedReadyPeers() {
        return this._roundReadyExpected
            ? new Set(this._roundReadyExpected)
            : new Set(this.players.keys());
    }

    _readyBarrierStatus() {
        const expected = Array.from(this._expectedReadyPeers()).sort();
        const readySet = this._roundReady || new Set();
        const ready = expected.filter((id) => readySet.has(id));
        const missing = expected.filter((id) => !readySet.has(id));
        return {
            expected,
            ready,
            missing,
            expectedCount: expected.length,
            readyCount: ready.length,
            missingCount: missing.length,
        };
    }

    /** HOST: start the round the moment every expected player has acked. */
    _maybeFinalizeRoundStart() {
        if (!this.isHost || !this._pendingRoundStart) return;
        const expected = this._expectedReadyPeers();
        const ready = this._roundReady || new Set();
        for (const id of expected) {
            if (!ready.has(id)) return; // still waiting on someone
        }
        this._finalizeRoundStart();
    }

    /** HOST: broadcast GO and start the deferred round locally (idempotent). */
    _finalizeRoundStart() {
        if (!this.isHost || !this._pendingRoundStart) return;
        if (this._readyBarrierTimer) {
            clearTimeout(this._readyBarrierTimer);
            this._readyBarrierTimer = null;
        }
        const startThunk = this._pendingRoundStart;
        this._pendingRoundStart = null;
        const status = this._readyBarrierStatus();
        this._recordNetEvent?.('round_barrier_finalized', {
            roundGeneration: this.roundGeneration,
            ready: status.ready,
            missing: status.missing,
            readyCount: status.readyCount,
            expectedCount: status.expectedCount,
        });
        this._roundReadyExpected = null;
        console.log(`🚦 [FFA] All players ready → starting round (gen ${this.roundGeneration})`);
        this.network.broadcastToAll(MessageTypes.GAME_ROUND_START, {
            roundGeneration: this.roundGeneration,
        });
        startThunk();
        // A reconnect that missed the deferred restart has no process-local
        // thunk for GAME_ROUND_START to release. Keep its resync queued until
        // the host has actually entered playing, then send authoritative state.
        this._updateSyncpoint?.();
        this._processPendingResyncs?.();
    }

    /**
    * Full game restart (resets frags too) - used when game is truly over
    * HOST ONLY
    */
    restartFullGame() {
        if (!this.isHost) {
            console.warn('⚠️ Only host can restart full game');
            return;
        }

        console.log('🔄 Restarting full game (resetting frags)...');

        // Stop current game
        this.stopGameLoop();
        this.stopStateSyncLoop();
        resetFfaInputEpoch(this);
        // Keep the heartbeat alive across the reset → startMatch countdown window so a
        // peer doesn't false-migrate while the host rebuilds the game (see restartMatch).
        // startMatch() re-arms it too; this just closes the brief gap. Idempotent.
        this.roundGeneration += 1;
        this.startHeartbeatLoop();

        // Reset trackers
        if (this.fragTracker) {
            this.fragTracker.reset();
        }
        if (this.attackRouter) {
            this.attackRouter.clearHistory();
        }

        // Reset ALL players including frags/scores (full reset). In-place reset()
        // (not `new GameState()`) keeps every held reference valid — see restartMatch.
        this.players.forEach((player) => {
            player.isAlive = true;
            player.awaitingSpawn = false; // a waiting late-joiner spawns this game
            player.frags = 0; // RESET FRAGS for new game
            player.garbageQueue.clear();
            player.lastAttackerId = null; // Clear last attacker for new game

            // Complete reset
            player.gameState.reset();
            player.gameState.level = this.matchConfig.startLevel;
        });

        // Clear buffered inputs/ticks from the finished game (host only).
        if (this.inputJitterBuffer) {
            this.inputJitterBuffer.clear();
            this.players.forEach((_p, id) => this.inputJitterBuffer.addPlayer(id));
        }

        // Reset match state
        this.winner = null;
        this.gamePhase = 'waiting';

        console.log('🎮 Starting new game...');

        // Dispatch event to clear death visuals
        emitMultiplayerEvent(MULTIPLAYER_EVENTS.ROUND_RESTART, {
            players: Array.from(this.players.keys()),
        });

        // Start a fresh match (broadcasts to peers with countdown)
        this.startMatch();
    }

    /**
    * Show countdown overlay with optional text: [TEXT] → 3, 2, 1, GO!
    * @param {Function} callback - Called after countdown finishes
    * @param {string} prefixText - Optional text to show before countdown (e.g., "ROUND OVER", "GAME START")
    * @param {number} countFrom - Number to start counting down from
    * @param {boolean} includeZero - Whether to include 0 in the countdown
    */
    showCountdown(callback, prefixText = null, countFrom = 5, includeZero = true) {
        const countdownGeneration = (this._countdownGeneration || 0) + 1;
        this._countdownGeneration = countdownGeneration;
        const runIfCurrent = (fn) => (...args) => {
            if (this._countdownGeneration === countdownGeneration) fn(...args);
        };
        const countdownElement = typeof document === 'undefined'
            ? null : document.getElementById('multiplayer-countdown');

        if (!countdownElement) {
            console.warn('⚠️ Countdown element not found');
            if (callback) callback();
            return;
        }

        const minCount = includeZero ? 0 : 1;
        let count = Number.isFinite(countFrom) ? Math.floor(countFrom) : 5;
        if (count < minCount) {
            count = minCount;
        }

        const forceFullScreen = () => {
            countdownElement.style.cssText = `
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        z-index: 99999 !important;
        margin: 0 !important;
        padding: 0 !important;
        background: rgba(0, 0, 0, 0.85) !important;
        backdrop-filter: blur(15px) !important;
        font-family: 'Orbitron', sans-serif !important;
        font-weight: 900 !important;
        text-align: center !important;
        color: #ffffff !important;
        text-shadow: 0 0 30px rgba(255, 255, 255, 0.9), 0 0 50px rgba(102, 126, 234, 0.7), 0 0 80px rgba(102, 126, 234, 0.4) !important;
        transform: none !important;
        translate: none !important;
        inset: 0 !important;
        opacity: 1 !important;
      `;
        };

        if (prefixText) {
            forceFullScreen();
            countdownElement.textContent = prefixText;
            countdownElement.style.fontSize = '80px';
            countdownElement.style.color = '#fbbf24'; // Yellow/gold
            countdownElement.style.animation = 'countdownFadeInScale 0.4s ease-out forwards';

            setTimeout(runIfCurrent(() => {
                countdownElement.style.animation = 'countdownFadeOut 0.2s ease-out forwards';
                setTimeout(runIfCurrent(startCountdown), 200);
            }), 1400);
        } else {
            forceFullScreen();
            startCountdown();
        }

        function startCountdown() {
            const showGo = () => {
                requestAnimationFrame(runIfCurrent(() => {
                    countdownElement.textContent = 'GO!';
                    countdownElement.style.fontSize = '160px';
                    countdownElement.style.color = '#10b981'; // Bright Green
                    countdownElement.style.animation = 'none';

                    void countdownElement.offsetHeight;

                    countdownElement.style.animation = 'countdownGo 0.6s ease-out forwards';

                    emitMultiplayerEvent(MULTIPLAYER_EVENTS.COUNTDOWN, { count: 'GO' });
                }));

                setTimeout(runIfCurrent(() => {
                    requestAnimationFrame(runIfCurrent(() => {
                        countdownElement.style.transition = 'opacity 0.3s ease-out';
                        countdownElement.style.opacity = '0';
                    }));

                    setTimeout(runIfCurrent(() => {
                        countdownElement.style.display = 'none';
                        countdownElement.style.transition = '';
                        countdownElement.style.opacity = ''; // Reset opacity
                        if (callback) callback();
                    }), 300);
                }), 600);
            };

            const showNumber = () => {
                if (count < minCount) {
                    showGo();
                    return;
                }

                const displayCount = count;
                requestAnimationFrame(runIfCurrent(() => {
                    countdownElement.textContent = String(displayCount);
                    countdownElement.style.fontSize = '140px';
                    countdownElement.style.color = displayCount >= 3 ? '#ef4444' : displayCount === 2 ? '#f59e0b' : '#10b981'; // Red (5,4,3) -> Orange (2) -> Green (1)
                    countdownElement.style.animation = 'none'; // Clear previous animation

                    void countdownElement.offsetHeight;

                    countdownElement.style.animation = 'countdownPulse 0.5s ease-out forwards';

                    emitMultiplayerEvent(MULTIPLAYER_EVENTS.COUNTDOWN, { count: displayCount });
                }));

                count--;

                if (count >= minCount) {
                    setTimeout(runIfCurrent(showNumber), 750);
                } else {
                    const goDelay = includeZero ? 0 : 750;
                    setTimeout(runIfCurrent(showGo), goDelay);
                }
            };

            showNumber();
        }
    }

    hideCountdownOverlay() {
        this._countdownGeneration = (this._countdownGeneration || 0) + 1;
        const countdownElement = typeof document === 'undefined'
            ? null : document.getElementById('multiplayer-countdown');
        if (!countdownElement) return;

        countdownElement.style.display = 'none';
        countdownElement.style.transition = '';
        countdownElement.style.opacity = '';
        countdownElement.style.animation = '';
        countdownElement.textContent = '';
    }

    /**
    * Clean up (leave match)
    */
    cleanup() {
        this._transitionJoin(JOIN_EVENTS.CLOSE, { reason: 'cleanup' });
        this._disposed = true;
        this._networkHandlerRegistry?.dispose();
        this.hideCountdownOverlay();
        resyncInputBarrier.cancelResyncInputBarriers(this, 'cleanup');
        disposeResyncState(this);
        this.stopGameLoop();
        this.stopStateSyncLoop();
        this.hostMigration?.stopMonitoring?.();
        resetFfaInputTransport(this);

        if (this._announceTimer) { clearTimeout(this._announceTimer); this._announceTimer = null; }

        if (this.inputValidator) {
            this.inputValidator.reset();
        }

        if (this.fragTracker) {
            this.fragTracker.reset();
        }

        if (this.attackRouter) {
            this.attackRouter.clearHistory();
        }

        this.players.clear();
        this.gamePhase = 'waiting';
        this.winner = null;
        this.setLocalInputHooks();

        console.log('🧹 FFA game state cleaned up');
    }
}
