/**
 * THE BLENDER BIRDS (2026-11, docs/ODYSSEY_BLENDER_BIRDS_2026-11.md): the herring gull, barn
 * swallow and greylag goose the Blender script (scripts/blender/odyssey/odyssey_birds.py) writes
 * into odyssey-bird-models.js, folded by odyssey-bird-rig.js, and the flights that draw them
 * (odyssey-flights.js).
 *
 *  - THE MODELS: sizes and triangle budgets for the pixels they cover, shells facing out and
 *    sheets facing up, hinge weights where the joints are, the plumage each species is named by.
 *  - THE WINGBEAT: the CPU twin of the vertex stage (birdWingPose + foldBirdPoint) over every
 *    pose a bird flies: no edge torn or crushed, no wing turned inside out, the outer wing lagging
 *    the inner, each kind's rhythm (gull glides, swallow bursts, goose steady).
 *  - THE DRAW: one material shared by the three flocks' draws, inside WebGPU's vertex-buffer limit,
 *    built for WebGPU (WGSL) and the WebGL2 fallback (GLSL) without a word.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { uniform, vec3 } from 'three/tsl';
import {
    FLIGHT_KIND, ODYSSEY_FLIGHTS, birdBeatWeight, birdWingPose, birdWingPoseAt, createOdysseyFlights, foldBirdPoint,
    lowlandBirdModel,
} from '../../src/rendering/odyssey/composition/odyssey-flights.js';
import { ODYSSEY_BIRD_MODELS } from '../../src/rendering/odyssey/composition/odyssey-bird-models.js';

vi.setConfig({ testTimeout: 60_000 });
afterEach(() => { vi.restoreAllMocks(); });

const KINDS = [
    ['gull', FLIGHT_KIND.GULL, 1.40],
    ['swallow', FLIGHT_KIND.SWALLOW, 0.33],
    ['goose', FLIGHT_KIND.GOOSE, 1.60],
];
const luminance = (c) => (0.2126 * c[0]) + (0.7152 * c[1]) + (0.0722 * c[2]);
const vec = (a, i) => [a[i * 3], a[(i * 3) + 1], a[(i * 3) + 2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [(a[1] * b[2]) - (a[2] * b[1]), (a[2] * b[0]) - (a[0] * b[2]), (a[0] * b[1]) - (a[1] * b[0])];
const dot = (a, b) => (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2]);

/** The vertex nearest `target` (bird frame). */
function nearest(model, target) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < model.vertexCount; i += 1) {
        const d = Math.hypot(...sub(vec(model.positions, i), target));
        if (d < bestD) { bestD = d; best = i; }
    }
    return best;
}

/** Every pose a bird flies in `seconds` of clock, for a few birds. */
function posesFlown(kind, seconds = 12, step = 1 / 30) {
    const out = [];
    [0.07, 0.31, 0.58, 0.93].forEach((seed) => {
        for (let t = 0; t < seconds; t += step) out.push(birdWingPose(kind, t, seed));
    });
    return out;
}

describe('the lowland birds (Blender models)', () => {
    KINDS.forEach(([name, kind, span]) => {
        it(`models the ${name} at its real size in a few hundred triangles`, () => {
            const m = lowlandBirdModel(kind);
            expect(m.name).toBe(name);
            expect(m.span).toBeCloseTo(span, 1);
            expect(m.triangleCount).toBeGreaterThanOrEqual(100);
            expect(m.triangleCount).toBeLessThanOrEqual(400);
            expect(m.index.length).toBe(m.triangleCount * 3);
            expect(m.positions.length).toBe(m.vertexCount * 3);
            ['normals', 'top', 'under'].forEach((k) => expect(m[k].length, k).toBe(m.vertexCount * 3));
            expect(m.hinge.length).toBe(m.vertexCount * 4);
            expect(Math.max(...m.index)).toBeLessThan(m.vertexCount);
            // Decoded once and shared.
            expect(lowlandBirdModel(kind)).toBe(m);
        });

        it(`faces the ${name}'s body out and its wings up, with unit normals`, () => {
            const m = lowlandBirdModel(kind);
            let wingUp = 0;
            let wingCount = 0;
            for (let i = 0; i < m.vertexCount; i += 1) {
                const n = vec(m.normals, i);
                expect(Math.hypot(...n)).toBeCloseTo(1, 3);
                if (m.hinge[i * 4] > 0.5) { wingUp += n[1]; wingCount += 1; }
            }
            expect(wingUp / wingCount).toBeGreaterThan(0.8);
            // The face winding agrees with the normals (three's front faces are counter-clockwise).
            let agree = 0;
            for (let t = 0; t < m.triangleCount; t += 1) {
                const [a, b, c] = [m.index[t * 3], m.index[(t * 3) + 1], m.index[(t * 3) + 2]];
                const pa = vec(m.positions, a);
                const face = cross(sub(vec(m.positions, b), pa), sub(vec(m.positions, c), pa));
                const avg = [0, 1, 2].map((k) => m.normals[(a * 3) + k] + m.normals[(b * 3) + k]
                    + m.normals[(c * 3) + k]);
                if (dot(face, avg) > 0) agree += 1;
            }
            expect(agree / m.triangleCount).toBeGreaterThan(0.97);
        });

        it(`weights the ${name}'s wings at the shoulder, the wrist and the tip, and nothing else`, () => {
            const m = lowlandBirdModel(kind);
            for (let i = 0; i < m.vertexCount; i += 1) {
                const [x] = vec(m.positions, i);
                const [arm, hand, tip, thin] = [0, 1, 2, 3].map((k) => m.hinge[(i * 4) + k]);
                [arm, hand, tip, thin].forEach((w) => {
                    expect(w).toBeGreaterThanOrEqual(0);
                    expect(w).toBeLessThanOrEqual(1);
                });
                // The hand moves only what the arm moves; the tip only what the hand moves.
                expect(hand).toBeLessThanOrEqual(arm + 1e-6);
                expect(tip).toBeLessThanOrEqual(hand + 1e-6);
                // Inside the shoulder nothing folds.
                if (Math.abs(x) < m.shoulder[0] * 0.8) expect(arm).toBe(0);
            }
            // The wingtips are carried all the way.
            const tipL = nearest(m, [m.span / 2, m.wrist[1], -m.length]);
            expect(m.hinge[tipL * 4]).toBeCloseTo(1, 2);
            expect(m.hinge[(tipL * 4) + 1]).toBeCloseTo(1, 2);
        });
    });

    it('paints the plumage each bird is named by', () => {
        const gull = lowlandBirdModel(FLIGHT_KIND.GULL);
        const swallow = lowlandBirdModel(FLIGHT_KIND.SWALLOW);
        const goose = lowlandBirdModel(FLIGHT_KIND.GOOSE);
        // Gull: a white body, a grey mantle above, black wingtips; white under the arm.
        const gullBelly = nearest(gull, [0, -0.05, 0.0]);
        const gullTip = nearest(gull, [0.68, 0.03, -0.075]);
        const gullArm = nearest(gull, [0.2, 0.03, 0.0]);
        expect(luminance(vec(gull.top, gullBelly))).toBeGreaterThan(0.6);
        expect(luminance(vec(gull.top, gullTip))).toBeLessThan(0.05);
        expect(luminance(vec(gull.top, gullArm))).toBeLessThan(luminance(vec(gull.under, gullArm)));
        expect(luminance(vec(gull.under, gullArm))).toBeGreaterThan(0.6);
        // Swallow: a blue-black back, a pale belly, a rust throat.
        const back = vec(swallow.top, nearest(swallow, [0, 0.013, 0.0]));
        const belly = vec(swallow.top, nearest(swallow, [0, -0.014, -0.01]));
        const throat = vec(swallow.top, nearest(swallow, [0, -0.008, 0.036]));
        expect(luminance(back)).toBeLessThan(0.04);
        expect(back[2]).toBeGreaterThan(back[0]);
        expect(luminance(belly)).toBeGreaterThan(0.6);
        expect(throat[0]).toBeGreaterThan(throat[1] * 2);
        // Goose: grey-brown, an orange bill, a pale forewing over dark flight feathers.
        const bill = vec(goose.top, nearest(goose, [0, -0.015, 0.47]));
        expect(bill[0]).toBeGreaterThan(bill[2] * 3);
        const fore = vec(goose.top, nearest(goose, [0.2, 0.04, 0.11]));
        const flightF = vec(goose.top, nearest(goose, [0.2, 0.04, -0.19]));
        expect(luminance(fore)).toBeGreaterThan(luminance(flightF) * 2);
    });

    it('writes the module the script measured (the record it carries matches the arrays)', () => {
        KINDS.forEach(([name, kind]) => {
            const src = ODYSSEY_BIRD_MODELS[name];
            const m = lowlandBirdModel(kind);
            expect(src.vertexCount).toBe(m.vertexCount);
            expect(src.stretch[0]).toBeLessThan(1.4);
        });
    });
});

describe('the lowland birds\' wingbeat (CPU twin of the vertex stage)', () => {
    it('holds a rest pose at zero angles', () => {
        const m = lowlandBirdModel(FLIGHT_KIND.GULL);
        const zero = {
            lift: 0, sweep: 0, bend: 0, fold: 0, curl: 0,
        };
        for (let i = 0; i < m.vertexCount; i += 7) {
            const p = vec(m.positions, i);
            const w = [0, 1, 2].map((k) => m.hinge[(i * 4) + k]);
            foldBirdPoint(m, p, w, zero).forEach((v, k) => expect(v).toBeCloseTo(p[k], 6));
        }
    });

    KINDS.forEach(([name, kind]) => {
        it(`never tears, crushes or turns over the ${name}'s skin in any pose it flies`, () => {
            const m = lowlandBirdModel(kind);
            const rest = [];
            const w = [];
            for (let i = 0; i < m.vertexCount; i += 1) {
                rest.push(vec(m.positions, i));
                w.push([0, 1, 2].map((k) => m.hinge[(i * 4) + k]));
            }
            const edges = new Map();
            for (let t = 0; t < m.triangleCount; t += 1) {
                for (let e = 0; e < 3; e += 1) {
                    const a = m.index[(t * 3) + e];
                    const b = m.index[(t * 3) + ((e + 1) % 3)];
                    const key = a < b ? `${a},${b}` : `${b},${a}`;
                    if (!edges.has(key)) edges.set(key, [a, b, Math.hypot(...sub(rest[a], rest[b]))]);
                }
            }
            let stretch = 1;
            let squash = 1;
            let turned = 0;
            const poses = posesFlown(kind, 6, 1 / 20);
            poses.forEach((pose) => {
                const moved = rest.map((p, i) => foldBirdPoint(m, p, w[i], pose));
                const normals = rest.map((p, i) => foldBirdPoint(m, vec(m.normals, i), w[i], pose, true));
                edges.forEach(([a, b, r0]) => {
                    if (r0 < 1e-5) return;
                    const r = Math.hypot(...sub(moved[a], moved[b])) / r0;
                    stretch = Math.max(stretch, r);
                    squash = Math.min(squash, r);
                });
                for (let t = 0; t < m.triangleCount; t += 1) {
                    const [a, b, c] = [m.index[t * 3], m.index[(t * 3) + 1], m.index[(t * 3) + 2]];
                    const face = cross(sub(moved[b], moved[a]), sub(moved[c], moved[a]));
                    const avg = [0, 1, 2].map((k) => normals[a][k] + normals[b][k] + normals[c][k]);
                    // A face that turns against its own (turned) normals shows its other side.
                    if (Math.hypot(...face) > 1e-9 && dot(face, avg) < 0) turned += 1;
                }
            });
            // The skin bends, stretched or bunched: the trailing edge folds in behind the wrist on
            // the upstroke (the hinge bands widen toward it so it bunches gently instead of
            // crumpling). The swallow's swept glide tucks its short arm's trailing edge in by the
            // body for good — a shape it holds, not a crease that flickers with the beat.
            expect(stretch, `${name} stretch`).toBeLessThan(1.4);
            expect(squash, `${name} squash`).toBeGreaterThan(kind === FLIGHT_KIND.SWALLOW ? 0.18 : 0.45);
            expect(turned / (poses.length * m.triangleCount), `${name} turned faces`).toBeLessThan(0.002);
        });

        it(`lags the ${name}'s outer wing behind the inner over a beat`, () => {
            const { lag } = lowlandBirdModel(kind).flight.beat;
            expect(lag).toBeGreaterThan(0.3);
            expect(lag).toBeLessThan(1.2);
            // The hand's own elevation peaks after the arm's.
            let armPeak = 0;
            let handPeak = 0;
            let armBest = -Infinity;
            let handBest = -Infinity;
            for (let k = 0; k < 360; k += 1) {
                const phi = (k / 360) * Math.PI * 2;
                const p = birdWingPoseAt(kind, phi, 1);
                if (p.lift > armBest) { armBest = p.lift; armPeak = phi; }
                if (p.lift + p.bend > handBest) { handBest = p.lift + p.bend; handPeak = phi; }
            }
            expect(handPeak).toBeGreaterThan(armPeak);
        });
    });

    it('flies each kind its own way: gulls glide, swallows burst, geese beat steadily', () => {
        const share = (kind) => {
            let beating = 0;
            let n = 0;
            [0.12, 0.44, 0.71].forEach((seed) => {
                for (let t = 0; t < 120; t += 0.25) { beating += birdBeatWeight(kind, t, seed); n += 1; }
            });
            return beating / n;
        };
        expect(share(FLIGHT_KIND.GULL)).toBeGreaterThan(0.08);
        expect(share(FLIGHT_KIND.GULL)).toBeLessThan(0.35);
        expect(share(FLIGHT_KIND.SWALLOW)).toBeGreaterThan(0.35);
        expect(share(FLIGHT_KIND.SWALLOW)).toBeLessThan(0.75);
        expect(share(FLIGHT_KIND.GOOSE)).toBe(1);
        const rate = (kind) => lowlandBirdModel(kind).flight.rate;
        expect(rate(FLIGHT_KIND.SWALLOW)).toBeGreaterThan(rate(FLIGHT_KIND.GULL) * 2);
        expect(rate(FLIGHT_KIND.GOOSE)).toBeGreaterThan(2);
        // The gull's glide is a gull wing: the arm raised, the hand bowed down.
        const glide = birdWingPoseAt(FLIGHT_KIND.GULL, 0, 0);
        expect(glide.lift).toBeGreaterThan(0.1);
        expect(glide.lift + glide.bend).toBeLessThan(0);
        // The swallow glides with its hands swept back.
        expect(birdWingPoseAt(FLIGHT_KIND.SWALLOW, 0, 0).fold).toBeGreaterThan(0.4);
    });
});

describe('the lowland flights draw', () => {
    it('is one material shared by one instanced draw per flock, inside the vertex-buffer limit', () => {
        const flights = createOdysseyFlights();
        expect(flights.group.name).toBe('odyssey-flights');
        expect(flights.meshes).toHaveLength(ODYSSEY_FLIGHTS.length);
        flights.meshes.forEach((mesh, i) => {
            expect(mesh.material).toBe(flights.material);
            const flock = ODYSSEY_FLIGHTS[i];
            expect(mesh.geometry.instanceCount).toBe(flock.count);
            expect(mesh.geometry.index.count).toBe(lowlandBirdModel(flock.kind).triangleCount * 3);
            // Every attribute is a vertex buffer on WebGPU; a pipeline binds at most eight.
            expect(Object.keys(mesh.geometry.attributes).length).toBeLessThanOrEqual(8);
            // The same layout in every draw: one shader and one pipeline for all three.
            expect(Object.keys(mesh.geometry.attributes).sort())
                .toEqual(Object.keys(flights.meshes[0].geometry.attributes).sort());
        });
        flights.dispose();
    });

    it('shows only the flocks whose window is open', () => {
        const flights = createOdysseyFlights();
        flights.update(9, 0.15);
        expect(flights.meshes.map((m) => m.visible)).toEqual([true, false, false]);
        flights.update(9, 0.30);
        expect(flights.meshes.map((m) => m.visible)).toEqual([false, true, true]);
        flights.update(9, 0.5);
        expect(flights.group.visible).toBe(false);
        flights.dispose();
    });

    const canvas = {
        style: {},
        width: 1280,
        height: 720,
        addEventListener() {},
        removeEventListener() {},
        getContext() { return null; },
        setAttribute() {},
    };
    function stubRenderer(forceWebGL) {
        const renderer = new THREE.WebGPURenderer({ canvas, forceWebGL });
        renderer.hasFeature = () => false;
        renderer._initialized = true;
        renderer._bindings = { getSharedBindGroup: (group) => group };
        if (forceWebGL) {
            renderer.backend.capabilities = { getUniformBufferLimit: () => 16384, getMaxAnisotropy: () => 1 };
        }
        if (!forceWebGL) {
            renderer.backend.device = { limits: { maxUniformBufferBindingSize: 65536 }, features: new Set() };
        }
        return renderer;
    }

    [['WGSL', false], ['GLSL', true]].forEach(([label, forceWebGL]) => {
        it(`builds the birds' material (${label}) without a word`, () => {
            const flights = createOdysseyFlights({
                hazeColour: vec3(0.7, 0.8, 0.9),
                sunColour: uniform(new THREE.Color(1, 0.95, 0.9)),
            });
            const scene = new THREE.Scene();
            scene.add(flights.group);
            const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 6000);
            camera.position.set(0, 340, 0);
            camera.updateMatrixWorld(true);
            flights.group.updateMatrixWorld(true);
            const renderer = stubRenderer(forceWebGL);
            const heard = [];
            vi.spyOn(console, 'warn').mockImplementation((...a) => heard.push(a.join(' ')));
            vi.spyOn(console, 'error').mockImplementation((...a) => heard.push(a.join(' ')));
            flights.meshes.forEach((target) => {
                const builder = renderer.backend.createNodeBuilder(target, renderer);
                builder.scene = scene;
                builder.material = target.material;
                builder.camera = camera;
                builder.context.material = target.material;
                builder.lightsNode = renderer.lighting.getNode(scene);
                builder.fogNode = null;
                builder.clippingContext = null;
                builder.build();
                expect(builder.fragmentShader.length, target.name).toBeGreaterThan(200);
                expect(builder.vertexShader).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
                expect(builder.fragmentShader).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
            });
            expect(heard).toEqual([]);
            flights.dispose();
        });
    });
});
