/**
 * First Light (the opening and menu world): the closed-form motion and the composition rules,
 * checked on the CPU (src/ui/intro-world/intro-world-core.js).
 */
import { describe, expect, it } from 'vitest';
import {
    BREATH_IN,
    BREATH_PERIOD,
    PIECE_CELLS,
    PIECE_COLORS,
    PIECE_KEYS,
    POSES,
    STACK,
    STACK_FITS,
    STACK_SECONDS,
    axisAngle,
    chooseStackPair,
    qMul,
    qRotate,
    qSlerp,
    stackPhase,
    stackSlot,
    breathAt,
    breathIntegral,
    buildMoteSeeds,
    buildPieceField,
    cameraPoseAt,
    halfHeightAt,
    openingState,
    pieceAt,
    presenceAt,
    riseClock,
    srgbToLinear,
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

describe('the pieces', () => {
    const lanes = buildPieceField({ count: 21, seed: 7 });

    it('are laid out the same way every time, every shape among them', () => {
        expect(buildPieceField({ count: 21, seed: 7 })).toEqual(lanes);
        expect(lanes).toHaveLength(21);
        expect(new Set(lanes.map((l) => l.shape)).size).toBe(PIECE_KEYS.length);
    });

    it('wear the logo\'s spectrum and never the familiar Guideline hue of their shape (0/7)', () => {
        expect(Object.keys(PIECE_COLORS).sort()).toEqual([...PIECE_KEYS].sort());
        // scripts/palette-guideline-check.mjs screens sRGB hues against these bands.
        const hue = (hex) => {
            const n = Number.parseInt(hex.slice(1), 16);
            const r = ((n >> 16) & 255) / 255;
            const g = ((n >> 8) & 255) / 255;
            const b = (n & 255) / 255;
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            let h;
            if (max === r) h = ((g - b) / (max - min)) % 6;
            else if (max === g) h = (b - r) / (max - min) + 2;
            else h = (r - g) / (max - min) + 4;
            return (h * 60 + 360) % 360;
        };
        const bands = {
            I: [[160, 210]],
            O: [[32, 75]],
            T: [[245, 315]],
            S: [[90, 170]],
            Z: [[320, 360], [0, 20]],
            J: [[200, 250]],
            L: [[20, 50]],
        };
        const inBand = (k) => bands[k].some(([lo, hi]) => hue(PIECE_COLORS[k]) >= lo && hue(PIECE_COLORS[k]) <= hi);
        const matched = PIECE_KEYS.filter(inBand);
        expect(matched).toEqual([]);
        // Pale and luminous, as the wordmark is: every colour is light.
        PIECE_KEYS.forEach((k) => expect(Math.max(...srgbToLinear(PIECE_COLORS[k]))).toBeGreaterThan(0.6));
    });

    it('rise on either side of the title, never through its column', () => {
        for (const lane of lanes) {
            const hw = halfHeightAt(lane.z) * (16 / 9);
            const least = lane.band === 'far' ? 0.27 : 0.4;
            for (let t = 0; t < 120; t += 0.7) {
                const p = pieceAt(lane, { rise: riseClock(t), time: t, aspect: 16 / 9 });
                expect(Math.abs(p.x) / hw, `${lane.band} lane at t=${t}`).toBeGreaterThan(least);
            }
        }
    });

    it('rise through the whole frame and the margin beyond it, so none pops in or out', () => {
        const lane = lanes[0];
        const hh = halfHeightAt(lane.z);
        let wraps = 0;
        let last = null;
        for (let t = 0; t < 400; t += 0.05) {
            const p = pieceAt(lane, { rise: riseClock(t), time: t, aspect: 16 / 9 });
            expect(p.y).toBeGreaterThanOrEqual(-hh - lane.scale * 2.4 - 3 - 1e-6);
            expect(p.y).toBeLessThanOrEqual(hh + lane.scale * 2.4 + 3 + 1e-6);
            if (last !== null && p.y < last - 1) {
                wraps += 1;
                // It leaves above the frame and comes back below it.
                expect(last).toBeGreaterThan(hh + lane.scale);
                expect(p.y).toBeLessThan(-hh - lane.scale);
            }
            last = p.y;
        }
        expect(wraps).toBeGreaterThan(0);
    });

    it('turn with unit quaternions', () => {
        const p = pieceAt(lanes[3], { rise: 3, time: 17, aspect: 1.5 });
        expect(Math.hypot(...p.q)).toBeCloseTo(1, 6);
    });

    it('draw a near piece smaller on a tall screen', () => {
        const near = lanes.find((l) => l.band === 'near');
        const wide = pieceAt(near, { rise: 0, time: 0, aspect: 16 / 9 });
        const tall = pieceAt(near, { rise: 0, time: 0, aspect: 0.46 });
        expect(tall.scale).toBeLessThan(wide.scale);
    });
});

describe('quiet zones', () => {
    const nav = {
        x0: 0.05, y0: 0.3, x1: 0.3, y1: 0.8,
    };

    it('take a piece away inside a rect and leave it alone well clear of it', () => {
        // NDC (x right, y up) of the rect's middle: x = 0.175 → -0.65, y = 0.55 → -0.1.
        expect(presenceAt(-0.65, -0.1, 0.02, [nav])).toBe(0);
        expect(presenceAt(0.6, 0.6, 0.02, [nav])).toBe(1);
        expect(presenceAt(0, 0, 0.02, [])).toBe(1);
    });

    it('fade it at the rect\'s edge, not at a line', () => {
        const values = [];
        for (let x = -0.3; x <= 0.1; x += 0.02) values.push(presenceAt(x, -0.1, 0.02, [nav]));
        expect(values.some((v) => v > 0.05 && v < 0.95)).toBe(true);
        for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1] - 1e-9);
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

describe('the stack', () => {
    it('locks every twin pair into one rectangle with no gap and no overlap', () => {
        for (const [key, fit] of Object.entries(STACK_FITS)) {
            const cells = PIECE_CELLS[key];
            const c = Math.cos(fit.turn);
            const s = Math.sin(fit.turn);
            const turn = (x, y) => [x * c - y * s, x * s + y * c];
            const all = [];
            for (let i = 0; i < 8; i += 2) all.push([cells[i], cells[i + 1]]);
            for (let i = 0; i < 8; i += 2) {
                const [x, y] = turn(cells[i], cells[i + 1]);
                all.push([x + fit.offset[0], y + fit.offset[1]]);
            }
            const keys = new Set(all.map(([x, y]) => `${Math.round(x * 2)},${Math.round(y * 2)}`));
            expect(keys.size, `${key}: overlap`).toBe(8);
            const xs = all.map(([x]) => x);
            const ys = all.map(([, y]) => y);
            const w = Math.round(Math.max(...xs) - Math.min(...xs)) + 1;
            const h = Math.round(Math.max(...ys) - Math.min(...ys)) + 1;
            expect(w * h, `${key}: ${w} x ${h}`).toBe(8);
        }
    });

    it('comes on the breath: glides together, locks with a flash, holds, lets go', () => {
        expect(stackPhase(0).join).toBeCloseTo(0, 6);
        expect(stackPhase(STACK.approach).join).toBeCloseTo(1, 6);
        expect(stackPhase(STACK.approach + STACK.hold * 0.5).join).toBe(1);
        expect(stackPhase(STACK_SECONDS - 1e-6).join).toBeCloseTo(0, 4);
        expect(stackPhase(1).flash).toBe(0);
        const lockFlash = stackPhase(STACK.approach * 0.96 + 0.01).flash;
        expect(lockFlash).toBeGreaterThan(0.6);
        expect(stackPhase(STACK.approach + 2).flash).toBeLessThan(lockFlash * 0.1);
        // It starts with an in-breath.
        expect((STACK.first % 10) + (STACK.every % 10)).toBe(0);
        expect(stackSlot(STACK.first - 0.1)).toBeNull();
        expect(stackSlot(STACK.first + 1)).toMatchObject({ k: 0 });
        expect(stackSlot(STACK.first + STACK_SECONDS + 1)).toBeNull();
        expect(stackSlot(STACK.first + STACK.every + 2)).toMatchObject({ k: 1 });
    });

    it('finds a pair of twins for most stacks, on the side it is asked for', () => {
        const lanes = buildPieceField({ count: 21, seed: 7 });
        let found = 0;
        for (let k = 0; k < 24; k++) {
            const start = STACK.first + k * STACK.every;
            const side = k % 2 === 0 ? 1 : -1;
            const pair = chooseStackPair(lanes, { start, aspect: 16 / 9, side });
            if (!pair) continue;
            found += 1;
            const a = lanes[pair.anchor];
            const b = lanes[pair.partner];
            expect(a.shape).toBe(b.shape);
            expect(Math.sign(a.sx)).toBe(side);
            expect(Math.sign(b.sx)).toBe(side);
            expect(STACK_FITS[PIECE_KEYS[a.shape]]).toBeDefined();
        }
        expect(found).toBeGreaterThanOrEqual(12);
    });

    it('turns with quaternions that compose and slerp to unit length', () => {
        const q = qMul(axisAngle([0, 1, 0], 0.4), axisAngle([1, 0, 0], -0.2));
        expect(Math.hypot(...q)).toBeCloseTo(1, 9);
        const half = qSlerp([0, 0, 0, 1], axisAngle([0, 0, 1], Math.PI / 2), 0.5);
        const v = qRotate(half, [1, 0, 0]);
        expect(v[0]).toBeCloseTo(Math.SQRT1_2, 6);
        expect(v[1]).toBeCloseTo(Math.SQRT1_2, 6);
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
