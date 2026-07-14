// @ts-check
/**
 * Canonical gameplay-event emitters (remediation plan §4.6 first slice — the
 * "6-shape problem"). The quartet (+TSPIN/B2B) was emitted from ~25 sites
 * across the six game modes with divergent payloads; ~212 theme subscriptions
 * consume them. These helpers are now the ONE definition of each payload
 * shape; modes call them instead of eventBus.emit directly (pinned by
 * tests/unit/gameplay-event-payloads.test.js).
 *
 * Shape rules (from the 2026-07 consumer audit — violating any of these
 * breaks live themes):
 *  - NEVER rename lineCount / comboCount / piece / depth / active — aurora,
 *    tornado, ocean, chromadelic read them bare (NaN on rename); ~35 more
 *    silently degrade to their `|| 1` fallbacks.
 *  - clearedRows and cascadeCount are ALWAYS present on LINE_CLEAR (defaults
 *    [] / 1) — starlight/wolfhour/electric-dreams place effects from
 *    clearedRows; halcyon/vesper scale by cascadeCount.
 *  - NEVER add a field named `detail` — ~10 themes unwrap
 *    `payload?.detail || payload`, so a `detail` key would shadow the payload.
 *  - NEVER add `timestamp` to PIECE_LOCK — chromadelic's play-pace tracker
 *    interprets it as a ms clock.
 *  - Optional keys are an explicit allowlist (below), not a pass-through bag:
 *    unknown keys are dropped so shapes cannot drift back through the helper.
 */
import { eventBus, EVENTS } from './event-bus.js';

/** @param {Record<string, any>} extra @param {string[]} allowed */
function pickAllowed(extra, allowed) {
    /** @type {Record<string, any>} */
    const out = {};
    for (const key of allowed) {
        if (extra[key] !== undefined) out[key] = extra[key];
    }
    return out;
}

// Mode/context tags shared by every gameplay event: `source` (e.g. 'odyssey',
// 'serenity-interaction'), `levelId` (Odyssey), `player` (local-MP board
// number — wolfhour selects the per-player canvas rect from it), `position`
// (Serenity interaction origin {x,y}).
const COMMON_OPTIONALS = ['source', 'levelId', 'player', 'position'];

/**
 * @param {{ lineCount: number, clearedRows?: number[], cascadeCount?: number,
 *   comboCount?: number, source?: string, levelId?: string|number,
 *   player?: number, position?: {x:number,y:number} }} payload
 */
export function emitLineClear({
    lineCount, clearedRows = [], cascadeCount = 1, ...extra
}) {
    eventBus.emit(EVENTS.LINE_CLEAR, {
        lineCount,
        clearedRows,
        cascadeCount,
        ...pickAllowed(extra, ['comboCount', ...COMMON_OPTIONALS]),
    });
}

/**
 * @param {{ comboCount: number, source?: string, levelId?: string|number,
 *   player?: number, position?: {x:number,y:number} }} payload
 */
export function emitCombo({ comboCount, ...extra }) {
    eventBus.emit(EVENTS.COMBO, { comboCount, ...pickAllowed(extra, COMMON_OPTIONALS) });
}

/**
 * @param {{ piece: object|null, source?: string, levelId?: string|number,
 *   player?: number }} payload
 *   piece sub-fields shape/x/y are read by starlight/chiral-gold/wolfhour/
 *   halcyon to place lock-origin effects.
 */
export function emitPieceLock({ piece, ...extra }) {
    eventBus.emit(EVENTS.PIECE_LOCK, { piece, ...pickAllowed(extra, COMMON_OPTIONALS) });
}

/**
 * @param {{ depth: number, perfectClearBonus?: number, source?: string,
 *   levelId?: string|number, player?: number }} payload
 */
export function emitPerfectClear({ depth, perfectClearBonus, ...extra }) {
    eventBus.emit(EVENTS.PERFECT_CLEAR, {
        depth,
        perfectClearBonus,
        ...pickAllowed(extra, COMMON_OPTIONALS),
    });
}

/**
 * @param {{ lineCount: number, source?: string, levelId?: string|number,
 *   player?: number }} payload
 */
export function emitTSpin({ lineCount, ...extra }) {
    eventBus.emit(EVENTS.TSPIN, { lineCount, ...pickAllowed(extra, COMMON_OPTIONALS) });
}

/**
 * @param {{ active?: boolean, source?: string, levelId?: string|number,
 *   player?: number }} payload
 */
export function emitB2B({ active = true, ...extra } = {}) {
    eventBus.emit(EVENTS.B2B, { active, ...pickAllowed(extra, COMMON_OPTIONALS) });
}
