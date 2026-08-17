import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * REGRESSION GUARD (2026-08-17) — the post-reveal background render-warm sweep.
 *
 * Source assertions rather than a booted board, deliberately: constructing
 * OdysseyBoardController needs a WebGPU device, and what is worth pinning here is the sweep's
 * INPUT SET — which chapters it enqueues — not a rendering behaviour.
 *
 * The bug these guard against: `_startBackgroundRenderWarm` enumerated `1..total`
 * unconditionally. Under One World (the default) chapters 2-5 are suppressed and never
 * created, so the sweep sat in its "not created yet" branch for 30 x 300ms = 9s on EACH of
 * them — ~36s of dead waiting — and chapters 6-8 were never render-warmed before the player
 * scrolled into them. Measured: after 48s idle the sweep was still on chapter 2, and
 * `_bgRenderWarmComplete` never became true.
 *
 * The unit tests in odyssey-warmup-plan.test.js prove the ORDER BUILDER is correct. They
 * cannot detect the call site being reverted to an inline loop, which is exactly how the
 * original bug was written — hence these.
 */

const ROOT = path.resolve(
    path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
    '../../../..',
);
const BOARD = readFileSync(
    path.join(ROOT, 'src/rendering/odyssey/OdysseyBoardController.js'),
    'utf8',
);

function renderWarmSource() {
    // The DEFINITION, not the earlier `this._startBackgroundRenderWarm();` call site.
    const start = BOARD.indexOf('\n    _startBackgroundRenderWarm() {');
    expect(start, '_startBackgroundRenderWarm definition must exist').toBeGreaterThan(-1);
    const rest = BOARD.slice(start + 1);
    // Up to the next member at the same indentation level.
    const end = rest.search(/\n {4}(?:\/\*\*|_deferRenderWarm\()/);
    return end === -1 ? rest : rest.slice(0, end);
}

describe('background render-warm sweep never waits on chapters that cannot exist', () => {
    it('builds its order via buildRenderWarmOrder rather than an inline 1..total loop', () => {
        const source = renderWarmSource();
        expect(source).toMatch(/buildRenderWarmOrder\(/);
        // The exact shape of the original bug.
        expect(source).not.toMatch(/for\s*\(let ch = 1; ch <= total; ch \+= 1\)\s*order\.push\(ch\)/);
    });

    it('passes the suppressed chapter set into the order builder', () => {
        expect(renderWarmSource()).toMatch(/suppressed:\s*this\.environmentManager\?\.suppressedChapters/);
    });

    it('imports the shared builder instead of re-deriving the order locally', () => {
        expect(BOARD).toMatch(/buildRenderWarmOrder[\s\S]{0,120}from '\.\/odyssey-warmup-plan\.js'/);
    });

    // Head-of-line blocking is the property under test, NOT any particular retry count: the old
    // code `return`ed from these branches WITHOUT advancing idx, so it re-entered on the same
    // chapter and every chapter behind it waited. Rotating = advance idx AND re-queue. Asserting
    // the branch bodies keeps this honest when the grace windows are retuned.
    it('rotates a chapter that has not been CREATED yet, instead of sleeping in place', () => {
        const source = renderWarmSource();
        const branch = source.slice(
            source.indexOf('if (!env) {'),
            source.indexOf('if (!env.prewarmed)'),
        );
        expect(branch.length, 'missing-env branch must be found').toBeGreaterThan(0);
        expect(branch).toMatch(/idx \+= 1/);
        expect(branch).toMatch(/order\.push\(ch\)/);
    });

    it('rotates a chapter that has not COMPILED yet, instead of sleeping in place', () => {
        const source = renderWarmSource();
        const branch = source.slice(
            source.indexOf('if (!env.prewarmed)'),
            source.indexOf('if (!env._renderWarmed)'),
        );
        expect(branch.length, 'not-prewarmed branch must be found').toBeGreaterThan(0);
        expect(branch).toMatch(/idx \+= 1/);
        expect(branch).toMatch(/order\.push\(ch\)/);
    });

    // Warming a chapter whose compile has not landed costs ~490ms of SYNCHRONOUS pipeline
    // creation vs ~4ms once it has (measured 2026-08-17), so the wait must stay in place.
    it('does not warm a chapter before its compile has landed, except as a bounded last resort', () => {
        const source = renderWarmSource();
        expect(source).toMatch(/if \(!env\.prewarmed\)/);
        expect(source).toMatch(/still not prewarmed after grace window/);
    });

    it('still guarantees the sweep can COMPLETE — the adaptive controller gates on it', () => {
        const source = renderWarmSource();
        // Bounded rotations, and an empty order must short-circuit rather than spin.
        expect(source).toMatch(/_bgWarmMissWaits\[ch\] <= \d+/);
        expect(source).toMatch(/order\.length === 0[\s\S]{0,120}_bgRenderWarmComplete = true/);
    });
});

/**
 * REGRESSION GUARD (RC-8, 2026-08-17) — the background gate must ask "is the PLAYER scrolling?",
 * not "is the camera position static?".
 *
 * The journey auto-drifts by design, and the follow lerp trails that moving target by a CONSTANT
 * steady-state lag. Measured on an idle board with zero input for 25s:
 *   isAnimating false, |target - current| = 0.000885, cameraSettledThreshold = 0.0008
 * i.e. permanently 11% over the threshold, so `_isCameraSettled()` could never be true and every
 * background path (creation, prewarm, render-warm) was throttled all session — chapters compiled
 * and ready at 15.9s were not render-warmed until 44s.
 */
describe('background gate distinguishes player input from cinematic auto-drift', () => {
    it('gates background work on _isScrollIdle, not the positional settle test', () => {
        expect(BOARD).toMatch(/_isInteractionIdle\(\)\s*&&\s*this\._isScrollIdle\(\)/);
        // The exact shape of the bug: gating background work on the positional test.
        expect(BOARD).not.toMatch(/_isInteractionIdle\(\)\s*&&\s*this\._isCameraSettled\(\)/);
    });

    it('derives scroll-idle from the player-only input velocity', () => {
        const start = BOARD.indexOf('    _isScrollIdle() {');
        expect(start, '_isScrollIdle must exist').toBeGreaterThan(-1);
        const body = BOARD.slice(start, BOARD.indexOf('\n    }', start));
        // travelModel.inputVelocity excludes the auto-drift; |target - current| does not.
        expect(body).toMatch(/travelModel\?\.inputVelocity/);
        expect(body).toMatch(/scrollIdleThreshold/);
    });

    it('leaves the positional settle test in place for the 30Hz position-work throttle', () => {
        // Different question, different right answer — that consumer wants "position is static".
        // Phase A added a warm-scrub bypass in front (the scrub teleports the camera, reads as
        // trivially settled, and a throttled sample would skip the seam work it exists to warm),
        // but the positional test itself must stay the throttle's predicate.
        expect(BOARD).toMatch(
            /const settled = !this\._isWarmingUp && this\._isCameraSettled\(\) && !inSeam/,
        );
    });

    it('lets a sustained block eventually yield one pass, whatever the reason', () => {
        // The old code hard-returned false on the player-busy branch, so a hair-trigger predicate
        // could starve background work forever with no escape.
        const start = BOARD.indexOf('    _canRunBackgroundTask() {');
        const body = BOARD.slice(start, BOARD.indexOf('\n    }', start));
        expect(body).not.toMatch(/\)\) return false;/);
        expect(body).toMatch(/_bgGateBlockedSince/);
    });
});
