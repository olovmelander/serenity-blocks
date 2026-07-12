import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    readFfaFixedTick,
    rollbackFixedTickOnPromotion,
    transitionFfaSimulationClock,
} from '../../src/core/multiplayer/ffa-fixed-tick-policy.js';

function setFlags(search = '') {
    vi.stubGlobal('window', {
        location: { search },
        localStorage: { getItem: () => null },
    });
}

describe('FFA fixed-tick policy', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it.each([
        ['', false],
        ['?simTickNetcode=1', true],
        ['?fixedTick=1', true],
        ['?simTickNetcode=1&fixedTick=0', false],
    ])('resolves %s to %s', (search, expected) => {
        setFlags(search);
        expect(readFfaFixedTick()).toBe(expected);
    });

    it('falls back on promotion and records why continuation is unsafe', () => {
        const recordEvent = vi.fn();

        expect(rollbackFixedTickOnPromotion(true, recordEvent)).toBe(false);
        expect(recordEvent).toHaveBeenCalledWith('fixed_tick_rollback', {
            reason: 'migration_missing_continuation',
        });
    });

    it('does not emit a rollback event when fixed tick was already disabled', () => {
        const recordEvent = vi.fn();

        expect(rollbackFixedTickOnPromotion(false, recordEvent)).toBe(false);
        expect(recordEvent).not.toHaveBeenCalled();
    });

    it('fails a fixed-clock transition closed when the jitter buffer is disabled', () => {
        const game = {
            _fixedTickEnabled: true,
            useJitterBuffer: false,
            matchConfig: { simulationClock: 'fixed60-v1' },
            _recordNetEvent: vi.fn(),
            localInputHooks: { reset: vi.fn() },
            loopCallbacksConfigured: false,
        };

        expect(transitionFfaSimulationClock(game, 'fixed60-v1')).toBe(true);
        expect(game._fixedTickEnabled).toBe(false);
        expect(game.matchConfig.simulationClock).toBe('legacy-variable-v1');
        expect(game._recordNetEvent).toHaveBeenCalledWith('fixed_tick_rollback', {
            reason: 'jitter_buffer_required',
        });
        expect(game.localInputHooks.reset).toHaveBeenCalledOnce();
    });
});
