/**
 * The real BioluminescenceWorld, built in Node on a THREE.Scene with no renderer: what a lock, a
 * clear, a chain and the Great Bloom write into the uniforms, the pools and the mushrooms' state.
 * Nothing here compiles a shader; nothing asserts a tuned gain, size or colour — only what
 * follows what, what is bigger than what, and that a replay is the same replay.
 */
import {
    afterAll, afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    BIOLUMINESCENCE_PARTS, BioluminescenceWorld, REST_RIG, SURGE_COOL, fovForAspect,
} from '../../src/themes/bioluminescence/bioluminescence-world.js';
import {
    BIOLUM_PALETTES, CLEAR_SLOTS, CLEAR_TRAVEL, EMITTER_MAX, HUSH_HOLD, JELLY_MAX, LOCK_SLOTS, RUNNER_SLOTS,
    RUNNER_TAIL, STEM_CLIMB, STORE_HOLD, STORE_MAX, jelliesForCombo, pieceColor, powerForCombo,
} from '../../src/themes/bioluminescence/bioluminescence-core.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/bioluminescence/bioluminescence-quality.js';
import { capCentre } from '../../src/themes/bioluminescence/bioluminescence-layout.js';
import { cardUnion, fallbackLayout } from '../../src/themes/bioluminescence/bioluminescence-composition.js';
import { runnerPoint, sporeHeight } from '../../src/themes/bioluminescence/bioluminescence-fx.js';
import { BIOLUMINESCENCE_TETROMINOS } from '../../src/themes/bioluminescence/bioluminescence-tetrominos.js';

// A world is a plan, a noise field and two dozen node materials: building one takes a moment,
// and longer on a machine that is busy with something else.
vi.setConfig({ testTimeout: 60_000 });

const PINK = BIOLUMINESCENCE_TETROMINOS.colors.Z;
const BLUE = BIOLUMINESCENCE_TETROMINOS.colors.J;
const AMBER = BIOLUMINESCENCE_TETROMINOS.colors.L;
const START = 10;

function buildWorld(quality = 'Minimal', {
    width = 1600, height = 900, live = true, capture = true,
} = {}) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, width / height, REST_RIG.near, REST_RIG.far);
    const world = new BioluminescenceWorld({ scene, quality, capture }).build();
    world.bindCamera(camera);
    const made = {
        scene, camera, world, width, height, live,
    };
    return rest(made);
}

/** Put a world back at rest at START, as the theme does on its first frame. */
function rest(made) {
    const {
        world, camera, width, height, live,
    } = made;
    world.setReducedMotion(false);
    Object.values(world.parts).forEach((part) => { part.mesh.visible = true; });
    world.setViewport(width, height, width / height);
    // The live rects, or null when no board is on screen.
    world.setLayout(live ? fallbackLayout(width, height) : null, width / height);
    world.seek(START);
    world.updateCamera(camera, { time: START, delta: 0 });
    world.update({ time: START, delta: 0 });
    return made;
}

const cache = new Map();
/**
 * A world to play a test on. Worlds are kept between tests and put back at rest (seek drops
 * every event in flight; a test below proves that a replay after it is exact).
 */
function makeWorld(quality = 'High', options = {}) {
    const key = JSON.stringify([quality, options]);
    if (!cache.has(key)) cache.set(key, buildWorld(quality, options));
    return rest(cache.get(key));
}

/** Advance the world from its current time by `seconds` in `steps` equal frames. */
function run({ world, camera }, seconds, steps = Math.max(1, Math.round(seconds * 60))) {
    const t0 = world.time;
    for (let i = 1; i <= steps; i++) {
        const sim = { time: t0 + (seconds * i) / steps, delta: seconds / steps };
        world.updateCamera(camera, sim);
        world.update(sim);
    }
}

/** The ring slots born at `time` (a lock writes more than one: found by birth, never by index). */
function ringsBornAt(world, time, tolerance = 1e-9) {
    const out = [];
    world.u.lockA.forEach((slot, index) => {
        if (Math.abs(slot.value.z - time) <= tolerance && slot.value.w > 0) {
            out.push({ place: slot.value, colour: world.u.lockC[index].value });
        }
    });
    return out;
}

/** Where a mushroom's cap stands in the rest camera's frame: NDC x (−1 the left edge, 1 the right). */
function capNdcX(world, index) {
    const m = world.mushrooms.list[index];
    const cap = capCentre(m);
    // The cap moves across the pool with its foot.
    return new THREE.Vector3(cap[0] + world.shift(m), cap[1], cap[2]).project(world.restCamera()).x;
}

/** The same as a fraction of the frame's width. */
function capScreenX(world, index) {
    return capNdcX(world, index) * 0.5 + 0.5;
}

/** The spores a pool has been asked for while `run` runs: what emit() said it threw. */
function sporesThrown(world, run) {
    const emit = vi.spyOn(world.spores, 'emit');
    run();
    const thrown = emit.mock.results.reduce((sum, result) => sum + result.value, 0);
    emit.mockRestore();
    return thrown;
}

/** Scale a colour so its brightest channel is 1. */
function hue(rgb) {
    const peak = Math.max(rgb[0], rgb[1], rgb[2]);
    return rgb.map((c) => c / peak);
}

/** Every number the shaders are handed that gameplay writes. */
function liveNumbers(world) {
    const out = {};
    world.u.lampRows.forEach((row, i) => { out[`lamp ${i}`] = row.toArray(); });
    Object.entries(world.mushrooms.draws).forEach(([key, draw]) => {
        Object.entries(draw.state).forEach(([name, array]) => { out[`mushrooms ${key}.${name}`] = array; });
    });
    Object.entries(world.spores.state).forEach(([name, array]) => { out[`spores.${name}`] = array; });
    for (const name of ['aPath', 'aBend', 'aGo', 'aTint']) {
        out[`runners.${name}`] = world.runners.geometry.getAttribute(name).array;
    }
    out['jellies.aLife'] = world.jellies.geometry.getAttribute('aLife').array;
    world.u.lockA.forEach((slot, i) => { out[`lockA ${i}`] = slot.value.toArray(); });
    world.u.lockC.forEach((slot, i) => { out[`lockC ${i}`] = slot.value.toArray(); });
    world.u.clearA.forEach((slot, i) => { out[`clearA ${i}`] = slot.value.toArray(); });
    world.u.clearC.forEach((slot, i) => { out[`clearC ${i}`] = slot.value.toArray(); });
    world.u.clearH.forEach((slot, i) => { out[`clearH ${i}`] = slot.value.toArray(); });
    out.heart = world.u.heart.value.toArray();
    out.shock = world.u.shock.value.toArray();
    out['jets.rows'] = world.jets.uniforms.rows.value.toArray();
    out['jets.frame'] = world.jets.uniforms.frame.value.toArray();
    out['jets.color'] = world.jets.uniforms.color.value.toArray();
    out.chime = world.crystals.uniforms.chime.value.toArray();
    out['jellies.flash'] = world.jellies.uniforms.flash.value.toArray();
    for (const name of ['time', 'power', 'surge', 'breath', 'pulse', 'moteLift', 'wake', 'sprout', 'swirl', 'squeeze']) {
        out[`u.${name}`] = [world.u[name].value];
    }
    return out;
}

function expectAllFinite(world, when) {
    Object.entries(liveNumbers(world)).forEach(([name, values]) => {
        for (let i = 0; i < values.length; i++) {
            if (!Number.isFinite(values[i])) throw new Error(`${when}: ${name}[${i}] is ${values[i]}`);
        }
    });
    const post = world.getPostState();
    for (const key of ['flash', 'kick', 'shafts', 'bloomBoost', 'exposure']) {
        expect(Number.isFinite(post[key]), `${when}: post.${key}`).toBe(true);
    }
    expect(Number.isFinite(post.heart.x) && Number.isFinite(post.heart.y), `${when}: post.heart`).toBe(true);
}

/** A session with everything in it. Returns nothing: the world is the record. */
function playScript(made) {
    const { world, camera } = made;
    world.seek(20);
    world.updateCamera(camera, { time: 20, delta: 0 });
    world.update({ time: 20, delta: 0 });
    const beat = () => run(made, 0.25, 15);
    world.onLock({ u: 0.2, rows: [18, 19], color: PINK });
    beat();
    world.onLock({
        u: 0.8, rows: [19], color: BLUE, hardDrop: true,
    });
    beat();
    beat();
    world.onCombo(1);
    world.onClear({ rows: [19], lines: 1 });
    beat();
    world.onLock({ u: 0.5, rows: [19], color: AMBER });
    world.onCombo(2);
    world.onClear({ rows: [19, 18], lines: 2, tspin: true });
    beat();
    beat();
    world.levelUp(2);
    beat();
    world.onLock({ u: 0.1, rows: [19], color: PINK });
    world.onCombo(3);
    world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
    beat();
    beat();
    beat();
    world.onClear({
        rows: [19, 18, 17], lines: 3, perfect: true, player: 2,
    });
    beat();
    world.onCombo(0);
    beat();
}

function record(world) {
    return JSON.stringify({
        state: world.getState(),
        post: world.getPostState(),
        numbers: Object.fromEntries(Object.entries(liveNumbers(world)).map(([name, values]) => [name, Array.from(values)])),
    });
}

afterEach(() => {
    vi.restoreAllMocks();
});
afterAll(() => {
    cache.forEach(({ world }) => world.dispose());
    cache.clear();
});

describe('bioluminescence world: build', () => {
    it('builds every tier from node materials only, with the parts its tier pays for', () => {
        for (const quality of QUALITY_NAMES) {
            const { scene, world } = buildWorld(quality);
            const tier = QUALITY[quality];
            const { plan } = world;
            const materials = new Set();
            scene.traverse((object) => {
                if (object.material) materials.add(object.material);
            });
            expect(materials.size, quality).toBeGreaterThan(10);
            for (const material of materials) {
                expect(material.isNodeMaterial, material.name).toBe(true);
                expect(material.isShaderMaterial, material.name).not.toBe(true);
                expect(material.fog, material.name).toBe(false); // the cave's air is in every material
            }
            // The whole picture and every event, on every tier.
            for (const part of [
                'backdrop', 'vault', 'floor', 'water', 'elder', 'parasols', 'crystals', 'worms', 'jellies', 'spores',
                'runners', 'jets',
            ]) {
                expect(world.parts[part], `${quality}.${part}`).toBeTruthy();
            }
            // Every part answers to a name the capture flag can address.
            for (const name of Object.keys(world.parts)) expect(BIOLUMINESCENCE_PARTS, name).toContain(name);
            expect(Boolean(world.reflection), `${quality} mirror`).toBe(tier.reflection > 0);
            expect(Boolean(world.parts.pads), `${quality} pads`).toBe(tier.pads > 0);
            expect(Boolean(world.parts.motes), `${quality} motes`).toBe(tier.motes > 0);
            expect(Boolean(world.parts.threads), `${quality} threads`).toBe(tier.threads > 0);
            expect(Boolean(world.parts.vines), `${quality} vines`).toBe(tier.vines > 0);

            // What a tier draws is the plan's first N of everything.
            const planned = Math.min(tier.mushrooms, plan.mushrooms.length);
            const sprouts = Math.min(tier.sprouts, plan.sprouts.length);
            expect(world.mushrooms.count, quality).toBe(planned + sprouts);
            expect(world.mushrooms.list.slice(0, planned), quality).toEqual(plan.mushrooms.slice(0, planned));
            expect(world.mushrooms.list.slice(planned).every((m) => m.kind === 'sprout'), quality).toBe(true);
            const drawn = Object.values(world.mushrooms.draws);
            expect(drawn.reduce((sum, draw) => sum + draw.count, 0), quality).toBe(world.mushrooms.count);
            for (const draw of drawn) expect(draw.geometry.instanceCount, draw.mesh.name).toBe(draw.count);
            expect(world.mushrooms.draws.elder.count, quality).toBe(1);
            expect(world.crystals.count, quality).toBe(Math.min(tier.crystals, plan.crystals.length));
            expect(world.parts.crystals.geometry.instanceCount, quality).toBe(world.crystals.count);
            expect(world.spores.count, quality).toBe(tier.spores);
            expect(world.jellies.count, quality).toBe(Math.min(tier.jellies, JELLY_MAX));
            expect(world.runners.count, quality).toBe(RUNNER_SLOTS * RUNNER_TAIL);
            expect(world.u.lampCount, quality).toBe(Math.min(tier.lamps, plan.emitters.length));
            expect(world.u.scatterCount, quality).toBe(Math.min(tier.scatter, plan.emitters.length));
            expect(world.getState()).toMatchObject({
                quality,
                mushrooms: world.mushrooms.count,
                crystals: world.crystals.count,
                spores: tier.spores,
                reflection: tier.reflection,
                jellies: jelliesForCombo(0, world.jellies.count),
                combo: 0,
                held: 0,
                squeeze: 1,
                layoutLive: true,
                palette: BIOLUM_PALETTES[0].name,
            });
            // The caps either side of the card are there to be fed.
            expect(world.targets.left.length, quality).toBeGreaterThan(0);
            expect(world.targets.right.length, quality).toBeGreaterThan(0);
            // Swimmers and the row jets are for the camera only: the pool's mirror skips layer 1.
            expect(world.parts.runners.mesh.layers.mask).toBe(2);
            expect(world.parts.jets.mesh.layers.mask).toBe(2);
            for (const name of Object.keys(world.parts)) {
                if (name !== 'runners' && name !== 'jets') expect(world.parts[name].mesh.layers.mask, name).toBe(1);
            }
            expectAllFinite(world, `${quality} at rest`);

            world.dispose();
            world.dispose();
            expect(world.disposed).toBe(true);
            expect(scene.children).toHaveLength(0);
            expect(world.parts).toEqual({});
            expect(world.u).toBeNull();
            // A late call on a disposed world is harmless.
            expect(() => {
                world.onLock({ u: 0.3, rows: [19], color: PINK });
                world.onClear({ lines: 4 });
                world.onCombo(3);
                world.levelUp(2);
                world.setViewport(800, 600, 4 / 3);
                world.setLayout(null);
                world.resetSession();
                world.seek(3);
                world.showOnlyParts(['water']);
                world.update({ time: 4, delta: 0.016 });
                world.getState();
            }).not.toThrow();
        }
    });

    it('names in PARTS exactly what the fullest tier draws', () => {
        const { world } = makeWorld('Extreme');
        expect(Object.keys(world.parts).sort()).toEqual([...BIOLUMINESCENCE_PARTS].sort());
        expect(new Set(BIOLUMINESCENCE_PARTS).size).toBe(BIOLUMINESCENCE_PARTS.length);
        // And a leaner tier draws a subset of it, never a part with another name.
        const lean = makeWorld('Minimal').world;
        expect(Object.keys(lean.parts).length).toBeLessThan(BIOLUMINESCENCE_PARTS.length);
        for (const name of Object.keys(lean.parts)) expect(BIOLUMINESCENCE_PARTS).toContain(name);
    });

    it('draws only the named parts when asked', () => {
        const { world } = makeWorld('High');
        world.showOnlyParts(['water', 'elder', 'nonsense']);
        for (const [name, part] of Object.entries(world.parts)) {
            expect(part.mesh.visible, name).toBe(name === 'water' || name === 'elder');
        }
        world.showOnlyParts(Object.keys(world.parts));
        expect(Object.values(world.parts).every((part) => part.mesh.visible)).toBe(true);
    });

    it('keeps every draw within the eight vertex buffers WebGPU binds', () => {
        const { world } = makeWorld('Extreme');
        for (const [name, part] of Object.entries(world.parts)) {
            // An interleaved buffer is one binding however many attributes read from it.
            const buffers = new Set(Object.values(part.geometry.attributes)
                .map((attribute) => (attribute.isInterleavedBufferAttribute ? attribute.data : attribute)));
            expect(buffers.size, name).toBeLessThanOrEqual(8);
        }
    });

    it('stands the camera on the rest rig and looks down the pool at the elder', () => {
        const made = makeWorld('Minimal');
        const { world, camera } = made;
        expect(camera.fov).toBeCloseTo(fovForAspect(1600 / 900), 6);
        expect(camera.near).toBe(REST_RIG.near);
        expect(camera.far).toBe(REST_RIG.far);
        expect(camera.layers.mask & 2).toBe(2); // it sees the swimmers' layer
        expect(camera.position.y).toBeGreaterThan(0); // over the water
        expect(Math.abs(camera.position.y - REST_RIG.height)).toBeLessThan(0.5);
        // The elder is in the frame, in its upper half, near the middle.
        const { heart } = world.getState();
        expect(heart.x).toBeGreaterThan(0.3);
        expect(heart.x).toBeLessThan(0.7);
        expect(heart.y).toBeGreaterThan(0);
        expect(heart.y).toBeLessThan(0.5);
        expect(world.getPostState().heart).toBe(world.heart);
        // The field of view follows the aspect inside its clamp.
        expect(fovForAspect(0.4)).toBe(REST_RIG.maxFov);
        expect(fovForAspect(4)).toBe(REST_RIG.minFov);
        expect(fovForAspect(1.5)).toBeGreaterThan(fovForAspect(2));
        expect(fovForAspect(NaN)).toBe(fovForAspect(16 / 9));
        // The pointer leans the view; nothing snaps.
        const before = camera.position.x;
        world.updateCamera(camera, { time: world.time, delta: 0, pointerX: 1 });
        expect(camera.position.x).toBeGreaterThan(before);
    });

    it('finds where a screen point meets the water, and gives up gracefully above the horizon', () => {
        const { world, camera } = makeWorld('Minimal');
        // The foot of the frame looks down at the water close by.
        const near = { ...world.screenToWater(0.5, 0.95, { x: 0, z: 0 }) };
        expect(near.z).toBeLessThan(0);
        expect(near.z).toBeGreaterThan(-40);
        // The point really is under that pixel.
        const back = new THREE.Vector3(near.x, 0, near.z).project(camera);
        expect(back.x * 0.5 + 0.5).toBeCloseTo(0.5, 4);
        expect(0.5 - back.y * 0.5).toBeCloseTo(0.95, 4);
        // Higher on the screen is farther down the pool; left of the screen is left in the cave.
        const farther = { ...world.screenToWater(0.5, 0.8, { x: 0, z: 0 }) };
        expect(farther.z).toBeLessThan(near.z);
        expect(world.screenToWater(0.2, 0.95, { x: 0, z: 0 }).x).toBeLessThan(near.x);
        // Above the horizon there is no water to meet: the point lands a few metres ahead.
        const sky = world.screenToWater(0.5, 0.1, { x: 0, z: 0 }, 9);
        expect(Math.hypot(sky.x - camera.position.x, sky.z - camera.position.z)).toBeCloseTo(9, 6);
        expect(sky.z).toBeLessThan(0);
        // A point `depth` along a pixel's ray is that far from the eye.
        const at = world.screenToWorld(0.3, 0.4, 5.5, [0, 0, 0]);
        expect(camera.position.distanceTo(new THREE.Vector3(...at))).toBeCloseTo(5.5, 6);
    });
});

describe('bioluminescence world: the lamps', () => {
    it('lights the grotto from finite, non-negative lamps through a whole session', () => {
        const made = makeWorld('High');
        const { world } = made;
        const lit = Math.min(EMITTER_MAX, world.plan.emitters.length);
        const check = (when) => {
            for (let k = 0; k < EMITTER_MAX; k++) {
                const position = world.u.lampRows[k * 2];
                const colour = world.u.lampRows[k * 2 + 1];
                for (const v of [...position.toArray(), ...colour.toArray()]) {
                    expect(Number.isFinite(v), `${when}: lamp ${k}`).toBe(true);
                }
                expect(position.w, `${when}: lamp ${k} radius`).toBeGreaterThan(0); // the shaders divide by it
                for (const channel of [colour.x, colour.y, colour.z]) {
                    expect(channel, `${when}: lamp ${k}`).toBeGreaterThanOrEqual(0);
                }
                if (k < lit) expect(Math.max(colour.x, colour.y, colour.z), `${when}: lamp ${k}`).toBeGreaterThan(0);
                else expect(colour.toArray(), `${when}: lamp ${k}`).toEqual([0, 0, 0, 0]);
            }
        };
        check('at rest');
        expect(world.u.lampRows).toHaveLength(EMITTER_MAX * 2);
        // Each lamp hangs where its cap or its crystals are drawn (in a wide frame: where planned).
        world.plan.emitters.forEach((lamp, k) => {
            const row = world.u.lampRows[k * 2];
            const rooted = lamp.kind === 'cap' ? world.mushrooms.list[lamp.source] : null;
            expect(row.x, `lamp ${k}`).toBeCloseTo(rooted ? lamp.x + world.shift(rooted) : lamp.x * world.squeeze, 9);
            expect(row.x, `lamp ${k}`).toBeCloseTo(lamp.x, 9);
            expect(row.y, `lamp ${k}`).toBe(lamp.y);
            expect(row.z, `lamp ${k}`).toBe(lamp.z);
        });
        // Through a session: after every beat of it.
        const { camera } = made;
        world.onLock({ u: 0.2, rows: [19], color: PINK, hardDrop: true });
        for (let i = 0; i < 12; i++) {
            run(made, 0.1);
            check(`lock +${i}`);
        }
        world.onCombo(4);
        world.onClear({ rows: [19, 18, 17, 16], lines: 4, perfect: true });
        for (let i = 0; i < 30; i++) {
            run(made, 0.1);
            check(`bloom +${i}`);
        }
        expect(camera).toBeTruthy();
    });

    it('lets a cap that blooms flare its own lamp, and dims every lamp while the grotto holds its breath', () => {
        const made = makeWorld('High');
        const { world } = made;
        const brightness = (k) => {
            const colour = world.u.lampRows[k * 2 + 1];
            return colour.x + colour.y + colour.z;
        };
        // A hero's lamp: find the row whose source is the mushroom we strike.
        const index = world.targets.left[0].index;
        const row = world.plan.emitters.findIndex((lamp) => lamp.kind === 'cap' && lamp.source === index);
        if (row >= 0) {
            const before = brightness(row);
            const bloom = world.mushrooms.strike(index, pieceColor(PINK), world.time, 1);
            run(made, bloom - world.time + 0.05, 8);
            expect(brightness(row)).toBeGreaterThan(before);
        }
        const fresh = makeWorld('High');
        const atRest = fresh.world.u.lampRows.map((r) => r.toArray());
        fresh.world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        run(fresh, HUSH_HOLD * 0.6, 6);
        // Mid-hush every lamp that has no bloom of its own is darker than it was at rest.
        for (let k = 1; k < fresh.world.u.lampCount; k++) {
            const now = fresh.world.u.lampRows[k * 2 + 1].toArray();
            const was = atRest[k * 2 + 1];
            expect(now[0] + now[1] + now[2], `lamp ${k}`).toBeLessThan((was[0] + was[1] + was[2]) * 0.8);
        }
    });
});

describe('bioluminescence world: a lock', () => {
    it('rings the water under the board, sends a swimmer and blooms a cap on that side in the piece\'s colour', () => {
        const made = makeWorld('High');
        const { world } = made;
        const strike = vi.spyOn(world.mushrooms, 'strike');
        const launch = vi.spyOn(world.runners, 'launch');
        const now = world.time;
        const card = cardUnion(world.layout);
        const rgb = pieceColor(PINK);
        world.onLock({ u: 0.2, rows: [18, 19], color: PINK });

        expect(world.counts).toMatchObject({ locks: 1, swimmers: 1, clears: 0 });
        // ── The dive: a ring born now, under the foot of the board, in the piece's colour ──
        const [dive] = ringsBornAt(world, now);
        expect(dive).toBeTruthy();
        expect(dive.place.y).toBeLessThan(0); // ahead of the viewer (the slot holds x, z)
        expect(dive.place.y).toBeGreaterThan(-40);
        const onScreen = new THREE.Vector3(dive.place.x, 0, dive.place.y).project(made.camera);
        expect(onScreen.x * 0.5 + 0.5).toBeGreaterThan(card.x0);
        expect(onScreen.x * 0.5 + 0.5).toBeLessThan(0.5); // the left of the board: where the piece locked
        expect(hue(dive.colour.toArray().slice(0, 3)).map((c) => +c.toFixed(6))).toEqual(rgb.map((c) => +c.toFixed(6)));

        // ── The swim: one swimmer leaves the dive for a mushroom on the left of the card ──
        expect(strike).toHaveBeenCalledOnce();
        expect(launch).toHaveBeenCalledOnce();
        const [index, struckRgb, arrive] = strike.mock.calls[0];
        const bloom = strike.mock.results[0].value;
        const target = world.mushrooms.list[index];
        expect(world.targets.left.map((t) => t.index)).toContain(index);
        expect(capScreenX(world, index)).toBeLessThan(card.x0);
        expect(struckRgb).toEqual(rgb);
        expect(arrive).toBeGreaterThan(now);
        expect(bloom).toBeCloseTo(arrive + STEM_CLIMB, 9);
        const flight = launch.mock.calls[0][0];
        expect(flight.time).toBe(now);
        expect(flight.time + flight.flight).toBeCloseTo(arrive, 9);
        expect(flight.from[0]).toBeCloseTo(dive.place.x, 9);
        expect(flight.from[1]).toBeCloseTo(dive.place.y, 9);
        expect(flight.to[0]).toBeCloseTo(world.drawnX(target), 9);
        expect(flight.to[1]).toBe(target.z);
        expect(flight.rgb).toEqual(rgb);
        // A second, smaller ring leaves the mushroom's foot when the swimmer gets there.
        const [foot] = ringsBornAt(world, arrive);
        expect(foot).toBeTruthy();
        expect(foot.place.x).toBeCloseTo(world.drawnX(target), 9);
        expect(foot.place.y).toBe(target.z);
        expect(foot.colour.w).toBeLessThan(dive.colour.w); // its reach

        // ── The bloom: nothing is held until the light has climbed the stem ──
        expect(world.mushrooms.heldAt(index, now)).toBe(0);
        expect(world.mushrooms.heldAt(index, arrive)).toBe(0);
        expect(world.mushrooms.heldAt(index, bloom - 1e-6)).toBe(0);
        expect(world.getState().held).toBe(0);
        expect(world.mushrooms.flashAt(index, bloom - 1e-6)).toEqual([0, 0, 0]);
        const held = world.mushrooms.heldAt(index, bloom + 1e-6);
        expect(held).toBeGreaterThan(0);
        expect(held).toBeLessThanOrEqual(STORE_MAX);
        // The cap keeps the piece's own colour, and flashes in it as it blooms.
        const kept = hue(world.mushrooms.heldColor(index, bloom + 1e-6));
        const flash = hue(world.mushrooms.flashAt(index, bloom + 1e-6));
        for (let c = 0; c < 3; c++) {
            expect(kept[c]).toBeCloseTo(rgb[c], 5);
            expect(flash[c]).toBeCloseTo(rgb[c], 5);
        }
        run(made, bloom - now + 0.1);
        expect(world.getState().held).toBeCloseTo(world.mushrooms.heldAt(index, world.time), 9);
        expect(world.getState().held).toBeGreaterThan(0);
        // It fades slowly: by 1/e over STORE_HOLD.
        expect(world.mushrooms.heldAt(index, bloom + STORE_HOLD) / world.mushrooms.heldAt(index, bloom)).toBeCloseTo(Math.exp(-1), 6);
        // The lock kicked the view and threw spores (the splash now, the cap's puff at its bloom).
        expect(world.spores.state.aBirth.filter((v, i) => i % 4 === 3 && v > -50).length).toBeGreaterThan(0);
    });

    it('feeds the other court from the other half of the board, and falls back when a court is empty', () => {
        const made = makeWorld('High');
        const { world } = made;
        const strike = vi.spyOn(world.mushrooms, 'strike');
        const card = cardUnion(world.layout);
        world.onLock({ u: 0.85, rows: [19], color: BLUE });
        const index = strike.mock.calls[0][0];
        expect(world.targets.right.map((t) => t.index)).toContain(index);
        expect(capScreenX(world, index)).toBeGreaterThan(card.x1);
        // The dive is under the right of the board.
        const [dive] = ringsBornAt(world, world.time);
        expect(new THREE.Vector3(dive.place.x, 0, dive.place.y).project(made.camera).x).toBeGreaterThan(0);
        // With nothing on one side a swimmer still finds a cap.
        world.targets.right = [];
        world.onLock({ u: 0.85, rows: [19], color: BLUE });
        expect(world.targets.left.map((t) => t.index)).toContain(strike.mock.calls[1][0]);
        // With nothing at all, the ring still goes out and nothing throws.
        world.targets.left = [];
        const swimmers = world.counts.swimmers;
        expect(() => world.onLock({ u: 0.3, rows: [19], color: BLUE })).not.toThrow();
        expect(world.counts.swimmers).toBe(swimmers);
        expect(world.counts.locks).toBe(3);
        world.findTargets();
    });

    it('never targets the elder, a sprout or a cap behind the card', () => {
        const { world } = makeWorld('High');
        const card = cardUnion(world.layout);
        const all = [...world.targets.left, ...world.targets.right];
        expect(new Set(all.map((t) => t.index)).size).toBe(all.length);
        for (const { index, weight } of all) {
            const m = world.mushrooms.list[index];
            expect(index).toBeGreaterThan(0);
            expect(m.kind).not.toBe('sprout');
            expect(weight).toBeGreaterThan(0);
            const sx = capScreenX(world, index);
            expect(sx < card.x0 || sx > card.x1, `mushroom ${index} at ${sx}`).toBe(true);
            // Nor a cap whose centre is at the very edge of the frame, or off it.
            expect(Math.abs(capNdcX(world, index)), `mushroom ${index}`).toBeLessThanOrEqual(0.95);
        }
        for (const { index } of world.targets.left) expect(capScreenX(world, index)).toBeLessThan(0.5);
        for (const { index } of world.targets.right) expect(capScreenX(world, index)).toBeGreaterThan(0.5);
        // The favourites come first.
        for (const side of [world.targets.left, world.targets.right]) {
            for (let i = 1; i < side.length; i++) expect(side[i].weight).toBeLessThanOrEqual(side[i - 1].weight);
        }
        expect(world.getState().favourite).toEqual({ left: world.targets.left[0].index, right: world.targets.right[0].index });
    });

    it('sends three swimmers for a hard drop and hits harder', () => {
        const soft = makeWorld('High');
        soft.world.onLock({ u: 0.2, rows: [19], color: AMBER });
        const softKick = soft.world.kick;
        const softRing = ringsBornAt(soft.world, soft.world.time)[0].place.w;
        const softSpores = soft.world.spores.state.aBirth.filter((v, i) => i % 4 === 3 && v > -50).length;

        const made = makeWorld('High');
        const { world } = made;
        const strike = vi.spyOn(world.mushrooms, 'strike');
        world.onLock({
            u: 0.2, rows: [19], color: AMBER, hardDrop: true,
        });
        expect(world.counts).toMatchObject({ locks: 1, swimmers: 3 });
        expect(strike).toHaveBeenCalledTimes(3);
        const [first, second, third] = strike.mock.calls;
        // The first is the lock's own; the others go to two more caps of that court and carry less.
        expect(new Set([first[0], second[0], third[0]]).size).toBe(3);
        for (const [index] of strike.mock.calls) expect(world.targets.left.map((t) => t.index)).toContain(index);
        expect(second[3]).toBeLessThan(first[3]);
        expect(third[3]).toBeLessThan(first[3]);
        // Each is told when it was sent: a cap can tell a swimmer on its way from one that arrived.
        for (const call of strike.mock.calls) expect(call[4]).toBe(world.time);
        expect(world.kick).toBeGreaterThan(softKick);
        expect(ringsBornAt(world, world.time)[0].place.w).toBeGreaterThan(softRing);
        expect(world.spores.state.aBirth.filter((v, i) => i % 4 === 3 && v > -50).length).toBeGreaterThan(softSpores);
        // The kick reaches the post and dies away.
        run(made, 1 / 60, 1);
        expect(world.getPostState().kick).toBeGreaterThan(0);
        run(made, 2);
        expect(world.getPostState().kick).toBeLessThan(0.01);
    });

    it('lets the newest colour win a cap, with what it already held adding to how much', () => {
        const made = makeWorld('High');
        const { world } = made;
        const index = world.targets.left[0].index;
        const pink = pieceColor(PINK);
        const blue = pieceColor(BLUE);
        const first = world.mushrooms.strike(index, pink, world.time, 0.85);
        run(made, first - world.time + 0.5);
        const alone = world.mushrooms.heldAt(index, world.time);
        expect(hue(world.mushrooms.heldColor(index, world.time))[0]).toBeCloseTo(pink[0], 5);

        const arrive = world.time + 0.4;
        const second = world.mushrooms.strike(index, blue, arrive, 0.85);
        // Until the second light has climbed the stem the cap still shows the first colour.
        const meanwhile = hue(world.mushrooms.heldColor(index, world.time));
        for (let c = 0; c < 3; c++) expect(meanwhile[c]).toBeCloseTo(pink[c], 5);
        expect(world.mushrooms.heldAt(index, second - 1e-6)).toBeLessThanOrEqual(alone);
        // Then it is the new colour, all of it: two pieces' colours are never summed.
        const after = hue(world.mushrooms.heldColor(index, second + 1e-6));
        for (let c = 0; c < 3; c++) expect(after[c]).toBeCloseTo(blue[c], 5);
        // And more of it than one lock alone leaves.
        expect(world.mushrooms.heldAt(index, second + 1e-6)).toBeGreaterThan(alone);
        // However often it is fed, a cap holds no more than STORE_MAX.
        for (let i = 0; i < 12; i++) world.mushrooms.strike(index, blue, second + 1 + i, 1.3);
        expect(world.mushrooms.heldAt(index, second + 14)).toBeLessThanOrEqual(STORE_MAX + 1e-9);
        // Only that cap holds anything.
        expect(world.mushrooms.totalHeld(second + 14)).toBeCloseTo(world.mushrooms.heldAt(index, second + 14), 9);
        // Out-of-range strikes are ignored.
        expect(() => world.mushrooms.strike(-1, blue, 1)).not.toThrow();
        expect(() => world.mushrooms.strike(world.mushrooms.count, blue, 1)).not.toThrow();
    });

    it('aims at where the click was when a lock has no board (the meditation mode)', () => {
        const made = makeWorld('High', { live: false });
        const { world } = made;
        const strike = vi.spyOn(world.mushrooms, 'strike');
        world.onLock({ screen: { x: 0.8, y: 0.9 }, color: null });
        const [dive] = ringsBornAt(world, world.time);
        const expected = { ...world.screenToWater(0.8, 0.9, { x: 0, z: 0 }) };
        expect(dive.place.x).toBeCloseTo(expected.x, 9);
        expect(dive.place.y).toBeCloseTo(expected.z, 9);
        expect(world.targets.right.map((t) => t.index)).toContain(strike.mock.calls[0][0]);
        // No colour of its own: the grotto's teal (whatever pieceColor falls back to).
        expect(strike.mock.calls[0][1]).toEqual(pieceColor(null));
    });

    it('recycles its ring slots without growing', () => {
        const made = makeWorld('Minimal');
        const { world } = made;
        for (let i = 0; i < LOCK_SLOTS * 3; i++) {
            world.onLock({ u: i % 2 ? 0.2 : 0.8, rows: [19], color: PINK });
            run(made, 0.2);
        }
        expect(world.u.lockA).toHaveLength(LOCK_SLOTS);
        expect(world.u.lockA.every((slot) => slot.value.z > START)).toBe(true);
        expect(world.u.ringsLive.value).toBe(1);
        // Long after the last lock the shaders are told there is nothing to draw.
        run(made, 12, 60);
        expect(world.u.ringsLive.value).toBe(0);
    });
});

describe('bioluminescence world: a clear', () => {
    it('rolls a wave out from under the board and lets go of everything the grotto holds', () => {
        const made = makeWorld('High');
        const { world } = made;
        // Fill a few caps on both sides.
        for (let i = 0; i < 6; i++) {
            world.onLock({ u: i % 2 ? 0.15 : 0.85, rows: [19], color: i % 2 ? PINK : BLUE });
            run(made, 1.6);
        }
        const holding = world.mushrooms.list.map((m, i) => i).filter((i) => world.mushrooms.heldAt(i, world.time) > 0);
        expect(holding.length).toBeGreaterThan(0);
        const before = world.getState().held;
        expect(before).toBeGreaterThan(0);
        const release = vi.spyOn(world.mushrooms, 'release');
        const now = world.time;
        world.onClear({ rows: [19], lines: 1 });

        expect(world.counts.clears).toBe(1);
        // ── One clear slot: born now, one front, no Great Bloom ──
        const slot = world.u.clearA.find((s) => s.value.x === now);
        expect(slot).toBeTruthy();
        expect(slot.value.y).toBe(1);
        expect(slot.value.z).toBeGreaterThan(0);
        expect(slot.value.w).toBe(0);
        expect(world.u.clearA).toHaveLength(CLEAR_SLOTS);
        // ── The wave's heart: on the water ahead, under the board ──
        const heart = world.u.heart.value;
        expect(heart.y).toBeLessThan(0);
        expect(heart.y).toBeGreaterThan(-40);
        const card = cardUnion(world.layout);
        const onScreen = new THREE.Vector3(heart.x, 0, heart.y).project(made.camera).x * 0.5 + 0.5;
        expect(onScreen).toBeGreaterThan(card.x0);
        expect(onScreen).toBeLessThan(card.x1);
        // ── Every mushroom answers as the wave passes it, the nearer the sooner ──
        const { released, passes } = release.mock.results[0].value;
        // All of it is let go (less the little each cap loses while the wave is on its way).
        expect(released).toBeLessThanOrEqual(before);
        expect(released).toBeGreaterThan(before * 0.9);
        expect(passes).toHaveLength(world.mushrooms.count);
        const distance = (i) => {
            const m = world.mushrooms.list[i];
            return Math.hypot(world.drawnX(m) - heart.x, m.z - heart.y);
        };
        for (let i = 0; i < world.mushrooms.count; i++) {
            expect(passes[i]).toBeGreaterThanOrEqual(now);
            expect(passes[i]).toBeLessThanOrEqual(now + CLEAR_TRAVEL + 1e-4);
        }
        const [a, b] = [holding[0], holding[holding.length - 1]];
        if (distance(a) + 1 < distance(b)) expect(passes[a]).toBeLessThan(passes[b]);
        // A cap holds its light until the front reaches it, flares, and then holds nothing.
        for (const i of holding) {
            expect(world.mushrooms.heldAt(i, passes[i] - 1e-3), `mushroom ${i}`).toBeGreaterThan(0);
            expect(world.mushrooms.heldAt(i, passes[i] + 1e-3), `mushroom ${i}`).toBe(0);
            expect(Math.max(...world.mushrooms.flashAt(i, passes[i] + 1e-3)), `mushroom ${i}`).toBeGreaterThan(0);
            expect(world.mushrooms.flashAt(i, passes[i] - 1e-3), `mushroom ${i}`).toEqual([0, 0, 0]);
        }
        run(made, CLEAR_TRAVEL + 0.2);
        expect(world.mushrooms.totalHeld(world.time)).toBe(0);
        expect(world.getState().held).toBe(0);
        // The clear stirred the grotto and the shaders were told a wave is live.
        expect(world.u.clearLive.value).toBe(1);
        expect(world.getState().storm).toBeGreaterThan(0);
        run(made, 12, 60);
        expect(world.u.clearLive.value).toBe(0);
        // A cap fed after the wave has gone holds its light again.
        const index = world.targets.left[0].index;
        const bloom = world.mushrooms.strike(index, pieceColor(AMBER), world.time, 1);
        expect(world.mushrooms.heldAt(index, bloom + 1)).toBeGreaterThan(0);
    });

    it('answers more lines with more fronts and a stronger wave, and fires the rows out of the card', () => {
        const waves = [1, 2, 3].map((lines) => {
            const made = makeWorld('High');
            const { world } = made;
            const now = world.time;
            const rows = [19, 18, 17].slice(0, lines);
            world.onClear({ rows, lines });
            const slot = world.u.clearA.find((s) => s.value.x === now).value;
            // The cleared rows leave the card as jets, at their own heights, from its edges.
            const jets = world.jets.uniforms;
            const card = cardUnion(world.layout);
            expect(jets.frame.value.x).toBeCloseTo(card.x0, 9);
            expect(jets.frame.value.y).toBeCloseTo(card.x1, 9);
            expect(jets.frame.value.z).toBe(now);
            expect(jets.frame.value.w).toBeGreaterThan(0);
            const ys = jets.rows.value.toArray();
            expect(ys.filter((y) => y >= 0)).toHaveLength(lines);
            for (let i = 1; i < lines; i++) expect(ys[i]).toBeLessThan(ys[i - 1]); // a higher row is higher on screen
            return {
                fronts: slot.y, strength: slot.z, jet: jets.frame.value.w, storm: world.storm,
            };
        });
        expect(waves.map((w) => w.fronts)).toEqual([1, 2, 3]);
        for (let i = 1; i < waves.length; i++) {
            expect(waves[i].strength).toBeGreaterThan(waves[i - 1].strength);
            expect(waves[i].jet).toBeGreaterThan(waves[i - 1].jet);
            expect(waves[i].storm).toBeGreaterThan(waves[i - 1].storm);
        }
        // Nonsense counts are clamped into one to four lines.
        const { world } = makeWorld('High');
        for (const [lines, fronts] of [[NaN, 1], [0, 1], [-3, 1], [2.4, 2], [99, 4]]) {
            world.seek(START);
            world.onClear({ lines });
            expect(world.u.clearA.find((s) => s.value.y === fronts && s.value.x >= START), `lines ${lines}`).toBeTruthy();
        }
    });

    it('keeps the row jets for a board that is on screen', () => {
        const away = makeWorld('High', { live: false }).world;
        away.onClear({ rows: [19], lines: 1 });
        expect(away.jets.uniforms.frame.value.w).toBe(0);
        expect(away.counts.clears).toBe(1);
        // A click's clear has no rows either: the wave starts where the click was.
        const click = makeWorld('High').world;
        click.onClear({ lines: 2, screen: { x: 0.25, y: 0.9 } });
        expect(click.jets.uniforms.frame.value.w).toBe(0);
        const expected = { ...click.screenToWater(0.25, 0.9, { x: 0, z: 0 }) };
        expect(click.u.heart.value.x).toBeCloseTo(expected.x, 9);
        expect(click.u.heart.value.y).toBeCloseTo(expected.z, 9);
    });

    it('turns the air and rings the crystals for a T-spin', () => {
        const made = makeWorld('High');
        const { world } = made;
        expect(world.u.swirl.value).toBe(0);
        const now = world.time;
        world.onClear({ rows: [19, 18], lines: 2, tspin: true });
        expect(world.crystals.uniforms.chime.value.x).toBe(now);
        expect(world.crystals.uniforms.chime.value.y).toBeGreaterThan(0);
        run(made, 1 / 60, 1);
        expect(world.u.swirl.value).toBeGreaterThan(0.5);
        run(made, 8);
        expect(world.u.swirl.value).toBeLessThan(0.01);
    });
});

describe('bioluminescence world: the Great Bloom', () => {
    it('holds its breath, then fires the elder, the shock and the surge', () => {
        const made = makeWorld('High');
        const { world } = made;
        const now = world.time;
        const atRest = { ...world.getPostState() };
        expect(world.u.breath.value).toBe(1);
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        const birth = now + HUSH_HOLD;

        expect(world.counts).toMatchObject({ clears: 1, blooms: 1 });
        // The wave, the shock and the elder's bloom all wait for the breath to be held.
        const slot = world.u.clearA.find((s) => s.value.y === 4).value;
        expect(slot.x).toBeCloseTo(birth, 9);
        expect(slot.w).toBe(1);
        expect(world.u.shock.value.x).toBeCloseTo(birth, 9);
        expect(world.u.shock.value.y).toBeGreaterThan(0);
        expect(world.mushrooms.flashAt(0, birth - 1e-3)).toEqual([0, 0, 0]);
        expect(Math.max(...world.mushrooms.flashAt(0, birth + 1e-3))).toBeGreaterThan(0);
        // The elder flashes; it is given nothing to hold.
        expect(world.mushrooms.heldAt(0, birth + 1)).toBe(0);
        // The crystals chime and every jelly flashes with it.
        expect(world.crystals.uniforms.chime.value.x).toBeCloseTo(birth, 9);
        expect(world.jellies.uniforms.flash.value.x).toBeCloseTo(birth, 9);

        // ── The hush: every light sinks, and the overdrive has not begun ──
        expect(world.surge).toBe(0);
        run(made, HUSH_HOLD * 0.75, 10);
        expect(world.time).toBeLessThan(birth);
        expect(world.u.breath.value).toBeLessThan(0.4);
        expect(world.surge).toBe(0);
        expect(world.u.surge.value).toBe(0);
        const hushed = { ...world.getPostState() };
        expect(hushed.shafts).toBeLessThan(atRest.shafts);
        // The post does not flare before the bloom does: nothing blooms into a held breath.
        expect(hushed.bloomBoost).toBeCloseTo(atRest.bloomBoost, 9);
        // ── Then everything at once ──
        run(made, HUSH_HOLD * 0.25 + 1 / 60, 6);
        expect(world.time).toBeGreaterThanOrEqual(birth);
        expect(world.surge).toBeGreaterThan(0.5); // from the first frame of the bloom
        run(made, 0.5, 30);
        expect(world.u.breath.value).toBeGreaterThan(0.8);
        expect(world.u.surge.value).toBeGreaterThan(0.5);
        const post = world.getPostState();
        expect(post.shafts).toBeGreaterThan(atRest.shafts);
        expect(post.bloomBoost).toBeGreaterThan(atRest.bloomBoost);
        expect(post.exposure).toBeLessThan(atRest.exposure); // the iris closes as the grotto flares
        expect(post.exposure).toBeLessThan(hushed.exposure); // and it closes for the bloom, not for the hush
        expect(post.exposure).toBeGreaterThan(0);
        // The surge cools by 1/e over SURGE_COOL.
        const hot = world.surge;
        run(made, SURGE_COOL);
        expect(world.surge / hot).toBeCloseTo(Math.exp(-1), 3);
        run(made, SURGE_COOL * 6, 200);
        expect(world.getPostState().exposure).toBeGreaterThan(0.95);
        expect(world.u.breath.value).toBeCloseTo(1, 3);
    });

    it('treats a perfect clear as a Great Bloom of four fronts, and a hotter one', () => {
        // (The overdrive starts with the bloom, after the hush: measure both a frame into it.)
        const intoBloom = HUSH_HOLD + 1 / 60;
        const quad = makeWorld('High');
        quad.world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        run(quad, intoBloom, 6);
        const quadSurge = quad.world.surge;
        expect(quadSurge).toBeGreaterThan(0);
        const made = makeWorld('High');
        const perfect = made.world;
        const now = perfect.time;
        perfect.onClear({ rows: [19], lines: 1, perfect: true });
        expect(perfect.counts.blooms).toBe(1);
        const slot = perfect.u.clearA.find((s) => s.value.x > now).value;
        expect(slot.x).toBeCloseTo(now + HUSH_HOLD, 9);
        expect(slot.y).toBe(4);
        expect(slot.w).toBe(1);
        expect(perfect.surge).toBe(0);
        run(made, intoBloom, 6);
        expect(perfect.surge).toBeGreaterThan(quadSurge);
        // Three lines are not one: no hush, no shock.
        const three = makeWorld('High').world;
        three.onClear({ rows: [19, 18, 17], lines: 3 });
        expect(three.counts.blooms).toBe(0);
        expect(three.hushUntil).toBeLessThan(three.time);
        expect(three.u.shock.value.y).toBe(0);
        expect(three.surge).toBe(0);
        // But the crystals ring for it.
        expect(three.crystals.uniforms.chime.value.x).toBeGreaterThanOrEqual(three.time);
    });
});

describe('bioluminescence world: a chain', () => {
    it('wakes the grotto: power, the glow-worms, the fairy rings and the jellies', () => {
        const made = makeWorld('High');
        const { world } = made;
        const atRest = world.getState();
        expect(atRest).toMatchObject({ power: 0, sprout: 0, combo: 0 });
        expect(atRest.jellies).toBe(jelliesForCombo(0, world.jellies.count));

        // One clear is not a chain: the grotto stirs, nothing sprouts, no jelly rises.
        world.onCombo(1);
        run(made, 3);
        expect(world.power).toBeGreaterThan(0);
        expect(world.power).toBeCloseTo(powerForCombo(1), 2);
        expect(world.u.sprout.value).toBe(0);
        expect(world.jellies.up).toBe(atRest.jellies);

        let power = world.power;
        let sprout = 0;
        let jellies = world.jellies.up;
        let wake = world.wake;
        for (const combo of [2, 3, 5, 8]) {
            world.onCombo(combo);
            expect(world.jellies.up).toBe(jelliesForCombo(combo, world.jellies.count));
            run(made, 3);
            expect(world.getState().combo).toBe(combo);
            expect(world.power, `combo ${combo}`).toBeGreaterThan(power);
            expect(world.power, `combo ${combo}`).toBeCloseTo(powerForCombo(combo), 2);
            expect(world.u.power.value).toBe(world.power);
            expect(world.u.sprout.value, `combo ${combo}`).toBeGreaterThan(sprout);
            expect(world.u.sprout.value, `combo ${combo}`).toBeLessThanOrEqual(1);
            expect(world.jellies.up, `combo ${combo}`).toBeGreaterThanOrEqual(jellies);
            expect(world.u.wake.value, `combo ${combo}`).toBeGreaterThan(wake);
            power = world.power;
            sprout = world.u.sprout.value;
            jellies = world.jellies.up;
            wake = world.wake;
        }
        expect(jellies).toBeGreaterThan(atRest.jellies);
        expect(world.getState().jellies).toBe(jellies);

        // The chain breaks: the grotto lets its breath go, the rings retreat, the jellies sink.
        world.onCombo(0);
        expect(world.jellies.up).toBe(atRest.jellies);
        run(made, 0.15);
        expect(world.u.breath.value).toBeLessThan(1);
        expect(world.u.sprout.value).toBeLessThan(sprout);
        expect(world.u.sprout.value).toBeGreaterThan(0); // they retreat, they do not vanish
        run(made, 12, 240);
        expect(world.u.breath.value).toBeCloseTo(1, 3);
        expect(world.u.sprout.value).toBe(0);
        expect(world.power).toBeLessThan(0.01);
        expect(world.wake).toBeLessThan(wake);
        // Nonsense is no chain.
        for (const nonsense of [NaN, -3, undefined, 'x']) {
            world.onCombo(nonsense);
            expect(world.getState().combo).toBe(0);
        }
    });

    it('raises and sinks jellies one after another, and counts the ones that are up', () => {
        const made = makeWorld('High');
        const { world } = made;
        const { jellies } = world;
        const life = jellies.geometry.getAttribute('aLife').array;
        const rise = (i) => life[i * 2];
        const sink = (i) => life[i * 2 + 1];
        const rest0 = jelliesForCombo(0, jellies.count);
        const now = world.time;
        // At rest the first few have always been up; the others have never risen.
        expect(jellies.up).toBe(rest0);
        for (let i = 0; i < jellies.count; i++) {
            if (i < rest0) expect(rise(i), `jelly ${i}`).toBeLessThan(now);
            else expect(rise(i), `jelly ${i}`).toBeGreaterThan(now + 1e6);
            expect(sink(i), `jelly ${i}`).toBeGreaterThan(now + 1e6);
        }
        // Raise three more: one after another, from now.
        jellies.setTarget(rest0 + 3, now);
        expect(jellies.up).toBe(rest0 + 3);
        for (let i = rest0; i < rest0 + 3; i++) {
            expect(rise(i), `jelly ${i}`).toBeGreaterThanOrEqual(now);
            expect(rise(i), `jelly ${i}`).toBeLessThan(now + 5);
            if (i > rest0) expect(rise(i), `jelly ${i}`).toBeGreaterThan(rise(i - 1));
            expect(sink(i), `jelly ${i}`).toBeGreaterThan(now + 1e6);
        }
        expect(rise(rest0 + 3)).toBeGreaterThan(now + 1e6);
        // Asking again changes nothing for the ones already on their way.
        const started = rise(rest0);
        run(made, 4);
        jellies.setTarget(rest0 + 3, world.time);
        expect(rise(rest0)).toBe(started);
        // Sink them: each is given a time to go under, from now; the ones at rest stay.
        const later = world.time;
        jellies.setTarget(rest0, later);
        expect(jellies.up).toBe(rest0);
        for (let i = 0; i < rest0; i++) expect(sink(i), `jelly ${i}`).toBeGreaterThan(later + 1e6);
        for (let i = rest0; i < rest0 + 3; i++) {
            expect(sink(i), `jelly ${i}`).toBeGreaterThanOrEqual(later);
            expect(sink(i), `jelly ${i}`).toBeLessThan(later + 5);
        }
        // The count is clamped to the pool.
        jellies.setTarget(999, later + 10);
        expect(jellies.up).toBe(jellies.count);
        jellies.setTarget(-5, later + 30);
        expect(jellies.up).toBe(0);
        for (let i = 0; i < jellies.count; i++) expect(sink(i), `jelly ${i}`).toBeLessThan(later + 60);
        // A flash is one uniform every jelly reads.
        jellies.flash(later + 31, 0.7);
        expect(jellies.uniforms.flash.value.toArray()).toEqual([later + 31, expect.closeTo(0.7, 6)]);
        expect(life.every(Number.isFinite)).toBe(true);
    });

    it('cycles the palettes with the level, easing unless told to snap', () => {
        const made = makeWorld('Medium');
        const { world } = made;
        const count = BIOLUM_PALETTES.length;
        expect(world.getState()).toMatchObject({ level: 1, palette: BIOLUM_PALETTES[0].name });
        const distance = (palette) => Math.hypot(...world.u.primary.value.toArray().map((v, c) => v - palette.primary[c]));
        expect(distance(BIOLUM_PALETTES[0])).toBeCloseTo(0, 6);

        world.levelUp(2);
        expect(world.getState()).toMatchObject({ level: 2, palette: BIOLUM_PALETTES[1].name });
        // The grotto answers a new level at once...
        expect(world.storm).toBeGreaterThan(0);
        expect(world.flash).toBeGreaterThan(0);
        // ...and changes colour over a few seconds.
        const away = distance(BIOLUM_PALETTES[1]);
        expect(away).toBeGreaterThan(0.01);
        run(made, 0.5);
        const nearer = distance(BIOLUM_PALETTES[1]);
        expect(nearer).toBeLessThan(away);
        expect(nearer).toBeGreaterThan(0);
        run(made, 12, 240);
        expect(distance(BIOLUM_PALETTES[1])).toBeLessThan(0.01);
        // Every palette key follows.
        expect(world.u.fogFar.value.toArray()[2]).toBeCloseTo(BIOLUM_PALETTES[1].fogFar[2], 2);

        // The palettes come round again.
        for (let level = 1; level <= count * 2 + 1; level++) {
            world.levelUp(level, { silent: true });
            expect(world.getState().palette, `level ${level}`).toBe(BIOLUM_PALETTES[(level - 1) % count].name);
        }
        // Silent: no flourish, and the colours are there on the next frame.
        const quiet = makeWorld('Medium');
        quiet.world.levelUp(3, { silent: true });
        expect(quiet.world.storm).toBe(0);
        run(quiet, 1 / 60, 1);
        expect(Math.hypot(...quiet.world.u.primary.value.toArray().map((v, c) => v - BIOLUM_PALETTES[2 % count].primary[c])))
            .toBeCloseTo(0, 6);
        // Nonsense is level one.
        quiet.world.levelUp(NaN);
        expect(quiet.world.getState().level).toBe(1);
    });
});

describe('bioluminescence world: clocks, replay and resets', () => {
    it('replays a session exactly: the same script twice, on the same world and on a new one', () => {
        const made = makeWorld('Medium');
        playScript(made);
        const first = record(made.world);
        playScript(made);
        const again = record(made.world);
        expect(again).toBe(first);
        // A world that has never played anything gets the same frame.
        const other = buildWorld('Medium');
        playScript(other);
        expect(record(other.world)).toBe(first);
        other.world.dispose();
        // And the session left its mark: this is not a record of nothing.
        expect(made.world.counts).toMatchObject({ locks: 4, clears: 4, blooms: 2 });
        expect(made.world.counts.swimmers).toBeGreaterThanOrEqual(4);
    });

    it('produces no NaN anywhere through a session on any tier', () => {
        for (const quality of ['Minimal', 'High', 'Extreme']) {
            const made = makeWorld(quality);
            expectAllFinite(made.world, `${quality} at rest`);
            playScript(made);
            expectAllFinite(made.world, `${quality} after a session`);
            // Mid-events as well: a frame inside the hush, a frame as the wave passes.
            made.world.onLock({
                u: 0.02, rows: [0], color: '#000000', hardDrop: true,
            });
            made.world.onClear({ rows: [0, 1, 2, 3], lines: 4, perfect: true });
            for (let i = 0; i < 20; i++) {
                run(made, 0.05, 1);
                expectAllFinite(made.world, `${quality} bloom frame ${i}`);
            }
            // A frame of no time at all (a frozen capture) and a stalled one.
            made.world.update({ time: made.world.time, delta: 0 });
            expectAllFinite(made.world, `${quality} frozen frame`);
            run(made, 5, 1);
            expectAllFinite(made.world, `${quality} after a stall`);
        }
    });

    it('drops every event on a seek and sets its slow clocks from the time alone', () => {
        const made = makeWorld('High');
        const { world } = made;
        playScript(made);
        world.seek(40);
        world.update({ time: 40, delta: 0 });
        expect(world.getState()).toMatchObject({
            time: 40,
            combo: 0,
            power: 0,
            surge: 0,
            storm: 0,
            sprout: 0,
            level: 1,
            held: 0,
            palette: BIOLUM_PALETTES[0].name,
            counts: {
                locks: 0, clears: 0, blooms: 0, swimmers: 0,
            },
        });
        expect(world.getState().jellies).toBe(jelliesForCombo(0, world.jellies.count));
        expect(world.u.lockA.every((slot) => slot.value.w === 0 && slot.value.z < 0)).toBe(true);
        expect(world.u.clearA.every((slot) => slot.value.z === 0 && slot.value.x < 0)).toBe(true);
        expect(world.u.shock.value.y).toBe(0);
        expect(world.u.breath.value).toBe(1);
        expect(world.u.ringsLive.value).toBe(0);
        expect(world.u.clearLive.value).toBe(0);
        expect(world.jets.uniforms.frame.value.w).toBe(0);
        expect(world.crystals.uniforms.chime.value.y).toBe(0);
        expect(world.spores.state.aBirth.filter((v, i) => i % 4 === 3).every((t) => t < 0)).toBe(true);
        const go = world.runners.geometry.getAttribute('aGo').array;
        expect(go.filter((v, i) => i % 4 === 0).every((t) => t < 0)).toBe(true);
        expect(world.getPostState()).toMatchObject({ flash: 0, kick: 0 });
        // The same instant is the same instant, whatever came before.
        const clocks = [world.pulse, world.moteLift];
        world.onCombo(6);
        run(made, 5);
        world.seek(40);
        expect([world.pulse, world.moteLift]).toEqual(clocks);
        world.seek(80);
        expect(world.pulse).toBeGreaterThan(clocks[0]);
        expect(world.moteLift).toBeGreaterThan(clocks[1]);
        world.seek(-5);
        expect(world.time).toBe(0);
    });

    it('starts a new run at rest but keeps its slow clocks turning', () => {
        const made = makeWorld('High');
        const { world } = made;
        world.onCombo(5);
        world.levelUp(3);
        world.onLock({ u: 0.3, rows: [19], color: PINK });
        run(made, 3);
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        run(made, 0.4);
        const { time, pulse, moteLift } = world;
        world.resetSession();
        // The clocks carry on from where they were: nothing jumps.
        expect(world.time).toBe(time);
        expect(world.pulse).toBe(pulse);
        expect(world.moteLift).toBe(moteLift);
        expect(world.getState()).toMatchObject({
            combo: 0,
            power: 0,
            surge: 0,
            sprout: 0,
            level: 1,
            held: 0,
            palette: BIOLUM_PALETTES[0].name,
            counts: {
                locks: 0, clears: 0, blooms: 0, swimmers: 0,
            },
        });
        expect(world.jellies.up).toBe(jelliesForCombo(0, world.jellies.count));
        expect(world.u.lockA.every((slot) => slot.value.w === 0)).toBe(true);
        expect(world.u.shock.value.y).toBe(0);
        run(made, 0.5);
        expect(world.pulse).toBeGreaterThan(pulse);
        expect(world.moteLift).toBeGreaterThan(moteLift);
        expect(world.u.breath.value).toBeCloseTo(1, 6);
        expectAllFinite(world, 'after a new run');
    });

    it('beats faster and lifts its motes faster the more awake it is', () => {
        const calm = makeWorld('High');
        run(calm, 2);
        const calmPulse = calm.world.pulse;
        const calmLift = calm.world.moteLift;
        const awake = makeWorld('High');
        // (The same world, back at rest: compare what two seconds of a chain do to it.)
        awake.world.onCombo(8);
        run(awake, 2);
        expect(awake.world.pulse).toBeGreaterThan(calmPulse);
        expect(awake.world.moteLift).toBeGreaterThan(calmLift);
        expect(awake.world.u.pulse.value).toBe(awake.world.pulse);
        expect(awake.world.u.moteLift.value).toBe(awake.world.moteLift);
    });

    it('stills the camera and softens the events for reduced motion', () => {
        const made = makeWorld('High');
        const { world, camera } = made;
        const index = world.targets.left[0].index;
        const from = { x: 0, z: -7 };
        const flight = world.sendSwimmer(index, from, [1, 1, 1], 0.85) - world.time;
        run(made, 3);
        const drifted = camera.position.clone();
        const lift = world.moteLift;
        world.onClear({ lines: 4 });
        const shock = world.u.shock.value.y;

        const still = makeWorld('High');
        still.world.setReducedMotion(true);
        expect(still.world.reducedMotion).toBe(true);
        const quick = still.world.sendSwimmer(index, from, [1, 1, 1], 0.85) - still.world.time;
        still.world.updateCamera(still.camera, { time: still.world.time, delta: 0, pointerX: 1, pointerY: -1 });
        expect(still.camera.position.toArray()).toEqual([0, REST_RIG.height, 0]);
        run(still, 3);
        // The camera stands where the rig puts it: no drift, no kick, no lean.
        expect(still.camera.position.toArray()).toEqual([0, REST_RIG.height, 0]);
        expect(drifted.toArray()).not.toEqual([0, REST_RIG.height, 0]);
        // The swimmer does not cross the water: the light is simply there.
        expect(quick).toBeLessThan(flight);
        expect(quick).toBeGreaterThan(0);
        // The air moves less, and the Great Bloom's shock is gentler.
        expect(still.world.moteLift).toBeLessThan(lift);
        still.world.onClear({ lines: 4 });
        expect(still.world.u.shock.value.y).toBeLessThan(shock);
        expect(still.world.u.shock.value.y).toBeGreaterThan(0);
        // Anything but true is off.
        still.world.setReducedMotion('yes');
        expect(still.world.reducedMotion).toBe(false);
    });
});

describe('bioluminescence world: an upright screen', () => {
    it('draws the two courts nearer the middle, and nothing else', () => {
        const wide = makeWorld('High').world;
        expect(wide.squeeze).toBe(1);
        expect(wide.u.squeeze.value).toBe(1);
        const made = makeWorld('High', { width: 430, height: 932 });
        const { world } = made;
        expect(world.squeeze).toBeLessThan(1);
        expect(world.squeeze).toBeGreaterThan(0);
        expect(world.u.squeeze.value).toBe(world.squeeze);
        expect(world.getState().squeeze).toBe(world.squeeze);
        // A square frame sits between the two.
        const square = makeWorld('High', { width: 900, height: 900 }).world;
        expect(square.squeeze).toBeGreaterThan(world.squeeze);
        expect(square.squeeze).toBeLessThanOrEqual(1);

        // The rule is the plan's: a court moves, in proportion to how far out it stands; nothing
        // else does. Where a mushroom happens to be rooted — in the water or on a bank — is not it.
        const { list } = world.mushrooms;
        const court = list.filter((m) => m.court);
        const others = list.filter((m) => !m.court);
        expect(court.length).toBeGreaterThan(0);
        expect(others.length).toBeGreaterThan(0);
        for (const m of court) {
            expect(world.drawnX(m), `${m.kind} at ${m.x},${m.z}`).toBeCloseTo(m.x * world.squeeze, 9);
            expect(world.shift(m)).toBeCloseTo(m.x * (world.squeeze - 1), 9);
            expect(Math.abs(world.drawnX(m))).toBeLessThanOrEqual(Math.abs(m.x));
            // In a wide frame it stands where the plan put it.
            expect(wide.drawnX(m)).toBe(m.x);
            expect(Math.abs(wide.shift(m))).toBe(0);
        }
        for (const m of others) {
            expect(world.drawnX(m), `${m.kind} at ${m.x},${m.z}`).toBe(m.x);
            expect(world.shift(m)).toBe(0);
        }
        // Both kinds of ground are in a court (rooted in the water and on a bank), and a bank
        // outside one stays put: the root's height decides nothing.
        expect(court.some((m) => m.y < -0.1)).toBe(true);
        expect(court.some((m) => m.y > 0.1)).toBe(true);
        expect(others.some((m) => m.y > 0.1)).toBe(true);
        expect(world.shift(null)).toBe(0);
        expect(list[0].court).toBeFalsy(); // the elder holds its island

        // The lamps move with what they light: a cap's with its mushroom, the crystals' always.
        world.plan.emitters.forEach((lamp, k) => {
            const row = world.u.lampRows[k * 2];
            if (lamp.kind === 'crystal') expect(row.x, `lamp ${k}`).toBeCloseTo(lamp.x * world.squeeze, 9);
            else {
                const m = list[lamp.source];
                expect(row.x - lamp.x, `lamp ${k}`).toBeCloseTo(world.drawnX(m) - m.x, 9);
            }
            expect(row.z, `lamp ${k}`).toBe(lamp.z);
        });
        // The frame is taller: the camera opens up to its widest.
        expect(made.camera.fov).toBeGreaterThan(makeWorld('High').camera.fov);
    });

    it('moves every mushroom of a court by the same factor as its hero, so no ring is torn from its cap', () => {
        const { world } = makeWorld('Extreme', { width: 430, height: 932 });
        const { list } = world.mushrooms;
        const heroes = list.filter((m) => m.kind === 'hero');
        expect(heroes.length).toBeGreaterThan(2);
        expect(heroes.every((m) => m.court)).toBe(true);
        const followers = list.filter((m) => m.court && m.kind !== 'hero');
        // The company at a hero's foot and the fairy ring round it.
        expect(followers.some((m) => m.kind === 'fill')).toBe(true);
        expect(followers.some((m) => m.kind === 'sprout')).toBe(true);
        for (const m of followers) {
            const label = `${m.kind} at ${m.x.toFixed(2)},${m.z.toFixed(2)}`;
            // It belongs to the hero it was planted beside...
            const hero = heroes.reduce((best, h) => (
                Math.hypot(h.x - m.x, h.z - m.z) < Math.hypot(best.x - m.x, best.z - m.z) ? h : best));
            const planned = Math.hypot(hero.x - m.x, hero.z - m.z);
            expect(planned, label).toBeLessThan(hero.capR * 1.3 + 1.5);
            // ...and is drawn beside it still: the same factor for both, so the gap between them
            // closes by that factor too and never opens.
            expect(world.drawnX(m) / m.x, label).toBeCloseTo(world.drawnX(hero) / hero.x, 9);
            expect(world.drawnX(m) - world.drawnX(hero), label).toBeCloseTo((m.x - hero.x) * world.squeeze, 9);
            const drawn = Math.hypot(world.drawnX(hero) - world.drawnX(m), hero.z - m.z);
            expect(drawn, label).toBeLessThanOrEqual(planned + 1e-9);
        }
        // The wave of a clear is timed to where each one is drawn, by the same rule.
        const release = vi.spyOn(world.mushrooms, 'release');
        world.onClear({ rows: [19], lines: 1 });
        const { passes } = release.mock.results[0].value;
        const heart = world.u.heart.value;
        const far = (m) => Math.hypot(world.drawnX(m) - heart.x, m.z - heart.y);
        const order = list.map((m, i) => i).sort((a, b) => far(list[a]) - far(list[b]));
        for (let k = 1; k < order.length; k++) {
            expect(passes[order[k]], `mushroom ${order[k]}`).toBeGreaterThanOrEqual(passes[order[k - 1]] - 1e-6);
        }
    });

    it('never aims a swimmer at a cap behind the card or at the edge of an upright frame', () => {
        for (const [width, height] of [[430, 932], [600, 900], [900, 900], [1600, 900], [2560, 1080]]) {
            const { world } = makeWorld('High', { width, height });
            const card = cardUnion(world.layout);
            const all = [...world.targets.left, ...world.targets.right];
            const frame = `${width}x${height}`;
            expect(all.length, frame).toBeGreaterThan(0);
            for (const { index } of all) {
                const ndc = capNdcX(world, index);
                expect(Math.abs(ndc), `${frame}: mushroom ${index}`).toBeLessThanOrEqual(0.95);
                const sx = ndc * 0.5 + 0.5;
                expect(sx < card.x0 || sx > card.x1, `${frame}: mushroom ${index} at ${sx}`).toBe(true);
            }
            for (const { index } of world.targets.left) expect(capNdcX(world, index), frame).toBeLessThan(0);
            for (const { index } of world.targets.right) expect(capNdcX(world, index), frame).toBeGreaterThan(0);
        }
        // An upright phone still has a court to feed on each side of the card.
        const { world } = makeWorld('High', { width: 430, height: 932 });
        expect(world.targets.left.length).toBeGreaterThan(0);
        expect(world.targets.right.length).toBeGreaterThan(0);
    });

    it('still feeds a cap that is in the frame, where it is drawn', () => {
        const made = makeWorld('High', { width: 430, height: 932 });
        const { world } = made;
        const all = [...world.targets.left, ...world.targets.right];
        expect(all.length).toBeGreaterThan(0);
        const card = cardUnion(world.layout);
        for (const { index } of all) {
            const sx = capScreenX(world, index);
            expect(sx < card.x0 || sx > card.x1, `mushroom ${index} at ${sx}`).toBe(true);
            expect(sx).toBeGreaterThan(0);
            expect(sx).toBeLessThan(1);
        }
        const strike = vi.spyOn(world.mushrooms, 'strike');
        const launch = vi.spyOn(world.runners, 'launch');
        world.onLock({ u: 0.2, rows: [19], color: PINK });
        expect(strike).toHaveBeenCalledOnce();
        const target = world.mushrooms.list[strike.mock.calls[0][0]];
        // The swimmer goes to where the mushroom is drawn, not to where the plan has it.
        expect(launch.mock.calls[0][0].to[0]).toBeCloseTo(world.drawnX(target), 9);
        if (target.court) expect(world.drawnX(target)).not.toBe(target.x);
        // So does the ring it leaves at the mushroom's foot.
        const foot = world.u.lockA.find((slot) => slot.value.z > world.time && slot.value.w > 0);
        expect(foot.value.x).toBeCloseTo(world.drawnX(target), 9);
        // And a clear's wave reaches each mushroom where it is drawn.
        const release = vi.spyOn(world.mushrooms, 'release');
        world.onClear({ rows: [19], lines: 1 });
        expect(release.mock.calls[0][5]).toEqual({ squeeze: world.squeeze });
        expectAllFinite(world, 'upright');
        // Turning the screen back composes the landscape picture again.
        world.setViewport(1600, 900, 1600 / 900);
        expect(world.squeeze).toBe(1);
        expect(world.u.squeeze.value).toBe(1);
        world.setViewport(430, 932, 430 / 932);
    });
});

describe('bioluminescence world: faults that stay fixed', () => {
    it('fits its worst frame into the spore pool on every tier', () => {
        // The ring that recycles the pool overwrites the oldest spores first: a frame that asks
        // for more than the pool loses the first of them before they are born.
        for (const quality of QUALITY_NAMES) {
            const made = makeWorld(quality);
            const { world } = made;
            const caps = [...world.targets.left, ...world.targets.right].map((t) => t.index);
            expect(caps.length, quality).toBeGreaterThan(3);
            let worst = 0;
            // However many caps are holding colour when the clear comes (rounding makes the
            // total wander with the count, so every count is tried).
            for (let holding = 0; holding <= Math.min(caps.length, 16); holding++) {
                rest(made);
                for (let k = 0; k < holding; k++) world.mushrooms.strike(caps[k], pieceColor(PINK), world.time, 1, world.time);
                run(made, 1);
                expect(world.mushrooms.list.filter((m, i) => world.mushrooms.heldAt(i, world.time) > 0)).toHaveLength(holding);
                // A hard drop that clears four lines and leaves the board empty, in one flush.
                const thrown = sporesThrown(world, () => {
                    world.onLock({
                        u: 0.1, rows: [16, 17, 18, 19], color: BLUE, hardDrop: true,
                    });
                    world.onClear({ rows: [19, 18, 17, 16], lines: 4, perfect: true });
                });
                expect(thrown, `${quality} with ${holding} caps holding`).toBeLessThanOrEqual(world.spores.count);
                worst = Math.max(worst, thrown);
                // Three lines throw no more than four.
                rest(made);
                for (let k = 0; k < holding; k++) world.mushrooms.strike(caps[k], pieceColor(PINK), world.time, 1, world.time);
                run(made, 1);
                const lesser = sporesThrown(world, () => {
                    world.onLock({
                        u: 0.9, rows: [17, 18, 19], color: BLUE, hardDrop: true,
                    });
                    world.onClear({ rows: [19, 18, 17], lines: 3, tspin: true });
                });
                expect(lesser, `${quality}: three lines with ${holding} caps holding`).toBeLessThanOrEqual(world.spores.count);
            }
            // The frame that was measured is the real thing: most of a pool, not a trickle.
            expect(worst, quality).toBeGreaterThan(world.spores.count * 0.5);
        }
    });

    it('blooms the cap of the very lock that cleared the line, and lets it keep its colour', () => {
        const made = makeWorld('High');
        const { world } = made;
        const { mushrooms } = world;
        const strike = vi.spyOn(mushrooms, 'strike');
        const release = vi.spyOn(mushrooms, 'release');
        const now = world.time;
        const rgb = pieceColor(PINK);
        // What one flush of the director sends for a lock that completes a line.
        world.onLock({ u: 0.2, rows: [19], color: PINK });
        world.onClear({ rows: [19], lines: 1 });
        const [index, , arrive] = strike.mock.calls[0];
        const bloom = strike.mock.results[0].value;
        const pass = release.mock.results[0].value.passes[index];
        expect(arrive).toBeGreaterThan(now);
        // Nothing of the piece's colour shows before its swimmer has climbed the stem — not when
        // the clear is called, and not as the wave goes by.
        for (const t of [now, (now + arrive) / 2, arrive, bloom - 1e-4]) {
            expect(mushrooms.heldAt(index, t), `held at +${t - now}`).toBe(0);
            expect(mushrooms.flashAt(index, t), `flash at +${t - now}`).toEqual([0, 0, 0]);
        }
        // Then the cap blooms, in the piece's colour, and holds it.
        const flash = mushrooms.flashAt(index, bloom + 1e-4);
        expect(Math.max(...flash)).toBeGreaterThan(0);
        hue(flash).forEach((c, k) => expect(c).toBeCloseTo(rgb[k], 5));
        expect(mushrooms.heldAt(index, bloom + 1e-4)).toBeGreaterThan(0);
        hue(mushrooms.heldColor(index, bloom + 1e-4)).forEach((c, k) => expect(c).toBeCloseTo(rgb[k], 5));
        if (pass < bloom) {
            // The wave had gone by before the swimmer arrived: there was nothing of this piece
            // for it to take, so the colour stays long after the wave has crossed the grotto.
            expect(mushrooms.heldAt(index, now + CLEAR_TRAVEL + 2)).toBeGreaterThan(0);
            run(made, CLEAR_TRAVEL + 2);
            expect(world.getState().held).toBeGreaterThan(0);
            hue(mushrooms.heldColor(index, world.time)).forEach((c, k) => expect(c).toBeCloseTo(rgb[k], 5));
        }

        // The same, set up by hand so no tuning can change which comes first: one cap already
        // holding, one whose swimmer is due well after the wave has left the grotto.
        rest(made);
        const [holder, late] = [world.targets.left[0].index, world.targets.right[0].index];
        const start = world.time;
        mushrooms.strike(holder, pieceColor(BLUE), start, 1, start);
        run(made, 1);
        const clearAt = world.time;
        const due = clearAt + CLEAR_TRAVEL + 1;
        const lateBloom = mushrooms.strike(late, rgb, due, 1, clearAt);
        const result = mushrooms.release(clearAt, 0, -8, [1, 1, 1], 1);
        const holderPass = result.passes[holder];
        const latePass = result.passes[late];
        expect(latePass).toBeLessThan(due);
        // The holder gives up what it held as the wave passes, with a flare.
        expect(result.released).toBeGreaterThan(0);
        expect(mushrooms.heldAt(holder, holderPass - 1e-3)).toBeGreaterThan(0);
        expect(mushrooms.heldAt(holder, holderPass + 1e-3)).toBe(0);
        expect(Math.max(...mushrooms.flashAt(holder, holderPass + 1e-3))).toBeGreaterThan(0);
        // The late cap had nothing yet: the wave takes nothing from it and fires nothing in it...
        expect(mushrooms.flashAt(late, latePass + 1e-3)).toEqual([0, 0, 0]);
        expect(mushrooms.heldAt(late, latePass + 1e-3)).toBe(0);
        // ...and its own bloom comes when its swimmer does, and stays.
        expect(Math.max(...mushrooms.flashAt(late, lateBloom + 1e-3))).toBeGreaterThan(0);
        expect(mushrooms.heldAt(late, lateBloom + 1e-3)).toBeGreaterThan(0);
        expect(mushrooms.heldAt(late, lateBloom + 10)).toBeGreaterThan(0);
        // A later clear takes it like any other.
        const again = mushrooms.release(lateBloom + 11, 0, -8, [1, 1, 1], 1);
        expect(mushrooms.heldAt(late, again.passes[late] + 1e-3)).toBe(0);
    });

    it('shows nothing of a swimmer still on its way when a second one is sent to the same cap', () => {
        const from = { x: -1, z: -7 };
        const pink = pieceColor(PINK);
        const blue = pieceColor(BLUE);
        // One lock alone, for comparison.
        const single = makeWorld('High');
        const index = single.world.targets.left[0].index;
        const soloArrive = single.world.sendSwimmer(index, from, blue, 0.85);
        const alone = single.world.mushrooms.heldAt(index, soloArrive + STEM_CLIMB + 1e-4);
        expect(alone).toBeGreaterThan(0);

        const made = makeWorld('High');
        const { world } = made;
        const { mushrooms } = world;
        const first = world.sendSwimmer(index, from, pink, 0.85);
        run(made, (first - world.time) * 0.25);
        expect(world.time).toBeLessThan(first);
        const second = world.sendSwimmer(index, from, blue, 0.85);
        expect(second).toBeGreaterThan(first);
        const bloom = second + STEM_CLIMB;
        // The cap held nothing, and shows nothing: not now, not when the first swimmer is due,
        // not until the second has climbed the stem.
        for (const t of [world.time, first - 1e-4, first + STEM_CLIMB + 1e-4, second, bloom - 1e-4]) {
            expect(mushrooms.heldAt(index, t), `at +${t - world.time}`).toBe(0);
            expect(mushrooms.heldColor(index, t), `at +${t - world.time}`).toEqual([0, 0, 0]);
        }
        run(made, 0.05);
        expect(world.getState().held).toBe(0);
        // Then it holds the newest colour, and both pieces' worth of it.
        hue(mushrooms.heldColor(index, bloom + 1e-4)).forEach((c, k) => expect(c).toBeCloseTo(blue[k], 5));
        expect(mushrooms.heldAt(index, bloom + 1e-4)).toBeGreaterThan(alone);
        expect(mushrooms.heldAt(index, bloom + 1e-4)).toBeLessThanOrEqual(STORE_MAX);

        // A cap that was already holding goes on showing exactly that, undisturbed, until then.
        rest(made);
        const amber = pieceColor(AMBER);
        const held0 = mushrooms.strike(index, amber, world.time, 1, world.time);
        run(made, held0 - world.time + 1);
        const a = world.sendSwimmer(index, from, pink, 0.85);
        run(made, (a - world.time) * 0.25);
        const before = mushrooms.heldAt(index, world.time);
        const b = world.sendSwimmer(index, from, blue, 0.85);
        expect(mushrooms.heldAt(index, world.time)).toBeCloseTo(before, 6);
        for (const t of [world.time, a + STEM_CLIMB + 1e-4, b + STEM_CLIMB - 1e-4]) {
            hue(mushrooms.heldColor(index, t)).forEach((c, k) => expect(c, `at +${t - world.time}`).toBeCloseTo(amber[k], 5));
            expect(mushrooms.heldAt(index, t)).toBeLessThanOrEqual(before + 1e-6);
            expect(mushrooms.heldAt(index, t)).toBeGreaterThan(before * 0.9);
        }
        hue(mushrooms.heldColor(index, b + STEM_CLIMB + 1e-4)).forEach((c, k) => expect(c).toBeCloseTo(blue[k], 5));
    });

    it('sends a hard drop\'s swimmers to different caps, as many as there are', () => {
        const { world } = makeWorld('High');
        const strike = vi.spyOn(world.mushrooms, 'strike');
        // The pick is seeded by the lock count: try a run of them, on both sides.
        for (let lock = 0; lock < 24; lock++) {
            strike.mockClear();
            const side = lock % 2 ? world.targets.right : world.targets.left;
            world.onLock({
                u: lock % 2 ? 0.8 : 0.2, rows: [19], color: AMBER, hardDrop: true,
            });
            const struck = strike.mock.calls.map(([index]) => index);
            expect(struck, `lock ${lock}`).toHaveLength(3);
            expect(new Set(struck).size, `lock ${lock}: ${struck}`).toBe(3);
            for (const index of struck) expect(side.map((t) => t.index), `lock ${lock}`).toContain(index);
        }
        // A court with two caps gets two swimmers, one with one gets one: never two to one cap.
        const whole = world.targets.left;
        for (const caps of [2, 1]) {
            world.targets.left = whole.slice(0, caps);
            for (let lock = 0; lock < 6; lock++) {
                strike.mockClear();
                world.onLock({
                    u: 0.2, rows: [19], color: AMBER, hardDrop: true,
                });
                const struck = strike.mock.calls.map(([index]) => index);
                expect(struck, `${caps} caps`).toHaveLength(caps);
                expect(new Set(struck).size, `${caps} caps`).toBe(caps);
            }
        }
        world.findTargets();
    });

    it('keeps each clear\'s wave centred where it began when another starts somewhere else', () => {
        const made = makeWorld('High', { live: false });
        const { world } = made;
        expect(world.u.clearH).toHaveLength(CLEAR_SLOTS);
        const slotBornAt = (time) => world.u.clearA.findIndex((slot) => slot.value.x === time);
        // Two clicks of the meditation mode, at two ends of the screen, a moment apart.
        const firstAt = world.time;
        world.onClear({ lines: 1, screen: { x: 0.15, y: 0.9 } });
        const first = slotBornAt(firstAt);
        const firstOrigin = world.u.clearH[first].value.toArray();
        const firstHere = { ...world.screenToWater(0.15, 0.9, { x: 0, z: 0 }) };
        expect(firstOrigin[0]).toBeCloseTo(firstHere.x, 9);
        expect(firstOrigin[1]).toBeCloseTo(firstHere.z, 9);
        run(made, 0.3);
        const secondAt = world.time;
        world.onClear({ lines: 2, screen: { x: 0.85, y: 0.8 } });
        const second = slotBornAt(secondAt);
        expect(second).not.toBe(first);
        const secondHere = { ...world.screenToWater(0.85, 0.8, { x: 0, z: 0 }) };
        expect(world.u.clearH[second].value.x).toBeCloseTo(secondHere.x, 9);
        expect(world.u.clearH[second].value.y).toBeCloseTo(secondHere.z, 9);
        // The first wave is still rolling, from where it started.
        expect(world.u.clearA[first].value.x).toBe(firstAt);
        expect(world.u.clearH[first].value.toArray()).toEqual(firstOrigin);
        expect(Math.hypot(firstOrigin[0] - secondHere.x, firstOrigin[1] - secondHere.z)).toBeGreaterThan(1);
        // `heart` names the latest one only.
        expect(world.u.heart.value.toArray()).toEqual(world.u.clearH[second].value.toArray());
        // A third recycles the oldest slot, origin and all.
        run(made, 0.3);
        world.onClear({ lines: 1, screen: { x: 0.5, y: 0.95 } });
        expect(slotBornAt(world.time)).toBe(first);
        expect(world.u.clearH[first].value.toArray()).not.toEqual(firstOrigin);
        expect(world.u.clearH[second].value.x).toBeCloseTo(secondHere.x, 9);
        // Two boards clearing in the same frame keep an origin each.
        const boards = makeWorld('High');
        boards.world.onClear({ rows: [19], lines: 1, screen: { x: 0.3, y: 0.9 } });
        boards.world.onClear({ rows: [19], lines: 1, screen: { x: 0.7, y: 0.9 } });
        const [a, b] = boards.world.u.clearH.map((slot) => slot.value.x);
        expect(a).not.toBeCloseTo(b, 1);
    });

    it('starts the overdrive when the elder blooms, on whatever frame that is', () => {
        const made = makeWorld('High');
        const { world } = made;
        const now = world.time;
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        // A capture frozen inside the hush sees no overdrive; frozen just after it, all of it.
        world.update({ time: now + HUSH_HOLD * 0.5, delta: 0 });
        expect(world.getState().surge).toBe(0);
        expect(world.u.surge.value).toBe(0);
        world.update({ time: now + HUSH_HOLD, delta: 0 });
        const full = world.getState().surge;
        expect(full).toBeGreaterThan(0);
        expect(world.u.surge.value).toBe(full);
        // It is applied once: the next frames only cool it.
        world.update({ time: now + HUSH_HOLD + 0.1, delta: 0.1 });
        expect(world.surge).toBeLessThan(full);
        expect(world.surge).toBeGreaterThan(full * 0.9);
        // A new run during the hush calls it off.
        rest(made);
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        world.resetSession();
        run(made, HUSH_HOLD * 3);
        expect(world.surge).toBe(0);
    });

    it('turns a sinking jelly round where it is, and calls off a sink that had not begun', () => {
        const made = makeWorld('High');
        const { world } = made;
        const { jellies } = world;
        const life = jellies.geometry.getAttribute('aLife').array;
        const rise = (i) => life[i * 2];
        const sink = (i) => life[i * 2 + 1];
        const never = (t) => t > world.time + 1e6;
        const base = jelliesForCombo(0, jellies.count);
        expect(jellies.count).toBeGreaterThanOrEqual(base + 3);
        jellies.setTarget(base + 3, world.time);
        run(made, 8); // all of them up
        const [a, b, c] = [base, base + 1, base + 2];
        const risen = [rise(a), rise(b), rise(c)];

        // The chain breaks: they are told to sink, one after another.
        const broke = world.time;
        jellies.setTarget(base, broke);
        expect(sink(a)).toBeGreaterThan(broke - 1e-3);
        expect(sink(a)).toBeLessThan(broke + 5);
        expect(sink(c)).toBeGreaterThan(sink(a));
        // A new chain before the last of them has started down.
        const back = (sink(a) + sink(c)) / 2;
        expect(back).toBeGreaterThan(sink(a));
        expect(back).toBeLessThan(sink(c));
        jellies.setTarget(base + 3, back);
        expect(jellies.up).toBe(base + 3);
        // The last had not begun to sink: it never does, and is left exactly where it was.
        expect(never(sink(c))).toBe(true);
        expect(rise(c)).toBe(risen[2]);
        // The first was on its way down: it does not vanish and start over from the pool with a
        // delay — it is already rising at `back`, most of the way up.
        expect(never(sink(a))).toBe(true);
        expect(rise(a)).toBeLessThan(back);
        // The further gone, the further it has to climb back.
        const lateBack = makeWorld('High');
        const j = lateBack.world.jellies;
        const l = j.geometry.getAttribute('aLife').array;
        j.setTarget(base + 3, lateBack.world.time);
        run(lateBack, 8);
        const t0 = lateBack.world.time;
        j.setTarget(base, t0);
        const started = l[a * 2 + 1];
        const caughtEarly = started + 0.2;
        j.setTarget(base + 1, caughtEarly);
        const early = caughtEarly - l[a * 2]; // how long it has "been rising" already
        j.setTarget(base, caughtEarly + 5);
        run(lateBack, 6);
        const again = l[a * 2 + 1];
        const caughtLate = again + 0.9;
        j.setTarget(base + 1, caughtLate);
        const late = caughtLate - l[a * 2];
        expect(early).toBeGreaterThan(0);
        expect(late).toBeGreaterThan(0);
        expect(late).toBeLessThan(early);
        // Once wholly gone it starts from the water again, no earlier than it is asked to.
        j.setTarget(base, caughtLate + 5);
        const gone = l[a * 2 + 1];
        j.setTarget(base + 1, gone + 60);
        expect(l[a * 2]).toBeGreaterThan(gone + 60 - 1e-3);
        expect(l.every(Number.isFinite)).toBe(true);
    });

    it('keeps every uniform finite whatever nonsense a lock or a clear is handed', () => {
        const made = makeWorld('High');
        const { world } = made;
        const nonsense = [NaN, Infinity, -Infinity, undefined, null, 'x', {}];
        for (const bad of nonsense) {
            const what = `after ${String(bad)}`;
            expect(() => {
                world.onLock({
                    u: bad, rows: [19], color: bad, screen: { x: bad, y: bad },
                });
                world.onLock({
                    u: bad, rows: [19], color: PINK, hardDrop: true,
                });
                world.onLock({ screen: { x: 0.3, y: bad } });
                world.onClear({ lines: bad, rows: [19], screen: { x: bad, y: 0.9 } });
                world.onClear({ lines: 4, perfect: true, screen: { x: 0.5, y: bad } });
                world.onClear({ lines: bad, rows: [19, 18], tspin: true });
                world.onCombo(bad);
            }, what).not.toThrow();
            expectAllFinite(world, what);
            run(made, 0.4, 8);
            expectAllFinite(world, `${what}, frames later`);
        }
        // The events still happened: a lock with no usable column is a lock in the middle.
        expect(world.counts.locks).toBe(nonsense.length * 3);
        expect(world.counts.clears).toBe(nonsense.length * 3);
        expect(world.counts.swimmers).toBeGreaterThan(nonsense.length * 3);
        // And the grotto comes back to rest: nothing was poisoned for good.
        run(made, 60, 300);
        expect(world.getPostState().exposure).toBeGreaterThan(0.9);
        expect(world.getState().storm).toBeLessThan(0.01);
        world.u.lampRows.forEach((row) => row.toArray().forEach((v) => expect(Number.isFinite(v)).toBe(true)));
    });

    it('eases back to the first level\'s colours on a new run, and snaps only on a seek', () => {
        const made = makeWorld('Medium');
        const { world } = made;
        const [first, , third] = BIOLUM_PALETTES;
        const to = (palette) => Math.hypot(...world.u.primary.value.toArray().map((v, c) => v - palette.primary[c]));
        world.levelUp(3, { silent: true });
        run(made, 1 / 60, 1);
        expect(to(third)).toBeCloseTo(0, 6);
        const apart = to(first);
        expect(apart).toBeGreaterThan(0.1);

        world.resetSession();
        // The run is new: the level and the palette it is heading for are the first again...
        expect(world.getState()).toMatchObject({ level: 1, palette: first.name });
        // ...but the grotto does not change colour in one frame.
        run(made, 1 / 60, 1);
        expect(to(third)).toBeLessThan(apart * 0.1);
        expect(to(first)).toBeGreaterThan(apart * 0.9);
        // It gets there over a few seconds, steadily.
        let previous = to(first);
        for (let i = 0; i < 6; i++) {
            run(made, 0.5);
            expect(to(first)).toBeLessThan(previous);
            previous = to(first);
        }
        run(made, 12, 240);
        expect(to(first)).toBeLessThan(0.01);

        // A seek is a capture's jump of the clock: there the colours are simply the first level's.
        world.levelUp(3, { silent: true });
        run(made, 1 / 60, 1);
        world.seek(world.time);
        world.update({ time: world.time, delta: 0 });
        expect(to(first)).toBeCloseTo(0, 6);
    });
});

describe('bioluminescence world: the pools', () => {
    it('throws spores from a pool that caps at its size and wraps', () => {
        const { world } = makeWorld('Minimal');
        const { spores } = world;
        const births = () => Array.from(spores.state.aBirth).filter((v, i) => i % 4 === 3);
        expect(births().every((t) => t < 0)).toBe(true); // all dormant after a seek
        const base = {
            x: 1, y: 2, z: -6, rgb: [1, 0.5, 0.25],
        };
        // A burst lands in the first free slots, at its own time.
        expect(spores.emit({ ...base, n: 5, time: 20 })).toBe(5);
        expect(births().filter((t) => t === 20)).toHaveLength(5);
        expect(births().slice(0, 5).every((t) => t === 20)).toBe(true);
        // Around the point it was thrown from, tinted with the colour it was given.
        for (let i = 0; i < 5; i++) {
            expect(spores.state.aBirth[i * 4 + 1]).toBe(2);
            expect(spores.state.aVel[i * 4 + 3]).toBeGreaterThan(0); // a life to live
            const tint = Array.from(spores.state.aTint.slice(i * 4, i * 4 + 3));
            expect(tint[0]).toBeGreaterThan(tint[1]);
            expect(tint[1]).toBeGreaterThan(tint[2]);
            expect(spores.state.aTint[i * 4 + 3]).toBeGreaterThan(0); // a size
        }
        // More than the pool holds is the pool, once round.
        expect(spores.emit({ ...base, n: spores.count + 50, time: 30 })).toBe(spores.count);
        expect(births().every((t) => t === 30)).toBe(true);
        // The next burst wraps over the oldest.
        const cursor = (5 + spores.count) % spores.count;
        expect(spores.emit({ ...base, n: 3, time: 40 })).toBe(3);
        const now = births();
        expect(now.filter((t) => t === 40)).toHaveLength(3);
        for (let k = 0; k < 3; k++) expect(now[(cursor + k) % spores.count]).toBe(40);
        expect(now.filter((t) => t === 30)).toHaveLength(spores.count - 3);
        // Nothing asked for is nothing thrown.
        expect(spores.emit({ ...base, n: 0, time: 50 })).toBe(0);
        expect(spores.emit({ ...base, n: -4, time: 50 })).toBe(0);
        expect(births().filter((t) => t === 50)).toHaveLength(0);
        // A stagger spreads the births after the time given, never before it.
        spores.reset();
        expect(births().every((t) => t < 0)).toBe(true);
        spores.emit({
            ...base, n: 20, time: 60, stagger: 0.5,
        });
        const spread = births().filter((t) => t > 0);
        expect(spread).toHaveLength(20);
        expect(Math.min(...spread)).toBeGreaterThanOrEqual(60);
        expect(Math.max(...spread)).toBeLessThanOrEqual(60.5 + 1e-4);
        expect(new Set(spread).size).toBeGreaterThan(1);
        // The same burst after a reset is the same burst.
        const once = Array.from(spores.state.aBirth);
        spores.reset();
        spores.emit({
            ...base, n: 20, time: 60, stagger: 0.5,
        });
        expect(Array.from(spores.state.aBirth)).toEqual(once);
    });

    it('lets a spore drift up or fall as its gravity says, never under the water', () => {
        // Floating: no speed of its own, negative gravity → it rises.
        expect(sporeHeight(1, 0, 2, -0.2)).toBeGreaterThan(sporeHeight(1, 0, 1, -0.2));
        // Falling: it comes down and stops at the water.
        expect(sporeHeight(1, 0, 1, 4)).toBeLessThan(1);
        expect(sporeHeight(1, 0, 60, 4)).toBeGreaterThan(0);
        expect(sporeHeight(1, 0, 60, 4)).toBe(sporeHeight(1, 0, 90, 4));
        // The damp air takes its first speed: thrown up, it does not keep climbing at that rate.
        const thrown = sporeHeight(0, 3, 1, 0) - sporeHeight(0, 3, 0, 0);
        expect(thrown).toBeGreaterThan(0);
        expect(thrown).toBeLessThan(3);
        expect(sporeHeight(2, 0, 0, 1)).toBe(2);
    });

    it('cycles its swimmers through RUNNER_SLOTS, a head and a wake each', () => {
        const { world } = makeWorld('Minimal');
        const { runners } = world;
        const go = runners.geometry.getAttribute('aGo').array;
        const path = runners.geometry.getAttribute('aPath').array;
        const slots = [];
        for (let i = 0; i < RUNNER_SLOTS + 2; i++) {
            slots.push(runners.launch({
                from: [i, -5], to: [i + 10, -30], rgb: [1, 1, 1], time: 100 + i, flight: 0.5, bow: 1,
            }));
        }
        expect(slots).toEqual([...Array(RUNNER_SLOTS).keys(), 0, 1]);
        // Every mote of a slot rides the same path with the same clock.
        for (let slot = 0; slot < RUNNER_SLOTS; slot++) {
            const expected = slot < 2 ? 100 + RUNNER_SLOTS + slot : 100 + slot; // 0 and 1 were launched twice
            for (let j = 0; j < RUNNER_TAIL; j++) {
                const i = slot * RUNNER_TAIL + j;
                expect(go[i * 4], `slot ${slot} mote ${j}`).toBe(expected);
                expect(go[i * 4 + 1]).toBeCloseTo(0.5, 6);
                expect(path[i * 4 + 1]).toBe(-5);
                expect(path[i * 4 + 3]).toBe(-30);
            }
        }
        expect(runners.count).toBe(RUNNER_SLOTS * RUNNER_TAIL);
        // A launch from a point to itself has no direction to bow from: it must not divide by zero.
        runners.launch({
            from: [3, -9], to: [3, -9], rgb: [1, 1, 1], time: 200, flight: 0.3, bow: 2,
        });
        for (const name of ['aPath', 'aBend', 'aGo', 'aTint']) {
            expect(runners.geometry.getAttribute(name).array.every(Number.isFinite), name).toBe(true);
        }
        runners.reset();
        expect(go.filter((v, i) => i % 4 === 0).every((t) => t < 0)).toBe(true);
        expect(runners.launch({
            from: [0, 0], to: [1, 1], rgb: [1, 1, 1], time: 300, flight: 1,
        })).toBe(0);
        // The path is a bowed curve from the dive to the mushroom's foot.
        const from = [0, -6];
        const to = [-10, -20];
        const mid = [-2, -16];
        expect(runnerPoint(from, mid, to, 0)).toEqual(from);
        expect(runnerPoint(from, mid, to, 1)).toEqual(to);
        const out = [0, 0];
        expect(runnerPoint(from, mid, to, 0.5, out)).toBe(out);
        expect(out[0]).toBeCloseTo(0.25 * from[0] + 0.5 * mid[0] + 0.25 * to[0], 12);
        expect(out[1]).toBeCloseTo(0.25 * from[1] + 0.5 * mid[1] + 0.25 * to[1], 12);
    });

    it('keeps the mushrooms\' state finite and puts all of it back on a reset', () => {
        const made = makeWorld('High');
        const { world } = made;
        const { mushrooms } = world;
        const index = world.targets.right[0].index;
        mushrooms.strike(index, pieceColor(AMBER), world.time, 1);
        mushrooms.fire(0, [1, 1, 1], world.time + 1, 1);
        mushrooms.fire(-1, [1, 1, 1], world.time, 1);
        mushrooms.fire(mushrooms.count, [1, 1, 1], world.time, 1);
        expect(Math.max(...mushrooms.flashAt(0, world.time + 1.01))).toBeGreaterThan(0);
        expect(mushrooms.totalHeld(world.time + 5)).toBeGreaterThan(0);
        mushrooms.release(world.time + 6, 0, -8, [1, 1, 1], 1);
        expect(mushrooms.totalHeld(world.time + 6 + CLEAR_TRAVEL + 0.01)).toBe(0);
        for (const draw of Object.values(mushrooms.draws)) {
            for (const [name, array] of Object.entries(draw.state)) {
                expect(array.every(Number.isFinite), `${draw.mesh.name}.${name}`).toBe(true);
            }
        }
        mushrooms.reset();
        for (const draw of Object.values(mushrooms.draws)) {
            expect(draw.state.aStore.every((v) => v === 0), draw.mesh.name).toBe(true);
            expect(draw.state.aPrev.every((v) => v === 0), draw.mesh.name).toBe(true);
            expect(draw.state.aPulse.filter((v, i) => i % 4 !== 3).every((v) => v === 0), draw.mesh.name).toBe(true);
            expect(draw.state.aPulse.filter((v, i) => i % 4 === 3).every((t) => t < 0), draw.mesh.name).toBe(true);
            expect(draw.state.aCut.every((t) => t > 1e6), draw.mesh.name).toBe(true);
        }
        expect(mushrooms.totalHeld(world.time)).toBe(0);
        expect(mushrooms.heldColor(index, world.time)).toEqual([0, 0, 0]);
        expect(mushrooms.flashAt(index, world.time)).toEqual([0, 0, 0]);
    });
});
