/**
 * CHAPTER 2'S SEA, SWIMMING NATURALLY (2026-11-03, docs/ODYSSEY_SEA_MOTION_2026-11.md). Olov: "I want
 * us to keep improving the design, movement and animations of all animals in odyssey mode, i want
 * them to feel natural and move in a smooth and natural way!!!"
 *
 * - the humpbacks (humpback-swim.glb, scripts/blender/odyssey/odyssey_whales.py): a keyed stroke in
 *   which the flukes move and the head stays nearly still (the old photo-to-3D rig was backwards), a
 *   seamless loop, the beat set by the pace (the calf's faster), a C-bend into turns without corners;
 * - the fish (fishPoseAt, the CPU twin of the vertex stage): each points where it goes, no two
 *   bodies meet, the beat follows the pace, the school follows its leaders, no jerks;
 * - the visitors: the manta flaps while it speeds up and glides while it slows, the leans ease into
 *   their limits instead of stopping on them;
 * - the jellies: beat follows beat without a step in the bell's speed.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
    CALF_LENGTH, MOTHER_LENGTH, WHALE_PASS_ASSET_ID,
} from '../../src/rendering/odyssey/composition/odyssey-whale-pass.js';
import {
    WHALE_BEND_BONES, WHALE_CLIP_S, WHALE_FLIPPER_BONES, WHALE_STROKE_S, WHALE_SWIM, whaleBend, whaleClipRate,
} from '../../src/rendering/odyssey/composition/odyssey-whale-swim.js';
import {
    FISH_HULL_LENGTH, FISH_HULL_SCALE, FISH_SCHOOLS, fishPoseAt, fishSchoolPhase, fishSchoolRows,
} from '../../src/rendering/odyssey/world/odyssey-fish.js';
import {
    OCEAN_ROAM, roamPace, softLimit,
} from '../../src/rendering/odyssey/composition/odyssey-ocean-roam.js';
import { OCEAN_VISITOR_STROKE, mantaFlap } from '../../src/rendering/odyssey/composition/odyssey-ocean-visitors.js';
import { jellySurge } from '../../src/rendering/odyssey/composition/odyssey-jellyfish-drift.js';
import {
    getChapter2CreatureAssetById,
} from '../../src/rendering/odyssey/chapter-environments/shared/chapter-02-creature-assets.js';

const GLB = 'src/rendering/odyssey/assets/chapter-02/creatures/humpback-swim.glb';
const DT = 1 / 60;

async function loadHumpback() {
    const buf = fs.readFileSync(GLB);
    return new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
}

describe('the humpbacks: a Blender model with a keyed stroke', () => {
    it('is the pair\'s asset, one skinned mesh of a few thousand triangles under eight vertex buffers', async () => {
        expect(getChapter2CreatureAssetById(WHALE_PASS_ASSET_ID)?.fileName).toBe('humpback-swim.glb');
        expect(getChapter2CreatureAssetById('whale-glide')).toBeNull();
        const gltf = await loadHumpback();
        const meshes = [];
        gltf.scene.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
        expect(meshes).toHaveLength(1);
        const g = meshes[0].geometry;
        expect(Object.keys(g.attributes).sort()).toEqual(['color', 'normal', 'position', 'skinIndex', 'skinWeight']);
        expect(g.index.count / 3).toBeLessThanOrEqual(6500);
        expect(meshes[0].skeleton.bones).toHaveLength(13);
        // Its drawn size is its bind-pose bounds (no dequantizing scale hidden in the skin: the old
        // GLB drew at half its bounds).
        g.computeBoundingBox();
        const box = g.boundingBox.getSize(new THREE.Vector3());
        const skinned = new THREE.Box3();
        const v = new THREE.Vector3();
        gltf.scene.updateMatrixWorld(true);
        for (let i = 0; i < g.attributes.position.count; i += 1) {
            v.fromBufferAttribute(g.attributes.position, i);
            skinned.expandByPoint(meshes[0].applyBoneTransform(i, v));
        }
        const drawn = skinned.getSize(new THREE.Vector3());
        expect(drawn.z / box.z).toBeCloseTo(1, 2);
    });

    it('leads with -Z, up +Y, as the whale pass swims it', async () => {
        const gltf = await loadHumpback();
        gltf.scene.updateMatrixWorld(true);
        const at = (n) => gltf.scene.getObjectByName(n).getWorldPosition(new THREE.Vector3());
        expect(at('head').z).toBeLessThan(at('root').z);
        expect(at('flukes').z).toBeGreaterThan(at('stock2').z);
        expect(at('flipper2_L').y).toBeLessThan(at('flipper1_L').y);
    });

    it('keys every bone the game bends, so the bend never piles up frame on frame', async () => {
        const gltf = await loadHumpback();
        const clip = gltf.animations[0];
        expect(clip.name).toBe('Swim');
        expect(clip.duration).toBeCloseTo(WHALE_CLIP_S, 3);
        const rotated = new Set(clip.tracks
            .filter((t) => t.name.endsWith('.quaternion'))
            .map((t) => t.name.split('.')[0]));
        [...WHALE_BEND_BONES.map((b) => b.name), ...WHALE_FLIPPER_BONES]
            .forEach((n) => expect(rotated.has(n), n).toBe(true));
    });

    it('strokes with the flukes while the head stays nearly still, and loops without a seam', async () => {
        const gltf = await loadHumpback();
        const clip = gltf.animations[0];
        const model = gltf.scene;
        const mixer = new THREE.AnimationMixer(model);
        mixer.clipAction(clip).play();
        let fluke = [Infinity, -Infinity];
        let snout = [Infinity, -Infinity];
        const first = { fluke: null, head: null };
        for (let k = 0; k <= 240; k += 1) {
            mixer.setTime((k / 240) * clip.duration);
            model.updateMatrixWorld(true);
            const f = model.getObjectByName('flukes').localToWorld(new THREE.Vector3(0, 0.1, 0));
            const h = model.getObjectByName('head').localToWorld(new THREE.Vector3(0, 0.2, 0));
            fluke = [Math.min(fluke[0], f.y), Math.max(fluke[1], f.y)];
            snout = [Math.min(snout[0], h.y), Math.max(snout[1], h.y)];
            if (k === 0) { first.fluke = f.clone(); first.head = h.clone(); }
            if (k === 240) {
                expect(f.distanceTo(first.fluke)).toBeLessThan(1e-3);
                expect(h.distanceTo(first.head)).toBeLessThan(1e-3);
            }
        }
        // The fluke tips sweep about a seventh of the length; the snout a twentieth of that.
        expect(fluke[1] - fluke[0]).toBeGreaterThan(0.1);
        expect(snout[1] - snout[0]).toBeLessThan((fluke[1] - fluke[0]) * 0.2);
    });

    it('keeps the size the journey has shown (the old GLB drew at half its bounds)', () => {
        expect(MOTHER_LENGTH).toBe(29);
        expect(CALF_LENGTH).toBe(13);
    });

    it('beats with its pace, the calf quicker than its mother, never jumping', () => {
        const mean = OCEAN_ROAM.whales.speed;
        expect(whaleClipRate(mean, mean, 'mother') * WHALE_STROKE_S.mother).toBeCloseTo(WHALE_CLIP_S, 6);
        expect(whaleClipRate(mean * 1.3, mean, 'mother')).toBeGreaterThan(whaleClipRate(mean, mean, 'mother'));
        expect(whaleClipRate(mean * 0.7, mean, 'mother')).toBeLessThan(whaleClipRate(mean, mean, 'mother'));
        expect(whaleClipRate(mean, mean, 'calf')).toBeGreaterThan(whaleClipRate(mean, mean, 'mother') * 1.5);
        // Bounded both ways, and continuous in the speed.
        const most = (WHALE_CLIP_S / WHALE_STROKE_S.mother) * WHALE_SWIM.rateMax;
        expect(whaleClipRate(mean * 5, mean, 'mother')).toBeLessThanOrEqual(most + 1e-9);
        let worst = 0;
        for (let s = 0.5; s < 4; s += 0.01) {
            const step = whaleClipRate(s + 0.01, mean, 'mother') - whaleClipRate(s, mean, 'mother');
            worst = Math.max(worst, Math.abs(step));
        }
        expect(worst).toBeLessThan(0.01);
    });

    it('bends into its turn as a C, capped softly, straight when it swims straight', () => {
        expect(whaleBend(0, 2.4, MOTHER_LENGTH)).toBe(0);
        expect(whaleBend(0.1, 2.4, MOTHER_LENGTH)).toBeGreaterThan(0);
        expect(whaleBend(-0.1, 2.4, MOTHER_LENGTH)).toBeLessThan(0);
        expect(Math.abs(whaleBend(5, 2.4, MOTHER_LENGTH))).toBeLessThanOrEqual(WHALE_SWIM.bendMax);
        expect(Math.abs(whaleBend(0.2, 2.4, MOTHER_LENGTH))).toBeLessThan(WHALE_SWIM.bendMax);
        // No corner where it nears its limit: the second difference over the yaw rate stays small.
        let worst = 0;
        const h = 0.002;
        for (let w = -0.4; w < 0.4; w += h) {
            const bend = (x) => whaleBend(x, 2.4, MOTHER_LENGTH);
            const d2 = bend(w + h) - (2 * bend(w)) + bend(w - h);
            worst = Math.max(worst, Math.abs(d2) / (h * h));
        }
        expect(worst).toBeLessThan(60);
        // The forward chain and the rear chain bend opposite ways (a C, not an S), and the shares add up.
        expect(WHALE_BEND_BONES.filter((b) => b.dir > 0).map((b) => b.name)).toEqual(['head', 'chest']);
        expect(WHALE_BEND_BONES.reduce((n, b) => n + b.share, 0)).toBeCloseTo(1, 6);
    });
});

describe('the fish: a school that follows its leaders', () => {
    const rows = fishSchoolRows();
    const pose = (row, t) => fishPoseAt(row, FISH_SCHOOLS[row.si], fishSchoolPhase(row.si), t);
    const len = (row) => row.scale * FISH_HULL_SCALE * FISH_HULL_LENGTH;

    it('points where it goes: the heading is the way it moves', () => {
        let worst = 0;
        rows.forEach((row) => {
            for (let t = 0; t < 60; t += 0.5) {
                const a = pose(row, t).centre;
                const b = pose(row, t + 1e-3).centre;
                const v = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
                const l = Math.hypot(...v);
                const f = pose(row, t + 5e-4).fwd;
                const c = Math.min(1, ((v[0] * f[0]) + (v[1] * f[1]) + (v[2] * f[2])) / l);
                worst = Math.max(worst, Math.acos(c));
            }
        });
        expect(worst).toBeLessThan(THREE.MathUtils.degToRad(1));
    });

    it('never swims through another fish (bodies a length long, 0.08 of one in radius)', () => {
        const dot = (a, b) => (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2]);
        const segDist = (p1, q1, p2, q2) => {
            const d1 = q1.map((x, k) => x - p1[k]);
            const d2 = q2.map((x, k) => x - p2[k]);
            const r = p1.map((x, k) => x - p2[k]);
            const a = dot(d1, d1);
            const e = dot(d2, d2);
            const f = dot(d2, r);
            const c = dot(d1, r);
            const b = dot(d1, d2);
            const den = (a * e) - (b * b);
            const clamp01 = (x) => Math.min(1, Math.max(0, x));
            let s = den > 1e-9 ? clamp01(((b * f) - (c * e)) / den) : 0;
            let u = ((b * s) + f) / e;
            if (u < 0) {
                u = 0;
                s = clamp01(-c / a);
            } else if (u > 1) {
                u = 1;
                s = clamp01((b - c) / a);
            }
            return Math.hypot(...p1.map((x, k) => x + (d1[k] * s) - p2[k] - (d2[k] * u)));
        };
        let worst = Infinity;
        for (let t = 0; t < 60; t += 0.5) {
            const p = rows.map((row) => pose(row, t));
            const seg = (P, l) => [
                P.centre.map((x, k) => x + (P.fwd[k] * l * 0.40)),
                P.centre.map((x, k) => x - (P.fwd[k] * l * 0.44)),
            ];
            for (let i = 0; i < rows.length; i += 1) {
                for (let j = i + 1; j < rows.length; j += 1) {
                    if (rows[i].si !== rows[j].si) continue;
                    const la = len(rows[i]);
                    const lb = len(rows[j]);
                    const [a0, a1] = seg(p[i], la);
                    const [b0, b1] = seg(p[j], lb);
                    worst = Math.min(worst, (segDist(a0, a1, b0, b1) - (0.08 * (la + lb))) / ((la + lb) / 2));
                }
            }
        }
        expect(worst).toBeGreaterThan(0);
    });

    it('beats its tail with its pace (the beat is the distance swum)', () => {
        rows.filter((_, i) => i % 7 === 0).forEach((row) => {
            let fast = 0;
            let slow = Infinity;
            let fastBeat = 0;
            let slowBeat = 0;
            for (let t = 0; t < 40; t += 0.25) {
                const p = pose(row, t);
                const q = pose(row, t + 0.01);
                const rate = (q.beat - p.beat) / 0.01;
                if (p.speed > fast) { fast = p.speed; fastBeat = rate; }
                if (p.speed < slow) { slow = p.speed; slowBeat = rate; }
                expect(rate).toBeGreaterThan(0);
            }
            expect(fastBeat).toBeGreaterThan(slowBeat);
        });
    });

    it('turns without a jerk: the heading\'s acceleration stays small', () => {
        let worst = 0;
        rows.filter((_, i) => i % 3 === 0).forEach((row) => {
            let prev = null;
            let prevW = null;
            for (let t = 0; t < 30; t += DT) {
                const f = pose(row, t).fwd;
                if (prev) {
                    const w = Math.acos(Math.min(1, (f[0] * prev[0]) + (f[1] * prev[1]) + (f[2] * prev[2]))) / DT;
                    if (prevW !== null) worst = Math.max(worst, Math.abs(w - prevW) / DT);
                    prevW = w;
                }
                prev = f;
            }
        });
        expect(worst).toBeLessThan(0.5);
    });

    it('follows its leaders: a fish behind swims where the one ahead swam', () => {
        // Two fish of one school at the same place across it: the one behind passes the same water
        // later (within a few tenths of a unit, the surge's own share).
        const school = FISH_SCHOOLS[0];
        const mk = (along) => ({
            ...rows[0], along, across: 0, up: 0, seed: 0.5,
        });
        const a = mk(0.1);
        const b = mk(0);
        const lagT = (a.along - b.along) / school.omega;
        let worst = 0;
        for (let t = 10; t < 40; t += 0.5) {
            const pa = pose(a, t).centre;
            const pb = pose(b, t + lagT).centre;
            worst = Math.max(worst, Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]));
        }
        expect(worst).toBeLessThan(1.2);
    });

    it('leans into the curve it swims and bends toward its inside', () => {
        rows.filter((_, i) => i % 11 === 0).forEach((row) => {
            for (let t = 0; t < 20; t += 1) {
                const p = pose(row, t);
                // A curve to its left (side > 0) leans it left (bank < 0) and bends it left.
                if (Math.abs(p.side) > 0.02) {
                    expect(Math.sign(p.bank)).toBe(-Math.sign(p.side));
                    expect(Math.sign(p.curvature)).toBe(Math.sign(p.side));
                }
            }
        });
    });
});

describe('the visitors stroke with their pace', () => {
    const r = OCEAN_ROAM.manta;

    it('the manta flaps while it speeds up and glides while it slows, easing between', () => {
        let glide = 0;
        let flap = 0;
        let worstStep = 0;
        let prev = null;
        for (let t = 0; t < r.paceS * 3; t += DT) {
            const p = roamPace(r, t);
            const f = mantaFlap(p, r);
            if (f > 0.99) {
                flap += 1;
                expect(p.change).toBeGreaterThan(0);
            }
            if (f < 0.01) {
                glide += 1;
                expect(p.change).toBeLessThan(0);
            }
            if (prev !== null) worstStep = Math.max(worstStep, Math.abs(f - prev));
            prev = f;
        }
        const n = (r.paceS * 3) / DT;
        expect(glide / n).toBeGreaterThan(0.25);
        expect(flap / n).toBeGreaterThan(0.25);
        // A flap fades to a glide over seconds, never at once.
        expect(worstStep).toBeLessThan(0.02);
        expect(OCEAN_VISITOR_STROKE.glideAmp).toBeLessThan(0.2);
    });

    it('its pace is its route\'s: the share swells and slackens by the route\'s pace', () => {
        let lo = Infinity;
        let hi = 0;
        for (let t = 0; t < r.paceS; t += 0.1) {
            const { share } = roamPace(r, t);
            lo = Math.min(lo, share);
            hi = Math.max(hi, share);
        }
        expect(lo).toBeCloseTo(1 - r.pace, 2);
        expect(hi).toBeCloseTo(1 + r.pace, 2);
    });

    it('leans ease into their limits (no corner where a hard clamp stopped them)', () => {
        expect(softLimit(0.01, 0.3)).toBeCloseTo(0.01, 4);
        expect(Math.abs(softLimit(10, 0.3))).toBeLessThanOrEqual(0.3);
        expect(Math.abs(softLimit(0.4, 0.3))).toBeLessThan(0.3);
        let worst = 0;
        const h = 0.001;
        for (let x = -1; x < 1; x += h) {
            const d2 = softLimit(x + h, 0.3) - (2 * softLimit(x, 0.3)) + softLimit(x - h, 0.3);
            worst = Math.max(worst, Math.abs(d2) / (h * h));
        }
        expect(worst).toBeLessThan(10);
    });
});

describe('the jellies beat without a step', () => {
    it('comes to rest from its coast as the next beat starts', () => {
        const h = 1e-5;
        const endSpeed = (jellySurge(1) - jellySurge(1 - h)) / h;
        const startSpeed = (jellySurge(h) - jellySurge(0)) / h;
        expect(Math.abs(endSpeed - startSpeed)).toBeLessThan(1e-3);
    });
});
