import { describe, expect, it } from 'vitest';

import {
    OCEAN_BED_LIGHT, OCEAN_CLOCK, OCEAN_WELL, OCEAN_ZONES, applyOceanClock, createOceanClock, createOceanLook,
    oceanBedLight, oceanClockAt, oceanDepthLook, oceanHazeColour,
} from './odyssey-ocean-depth.js';
import {
    OCEAN_SUN_RAYS, SNELL_WINDOW, snellWindowPresence, snellWindowRimCos, sunRaysPresence,
} from './odyssey-ocean-window.js';

const luma = ([r, g, b]) => (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
const COLOURS = ['shallow', 'mid', 'deep', 'luminous'];
const SCALARS = ['dim', 'well', 'shafts', 'glow', 'caustics', 'beams', 'overhead'];

describe('the depth arc: four waters, one climb', () => {
    it('names four zones, shallowest first, each a complete look', () => {
        expect(OCEAN_ZONES.map((z) => z.name)).toEqual(['shallows', 'sunlit', 'twilight', 'abyss']);
        OCEAN_ZONES.forEach((z, i) => {
            if (i > 0) expect(z.depth).toBeGreaterThan(OCEAN_ZONES[i - 1].depth);
            COLOURS.forEach((k) => {
                expect(z[k]).toHaveLength(3);
                z[k].forEach((c) => {
                    expect(c).toBeGreaterThanOrEqual(0);
                    expect(c).toBeLessThanOrEqual(1);
                });
            });
            SCALARS.forEach((k) => expect(Number.isFinite(z[k]), `${z.name}.${k}`).toBe(true));
        });
    });

    it('is each zone exactly at its own depth, and holds the ends beyond them', () => {
        OCEAN_ZONES.forEach((z) => {
            const look = oceanDepthLook(z.depth);
            COLOURS.forEach((k) => look[k].forEach((c, i) => expect(c).toBeCloseTo(z[k][i], 10)));
            SCALARS.forEach((k) => expect(look[k]).toBeCloseTo(z[k], 10));
            expect(look.zone).toBe(z.name);
        });
        const top = oceanDepthLook(0);
        const above = oceanDepthLook(-30);
        const garbage = oceanDepthLook(NaN);
        const floor = oceanDepthLook(900);
        top.mid.forEach((c, i) => expect(c).toBeCloseTo(OCEAN_ZONES[0].mid[i], 10));
        expect(above.mid).toEqual(top.mid);
        expect(garbage.mid).toEqual(top.mid);
        floor.deep.forEach((c, i) => expect(c).toBeCloseTo(OCEAN_ZONES.at(-1).deep[i], 10));
    });

    it('is continuous in depth: no step anywhere on the climb', () => {
        const looks = [];
        for (let d = 0; d <= 220; d += 0.25) looks.push(oceanDepthLook(d, createOceanLook()));
        looks.slice(1).forEach((look, n) => {
            const prev = looks[n];
            COLOURS.forEach((k) => look[k].forEach((c, i) => {
                expect(Math.abs(c - prev[k][i]), `${k} at ${look.depth}`).toBeLessThan(0.004);
            }));
            expect(Math.abs(look.dim - prev.dim), `dim at ${look.depth}`).toBeLessThan(0.006);
            expect(Math.abs(look.glow - prev.glow), `glow at ${look.depth}`).toBeLessThan(0.008);
        });
    });

    it('darkens all the way down: the abyss is blue-black, the shallows bright', () => {
        let prev = Infinity;
        for (let d = 0; d <= 200; d += 5) {
            const look = oceanDepthLook(d);
            const light = luma(look.mid) * look.dim;
            expect(light, `at ${d}`).toBeLessThanOrEqual(prev + 1e-9);
            prev = light;
        }
        const abyss = oceanDepthLook(190);
        const shallows = oceanDepthLook(4);
        expect(luma(abyss.deep) * abyss.dim).toBeLessThan(0.002);
        expect(luma(shallows.mid) * shallows.dim).toBeGreaterThan(0.25);
        // Near-black, and still blue: the dark has a colour.
        expect(abyss.deep[2]).toBeGreaterThan(abyss.deep[1] * 3);
        expect(abyss.deep[2]).toBeGreaterThan(abyss.deep[0] * 10);
    });

    it('turns from blue to turquoise on the way up (no two waters the same hue)', () => {
        // Green against blue in the water round the eye: under a third in the deep, near parity
        // in the shallows.
        const ratio = (d) => { const m = oceanDepthLook(d).mid; return m[1] / m[2]; };
        expect(ratio(180)).toBeLessThan(0.3);
        expect(ratio(115)).toBeLessThan(0.4);
        expect(ratio(58)).toBeGreaterThan(0.5);
        expect(ratio(6)).toBeGreaterThan(0.7);
        [180, 115, 58, 6].reduce((deeper, d) => {
            if (deeper !== null) expect(ratio(d)).toBeGreaterThan(ratio(deeper) + 0.05);
            return d;
        }, null);
    });

    it('gives the dark its own lights and the shallows their caustics', () => {
        expect(oceanDepthLook(180).glow).toBe(1);
        expect(oceanDepthLook(4).glow).toBe(0);
        expect(oceanDepthLook(4).caustics).toBe(1);
        expect(oceanDepthLook(130).caustics).toBe(0);
        // The thin sweeping shafts belong to the upper water; the abyss has none.
        expect(oceanDepthLook(50).beams).toBeGreaterThan(0.9);
        expect(oceanDepthLook(180).beams).toBe(0);
        // The surface is a far well from the abyss, and simply there in the shallows.
        expect(oceanDepthLook(180).overhead).toBeGreaterThan(oceanDepthLook(60).overhead);
        expect(oceanDepthLook(2).overhead).toBe(0);
    });

    it('hazes the animals toward the water that is round them', () => {
        const near = oceanHazeColour(5);
        const deep = oceanHazeColour(180);
        expect(luma(near)).toBeGreaterThan(luma(deep) * 50);
        expect(near[1]).toBeGreaterThan(near[0]);
        const hazes = [];
        for (let d = 0; d <= 220; d += 0.5) hazes.push(oceanHazeColour(d).slice());
        hazes.slice(1).forEach((c, n) => {
            c.forEach((v, i) => expect(Math.abs(v - hazes[n][i]), `haze at ${(n + 1) * 0.5}`).toBeLessThan(0.012));
        });
    });
});

describe('the light that reaches the bed (2026-11-25)', () => {
    it('is whole at the surface, falls all the way down and never to nothing', () => {
        expect(oceanBedLight(0)).toEqual([1, 1, 1]);
        expect(oceanBedLight(-20)).toEqual([1, 1, 1]);
        expect(oceanBedLight(NaN)).toEqual([1, 1, 1]);
        let prev = [1, 1, 1];
        for (let d = 5; d <= 220; d += 5) {
            const now = oceanBedLight(d).slice();
            for (let c = 0; c < 3; c += 1) {
                expect(now[c], `at ${d}`).toBeLessThan(prev[c]);
                expect(now[c]).toBeGreaterThan(OCEAN_BED_LIGHT.floor);
            }
            // Red goes first.
            expect(now[0]).toBeLessThan(now[1]);
            expect(now[1]).toBeLessThan(now[2]);
            prev = now;
        }
        // The plain under the column keeps about half of what the shelf has: deep, not black.
        expect(oceanBedLight(190)[1]).toBeLessThan(oceanBedLight(20)[1] * 0.68);
        expect(oceanBedLight(190)[1]).toBeGreaterThan(0.4);
    });

    it('shapes the well as a core with a wider halo, and deepens it on the way down', () => {
        expect(OCEAN_WELL.core).toBeGreaterThan(0);
        expect(OCEAN_WELL.halo).toBeGreaterThan(0);
        expect(oceanDepthLook(180).well).toBeGreaterThan(oceanDepthLook(115).well);
        expect(oceanDepthLook(115).well).toBeGreaterThan(oceanDepthLook(58).well);
        expect(oceanDepthLook(4).well).toBe(0);
    });
});

describe("the sun's light in the water near the surface (2026-11-25)", () => {
    it('is whole in the top of the column and gone in the deep, without a step', () => {
        expect(sunRaysPresence(0)).toBe(1);
        expect(sunRaysPresence(OCEAN_SUN_RAYS.depth[0])).toBe(1);
        expect(sunRaysPresence(OCEAN_SUN_RAYS.depth[1])).toBe(0);
        expect(sunRaysPresence(200)).toBe(0);
        expect(sunRaysPresence(NaN)).toBe(0);
        let prev = 1;
        for (let d = 0; d <= 140; d += 0.5) {
            const now = sunRaysPresence(d);
            expect(now).toBeLessThanOrEqual(prev + 1e-12);
            expect(prev - now, `at ${d}`).toBeLessThan(0.02);
            prev = now;
        }
        // Orb 9's and orb 10's water has it; the deep orbs' close-ups do not run it at all.
        expect(sunRaysPresence(6)).toBe(1);
        expect(sunRaysPresence(60)).toBeGreaterThan(0.1);
        expect(sunRaysPresence(96)).toBe(0);
    });

    it('keeps the streaks soft and slow', () => {
        // A cell of the tile takes over ten seconds to drift by; the streaks only where the view
        // turns toward the sun.
        expect(OCEAN_SUN_RAYS.drift).toBeLessThan(0.008);
        expect(OCEAN_SUN_RAYS.from[0]).toBeGreaterThan(0.1);
        expect(OCEAN_SUN_RAYS.from[1]).toBeGreaterThan(OCEAN_SUN_RAYS.from[0]);
        expect(OCEAN_SUN_RAYS.counts.every((n) => Number.isInteger(n))).toBe(true);
        expect(OCEAN_SUN_RAYS.counts[0]).not.toBe(OCEAN_SUN_RAYS.counts[1]);
    });
});

describe("the sea's own weather: alive on the clock", () => {
    const column = { x: -8, z: 3, seaLevel: 287.31 };

    it('is a function of the clock alone, and survives garbage', () => {
        const a = oceanClockAt(123.4, column);
        const b = oceanClockAt(123.4, column);
        expect(a).toEqual(b);
        expect(() => oceanClockAt(NaN, column)).not.toThrow();
        expect(Number.isFinite(oceanClockAt(undefined, column).light)).toBe(true);
    });

    it('never pops: light, chop and the bloom all move slowly', () => {
        let prev = oceanClockAt(0, column, createOceanClock());
        for (let t = 0.1; t < 900; t += 0.1) {
            const c = oceanClockAt(t, column, createOceanClock());
            expect(Math.abs(c.light - prev.light), `light at ${t}`).toBeLessThan(0.008);
            expect(Math.abs(c.chop - prev.chop), `chop at ${t}`).toBeLessThan(0.006);
            expect(Math.abs(c.bloom[3] - prev.bloom[3]), `bloom at ${t}`).toBeLessThan(0.01);
            expect(Math.hypot(c.bloom[0] - prev.bloom[0], c.bloom[1] - prev.bloom[1], c.bloom[2] - prev.bloom[2]))
                .toBeLessThan(0.4);
            prev = c;
        }
    });

    it('changes the picture over a visit: cloud passes, the sea roughens and calms, the bloom comes and goes', () => {
        let lo = Infinity;
        let hi = -Infinity;
        let calm = Infinity;
        let rough = -Infinity;
        let bloomOn = 0;
        let bloomOff = 0;
        const n = 6000;
        for (let i = 0; i < n; i += 1) {
            const c = oceanClockAt(i * 0.5, column);
            lo = Math.min(lo, c.light);
            hi = Math.max(hi, c.light);
            calm = Math.min(calm, c.chop);
            rough = Math.max(rough, c.chop);
            if (c.bloom[3] > 0.6) bloomOn += 1;
            if (c.bloom[3] < 0.05) bloomOff += 1;
        }
        expect(lo).toBeLessThan(0.75);
        expect(lo).toBeGreaterThan(1 - OCEAN_CLOCK.light.dip - 0.02);
        expect(hi).toBeGreaterThan(1.04);
        expect(hi).toBeLessThan(1.15);
        expect(calm).toBeLessThan(0.7);
        expect(rough).toBeGreaterThan(1.3);
        expect(bloomOn / n).toBeGreaterThan(0.2);
        expect(bloomOff / n).toBeGreaterThan(0.15);
        // Two visits a minute apart are not the same sea.
        const a = oceanClockAt(40, column);
        const b = oceanClockAt(100, column);
        expect(Math.abs(a.light - b.light) + Math.abs(a.chop - b.chop)).toBeGreaterThan(0.08);
    });

    it('keeps the bloom in the water round the column', () => {
        for (let t = 0; t < 2000; t += 3) {
            const c = oceanClockAt(t, column);
            const depth = column.seaLevel - c.bloom[1];
            expect(depth).toBeGreaterThan(OCEAN_CLOCK.bloom.depth[0] - 1e-6);
            expect(depth).toBeLessThan(OCEAN_CLOCK.bloom.depth[1] + 1e-6);
            expect(Math.hypot(c.bloom[0] - column.x, c.bloom[2] - column.z)).toBeCloseTo(OCEAN_CLOCK.bloom.radius, 6);
        }
    });

    it('lays the weather over the look: a cloud dims what the surface gives', () => {
        const clear = applyOceanClock(oceanDepthLook(40, createOceanLook()), { light: 1, chop: 1, bloom: [0, 0, 0, 0] });
        const cloud = applyOceanClock(oceanDepthLook(40, createOceanLook()), { light: 0.7, chop: 1, bloom: [0, 0, 0, 0] });
        expect(cloud.dim).toBeCloseTo(clear.dim * 0.7, 10);
        expect(cloud.beams).toBeLessThan(clear.beams * 0.6);
        expect(cloud.caustics).toBeLessThan(clear.caustics);
        // The plates themselves are the water's, not the weather's.
        expect(cloud.mid).toEqual(clear.mid);
    });
});

describe("Snell's window", () => {
    it('opens 48.6 degrees wide', () => {
        expect((Math.acos(snellWindowRimCos()) * 180) / Math.PI).toBeCloseTo(48.6, 1);
    });

    it('shows the world near the surface and fades it out with depth, without a step', () => {
        expect(snellWindowPresence(0)).toBe(1);
        expect(snellWindowPresence(SNELL_WINDOW.reach - SNELL_WINDOW.fade)).toBe(1);
        expect(snellWindowPresence(SNELL_WINDOW.reach)).toBe(0);
        expect(snellWindowPresence(400)).toBe(0);
        expect(snellWindowPresence(NaN)).toBe(0);
        let prev = snellWindowPresence(0);
        for (let d = 0.25; d < 140; d += 0.25) {
            const p = snellWindowPresence(d);
            expect(p).toBeLessThanOrEqual(prev + 1e-12);
            expect(prev - p).toBeLessThan(0.012);
            prev = p;
        }
    });
});
