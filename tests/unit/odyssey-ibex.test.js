/**
 * Odyssey's ibex (2026-11-02): a buck, two nannies and a kid on the shelf above the grey rock band at
 * the massif's foot (composition/odyssey-ibex-herd.js, odyssey-ibex.js). No GPU needed:
 *  - THE MODEL: the Blender-built GLB carries the deer's 27-bone skeleton, its skin, its paint and
 *    the horns' roots, within its triangle budget.
 *  - SHADERS: the group's and the shadows' materials build through three's WGSL and GLSL node
 *    builders against a stub renderer: no throw, no warning, no NaN / Infinity.
 *  - THE ROCK: every animal stays on the standable shelf at the rim of the rock band, clear of the
 *    trees; the hooves bearing weight stand where the plan put them; the animals keep apart.
 *  - THE LEAP: those that leap leave the rock with all four hooves, fly an arc and land on all four,
 *    planted.
 *  - THE CAMERA: the REAL rail camera sees them from L19 to L25, and never sees them appear or leave.
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
    createDeerRig, deerFootAt, deerLeapAt, deerStateAt, planFootfalls, poseDeer,
} from '../../src/rendering/odyssey/composition/odyssey-deer-herd.js';
import {
    ODYSSEY_IBEX, buildIbexHerd, ibexRevealAt,
} from '../../src/rendering/odyssey/composition/odyssey-ibex-herd.js';
import { createOdysseyIbex, parseOdysseyIbex } from '../../src/rendering/odyssey/composition/odyssey-ibex.js';
import { ODYSSEY_SEA_LEVEL, odysseyWorldHeight } from '../../src/rendering/odyssey/world/odyssey-world-height.js';
import { scatterZonedForest } from '../../src/rendering/odyssey/world/odyssey-forest-scatter.js';
import { getOdysseyPathPointAt } from '../../src/rendering/odyssey/path-utils.js';

const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
const GLB = new URL('../../src/rendering/odyssey/assets/chapter-04/ibex/alpine-ibex.glb', import.meta.url);
const DEER_BONES = ['root', 'pelvis', 'chest', 'neck0', 'neck1', 'neck2', 'head', 'jaw', 'earL', 'earR', 'tail'];
const H = odysseyWorldHeight;
const gradient = (x, z) => Math.hypot((H(x + 1.5, z) - H(x - 1.5, z)) / 3, (H(x, z + 1.5) - H(x, z - 1.5)) / 3);

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

async function parseGlb() {
    const file = readFileSync(GLB);
    return new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '');
}

let model;
let rig;
const herd = buildIbexHerd();

beforeAll(async () => {
    model = parseOdysseyIbex((await parseGlb()).scene);
    rig = createDeerRig(model.skeleton);
    planFootfalls(herd, rig, ODYSSEY_IBEX);
});

describe('the ibex model', () => {
    it('carries the deer\'s skeleton, its skin, its paint and the horns\' roots, in budget', () => {
        expect(model.skeleton).toHaveLength(27);
        DEER_BONES.forEach((name) => expect(model.skeleton.some((b) => b.name === name), name).toBe(true));
        expect(model.triangles).toBeGreaterThan(1600);
        expect(model.triangles).toBeLessThanOrEqual(2600);
        const { attributes } = model.geometry;
        const head = model.skeleton.findIndex((b) => b.name === 'head');
        let hornVerts = 0;
        for (let i = 0; i < attributes._horn.count; i += 1) {
            if (attributes._horn.getW(i) < 0.5) continue;
            hornVerts += 1;
            // A horn rides the head alone.
            expect(Math.round(attributes._bones.getX(i) * 255)).toBe(head);
            expect(attributes._weights.getX(i)).toBeGreaterThan(0.99);
        }
        expect(hornVerts).toBeGreaterThan(60);
        // A nanny at life size: about 0.8 m at the withers, the hooves on y = 0, the buck's horns
        // sweeping up to ~1.3 m.
        const box = new THREE.Box3().setFromBufferAttribute(attributes.position);
        expect(box.min.y).toBeCloseTo(0, 2);
        expect(box.max.y).toBeGreaterThan(1.15);
        expect(box.max.y).toBeLessThan(1.45);
    });
});

describe('the ibex drawn', () => {
    it('loads off the GPU, is ready only when told, and builds for both backends', async () => {
        const gltf = await parseGlb();
        const ibex = createOdysseyIbex({ loadGltf: async () => ({ scene: gltf.scene }) });
        expect(ibex.group.visible).toBe(false);
        expect(await ibex.load()).toBe(true);
        const meshes = [];
        ibex.group.traverse((o) => { if (o.isMesh) meshes.push(o); });
        expect(meshes.map((m) => m.name).sort()).toEqual(['odyssey-ibex-group', 'odyssey-ibex-shadows']);
        meshes.forEach((mesh) => BACKENDS.forEach(([label, Builder]) => {
            const out = build(Builder, mesh);
            expect(out.thrown, `${mesh.name} ${label}: ${out.thrown?.stack ?? ''}`).toBeUndefined();
            expect(out.heard, `${mesh.name} ${label}`).toEqual([]);
            ['vertex', 'fragment'].forEach((stage) => {
                expect(out[stage], `${mesh.name} ${label} ${stage}`).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
            });
            expect(out.vertex).toMatch(/textureLoad|texelFetch/);
        }));
        const p = ODYSSEY_IBEX.window[0] + 0.05;
        ibex.update(10, p);
        expect(ibex.group.visible).toBe(false);
        ibex.markReady();
        ibex.update(10, p);
        expect(ibex.group.visible).toBe(true);
        ibex.update(10, 0.6);
        expect(ibex.group.visible).toBe(false);
        // Four animals, one draw for the bodies and one for the shadows.
        expect(ibex.triangles).toBe(model.triangles * 4);
        ibex.dispose();
    });
});

describe('the ibex on the rock', () => {
    const RAIL = Array.from({ length: 48 }, (_, i) => getOdysseyPathPointAt(i / 47));
    const trees = [15, 24].flatMap((spacing) => scatterZonedForest(H, { rail: RAIL, spacing }).placements
        .filter((t) => Math.abs(t.x + 152) < 70 && Math.abs(t.z + 562) < 60));
    const stats = herd.map(() => ({
        clear: Infinity, slope: 0, rim: 0, dry: Infinity, stance: [], dig: 0, leapDig: 0,
    }));
    let gap = Infinity;
    const states = [];
    // The rock band: is there ground steeper than 0.9 (the ground paints it rock) within `r`?
    const rockNear = (x, z, r) => {
        for (let a = 0; a < 16; a += 1) {
            for (const d of [r * 0.5, r]) {
                const th = (a / 16) * Math.PI * 2;
                if (gradient(x + (Math.cos(th) * d), z + (Math.sin(th) * d)) > 0.9) return true;
            }
        }
        return false;
    };

    beforeAll(() => {
        const longest = Math.max(...herd.map((a) => a.loop));
        const times = Array.from({ length: Math.ceil(longest * 15) }, (_, f) => f / 15);
        times.forEach((t) => {
            herd.forEach((animal, i) => {
                const pose = poseDeer(rig, animal, t, H, null, 0, ODYSSEY_IBEX);
                const s = pose.state;
                const m = stats[i];
                const leaping = deerLeapAt(animal, t).on;
                for (const tree of trees) {
                    m.clear = Math.min(m.clear, Math.hypot(tree.x - s.x, tree.z - s.z) - (0.6 * 4.6 * tree.scaleXZ));
                }
                m.slope = Math.max(m.slope, gradient(s.x, s.z));
                m.dry = Math.min(m.dry, H(s.x, s.z) - ODYSSEY_SEA_LEVEL);
                pose.hooves.forEach((h) => {
                    if (h.stance > 0.95) {
                        m.stance.push(Math.hypot(h.x - h.planX, h.z - h.planZ, h.y - h.ground) / animal.k);
                    }
                    const dig = (h.ground - h.y) / animal.k;
                    if (leaping) m.leapDig = Math.max(m.leapDig, dig);
                    else m.dig = Math.max(m.dig, dig);
                });
                states[i] = { ...s };
                if (i !== herd.length - 1) return;
                for (let a = 0; a < herd.length; a += 1) {
                    for (let b = a + 1; b < herd.length; b += 1) {
                        const d = Math.hypot(states[a].x - states[b].x, states[a].z - states[b].z);
                        gap = Math.min(gap, d / (0.3 * (herd[a].k + herd[b].k)));
                    }
                }
            });
        });
        herd.forEach((animal, i) => {
            stats[i].rim = animal.member.spots.every(([x, z]) => rockNear(x, z, 12)) ? 1 : 0;
        });
    });

    it('keeps every animal on the standable shelf at the rock band\'s rim, clear of the trees', () => {
        stats.forEach((m, i) => {
            const label = `${herd[i].member.name} #${i}`;
            expect(m.dry, `${label} above the sea`).toBeGreaterThan(40);
            expect(m.slope, `${label} slope`).toBeLessThan(0.55);
            expect(m.rim, `${label} spots by the rock band`).toBe(1);
            expect(m.clear, `${label} clear of the trees`).toBeGreaterThan(0.5);
        });
    });

    it('stands the hooves bearing weight where the plan put them, on the rock', () => {
        stats.forEach((m, i) => {
            const label = `${herd[i].member.name} #${i}`;
            const sorted = [...m.stance].sort((a, b) => a - b);
            // In shares of the drawn size: nearly always within a few centimetres of life size.
            expect(sorted[Math.floor(sorted.length * 0.99)], `${label} stance (99th percentile)`).toBeLessThan(0.07);
            expect(sorted[sorted.length - 1], `${label} stance (worst)`).toBeLessThan(0.25);
            // (On the shelf's side slopes a swinging hoof's tip grazes the rock; at a landing a fore
            // hoof reaching up the slope does too, by at most about a pixel at these distances.)
            expect(m.dig, `${label} digging`).toBeLessThan(0.2);
            expect(m.leapDig, `${label} digging in a leap`).toBeLessThan(0.2);
        });
    });

    it('keeps the animals apart (the kid near its mother, never inside her)', () => {
        expect(gap).toBeGreaterThan(0.9);
    });

    it('leaves the rock with all four hooves, flies an arc, and lands on all four, planted', () => {
        let leaps = 0;
        herd.forEach((animal) => {
            animal.segments.filter((s) => s.kind === 'leap').forEach((s) => {
                leaps += 1;
                const label = `${animal.member.name} leap at ${s.t0.toFixed(1)} s`;
                const off = s.t0 + s.crouch;
                const mid = off + (s.flight / 2);
                // Mid-flight: no hoof on the rock, the body well up off its line.
                for (let l = 0; l < 4; l += 1) {
                    expect(deerFootAt(animal, l, mid, {}).planted, `${label} hoof ${l}`).toBe(false);
                }
                const standing = poseDeer(rig, animal, s.t0 - 0.5, H, null, 0, ODYSSEY_IBEX);
                const standY = rig.J[rig.index.root][1] - standing.ground;
                const flying = poseDeer(rig, animal, mid, H, null, 0, ODYSSEY_IBEX);
                const line = H(s.x0, s.z0) + ((H(s.x1, s.z1) - H(s.x0, s.z0)) * 0.5);
                expect(rig.J[rig.index.root][1] - line - standY, label).toBeGreaterThan(0.3 * animal.k);
                expect(flying.state.x, label).toBeCloseTo((s.x0 + s.x1) / 2, 0);
                // After the landing every hoof is planted, near where it lands.
                const after = off + s.flight + 0.3;
                for (let l = 0; l < 4; l += 1) {
                    const f = deerFootAt(animal, l, after, {});
                    expect(f.planted, `${label} hoof ${l} down`).toBe(true);
                    const away = Math.hypot(f.x - s.x1, f.z - s.z1);
                    expect(away, `${label} hoof ${l} at the landing`).toBeLessThan(1.2 * animal.k);
                }
            });
        });
        // The buck, a nanny each and the kid's two hops.
        expect(leaps).toBe(5);
    });
});

describe('the ibex seen from the rail', () => {
    const cam = createOdysseyCameraRig();
    /** An animal's shoulder on screen at 1440p, or 0 when it is out of the frame or behind ground. */
    function seenPx(camera, animal, s) {
        const ground = H(s.x, s.z);
        const top = new THREE.Vector3(s.x, ground + (0.79 * animal.k), s.z);
        if (!cam.inFrame(camera, top, 0.97)) return 0;
        const eye = camera.position;
        const d = top.clone().sub(eye);
        const len = d.length();
        d.divideScalar(len);
        for (let step = 3; step < len - 3; step += Math.max(2, step * 0.03)) {
            if (H(eye.x + (d.x * step), eye.z + (d.z * step)) > eye.y + (d.y * step)) return 0;
        }
        return Math.abs(top.clone().project(camera).y - new THREE.Vector3(s.x, ground, s.z).project(camera).y) * 720;
    }

    it('is in view from L19 to L25 (but L23, which looks west), the buck large enough to read', () => {
        // [level, the buck's shoulder in pixels at 1440p, at least]. Measured 2026-11-02: 13, 13, 19,
        // 25 and 28 px; the nannies about four fifths of that, the kid a little under half.
        [[19, 12], [21, 12], [22, 17], [24, 23], [25, 26]].forEach(([level, px]) => {
            const camera = cam.poseAt(cam.parkOf(level));
            let buck = 0;
            let inView = 0;
            [0, 60, 120, 180].forEach((t) => {
                let n = 0;
                herd.forEach((animal) => {
                    const p = seenPx(camera, animal, deerStateAt(animal, t, {}));
                    if (p > 0) n += 1;
                    if (animal.member.name === 'buck') buck = Math.max(buck, p);
                });
                inView = Math.max(inView, n);
            });
            expect(inView, `L${level} ibex in the frame`).toBe(4);
            expect(buck, `L${level} buck (px)`).toBeGreaterThan(px);
        });
    });

    it('never appears or leaves in view: out of the frame at both ends of its window', () => {
        const [start, end] = ODYSSEY_IBEX.window;
        expect(ibexRevealAt(start - 0.001)).toBe(0);
        expect(ibexRevealAt(start + 0.001)).toBe(1);
        expect(ibexRevealAt(end - 0.001)).toBe(1);
        expect(ibexRevealAt(end + 0.001)).toBe(0);
        // Around each end (the end from a little before it: the camera lags its settled pose in a
        // glide), every animal out of a padded frame at every clock phase.
        const check = (from, to) => {
            for (let p = from; p <= to; p += 0.0005) {
                const camera = cam.poseAt(p);
                [0, 60, 120, 180].forEach((t) => herd.forEach((animal) => {
                    const s = deerStateAt(animal, t, {});
                    const pt = new THREE.Vector3(s.x, H(s.x, s.z) + animal.k, s.z);
                    expect(cam.inFrame(camera, pt, 1.1), `${animal.member.name} at p ${p.toFixed(4)}`).toBe(false);
                }));
            }
        };
        check(start - 0.003, start + 0.003);
        check(end - 0.012, end + 0.003);
    });
});
