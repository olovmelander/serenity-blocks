// @ts-check
import { optimizedEventBus } from '../utils/event-optimizer.js';

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

export function emitMultiplayerEvent(event, payload) {
    optimizedEventBus.emit(event, payload);
}

export function onMultiplayerEvent(event, handler, options = {}) {
    optimizedEventBus.on(event, handler, options);
    return () => optimizedEventBus.off(event, handler);
}

export function offMultiplayerEvent(event, handler) {
    optimizedEventBus.off(event, handler);
}

export function onceMultiplayerEvent(event, handler) {
    optimizedEventBus.once(event, handler);
}
