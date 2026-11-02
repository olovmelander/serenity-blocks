/**
 * Odyssey's ground animals (2026-11-01): the glade's red deer above the chapter-3 shore.
 *
 * No GPU needed:
 *  - THE MODEL: the Blender-built GLB parses, carries its skin and paint and its 25-bone skeleton,
 *    and stays within its triangle budget.
 *  - SHADERS: the herd's and the shadows' materials build through three's own WGSL and GLSL node
 *    builders against a stub renderer (the harness of odyssey-act2-life.test.js): no throw, no
 *    warning, no NaN / Infinity / stringified node.
 *  - THE GROUND: every deer stays on open, dry, walkable grass clear of the trees (both tiers'
 *    forests), the hooves that bear its weight stand on the ground, the swinging ones never dig
 *    in, the deer keep apart, and a grazing head reaches the grass.
 *  - THE CAMERA: the REAL rail camera (tests/unit/helpers/odyssey-camera-rig.js) sees the herd at
 *    the chapter-3 orb parks, large enough to read, and never sees it appear or leave: at both
 *    ends of its window it is out of the frame (or behind the sea's surface, deep in chapter 2).
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
    ODYSSEY_DEER, buildHerd, createDeerRig, deerPathAt, deerRevealAt, deerStateAt, planFootfalls, poseDeer,
} from '../../src/rendering/odyssey/composition/odyssey-deer-herd.js';
import { createOdysseyDeer, parseOdysseyDeer } from '../../src/rendering/odyssey/composition/odyssey-deer.js';
import {
    ODYSSEY_SEA_LEVEL, odysseyWorldDetailWeight, odysseyWorldHeight, odysseyWorldMacro, odysseyWorldRelief,
} from '../../src/rendering/odyssey/world/odyssey-world-height.js';
import { scatterZonedForest } from '../../src/rendering/odyssey/world/odyssey-forest-scatter.js';
import { getOdysseyPathPointAt } from '../../src/rendering/odyssey/path-utils.js';

const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
/**
 * The motion pass's limits (rad/s, rad/s^2, m/s^2), over every deer's whole loop at 30 fps. Measured
 * 2026-11-02: spine, neck and head at most ~3 rad/s (the head going down to graze), legs ~14 (a
 * walk's swing), tail, ears and jaw ~3.3; their accelerations ~19, ~355 and ~32; the body ~2.7 m/s^2.
 * The old solver's legs reached 41 rad/s in single-frame pops.
 */
const MOTION_LIMITS = Object.freeze({
    bodyW: 3.5, legW: 16, flickW: 4, bodyAcc: 25, legAcc: 450, flickAcc: 45, accel: 3.2,
});
const GLB = new URL('../../src/rendering/odyssey/assets/chapter-03/deer/red-deer.glb', import.meta.url);

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

/** Both stages of a mesh's material as one backend writes them, plus what three said. */
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

function expectClean(out, label) {
    expect(out.thrown, `${label}: ${out.thrown?.stack ?? ''}`).toBeUndefined();
    expect(out.heard, label).toEqual([]);
    ['vertex', 'fragment'].forEach((stage) => {
        expect(typeof out[stage], `${label} ${stage}`).toBe('string');
        expect(out[stage], `${label} ${stage}`).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
    });
}

async function parseGlb() {
    const file = readFileSync(GLB);
    const bytes = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    return new GLTFLoader().parseAsync(bytes, '');
}

/** Every deer's state and pose over its whole loop, every `step` seconds. */
function sweep(herd, rig, heightAt, step, visit) {
    const longest = Math.max(...herd.map((d) => d.loop));
    for (let t = 0; t < longest; t += step) {
        herd.forEach((deer, i) => {
            const pose = poseDeer(rig, deer, t, heightAt);
            visit(deer, i, t, pose.state, pose);
        });
    }
}

let model;
let rig;
const herd = buildHerd(ODYSSEY_DEER);

beforeAll(async () => {
    const gltf = await parseGlb();
    model = parseOdysseyDeer(gltf.scene);
    rig = createDeerRig(model.skeleton);
    planFootfalls(herd, rig);
});

describe('the deer model', () => {
    it('is one skinned, painted mesh on a 27-bone skeleton, within its triangle budget', () => {
        // Three neck bones and a jaw since the motion pass (2026-11-02).
        expect(model.skeleton).toHaveLength(27);
        expect(model.triangles).toBeGreaterThan(1500);
        expect(model.triangles).toBeLessThanOrEqual(2400);
        const { attributes } = model.geometry;
        ['position', 'normal', 'color', '_bones', '_weights'].forEach((name) => expect(attributes[name]).toBeTruthy());
        // Every vertex's weights sum to one and name real bones.
        const w = attributes._weights;
        const b = attributes._bones;
        for (let i = 0; i < w.count; i += 1) {
            expect(Math.abs((w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i)) - 1)).toBeLessThan(0.02);
            [b.getX(i), b.getY(i), b.getZ(i), b.getW(i)].forEach((v) => expect(Math.round(v * 255)).toBeLessThan(27));
        }
        // A hind at life size: about 1.15 m at the withers, the hooves on y = 0.
        const box = new THREE.Box3().setFromBufferAttribute(attributes.position);
        expect(box.min.y).toBeCloseTo(0, 2);
        expect(box.max.y).toBeGreaterThan(1.5);
        expect(box.max.y).toBeLessThan(1.8);
    });
});

describe('the herd drawn', () => {
    it('loads off the GPU, is ready only when told, and builds for both backends', async () => {
        const gltf = await parseGlb();
        const deer = createOdysseyDeer({ loadGltf: async () => ({ scene: gltf.scene }) });
        expect(deer.group.visible).toBe(false);
        expect(deer.isReady).toBe(false);
        expect(await deer.load()).toBe(true);
        const meshes = [];
        deer.group.traverse((o) => { if (o.isMesh) meshes.push(o); });
        expect(meshes.map((m) => m.name).sort()).toEqual(['odyssey-deer-herd', 'odyssey-deer-shadows']);
        meshes.forEach((mesh) => BACKENDS.forEach(([label, Builder]) => {
            const out = build(Builder, mesh);
            expectClean(out, `${mesh.name} ${label}`);
            // Skinned (or laid) from the pose table in the vertex stage.
            expect(out.vertex, `${mesh.name} ${label}`).toMatch(/textureLoad|texelFetch/);
        }));
        // Loaded but not ready: never drawn, whatever the progress says.
        deer.update(10, 0.17);
        expect(deer.group.visible).toBe(false);
        deer.markReady();
        deer.update(10, 0.17);
        expect(deer.group.visible).toBe(true);
        deer.update(10, 0.5);
        expect(deer.group.visible).toBe(false);
        deer.dispose();
    });
});

describe('the herd on the ground', () => {
    // The CPU height mirror without the bake (the forest scatter test's), and both tiers' forests
    // (High scatters at 15 u, Low at 24 u) round the glade.
    const heightAt = (x, z) => odysseyWorldMacro(x, z) + (odysseyWorldRelief(x, z) * odysseyWorldDetailWeight(x, z));
    const RAIL = Array.from({ length: 48 }, (_, i) => getOdysseyPathPointAt(i / 47));
    const trees = [15, 24].flatMap((spacing) => scatterZonedForest(heightAt, { rail: RAIL, spacing }).placements
        .filter((t) => Math.abs(t.x + 200) < 80 && Math.abs(t.z + 228) < 60));
    const stats = herd.map(() => ({
        clear: Infinity, slope: 0, dry: Infinity, stance: 0, dig: 0, stanceAll: [],
    }));
    let gap = Infinity;
    const states = [];

    beforeAll(() => {
        sweep(herd, rig, odysseyWorldHeight, 0.5, (deer, i, t, state, pose) => {
            const m = stats[i];
            const fx = Math.sin(state.heading);
            const fz = Math.cos(state.heading);
            // Its chest, middle and rump against every crown's inner 60 %: under the edge of a crown
            // is fine (a deer grazes there), never against a trunk or into a low crown.
            for (const f of [-0.6, 0, 0.6]) {
                const x = state.x + (fx * f * deer.k);
                const z = state.z + (fz * f * deer.k);
                for (const tree of trees) {
                    m.clear = Math.min(m.clear, Math.hypot(tree.x - x, tree.z - z) - (0.6 * 4.6 * tree.scaleXZ));
                }
            }
            const e = 1.5;
            m.slope = Math.max(m.slope, Math.hypot(
                (odysseyWorldHeight(state.x + e, state.z) - odysseyWorldHeight(state.x - e, state.z)) / (2 * e),
                (odysseyWorldHeight(state.x, state.z + e) - odysseyWorldHeight(state.x, state.z - e)) / (2 * e),
            ));
            m.dry = Math.min(m.dry, odysseyWorldHeight(state.x, state.z) - ODYSSEY_SEA_LEVEL);
            for (const h of pose.hooves) {
                if (h.stance > 0.95) {
                    const off = Math.hypot(h.x - h.planX, h.z - h.planZ, h.y - h.ground) / deer.k;
                    m.stance = Math.max(m.stance, off);
                    m.stanceAll.push(off);
                }
                m.dig = Math.max(m.dig, (h.ground - h.y) / deer.k);
            }
            states[i] = { ...state };
            if (i !== herd.length - 1) return;
            // Every pair as capsules along their bodies: the gap between their spines against their
            // summed half-widths.
            const spine = (s, k) => [Math.sin(s.heading) * 0.55 * k, Math.cos(s.heading) * 0.55 * k];
            for (let a = 0; a < herd.length; a += 1) {
                for (let b = a + 1; b < herd.length; b += 1) {
                    const [ax, az] = spine(states[a], herd[a].k);
                    const [bx, bz] = spine(states[b], herd[b].k);
                    let best = Infinity;
                    for (let u = -1; u <= 1.001; u += 0.2) {
                        for (let w = -1; w <= 1.001; w += 0.2) {
                            best = Math.min(best, Math.hypot(
                                (states[a].x + (ax * u)) - (states[b].x + (bx * w)),
                                (states[a].z + (az * u)) - (states[b].z + (bz * w)),
                            ));
                        }
                    }
                    gap = Math.min(gap, best / (0.22 * (herd[a].k + herd[b].k)));
                }
            }
        });
    });

    it('keeps every deer on dry, walkable grass, clear of the trunks and low crowns of both tiers', () => {
        stats.forEach((m, i) => {
            const label = `${herd[i].member.name} #${i}`;
            expect(m.dry, `${label} above the sea`).toBeGreaterThan(8);
            expect(m.slope, `${label} slope`).toBeLessThan(0.45);
            expect(m.clear, `${label} clear of the trees`).toBeGreaterThan(0.5);
        });
    });

    it('stands the hooves bearing weight where the plan put them, on the ground, and never digs one in', () => {
        stats.forEach((m, i) => {
            const label = `${herd[i].member.name} #${i}`;
            const sorted = [...m.stanceAll].sort((a, b) => a - b);
            const p99 = sorted[Math.floor(sorted.length * 0.99)];
            // In shares of the drawn size (3 for a hind): nearly always within a few centimetres; at
            // worst, at the very end of a long stance, a hind hoof lifts a little early.
            expect(p99, `${label} stance hooves (99th percentile)`).toBeLessThan(0.05);
            expect(m.stance, `${label} stance hooves (worst)`).toBeLessThan(0.22);
            expect(m.dig, `${label} digging`).toBeLessThan(0.05);
        });
    });

    it('keeps the deer apart (the calf near its mother, never inside her)', () => {
        expect(gap).toBeGreaterThan(1.1);
    });

    it('brings a grazing muzzle down to the grass, ahead of the chest', async () => {
        const gltf = await parseGlb();
        const { muzzle } = gltf.scene.userData.landmarks;
        const k = 3;
        // A hind standing on flat ground with her head down, her hooves where they stand.
        const deer = {
            member: { seed: 1 },
            k,
            loop: 100,
            walkSpeed: 1.8,
            strideW: 2.8,
            segments: [{
                kind: 'graze', t0: 0, dur: 100, x0: 0, z0: 0, h0: 0, x1: 0, z1: 0, h1: 0, head: 1, look: 0, alert: 0,
            }],
            plan: { steps: [[], [], [], []], start: rig.legs.map((leg) => rig.footOffset[leg.leg].map((v) => v * k)) },
        };
        poseDeer(rig, deer, 50, () => 300);
        const hb = rig.index.head;
        const { head } = rig.skeleton[hb];
        const r = rig.R[hb];
        const d = [muzzle[0] - head[0], muzzle[1] - head[1], muzzle[2] - head[2]].map((c) => c * k);
        const y = rig.J[hb][1] + (r[3] * d[0]) + (r[4] * d[1]) + (r[5] * d[2]);
        const z = rig.J[hb][2] + (r[6] * d[0]) + (r[7] * d[1]) + (r[8] * d[2]);
        expect((y - 300) / k).toBeGreaterThan(-0.02);
        expect((y - 300) / k).toBeLessThan(0.08);
        expect(z).toBeGreaterThan(rig.J[rig.index.chest][2]);
    });
});

describe('the herd seen from the rail', () => {
    const cam = createOdysseyCameraRig();
    const v = new THREE.Vector3();
    /** A deer's withers' on-screen height at 1440p, or 0 when it is out of the frame or behind ground. */
    function seenPx(camera, deer, state) {
        const ground = odysseyWorldHeight(state.x, state.z);
        const top = new THREE.Vector3(state.x, ground + (1.16 * deer.k), state.z);
        if (!cam.inFrame(camera, top, 0.95)) return 0;
        const eye = camera.position;
        const d = v.copy(top).sub(eye);
        const len = d.length();
        d.divideScalar(len);
        for (let s = 3; s < len - 3; s += Math.max(2, s * 0.03)) {
            if (odysseyWorldHeight(eye.x + (d.x * s), eye.z + (d.z * s)) > eye.y + (d.y * s)) return 0;
        }
        const a = top.clone().project(camera).y;
        const b = new THREE.Vector3(state.x, ground, state.z).project(camera).y;
        return Math.abs(a - b) * 720;
    }

    it('is in view at the chapter-3 orb parks, large enough to read', () => {
        // [level, deer in the frame (at least), the largest deer's withers in pixels at 1440p]. Measured
        // 2026-11-01: 24, 25, 27, 40 and 51 px (the trees hide some of them from some parks; the
        // ground never does).
        const expected = [[11, 5, 20], [12, 5, 20], [13, 5, 21], [14, 5, 23], [15, 5, 34], [17, 4, 44]];
        expected.forEach(([level, count, px]) => {
            const camera = cam.poseAt(cam.parkOf(level));
            let inView = 0;
            let largest = 0;
            [0, 60, 140, 230].forEach((t) => {
                let n = 0;
                herd.forEach((deer) => {
                    const p = seenPx(camera, deer, deerStateAt(deer, t, {}));
                    if (p > 0) n += 1;
                    largest = Math.max(largest, p);
                });
                inView = Math.max(inView, n);
            });
            expect(inView, `L${level} deer in the frame`).toBeGreaterThanOrEqual(count);
            expect(largest, `L${level} largest deer (px)`).toBeGreaterThan(px);
        });
    });

    it('never appears or leaves in view: deep under the sea at the start, out of the frame at the end', () => {
        const [start, end] = ODYSSEY_DEER.window;
        expect(deerRevealAt(start - 0.001)).toBe(0);
        expect(deerRevealAt(start + 0.001)).toBe(1);
        expect(deerRevealAt(end - 0.001)).toBe(1);
        expect(deerRevealAt(end + 0.001)).toBe(0);
        for (let p = start - 0.003; p <= start + 0.003; p += 0.0005) {
            expect(cam.poseAt(p).position.y, `eye at ${p.toFixed(4)}`).toBeLessThan(ODYSSEY_SEA_LEVEL - 20);
        }
        // The end, from a little before it (the camera lags its settled pose in a glide): every deer
        // out of a padded frame at every clock phase.
        for (let p = end - 0.012; p <= end + 0.003; p += 0.0005) {
            const camera = cam.poseAt(p);
            [0, 75, 150, 225].forEach((t) => herd.forEach((deer) => {
                const s = deerStateAt(deer, t, {});
                const pt = new THREE.Vector3(s.x, odysseyWorldHeight(s.x, s.z) + deer.k, s.z);
                expect(cam.inFrame(camera, pt, 1.1), `${deer.member.name} at p ${p.toFixed(4)}`).toBe(false);
            }));
        }
    });
});

describe('the herd in motion (the motion pass, 2026-11-02)', () => {
    const fps = 30;
    /** Angle between two unit quaternions at offsets a and b of two tables. */
    const qAngle = (A, a, B, b) => {
        const d = Math.abs((A[a] * B[b]) + (A[a + 1] * B[b + 1]) + (A[a + 2] * B[b + 2]) + (A[a + 3] * B[b + 3]));
        return 2 * Math.acos(Math.min(1, d));
    };
    const LEG_BONE = /humerus|forearm|foreCannon|foreHoof|femur|tibia|hindCannon|hindHoof/;
    const measured = [];

    beforeAll(() => {
        herd.forEach((deer) => {
            const B = rig.skeleton.length;
            const kindOf = rig.skeleton.map((b) => {
                if (LEG_BONE.test(b.name)) return 'leg';
                return /tail|ear|jaw/.test(b.name) ? 'flick' : 'body';
            });
            const m = {
                bodyW: 0,
                legW: 0,
                flickW: 0,
                bodyAcc: 0,
                legAcc: 0,
                flickAcc: 0,
                slide: 0,
                slides: [],
                turn: {},
                spunFor: 0,
                accel: 0,
                order: [0, 0],
            };
            let prev = null;
            let prevW = null;
            const anchor = [null, null, null, null];
            let lastV = null;
            let lastP = null;
            let spinning = 0;
            for (let f = 0; f <= deer.loop * fps; f += 1) {
                const t = f / fps;
                const table = new Float32Array(B * 8);
                const pose = poseDeer(rig, deer, t, odysseyWorldHeight, table, 0);
                const s = pose.state;
                // A hoof bearing weight stays where it was put down.
                pose.hooves.forEach((h, l) => {
                    if (h.stance) {
                        if (!anchor[l]) anchor[l] = [h.x, h.z];
                        const d = Math.hypot(h.x - anchor[l][0], h.z - anchor[l][1]) / deer.k;
                        m.slide = Math.max(m.slide, d);
                        m.slides.push(d);
                    } else anchor[l] = null;
                });
                if (prev) {
                    const w = new Float64Array(B);
                    for (let b = 0; b < B; b += 1) {
                        w[b] = qAngle(table, b * 8, prev, b * 8) * fps;
                        const key = kindOf[b];
                        m[`${key}W`] = Math.max(m[`${key}W`], w[b]);
                        if (prevW) m[`${key}Acc`] = Math.max(m[`${key}Acc`], Math.abs(w[b] - prevW[b]) * fps);
                    }
                    prevW = w;
                    // Speed, acceleration and turning of the body.
                    const v = Math.hypot(s.x - lastP[0], s.z - lastP[1]) * fps;
                    if (lastV != null) m.accel = Math.max(m.accel, Math.abs(v - lastV) * fps);
                    lastV = v;
                    const dh = s.heading - lastP[2];
                    const turn = Math.abs(Math.atan2(Math.sin(dh), Math.cos(dh))) * fps;
                    const tl = t % deer.loop;
                    const seg = deer.segments.find((g, n) => g.t0 <= tl && (deer.segments[n + 1]?.t0 ?? Infinity) > tl);
                    m.turn[seg.kind] = Math.max(m.turn[seg.kind] || 0, turn);
                    // Turning with every hoof down is the turntable: allowed only for a moment.
                    spinning = turn > 0.12 && pose.hooves.every((h) => h.stance) ? spinning + (1 / fps) : 0;
                    m.spunFor = Math.max(m.spunFor, spinning);
                }
                prev = table;
                lastP = [s.x, s.z, s.heading];
            }
            // The walk's order: in a walk, each lift is followed by the next hoof in the order
            // (left hind, left fore, right hind, right fore).
            const inWalk = (t0) => deer.segments.some((g) => g.kind === 'walk'
                && t0 > g.t0 + 1 && t0 < g.t0 + g.dur - 1);
            const lifts = deer.plan.steps
                .flatMap((list, l) => list.filter((st) => !st[6] && st[0] >= 0 && st[0] < deer.loop)
                    .map((st) => [st[0], l]))
                .filter(([t0]) => inWalk(t0))
                .sort((a, b) => a[0] - b[0]);
            for (let i = 1; i < lifts.length; i += 1) {
                if (lifts[i][0] - lifts[i - 1][0] > 1) continue;
                m.order[1] += 1;
                if (lifts[i][1] === (lifts[i - 1][1] + 1) % 4) m.order[0] += 1;
            }
            measured.push(m);
        });
    });

    it('never slides a hoof that bears weight', () => {
        measured.forEach((m, i) => {
            const sorted = [...m.slides].sort((a, b) => a - b);
            expect(sorted[Math.floor(sorted.length * 0.99)], `#${i} slide (99th percentile)`).toBeLessThan(0.05);
            expect(m.slide, `#${i} slide (worst)`).toBeLessThan(0.2);
        });
    });

    it('moves every joint smoothly, through every change of state (no pops)', () => {
        measured.forEach((m, i) => {
            // Spine, neck and head: unhurried. Legs: a deer's swing, no faster. Tail, ears and jaw:
            // quick flicks, but never a jump.
            Object.entries(MOTION_LIMITS).forEach(([key, limit]) => {
                if (key !== 'accel') expect(m[key], `#${i} ${key}`).toBeLessThan(limit);
            });
        });
    });

    it('starts and stops smoothly, turns along curves or by stepping round, never spins', () => {
        measured.forEach((m, i) => {
            expect(m.accel, `#${i} body acceleration m/s^2`).toBeLessThan(MOTION_LIMITS.accel);
            expect(m.turn.walk ?? 0, `#${i} turning in a walk`).toBeLessThan(0.45);
            expect(m.turn.turn ?? 0, `#${i} turning on the spot`).toBeLessThan(ODYSSEY_DEER.turnRate * 1.05);
            expect(m.turn.step ?? 0, `#${i} turning in a grazing step`).toBeLessThan(1.2);
            expect(m.turn.graze ?? 0, `#${i} turning while grazing`).toBeLessThan(0.01);
            expect(m.spunFor, `#${i} turning with every hoof down (s)`).toBeLessThan(1.0);
        });
    });

    it('walks a four-beat walk: left hind, left fore, right hind, right fore', () => {
        const inOrder = measured.reduce((sum, m) => sum + m.order[0], 0);
        const all = measured.reduce((sum, m) => sum + m.order[1], 0);
        expect(all, 'lifts in the walks of the herd').toBeGreaterThan(40);
        expect(inOrder / all, 'lifts in order').toBeGreaterThan(0.85);
    });

    it('joins its loop without a jump (the seam)', () => {
        herd.forEach((deer, i) => {
            const B = rig.skeleton.length;
            const a = new Float32Array(B * 8);
            const b = new Float32Array(B * 8);
            poseDeer(rig, deer, deer.loop - 0.0001, odysseyWorldHeight, a, 0);
            poseDeer(rig, deer, deer.loop + 0.0001, odysseyWorldHeight, b, 0);
            for (let j = 0; j < B; j += 1) {
                const o = j * 8;
                const moved = Math.hypot(a[o + 4] - b[o + 4], a[o + 5] - b[o + 5], a[o + 6] - b[o + 6]);
                expect(moved, `#${i} bone ${j}`).toBeLessThan(0.02);
                expect(qAngle(a, o, b, o), `#${i} bone ${j} turn`).toBeLessThan(0.02);
            }
        });
    });

    it('keeps its walking path on curves that leave the way it faces', () => {
        herd.forEach((deer) => {
            deer.segments.filter((g) => g.kind === 'walk').forEach((g) => {
                const start = deerPathAt(deer, g.t0 + 0.02, {});
                const before = deerPathAt(deer, g.t0 - 0.02, {});
                const dh = start.heading - before.heading;
                expect(Math.abs(Math.atan2(Math.sin(dh), Math.cos(dh)))).toBeLessThan(0.02);
            });
        });
    });
});
