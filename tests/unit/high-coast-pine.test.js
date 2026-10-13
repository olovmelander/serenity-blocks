/**
 * High Coast's old pine (src/themes/high-coast/high-coast-pine.js): the plan is deterministic,
 * the needle tufts carry sane shading data, the needle texture keeps its coverage down the mip
 * chain, the bark's seam faces away from the eye, the crown stays inside the reach the framing
 * rule assumes (PINE_FRAME), and the shadow's casters fit their table.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { EYE, PINE_FRAME, PLACES } from '../../src/themes/high-coast/high-coast-core.js';
import {
    PINE_FOLIAGE, PINE_SHADOW, bakeNeedleTexture, needleGeometry, pineFrame, pinePlan, shadowCasters,
} from '../../src/themes/high-coast/high-coast-pine.js';

const frame = pineFrame(PLACES.pine.x, 145.4, PLACES.pine.z);
const eyeLocal = new THREE.Vector3(EYE.x, EYE.y, EYE.z).applyMatrix4(frame.inverse);

describe('High Coast old pine', () => {
    it('draws the same tree every time', () => {
        const a = pinePlan(eyeLocal);
        const b = pinePlan(eyeLocal);
        expect(a.plates.length).toBe(b.plates.length);
        expect(a.plates.length).toBeGreaterThan(30);
        a.plates.forEach((p, i) => {
            expect(p.c.distanceTo(b.plates[i].c)).toBe(0);
            expect(p.R).toBe(b.plates[i].R);
        });
    });

    it('gives every tuft a dome normal, a depth and a sky openness in range', () => {
        const plan = pinePlan(eyeLocal);
        for (const density of PINE_FOLIAGE.density) {
            const { geometry, tufts } = needleGeometry(plan.plates, { density });
            const {
                position, uv, aTuft, aSeed,
            } = geometry.attributes;
            expect(position.count).toBe(tufts * 8);
            expect(uv.count).toBe(position.count);
            expect(geometry.index.count).toBe(tufts * 12);
            for (let i = 0; i < position.count; i += 8) {
                const n = new THREE.Vector3(aTuft.getX(i), aTuft.getY(i), aTuft.getZ(i));
                expect(Math.abs(n.length() - 1)).toBeLessThan(1e-4);
                expect(aTuft.getW(i)).toBeGreaterThanOrEqual(0);
                expect(aTuft.getW(i)).toBeLessThanOrEqual(1);
                expect(aSeed.getY(i)).toBeGreaterThanOrEqual(0);
                expect(aSeed.getY(i)).toBeLessThanOrEqual(1);
            }
            expect([...position.array].every(Number.isFinite)).toBe(true);
        }
    });

    it('keeps the needles\' coverage down the mip chain', () => {
        const { texture, coverage } = bakeNeedleTexture(128);
        expect(texture.mipmaps.length).toBe(8);
        expect(texture.generateMipmaps).toBe(false);
        expect(coverage[0]).toBeGreaterThan(0.1);
        // Down to 4 x 4 every level keeps what an alpha test passes at full size, within a third.
        for (let k = 1; k <= 5; k++) expect(Math.abs(coverage[k] - coverage[0]) / coverage[0]).toBeLessThan(0.5);
        expect(coverage[7]).toBeGreaterThan(0);
        texture.dispose();
    });

    it('turns the trunk\'s bark seam to the side the eye never sees', () => {
        const plan = pinePlan(eyeLocal);
        const trunk = plan.wood[0];
        const sides = 18;
        const rings = trunk.pos.length / 3 / (sides + 1);
        for (let i = 0; i < rings; i += 7) {
            const centre = trunk.curve.getPointAt(i / (rings - 1));
            const seam = new THREE.Vector3(trunk.pos[i * (sides + 1) * 3], trunk.pos[i * (sides + 1) * 3 + 1], trunk.pos[i * (sides + 1) * 3 + 2]);
            const toSeam = seam.sub(centre).normalize();
            const toEye = eyeLocal.clone().sub(centre).normalize();
            expect(toSeam.dot(toEye)).toBeLessThan(-0.5);
        }
    });

    it('keeps the crown inside the reach the framing rule assumes', () => {
        const plan = pinePlan(eyeLocal);
        const { geometry } = needleGeometry(plan.plates, { density: PINE_FOLIAGE.density[2] });
        const p = geometry.attributes.position;
        const v = new THREE.Vector3();
        let right = -Infinity;
        for (let i = 0; i < p.count; i++) {
            v.fromBufferAttribute(p, i).applyMatrix4(frame.matrix);
            right = Math.max(right, Math.atan2(v.x - EYE.x, -(v.z - EYE.z)) * (180 / Math.PI));
        }
        expect(right).toBeLessThanOrEqual(PINE_FRAME.crown);
    });

    it('fits the shadow\'s casters in their table: plates flat, the trunk round', () => {
        const plan = pinePlan(eyeLocal);
        const rows = shadowCasters(plan, frame);
        expect(rows.length).toBeLessThanOrEqual(PINE_SHADOW.rows);
        expect(rows.filter((r) => r.w > 0).length).toBe(plan.plates.length);
        expect(rows.filter((r) => r.w < 0).length).toBeGreaterThan(10);
        for (const r of rows) expect([r.x, r.y, r.z, r.w].every(Number.isFinite)).toBe(true);
    });
});
