/**
 * Vesper Chrysalis — the real world (vesper-chrysalis-world.js), built without a GPU.
 *
 * The scene is being tuned while these tests stand: they drive the world through the calls the
 * theme makes and assert behaviour and invariants, with every bound taken from the modules' own
 * exports. Tests marked `it.fails` pin faults found in the world's own files: each says what it
 * expects and what happens instead, and turns red the day the fault is fixed (drop `.fails` then).
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    HERO_LAYER, REST_RIG, VESPER_PARTS, VesperWorld, fovForAspect,
} from '../../src/themes/vesper-chrysalis/vesper-chrysalis-world.js';
import {
    BLADE_SLOTS, BLOOM_FULL, BLOOM_HOLD, BLOOM_KEEP, BLOOM_RISE, DEG, EYE, EYE_COMBO, HEART, HOUR_SECONDS, HUSH_HOLD,
    MOTH_DEPTH, MOTH_FLIGHT, PALETTE_KEYS, RING_LIVE, RING_SLOTS, SURGE_COOL, SWELL_LIVE, SWELL_SLOTS, THREAD_PULSES,
    VESPER_PALETTES, WING_FALL, WING_STEPS, bloomLevel, hourAt, paletteAt, pieceColor, powerForCombo, spireTip,
    swellPassTime, wingForCombo,
} from '../../src/themes/vesper-chrysalis/vesper-chrysalis-core.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-quality.js';
import {
    boardPoint, cardUnion, fallbackLayout,
} from '../../src/themes/vesper-chrysalis/vesper-chrysalis-composition.js';
import { DUST_HOME } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-fx.js';
import { PULSE_TRAVEL } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-relic.js';
import { VesperPost } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-post.js';
import { URL_PARAMETER_CATALOG } from '../../src/ui/url-parameters/catalog.js';

// Every test builds a whole world (a noise field, a plan, some twenty node materials).
vi.setConfig({ testTimeout: 60000 });

/** The parts that are not mirrored by the lake's pass: the distance, the lake itself, the screen-space blades. */
const UNMIRRORED = ['sky', 'lake', 'blades'];

/** A renderer as far as the world needs one: it keeps a clear colour. */
function standInRenderer() {
    const clear = { color: new THREE.Color(0x123456), alpha: 1 };
    return {
        clear,
        getClearColor: (target) => target.copy(clear.color),
        getClearAlpha: () => clear.alpha,
        setClearColor: vi.fn((color, alpha = 1) => {
            clear.color.set(color);
            clear.alpha = alpha;
        }),
    };
}

function frame(world, camera, time, delta) {
    const sim = { time, delta };
    world.updateCamera(camera, sim);
    world.update(sim, camera);
}

function makeWorld(quality = 'Low', {
    width = 1600, height = 900, live = true, reduced = false, renderer = null, start = 10,
} = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new VesperWorld({
        scene, quality, capture: true, renderer,
    }).build();
    world.bindCamera(camera);
    world.setReducedMotion(reduced);
    world.setViewport(width, height, aspect);
    // As the theme does on its first frame: the live rects, or null when no board is on screen.
    world.setLayout(live ? fallbackLayout(width, height) : null, aspect);
    world.seek(start);
    frame(world, camera, start, 0);
    return { scene, camera, world };
}

/** Advance the world from its current time by `seconds` in `steps` equal frames. */
function run(world, camera, seconds, steps = Math.max(1, Math.round(seconds * 60))) {
    const t0 = world.time;
    for (let i = 1; i <= steps; i++) frame(world, camera, t0 + (seconds * i) / steps, seconds / steps);
}

/** Record every call of a pool's method (its arguments copied: the world reuses its scratch arrays). */
function record(part, method) {
    const calls = [];
    const original = part[method];
    part[method] = (...args) => {
        calls.push(structuredClone(args));
        return original(...args);
    };
    return calls;
}

/** The strikes and the releases still on their way to the lilies, the soonest first (the list is kept in time order). */
const strikes = (world) => world.blooms.pending.filter((e) => e.kind === 'strike');
const releases = (world) => world.blooms.pending.filter((e) => e.kind === 'release');

/** Every strike the world orders from now on, in the order it orders them: call the result to read them. */
function recordStrikes(world) {
    const calls = record(world.blooms, 'strike');
    return () => calls.map(([index, rgb, at, amount]) => ({
        index, rgb, at, amount,
    }));
}
const levels = (world, at = world.time) => world.blooms.plan.map((_, i) => world.blooms.levelAt(i, at));
const litLilies = (world, at = world.time) => levels(world, at).flatMap((level, i) => (level > 0 ? [i] : []));

/** The rings whose slot says they start at `time`. */
function ringsBornAt(world, time) {
    const out = [];
    world.u.ringA.forEach((slot, i) => {
        if (Math.abs(slot.value.z - time) < 1e-9) out.push({ place: slot.value, colour: world.u.ringC[i].value });
    });
    return out;
}

/** The dust pool's slots that are in use: where each scale starts, how it moves, its look. */
function dustInUse(world) {
    const birth = world.dust.geometry.getAttribute('aBirth').array;
    const motion = world.dust.geometry.getAttribute('aMotion').array;
    const look = world.dust.geometry.getAttribute('aLook').array;
    const out = [];
    for (let i = 0; i < world.dust.count; i++) {
        if (birth[i * 4 + 3] > -50) {
            out.push({
                at: [birth[i * 4], birth[i * 4 + 1], birth[i * 4 + 2]],
                time: birth[i * 4 + 3],
                velocity: [motion[i * 4], motion[i * 4 + 1], motion[i * 4 + 2]],
                life: motion[i * 4 + 3],
                rgb: [look[i * 4], look[i * 4 + 1], look[i * 4 + 2]],
                size: look[i * 4 + 3],
            });
        }
    }
    return out;
}

/** A colour (a vector or an array) keeps the hue of `rgb`: the same ratios between its channels. */
function expectHue(colour, rgb, digits = 5) {
    const [r, g, b] = Array.isArray(colour) ? colour : [colour.x, colour.y, colour.z];
    const peak = Math.max(r, g, b);
    const wanted = Math.max(...rgb);
    expect(peak).toBeGreaterThan(0);
    expect(r / peak).toBeCloseTo(rgb[0] / wanted, digits);
    expect(g / peak).toBeCloseTo(rgb[1] / wanted, digits);
    expect(b / peak).toBeCloseTo(rgb[2] / wanted, digits);
}

/** Where a world point shows through a camera (screen fractions, y down). */
function onScreen(point, camera) {
    const v = new THREE.Vector3(...point).project(camera);
    return { x: v.x * 0.5 + 0.5, y: 0.5 - v.y * 0.5 };
}

/** A world whose lilies hold light on both sides: four hard drops, landed and opened. */
function litWorld(quality = 'Low', options = {}) {
    const made = makeWorld(quality, options);
    const { camera, world } = made;
    for (let i = 0; i < 4; i++) {
        world.onLock({ u: i % 2 ? 0.8 : 0.2, hardDrop: true, color: i % 2 ? '#60ffff' : '#ff70ff' });
        run(world, camera, 0.5);
    }
    const landed = Math.max(world.time, ...world.blooms.pending.map((e) => e.at));
    run(world, camera, landed - world.time + BLOOM_RISE * 3);
    expect(world.blooms.pending).toHaveLength(0);
    const lit = litLilies(world);
    expect(lit.length).toBeGreaterThan(3);
    return { ...made, lit };
}

/**
 * The event slots of one kind: every slot's place and time, and the colour of those in use. (A
 * slot that has never been written since the last seek is not drawn: its strength is zero and
 * its birth long past. The colour it last carried is left in it, and is no part of the picture.)
 */
function slotNumbers(places, colours, birth) {
    return places.flatMap((slot, i) => {
        const place = slot.value.toArray();
        return slot.value.getComponent(birth) > -50 ? [...place, ...colours[i].value.toArray()] : place;
    });
}

/** Everything a frame of the world is made of, but the dust: numbers, in a fixed order. */
function snapshot(world, camera) {
    const { u } = world;
    const scalars = ['time', 'pixelAngle', 'power', 'surge', 'breath', 'wake', 'crack', 'combo', 'night', 'aurora',
        'cloudDrift', 'drift', 'ringsLive', 'swellLive', 'pulsesLive'].map((key) => u[key].value);
    const post = world.getPostState();
    return [
        ...scalars,
        ...PALETTE_KEYS.flatMap((key) => u[key].value.toArray()),
        ...u.fed.value.toArray(),
        ...u.wing.value.toArray(),
        ...u.eyes.value.toArray(),
        ...u.viewport.value.toArray(),
        ...slotNumbers(u.ringA, u.ringC, 2),
        ...slotNumbers(u.swellA, u.swellC, 0),
        ...slotNumbers(u.pulseA, u.pulseC, 0),
        ...world.blooms.rows.flatMap((row) => row.toArray()),
        ...world.blooms.tints.flatMap((tint) => tint.toArray()),
        ...world.blooms.state.flatMap((s) => [s.t0, s.from, s.to, ...s.rgb]),
        ...world.blooms.pending.flatMap((e) => [e.index, e.at, e.amount, e.kind === 'strike' ? 1 : 0, e.tag ?? -1]),
        post.flash, post.kick, post.shafts, post.bloomBoost, post.exposure, post.prism.radius, post.prism.strength,
        post.heart.x, post.heart.y,
        world.wing, world.power, world.surge, world.storm, world.breath, world.drift, world.fed, world.beat,
        world.moths.cursor, world.dust.cursor, world.ringCursor, world.swellCursor, world.pulseCursor,
        ...Object.values(world.counts),
        ...camera.matrixWorld.toArray(), camera.fov,
    ];
}

/**
 * The dust pool: every scale in use, slot by slot. (A slot not in use is not drawn; a seek or a
 * new pool leaves different leftovers in it.)
 */
function dustSnapshot(world) {
    const names = ['aBirth', 'aMotion', 'aLook'];
    const arrays = names.map((name) => world.dust.geometry.getAttribute(name).array);
    const out = [];
    for (let i = 0; i < world.dust.count; i++) {
        const scale = (array) => Array.from(array.subarray(i * 4, i * 4 + 4));
        if (arrays[0][i * 4 + 3] > -50) out.push(i, ...arrays.flatMap(scale));
    }
    return out;
}

/** A run of play that touches every reaction, at a given frame rate. */
function script(world, camera, fps = 60) {
    world.onLock({ u: 0.3, hardDrop: true, color: '#ffa050' });
    world.onClear({ lines: 2 });
    world.onCombo(1);
    run(world, camera, 1.5, Math.round(1.5 * fps));
    world.onLock({ u: 0.7, color: '#60ffff' });
    world.onClear({ lines: 4 });
    world.onCombo(2);
    run(world, camera, 2, Math.round(2 * fps));
    world.onLock({ u: 0.8, color: '#ff70ff' });
    world.onClear({ lines: 1, tspin: true });
    world.onCombo(3);
    world.levelUp(2);
    run(world, camera, 1.5, Math.round(1.5 * fps));
    world.onLock({ u: 0.2, hardDrop: true, color: '#60ffff' });
    world.onCombo(0);
    run(world, camera, 1, fps);
}

/**
 * A longer run with what the short one leaves out: a chain that breaks into a new one, a new run
 * (the soft reset) with everything still in the air, and play going on after it.
 */
function longScript(world, camera, fps = 60) {
    script(world, camera, fps);
    world.onLock({ u: 0.6, color: '#ffd060' });
    world.onClear({ lines: 3 });
    world.onCombo(1);
    run(world, camera, 0.4, Math.round(0.4 * fps));
    world.onCombo(2);
    world.onLock({ u: 0.3, hardDrop: true, color: '#ff70ff' });
    world.onClear({ lines: 4, perfect: true });
    run(world, camera, 0.5, Math.round(0.5 * fps));
    world.resetSession();
    run(world, camera, 0.3, Math.round(0.3 * fps));
    world.onLock({ u: 0.8, hardDrop: true, color: '#60ffff' });
    world.onClear({ lines: 2 });
    world.onCombo(1);
    run(world, camera, 1.2, Math.round(1.2 * fps));
    world.onCombo(3);
    world.onCombo(1);
    run(world, camera, 0.6, Math.round(0.6 * fps));
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('vesper world: build', () => {
    it('builds the whole picture at every tier from node materials, with the counts the tier pays for', () => {
        for (const quality of QUALITY_NAMES) {
            const { scene, world } = makeWorld(quality);
            const tier = QUALITY[quality];
            const names = Object.keys(world.parts);
            // Every part is drawn under a name a capture can address; a tier may leave out only
            // what it has none of.
            const absent = [tier.reeds > 0 ? null : 'reeds', tier.fireflies > 0 ? null : 'fireflies'].filter(Boolean);
            expect([...names].sort(), quality).toEqual(VESPER_PARTS.filter((name) => !absent.includes(name)).sort());
            expect(scene.children, quality).toEqual([world.root]);
            // The parts, and (with a mirror pass) the plane the pass mirrors about.
            expect(world.root.children, quality).toHaveLength(names.length + (tier.mirror > 0 ? 1 : 0));
            expect(Boolean(world.lake.reflection), quality).toBe(tier.mirror > 0);
            const drawn = [];
            for (const name of names) {
                const part = world.parts[name];
                const label = `${quality}.${name}`;
                expect(part.mesh.parent, label).toBe(world.root);
                expect(part.mesh.frustumCulled, label).toBe(false);
                expect(part.mesh.matrixAutoUpdate, label).toBe(false);
                expect(part.mesh.visible, label).toBe(true); // no pool waits hidden for its first event
                part.mesh.traverse((object) => {
                    if (!object.material) return;
                    drawn.push(object);
                    expect(object.material.isNodeMaterial, label).toBe(true);
                    expect(object.material.isShaderMaterial, label).not.toBe(true);
                    expect(object.material.fog, label).toBe(false); // the evening's own mist is in every material
                    expect(object.frustumCulled, label).toBe(false);
                });
            }
            expect(drawn.length, quality).toBeGreaterThanOrEqual(names.length);
            // What the tier pays for.
            expect(world.blooms, quality).toBe(world.parts.blooms);
            expect(world.blooms.count, quality).toBe(tier.blooms);
            expect(world.blooms.plan, quality).toHaveLength(tier.blooms);
            expect(world.parts.spires.count, quality).toBe(tier.spires * 2);
            expect(world.spires, quality).toHaveLength(tier.spires * 2);
            expect(world.parts.threads.count, quality).toBe(tier.threads);
            expect(world.dust.count, quality).toBe(tier.dust);
            if (tier.fireflies > 0) expect(world.parts.fireflies.count, quality).toBe(tier.fireflies);
            if (tier.reeds > 0) expect(world.parts.reeds.count, quality).toBe(tier.reeds);
            expect(world.getState(), quality).toMatchObject({
                quality,
                time: 10,
                combo: 0,
                wing: 0,
                level: 1,
                palette: VESPER_PALETTES[0].name,
                blooms: tier.blooms,
                held: 0,
                dust: tier.dust,
                spires: tier.spires * 2,
                threads: tier.threads,
                fireflies: tier.fireflies,
                mirror: tier.mirror > 0,
                layoutLive: true,
                counts: {
                    locks: 0, clears: 0, quads: 0, moths: 0, falls: 0,
                },
            });
            world.dispose();
        }
    });

    it('names its parts as the URL reference lists them, and builds them all at the fullest tier', () => {
        expect(new Set(VESPER_PARTS).size).toBe(VESPER_PARTS.length);
        // ?vesperChrysalisParts= (the captureThemes row in theme-parameters.js) takes these names.
        const entry = URL_PARAMETER_CATALOG.find(({ name }) => name === 'vesperChrysalisParts');
        expect(entry.values).toMatch(/^Comma-separated names: /);
        const listed = entry.values.replace('Comma-separated names: ', '').split(', ');
        expect([...listed].sort()).toEqual([...VESPER_PARTS].sort());
        const { world } = makeWorld(QUALITY_NAMES[QUALITY_NAMES.length - 1]);
        expect(Object.keys(world.parts).sort()).toEqual([...VESPER_PARTS].sort());
        world.dispose();
    });

    it('builds the High tier for a quality it does not know, and the same lake every time', () => {
        const unknown = new VesperWorld({ scene: new THREE.Scene(), quality: 'Nope' }).build();
        const high = new VesperWorld({ scene: new THREE.Scene(), quality: 'High' }).build();
        const bare = new VesperWorld({ scene: new THREE.Scene() }).build();
        for (const world of [unknown, bare]) {
            expect(world.blooms.count).toBe(QUALITY.High.blooms);
            expect(world.dust.count).toBe(QUALITY.High.dust);
            expect(world.blooms.plan).toEqual(high.blooms.plan);
            expect(world.spires).toEqual(high.spires);
            expect(world.threads).toEqual(high.threads);
        }
        unknown.dispose();
        high.dispose();
        bare.dispose();
    });

    it('draws only the named parts when asked, and takes a part its tier does not have in its stride', () => {
        const { camera, world } = makeWorld('Minimal');
        // The lowest tier has no reeds and no fireflies: they are absent, not broken.
        expect(QUALITY.Minimal.reeds).toBe(0);
        expect(world.parts.reeds).toBeUndefined();
        expect(world.parts.fireflies).toBeUndefined();
        expect(world.getState().fireflies).toBe(0);
        world.showOnlyParts(['sky', 'wings', 'reeds', 'no-such-part']);
        Object.keys(world.parts).forEach((name) => {
            expect(world.parts[name].mesh.visible, name).toBe(name === 'sky' || name === 'wings');
        });
        world.showOnlyParts(['fireflies']);
        expect(Object.values(world.parts).some((part) => part.mesh.visible)).toBe(false);
        world.showOnlyParts([]);
        expect(Object.values(world.parts).some((part) => part.mesh.visible)).toBe(false);
        world.showOnlyParts(VESPER_PARTS);
        expect(Object.values(world.parts).every((part) => part.mesh.visible)).toBe(true);
        // And the whole of play runs without them.
        expect(() => {
            world.onLock({ u: 0.2, hardDrop: true });
            world.onClear({ lines: 4 });
            world.onCombo(3);
            run(world, camera, 3);
            world.onCombo(0);
            run(world, camera, 3);
        }).not.toThrow();
        world.dispose();
    });

    it('puts what stands in the scene on the mirror\'s layer, and nothing else', () => {
        for (const quality of ['Minimal', 'High']) {
            const { world } = makeWorld(quality);
            for (const name of Object.keys(world.parts)) {
                const mirrored = !UNMIRRORED.includes(name);
                let objects = 0;
                world.parts[name].mesh.traverse((object) => {
                    objects += 1;
                    const label = `${quality}.${name} ${object.name || object.type}`;
                    // The mirror pass draws layer HERO_LAYER only; the main camera draws both.
                    expect(object.layers.isEnabled(HERO_LAYER), label).toBe(mirrored);
                    expect(object.layers.isEnabled(0), label).toBe(!mirrored);
                });
                expect(objects, name).toBeGreaterThan(0);
            }
            // The plane the pass mirrors about is no part of the picture.
            if (world.lake.reflectorTarget) expect(world.lake.reflectorTarget.layers.isEnabled(HERO_LAYER)).toBe(false);
            world.dispose();
        }
        expect(HERO_LAYER).toBeGreaterThan(0);
        expect(HERO_LAYER).toBeLessThan(32);
    });

    it('shows the camera it is bound to both layers, and the mirror\'s camera only what stands in the scene', () => {
        const { camera, world } = makeWorld('High');
        expect(camera.layers.isEnabled(0)).toBe(true);
        expect(camera.layers.isEnabled(HERO_LAYER)).toBe(true);
        const { reflector } = world.lake.reflection;
        const mirror = reflector.getVirtualCamera(camera);
        expect(mirror.layers.mask).toBe(1 << HERO_LAYER);
        // Another camera (a rebuild's, a capture's) is bound the same way.
        const other = new THREE.PerspectiveCamera(50, 1.5, 0.5, 6000);
        expect(other.layers.isEnabled(HERO_LAYER)).toBe(false);
        world.bindCamera(other);
        expect(other.layers.isEnabled(HERO_LAYER)).toBe(true);
        expect(reflector.getVirtualCamera(other).layers.mask).toBe(1 << HERO_LAYER);
        expect(() => world.bindCamera(null)).not.toThrow();
        world.dispose();
        // A tier with no mirror pass binds a camera just the same.
        const plain = makeWorld('Low');
        expect(plain.world.lake.reflection).toBeNull();
        expect(plain.camera.layers.isEnabled(HERO_LAYER)).toBe(true);
        plain.world.dispose();
    });

    // three sorts by a Group's renderOrder before any mesh's own (Renderer._projectObject:
    // groupOrder). A part made of several draws (the chrysalis and its halo; a lily's petals, pad
    // and aura) must therefore carry no order on its group, or all its draws come after
    // everything outside it: a pad, which is drawn `over`, would then cut a notch in a blade, a
    // moth or a wing in front of it, and the sky's shader would run under the chrysalis.
    it('draws its parts in the order their render orders say', () => {
        const { world } = makeWorld('High');
        const drawn = [];
        const walk = (object, groupOrder) => {
            const order = object.isGroup ? object.renderOrder : groupOrder;
            if (object.material) {
                drawn.push({
                    name: object.name || object.material.name,
                    transparent: object.material.transparent === true,
                    groupOrder: order,
                    renderOrder: object.renderOrder,
                });
            }
            object.children.forEach((child) => walk(child, order));
        };
        walk(world.root, 0);
        expect(drawn.length).toBeGreaterThan(12);
        const order = {};
        for (const transparent of [false, true]) {
            const list = drawn.filter((item) => item.transparent === transparent);
            const asSorted = [...list].sort((a, b) => a.groupOrder - b.groupOrder || a.renderOrder - b.renderOrder);
            const asNumbered = [...list].sort((a, b) => a.renderOrder - b.renderOrder);
            expect(asSorted.map((item) => item.name)).toEqual(asNumbered.map((item) => item.name));
            // No two draws of a kind share a place: the order never falls back on distance.
            expect(new Set(list.map((item) => item.renderOrder)).size).toBe(list.length);
            order[transparent ? 'blended' : 'solid'] = asSorted.map((item) => item.name);
        }
        const place = (list, pattern) => list.findIndex((name) => pattern.test(name));
        // The sky is the last of the solid draws: its shader runs only where sky shows.
        expect(place(order.solid, /Sky/)).toBe(order.solid.length - 1);
        expect(place(order.solid, /Shell/)).toBeLessThan(place(order.solid, /Lake/));
        // The pads lie on the water under every light; the screen-space blades are over everything.
        expect(place(order.blended, /Blooms|Pad/)).toBe(0);
        expect(place(order.blended, /Blades/)).toBe(order.blended.length - 1);
        expect(place(order.blended, /Halo/)).toBeLessThan(place(order.blended, /Wings/));
        world.dispose();
    });

    it('takes the renderer\'s clear colour for the mirror pass and hands it back when it goes', () => {
        const renderer = standInRenderer();
        const { scene, camera, world } = makeWorld('Medium', { renderer });
        // The mirror pass is laid over the mirrored sky by its alpha: it must clear to nothing.
        expect(renderer.clear.alpha).toBe(0);
        expect(renderer.clear.color.getHex()).toBe(0x000000);
        expect(scene.children).toContain(world.root);
        const disposals = [];
        Object.values(world.parts).forEach((part) => {
            disposals.push(vi.spyOn(part.geometry, 'dispose'), vi.spyOn(part.material, 'dispose'));
        });
        expect(world.textures.length).toBeGreaterThanOrEqual(1); // the noise field
        world.textures.forEach((texture) => disposals.push(vi.spyOn(texture, 'dispose')));
        const mirror = vi.spyOn(world.lake.reflection, 'dispose');
        expect(world.disposed).toBe(false);
        world.dispose();
        expect(world.disposed).toBe(true);
        expect(scene.children).toHaveLength(0);
        for (const disposal of disposals) expect(disposal).toHaveBeenCalledOnce();
        expect(mirror).toHaveBeenCalledOnce();
        expect(renderer.clear.color.getHex()).toBe(0x123456);
        expect(renderer.clear.alpha).toBe(1);
        expect(camera.layers.isEnabled(HERO_LAYER)).toBe(false);
        expect(camera.layers.isEnabled(0)).toBe(true);
        expect(world.parts).toEqual({});
        expect(world.textures).toEqual([]);
        // A second dispose does nothing at all.
        const calls = renderer.setClearColor.mock.calls.length;
        expect(() => world.dispose()).not.toThrow();
        for (const disposal of disposals) expect(disposal).toHaveBeenCalledOnce();
        expect(renderer.setClearColor).toHaveBeenCalledTimes(calls);
        // A late frame or a late event after retirement is harmless.
        expect(() => {
            frame(world, camera, 11, 0.016);
            world.onLock({ u: 0.5 });
            world.onLock({ u: 0.2, hardDrop: true });
            world.onClear({ lines: 4, perfect: true });
            world.onCombo(0);
            world.onGameOver();
            world.levelUp(2);
            world.levelUp(3, { silent: true });
            world.setViewport(800, 600, 800 / 600);
            world.setLayout(null);
            world.setLayout(fallbackLayout(800, 600), 800 / 600);
            world.setReducedMotion(true);
            world.showOnlyParts(['sky']);
            world.resetSession();
            world.seek(3);
            world.bindCamera(camera);
        }).not.toThrow();
        expect(world.getState()).toMatchObject({ blooms: 0, held: 0, dust: 0 });
        expect(world.getPostState()).toBeTruthy();
    });

    it('builds and retires without a renderer, and before it is built answers no event', () => {
        const scene = new THREE.Scene();
        const world = new VesperWorld({ scene, quality: 'Minimal' });
        expect(() => {
            world.onLock({ u: 0.2 });
            world.onClear({ lines: 2 });
            world.update({ time: 1, delta: 0.016 });
            world.setViewport(800, 600, 800 / 600);
        }).not.toThrow();
        expect(scene.children).toHaveLength(0);
        world.build();
        expect(scene.children).toEqual([world.root]);
        world.dispose();
        expect(scene.children).toHaveLength(0);
    });

    it('takes a late chain after retirement, and an early one before it is built: it notes the number', () => {
        const { world } = makeWorld('Minimal');
        world.dispose();
        expect(() => world.onCombo(3)).not.toThrow();
        expect(world.combo).toBe(3);
        expect(() => world.onCombo(0)).not.toThrow();
        expect(world.combo).toBe(0);
        expect(world.counts.falls).toBe(0);
        // Before it is built there is nothing to write to either; once built, the chain it was told of opens the wings.
        const unbuilt = new VesperWorld({ scene: new THREE.Scene(), quality: 'Minimal' });
        expect(() => unbuilt.onCombo(2)).not.toThrow();
        expect(unbuilt.combo).toBe(2);
        expect(() => unbuilt.resetSession()).not.toThrow();
        unbuilt.onCombo(2);
        unbuilt.build();
        const camera = new THREE.PerspectiveCamera(50, 16 / 9, REST_RIG.near, REST_RIG.far);
        unbuilt.bindCamera(camera);
        for (let i = 1; i <= 180; i++) frame(unbuilt, camera, i / 60, 1 / 60);
        expect(unbuilt.wing).toBe(wingForCombo(2));
        unbuilt.dispose();
    });
});

describe('vesper world: camera', () => {
    it('rests at the eye, looking a little up at the chrysalis, with the lens its frame asks for', () => {
        for (const [width, height] of [[1600, 900], [390, 844], [3440, 1440]]) {
            const { camera, world } = makeWorld('Minimal', { width, height, reduced: true });
            const aspect = width / height;
            expect(camera.position.toArray()).toEqual([EYE.x, EYE.y, EYE.z]);
            expect(camera.fov).toBe(fovForAspect(aspect));
            expect(camera.near).toBe(REST_RIG.near);
            expect(camera.far).toBe(REST_RIG.far);
            const gaze = camera.getWorldDirection(new THREE.Vector3());
            expect(gaze.x).toBeCloseTo(0, 9);
            expect(Math.atan2(gaze.y, -gaze.z)).toBeCloseTo(EYE.pitch, 9);
            // The heart on screen is where a pinhole at the eye puts it (the model the core and
            // mesh tests measure the composition in).
            const dy = HEART[1] - EYE.y;
            const dz = HEART[2] - EYE.z;
            const depth = dy * Math.sin(EYE.pitch) - dz * Math.cos(EYE.pitch);
            const rise = dy * Math.cos(EYE.pitch) + dz * Math.sin(EYE.pitch);
            const lens = Math.tan((fovForAspect(aspect) * DEG) / 2);
            expect(world.heart.x).toBeCloseTo(0.5, 9);
            expect(world.heart.y).toBeCloseTo(0.5 - (rise / (depth * lens)) * 0.5, 9);
            // The post reads the same point, not a copy of it.
            expect(world.getPostState().heart).toBe(world.heart);
            expect(world.getState().heart).toEqual(world.heart);
            expect(world.getState().heart).not.toBe(world.heart);
            world.dispose();
        }
        expect(REST_RIG).toMatchObject({
            hFov: EYE.hFov, minFov: EYE.minFov, maxFov: EYE.maxFov, near: EYE.near, far: EYE.far,
        });
    });

    it('stands in a boat that is all but still: it sways, never far, never losing the chrysalis', () => {
        const { camera, world } = makeWorld('Minimal');
        const rest = new THREE.Vector3(EYE.x, EYE.y, EYE.z);
        let wandered = 0;
        for (let i = 0; i < 90; i++) {
            run(world, camera, 2, 1);
            const away = camera.position.distanceTo(rest);
            wandered = Math.max(wandered, away);
            expect(away).toBeLessThan(3);
            expect(camera.position.y).toBeGreaterThan(EYE.y * 0.8); // above the water
            expect(world.heart.x).toBeGreaterThan(0.4);
            expect(world.heart.x).toBeLessThan(0.6);
            expect(world.heart.y).toBeGreaterThan(0);
            expect(world.heart.y).toBeLessThan(0.5);
            // The heart on screen is where the camera really sees it.
            const seen = onScreen(HEART, camera);
            expect(world.heart.x).toBeCloseTo(seen.x, 9);
            expect(world.heart.y).toBeCloseTo(seen.y, 9);
        }
        expect(wandered).toBeGreaterThan(0.1);
        world.dispose();
    });

    it('leans the view with the pointer', () => {
        const { camera, world } = makeWorld('Minimal');
        const at = (pointerX, pointerY) => {
            world.updateCamera(camera, {
                time: 10, delta: 0, pointerX, pointerY,
            });
            return camera.position.clone();
        };
        const rest = at(0, 0);
        const right = at(1, 0);
        expect(right.x).toBeGreaterThan(rest.x);
        expect(right.y).toBeCloseTo(rest.y, 9);
        expect(world.heart.x).toBeGreaterThan(0);
        expect(world.heart.x).toBeLessThan(1);
        const left = at(-1, 0);
        expect(rest.x - left.x).toBeCloseTo(right.x - rest.x, 9);
        // A pointer low on the screen lowers the view.
        expect(at(0, 1).y).toBeLessThan(rest.y);
        expect(at(0, -1).y).toBeGreaterThan(rest.y);
        // No pointer at all is a pointer at rest.
        world.updateCamera(camera, { time: 10, delta: 0 });
        expect(camera.position.distanceTo(rest)).toBeLessThan(1e-12);
        world.dispose();
    });

    it('finds the world point along the ray through a screen point', () => {
        const { camera, world } = makeWorld('Minimal');
        for (const [sx, sy, depth] of [[0.3, 0.7, 12], [0.5, 0.5, MOTH_DEPTH], [0.95, 0.1, 40]]) {
            const out = [0, 0, 0];
            expect(world.screenToWorld(sx, sy, depth, out)).toBe(out);
            expect(new THREE.Vector3(...out).distanceTo(camera.position)).toBeCloseTo(depth, 6);
            const seen = onScreen(out, camera);
            expect(seen.x).toBeCloseTo(sx, 6);
            expect(seen.y).toBeCloseTo(sy, 6);
        }
        world.dispose();
        // Before any camera is bound it aims straight ahead from the eye, and a lock still lands.
        const blind = new VesperWorld({ scene: new THREE.Scene(), quality: 'Minimal' }).build();
        expect(blind.screenToWorld(0.2, 0.9, 5, [1, 1, 1])).toEqual([0, EYE.y, -5]);
        expect(() => blind.onLock({ u: 0.2 })).not.toThrow();
        expect(blind.counts).toMatchObject({ locks: 1, moths: 1 });
        blind.dispose();
    });

    it('follows the frame: the viewport, the pixel\'s angle, the lens and where a board would hang', () => {
        const { camera, world } = makeWorld('Minimal', { live: false });
        expect(world.u.viewport.value.toArray()).toEqual([1600, 900]);
        const pixel = () => (2 * Math.tan((camera.fov * DEG) / 2)) / world.u.viewport.value.y;
        expect(world.u.pixelAngle.value).toBeCloseTo(pixel(), 12);
        const wide = cardUnion(world.layout);
        expect((wide.x0 + wide.x1) / 2).toBeCloseTo(0.5, 9);
        // An upright phone: a taller lens, a card that fills more of the width.
        world.setViewport(390, 844, 390 / 844);
        frame(world, camera, world.time, 0);
        expect(world.u.viewport.value.toArray()).toEqual([390, 844]);
        expect(camera.fov).toBe(fovForAspect(390 / 844));
        expect(camera.fov).toBeGreaterThan(fovForAspect(1600 / 900));
        expect(world.u.pixelAngle.value).toBeCloseTo(pixel(), 12);
        const upright = cardUnion(world.layout);
        expect(world.getState().layoutLive).toBe(false);
        expect(upright.x1 - upright.x0).toBeGreaterThan(wide.x1 - wide.x0);
        // Back to a desktop's shape: the card a moth leaves follows at once.
        world.setViewport(1600, 900, 1600 / 900);
        expect(cardUnion(world.layout)).toEqual(wide);
        // A live board is not moved by a resize: the theme reads its rects again.
        const rects = fallbackLayout(1600, 900);
        world.setLayout(rects, 1600 / 900);
        world.setViewport(390, 844, 390 / 844);
        expect(world.layout).toBe(rects);
        expect(world.getState().layoutLive).toBe(true);
        // The board leaves the screen: back to where it would hang in this frame.
        world.setLayout(null);
        expect(cardUnion(world.layout)).toEqual(upright);
        // Nonsense leaves the frame as it was.
        world.setViewport(0, -4, NaN);
        expect(world.u.viewport.value.toArray()).toEqual([390, 844]);
        expect(cardUnion(world.layout)).toEqual(upright);
        expect(Number.isFinite(world.u.pixelAngle.value)).toBe(true);
        world.dispose();
    });
});

describe('vesper world: locks', () => {
    it('sends one moth from the card to a lily, which opens when it lands and keeps the light', () => {
        const { camera, world } = makeWorld('Low');
        const launches = record(world.moths, 'launch');
        const card = cardUnion(world.layout);
        const board = world.layout.boards[0];
        const rgb = pieceColor('#60ffff');
        const t0 = world.time;
        expect(world.getState().held).toBe(0);
        world.onLock({ rows: [12, 13], u: 0.2, color: '#60ffff' });
        expect(world.counts).toMatchObject({ locks: 1, moths: 1 });

        // ── The moth: it leaves now, from the card's edge on the piece's side, at the piece's height ──
        expect(launches).toHaveLength(1);
        const [moth] = launches[0];
        expect(world.moths.cursor).toBe(1);
        expect(moth.time).toBe(t0);
        expect(moth.flight).toBeGreaterThan(0);
        expect(moth.flight).toBeLessThan(5);
        expect(moth.size).toBeGreaterThan(0);
        expect(moth.rgb).toEqual(rgb);
        expect(new THREE.Vector3(...moth.from).distanceTo(camera.position)).toBeCloseTo(MOTH_DEPTH, 4);
        const start = onScreen(moth.from, camera);
        expect(start.x).toBeCloseTo(card.x0, 4);
        expect(start.y).toBeCloseTo(boardPoint(board, 0.2, 13).y, 4);

        // ── The lily: one, on the piece's side; a strike is on its way to it ──
        expect(world.blooms.pending).toHaveLength(1);
        const [strike] = strikes(world);
        const lily = world.blooms.plan[strike.index];
        expect(lily.side).toBe(-1);
        expect(lily.x).toBeLessThan(0);
        expect(strike.at).toBe(t0 + moth.flight);
        expect(strike.amount).toBeGreaterThan(0);
        expect(strike.rgb).toEqual(rgb);
        // The moth flies to just above that lily, on a path that bows upward.
        expect(moth.to[0]).toBe(lily.x);
        expect(moth.to[2]).toBe(lily.z);
        expect(moth.to[1]).toBeGreaterThan(0);
        expect(moth.to[1]).toBeLessThan(lily.size * 2);
        expect(moth.bow[1]).toBeGreaterThan(0);

        // ── The ring it will send over the water when it lands, in the piece's colour ──
        const rings = ringsBornAt(world, strike.at);
        expect(rings).toHaveLength(1);
        expect(rings[0].place.x).toBe(lily.x);
        expect(rings[0].place.y).toBe(lily.z);
        expect(rings[0].place.w).toBeGreaterThan(0);
        expect(rings[0].colour.w).toBeGreaterThan(0);
        expectHue(rings[0].colour, rgb);

        // ── The silk on that side carries the piece's colour down to the chrysalis, now ──
        const pulses = world.u.pulseA.filter((slot) => slot.value.x === t0);
        expect(pulses).toHaveLength(1);
        expect(pulses[0].value.y).toBe(-1);
        expect(pulses[0].value.z).toBeGreaterThan(0);
        expectHue(world.u.pulseC[world.u.pulseA.indexOf(pulses[0])].value, rgb);

        // ── A puff of scales where it lands, when it lands ──
        const puff = dustInUse(world);
        expect(puff.length).toBeGreaterThan(0);
        for (const scale of puff) {
            expect(scale.time).toBeCloseTo(strike.at, 4);
            expect(scale.size).toBeGreaterThan(0); // falling, not going home
            for (let k = 0; k < 3; k++) expect(scale.at[k]).toBeCloseTo(moth.to[k], 4);
            expectHue(scale.rgb, rgb, 4);
        }

        // Nothing is lit while the moth is in the air...
        expect(world.kick).toBeGreaterThan(0);
        expect(world.flash).toBeGreaterThan(0);
        run(world, camera, moth.flight - 0.02);
        expect(world.blooms.pending).toHaveLength(1);
        expect(world.getState().held).toBe(0);
        expect(world.blooms.rows[strike.index].y + world.blooms.rows[strike.index].z).toBe(0);
        // ...and once it has landed the lily holds its light: the level of its own state.
        run(world, camera, 0.02 + BLOOM_RISE);
        expect(world.blooms.pending).toHaveLength(0);
        const state = world.blooms.state[strike.index];
        expect(state).toMatchObject({ t0: strike.at, from: 0, to: strike.amount });
        expect(state.rgb).toEqual(rgb);
        const level = world.blooms.levelAt(strike.index, world.time);
        expect(level).toBeGreaterThan(0);
        expect(level).toBe(bloomLevel(state.from, state.to, world.time - state.t0));
        // The shader evaluates the same expression from the same four numbers.
        expect(world.blooms.rows[strike.index].toArray()).toEqual([state.t0, state.from, state.to, strike.at]);
        expect(world.blooms.tints[strike.index].toArray().slice(0, 3)).toEqual(rgb);
        // Only that lily.
        expect(litLilies(world)).toEqual([strike.index]);
        expect(world.getState().held).toBe(level);
        expect(world.blooms.totalHeld(world.time)).toBe(level);
        world.dispose();
    });

    it('lights a lily on the piece\'s own side of the board, and takes turns for a piece down the middle', () => {
        const { camera, world } = makeWorld('High');
        const launches = record(world.moths, 'launch');
        const ordered = recordStrikes(world);
        const card = cardUnion(world.layout);
        for (let i = 0; i < 12; i++) {
            const u = (i + 0.5) / 12;
            world.onLock({ u, rows: [4 + i] });
            const strike = ordered().at(-1);
            const side = u < 0.5 ? -1 : 1;
            expect(world.blooms.plan[strike.index].side, `lock ${i}`).toBe(side);
            // The moth leaves that edge of the card, at that row.
            const start = onScreen(launches[i][0].from, camera);
            expect(start.x, `lock ${i}`).toBeCloseTo(side < 0 ? card.x0 : card.x1, 4);
            expect(start.y, `lock ${i}`).toBeCloseTo(boardPoint(world.layout.boards[0], u, 4 + i).y, 4);
            run(world, camera, 0.25);
        }
        // A piece down the middle of the board goes to one side, the next to the other.
        world.onLock({ u: 0.5 });
        world.onLock({ u: 0.5 });
        const [first, second] = ordered().slice(-2).map((e) => world.blooms.plan[e.index].side);
        expect(first).toBe(-second);
        // With no rows named the piece is taken to lie on the floor; a column off the board is the board's edge.
        world.onLock({ u: 7 });
        const far = onScreen(launches.at(-1)[0].from, camera);
        expect(far.x).toBeCloseTo(card.x1, 4);
        expect(far.y).toBeCloseTo(boardPoint(world.layout.boards[0], 1, 19).y, 4);
        expect(() => world.onLock()).not.toThrow();
        expect(() => world.onLock({ u: 0.4, rows: [], color: 'not-a-colour' })).not.toThrow();
        world.dispose();
    });

    it('keeps a moth in the air no longer than MOTH_FLIGHT * 1.6, the further the longer', () => {
        const { world } = makeWorld('Extreme');
        const launches = record(world.moths, 'launch');
        const from = world.screenToWorld(0.39, 0.6, MOTH_DEPTH, [0, 0, 0]);
        const flown = world.blooms.plan.map((b, index) => {
            const landed = world.sendMoth(index, from, [1, 1, 1], 0.9);
            const [moth] = launches.at(-1);
            expect(landed).toBe(world.time + moth.flight);
            expect([moth.to[0], moth.to[2]]).toEqual([b.x, b.z]);
            return { far: Math.hypot(...moth.to.map((v, k) => v - from[k])), flight: moth.flight };
        });
        flown.sort((a, b) => a.far - b.far);
        for (let i = 0; i < flown.length; i++) {
            expect(flown[i].flight).toBeGreaterThan(0);
            expect(flown[i].flight).toBeLessThanOrEqual(MOTH_FLIGHT * 1.6 + 1e-12);
            if (i > 0) expect(flown[i].flight).toBeGreaterThanOrEqual(flown[i - 1].flight - 1e-9);
        }
        // The far lilies are a real flight away, the near ones a hop.
        expect(flown.at(-1).flight).toBeGreaterThan(flown[0].flight);
        world.dispose();
    });

    it('sends three moths to three lilies on a hard drop, strikes the lake and rings all the silk', () => {
        const soft = makeWorld('Low');
        const hard = makeWorld('Low');
        const launches = record(hard.world.moths, 'launch');
        const ordered = recordStrikes(hard.world);
        const softOrdered = recordStrikes(soft.world);
        const t0 = hard.world.time;
        soft.world.onLock({ u: 0.3, color: '#ffa050' });
        hard.world.onLock({ u: 0.3, hardDrop: true, color: '#ffa050' });
        expect(soft.world.counts.moths).toBe(1);
        expect(hard.world.counts).toMatchObject({ locks: 1, moths: 3 });
        expect(launches).toHaveLength(3);
        // Three strikes on their way to three lilies, listed by when they land.
        expect(strikes(hard.world)).toHaveLength(3);
        const landings = strikes(hard.world).map((e) => e.at);
        expect(landings).toEqual([...landings].sort((a, b) => a - b));
        const struck = ordered();
        expect(struck).toHaveLength(3);
        expect(new Set(struck.map((e) => e.index)).size).toBe(3);
        // The piece's own lily is on its side and takes the most; and the first is the lily a soft lock lights.
        expect(hard.world.blooms.plan[struck[0].index].side).toBe(-1);
        expect(struck[0].index).toBe(softOrdered()[0].index);
        expect(struck[0].amount).toBeGreaterThan(softOrdered()[0].amount);
        expect(struck[1].amount).toBeLessThan(struck[0].amount);
        expect(struck[2].amount).toBeLessThan(struck[0].amount);
        // Every moth leaves the same point of the card, each to its own lily.
        const ringAt = (i) => {
            const lily = hard.world.blooms.plan[struck[i].index];
            const there = (ring) => ring.place.x === lily.x && ring.place.y === lily.z;
            return ringsBornAt(hard.world, struck[i].at).filter(there);
        };
        for (let i = 0; i < 3; i++) {
            const [moth] = launches[i];
            const lily = hard.world.blooms.plan[struck[i].index];
            expect(moth.from).toEqual(launches[0][0].from);
            expect([moth.to[0], moth.to[2]]).toEqual([lily.x, lily.z]);
            expect(struck[i].at).toBe(t0 + moth.flight);
        }
        // Two rings in all, not four: the piece's own lily sends one over the water as its moth
        // lands (the other two open without), and the board strikes the lake now...
        expect(ringAt(0)).toHaveLength(1);
        expect(ringAt(1)).toHaveLength(0);
        expect(ringAt(2)).toHaveLength(0);
        expect(hard.world.ringCursor).toBe(2);
        expect(hard.world.u.ringA.filter((slot) => slot.value.z > -50)).toHaveLength(2);
        expect(soft.world.ringCursor).toBe(1);
        // ...nearer the chrysalis than any lily...
        const now = ringsBornAt(hard.world, t0);
        expect(now).toHaveLength(1);
        const fromHeart = (x, z) => Math.hypot(x - HEART[0], z - HEART[2]);
        const nearest = Math.min(...hard.world.blooms.plan.map((b) => fromHeart(b.x, b.z)));
        expect(fromHeart(now[0].place.x, now[0].place.y)).toBeLessThan(nearest);
        expect(ringsBornAt(soft.world, t0)).toHaveLength(0);
        // ...and the silk rings on both sides (a soft lock rings its own side).
        const pulse = (world) => world.u.pulseA.find((slot) => slot.value.x === t0).value;
        expect(pulse(hard.world).y).toBe(0);
        expect(pulse(soft.world).y).toBe(-1);
        expect(pulse(hard.world).z).toBeGreaterThan(pulse(soft.world).z);
        // It kicks the camera harder, and the kick reaches the post and the lens.
        expect(hard.world.kick).toBeGreaterThan(soft.world.kick);
        expect(hard.world.flash).toBeGreaterThan(soft.world.flash);
        const { fov } = hard.camera;
        run(hard.world, hard.camera, 1 / 60, 1);
        run(soft.world, soft.camera, 1 / 60, 1);
        expect(hard.world.getPostState().kick).toBeGreaterThan(soft.world.getPostState().kick);
        expect(hard.camera.fov).toBeLessThan(fov);
        expect(hard.camera.fov).toBeLessThan(soft.camera.fov);
        // The lake is left holding more.
        run(hard.world, hard.camera, 4);
        run(soft.world, soft.camera, 4);
        expect(hard.world.getState().held).toBeGreaterThan(soft.world.getState().held);
        expect(litLilies(hard.world)).toHaveLength(3);
        // The kick is spent and the lens is back.
        expect(hard.world.getPostState().kick).toBeLessThan(1e-6);
        expect(hard.camera.fov).toBeCloseTo(fov, 5);
        soft.world.dispose();
        hard.world.dispose();
    });

    it('spreads a run of locks over a side\'s lilies before it lights any of them twice', () => {
        for (const quality of QUALITY_NAMES) {
            for (const side of [-1, 1]) {
                const { world } = makeWorld(quality);
                const own = world.blooms.plan.filter((b) => b.side === side).length;
                // As fast as pieces can lock: every moth still in the air when the next one leaves.
                for (let i = 0; i < own; i++) world.onLock({ u: side < 0 ? 0.2 : 0.8 });
                const struck = strikes(world).map((e) => e.index);
                expect(struck).toHaveLength(own);
                for (const index of struck) expect(world.blooms.plan[index].side).toBe(side);
                expect(new Set(struck).size, `${quality}, side ${side}: lilies ${struck.join(' ')}`).toBe(own);
                world.dispose();
            }
        }
    });

    // A lily's level starts from what it held when a moth lands and only rises over BLOOM_RISE.
    // If the next lock asked what it HOLDS, the lily just lit would count as dark for that half
    // second and take the next moth too, while its neighbours have none: it is asked what the
    // lily is opening to (blooms.wanted).
    it('does not send the next moth to the lily the last one has just lit', () => {
        const { camera, world } = makeWorld('Minimal');
        const repeats = [];
        for (let k = 0; k < 24; k++) {
            world.seek(10 + k);
            frame(world, camera, world.time, 0);
            world.onLock({ u: 0.2 });
            const [first] = strikes(world);
            // The next piece locks a moment after the first moth lands: at once, early or late in the lily's opening.
            run(world, camera, first.at - world.time + BLOOM_RISE * [0.02, 0.1, 0.5][k % 3]);
            expect(world.blooms.pending).toHaveLength(0);
            expect(world.blooms.levelAt(first.index, world.time)).toBeLessThan(first.amount * 0.6);
            world.counts.moths = k; // the pick is seeded by the moths sent: try a run of seeds
            world.onLock({ u: 0.2 });
            if (strikes(world)[0].index === first.index) repeats.push(k);
        }
        expect(repeats).toEqual([]);
        world.dispose();
    });

    it('counts a lily for what it is opening to from the moment its moth lands', () => {
        const { camera, world } = makeWorld('Low');
        const { blooms } = world;
        const from = world.screenToWorld(0.3, 0.5, MOTH_DEPTH, [0, 0, 0]);
        expect(blooms.wanted(3, world.time)).toBe(0);
        const landed = world.sendMoth(3, from, [1, 0.5, 0.2], 0.9);
        // On its way: spoken for in full, holding nothing.
        expect(blooms.wanted(3, world.time)).toBeCloseTo(0.9, 9);
        expect(blooms.levelAt(3, world.time)).toBe(0);
        // Just landed: still all but dark, and still spoken for in full.
        run(world, camera, landed - world.time + BLOOM_RISE * 0.05);
        expect(blooms.pending).toHaveLength(0);
        expect(blooms.levelAt(3, world.time)).toBeLessThan(0.05);
        expect(blooms.wanted(3, world.time)).toBeGreaterThan(0.85);
        expect(blooms.wanted(3, world.time)).toBeLessThanOrEqual(0.9);
        // Never less than it holds, at any moment of its opening or its fading; and once open, just what it holds.
        for (let i = 0; i < 40; i++) {
            run(world, camera, BLOOM_RISE / 10, 1);
            expect(blooms.wanted(3, world.time)).toBeGreaterThanOrEqual(blooms.levelAt(3, world.time));
        }
        expect(blooms.wanted(3, world.time)).toBeCloseTo(blooms.levelAt(3, world.time), 9);
        // A second moth on its way adds to it; a lily asked about that does not exist wants nothing.
        world.sendMoth(3, from, [1, 1, 1], 0.6);
        expect(blooms.wanted(3, world.time)).toBeCloseTo(blooms.levelAt(3, world.time) + 0.6, 9);
        expect(blooms.wanted(99, world.time)).toBe(0);
        // Let go, it wants what is left of its light: soon nothing.
        blooms.letGo(world.time);
        expect(blooms.wanted(3, world.time)).toBeCloseTo(blooms.levelAt(3, world.time), 9);
        run(world, camera, BLOOM_RISE * 1.5);
        expect(blooms.wanted(3, world.time)).toBe(0);
        world.dispose();
    });

    it('borrows the other side\'s lilies when its own are all spoken for, and sends nothing when none is left', () => {
        const { world } = makeWorld('Minimal');
        const left = world.blooms.plan.flatMap((b, i) => (b.side < 0 ? [i] : []));
        const right = world.blooms.plan.flatMap((b, i) => (b.side > 0 ? [i] : []));
        expect(left).toContain(world.pickBloom(-1));
        expect(right).toContain(world.pickBloom(1));
        expect(left).toContain(world.pickBloom(-1, left.slice(1)));
        expect(left.slice(1)).not.toContain(world.pickBloom(-1, left.slice(1)));
        // Every lily of its side taken: one from across the board.
        expect(right).toContain(world.pickBloom(-1, left));
        expect(left).toContain(world.pickBloom(1, right));
        expect(world.pickBloom(-1, [...left, ...right])).toBe(-1);
        // A moth for a lily that is not there is not sent.
        const launches = record(world.moths, 'launch');
        expect(world.sendMoth(-1, [0, 4, -15], [1, 1, 1], 1)).toBe(world.time);
        expect(world.sendMoth(world.blooms.count + 3, [0, 4, -15], [1, 1, 1], 1)).toBe(world.time);
        expect(launches).toHaveLength(0);
        expect(world.blooms.pending).toHaveLength(0);
        expect(world.counts.moths).toBe(0);
        world.dispose();
    });

    it('never lets one lily hold more than its fill, and lets its light fade over the hold', () => {
        const { camera, world } = makeWorld('Low');
        const from = world.screenToWorld(0.3, 0.5, MOTH_DEPTH, [0, 0, 0]);
        let landed = world.time;
        for (let i = 0; i < 8; i++) {
            landed = world.sendMoth(0, from, [1, 0.9, 0.8], 1.1);
            run(world, camera, 0.4);
            expect(world.blooms.levelAt(0, world.time)).toBeLessThanOrEqual(BLOOM_FULL);
        }
        run(world, camera, landed - world.time + BLOOM_RISE);
        const full = world.blooms.levelAt(0, world.time);
        expect(full).toBeGreaterThan(BLOOM_FULL * 0.9);
        expect(full).toBeLessThanOrEqual(BLOOM_FULL);
        expect(world.blooms.state[0].to).toBe(BLOOM_FULL);
        // To 1/e in BLOOM_HOLD seconds, whenever it is asked.
        expect(world.blooms.levelAt(0, world.time + BLOOM_HOLD)).toBeCloseTo(full * Math.exp(-1), 9);
        let previous = world.getState().held;
        for (let i = 0; i < 6; i++) {
            run(world, camera, BLOOM_HOLD / 3, 10);
            const now = world.getState().held;
            expect(now).toBeLessThan(previous);
            expect(now).toBeGreaterThan(0);
            previous = now;
        }
        world.dispose();
    });

    it('adds a second moth\'s light to what the lily holds when it lands, in the newcomer\'s colour', () => {
        const { camera, world } = makeWorld('Low');
        const from = world.screenToWorld(0.3, 0.5, MOTH_DEPTH, [0, 0, 0]);
        const first = world.sendMoth(2, from, [1, 0.5, 0.2], 0.9);
        run(world, camera, first - world.time + 2);
        const held = world.blooms.levelAt(2, world.time);
        const second = world.sendMoth(2, from, [0.2, 0.5, 1], 0.6);
        // Nothing changes until it lands: the level runs on as it was.
        const before = world.blooms.levelAt(2, second - 1e-6);
        expect(before).toBeLessThan(held);
        expect(world.blooms.promised(2, world.time)).toBeCloseTo(held + 0.6, 9);
        // What it will hold at a moment to come counts the moth only once it has landed by then...
        const { blooms } = world;
        expect(blooms.heldAt(2, world.time)).toBe(held);
        expect(blooms.heldAt(2, second - 1e-6)).toBe(before);
        expect(blooms.heldAt(2, second)).toBe(blooms.levelAt(2, second)); // landing: the light has yet to rise
        const opened = blooms.heldAt(2, second + BLOOM_RISE);
        const landing = blooms.levelAt(2, second);
        expect(opened).toBeCloseTo(bloomLevel(landing, landing + 0.6, BLOOM_RISE), 9);
        expect(opened).toBeGreaterThan(before + 0.5);
        // ...and so does its colour.
        expect(blooms.colourAt(2, second - 1e-6)).toEqual([1, 0.5, 0.2]);
        expect(blooms.colourAt(2, second)).toEqual([0.2, 0.5, 1]);
        expect(blooms.colourOf(2)).toEqual([0.2, 0.5, 1]);
        // The same for any run of changes on their way to a lily: each counts from its own moment,
        // a swell's release among them, and nothing takes the lily past its fill.
        const t0 = world.time;
        blooms.strike(4, [1, 1, 1], t0 + 3, 1.5);
        blooms.release(4, t0 + 4, 'a swell');
        blooms.strike(4, [0, 1, 0], t0 + 5, 9);
        expect(blooms.heldAt(4, t0 + 2.99)).toBe(0);
        const lit = bloomLevel(0, 1.5, 1);
        expect(blooms.heldAt(4, t0 + 4)).toBeCloseTo(lit, 9);
        expect(blooms.heldAt(4, t0 + 4 + BLOOM_RISE)).toBeCloseTo(bloomLevel(lit, lit * BLOOM_KEEP, BLOOM_RISE), 9);
        expect(blooms.heldAt(4, t0 + 5 + BLOOM_RISE * 2)).toBeLessThanOrEqual(BLOOM_FULL);
        expect(blooms.heldAt(4, t0 + 5 + BLOOM_RISE * 2)).toBeGreaterThan(BLOOM_FULL * 0.9);
        expect(blooms.colourAt(4, t0 + 2)).toEqual(blooms.state[4].rgb);
        expect(blooms.colourAt(4, t0 + 4.5)).toEqual([1, 1, 1]);
        expect(blooms.colourAt(4, t0 + 5)).toEqual([0, 1, 0]);
        expect(blooms.heldAt(99, t0 + 1)).toBe(0);
        // What it says a lily will hold is what the lily then holds, frame by frame.
        const foretold = [3.2, 3.9, 4.1, 4.4, 5.2, 6.5].map((after) => [t0 + after, blooms.heldAt(4, t0 + after)]);
        run(world, camera, second - world.time + BLOOM_RISE * 2);
        const state = world.blooms.state[2];
        expect(state.t0).toBe(second);
        expect(state.from).toBeCloseTo(before, 5);
        expect(state.to).toBeCloseTo(before + 0.6, 5);
        expect(state.rgb).toEqual([0.2, 0.5, 1]);
        expect(world.blooms.levelAt(2, world.time)).toBeGreaterThan(held);
        expect(world.blooms.levelAt(2, second + BLOOM_RISE)).toBeCloseTo(opened, 9);
        expect(world.blooms.colourOf(2)).toEqual([0.2, 0.5, 1]);
        for (const [when, level] of foretold) {
            run(world, camera, when - world.time);
            expect(world.blooms.levelAt(4, world.time), `at ${(when - t0).toFixed(1)} s`).toBeCloseTo(level, 9);
        }
        expect(world.blooms.pending).toHaveLength(0);
        world.dispose();
    });

    it('aims from the click when a mode has no board to aim through', () => {
        const { camera, world } = makeWorld('Low', { live: false });
        const launches = record(world.moths, 'launch');
        const ordered = recordStrikes(world);
        world.onLock({ screen: { x: 0.15, y: 0.4 }, color: '#ffd060' });
        let start = onScreen(launches[0][0].from, camera);
        expect(start.x).toBeCloseTo(0.15, 4);
        expect(start.y).toBeCloseTo(0.4, 4);
        expect(world.blooms.plan[ordered()[0].index].side).toBe(-1);
        world.onLock({ screen: { x: 0.85, y: 0.7 }, u: 0.1 }); // the click wins over the column
        start = onScreen(launches[1][0].from, camera);
        expect(start.x).toBeCloseTo(0.85, 4);
        expect(start.y).toBeCloseTo(0.7, 4);
        expect(world.blooms.plan[ordered()[1].index].side).toBe(1);
        world.dispose();
    });
});

describe('vesper world: the board on screen', () => {
    it('leaves from the fallback board\'s card when no board is on screen, and from the live card when one is', () => {
        const { camera, world } = makeWorld('Low', { live: false });
        const launches = record(world.moths, 'launch');
        expect(world.getState().layoutLive).toBe(false);
        // Where the solo board would hang in this frame.
        const fallback = cardUnion(world.layout);
        expect((fallback.x0 + fallback.x1) / 2).toBeCloseTo(0.5, 9);
        world.onLock({ u: 0.8, rows: [10] });
        let start = onScreen(launches[0][0].from, camera);
        expect(start.x).toBeCloseTo(fallback.x1, 4);
        expect(start.y).toBeCloseTo(boardPoint(world.layout.boards[0], 0.8, 10).y, 4);
        // A board appears, somewhere else entirely: two cards side by side.
        const rects = {
            cardCount: 2,
            cards: [{
                x0: 0.1, y0: 0.15, x1: 0.38, y1: 0.9,
            }, {
                x0: 0.6, y0: 0.15, x1: 0.88, y1: 0.9,
            }],
            hud: null,
            boards: [null, {
                x0: 0.13, y0: 0.3, x1: 0.35, y1: 0.86,
            }, {
                x0: 0.63, y0: 0.3, x1: 0.85, y1: 0.86,
            }, null, null],
        };
        world.setLayout(rects, 1600 / 900);
        expect(world.getState().layoutLive).toBe(true);
        // The second board's piece, on its right: out of the right edge of all the cards, at its own row.
        world.onLock({ u: 0.8, rows: [5], player: 2 });
        start = onScreen(launches[1][0].from, camera);
        expect(start.x).toBeCloseTo(0.88, 4);
        expect(start.y).toBeCloseTo(boardPoint(rects.boards[2], 0.8, 5).y, 4);
        expect(launches[1][0].to[0]).toBeGreaterThan(0); // to a lily on the right of the lake
        // The first board's piece, on its left: out of the left edge.
        world.onLock({ u: 0.1, rows: [16, 17, 18], player: 1 });
        start = onScreen(launches[2][0].from, camera);
        expect(start.x).toBeCloseTo(0.1, 4);
        expect(start.y).toBeCloseTo(boardPoint(rects.boards[1], 0.1, 17).y, 4); // the middle row it covers
        // A player with no board on screen is aimed through the first board there is.
        world.onLock({ u: 0.1, rows: [3], player: 4 });
        start = onScreen(launches[3][0].from, camera);
        expect(start.y).toBeCloseTo(boardPoint(rects.boards[1], 0.1, 3).y, 4);
        // The board goes: back to the fallback.
        world.setLayout(null);
        world.onLock({ u: 0.2, rows: [10] });
        start = onScreen(launches[4][0].from, camera);
        expect(start.x).toBeCloseTo(fallback.x0, 4);
        world.dispose();
    });

    it('fires the cleared rows out of the card as blades only while a board is live', () => {
        const { camera, world } = makeWorld('Low');
        const fires = record(world.blades, 'fire');
        const card = cardUnion(world.layout);
        const board = world.layout.boards[0];
        const t0 = world.time;
        world.onClear({ rows: [19, 17], lines: 2 });
        expect(fires).toHaveLength(1);
        let [ys, x0, x1, rgb, time, strength] = fires[0];
        expect(ys).toHaveLength(2);
        expect(ys[0]).toBeCloseTo(boardPoint(board, 0.5, 19).y, 9);
        expect(ys[1]).toBeCloseTo(boardPoint(board, 0.5, 17).y, 9);
        expect([x0, x1]).toEqual([card.x0, card.x1]);
        expect(time).toBe(t0);
        expect(strength).toBeGreaterThan(0);
        expect(rgb.every((c) => c > 0 && c <= 1)).toBe(true);
        // Where a blade ends it comes apart into scales, to either side of the card.
        const ends = dustInUse(world).map((scale) => onScreen(scale.at, camera).x);
        expect(ends.some((x) => x < card.x0)).toBe(true);
        expect(ends.some((x) => x > card.x1)).toBe(true);
        // With no rows named, the rows are the floor's; never more blades than the pool has.
        run(world, camera, 1);
        world.onClear({ lines: 3 });
        [ys] = fires[1];
        expect(ys).toHaveLength(3);
        expect(ys[0]).toBeCloseTo(boardPoint(board, 0.5, 19).y, 9);
        expect(ys[2]).toBeCloseTo(boardPoint(board, 0.5, 17).y, 9);
        world.onClear({ lines: 4, rows: [19, 18, 17, 16, 15, 14] });
        [ys, x0, x1, rgb, time, strength] = fires[2];
        expect(ys).toHaveLength(BLADE_SLOTS);
        // A clear that names a point on screen (a mode without a board) throws no blades...
        world.onClear({ lines: 2, screen: { x: 0.5, y: 0.5 } });
        expect(fires).toHaveLength(3);
        // ...nor does any clear once the board has left the screen; the swell still crosses the lake.
        world.setLayout(null);
        const swells = world.swellCursor;
        world.onClear({ rows: [19], lines: 1 });
        expect(fires).toHaveLength(3);
        expect(world.swellCursor).toBe(swells + 1);
        // And when the board is back, so are they.
        world.setLayout(fallbackLayout(1600, 900), 1600 / 900);
        world.onClear({ rows: [19], lines: 1 });
        expect(fires).toHaveLength(4);
        world.dispose();
    });
});

describe('vesper world: clears', () => {
    it('sends a swell from under the chrysalis, one front a line, stronger and in another colour for more', () => {
        const { camera, world } = makeWorld('Low');
        const seen = [];
        for (const lines of [1, 2, 3]) {
            const t0 = world.time;
            const cursor = world.swellCursor;
            world.onClear({ lines });
            expect(world.swellCursor).toBe(cursor + 1);
            const slot = world.u.swellA.findIndex((s) => s.value.x === t0);
            expect(slot).toBe(cursor % SWELL_SLOTS);
            const swell = world.u.swellA[slot].value;
            expect(swell.y).toBe(lines); // fronts
            expect(swell.z).toBeGreaterThan(0); // strength
            expect(swell.w).toBe(0); // not a four-line clear
            const colour = world.u.swellC[slot].value.toArray();
            expect(colour.every((c) => c > 0 && c <= 1)).toBe(true);
            expect(Math.max(...colour)).toBeCloseTo(1, 9);
            seen.push({ strength: swell.z, colour, storm: world.storm });
            expect(world.lastClear).toEqual({ time: t0, lines });
            expect(world.counts.clears).toBe(seen.length);
            run(world, camera, 0.4);
        }
        expect(seen[1].strength).toBeGreaterThan(seen[0].strength);
        expect(seen[2].strength).toBeGreaterThan(seen[1].strength);
        expect(seen[1].colour).not.toEqual(seen[0].colour);
        expect(seen[2].colour).not.toEqual(seen[1].colour);
        // No more lines than a board can clear at once, no fewer than one; nonsense is one line.
        for (const [lines, fronts] of [[0, 1], [-3, 1], ['two', 1], [undefined, 1], [2.4, 2], [9, 4]]) {
            run(world, camera, 0.1);
            const slot = world.swellCursor % SWELL_SLOTS;
            world.onClear({ lines });
            expect(world.u.swellA[slot].value.x, String(lines)).toBeGreaterThanOrEqual(world.time);
            expect(world.u.swellA[slot].value.y, String(lines)).toBe(fronts);
        }
        expect(() => world.onClear()).not.toThrow();
        world.dispose();
    });

    it('kicks the camera a beat after a clear and lights the wings and the post at once', () => {
        const { camera, world } = makeWorld('Low');
        run(world, camera, 1);
        const rest = { ...world.getPostState() };
        expect(world.kick).toBe(0);
        world.onClear({ lines: 3 });
        // Not yet: the kick lands with the swell's first fronts.
        expect(world.kick).toBe(0);
        expect(world.wingFlash).toBeGreaterThan(0);
        expect(world.storm).toBeGreaterThan(0);
        run(world, camera, 1 / 60, 1);
        expect(world.getPostState().shafts).toBeGreaterThan(rest.shafts);
        expect(world.getPostState().bloomBoost).toBeGreaterThan(rest.bloomBoost);
        expect(world.getPostState().exposure).toBeLessThan(1);
        let kicked = 0;
        for (let i = 0; i < 30; i++) {
            run(world, camera, 1 / 60, 1);
            kicked = Math.max(kicked, world.getPostState().kick);
        }
        expect(kicked).toBeGreaterThan(0);
        expect(world.pendingKick.time).toBe(Infinity);
        world.dispose();
    });

    it('lets every lit lily go of its light as the swell passes it, to the share it keeps', () => {
        const { camera, world, lit } = litWorld('Low');
        const t0 = world.time;
        world.onClear({ lines: 2, rows: [19, 18] });
        // One release a lit lily, each at the moment the first front reaches it; none for a dark one.
        const due = releases(world);
        expect(world.blooms.pending).toHaveLength(due.length);
        expect(due.map((e) => e.index).sort((a, b) => a - b)).toEqual(lit);
        const passes = new Map();
        for (const e of due) {
            const b = world.blooms.plan[e.index];
            expect(e.at).toBe(t0 + swellPassTime(b.x, b.z));
            expect(e.at).toBeGreaterThan(t0);
            // It carries the name of the swell that makes it (its birth), so the swell can call it off.
            expect(e.tag).toBe(t0);
            passes.set(e.index, { at: e.at, held: world.blooms.levelAt(e.index, e.at) });
        }
        // They are listed in the order the front will reach them.
        expect(due.map((e) => e.at)).toEqual([...due.map((e) => e.at)].sort((a, b) => a - b));
        // Until the front arrives a lily shines on; from then it falls, smoothly, to BLOOM_KEEP of what it held.
        const last = Math.max(...due.map((e) => e.at));
        let previous = levels(world);
        while (world.time < last + BLOOM_RISE * 3) {
            run(world, camera, 1 / 30, 1);
            const now = levels(world);
            for (const index of lit) {
                const pass = passes.get(index);
                const label = `lily ${index} at ${(world.time - t0).toFixed(3)} s`;
                if (world.time < pass.at) {
                    expect(world.blooms.state[index].t0, label).toBeLessThan(t0);
                } else {
                    const age = world.time - pass.at;
                    expect(now[index], label).toBeCloseTo(bloomLevel(pass.held, pass.held * BLOOM_KEEP, age), 9);
                }
                // Never a jump, never a rise: nothing lands on these lilies meanwhile.
                expect(now[index], label).toBeLessThanOrEqual(previous[index]);
                expect(previous[index] - now[index], label).toBeLessThan(pass.held * 0.5);
            }
            previous = now;
        }
        expect(world.blooms.pending).toHaveLength(0);
        for (const index of lit) {
            const pass = passes.get(index);
            const age = world.time - pass.at;
            expect(age).toBeGreaterThan(BLOOM_RISE);
            // About BLOOM_KEEP of what it held (the rest of the difference is the slow fade).
            expect(world.blooms.levelAt(index, world.time) / pass.held).toBeCloseTo(
                BLOOM_KEEP * Math.exp(-age / BLOOM_HOLD),
                9,
            );
            expect(world.blooms.state[index]).toMatchObject({ t0: pass.at });
            expect(world.blooms.state[index].to).toBeCloseTo(pass.held * BLOOM_KEEP, 9);
            expect(world.blooms.rows[index].x).toBe(pass.at);
        }
        // The lilies no swell had anything to take from are as dark as they were.
        for (let i = 0; i < world.blooms.count; i++) {
            if (!lit.includes(i)) expect(world.blooms.levelAt(i, world.time)).toBe(0);
        }
        world.dispose();
    });

    it('streams the light the lilies let go back to the chrysalis, which glows in it', () => {
        const { camera, world, lit } = litWorld('Low');
        const t0 = world.time;
        const tints = lit.map((index) => world.blooms.colourOf(index));
        expect(world.fed).toBe(0);
        world.onClear({ lines: 1 });
        // Scales leave each lily as the swell passes it, and every one of them ends at the chrysalis.
        const home = dustInUse(world).filter((scale) => scale.size < 0);
        expect(home.length).toBeGreaterThanOrEqual(lit.length);
        const sources = new Set();
        for (const scale of home) {
            const lily = lit.find((index) => {
                const b = world.blooms.plan[index];
                return Math.hypot(scale.at[0] - b.x, scale.at[2] - b.z) < b.size * 2;
            });
            expect(lily).not.toBeUndefined();
            sources.add(lily);
            const b = world.blooms.plan[lily];
            // It leaves when the front reaches its lily, or a moment after.
            expect(scale.time).toBeGreaterThan(t0 + swellPassTime(b.x, b.z) - 1e-3);
            expect(scale.time).toBeLessThan(t0 + swellPassTime(b.x, b.z) + 1);
            for (let k = 0; k < 3; k++) {
                expect(scale.at[k] + scale.velocity[k] * scale.life).toBeCloseTo(DUST_HOME[k], 2);
            }
        }
        expect([...sources].sort((a, b) => a - b)).toEqual(lit);
        // Nothing is fed until the light has had time to arrive; then the chrysalis takes it in...
        expect(world.pendingFed.time).toBeGreaterThan(t0);
        expect(world.pendingFed.time).toBeLessThan(t0 + 10);
        run(world, camera, world.pendingFed.time - t0 - 0.05);
        expect(world.fed).toBe(0);
        expect(world.u.fed.value.w).toBe(0);
        run(world, camera, 0.1);
        expect(world.fed).toBeGreaterThan(0);
        expect(world.fed).toBeLessThanOrEqual(1);
        expect(world.u.fed.value.w).toBe(world.fed);
        expect(world.pendingFed.time).toBe(Infinity);
        // ...in a colour between those the lilies held...
        const fedColour = world.u.fed.value.toArray().slice(0, 3);
        for (let k = 0; k < 3; k++) {
            expect(fedColour[k]).toBeGreaterThanOrEqual(Math.min(...tints.map((tint) => tint[k])) - 1e-9);
            expect(fedColour[k]).toBeLessThanOrEqual(Math.max(...tints.map((tint) => tint[k])) + 1e-9);
        }
        // ...and wakes for it, then settles.
        const { fed } = world;
        run(world, camera, 5);
        expect(world.fed).toBeLessThan(fed * 0.2);
        expect(world.u.fed.value.w).toBe(world.fed);
        world.dispose();
    });

    it('feeds the chrysalis nothing from a dark lake', () => {
        const { camera, world } = makeWorld('Low');
        world.onClear({ lines: 3 });
        expect(world.blooms.pending).toHaveLength(0);
        expect(world.pendingFed.time).toBe(Infinity);
        expect(dustInUse(world).filter((scale) => scale.size < 0)).toHaveLength(0);
        run(world, camera, 4);
        expect(world.fed).toBe(0);
        expect(world.getState().held).toBe(0);
        world.dispose();
    });

    /**
     * A dark lake with two moths in the air when a clear comes: one to the lily nearest the
     * chrysalis (the swell reaches it first, long before a moth can), one to the lily furthest
     * from it (its moth is there well before the swell).
     */
    function mothsAndSwell(quality = 'High') {
        const made = makeWorld(quality);
        const { camera, world } = made;
        const byPass = world.blooms.plan.map((b, index) => ({ index, pass: swellPassTime(b.x, b.z) }))
            .sort((a, b) => a.pass - b.pass);
        const near = byPass[0];
        const far = byPass.at(-1);
        // One moth is all but there when the clear comes...
        let from = world.screenToWorld(0.39, 0.6, MOTH_DEPTH, [0, 0, 0]);
        const early = { ...far, amount: 0.9, lands: world.sendMoth(far.index, from, [0.2, 0.5, 1], 0.9) };
        run(world, camera, early.lands - world.time - 0.05);
        expect(strikes(world)).toHaveLength(1); // ...but still in the air
        // ...the other leaves the card in the very frame of the clear.
        const t0 = world.time;
        from = world.screenToWorld(0.39, 0.6, MOTH_DEPTH, [0, 0, 0]);
        const late = { ...near, amount: 0.9, lands: world.sendMoth(near.index, from, [1, 0.5, 0.2], 0.9) };
        // The cases in question: the swell is at the one lily before its moth, at the other after.
        expect(t0 + late.pass).toBeLessThan(late.lands);
        expect(t0 + early.pass).toBeGreaterThan(early.lands);
        return {
            ...made, t0, late, early,
        };
    }

    // The piece that clears a line locks in the same frame: its moth is still in the air when the
    // swell reaches a near lily. If the clear counted every moth on its way, light would leave a
    // lily that is still shut and the chrysalis be "fed" light no lily held: it asks what each
    // lily will hold WHEN the front reaches it (blooms.heldAt).
    it('sends no light home from a lily that is still dark when the swell passes it', () => {
        const {
            world, t0, late, early,
        } = mothsAndSwell();
        world.onClear({ lines: 1, rows: [19] });
        // The lily whose moth is still in the air: nothing to let go, nothing sent home.
        expect(world.blooms.heldAt(late.index, t0 + late.pass)).toBe(0);
        expect(releases(world).filter((e) => e.index === late.index)).toEqual([]);
        // The lily its moth has reached by then lets go of what it holds at that moment.
        const held = world.blooms.heldAt(early.index, t0 + early.pass);
        expect(held).toBeGreaterThan(0.12);
        expect(releases(world)).toHaveLength(1);
        expect(releases(world)[0]).toMatchObject({ index: early.index, at: t0 + early.pass, tag: t0 });
        // Home-going scales leave only that one, in its moth's colour, and the chrysalis is fed that light alone.
        const home = dustInUse(world).filter((scale) => scale.size < 0);
        expect(home.length).toBeGreaterThan(0);
        const there = world.blooms.plan[early.index];
        for (const scale of home) {
            expect(Math.hypot(scale.at[0] - there.x, scale.at[2] - there.z)).toBeLessThan(there.size * 2);
            expect(scale.time).toBeGreaterThan(t0 + early.pass - 1e-3);
            expectHue(scale.rgb, [0.2, 0.5, 1], 4);
        }
        expect(world.pendingFed.time).toBeGreaterThan(t0 + early.pass);
        world.pendingFed.rgb.forEach((c, k) => expect(c).toBeCloseTo([0.2, 0.5, 1][k], 12));
        world.dispose();
        // A clear with only moths still in the air to meet: no release, no scales, no feed.
        const only = makeWorld('High');
        const first = only.world.blooms.plan.map((b, index) => ({ index, pass: swellPassTime(b.x, b.z) }))
            .sort((a, b) => a.pass - b.pass)[0];
        const from = only.world.screenToWorld(0.39, 0.6, MOTH_DEPTH, [0, 0, 0]);
        expect(only.world.sendMoth(first.index, from, [1, 1, 1], 1.25)).toBeGreaterThan(only.world.time + first.pass);
        only.world.onClear({ lines: 3 });
        expect(releases(only.world)).toEqual([]);
        expect(dustInUse(only.world).filter((scale) => scale.size < 0)).toEqual([]);
        expect(only.world.pendingFed.time).toBe(Infinity);
        only.world.dispose();
    });

    it('keeps the light of a moth that lands after the swell has passed, and takes one\'s that lands before', () => {
        const {
            camera, world, t0, late, early,
        } = mothsAndSwell();
        world.onClear({ lines: 1, rows: [19] });
        const foretold = world.blooms.heldAt(early.index, t0 + early.pass);
        run(world, camera, Math.max(late.lands, t0 + early.pass) - world.time + BLOOM_RISE * 2);
        expect(world.blooms.pending).toHaveLength(0);
        // The moth that came after the swell: the lily holds all it brought.
        expect(world.blooms.levelAt(late.index, world.time))
            .toBeCloseTo(bloomLevel(0, late.amount, world.time - late.lands), 9);
        // The moth that came before it: the lily let go of what it held when the front arrived.
        const age = world.time - (t0 + early.pass);
        expect(world.blooms.levelAt(early.index, world.time))
            .toBeCloseTo(bloomLevel(foretold, foretold * BLOOM_KEEP, age), 9);
        expect(world.blooms.levelAt(early.index, t0 + early.pass)).toBeCloseTo(foretold, 9);
        world.dispose();
    });

    // The lake draws SWELL_SLOTS swells. One more clear inside the oldest one's crossing takes its
    // slot, and that swell vanishes from the water: the releases it had still to make go with it
    // (blooms.cancel by the swell's tag), or lilies it had not reached would let go of their light
    // with no front anywhere near them. (Local multiplayer: boards clearing within the same
    // second is ordinary.)
    it('lets no lily go of its light for a swell the lake has stopped drawing', () => {
        const { camera, world } = litWorld('High');
        const births = [];
        for (let i = 0; i < SWELL_SLOTS; i++) {
            births.push(world.time);
            world.onClear({ lines: 1 });
            run(world, camera, 0.3);
        }
        // Every swell so far is on the water, and has releases still to make.
        for (const birth of births) expect(releases(world).some((e) => e.tag === birth)).toBe(true);
        const kept = releases(world).filter((e) => e.tag !== births[0]).length;
        births.push(world.time);
        world.onClear({ lines: 1 });
        // The oldest swell is gone from the water, and so is everything it had still to do...
        const onWater = world.u.swellA.map((slot) => slot.value.x);
        expect(onWater).not.toContain(births[0]);
        expect(releases(world).filter((e) => e.tag === births[0])).toEqual([]);
        // ...while the others keep theirs, and the new one has its own.
        expect(releases(world).filter((e) => e.tag !== births.at(-1))).toHaveLength(kept);
        expect(releases(world).some((e) => e.tag === births.at(-1))).toBe(true);
        run(world, camera, 0.3);
        const orphans = releases(world).filter((e) => {
            const b = world.blooms.plan[e.index];
            return !onWater.some((birth) => Math.abs(birth + swellPassTime(b.x, b.z) - e.at) < 1e-6);
        });
        expect(orphans.map((e) => `lily ${e.index} at ${e.at.toFixed(2)}`)).toEqual([]);
        // A swell that has run its course is replaced without a thought.
        run(world, camera, SWELL_LIVE + 1);
        expect(world.blooms.pending).toHaveLength(0);
        expect(() => world.onClear({ lines: 2 })).not.toThrow();
        world.dispose();
    });

    // A release's tag is its swell's birth, so no two swells may share one. Two boards clearing
    // in the same frame (local multiplayer) would: the second is born a microsecond later instead,
    // and when the lake stops drawing the first of the pair, cancel(tag) calls off its releases
    // only — the second is still on the water, and the lilies ahead of it still let go as it passes.
    it('keeps a swell\'s releases when the lake stops drawing another born in the same frame', () => {
        const { camera, world } = litWorld('High');
        const born = world.time;
        const pair = (slot) => Math.abs(slot.value.x - born) < 1e-3;
        world.onClear({ lines: 1, player: 1 });
        world.onClear({ lines: 2, player: 2 });
        for (let i = 2; i < SWELL_SLOTS; i++) {
            run(world, camera, 0.3);
            world.onClear({ lines: 1, player: 1 });
        }
        run(world, camera, 0.3);
        // Both swells of the pair are on the water, with lilies still to reach, under two tags.
        const births = world.u.swellA.filter(pair).map((slot) => slot.value.x).sort((a, b) => a - b);
        expect(births).toHaveLength(2);
        expect(births[0]).toBe(born);
        expect(births[1]).toBeGreaterThan(born);
        expect(releases(world).filter((e) => e.tag === births[1]).length).toBeGreaterThan(0);
        // One more clear takes the slot of the first of the pair.
        world.onClear({ lines: 1, player: 2 });
        expect(world.u.swellA.filter(pair).map((slot) => slot.value.x)).toEqual([births[1]]);
        expect(releases(world).filter((e) => e.tag === births[0])).toEqual([]);
        // The second is still crossing the lake: the lilies ahead of it still let go as it passes.
        expect(releases(world).filter((e) => e.tag === births[1]).length).toBeGreaterThan(0);
        world.dispose();
    });

    it('keeps the lilies\' list of changes in time order, and calls off one swell\'s releases by its tag', () => {
        const { camera, world } = makeWorld('Low');
        const { blooms } = world;
        const t = world.time;
        blooms.release(0, t + 3, 5);
        blooms.strike(2, [1, 1, 1], t + 1.5, 0.9);
        blooms.release(1, t + 2, 5);
        blooms.release(1, t + 3, 7);
        blooms.release(3, t + 2.5);
        blooms.strike(4, [1, 0, 0], t + 3, 0.5);
        const listed = () => blooms.pending.map((e) => `${e.kind} ${e.index} @${(e.at - t).toFixed(1)} #${e.tag}`);
        // In time order whatever order they came in; changes due at the same moment in the order they came.
        expect(listed()).toEqual([
            'strike 2 @1.5 #null', 'release 1 @2.0 #5', 'release 3 @2.5 #null', 'release 0 @3.0 #5',
            'release 1 @3.0 #7', 'strike 4 @3.0 #null',
        ]);
        // Calling off a tag takes that swell's releases and nothing else: not a moth, not another swell's.
        blooms.cancel(5);
        expect(listed()).toEqual([
            'strike 2 @1.5 #null', 'release 3 @2.5 #null', 'release 1 @3.0 #7', 'strike 4 @3.0 #null',
        ]);
        // No tag is no swell: untagged changes cannot be called off by accident.
        blooms.cancel(null);
        blooms.cancel(undefined);
        blooms.cancel(99);
        expect(blooms.pending).toHaveLength(4);
        // A change that could never come due, or that brings nothing, is not listed at all.
        blooms.strike(2, [1, 1, 1], NaN, 0.9);
        blooms.strike(2, [1, 1, 1], Infinity, 0.9);
        blooms.strike(2, [1, 1, 1], t + 1, 0);
        blooms.strike(2, [1, 1, 1], t + 1, -2);
        blooms.strike(2, [1, 1, 1], t + 1, NaN);
        blooms.strike(-1, [1, 1, 1], t + 1, 0.9);
        blooms.strike(blooms.count, [1, 1, 1], t + 1, 0.9);
        blooms.release(1, NaN, 7);
        blooms.release(blooms.count + 2, t + 1, 7);
        expect(blooms.pending).toHaveLength(4);
        // What is left comes due in its turn.
        run(world, camera, 4);
        expect(blooms.pending).toHaveLength(0);
        expect(litLilies(world)).toEqual([2, 4]);
        world.dispose();
    });

    it('lets every lily fade to nothing and drops what was on its way when it is told to let go', () => {
        const { camera, world, lit } = litWorld('High');
        const { blooms } = world;
        const from = world.screenToWorld(0.3, 0.5, MOTH_DEPTH, [0, 0, 0]);
        const dark = blooms.plan.findIndex((_, i) => !lit.includes(i));
        expect(dark).toBeGreaterThanOrEqual(0);
        world.sendMoth(dark, from, [1, 1, 1], 0.9);
        world.onClear({ lines: 2 });
        expect(blooms.pending.length).toBeGreaterThan(1);
        const t = world.time;
        const before = levels(world);
        const tints = blooms.tints.map((tint) => tint.toArray());
        const flashes = blooms.rows.map((row) => row.w);
        blooms.letGo(t);
        // Nothing on its way lands any more; nothing jumps: every lily starts from what it holds now...
        expect(blooms.pending).toEqual([]);
        expect(levels(world)).toEqual(before);
        blooms.plan.forEach((_, i) => {
            const state = blooms.state[i];
            if (lit.includes(i)) expect(state).toMatchObject({ t0: t, from: before[i], to: 0 });
            // The shader is told the same, keeps the lily's colour, and does not flash it.
            expect(blooms.rows[i].toArray()).toEqual([state.t0, state.from, state.to, flashes[i]]);
            expect(blooms.tints[i].toArray()).toEqual(tints[i]);
        });
        // ...and fades, smoothly, to nothing at all.
        let previous = before;
        for (let i = 0; i < 20; i++) {
            run(world, camera, BLOOM_RISE / 10, 1);
            const now = levels(world);
            for (const index of lit) {
                expect(now[index]).toBeLessThanOrEqual(previous[index]);
                expect(now[index]).toBeCloseTo(bloomLevel(before[index], 0, world.time - t), 9);
            }
            previous = now;
        }
        expect(world.getState().held).toBe(0);
        expect(levels(world).every((level) => level === 0)).toBe(true);
        // The moth that was in the air lands on a lily that stays shut.
        run(world, camera, 3);
        expect(world.getState().held).toBe(0);
        // The lake can be lit again, and a second letting go of a dark lake changes nothing.
        blooms.letGo(world.time);
        expect(blooms.state.every((s) => s.to === 0)).toBe(true);
        const landed = world.sendMoth(dark, from, [1, 1, 1], 0.9);
        run(world, camera, landed - world.time + BLOOM_RISE);
        expect(litLilies(world)).toEqual([dark]);
        world.dispose();
    });
});

describe('vesper world: the four-line clear, the perfect clear and the T-spin', () => {
    it('holds its breath on four lines, then lets everything go at once', () => {
        const { camera, world, lit } = litWorld('Low');
        run(world, camera, 2);
        const rest = { ...world.getPostState(), prism: { ...world.getPostState().prism } };
        const t0 = world.time;
        const birth = t0 + HUSH_HOLD;
        world.onClear({ lines: 4, rows: [19, 18, 17, 16] });
        expect(world.counts).toMatchObject({ clears: 1, quads: 1 });
        // The swell, its ring under the chrysalis and the ring through the frame all wait for the hush to end.
        const swell = world.u.swellA.find((slot) => slot.value.x === birth).value;
        expect(swell.y).toBe(4);
        expect(swell.w).toBe(1);
        expect(world.lastClear).toEqual({ time: birth, lines: 4 });
        expect(world.shock.time).toBe(birth);
        expect(world.shock.strength).toBeGreaterThan(0);
        expect(world.hushUntil).toBe(birth);
        expect(ringsBornAt(world, birth)).toHaveLength(1);
        expect(world.surge).toBeGreaterThan(0);
        // Every lit lily lets go as the delayed swell reaches it.
        for (const e of releases(world)) {
            const b = world.blooms.plan[e.index];
            expect(e.at).toBe(birth + swellPassTime(b.x, b.z));
        }
        expect(releases(world).map((e) => e.index).sort((a, b) => a - b)).toEqual(lit);

        // ── The hush: every light the evening makes sinks, and the post goes quiet ──
        let lowest = 1;
        const frames = 12;
        for (let i = 1; i < frames; i++) {
            run(world, camera, HUSH_HOLD / frames, 1);
            lowest = Math.min(lowest, world.u.breath.value);
            expect(world.u.breath.value).toBeLessThan(1);
            expect(world.getPostState().prism).toEqual({ radius: 0, strength: 0 });
            expect(world.getPostState().shafts).toBeLessThan(rest.shafts);
        }
        expect(lowest).toBeLessThan(0.5);
        expect(world.u.breath.value).toBe(world.breath);

        // ── Then the beat: a ring through the frame, the eyes open, the wings stroke, the breath comes back ──
        run(world, camera, (2 * HUSH_HOLD) / frames, 2);
        expect(world.time).toBeGreaterThan(birth);
        const { prism } = world.getPostState();
        expect(prism.radius).toBeGreaterThan(0);
        expect(prism.strength).toBeGreaterThan(0);
        expect(world.getPostState().shafts).toBeGreaterThan(rest.shafts);
        expect(world.getPostState().exposure).toBeLessThan(rest.exposure);
        expect(world.u.eyes.value.w).toBeGreaterThan(0);
        expect(world.u.aurora.value).toBeGreaterThan(0);
        const grown = prism.radius;
        run(world, camera, 0.5);
        expect(world.getPostState().prism.radius).toBeGreaterThan(grown);
        expect(world.u.breath.value).toBeGreaterThan(0.9);
        // The eyes look out for a moment even with no chain running.
        expect(world.combo).toBe(0);
        expect(world.u.eyes.value.x).toBeGreaterThan(0.5);
        expect(world.u.eyes.value.y).toBeGreaterThan(0.5);
        expect(world.beat).not.toBe(0);

        // ── The overdrive cools to 1/e in SURGE_COOL seconds, and everything closes again ──
        const { surge } = world;
        run(world, camera, SURGE_COOL, 300);
        expect(world.surge / surge).toBeCloseTo(Math.exp(-1), 6);
        expect(world.u.surge.value).toBe(world.surge);
        run(world, camera, SURGE_COOL * 12, 800);
        expect(world.surge).toBeLessThan(1e-4);
        expect(world.getPostState().prism).toEqual({ radius: 0, strength: 0 });
        expect(world.getPostState().exposure).toBeCloseTo(1, 3);
        expect(world.u.eyes.value.x).toBeLessThan(1e-3);
        expect(world.u.breath.value).toBeCloseTo(1, 6);
        world.dispose();
    });

    it('relights the whole lake on a perfect clear, hotter than four lines', () => {
        const plain = makeWorld('Low');
        plain.world.onClear({ lines: 4 });
        const { camera, world, lit } = litWorld('Low');
        const t0 = world.time;
        const birth = t0 + HUSH_HOLD;
        world.onClear({ lines: 1, perfect: true });
        // A four-line clear's ceremony, whatever the lines.
        expect(world.counts.quads).toBe(1);
        expect(world.u.swellA.find((slot) => slot.value.x === birth).value.y).toBe(4);
        expect(world.hushUntil).toBe(birth);
        expect(world.surge).toBeGreaterThan(plain.world.surge);
        // Every lily is promised new light, after the swell has taken the old.
        const promised = strikes(world);
        expect(promised.map((e) => e.index).sort((a, b) => a - b)).toEqual(world.blooms.plan.map((_, i) => i));
        for (const e of promised) {
            const b = world.blooms.plan[e.index];
            expect(e.at).toBeGreaterThan(birth + swellPassTime(b.x, b.z));
            expect(e.amount).toBeGreaterThan(0);
        }
        for (const e of releases(world)) {
            expect(lit).toContain(e.index);
            expect(promised.find((s) => s.index === e.index).at).toBeGreaterThan(e.at);
        }
        run(world, camera, Math.max(...promised.map((e) => e.at)) - world.time + BLOOM_RISE * 2);
        expect(world.blooms.pending).toHaveLength(0);
        expect(litLilies(world)).toHaveLength(world.blooms.count);
        for (const level of levels(world)) {
            expect(level).toBeGreaterThan(0.5);
            expect(level).toBeLessThanOrEqual(BLOOM_FULL);
        }
        plain.world.dispose();
        world.dispose();
    });

    it('beats the wings on a T-spin and rings the frame, without the hush', () => {
        const quad = makeWorld('Low');
        quad.world.onClear({ lines: 4 });
        const { camera, world } = makeWorld('Low');
        const plain = makeWorld('Low');
        const t0 = world.time;
        world.onClear({ lines: 2, tspin: true });
        plain.world.onClear({ lines: 2 });
        expect(world.counts.quads).toBe(0);
        expect(world.hushUntil).toBeLessThan(t0);
        expect(world.u.swellA.find((slot) => slot.value.x === t0).value.w).toBe(0);
        expect(world.storm).toBeGreaterThanOrEqual(plain.world.storm);
        expect(world.beatKick).toBeGreaterThan(plain.world.beatKick);
        // The ring through the frame starts now, fainter than a four-line clear's.
        expect(world.shock.time).toBe(t0);
        expect(world.shock.strength).toBeGreaterThan(0);
        expect(world.shock.strength).toBeLessThan(quad.world.shock.strength);
        run(world, camera, 0.1);
        run(plain.world, plain.camera, 0.1);
        expect(world.getPostState().prism.strength).toBeGreaterThan(0);
        expect(plain.world.getPostState().prism.strength).toBe(0);
        expect(world.u.breath.value).toBeGreaterThan(0.9);
        // A T-spin that clears four lines is a four-line clear: its ring waits for the hush.
        const both = makeWorld('Low');
        both.world.onClear({ lines: 4, tspin: true });
        expect(both.world.shock.time).toBe(both.world.time + HUSH_HOLD);
        expect(both.world.shock.strength).toBe(quad.world.shock.strength);
        for (const made of [quad, plain, both]) made.world.dispose();
        world.dispose();
    });
});

describe('vesper world: the chain', () => {
    it('unfurls the wings a step for every clear of a chain, over a moment, never at once', () => {
        const { camera, world } = makeWorld('Low');
        expect(world.wing).toBe(0);
        const t0 = world.time;
        world.onCombo(3);
        expect(world.combo).toBe(3);
        expect(world.wing).toBe(0); // not yet
        // The silk rings on both sides, and scales fly where the new band of wing is being written.
        const pulse = world.u.pulseA.find((slot) => slot.value.x === t0).value;
        expect(pulse.y).toBe(0);
        expect(pulse.z).toBeGreaterThan(0);
        expect(dustInUse(world).length).toBeGreaterThan(0);
        expect(world.wingFlash).toBeGreaterThan(0);
        const target = wingForCombo(3);
        let previous = 0;
        let frames = 0;
        while (world.wing < target && frames < 600) {
            run(world, camera, 1 / 60, 1);
            frames += 1;
            expect(world.wing).toBeGreaterThan(previous);
            expect(world.wing).toBeLessThanOrEqual(target);
            expect(world.u.wing.value.x).toBe(world.wing);
            expect(world.u.wing.value.z).toBe(0); // nothing is falling
            previous = world.wing;
        }
        // A few steps, not one, and not for ever.
        expect(frames).toBeGreaterThan(5);
        expect(frames).toBeLessThan(600);
        expect(world.wing).toBe(target);
        run(world, camera, 3);
        expect(world.wing).toBe(target);
        expect(world.getState().wing).toBe(target);
        // The chrysalis charges with it, cracks, and lights a point of its diadem for every step.
        expect(world.power).toBeCloseTo(powerForCombo(3), 2);
        expect(world.u.power.value).toBe(world.power);
        expect(world.u.combo.value).toBe(3);
        expect(world.u.crack.value).toBeGreaterThan(0);
        expect(world.u.crack.value).toBeLessThanOrEqual(1);
        expect(world.u.wake.value).toBeGreaterThan(0);
        // The next step writes the next band.
        world.onCombo(4);
        run(world, camera, 3);
        expect(world.wing).toBe(wingForCombo(4));
        expect(world.wing).toBeGreaterThan(target);
        // The same number again is no step: nothing rings, nothing falls.
        const pulses = world.pulseCursor;
        world.onCombo(4);
        expect(world.pulseCursor).toBe(pulses);
        expect(world.counts.falls).toBe(0);
        world.dispose();
    });

    it('lets the wings fall when the chain drops to a lower step: it broke, and a new one has begun', () => {
        // The game reports a break only with the next lock. When that lock clears, the world is
        // never told "0": the chain goes straight from its old length to 1 (or, with several
        // boards, to the longest chain left). The wings that stood fall all the same.
        const { camera, world } = makeWorld('Low');
        world.onCombo(4);
        run(world, camera, 3);
        const open = world.wing;
        expect(open).toBe(wingForCombo(4));
        const scales = dustInUse(world).length;
        const fell = world.time;
        world.onCombo(1);
        expect(world.combo).toBe(1);
        expect(world.counts.falls).toBe(1);
        expect(dustInUse(world).length).toBeGreaterThan(scales); // they shed their scales
        // The old wings burn away whole: they are not redrawn at the new step meanwhile.
        const steps = 10;
        for (let i = 1; i < steps; i++) {
            run(world, camera, WING_FALL / steps, 3);
            expect(world.u.wing.value.x, `step ${i}`).toBe(open);
            expect(world.u.wing.value.z, `step ${i}`).toBeCloseTo((world.time - fell) / WING_FALL, 9);
            expect(world.u.combo.value, `step ${i}`).toBe(1);
        }
        // Then the new chain's wings are written, from nothing, to its own step.
        run(world, camera, (2 * WING_FALL) / steps, 6);
        expect(world.u.wing.value.z).toBe(0);
        expect(world.wing).toBeGreaterThan(0);
        expect(world.wing).toBeLessThan(wingForCombo(1));
        run(world, camera, 3);
        expect(world.wing).toBe(wingForCombo(1));
        // Any lower number does it, not only 1: 3 -> 2 is a break as well.
        world.onCombo(3);
        run(world, camera, 3);
        world.onCombo(2);
        expect(world.counts.falls).toBe(2);
        run(world, camera, WING_FALL / 2);
        expect(world.u.wing.value.x).toBe(wingForCombo(3));
        expect(world.u.wing.value.z).toBeGreaterThan(0.4);
        run(world, camera, WING_FALL / 2 + 3);
        expect(world.wing).toBe(wingForCombo(2));
        expect(world.u.wing.value.z).toBe(0);
        world.dispose();
    });

    it('opens every step of the way to full, and stays full beyond it', () => {
        const { camera, world } = makeWorld('Low');
        for (let n = 1; n <= WING_STEPS.length + 2; n++) {
            world.onCombo(n);
            run(world, camera, 2.5);
            expect(world.wing, `combo ${n}`).toBe(wingForCombo(n));
            expect(world.u.wing.value.x, `combo ${n}`).toBe(wingForCombo(n));
            expect(world.power, `combo ${n}`).toBeLessThan(1);
            expect(world.u.crack.value, `combo ${n}`).toBeLessThanOrEqual(1);
            expect(world.u.eyes.value.z, `combo ${n}`).toBeGreaterThanOrEqual(0);
            expect(world.u.eyes.value.z, `combo ${n}`).toBeLessThanOrEqual(1);
        }
        expect(world.wing).toBe(1);
        // Anything that is not a count is no chain; a count given as text is a count.
        for (const junk of [NaN, undefined, null, 'x', -4]) {
            const made = makeWorld('Minimal');
            made.world.onCombo(junk);
            expect(made.world.combo, String(junk)).toBe(0);
            made.world.dispose();
        }
        world.onCombo('12');
        expect(world.combo).toBe(12);
        world.dispose();
    });

    it('opens the eyes of the hindwings, then of the forewings, at their steps of the chain', () => {
        const { camera, world } = makeWorld('Low');
        const eyes = () => [world.u.eyes.value.x, world.u.eyes.value.y];
        world.onCombo(EYE_COMBO.hind - 1);
        run(world, camera, 3);
        expect(eyes()).toEqual([0, 0]);
        world.onCombo(EYE_COMBO.hind);
        run(world, camera, 1 / 60, 1);
        expect(eyes()[0]).toBeGreaterThan(0);
        expect(eyes()[0]).toBeLessThan(0.5); // opening, not open
        run(world, camera, 3);
        expect(eyes()[0]).toBeGreaterThan(0.99);
        expect(eyes()[1]).toBe(0);
        world.onCombo(EYE_COMBO.fore - 1);
        run(world, camera, 3);
        expect(eyes()[1]).toBe(0);
        world.onCombo(EYE_COMBO.fore);
        run(world, camera, 3);
        expect(eyes()[0]).toBeGreaterThan(0.99);
        expect(eyes()[1]).toBeGreaterThan(0.99);
        // They close when the chain is gone.
        world.onCombo(0);
        run(world, camera, 4);
        expect(eyes()[0]).toBeLessThan(1e-3);
        expect(eyes()[1]).toBeLessThan(1e-3);
        world.dispose();
    });

    it('lets the wings fall to dust when the chain breaks, in WING_FALL seconds, to nothing', () => {
        const { camera, world } = makeWorld('Low');
        world.onCombo(5);
        run(world, camera, 3);
        const open = world.wing;
        expect(open).toBe(wingForCombo(5));
        const scales = dustInUse(world).length;
        const t0 = world.time;
        world.onCombo(0);
        expect(world.combo).toBe(0);
        expect(world.counts.falls).toBe(1);
        // They shed their scales as they go.
        expect(dustInUse(world).length).toBeGreaterThan(scales);
        // The wings stay as they were while they burn away from the margin inward: the fall runs 0..1.
        const steps = 20;
        for (let i = 1; i < steps; i++) {
            run(world, camera, WING_FALL / steps, 3);
            expect(world.wing, `step ${i}`).toBe(open);
            expect(world.u.wing.value.x, `step ${i}`).toBe(open);
            expect(world.u.wing.value.z, `step ${i}`).toBeCloseTo((world.time - t0) / WING_FALL, 9);
        }
        expect(world.u.wing.value.z).toBeGreaterThan(0.9);
        expect(world.time).toBeLessThan(t0 + WING_FALL);
        // And then they are gone: nothing left to draw, nothing left falling.
        run(world, camera, (2 * WING_FALL) / steps, 6);
        expect(world.time).toBeGreaterThan(t0 + WING_FALL);
        expect(world.wing).toBe(0);
        expect(world.u.wing.value.x).toBe(0);
        expect(world.u.wing.value.z).toBe(0);
        run(world, camera, 2);
        expect(world.wing).toBe(0);
        expect(world.getState().wing).toBe(0);
        // Breaking a chain that is already broken does nothing.
        world.onCombo(0);
        expect(world.counts.falls).toBe(1);
        world.dispose();
    });

    it('makes a new chain\'s wings wait until the old ones have finished falling', () => {
        const { camera, world } = makeWorld('Low');
        world.onCombo(6);
        run(world, camera, 3);
        const open = world.wing;
        expect(open).toBe(wingForCombo(6));
        const fell = world.time;
        world.onCombo(0);
        run(world, camera, WING_FALL * 0.4);
        expect(world.u.wing.value.z).toBeGreaterThan(0);
        const scales = world.dust.cursor;
        const pulses = world.pulseCursor;
        // A new chain begins, and grows, while the old wings are still burning away.
        let quiet = { flash: world.wingFlash, stroke: world.beatKick };
        world.onCombo(1);
        expect(world.wing).toBe(open); // nothing is cut short
        expect({ flash: world.wingFlash, stroke: world.beatKick }).toEqual(quiet);
        run(world, camera, WING_FALL * 0.2);
        quiet = { flash: world.wingFlash, stroke: world.beatKick };
        world.onCombo(2);
        expect(world.combo).toBe(2);
        expect(world.counts.falls).toBe(1);
        // The silk still rings for each step...
        expect(world.pulseCursor).toBe(pulses + 2);
        // ...but no scales fly, nothing flashes and the wings do not beat: there is no wing to write on yet.
        expect(world.dust.cursor).toBe(scales);
        expect({ flash: world.wingFlash, stroke: world.beatKick }).toEqual(quiet);
        // The fall runs its whole course, as if nothing had happened.
        while (world.time + 2 / 60 < fell + WING_FALL) {
            run(world, camera, 1 / 60, 1);
            expect(world.wing).toBe(open);
            expect(world.u.wing.value.x).toBe(open);
            expect(world.u.wing.value.z).toBeCloseTo((world.time - fell) / WING_FALL, 9);
        }
        expect(world.u.wing.value.z).toBeGreaterThan(0.9);
        // Then the old wings are gone, and the new chain's are written from the root to its step.
        run(world, camera, 3 / 60, 3);
        expect(world.time).toBeGreaterThan(fell + WING_FALL);
        expect(world.u.wing.value.z).toBe(0);
        expect(world.wing).toBeGreaterThan(0);
        expect(world.wing).toBeLessThan(wingForCombo(2) * 0.5);
        let previous = world.wing;
        for (let i = 0; i < 30; i++) {
            run(world, camera, 1 / 60, 1);
            expect(world.wing).toBeGreaterThan(previous);
            expect(world.wing).toBeLessThanOrEqual(wingForCombo(2));
            expect(world.u.wing.value.z).toBe(0);
            previous = world.wing;
        }
        run(world, camera, 3);
        expect(world.wing).toBe(wingForCombo(2));
        // Well after the old fall has ended, nothing snaps the new wings shut.
        run(world, camera, WING_FALL * 2);
        expect(world.wing).toBe(wingForCombo(2));
        // The next step, with no fall in the way, is written at once, with its scales and its flash.
        world.onCombo(3);
        expect(world.dust.cursor).toBeGreaterThan(scales);
        expect(world.wingFlash).toBeGreaterThan(0.5);
        world.dispose();
    });

    it('drops no second pair of wings when a chain that began during a fall breaks before the fall is over', () => {
        const { camera, world } = makeWorld('Low');
        world.onCombo(5);
        run(world, camera, 3);
        const open = world.wing;
        const fell = world.time;
        world.onCombo(0);
        run(world, camera, WING_FALL * 0.3);
        world.onCombo(1);
        world.onCombo(2);
        run(world, camera, WING_FALL * 0.3);
        const scales = world.dust.cursor;
        world.onCombo(0);
        // The wings on screen are still the old ones, part burned: they are not dropped again.
        expect(world.counts.falls).toBe(1);
        expect(world.dust.cursor).toBe(scales);
        expect(world.fallStart).toBe(fell);
        run(world, camera, 1 / 60, 1);
        expect(world.u.wing.value.x).toBe(open);
        expect(world.u.wing.value.z).toBeCloseTo((world.time - fell) / WING_FALL, 9);
        run(world, camera, WING_FALL);
        expect(world.wing).toBe(0);
        expect(world.u.wing.value.z).toBe(0);
        run(world, camera, 2);
        expect(world.wing).toBe(0);
        world.dispose();
    });

    it('has nothing to drop when a chain breaks before its wings have shown', () => {
        for (const [long, short] of [[1, 0], [3, 1], [5, 4]]) {
            const { camera, world } = makeWorld('Low');
            world.onCombo(long);
            world.onCombo(short);
            expect(world.counts.falls, `${long} -> ${short}`).toBe(0);
            run(world, camera, 1 / 60, 1);
            expect(world.u.wing.value.z, `${long} -> ${short}`).toBe(0);
            run(world, camera, 3);
            expect(world.wing, `${long} -> ${short}`).toBe(wingForCombo(short));
            world.dispose();
        }
    });

    /** A run at its busiest: wings open at the fourth step, lilies lit, three moths in the air, a four-line clear in its hush. */
    function busyRun() {
        const made = makeWorld('High');
        const { camera, world } = made;
        world.levelUp(3);
        world.onLock({ u: 0.4, hardDrop: true });
        world.onClear({ lines: 2 });
        world.onCombo(4);
        run(world, camera, 3);
        world.onLock({ u: 0.7, hardDrop: true });
        world.onClear({ lines: 4 });
        run(world, camera, HUSH_HOLD / 2, 4);
        return made;
    }

    it('starts a new run softly: the chain breaks, the lilies begin to fade, and nothing on screen jumps', () => {
        const { world } = busyRun();
        const open = world.wing;
        expect(open).toBe(wingForCombo(4));
        // The moment before: light on the lake, moths and a swell's releases on their way, the hush on.
        expect(world.getState().held).toBeGreaterThan(0);
        expect(strikes(world).length).toBeGreaterThan(0);
        expect(releases(world).length).toBeGreaterThan(0);
        expect(world.u.breath.value).toBeLessThan(0.9);
        expect(world.pendingKick.time).not.toBe(Infinity);
        expect(world.pendingFed.time).not.toBe(Infinity);
        const slots = () => ['ringA', 'ringC', 'swellA', 'swellC', 'pulseA', 'pulseC']
            .flatMap((key) => world.u[key].flatMap((slot) => slot.value.toArray()));
        const before = {
            time: world.time,
            drift: world.drift,
            levels: levels(world),
            dust: dustSnapshot(world),
            slots: slots(),
            cursors: [world.moths.cursor, world.ringCursor, world.swellCursor, world.pulseCursor],
            decaying: [world.surge, world.storm, world.power, world.flash, world.kick, world.eyeFlash, world.fed],
            shock: { ...world.shock },
            lastClear: { ...world.lastClear },
            breath: world.breath,
        };
        expect(before.drift).toBeGreaterThan(before.time); // the run has carried the clouds further than the clock alone
        world.resetSession();

        // ── What is forgotten ──
        expect(world.combo).toBe(0);
        expect(world.counts).toEqual({
            locks: 0, clears: 0, quads: 0, moths: 0, falls: 0,
        });
        expect(world.blooms.pending).toEqual([]); // nothing still on its way will land
        expect(world.pendingKick.time).toBe(Infinity);
        expect(world.pendingFed.time).toBe(Infinity);
        expect(world.hushUntil).toBeLessThan(world.time);
        // ── What breaks: the chain still standing; its wings begin to fall, they do not vanish ──
        expect(world.wing).toBe(open);
        expect(world.fallStart).toBe(before.time);
        expect(world.fallFrom).toBe(open);
        // ── What stays exactly as it was, to run out by itself ──
        expect(world.time).toBe(before.time);
        expect(world.drift).toBe(before.drift);
        expect(world.getState()).toMatchObject({ level: 3, palette: VESPER_PALETTES[2].name, layoutLive: true });
        expect(levels(world)).toEqual(before.levels); // every lily starts its fade from what it holds
        expect(slots()).toEqual(before.slots); // every ring, swell and pulse
        expect([world.moths.cursor, world.ringCursor, world.swellCursor, world.pulseCursor]).toEqual(before.cursors);
        expect([world.surge, world.storm, world.power, world.flash, world.kick, world.eyeFlash, world.fed])
            .toEqual(before.decaying);
        expect(world.shock).toEqual(before.shock);
        expect(world.lastClear).toEqual(before.lastClear);
        expect(world.breath).toBe(before.breath);
        // Every scale already thrown is still there (the falling wings add theirs).
        const dust = dustSnapshot(world);
        expect(dust.length).toBeGreaterThan(before.dust.length);
        expect(dust.slice(0, before.dust.length)).toEqual(before.dust);
        world.dispose();
    });

    it('lets what is in the air run out after a new run begins: the fall, the fade, the moths, the swell', () => {
        const { camera, world } = busyRun();
        const open = world.wing;
        const reset = world.time;
        const { surge, storm } = world;
        const birth = world.lastClear.time; // the four-line clear's swell is still to start
        expect(birth).toBeGreaterThan(reset);
        world.resetSession();
        // The hush is over at once: the breath comes back (less the sigh of the falling wings)...
        let previous = world.u.breath.value;
        let kicked = world.kick;
        let { fed } = world;
        const held = [world.getState().held];
        for (let i = 0; i < 30; i++) {
            run(world, camera, 1 / 60, 1);
            expect(world.u.breath.value).toBeGreaterThanOrEqual(previous);
            previous = world.u.breath.value;
            // ...the kick that was due with the swell never comes, nor the chrysalis's feed...
            expect(world.kick).toBeLessThanOrEqual(kicked);
            kicked = world.kick;
            expect(world.fed).toBeLessThanOrEqual(fed);
            ({ fed } = world);
            // ...the wings fall as any broken chain's do...
            expect(world.u.wing.value.x).toBe(open);
            expect(world.u.wing.value.z).toBeCloseTo((world.time - reset) / WING_FALL, 9);
            // ...and the lilies fade, none of them flaring up on the way.
            held.push(world.getState().held);
            expect(held.at(-1)).toBeLessThanOrEqual(held.at(-2));
        }
        expect(previous).toBeGreaterThan(0.6);
        // The swell that was about to start still crosses the lake, and its ring still goes through the frame.
        expect(world.u.swellA.some((slot) => slot.value.x === birth)).toBe(true);
        expect(world.u.swellLive.value).toBe(1);
        expect(world.getPostState().prism.strength).toBeGreaterThan(0);
        // The overdrive cools as it would have.
        expect(world.surge).toBeLessThan(surge);
        expect(world.surge).toBeGreaterThan(surge * 0.5);
        expect(world.storm).toBeLessThan(storm);
        // In the time a lily takes to open, the lake is dark; the moths that were in the air land on shut lilies.
        run(world, camera, BLOOM_RISE);
        expect(world.getState().held).toBe(0);
        run(world, camera, 3);
        expect(world.getState().held).toBe(0);
        expect(litLilies(world)).toEqual([]);
        expect(world.fed).toBeLessThanOrEqual(fed);
        expect(world.pendingFed.time).toBe(Infinity);
        expect(world.wing).toBe(0);
        expect(world.u.wing.value.z).toBe(0);
        expect(world.counts).toEqual({
            locks: 0, clears: 0, quads: 0, moths: 0, falls: 0,
        });
        // The new run plays from there: the lake is there to be lit, the chrysalis to be woken.
        world.onLock({ u: 0.2 });
        world.onClear({ lines: 1 });
        world.onCombo(1);
        expect(world.counts).toMatchObject({ locks: 1, clears: 1, moths: 1 });
        run(world, camera, 3);
        expect(world.getState().held).toBeGreaterThan(0);
        expect(world.wing).toBe(wingForCombo(1));
        world.dispose();
    });

    it('breaks no chain twice at a new run, and leaves a dark, shut evening as it is', () => {
        const { camera, world } = makeWorld('Low');
        // Nothing going on: a new run changes nothing at all.
        run(world, camera, 1);
        const rest = snapshot(world, camera);
        world.resetSession();
        expect(snapshot(world, camera)).toEqual(rest);
        expect(world.counts.falls).toBe(0);
        // Wings already falling fall on: the reset does not drop them again.
        world.onCombo(5);
        run(world, camera, 3);
        const open = world.wing;
        const fell = world.time;
        world.onCombo(0);
        run(world, camera, WING_FALL * 0.3);
        const scales = world.dust.cursor;
        world.resetSession();
        world.resetSession();
        expect(world.fallStart).toBe(fell);
        expect(world.dust.cursor).toBe(scales);
        run(world, camera, 1 / 60, 1);
        expect(world.u.wing.value.x).toBe(open);
        expect(world.u.wing.value.z).toBeCloseTo((world.time - fell) / WING_FALL, 9);
        run(world, camera, WING_FALL);
        expect(world.wing).toBe(0);
        // A chain that began during that fall is forgotten with the run: no wings rise for it.
        world.onCombo(3);
        run(world, camera, 3);
        world.onCombo(0);
        run(world, camera, WING_FALL * 0.5);
        world.onCombo(2);
        world.resetSession();
        expect(world.combo).toBe(0);
        run(world, camera, WING_FALL + 3);
        expect(world.wing).toBe(0);
        expect(world.u.combo.value).toBe(0);
        // Wings that have not shown yet have nothing to drop.
        world.onCombo(2);
        world.resetSession();
        expect(world.combo).toBe(0);
        expect(world.counts.falls).toBe(0);
        run(world, camera, 2);
        expect(world.wing).toBe(0);
        world.dispose();
    });

    it('lets the wings fall when the run ends, through the session reset that follows in the same frame', () => {
        const { camera, world } = makeWorld('High');
        world.onCombo(5);
        run(world, camera, 3);
        const open = world.wing;
        const t0 = world.time;
        // As the theme does on game over: the world marks the ending, then the session is reset.
        world.onGameOver();
        world.resetSession();
        expect(world.combo).toBe(0);
        expect(world.wing).toBe(open);
        run(world, camera, WING_FALL / 2);
        expect(world.u.wing.value.x).toBe(open);
        expect(world.u.wing.value.z).toBeCloseTo((world.time - t0) / WING_FALL, 9);
        run(world, camera, WING_FALL / 2 + 0.1);
        expect(world.wing).toBe(0);
        expect(world.u.wing.value.z).toBe(0);
        // A run that ends with no chain has nothing to drop.
        world.onGameOver();
        world.resetSession();
        run(world, camera, 1 / 60, 1);
        expect(world.wing).toBe(0);
        expect(world.u.wing.value.z).toBe(0);
        world.dispose();
    });

    // The scales the falling wings shed are thrown the moment the chain breaks. The session reset
    // that follows a game over in the same frame must leave them in the air, or the wings burn
    // away at the end of a run with no dust at all, while a chain that merely breaks sheds hundreds.
    it('sheds the falling wings\' scales when the run ends, as it does when a chain breaks', () => {
        const { camera, world } = makeWorld('High');
        world.onCombo(5);
        run(world, camera, 6);
        expect(dustInUse(world).filter((scale) => scale.time + scale.life > world.time)).toEqual([]);
        const before = dustInUse(world).length;
        world.onGameOver();
        const shed = dustInUse(world).length;
        expect(shed - before).toBeGreaterThan(20);
        const thrown = dustSnapshot(world);
        world.resetSession();
        expect(dustInUse(world).length).toBe(shed);
        expect(dustSnapshot(world)).toEqual(thrown);
        // A new run with wings open and no game over before it sheds them just the same.
        const other = makeWorld('High');
        other.world.onCombo(5);
        run(other.world, other.camera, 6);
        other.world.resetSession();
        expect(dustInUse(other.world).length).toBe(shed);
        expect(other.world.fallFrom).toBe(wingForCombo(5));
        other.world.dispose();
        world.dispose();
    });

    it('moves the evening on an hour with the level, easing the sky, and cycles through its hours', () => {
        const { camera, world } = makeWorld('Low');
        // (The evening also moves on by itself — the next test. Held still, a level's hour is exact.)
        world.setHourDrift(false);
        world.applyPalette(1);
        frame(world, camera, world.time, 0);
        const colour = (palette) => PALETTE_KEYS.flatMap((key) => palette[key]);
        const shown = () => PALETTE_KEYS.flatMap((key) => world.u[key].value.toArray());
        const gap = (palette) => Math.max(...shown().map((v, i) => Math.abs(v - colour(palette)[i])));
        expect(gap(VESPER_PALETTES[0])).toBeLessThan(1e-6);
        expect(world.u.night.value).toBeCloseTo(VESPER_PALETTES[0].night, 6);
        world.levelUp(2);
        expect(world.getState()).toMatchObject({ level: 2, palette: VESPER_PALETTES[1].name });
        expect(world.storm).toBeGreaterThan(0);
        expect(world.flash).toBeGreaterThan(0);
        // The sky does not jump: it is still the old hour on the next frame, and the new one a while later.
        run(world, camera, 1 / 60, 1);
        const started = gap(VESPER_PALETTES[1]);
        expect(gap(VESPER_PALETTES[0])).toBeLessThan(started);
        expect(world.getPostState().prism.strength).toBeGreaterThan(0); // a ring through the frame
        let previous = started;
        for (let i = 0; i < 10; i++) {
            run(world, camera, 0.5);
            expect(gap(VESPER_PALETTES[1])).toBeLessThan(previous);
            previous = gap(VESPER_PALETTES[1]);
        }
        run(world, camera, 20, 400);
        expect(gap(VESPER_PALETTES[1])).toBeLessThan(1e-4);
        expect(world.u.night.value).toBeCloseTo(VESPER_PALETTES[1].night, 4);
        // A rebuild in the middle of a run comes back at its hour at once, without the ceremony.
        const quiet = makeWorld('Low');
        quiet.world.setHourDrift(false);
        quiet.world.levelUp(4, { silent: true });
        expect(quiet.world.storm).toBe(0);
        expect(quiet.world.flash).toBe(0);
        frame(quiet.world, quiet.camera, quiet.world.time, 0);
        const quietGap = Math.max(...PALETTE_KEYS.flatMap((key) => quiet.world.u[key].value.toArray())
            .map((v, i) => Math.abs(v - colour(VESPER_PALETTES[3])[i])));
        expect(quietGap).toBeLessThan(1e-6);
        expect(quiet.world.getPostState().prism.strength).toBe(0);
        quiet.world.dispose();
        // The hours come round again, and nonsense is the first level.
        for (let level = 1; level <= VESPER_PALETTES.length * 2 + 1; level++) {
            world.levelUp(level);
            expect(world.getState().palette).toBe(VESPER_PALETTES[(level - 1) % VESPER_PALETTES.length].name);
        }
        for (const junk of [NaN, undefined, 0, -3, 'x']) {
            world.levelUp(junk);
            expect(world.getState(), String(junk)).toMatchObject({ level: 1, palette: VESPER_PALETTES[0].name });
        }
        world.levelUp(2.6);
        expect(world.getState().level).toBe(3);
        world.dispose();
    });

    it('moves the evening on by itself, slowly, whatever the level and whatever is played', () => {
        const { camera, world } = makeWorld('Low');
        const shown = () => PALETTE_KEYS.flatMap((key) => world.u[key].value.toArray());
        const wanted = (hour) => {
            const palette = paletteAt(hour);
            return PALETTE_KEYS.flatMap((key) => palette[key]);
        };
        const gap = (hour) => Math.max(...shown().map((v, i) => Math.abs(v - wanted(hour)[i])));
        // The hour is the level's plus the time on the clock, an hour every HOUR_SECONDS.
        const t0 = world.time;
        expect(world.getState().hour).toBeCloseTo(t0 / HOUR_SECONDS, 12);
        expect(world.hourNow()).toBe(hourAt(1, t0));
        // It drifts with nothing played: half an hour on, the sky is half way to the next hour
        // (the eased colours trail the moving target by a hair), and is neither hour's own.
        run(world, camera, HOUR_SECONDS * 0.5 - t0, 600);
        expect(world.getState()).toMatchObject({ level: 1, palette: VESPER_PALETTES[0].name });
        expect(world.getState().hour).toBeCloseTo(0.5, 9);
        expect(gap(0.5)).toBeLessThan(0.02);
        expect(gap(0)).toBeGreaterThan(0.05);
        expect(gap(1)).toBeGreaterThan(0.05);
        // A whole hour on it has arrived at the next hour, with the level where it was.
        run(world, camera, HOUR_SECONDS * 0.5, 600);
        expect(world.getState().hour).toBeCloseTo(1, 9);
        expect(gap(1)).toBeLessThan(0.02);
        expect(world.u.night.value).toBeCloseTo(VESPER_PALETTES[1].night, 1);
        expect(world.getState().level).toBe(1);
        // Never a jump: from one frame to the next the colours move by next to nothing.
        const furthest = (a, b) => Math.max(...a.map((v, k) => Math.abs(v - b[k])));
        let previous = shown();
        let largest = 0;
        for (let i = 0; i < 240; i++) {
            run(world, camera, 0.25, 1);
            const now = shown();
            largest = Math.max(largest, furthest(now, previous));
            previous = now;
        }
        expect(largest).toBeGreaterThan(0);
        expect(largest).toBeLessThan(0.01);
        // A level-up moves it on one more hour on top of where time had brought it…
        const before = world.hourNow();
        world.levelUp(2);
        expect(world.hourNow()).toBeCloseTo(before + 1, 12);
        // …play does not hurry or hold it…
        const played = world.hourNow();
        world.onLock({ u: 0.3, hardDrop: true });
        world.onCombo(4);
        world.onClear({ lines: 4 });
        run(world, camera, 12, 240);
        expect(world.hourNow()).toBeCloseTo(played + 12 / HOUR_SECONDS, 9);
        // …a new run keeps it, and the hours come round again.
        world.resetSession();
        expect(world.hourNow()).toBeCloseTo(played + 12 / HOUR_SECONDS, 9);
        const whole = paletteAt(world.hourNow() + VESPER_PALETTES.length);
        const same = paletteAt(world.hourNow());
        PALETTE_KEYS.forEach((key) => same[key].forEach((v, c) => expect(whole[key][c]).toBeCloseTo(v, 9)));
        // Held still (a capture of one level's hour), it is that hour whatever the clock says.
        world.setHourDrift(false);
        expect(world.hourNow()).toBe(1);
        world.applyPalette(1);
        frame(world, camera, world.time, 0);
        expect(gap(1)).toBeLessThan(1e-6);
        world.dispose();
    });
});

describe('vesper world: reduced motion', () => {
    it('stills the camera and the lens, shortens a moth\'s flight, softens the ring, and keeps the feedback', () => {
        const calm = makeWorld('Low', { reduced: true });
        const lively = makeWorld('Low');
        const calmLaunches = record(calm.world.moths, 'launch');
        const livelyLaunches = record(lively.world.moths, 'launch');
        const calmStrikes = recordStrikes(calm.world);
        const livelyStrikes = recordStrikes(lively.world);
        // The same lock, the same lilies: a short hop instead of a flight.
        calm.world.onLock({ u: 0.2, rows: [12], hardDrop: true });
        lively.world.onLock({ u: 0.2, rows: [12], hardDrop: true });
        expect(calmStrikes().map((e) => e.index)).toEqual(livelyStrikes().map((e) => e.index));
        expect(calmStrikes()).toHaveLength(3);
        for (let i = 0; i < 3; i++) {
            expect(calmLaunches[i][0].flight).toBeLessThan(livelyLaunches[i][0].flight / 2);
            expect(calmLaunches[i][0].flight).toBeLessThan(0.5);
            expect(calmLaunches[i][0].flight).toBeGreaterThan(0);
        }
        // The camera does not move: not with time, not with the pointer, not with a kick.
        const rest = calm.camera.position.clone();
        const { fov } = calm.camera;
        const gaze = calm.camera.quaternion.clone();
        for (let i = 0; i < 40; i++) {
            const time = calm.world.time + 0.37;
            const sim = {
                time, delta: 0.37, pointerX: Math.sin(i), pointerY: Math.cos(i),
            };
            calm.world.updateCamera(calm.camera, sim);
            calm.world.update(sim, calm.camera);
            if (i === 10) calm.world.onLock({ u: 0.7, hardDrop: true });
            expect(calm.camera.position.distanceTo(rest)).toBe(0);
            expect(calm.camera.fov).toBe(fov);
            expect(calm.camera.quaternion.angleTo(gaze)).toBeLessThan(1e-12);
        }
        // The lilies still light, and the feedback still reaches the post.
        expect(calm.world.getState().held).toBeGreaterThan(0);
        calm.world.onLock({ u: 0.3, hardDrop: true });
        run(calm.world, calm.camera, 1 / 60, 1);
        expect(calm.world.getPostState().kick).toBeGreaterThan(0);
        // A four-line clear's ring through the frame is fainter.
        calm.world.onClear({ lines: 4 });
        lively.world.onClear({ lines: 4 });
        expect(calm.world.shock.strength).toBeGreaterThan(0);
        expect(calm.world.shock.strength).toBeLessThan(lively.world.shock.strength);
        // The slow clock (clouds, reeds, the wings' stroke) runs slower.
        const drift = { calm: calm.world.drift, lively: lively.world.drift };
        const stride = lively.world.time - calm.world.time;
        run(lively.world, lively.camera, 5);
        run(calm.world, calm.camera, 5);
        expect(stride).toBeLessThan(0); // the calm world is further on in time, and still its clock has moved less
        expect(calm.world.drift - drift.calm).toBeLessThan(lively.world.drift - drift.lively);
        // Switched off again, the boat sways once more.
        calm.world.setReducedMotion(false);
        run(calm.world, calm.camera, 3);
        expect(calm.camera.position.distanceTo(rest)).toBeGreaterThan(0);
        calm.world.dispose();
        lively.world.dispose();
    });
});

describe('vesper world: what the shaders and the post are told', () => {
    it('raises a live flag while a ring, a swell or a pulse is running, and drops it after', () => {
        const { camera, world } = makeWorld('Low');
        const live = () => [world.u.ringsLive.value, world.u.swellLive.value, world.u.pulsesLive.value];
        const settle = () => run(world, camera, 30, 300);
        /** What the slots themselves say is on the water / on the silk right now. */
        const running = () => {
            const t = world.time;
            const any = (slots, component, life) => slots.some((slot) => {
                const age = t - slot.value.getComponent(component);
                return age >= 0 && age < life;
            });
            return [any(world.u.ringA, 2, RING_LIVE), any(world.u.swellA, 0, SWELL_LIVE),
                any(world.u.pulseA, 0, PULSE_TRAVEL * 1.6)];
        };
        const agree = (label) => {
            const flags = live();
            running().forEach((on, i) => { if (on) expect(flags[i], `${label}: flag ${i}`).toBe(1); });
        };
        expect(live()).toEqual([0, 0, 0]);
        // A hard drop: a ring now, light on the silk now, more rings as its moths land.
        world.onLock({ u: 0.3, hardDrop: true });
        for (let i = 0; i < 240; i++) {
            run(world, camera, 1 / 30, 1);
            agree(`hard drop, frame ${i}`);
            if (i === 0) expect(live()).toEqual([1, 0, 1]);
        }
        settle();
        expect(live()).toEqual([0, 0, 0]);
        // A clear: a swell.
        world.onClear({ lines: 2 });
        run(world, camera, 1 / 60, 1);
        expect(live()).toEqual([0, 1, 0]);
        run(world, camera, SWELL_LIVE * 0.9);
        expect(live()[1]).toBe(1);
        settle();
        expect(live()).toEqual([0, 0, 0]);
        // A four-line clear: its swell and its ring wait out the hush, and are announced before they start.
        world.onClear({ lines: 4 });
        for (let i = 0; i < 60; i++) {
            run(world, camera, 1 / 60, 1);
            agree(`four lines, frame ${i}`);
        }
        expect(live()).toEqual([1, 1, 0]);
        settle();
        // A chain: light on the silk.
        world.onCombo(2);
        run(world, camera, 1 / 60, 1);
        expect(live()).toEqual([0, 0, 1]);
        world.onCombo(0);
        settle();
        expect(live()).toEqual([0, 0, 0]);
        expect(world.u.time.value).toBe(world.time);
        world.dispose();
    });

    it('reuses its slots in turn: the oldest ring, swell or pulse makes way for the newest', () => {
        const { camera, world } = makeWorld('Low');
        for (let i = 0; i < RING_SLOTS * 2 + 3; i++) {
            run(world, camera, 0.05);
            const cursor = world.ringCursor;
            world.ring(i, -i, world.time, 0.5, [1, 0.5, 0.25], 1.5);
            expect(world.ringCursor).toBe(cursor + 1);
            const slot = cursor % RING_SLOTS;
            expect(world.u.ringA[slot].value.toArray()).toEqual([i, -i, world.time, 0.5]);
            expect(world.u.ringC[slot].value.toArray()).toEqual([1, 0.5, 0.25, 1.5]);
        }
        for (let i = 0; i < THREAD_PULSES * 2 + 1; i++) {
            run(world, camera, 0.05);
            const cursor = world.pulseCursor;
            world.threadPulse(world.time, i % 2 ? 1 : -1, 0.7, [0.2, 0.4, 0.6]);
            const slot = cursor % THREAD_PULSES;
            expect(world.u.pulseA[slot].value.toArray().slice(0, 3)).toEqual([world.time, i % 2 ? 1 : -1, 0.7]);
            expect(world.u.pulseC[slot].value.toArray()).toEqual([0.2, 0.4, 0.6]);
        }
        // Every slot the lake and the silk evaluate is one the world can write.
        expect(world.u.ringA).toHaveLength(RING_SLOTS);
        expect(world.u.ringC).toHaveLength(RING_SLOTS);
        expect(world.u.swellA).toHaveLength(SWELL_SLOTS);
        expect(world.u.swellC).toHaveLength(SWELL_SLOTS);
        expect(world.u.pulseA).toHaveLength(THREAD_PULSES);
        expect(world.u.pulseC).toHaveLength(THREAD_PULSES);
        world.dispose();
    });

    it('hands the post one reused object of finite numbers that the post knows how to read', () => {
        const { camera, world } = makeWorld('Low');
        const post = world.getPostState();
        expect(world.getPostState()).toBe(post);
        // Every key it carries is one VesperPost.update takes.
        const reads = VesperPost.prototype.update.toString();
        for (const key of Object.keys(post)) expect(reads, key).toMatch(new RegExp(`\\b${key}\\b`));
        expect(Object.keys(post.prism).sort()).toEqual(['radius', 'strength']);
        // At rest: an open iris, the chrysalis's own shafts, nothing else.
        expect(post).toMatchObject({
            flash: 0, kick: 0, exposure: 1, prism: { radius: 0, strength: 0 },
        });
        expect(post.bloomBoost).toBeLessThan(1e-12);
        expect(post.shafts).toBeGreaterThan(0);
        const { prism } = post;
        const events = [
            () => world.onLock({ u: 0.2, hardDrop: true, color: '#ffa050' }),
            () => world.onClear({ lines: 1 }),
            () => world.onCombo(2),
            () => world.onClear({ lines: 3, tspin: true }),
            () => world.onCombo(3),
            () => world.levelUp(2),
            () => world.onClear({ lines: 4 }),
            () => world.onCombo(0),
            () => world.onClear({ lines: 2, perfect: true }),
        ];
        let lowest = 1;
        for (const event of events) {
            event();
            for (let i = 0; i < 30; i++) {
                run(world, camera, 1 / 60, 1);
                expect(world.getPostState()).toBe(post);
                expect(post.prism).toBe(prism);
                expect(post.heart).toBe(world.heart);
                for (const key of ['flash', 'kick', 'shafts', 'bloomBoost', 'exposure']) {
                    expect(Number.isFinite(post[key]), key).toBe(true);
                    expect(post[key], key).toBeGreaterThanOrEqual(0);
                }
                expect(post.exposure).toBeLessThanOrEqual(1);
                expect(post.exposure).toBeGreaterThan(0);
                expect(Number.isFinite(post.prism.radius) && post.prism.radius >= 0).toBe(true);
                expect(Number.isFinite(post.prism.strength) && post.prism.strength >= 0).toBe(true);
                lowest = Math.min(lowest, post.exposure);
            }
        }
        // In the surge of the last clear the iris is closed, and it opens again as the surge cools.
        expect(lowest).toBeLessThan(1);
        const closed = post.exposure;
        run(world, camera, SURGE_COOL * 12, 600);
        expect(post.exposure).toBeGreaterThan(closed);
        expect(post.exposure).toBeCloseTo(1, 2);
        world.dispose();
    });

    it('reports its state as plain data', () => {
        const { camera, world } = makeWorld('High');
        world.onLock({ u: 0.2, hardDrop: true });
        world.onClear({ lines: 4 });
        world.onCombo(5);
        world.levelUp(3);
        run(world, camera, 2);
        const state = world.getState();
        // It survives a structured copy and a trip through JSON unchanged: numbers, text, flags, lists.
        expect(JSON.parse(JSON.stringify(state))).toEqual(state);
        const leaves = [];
        const walk = (value, at) => {
            if (Array.isArray(value)) value.forEach((item, i) => walk(item, `${at}[${i}]`));
            else if (value && typeof value === 'object') {
                expect(Object.getPrototypeOf(value), at).toBe(Object.prototype);
                Object.keys(value).forEach((key) => walk(value[key], `${at}.${key}`));
            } else leaves.push([at, value]);
        };
        walk(state, 'state');
        expect(leaves.length).toBeGreaterThan(15);
        for (const [at, value] of leaves) {
            expect(['number', 'string', 'boolean'], at).toContain(typeof value);
            if (typeof value === 'number') expect(Number.isFinite(value), at).toBe(true);
        }
        // A copy each time: a reader may keep it.
        expect(world.getState()).not.toBe(state);
        expect(world.getState().counts).not.toBe(world.counts);
        expect(state).toMatchObject({
            quality: 'High',
            combo: 5,
            level: 3,
            palette: VESPER_PALETTES[2].name,
            counts: { locks: 1, clears: 1, quads: 1 },
        });
        expect(state.held).toBeGreaterThan(0);
        expect(state.time).toBe(world.time);
        world.dispose();
    });

    it('makes the long threads fast to the two tallest crystals of each stand', () => {
        for (const quality of ['Minimal', 'High', 'Extreme']) {
            const { world } = makeWorld(quality);
            const long = world.threads.filter((thread) => thread.long);
            expect(long, quality).toHaveLength(4);
            expect(world.threads, quality).toHaveLength(QUALITY[quality].threads);
            for (const side of [-1, 1]) {
                const stand = world.spires.filter((c) => c.side === side).sort((a, b) => b.height - a.height);
                const tips = stand.slice(0, 2).map((c) => spireTip(c));
                const ends = long.filter((thread) => thread.side === side).map((thread) => thread.b);
                expect(ends, `${quality}, side ${side}`).toEqual(tips);
            }
            world.dispose();
        }
    });
});

describe('vesper world: time', () => {
    it('reaches the same state at 30 and at 240 frames a second', () => {
        const slow = makeWorld('Low');
        const fast = makeWorld('Low');
        script(slow.world, slow.camera, 30);
        script(fast.world, fast.camera, 240);
        const a = slow.world.getState();
        const b = fast.world.getState();
        expect(a.time).toBeCloseTo(b.time, 9);
        expect(a.counts).toEqual(b.counts);
        expect(a).toMatchObject({ combo: b.combo, level: b.level, palette: b.palette });
        expect(a.held).toBeGreaterThan(0);
        for (const key of ['power', 'surge', 'storm', 'breath', 'wing', 'held']) {
            expect(a[key], key).toBeCloseTo(b[key], 2);
        }
        // The slow clock is integrated frame by frame: close, not identical.
        expect(slow.world.drift / fast.world.drift).toBeCloseTo(1, 1);
        // Event slots hold timestamps and the lilies are closed forms: identical whatever the frame rate.
        for (const key of ['ringA', 'swellA', 'pulseA']) {
            slow.world.u[key].forEach((slot, i) => {
                const other = fast.world.u[key][i].value.toArray();
                slot.value.toArray().forEach((v, k) => expect(v, `${key}[${i}][${k}]`).toBeCloseTo(other[k], 2));
            });
        }
        const lit = litLilies(slow.world);
        expect(litLilies(fast.world)).toEqual(lit);
        for (const index of lit) {
            const level = slow.world.blooms.levelAt(index, slow.world.time);
            expect(level).toBeCloseTo(fast.world.blooms.levelAt(index, fast.world.time), 2);
        }
        // The wings are falling in both, the same way.
        expect(slow.world.u.wing.value.z).toBeCloseTo(fast.world.u.wing.value.z, 9);
        slow.world.dispose();
        fast.world.dispose();
    });

    it('gives two worlds the same frame for the same recipe, to the last digit', () => {
        const a = makeWorld('High');
        const b = makeWorld('High');
        const moths = [record(a.world.moths, 'launch'), record(b.world.moths, 'launch')];
        const blades = [record(a.world.blades, 'fire'), record(b.world.blades, 'fire')];
        longScript(a.world, a.camera);
        longScript(b.world, b.camera);
        const first = snapshot(a.world, a.camera);
        expect(first.length).toBeGreaterThan(500);
        expect(first.every((v) => typeof v === 'number' && !Number.isNaN(v))).toBe(true);
        expect(snapshot(b.world, b.camera)).toEqual(first);
        // The pools too: every moth sent, every blade fired, every scale of dust.
        expect(moths[0].length).toBeGreaterThan(5);
        expect(moths[1]).toEqual(moths[0]);
        expect(blades[1]).toEqual(blades[0]);
        expect(dustInUse(a.world).length).toBeGreaterThan(50);
        expect(dustSnapshot(b.world)).toEqual(dustSnapshot(a.world));
        a.world.dispose();
        b.world.dispose();
    });

    it('replays a frame: seek, then the same steps, gives the same evening whatever came before', () => {
        const { camera, world } = makeWorld('High');
        const moths = record(world.moths, 'launch');
        const blades = record(world.blades, 'fire');
        longScript(world, camera);
        const first = snapshot(world, camera);
        const firstDust = dustSnapshot(world);
        const flown = structuredClone(moths);
        const fired = structuredClone(blades);
        // Something else entirely in between: play, a new run with everything in the air, more play...
        world.onCombo(9);
        world.onLock({ u: 0.5, hardDrop: true });
        world.onClear({ lines: 3, tspin: true });
        world.levelUp(5);
        world.setReducedMotion(true);
        run(world, camera, 3);
        world.setReducedMotion(false);
        world.resetSession();
        world.onLock({ u: 0.1, hardDrop: true });
        world.onClear({ lines: 4, perfect: true });
        world.onCombo(2);
        run(world, camera, 0.5);
        world.onCombo(1);
        // ...then the capture's recipe again.
        world.seek(10);
        frame(world, camera, 10, 0);
        moths.length = 0;
        blades.length = 0;
        longScript(world, camera);
        const again = snapshot(world, camera);
        expect(again).toHaveLength(first.length);
        /** The largest difference between two lists of numbers of one length. */
        const apart = (a, b) => {
            expect(b).toHaveLength(a.length);
            let worst = 0;
            for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
            return worst;
        };
        // Everything is a function of the clock and of the events' own timestamps. (To a hair, not
        // to the last bit: a seek puts the palette back with `p += (target - p) * 1`, which can
        // leave a colour one unit in the last place from where a new world has it.)
        expect(apart(first, again)).toBeLessThan(1e-9);
        // Every moth again, from the same point to the same lily; every blade, in the same colour.
        expect(moths).toEqual(flown);
        expect(blades).toHaveLength(fired.length);
        expect(apart(fired.flat(2), blades.flat(2))).toBeLessThan(1e-9);
        // The dust too: every scale in the same slot, at the same place, on the same course (to
        // the precision of the 32-bit attributes it is kept in).
        expect(apart(firstDust, dustSnapshot(world))).toBeLessThan(1e-4);
        world.dispose();
    });

    // The dust pool draws each scale's scatter, speed, life and size from a generator of its own.
    // A seek must rewind it with the pool, or the second capture taken from one page (a contact
    // sheet seeks many times) has every scale somewhere else than the same capture taken from a
    // fresh page, and "seek(t) plus a fixed-step replay reproduces any frame" holds for all but the dust.
    it('replays the dust too: the same scales in the same places after a seek', () => {
        const { camera, world } = makeWorld('High');
        script(world, camera);
        const first = dustSnapshot(world);
        expect(dustInUse(world).length).toBeGreaterThan(50);
        for (let pass = 0; pass < 2; pass++) {
            world.seek(10);
            frame(world, camera, 10, 0);
            expect(dustInUse(world)).toHaveLength(0);
            script(world, camera);
            const again = dustSnapshot(world);
            expect(again).toHaveLength(first.length);
            // The same slots, and every number in them the same to the precision of a 32-bit float
            // (a wing's scales take their colour from the palette, which a seek restores to a hair).
            let worst = 0;
            let slots = 0;
            for (let i = 0; i < first.length; i++) {
                if (i % 13 === 0 && again[i] !== first[i]) slots += 1;
                worst = Math.max(worst, Math.abs(again[i] - first[i]));
            }
            expect(slots, `pass ${pass}`).toBe(0);
            expect(worst, `pass ${pass}`).toBeLessThan(1e-4);
        }
        // And a fresh world throws the very same scales.
        const fresh = makeWorld('High');
        script(fresh.world, fresh.camera);
        expect(dustSnapshot(fresh.world)).toEqual(first);
        fresh.world.dispose();
        world.dispose();
    });

    it('does NOT rewind the dust at a new run: the scales in the air stay, and new ones are new', () => {
        const play = () => {
            const made = makeWorld('High');
            made.world.onLock({ u: 0.3, hardDrop: true });
            run(made.world, made.camera, 0.5);
            return made;
        };
        const { world } = play();
        const thrown = dustSnapshot(world);
        const { cursor } = world.dust;
        expect(thrown.length).toBeGreaterThan(0);
        world.resetSession();
        // Nothing was standing to fall: the reset throws nothing, and takes nothing away.
        expect(world.dust.cursor).toBe(cursor);
        expect(dustSnapshot(world)).toEqual(thrown);
        // The next lock's scales go into the next slots, drawn from where the generator had got to...
        world.onLock({ u: 0.3, hardDrop: true });
        const after = dustSnapshot(world);
        expect(world.dust.cursor).toBeGreaterThan(cursor);
        expect(after.slice(0, thrown.length)).toEqual(thrown);
        // ...so they are not the first lock's scales over again, as they would be after a seek.
        const scale = (list, k) => list.slice(k * 13 + 5, k * 13 + 9); // a scale's course (its velocity and life)
        const count = thrown.length / 13;
        expect(Number.isInteger(count)).toBe(true);
        expect(scale(after, count)).not.toEqual(scale(thrown, 0));
        // And the same play on another world throws exactly the same.
        const twin = play();
        twin.world.resetSession();
        twin.world.onLock({ u: 0.3, hardDrop: true });
        expect(dustSnapshot(twin.world)).toEqual(after);
        twin.world.dispose();
        world.dispose();
    });

    it('drops every event in flight when it seeks, and starts the evening over at its first hour', () => {
        const { camera, world } = makeWorld('High');
        world.onLock({ u: 0.4, hardDrop: true });
        world.onClear({ lines: 4, tspin: true });
        world.onCombo(6);
        world.levelUp(3);
        run(world, camera, 1.5);
        world.onCombo(0);
        run(world, camera, 0.5);
        expect(world.getState().held).toBeGreaterThan(0);
        world.seek(40);
        expect(world.time).toBe(40);
        expect(world.drift).toBe(40);
        expect(world.getState()).toMatchObject({
            time: 40,
            combo: 0,
            power: 0,
            surge: 0,
            storm: 0,
            breath: 1,
            wing: 0,
            eyes: [0, 0],
            level: 1,
            palette: VESPER_PALETTES[0].name,
            held: 0,
            layoutLive: true,
            counts: {
                locks: 0, clears: 0, quads: 0, moths: 0, falls: 0,
            },
        });
        expect(world.blooms.pending).toHaveLength(0);
        expect(world.blooms.state.every((s) => s.from === 0 && s.to === 0)).toBe(true);
        expect(world.blooms.rows.every((row) => row.y === 0 && row.z === 0)).toBe(true);
        expect(world.u.ringA.every((slot) => slot.value.z < -50)).toBe(true);
        expect(world.u.swellA.every((slot) => slot.value.x < -50)).toBe(true);
        expect(world.u.pulseA.every((slot) => slot.value.x < -50)).toBe(true);
        expect(world.u.fed.value.w).toBe(0);
        expect(dustInUse(world)).toHaveLength(0);
        expect([world.moths.cursor, world.dust.cursor, world.ringCursor, world.swellCursor, world.pulseCursor])
            .toEqual([0, 0, 0, 0, 0]);
        expect(world.pendingKick.time).toBe(Infinity);
        expect(world.pendingFed.time).toBe(Infinity);
        // The next frame is the evening at rest.
        frame(world, camera, 40, 0);
        expect([world.u.ringsLive.value, world.u.swellLive.value, world.u.pulsesLive.value]).toEqual([0, 0, 0]);
        expect(world.u.wing.value.toArray()).toEqual([0, world.beat, 0, 0]);
        expect(world.getPostState()).toMatchObject({
            flash: 0, kick: 0, exposure: 1, prism: { radius: 0, strength: 0 },
        });
        expect(world.getPostState().bloomBoost).toBeLessThan(1e-12);
        // (Its colours are the first level's hour, moved on by the forty seconds on the clock.)
        const first = paletteAt(hourAt(1, 40));
        PALETTE_KEYS.forEach((key) => {
            world.u[key].value.toArray().forEach((v, k) => expect(v, key).toBeCloseTo(first[key][k], 6));
        });
        // The lake is there to be lit.
        world.onLock({ u: 0.2 });
        expect(world.counts.moths).toBe(1);
        // A seek before the start of time is the start of time.
        world.seek(-5);
        expect(world.time).toBe(0);
        expect(world.drift).toBe(0);
        expect(() => frame(world, camera, 0, 0)).not.toThrow();
        expect(world.wing).toBe(0);
        world.dispose();
    });

    it('moves nothing that decays or drifts on a frame of no time', () => {
        const { camera, world } = makeWorld('Low');
        world.onLock({ u: 0.3, hardDrop: true });
        world.onClear({ lines: 4 });
        world.onCombo(3);
        run(world, camera, 0.7);
        const held = () => ({
            power: world.power,
            surge: world.surge,
            storm: world.storm,
            flash: world.flash,
            kick: world.kick,
            wingFlash: world.wingFlash,
            eyeFlash: world.eyeFlash,
            beatKick: world.beatKick,
            fed: world.fed,
            drift: world.drift,
            beat: world.beat,
            levels: levels(world),
            palette: PALETTE_KEYS.flatMap((key) => world.u[key].value.toArray()),
            slots: [...world.u.ringA, ...world.u.swellA, ...world.u.pulseA].flatMap((slot) => slot.value.toArray()),
        });
        const before = held();
        for (let i = 0; i < 5; i++) frame(world, camera, world.time, 0);
        expect(held()).toEqual(before);
        world.dispose();
    });

    // A frame of no time must leave the eased values where they are, not snap them to their
    // targets: a capture ends on such a frame (the effect's seekTo), and would never show wings
    // half unfurled or the breath half held; in play, two animation frames with one timestamp
    // would make the wings jump to their full step.
    it('moves no eased value on a frame of no time', () => {
        const { camera, world } = makeWorld('Low');
        const eased = () => ({
            wing: world.wing,
            crack: world.crack,
            eyeHind: world.eyeHind,
            eyeFore: world.eyeFore,
            breath: world.breath,
            shown: [...world.u.wing.value.toArray(), ...world.u.eyes.value.toArray(), world.u.breath.value],
        });
        const still = (label) => {
            const before = eased();
            for (let i = 0; i < 3; i++) frame(world, camera, world.time, 0);
            expect(eased(), label).toEqual(before);
            return before;
        };
        // The wings, the cracks and the eyes on their way open: on their way, not there.
        world.onCombo(EYE_COMBO.fore);
        run(world, camera, 0.1, 6);
        const opening = still('opening');
        expect(opening.wing).toBeGreaterThan(0);
        expect(opening.wing).toBeLessThan(wingForCombo(EYE_COMBO.fore));
        expect(opening.eyeFore).toBeGreaterThan(0);
        expect(opening.eyeFore).toBeLessThan(1);
        expect(opening.crack).toBeGreaterThan(0);
        expect(opening.crack).toBeLessThan(1);
        // The breath half held, in a four-line clear's hush.
        world.onClear({ lines: 4 });
        run(world, camera, HUSH_HOLD / 6, 1);
        const hushed = still('in the hush');
        expect(hushed.breath).toBeLessThan(1);
        expect(hushed.breath).toBeGreaterThan(0.14);
        // The wings part fallen, with a new chain waiting behind them.
        run(world, camera, 3);
        world.onCombo(0);
        run(world, camera, WING_FALL * 0.4);
        world.onCombo(1);
        const falling = still('falling');
        expect(falling.shown[2]).toBeCloseTo(0.4, 6);
        // A chain reported on a frame of no time waits for time to pass: it is not drawn at once.
        run(world, camera, WING_FALL + 3);
        expect(world.wing).toBe(wingForCombo(1));
        world.onCombo(5);
        frame(world, camera, world.time, 0);
        expect(world.wing).toBe(wingForCombo(1));
        run(world, camera, 3);
        expect(world.wing).toBe(wingForCombo(5));
        world.dispose();
    });

    it('returns to its resting look long after the last event', () => {
        const { camera, world } = makeWorld('Low');
        // (Held at one hour: left to itself the evening moves on, and its resting look with it.)
        world.setHourDrift(false);
        world.applyPalette(1);
        run(world, camera, 1);
        const rest = { ...world.getPostState() };
        const wake = world.u.wake.value;
        const aurora = world.u.aurora.value;
        world.onLock({ u: 0.5, hardDrop: true });
        world.onCombo(5);
        world.onClear({ lines: 4 });
        run(world, camera, 2);
        world.onCombo(0);
        run(world, camera, BLOOM_HOLD * 12, 1500);
        const post = world.getPostState();
        expect(post.flash).toBeLessThan(1e-6);
        expect(post.kick).toBeLessThan(1e-6);
        expect(post.shafts).toBeCloseTo(rest.shafts, 5);
        expect(post.bloomBoost).toBeCloseTo(rest.bloomBoost, 5);
        expect(post.exposure).toBeCloseTo(1, 5);
        expect(post.prism).toEqual({ radius: 0, strength: 0 });
        expect(world.u.breath.value).toBeCloseTo(1, 6);
        expect(world.u.wake.value).toBeCloseTo(wake, 5);
        expect(world.u.aurora.value).toBeCloseTo(aurora, 5);
        expect([world.u.ringsLive.value, world.u.swellLive.value, world.u.pulsesLive.value]).toEqual([0, 0, 0]);
        expect(world.getState()).toMatchObject({ combo: 0, wing: 0 });
        expect(world.getState().power).toBeLessThan(1e-6);
        expect(world.getState().held).toBeLessThan(1e-3);
        expect(world.u.crack.value).toBeLessThan(1e-6);
        // The clouds are back to their resting pace.
        const { drift } = world;
        run(world, camera, 1);
        expect(world.drift - drift).toBeCloseTo(1, 4);
        world.dispose();
    });
});

describe('vesper world: the moth and ring pools', () => {
    /**
     * `drops` hard drops, one every `gap` seconds. Counts what the pools' reuse takes away: moths
     * overwritten before they have landed, and rings overwritten before they have begun.
     */
    function hardDrops(quality, gap, drops = 40) {
        const { camera, world } = makeWorld(quality);
        const lost = { moths: 0, rings: 0 };
        const landing = [];
        const { launch } = world.moths;
        world.moths.launch = (moth) => {
            const slot = launch(moth);
            if (landing[slot] > moth.time + 1e-9) lost.moths += 1;
            landing[slot] = moth.time + moth.flight;
            return slot;
        };
        const ring = world.ring.bind(world);
        world.ring = (...args) => {
            if (world.u.ringA[world.ringCursor % RING_SLOTS].value.z > world.time + 1e-9) lost.rings += 1;
            return ring(...args);
        };
        for (let i = 0; i < drops; i++) {
            world.onLock({ u: i % 2 ? 0.8 : 0.2, hardDrop: true, rows: [18] });
            run(world, camera, gap);
        }
        expect(world.counts.moths).toBe(drops * 3);
        expect(world.moths.cursor).toBe(drops * 3);
        // A hard drop writes two rings: its own lily's, and the strike under the chrysalis.
        expect(world.ringCursor).toBe(drops * 2);
        world.dispose();
        return lost;
    }

    it('lets every moth of a steady run of hard drops finish its flight', () => {
        // A hard drop a second: brisk solo play.
        expect(hardDrops('High', 1)).toEqual({ moths: 0, rings: 0 });
    });

    // The pool holds MOTH_SLOTS moths and a hard drop sends three. At two hard drops a second (a
    // fast solo player; any two boards in local multiplayer) no slot may be taken again before
    // its moth has landed, or the moth vanishes in mid-flight and its lily opens with nothing to
    // have lit it. The same for the rings its landing is to send over the water.
    it('lets every moth of a fast run of hard drops finish its flight, at every tier', () => {
        for (const quality of QUALITY_NAMES) {
            expect(hardDrops(quality, 0.5), quality).toEqual({ moths: 0, rings: 0 });
        }
    });
});
