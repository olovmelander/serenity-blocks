import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    createJoinState,
    isJoinDownloadActive,
    isJoinHandshakeComplete,
    JOIN_LIFECYCLE_EVENTS,
    JOIN_LIFECYCLE_STATES,
    JOIN_STATE_TRANSITION_EVENT,
    JoinLifecycleTransitionError,
    transitionFfaJoinState,
    transitionJoinState,
} from '../../src/core/multiplayer/ffa/join-lifecycle.js';

const S = JOIN_LIFECYCLE_STATES;
const E = JOIN_LIFECYCLE_EVENTS;

describe('FFA join lifecycle state machine', () => {
    it('starts peers at hello and session-owning hosts at live', () => {
        expect(createJoinState()).toBe(S.HELLO);
        expect(createJoinState({ isHost: false })).toBe(S.HELLO);
        expect(createJoinState({ isHost: true })).toBe(S.LIVE);
    });

    it('pins the complete admitted baseline path', () => {
        let state = createJoinState();
        state = transitionJoinState(state, E.WELCOME_ACCEPTED);
        expect(state).toBe(S.WELCOMED);
        state = transitionJoinState(state, E.DOWNLOAD_STARTED);
        expect(state).toBe(S.DOWNLOADING);
        state = transitionJoinState(state, E.APPLY_STARTED);
        expect(state).toBe(S.APPLYING);
        state = transitionJoinState(state, E.APPLY_SUCCEEDED);
        expect(state).toBe(S.LIVE);
    });

    it('allows a live recovery download without repeating admission', () => {
        let state = createJoinState({ isHost: true });
        state = transitionJoinState(state, E.DOWNLOAD_STARTED);
        state = transitionJoinState(state, E.APPLY_STARTED);
        state = transitionJoinState(state, E.APPLY_SUCCEEDED);

        expect(state).toBe(S.LIVE);
    });

    it('lets an already-known peer become live from the next accepted state frame', () => {
        expect(transitionJoinState(S.WELCOMED, E.LIVE_STATE_ACCEPTED)).toBe(S.LIVE);
    });

    it('returns an apply failure to downloading so retransmitted chunks can retry', () => {
        let state = S.DOWNLOADING;
        state = transitionJoinState(state, E.APPLY_STARTED);
        state = transitionJoinState(state, E.APPLY_FAILED);

        expect(state).toBe(S.DOWNLOADING);
        expect(isJoinDownloadActive(state)).toBe(true);
    });

    it.each([E.DOWNLOAD_TIMED_OUT, E.HOST_CHANGED])(
        'preserves the current fail-open behavior for %s',
        (event) => {
            expect(transitionJoinState(S.DOWNLOADING, event)).toBe(S.LIVE);
            expect(transitionJoinState(S.APPLYING, event)).toBe(S.LIVE);
        },
    );

    it('uses rejected as a terminal attempt state but permits an explicit retry', () => {
        let state = transitionJoinState(S.HELLO, E.REJECT);
        expect(state).toBe(S.REJECTED);
        expect(isJoinHandshakeComplete(state)).toBe(false);

        state = transitionJoinState(state, E.ANNOUNCE);
        expect(state).toBe(S.HELLO);
    });

    it('closes from every non-closed state and makes close idempotent', () => {
        Object.values(S).forEach((state) => {
            expect(transitionJoinState(state, E.CLOSE)).toBe(S.CLOSED);
        });
    });

    it.each([
        [S.HELLO, E.ANNOUNCE],
        [S.WELCOMED, E.WELCOME_ACCEPTED],
        [S.DOWNLOADING, E.DOWNLOAD_STARTED],
        [S.APPLYING, E.APPLY_STARTED],
        [S.LIVE, E.WELCOME_ACCEPTED],
        [S.LIVE, E.LIVE_STATE_ACCEPTED],
        [S.LIVE, E.HOST_CHANGED],
        [S.REJECTED, E.REJECT],
        [S.CLOSED, E.CLOSE],
    ])('deduplicates replayed %s + %s events', (state, event) => {
        const onNetEvent = vi.fn();

        expect(transitionJoinState(state, event, { onNetEvent })).toBe(state);
        expect(onNetEvent).not.toHaveBeenCalled();
    });

    it('emits one structured net event only when the state changes', () => {
        const onNetEvent = vi.fn();

        const state = transitionJoinState(S.WELCOMED, E.DOWNLOAD_STARTED, {
            details: { resyncId: 'R1', roundGeneration: 3 },
            onNetEvent,
        });

        expect(state).toBe(S.DOWNLOADING);
        expect(onNetEvent).toHaveBeenCalledOnce();
        expect(onNetEvent).toHaveBeenCalledWith(JOIN_STATE_TRANSITION_EVENT, {
            resyncId: 'R1',
            roundGeneration: 3,
            from: S.WELCOMED,
            to: S.DOWNLOADING,
            cause: E.DOWNLOAD_STARTED,
        });
    });

    it('rejects illegal transitions without emitting telemetry', () => {
        const onNetEvent = vi.fn();

        expect(() => transitionJoinState(S.HELLO, E.APPLY_STARTED, { onNetEvent }))
            .toThrow(JoinLifecycleTransitionError);
        expect(() => transitionJoinState(S.CLOSED, E.ANNOUNCE, { onNetEvent }))
            .toThrow('Illegal join lifecycle transition: closed + ANNOUNCE');
        expect(onNetEvent).not.toHaveBeenCalled();
    });

    it('derives the legacy handshake and download predicates from one state', () => {
        expect(Object.fromEntries(Object.values(S).map((state) => [
            state,
            {
                handshake: isJoinHandshakeComplete(state),
                download: isJoinDownloadActive(state),
            },
        ]))).toEqual({
            hello: { handshake: false, download: false },
            welcomed: { handshake: true, download: false },
            downloading: { handshake: true, download: true },
            applying: { handshake: true, download: true },
            live: { handshake: true, download: false },
            rejected: { handshake: false, download: false },
            closed: { handshake: false, download: false },
        });
    });

    it('updates an FFA owner and routes transitions through its net-event log', () => {
        const game = { isHost: false, _recordNetEvent: vi.fn() };

        expect(transitionFfaJoinState(game, E.WELCOME_ACCEPTED, { hostSteamId: 'HOST' }))
            .toBe(S.WELCOMED);
        expect(game.joinState).toBe(S.WELCOMED);
        expect(game._recordNetEvent).toHaveBeenCalledWith(JOIN_STATE_TRANSITION_EVENT, {
            hostSteamId: 'HOST',
            from: S.HELLO,
            to: S.WELCOMED,
            cause: E.WELCOME_ACCEPTED,
        });
    });
});
