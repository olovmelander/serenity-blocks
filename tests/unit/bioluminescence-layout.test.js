/**
 * The Bioluminescence plan and the CPU maths it shares with the choreography and the shaders.
 * Everything here is three-free. Assertions are relationships and invariants (what stands on
 * what, what is ordered by what, what inverts what), never tuned numbers.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    BIOLUM_PALETTES, CLEAR_REACH, CLEAR_TRAVEL, ELDER, EMITTER_MAX, JELLY_MAX, NOISE_SIZE, PALETTE_KEYS, RING_REACH,
    STARSPORE, TERRAIN, approach, bakeNoise, clamp01, clearPassTime, clearRadius, familyColor, jelliesForCombo, lerp,
    linRGB, mulberry32, pieceColor, powerForCombo, ringRadius, sampleNoise, smooth,
} from '../../src/themes/bioluminescence/bioluminescence-core.js';
import {
    BELL, GLOBE, ISLETS, MAX_CRYSTALS, MAX_MUSHROOMS, MAX_PADS, MAX_SPIKES, MAX_SPROUTS, MAX_VINES, MAX_WORMS, PARASOL,
    VAULT, buildPlan, capCentre, floorHeight, shoreDistance, vaultHeight,
} from '../../src/themes/bioluminescence/bioluminescence-layout.js';
import { QUALITY, QUALITY_NAMES, tierFor } from '../../src/themes/bioluminescence/bioluminescence-quality.js';
import { BIOLUMINESCENCE_TETROMINOS } from '../../src/themes/bioluminescence/bioluminescence-tetrominos.js';

const noise = bakeNoise();
const plan = buildPlan(noise, NOISE_SIZE);
const heroes = plan.mushrooms.slice(1, plan.heroCount);
const SHAPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
const themeDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'src',
    'themes',
    'bioluminescence',
);

/** Every cell of the floor's grid, with its world position. */
function eachCell(visit) {
    const {
        nx, nz, x0, x1, z0, z1,
    } = TERRAIN;
    for (let j = 0; j < nz; j++) {
        const z = z0 + ((z1 - z0) * j) / (nz - 1);
        for (let i = 0; i < nx; i++) visit(j * nx + i, x0 + ((x1 - x0) * i) / (nx - 1), z);
    }
}

const inside = (x, z) => x > TERRAIN.x0 && x < TERRAIN.x1 && z > TERRAIN.z0 && z < TERRAIN.z1;

describe('bioluminescence core maths', () => {
    it('grows a lock ring fast, then settles it inside its reach', () => {
        expect(ringRadius(-1)).toBe(0);
        expect(ringRadius(0)).toBe(0);
        expect(ringRadius(0.2)).toBeGreaterThan(0);
        expect(ringRadius(0.4)).toBeGreaterThan(ringRadius(0.2));
        // It slows as it goes: the second stretch of time covers less than the first.
        expect(ringRadius(0.4) - ringRadius(0.2)).toBeLessThan(ringRadius(0.2));
        expect(ringRadius(600)).toBeLessThanOrEqual(RING_REACH);
        expect(ringRadius(600)).toBeGreaterThan(RING_REACH * 0.99);
        // A smaller ring is the same ring, scaled.
        expect(ringRadius(0.7, 0.3)).toBeCloseTo(ringRadius(0.7) * 0.3, 9);
    });

    it('runs a clear wave out through the grotto and knows when it passes a point', () => {
        expect(clearRadius(-1)).toBe(0);
        expect(clearRadius(0)).toBe(0);
        expect(clearRadius(CLEAR_TRAVEL)).toBeCloseTo(CLEAR_REACH, 9);
        expect(clearRadius(CLEAR_TRAVEL * 3)).toBeCloseTo(CLEAR_REACH, 9);
        let previous = 0;
        for (let i = 1; i <= 20; i++) {
            const radius = clearRadius((CLEAR_TRAVEL * i) / 20);
            expect(radius).toBeGreaterThan(previous);
            previous = radius;
        }
        // The pass time is the wave's inverse: a mushroom lets go exactly as the front arrives.
        for (const dist of [0.5, 5, 40, CLEAR_REACH * 0.6, CLEAR_REACH]) {
            expect(clearRadius(clearPassTime(dist))).toBeCloseTo(dist, 6);
        }
        for (const age of [0.1, CLEAR_TRAVEL * 0.3, CLEAR_TRAVEL * 0.9]) {
            expect(clearPassTime(clearRadius(age))).toBeCloseTo(age, 6);
        }
        expect(clearPassTime(0)).toBe(0);
        expect(clearPassTime(CLEAR_REACH * 10)).toBe(CLEAR_TRAVEL);
    });

    it('wakes with the combo and never past full', () => {
        expect(powerForCombo(0)).toBe(0);
        expect(powerForCombo(-2)).toBe(0);
        let previous = 0;
        for (let combo = 1; combo <= 12; combo++) {
            const power = powerForCombo(combo);
            expect(power).toBeGreaterThan(previous);
            expect(power).toBeLessThan(1);
            previous = power;
        }
        expect(powerForCombo(500)).toBeLessThanOrEqual(1);
        expect(powerForCombo(500)).toBeGreaterThan(0.99);
    });

    it('raises jellies with a chain from its second step, never more than there are', () => {
        const rest = jelliesForCombo(0);
        expect(rest).toBeGreaterThan(0);
        expect(rest).toBeLessThan(JELLY_MAX);
        // One clear is not a chain yet.
        expect(jelliesForCombo(1)).toBe(rest);
        expect(jelliesForCombo(2)).toBeGreaterThan(rest);
        let previous = rest;
        for (let combo = 1; combo <= 30; combo++) {
            const up = jelliesForCombo(combo);
            expect(Number.isInteger(up)).toBe(true);
            expect(up).toBeGreaterThanOrEqual(previous);
            expect(up).toBeLessThanOrEqual(JELLY_MAX);
            previous = up;
        }
        expect(jelliesForCombo(100)).toBe(JELLY_MAX);
        // A tier with fewer slots is never asked for more than it has.
        expect(jelliesForCombo(100, 5)).toBe(5);
        expect(jelliesForCombo(0, 2)).toBe(2);
        // Nonsense is no chain.
        for (const nonsense of [NaN, undefined, null, -4, 'x']) expect(jelliesForCombo(nonsense)).toBe(rest);
    });

    it('converts sRGB hex to scene-linear and seeds a repeatable generator', () => {
        expect(linRGB(0x000000)).toEqual([0, 0, 0]);
        expect(linRGB(0xffffff).every((c) => Math.abs(c - 1) < 1e-9)).toBe(true);
        expect(linRGB(0x808080)[0]).toBeCloseTo(0.2158, 3);
        expect(linRGB(0xff0000)).toEqual([1, 0, 0]);
        const a = mulberry32(7);
        const b = mulberry32(7);
        const other = mulberry32(8);
        let same = 0;
        for (let i = 0; i < 50; i++) {
            const v = a();
            expect(v).toBe(b());
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
            if (v === other()) same += 1;
        }
        expect(same).toBeLessThan(5);
    });

    it('eases and interpolates', () => {
        expect(clamp01(-3)).toBe(0);
        expect(clamp01(0.4)).toBe(0.4);
        expect(clamp01(7)).toBe(1);
        expect(lerp(2, 6, 0.25)).toBe(3);
        expect(smooth(0, 1, -1)).toBe(0);
        expect(smooth(0, 1, 0.5)).toBeCloseTo(0.5, 12);
        expect(smooth(0, 1, 2)).toBe(1);
        // Either order of the edges: the ramp runs the other way.
        expect(smooth(1, 0, 0.25)).toBeCloseTo(1 - smooth(0, 1, 0.25), 12);
        expect(smooth(6, -24, 6)).toBe(0);
        expect(smooth(6, -24, -24)).toBe(1);
        // A frame-rate independent approach: two half steps close what one whole step does.
        expect(approach(3, 0)).toBe(0);
        const whole = approach(3, 0.2);
        const half = approach(3, 0.1);
        expect(1 - (1 - half) * (1 - half)).toBeCloseTo(whole, 12);
        expect(whole).toBeGreaterThan(0);
        expect(whole).toBeLessThan(1);
    });

    it('gives a lock the piece\'s colour, peak-normalised, with a floor in every channel', () => {
        const pink = pieceColor('#ff6fb5');
        expect(Math.max(...pink)).toBeCloseTo(1, 6);
        expect(Math.min(...pink)).toBeGreaterThan(0);
        // Its hue survives: red over blue over green.
        expect(pink[0]).toBeGreaterThan(pink[2]);
        expect(pink[2]).toBeGreaterThan(pink[1]);
        // A pastel is pushed toward its own hue: the weakest channel falls further than it would
        // by normalising alone.
        const plain = linRGB(0xff6fb5);
        expect(pink[1]).toBeLessThan(plain[1] / Math.max(...plain));
        // A pure primary still reaches all three channels.
        const blue = pieceColor(0x0000ff);
        expect(blue[2]).toBeCloseTo(1, 6);
        expect(blue[0]).toBeGreaterThan(0);
        expect(blue[1]).toBeGreaterThan(0);
        // Strings, with or without the hash, in either case, and numbers are the same colour.
        expect(pieceColor('3dffa8')).toEqual(pieceColor('#3DFFA8'));
        expect(pieceColor('#3dffa8')).toEqual(pieceColor(0x3dffa8));
        // Nonsense falls back to the given colour, or to the theme's own.
        expect(pieceColor('teal', 0x00ff00)[1]).toBeCloseTo(1, 6);
        expect(pieceColor(NaN, 0x123456)).toEqual(pieceColor(0x123456));
        expect(pieceColor(null)).toEqual(pieceColor(undefined));
        expect(Math.max(...pieceColor(null))).toBeCloseTo(1, 6);
        expect(pieceColor(null).every((c) => Number.isFinite(c) && c > 0)).toBe(true);
        // Black has no hue to keep: it must not divide by nothing.
        expect(pieceColor(0x000000).every(Number.isFinite)).toBe(true);
    });

    it('turns the theme\'s seven piece colours into seven lights that read apart', () => {
        const lights = SHAPES.map((shape) => pieceColor(BIOLUMINESCENCE_TETROMINOS.colors[shape]));
        lights.forEach((light, i) => {
            expect(BIOLUMINESCENCE_TETROMINOS.colors[SHAPES[i]], SHAPES[i]).toMatch(/^#[0-9a-f]{6}$/i);
            expect(Math.max(...light), SHAPES[i]).toBeCloseTo(1, 6);
            expect(Math.min(...light), SHAPES[i]).toBeGreaterThan(0);
        });
        for (let a = 0; a < lights.length; a++) {
            for (let b = a + 1; b < lights.length; b++) {
                const apart = Math.max(...lights[a].map((v, c) => Math.abs(v - lights[b][c])));
                expect(apart, `${SHAPES[a]} against ${SHAPES[b]}`).toBeGreaterThan(0.1);
            }
        }
    });

    it('defines every palette key for every level\'s palette, in scene-linear light', () => {
        expect(BIOLUM_PALETTES.length).toBeGreaterThan(1);
        expect(new Set(BIOLUM_PALETTES.map((p) => p.name)).size).toBe(BIOLUM_PALETTES.length);
        for (const palette of BIOLUM_PALETTES) {
            expect(typeof palette.name).toBe('string');
            for (const key of PALETTE_KEYS) {
                expect(palette[key], `${palette.name}.${key}`).toHaveLength(3);
                for (const channel of palette[key]) {
                    expect(Number.isFinite(channel), `${palette.name}.${key}`).toBe(true);
                    expect(channel, `${palette.name}.${key}`).toBeGreaterThanOrEqual(0);
                }
            }
            // A palette names nothing the shaders have no uniform for.
            expect(Object.keys(palette).filter((key) => key !== 'name').sort()).toEqual([...PALETTE_KEYS].sort());
            // The three families of living light are the palette's first three colours.
            expect(familyColor(palette, 0)).toBe(palette.primary);
            expect(familyColor(palette, 1)).toBe(palette.secondary);
            expect(familyColor(palette, 2)).toBe(palette.accent);
        }
        expect(STARSPORE).toHaveLength(3);
        expect(STARSPORE.every((c) => Number.isFinite(c) && c >= 0)).toBe(true);
    });
});

describe('bioluminescence noise field', () => {
    it('bakes four tileable channels stretched to the unit range, the same every time', () => {
        expect(noise).toHaveLength(NOISE_SIZE * NOISE_SIZE * 4);
        const lo = [Infinity, Infinity, Infinity, Infinity];
        const hi = [-Infinity, -Infinity, -Infinity, -Infinity];
        for (let i = 0; i < noise.length; i++) {
            lo[i % 4] = Math.min(lo[i % 4], noise[i]);
            hi[i % 4] = Math.max(hi[i % 4], noise[i]);
        }
        for (let c = 0; c < 4; c++) {
            expect(lo[c]).toBeCloseTo(0, 5);
            expect(hi[c]).toBeCloseTo(1, 5);
        }
        const again = bakeNoise();
        for (let i = 0; i < noise.length; i += 997) expect(again[i]).toBe(noise[i]);
    });

    it('reads the field bilinearly and wraps at its edges', () => {
        for (const [x, y] of [[0.3, 0.7], [0.999, 0.001], [0, 0]]) {
            const v = sampleNoise(noise, NOISE_SIZE, x, y, 1);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
            expect(sampleNoise(noise, NOISE_SIZE, x + 1, y - 1, 1)).toBeCloseTo(v, 9);
        }
        // At a texel centre it returns the texel.
        const texel = (ix, iy, c) => noise[(iy * NOISE_SIZE + ix) * 4 + c];
        const centre = sampleNoise(noise, NOISE_SIZE, 10.5 / NOISE_SIZE, 20.5 / NOISE_SIZE, 2);
        expect(centre).toBeCloseTo(texel(10, 20, 2), 6);
    });
});

describe('bioluminescence grotto plan', () => {
    it('is deterministic for a seed and different for another', () => {
        const again = buildPlan(noise, NOISE_SIZE);
        expect(again.seed).toBe(plan.seed);
        for (const key of ['mushrooms', 'sprouts', 'crystals', 'spikes', 'vines', 'jellies', 'pads', 'emitters', 'drips']) {
            expect(JSON.stringify(again[key]), key).toBe(JSON.stringify(plan[key]));
        }
        expect(JSON.stringify(again.worms.slice(0, 200))).toBe(JSON.stringify(plan.worms.slice(0, 200)));
        expect(Array.from(again.heights)).toEqual(Array.from(plan.heights));
        expect(Array.from(again.vault)).toEqual(Array.from(plan.vault));
        const other = buildPlan(noise, NOISE_SIZE, 1234);
        expect(other.seed).toBe(1234);
        expect(JSON.stringify(other.mushrooms)).not.toBe(JSON.stringify(plan.mushrooms));
        expect(JSON.stringify(other.crystals)).not.toBe(JSON.stringify(plan.crystals));
        // The rock is not seeded: the pool lies where it lies.
        expect(Array.from(other.heights)).toEqual(Array.from(plan.heights));
        // Nor is where the heroes were placed by hand.
        expect(other.heroCount).toBe(plan.heroCount);
        for (let i = 0; i < plan.heroCount; i++) {
            expect(other.mushrooms[i].x).toBe(plan.mushrooms[i].x);
            expect(other.mushrooms[i].z).toBe(plan.mushrooms[i].z);
        }
    });

    it('lists no more of anything than a tier may ever draw', () => {
        const limits = [
            ['mushrooms', MAX_MUSHROOMS], ['sprouts', MAX_SPROUTS], ['crystals', MAX_CRYSTALS], ['spikes', MAX_SPIKES],
            ['worms', MAX_WORMS], ['vines', MAX_VINES], ['pads', MAX_PADS], ['jellies', JELLY_MAX], ['emitters', EMITTER_MAX],
        ];
        for (const [key, max] of limits) {
            expect(plan[key].length, key).toBeGreaterThan(0);
            expect(plan[key].length, key).toBeLessThanOrEqual(max);
        }
        expect(plan.jellies).toHaveLength(JELLY_MAX);
        expect(plan.drips.length).toBeGreaterThan(0);
        expect(plan.heights).toHaveLength(TERRAIN.nx * TERRAIN.nz);
        expect(plan.shore).toHaveLength(TERRAIN.nx * TERRAIN.nz);
        expect(plan.vault).toHaveLength(VAULT.nx * VAULT.nz);
        expect(plan.heights.every(Number.isFinite)).toBe(true);
        expect(plan.shore.every(Number.isFinite)).toBe(true);
        expect(plan.vault.every(Number.isFinite)).toBe(true);
    });

    it('shapes a pool: water where the viewer stands and down the middle, rock either side', () => {
        // The camera stands in the shallows at the origin.
        expect(plan.shoreAt(0, 0)).toBeLessThan(0);
        expect(plan.floorAt(0, 0)).toBeLessThan(0);
        expect(shoreDistance(0, 0, noise, NOISE_SIZE)).toBeLessThan(0);
        // The middle of the pool, all the way to the elder's island.
        for (const z of [-5, -15, -30, -45]) {
            expect(plan.shoreAt(0, z), `shore at z=${z}`).toBeLessThan(0);
            expect(shoreDistance(0, z, noise, NOISE_SIZE), `shore at z=${z}`).toBeLessThan(0);
        }
        // Out on either side the ground has climbed well clear of the water.
        const edge = TERRAIN.x1 - 4;
        for (const z of [-20, -40, -60]) {
            expect(plan.shoreAt(-edge, z), `left bank at z=${z}`).toBeGreaterThan(0);
            expect(plan.shoreAt(edge, z), `right bank at z=${z}`).toBeGreaterThan(0);
            expect(plan.floorAt(-edge, z), `left bank at z=${z}`).toBeGreaterThan(1);
            expect(plan.floorAt(edge, z), `right bank at z=${z}`).toBeGreaterThan(1);
        }
        // Between the viewer and the elder: under water well inside the shoreline, over it well
        // outside (away from the islets and the island, which stand in the pool).
        let wet = 0;
        let dry = 0;
        eachCell((o, x, z) => {
            if (z > 0 || z < ELDER.z) return;
            const islet = ISLETS.some(([ix, iz, r]) => Math.hypot(x - ix, z - iz) < r + 1);
            const island = Math.hypot(x - ELDER.x, z - ELDER.z) < ELDER.radius;
            if (islet || island) return;
            if (plan.shore[o] < -2) {
                wet += 1;
                expect(plan.heights[o], `bed at ${x},${z}`).toBeLessThan(0);
            } else if (plan.shore[o] > 8) {
                dry += 1;
                expect(plan.heights[o], `bank at ${x},${z}`).toBeGreaterThan(0);
            }
        });
        expect(wet).toBeGreaterThan(500);
        expect(dry).toBeGreaterThan(500);
    });

    it('samples its height fields at the grid, and reads them back between the cells', () => {
        const {
            nx, nz, x0, x1, z0, z1,
        } = TERRAIN;
        for (const [i, j] of [[0, 0], [80, 180], [40, 100], [nx - 2, nz - 2]]) {
            const x = x0 + ((x1 - x0) * i) / (nx - 1);
            const z = z0 + ((z1 - z0) * j) / (nz - 1);
            // (The fields are single precision; the walls at the plan's edge stand tens of metres.)
            expect(plan.heights[j * nx + i]).toBeCloseTo(floorHeight(x, z, noise, NOISE_SIZE), 3);
            expect(plan.shore[j * nx + i]).toBeCloseTo(shoreDistance(x, z, noise, NOISE_SIZE), 3);
            expect(plan.floorAt(x, z)).toBeCloseTo(plan.heights[j * nx + i], 3);
            expect(plan.shoreAt(x, z)).toBeCloseTo(plan.shore[j * nx + i], 3);
        }
        for (const [i, j] of [[0, 0], [40, 60], [VAULT.nx - 2, VAULT.nz - 2]]) {
            const x = x0 + ((x1 - x0) * i) / (VAULT.nx - 1);
            const z = z0 + ((z1 - z0) * j) / (VAULT.nz - 1);
            expect(plan.vault[j * VAULT.nx + i]).toBeCloseTo(vaultHeight(x, z, noise, NOISE_SIZE), 3);
            expect(plan.vaultAt(x, z)).toBeCloseTo(plan.vault[j * VAULT.nx + i], 3);
        }
        // Outside the plan the fields hold their edge: nothing reads off the end of an array.
        for (const read of [plan.floorAt, plan.shoreAt, plan.vaultAt]) {
            expect(Number.isFinite(read(x0 - 500, z0 - 500))).toBe(true);
            expect(Number.isFinite(read(x1 + 500, z1 + 500))).toBe(true);
        }
    });

    it('raises the islets and the elder\'s island out of the water, and only them', () => {
        expect(plan.floorAt(ELDER.x, ELDER.z)).toBeGreaterThan(0);
        expect(ISLETS.length).toBeGreaterThan(1);
        for (const [x, z, radius, top] of ISLETS) {
            expect(radius).toBeGreaterThan(0);
            expect(top).toBeGreaterThan(0);
            // An islet stands in the pool: water round it, stone at its heart.
            expect(plan.shoreAt(x, z), `islet at ${x},${z}`).toBeLessThan(0);
            expect(floorHeight(x, z, noise, NOISE_SIZE), `islet at ${x},${z}`).toBeGreaterThan(0);
            // Without its outcrops the bed runs on under it.
            expect(floorHeight(x, z, noise, NOISE_SIZE, false), `bed under ${x},${z}`).toBeLessThan(0);
        }
        // The bare ground is the floor with the outcrops taken away: never above it.
        expect(plan.ground).toHaveLength(plan.heights.length);
        let lifted = 0;
        eachCell((o, x, z) => {
            expect(plan.ground[o]).toBeLessThanOrEqual(plan.heights[o] + 1e-6);
            if (plan.ground[o] < plan.heights[o] - 1e-6) {
                lifted += 1;
                // (An outcrop's edge wanders, so it is looked for within twice its radius.)
                const near = ISLETS.some(([ix, iz, r]) => Math.hypot(x - ix, z - iz) <= r * 2);
                expect(near, `lifted at ${x},${z}`).toBe(true);
            }
        });
        expect(lifted).toBeGreaterThan(0);
    });

    it('keeps the vault clear of the floor over the whole pool', () => {
        let cells = 0;
        let lowest = Infinity;
        eachCell((o, x, z) => {
            if (plan.shore[o] >= 0) return;
            cells += 1;
            lowest = Math.min(lowest, plan.vaultAt(x, z) - plan.heights[o]);
        });
        expect(cells).toBeGreaterThan(1000);
        // Room to stand in, with air for the jellies above: the rock never comes down to the water.
        expect(lowest).toBeGreaterThan(5);
        // The great dome is over the elder.
        expect(plan.vaultAt(ELDER.x, ELDER.z)).toBeGreaterThan(plan.floorAt(ELDER.x, ELDER.z) + ELDER.height);
        expect(plan.vaultAt(ELDER.x, ELDER.z)).toBeGreaterThan(plan.vaultAt(0, 0));
    });

    it('lists the elder first, then the heroes of the two courts, then the fill by importance', () => {
        const [elder] = plan.mushrooms;
        expect(elder).toMatchObject({
            kind: 'elder', species: PARASOL, x: ELDER.x, z: ELDER.z, height: ELDER.height, capR: ELDER.radius,
        });
        expect(plan.heroCount).toBeGreaterThan(4);
        expect(plan.heroCount).toBeLessThan(plan.mushrooms.length);
        plan.mushrooms.forEach((m, i) => {
            let kind = 'fill';
            if (i === 0) kind = 'elder';
            else if (i < plan.heroCount) kind = 'hero';
            expect(m.kind, `mushroom ${i}`).toBe(kind);
        });
        // A court each side of the pool, all of them the wide caps a lock's light is sent to.
        expect(heroes.every((m) => m.species === PARASOL)).toBe(true);
        expect(heroes.filter((m) => m.x < 0).length).toBeGreaterThan(1);
        expect(heroes.filter((m) => m.x > 0).length).toBeGreaterThan(1);
        // Nothing in the grotto comes near the elder.
        for (const m of plan.mushrooms.slice(1)) {
            expect(m.height).toBeLessThan(elder.height);
            expect(m.capR).toBeLessThan(elder.capR);
        }
        // A tier that draws fewer keeps what fills the picture: the fill is listed by importance,
        // so what a low tier keeps stands taller than what it leaves out.
        const fill = plan.mushrooms.slice(plan.heroCount);
        const quarter = Math.floor(fill.length / 4);
        const mean = (list) => list.reduce((sum, m) => sum + m.height, 0) / list.length;
        expect(mean(fill.slice(0, quarter))).toBeGreaterThan(mean(fill.slice(-quarter)));
        // All three species grow here.
        for (const species of [PARASOL, BELL, GLOBE]) {
            expect(fill.some((m) => m.species === species), `species ${species}`).toBe(true);
        }
    });

    it('roots every mushroom where the floor or the pool says, standing clear of the water', () => {
        plan.mushrooms.forEach((m, i) => {
            const label = `mushroom ${i} (${m.kind})`;
            for (const key of ['x', 'y', 'z', 'height', 'capR', 'stemR', 'yaw', 'seed']) {
                expect(Number.isFinite(m[key]), `${label}.${key}`).toBe(true);
            }
            expect(m.height, label).toBeGreaterThan(0);
            expect(m.capR, label).toBeGreaterThan(0);
            expect(m.stemR, label).toBeGreaterThan(0);
            expect(m.stemR, label).toBeLessThan(m.capR);
            expect([PARASOL, BELL, GLOBE], label).toContain(m.species);
            expect([0, 1, 2], label).toContain(m.family);
            expect(Number.isInteger(m.seed), label).toBe(true);
            expect(m.lean, label).toHaveLength(2);
            expect(Math.hypot(...m.lean), label).toBeLessThan(0.5); // it leans, it never lies down
            expect(inside(m.x, m.z), label).toBe(true);
            // The root is buried in the ground it stands on, or under the water it stands in:
            // no mushroom floats.
            const floor = plan.floorAt(m.x, m.z);
            expect(m.y, label).toBeLessThan(Math.max(floor, 0));
            // And not buried so deep that the cap is lost.
            expect(m.y + m.height, label).toBeGreaterThan(Math.max(floor, 0));
        });
    });

    it('roots every hero by the rule the shader and the choreography share', () => {
        // A mushroom is "rooted in the water" when its root is under it; an upright screen draws
        // those nearer the middle of the pool. The plan decides which: by where the hero stands.
        for (const hero of heroes) {
            const label = `hero at ${hero.x},${hero.z}`;
            const floor = plan.floorAt(hero.x, hero.z);
            if (floor < -0.5) {
                // It wades: rooted under the water, inside the shoreline.
                expect(hero.y, label).toBeLessThan(0);
                expect(plan.shoreAt(hero.x, hero.z), label).toBeLessThan(0);
            } else if (floor > 0.5) {
                // It stands ashore: rooted in the bank, above the water.
                expect(hero.y, label).toBeGreaterThan(0);
                expect(hero.y, label).toBeLessThan(floor);
                expect(plan.shoreAt(hero.x, hero.z), label).toBeGreaterThan(0);
            }
            // Either way its cap is in the air, well over the water.
            expect(capCentre(hero)[1], label).toBeGreaterThan(2);
        }
        // The elder holds its island, above the water.
        expect(plan.mushrooms[0].y).toBeGreaterThan(0);
        expect(plan.mushrooms[0].y).toBeLessThan(plan.floorAt(ELDER.x, ELDER.z));
    });

    it('finds a cap\'s centre at the top of its leaning stem', () => {
        const m = {
            x: 2, y: -0.5, z: -10, height: 4, lean: [0.1, -0.05],
        };
        const out = [9, 9, 9];
        expect(capCentre(m, out)).toBe(out);
        expect(out[0]).toBeCloseTo(2.4, 12);
        expect(out[1]).toBeCloseTo(3.5, 12);
        expect(out[2]).toBeCloseTo(-10.2, 12);
        // Without a target it returns a new point each time.
        const a = capCentre(m);
        expect(a).toEqual(out);
        expect(capCentre(m)).not.toBe(a);
        // Every planned cap is above its root and inside the cave.
        for (const shroom of plan.mushrooms) {
            const [, y] = capCentre(shroom);
            expect(y).toBeGreaterThan(shroom.y);
            expect(y).toBeLessThan(plan.vaultAt(shroom.x, shroom.z));
        }
    });

    it('ranks the fairy-ring sprouts nearest first, each rank strictly inside (0, 1)', () => {
        expect(plan.sprouts.length).toBeGreaterThan(8);
        plan.sprouts.forEach((s, i) => {
            const label = `sprout ${i}`;
            expect(s.kind, label).toBe('sprout');
            expect([BELL, GLOBE], label).toContain(s.species);
            expect([0, 1, 2], label).toContain(s.family);
            expect(s.rank, label).toBeGreaterThan(0);
            expect(s.rank, label).toBeLessThan(1);
            expect(s.height, label).toBeGreaterThan(0);
            expect(s.capR, label).toBeGreaterThan(0);
            expect(s.stemR, label).toBeGreaterThan(0);
            expect(Number.isInteger(s.seed), label).toBe(true);
            // On the ground, at most in a hand's depth of water: a sprout does not grow from the bed.
            expect(s.y, label).toBeLessThanOrEqual(plan.floorAt(s.x, s.z) + 1e-6);
            expect(s.y, label).toBeGreaterThan(-0.6);
            if (i > 0) {
                const before = plan.sprouts[i - 1];
                // They rise in order: a longer chain reaches farther into the cave.
                expect(s.rank, label).toBeGreaterThan(before.rank);
                expect(Math.hypot(s.x, s.z), label).toBeGreaterThanOrEqual(Math.hypot(before.x, before.z));
            }
        });
        // They are small beside the heroes they ring.
        const smallest = Math.min(...heroes.map((m) => m.height));
        expect(Math.max(...plan.sprouts.map((s) => s.height))).toBeLessThan(smallest);
    });

    it('leaves every sprout in the ground at rest, and stands them all for a full chain', () => {
        // The shader grows a sprout of rank r over the window [r − w, r] of the grotto's growth:
        // a rank inside the window would leave a stunted mushroom standing with no chain at all.
        const shader = readFileSync(path.join(themeDir, 'bioluminescence-mushrooms.js'), 'utf8');
        const found = /smoothstep\(rank\.sub\(([\d.]+)\),\s*rank,\s*u\.sprout\)/.exec(shader);
        expect(found, 'the sprouts grow by smoothstep(rank − w, rank, u.sprout)').toBeTruthy();
        const window = Number(found[1]);
        expect(window).toBeGreaterThan(0);
        expect(window).toBeLessThan(1);
        const grown = (rank, growth) => {
            const t = Math.max(0, Math.min(1, (growth - (rank - window)) / window));
            return t * t * (3 - 2 * t);
        };
        plan.sprouts.forEach((s, i) => {
            expect(s.rank, `sprout ${i}`).toBeGreaterThan(window);
            expect(grown(s.rank, 0), `sprout ${i} at rest`).toBe(0);
            expect(grown(s.rank, 1), `sprout ${i} at a full chain`).toBe(1);
        });
        // Growth is the chain: the nearest rise first, and each step of it raises some more.
        let standing = 0;
        for (const growth of [0.2, 0.4, 0.6, 0.8, 1]) {
            const now = plan.sprouts.filter((s) => grown(s.rank, growth) > 0.5).length;
            expect(now, `growth ${growth}`).toBeGreaterThan(standing);
            standing = now;
        }
        expect(standing).toBe(plan.sprouts.length);
    });

    it('marks the two courts: the heroes, their company and their fairy rings, and nothing else', () => {
        const everything = [...plan.mushrooms, ...plan.sprouts];
        const court = everything.filter((m) => m.court);
        // The elder holds its island; every hero belongs to a court.
        expect(plan.mushrooms[0].court).toBeFalsy();
        expect(heroes.every((m) => m.court === true)).toBe(true);
        expect(court.some((m) => m.kind === 'fill')).toBe(true);
        expect(court.some((m) => m.kind === 'sprout')).toBe(true);
        expect(court.some((m) => m.x < 0)).toBe(true);
        expect(court.some((m) => m.x > 0)).toBe(true);
        // A court moves as one on an upright screen, so whatever is in it stands by a hero.
        for (const m of court) {
            if (m.kind === 'hero') continue;
            const nearest = Math.min(...heroes.map((h) => (Math.hypot(h.x - m.x, h.z - m.z) - h.capR * 1.3)));
            expect(nearest, `${m.kind} at ${m.x.toFixed(1)},${m.z.toFixed(1)}`).toBeLessThan(1.5);
        }
        // It is a plan's decision, not the lie of the land: both courts have members rooted in
        // the water and members rooted on a bank.
        expect(court.some((m) => m.y < -0.1)).toBe(true);
        expect(court.some((m) => m.y > 0.1)).toBe(true);
        // What grows on the outcrops in the shallows stays on them.
        for (const m of everything) {
            if (ISLETS.some(([ix, iz, r]) => Math.hypot(m.x - ix, m.z - iz) < r * 0.5)) {
                expect(m.court, `${m.kind} on an islet at ${m.x.toFixed(1)},${m.z.toFixed(1)}`).toBeFalsy();
            }
        }
        // Most of the grotto is not in a court.
        expect(court.length).toBeLessThan(everything.length / 2);
    });

    it('stands every crystal on a unit axis, from a buried root to its tip', () => {
        const clusters = new Set();
        plan.crystals.forEach((crystal, index) => {
            const label = `crystal ${index}`;
            clusters.add(crystal.cluster);
            for (const key of ['x', 'y', 'z', 'height', 'radius', 'yaw', 'hue', 'seed']) {
                expect(Number.isFinite(crystal[key]), `${label}.${key}`).toBe(true);
            }
            expect(crystal.height, label).toBeGreaterThan(0);
            expect(crystal.radius, label).toBeGreaterThan(0);
            expect(crystal.radius, label).toBeLessThan(crystal.height);
            expect(crystal.hue, label).toBeGreaterThanOrEqual(0);
            expect(crystal.hue, label).toBeLessThan(1);
            expect(Number.isInteger(crystal.seed), label).toBe(true);
            expect(crystal.seed, label).toBeGreaterThan(0);
            expect(Math.hypot(...crystal.axis), label).toBeCloseTo(1, 9);
            expect(crystal.axis[1], label).toBeGreaterThan(0.5);
            for (let c = 0; c < 3; c++) {
                const root = [crystal.x, crystal.y, crystal.z][c];
                expect(crystal.tip[c], label).toBeCloseTo(root + crystal.axis[c] * crystal.height, 9);
            }
            // The root is under the bed or the water: no stone floats.
            const ground = Math.max(plan.floorAt(crystal.x, crystal.z), 0);
            expect(crystal.y, label).toBeLessThan(ground);
            // And its point shows above both: a stone wholly under the pool is drawn and never seen.
            expect(crystal.tip[1], label).toBeGreaterThan(0);
            expect(crystal.tip[1], label).toBeGreaterThan(ground);
            expect(inside(crystal.x, crystal.z), label).toBe(true);
        });
        // The plan lists as many as the fullest tier draws: a budget above that buys nothing.
        const most = Math.max(...QUALITY_NAMES.map((name) => QUALITY[name].crystals));
        expect(plan.crystals.length).toBeGreaterThanOrEqual(most);
        // Clusters, listed one after another, each with its tallest stone first.
        expect(clusters.size).toBeGreaterThan(1);
        for (let i = 1; i < plan.crystals.length; i++) {
            expect(plan.crystals[i].cluster).toBeGreaterThanOrEqual(plan.crystals[i - 1].cluster);
        }
        for (const cluster of clusters) {
            const mine = plan.crystals.filter((crystal) => crystal.cluster === cluster);
            expect(mine[0].height, `cluster ${cluster}`).toBe(Math.max(...mine.map((crystal) => crystal.height)));
            expect(mine[0].tip[1], `cluster ${cluster}`).toBeGreaterThan(0);
        }
    });

    it('joins floor and vault with columns, hangs stalactites and stands stalagmites', () => {
        const columns = plan.spikes.filter((spike) => spike.column);
        expect(columns.length).toBeGreaterThan(0);
        // The columns come first, so every tier draws them.
        expect(plan.spikes.slice(0, columns.length).every((spike) => spike.column)).toBe(true);
        let hanging = 0;
        let standing = 0;
        plan.spikes.forEach((spike, index) => {
            const label = `spike ${index}`;
            for (const key of ['x', 'y', 'z', 'length', 'radius', 'seed']) {
                expect(Number.isFinite(spike[key]), `${label}.${key}`).toBe(true);
            }
            expect(spike.radius, label).toBeGreaterThan(0);
            const floor = plan.floorAt(spike.x, spike.z);
            const vault = plan.vaultAt(spike.x, spike.z);
            if (spike.column) {
                expect(spike.y, label).toBeLessThan(floor);
                expect(spike.y + spike.length, label).toBeGreaterThan(vault);
            } else if (spike.length < 0) {
                hanging += 1;
                // Rooted in the vault, ending in the air.
                expect(spike.y, label).toBeGreaterThan(vault);
                expect(spike.y + spike.length, label).toBeGreaterThan(floor);
            } else {
                standing += 1;
                // Rooted in the floor, on dry ground, ending in the air.
                expect(spike.y, label).toBeLessThan(floor);
                expect(spike.y + spike.length, label).toBeLessThan(vault);
                expect(plan.shoreAt(spike.x, spike.z), label).toBeGreaterThan(0);
            }
        });
        expect(hanging).toBeGreaterThan(0);
        expect(standing).toBeGreaterThan(0);
    });

    it('hangs the glow-worms on the vault, nearest first', () => {
        plan.worms.forEach((worm, index) => {
            const label = `worm ${index}`;
            const vault = plan.vaultAt(worm.x, worm.z);
            expect(worm.y, label).toBeLessThanOrEqual(vault);
            expect(worm.y, label).toBeGreaterThan(vault - 1);
            expect(worm.seed, label).toBeGreaterThanOrEqual(0);
            expect(worm.seed, label).toBeLessThan(1);
            // A worm of rank r lights once the grotto's wakefulness passes r.
            expect(worm.rank, label).toBeGreaterThanOrEqual(0);
            expect(worm.rank, label).toBeLessThan(1);
            expect(worm.thread, label).toBeGreaterThan(0);
            if (index > 0) expect(worm.order, label).toBeGreaterThanOrEqual(plan.worms[index - 1].order);
        });
        // The ranks are spread: some worms are lit at rest, a chain has more to kindle.
        const ranks = plan.worms.map((worm) => worm.rank);
        expect(ranks.filter((rank) => rank < 0.3).length).toBeGreaterThan(plan.worms.length * 0.1);
        expect(ranks.filter((rank) => rank > 0.7).length).toBeGreaterThan(plan.worms.length * 0.1);
    });

    it('hangs the vines from the vault over both courts, clear of the floor', () => {
        plan.vines.forEach((vine, index) => {
            const label = `vine ${index}`;
            expect(vine.y, label).toBeGreaterThanOrEqual(plan.vaultAt(vine.x, vine.z));
            expect(vine.length, label).toBeGreaterThan(0);
            expect(vine.y - vine.length, label).toBeGreaterThan(plan.floorAt(vine.x, vine.z));
            expect(vine.y - vine.length, label).toBeGreaterThan(0);
            expect(Number.isInteger(vine.pods), label).toBe(true);
            expect(vine.pods, label).toBeGreaterThan(0); // the shader divides by it
            expect([0, 1, 2], label).toContain(vine.family);
            expect(vine.seed, label).toBeGreaterThanOrEqual(0);
            expect(vine.seed, label).toBeLessThan(1);
        });
        expect(plan.vines.filter((vine) => vine.x < 0).length).toBeGreaterThan(0);
        expect(plan.vines.filter((vine) => vine.x > 0).length).toBeGreaterThan(0);
    });

    it('gives every jelly a home in the air, either side of the pool\'s middle', () => {
        plan.jellies.forEach((jelly, index) => {
            const label = `jelly ${index}`;
            for (const key of ['x', 'y', 'z', 'size', 'seed', 'family']) {
                expect(Number.isFinite(jelly[key]), `${label}.${key}`).toBe(true);
            }
            expect(jelly.y, label).toBeGreaterThan(0);
            expect(jelly.y, label).toBeLessThan(plan.vaultAt(jelly.x, jelly.z));
            expect(jelly.z, label).toBeLessThan(0); // ahead of the viewer
            expect(jelly.size, label).toBeGreaterThan(0);
            expect([0, 1, 2], label).toContain(jelly.family);
            expect(inside(jelly.x, jelly.z), label).toBe(true);
        });
        expect(plan.jellies.filter((jelly) => jelly.x < 0).length).toBeGreaterThan(0);
        expect(plan.jellies.filter((jelly) => jelly.x > 0).length).toBeGreaterThan(0);
        // The ones that drift at rest are the first the plan lists.
        expect(jelliesForCombo(0)).toBeLessThanOrEqual(plan.jellies.length);
    });

    it('floats the pads on the water near the shores, and lets the drips fall into the pool', () => {
        plan.pads.forEach((pad, index) => {
            const label = `pad ${index}`;
            expect(plan.shoreAt(pad.x, pad.z), label).toBeLessThan(0);
            expect(pad.r, label).toBeGreaterThan(0);
            expect(pad.seed, label).toBeGreaterThanOrEqual(0);
            expect(pad.seed, label).toBeLessThan(1);
            expect([0, 1, 2], label).toContain(pad.family);
            // No two lie on top of each other.
            for (let other = 0; other < index; other++) {
                const lily = plan.pads[other];
                expect(Math.hypot(pad.x - lily.x, pad.z - lily.z), `${label} and ${other}`).toBeGreaterThan(lily.r);
            }
        });
        plan.drips.forEach((drip, index) => {
            const label = `drip ${index}`;
            expect(plan.shoreAt(drip.x, drip.z), label).toBeLessThan(0);
            expect(drip.period, label).toBeGreaterThan(0); // the shader divides by it
            expect(drip.phase, label).toBeGreaterThanOrEqual(0);
            expect(drip.phase, label).toBeLessThan(1);
        });
    });

    it('lights the grotto from its great caps and its crystals: at most EMITTER_MAX lamps', () => {
        expect(plan.emitters.length).toBeLessThanOrEqual(EMITTER_MAX);
        const [first] = plan.emitters;
        // The elder's lamp is the first row: the choreography recolours row 0 for the Great Bloom.
        expect(first).toMatchObject({ kind: 'cap', source: 0 });
        const sources = new Set();
        plan.emitters.forEach((lamp, index) => {
            const label = `lamp ${index}`;
            for (const key of ['x', 'y', 'z', 'radius', 'gain', 'family']) {
                expect(Number.isFinite(lamp[key]), `${label}.${key}`).toBe(true);
            }
            expect(lamp.radius, label).toBeGreaterThan(0); // the shaders divide by r² + radius²
            expect(lamp.gain, label).toBeGreaterThan(0);
            expect(inside(lamp.x, lamp.z), label).toBe(true);
            expect(['cap', 'crystal'], label).toContain(lamp.kind);
            if (lamp.kind === 'cap') {
                // A cap's lamp belongs to the elder or a hero, hangs just under that cap and is
                // not listed twice.
                expect(lamp.source, label).toBeLessThan(plan.heroCount);
                expect(sources.has(lamp.source), label).toBe(false);
                sources.add(lamp.source);
                const shroom = plan.mushrooms[lamp.source];
                const [cx, cy, cz] = capCentre(shroom);
                expect(Math.hypot(lamp.x - cx, lamp.y - cy, lamp.z - cz), label).toBeLessThan(shroom.capR);
                expect(lamp.y, label).toBeLessThanOrEqual(cy);
                expect(lamp.family, label).toBe(shroom.family);
            } else {
                // A crystal cluster's lamp stands where its stones do.
                const near = plan.crystals.some((crystal) => Math.hypot(crystal.x - lamp.x, crystal.z - lamp.z) < 3);
                expect(near, label).toBe(true);
            }
        });
        expect(plan.emitters.some((lamp) => lamp.kind === 'crystal')).toBe(true);
        // Both courts have a lamp of their own.
        const caps = plan.emitters.filter((lamp) => lamp.kind === 'cap' && lamp.source > 0);
        expect(caps.some((lamp) => lamp.x < 0)).toBe(true);
        expect(caps.some((lamp) => lamp.x > 0)).toBe(true);
    });
});

describe('bioluminescence tiers', () => {
    it('defines every quality tier', () => {
        expect(QUALITY_NAMES).toEqual(['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme']);
        for (const name of QUALITY_NAMES) {
            expect(QUALITY[name]).toBeTruthy();
            expect(tierFor(name)).toBe(QUALITY[name]);
            expect(Object.isFrozen(QUALITY[name])).toBe(true);
        }
        expect(tierFor('nope')).toBe(QUALITY.High);
        expect(tierFor(undefined)).toBe(QUALITY.High);
        // Every tier answers the same questions.
        const keys = Object.keys(QUALITY.High).sort();
        for (const name of QUALITY_NAMES) expect(Object.keys(QUALITY[name]).sort(), name).toEqual(keys);
    });

    it('scales every budget monotonically with the tier', () => {
        const budgets = [
            'mushrooms', 'sprouts', 'crystals', 'spikes', 'worms', 'threads', 'vines', 'motes', 'jellies', 'spores', 'pads',
            'lamps', 'scatter', 'reflection',
        ];
        for (let i = 1; i < QUALITY_NAMES.length; i++) {
            const a = QUALITY[QUALITY_NAMES[i - 1]];
            const b = QUALITY[QUALITY_NAMES[i]];
            for (const key of budgets) {
                expect(b[key], `${QUALITY_NAMES[i]}.${key}`).toBeGreaterThanOrEqual(a[key]);
            }
            expect(Number(b.sparkle), `${QUALITY_NAMES[i]}.sparkle`).toBeGreaterThanOrEqual(Number(a.sparkle));
        }
    });

    it('never asks for more than can exist, and keeps the picture and every event on every tier', () => {
        for (const name of QUALITY_NAMES) {
            const tier = QUALITY[name];
            expect(tier.mushrooms, name).toBeLessThanOrEqual(MAX_MUSHROOMS);
            expect(tier.sprouts, name).toBeLessThanOrEqual(MAX_SPROUTS);
            expect(tier.crystals, name).toBeLessThanOrEqual(MAX_CRYSTALS);
            expect(tier.spikes, name).toBeLessThanOrEqual(MAX_SPIKES);
            expect(tier.worms, name).toBeLessThanOrEqual(MAX_WORMS);
            expect(tier.vines, name).toBeLessThanOrEqual(MAX_VINES);
            expect(tier.pads, name).toBeLessThanOrEqual(MAX_PADS);
            expect(tier.jellies, name).toBeLessThanOrEqual(JELLY_MAX);
            expect(tier.lamps, name).toBeLessThanOrEqual(EMITTER_MAX);
            // A halo in the mist is for a lamp that also lights the rock; a thread hangs from a worm.
            expect(tier.scatter, name).toBeLessThanOrEqual(tier.lamps);
            expect(tier.threads, name).toBeLessThanOrEqual(tier.worms);
            // The elder and both courts, so a swimmer always has a cap to reach...
            expect(tier.mushrooms, name).toBeGreaterThanOrEqual(plan.heroCount);
            expect(tier.lamps, name).toBeGreaterThan(0);
            // ...sprouts for a chain to raise, more jellies than drift at rest, spores to throw,
            // crystals to chime, worms to kindle.
            expect(tier.sprouts, name).toBeGreaterThan(0);
            expect(tier.jellies, name).toBeGreaterThan(jelliesForCombo(0));
            expect(tier.spores, name).toBeGreaterThan(0);
            expect(tier.crystals, name).toBeGreaterThan(0);
            expect(tier.worms, name).toBeGreaterThan(0);
            expect(tier.reflection, name).toBeGreaterThanOrEqual(0);
            expect(tier.reflection, name).toBeLessThanOrEqual(1);
        }
    });

    it('pays for what the plan can deliver: no tier budgets more mushrooms, sprouts or crystals than it lists', () => {
        // (A budget the plan cannot fill makes two tiers the same tier without saying so.)
        for (const name of QUALITY_NAMES) {
            const tier = QUALITY[name];
            expect(tier.mushrooms, `${name}.mushrooms`).toBeLessThanOrEqual(plan.mushrooms.length);
            expect(tier.sprouts, `${name}.sprouts`).toBeLessThanOrEqual(plan.sprouts.length);
            expect(tier.crystals, `${name}.crystals`).toBeLessThanOrEqual(plan.crystals.length);
        }
    });
});
