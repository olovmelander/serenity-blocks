import { describe, expect, it } from 'vitest';

import { FOREST_SHADE_PLATE, FOREST_WORLD_SCALE, bakeForestShadeData } from './odyssey-forest-shade.js';
import { ODYSSEY_WORLD_SUN } from '../chapter-environments/shared/chapter-profile.js';

/**
 * The forest's shade on the ground (Act II pass, step 3). Checked on flat ground, where the
 * answer is geometry: a crown's shadow lies AWAY from the sun at height / tan(elevation), its
 * cover sits under the tree, and the plate is empty where no tree stands.
 */

const RES = 512;
const P = FOREST_SHADE_PLATE;
const texel = P.extent / RES;
const flat = () => 300;
const tree = (speciesId, x = P.x, z = P.z) => ({
    x, y: 300, z, speciesId, scaleXZ: 1, scaleY: 1, crown: [0.2, 0.3, 0.1],
});
const at = (bake, x, z, ch) => {
    const i = Math.floor(((x - (P.x - (P.extent / 2))) / texel));
    const j = Math.floor(((z - (P.z - (P.extent / 2))) / texel));
    return bake.data[(((j * RES) + i) * 4) + ch] / 255;
};
const sun = ODYSSEY_WORLD_SUN;
const len = Math.hypot(...sun);
const away = [-sun[0] / Math.hypot(sun[0], sun[2]), -sun[2] / Math.hypot(sun[0], sun[2])];
const cotE = Math.hypot(sun[0], sun[2]) / sun[1];

describe('the forest shade plate', () => {
    it('is empty where no tree stands', () => {
        const bake = bakeForestShadeData([], flat, { res: RES });
        expect(bake.data.every((v) => v === 0)).toBe(true);
        expect(bake.res).toBe(RES);
    });

    it('throws a fir\'s shadow away from the sun, a sun-height cotangent out, and none toward it', () => {
        const bake = bakeForestShadeData([tree('S2-workhorse-pine')], flat, { res: RES });
        // The pine's crown middle stands ~2.5 local units up: its shadow lies ~cot(e) x that out.
        const reach = 2.5 * FOREST_WORLD_SCALE * cotE;
        expect(at(bake, P.x + (away[0] * reach), P.z + (away[1] * reach), 0)).toBeGreaterThan(0.5);
        expect(at(bake, P.x - (away[0] * reach), P.z - (away[1] * reach), 0)).toBe(0);
        // Off to the side of the shadow's axis, well past the crown's width: clear.
        expect(at(bake, P.x + (away[1] * 30), P.z - (away[0] * 30), 0)).toBe(0);
        expect(sun[1] / len).toBeLessThan(0.5);
    });

    it('lays the canopy cover under the tree, with its colour premultiplied by it', () => {
        const bake = bakeForestShadeData([tree('S1-shore-broadleaf')], flat, { res: RES });
        const cover = at(bake, P.x, P.z, 1);
        expect(cover).toBeGreaterThan(0.6); // (the sampled texel centre is half a 7 u texel off the trunk)
        // B / G and A / G give the crown's red and green back (stored over `colourScale`).
        expect((at(bake, P.x, P.z, 2) / cover) * P.colourScale).toBeCloseTo(0.2, 1);
        expect((at(bake, P.x, P.z, 3) / cover) * P.colourScale).toBeCloseTo(0.3, 1);
        expect(at(bake, P.x + 40, P.z + 40, 1)).toBe(0);
    });

    it('lets light through a broadleaf\'s shadow, and not through a fir\'s', () => {
        const mean = (speciesId) => {
            const bake = bakeForestShadeData([tree(speciesId)], flat, { res: RES });
            let sum = 0;
            let n = 0;
            for (let k = 0; k < RES * RES; k += 1) {
                const v = bake.data[k * 4];
                if (v > 0) { sum += v; n += 1; }
            }
            return sum / n / 255;
        };
        expect(mean('S1-shore-broadleaf')).toBeLessThan(mean('S2-workhorse-pine'));
    });
});
