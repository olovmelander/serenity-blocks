/**
 * Act II life and light (2026-10-20 overhaul): the lowland flights, the massif's eagle, the
 * antisolar sky (rainbow + shower) and the cloud-shadow schedule.
 *
 * Two kinds of guard, no GPU needed:
 *  - SHADERS: every new material is built through three's own WGSL and GLSL node builders against
 *    a stub renderer (the harness of himalayan-peak-shaders.test.js). A graph one builder cannot
 *    turn into a shader throws or warns here instead of leaving a part undrawn on a player's
 *    machine; NaN / Infinity / a stringified node in the output fail too.
 *  - PLACES: every bird keeps clear of the terrain and of the rail while it is shown, on the CPU
 *    height mirror and the live spline — the clearances the summit kettle was solved to.
 */
import { readFileSync } from 'node:fs';
import {
    beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context, uniform, vec3 } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
    FLIGHT_KIND, ODYSSEY_FLIGHTS, createOdysseyFlights, flightPositionAt, resolveFlightLanes,
} from '../../src/rendering/odyssey/composition/odyssey-flights.js';
import {
    EAGLE_BONES, ODYSSEY_EAGLE, createEaglePose, eagleFlight, eaglePoint, eagleRevealAt,
} from '../../src/rendering/odyssey/composition/odyssey-eagle-flight.js';
import { createOdysseyEagle } from '../../src/rendering/odyssey/composition/odyssey-eagle.js';
import { airMoteKindsAt, createOdysseyAirMotes } from '../../src/rendering/odyssey/composition/odyssey-air-motes.js';
import {
    ODYSSEY_SPINDRIFT, createSummitSpindrift, findHeroSummit, spindriftRevealAt,
} from '../../src/rendering/odyssey/composition/odyssey-summit-spindrift.js';
import { antisolarSchedule, applyAntisolarSky } from '../../src/rendering/odyssey/world/odyssey-sky-optics.js';
import { cloudShadowSchedule } from '../../src/rendering/odyssey/world/odyssey-world-renderer.js';
import { odysseyWorldHeight } from '../../src/rendering/odyssey/world/odyssey-world-height.js';
import { getOdysseyPathPointAt } from '../../src/rendering/odyssey/path-utils.js';
import { deriveOdysseyChapterPositions } from '../../src/core/odyssey/data/odyssey-layout.js';

const CP = deriveOdysseyChapterPositions();
const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];

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

/** Distance from `pt` to the rail over the journey-progress window [a, b]. */
function railDistance(pt, a, b) {
    let best = Infinity;
    for (let p = a; p <= b; p += 0.0005) {
        const r = getOdysseyPathPointAt(p);
        best = Math.min(best, Math.hypot(r.x - pt.x, r.y - pt.y, r.z - pt.z));
    }
    return best;
}

describe('the lowland flights', () => {
    it('is one opaque, fog-exempt instanced draw, hidden until a flock is staged', () => {
        const flights = createOdysseyFlights();
        const { mesh } = flights;
        expect(mesh.name).toBe('odyssey-flights');
        expect(mesh.visible).toBe(false);
        expect(mesh.material.transparent).toBe(false);
        expect(mesh.material.depthWrite).toBe(true);
        expect(mesh.material.fog).toBe(false);
        expect(mesh.frustumCulled).toBe(false);
        const total = ODYSSEY_FLIGHTS.reduce((n, f) => n + f.count, 0);
        expect(mesh.geometry.instanceCount).toBe(total);
        // position + aWing + two packed per-instance vec4s: well inside WebGPU's 8 vertex buffers.
        expect(Object.keys(mesh.geometry.attributes).length).toBeLessThanOrEqual(4);
        flights.dispose();
    });

    it('reveals each flock by progress inside chapters 3-4 only', () => {
        const flights = createOdysseyFlights();
        ODYSSEY_FLIGHTS.forEach((flock) => {
            const [a, b, c, d] = flock.window;
            expect(a, flock.id).toBeGreaterThan(CP[2] - 0.015);
            expect(d, flock.id).toBeLessThan(CP[4]);
            expect(b).toBeGreaterThan(a);
            expect(d).toBeGreaterThan(c);
        });
        flights.update(9, 0.10);
        expect(flights.mesh.visible).toBe(false);
        flights.update(9, 0.19);
        expect(flights.mesh.visible).toBe(true);
        flights.update(9, 0.40);
        expect(flights.mesh.visible).toBe(false);
        flights.dispose();
    });

    it('flies the same birds every session', () => {
        expect(resolveFlightLanes()).toEqual(resolveFlightLanes());
        const lanes = resolveFlightLanes();
        expect(lanes).toHaveLength(ODYSSEY_FLIGHTS.reduce((n, f) => n + f.count, 0));
    });

    it('keeps every bird above the ground and off the rail while its flock is shown', () => {
        const lanes = resolveFlightLanes();
        lanes.forEach((lane, i) => {
            const flock = ODYSSEY_FLIGHTS[lane.flock];
            let clear = Infinity;
            let rail = Infinity;
            const span = flock.kind === FLIGHT_KIND.GOOSE ? flock.period : 90;
            for (let t = 0; t < span; t += 1.5) {
                const b = flightPositionAt(lane, t);
                if (!b.shown) continue;
                clear = Math.min(clear, b.y - odysseyWorldHeight(b.x, b.z));
                if (t % 6 === 0) rail = Math.min(rail, railDistance(b, flock.window[0], flock.window[3]));
            }
            expect(clear, `${flock.id} #${i} terrain clearance`).toBeGreaterThan(6);
            expect(rail, `${flock.id} #${i} rail clearance`).toBeGreaterThan(14);
        });
    });

    it('builds for WebGPU and for the WebGL2 fallback without a word', () => {
        const flights = createOdysseyFlights({
            hazeColour: vec3(0.7, 0.8, 0.9),
            sunColour: uniform(new THREE.Color(1, 0.95, 0.9)),
        });
        BACKENDS.forEach(([label, Builder]) => expectClean(build(Builder, flights.mesh), `flights ${label}`));
        flights.dispose();
    });
});

describe("the massif's eagle", () => {
    let gltf;
    beforeAll(async () => {
        const file = readFileSync(new URL('../../src/rendering/odyssey/assets/chapter-04/eagle.glb', import.meta.url));
        const bytes = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
        gltf = await new GLTFLoader().parseAsync(bytes, '');
    });

    it('is shown only from the end of chapter 4 up the first half of the climb', () => {
        // Where it leaves is the camera's business: odyssey-act2-fade-out-of-view.test.js.
        const [a, , , d] = ODYSSEY_EAGLE.window;
        expect(a).toBeGreaterThan(CP[3]);
        expect(d).toBeLessThan((CP[4] + CP[5]) / 2);
        expect(eagleRevealAt(CP[3])).toBe(0);
        expect(eagleRevealAt((CP[3] + CP[4]) / 2 + 0.03)).toBeGreaterThan(0.99);
        expect(eagleRevealAt(0.5)).toBe(0);
    });

    it('thermals clear of the massif and of the rail', () => {
        let clear = Infinity;
        let rail = Infinity;
        const pt = { x: 0, y: 0, z: 0 };
        for (let t = 0; t < ODYSSEY_EAGLE.round; t += 0.7) {
            eaglePoint(t, pt);
            clear = Math.min(clear, pt.y - odysseyWorldHeight(pt.x, pt.z));
            const [w0, , , w3] = ODYSSEY_EAGLE.window;
            if (Math.round(t / 0.7) % 6 === 0) rail = Math.min(rail, railDistance(pt, w0, w3));
        }
        expect(clear, 'terrain clearance').toBeGreaterThan(40);
        expect(rail, 'rail clearance').toBeGreaterThan(45);
    });

    it('holds an upright, orthonormal body frame round the whole thermal (never belly-up)', () => {
        const pose = createEaglePose();
        for (let t = 0; t < ODYSSEY_EAGLE.round; t += 1.3) {
            eagleFlight(t, {}, pose);
            const [lx, ly, lz] = pose.left;
            const [ux, uy, uz] = pose.up;
            const [fx, fy, fz] = pose.forward;
            expect(Math.hypot(lx, ly, lz)).toBeCloseTo(1, 4);
            expect(Math.hypot(ux, uy, uz)).toBeCloseTo(1, 4);
            expect(Math.abs((lx * ux) + (ly * uy) + (lz * uz))).toBeLessThan(1e-4);
            expect(Math.abs((fx * ux) + (fy * uy) + (fz * uz))).toBeLessThan(1e-4);
            expect(uy, `up.y @${t}`).toBeGreaterThan(0.3);
        }
        expect(Object.keys(pose.joints).sort()).toEqual([...EAGLE_BONES].sort());
    });

    it('loads the model off the GPU, is ready only when told, and builds for both backends', async () => {
        const eagle = createOdysseyEagle({ url: 'unused' });
        expect(eagle.group.visible).toBe(false);
        expect(eagle.isReady).toBe(false);
        // Hand the parsed model over the way the loader would.
        const scene = gltf.scene.clone(true);
        let skinned = null;
        scene.traverse((o) => { if (!skinned && o.isSkinnedMesh) skinned = o; });
        expect(skinned).toBeTruthy();
        skinned.material = eagle.material;
        BACKENDS.forEach(([label, Builder]) => expectClean(build(Builder, skinned), `eagle ${label}`));
        // Not ready, so never drawn — whatever the progress says.
        eagle.update(10, 0.016, 0.3);
        expect(eagle.group.visible).toBe(false);
        eagle.dispose();
    });
});

describe('the air motes', () => {
    it('is one additive draw that leaves the target alpha alone, hidden outside its windows', () => {
        const air = createOdysseyAirMotes();
        expect(air.mesh.name).toBe('odyssey-air-motes');
        expect(air.mesh.material.transparent).toBe(true);
        expect(air.mesh.material.depthWrite).toBe(false);
        expect(air.mesh.material.blending).toBe(THREE.AdditiveBlending);
        expect(air.mesh.material.premultipliedAlpha).toBe(true);
        expect(air.mesh.material.fog).toBe(false);
        // No instance data at all: a mote's place follows from its index.
        expect(Object.keys(air.mesh.geometry.attributes)).toEqual(['position']);
        air.update(9, 0.10);
        expect(air.mesh.visible).toBe(false);
        air.update(9, 0.20);
        expect(air.mesh.visible).toBe(true);
        air.update(9, 0.72);
        expect(air.mesh.visible).toBe(false);
        air.dispose();
    });

    it('fills the air with pollen on the shore, down on the meadows, dust on the climb', () => {
        expect(airMoteKindsAt(0.19).pollen).toBeGreaterThan(0.99);
        expect(airMoteKindsAt(0.30).down).toBeGreaterThan(0.99);
        expect(airMoteKindsAt(0.55).dust).toBeGreaterThan(0.99);
        // Gone well before the 5->6 departure (chapter 6 starts at CP[5]).
        expect(airMoteKindsAt(CP[5] - 0.07).dust).toBe(0);
    });

    it('builds for both backends', () => {
        const air = createOdysseyAirMotes({ sunColour: uniform(new THREE.Color(1, 0.95, 0.9)) });
        BACKENDS.forEach(([label, Builder]) => expectClean(build(Builder, air.mesh), `air motes ${label}`));
        air.dispose();
    });
});

describe('the summit spindrift', () => {
    const hero = { x: -182.7, z: -1059.3 };
    const summit = findHeroSummit(odysseyWorldHeight, hero);

    it('leaves the summit point on the height mirror and streams away from the rail', () => {
        expect(summit.y).toBeGreaterThan(980);
        // The plume runs west (the banner's side): its far end is farther from the rail than its root.
        const w = ODYSSEY_SPINDRIFT.wind;
        const len = Math.hypot(...w);
        const tip = {
            x: summit.x + (w[0] / len) * ODYSSEY_SPINDRIFT.run,
            y: summit.y + (w[1] / len) * ODYSSEY_SPINDRIFT.run,
            z: summit.z + (w[2] / len) * ODYSSEY_SPINDRIFT.run,
        };
        const [a, , , d] = ODYSSEY_SPINDRIFT.window;
        expect(railDistance(tip, a, d)).toBeGreaterThan(railDistance(summit, a, d));
        expect(railDistance(tip, a, d)).toBeGreaterThan(150);
    });

    it('is shown from the shore to the top of the climb and gone before the departure', () => {
        expect(spindriftRevealAt(0.10)).toBe(0);
        expect(spindriftRevealAt(0.30)).toBe(1);
        expect(spindriftRevealAt(0.60)).toBe(1);
        expect(spindriftRevealAt(CP[5] - 0.06)).toBe(0);
    });

    it('builds for both backends', () => {
        const plume = createSummitSpindrift({ summit, sunColour: uniform(new THREE.Color(1, 0.95, 0.9)) });
        expect(plume.mesh.material.transparent).toBe(true);
        expect(plume.mesh.material.depthWrite).toBe(false);
        expect(plume.mesh.material.fog).toBe(false);
        BACKENDS.forEach(([label, Builder]) => expectClean(build(Builder, plume.mesh), `spindrift ${label}`));
        plume.dispose();
    });
});

describe('the antisolar sky', () => {
    it('stands the bow over the chapter 3-4 orbs only, the shower around it', () => {
        // Act II progress (actT) of a few orbs: L14 0.168, L16 0.206, L20 0.281, L25 0.373.
        expect(antisolarSchedule(0.10).bow).toBe(0);
        expect(antisolarSchedule(0.206).bow).toBeGreaterThan(0.99);
        expect(antisolarSchedule(0.281).bow).toBeGreaterThan(0.99);
        expect(antisolarSchedule(0.373).bow).toBe(0);
        expect(antisolarSchedule(0.373).veil).toBe(0);
        // The shower gathers before the bow and thins after it.
        expect(antisolarSchedule(0.17).veil).toBeGreaterThan(antisolarSchedule(0.17).bow);
    });

    it('builds the sky term for both backends', () => {
        const material = new THREE.MeshBasicNodeMaterial();
        const dir = vec3(0.3, 0.2, -0.93).normalize();
        material.colorNode = applyAntisolarSky({
            sky: vec3(0.7, 0.8, 0.9),
            dir,
            anti: vec3(0.545, -0.426, -0.722),
            bow: uniform(1),
            veil: uniform(1),
            sunColour: uniform(new THREE.Color(1, 0.95, 0.9)),
            time: uniform(9),
        });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
        BACKENDS.forEach(([label, Builder]) => expectClean(build(Builder, mesh), `sky optics ${label}`));
    });
});

describe('the cloud shadows', () => {
    it('are off under water, open up as the shore arrives, and hold a scattered cover', () => {
        expect(cloudShadowSchedule(0.0).strength).toBe(0);
        expect(cloudShadowSchedule(0.2).strength).toBe(1);
        // "Light floods the island": heavier just after the breach, scattered from the shore orbs.
        expect(cloudShadowSchedule(0.106).cover).toBeGreaterThan(cloudShadowSchedule(0.2).cover + 0.2);
        [0.2, 0.4, 0.7, 0.95].forEach((t) => {
            const { cover } = cloudShadowSchedule(t);
            expect(cover).toBeGreaterThan(0.4);
            expect(cover).toBeLessThan(0.7);
        });
    });
});
