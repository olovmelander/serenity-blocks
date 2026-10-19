/**
 * Spring — the air: willow down and pollen drifting over the valley (spring-air.js), and what
 * gameplay throws into it (spring-motes.js, SpringWorld's bursts).
 *
 * The shader half builds both materials through three's own node builders against a stub renderer
 * (the WGSL one of the WebGPU backend and the GLSL one of the WebGL2 fallback): a graph one of them
 * cannot turn into a shader, a JS operator applied to a node (NaN or "[object Object]" printed into
 * the source) or a smoothstep with equal edges fails here instead of leaving the air undrawn. The
 * world half plays the events and reads the ring of motes and the air's uniforms.
 */
import {
    afterEach, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import { AIR, SpringAir } from '../../src/themes/spring/spring-air.js';
import { MOTE_KIND, Motes } from '../../src/themes/spring/spring-motes.js';
import { QUALITY } from '../../src/themes/spring/spring-quality.js';
import { createUniforms } from '../../src/themes/spring/spring-tsl.js';
import {
    AIR_MOTION, REST_RIG, SpringWorld, fovForAspect, valleyGround,
} from '../../src/themes/spring/spring-world.js';

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

function buildShaders(Builder, mesh) {
    const builder = new Builder(mesh, stubRenderer());
    builder.scene = new THREE.Scene();
    builder.camera = new THREE.PerspectiveCamera();
    builder.context.material = mesh.material;
    builder.material = mesh.material;
    builder.build();
    return { vertex: builder.vertexShader, fragment: builder.fragmentShader };
}

/** smoothstep() calls whose two edges are the same constant: a hard error in WGSL. */
function equalEdges(shader) {
    const number = '(-?\\d+(?:\\.\\d*)?(?:e[-+]?\\d+)?)';
    return [...shader.matchAll(new RegExp(`smoothstep\\(\\s*${number}\\s*,\\s*${number}\\s*,`, 'g'))]
        .filter((m) => Number(m[1]) === Number(m[2])).map((m) => m[0]);
}

/** Words WGSL reserves that read like ordinary names, declared as a variable or a loop index. */
const RESERVED = /\b(?:var|let|const)\s+(?:patch|filter|sample|target|input|output|module|ref|self|layout|resource|namespace)\b/;

afterEach(() => {
    vi.restoreAllMocks();
});

describe('spring air: the shaders', () => {
    const u = createUniforms();
    const meshes = { air: new SpringAir(u, 64).mesh, motes: new Motes(u, 64).mesh };

    describe.each(Object.keys(meshes))('%s', (name) => {
        it.each(BACKENDS)('builds as %s, clean', (label, Builder) => {
            const heard = [];
            const listen = (...args) => heard.push(args.map(String).join(' ').slice(0, 300));
            vi.spyOn(console, 'warn').mockImplementation(listen);
            vi.spyOn(console, 'error').mockImplementation(listen);
            const { vertex, fragment } = buildShaders(Builder, meshes[name]);
            expect(heard).toEqual([]);
            for (const source of [vertex, fragment]) {
                expect(source).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
                // A name WGSL reserves (a TSL loop's `name` becomes a variable): Tint refuses the module.
                expect(source).not.toMatch(RESERVED);
                expect(equalEdges(source)).toEqual([]);
            }
            // The light is worked out a corner, not a pixel: the fragment stage is small.
            expect(fragment.length).toBeLessThan(vertex.length);
        });
    });
});

describe('spring air: the motes', () => {
    it('are a mesh of quads with no instance data, one a mote, as many as the tier asks', () => {
        const air = new SpringAir(createUniforms(), QUALITY.High.air);
        expect(air.geometry.instanceCount).toBe(QUALITY.High.air);
        expect(Object.keys(air.geometry.attributes)).toEqual(['position']);
        expect(air.mesh.material.blending).toBe(THREE.AdditiveBlending);
        expect(air.mesh.material.depthWrite).toBe(false);
        air.dispose();
    });

    it('grows with the tier, and so does what gameplay can throw into the air', () => {
        const tiers = ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme'];
        for (let k = 1; k < tiers.length; k++) {
            expect(QUALITY[tiers[k]].air).toBeGreaterThan(QUALITY[tiers[k - 1]].air);
            expect(QUALITY[tiers[k]].motes).toBeGreaterThan(QUALITY[tiers[k - 1]].motes);
        }
        expect(QUALITY.Extreme.air).toBeLessThanOrEqual(2400);
    });

    it('drift down the valley on the breeze', () => {
        expect(Math.hypot(...AIR.breeze)).toBeCloseTo(1, 2);
        expect(AIR.breeze[0]).toBeGreaterThan(0); // toward the right, down the valley
    });
});

/** A world with its camera at rest, and a helper that steps it. */
function makeWorld(quality = 'Minimal') {
    const scene = new THREE.Scene();
    const aspect = 16 / 9;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new SpringWorld({
        scene, quality, capture: true, prepared: { quality, ground: valleyGround(), assets: null },
    }).build();
    world.bindCamera(camera);
    world.setViewport(1600, 900, aspect);
    let t = 0;
    const step = (seconds = 1 / 30) => {
        const frames = Math.max(1, Math.round(seconds * 30));
        for (let i = 0; i < frames; i++) {
            t += 1 / 30;
            world.updateCamera(camera, { time: t, delta: 1 / 30 });
            world.update({ time: t, delta: 1 / 30 }, camera);
        }
    };
    step();
    return { world, step };
}

/** The motes alive in the ring: kind, colour, born. */
function live(world) {
    const { motes } = world;
    const out = [];
    for (let i = 0; i < motes.count; i++) {
        const born = motes.start[i * 4 + 3];
        if (born < -1e5) continue;
        out.push({
            i,
            kind: motes.kind[i * 4],
            rgb: Array.from(motes.look.subarray(i * 4, i * 4 + 3)),
            born,
            at: Array.from(motes.start.subarray(i * 4, i * 4 + 3)),
        });
    }
    return out;
}

describe('spring air: what gameplay does to it', () => {
    // The valley is baked once a run (the first world pays for it).
    beforeAll(() => {
        makeWorld().world.dispose();
    }, 60000);

    it('a lock shakes the piece\'s own pollen out of its patch of bloom, and puffs the air there', () => {
        const { world, step } = makeWorld();
        world.onLock({ rows: [19, 18], u: 0.2, color: '#279DF1' }); // the S, hepatica blue
        const thrown = live(world);
        expect(thrown.length).toBeGreaterThan(8);
        expect(thrown.every((m) => m.kind === MOTE_KIND.pollen)).toBe(true);
        // Most in the piece's colour (a few gold).
        const blue = thrown.filter((m) => m.rgb[2] > m.rgb[0] * 3);
        expect(blue.length / thrown.length).toBeGreaterThan(0.5);
        // At the patch the lock opened (the event row the air reads), on the left of the card.
        const patch = world.u.tables.events[0];
        expect(thrown.every((m) => Math.hypot(m.at[0] - patch.x, m.at[2] - patch.y) < 3)).toBe(true);
        expect(patch.x).toBeLessThan(0);
        expect(patch.w).toBeGreaterThan(0);
        step(0.5);
        world.dispose();
    });

    it('a hard drop shakes out more, and knocks a ring of down off the plants', () => {
        const { world } = makeWorld();
        world.onLock({ rows: [19], u: 0.8, color: '#EE8512' });
        const soft = live(world).length;
        world.motes.clear();
        world.onLock({
            rows: [19], u: 0.8, color: '#EE8512', hardDrop: true, distance: 14,
        });
        const hard = live(world);
        expect(hard.length).toBeGreaterThan(soft);
        expect(hard.some((m) => m.kind === MOTE_KIND.down)).toBe(true);
        world.dispose();
    });

    it('a clear lifts pollen and down off both sides in its rows\' colours, and breathes through the air', () => {
        const { world, step } = makeWorld();
        // A row of I (lemon) on the left half, S (blue) on the right.
        const rowCodes = [0, 0, 0, 0, 0, 4, 4, 4, 4, 4];
        world.onClear({ lines: 1, rowCodes, combo: 1 });
        const thrown = live(world).filter((m) => m.kind === MOTE_KIND.pollen);
        const left = thrown.filter((m) => m.at[0] < 0);
        const right = thrown.filter((m) => m.at[0] > 0);
        expect(left.length).toBeGreaterThan(0);
        expect(right.length).toBeGreaterThan(0);
        expect(left.every((m) => m.rgb[0] > m.rgb[2])).toBe(true); // lemon
        expect(right.every((m) => m.rgb[2] > m.rgb[0])).toBe(true); // blue
        step();
        const wave = world.u.airWave.value;
        expect(wave.x).toBeCloseTo(world.time - 1 / 30, 3);
        expect(wave.y).toBeCloseTo(AIR_MOTION.wave + AIR_MOTION.wavePerLine, 5);
        const one = wave.y;
        world.onClear({ lines: 4, rowCodes: [...rowCodes, ...rowCodes, ...rowCodes, ...rowCodes], combo: 1 });
        step();
        expect(world.u.airWave.value.y).toBeGreaterThan(one);
        world.dispose();
    });

    it('each link of a chain spins up a whirlwind beside the card, on alternate sides, stronger each time', () => {
        const { world, step } = makeWorld();
        world.onLock({ rows: [19], u: 0.5, color: '#E8508C' });
        world.motes.clear();
        world.onCombo(1);
        expect(live(world)).toEqual([]);
        world.onCombo(2);
        const first = live(world).filter((m) => m.kind === MOTE_KIND.whirl);
        expect(first.length).toBeGreaterThan(10);
        world.motes.clear();
        world.onCombo(3);
        const second = live(world).filter((m) => m.kind === MOTE_KIND.whirl);
        expect(second.length).toBeGreaterThan(first.length);
        // Opposite sides of the card.
        expect(Math.sign(first[0].at[0])).toBe(-Math.sign(second[0].at[0]));
        // The piece's colour, some gold and some down.
        expect(second.some((m) => m.rgb[0] > 0.7 && m.rgb[1] < 0.2)).toBe(true);
        step();
        world.dispose();
    });

    it('a chain stirs the air (it eases in), hurries its clock and turns its gyres; a break lets the down go', () => {
        const { world, step } = makeWorld();
        step(1);
        const calm = world.getState().air;
        expect(calm.stir).toBe(0);
        const before = world.u.air.value.x;
        step(1);
        const calmRate = world.u.air.value.x - before;
        expect(calmRate).toBeCloseTo(1, 1);
        for (let n = 1; n <= 8; n++) world.onCombo(n);
        step(4);
        const stirred = world.getState().air;
        expect(stirred.stir).toBeGreaterThan(0.9);
        expect(stirred.gyre).toBeGreaterThan(calm.gyre);
        const at = world.u.air.value.x;
        step(1);
        expect(world.u.air.value.x - at).toBeGreaterThan(calmRate * 2);
        world.motes.clear();
        world.onCombo(0);
        const let_go = live(world);
        expect(let_go.filter((m) => m.kind === MOTE_KIND.down).length).toBeGreaterThan(20);
        step(15);
        expect(world.getState().air.stir).toBeLessThan(0.1);
        world.dispose();
    });

    it('back-to-back strikes glints off the river, a level up sends down over, a perfect clear stills the air', () => {
        const { world, step } = makeWorld();
        world.onB2B(1);
        const glints = live(world).filter((m) => m.kind === MOTE_KIND.glint);
        expect(glints.length).toBeGreaterThan(5);
        world.motes.clear();
        world.levelUp(2);
        expect(live(world).filter((m) => m.kind === MOTE_KIND.down).length).toBeGreaterThan(20);
        world.motes.clear();
        world.onClear({ lines: 4, perfect: true });
        expect(live(world).length).toBeGreaterThan(40);
        step(4);
        expect(world.u.air.value.w).toBeGreaterThan(0.9);
        const at = world.u.air.value.x;
        step(1);
        expect(world.u.air.value.x - at).toBeLessThan(0.3);
        step(20);
        expect(world.u.air.value.w).toBe(0);
        world.dispose();
    });

    it('a T-spin whirls the air on the side of its lock', () => {
        const { world } = makeWorld();
        world.onLock({ rows: [19], u: 0.85, color: '#F8F4EC' });
        world.motes.clear();
        world.onClear({ lines: 2, tspin: true, combo: 1 });
        const whirl = live(world).filter((m) => m.kind === MOTE_KIND.whirl);
        expect(whirl.length).toBeGreaterThan(10);
        expect(whirl[0].at[0]).toBeGreaterThan(0);
        world.dispose();
    });

    it('throws nothing into the air under reduced motion, and the air drifts slower', () => {
        const { world, step } = makeWorld();
        world.setReducedMotion(true);
        world.onLock({ rows: [19], u: 0.2, color: '#279DF1' });
        world.onClear({ lines: 2, rowCodes: Array(20).fill(1), combo: 2 });
        world.onCombo(2);
        expect(live(world)).toEqual([]);
        // The patch of bloom still opens.
        expect(world.u.tables.events[0].w).toBeGreaterThan(0);
        const at = world.u.air.value.x;
        step(1);
        expect(world.u.air.value.x - at).toBeLessThan(0.6);
        world.dispose();
    });

    it('a seek gives the same air again, and a rebuild in place keeps it', () => {
        const { world, step } = makeWorld();
        for (let n = 1; n <= 5; n++) world.onCombo(n);
        step(3);
        const state = world.exportSessionState();
        const { clock, gyre, stir } = world.getState().air;
        const other = makeWorld().world;
        other.importSessionState(state);
        expect(other.getState().air).toEqual({ clock, gyre, stir });
        world.seek(12);
        expect(world.getState().air).toEqual({ clock: 12, gyre: 0, stir: 0 });
        expect(live(world)).toEqual([]);
        world.dispose();
        other.dispose();
    });
});
