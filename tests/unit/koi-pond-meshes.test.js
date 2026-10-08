/**
 * Koi Pond — the generated meshes face the right way.
 *
 * Every mesh in this theme is built in code and its normals are computed from its triangles, so
 * a triangle wound the wrong way gives a surface that is lit from behind and never from the moon.
 * The materials are double-sided, so nothing disappears when that happens: the koi's backs and
 * the lily pads were dark for most of the theme's development before a close-up showed it. These
 * tests pin the facing of each mesh.
 */
import { describe, expect, it } from 'vitest';

import { buildKoiGeometry } from '../../src/themes/koi-pond/koi-pond-koi.js';
import {
    buildMapleLeafGeometry, buildPadGeometry, buildPetalGeometry,
} from '../../src/themes/koi-pond/koi-pond-flora.js';
import { buildGroundGeometry } from '../../src/themes/koi-pond/koi-pond-bed.js';

function meanNormalY(geometry) {
    const normal = geometry.getAttribute('normal');
    let sum = 0;
    for (let i = 0; i < normal.count; i++) sum += normal.getY(i);
    return sum / normal.count;
}

describe('koi pond: generated meshes', () => {
    it('gives the koi a body whose skin faces outward: its back up, its flanks away from the spine', () => {
        const geometry = buildKoiGeometry();
        const position = geometry.getAttribute('position');
        const normal = geometry.getAttribute('normal');
        const body = geometry.getAttribute('aBody');
        const wrong = [];
        let back = 0;
        let flank = 0;
        for (let i = 0; i < position.count; i++) {
            const s = body.getX(i);
            const around = body.getY(i);
            if (body.getZ(i) !== 0 || s < 0.15 || s > 0.6) continue;
            if (Math.abs(around) < 0.15) {
                back += 1;
                if (normal.getY(i) < 0.5) wrong.push(`back vertex ${i}: normal.y ${normal.getY(i).toFixed(2)}`);
            } else if (Math.abs(Math.abs(around) - 0.5) < 0.1) {
                flank += 1;
                if (Math.sign(normal.getZ(i)) !== Math.sign(position.getZ(i))) wrong.push(`flank vertex ${i} faces the spine`);
            }
        }
        expect(back).toBeGreaterThan(10);
        expect(flank).toBeGreaterThan(10);
        expect(wrong).toEqual([]);
    });

    it('keeps the koi within its unit length and gives every vertex a finite normal', () => {
        const geometry = buildKoiGeometry();
        const position = geometry.getAttribute('position');
        const normal = geometry.getAttribute('normal');
        for (let i = 0; i < position.count; i++) {
            expect(Math.abs(position.getX(i))).toBeLessThanOrEqual(0.62);
            expect(Number.isFinite(normal.getX(i) + normal.getY(i) + normal.getZ(i))).toBe(true);
        }
        expect(geometry.getIndex().count % 3).toBe(0);
    });

    it('turns what floats and what grows face up: pads, petals, leaves, and the ground itself', () => {
        expect(meanNormalY(buildPadGeometry())).toBeGreaterThan(0.9);
        expect(meanNormalY(buildPetalGeometry())).toBeGreaterThan(0.6);
        expect(meanNormalY(buildMapleLeafGeometry())).toBeGreaterThan(0.9);
        expect(meanNormalY(buildGroundGeometry({
            minX: -3, maxX: 3, minZ: -6, maxZ: 3, cell: 0.5,
        }))).toBeGreaterThan(0.8);
    });
});
