/**
 * Shared structural contracts for Serenity Blocks (remediation Phase 3).
 *
 * These types document the hand-maintained contracts that are currently
 * duplicated across many sites with no compile-time binding — most importantly
 * the multiplayer per-player snapshot (built in ffa-p2p-game-state.js, encoded
 * and decoded field-by-field in network/binary-encoding.js, and read back on
 * apply) and the event-bus payloads. As modules opt into `// @ts-check`, annotate
 * their snapshot/event handling against these interfaces so a field rename fails
 * to compile at every site instead of silently corrupting the wire / a listener.
 *
 * This file is intentionally ambient (no imports/exports) so it is visible to any
 * checked module via JSDoc `@type {import('...').X}` references or globals.
 */

// ---------------------------------------------------------------------------
// Multiplayer snapshot contract (host-authoritative state over Steam P2P)
// ---------------------------------------------------------------------------

/** A single board cell as stored in GameState.boardGrid (null = empty). */
interface BoardCell {
  type: string;
  shapeKey?: string;
  color?: string;
  id?: string | number;
}

/** A queued garbage entry mirrored over the wire. */
interface GarbageEntrySnapshot {
  type: string;
  attackerId?: string | null;
  attackerName?: string | null;
  /** Burst identity — with lineIndex forms the idempotent-adopt dedupe key
   *  `attackId:lineIndex` (garbageIdempotent flag). Distinct from attackerId. */
  attackId?: string | number;
  attackSeq?: number;
  lineIndex?: number;
  color?: string;
  holeMask?: number | null;
  variant?: string;
  duration?: number;
  isLastInBurst?: boolean;
  targetId?: string;
  createdSimTick?: number;
  sourceSimTick?: number;
  sourceLockSeq?: number;
  applyAfterLockSeq?: number;
  applySimTick?: number;
  rulesHash?: string;
  clearSummary?: unknown;
}

interface BlindTimersSnapshot {
  field: number;
  fieldMax: number;
  pending: number;
  pendingMax: number;
}

interface InputHandlingConfig {
  dasDelay: number;
  dasInterval: number;
  softDropInterval: number;
}

type InputPhase = 'down' | 'up';

interface InputEdgeBase {
  tick: number;
  subframe: number;
  sequence: number;
}

type InputEdge = InputEdgeBase & (
  | { action: 'move'; value: -1 | 1; phase: InputPhase }
  | { action: 'rotate'; value: 'left' | 'right' | 'flip'; phase: 'down' }
  | { action: 'softDrop'; value: null; phase: InputPhase }
  | { action: 'hardDrop'; value: null; phase: 'down' }
);

type InputAction = InputEdge['action'];

interface InputCommandBase {
  tick: number;
  subframe: number;
  source: 'edge' | 'repeat';
  edgeSequence: number | null;
}

type InputCommand = InputCommandBase & (
  | { action: 'move'; value: -1 | 1 }
  | { action: 'rotate'; value: 'left' | 'right' | 'flip' }
  | { action: 'softDrop'; value: null }
  | { action: 'hardDrop'; value: null }
);

type InputDisposition =
  | 'applied'
  | 'deferred_physics'
  | 'rejected_hit_stop'
  | 'rejected_physics';

interface InputDispositionRecord {
  command: InputCommand;
  disposition: InputDisposition;
}

interface AdvanceTickResult {
  tick: number;
  tickMs: number;
  simTimeMs: number;
  input: InputDispositionRecord[];
  frozen: boolean;
  physicsAdvanced: boolean;
}

interface DasDirectionState {
  active: boolean;
  delayAccumulator: number;
  intervalAccumulator: number;
  isRepeating: boolean;
}

interface TickDasDirectionState extends DasDirectionState {
  readonly clock: 'input60k';
}

interface SoftDropInputState {
  active: boolean;
  intervalAccumulator: number;
}

interface TickSoftDropInputState extends SoftDropInputState {
  readonly clock: 'input60k';
}

interface PlayerInputState {
  readonly clock: 'input60k';
  config: InputHandlingConfig;
  das: {
    moveLeft: TickDasDirectionState;
    moveRight: TickDasDirectionState;
    softDrop: TickSoftDropInputState;
  };
  pendingEdges: InputEdge[];
  nextEdgeSequence: number;
  overflowCount: number;
}

type GamePhase = 'waiting' | 'countdown' | 'playing' | 'finished';

interface ActivePieceSnapshot {
  type: string;
  shapeKey?: string;
  shape?: number[][];
  color?: string;
  x: number;
  y: number;
  rotation: number;
}

interface LockedPieceSnapshot {
  type?: string;
  shapeKey?: string;
  shape: number[][];
  color?: string;
  x: number;
  y: number;
  pieceId?: string | number;
}

/**
 * The per-player snapshot. Must stay in sync across:
 *  - ffa-p2p-game-state.js  buildStateSnapshot()  (producer)
 *  - network/binary-encoding.js  encode/decode     (wire)
 *  - ffa-p2p-game-state.js  _applySnapshotState()  (consumer)
 */
interface PackedPlayerSnapshotV7 {
  steamId: string;
  name: string;
  color: string;
  score: number;
  lines: number;
  level: number;
  frags: number;
  isAlive: boolean;
  awaitingSpawn: boolean;
  garbagePending: number;
  grid: Array<Array<BoardCell | null>>;
  currentPiece: ActivePieceSnapshot | null;
  nextPieces: string[];
  dropCounter: number;
  dropInterval: number;
  garbageEntries: GarbageEntrySnapshot[];
  lockedPieces: LockedPieceSnapshot[];
  blindTimers: BlindTimersSnapshot | null;
}

/** Hydrated player shape accepted by the live snapshot consumer. */
interface PlayerSnapshot extends PackedPlayerSnapshotV7 {
  /** Wrapper-carried acknowledgement; undefined on resync/JSON that omits it. */
  lastInputSeq: number | undefined;
  /** Authoritative/apply fields absent from both packed v7 and its current wrapper. */
  lastAttackerId: string | null | undefined;
  lockSeq: number | undefined;
}

interface AuthoritativePlayerSnapshot extends PlayerSnapshot {
  lastAttackerId: string | null;
  lockSeq: number;
}

interface HotPotatoStateSnapshot {
  enabled: boolean;
  holderId: string | null;
  previousHolderId: string | null;
  expiresAt: number;
  durationMs: number;
  penaltyLines: number;
  generation: number;
  lastEvent: unknown | null;
}

interface SnapshotWinner {
  steamId: string | null;
  name: string;
}

/** Hydrated snapshot accepted by the live consumer. */
interface StateSnapshot {
  players: PlayerSnapshot[];
  gamePhase: GamePhase;
  winner: SnapshotWinner | null;
  timestamp: number;
  tick: number;
  simTick: number;
  snapshotSeq: number;
  /** DJB2 digest for desync detection — carried in the network envelope wrapper. */
  digest: string | undefined;
  /** Round fence: snapshots from a previous round generation are dropped on apply. */
  roundGeneration: number | undefined;
  /** Host-migration epoch fence (migrationEpoch flag): stale-host packets are rejected. */
  migrationEpoch: number | undefined;
  /** Authoritative/apply field; absent from both packed v7 and its current wrapper. */
  hotPotatoState: HotPotatoStateSnapshot | null | undefined;
}

/** Exact producer shape returned by FFAGameStateP2P.buildStateSnapshot(). */
interface AuthoritativeStateSnapshot extends StateSnapshot {
  players: AuthoritativePlayerSnapshot[];
  simTick: number;
  snapshotSeq: number;
  digest: string;
  roundGeneration: number;
  migrationEpoch: number;
  hotPotatoState: HotPotatoStateSnapshot | null;
}

/** Exact v7 packed-body shape before JSON-wrapper metadata is hydrated. */
interface BinaryStateSnapshotV7 {
  players: PackedPlayerSnapshotV7[];
  gamePhase: GamePhase;
  winner: SnapshotWinner | null;
  timestamp: number;
  tick: number;
  simTick: number;
  snapshotSeq: number;
}

interface BinarySnapshotWrapperV7 {
  _binary: true;
  _delta: boolean;
  _data: string;
  _gen?: number;
  _migrationEpoch?: number;
  _acks: Record<string, number>;
  _digest?: string;
  _originalSize: number;
  _encodedSize: number;
}

interface SnapshotHydrationMetadata {
  roundGeneration?: number;
  migrationEpoch?: number;
  digest?: string;
  hotPotatoState?: HotPotatoStateSnapshot | null;
  acknowledgements?: Record<string, number>;
}

interface ResyncSnapshotState extends StateSnapshot {
  matchConfig?: Record<string, unknown>;
  sharedSeed?: number;
  matchStartTime?: number;
  downloadEpoch?: string | null;
  resyncId?: string | null;
  sentAt?: number;
}

/** Download-join/resync progress owned by the joining peer. */
interface DownloadJoinProgress {
  resyncId: string;
  downloadEpoch: string;
  startedAt: number;
  snapshotSeq?: number;
  simTick?: number;
  roundGeneration?: number;
}

interface LobbyPlayerStateSnapshot {
  steamId: string;
  name: string;
  color: string;
  isReady: boolean;
  isAlive: boolean;
  awaitingSpawn: boolean;
  isDisconnected: boolean;
}

interface LobbyRosterSnapshot {
  players: LobbyPlayerStateSnapshot[];
  spectatorCount: number;
}

// ---------------------------------------------------------------------------
// Event-bus payload contracts
// ---------------------------------------------------------------------------

/**
 * Canonical gameplay-event payloads (plan §4.6). The ONE producer is
 * events/gameplay-events.js — modes call its emit helpers, never
 * eventBus.emit directly (pinned by tests/unit/gameplay-event-payloads.test.js).
 * Field names are load-bearing for ~212 theme subscriptions: never rename
 * lineCount/comboCount/piece/depth/active; never add a `detail` key.
 */
interface GameplayEventTags {
  /** Mode/context tag, e.g. 'odyssey', 'infinity', 'serenity-interaction'. */
  source?: string;
  /** Odyssey level id. */
  levelId?: string | number;
  /** Local-MP board number (1-based) — selects the per-player canvas rect. */
  player?: number;
  /** Interaction origin (Serenity click/tap). */
  position?: { x: number; y: number };
}

interface EventPayloadMap {
  LINE_CLEAR: GameplayEventTags & {
    lineCount: number;
    clearedRows: number[]; // always present (default [])
    cascadeCount: number; // always present (default 1)
    comboCount?: number;
  };
  COMBO: GameplayEventTags & { comboCount: number };
  PIECE_LOCK: GameplayEventTags & { piece: unknown | null };
  PERFECT_CLEAR: GameplayEventTags & { depth: number; perfectClearBonus?: number };
  TSPIN: GameplayEventTags & { lineCount: number };
  B2B: GameplayEventTags & { active: boolean };
}

// ---------------------------------------------------------------------------
// Loosely-typed global bag (window.*) — the most-touched global surface.
// ---------------------------------------------------------------------------

interface GameSettings {
  themeBasedTetrominos?: boolean;
  [key: string]: unknown;
}

interface SettingsManager {
  get?: () => GameSettings | undefined;
  [key: string]: unknown;
}

interface ElectronAPI {
  invoke: (...args: any[]) => Promise<any>;
  [key: string]: unknown;
}

interface ImportMeta {
  readonly env: {
    readonly DEV?: boolean;
    [key: string]: unknown;
  };
}

interface Window {
  settings?: GameSettings;
  settingsManager?: SettingsManager;
  themeManager?: unknown;
  gameInstance?: unknown;
  perfMonitor?: unknown;
  electronAPI?: ElectronAPI;
  activeGPURenderer?: unknown;
  audioManager?: unknown;
  __DEBUG_JSON_SNAPSHOTS__?: boolean;
  __MULTIPLAYER_DEBUG_GARBAGE__?: boolean;
}
