/**
 * Earth Core's shaft (walls + lava falls): the geometry faces the climb, the cave mouth keeps the
 * opening vista open, and both materials build for WebGPU (WGSL) and the WebGL2 fallback (GLSL)
 * through three's own node builders on a device-less renderer (the pyrestorm-shaders set-up).
 * Not a compile: Tint and the driver never see these shaders here.
 */
import {
    beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import {
    SHAFT,
    SHAFT_FALLS,
    createShaftFalls,
    createShaftWall,
    planEarthCoreShaft,
    shaftMouthHalfAngle,
    shaftRadiusAt,
} from '../../src/rendering/odyssey/chapter-environments/earth-core-shaft.js';
import { createLavaFloorTSL } from '../../src/rendering/odyssey/chapter-environments/earth-core.tsl.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

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
    if (forceWebGL) renderer.backend.capabilities = { getUniformBufferLimit: () => 16384, getMaxAnisotropy: () => 1 };
    else renderer.backend.device = { limits: { maxUniformBufferBindingSize: 65536 }, features: new Set() };
    return renderer;
}

const vista = { x: 0.677, z: 0.736 };
const len = Math.hypot(vista.x, vista.z);
vista.x /= len; vista.z /= len;
const right = { x: -vista.z, z: vista.x };
const plan = planEarthCoreShaft({
    axis: { x: -3.5, z: -0.6 }, lakeY: -10, vista, right,
});
const uniforms = {
    uTime: uniform(3), uPulseIntensity: uniform(0), uSeam: uniform(0), uOpacity: uniform(1), uDescent: uniform(0.4),
};

describe('Earth Core shaft — the plan', () => {
    it('narrows from the lake chamber to the vent throat at the seabed, then flares into a lip', () => {
        expect(shaftRadiusAt(0)).toBeCloseTo(SHAFT.R_CHAMBER, 6);
        expect(shaftRadiusAt(80)).toBeLessThan(SHAFT.R_CHAMBER);
        expect(shaftRadiusAt(SHAFT.H_THROAT_TOP)).toBeCloseTo(SHAFT.R_THROAT, 6);
        expect(shaftRadiusAt(SHAFT.H_TOP)).toBeGreaterThan(SHAFT.R_THROAT);
        for (let h = 0; h < SHAFT.H_THROAT_TOP; h += 2) {
            expect(shaftRadiusAt(h + 2)).toBeLessThanOrEqual(shaftRadiusAt(h) + 1e-9);
        }
    });

    it('keeps the cave mouth open below its crown and closed above it', () => {
        expect(shaftMouthHalfAngle(0)).toBeCloseTo(SHAFT.MOUTH_HALF_ANGLE, 6);
        expect(shaftMouthHalfAngle(SHAFT.MOUTH_CROWN_H)).toBe(0);
        expect(shaftMouthHalfAngle(120)).toBe(0);
    });

    it('seats every fall on the wall, off the vista, pouring into the lake', () => {
        expect(plan.falls).toHaveLength(SHAFT_FALLS.length);
        plan.falls.forEach((f) => {
            // Never inside the cave mouth's azimuths (the opening frame keeps its vista).
            expect(Math.abs(f.azimuth)).toBeGreaterThan(SHAFT.MOUTH_HALF_ANGLE);
            const r = Math.hypot(f.lip.x - plan.axis.x, f.lip.z - plan.axis.z);
            expect(r).toBeCloseTo(shaftRadiusAt(f.lipH) - 3.2, 4);
            // The big falls pour into the lake; the throat's slim curtains break into spray first.
            if (!f.breaks) expect(f.lip.y - f.drop).toBeLessThan(plan.lakeY);
            else expect(f.lip.y - f.drop).toBeGreaterThan(plan.lakeY + 60);
        });
    });
});

describe('Earth Core shaft — the wall geometry', () => {
    let wall;
    beforeAll(() => { wall = createShaftWall(uniforms, plan); });

    it('faces the axis: the climb sees the wall from inside', () => {
        const pos = wall.geometry.getAttribute('position');
        const nrm = wall.geometry.getAttribute('normal');
        let inward = 0;
        let total = 0;
        for (let v = 0; v < pos.count; v += 13) {
            // Vertices in the cave mouth belong to no triangle (zero normal): not part of the wall.
            if (Math.hypot(nrm.getX(v), nrm.getY(v), nrm.getZ(v)) < 0.5) continue;
            const px = pos.getX(v) - plan.axis.x;
            const pz = pos.getZ(v) - plan.axis.z;
            const d = -(nrm.getX(v) * px) - (nrm.getZ(v) * pz);
            if (d > 0) inward += 1;
            total += 1;
        }
        expect(inward / total).toBeGreaterThan(0.9);
    });

    it('is one draw of a sensible size, with no triangle in the cave mouth', () => {
        const tris = wall.geometry.index.count / 3;
        expect(tris).toBeGreaterThan(40000);
        expect(tris).toBeLessThan(90000);
        const pos = wall.geometry.getAttribute('position');
        const idx = wall.geometry.index.array;
        let inMouth = 0;
        for (let t = 0; t < idx.length; t += 3 * 7) {
            const v = idx[t];
            const h = pos.getY(v) - plan.lakeY;
            const px = pos.getX(v) - plan.axis.x;
            const pz = pos.getZ(v) - plan.axis.z;
            const az = Math.atan2((px * plan.right.x) + (pz * plan.right.z), (px * plan.vista.x) + (pz * plan.vista.z));
            if (h < 20 && Math.abs(az) < shaftMouthHalfAngle(h) - ((12 * Math.PI) / 180)) inMouth += 1;
        }
        expect(inMouth).toBe(0);
    });
});

describe('Earth Core shaft — shaders build for both backends', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.5, 3000);
    camera.position.set(-5, 30, -1);
    camera.lookAt(-4, 200, 1);
    camera.updateMatrixWorld(true);
    const group = new THREE.Group();
    const wall = createShaftWall(uniforms, plan);
    const falls = createShaftFalls(uniforms, plan);
    // The lake's High graph (crust plates + the breathing blisters), which only High compiles.
    const lake = createLavaFloorTSL(uniforms.uTime, uniforms.uPulseIntensity, uniforms.uDescent, { crustPlates: true }).mesh;
    group.add(wall, falls, lake);
    scene.add(group);
    group.updateMatrixWorld(true);

    [['WGSL', false], ['GLSL', true]].forEach(([label, forceWebGL]) => {
        it(`builds the wall, the falls and the High lake (${label}) without a word`, () => {
            const renderer = stubRenderer(forceWebGL);
            const heard = [];
            const warn = vi.spyOn(console, 'warn').mockImplementation((...a) => heard.push(a.join(' ')));
            const error = vi.spyOn(console, 'error').mockImplementation((...a) => heard.push(a.join(' ')));
            try {
                [wall, falls, lake].forEach((mesh) => {
                    const builder = renderer.backend.createNodeBuilder(mesh, renderer);
                    builder.scene = scene;
                    builder.material = mesh.material;
                    builder.camera = camera;
                    builder.context.material = mesh.material;
                    builder.lightsNode = renderer.lighting.getNode(scene);
                    builder.fogNode = null;
                    builder.clippingContext = null;
                    builder.build();
                    const frag = builder.fragmentShader;
                    expect(typeof frag).toBe('string');
                    expect(frag.length).toBeGreaterThan(200);
                    expect(frag).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
                    expect(builder.vertexShader).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
                    // A stage this size is a feature unrolled in JavaScript, not a loop.
                    expect(frag.length).toBeLessThan(64 * 1024);
                });
            } finally {
                warn.mockRestore();
                error.mockRestore();
            }
            expect(heard).toEqual([]);
        });
    });
});
