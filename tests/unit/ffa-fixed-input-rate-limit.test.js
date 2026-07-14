import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';
import { InputValidator } from '../../src/core/validation/input-validator.js';

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('FFA fixed-tick input rate policy', () => {
    it('retains the legacy browser-event ceiling outside fixed tick', () => {
        vi.useFakeTimers();
        vi.setSystemTime(100_000);
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const validator = new InputValidator();

        for (let index = 0; index < validator.MAX_INPUTS_PER_SECOND; index += 1) {
            const result = validator.validateInput('PEER', 'drop', { type: 'soft' }, Date.now());
            expect(result.valid).toBe(true);
        }
        const rejected = validator.validateInput('PEER', 'drop', { type: 'soft' }, Date.now());
        expect(rejected.valid).toBe(false);
    });

    it('does not wall-rate valid commands after the group progression brand', () => {
        vi.useFakeTimers();
        vi.setSystemTime(100_000);
        const validator = new InputValidator();

        for (let index = 0; index < 3000; index += 1) {
            expect(validator.validateInput(
                'PEER',
                'drop',
                { type: 'soft' },
                Date.now(),
                { fixedTick: true },
            ).valid).toBe(true);
        }
        expect(validator.inputCounts.has('PEER')).toBe(false);
    });

    it('opts remote traffic in only after canonical group validation', () => {
        const validateInput = vi.fn(() => ({ valid: false, reason: 'stop' }));
        const state = Object.assign(Object.create(FFAGameStateP2P.prototype), {
            isHost: true,
            _fixedTickEnabled: true,
            players: new Map([['PEER', { name: 'Peer', isAlive: true }]]),
            inputValidator: { validateInput },
            _recordNetEvent: vi.fn(),
        });
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        state.processPlayerInput('PEER', 'move', { direction: -1 }, 1234);

        expect(validateInput).toHaveBeenCalledWith(
            'PEER',
            'move',
            { direction: -1 },
            1234,
            { fixedTick: false },
        );

        state.processPlayerInput(
            'PEER',
            'move',
            { direction: -1 },
            1234,
            { fixedTickCanonical: true },
        );
        expect(validateInput).toHaveBeenLastCalledWith(
            'PEER',
            'move',
            { direction: -1 },
            1234,
            { fixedTick: true },
        );
    });
});
