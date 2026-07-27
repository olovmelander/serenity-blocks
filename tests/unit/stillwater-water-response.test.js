import { describe, expect, it } from 'vitest';
import {
    createStillwaterWaterResponseState,
    STILLWATER_RESPONSE_CAPACITY,
    STILLWATER_RESPONSE_KIND,
} from '../../src/themes/stillwater/sim/stillwater-water-response.js';

describe('Stillwater Wave 3 water-response state', () => {
    it('preallocates the tier capacities and keeps every backing identity stable', () => {
        expect(STILLWATER_RESPONSE_CAPACITY).toEqual({ Low: 4, High: 10 });

        const responses = createStillwaterWaterResponseState({
            capacity: STILLWATER_RESPONSE_CAPACITY.High,
        });
        const { stateValues, shapeValues } = responses.bindings;
        const stateSlots = [...stateValues];
        const shapeSlots = [...shapeValues];

        for (let index = 0; index < 48; index += 1) {
            responses.triggerReaction('lock', {
                time: index * 0.5,
                x: (index % 7) - 3,
                z: -5 - (index % 9),
            });
        }
        responses.triggerReaction('tetris', { time: 30, x: 0, z: -10.5 });
        responses.triggerReaction('tspin', { time: 33, x: 2.2, z: -11.5 });

        expect(responses.bindings.stateValues).toBe(stateValues);
        expect(responses.bindings.shapeValues).toBe(shapeValues);
        expect(stateValues).toHaveLength(STILLWATER_RESPONSE_CAPACITY.High);
        expect(shapeValues).toHaveLength(STILLWATER_RESPONSE_CAPACITY.High);
        stateSlots.forEach((slot, index) => expect(stateValues[index]).toBe(slot));
        shapeSlots.forEach((slot, index) => expect(shapeValues[index]).toBe(slot));
        expect(responses.getActiveSlotCount(33.1)).toBeLessThanOrEqual(
            STILLWATER_RESPONSE_CAPACITY.High,
        );
        expect(responses.getActiveMode(33.1)).toBe(STILLWATER_RESPONSE_KIND.tspin);
    });

    it('routes a quiet lock into one routine slot and reuses the oldest slot deterministically', () => {
        const responses = createStillwaterWaterResponseState({ capacity: 4 });

        responses.triggerReaction('lock', { time: 0, x: -2, z: -6 });
        expect(responses.getSnapshot(0.1)).toMatchObject({
            activeSlots: 1,
            activeMode: STILLWATER_RESPONSE_KIND.lock,
            specialActive: false,
            triggeredLocks: 1,
            lastEvent: 'lock',
        });

        responses.triggerReaction('lock', { time: 0.1, x: -1, z: -7 });
        responses.triggerReaction('lock', { time: 0.2, x: 0, z: -8 });
        responses.triggerReaction('lock', { time: 0.3, x: 1, z: -9 });
        const snapshot = responses.getSnapshot(0.31);

        expect(snapshot.activeSlots).toBe(3);
        expect(snapshot.overwriteCount).toBe(1);
        expect(snapshot.routineCursor).toBe(2);
        expect(snapshot.packedState[1].slice(0, 4)).toEqual([
            1,
            -9,
            0.3,
            STILLWATER_RESPONSE_KIND.lock,
        ]);
    });

    it('gives Tetris and T-spin one reserved dominant special channel', () => {
        const responses = createStillwaterWaterResponseState({ capacity: 10 });
        responses.triggerReaction('lock', { time: 1, x: -3, z: -6 });
        responses.triggerReaction('tetris', { time: 1.2, x: 0, z: -10.5 });

        const tetris = responses.getSnapshot(1.3);
        expect(tetris).toMatchObject({
            activeSlots: 1,
            activeMode: STILLWATER_RESPONSE_KIND.tetris,
            specialActive: true,
            specialKind: STILLWATER_RESPONSE_KIND.tetris,
            triggeredTetrises: 1,
            lastEvent: 'tetris',
        });
        expect(responses.triggerReaction('lock', { time: 2, x: 1, z: -7 })).toBe(false);
        expect(responses.getSnapshot(2).suppressedLocks).toBe(1);

        responses.triggerReaction('tspin', { time: 4.1, x: 2.2, z: -11.5 });
        const tspin = responses.getSnapshot(4.2);
        expect(tspin.activeMode).toBe(STILLWATER_RESPONSE_KIND.tspin);
        expect(tspin.specialKind).toBe(STILLWATER_RESPONSE_KIND.tspin);
        expect(tspin.triggeredTspins).toBe(1);
        expect(tspin.packedState[0]).not.toEqual(tetris.packedState[0]);
    });

    it('keeps a four-slot Medium Tetris in one reserved special channel', () => {
        const responses = createStillwaterWaterResponseState({ capacity: 4 });
        expect(responses.triggerReaction('tetris', {
            time: 2,
            x: 0,
            z: -10.5,
        })).toBe(true);

        const snapshot = responses.getSnapshot(2.42);
        expect(snapshot).toMatchObject({
            capacity: 4,
            activeSlots: 1,
            activeMode: STILLWATER_RESPONSE_KIND.tetris,
            specialActive: true,
            specialKind: STILLWATER_RESPONSE_KIND.tetris,
        });
        expect(snapshot.packedState).toHaveLength(4);
        expect(responses.bindings.stateValues).toHaveLength(4);
        expect(responses.bindings.shapeValues).toHaveLength(4);
    });

    it('expires entirely in the shader timeline without per-frame state writes', () => {
        const responses = createStillwaterWaterResponseState({ capacity: 10 });
        responses.triggerReaction('lock', { time: 0.5, x: -3, z: -6 });
        const writesAfterTrigger = responses.getSnapshot(0.5).eventWrites;

        for (let frame = 0; frame < 600; frame += 1) {
            responses.getActiveSlotCount(0.5 + frame / 60);
        }

        const expired = responses.getSnapshot(12);
        expect(expired.activeSlots).toBe(0);
        expect(expired.activeMode).toBe(STILLWATER_RESPONSE_KIND.idle);
        expect(responses.getActiveMode(12)).toBe(STILLWATER_RESPONSE_KIND.idle);
        expect(expired.eventWrites).toBe(writesAfterTrigger);
        expired.packedState.flat().forEach((value) => expect(Number.isFinite(value)).toBe(true));
    });

    it('produces byte-equivalent packed state for the same deterministic sequence', () => {
        const run = () => {
            const responses = createStillwaterWaterResponseState({ capacity: 10 });
            responses.triggerReaction('lock', { time: 1, x: -2.5, z: -6.5 });
            responses.triggerReaction('lock', { time: 3, x: 1.5, z: -8.5 });
            responses.triggerReaction('tetris', { time: 5, x: 0, z: -10.5 });
            responses.triggerReaction('tspin', { time: 8, x: 2.2, z: -11.5 });
            return responses.getSnapshot(8.34).packedState;
        };

        expect(run()).toEqual(run());
    });

    it('rejects invalid capacities and unknown response names', () => {
        expect(() => createStillwaterWaterResponseState({ capacity: 3 })).toThrow(RangeError);
        expect(() => createStillwaterWaterResponseState({ capacity: 13 })).toThrow(RangeError);

        const responses = createStillwaterWaterResponseState();
        expect(() => responses.triggerReaction('perfect-clear')).toThrow(RangeError);
    });
});
