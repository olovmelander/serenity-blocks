import {
    afterEach, describe, expect, it, vi,
} from 'vitest';

import WolfhourTheme from '../../src/themes/wolfhour/wolfhour-theme.js';

/**
 * Wolfhour's reactions build with play instead of popping and resetting: the true combo
 * escalates a chain, a weak clear after a strong one never cuts the moon's light, a long chain
 * wakes the night further than its first clear did, a perfect clear crowns the clear still playing
 * (never a second clear), and when the hands rest the night breathes back to calm.
 */
function createTheme(quality = 'High') {
    const theme = new WolfhourTheme();
    theme.activeQualityLevel = quality;
    vi.spyOn(theme, 'resolvePieceLockOrigin').mockReturnValue({ x: 300, y: 0, z: 100 });
    vi.spyOn(theme, 'resolveLineClearOrigin').mockReturnValue({ x: 320, y: 10, z: 100 });
    return theme;
}

/** Advance the theme's clock frame by frame to `until`, sampling the surge as the loop does. */
function runTo(theme, until, fps = 60) {
    while (theme.time < until - 1e-9) {
        theme.time = Math.min(until, theme.time + 1 / fps);
        theme.updateSurge();
        theme.updateLunarReaction();
    }
}

/** One clearing lock: a hard drop, the lock and its clear, as physics sends them in one tick. */
function clearingLock(theme, lines = 1) {
    theme.onHardDrop({});
    theme.onPieceLock({});
    theme.onLineClear({ lineCount: lines, clearedRows: [], cascadeCount: 1 });
}

const queued = (theme, type) => theme.reactiveQueue.filter((token) => token.type === type).length;

describe('Wolfhour surge', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('rings the moon harder for a clear than a lock, and harder again for a quad and a perfect clear', () => {
        const theme = createTheme();
        const strengths = [];
        const ring = vi.spyOn(theme, 'triggerLunarReaction');
        theme.onPieceLock({});
        strengths.push(ring.mock.calls.at(-1)[0].strength);
        for (const lines of [1, 2, 3, 4]) {
            theme.onPieceLock({});
            theme.onLineClear({ lineCount: lines });
            strengths.push(ring.mock.calls.at(-1)[0].strength);
            // Break the chain so each clear is its own first clear.
            theme.onPieceLock({});
        }
        theme.onPerfectClear({});
        strengths.push(ring.mock.calls.at(-1)[0].strength);
        for (let i = 1; i < strengths.length; i += 1) {
            expect(strengths[i]).toBeGreaterThan(strengths[i - 1]);
        }
    });

    it('never cuts the light when a single follows a quad: it only adds to what is lit', () => {
        // Two nights: one hears only the quad, the other the quad and a single 0.3 s later.
        const nights = [createTheme(), createTheme()];
        for (const theme of nights) {
            theme.moonNodeData = { uniforms: { uPulse: { value: 0 } } };
            theme.time = 10;
            clearingLock(theme, 4);
            runTo(theme, 10.3);
        }
        const [quadOnly, both] = nights;
        clearingLock(both, 1);
        for (let t = 10.3; t < 14; t += 0.05) {
            runTo(quadOnly, t);
            runTo(both, t);
            const moon = (theme) => theme.moonNodeData.uniforms.uPulse.value;
            expect(moon(both)).toBeGreaterThanOrEqual(moon(quadOnly) - 1e-9);
            expect(both.night.wake).toBeGreaterThanOrEqual(quadOnly.night.wake - 1e-9);
            expect(both.night.halo).toBeGreaterThanOrEqual(quadOnly.night.halo - 1e-9);
            expect(both.night.level).toBeGreaterThanOrEqual(quadOnly.night.level - 1e-9);
        }
    });

    it('counts the true combo across locks and escalates the chain step by step', () => {
        const theme = createTheme();
        const ring = vi.spyOn(theme, 'triggerLunarReaction');
        const strengths = [];
        theme.time = 5;
        for (let n = 0; n < 10; n += 1) {
            clearingLock(theme, 1);
            strengths.push(ring.mock.calls.at(-1)[0].strength);
            runTo(theme, theme.time + 0.64);
        }
        // Ten singles in a row are not ten identical singles: the moon rings louder down the chain,
        // shooting stars and rifts answer the steps past the second, and the fifth brings a meteor down.
        expect(theme.comboTrackers.get('local').combo).toBe(10);
        expect(strengths.at(-1)).toBeGreaterThan(strengths[0] + 0.2);
        expect(theme.chainProgressByPlayer.get('local')).toBe(10);
        expect(theme.reactiveMetrics.queueMaxDepth).toBeGreaterThan(0);
        // A lock that clears nothing ends the chain; the next clear starts over at one.
        theme.onPieceLock({});
        theme.onPieceLock({});
        theme.onLineClear({ lineCount: 1 });
        expect(theme.comboTrackers.get('local').combo).toBe(1);
        expect(theme.chainProgressByPlayer.get('local')).toBe(0);
    });

    it('queues the chain\'s rifts, shooting stars and meteor strike once per step', () => {
        const theme = createTheme();
        vi.spyOn(theme, 'processReactiveQueue').mockImplementation(() => {});
        theme.time = 5;
        for (let n = 0; n < 5; n += 1) clearingLock(theme, 1);
        // Same lock's later waves are depth, not combo: still one step per clearing lock.
        expect(theme.comboTrackers.get('local').combo).toBe(5);
        expect(queued(theme, 'rift')).toBeGreaterThanOrEqual(3);
        expect(queued(theme, 'meteor')).toBeGreaterThanOrEqual(3);
        expect(queued(theme, 'crash')).toBe(1);
        clearingLock(theme, 1);
        expect(queued(theme, 'crash')).toBe(1);
    });

    it('wakes the night further over a long chain than after its first clear, then breathes back', () => {
        const theme = createTheme();
        theme.time = 20;
        clearingLock(theme, 1);
        runTo(theme, 20.6);
        const first = { ...theme.night };
        for (let n = 1; n < 12; n += 1) {
            clearingLock(theme, (n % 3) + 1);
            runTo(theme, theme.time + 0.64);
        }
        const chain = { ...theme.night };
        expect(chain.level).toBeGreaterThan(first.level + 0.4);
        expect(chain.wake).toBeGreaterThan(first.wake + 0.4);
        expect(chain.halo).toBeGreaterThan(first.halo + 0.5);
        expect(chain.stars).toBeGreaterThan(first.stars);
        expect(chain.iris).toBeLessThan(first.iris);
        expect(chain.stage).toBe(3);
        // The hands rest: within a few seconds the night is back to calm.
        runTo(theme, theme.time + 12, 30);
        expect(theme.night.stage).toBe(0);
        expect(theme.night.halo).toBeLessThan(0.02);
        expect(theme.night.wake).toBeLessThan(0.1);
        expect(theme.night.iris).toBeCloseTo(1, 2);
    });

    it('makes a late perfect clear a crown over the clear still playing, never a second clear', () => {
        const theme = createTheme();
        vi.spyOn(theme, 'processReactiveQueue').mockImplementation(() => {});
        theme.time = 30;
        clearingLock(theme, 4);
        runTo(theme, 30.36);
        const beams = queued(theme, 'beam');
        const waves = queued(theme, 'wave');
        const haloBefore = theme.night.halo;
        theme.onPerfectClear({ depth: 4 });
        runTo(theme, 30.8);
        expect(queued(theme, 'beam')).toBe(beams);
        expect(queued(theme, 'wave')).toBe(waves);
        expect(queued(theme, 'meteor')).toBeGreaterThan(0);
        expect(theme.night.crown).toBeGreaterThan(0.5);
        expect(theme.night.halo).toBeGreaterThan(haloBefore + 0.3);
    });

    it('answers a zero-line T-spin and a back-to-back clear with something of their own', () => {
        const theme = createTheme();
        theme.time = 40;
        const ring = vi.spyOn(theme, 'triggerLunarReaction');
        theme.onTSpin({ lineCount: 0 });
        expect(ring).toHaveBeenCalledTimes(1);
        expect(queued(theme, 'starBurst')).toBe(1);
        runTo(theme, 40.2);
        expect(theme.night.wind).toBeGreaterThan(0);
        theme.onB2B({ active: true });
        // Two rings, the second a moment after the first.
        expect(ring).toHaveBeenCalledTimes(3);
        expect(ring.mock.calls.at(-1)[0].delay).toBeGreaterThan(0);
        theme.onB2B({ active: false });
        expect(ring).toHaveBeenCalledTimes(3);
    });

    it('lets the lowest tiers answer with fewer effects rather than none', () => {
        const theme = createTheme('Low');
        expect(theme.qualityPreset.maxCelestialBeams).toBeGreaterThan(0);
        theme.applyQualityPreset('Low');
        expect(theme.getReactivePoolCapacity('beam')).toBeGreaterThan(0);
        const spawned = [];
        vi.spyOn(theme, 'spawnReactiveToken').mockImplementation((token) => {
            spawned.push(token.type);
            return true;
        });
        theme.enqueueReactiveToken('meteor', { shower: true }, performance.now() - 1);
        theme.processReactiveQueue();
        expect(spawned).toEqual(['meteor']);
        expect(theme.reactiveMetrics.tokensDropped).toBe(0);
    });
});
