import { describe, expect, it } from 'vitest';
import { DataUtils } from 'three';

import {
    ODYSSEY_SCULPT_PLATE,
    ODYSSEY_TARN,
    ODYSSEY_TARN_BOX,
    ODYSSEY_TARN_PLATE,
    odysseyTarnCarve,
    odysseyTarnDistance,
    odysseyTarnRn,
    odysseyWorldDetailWeight,
    odysseyWorldHeight,
    odysseyWorldMacro,
    odysseyWorldRelief,
} from './odyssey-world-height.js';
import { bakeSculptPlateData, bakeTarnPlateData } from './odyssey-world-bake-data.js';
import { buildTarnSurface, TARN_SURFACE } from './odyssey-tarn-surface.js';
import { scatterZonedForest } from './odyssey-forest-scatter.js';
import { getOdysseyPathPointAt, getOdysseyWorldRailPointAt } from '../path-utils.js';

/**
 * THE TARN (Act II pass, step 6; redrawn 2026-11-20): the pond in the chapter-3 basin's meadow.
 * Its shore is a drawn outline (ODYSSEY_TARN.outline, with an islet), the ground across it a
 * profile of the distance to that line (shelf, drop, rolling floor; beach and bank), carried to
 * the shader by its own plate (ODYSSEY_TARN_PLATE), and the water one sheet cut to the shore
 * (odyssey-tarn-surface.js). These hold the form: the waterline where the shore is drawn, water
 * where the swans swim and a shelf where the bed shows, nothing changed past the bank, and the
 * plate that draws it exact.
 */
const W = ODYSSEY_TARN.waterY;
const groundAt = (x, z) => odysseyWorldMacro(x, z) + (odysseyWorldRelief(x, z) * odysseyWorldDetailWeight(x, z));
const [X0, X1, Z0, Z1] = ODYSSEY_TARN_BOX;

/** Every point of a grid over the tarn's box, `step` u apart. */
function grid(step) {
    const out = [];
    for (let z = Z0 + (step / 2); z < Z1; z += step) {
        for (let x = X0 + (step / 2); x < X1; x += step) out.push([x, z]);
    }
    return out;
}
const G2 = grid(2);

describe('the tarn in the meadow', () => {
    it('leaves the meadow alone past its bank', () => {
        let checked = 0;
        G2.forEach(([x, z]) => {
            if (odysseyTarnDistance(x, z) < ODYSSEY_TARN.bank) return;
            checked += 1;
            expect(odysseyTarnCarve(x, z, groundAt(x, z)), `(${x}, ${z})`).toBe(0);
        });
        expect(checked).toBeGreaterThan(G2.length * 0.25);
        // ...and outside its box entirely.
        [[X0 - 5, -440], [X1 + 5, -440], [-240, Z0 - 5], [-240, Z1 + 5]].forEach(([x, z]) => {
            expect(odysseyTarnCarve(x, z, groundAt(x, z))).toBe(0);
        });
    });

    it('draws its waterline where its shore is: water inside, dry ground outside', () => {
        G2.forEach(([x, z]) => {
            const d = odysseyTarnDistance(x, z);
            const h = odysseyWorldHeight(x, z);
            if (d <= -1) expect(h, `water at (${x}, ${z}), ${d.toFixed(1)} u in`).toBeLessThan(W - 0.05);
            if (d >= 0.5) expect(h, `bank at (${x}, ${z}), ${d.toFixed(1)} u out`).toBeGreaterThanOrEqual(W);
            expect(h).toBeGreaterThanOrEqual(ODYSSEY_TARN.floorY - 1e-6);
        });
    });

    it('is one water round an islet, with basins deep enough to swim and a shelf the bed shows through', () => {
        // One body: a flood fill over the wet cells reaches them all.
        const wet = new Set(G2.filter(([x, z]) => odysseyTarnDistance(x, z) < 0).map(([x, z]) => `${x},${z}`));
        const [start] = wet;
        const seen = new Set([start]);
        const todo = [start];
        while (todo.length) {
            const [x, z] = todo.pop().split(',').map(Number);
            [[2, 0], [-2, 0], [0, 2], [0, -2]].forEach(([dx, dz]) => {
                const k = `${x + dx},${z + dz}`;
                if (wet.has(k) && !seen.has(k)) {
                    seen.add(k);
                    todo.push(k);
                }
            });
        }
        expect(seen.size).toBe(wet.size);
        // The islet stands out of the water.
        const islet = ODYSSEY_TARN.islet.reduce((c, [x, z]) => [c[0] + (x / ODYSSEY_TARN.islet.length), c[1] + (z / ODYSSEY_TARN.islet.length)], [0, 0]);
        expect(odysseyTarnDistance(islet[0], islet[1])).toBeGreaterThan(1);
        expect(odysseyWorldHeight(islet[0], islet[1])).toBeGreaterThan(W + 0.5);
        // Deep enough to swim, not a hole; shallow by the shore.
        let deepest = 0;
        let shelfDeepest = 0;
        G2.forEach(([x, z]) => {
            const d = odysseyTarnDistance(x, z);
            if (d >= 0) return;
            const depth = W - odysseyWorldHeight(x, z);
            deepest = Math.max(deepest, depth);
            if (d > -1.5) shelfDeepest = Math.max(shelfDeepest, depth);
        });
        expect(deepest).toBeGreaterThan(2.5);
        expect(deepest).toBeLessThan(5.2);
        expect(shelfDeepest).toBeLessThan(0.5);
    });

    it('is drawn by its own plate, exact in the water and zero on its border', () => {
        const P = ODYSSEY_TARN_PLATE;
        const plate = bakeTarnPlateData();
        expect([plate.resX, plate.resZ]).toEqual([P.resX, P.resZ]);
        const dx = (X1 - X0) / P.resX;
        const dz = (Z1 - Z0) / P.resZ;
        const texel = (i, j) => {
            const k = ((j * P.resX) + i) * 4;
            return [0, 1, 2, 3].map((c) => DataUtils.fromHalfFloat(plate.data[k + c]));
        };
        // The shader's height is ground * (1 - G) + waterY * G + R: in the water G = 1 and the
        // height is the tarn's own, to the half float's step.
        let water = 0;
        for (let j = 0; j < P.resZ; j += 4) {
            for (let i = 0; i < P.resX; i += 4) {
                const [r, g] = texel(i, j);
                if (g < 1) continue;
                water += 1;
                const x = X0 + ((i + 0.5) * dx);
                const z = Z0 + ((j + 0.5) * dz);
                expect(Math.abs((W + r) - odysseyWorldHeight(x, z)), `(${x.toFixed(1)}, ${z.toFixed(1)})`).toBeLessThan(0.01);
            }
        }
        expect(water).toBeGreaterThan(100);
        // The border: no weight, no lift, so a clamped sampler adds nothing outside the box.
        for (let i = 0; i < P.resX; i += 1) {
            [texel(i, 0), texel(i, P.resZ - 1)].forEach(([r, g]) => expect([r, g]).toEqual([0, 0]));
        }
        for (let j = 0; j < P.resZ; j += 1) {
            [texel(0, j), texel(P.resX - 1, j)].forEach(([r, g]) => expect([r, g]).toEqual([0, 0]));
        }
    });

    it('leaves the sculpt plate to the summit: its border reads zero', () => {
        const S = ODYSSEY_SCULPT_PLATE;
        const plate = bakeSculptPlateData(96);
        for (let i = 0; i < 96; i += 1) {
            [[i, 0], [i, 95], [0, i], [95, i]].forEach(([u, v]) => {
                expect(Math.abs(plate.data[((v * 96) + u) * 4])).toBe(0);
            });
        }
        // The tarn is nowhere in it: at the tarn's middle the sculpt adds nothing.
        const u = Math.round((((-260 - S.x) / S.extent) + 0.5) * 95);
        const v = Math.round((((-440 - S.z) / S.extent) + 0.5) * 95);
        expect(plate.data[((v * 96) + u) * 4]).toBe(0);
    });

    it('lays its water sheet over all of its water', () => {
        const { positions, indices } = buildTarnSurface();
        expect(indices.length % 3).toBe(0);
        expect(positions.every((v, i) => i % 3 !== 1 || v === W)).toBe(true);
        // Every wet point lies in a cell the sheet holds (a cell is kept when one of its corners is
        // within the margin of the water; a wet point's corners are within a cell's diagonal).
        expect(TARN_SURFACE.cell * Math.SQRT2).toBeLessThan(TARN_SURFACE.margin);
        // Up-facing: the first triangle's normal points up.
        const p = (k) => [positions[k * 3], positions[(k * 3) + 1], positions[(k * 3) + 2]];
        const [a, b, c] = [p(indices[0]), p(indices[1]), p(indices[2])];
        const ny = ((b[2] - a[2]) * (c[0] - a[0])) - ((b[0] - a[0]) * (c[2] - a[2]));
        expect(ny).toBeGreaterThan(0);
    });

    it('keeps its near meadow open: no tree in the water, and only the authored clumps on its banks', () => {
        const rail = Array.from({ length: 48 }, (_, i) => getOdysseyWorldRailPointAt(i / 47));
        const forest = scatterZonedForest(odysseyWorldHeight, { rail, visibilityCull: false });
        forest.placements.forEach((p) => {
            const at = `${p.speciesId} at (${p.x.toFixed(0)}, ${p.z.toFixed(0)})`;
            // Nothing stands in the water (the islet's pine is on the islet).
            expect(odysseyTarnDistance(p.x, p.z), at).toBeGreaterThan(1.1);
            if (p.framing || odysseyTarnRn(p.x, p.z) > ODYSSEY_TARN.clearing - 1e-6) return;
            // Inside the clearing only the waterside clumps (FOREST_MASSES) stand, and on the bank the
            // rail looks over (the south) only the two low ones at its ends.
            expect(p.wood, at).toBe('waterside');
            if (p.z > -400 && p.x > -282 && p.x < -176) throw new Error(`${at} stands between the rail and the water`);
        });
    });

    it('stays well under the rail where the climb flies over it', () => {
        let lowest = Infinity;
        for (let p = 0.2; p < 0.4; p += 0.0005) {
            const pt = getOdysseyPathPointAt(p);
            if (odysseyTarnDistance(pt.x, pt.z) < 10) lowest = Math.min(lowest, pt.y - W);
        }
        expect(lowest).toBeGreaterThan(60);
    });
});
