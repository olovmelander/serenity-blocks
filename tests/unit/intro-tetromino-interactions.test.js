import { describe, expect, it } from 'vitest';
import {
    INTRO_TETROMINO_CLICK_IMPULSE,
    INTRO_TETROMINO_MAX_SPEED,
    computeImpulseAwayFromRay,
    clampVectorMagnitude,
    findClosestTetrominoRayHit,
} from '../../src/ui/intro-tetromino-interactions.js';

const O_TYPE = 1;

function createState(slotCount = 3) {
    return {
        positions: new Float32Array(slotCount * 4),
        velocities: new Float32Array(slotCount * 4),
        rotations: new Float32Array(slotCount * 4),
    };
}

function setTetromino(state, slot, {
    x = 0,
    y = 0,
    z = 0,
    active = 1,
    type = O_TYPE,
    rz = 0,
} = {}) {
    const i4 = slot * 4;
    state.positions[i4] = x;
    state.positions[i4 + 1] = y;
    state.positions[i4 + 2] = z;
    state.positions[i4 + 3] = active;
    state.velocities[i4 + 3] = type;
    state.rotations[i4 + 2] = rz;
}

describe('intro tetromino interactions', () => {
    const ray = {
        origin: { x: 0, y: 0, z: 10 },
        direction: { x: 0, y: 0, z: -1 },
    };

    it('hits an active tetromino slot under the pointer ray', () => {
        const state = createState();
        setTetromino(state, 0);

        const hit = findClosestTetrominoRayHit({ ray, ...state });

        expect(hit?.slot).toBe(0);
    });

    it('skips inactive tetromino slots', () => {
        const state = createState();
        setTetromino(state, 0, { active: 0 });

        const hit = findClosestTetrominoRayHit({ ray, ...state });

        expect(hit).toBeNull();
    });

    it('chooses the closest hit along the camera ray', () => {
        const state = createState();
        setTetromino(state, 0, { z: 0 });
        setTetromino(state, 1, { z: 4 });

        const hit = findClosestTetrominoRayHit({ ray, ...state });

        expect(hit?.slot).toBe(1);
    });

    it('misses when the ray is outside the picking tolerance', () => {
        const state = createState();
        setTetromino(state, 0, { x: 10 });

        const hit = findClosestTetrominoRayHit({ ray, ...state });

        expect(hit).toBeNull();
    });

    it('clamps impulse velocity to the intro tetromino speed cap', () => {
        const clamped = clampVectorMagnitude({ x: 1, y: 0, z: 0 }, INTRO_TETROMINO_MAX_SPEED);

        expect(clamped.x).toBeCloseTo(INTRO_TETROMINO_MAX_SPEED);
        expect(clamped.y).toBe(0);
        expect(clamped.z).toBe(0);
    });

    it('uses a finite fallback impulse when the tetromino center is on the ray', () => {
        const impulse = computeImpulseAwayFromRay(ray, { x: 0, y: 0, z: 0 });
        const magnitude = Math.hypot(impulse.x, impulse.y, impulse.z);

        expect(Number.isFinite(impulse.x)).toBe(true);
        expect(Number.isFinite(impulse.y)).toBe(true);
        expect(Number.isFinite(impulse.z)).toBe(true);
        expect(magnitude).toBeCloseTo(INTRO_TETROMINO_CLICK_IMPULSE);
        expect(impulse.z).toBeCloseTo(0);
    });
});
