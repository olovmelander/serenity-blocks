import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    ATTACK_LINES_AHEAD,
    ATTACK_REQUEST_BUCKET_CAPACITY,
    ATTACK_REQUEST_TICKS_PER_TOKEN,
    consumeAttackRequestToken,
    handleFfaAttackRequest,
    noteCopyClear,
    sanitizePeerCascadeSummary,
} from '../../src/core/multiplayer/ffa/attack-request.js';
import { calculateGarbage } from '../../src/core/garbage.js';
import { COLS, ROWS, HIDDEN_ROWS } from '../../src/core/constants.js';

const MAX_ROWS = ROWS + HIDDEN_ROWS;

function holeRow(column) {
    return Array.from({ length: COLS }, (_, x) => x === column);
}

/** The shape physics.js hands to onGarbageReady. */
function physicsSummary(overrides = {}) {
    return {
        totalLines: 4,
        depth: 4,
        comboStages: 1,
        complexity: 1,
        holeMask: [holeRow(3), holeRow(3), holeRow(7), holeRow(7)],
        manualColumns: [3],
        sendForPerfectClear: false,
        lockFootprint: [{ x: 3, y: 20 }, { x: 3, y: 21 }, { x: 3, y: 22 }, { x: 3, y: 23 }],
        sourceColor: '#00f0f0',
        sourcePiece: 'I',
        sequence: 12,
        ...overrides,
    };
}

function makeHost(overrides = {}) {
    return {
        isHost: true,
        gamePhase: 'playing',
        roundGeneration: 3,
        simTick: 100,
        players: new Map([
            ['PEER', { steamId: 'PEER', isAlive: true, gameState: { boardGrid: new Array(MAX_ROWS) } }],
            ['DEAD', { steamId: 'DEAD', isAlive: false, gameState: {} }],
        ]),
        attackRouter: { routeAttack: vi.fn() },
        _recordNetEvent: vi.fn(),
        ...overrides,
    };
}

function request(summary, extra = {}) {
    return { from: 'PEER', data: { cascadeSummary: summary, roundGeneration: 3, ...extra } };
}

describe('sanitizePeerCascadeSummary', () => {
    it('leaves a real cascade summary equivalent for the garbage calculation', () => {
        for (const summary of [
            physicsSummary(),
            physicsSummary({ depth: 2, totalLines: 2, holeMask: [holeRow(0), holeRow(9)] }),
            physicsSummary({ sendForPerfectClear: true }),
            physicsSummary({ holeMask: [[3], [3, 4], [7]], manualColumns: [3, 4] }),
        ]) {
            const result = sanitizePeerCascadeSummary(summary);
            expect(result.ok).toBe(true);
            expect(calculateGarbage(result.summary)).toEqual(calculateGarbage(summary));
        }
    });

    it('rejects a depth no board can produce', () => {
        for (const depth of [1e9, MAX_ROWS + 1, 0, -1, 2.5, NaN, Infinity, '4', null]) {
            expect(sanitizePeerCascadeSummary(physicsSummary({ depth, totalLines: depth })))
                .toEqual({ ok: false, reason: 'depth_out_of_range' });
        }
        expect(sanitizePeerCascadeSummary(physicsSummary({ depth: MAX_ROWS })).ok).toBe(true);
    });

    it('rejects non-object summaries and non-array hole masks', () => {
        for (const summary of [null, undefined, 4, 'x', [], true]) {
            expect(sanitizePeerCascadeSummary(summary)).toEqual({ ok: false, reason: 'malformed_summary' });
        }
        expect(sanitizePeerCascadeSummary(physicsSummary({ holeMask: { length: 1e9 } })))
            .toEqual({ ok: false, reason: 'malformed_hole_mask' });
    });

    it('never keeps more hole-mask rows than lines cleared, and nulls malformed rows', () => {
        const huge = Array.from({ length: 16000 }, () => holeRow(1));
        const result = sanitizePeerCascadeSummary(physicsSummary({ depth: 3, holeMask: huge }));
        expect(result.summary.holeMask).toHaveLength(3);

        const mixed = sanitizePeerCascadeSummary(physicsSummary({
            holeMask: [holeRow(2), 'boom', new Array(COLS + 1).fill(true), [0, COLS]],
        }));
        expect(mixed.summary.holeMask).toEqual([holeRow(2), null, null, null]);
    });

    it('rebuilds from a whitelist and bounds every remaining field', () => {
        const result = sanitizePeerCascadeSummary(physicsSummary({
            complexity: 1e12,
            comboStages: 1e12,
            manualColumns: [3, 3, -1, COLS, 4.5, 'x', 9],
            sendForPerfectClear: 'yes',
            sourceColor: 'red;background:url(//evil)',
            sourcePiece: 'constructor',
            sequence: Infinity,
            extra: 'x'.repeat(1000),
        }));

        expect(result.summary).toEqual({
            totalLines: 4,
            depth: 4,
            comboStages: MAX_ROWS,
            complexity: MAX_ROWS,
            holeMask: [holeRow(3), holeRow(3), holeRow(7), holeRow(7)],
            manualColumns: [3, 9],
            sendForPerfectClear: false,
            sourceColor: null,
            sourcePiece: null,
            sequence: undefined,
        });
    });
});

describe('consumeAttackRequestToken', () => {
    it('allows a burst, then refills on the host tick', () => {
        const buckets = new Map();
        for (let i = 0; i < ATTACK_REQUEST_BUCKET_CAPACITY; i++) {
            expect(consumeAttackRequestToken(buckets, 'P', 10)).toBe(true);
        }
        expect(consumeAttackRequestToken(buckets, 'P', 10)).toBe(false);
        expect(consumeAttackRequestToken(buckets, 'P', 10 + ATTACK_REQUEST_TICKS_PER_TOKEN - 1)).toBe(false);
        expect(consumeAttackRequestToken(buckets, 'P', 10 + ATTACK_REQUEST_TICKS_PER_TOKEN)).toBe(true);
        expect(consumeAttackRequestToken(buckets, 'P', 10 + ATTACK_REQUEST_TICKS_PER_TOKEN)).toBe(false);
        // Another player has their own bucket.
        expect(consumeAttackRequestToken(buckets, 'Q', 10)).toBe(true);
    });

    it('refills instead of freezing when the tick restarts', () => {
        const buckets = new Map();
        for (let i = 0; i < ATTACK_REQUEST_BUCKET_CAPACITY; i++) consumeAttackRequestToken(buckets, 'P', 5000);
        expect(consumeAttackRequestToken(buckets, 'P', 5000)).toBe(false);
        expect(consumeAttackRequestToken(buckets, 'P', 0)).toBe(true);
    });
});

describe('handleFfaAttackRequest', () => {
    it('routes a real attack with the sanitized summary', () => {
        const game = makeHost();

        expect(handleFfaAttackRequest(game, request(physicsSummary()))).toBe(true);

        expect(game.attackRouter.routeAttack).toHaveBeenCalledTimes(1);
        const [attacker, summary] = game.attackRouter.routeAttack.mock.calls[0];
        expect(attacker).toBe('PEER');
        expect(summary).not.toHaveProperty('lockFootprint');
        expect(calculateGarbage(summary)).toEqual(calculateGarbage(physicsSummary()));
        expect(game._recordNetEvent).toHaveBeenCalledWith('attack_request', {
            attackerSteamId: 'PEER',
            cascadeSummary: summary,
        });
    });

    it('drops the one-packet host hang without touching the router', () => {
        const game = makeHost();
        const started = performance.now();

        expect(handleFfaAttackRequest(game, request({ depth: 1e9, sendForPerfectClear: true }))).toBe(false);

        expect(performance.now() - started).toBeLessThan(250);
        expect(game.attackRouter.routeAttack).not.toHaveBeenCalled();
        expect(game._attackRequestDrops).toBe(1);
        expect(game._recordNetEvent).toHaveBeenCalledWith('attack_request_rejected', {
            attackerSteamId: 'PEER',
            reason: 'depth_out_of_range',
        });
    });

    it('fences requests to the live round and phase', () => {
        const stale = makeHost();
        expect(handleFfaAttackRequest(stale, request(physicsSummary(), { roundGeneration: 2 }))).toBe(false);
        expect(stale._recordNetEvent).toHaveBeenCalledWith('attack_request_rejected', {
            attackerSteamId: 'PEER',
            reason: 'stale_round',
        });

        for (const gamePhase of ['waiting', 'finished']) {
            const game = makeHost({ gamePhase });
            expect(handleFfaAttackRequest(game, request(physicsSummary()))).toBe(false);
            expect(game.attackRouter.routeAttack).not.toHaveBeenCalled();
        }

        // A peer on an older build sends no round id; the phase fence still applies.
        const legacy = makeHost();
        expect(handleFfaAttackRequest(legacy, { from: 'PEER', data: { cascadeSummary: physicsSummary() } }))
            .toBe(true);
    });

    it('ignores dead or unknown attackers without spending their budget', () => {
        const game = makeHost();

        expect(handleFfaAttackRequest(game, { ...request(physicsSummary()), from: 'DEAD' })).toBe(false);
        expect(handleFfaAttackRequest(game, { ...request(physicsSummary()), from: 'STRANGER' })).toBe(false);

        expect(game.attackRouter.routeAttack).not.toHaveBeenCalled();
        expect(game._attackRequestBuckets).toBeUndefined();
    });

    it('rate-limits a flooding peer until the host tick advances', () => {
        const game = makeHost();
        // The host's copy made every clear, so only the rate limit can refuse them.
        noteCopyClear(game, 'PEER', { totalLines: 4 * (ATTACK_REQUEST_BUCKET_CAPACITY + 1) });

        for (let i = 0; i < ATTACK_REQUEST_BUCKET_CAPACITY; i++) {
            expect(handleFfaAttackRequest(game, request(physicsSummary()))).toBe(true);
        }
        expect(handleFfaAttackRequest(game, request(physicsSummary()))).toBe(false);
        expect(game._recordNetEvent).toHaveBeenLastCalledWith('attack_request_rejected', {
            attackerSteamId: 'PEER',
            reason: 'rate_limited',
        });

        game.simTick += ATTACK_REQUEST_TICKS_PER_TOKEN;
        expect(handleFfaAttackRequest(game, request(physicsSummary()))).toBe(true);
        expect(game.attackRouter.routeAttack).toHaveBeenCalledTimes(ATTACK_REQUEST_BUCKET_CAPACITY + 1);
    });

    it('is inert on a peer and logs — but never routes — under authoritative attacks', () => {
        const peer = makeHost({ isHost: false });
        expect(handleFfaAttackRequest(peer, request(physicsSummary()))).toBe(false);
        expect(peer._recordNetEvent).not.toHaveBeenCalled();

        const authoritative = makeHost({ _authoritativeAttacksEnabled: true });
        expect(handleFfaAttackRequest(authoritative, request(physicsSummary()))).toBe(false);
        expect(authoritative.attackRouter.routeAttack).not.toHaveBeenCalled();
        expect(authoritative._recordNetEvent).toHaveBeenCalledWith('attack_request_ignored', expect.objectContaining({
            attackerSteamId: 'PEER',
            reason: 'authoritative_attacks',
        }));
    });

    it('tolerates malformed envelopes', () => {
        const game = makeHost();
        for (const msg of [undefined, {}, { from: 'PEER' }, { from: 'PEER', data: 7 }, { from: 'PEER', data: {} }]) {
            expect(handleFfaAttackRequest(game, msg)).toBe(false);
        }
        expect(game.attackRouter.routeAttack).not.toHaveBeenCalled();
    });
});

describe('reports checked against the host\'s copy of the board', () => {
    it('lets reports run a little ahead of the copy, and no further', () => {
        const game = makeHost();
        // Two quads before the copy has made either: the copy waits for the peer's inputs.
        expect(handleFfaAttackRequest(game, request(physicsSummary()))).toBe(true);
        expect(handleFfaAttackRequest(game, request(physicsSummary()))).toBe(true);
        expect(ATTACK_LINES_AHEAD).toBe(8);
        // A third the copy never made is refused...
        expect(handleFfaAttackRequest(game, request(physicsSummary()))).toBe(false);
        expect(game._recordNetEvent).toHaveBeenLastCalledWith('attack_request_rejected', {
            attackerSteamId: 'PEER',
            reason: 'implausible_attack',
        });
        // ...until the copy catches up.
        noteCopyClear(game, 'PEER', { totalLines: 8 });
        expect(handleFfaAttackRequest(game, request(physicsSummary()))).toBe(true);
        expect(game.attackRouter.routeAttack).toHaveBeenCalledTimes(3);
    });

    it('starts each round\'s count afresh', () => {
        const game = makeHost();
        handleFfaAttackRequest(game, request(physicsSummary()));
        handleFfaAttackRequest(game, request(physicsSummary()));
        game.roundGeneration += 1;
        expect(handleFfaAttackRequest(game, request(physicsSummary(), { roundGeneration: 4 }))).toBe(true);
    });

    it('keeps a perfect-clear bonus only when the copy is near empty', () => {
        const full = (rows) => Array.from({ length: MAX_ROWS }, (_, y) => (
            y >= MAX_ROWS - rows ? Array.from({ length: COLS }, () => ({ type: 'I' })) : Array(COLS).fill(null)
        ));
        const game = makeHost();
        game.players.get('PEER').gameState.boardGrid = full(4); // the four rows being cleared
        handleFfaAttackRequest(game, request(physicsSummary({ sendForPerfectClear: true })));
        expect(game.attackRouter.routeAttack.mock.calls[0][1].sendForPerfectClear).toBe(true);

        game.players.get('PEER').gameState.boardGrid = full(12);
        noteCopyClear(game, 'PEER', { totalLines: 8 });
        handleFfaAttackRequest(game, request(physicsSummary({ sendForPerfectClear: true })));
        expect(game.attackRouter.routeAttack.mock.calls[1][1].sendForPerfectClear).toBe(false);
    });
});
