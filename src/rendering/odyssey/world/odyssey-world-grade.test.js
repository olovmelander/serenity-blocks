/**
 * THE OUTPUT CONTRACT HAS ONE SOURCE.
 *
 * `odyssey-world-grade.js` exists so the board and the cloud playground rig grade the world
 * identically BY CONSTRUCTION. A value-agreement test cannot defend that: if someone re-inlines
 * `outputScale: 0.82` in the board, every "do the numbers match?" assertion still passes while
 * the contract quietly forks again (this repo has the same failure written up four times over in
 * odyssey-world-height.js). So these tests assert the STRUCTURE — that the board imports the
 * constants and does not carry its own copies of the literals.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
    ONE_WORLD_APPLY_EXPOSURE,
    ONE_WORLD_OUTPUT_SCALE,
    ONE_WORLD_OUTPUT_SATURATION,
    ONE_WORLD_SKY_RADIUS,
} from './odyssey-world-grade.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOARD = path.join(HERE, '..', 'OdysseyBoardController.js');
const boardSource = readFileSync(BOARD, 'utf8');

describe('One World output contract', () => {
    it('exports the values the board and playground both grade against', () => {
        // Pinned so a silent re-tune has to be a deliberate edit to THIS line, and so the
        // rationale in the module header stays attached to a number someone can find.
        expect(ONE_WORLD_OUTPUT_SCALE).toBe(0.82);
        expect(ONE_WORLD_OUTPUT_SATURATION).toBe(0.72);
        expect(ONE_WORLD_SKY_RADIUS).toBe(3600);
        // The post stack owns exposure; the world applying it too would double-expose.
        expect(ONE_WORLD_APPLY_EXPOSURE).toBe(false);
    });

    it('is IMPORTED by the board, not re-declared there', () => {
        expect(boardSource).toMatch(/from\s+'\.\/world\/odyssey-world-grade\.js'/);
        // The whole point of the module: the board must not own these names again.
        expect(boardSource).not.toMatch(/const\s+ONE_WORLD_OUTPUT_SCALE\s*=/);
        expect(boardSource).not.toMatch(/const\s+ONE_WORLD_OUTPUT_SATURATION\s*=/);
        expect(boardSource).not.toMatch(/const\s+ONE_WORLD_SKY_RADIUS\s*=/);
    });

    it('passes the constants to the world instead of re-inlined literals', () => {
        expect(boardSource).toMatch(/outputScale:\s*ONE_WORLD_OUTPUT_SCALE/);
        expect(boardSource).toMatch(/outputSaturation:\s*ONE_WORLD_OUTPUT_SATURATION/);
        expect(boardSource).toMatch(/skyRadius:\s*ONE_WORLD_SKY_RADIUS/);
        expect(boardSource).toMatch(/applyExposure:\s*ONE_WORLD_APPLY_EXPOSURE/);
        // A re-inlined literal is the actual regression this file is here to catch.
        expect(boardSource).not.toMatch(/outputScale:\s*[\d.]/);
        expect(boardSource).not.toMatch(/outputSaturation:\s*[\d.]/);
        expect(boardSource).not.toMatch(/applyExposure:\s*(true|false)/);
    });
});
