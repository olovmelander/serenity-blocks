// @ts-check

/**
 * Peer join/resync lifecycle (remediation plan §6A.6).
 *
 * This state is deliberately narrower than the round barrier and player spawn
 * disposition. A live peer may re-enter the download/apply states for recovery
 * without becoming a newly admitted player again.
 */

export const JOIN_LIFECYCLE_STATES = Object.freeze({
    HELLO: 'hello',
    WELCOMED: 'welcomed',
    DOWNLOADING: 'downloading',
    APPLYING: 'applying',
    LIVE: 'live',
    REJECTED: 'rejected',
    CLOSED: 'closed',
});

export const JOIN_LIFECYCLE_EVENTS = Object.freeze({
    ANNOUNCE: 'ANNOUNCE',
    WELCOME_ACCEPTED: 'WELCOME_ACCEPTED',
    DOWNLOAD_STARTED: 'DOWNLOAD_STARTED',
    APPLY_STARTED: 'APPLY_STARTED',
    APPLY_SUCCEEDED: 'APPLY_SUCCEEDED',
    APPLY_FAILED: 'APPLY_FAILED',
    LIVE_STATE_ACCEPTED: 'LIVE_STATE_ACCEPTED',
    DOWNLOAD_TIMED_OUT: 'DOWNLOAD_TIMED_OUT',
    HOST_CHANGED: 'HOST_CHANGED',
    REJECT: 'REJECT',
    PROMOTE: 'PROMOTE',
    CLOSE: 'CLOSE',
});

export const JOIN_STATE_TRANSITION_EVENT = 'join_state_transition';

/** @typedef {'hello'|'welcomed'|'downloading'|'applying'|'live'|'rejected'|'closed'} JoinLifecycleState */
/** @typedef {'ANNOUNCE'|'WELCOME_ACCEPTED'|'DOWNLOAD_STARTED'|'APPLY_STARTED'|'APPLY_SUCCEEDED'|'APPLY_FAILED'|'LIVE_STATE_ACCEPTED'|'DOWNLOAD_TIMED_OUT'|'HOST_CHANGED'|'REJECT'|'PROMOTE'|'CLOSE'} JoinLifecycleEvent */

/** @type {Readonly<Record<JoinLifecycleState, Partial<Record<JoinLifecycleEvent, JoinLifecycleState>>>>} */
const TRANSITIONS = Object.freeze({
    [JOIN_LIFECYCLE_STATES.HELLO]: Object.freeze({
        [JOIN_LIFECYCLE_EVENTS.ANNOUNCE]: JOIN_LIFECYCLE_STATES.HELLO,
        [JOIN_LIFECYCLE_EVENTS.WELCOME_ACCEPTED]: JOIN_LIFECYCLE_STATES.WELCOMED,
        [JOIN_LIFECYCLE_EVENTS.REJECT]: JOIN_LIFECYCLE_STATES.REJECTED,
        [JOIN_LIFECYCLE_EVENTS.PROMOTE]: JOIN_LIFECYCLE_STATES.LIVE,
        [JOIN_LIFECYCLE_EVENTS.CLOSE]: JOIN_LIFECYCLE_STATES.CLOSED,
    }),
    [JOIN_LIFECYCLE_STATES.WELCOMED]: Object.freeze({
        [JOIN_LIFECYCLE_EVENTS.WELCOME_ACCEPTED]: JOIN_LIFECYCLE_STATES.WELCOMED,
        [JOIN_LIFECYCLE_EVENTS.DOWNLOAD_STARTED]: JOIN_LIFECYCLE_STATES.DOWNLOADING,
        [JOIN_LIFECYCLE_EVENTS.LIVE_STATE_ACCEPTED]: JOIN_LIFECYCLE_STATES.LIVE,
        [JOIN_LIFECYCLE_EVENTS.HOST_CHANGED]: JOIN_LIFECYCLE_STATES.LIVE,
        [JOIN_LIFECYCLE_EVENTS.REJECT]: JOIN_LIFECYCLE_STATES.REJECTED,
        [JOIN_LIFECYCLE_EVENTS.PROMOTE]: JOIN_LIFECYCLE_STATES.LIVE,
        [JOIN_LIFECYCLE_EVENTS.CLOSE]: JOIN_LIFECYCLE_STATES.CLOSED,
    }),
    [JOIN_LIFECYCLE_STATES.DOWNLOADING]: Object.freeze({
        [JOIN_LIFECYCLE_EVENTS.DOWNLOAD_STARTED]: JOIN_LIFECYCLE_STATES.DOWNLOADING,
        [JOIN_LIFECYCLE_EVENTS.APPLY_STARTED]: JOIN_LIFECYCLE_STATES.APPLYING,
        [JOIN_LIFECYCLE_EVENTS.DOWNLOAD_TIMED_OUT]: JOIN_LIFECYCLE_STATES.LIVE,
        [JOIN_LIFECYCLE_EVENTS.HOST_CHANGED]: JOIN_LIFECYCLE_STATES.LIVE,
        [JOIN_LIFECYCLE_EVENTS.REJECT]: JOIN_LIFECYCLE_STATES.REJECTED,
        [JOIN_LIFECYCLE_EVENTS.PROMOTE]: JOIN_LIFECYCLE_STATES.LIVE,
        [JOIN_LIFECYCLE_EVENTS.CLOSE]: JOIN_LIFECYCLE_STATES.CLOSED,
    }),
    [JOIN_LIFECYCLE_STATES.APPLYING]: Object.freeze({
        [JOIN_LIFECYCLE_EVENTS.APPLY_STARTED]: JOIN_LIFECYCLE_STATES.APPLYING,
        [JOIN_LIFECYCLE_EVENTS.APPLY_SUCCEEDED]: JOIN_LIFECYCLE_STATES.LIVE,
        [JOIN_LIFECYCLE_EVENTS.APPLY_FAILED]: JOIN_LIFECYCLE_STATES.DOWNLOADING,
        [JOIN_LIFECYCLE_EVENTS.DOWNLOAD_TIMED_OUT]: JOIN_LIFECYCLE_STATES.LIVE,
        [JOIN_LIFECYCLE_EVENTS.HOST_CHANGED]: JOIN_LIFECYCLE_STATES.LIVE,
        [JOIN_LIFECYCLE_EVENTS.REJECT]: JOIN_LIFECYCLE_STATES.REJECTED,
        [JOIN_LIFECYCLE_EVENTS.PROMOTE]: JOIN_LIFECYCLE_STATES.LIVE,
        [JOIN_LIFECYCLE_EVENTS.CLOSE]: JOIN_LIFECYCLE_STATES.CLOSED,
    }),
    [JOIN_LIFECYCLE_STATES.LIVE]: Object.freeze({
        [JOIN_LIFECYCLE_EVENTS.WELCOME_ACCEPTED]: JOIN_LIFECYCLE_STATES.LIVE,
        [JOIN_LIFECYCLE_EVENTS.DOWNLOAD_STARTED]: JOIN_LIFECYCLE_STATES.DOWNLOADING,
        [JOIN_LIFECYCLE_EVENTS.LIVE_STATE_ACCEPTED]: JOIN_LIFECYCLE_STATES.LIVE,
        [JOIN_LIFECYCLE_EVENTS.HOST_CHANGED]: JOIN_LIFECYCLE_STATES.LIVE,
        [JOIN_LIFECYCLE_EVENTS.REJECT]: JOIN_LIFECYCLE_STATES.REJECTED,
        [JOIN_LIFECYCLE_EVENTS.PROMOTE]: JOIN_LIFECYCLE_STATES.LIVE,
        [JOIN_LIFECYCLE_EVENTS.CLOSE]: JOIN_LIFECYCLE_STATES.CLOSED,
    }),
    [JOIN_LIFECYCLE_STATES.REJECTED]: Object.freeze({
        [JOIN_LIFECYCLE_EVENTS.ANNOUNCE]: JOIN_LIFECYCLE_STATES.HELLO,
        [JOIN_LIFECYCLE_EVENTS.REJECT]: JOIN_LIFECYCLE_STATES.REJECTED,
        [JOIN_LIFECYCLE_EVENTS.CLOSE]: JOIN_LIFECYCLE_STATES.CLOSED,
    }),
    [JOIN_LIFECYCLE_STATES.CLOSED]: Object.freeze({
        [JOIN_LIFECYCLE_EVENTS.CLOSE]: JOIN_LIFECYCLE_STATES.CLOSED,
    }),
});

export class JoinLifecycleTransitionError extends Error {
    /** @param {string} currentState @param {string} event */
    constructor(currentState, event) {
        super(`Illegal join lifecycle transition: ${currentState} + ${event}`);
        this.name = 'JoinLifecycleTransitionError';
        this.currentState = currentState;
        this.event = event;
    }
}

/**
 * Hosts are already admitted to the session they own; peers begin at HELLO.
 * @param {{isHost?: boolean}} [options]
 * @returns {JoinLifecycleState}
 */
export function createJoinState({ isHost = false } = {}) {
    return isHost ? JOIN_LIFECYCLE_STATES.LIVE : JOIN_LIFECYCLE_STATES.HELLO;
}

/**
 * Apply one explicit lifecycle event. Replayed events that target the current
 * state are idempotent and do not emit duplicate telemetry.
 *
 * @param {JoinLifecycleState} currentState
 * @param {JoinLifecycleEvent} event
 * @param {{
 *   details?: Record<string, unknown>,
 *   onNetEvent?: ((eventName: string, details: Record<string, unknown>) => void)|null,
 * }} [options]
 * @returns {JoinLifecycleState}
 */
export function transitionJoinState(currentState, event, {
    details = {},
    onNetEvent = null,
} = {}) {
    const nextState = TRANSITIONS[currentState]?.[event];
    if (!nextState) throw new JoinLifecycleTransitionError(currentState, event);
    if (nextState === currentState) return currentState;

    if (typeof onNetEvent === 'function') {
        onNetEvent(JOIN_STATE_TRANSITION_EVENT, {
            ...details,
            from: currentState,
            to: nextState,
            cause: event,
        });
    }
    return nextState;
}

/**
 * Apply a lifecycle event to an FFA owner while routing transition telemetry
 * through its existing bounded net-event log.
 * @param {Record<string, any>} game
 * @param {JoinLifecycleEvent} event
 * @param {Record<string, unknown>} [details]
 */
export function transitionFfaJoinState(game, event, details = {}) {
    const currentState = game.joinState ?? createJoinState({ isHost: game.isHost === true });
    game.joinState = transitionJoinState(currentState, event, {
        details,
        onNetEvent: typeof game._recordNetEvent === 'function'
            ? game._recordNetEvent.bind(game)
            : null,
    });
    return game.joinState;
}

/** @param {JoinLifecycleState} state */
export function isJoinHandshakeComplete(state) {
    return state === JOIN_LIFECYCLE_STATES.WELCOMED
        || state === JOIN_LIFECYCLE_STATES.DOWNLOADING
        || state === JOIN_LIFECYCLE_STATES.APPLYING
        || state === JOIN_LIFECYCLE_STATES.LIVE;
}

/** @param {JoinLifecycleState} state */
export function isJoinDownloadActive(state) {
    return state === JOIN_LIFECYCLE_STATES.DOWNLOADING
        || state === JOIN_LIFECYCLE_STATES.APPLYING;
}
