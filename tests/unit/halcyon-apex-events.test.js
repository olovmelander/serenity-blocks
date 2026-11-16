/**
 * Halcyon Apex — the board's moments, each with its own answer: the spray a hard drop throws out
 * from under the card, the wisps two and three lines send to the great crystals, the salute and
 * the prism bursts of four lines, the crown a perfect clear opens over the sky, the helix a twist
 * winds round the crystals, and the hour a new level turns. Also the giant in the dawn sky and the
 * seven hues of the pieces.
 */
import {
    describe, expect, it, vi,
} from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import { HalcyonApexWorld, REST_RIG } from '../../src/themes/halcyon-apex/halcyon-apex-world.js';
import { HUSH_HOLD, SITE, compositionFor } from '../../src/themes/halcyon-apex/halcyon-apex-core.js';
import { fallbackLayout } from '../../src/themes/halcyon-apex/halcyon-apex-composition.js';
import {
    BURST_LIFE, BURST_RAYS, burstLight, burstOpen,
} from '../../src/themes/halcyon-apex/halcyon-apex-fx.js';
import { IRIS_LIFE, PLANET_RADIUS, PLANET_RING } from '../../src/themes/halcyon-apex/halcyon-apex-sky.js';
import { HALCYON_APEX_TETROMINOS } from '../../src/themes/halcyon-apex/halcyon-apex-tetrominos.js';
import {
    SHAPES, USUAL_BANDS, hexToHue, inBands,
} from '../../scripts/palette-guideline-check.mjs';

vi.setConfig({ testTimeout: 120000 });

function makeWorld(quality = 'Low', width = 1600, height = 900) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, width / height, REST_RIG.near, REST_RIG.far);
    const world = new HalcyonApexWorld({ scene, quality, capture: true }).build();
    world.bindCamera(camera);
    world.setViewport(width, height, width / height);
    world.setLayout(fallbackLayout(width, height), width / height);
    world.setTraffic(false);
    world.seek(20);
    return { scene, camera, world };
}

function run(world, camera, from, to, dt = 1 / 60) {
    for (let time = from; time <= to + 1e-9; time += dt) {
        const sim = { time, delta: dt };
        world.updateCamera(camera, sim);
        world.update(sim, camera);
    }
}

/** Sparks born in [from, to): [x, y, z, birth, vx, vy, vz] each. */
function sparksBorn(world, from, to) {
    const birth = world.parts.sparks.geometry.getAttribute('aBirth').array;
    const vel = world.parts.sparks.geometry.getAttribute('aVel').array;
    const out = [];
    for (let i = 0; i < birth.length; i += 4) {
        if (birth[i + 3] >= from && birth[i + 3] < to) out.push([birth[i], birth[i + 1], birth[i + 2], birth[i + 3], vel[i], vel[i + 1], vel[i + 2]]);
    }
    return out;
}

describe('a hard drop', () => {
    it('throws two fans of spray out from under the card, leaning away from it, and a second ring', () => {
        const { world, camera } = makeWorld('High');
        run(world, camera, 20, 20.2);
        const t = world.time;
        const ringsBefore = world.u.lockA.filter((slot) => slot.value.w > 0 && slot.value.z >= t - 1e-6).length;
        world.onLock({
            u: 0.5, rows: [19, 18], hardDrop: true, color: '#f4c95d',
        });
        const fans = sparksBorn(world, t + 0.04, t + 0.2);
        expect(fans.length).toBeGreaterThan(60);
        const left = fans.filter((s) => s[4] < -0.8).length;
        const right = fans.filter((s) => s[4] > 0.8).length;
        // Each fan leans its own way: most of its sparks fly outward.
        expect(left).toBeGreaterThan(fans.length * 0.3);
        expect(right).toBeGreaterThan(fans.length * 0.3);
        fans.forEach((s) => expect(s[5]).toBeGreaterThan(3));
        const rings = world.u.lockA.filter((slot) => slot.value.w > 0 && slot.value.z >= t - 1e-6);
        expect(rings.length - ringsBefore).toBe(2);
        expect(Math.max(...rings.map((slot) => slot.value.z))).toBeCloseTo(t + 0.13, 5);

        // A soft lock throws no spray at all.
        const { world: calm, camera: cam2 } = makeWorld('High');
        run(calm, cam2, 20, 20.2);
        calm.onLock({ u: 0.5, rows: [19, 18], color: '#f4c95d' });
        expect(sparksBorn(calm, calm.time + 0.04, calm.time + 0.2)).toHaveLength(0);
        world.dispose();
        calm.dispose();
    });
});

describe('line clears, each its own', () => {
    const wispsFlown = (world) => world.getState().counts.wisps;

    it('sends a wisp to each great crystal for every line past the first (none for one line, none for four)', () => {
        [[1, 0], [2, 2], [3, 4], [4, 0]].forEach(([lines, want]) => {
            const { world, camera } = makeWorld();
            run(world, camera, 20, 20.2);
            const before = wispsFlown(world);
            world.onClear({ lines, rows: Array.from({ length: lines }, (_, i) => 19 - i) });
            expect(wispsFlown(world) - before, `${lines} lines`).toBe(want);
            world.dispose();
        });
    });

    it('answers four lines with a salute overhead and a prism burst on each great crystal as its wave arrives', () => {
        const { world, camera } = makeWorld();
        run(world, camera, 20, 20.2);
        const t = world.time;
        world.onClear({ lines: 4, rows: [19, 18, 17, 16] });
        expect(world.getState().counts.salutes).toBe(1);
        // The bursts wait for the wave: nothing yet.
        expect(world.u.burst.value.y).toBe(0);
        run(world, camera, t + 1 / 60, t + 2.6);
        const state = world.getState();
        expect(state.visitor).toMatchObject({ route: 'salute', kind: 'swift' });
        expect(state.visitor.ships).toBe(5);
        const burst = world.u.burst.value;
        expect(burst.y).toBeGreaterThan(0.6);
        expect(burst.w).toBeGreaterThan(0.6);
        // The Halcyon stands nearer the board's foot than the Apex: its burst comes first, both after the hush.
        expect(burst.z).toBeGreaterThan(t + HUSH_HOLD);
        expect(burst.x).toBeGreaterThan(burst.z);
        // A second four-line clear while the swifts are still overhead calls no second flight.
        world.onClear({ lines: 4, rows: [19, 18, 17, 16] });
        expect(world.getState().counts.salutes).toBe(1);
        run(world, camera, world.time + 1 / 60, world.time + 8);
        world.onClear({ lines: 4, rows: [19, 18, 17, 16] });
        expect(world.getState().counts.salutes).toBe(2);
        world.dispose();
    });

    it('crowns a perfect clear: seven swifts, rings of the spectrum over the sky, orbs round the Apex', () => {
        const { world, camera } = makeWorld();
        run(world, camera, 20, 20.2);
        const t = world.time;
        expect(world.u.iris.value.y).toBe(0);
        world.onClear({ lines: 4, rows: [19, 18, 17, 16], perfect: true });
        expect(world.u.iris.value.x).toBeCloseTo(t + HUSH_HOLD, 5);
        expect(world.u.iris.value.y).toBe(1);
        run(world, camera, t + 1 / 60, t + 1.5);
        const { visitor } = world.getState();
        expect(visitor.sorties.split(' ').sort()).toEqual(['crown', 'salute']);
        expect(visitor.ships).toBe(7 + 8);
        // The crown that settles after its clear opens the rings again, with no second salute.
        const { world: late, camera: cam2 } = makeWorld();
        run(late, cam2, 20, 20.2);
        late.onClear({ lines: 2, rows: [19, 18] });
        run(late, cam2, late.time + 1 / 60, late.time + 0.36);
        late.onCrown();
        expect(late.u.iris.value.x).toBeCloseTo(late.time, 5);
        expect(late.getState().counts.salutes).toBe(0);
        world.dispose();
        late.dispose();
    });

    it('keeps the sky still under reduced motion: no salute, no orbs, the rings at half', () => {
        const { world, camera } = makeWorld();
        world.setReducedMotion(true);
        run(world, camera, 20, 20.2);
        world.onClear({ lines: 4, rows: [19, 18, 17, 16], perfect: true });
        expect(world.getState().counts.salutes).toBe(0);
        expect(world.u.iris.value.y).toBe(0.5);
        run(world, camera, world.time + 1 / 60, world.time + 1.2);
        expect(world.getState().visitor).toBeNull();
        world.dispose();
    });
});

describe('a twist', () => {
    it('winds a helix of glitter up round each great crystal, twice round, as its wave leaves', () => {
        const { world, camera } = makeWorld('High');
        run(world, camera, 20, 20.2);
        const t = world.time;
        world.onClear({ lines: 2, rows: [19, 18], twist: true });
        const { apex } = world.plan;
        const near = (s, c, r) => Math.hypot(s[0] - c[0], s[2] - c[2]) < r;
        const born = sparksBorn(world, t - 1e-6, t + 0.7);
        const roundApex = born.filter((s) => near(s, apex, SITE.apex.girth * 3) && Math.abs(s[1] - apex[1]) < SITE.apex.half * 1.3);
        const roundHalcyon = born.filter((s) => near(s, world.halcyon, SITE.halcyon.girth * 3) && Math.abs(s[1] - world.halcyon[1]) < SITE.halcyon.half * 1.3);
        expect(roundApex.length).toBeGreaterThan(60);
        expect(roundHalcyon.length).toBeGreaterThan(60);
        // It climbs: the later a spark is born, the higher on the crystal.
        const byBirth = [...roundApex].sort((a, b) => a[3] - b[3]);
        expect(byBirth[byBirth.length - 1][1]).toBeGreaterThan(byBirth[0][1] + SITE.apex.half);
        // And it goes round: the sparks cover every side of the crystal.
        const sides = new Set(roundApex.map((s) => Math.floor(((Math.atan2(s[2] - apex[2], s[0] - apex[0]) / (Math.PI * 2)) + 1) * 8) % 8));
        expect(sides.size).toBe(8);
        // A clear without a twist winds nothing round the Apex in that moment.
        const { world: plain, camera: cam2 } = makeWorld('High');
        run(plain, cam2, 20, 20.2);
        plain.onClear({ lines: 2, rows: [19, 18] });
        const plainBorn = sparksBorn(plain, plain.time - 1e-6, plain.time + 0.5)
            .filter((s) => near(s, plain.plan.apex, SITE.apex.girth * 3) && Math.abs(s[1] - plain.plan.apex[1]) > 3);
        expect(plainBorn.length).toBeLessThan(10);
        world.dispose();
        plain.dispose();
    });
});

describe('a new level', () => {
    it('races the clouds for a breath, runs both ley lines in the new hour and calls a flight over', () => {
        const { world, camera } = makeWorld();
        run(world, camera, 20, 21);
        const drift = () => world.cloudDrift;
        const d0 = drift();
        run(world, camera, world.time + 1 / 60, world.time + 1);
        const calm = drift() - d0;
        const { pulses } = world.getState().counts;
        world.levelUp(2);
        expect(world.getState().counts.pulses - pulses).toBe(4);
        const d1 = drift();
        run(world, camera, world.time + 1 / 60, world.time + 1);
        expect(drift() - d1).toBeGreaterThan(calm * 12);
        expect(world.getState().visitor?.sorties ?? '').toContain('flyby');
        // It eases off: a few seconds on the sky is back to its own pace.
        run(world, camera, world.time + 1 / 60, world.time + 6);
        const d2 = drift();
        run(world, camera, world.time + 1 / 60, world.time + 1);
        expect(drift() - d2).toBeLessThan(calm * 3);
        // Silent (a rebuild in the middle of a run): the hour only.
        const before = world.getState().counts.pulses;
        world.levelUp(3, { silent: true });
        expect(world.getState().counts.pulses).toBe(before);
        world.dispose();
    });
});

describe('the prism burst', () => {
    it('opens fast, holds its light a moment and is gone within its life', () => {
        expect(burstOpen(0)).toBe(0);
        expect(burstOpen(0.3)).toBeGreaterThan(0.7);
        expect(burstOpen(2)).toBeGreaterThan(0.99);
        expect(burstLight(0.05)).toBeGreaterThan(0.9);
        expect(burstLight(1)).toBeLessThan(burstLight(0.3));
        expect(burstLight(BURST_LIFE)).toBe(0);
        expect(burstLight(-1)).toBe(0);
    });

    it('is one pool of rays for both crystals, drawn in the lagoon\'s mirror, dormant at rest', () => {
        const { world } = makeWorld();
        const { bursts } = world.parts;
        expect(bursts.count).toBe(BURST_RAYS * 2);
        expect(bursts.geometry.instanceCount).toBe(BURST_RAYS * 2);
        expect(bursts.mesh.layers.mask).toBe(1);
        expect(world.u.burst.value.toArray()).toEqual([-100, 0, -100, 0]);
        world.dispose();
    });
});

describe('the giant in the dawn', () => {
    it('hangs where the composition leaves it sky, clear of the Apex, its lit limb toward the sun', () => {
        [[1600, 900], [430, 850]].forEach(([w, h]) => {
            const { world } = makeWorld('Minimal', w, h);
            const cam = world.restCamera();
            const dir = world.u.planetDir.value;
            const comp = compositionFor(w / h);
            const at = dir.clone().multiplyScalar(1000).add(cam.position).project(cam);
            expect(at.x * 0.5 + 0.5).toBeCloseTo(comp.planet.x, 2);
            expect(0.5 - at.y * 0.5).toBeCloseTo(comp.planet.y, 2);
            // Its frame is square to where it hangs, and the sun lies to its right in a wide frame.
            expect(Math.abs(dir.dot(world.u.planetRight.value))).toBeLessThan(1e-6);
            expect(Math.abs(dir.dot(world.u.planetUp.value))).toBeLessThan(1e-6);
            expect(world.u.planetUp.value.y).toBeGreaterThan(0.5);
            expect(world.u.planetSun.value.length()).toBeCloseTo(1, 6);
            if (w > h) expect(world.u.planetSun.value.x).toBeGreaterThan(0.5);
            // Well clear of the Apex: more than its rings' reach away.
            const apex = new THREE.Vector3(...world.plan.apex).sub(cam.position).normalize();
            expect(Math.acos(apex.dot(dir))).toBeGreaterThan(PLANET_RADIUS * PLANET_RING);
            expect(world.u.planet.value.x).toBe(PLANET_RADIUS);
            world.dispose();
        });
    });

    it('is a paler disc of sky by day and stands out in the blue hour', () => {
        const { world, camera } = makeWorld('Minimal');
        run(world, camera, 20, 20.1);
        const day = world.u.planet.value.z;
        world.levelUp(5, { silent: true });
        run(world, camera, world.time + 1 / 60, world.time + 0.2);
        expect(day).toBeLessThan(0.6);
        expect(world.u.planet.value.z).toBeGreaterThan(0.9);
        world.dispose();
    });
});

describe('the pieces', () => {
    it('are seven hues no two of which sit together, none the hue its shape usually wears', () => {
        const hues = SHAPES.map((shape) => hexToHue(HALCYON_APEX_TETROMINOS.colors[shape]));
        hues.forEach((hue) => expect(hue).not.toBeNull());
        for (let i = 0; i < hues.length; i++) {
            for (let j = i + 1; j < hues.length; j++) {
                const gap = Math.abs(hues[i] - hues[j]);
                expect(Math.min(gap, 360 - gap), `${SHAPES[i]} / ${SHAPES[j]}`).toBeGreaterThan(18);
            }
        }
        SHAPES.forEach((shape, i) => expect(inBands(hues[i], USUAL_BANDS[shape], 12), shape).toBe(false));
    });
});

// ── The new shaders through both node builders ──────────────────────────────────

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

function build(Builder, object) {
    const builder = new Builder(object, stubRenderer());
    builder.scene = new THREE.Scene();
    builder.camera = new THREE.PerspectiveCamera();
    builder.context.material = object.material;
    builder.material = object.material;
    builder.build();
    return { vertex: builder.vertexShader, fragment: builder.fragmentShader };
}

describe('the bursts and the sky', () => {
    const { world } = makeWorld('High');

    it.each([['bursts'], ['sky']])('%s builds on WGSL and GLSL without a word, NaN or equal edges', (name) => {
        const { mesh } = world.parts[name];
        [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]].forEach(([label, Builder]) => {
            const heard = [];
            const listen = (...args) => heard.push(args.map(String).join(' ').slice(0, 300));
            const warn = vi.spyOn(console, 'warn').mockImplementation(listen);
            const error = vi.spyOn(console, 'error').mockImplementation(listen);
            let out;
            try {
                out = build(Builder, mesh);
            } finally {
                warn.mockRestore();
                error.mockRestore();
            }
            expect(heard, `${name} ${label}`).toEqual([]);
            ['vertex', 'fragment'].forEach((stage) => {
                const code = out[stage];
                expect(Buffer.byteLength(code), `${name} ${label} ${stage} size`).toBeLessThan(48 * 1024);
                expect(code, `${name} ${label} ${stage}`).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
                const equal = [...code.matchAll(/smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,/g)].filter((m) => Number(m[1]) === Number(m[2]));
                expect(equal, `${name} ${label} ${stage}`).toEqual([]);
            });
        });
    });

    it('takes the giant in a per-pixel branch that holds no derivative and no texture read', () => {
        // WGSL allows neither under a branch that differs from pixel to pixel: the shader would be
        // refused on WebGPU alone. The source is the place to hold it to that.
        const source = readFileSync(new URL('../../src/themes/halcyon-apex/halcyon-apex-sky.js', import.meta.url), 'utf8');
        const from = source.indexOf('if (planet) {');
        const to = source.indexOf('// ── The sun', from);
        expect(from).toBeGreaterThan(0);
        expect(to).toBeGreaterThan(from);
        const branch = source.slice(from, to);
        expect(branch).toContain('If(dot(dir, u.planetDir)');
        ['fwidth(', 'dFdx(', 'dFdy(', 'u.noise(', 'texture('].forEach((call) => expect(branch, call).not.toContain(call));
        expect(IRIS_LIFE).toBeGreaterThan(3);
        world.dispose();
    });
});
