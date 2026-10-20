// @ts-check

/**
 * What a charm does to a live attempt (docs/ODYSSEY_CHARMS_AUDIT_2026-10.md §5.4).
 *
 * One press, one effect, now: Tide sweeps the lowest rows, Still Air slows the fall for a while,
 * Long Breath lengthens the clock, Hearth arms the well so one top-out empties it instead of
 * ending the orb. Each is used once an attempt and is gone from the bag on use, whatever the
 * attempt comes to. Nothing a charm clears counts toward a goal: Tide and Hearth rewrite the
 * well through the restore boundary replays use (the grid, caches and the Infinity camera stay
 * in step), never through the line-clear path. Still Air's clock is ticked from the gameplay
 * loop (tickOdysseyCharms), not from the HUD's throttled refresh, so it ends when it should.
 *
 * Fixed-tick attempts (fixed60-v1, the dev flag, unranked) refuse every charm: a well rewrite
 * from a key press is off-tick there. A fixed-tick path would route the use through
 * applyOdysseyFixedCommand; none exists yet.
 */
import { markBoardDirty, rebuildBoardGridFromPieces } from '../board.js';
import { restoreBoardState } from '../game.js';
import { DEMO_FIXED_SIMULATION_CLOCK } from '../demo/DemoRecorder.js';
import {
    ODYSSEY_CHARMS, ODYSSEY_LONG_BREATH_SECONDS, ODYSSEY_STILL_AIR_MS, ODYSSEY_STILL_AIR_SLOWEST_MS,
    ODYSSEY_TIDE_ROWS, odysseyCharmById, odysseyCharmTitle, odysseyLevelHasClock,
} from './odyssey-charm-bag.js';

/** The chips' lavender, for the ring Hearth draws on the well when armed. */
const HEARTH_RING_TONE = 0xb5a0ee;

/** Why a press did nothing, in the chip's few words. */
export const ODYSSEY_CHARM_REFUSALS = Object.freeze({
    'fixed-clock': 'not on this clock',
    'no-clock': 'no clock here',
    cascade: 'mid-cascade',
    'empty-floor': 'nothing to clear',
    used: 'used',
    none: 'none left',
    paused: 'paused',
    countdown: 'not yet',
    completing: 'orb ending',
    lap: 'orb cleared',
    over: 'orb over',
    look: 'looking around',
});

/**
 * @typedef {Object} OdysseyCharmRun one attempt's charm use
 * @property {string[]} used the charms used this attempt, in order
 * @property {{ until: number, base: number, slow: number } | null} stillAir the slow fall while it runs
 * @property {boolean} hearthArmed
 * @property {boolean} hearthUsed
 */

/** @returns {OdysseyCharmRun} */
export function createOdysseyCharmRun() {
    return {
        used: [], stillAir: null, hearthArmed: false, hearthUsed: false,
    };
}

/** The charms an attempt used, for the results and the time board's exclusion. */
export function odysseyCharmsUsed(session) {
    return [...(session?.charms?.used || [])];
}

// =============================
// Tide
// =============================

/**
 * Remove the lowest `rows` rows of a well and settle everything above by the same distance.
 * Pure: returns new pieces with fresh shape matrices. A stack always rests on the floor, so
 * every surviving cell keeps its support and nothing is left floating.
 * @returns {{ pieces: object[], removed: number }} the settled pieces and the cells swept away
 */
export function sweepLowestRows(lockedPieces, rows, floorRow) {
    const cutFrom = floorRow - rows + 1;
    let removed = 0;
    const pieces = [];
    for (const piece of lockedPieces || []) {
        let remaining = 0;
        const shape = piece.shape.map((row) => row.slice());
        for (let dy = 0; dy < shape.length; dy++) {
            const swept = Math.floor(piece.y + dy) >= cutFrom;
            for (let dx = 0; dx < shape[dy].length; dx++) {
                if (!shape[dy][dx]) continue;
                if (swept) {
                    shape[dy][dx] = 0;
                    removed++;
                } else {
                    remaining++;
                }
            }
        }
        if (remaining > 0) pieces.push({ ...piece, shape, y: piece.y + rows });
    }
    return { pieces, removed };
}

function replaceWell(gameState, pieces) {
    const grid = rebuildBoardGridFromPieces(pieces, gameState.boardGrid.map((row) => Array(row.length).fill(null)));
    restoreBoardState(gameState, { grid, lockedPieces: pieces }, {
        adoptBoard: true, keepCurrentPiece: true, mirrorGrid: Array.isArray(gameState.grid),
    });
    markBoardDirty(gameState);
}

/** The rows Tide would sweep, lowest last, for the flash and the particles. */
export function odysseyTideRows(gameState, rows = ODYSSEY_TIDE_ROWS) {
    const floor = (gameState?.boardGrid?.length || 0) - 1;
    return floor < 0 ? [] : Array.from({ length: Math.min(rows, floor + 1) }, (_, index) => floor - index);
}

/** Tide: the lowest rows wash away; refused mid-cascade, after a top-out, or over an empty floor. */
export function applyOdysseyTide(gameState, rows = ODYSSEY_TIDE_ROWS) {
    if (!gameState?.boardGrid?.length || gameState.isProcessingPhysics || gameState.isGameOver) return false;
    const { pieces, removed } = sweepLowestRows(gameState.lockedPieces, rows, gameState.boardGrid.length - 1);
    if (removed === 0) return false;
    replaceWell(gameState, pieces);
    return true;
}

// =============================
// Still Air
// =============================

/** Still Air: the gentlest fall for a while, measured on the attempt's clock. */
export function beginOdysseyStillAir(session, nowMs) {
    const run = session?.charms;
    const { gameState } = session || {};
    if (!run || !gameState) return null;
    const base = Math.max(1, Number(gameState.dropInterval) || 1000);
    const slow = Math.max(base, ODYSSEY_STILL_AIR_SLOWEST_MS);
    run.stillAir = { until: nowMs + ODYSSEY_STILL_AIR_MS, base, slow };
    gameState.dropInterval = slow;
    return run.stillAir;
}

/**
 * Keep Still Air's pace through level-ups and duel rounds, and give the pace back when it ends.
 * @returns {number|null} milliseconds left, 0 when it just ended, null when none is running
 */
export function tickOdysseyStillAir(session, nowMs) {
    const air = session?.charms?.stillAir;
    if (!air) return null;
    const { gameState } = session;
    if (nowMs >= air.until) {
        if (gameState.dropInterval === air.slow) gameState.dropInterval = air.base;
        session.charms.stillAir = null;
        return 0;
    }
    if (gameState.dropInterval !== air.slow) {
        // A level-up or a new duel round set a fresh pace underneath; slow that one instead.
        air.base = gameState.dropInterval;
        air.slow = Math.max(air.base, ODYSSEY_STILL_AIR_SLOWEST_MS);
        gameState.dropInterval = air.slow;
    }
    return air.until - nowMs;
}

// =============================
// Long Breath
// =============================

/** Long Breath: more seconds on a clock, through the evaluator. Nothing on an orb without one. */
export function applyOdysseyLongBreath(session) {
    if (!session?.hybridEngine?.extendTimeLimit || !odysseyLevelHasClock(session.levelConfig)) return 0;
    session.hybridEngine.extendTimeLimit(ODYSSEY_LONG_BREATH_SECONDS);
    return ODYSSEY_LONG_BREATH_SECONDS;
}

// =============================
// Hearth
// =============================

/**
 * Empty a well and let play go on: the piece in hand stays, or a new one is dealt.
 * @param {object} gameState
 * @param {{ spawn?: () => void }} [options]
 */
export function reviveOdysseyWell(gameState, { spawn } = {}) {
    if (!gameState?.boardGrid?.length) return false;
    replaceWell(gameState, []);
    gameState.isGameOver = false;
    gameState.isAlive = true;
    gameState.dropCounter = 0;
    if (!gameState.currentPiece) spawn?.();
    return true;
}

/**
 * Hearth, armed: a top-out empties the well instead of ending the orb, once. Shared by solo
 * wells (the mode's game-over path) and the duel's human well (its top-out guard, so the rival
 * gets no knockout).
 * @returns {boolean} whether the top-out was absorbed
 */
export function tryOdysseyHearth(mode, session) {
    const run = session?.charms;
    if (!run?.hearthArmed || run.hearthUsed) return false;
    const { gameState } = session;
    if (!mode?._isLevelSessionActive?.(session) || gameState?.victoryLapActive) return false;
    const revived = reviveOdysseyWell(gameState, { spawn: () => session.physicsCallbacks?.spawnPiece?.() });
    if (!revived) return false;
    run.hearthArmed = false;
    run.hearthUsed = true;
    mode._getBoardScene?.()?.sharedEffects?.playPerfectClear?.(0);
    mode.deps?.soundManager?.sfxPlayer?.playPerfectClear?.();
    syncOdysseyCharmHud(mode, session);
    console.log('[Odyssey] Hearth: the well empties and the orb goes on');
    return true;
}

// =============================
// Using a charm
// =============================

/** The attempt's clock in milliseconds, on whichever simulation clock it runs. */
export function odysseyLevelNowMs(mode, session = mode?._activeLevelSession) {
    if (!session) return 0;
    if (session.simulationClock === DEMO_FIXED_SIMULATION_CLOCK) return Number(session.gameState?.simTimeMs) || 0;
    return Number(mode?._elapsedLevelMs?.()) || 0;
}

/** Whether this attempt can use charms at all: never on the fixed-tick clock. */
export function odysseyCharmsAllowed(session) {
    return Boolean(session) && session.simulationClock !== DEMO_FIXED_SIMULATION_CLOCK;
}

/** A refusal that holds for the whole orb (Long Breath without a clock), shown on the chip before any press. */
export function odysseyCharmStandingRefusal(session, charmId) {
    if (charmId === 'long-breath' && session?.levelConfig && !odysseyLevelHasClock(session.levelConfig)) {
        return 'no-clock';
    }
    return null;
}

/**
 * Why a charm cannot be used right now, or null when it can. Refused presses cost nothing.
 * @param {object} mode
 * @param {object} session
 * @param {string} charmId
 * @param {number} count how many of the charm the bag holds
 * @returns {string | null} a key of ODYSSEY_CHARM_REFUSALS, 'no-session' or 'unknown'
 */
export function odysseyCharmRefusal(mode, session, charmId, count) {
    if (!mode?._isLevelSessionActive?.(session) || !session.charms) return 'no-session';
    if (!odysseyCharmsAllowed(session)) return 'fixed-clock';
    if (!odysseyCharmById(charmId)) return 'unknown';
    const { gameState } = session;
    if (!mode.levelRunStarted) return 'countdown';
    if (mode.isPaused || gameState.isPaused) return 'paused';
    if (mode.levelCompleting) return 'completing';
    if (gameState.victoryLapActive) return 'lap';
    if (gameState.isGameOver) return 'over';
    if (mode.isInExplorationMode) return 'look';
    if (session.charms.used.includes(charmId)) return 'used';
    if (!(Number(count) > 0)) return 'none';
    const standing = odysseyCharmStandingRefusal(session, charmId);
    if (standing) return standing;
    if (charmId === 'tide') {
        if (gameState.isProcessingPhysics) return 'cascade';
        const floor = (gameState.boardGrid?.length || 0) - 1;
        if (floor < 0 || sweepLowestRows(gameState.lockedPieces, ODYSSEY_TIDE_ROWS, floor).removed === 0) {
            return 'empty-floor';
        }
    }
    return null;
}

/**
 * Use a charm during the current orb: the effect now, its feedback on the well, one less in the
 * bag (saved), and the chip told. Refused presses change nothing and say why.
 * @param {object} mode
 * @param {string} charmId
 * @returns {{ ok: boolean, charmId: string, reason?: string }}
 */
export function activateOdysseyCharm(mode, charmId) {
    const session = mode?._activeLevelSession;
    const count = mode?.odysseyState?.getCharmCount?.(charmId) ?? 0;
    const reason = odysseyCharmRefusal(mode, session, charmId, count);
    if (reason) return { ok: false, charmId, reason };
    const { gameState } = session;
    const run = session.charms;
    const nowMs = odysseyLevelNowMs(mode, session);
    const effects = mode._getBoardScene?.()?.sharedEffects;
    const sfx = mode.deps?.soundManager?.sfxPlayer;
    let applied = false;
    if (charmId === 'tide') {
        const rows = odysseyTideRows(gameState);
        applied = applyOdysseyTide(gameState);
        if (applied) {
            // The impact's weight without the "Quad" callout four lines would earn: nothing Tide clears counts.
            effects?.playLineClearImpact?.(Math.min(ODYSSEY_TIDE_ROWS, 3), 1);
            effects?.triggerLineClearFlash?.(rows);
            effects?.spawnLineClearParticles?.(rows);
            sfx?.playLineClear?.();
        }
    } else if (charmId === 'still-air') {
        applied = Boolean(beginOdysseyStillAir(session, nowMs));
        if (applied) sfx?.playLevelUp?.();
    } else if (charmId === 'long-breath') {
        const seconds = applyOdysseyLongBreath(session);
        applied = seconds > 0;
        if (applied) {
            mode.odysseyHUD?.extendTimeLimit?.(seconds);
            sfx?.playCascadeChime?.(2);
        }
    } else if (charmId === 'hearth') {
        run.hearthArmed = true;
        applied = true;
        const scene = effects?.scene;
        const width = Number(scene?.cols) * Number(scene?.blockSize);
        const height = Number(scene?.rows) * Number(scene?.blockSize);
        if (Number.isFinite(width) && Number.isFinite(height)) {
            effects.createShockwaveRing?.(width / 2, height * 0.62, HEARTH_RING_TONE, 1);
        }
        sfx?.playLevelUp?.();
    }
    if (!applied) return { ok: false, charmId, reason: 'refused' };
    run.used.push(charmId);
    mode.odysseyState?.spendCharm?.(charmId);
    syncOdysseyCharmHud(mode, session, nowMs);
    console.log(`[Odyssey] Charm used: ${charmId}`);
    return { ok: true, charmId };
}

// =============================
// The tray's view, and the tick
// =============================

/**
 * What the HUD tray shows: a chip for every charm held or used this attempt, each with its
 * state (ready, active with a countdown, armed, used) and any refusal that holds for the orb.
 * Hidden when the bag is empty and nothing was used, and always on the fixed-tick clock.
 * @param {object | null} session
 * @param {Record<string, number>} [counts] the bag, by charm id
 * @param {number} [nowMs] the attempt's clock
 * @param {{ paused?: boolean }} [options]
 */
export function describeOdysseyCharmRun(session, counts = {}, nowMs = 0, { paused = false } = {}) {
    const run = session?.charms || createOdysseyCharmRun();
    const active = Boolean(run.stillAir && nowMs < run.stillAir.until);
    const charms = ODYSSEY_CHARMS.map((charm) => {
        const count = Math.max(0, Math.floor(Number(counts?.[charm.id]) || 0));
        const used = run.used.includes(charm.id);
        let state = count > 0 ? 'ready' : 'empty';
        let remainingMs = 0;
        if (charm.id === 'still-air' && active) {
            state = 'active';
            remainingMs = run.stillAir.until - nowMs;
        } else if (charm.id === 'hearth' && run.hearthArmed) {
            state = 'armed';
        } else if (used) {
            state = 'used';
        }
        const reason = state === 'ready' ? odysseyCharmStandingRefusal(session, charm.id) : null;
        return {
            ...charm, title: odysseyCharmTitle(charm), count, state, remainingMs, reason, shown: count > 0 || used,
        };
    }).filter((chip) => chip.shown);
    return {
        hidden: !odysseyCharmsAllowed(session) || charms.length === 0,
        paused: Boolean(paused),
        stillAir: active,
        charms,
    };
}

/** Show the tray's current state. */
export function syncOdysseyCharmHud(
    mode,
    session = mode?._activeLevelSession,
    nowMs = odysseyLevelNowMs(mode, session),
) {
    if (!session?.charms || typeof mode?.odysseyHUD?.updateCharms !== 'function') return;
    const counts = mode.odysseyState?.getCharmCounts?.() || {};
    const paused = Boolean(mode.isPaused || session.gameState?.isPaused);
    mode.odysseyHUD.updateCharms(describeOdysseyCharmRun(session, counts, nowMs, { paused }));
}

/** The gameplay loop's tick: Still Air keeps its pace and ends on time, whatever the HUD does. */
export function tickOdysseyCharms(mode, session = mode?._activeLevelSession) {
    if (!session?.charms?.stillAir || !mode?._isLevelSessionActive?.(session)) return;
    if (tickOdysseyStillAir(session, odysseyLevelNowMs(mode, session)) === 0) syncOdysseyCharmHud(mode, session);
}
