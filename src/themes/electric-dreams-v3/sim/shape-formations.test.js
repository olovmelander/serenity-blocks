import { describe, expect, it } from 'vitest';
import { generateShape, SHAPE_NAMES } from './shape-formations.js';

const NEW_SHAPES = Object.freeze([
    'lightning',
    'snowflake',
    'lotus',
    'crescent',
    'crystalShard',
    'mobius',
    'comet',
    'nautilus',
    'tetrominoSet',
]);

describe('Electric Dreams V3 shape formations', () => {
    it('registers the expanded formation set', () => {
        expect(SHAPE_NAMES).toEqual(expect.arrayContaining(NEW_SHAPES));
    });

    it('fills every new formation with finite active targets', () => {
        NEW_SHAPES.forEach((shapeName) => {
            const arr = new Float32Array(512 * 4);

            expect(generateShape(shapeName, arr, 512)).toBe(true);

            let activeCount = 0;
            let maxAbsPosition = 0;
            for (let i = 0; i < 512; i += 1) {
                const i4 = i * 4;
                expect(Number.isFinite(arr[i4])).toBe(true);
                expect(Number.isFinite(arr[i4 + 1])).toBe(true);
                expect(Number.isFinite(arr[i4 + 2])).toBe(true);
                expect(Number.isFinite(arr[i4 + 3])).toBe(true);
                expect(arr[i4 + 3]).toBeGreaterThan(0);
                expect(arr[i4 + 3]).toBeLessThanOrEqual(1);
                activeCount += arr[i4 + 3] > 0 ? 1 : 0;
                maxAbsPosition = Math.max(
                    maxAbsPosition,
                    Math.abs(arr[i4]),
                    Math.abs(arr[i4 + 1]),
                    Math.abs(arr[i4 + 2]),
                );
            }

            expect(activeCount).toBe(512);
            expect(maxAbsPosition).toBeGreaterThan(2);
        });
    });

    it('keeps the free formation as a zero-attraction release state', () => {
        const arr = new Float32Array(32 * 4).fill(1);

        expect(generateShape('free', arr, 32)).toBe(true);

        for (let i = 0; i < 32; i += 1) {
            expect(arr[i * 4 + 3]).toBe(0);
        }
    });

    it('spreads the tetromino set across a wide two-row formation', () => {
        const arr = new Float32Array(1024 * 4);

        expect(generateShape('tetrominoSet', arr, 1024)).toBe(true);

        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (let i = 0; i < 1024; i += 1) {
            const i4 = i * 4;
            minX = Math.min(minX, arr[i4]);
            maxX = Math.max(maxX, arr[i4]);
            minY = Math.min(minY, arr[i4 + 1]);
            maxY = Math.max(maxY, arr[i4 + 1]);
        }

        expect(maxX - minX).toBeGreaterThan(20);
        expect(maxY - minY).toBeGreaterThan(8);
    });
});
