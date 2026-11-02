/**
 * LIFE AT THE POND (chapter 3's tarn, 2026-11-02): two swans, a heron, a hind and her calf come down
 * to drink. What is pinned here:
 *  - the models and their skins, and both shader backends build the birds' draw cleanly;
 *  - hidden until ready, drawn only through the window;
 *  - THE SWANS never leave the water (their whole hull over deep water at every moment of the loop)
 *    and keep apart; THE HERON stands in the shallows, its planted feet never slide, its legs reach
 *    them; THE DRINKERS walk dry or shallow, gentle ground clear of the trees and boulders, and come
 *    to the water's edge;
 *  - SITING on the real rail camera: in frame through the L18 -> L19 glide and at L22-L23, at the
 *    pixel sizes the doc records (1440p); never appearing or leaving in view.
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
    HERON_LOOP, ODYSSEY_POND, ODYSSEY_TARN_DEER, createBirdRig, legReach, poseHeron, poseSwan, swanRoute,
    swanStateAt,
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
    it('are small skinned models: a swan of 6 bones, a heron of 11, under 1,500 triangles each', () => {
        expect(swanModel.skeleton.map((b) => b.name)).toEqual(['root', 'neck0', 'neck1', 'neck2', 'neck3', 'head']);
        expect(heronModel.skeleton.length).toBe(11);
        [swanModel, heronModel].forEach((m) => {
            expect(m.triangles).toBeGreaterThan(600);
            expect(m.triangles).toBeLessThan(1500);
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
        expect(accel).toBeLessThan(0.05);
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
            if (s.dip < 0.05) expect(headY).toBeGreaterThan(W + 1.2);
        }
    });
});

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
                // The leg's solve: the ankle where the planner put it (over its ground by the ankle).
                const ankle = fr.feet[side];
                miss = Math.max(miss, Math.hypot(ankle[0] - f.x, ankle[2] - f.z));
                if (i === 0 || !f.planted) return;
                const prev = frames[i - 1].s.feet[side];
                if (prev.planted) slide = Math.max(slide, Math.hypot(f.x - prev.x, f.z - prev.z));
            });
        });
        expect(slide).toBeLessThan(1e-6);
        expect(miss).toBeLessThan(0.35);
    });

    it('reaches with a two-segment solve whose heel bends back', () => {
        const { upper, lower } = legReach(0.26, 0.27, 0.01, -0.5);
        expect(upper).toBeLessThan(lower);
        expect(Math.hypot((0.26 * Math.sin(upper)) + (0.27 * Math.sin(lower)),
            (0.26 * Math.cos(upper)) + (0.27 * Math.cos(lower)))).toBeCloseTo(Math.hypot(0.01, 0.5), 4);
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
                pose.hooves.forEach((h) => {
                    wet = Math.max(wet, W - h.ground);
                    if (h.stance > 0.95) hoof = Math.max(hoof, Math.abs(h.y - h.ground) / deer.k);
                });
                trees.forEach((tr) => { clear = Math.min(clear, Math.hypot(tr.x - s.x, tr.z - s.z) - (0.6 * 4.6 * tr.scaleXZ)); });
                rocks.forEach((r) => { clear = Math.min(clear, Math.hypot(r.x - s.x, r.z - s.z) - Math.max(r.sx, r.sz) - 1); });
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
                const hit = [0, 1].some((i) => {
                    const s = swanStateAt(i, t, {});
                    const at = new THREE.Vector3(s.x, W + 1, s.z);
                    if (!cam.inFrame(camera, at, 0.95)) return false;
                    px = Math.min(px, 3.4 * pxAt(camera, camera.position.distanceTo(at)));
                    return true;
                });
                if (hit) seen += 1;
            }
            const label = `p ${p.toFixed(4)}`;
            expect(seen / n, `${label} swans in frame`).toBeGreaterThan(share);
            expect(px, `${label} swan length (px)`).toBeGreaterThan(12);
            const heron = ODYSSEY_POND.heron.spots[0];
            expect(cam.inFrame(camera, new THREE.Vector3(heron[0], W + 2, heron[1]), 0.95), `${label} heron`).toBe(true);
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
        ODYSSEY_POND.heron.spots.forEach(([x, z]) => pts.push([x, W + 3, z]));
        ODYSSEY_TARN_DEER.members.forEach((m) => m.spots.forEach(([x, z]) => pts.push([x, odysseyWorldHeight(x, z) + 4, z])));
        pts.forEach(([x, y, z]) => {
            expect(cam.inFrame(camera, new THREE.Vector3(x, y, z), 1.1), `(${x.toFixed(0)}, ${z.toFixed(0)}) at p ${p1}`)
                .toBe(false);
        });
    });
});
