/**
 * Synthwave Sunset — the gull model (scripts/blender/synthwave_gull.py →
 * src/themes/synthwave-sunset/assets/gull.glb). The file must be the one the manifest records, a
 * gull's size and shape, light enough to stay one cheap draw, and carry what the vertex stage folds
 * the wings with; the fold must give a gull's crank in the glide and leave the body still.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
    GULL_GLIDE, GULL_RIG, GULL_FLIGHTS, foldPoint,
} from '../../src/themes/synthwave-sunset/synthwave-sunset-gull-flight.js';
import { SynthwaveGulls, gullGeometryFromGltf } from '../../src/themes/synthwave-sunset/synthwave-sunset-gulls.js';
import { createWorldUniforms } from '../../src/themes/synthwave-sunset/synthwave-sunset-world.js';

const assets = new URL('../../src/themes/synthwave-sunset/assets/', import.meta.url);
const read = (file) => readFileSync(new URL(file, assets));
const manifest = JSON.parse(read('asset-manifest.json').toString('utf8'));

async function parsed() {
    const bytes = read('gull.glb');
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return gullGeometryFromGltf(await new GLTFLoader().parseAsync(buffer, ''));
}

describe('synthwave-sunset gull model', () => {
    it('is the file the manifest records, light enough for a handful of birds', () => {
        const [entry] = manifest.assets;
        const bytes = read(entry.file);
        expect(entry.file).toBe('gull.glb');
        expect(bytes.length).toBe(entry.bytes);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
        expect(bytes.length).toBeLessThan(120_000);
        expect(entry.triangles).toBeGreaterThan(800);
        expect(entry.triangles).toBeLessThan(3000);
        expect(read('ATTRIBUTION.md').toString('utf8')).toMatch(/synthwave_gull\.py/);
    });

    it('is a gull: a 1.4 m span, 0.6 m long, two mirrored wings, the layout the vertex stage reads', async () => {
        const geometry = await parsed();
        expect(geometry.getAttribute('position').itemSize).toBe(3);
        expect(geometry.getAttribute('normal').itemSize).toBe(3);
        expect(geometry.getAttribute('color').itemSize).toBe(4);
        expect(geometry.getAttribute('_wing').itemSize).toBe(3);
        geometry.computeBoundingBox();
        const { min, max } = geometry.boundingBox;
        expect(max.x - min.x).toBeCloseTo(GULL_RIG.span, 1);
        expect(max.z - min.z).toBeCloseTo(GULL_RIG.length, 1);
        expect(max.x + min.x).toBeCloseTo(0, 3);
        // Forward is +z: the bill leads, the tail trails.
        expect(max.z).toBeGreaterThan(0.25);
        expect(min.z).toBeLessThan(-0.25);
        const tris = geometry.index.count / 3;
        expect(tris).toBe(manifest.assets[0].triangles);
    });

    it('weights the wings by their hinges: the body still, the arm from the shoulder, the hand from the wrist', async () => {
        const geometry = await parsed();
        const p = geometry.getAttribute('position');
        const w = geometry.getAttribute('_wing');
        const [, armEnd] = GULL_RIG.armBand;
        const [handStart, handEnd] = GULL_RIG.handBand;
        for (let i = 0; i < p.count; i += 1) {
            const ax = Math.abs(p.getX(i));
            const [arm, hand, tip] = [w.getX(i), w.getY(i), w.getZ(i)];
            expect(hand).toBeLessThanOrEqual(arm + 1e-6);
            expect(tip).toBeLessThanOrEqual(hand + 1e-6);
            if (ax < GULL_RIG.armBand[0]) expect(arm).toBe(0);
            if (ax > armEnd + 0.01 && Math.abs(p.getZ(i)) < 0.2) expect(arm).toBeCloseTo(1, 5);
            if (ax < handStart) expect(hand).toBe(0);
            if (ax > handEnd) expect(hand).toBeCloseTo(1, 5);
        }
    });

    it('folds into a gull\'s glide: the arms up, the hands down from the wrist, the body still', async () => {
        const geometry = await parsed();
        const p = geometry.getAttribute('position');
        const w = geometry.getAttribute('_wing');
        const out = [0, 0, 0];
        let tipY = -Infinity;
        let tipRest = 0;
        for (let i = 0; i < p.count; i += 1) {
            const rest = [p.getX(i), p.getY(i), p.getZ(i)];
            const weights = [w.getX(i), w.getY(i), w.getZ(i)];
            foldPoint(rest, weights, GULL_GLIDE, out);
            if (weights[0] === 0) expect(Math.hypot(out[0] - rest[0], out[1] - rest[1], out[2] - rest[2])).toBeLessThan(1e-9);
            if (Math.abs(rest[0]) > 0.69 && out[1] > tipY) {
                tipY = out[1];
                tipRest = rest[1];
            }
        }
        // The wrist rises with the arm's lift; the tip ends below the wrist (the crank).
        const wrist = foldPoint(GULL_RIG.wrist, [1, 0, 0], GULL_GLIDE, [0, 0, 0]);
        expect(wrist[1]).toBeGreaterThan(GULL_RIG.wrist[1] + 0.05);
        expect(tipY).toBeLessThan(wrist[1]);
        expect(tipY).toBeGreaterThan(tipRest - 0.1);
    });

    it('swaps the model into the flock\'s one draw when it arrives', async () => {
        const gulls = new SynthwaveGulls(createWorldUniforms(), { count: 5 });
        expect(gulls.mesh.visible).toBe(false);
        const geometry = await parsed();
        gulls.attach(geometry);
        expect(gulls.mesh.visible).toBe(true);
        expect(gulls.mesh.geometry).toBeInstanceOf(THREE.InstancedBufferGeometry);
        expect(gulls.mesh.geometry.index.count).toBe(geometry.index.count);
        expect(gulls.mesh.geometry.instanceCount).toBe(5);
        expect(GULL_FLIGHTS.length).toBeGreaterThanOrEqual(9);
        gulls.dispose();
    });
});
