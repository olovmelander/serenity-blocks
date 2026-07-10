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
  id?: number;
}

/** A queued garbage entry mirrored over the wire. */
interface GarbageEntrySnapshot {
  type: string;
  attackerId?: string;
  /** Burst identity — with lineIndex forms the idempotent-adopt dedupe key
   *  `attackId:lineIndex` (garbageIdempotent flag). Distinct from attackerId. */
  attackId?: string | number;
  lineIndex?: number;
  color?: string;
  holeMask?: number[] | number | null;
  variant?: string;
}

interface BlindTimersSnapshot {
  field: number;
  fieldMax: number;
  pending: number;
  pendingMax: number;
}

/**
 * The per-player snapshot. Must stay in sync across:
 *  - ffa-p2p-game-state.js  buildStateSnapshot()  (producer)
 *  - network/binary-encoding.js  encode/decode     (wire)
 *  - ffa-p2p-game-state.js  _applySnapshotState()  (consumer)
 */
interface PlayerSnapshot {
  steamId: string;
  name: string;
  color: string;
  score: number;
  lines: number;
  level: number;
  frags: number;
  isAlive: boolean;
  garbagePending: number;
  grid: Array<Array<BoardCell | null>>;
  currentPiece: unknown | null;
  nextPieces: Array<string | { type: string }>;
  dropCounter: number;
  dropInterval: number;
  garbageEntries: GarbageEntrySnapshot[];
  lockedPieces?: unknown[];
  blindTimers: BlindTimersSnapshot | null;
  lastInputSeq?: number;
  /** Late joiner waiting for the next spawn window (≠ eliminated) — drives the ⏳ overlay. */
  awaitingSpawn?: boolean;
}

/** The full authoritative snapshot broadcast at the state-sync rate. */
interface StateSnapshot {
  players: PlayerSnapshot[];
  gamePhase: 'waiting' | 'countdown' | 'playing' | 'finished';
  winner: { steamId: string | null; name: string } | null;
  timestamp: number;
  tick: number;
  /** DJB2 digest for desync detection — carried in the network envelope wrapper. */
  digest?: string;
  /** Round fence: snapshots from a previous round generation are dropped on apply. */
  roundGeneration?: number;
  /** Host-migration epoch fence (migrationEpoch flag): stale-host packets are rejected. */
  migrationEpoch?: number;
  /** Host's watch-only spectator count, mirrored to peers for lobby display. */
  spectatorCount?: number;
}

/**
 * Download-join / resync progress owned by the joining peer while a chunked
 * state transfer is in flight (downloadJoin flag; plan §6A.6 replaces these
 * implicit flags with an explicit joinState machine).
 */
interface DownloadJoinState {
  downloadJoinInProgress: boolean;
  resyncId?: string | null;
  expectedChunks?: number;
  receivedChunks?: number;
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

interface Window {
  settings?: GameSettings;
  settingsManager?: SettingsManager;
  themeManager?: unknown;
  gameInstance?: unknown;
  perfMonitor?: unknown;
  electronAPI?: unknown;
  activeGPURenderer?: unknown;
  audioManager?: unknown;
  __DEBUG_JSON_SNAPSHOTS__?: boolean;
}
