/**
 * Moonlit Greenhouse — the three-free core: the house's shape, where a ray toward the moon leaves
 * it and what the glazing lets through there, the blinds, the wheel of nights, the chain's
 * gauges, the fireflies' flash, the piece colours and the baked noise.
 */
import { describe, expect, it } from 'vitest';
import {
    ARC, BLINDS, FLASH, GLAZING, HOUSE, NIGHTS, NIGHT_COLOURS, NIGHT_REST, NIGHT_SECONDS, TIMING, bakeGardenNoise,
    blindAt, cellsFromMatrix, fireflyFlash, glazingAt, groundAt, houseExit, lineMask, moonDrift, moonlightAt,
    mossForCombo, mulberry32, nightAt, nightPlace, pieceLight, restEase, ribPositions, skyDirection, swarmForCombo,
    syncForCombo, vaultHeightAt,
} from '../../src/themes/moonlit-greenhouse/moonlit-greenhouse-core.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

describe('the house', () => {
    it('springs the pointed vault from the side walls and meets at the ridge', () => {
        // The left arc is centred on the spring line at +offset and passes through (-halfSpan, spring)
        // and (0, spring + rise).
        const { offset, radius } = ARC;
        expect(near(Math.hypot(-HOUSE.halfSpan - offset, 0), radius)).toBe(true);
        expect(near(Math.hypot(0 - offset, HOUSE.rise), radius)).toBe(true);
        expect(vaultHeightAt(0)).toBeCloseTo(HOUSE.spring + HOUSE.rise, 6);
        expect(vaultHeightAt(HOUSE.halfSpan)).toBeCloseTo(HOUSE.spring, 6);
        expect(vaultHeightAt(-3.2)).toBeCloseTo(vaultHeightAt(3.2), 9);
        // Falls steadily from the ridge to the walls, and beyond them it is the wall's head.
        let last = Infinity;
        for (let x = 0; x <= HOUSE.halfSpan; x += 0.25) {
            const h = vaultHeightAt(x);
            expect(h).toBeLessThan(last + 1e-9);
            last = h;
        }
        expect(vaultHeightAt(9)).toBeCloseTo(HOUSE.spring, 6);
    });

    it('stands its ribs every GLAZING.ribEvery along the whole house', () => {
        const ribs = ribPositions();
        expect(ribs.length).toBeGreaterThan(15);
        expect(ribs[0]).toBeLessThanOrEqual(HOUSE.near);
        expect(ribs[ribs.length - 1]).toBeGreaterThanOrEqual(HOUSE.far);
        for (let i = 1; i < ribs.length; i += 1) expect(ribs[i - 1] - ribs[i]).toBeCloseTo(GLAZING.ribEvery, 9);
    });

    it('finds where a ray toward the sky leaves the house, on the vault or a side wall', () => {
        const rand = mulberry32(7);
        for (let i = 0; i < 400; i += 1) {
            const p = { x: (rand() * 2 - 1) * 6.5, y: rand() * 9, z: -rand() * 50 };
            if (p.y > vaultHeightAt(p.x) - 0.05) continue;
            const d = skyDirection((rand() * 2 - 1) * 70, 8 + rand() * 75);
            const e = houseExit(p, d);
            expect(e.t).toBeGreaterThan(0);
            const hit = { x: p.x + d.x * e.t, y: p.y + d.y * e.t, z: p.z + d.z * e.t };
            expect(e.along).toBeCloseTo(hit.z, 6);
            if (e.wall) {
                expect(Math.abs(Math.abs(hit.x) - HOUSE.halfSpan)).toBeLessThan(1e-6);
                expect(hit.y).toBeLessThanOrEqual(HOUSE.spring + 1e-6);
                expect(e.s).toBeCloseTo(hit.y - HOUSE.spring, 6);
            } else {
                expect(hit.y).toBeGreaterThanOrEqual(HOUSE.spring - 1e-6);
                expect(hit.y).toBeCloseTo(vaultHeightAt(hit.x), 4);
                expect(e.s).toBeGreaterThanOrEqual(-1e-6);
                expect(e.s).toBeLessThanOrEqual(ARC.length + 1e-6);
                expect(e.side).toBe(hit.x <= 0 ? -1 : 1);
            }
        }
    });

    it('measures arc length from each side spring to the ridge', () => {
        // Straight up from the middle of the nave: the ridge, at the full arc length.
        const top = houseExit({ x: 0, y: 1, z: -10 }, { x: 0, y: 1, z: 0 });
        expect(top.wall).toBe(false);
        expect(top.s).toBeCloseTo(ARC.length, 6);
        // Toward the left wall's head: the spring (s near 0).
        const d = { x: -HOUSE.halfSpan, y: HOUSE.spring + 0.02 - 1, z: 0 };
        const l = Math.hypot(d.x, d.y);
        const spring = houseExit({ x: 0, y: 1, z: -10 }, { x: d.x / l, y: d.y / l, z: 0 });
        expect(spring.s).toBeLessThan(0.1);
    });
});

describe('the glazing and the moonlight', () => {
    it('draws soft lines on every multiple', () => {
        expect(lineMask(1.2, 0.6, 0.05, 0.001)).toBeCloseTo(1, 6);
        expect(lineMask(1.5, 0.6, 0.05, 0.001)).toBeCloseTo(0, 6);
        const soft = lineMask(0.6 + 0.025, 0.6, 0.05, 0.01);
        expect(soft).toBeGreaterThan(0.3);
        expect(soft).toBeLessThan(0.7);
    });

    it('lets the panes through and stops the iron', () => {
        // Between bars, mid-pane, on a bay with no blind: most of the light.
        let open = null;
        for (let bay = 0; bay < 40 && open === null; bay += 1) {
            const along = -bay * GLAZING.ribEvery - GLAZING.barEvery * 1.5;
            if (blindAt(Math.floor(along / GLAZING.ribEvery), -1, 3) === 1) open = along;
        }
        expect(open).not.toBeNull();
        const pane = glazingAt(open, GLAZING.purlinEvery * 1.5, false, 0.002, -1);
        expect(pane).toBeGreaterThan(0.5);
        // On a rib: nothing.
        expect(glazingAt(-GLAZING.ribEvery * 4, 3.3, false, 0.002, -1)).toBeLessThan(0.02);
        // On a glazing bar's centre line.
        expect(glazingAt(-GLAZING.barEvery * 7, 3.3, false, 0.002, -1)).toBeLessThan(0.05);
        // On the side walls, the plinth is solid.
        expect(glazingAt(-3.1, 0.3 - HOUSE.spring, true, 0.002)).toBeLessThan(0.02);
    });

    it('rolls lath blinds down a share of the bays, ruled by the laths', () => {
        let down = 0;
        const bays = 400;
        // Read with a wide edge, so the laths and their gaps average out.
        for (let bay = 0; bay < bays; bay += 1) if (blindAt(bay, -1, ARC.length - 0.05, 1) < 0.9) down += 1;
        expect(down / bays).toBeGreaterThan(BLINDS.share - 0.12);
        expect(down / bays).toBeLessThan(BLINDS.share + 0.12);
        // Under a blind, a wide penumbra averages laths and gaps to the open share.
        for (let bay = 0; bay < 60; bay += 1) {
            if (blindAt(bay, 1, ARC.length - 0.05) === 1) continue;
            const wide = blindAt(bay, 1, ARC.length - 0.05, 1);
            expect(wide).toBeGreaterThan(0.04 + 0.96 * BLINDS.open - 0.06);
            expect(wide).toBeLessThan(0.04 + 0.96 * BLINDS.open + 0.06);
            break;
        }
        // Every value stays in 0..1.
        const rand = mulberry32(3);
        for (let i = 0; i < 500; i += 1) {
            const v = blindAt(Math.floor(rand() * 30), rand() < 0.5 ? -1 : 1, rand() * ARC.length, rand() * 0.3);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
        }
    });

    it('lays the lattice across the floor and goes dark when the moon is down', () => {
        const moon = skyDirection(-26, 21);
        let lit = 0;
        let dark = 0;
        let n = 0;
        for (let x = -6; x <= 6; x += 0.21) {
            for (let z = -30; z <= 0; z += 0.23) {
                const v = moonlightAt({ x, y: 0, z }, moon);
                expect(v).toBeGreaterThanOrEqual(0);
                expect(v).toBeLessThanOrEqual(1);
                if (v > 0.6) lit += 1;
                if (v < 0.1) dark += 1;
                n += 1;
            }
        }
        // Mostly lit, with real shadow in it: the ribs, the bars and the blinds.
        expect(lit / n).toBeGreaterThan(0.25);
        expect(dark / n).toBeGreaterThan(0.05);
        expect(moonlightAt({ x: 0, y: 0, z: -10 }, skyDirection(-26, 0.5))).toBe(0);
    });

    it('widens a bar\'s shadow with the distance it is thrown', () => {
        // Just outside a rib's shadow, on a bay with no blind: crisp near the glass, the shadow's
        // penumbra reaches it when it is thrown far.
        let bay = 0;
        while (blindAt(-bay, -1, 3.3, 0.5) < 1 && bay < 60) bay += 1;
        const rib = -bay * GLAZING.ribEvery;
        const at = rib + GLAZING.ribWidth * 0.5 + 0.04;
        const crisp = glazingAt(at, 3.3, false, 0.002, -1);
        const thrown = glazingAt(at, 3.3, false, 20 * GLAZING.penumbra + 0.004, -1);
        expect(crisp).toBeGreaterThan(0.5);
        expect(thrown).toBeLessThan(crisp);
    });
});

describe('the floor', () => {
    it('knows the canal, the paths and the beds', () => {
        expect(groundAt(0, -5).kind).toBe('water');
        expect(groundAt(3, -5).kind).toBe('path');
        expect(groundAt(-5, -5).kind).toBe('bed');
        expect(groundAt(0, 3).kind).toBe('path');
        expect(groundAt(0, -5).y).toBeLessThan(0);
        expect(groundAt(5, -5).y).toBeGreaterThan(0);
    });
});

describe('the moon and the wheel of nights', () => {
    it('points the moon where its azimuth and elevation say', () => {
        const d = skyDirection(-26, 21);
        expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 9);
        expect(d.x).toBeLessThan(0);
        expect(d.z).toBeLessThan(0);
        expect(Math.asin(d.y) * (180 / Math.PI)).toBeCloseTo(21, 9);
        const drift = moonDrift(123);
        expect(Math.abs(drift.az)).toBeLessThanOrEqual(4.5);
        expect(Math.abs(drift.el)).toBeLessThanOrEqual(1.6);
    });

    it('holds every night and mixes between them with rests at each end', () => {
        expect(NIGHTS.length).toBe(6);
        NIGHTS.forEach((n) => NIGHT_COLOURS.forEach((key) => {
            expect(n[key]).toHaveLength(3);
            n[key].forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
        }));
        expect(restEase(NIGHT_REST * 0.5)).toBe(0);
        expect(restEase(1 - NIGHT_REST * 0.5)).toBe(1);
        const a = nightAt(2);
        expect(a.name).toBe(NIGHTS[2].name);
        expect(a.mix).toBe(0);
        expect(a.moonlight).toEqual(NIGHTS[2].moonlight);
        const half = nightAt(2.5);
        expect(half.mix).toBeCloseTo(0.5, 6);
        expect(half.moonlight[0]).toBeCloseTo((NIGHTS[2].moonlight[0] + NIGHTS[3].moonlight[0]) / 2, 6);
        // The wheel closes: past the last night comes the first.
        expect(nightAt(NIGHTS.length + 0.05).name).toBe(NIGHTS[0].name);
        expect(nightAt(-0.95).name).toBe(NIGHTS[NIGHTS.length - 1].name);
        expect(nightPlace(3, NIGHT_SECONDS * 0.5)).toBeCloseTo(2.5, 9);
        expect(nightPlace(1, 0)).toBe(0);
    });
});

describe('what the board does', () => {
    it('pulls the fireflies into step and the moss up the columns with the chain', () => {
        expect(syncForCombo(0)).toBe(0);
        expect(syncForCombo(1)).toBe(0);
        let last = 0;
        for (let c = 2; c < 20; c += 1) {
            const s = syncForCombo(c);
            expect(s).toBeGreaterThan(last);
            expect(s).toBeLessThanOrEqual(1);
            last = s;
        }
        expect(syncForCombo(8)).toBeGreaterThan(0.85);
        expect(mossForCombo(0)).toBe(0);
        expect(mossForCombo(3) - mossForCombo(2)).toBeCloseTo(0.62, 9);
        expect(mossForCombo(30)).toBeLessThanOrEqual(HOUSE.spring + 3);
        expect(swarmForCombo(0)).toBeGreaterThan(0.3);
        expect(swarmForCombo(20)).toBe(1);
    });

    it('flashes each firefly on its own out of step and all together in step', () => {
        for (let t = 0; t < 10; t += 0.37) {
            for (const seed of [0.1, 0.5, 0.9]) {
                const v = fireflyFlash(t, seed, -8, 0.4);
                expect(v).toBeGreaterThanOrEqual(0);
                expect(v).toBeLessThanOrEqual(1);
            }
        }
        // In full step, two fireflies at the same place flash together whatever their seeds.
        for (let t = 0; t < 6; t += 0.11) {
            expect(fireflyFlash(t, 0.13, -5, 1)).toBeCloseTo(fireflyFlash(t, 0.87, -5, 1), 9);
        }
        // A flash takes FLASH.width of the beat.
        let on = 0;
        const n = 4000;
        for (let i = 0; i < n; i += 1) if (fireflyFlash((i / n) * FLASH.beat * 10, 0.3, 0, 1) > 0) on += 1;
        expect(on / n).toBeCloseTo(FLASH.width, 1);
    });

    it('keeps its timings positive', () => {
        Object.values(TIMING).forEach((v) => expect(v).toBeGreaterThan(0));
    });
});

describe('pieces', () => {
    it('turns a piece colour into light with its brightest channel at one', () => {
        const rgb = pieceLight('#82f5b8');
        expect(Math.max(...rgb)).toBeCloseTo(1, 9);
        expect(rgb[1]).toBe(1);
        expect(pieceLight('rgba(0,0,0,0.5)')).toEqual([1, 0.84, 0.52]);
        expect(pieceLight('#000000')).toEqual([1, 0.84, 0.52]);
    });

    it('reads a shape matrix as four cells about their own centre', () => {
        const t = cellsFromMatrix([[0, 1, 0], [1, 1, 1]]);
        expect(t).toHaveLength(8);
        let sx = 0;
        for (let i = 0; i < 8; i += 2) sx += t[i];
        expect(sx).toBeCloseTo(0, 9);
        expect(cellsFromMatrix(null)).toBeNull();
        expect(cellsFromMatrix([[0, 0]])).toBeNull();
    });
});

describe('the baked noise', () => {
    it('is deterministic and tiles at its edges', () => {
        const size = 64;
        const a = bakeGardenNoise(size, 5);
        const b = bakeGardenNoise(size, 5);
        expect(a).toEqual(b);
        expect(a.length).toBe(size * size * 4);
        // The fBm channels wrap: the last column continues into the first.
        let jump = 0;
        let step = 0;
        for (let j = 0; j < size; j += 1) {
            const first = a[(j * size) * 4];
            const last = a[(j * size + size - 1) * 4];
            const prev = a[(j * size + size - 2) * 4];
            jump += Math.abs(first - last);
            step += Math.abs(last - prev);
        }
        expect(jump / size).toBeLessThan((step / size) * 3 + 2);
        // Beads: most of the field is off a drop, some of it is on one.
        let on = 0;
        for (let i = 1; i < a.length; i += 4) if (a[i] > 40) on += 1;
        expect(on / (size * size)).toBeGreaterThan(0.05);
        expect(on / (size * size)).toBeLessThan(0.9);
    });
});
