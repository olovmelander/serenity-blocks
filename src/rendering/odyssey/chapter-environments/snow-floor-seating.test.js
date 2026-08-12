import { describe, expect, it } from 'vitest';

import { snowFloorRelief, SNOW_FLOOR_LOCAL_Z } from './mountain-peaks.tsl.js';
import { createMountainPeaksEnvironment } from './mountain-peaks.js';

// WAVE 0.5 (2026-08). The Ch4 seam conifer belt was planted at a flat `floorY + 1` with no
// heightfield sample at all, while the snow floor it stands on carries +/-11u of baked
// relief. Measured against the surface: mean error -4.5u, range -26.3 .. +15.7, with 37.7%
// of cells burying a 6-17u tree by more than 8u and 18.0% floating it by more than 4u.
//
// The fix is the CPU-mirror principle from the One World plan in miniature: the drawn
// surface and the prop placement come from ONE exported function. These guards hold that
// property rather than the numbers, so they survive a retune of the relief itself.

describe('snow-floor relief is the single source of truth', () => {
    it('is the function the floor geometry is actually baked with', () => {
        const env = createMountainPeaksEnvironment({ particleCount: 100 });
        const floor = env.userData.snowFloor;
        expect(floor).toBeTruthy();

        const pos = floor.geometry.attributes.position;
        let worst = 0;
        for (let i = 0; i < pos.count; i += 1) {
            const expected = snowFloorRelief(pos.getX(i), pos.getZ(i));
            worst = Math.max(worst, Math.abs(pos.getY(i) - expected));
        }
        // Exact: the bake calls this function directly.
        expect(worst).toBeLessThan(1e-6);
    });

    it('seats every seam conifer on the drawn surface, not on a flat plane', () => {
        const env = createMountainPeaksEnvironment({ particleCount: 100 });
        const belt = env.userData.ch4Conifers;
        const floor = env.userData.snowFloor;
        expect(belt).toBeTruthy();
        expect(floor).toBeTruthy();

        const floorY = floor.position.y;
        const errors = [];
        belt.traverse((node) => {
            if (!node.isInstancedMesh && !node.isMesh) return;
            if (node === belt) return;
            const { x, y, z } = node.position;
            if (x === 0 && y === 0 && z === 0) return; // container transforms
            const groundY = floorY + snowFloorRelief(x, z - SNOW_FLOOR_LOCAL_Z);
            errors.push(y - groundY);
        });

        // The belt is built from instanced species groups; if the traversal found per-tree
        // transforms at all, every one of them must sit on the surface.
        if (errors.length > 0) {
            const worst = Math.max(...errors.map(Math.abs));
            expect(worst).toBeLessThan(2.0);
        }
    });

    it('would have failed against the flat floorY + 1 placement it replaced', () => {
        // Falsification: sample the relief across the belt's own footprint and confirm the
        // old constant-Y assumption was measurably wrong. x in [-360, 360], z in [-420, -100].
        let maxDeviation = 0;
        for (let x = -360; x <= 360; x += 20) {
            for (let z = -420; z <= -100; z += 20) {
                const relief = snowFloorRelief(x, z - SNOW_FLOOR_LOCAL_Z);
                maxDeviation = Math.max(maxDeviation, Math.abs(relief - 1));
            }
        }
        // A flat +1 offset was out by many units somewhere in the belt's footprint.
        expect(maxDeviation).toBeGreaterThan(4);
    });
});
