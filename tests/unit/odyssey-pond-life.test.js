/**
 * LIFE AT THE POND (chapter 3's tarn, 2026-11-02): two swans, a heron, a hind and her calf come down
 * to drink. What is pinned here:
 *  - the models and their skins, and both shader backends build the birds' draw cleanly;
 *  - hidden until ready, drawn only through the window;
 *  - THE SWANS never leave the water (their whole hull over deep water at every moment of the loop)
 *    and keep apart; THE HERON stands in the shallows, its planted feet never slide, its legs reach
 *    them; it flies between its two places now and then, its open wings drawn only then, clear of
 *    the bank, landing on its feet; THE DRINKERS walk dry or shallow, gentle ground clear of the
 *    trees and boulders, and come to the water's edge;
 *  - SITING on the real rail camera: in frame through the L18 -> L19 glide and at L22-L23, at the
 *    pixel sizes the doc records (1440p), the heron's flights too; never appearing or leaving in view.
 */
import { readFileSync } from 'node:fs';
import {
    beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createOdysseyCameraRig } from './helpers/odyssey-camera-rig.js';
import {
    HERON_FLIGHTS, HERON_LOOP, HERON_STOPS, ODYSSEY_POND, ODYSSEY_TARN_DEER, createBirdRig, heronStateAt, legReach, poseHeron,
    poseSwan, swanRoute, swanStateAt,
} from '../../src/rendering/odyssey/composition/odyssey-pond-life-motion.js';
import { createOdysseyPondLife, parseOdysseyPondBird } from '../../src/rendering/odyssey/composition/odyssey-pond-life.js';
import {
    buildHerd, createDeerRig, deerStateAt, planFootfalls, poseDeer,
} from '../../src/rendering/odyssey/composition/odyssey-deer-herd.js';
import { parseOdysseyDeer } from '../../src/rendering/odyssey/composition/odyssey-deer.js';
import {
    ODYSSEY_SEA_LEVEL, ODYSSEY_TARN, odysseyTarnRn, odysseyWorldHeight,
} from '../../src/rendering/odyssey/world/odyssey-world-height.js';
import { scatterZonedForest } from '../../src/rendering/odyssey/world/odyssey-forest-scatter.js';
import { buildBoulderSites } from '../../src/rendering/odyssey/world/odyssey-boulders.js';
import { getOdysseyPathPointAt } from '../../src/rendering/odyssey/path-utils.js';

const ASSETS = '../../src/rendering/odyssey/assets/chapter-03/';
const FILES = {
    swan: new URL(`${ASSETS}pond/swan.glb`, import.meta.url),
    heron: new URL(`${ASSETS}pond/heron.glb`, import.meta.url),
    deer: new URL(`${ASSETS}deer/red-deer.glb`, import.meta.url),
};
/** The fastest any bone turned between two frames of world rotations (quaternions), per second at 30 fps. */
function fastestTurn(q, prev) {
    let w = 0;
    q.forEach((v, b) => {
        const dot = Math.abs((v[0] * prev[b][0]) + (v[1] * prev[b][1]) + (v[2] * prev[b][2]) + (v[3] * prev[b][3]));
        w = Math.max(w, 2 * Math.acos(Math.min(1, dot)) * 30);
    });
    return w;
}
const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
const W = ODYSSEY_TARN.waterY;

async function parseGlb(url) {
    const file = readFileSync(url);
    const bytes = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    return new GLTFLoader().parseAsync(bytes, '');
}
const loadGltf = (url) => {
    const key = Object.keys(FILES).find((k) => String(url).includes(k === 'deer' ? 'red-deer' : `${k}.glb`));
    return parseGlb(FILES[key]);
};

function stubRenderer() {
    return {
        contextNode: context(),
        lighting: { enabled: false },
        backend: {
            device: null,
            capabilities: { getUniformBufferLimit: () => 65536 },
            extensions: { has: () => false },
            utils: { getTextureSampleData: () => ({ samples: 1, primarySamples: 1, isMSAA: false }) },
            compatibilityMode: false,
        },
        getRenderTarget: () => null,
        getMRT: () => null,
        shadowMap: { enabled: false, type: 0 },
        capabilities: {},
        library: { fromMaterial: (m) => m },
        nodes: {},
        getOutputRenderTarget: () => null,
        currentColorSpace: 'srgb',
        outputColorSpace: 'srgb',
        toneMapping: 0,
        xr: { enabled: false },
        debug: { checkShaderErrors: false, diagnostics: { keywords: true } },
        getUniformBufferLimit: () => 65536,
        hasFeature: () => false,
        isOutputTarget: false,
        logarithmicDepthBuffer: false,
        reverseDepth: false,
        highPrecision: false,
    };
}

function build(Builder, mesh) {
    const heard = [];
    const listen = (...args) => heard.push(args.map(String).join(' ').slice(0, 300));
    const warn = vi.spyOn(console, 'warn').mockImplementation(listen);
    const error = vi.spyOn(console, 'error').mockImplementation(listen);
    try {
        const builder = new Builder(mesh, stubRenderer());
        builder.scene = new THREE.Scene();
        builder.camera = new THREE.PerspectiveCamera();
        builder.context.material = mesh.material;
        builder.material = mesh.material;
        builder.build();
        return { vertex: builder.vertexShader, fragment: builder.fragmentShader, heard };
    } catch (thrown) {
        return { thrown, heard };
    } finally {
        warn.mockRestore();
        error.mockRestore();
    }
}

let swanModel;
let heronModel;
beforeAll(async () => {
    swanModel = parseOdysseyPondBird((await parseGlb(FILES.swan)).scene, 'swan');
    heronModel = parseOdysseyPondBird((await parseGlb(FILES.heron)).scene, 'heron');
});

describe('the pond birds: models, skins, the draw', () => {
    it('are small skinned models: a swan of 9 bones (its wings their own), a heron of 17 (its catch and open wings their own), under 1,700 triangles', () => {
        expect(swanModel.skeleton.map((b) => b.name))
            .toEqual(['root', 'neck0', 'neck1', 'neck2', 'neck3', 'neck4', 'head', 'wingL', 'wingR']);
        expect(heronModel.skeleton.map((b) => b.name).slice(0, 6)).toEqual(['root', 'neck0', 'neck1', 'neck2', 'neck3', 'head']);
        expect(heronModel.skeleton.length).toBe(17);
        expect(heronModel.skeleton[12].name).toBe('fish');
        expect(heronModel.skeleton.slice(13).map((b) => b.name)).toEqual(['wingL', 'handL', 'wingR', 'handR']);
        // The fish is its own small part, skinned whole to its bone.
        const bones = heronModel.geometry.attributes._bones;
        let fishVerts = 0;
        for (let v = 0; v < bones.count; v += 1) if (Math.round(bones.getX(v) * 255) === 12) fishVerts += 1;
        expect(fishVerts).toBeGreaterThan(8);
        [swanModel, heronModel].forEach((m) => {
            expect(m.triangles).toBeGreaterThan(600);
            expect(m.triangles).toBeLessThan(1700);
            // Every vertex's four weights sum to one, every bone index is in the skeleton.
            const w = m.geometry.attributes._weights;
            const b = m.geometry.attributes._bones;
            for (let i = 0; i < w.count; i += 1) {
                const sum = w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i);
                expect(Math.abs(sum - 1)).toBeLessThan(0.02);
                [b.getX(i), b.getY(i), b.getZ(i), b.getW(i)].forEach((v) => {
                    expect(Math.round(v * 255)).toBeLessThan(m.skeleton.length);
                });
            }
        });
    });

    it('builds both species\' draw cleanly for WGSL and GLSL, hidden until ready, drawn in the window', async () => {
        const rows = [];
        const pond = createOdysseyPondLife({ loadGltf, world: { setTarnSwans: (r) => rows.push([...r]) } });
        expect(pond.group.visible).toBe(false);
        await pond.load();
        const meshes = [];
        pond.group.traverse((o) => { if (o.isMesh && o.name.startsWith('odyssey-pond-')) meshes.push(o); });
        expect(meshes.map((m) => m.name).sort()).toEqual(['odyssey-pond-heron', 'odyssey-pond-swans']);
        meshes.forEach((mesh) => {
            BACKENDS.forEach(([label, Builder]) => {
                const out = build(Builder, mesh);
                expect(out.thrown, `${mesh.name} ${label}: ${out.thrown?.stack ?? ''}`).toBeUndefined();
                expect(out.heard, `${mesh.name} ${label}`).toEqual([]);
                expect(out.fragment).not.toMatch(/\bNaN\b|object Object/);
            });
        });
        pond.update(10, 0.25);
        expect(pond.group.visible).toBe(false);
        pond.markReady();
        pond.update(10, 0.25);
        expect(pond.group.visible).toBe(true);
        // The wakes go to the world while it is drawn, and away when it is not.
        expect(rows[rows.length - 1][0]).toBeLessThan(0);
        pond.update(10, 0.6);
        expect(pond.group.visible).toBe(false);
        expect(rows[rows.length - 1][0]).toBe(1e5);
        pond.dispose();
    }, 60_000);
});

describe('the swans', () => {
    const S = ODYSSEY_POND.swans;
    const loop = (swanRoute().length / S.speed) + (2 * S.lag);
    const states = [];
    beforeAll(() => {
        for (let t = 0; t < loop; t += 0.5) states.push([swanStateAt(0, t, {}), swanStateAt(1, t, {})]);
    });

    it('never leave the water: the whole hull over water at least 0.6 deep, all the loop', () => {
        let rn = 0;
        let depth = Infinity;
        states.forEach((pair) => pair.forEach((s) => {
            const fx = Math.sin(s.heading);
            const fz = Math.cos(s.heading);
            for (const [a, b] of [[1.9, 0], [-1.7, 0], [0, 0.7], [0, -0.7], [0, 0]]) {
                const x = s.x + (fx * a) + (fz * b);
                const z = s.z + (fz * a) - (fx * b);
                rn = Math.max(rn, odysseyTarnRn(x, z));
                depth = Math.min(depth, W - odysseyWorldHeight(x, z));
            }
        }));
        expect(rn).toBeLessThan(0.75);
        expect(depth).toBeGreaterThan(0.6);
    });

    it('turn smoothly along the route and the mate never swings wide (60 Hz, both swans)', () => {
        // The heading is the spline's own tangent (a table of straight pieces turned it in small
        // steps: 220 rad/s^2 at the root); the mate follows the lead's line, so its speed stays the
        // lead's (a fixed side offset cusped round the west turn at up to 14 u/s).
        [0, 1].forEach((i) => {
            let prevH = null;
            let prevW = null;
            let worstA = 0;
            let worstV = 0;
            let prev = null;
            for (let t = 0; t < 150; t += 1 / 60) {
                const s = swanStateAt(i, t, {});
                if (prev) worstV = Math.max(worstV, Math.hypot(s.x - prev.x, s.z - prev.z) * 60);
                if (prevH !== null) {
                    const w = Math.atan2(Math.sin(s.heading - prevH), Math.cos(s.heading - prevH)) * 60;
                    if (prevW !== null) worstA = Math.max(worstA, Math.abs(w - prevW) * 60);
                    prevW = w;
                }
                prevH = s.heading;
                prev = s;
            }
            expect(worstA, `swan ${i} heading acceleration`).toBeLessThan(3);
            expect(worstV, `swan ${i} speed`).toBeLessThan(ODYSSEY_POND.swans.speed * 1.4);
        });
    });

    it('keep apart, glide calmly (no sudden turns or speed changes) and stay world-anchored', () => {
        let gap = Infinity;
        let turn = 0;
        let accel = 0;
        states.forEach(([a, b], i) => {
            gap = Math.min(gap, Math.hypot(a.x - b.x, a.z - b.z));
            if (i === 0) return;
            const [pa] = states[i - 1];
            turn = Math.max(turn, Math.abs(Math.atan2(Math.sin(a.heading - pa.heading), Math.cos(a.heading - pa.heading))) / 0.5);
            accel = Math.max(accel, Math.abs(a.speed - pa.speed) / 0.5);
        });
        expect(gap).toBeGreaterThan(3);
        expect(turn).toBeLessThan(0.45);
        // The paddle strokes surge it a little, smoothly (a stroke a second).
        expect(accel).toBeLessThan(0.5);
        // The same clock gives the same place: nothing follows the camera.
        expect(swanStateAt(0, 123.4, {}).x).toBe(swanStateAt(0, 123.4, {}).x);
    });

    it('pose finite tables, the head under the water only when it dips', () => {
        const rig = createBirdRig(swanModel.skeleton);
        const table = new Float32Array(swanModel.skeleton.length * 8);
        for (let t = 0; t < ODYSSEY_POND.swans.loop; t += 0.5) {
            const s = poseSwan(rig, 0, t, W, table, 0, {});
            expect(table.every(Number.isFinite)).toBe(true);
            const headY = rig.hw[rig.index.head][1];
            if (s.dip < 0.05 && s.preen < 0.05) expect(headY).toBeGreaterThan(W + 1.2);
            if (s.dip > 0.95) expect(headY).toBeLessThan(W + 0.6);
        }
    });

    it('move every bone smoothly: no joint of the neck, head or wings turns faster than it can', () => {
        // Each bone's world rotation, frame to frame at 30 fps over both swans' whole loops: the
        // fastest is a wing beat in a stretch; nothing pops.
        [0, 1].forEach((i) => {
            const rig = createBirdRig(swanModel.skeleton);
            let prev = null;
            let fastest = 0;
            for (let t = 0; t < ODYSSEY_POND.swans.loop; t += 1 / 30) {
                poseSwan(rig, i, t, W, null, 0, {});
                const q = rig.qw.map((v) => [...v]);
                if (prev) fastest = Math.max(fastest, fastestTurn(q, prev));
                prev = q;
            }
            expect(fastest, `swan ${i} (rad/s)`).toBeLessThan(6);
        });
    });
});

const WING_BONES = Object.freeze(['wingL', 'handL', 'wingR', 'handR']);
/** The rows of `arr` at the indices `idx`, and those not at them. */
const pick = (arr, idx) => idx.map((b) => arr[b]);
const omit = (arr, idx) => arr.filter((_, b) => !idx.includes(b));

describe('the heron', () => {
    const rig = createBirdRig(heronModel ? heronModel.skeleton : []);
    const frames = [];
    beforeAll(() => {
        const r = createBirdRig(heronModel.skeleton);
        for (let t = 0; t < HERON_LOOP; t += 0.1) {
            const s = poseHeron(r, t, odysseyWorldHeight, null, 0, { feet: [{}, {}] });
            const feet = ['footL', 'footR'].map((n) => [...r.hw[r.index[n]]]);
            frames.push({ t, s: JSON.parse(JSON.stringify(s)), feet });
        }
        rig.skeleton = r.skeleton;
    });

    it('stands in the shallows: its feet under at most 1.2 u of water, never on dry ground far from it', () => {
        frames.forEach(({ s }) => s.feet.forEach((f) => {
            const depth = W - f.ground;
            expect(depth).toBeLessThan(1.2);
            expect(depth).toBeGreaterThan(-0.6);
        }));
    });

    it('never slides a planted foot, and its legs reach their feet', () => {
        let slide = 0;
        let miss = 0;
        frames.forEach((fr, i) => {
            fr.s.feet.forEach((f, side) => {
                // The leg's solve: the ankle where the planner put it (over its ground by the ankle);
                // in the air its legs trail, and reach for the water again before it lands.
                const ankle = fr.feet[side];
                const onFeet = !fr.s.flying || (fr.s.legs < 1e-3 && fr.s.height < 1e-3);
                if (onFeet) miss = Math.max(miss, Math.hypot(ankle[0] - f.x, ankle[2] - f.z));
                if (i === 0 || !f.planted) return;
                const prev = frames[i - 1].s.feet[side];
                if (prev.planted) slide = Math.max(slide, Math.hypot(f.x - prev.x, f.z - prev.z));
            });
        });
        expect(slide).toBeLessThan(1e-6);
        expect(miss).toBeLessThan(0.35);
    });

    it('holds its head still while it steps, and moves every joint smoothly', () => {
        // Over each stalk: the head's travel while the body moves under it, against the body's; and
        // the fastest any bone turns, frame to frame at 30 fps (the strike's shot is the fastest).
        const r = createBirdRig(heronModel.skeleton);
        const wings = WING_BONES.map((n) => r.index[n]);
        let prev = null;
        let fastest = 0;
        let fastestShot = 0;
        let fastestWing = 0;
        let bodyMoved = 0;
        let headMoved = 0;
        let last = null;
        for (let t = 0; t < HERON_LOOP; t += 1 / 30) {
            const s = poseHeron(r, t, odysseyWorldHeight, null, 0, { feet: [{}, {}] });
            const q = r.qw.map((v) => [...v]);
            if (prev) {
                // The open wings beat (their own measure); the rest of it, the body and the neck.
                const w = fastestTurn(omit(q, wings), omit(prev, wings));
                fastestWing = Math.max(fastestWing, fastestTurn(pick(q, wings), pick(prev, wings)));
                if (s.shoot > 0.001 && s.shoot < 0.999) fastestShot = Math.max(fastestShot, w);
                else fastest = Math.max(fastest, w);
            }
            prev = q;
            const headAt = r.hw[r.index.head];
            if (last && s.walking && s.headLag > 0.01 && last.lag < s.headLag && Math.abs(s.heading - last.heading) < 1e-4) {
                bodyMoved += Math.hypot(s.x - last.x, s.z - last.z);
                headMoved += Math.hypot(headAt[0] - last.hx, headAt[1] - last.hy, headAt[2] - last.hz);
            }
            last = {
                x: s.x, z: s.z, hx: headAt[0], hy: headAt[1], hz: headAt[2], lag: s.headLag, heading: s.heading,
            };
        }
        expect(bodyMoved).toBeGreaterThan(1);
        expect(headMoved / bodyMoved).toBeLessThan(0.2);
        // Calm moves stay under ~2 turns a second; the strike's shot, a heron's fastest move, is
        // eased at both ends and never jumps.
        expect(fastest).toBeLessThan(12);
        expect(fastestShot).toBeLessThan(30);
        // Slow, deep wingbeats (a heron's ~1.5 a second): the arm and hand never faster than that.
        expect(fastestWing).toBeGreaterThan(5);
        expect(fastestWing).toBeLessThan(14);
    });

    it('turns in small steps, never spinning, and swallows the fish it catches', () => {
        // Over the whole loop: the body never turns faster than a stepped turn allows; a fish is in
        // the bill only after a strike's shot (its bill under the water when it appears) and is
        // gone again within seconds, swallowed.
        let fastest = 0;
        let fastestFlying = 0;
        let prev = null;
        let fishTime = 0;
        let fishRuns = 0;
        let inRun = false;
        let longest = 0;
        let run = 0;
        for (let t = 0; t < HERON_LOOP; t += 1 / 30) {
            const s = heronStateAt(t, { feet: [{}, {}] });
            if (prev !== null) {
                const w = Math.abs(Math.atan2(Math.sin(s.heading - prev), Math.cos(s.heading - prev))) * 30;
                if (s.flying) fastestFlying = Math.max(fastestFlying, w);
                else fastest = Math.max(fastest, w);
            }
            prev = s.heading;
            if (s.fish > 0.01) {
                fishTime += 1 / 30;
                run += 1 / 30;
                if (!inRun) {
                    fishRuns += 1;
                    expect(s.shoot, `a fish appears only with the bill down, t ${t.toFixed(2)}`).toBeGreaterThan(0.9);
                }
                inRun = true;
                longest = Math.max(longest, run);
            } else {
                inRun = false;
                run = 0;
            }
        }
        expect(fastest).toBeLessThan(1.2);
        // In the air it follows its curve, banked: never a sudden swing.
        expect(fastestFlying).toBeLessThan(2.2);
        expect(fishRuns).toBeGreaterThan(0);
        expect(longest).toBeLessThan(5);
        expect(fishTime).toBeGreaterThan(0);
    });

    it('flies between its two places every two or three minutes, its wings drawn only in the air, clear of the bank', () => {
        // Two flights a loop, a minute and a half to three apart; each leaves from its two feet and
        // lands on them (planted, no slide), its body over the ground it left and the ground it lands on;
        // in the air its feet are a unit and more over the bank it crosses.
        expect(HERON_FLIGHTS.length).toBe(2);
        const gaps = HERON_FLIGHTS.map((f, i) => {
            const next = HERON_FLIGHTS[(i + 1) % HERON_FLIGHTS.length];
            return ((next.t0 - f.t0) + HERON_LOOP) % HERON_LOOP;
        });
        gaps.forEach((g) => {
            expect(g).toBeGreaterThan(90);
            expect(g).toBeLessThan(180);
        });
        const r = createBirdRig(heronModel.skeleton);
        const wings = WING_BONES.map((n) => r.index[n]);
        HERON_FLIGHTS.forEach((f) => {
            let clear = Infinity;
            let peak = 0;
            for (let u = -1; u < f.dur + 1; u += 1 / 30) {
                const s = poseHeron(r, f.t0 + u, odysseyWorldHeight, null, 0, { feet: [{}, {}] });
                const open = wings.map((b) => r.grown[b]);
                if (!s.flying) open.forEach((v) => expect(v, `wings folded away at ${u.toFixed(2)}`).toBe(0));
                if (s.height > 0.6) {
                    const feetY = Math.min(r.hw[r.index.footL][1], r.hw[r.index.footR][1]);
                    clear = Math.min(clear, feetY - Math.max(W, odysseyWorldHeight(s.x, s.z)));
                }
                peak = Math.max(peak, s.height * ODYSSEY_POND.heron.scale);
            }
            expect(clear, 'clear of the water and the bank').toBeGreaterThan(1);
            expect(peak).toBeGreaterThan(4);
            expect(peak).toBeLessThan(8);
        });
    });

    it('reaches with a two-segment solve whose heel bends back', () => {
        const { upper, lower } = legReach(0.26, 0.27, 0.01, -0.42);
        expect(upper).toBeLessThan(lower);
        expect(Math.hypot(
            (0.26 * Math.sin(upper)) + (0.27 * Math.sin(lower)),
            (0.26 * Math.cos(upper)) + (0.27 * Math.cos(lower)),
        )).toBeCloseTo(Math.hypot(0.01, 0.42), 4);
        // Past ~93 % of its length the reach eases off smoothly: no kink at full stretch.
        const near = legReach(0.26, 0.27, 0, -0.52);
        const nearer = legReach(0.26, 0.27, 0, -0.5201);
        expect(Math.abs(near.upper - nearer.upper)).toBeLessThan(0.01);
    });
});

describe('the drinkers', () => {
    let herd;
    let rig;
    beforeAll(async () => {
        const model = parseOdysseyDeer((await parseGlb(FILES.deer)).scene);
        rig = createDeerRig(model.skeleton);
        herd = buildHerd(ODYSSEY_TARN_DEER);
        planFootfalls(herd, rig, ODYSSEY_TARN_DEER);
    }, 120_000);

    it('walk dry or shallow, gentle ground clear of trees and boulders, and come to the water\'s edge', () => {
        const RAIL = Array.from({ length: 48 }, (_, i) => getOdysseyPathPointAt(i / 47));
        const trees = [15, 24].flatMap((spacing) => scatterZonedForest(odysseyWorldHeight, { rail: RAIL, spacing })
            .placements.filter((t) => Math.abs(t.x + 330) < 80 && Math.abs(t.z + 480) < 80));
        const rocks = buildBoulderSites(odysseyWorldHeight, { trees });
        herd.forEach((deer, i) => {
            let nearest = Infinity;
            let slope = 0;
            let clear = Infinity;
            let wet = 0;
            let hoof = 0;
            for (let t = 0; t < deer.loop; t += 1) {
                const s = deerStateAt(deer, t);
                const pose = poseDeer(rig, deer, t, odysseyWorldHeight, null, 0, ODYSSEY_TARN_DEER);
                nearest = Math.min(nearest, odysseyTarnRn(s.x, s.z));
                const e = 1.5;
                slope = Math.max(slope, Math.hypot(
                    (odysseyWorldHeight(s.x + e, s.z) - odysseyWorldHeight(s.x - e, s.z)) / (2 * e),
                    (odysseyWorldHeight(s.x, s.z + e) - odysseyWorldHeight(s.x, s.z - e)) / (2 * e),
                ));
                for (const h of pose.hooves) {
                    wet = Math.max(wet, W - h.ground);
                    if (h.stance > 0.95) hoof = Math.max(hoof, Math.abs(h.y - h.ground) / deer.k);
                }
                for (const tr of trees) clear = Math.min(clear, Math.hypot(tr.x - s.x, tr.z - s.z) - (0.6 * 4.6 * tr.scaleXZ));
                for (const r of rocks) clear = Math.min(clear, Math.hypot(r.x - s.x, r.z - s.z) - Math.max(r.sx, r.sz) - 1);
            }
            const label = `${deer.member.name} #${i}`;
            expect(nearest, `${label} comes down to the water`).toBeLessThan(1.05);
            expect(wet, `${label} never deeper than its fetlocks`).toBeLessThan(0.6);
            // The bowl's rim is steeper than the glade: they come down its gentlest stretch.
            expect(slope, `${label} slope`).toBeLessThan(0.75);
            expect(hoof, `${label} standing hooves on the ground (share of size)`).toBeLessThan(0.1);
            expect(clear, `${label} clear of trees and rocks`).toBeGreaterThan(0.5);
            expect(odysseyWorldHeight(deer.member.spots[1][0], deer.member.spots[1][1]) - ODYSSEY_SEA_LEVEL).toBeGreaterThan(8);
        });
    }, 120_000);
});

describe('the pond on the rail camera', () => {
    const cam = createOdysseyCameraRig();
    const pxAt = (camera, d) => 1440 / (2 * Math.tan((camera.fov * Math.PI) / 360) * d);

    it('is in view through the L18 -> L19 glide and at L22-L23, at a readable size (1440p)', () => {
        // The share of the swans' loop in which a swan is in frame (the west lobe is all L22-L23 see),
        // the heron's and the drinkers' bank in frame, and the swan's length in pixels.
        const loop = swanRoute().length / ODYSSEY_POND.swans.speed;
        [[0.235, 0.8], [0.245, 0.8], [0.255, 0.6], [cam.parkOf(22), 0.25], [cam.parkOf(23), 0.25]].forEach(([p, share]) => {
            const camera = cam.poseAt(p);
            let seen = 0;
            let n = 0;
            let px = Infinity;
            for (let t = 0; t < loop; t += 3) {
                n += 1;
                let hit = false;
                for (const i of [0, 1]) {
                    const s = swanStateAt(i, t, {});
                    const at = new THREE.Vector3(s.x, W + 1, s.z);
                    if (cam.inFrame(camera, at, 0.95)) {
                        px = Math.min(px, 3.4 * pxAt(camera, camera.position.distanceTo(at)));
                        hit = true;
                    }
                }
                if (hit) seen += 1;
            }
            const label = `p ${p.toFixed(4)}`;
            expect(seen / n, `${label} swans in frame`).toBeGreaterThan(share);
            expect(px, `${label} swan length (px)`).toBeGreaterThan(12);
            // The heron's north shore, every view's; and the flights, all but their ends at the
            // south-west shallows (which the parks see at the frame's foot), in frame.
            const heron = HERON_STOPS[0];
            expect(cam.inFrame(camera, new THREE.Vector3(heron[0], W + 2, heron[1]), 0.95), `${label} heron`).toBe(true);
            if (p > 0.26) {
                let inside = 0;
                let n2 = 0;
                HERON_FLIGHTS.forEach((f) => {
                    for (let u = 0.6; u < f.touchdown - 0.6; u += 0.1) {
                        const s = heronStateAt(f.t0 + u, { feet: [{}, {}] });
                        const y = Math.max(W, odysseyWorldHeight(s.x, s.z)) + (s.height * ODYSSEY_POND.heron.scale) + 1;
                        n2 += 1;
                        if (cam.inFrame(camera, new THREE.Vector3(s.x, y, s.z), 1)) inside += 1;
                    }
                });
                expect(inside / n2, `${label} flights in frame`).toBeGreaterThan(0.7);
            }
            const bank = ODYSSEY_TARN_DEER.members[0].spots[0];
            expect(cam.inFrame(camera, new THREE.Vector3(bank[0], W + 3, bank[1]), 0.95), `${label} bank`).toBe(true);
        });
    });

    it('never appears or leaves in view: the eye is under the sea as the window opens, all out of frame as it closes', () => {
        const [p0, p1] = ODYSSEY_POND.window;
        expect(cam.poseAt(p0).position.y).toBeLessThan(ODYSSEY_SEA_LEVEL - 20);
        const camera = cam.poseAt(p1);
        const pts = [];
        for (let t = 0; t < 400; t += 2) {
            const a = swanStateAt(0, t, {});
            const b = swanStateAt(1, t, {});
            pts.push([a.x, W + 2, a.z], [b.x, W + 2, b.z]);
        }
        HERON_STOPS.forEach(([x, z]) => pts.push([x, W + 4, z]));
        HERON_FLIGHTS.forEach((f) => {
            for (let u = 0; u < f.dur; u += 0.25) {
                const s = heronStateAt(f.t0 + u + 1e-3, { feet: [{}, {}] });
                pts.push([s.x, Math.max(W, odysseyWorldHeight(s.x, s.z)) + (s.height * ODYSSEY_POND.heron.scale) + 2, s.z]);
            }
        });
        ODYSSEY_TARN_DEER.members.forEach((m) => m.spots.forEach(([x, z]) => pts.push([x, odysseyWorldHeight(x, z) + 4, z])));
        pts.forEach(([x, y, z]) => {
            expect(cam.inFrame(camera, new THREE.Vector3(x, y, z), 1.1), `(${x.toFixed(0)}, ${z.toFixed(0)}) at p ${p1}`)
                .toBe(false);
        });
    });
});
