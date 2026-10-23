import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BOARD = readFileSync(path.join(ROOT, 'src/rendering/odyssey/OdysseyBoardController.js'), 'utf8');

describe('the corridor field clock', () => {
    it('gets every frame’s time, also the frames the settled-camera gate skips', () => {
        // Audit 2026-10-23: fed one frame's delta per throttled run, the corridor's drift ran at
        // ~20 % speed once the camera settled (orb close-ups, arrivals, reduced motion).
        const gate = BOARD.indexOf('if (runPositionWork) {');
        expect(gate).toBeGreaterThan(-1);
        const accumulate = BOARD.lastIndexOf('this._corridorPendingDelta = (this._corridorPendingDelta || 0) + delta;', gate);
        expect(accumulate).toBeGreaterThan(gate - 400);
        const block = BOARD.slice(gate, gate + 600);
        expect(block).toMatch(/const corridorDelta = Math\.min\(this\._corridorPendingDelta, 0\.25\);/);
        expect(block).toMatch(/this\._corridorPendingDelta = 0;/);
        expect(block).toMatch(/this\.corridorField\?\.update\(this\.camera, cameraProgress, corridorDelta\);/);
    });
});
