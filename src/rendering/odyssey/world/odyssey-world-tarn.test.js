import { describe, expect, it } from 'vitest';

import {
    ODYSSEY_SCULPT_PLATE,
    ODYSSEY_TARN,
    odysseyTarnCarve,
    odysseyTarnRn,
    odysseyWorldDetailWeight,
    odysseyWorldHeight,
    odysseyWorldMacro,
    odysseyWorldRelief,
} from './odyssey-world-height.js';
import { bakeSculptPlateData } from './odyssey-world-bake-data.js';
import { scatterZonedForest } from './odyssey-forest-scatter.js';
import { getOdysseyPathPointAt } from '../path-utils.js';

/**
 * THE TARN (Act II pass, step 6): the pond in the chapter-3 basin's meadow. Its water is a flat
 * disc per lobe at `waterY`, and the shoreline is wherever the carved ground rises through it, so
 * the shape only works if three things hold: the carve is exactly zero outside the lobes, the
 * natural ground on every disc's rim stands above the water (the disc's edge is buried), and the
 * carved ground dips under the water inside.
 */
const groundAt = (x, z) => odysseyWorldMacro(x, z) + (odysseyWorldRelief(x, z) * odysseyWorldDetailWeight(x, z));

describe('the tarn in the meadow', () => {
    it('carves nothing outside its lobes', () => {
        ODYSSEY_TARN.lobes.forEach((lb) => {
            for (let a = 0; a < 48; a += 1) {
                const th = (a / 48) * Math.PI * 2;
                for (const f of [1.0, 1.2, 1.6]) {
                    const x = lb.x + (Math.cos(th) * lb.rx * f);
                    const z = lb.z + (Math.sin(th) * lb.rz * f);
                    if (odysseyTarnRn(x, z) < 1.06) continue; // a point on one lobe's rim inside another
                    expect(Math.abs(odysseyTarnCarve(x, z, groundAt(x, z)))).toBe(0);
                }
            }
        });
    });

    it('buries every disc edge: the meadow on each lobe\'s rim stands above the water', () => {
        const insideAnother = (x, z, self) => ODYSSEY_TARN.lobes.some((o) => o !== self
            && Math.hypot((x - o.x) / o.rx, (z - o.z) / o.rz) < 1);
        ODYSSEY_TARN.lobes.forEach((lb) => {
            for (let a = 0; a < 96; a += 1) {
                const th = (a / 96) * Math.PI * 2;
                const x = lb.x + (Math.cos(th) * lb.rx);
                const z = lb.z + (Math.sin(th) * lb.rz);
                if (insideAnother(x, z, lb)) continue; // the waist, where two lobes are one water
                expect(odysseyWorldHeight(x, z), `rim of (${lb.x}, ${lb.z}) at ${a}`)
                    .toBeGreaterThan(ODYSSEY_TARN.waterY + 0.5);
            }
        });
    });

    it('holds water: the carved ground dips under the surface at every lobe\'s heart', () => {
        ODYSSEY_TARN.lobes.forEach((lb) => {
            expect(odysseyWorldHeight(lb.x, lb.z)).toBeLessThan(ODYSSEY_TARN.waterY - 1);
            expect(odysseyWorldHeight(lb.x, lb.z)).toBeGreaterThanOrEqual(ODYSSEY_TARN.floorY - 0.01);
        });
    });

    it('lives on the sculpt plate, inside its border', () => {
        const S = ODYSSEY_SCULPT_PLATE;
        ODYSSEY_TARN.lobes.forEach((lb) => {
            expect(lb.x - lb.rx).toBeGreaterThan(S.x - (S.extent / 2) + 10);
            expect(lb.x + lb.rx).toBeLessThan(S.x + (S.extent / 2) - 10);
            expect(lb.z - lb.rz).toBeGreaterThan(S.z - (S.extent / 2) + 10);
            expect(lb.z + lb.rz).toBeLessThan(S.z + (S.extent / 2) - 10);
        });
        const plate = bakeSculptPlateData(96);
        // The plate's border reads zero (a clamped sampler extends it to the whole world).
        for (let i = 0; i < 96; i += 1) {
            [[i, 0], [i, 95], [0, i], [95, i]].forEach(([u, v]) => {
                expect(Math.abs(plate.data[((v * 96) + u) * 4])).toBe(0);
            });
        }
    });

    it('keeps its meadow open: no tree stands in the water or its clearing', () => {
        const rail = Array.from({ length: 48 }, (_, i) => getOdysseyPathPointAt(i / 47));
        const forest = scatterZonedForest(odysseyWorldHeight, { rail, visibilityCull: false });
        forest.placements.forEach((p) => {
            expect(odysseyTarnRn(p.x, p.z), `${p.speciesId} at (${p.x.toFixed(0)}, ${p.z.toFixed(0)})`)
                .toBeGreaterThan(ODYSSEY_TARN.clearing - 1e-6);
        });
    });

    it('stays well under the rail where the climb flies over it', () => {
        let nearest = { d: Infinity, y: 0 };
        for (let p = 0.2; p < 0.4; p += 0.0005) {
            const pt = getOdysseyPathPointAt(p);
            const d = Math.min(...ODYSSEY_TARN.lobes.map((lb) => Math.hypot(
                (pt.x - lb.x) / lb.rx,
                (pt.z - lb.z) / lb.rz,
            )));
            if (d < nearest.d) nearest = { d, y: pt.y };
        }
        expect(nearest.y - ODYSSEY_TARN.waterY).toBeGreaterThan(60);
    });
});
