/**
 * First Light (the opening and menu world): the closed-form motion and the composition rules,
 * checked on the CPU (src/ui/intro-world/intro-world-core.js).
 */
import { describe, expect, it } from 'vitest';
import {
    BREATH_IN,
    BREATH_PERIOD,
    GATHER,
    GATHER_SECONDS,
    MURMURATION,
    POSES,
    breathAt,
    breathIntegral,
    buildMoteSeeds,
    buildMurmurationSeeds,
    cameraPoseAt,
    gatherPhase,
    gatherSlot,
    halfHeightAt,
    murmurationAt,
    murmurationLine,
    openingState,
    riseClock,
} from '../../src/ui/intro-world/intro-world-core.js';

describe('the breath', () => {
    it('breathes in for four seconds and out for six, from rest to full and back', () => {
        expect(BREATH_IN).toBe(4);
        expect(BREATH_PERIOD).toBe(10);
        expect(breathAt(0)).toBeCloseTo(0, 6);
        expect(breathAt(4)).toBeCloseTo(1, 6);
        expect(breathAt(10)).toBeCloseTo(0, 6);
        expect(breathAt(2)).toBeCloseTo(0.5, 6);
        expect(breathAt(7)).toBeCloseTo(0.5, 6);
    });

    it('is smooth: no step anywhere in a long run', () => {
        let last = breathAt(0);
        for (let t = 0.01; t < 60; t += 0.01) {
            const b = breathAt(t);
            expect(b).toBeGreaterThanOrEqual(0);
            expect(b).toBeLessThanOrEqual(1);
            expect(Math.abs(b - last)).toBeLessThan(0.01);
            last = b;
        }
    });

    it('integrates exactly (the rise clock is a closed form, so a seek lands where playing would)', () => {
        let sum = 0;
        let prev = breathAt(0);
        const dt = 0.001;
        for (let i = 1; i <= 37000; i++) {
            const t = i * dt;
            const b = breathAt(t);
            sum += ((prev + b) / 2) * dt;
            prev = b;
            if (i % 4111 === 0) expect(breathIntegral(t)).toBeCloseTo(sum, 4);
        }
    });

    it('paces the rise faster on the in-breath, never backward', () => {
        let last = riseClock(0);
        for (let t = 0.05; t < 30; t += 0.05) {
            const r = riseClock(t);
            const pace = (r - last) / 0.05;
            expect(pace).toBeGreaterThan(0.7);
            expect(pace).toBeLessThan(1.3);
            last = r;
        }
        // The top of the in-breath (3–4 s) against the bottom of the out-breath (9–10 s).
        expect(riseClock(4) - riseClock(3)).toBeGreaterThan(riseClock(10) - riseClock(9));
    });
});

describe('the murmuration', () => {
    const seeds = buildMurmurationSeeds(4000);

    it('lays its motes out the same way every time, along it and across it', () => {
        expect(buildMurmurationSeeds(4000)).toEqual(seeds);
        for (let i = 0; i < 4000; i++) {
            expect(seeds[i * 4]).toBeGreaterThanOrEqual(0);
            expect(seeds[i * 4]).toBeLessThanOrEqual(1);
            expect(seeds[i * 4 + 2]).toBeGreaterThanOrEqual(0);
            expect(seeds[i * 4 + 2]).toBeLessThanOrEqual(1.5);
        }
    });

    it('is a closed form of time: the same moment always gives the same flock', () => {
        const a = murmurationAt({ time: 37.5, breath: 0.3 });
        const b = murmurationAt({ time: 37.5, breath: 0.3 });
        expect(a).toEqual(b);
        expect(murmurationAt({ time: 40 }).head).toBeGreaterThan(a.head);
    });

    it('flies round the title, never through it, for minutes on end', () => {
        const hh = halfHeightAt(MURMURATION.z);
        for (const aspect of [16 / 9, 21 / 9, 4 / 3]) {
            const hw = hh * aspect;
            for (let t = 0; t < 300; t += 0.9) {
                const m = murmurationAt({ time: t, breath: breathAt(t), aspect });
                for (let k = 0; k <= 20; k++) {
                    const [x, y] = murmurationLine(m, k / 20);
                    const inside = Math.abs(x) < 0.3 * hw && Math.abs(y) < 0.3 * hh;
                    expect(inside, `aspect ${aspect.toFixed(2)}, t=${t.toFixed(1)}, s=${k / 20}`).toBe(false);
                }
            }
        }
    });

    it('splits on the out-breath, never on the in-breath\'s top', () => {
        expect(murmurationAt({ time: 20, breath: 1 }).split).toBeCloseTo(0, 9);
        const open = Math.max(...Array.from({ length: 40 }, (_, i) => murmurationAt({ time: i, breath: 0 }).split));
        expect(open).toBeGreaterThan(0.6);
    });

    it('calms under reduced motion: no banking, no splitting, a shallow swing', () => {
        const calm = murmurationAt({ time: 33, breath: 0.2, motion: 0 });
        expect(calm.bank[2]).toBe(0);
        expect(calm.split).toBe(0);
        expect(calm.radii[2]).toBeLessThan(MURMURATION.zAmp * 0.5);
    });

    it('gathers into a ring that stands round the title, wider on a tall screen', () => {
        const hh = halfHeightAt(MURMURATION.z);
        const wide = murmurationAt({ time: 25, aspect: 16 / 9 });
        expect(wide.ring[2] - wide.ringTube).toBeGreaterThan(0.3 * hh * (16 / 9));
        expect(wide.ring[3] - wide.ringTube).toBeGreaterThan(0.3 * hh);
        const tall = murmurationAt({ time: 25, aspect: 0.46 });
        expect(tall.ring[2] / (hh * 0.56)).toBeGreaterThan(wide.ring[2] / (hh * (16 / 9)));
    });
});

describe('the opening and the camera', () => {
    it('moves from the frame under the loading screen to rest, never back', () => {
        const keys = ['travel', 'rise', 'unfurl', 'light', 'halo'];
        keys.forEach((k) => expect(openingState(0)[k]).toBeCloseTo(0, 6));
        const states = Array.from({ length: 101 }, (_, i) => openingState(i / 100));
        for (let i = 1; i < states.length; i++) {
            const [before, now] = [states[i - 1], states[i]];
            keys.forEach((k) => expect(now[k]).toBeGreaterThanOrEqual(before[k] - 1e-9));
        }
        keys.forEach((k) => expect(openingState(1)[k]).toBeCloseTo(1, 6));
        expect(openingState(1).waveFade).toBeCloseTo(0, 6);
    });

    it('starts low in the light and rests on the title pose', () => {
        const near = (a, b) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));
        const start = cameraPoseAt({ travel: 0, motion: 0, breath: 0.5 });
        near(start.pos, POSES.open.pos);
        const rest = cameraPoseAt({ travel: 1, motion: 0, breath: 0.5 });
        near(rest.pos, POSES.title.pos);
        expect(rest.fov).toBeCloseTo(POSES.title.fov, 9);
        const menu = cameraPoseAt({
            travel: 1, menu: 1, motion: 0, breath: 0.5,
        });
        near(menu.look, POSES.menu.look);
    });

    it('holds the eye still under reduced motion', () => {
        const a = cameraPoseAt({ time: 3, motion: 0, breath: 0.2 });
        const b = cameraPoseAt({ time: 40, motion: 0, breath: 0.9 });
        expect(a.pos).toEqual(b.pos);
    });
});

describe('the gathering', () => {
    it('comes on the breath: pours in, closes with a flash, holds, lets go', () => {
        expect(gatherPhase(0).join).toBeCloseTo(0, 6);
        expect(gatherPhase(GATHER.approach).join).toBeCloseTo(1, 6);
        expect(gatherPhase(GATHER.approach + GATHER.hold * 0.5).join).toBe(1);
        expect(gatherPhase(GATHER_SECONDS - 1e-6).join).toBeCloseTo(0, 4);
        expect(gatherPhase(1).flash).toBe(0);
        const closing = gatherPhase(GATHER.approach * 0.96 + 0.01).flash;
        expect(closing).toBeGreaterThan(0.6);
        expect(gatherPhase(GATHER.approach + 2).flash).toBeLessThan(closing * 0.1);
        // It starts with an in-breath, every third breath.
        expect((GATHER.first % 10) + (GATHER.every % 10)).toBe(0);
        expect(gatherSlot(GATHER.first - 0.1)).toBeNull();
        expect(gatherSlot(GATHER.first + 1)).toMatchObject({ k: 0 });
        expect(gatherSlot(GATHER.first + GATHER_SECONDS + 1)).toBeNull();
        expect(gatherSlot(GATHER.first + GATHER.every + 2)).toMatchObject({ k: 1 });
    });
});

describe('the motes', () => {
    it('are mostly far, a handful near the eye', () => {
        const seeds = buildMoteSeeds(2000);
        let near = 0;
        for (let i = 0; i < 2000; i++) if (seeds[i * 4 + 2] > 4) near += 1;
        expect(near).toBeGreaterThan(5);
        expect(near).toBeLessThan(60);
    });
});
