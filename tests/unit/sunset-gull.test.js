/**
 * Sunset — the gull modelled, rigged and animated in Blender (scripts/blender/sunset_gull.py ->
 * sunset-gull-model.js): its mesh, its skin, and the vertex stage's twin held to the rig Blender
 * itself deformed.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { SUNSET_GULL } from '../../src/themes/sunset/sunset-gull-model.js';
import {
    FLAP_ROWS, GULL_SCALE, createFlock, gullModel, gullPose, gullVertex,
} from '../../src/themes/sunset/sunset-birds.js';
import { SunsetWorld } from '../../src/themes/sunset/sunset-world.js';

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('sunset gull: the model', () => {
    it('is a whole mesh of a real gull, every vertex on at most two of its nine bones', () => {
        const m = gullModel();
        expect(m.positions.length).toBe(m.vertexCount * 3);
        expect(m.index.length).toBe(m.triangleCount * 3);
        expect(Math.max(...m.index)).toBe(m.vertexCount - 1);
        expect(m.bones).toBe(9);
        for (let i = 0; i < m.vertexCount; i += 1) {
            expect(m.skin[i * 4]).toBeLessThan(9);
            expect(m.skin[i * 4 + 1]).toBeLessThan(9);
        }
        // A common gull, its wings drawn a little long (it is seen side-on, small): about 1.33 m
        // across, 0.4 m from bill to tail; light enough to draw in a crowd.
        expect(SUNSET_GULL.span).toBeGreaterThan(1.25);
        expect(SUNSET_GULL.span).toBeLessThan(1.4);
        expect(SUNSET_GULL.length).toBeGreaterThan(0.35);
        expect(SUNSET_GULL.length).toBeLessThan(0.45);
        expect(m.triangleCount).toBeLessThan(2000);
    });

    it('carries rotations of unit length, all on one side of the sphere, for every row', () => {
        const { poses, rows, bones } = gullModel();
        expect(rows).toBe(FLAP_ROWS + 1);
        expect(poses.length).toBe(rows * bones * 8);
        for (let r = 0; r < rows; r += 1) {
            for (let b = 0; b < bones; b += 1) {
                const o = (r * bones + b) * 8;
                expect(Math.hypot(poses[o], poses[o + 1], poses[o + 2], poses[o + 3])).toBeCloseTo(1, 4);
                expect(poses[o + 3]).toBeGreaterThan(0); // blending rows never takes the long way round
            }
        }
    });

    it('moves exactly as Blender moved it: the vertex stage twin against the rig', () => {
        expect(SUNSET_GULL.checks.length).toBeGreaterThan(20);
        let worst = 0;
        SUNSET_GULL.checks.forEach(({ vertex, row, at }) => {
            const glide = row === FLAP_ROWS ? 1 : 0;
            const cycle = row === FLAP_ROWS ? 0 : row / FLAP_ROWS;
            worst = Math.max(worst, dist(gullVertex(vertex, cycle, glide), at));
        });
        // Positions are stored to a tenth of a millimetre; the rig agrees to well under a millimetre.
        expect(worst).toBeLessThan(5e-4);
    });

    it('beats through a whole stroke and glides with the wings open, in one smooth loop', () => {
        const tip = 0; // the right wingtip is the first check vertex
        const v = SUNSET_GULL.checks[tip].vertex;
        const heights = Array.from({ length: 96 }, (_, k) => gullVertex(v, k / 96, 0)[1]);
        // The tip rises well over the back and falls well under the belly.
        expect(Math.max(...heights)).toBeGreaterThan(0.3);
        expect(Math.min(...heights)).toBeLessThan(-0.25);
        // No jump anywhere round the loop, the join included.
        for (let k = 0; k < 96; k += 1) {
            expect(Math.abs(heights[(k + 1) % 96] - heights[k])).toBeLessThan(0.06);
        }
        // Gliding, the wing is open nearly to its full span.
        const glideTip = gullVertex(v, 0.3, 1);
        expect(glideTip[0]).toBeGreaterThan(0.52);
        // On the upstroke the wrist is flexed: the span is well short of the downstroke's.
        const spanAt = (cycle) => gullVertex(v, cycle, 0)[0];
        expect(spanAt(0.72)).toBeLessThan(spanAt(0.3) * 0.8);
    });

    // The bands over each joint widen toward the trailing edge and the hand's runs out behind the
    // wrist (scripts/blender/sunset_gull.py): without that the elbow stretched the trailing edge
    // 1.9 times and the folding hand dragged it in to a tenth of its length. What is left is the
    // hand's inner trailing edge closing over the forearm's late in the upstroke, as the primaries
    // slide under the secondaries.
    it('never tears its skin: no edge stretches or shrinks far in any pose or blend', () => {
        const m = gullModel();
        const edges = new Set();
        for (let i = 0; i < m.index.length; i += 3) {
            for (let k = 0; k < 3; k += 1) {
                const a = m.index[i + k];
                const b = m.index[i + ((k + 1) % 3)];
                edges.add(a < b ? `${a},${b}` : `${b},${a}`);
            }
        }
        const pairs = [...edges].map((e) => e.split(',').map(Number));
        const rest = (i) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
        let longest = 1;
        let shortest = 1;
        const poses = [];
        for (let k = 0; k < FLAP_ROWS * 2; k += 1) poses.push([k / (FLAP_ROWS * 2), 0]);
        [0.25, 0.5, 0.75].forEach((g) => poses.push([0.7, g], [0.1, g]));
        poses.forEach(([cycle, glide]) => {
            const moved = new Map();
            const at = (i) => {
                if (!moved.has(i)) moved.set(i, gullVertex(i, cycle, glide));
                return moved.get(i);
            };
            pairs.forEach(([a, b]) => {
                const r = dist(rest(a), rest(b));
                if (r < 2e-3) return;
                const s = dist(at(a), at(b)) / r;
                longest = Math.max(longest, s);
                shortest = Math.min(shortest, s);
            });
        });
        expect(longest).toBeLessThan(1.75);
        expect(shortest).toBeGreaterThan(0.18);
    });

    it('keeps every joint where its parent holds it, in any blend of the beat and the glide', () => {
        const { pivots, parents, bones } = SUNSET_GULL;
        const at = (pose, b, p) => {
            const o = b * 8;
            const q = new THREE.Quaternion(pose[o], pose[o + 1], pose[o + 2], pose[o + 3]);
            const t = new THREE.Vector3(pose[o + 4], pose[o + 5], pose[o + 6]);
            return new THREE.Vector3(...p).applyQuaternion(q).add(t);
        };
        let worst = 0;
        [[0.1, 0.5], [0.7, 0.5], [0.33, 0.25], [0.95, 0.8], [0.5, 0]].forEach(([cycle, glide]) => {
            const pose = gullPose(cycle, glide);
            for (let b = 0; b < bones.length; b += 1) {
                const q = pose.subarray(b * 8, b * 8 + 4);
                expect(Math.hypot(...q)).toBeCloseTo(1, 5); // blending never scales the bird
                if (parents[b] >= 0 && bones[b] !== 'head') {
                    worst = Math.max(worst, at(pose, b, pivots[b]).distanceTo(at(pose, parents[b], pivots[b])));
                }
            }
        });
        expect(worst).toBeLessThan(1e-5);
    });
});

describe('sunset gull: the flock draws it', () => {
    // (sunset-shaders.test.js builds its material for WebGPU and WebGL2 with the rest of the world.)
    it('flies each bird where the skein puts it, life-sized times GULL_SCALE, bill first', () => {
        const world = new SunsetWorld({ scene: new THREE.Scene(), quality: 'Low' }).build();
        const flock = createFlock({ count: 5, U: world.U, seed: 3 });
        flock.send(0, 5, new THREE.Vector3(0, 0.05, -1).normalize());
        flock.update(4);
        const { geometry } = flock.mesh;
        expect(geometry.instanceCount).toBe(5);
        const buffers = new Set(Object.values(geometry.attributes).map((a) => a.data ?? a));
        expect(buffers.size).toBeLessThanOrEqual(8);
        // Bird 0's bill tip and wingtips through its row of the table, as the vertex stage reads it.
        const { data } = flock.table.image;
        const m = gullModel();
        const world0 = (vertex) => {
            const b = m.skin[vertex * 4];
            const o = b * 8;
            const q = new THREE.Quaternion(data[o], data[o + 1], data[o + 2], data[o + 3]);
            const p = new THREE.Vector3().fromArray(m.positions, vertex * 3);
            const t = new THREE.Vector3(data[o + 4], data[o + 5], data[o + 6]);
            return p.applyQuaternion(q).multiplyScalar(data[o + 7]).add(t);
        };
        const [x, y, z, size] = flock.placeOf(0);
        expect(size).toBeCloseTo(GULL_SCALE, 3);
        const place = new THREE.Vector3(x, y, z);
        const bill = SUNSET_GULL.checks[2].vertex;
        const ahead = world0(bill).sub(place);
        // Half a second on, the bird has flown the way its bill points.
        flock.update(4.5);
        const moved = new THREE.Vector3(...flock.placeOf(0).slice(0, 3)).sub(place);
        expect(ahead.normalize().dot(moved.normalize())).toBeGreaterThan(0.8);
        expect(world0(SUNSET_GULL.checks[0].vertex).distanceTo(new THREE.Vector3(...flock.placeOf(0).slice(0, 3))))
            .toBeLessThan(0.65 * GULL_SCALE);
        flock.dispose();
        world.dispose();
    });
});
