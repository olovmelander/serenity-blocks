// @ts-check
// Multiplayer events ride the ONE unified bus (plan §4.1 — optimizer retired).
// Names are ffa:-prefixed so they never collide with the camelCase EVENTS
// namespace on the same bus.
import { eventBus } from './event-bus.js';

export const MULTIPLAYER_EVENTS = {
    PLAYER_LIST_CHANGED: 'ffa:player-list-changed',
    MATCH_PREPARING: 'ffa:match-preparing', // UI setup before countdown
    MATCH_STARTED: 'ffa:match-started', // Game actually starts (after countdown)
    ROUND_RESTART: 'ffa:round-restart',
    CHAT_MESSAGE: 'ffa:chat-message',
    LINE_CLEAR: 'ffa:line-clear',
    LINE_CLEAR_IMPACT: 'ffa:line-clear-impact',
    COMBO: 'ffa:combo',
    // Phase 1+2: an OPPONENT (non-local) player cleared lines — drives the staged
    // flash/combo on that opponent's mini-board. Separate from LINE_CLEAR (which the
    // local board owns) so the two never double-fire. Carries cascadeCount.
    OPPONENT_CLEAR: 'ffa:opponent-clear',
    PIECE_LOCK: 'ffa:piece-lock',
    PLAYER_TOPPED_OUT: 'ffa:player-topped-out',
    GARBAGE_INSERTED: 'ffa:garbage-inserted',
    GARBAGE_COUNTERED: 'ffa:garbage-countered',
    GARBAGE_SENT: 'ffa:garbage-sent', // local echo so the AUTHORING node logs its own attacks

    RENDER_FRAME: 'ffa:render-frame',
    COUNTDOWN: 'ffa:countdown',
    GAME_OVER: 'ffa:game-over',
    ROUND_OVER: 'ffa:round-over',
    PERFECT_CLEAR: 'ffa:perfect-clear',
    JOIN_REJECTED: 'ffa:join-rejected', // host refused our join (e.g. lobby full)
    KICKED: 'ffa:kicked', // the host kicked us from the match
    // Emitted by host-migration.js on epoch adoption. Was emitted with an
    // UNDEFINED name for months (key missing from this map — the bug class the
    // event-contract test now guards); subscriber lands with plan §4.1.
    HOST_MIGRATED: 'ffa:host-migrated',
};

/** @param {string} event @param {unknown} [payload] */
export function emitMultiplayerEvent(event, payload) {
    eventBus.emit(event, payload);
}

/**
 * @param {string} event
 * @param {(payload?: any) => void} handler
 * @param {import('./event-bus.js').ListenerOptions} [options]
 * @returns {() => void} unsubscribe
 */
export function onMultiplayerEvent(event, handler, options = {}) {
    return eventBus.on(event, handler, options);
}

/** @param {string} event @param {(payload?: any) => void} handler */
export function offMultiplayerEvent(event, handler) {
    eventBus.off(event, handler);
}

/** @param {string} event @param {(payload?: any) => void} handler */
export function onceMultiplayerEvent(event, handler) {
    return eventBus.once(event, handler);
}
