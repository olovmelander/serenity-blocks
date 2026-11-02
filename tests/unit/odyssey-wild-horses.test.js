/**
 * Odyssey's wild horses (2026-11-02): a band of five adults and two foals on the open meadow east of
 * the rail (chapters 3-4). The deer's tests (odyssey-ground-animals.test.js), for the horses.
 *
 * No GPU needed:
 *  - THE MODEL: the Blender-built GLB parses into a mare and a foal, each skinned and painted on its
 *    29-bone skeleton, within their triangle budgets.
 *  - SHADERS: the band's, the foals' and the shadows' materials build through three's own WGSL and
 *    GLSL node builders, with no more than WebGPU's eight vertex buffers a draw.
 *  - THE SCHEDULE AND THE GAITS: every loop is exactly as long (the band's runs stay together), and
 *    the gait table blends from a four-beat walk through the trot's diagonal pairs to the gallop.
 *  - THE GROUND: every horse stays on dry, walkable grass, clear of the trunks and crowns of both
 *    forest tiers, the boulders, the tarn and the rail's track, at every moment of its loop (runs
 *    included); hooves that bear weight stay planted; the horses keep apart; foals stay near.
 *  - THE CAMERA: the REAL rail camera sees the band at the chapter-3 parks, and never sees it appear
 *    or leave: under the sea at the start of its window, out of the frame at the end.
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
    HORSE_DUST, ODYSSEY_HORSES, bandDustAt, bandRunTimes, buildBand, createHorseRig, gaitAt, horseFootAt,
    horseRevealAt, horseRhythmAt, horseSegmentAt, horseStateAt, planFootfalls, poseHorse,
} from '../../src/rendering/odyssey/composition/odyssey-horse-band.js';
import {
    ODYSSEY_MEADOW_CLEARING, odysseyMeadowClearingRn,
} from '../../src/rendering/odyssey/world/odyssey-meadow-clearing.js';
import { createOdysseyHorses, parseOdysseyHorse } from '../../src/rendering/odyssey/composition/odyssey-horses.js';
import {
    ODYSSEY_SEA_LEVEL, odysseyTarnRn, odysseyWorldDetailWeight, odysseyWorldHeight, odysseyWorldMacro,
    odysseyWorldRelief,
} from '../../src/rendering/odyssey/world/odyssey-world-height.js';
import { scatterZonedForest } from '../../src/rendering/odyssey/world/odyssey-forest-scatter.js';
import { buildBoulderSites } from '../../src/rendering/odyssey/world/odyssey-boulders.js';
import { getOdysseyPathPointAt } from '../../src/rendering/odyssey/path-utils.js';

const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
const GLB = new URL('../../src/rendering/odyssey/assets/chapter-03/horses/wild-horses.glb', import.meta.url);

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
    const bytes = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    return new GLTFLoader().parseAsync(bytes, '');
}

const band = buildBand(ODYSSEY_HORSES);
const isFoal = (h) => h.member.model === 'foal';
let models;
let rigs;

beforeAll(async () => {
    const gltf = await parseGlb();
    models = { horse: parseOdysseyHorse(gltf.scene, 'horse'), foal: parseOdysseyHorse(gltf.scene, 'foal') };
    rigs = { horse: createHorseRig(models.horse.skeleton), foal: createHorseRig(models.foal.skeleton) };
    planFootfalls(band, rigs);
});

describe('the wild horse models', () => {
    it('are a mare and a foal, each skinned and painted on a 29-bone skeleton, within budget', () => {
        [['horse', 2400, 3300, 1.7, 1.9], ['foal', 1600, 2400, 1.35, 1.6]].forEach(([name, lo, hi, minH, maxH]) => {
            const model = models[name];
            expect(model.skeleton, name).toHaveLength(29);
            expect(model.triangles, name).toBeGreaterThan(lo);
            expect(model.triangles, name).toBeLessThanOrEqual(hi);
            const { attributes } = model.geometry;
            const w = attributes._weights;
            const b = attributes._bones;
            for (let i = 0; i < w.count; i += 1) {
                expect(Math.abs((w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i)) - 1)).toBeLessThan(0.02);
                [b.getX(i), b.getY(i), b.getZ(i), b.getW(i)].forEach((v) => expect(Math.round(v * 255)).toBeLessThan(29));
            }
            const box = new THREE.Box3().setFromBufferAttribute(attributes.position);
            expect(box.min.y, name).toBeCloseTo(0, 2);
            expect(box.max.y, name).toBeGreaterThan(minH);
            expect(box.max.y, name).toBeLessThan(maxH);
        });
    });
});

describe('the band drawn', () => {
    it('loads off the GPU, is ready only when told, and builds for both backends in eight buffers', async () => {
        const gltf = await parseGlb();
        const horses = createOdysseyHorses({ loadGltf: async () => ({ scene: gltf.scene }) });
        expect(horses.group.visible).toBe(false);
        expect(await horses.load()).toBe(true);
        const meshes = [];
        horses.group.traverse((o) => { if (o.isMesh) meshes.push(o); });
        expect(meshes.map((m) => m.name).sort())
            .toEqual(['odyssey-horse-band', 'odyssey-horse-dust', 'odyssey-horse-foals', 'odyssey-horse-shadows']);
        meshes.forEach((mesh) => {
            // WebGPU's limit: eight vertex buffers a draw (geometry and instanced attributes together).
            expect(Object.keys(mesh.geometry.attributes).length, mesh.name).toBeLessThanOrEqual(8);
            BACKENDS.forEach(([label, Builder]) => {
                const out = build(Builder, mesh);
                expect(out.thrown, `${mesh.name} ${label}: ${out.thrown?.stack ?? ''}`).toBeUndefined();
                expect(out.heard, `${mesh.name} ${label}`).toEqual([]);
                if (mesh.name !== 'odyssey-horse-dust') {
                    expect(out.vertex, `${mesh.name} ${label}`).toMatch(/textureLoad|texelFetch/);
                }
                expect(out.fragment, `${mesh.name} ${label}`).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
            });
        });
        expect(horses.triangles).toBe((5 * models.horse.triangles) + (2 * models.foal.triangles));
        horses.update(60, 0.2);
        expect(horses.group.visible).toBe(false);
        horses.markReady();
        horses.update(60, 0.2);
        expect(horses.group.visible).toBe(true);
        horses.update(60, 0.5);
        expect(horses.group.visible).toBe(false);
        horses.dispose();
    });
});

describe('the band\'s clock and gaits', () => {
    it('runs every loop exactly as long, so the band\'s runs stay together for ever', () => {
        band.forEach((h) => expect(h.loop, h.member.name).toBeCloseTo(ODYSSEY_HORSES.loop, 6));
        const runs = bandRunTimes(band);
        expect(runs).toHaveLength(2);
        // Minutes apart, each a moment of 10-30 s.
        expect(runs[1].from - runs[0].from).toBeGreaterThan(100);
        runs.forEach((r) => {
            expect(r.to - r.from).toBeGreaterThan(10);
            expect(r.to - r.from).toBeLessThan(32);
        });
    });

    it('blends the gaits by speed: a four-beat walk, the trot\'s diagonal pairs, a three-beat canter, a gallop', () => {
        const at = (v) => gaitAt(v, { rate: 0, duty: 0, lift: [0, 0, 0, 0] });
        // Standing still: no stride at all.
        expect(at(0).rate).toBe(0);
        const walk = at(1.2);
        expect(walk.lift).toEqual([0, 0.25, 0.5, 0.75]);
        expect(walk.duty).toBeGreaterThan(0.6);
        const trot = at(3.0);
        // Left hind with right fore, right hind with left fore (lift 1 is lift 0 a stride later).
        expect(trot.lift[3] % 1).toBeCloseTo(trot.lift[0], 6);
        expect(trot.lift[1]).toBeCloseTo(trot.lift[2], 6);
        expect(at(7.0).duty).toBeLessThan(0.3);
        // The stride rate and the stance share move smoothly and the right way with the speed.
        let last = at(0.05);
        for (let v = 0.1; v <= 9; v += 0.05) {
            const g = at(v);
            expect(g.rate).toBeGreaterThanOrEqual(last.rate - 1e-9);
            expect(g.duty).toBeLessThanOrEqual(last.duty + 1e-9);
            for (let i = 0; i < 4; i += 1) expect(Math.abs(g.lift[i] - last.lift[i])).toBeLessThan(0.05);
            last = { rate: g.rate, duty: g.duty, lift: [...g.lift] };
        }
    });
});

describe('the band on the ground', () => {
    const heightAt = (x, z) => odysseyWorldMacro(x, z) + (odysseyWorldRelief(x, z) * odysseyWorldDetailWeight(x, z));
    const RAIL = Array.from({ length: 48 }, (_, i) => getOdysseyPathPointAt(i / 47));
    const tiers = [15, 24].map((spacing) => scatterZonedForest(heightAt, { rail: RAIL, spacing }).placements);
    const trees = tiers.flat().filter((t) => t.x > -260 && t.x < 140 && t.z > -560 && t.z < -200);
    const rocks = tiers.flatMap((t) => buildBoulderSites(odysseyWorldHeight, { trees: t }));
    const track = Array.from({ length: 1500 }, (_, i) => getOdysseyPathPointAt(0.12 + ((0.6 * i) / 1499)));
    const stats = band.map(() => ({
        clear: Infinity,
        rock: Infinity,
        rail: Infinity,
        tarn: Infinity,
        slope: 0,
        dry: Infinity,
        stance: [],
        dig: 0,
        mother: 0,
        top: 0,
    }));
    let gap = Infinity;

    beforeAll(() => {
        const states = [];
        const loaded = rigs;
        for (let t = 0; t < ODYSSEY_HORSES.loop; t += 1 / 15) {
            band.forEach((h, i) => {
                const pose = poseHorse(loaded[h.member.model], h, t, odysseyWorldHeight);
                const { state } = pose;
                const m = stats[i];
                const fx = Math.sin(state.heading);
                const fz = Math.cos(state.heading);
                // Its chest, middle and rump against every crown's inner 60 % (a trunk, a low crown).
                const half = 1.12 * h.k * (isFoal(h) ? 0.6 : 1);
                for (const f of [-1, 0, 1]) {
                    const x = state.x + (fx * f * half);
                    const z = state.z + (fz * f * half);
                    for (const tree of trees) {
                        m.clear = Math.min(m.clear, Math.hypot(tree.x - x, tree.z - z) - (0.6 * 4.6 * tree.scaleXZ));
                    }
                    for (const r of rocks) m.rock = Math.min(m.rock, Math.hypot(r.x - x, r.z - z) - Math.max(r.sx, r.sz));
                }
                if (Math.round(t * 15) % 15 === 0) {
                    for (const p of track) m.rail = Math.min(m.rail, Math.hypot(p.x - state.x, p.z - state.z));
                }
                m.tarn = Math.min(m.tarn, odysseyTarnRn(state.x, state.z));
                m.dry = Math.min(m.dry, odysseyWorldHeight(state.x, state.z) - ODYSSEY_SEA_LEVEL);
                const e = 1.5;
                m.slope = Math.max(m.slope, Math.hypot(
                    (odysseyWorldHeight(state.x + e, state.z) - odysseyWorldHeight(state.x - e, state.z)) / (2 * e),
                    (odysseyWorldHeight(state.x, state.z + e) - odysseyWorldHeight(state.x, state.z - e)) / (2 * e),
                ));
                for (const hv of pose.hooves) {
                    if (hv.stance > 0.95) m.stance.push(Math.hypot(hv.x - hv.planX, hv.z - hv.planZ, hv.y - hv.ground) / h.k);
                    m.dig = Math.max(m.dig, (hv.ground - hv.y) / h.k);
                }
                m.top = Math.max(m.top, state.speed);
                states[i] = { ...state };
            });
            const spine = (s, h) => {
                const l = 1.1 * h.k * (isFoal(h) ? 0.6 : 1);
                return [Math.sin(s.heading) * l, Math.cos(s.heading) * l];
            };
            for (let a = 0; a < band.length; a += 1) {
                for (let b = a + 1; b < band.length; b += 1) {
                    const [ax, az] = spine(states[a], band[a]);
                    const [bx, bz] = spine(states[b], band[b]);
                    let best = Infinity;
                    for (let u = -1; u <= 1.001; u += 0.25) {
                        for (let w = -1; w <= 1.001; w += 0.25) {
                            best = Math.min(best, Math.hypot(
                                (states[a].x + (ax * u)) - (states[b].x + (bx * w)),
                                (states[a].z + (az * u)) - (states[b].z + (bz * w)),
                            ));
                        }
                    }
                    gap = Math.min(gap, best / (0.3 * (band[a].k + band[b].k)));
                }
            }
            band.forEach((h, i) => {
                if (h.member.mother == null) return;
                const mum = states[h.member.mother];
                stats[i].mother = Math.max(stats[i].mother, Math.hypot(states[i].x - mum.x, states[i].z - mum.z));
            });
        }
    }, 120000);

    it('keeps every horse on dry, walkable grass, clear of trees, boulders, the tarn and the rail', () => {
        // Measured 2026-11-02: crowns >= 0.4 u, boulders >= 1.9 u, tarn distance >= 1.64, rail >= 36 u,
        // slope <= 0.31.
        stats.forEach((m, i) => {
            const label = `${band[i].member.name} #${i}`;
            expect(m.dry, `${label} above the sea`).toBeGreaterThan(8);
            expect(m.slope, `${label} slope`).toBeLessThan(0.36);
            expect(m.clear, `${label} clear of the trees`).toBeGreaterThan(0);
            expect(m.rock, `${label} clear of the boulders`).toBeGreaterThan(1);
            expect(m.tarn, `${label} away from the tarn`).toBeGreaterThan(1.5);
            expect(m.rail, `${label} away from the rail's track`).toBeGreaterThan(30);
        });
    });

    it('gallops: every horse reaches the band\'s speed in the runs, the foals too', () => {
        stats.forEach((m, i) => expect(m.top, band[i].member.name).toBeGreaterThan(0.95 * ODYSSEY_HORSES.runSpeed * 3));
    });

    it('keeps the hooves that bear weight where the plan put them, on the ground, never dug in', () => {
        // Shares of the drawn size: 99 % of stance frames within ~0.07 (a few centimetres of a life-size
        // horse), the worst ~0.13 (a hoof at the far end of a gallop stance, out of the leg's reach).
        stats.forEach((m, i) => {
            const label = `${band[i].member.name} #${i}`;
            const sorted = [...m.stance].sort((a, b) => a - b);
            expect(sorted[Math.floor(sorted.length * 0.99)], `${label} stance (99th percentile)`).toBeLessThan(0.08);
            expect(sorted[sorted.length - 1], `${label} stance (worst)`).toBeLessThan(0.25);
            expect(m.dig, `${label} digging`).toBeLessThan(0.07);
        });
    });

    it('keeps the horses apart, and each foal near its mother', () => {
        expect(gap).toBeGreaterThan(0.9);
        band.forEach((h, i) => {
            if (h.member.mother != null) expect(stats[i].mother, `foal #${i}`).toBeLessThan(40);
        });
    });
});

describe('the band seen from the rail', () => {
    const cam = createOdysseyCameraRig();
    const v = new THREE.Vector3();
    function seenPx(camera, h, s) {
        const ground = odysseyWorldHeight(s.x, s.z);
        const top = new THREE.Vector3(s.x, ground + ((isFoal(h) ? 1.04 : 1.376) * h.k), s.z);
        if (!cam.inFrame(camera, top, 0.95)) return 0;
        const eye = camera.position;
        const d = v.copy(top).sub(eye);
        const len = d.length();
        d.divideScalar(len);
        for (let s2 = 3; s2 < len - 3; s2 += Math.max(2, s2 * 0.03)) {
            if (odysseyWorldHeight(eye.x + (d.x * s2), eye.z + (d.z * s2)) > eye.y + (d.y * s2)) return 0;
        }
        const a = top.clone().project(camera).y;
        const b = new THREE.Vector3(s.x, ground, s.z).project(camera).y;
        return Math.abs(a - b) * 720;
    }

    it('is in the frame at the chapter-3 parks, large enough to read (the ground; the crowns hide some)', () => {
        // [level, horses in the frame (at least), the largest withers in px at 1440p]. Measured
        // 2026-11-02: 25, 35, 32, 49 and 46 px.
        [[11, 7, 22], [15, 7, 30], [16, 7, 28], [17, 5, 42], [18, 4, 40]].forEach(([level, count, px]) => {
            const camera = cam.poseAt(cam.parkOf(level));
            let inView = 0;
            let largest = 0;
            for (let t = 0; t < ODYSSEY_HORSES.loop; t += 10) {
                let n = 0;
                for (const h of band) {
                    const p = seenPx(camera, h, horseStateAt(h, t, {}));
                    if (p > 0) n += 1;
                    largest = Math.max(largest, p);
                }
                inView = Math.max(inView, n);
            }
            expect(inView, `L${level} horses in the frame`).toBeGreaterThanOrEqual(count);
            expect(largest, `L${level} largest (px)`).toBeGreaterThan(px);
        });
    });

    it('never appears or leaves in view: under the sea at the start, out of the frame at the end', () => {
        const [start, end] = ODYSSEY_HORSES.window;
        expect(horseRevealAt(start - 0.001)).toBe(0);
        expect(horseRevealAt(start + 0.001)).toBe(1);
        expect(horseRevealAt(end - 0.001)).toBe(1);
        expect(horseRevealAt(end + 0.001)).toBe(0);
        for (let p = start - 0.003; p <= start + 0.003; p += 0.0005) {
            expect(cam.poseAt(p).position.y, `eye at ${p.toFixed(4)}`).toBeLessThan(ODYSSEY_SEA_LEVEL - 20);
        }
        // Around the window's end, every horse at every moment of the loop is out of the (padded) frame.
        for (let p = end - 0.006; p <= end + 0.006; p += 0.002) {
            const camera = cam.poseAt(p);
            for (let t = 0; t < ODYSSEY_HORSES.loop; t += 2) {
                band.forEach((h) => {
                    const s = horseStateAt(h, t, {});
                    const pt = new THREE.Vector3(s.x, odysseyWorldHeight(s.x, s.z) + 4, s.z);
                    expect(cam.inFrame(camera, pt, 1.15), `${h.member.name} at p ${p.toFixed(3)} t ${t}`).toBe(false);
                });
            }
        }
    });
});

describe('the gaits on the ground (footfalls from the plan)', () => {
    const LH = 0;
    const LF = 1;
    const RH = 2;
    const RF = 3;
    const rhythm = { phase: 0, speed: 0 };
    const plantedAt = (h, t) => {
        let planted = 0;
        for (let l = 0; l < 4; l += 1) if (horseFootAt(h, l, t).planted) planted += 1;
        return planted;
    };

    it('walks on at least two hooves (a walk never leaves the ground)', () => {
        // Measured 2026-11-02: 1.4-2.1 % of walking time on one hoof, in the first and last steps of
        // a pivot; never airborne.
        band.forEach((h) => {
            let n = 0;
            let low = 0;
            let air = 0;
            for (let t = 0; t < ODYSSEY_HORSES.loop; t += 0.02) {
                const v = horseRhythmAt(h, t, rhythm).speed;
                if (v > 0.2 && v < 1.8) {
                    n += 1;
                    const planted = plantedAt(h, t);
                    if (planted < 2) low += 1;
                    if (planted === 0) air += 1;
                }
            }
            expect(low / n, `${h.member.name} on fewer than two hooves`).toBeLessThan(0.03);
            // (Only the quick wheel before a run, which hops round, leaves the ground for an instant.)
            expect(air / n, `${h.member.name} airborne at a walk`).toBeLessThan(0.01);
        });
    });

    it('gallops a transverse gallop on the left lead (RH, LH, RF, LF), with a moment of flight', () => {
        band.forEach((h) => {
            const landings = [];
            h.plan.steps.forEach((list, l) => list.forEach((s) => {
                if (s[6] === 0 && horseRhythmAt(h, s[1], rhythm).speed >= 6.6) landings.push([s[1], l]);
            }));
            landings.sort((a, b) => a[0] - b[0]);
            let strides = 0;
            let right = 0;
            for (let k = 0; k + 3 < landings.length; k += 1) {
                if (landings[k][1] === RH) {
                    strides += 1;
                    if (landings[k + 1][1] === LH && landings[k + 2][1] === RF && landings[k + 3][1] === LF) right += 1;
                }
            }
            expect(strides, h.member.name).toBeGreaterThan(20);
            expect(right / strides, `${h.member.name} strides in the gallop's order`).toBeGreaterThan(0.9);
            // Flight: at a gallop all four hooves are in the air for part of each stride.
            let n = 0;
            let air = 0;
            for (let t = 0; t < ODYSSEY_HORSES.loop; t += 0.005) {
                if (horseRhythmAt(h, t, rhythm).speed >= 6.6) {
                    n += 1;
                    if (plantedAt(h, t) === 0) air += 1;
                }
            }
            expect(air / n, `${h.member.name} time in the air at a gallop`).toBeGreaterThan(0.1);
        });
    });

    it('stands on a straight fore knee (the shoulder and elbow take the give)', () => {
        const rig = rigs.horse;
        const horse = band[0];
        let checked = 0;
        for (let t = 0; t < ODYSSEY_HORSES.loop; t += 1.3) {
            const { state } = poseHorse(rig, horse, t, () => 0);
            const { segment, u } = horseSegmentAt(horse, t);
            // (Standing a moment: a hoof the last step left out has stepped in.)
            if (state.speed <= 0.05 && Math.abs(state.turning) < 0.02 && u * segment.dur > 1) {
                for (let l = 0; l < rig.legs.length; l += 1) {
                    const leg = rig.legs[l];
                    if (leg.front && rig.feet[l].planted) {
                        // The cannon's bend against the forearm: straight (a few hundredths of a radian).
                        expect(Math.abs(rig.local[leg.chain[1]][0]), `t ${t.toFixed(1)}`).toBeLessThan(0.08);
                        checked += 1;
                    }
                }
            }
        }
        expect(checked).toBeGreaterThan(100);
    });
});

describe('the meadow kept open for the band', () => {
    const heightAt = (x, z) => odysseyWorldMacro(x, z) + (odysseyWorldRelief(x, z) * odysseyWorldDetailWeight(x, z));
    const RAIL = Array.from({ length: 48 }, (_, i) => getOdysseyPathPointAt(i / 47));

    it('opens the band\'s places and runs, with a ragged edge, and leaves the boulders as they were', () => {
        // Every horse at every moment of its loop is inside the clearing (the long run brushes its
        // ragged rim on the west side, where the treeline thins).
        band.forEach((h) => {
            for (let t = 0; t < ODYSSEY_HORSES.loop; t += 1) {
                const s = horseStateAt(h, t, {});
                expect(odysseyMeadowClearingRn(s.x, s.z), `${h.member.name} at ${t}`).toBeLessThan(1.15);
            }
        });
        // The edge moves in and out (no cut ellipse): along the first lobe's rim the noise shifts the
        // normalized distance by more than 0.06 either way.
        const plain = (x, z) => Math.min(...ODYSSEY_MEADOW_CLEARING.lobes.map((q) => Math.hypot((x - q.x) / q.rx, (z - q.z) / q.rz)));
        const offs = [];
        ODYSSEY_MEADOW_CLEARING.lobes.forEach((lb) => {
            for (let a = 0; a < Math.PI * 2; a += 0.05) {
                const x = lb.x + (Math.cos(a) * lb.rx);
                const z = lb.z + (Math.sin(a) * lb.rz);
                offs.push(odysseyMeadowClearingRn(x, z) - plain(x, z));
            }
        });
        expect(Math.max(...offs)).toBeGreaterThan(0.06);
        expect(Math.min(...offs)).toBeLessThan(-0.06);
        [15, 24].forEach((spacing) => {
            const open = scatterZonedForest(heightAt, { rail: RAIL, spacing });
            const shut = scatterZonedForest(heightAt, { rail: RAIL, spacing, meadowClearing: false });
            const core = open.placements.filter((p) => odysseyMeadowClearingRn(p.x, p.z) < ODYSSEY_MEADOW_CLEARING.core);
            // Only a few lone trees in its core; the clearing removed its trees and reports them.
            expect(core.length, `tier ${spacing} lone trees`).toBeLessThanOrEqual(4);
            expect(open.meadowCleared.length, `tier ${spacing} cleared`).toBeGreaterThan(10);
            expect(open.placements.length + open.meadowCleared.length).toBe(shut.placements.length);
            // The boulders see the cleared sites as trees, so not one rock moves or appears.
            const rocksOf = (z) => buildBoulderSites(odysseyWorldHeight, { trees: [...z.placements, ...z.meadowCleared] })
                .map((r) => `${r.x.toFixed(2)},${r.z.toFixed(2)},${r.sx.toFixed(2)}`).join('|');
            expect(rocksOf(open)).toBe(rocksOf(shut));
        });
    }, 120000);
});

describe('the dust of a run', () => {
    it('rises only where a hoof struck at a canter or gallop, and fades within its life', () => {
        const out = new Float32Array(400 * 4);
        const runs = bandRunTimes(band);
        // Grazing: no dust.
        expect(bandDustAt(band, runs[0].from - 20, out, 400)).toBe(0);
        // In the gallop: puffs, each on the ground where a hoof landed, younger than its life.
        const mid = (runs[0].from + runs[0].to) / 2;
        const n = bandDustAt(band, mid, out, 400);
        expect(n).toBeGreaterThan(30);
        expect(n).toBeLessThanOrEqual(band.length * HORSE_DUST.perHorse);
        for (let i = 0; i < n; i += 1) {
            expect(out[(i * 4) + 2]).toBeGreaterThanOrEqual(0);
            expect(out[(i * 4) + 2]).toBeLessThanOrEqual(HORSE_DUST.life);
            expect(odysseyMeadowClearingRn(out[i * 4], out[(i * 4) + 1])).toBeLessThan(1.15);
        }
    });
});
