import { describe, expect, it } from 'vitest';
import { buildCloudLobes } from './odyssey-cloud-field.js';
import { CLOUD_FIELD_ANCHOR, ODYSSEY_CLOUD_FIELD_SPECS } from './odyssey-cloud-field-specs.js';
import { ODYSSEY_MASSIFS } from './odyssey-world-height.js';
import {
    WATER_CLOUD_SLOTS, buildWaterCloudProxies, selectWaterClouds, waterCloudDrift,
} from './odyssey-water-clouds.js';

const hero = ODYSSEY_MASSIFS.find((m) => m.id === CLOUD_FIELD_ANCHOR.massif);
const ANCHOR = { x: hero.x, z: hero.z, radius: CLOUD_FIELD_ANCHOR.radius };
const DRIFT = {
    xz: 145, y: 26, periodMin: 70, periodMax: 165,
};
const proxies = buildWaterCloudProxies(ODYSSEY_CLOUD_FIELD_SPECS, ANCHOR);
const rows = () => Array.from({ length: WATER_CLOUD_SLOTS * 3 }, () => ({
    x: 0, y: 0, z: 0, w: 0,
}));

describe('clouds in the water', () => {
    it('fits each mass: its lobe centres inside the ellipsoid, its base below the centre', () => {
        ODYSSEY_CLOUD_FIELD_SPECS.forEach((spec, i) => {
            const p = proxies[i];
            expect(p.baseQ).toBeLessThan(-0.5);
            buildCloudLobes(spec).forEach((l) => {
                const dx = l.x - p.x;
                const dz = l.z - p.z;
                const lx = ((dx * p.cos) + (dz * p.sin)) / p.a;
                const lz = ((-dx * p.sin) + (dz * p.cos)) / p.c;
                const ly = (l.y - p.y) / p.b;
                expect(Math.hypot(lx, ly, lz)).toBeLessThan(1);
            });
        });
    });

    it('drifts as the field does, and holds the banner to its summit', () => {
        const out = { x: 0, y: 0, z: 0 };
        const banner = proxies.find((p) => p.id.startsWith('B1'));
        waterCloudDrift(banner, 123.4, DRIFT, out);
        expect(Math.hypot(out.x, out.y, out.z)).toBe(0);
        const far = proxies.find((p) => p.id === 'S01');
        waterCloudDrift(far, 123.4, DRIFT, out);
        const phase = far.seed * 6.2831853;
        const w = 6.2831853 / (70 + (far.seed * 95));
        expect(out.x).toBeCloseTo(Math.sin((123.4 * w) + phase) * 145, 6);
    });

    it('picks only masses whose mirror image is in view, largest first', () => {
        const eye = { x: 0, y: 60, z: 0 };
        // A view that sees everything below the horizon south of the eye (-z).
        const inView = (x, y, z) => y < 0 && z < 0;
        const r = rows();
        const n = selectWaterClouds(proxies, 0, DRIFT, eye, inView, [0], r);
        expect(n).toBe(WATER_CLOUD_SLOTS);
        // Every pick's mirror image is south of the eye.
        for (let i = 0; i < n; i += 1) expect(r[i * 3].z).toBeLessThan(0);
        // Nothing in view: nothing traced.
        expect(selectWaterClouds(proxies, 0, DRIFT, eye, () => false, [0], rows())).toBe(0);
        // An eye under a water plane sees no mirror image in it.
        expect(selectWaterClouds(proxies, 0, DRIFT, { x: 0, y: -5, z: 0 }, () => true, [0], rows())).toBe(0);
    });
});
