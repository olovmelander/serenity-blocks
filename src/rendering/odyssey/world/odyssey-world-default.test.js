import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * WAVE 3 — One World is the DEFAULT path, and the escape hatch is real.
 *
 * These are source assertions rather than a booted board, deliberately: constructing
 * OdysseyBoardController needs a WebGPU device, and the thing worth pinning here is a POLICY
 * (which path ships, and whether it can be turned off) rather than a rendering behaviour. The
 * behaviour is covered by the in-game captures; this catches the policy silently flipping back
 * — or, more likely, someone "simplifying" the tri-state flag into a plain truthy read and
 * quietly deleting the only way a user can get the legacy journey back.
 */

const ROOT = path.resolve(
    path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
    '../../../..',
);
const BOARD = readFileSync(
    path.join(ROOT, 'src/rendering/odyssey/OdysseyBoardController.js'),
    'utf8',
);

describe('One World ships by default', () => {
    it('does not gate itself behind an opt-in truthy flag read', () => {
        // The opt-in form. If this ever comes back, the rebuild has silently stopped shipping.
        expect(BOARD).not.toMatch(/oneWorldEnabled\s*=\s*options\.oneWorld === true\s*\|\|\s*readBooleanUrlFlag\('odysseyOneWorld'\)/);
        expect(BOARD).toMatch(/oneWorldEnabled/);
    });

    it('keeps an explicit off switch — ?odysseyOneWorld=0 and options.oneWorld === false', () => {
        expect(BOARD).toMatch(/oneWorldParam !== '0'/);
        expect(BOARD).toMatch(/options\.oneWorld !== false/);
    });

    it('suppresses exactly the chapters the world draws, and no others', () => {
        const match = BOARD.match(/const ONE_WORLD_CHAPTERS = \[([^\]]+)\]/);
        expect(match, 'ONE_WORLD_CHAPTERS must exist').toBeTruthy();
        const ids = match[1].split(',').map((t) => Number(t.trim()));
        // Act II is chapters 2-5. Ch1 (earth core) and Ch6+ (space onward) keep their own
        // environments — the world's height field does not describe them, so suppressing one
        // would leave a chapter with no ground at all rather than with the world's ground.
        expect(ids).toEqual([2, 3, 4, 5]);
    });

    it('still builds the world inside a try/catch that falls back to the dioramas', () => {
        // A throw in world construction must not take the whole board down now that this is
        // the default path — the legacy chapters are the fallback, and they only exist if
        // suppression is undone when the build fails.
        const idx = BOARD.indexOf('createOdysseyWorld(');
        expect(idx).toBeGreaterThan(-1);
        const before = BOARD.slice(Math.max(0, idx - 900), idx);
        expect(before).toMatch(/try\s*\{/);
        // REPLACED 2026-08-13 (same requirement, STRONGER assertion): this read
        // `BOARD.slice(idx, idx + 2200)` for both `catch` and the un-suppress, so adding a
        // comment to the option list could break it — and worse, a fixed window never
        // actually proved the reset was INSIDE the catch. Anchor on the catch itself.
        const catchIdx = BOARD.indexOf('catch', idx);
        expect(catchIdx).toBeGreaterThan(idx);
        const catchBlock = BOARD.slice(catchIdx, catchIdx + 800);
        expect(catchBlock).toMatch(/oneWorldEnabled = false/);
    });
});
