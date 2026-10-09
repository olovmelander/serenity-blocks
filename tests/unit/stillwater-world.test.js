/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Stillwater — the real world (stillwater-world.js), built without a GPU.
 *
 * The tarn is being tuned while these tests stand: they drive the world through the calls the
 * theme makes and assert behaviour and invariants, with every bound taken from the modules' own
 * exports. A test marked `it.fails` pins a fault that is known and left open: it says what it
 * expects and what happens instead, and turns red the day the fault is fixed (drop `.fails` then).
 * Where a test says what the world "once" did, it pins a fault that was found here and has been
 * put right.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    HERO_LAYER, HOUR_TURN, REST_RIG, STILLWATER_PARTS, StillwaterWorld, fovForAspect,
} from '../../src/themes/stillwater/stillwater-world.js';
import {
    DEG, DROP_FLIGHT, EYE, HEART, HOURS, HOUR_SECONDS, HUSH_HOLD, MOON, PALETTE_KEYS, PALETTE_SCALARS, RING_LIVE,
    RING_SLOTS, SPIRIT, STROKE_LIVE, STROKE_SLOTS, SURGE_COOL, TROLL, WISP_HOLD, WISP_HOME, WISP_RISE, WISP_SLOTS,
    approachForCombo, eyesForCombo, heartForCombo, hourAt, moonFor, mulberry32, paletteAt, pieceColor, powerForCombo,
    skyDirection, smooth, squeezeFor, strokePassTime,
} from '../../src/themes/stillwater/stillwater-core.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/stillwater/stillwater-quality.js';
import { boardPoint, cardUnion, fallbackLayout } from '../../src/themes/stillwater/stillwater-composition.js';
import { groundHeight, shoreDistance } from '../../src/themes/stillwater/stillwater-plan.js';

// Every test builds a whole world (a noise field, the plans, some twenty node materials).
vi.setConfig({ testTimeout: 60000 });

/**
 * The troll's sculpt is fetched by three's GLTFLoader, which has nothing to fetch from here:
 * the loader is replaced by one that answers with whatever a test puts in `sculpt.load`
 * (by default it fails, as a missing file would).
 */
const sculpt = vi.hoisted(() => ({ load: null, urls: [] }));
vi.mock('three/addons/loaders/GLTFLoader.js', () => ({
    GLTFLoader: class {
        loadAsync(url) {
            sculpt.urls.push(url);
            return sculpt.load ? sculpt.load(url) : Promise.reject(new Error('no sculpt in this test'));
        }
    },
}));

/** What stands on the banks (drawn in with them on a narrow frame), what hangs in the air, and what is not mirrored. */
const BANKS = ['ground', 'boulders', 'trunks', 'boughs', 'fringe', 'saplings', 'ferns', 'reeds', 'pads', 'lilies',
    'caps', 'spirit', 'troll'];
const AIR = ['mist', 'eyes', 'fireflies', 'wisps', 'drops', 'sparks'];
const UNMIRRORED = ['sky', 'water'];

/** The parts a tier may leave out, and the tier's number that says so. */
const OPTIONAL = {
    boughs: 'boughs',
    fringe: 'boughs',
    saplings: 'saplings',
    ferns: 'ferns',
    reeds: 'reeds',
    mist: 'mist',
    fireflies: 'fireflies',
};
const partsOf = (tier) => STILLWATER_PARTS.filter((name) => !(name in OPTIONAL) || tier[OPTIONAL[name]] > 0);

const WIDE = [[1600, 900], [1584, 813], [1920, 1080], [2560, 1080], [1280, 1024]];
const UPRIGHT = [[820, 1180], [430, 932], [390, 844]];

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

function frame(world, camera, time, delta, pointer = {}) {
    const sim = { time, delta, ...pointer };
    world.updateCamera(camera, sim);
    world.update(sim, camera);
}

function makeWorld(quality = 'Low', {
    width = 1600, height = 900, live = true, reduced = false, renderer = null, start = 10, drift = true,
} = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new StillwaterWorld({
        scene, quality, capture: true, renderer,
    }).build();
    world.bindCamera(camera);
    world.setReducedMotion(reduced);
    world.setHourDrift(drift);
    world.setViewport(width, height, aspect);
    // As the theme does on its first frame: the live rects, or null when no board is on screen.
    world.setLayout(live ? fallbackLayout(width, height) : null, aspect);
    world.seek(start);
    frame(world, camera, start, 0);
    return { scene, camera, world };
}

/** Advance the world by `seconds` in fixed steps of 1 / fps, calling `each` after every frame. */
function run(world, camera, seconds, fps = 60, each = null) {
    const steps = Math.max(1, Math.round(seconds * fps));
    const t0 = world.time;
    for (let i = 1; i <= steps; i++) {
        frame(world, camera, t0 + i / fps, 1 / fps);
        if (each) each(i);
    }
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

/** Every ring the world starts from now on, with how far it was born from the water's edge (negative = on the water). */
function recordRings(world) {
    const rings = [];
    const original = world.ring.bind(world);
    world.ring = (x, z, time, strength, rgb, reach) => {
        rings.push({
            x, z, time, strength, rgb: [...rgb], reach, edge: shoreDistance(x / world.squeeze, z), asked: world.time,
        });
        return original(x, z, time, strength, rgb, reach);
    };
    return rings;
}

/** The live rows of the three tables the water and the sprites read. */
const ringsOf = (world) => Array.from({ length: world.u.counts.value.x }, (_, i) => {
    const a = world.u.ringRows[i * 2];
    const c = world.u.ringRows[i * 2 + 1];
    return {
        x: a.x, z: a.y, time: a.z, strength: a.w, rgb: [c.x, c.y, c.z], reach: c.w,
    };
});
const strokesOf = (world) => Array.from({ length: world.u.counts.value.y }, (_, i) => {
    const a = world.u.strokeRows[i * 2];
    const c = world.u.strokeRows[i * 2 + 1];
    return {
        time: a.x, fronts: a.y, strength: a.z, gold: a.w, rgb: [c.x, c.y, c.z],
    };
});
const wispsOf = (world) => Array.from({ length: world.u.counts.value.z }, (_, i) => {
    const a = world.u.wispRows[i * 2];
    const c = world.u.wispRows[i * 2 + 1];
    return {
        x: a.x, y: a.y, z: a.z, light: a.w, rgb: [c.x, c.y, c.z], seed: c.w,
    };
});

/** Every number the shaders share, with a name to report it by. */
function sharedNumbers(world) {
    const out = [];
    const take = (name, value) => {
        if (typeof value === 'number') out.push([name, value]);
        else if (value && typeof value.toArray === 'function') {
            value.toArray().forEach((v, k) => out.push([`${name}[${k}]`, v]));
        }
    };
    Object.keys(world.u).forEach((key) => {
        const node = world.u[key];
        if (Array.isArray(node)) node.forEach((row, i) => take(`u.${key}[${i}]`, row));
        else if (node && typeof node === 'object' && 'value' in node) {
            // (Not the textures, and not the table nodes: their rows are the arrays walked above.)
            if (!node.value?.isTexture && !Array.isArray(node.value)) take(`u.${key}`, node.value);
        }
    });
    take('spirit.uTrail', world.spirit.uTrail.value);
    take('spirit.uFed', world.spirit.uFed.value);
    return out;
}

/** Where a world point shows through a camera (screen fractions, y down). */
function onScreen(point, camera) {
    const v = new THREE.Vector3(...point).project(camera);
    return { x: v.x * 0.5 + 0.5, y: 0.5 - v.y * 0.5 };
}

/** How far along its way (0 = where it rests, 1 = where a chain draws it) a figure stands, and how far off the line. */
function wayOf(who, position) {
    const dx = who.reach[0] - who.home[0];
    const dz = who.reach[2] - who.home[2];
    const along = ((position.x - who.home[0]) * dx + (position.z - who.home[2]) * dz) / (dx * dx + dz * dz);
    const off = Math.hypot(position.x - (who.home[0] + dx * along), position.z - (who.home[2] + dz * along));
    return { along, off, length: Math.hypot(dx, dz) };
}

/** A stand-in for the troll's sculpt: a mesh, the two bones the world turns itself, a leg, and a walk. */
function fakeSculpt({ walk = true } = {}) {
    const scene = new THREE.Group();
    const geometry = new THREE.BufferGeometry();
    const corners = new Float32Array([0, -0.5, 0, 0.3, 0.5, 0, -0.3, 0.5, 0]);
    geometry.setAttribute('position', new THREE.BufferAttribute(corners, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(9).fill(0.5), 3));
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    mesh.name = 'sculpt';
    const bones = ['spine', 'head', 'leg'].map((name) => {
        const bone = new THREE.Bone();
        bone.name = name;
        return bone;
    });
    bones[0].add(bones[1]);
    scene.add(bones[0], bones[2], mesh);
    const swing = (name, x) => new THREE.QuaternionKeyframeTrack(
        `${name}.quaternion`,
        [0, 0.3, 0.6, 0.9, 1.2],
        [0, 0, 0, 1, x, 0, 0, Math.sqrt(1 - x * x), 0, 0, 0, 1, -x, 0, 0, Math.sqrt(1 - x * x), 0, 0, 0, 1],
    );
    const clip = new THREE.AnimationClip('walk', 1.2, [swing('spine', 0.05), swing('head', 0.08), swing('leg', 0.4)]);
    return {
        gltf: { scene, animations: walk ? [clip] : [] },
        mesh,
        geometry,
        bones: { spine: bones[0], head: bones[1], leg: bones[2] },
    };
}

/** A run of play that touches every reaction: locks, a hard drop, clears, a chain to 5, four lines, a level, a break. */
function play(world, camera) {
    const step = (seconds) => run(world, camera, seconds);
    world.onLock({ u: 0.2, rows: [18, 19], color: '#F2D68A' });
    step(0.5);
    world.onLock({
        u: 0.8, rows: [17, 18], color: '#6CC7C6', hardDrop: true,
    });
    step(0.5);
    world.onLock({ u: 0.35, rows: [19], color: '#C36F73' });
    world.onClear({ rows: [19], lines: 1 });
    world.onCombo(1);
    step(0.6);
    world.onLock({ u: 0.7, rows: [18, 19], color: '#5F9B72' });
    world.onClear({ rows: [18, 19], lines: 2 });
    world.onCombo(2);
    step(0.6);
    world.onLock({ u: 0.5, rows: [19], color: '#9A7FB7' });
    world.onClear({ rows: [19], lines: 1, tspin: true });
    world.onCombo(3);
    step(0.6);
    world.onLock({ u: 0.1, rows: [17, 18, 19], color: '#537E9F' });
    world.onClear({ rows: [17, 18, 19], lines: 3 });
    world.onCombo(4);
    step(0.6);
    world.onLock({
        u: 0.95, rows: [16, 17, 18, 19], color: '#D99A5E', hardDrop: true,
    });
    world.onClear({ rows: [16, 17, 18, 19], lines: 4 });
    world.onCombo(5);
    step(0.8);
    world.levelUp(2);
    step(0.9);
    world.onLock({ u: 0.4, rows: [19], color: '#F2D68A' });
    world.onCombo(0);
    step(0.9);
}

/** Everything a frame of the world is made of, as text: its state, and the three tables row by row. */
function picture(world, liveOnly = false) {
    const rows = (list, live) => (liveOnly ? list.slice(0, live * 2) : list).map((row) => row.toArray());
    const { x, y, z } = world.u.counts.value;
    const post = world.getPostState();
    return JSON.stringify({
        state: world.getState(),
        rings: rows(world.u.ringRows, x),
        strokes: rows(world.u.strokeRows, y),
        wisps: rows(world.u.wispRows, z),
        post: [post.flash, post.kick, post.shafts, post.bloomBoost, post.exposure, post.prism.radius,
            post.prism.strength],
        figures: [world.spirit.figure.position.toArray(), world.troll.figure.position.toArray()],
        air: [world.u.drift.value, world.u.sway.value, world.u.wind.value, world.u.breath.value],
    });
}

afterEach(() => {
    sculpt.load = null;
    sculpt.urls.length = 0;
    vi.restoreAllMocks();
});

describe('stillwater world: build', () => {
    it('builds every part of the picture at the fullest tiers, and at each tier what that tier pays for', () => {
        for (const quality of QUALITY_NAMES) {
            const { scene, world } = makeWorld(quality);
            const tier = QUALITY[quality];
            const names = Object.keys(world.parts);
            expect([...names].sort(), quality).toEqual(partsOf(tier).sort());
            expect(scene.children, quality).toEqual([world.root]);
            const drawn = [];
            for (const name of names) {
                const part = world.parts[name];
                const label = `${quality}.${name}`;
                expect(part.mesh, label).toBeTruthy();
                expect(part.mesh.visible, label).toBe(true); // no pool waits hidden for its first event
                part.mesh.traverse((object) => {
                    if (!object.material) return;
                    drawn.push(object);
                    expect(object.material.isNodeMaterial, label).toBe(true);
                    expect(object.material.isShaderMaterial, label).not.toBe(true);
                    expect(object.material.fog, label).toBe(false); // the night's own mist is in every material
                    expect(object.frustumCulled, label).toBe(false);
                });
            }
            expect(drawn.length, quality).toBeGreaterThanOrEqual(names.length);
            // What the tier pays for.
            expect(world.tier, quality).toBe(tier);
            expect(world.parts.trunks.count, quality).toBe(tier.trunks);
            expect(world.parts.boulders.count, quality).toBe(tier.boulders);
            expect(world.parts.pads.count, quality).toBe(tier.lilies);
            expect(world.parts.lilies.count, quality).toBeGreaterThan(0);
            expect(world.parts.lilies.count, quality).toBeLessThan(tier.lilies);
            expect(world.parts.caps.count, quality).toBe(tier.caps);
            expect(world.parts.eyes.count, quality).toBe(tier.eyes);
            expect(world.sparks, quality).toBe(world.parts.sparks);
            expect(world.sparks.count, quality).toBe(tier.sparks);
            expect(world.drops, quality).toBe(world.parts.drops);
            expect(world.troll.lod, quality).toBe(tier.troll);
            if (tier.boughs > 0) {
                expect(world.parts.boughs.count + (world.parts.fringe?.count ?? 0), quality).toBe(tier.boughs);
            }
            if (tier.saplings > 0) expect(world.parts.saplings.count, quality).toBe(tier.saplings);
            if (tier.ferns > 0) expect(world.parts.ferns.count, quality).toBe(tier.ferns);
            if (tier.reeds > 0) {
                expect(world.parts.reeds.count, quality).toBeLessThanOrEqual(tier.reeds);
                expect(world.parts.reeds.count, quality).toBeGreaterThan(tier.reeds * 0.9);
            }
            if (tier.fireflies > 0) {
                expect(world.parts.fireflies.count, quality).toBeLessThanOrEqual(tier.fireflies);
                expect(world.parts.fireflies.count, quality).toBeGreaterThan(tier.fireflies * 0.9);
            }
            expect(Boolean(world.water.reflection), quality).toBe(tier.mirror > 0);
            expect(world.getState(), quality).toMatchObject({
                quality,
                time: 10,
                combo: 0,
                level: 1,
                squeeze: 1,
                rings: 0,
                strokes: 0,
                wisps: 0,
                spirit: 0,
                troll: 0,
                trollReady: false,
                trunks: tier.trunks,
                boulders: tier.boulders,
                sparks: tier.sparks,
                mirror: tier.mirror > 0,
                layoutLive: true,
                counts: {
                    locks: 0, clears: 0, quads: 0, wisps: 0, gathered: 0,
                },
            });
            world.dispose();
        }
        // The tier the game ships as its default has all of it; the lowest leaves out what it has none of.
        expect(partsOf(QUALITY.High).sort()).toEqual([...STILLWATER_PARTS].sort());
        for (const name of ['reeds', 'ferns', 'fireflies']) {
            expect(partsOf(QUALITY.Minimal).includes(name), name).toBe(QUALITY.Minimal[name] > 0);
        }
    });

    it('names each part once, and knows of each whether it stands on the banks, hangs in the air or is far off', () => {
        expect(new Set(STILLWATER_PARTS).size).toBe(STILLWATER_PARTS.length);
        expect([...BANKS, ...AIR, ...UNMIRRORED].sort()).toEqual([...STILLWATER_PARTS].sort());
    });

    it('builds the High tier for a quality it does not know, and the same tarn every time', () => {
        const unknown = new StillwaterWorld({ scene: new THREE.Scene(), quality: 'Nope' }).build();
        const high = new StillwaterWorld({ scene: new THREE.Scene(), quality: 'High' }).build();
        const bare = new StillwaterWorld({ scene: new THREE.Scene() }).build();
        for (const world of [unknown, bare]) {
            expect(world.tier).toBe(QUALITY.High);
            expect(Object.keys(world.parts).sort()).toEqual(Object.keys(high.parts).sort());
            expect(world.trunkPlan).toEqual(high.trunkPlan);
            for (const name of ['trunks', 'boughs', 'ground']) {
                expect(Array.from(world.parts[name].geometry.getAttribute('position').array))
                    .toEqual(Array.from(high.parts[name].geometry.getAttribute('position').array));
            }
        }
        unknown.dispose();
        high.dispose();
        bare.dispose();
    });

    it('draws only the named parts when asked, and takes a part its tier does not have in its stride', () => {
        const { camera, world } = makeWorld('Minimal');
        const absent = STILLWATER_PARTS.filter((name) => !world.parts[name]);
        expect(absent).toEqual(STILLWATER_PARTS.filter((name) => !partsOf(QUALITY.Minimal).includes(name)));
        world.showOnlyParts(['sky', 'water', ...absent, 'no-such-part']);
        Object.keys(world.parts).forEach((name) => {
            expect(world.parts[name].mesh.visible, name).toBe(name === 'sky' || name === 'water');
        });
        world.showOnlyParts([]);
        expect(Object.values(world.parts).some((part) => part.mesh.visible)).toBe(false);
        world.showOnlyParts(STILLWATER_PARTS);
        expect(Object.values(world.parts).every((part) => part.mesh.visible)).toBe(true);
        // And the whole of play runs without what the tier leaves out.
        expect(() => play(world, camera)).not.toThrow();
        for (const [name, value] of sharedNumbers(world)) expect(Number.isFinite(value), name).toBe(true);
        world.dispose();
    });

    it('hangs what stands on the banks in the stage group, and everything else in the world', () => {
        for (const quality of ['Minimal', 'High']) {
            const { world } = makeWorld(quality);
            expect(world.stage.parent).toBe(world.root);
            for (const name of Object.keys(world.parts)) {
                const { mesh } = world.parts[name];
                expect(mesh.parent, `${quality}.${name}`).toBe(BANKS.includes(name) ? world.stage : world.root);
            }
            // The world, the stage, the parts, and (with a mirror pass) the plane the pass mirrors about.
            const loose = Object.keys(world.parts).filter((name) => !BANKS.includes(name)).length;
            expect(world.root.children).toHaveLength(1 + loose + (QUALITY[quality].mirror > 0 ? 1 : 0));
            expect(world.stage.children).toHaveLength(Object.keys(world.parts).length - loose);
            world.dispose();
        }
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
            const plane = world.water.reflectorTarget;
            if (plane) expect(plane.layers.isEnabled(HERO_LAYER)).toBe(false);
            world.dispose();
        }
        expect(HERO_LAYER).toBeGreaterThan(0);
        expect(HERO_LAYER).toBeLessThan(32);
    });

    it('shows the camera it is bound to both layers, and the mirror\'s camera only what stands in the scene', () => {
        const { camera, world } = makeWorld('High');
        expect(camera.layers.isEnabled(0)).toBe(true);
        expect(camera.layers.isEnabled(HERO_LAYER)).toBe(true);
        const { reflector } = world.water.reflection;
        expect(reflector.getVirtualCamera(camera).layers.mask).toBe(1 << HERO_LAYER);
        // Another camera (a rebuild's, a capture's) is bound the same way.
        const other = new THREE.PerspectiveCamera(50, 1.5, 0.5, 600);
        expect(other.layers.isEnabled(HERO_LAYER)).toBe(false);
        world.bindCamera(other);
        expect(other.layers.isEnabled(HERO_LAYER)).toBe(true);
        expect(reflector.getVirtualCamera(other).layers.mask).toBe(1 << HERO_LAYER);
        expect(() => world.bindCamera(null)).not.toThrow();
        world.dispose();
        // A tier with no mirror pass binds a camera just the same.
        const plain = makeWorld('Low');
        expect(plain.world.water.reflection).toBeNull();
        expect(plain.camera.layers.isEnabled(HERO_LAYER)).toBe(true);
        plain.world.dispose();
    });

    // three sorts by a Group's renderOrder before any mesh's own. A part made of several draws
    // (the spirit and her halo; the troll, his staff and his lantern's glow) must therefore carry
    // no order on its group, or all its draws would come after everything outside it.
    it('draws the sky last of what is solid, and the lights after the mist, each in a place of its own', () => {
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
        expect(drawn.length).toBeGreaterThan(STILLWATER_PARTS.length);
        // No group outranks the orders of what is in it.
        expect(drawn.filter((item) => item.groupOrder !== 0)).toEqual([]);
        const solid = drawn.filter((item) => !item.transparent).sort((a, b) => a.renderOrder - b.renderOrder);
        const blended = drawn.filter((item) => item.transparent).sort((a, b) => a.renderOrder - b.renderOrder);
        // The sky's shader runs only where the distance shows between the trunks; the water's only where no bank hides it.
        expect(solid.at(-1).name).toMatch(/Sky/);
        const place = (list, pattern) => list.findIndex((item) => pattern.test(item.name));
        for (const pattern of [/Ground/, /Trunks/, /Boulders/]) {
            expect(place(solid, pattern)).toBeGreaterThanOrEqual(0);
            expect(place(solid, pattern)).toBeLessThan(place(solid, /Water/));
        }
        // What is blended is drawn back to front by its place in the list: no two share one.
        expect(new Set(blended.map((item) => item.renderOrder)).size).toBe(blended.length);
        expect(place(blended, /Mist/)).toBe(0);
        for (const pattern of [/Wisps/, /Sparks/, /Drops/, /Eyes/, /Fireflies/, /Halo/, /Glow/]) {
            expect(place(blended, pattern), String(pattern)).toBeGreaterThan(0);
        }
        world.dispose();
    });

    it('takes the renderer\'s clear colour for the mirror pass and hands it back when it goes', () => {
        const renderer = standInRenderer();
        const { scene, camera, world } = makeWorld('Medium', { renderer });
        // The mirror pass is laid over the mirrored distance by its alpha: it must clear to nothing.
        expect(renderer.clear.alpha).toBe(0);
        expect(renderer.clear.color.getHex()).toBe(0x000000);
        expect(scene.children).toContain(world.root);
        const disposals = [];
        Object.values(world.parts).forEach((part) => {
            if (part.geometry) disposals.push(vi.spyOn(part.geometry, 'dispose'));
            disposals.push(vi.spyOn(part.material, 'dispose'));
        });
        expect(world.textures.length).toBeGreaterThanOrEqual(2); // the noise field, the shore map
        world.textures.forEach((texture) => disposals.push(vi.spyOn(texture, 'dispose')));
        const mirror = vi.spyOn(world.water.reflection, 'dispose');
        expect(world.disposed).toBe(false);
        world.dispose();
        expect(world.disposed).toBe(true);
        expect(scene.children).toHaveLength(0);
        for (const disposal of disposals) expect(disposal).toHaveBeenCalled();
        expect(mirror).toHaveBeenCalledOnce();
        expect(renderer.clear.color.getHex()).toBe(0x123456);
        expect(renderer.clear.alpha).toBe(1);
        expect(camera.layers.isEnabled(HERO_LAYER)).toBe(false);
        expect(camera.layers.isEnabled(0)).toBe(true);
        expect(world.parts).toEqual({});
        expect(world.textures).toEqual([]);
        // A second dispose does nothing at all.
        const calls = renderer.setClearColor.mock.calls.length;
        const counts = disposals.map((disposal) => disposal.mock.calls.length);
        expect(() => world.dispose()).not.toThrow();
        expect(disposals.map((disposal) => disposal.mock.calls.length)).toEqual(counts);
        expect(mirror).toHaveBeenCalledOnce();
        expect(renderer.setClearColor).toHaveBeenCalledTimes(calls);
    });

    it('ignores a late frame and a late event once it has been retired', () => {
        const { scene, camera, world } = makeWorld('Minimal');
        world.onLock({ u: 0.2, color: '#C36F73' });
        run(world, camera, 1);
        const before = JSON.stringify(world.getPostState());
        const { time } = world;
        world.dispose();
        expect(() => {
            world.update({ time: 99, delta: 0.016 });
            world.update({ time: 100, delta: 0.016 }, camera);
            world.onLock({ u: 0.5 });
            world.onLock({ u: 0.2, hardDrop: true });
            world.onClear({ lines: 4, perfect: true });
            world.onCombo(3);
            world.onCombo(0);
            world.onGameOver();
            world.levelUp(2);
            world.levelUp(3, { silent: true });
            world.setViewport(800, 600, 800 / 600);
            world.setViewport(390, 844, 390 / 844);
            world.setLayout(null);
            world.setLayout(fallbackLayout(800, 600), 800 / 600);
            world.setReducedMotion(true);
            world.setHourDrift(false);
            world.showOnlyParts(['sky']);
            world.resetSession();
        }).not.toThrow();
        // Nothing was started and no frame was taken: the clock, the counts and what the post reads are as they were.
        expect(world.time).toBe(time);
        expect(world.counts.locks).toBe(0); // (the new run just asked for started its counts again)
        expect(world.rings.length + world.strokes.length).toBeLessThanOrEqual(1);
        expect(JSON.stringify(world.getPostState())).toBe(before);
        expect(scene.children).toHaveLength(0);
        expect(world.getState()).toMatchObject({
            rings: 0, strokes: 0, wisps: 0, trunks: 0, boulders: 0, sparks: 0, mirror: false, trollReady: false,
        });
        expect(() => world.seek(3)).not.toThrow();
        expect(() => world.bindCamera(camera)).not.toThrow();
    });

    it('builds and retires without a renderer, and before it is built answers no event', () => {
        const scene = new THREE.Scene();
        const world = new StillwaterWorld({ scene, quality: 'Minimal' });
        expect(() => {
            world.onLock({ u: 0.2 });
            world.onClear({ lines: 2 });
            world.onCombo(2);
            world.levelUp(2);
            world.update({ time: 1, delta: 0.016 });
            world.setViewport(800, 600, 800 / 600);
            world.setLayout(null, 800 / 600);
            world.resetSession();
            world.onGameOver();
            world.showOnlyParts(['sky']);
        }).not.toThrow();
        expect(scene.children).toHaveLength(0);
        expect(world.counts.locks).toBe(0);
        expect(world.getState()).toMatchObject({ rings: 0, wisps: 0, trollReady: false });
        expect(world.getPostState()).toBeTruthy();
        world.build();
        expect(scene.children).toEqual([world.root]);
        world.dispose();
        expect(scene.children).toHaveLength(0);
    });
});

describe('stillwater world: the troll\'s sculpt', () => {
    it('needs no sculpt: the whole of play runs with the lantern standing by itself', async () => {
        const { camera, world } = makeWorld('Low');
        expect(world.getState().trollReady).toBe(false);
        expect(() => play(world, camera)).not.toThrow();
        for (const [name, value] of sharedNumbers(world)) expect(Number.isFinite(value), name).toBe(true);
        // His lantern is lit and stands by his seat, over the bank.
        const lantern = world.u.lanternAt.value;
        expect(lantern.w).toBeGreaterThan(0);
        expect(lantern.y).toBeGreaterThan(TROLL.home[1]);
        expect(Math.hypot(lantern.x - TROLL.home[0], lantern.z - TROLL.home[2])).toBeLessThan(TROLL.height);
        world.dispose();
    });

    it.each(['Minimal', 'High'])(
        'takes the sculpt when it arrives: mirrored, in the troll\'s own material, walking by the ground covered (%s)',
        async (quality) => {
            const { camera, world } = makeWorld(quality);
            const made = fakeSculpt();
            sculpt.load = () => Promise.resolve(made.gltf);
            await expect(world.prepare()).resolves.toBe(true);
            // It fetched the mesh its tier pays for.
            expect(sculpt.urls).toHaveLength(1);
            expect(sculpt.urls[0]).toContain(`troll-lod${QUALITY[quality].troll}.glb`);
            expect(world.getState().trollReady).toBe(true);
            expect(world.troll.ready).toBe(true);
            expect(world.troll.failed).toBe(false);
            // He stands in the troll's group, shaded as part of the place, and the water mirrors him.
            let found = null;
            world.troll.mesh.traverse((object) => {
                if (object === made.mesh) found = object;
                expect(object.layers.mask, object.name || object.type).toBe(1 << HERO_LAYER);
            });
            expect(found).toBe(made.mesh);
            expect(made.mesh.material).toBe(world.troll.material);
            expect(made.mesh.material.isNodeMaterial).toBe(true);
            expect(made.mesh.frustumCulled).toBe(false);
            expect(made.geometry.getAttribute('normal')).toBeTruthy();
            // His soles are on the ground at his seat: the sculpt stands a unit tall about its middle.
            run(world, camera, 0.5);
            world.root.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(made.mesh);
            expect(box.min.y).toBeCloseTo(TROLL.home[1], 4);
            expect(box.max.y - box.min.y).toBeCloseTo(TROLL.height, 4);
            // Standing, he is as he was sculpted; a chain sets him walking, and the walk is played by his stride.
            const atRest = made.bones.leg.quaternion.clone();
            let swung = 0;
            world.onCombo(8);
            run(world, camera, 1.2, 60, () => {
                swung = Math.max(swung, made.bones.leg.quaternion.angleTo(atRest));
            });
            expect(swung).toBeGreaterThan(0.1);
            // He stops at the water, and stands again.
            run(world, camera, 6);
            expect(made.bones.leg.quaternion.angleTo(atRest)).toBeLessThan(0.01);
            // His head turns to a clear, over the walk's own turn of it.
            const head = made.bones.head.quaternion.clone();
            world.onClear({ lines: 2 });
            run(world, camera, 0.4);
            expect(made.bones.head.quaternion.angleTo(head)).toBeGreaterThan(0.05);
            for (const [name, value] of sharedNumbers(world)) expect(Number.isFinite(value), name).toBe(true);
            // When the world goes, so does he.
            const gone = vi.spyOn(made.geometry, 'dispose');
            world.dispose();
            expect(gone).toHaveBeenCalledOnce();
        },
    );

    it('takes a sculpt with no walk in it, and stands him still', async () => {
        const { camera, world } = makeWorld('Low');
        const made = fakeSculpt({ walk: false });
        sculpt.load = () => Promise.resolve(made.gltf);
        await expect(world.prepare()).resolves.toBe(true);
        expect(world.getState().trollReady).toBe(true);
        expect(() => play(world, camera)).not.toThrow();
        world.dispose();
    });

    it('survives a sculpt that cannot be had: it says so once and plays on without him', async () => {
        const { camera, world } = makeWorld('Low');
        const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
        sculpt.load = () => Promise.reject(new Error('404'));
        await expect(world.prepare()).resolves.toBe(false);
        expect(warned).toHaveBeenCalledOnce();
        expect(world.getState().trollReady).toBe(false);
        expect(world.troll.failed).toBe(true);
        expect(() => play(world, camera)).not.toThrow();
        // The chain still brings his lantern down to the water.
        world.onCombo(8);
        const before = world.u.lanternAt.value.clone();
        run(world, camera, 5);
        expect(world.getState().troll).toBe(1);
        const now = world.u.lanternAt.value;
        expect(Math.hypot(now.x - before.x, now.y - before.y, now.z - before.z)).toBeGreaterThan(1);
        for (const [name, value] of sharedNumbers(world)) expect(Number.isFinite(value), name).toBe(true);
        world.dispose();
    });

    it('drops a sculpt that arrives after the world has gone', async () => {
        const { scene, world } = makeWorld('Minimal');
        const made = fakeSculpt();
        let arrive;
        sculpt.load = () => new Promise((resolve) => {
            arrive = resolve;
        });
        const preparing = world.prepare();
        world.dispose();
        arrive(made.gltf);
        await expect(preparing).resolves.toBe(false);
        expect(made.mesh.parent).toBe(made.gltf.scene); // it was never taken in
        expect(scene.children).toHaveLength(0);
        expect(world.getState().trollReady).toBe(false);
        // A world that was never built, or is already gone, has nothing to prepare.
        await expect(world.prepare()).resolves.toBe(false);
        await expect(new StillwaterWorld({ scene: new THREE.Scene() }).prepare()).resolves.toBe(false);
    });
});

describe('stillwater world: the frame', () => {
    it('rests at the eye, looking a little below the horizontal, with the lens its frame asks for', () => {
        for (const [width, height] of [...WIDE, ...UPRIGHT]) {
            const { camera, world } = makeWorld('Minimal', { width, height, reduced: true });
            const aspect = width / height;
            expect(camera.position.toArray()).toEqual([EYE.x, EYE.y, EYE.z]);
            expect(camera.fov).toBe(fovForAspect(aspect));
            expect(camera.near).toBe(REST_RIG.near);
            expect(camera.far).toBe(REST_RIG.far);
            const gaze = camera.getWorldDirection(new THREE.Vector3());
            expect(gaze.x).toBeCloseTo(0, 9);
            expect(Math.atan2(gaze.y, -gaze.z)).toBeCloseTo(EYE.pitch, 9);
            // The far waterline lies a little above the middle of the frame: more water than sky below it.
            const far = onScreen([0, 0, -60], camera);
            expect(far.y).toBeGreaterThan(0.35);
            expect(far.y).toBeLessThan(0.5);
            // The water at the viewer's feet is at the bottom of it.
            expect(onScreen([0, 0, 2], camera).y).toBeGreaterThan(0.8);
            world.dispose();
        }
        expect(REST_RIG).toMatchObject({
            hFov: EYE.hFov, minFov: EYE.minFov, maxFov: EYE.maxFov, near: EYE.near, far: EYE.far,
        });
    });

    it('breathes: the view sways a little, never far, and a hard drop kicks the lens', () => {
        const { camera, world } = makeWorld('Minimal');
        const rest = new THREE.Vector3(EYE.x, EYE.y, EYE.z);
        let wandered = 0;
        for (let i = 0; i < 120; i++) {
            run(world, camera, 2, 1);
            const away = camera.position.distanceTo(rest);
            wandered = Math.max(wandered, away);
            expect(away).toBeLessThan(0.5);
            expect(camera.position.y).toBeGreaterThan(EYE.y - 0.2);
            expect(Math.abs(camera.getWorldDirection(new THREE.Vector3()).x)).toBeLessThan(0.02);
        }
        expect(wandered).toBeGreaterThan(0.02);
        const { fov } = camera;
        world.onLock({ u: 0.2, hardDrop: true });
        run(world, camera, 1 / 60);
        expect(camera.fov).toBeLessThan(fov);
        expect(world.getPostState().kick).toBeGreaterThan(0);
        run(world, camera, 3);
        expect(camera.fov).toBeCloseTo(fov, 5);
        expect(world.getPostState().kick).toBeLessThan(1e-6);
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

    it('finds the world point along the ray through a screen point, and where that ray meets the water', () => {
        const { camera, world } = makeWorld('Minimal');
        for (const [sx, sy, depth] of [[0.3, 0.7, 12], [0.5, 0.5, 6.5], [0.95, 0.1, 40]]) {
            const out = [0, 0, 0];
            expect(world.screenToWorld(sx, sy, depth, out)).toBe(out);
            expect(new THREE.Vector3(...out).distanceTo(camera.position)).toBeCloseTo(depth, 6);
            const seen = onScreen(out, camera);
            expect(seen.x).toBeCloseTo(sx, 6);
            expect(seen.y).toBeCloseTo(sy, 6);
        }
        for (const [sx, sy] of [[0.2, 0.7], [0.5, 0.9], [0.8, 0.6], [0.5, 0.55]]) {
            const hit = world.screenToWater(sx, sy);
            expect(hit[1]).toBe(0);
            const seen = onScreen(hit, camera);
            expect(seen.x).toBeCloseTo(sx, 6);
            expect(seen.y).toBeCloseTo(sy, 6);
        }
        // Above the horizon a ray never meets the water; nor is a point beyond the far shore one.
        expect(world.screenToWater(0.5, 0.2)).toBeNull();
        expect(world.screenToWater(0.5, 0.45)).toBeNull();
        expect(world.screenToWater(0.5, 0.9, [0, 0, 0], 2)).toBeNull();
        // Open water is water clear of the banks.
        expect(world.onWater(0, -20)).toBe(true);
        expect(world.onWater(EYE.x, EYE.z)).toBe(false);
        expect(world.onWater(SPIRIT.reach[0], SPIRIT.reach[2])).toBe(true);
        expect(world.onWater(TROLL.home[0], TROLL.home[2])).toBe(false);
        world.dispose();
        // Before any camera is bound it aims straight ahead from the eye, and a lock still lands on the water.
        const blind = new StillwaterWorld({ scene: new THREE.Scene(), quality: 'Minimal' }).build();
        expect(blind.screenToWorld(0.2, 0.9, 5, [1, 1, 1])).toEqual([0, EYE.y, EYE.z - 5]);
        expect(blind.screenToWater(0.5, 0.9)).toBeNull();
        const rings = recordRings(blind);
        blind.onLock({ u: 0.2 });
        blind.onLock({ u: 0.8 });
        expect(rings).toHaveLength(2);
        expect(rings.map((ring) => Math.sign(ring.x))).toEqual([-1, 1]);
        for (const ring of rings) expect(ring.edge).toBeLessThan(0);
        blind.dispose();
    });

    it('follows the frame: the viewport, the pixel\'s angle, the lens and where a board would stand', () => {
        const { camera, world } = makeWorld('Minimal', { live: false });
        expect(world.u.viewport.value.toArray()).toEqual([1600, 900]);
        const pixel = () => (2 * Math.tan((fovForAspect(world.aspect) * DEG) / 2)) / world.u.viewport.value.y;
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
        // Back to a desktop's shape: where a lock's light leaves the card follows at once.
        world.setViewport(1600, 900, 1600 / 900);
        expect(cardUnion(world.layout).x0).toBeCloseTo(wide.x0, 9);
        // A live board is not moved by a resize: the theme reads its rects again.
        const rects = fallbackLayout(1600, 900);
        world.setLayout(rects, 1600 / 900);
        world.setViewport(390, 844, 390 / 844);
        expect(world.layout).toBe(rects);
        expect(world.getState().layoutLive).toBe(true);
        // The board leaves the screen: back to where it would stand in this frame.
        world.setLayout(null);
        expect(world.getState().layoutLive).toBe(false);
        expect(cardUnion(world.layout).x0).toBeCloseTo(upright.x0, 9);
        // Nonsense leaves the frame as it was.
        world.setViewport(0, -4, NaN);
        world.setLayout(null, -1);
        world.setLayout(null, Infinity);
        expect(world.u.viewport.value.toArray()).toEqual([390, 844]);
        expect(world.aspect).toBe(390 / 844);
        expect(Number.isFinite(world.u.pixelAngle.value)).toBe(true);
        world.dispose();
    });

    it('draws the stage in on a tall frame, keeps the two figures their width, and moves the moon', () => {
        const { camera, world } = makeWorld('Low');
        const size = (object) => {
            world.root.updateMatrixWorld(true);
            return new THREE.Vector3().setFromMatrixScale(object.matrixWorld);
        };
        const wideMoon = world.u.moonDir.value.clone();
        expect(world.stage.scale.x).toBe(1);
        expect(world.u.squeeze.value).toBe(1);
        expect(wideMoon.toArray()).toEqual(skyDirection(MOON.azimuth, MOON.elevation));
        expect(world.u.moonAz.value).toBe(MOON.azimuth);
        for (const [width, height] of UPRIGHT) {
            const aspect = width / height;
            const squeeze = squeezeFor(aspect);
            expect(squeeze).toBeLessThan(1);
            // Either call the theme makes on a resize carries the frame's shape.
            if (width === 430) world.setLayout(fallbackLayout(width, height), aspect);
            else world.setViewport(width, height, aspect);
            frame(world, camera, world.time, 0);
            const label = `${width} × ${height}`;
            expect(world.squeeze, label).toBe(squeeze);
            expect(world.getState().squeeze, label).toBe(squeeze);
            expect(world.stage.scale.x, label).toBe(squeeze);
            expect(world.stage.scale.y, label).toBe(1);
            expect(world.stage.scale.z, label).toBe(1);
            expect(world.u.squeeze.value, label).toBe(squeeze);
            // The two are widened by what the stage is drawn in by: neither is squeezed.
            expect(world.spirit.figure.scale.x, label).toBeCloseTo(1 / squeeze, 12);
            expect(world.troll.figure.scale.x, label).toBeCloseTo(1 / squeeze, 12);
            expect(size(world.spirit.figure).toArray(), label).toEqual([1, 1, 1].map((v) => expect.closeTo(v, 9)));
            expect(size(world.troll.figure).toArray(), label).toEqual([1, 1, 1].map((v) => expect.closeTo(v, 9)));
            // They stand where the banks now are.
            const spirit = new THREE.Vector3().setFromMatrixPosition(world.spirit.figure.matrixWorld);
            const troll = new THREE.Vector3().setFromMatrixPosition(world.troll.figure.matrixWorld);
            expect(spirit.x, label).toBeCloseTo(SPIRIT.home[0] * squeeze, 9);
            expect(troll.x, label).toBeCloseTo(TROLL.home[0] * squeeze, 9);
            // Their lights are where they stand: the water, the banks and the wisps read these.
            expect(world.u.spiritAt.value.x, label).toBeCloseTo(spirit.x, 6);
            expect(world.u.spiritAt.value.z, label).toBeCloseTo(SPIRIT.home[2], 6);
            expect(Math.abs(world.u.lanternAt.value.x - troll.x), label).toBeLessThan(TROLL.height);
            expect(world.u.heartAt.value.x, label).toBeCloseTo(HEART[0] * squeeze, 9);
            // The moon comes in with the stage and climbs.
            const moon = moonFor(aspect);
            expect(world.u.moonDir.value.toArray(), label).toEqual(skyDirection(moon.azimuth, moon.elevation));
            expect(world.u.moonAz.value, label).toBe(moon.azimuth);
            expect(world.u.moonDir.value.y, label).toBeGreaterThan(wideMoon.y);
            expect(Math.abs(world.u.moonDir.value.x), label).toBeLessThan(Math.abs(wideMoon.x));
        }
        // Back on a wide frame it is all as built.
        world.setViewport(1600, 900, 1600 / 900);
        frame(world, camera, world.time, 0);
        expect(world.stage.scale.x).toBe(1);
        expect(world.spirit.figure.scale.x).toBe(1);
        expect(world.troll.figure.scale.x).toBe(1);
        expect(world.u.moonDir.value.toArray()).toEqual(wideMoon.toArray());
        world.dispose();
    });

    it('tells the post where the moon and the tarn\'s heart are on screen', () => {
        for (const [width, height] of [[1600, 900], [390, 844]]) {
            const { camera, world } = makeWorld('Minimal', { width, height });
            const post = world.getPostState();
            for (let i = 0; i < 20; i++) {
                run(world, camera, 1.7, 1);
                const moon = world.u.moonDir.value;
                const far = camera.position.clone().add(moon.clone().multiplyScalar(500));
                const seen = onScreen(far.toArray(), camera);
                expect(post.moon.x).toBeCloseTo(seen.x, 9);
                expect(post.moon.y).toBeCloseTo(seen.y, 9);
                const heart = onScreen([HEART[0] * world.squeeze, 0, HEART[2]], camera);
                expect(post.heart.x).toBeCloseTo(heart.x, 9);
                expect(post.heart.y).toBeCloseTo(heart.y, 9);
                // The moon is in the frame, left of the middle and in its upper half; the heart lies behind the card.
                expect(post.moon.x).toBeGreaterThan(0);
                expect(post.moon.x).toBeLessThan(0.5);
                expect(post.moon.y).toBeGreaterThan(0);
                expect(post.moon.y).toBeLessThan(0.5);
                const card = cardUnion(world.layout);
                expect(post.heart.x).toBeGreaterThan(card.x0);
                expect(post.heart.x).toBeLessThan(card.x1);
            }
            // The post reads the same points, not copies of them; the state hands out copies.
            expect(post.moon).toBe(world.moonScreen);
            expect(post.heart).toBe(world.heartScreen);
            expect(world.getState().moon).toEqual(world.moonScreen);
            expect(world.getState().moon).not.toBe(world.moonScreen);
            world.dispose();
        }
    });

    it('stands the spirit left of the card and the troll right of it, both in the frame, on any frame', () => {
        for (const [width, height] of [...WIDE, ...UPRIGHT]) {
            const { camera, world } = makeWorld('Minimal', { width, height, reduced: true });
            const card = cardUnion(world.layout);
            world.root.updateMatrixWorld(true);
            const middle = (figure, height0) => {
                const p = new THREE.Vector3().setFromMatrixPosition(figure.matrixWorld);
                return onScreen([p.x, p.y + height0 * 0.5, p.z], camera);
            };
            const spirit = middle(world.spirit.figure, SPIRIT.height);
            const troll = middle(world.troll.figure, TROLL.height);
            const label = `${width} × ${height}`;
            expect(spirit.x, label).toBeGreaterThan(0);
            expect(spirit.x, label).toBeLessThan(card.x0);
            expect(troll.x, label).toBeGreaterThan(card.x1);
            expect(troll.x, label).toBeLessThan(1);
            for (const seen of [spirit, troll]) {
                expect(seen.y, label).toBeGreaterThan(0.2);
                expect(seen.y, label).toBeLessThan(0.8);
            }
            // His lantern is in the frame too, and on a wide one clear of the card.
            const lantern = onScreen(world.u.lanternAt.value.toArray().slice(0, 3), camera);
            expect(lantern.x, label).toBeGreaterThan(0.5);
            expect(lantern.x, label).toBeLessThan(1);
            if (width > height) expect(lantern.x, label).toBeGreaterThan(card.x1);
            world.dispose();
        }
    });

    // A known limit of narrow frames, left open. The troll keeps his width on a narrow frame while
    // the strip beside the card narrows with it: his lantern, which he holds out toward the board,
    // then hangs behind the card's edge (430 × 932: the flame at 0.777 of the width, the card's
    // edge at 0.804; 390 × 844: 0.778, the edge at 0.836). Expected: the flame in the strip beside
    // the card, where his light and the wisps that fly home to it can be seen.
    it.fails('keeps the troll\'s lantern clear of the card on an upright frame', () => {
        const hidden = [];
        for (const [width, height] of UPRIGHT) {
            const { camera, world } = makeWorld('Minimal', { width, height, reduced: true });
            const card = cardUnion(world.layout);
            const lantern = onScreen(world.u.lanternAt.value.toArray().slice(0, 3), camera);
            const places = `${lantern.x.toFixed(3)} < ${card.x1.toFixed(3)}`;
            if (!(lantern.x > card.x1)) hidden.push(`${width} × ${height}: ${places}`);
            world.dispose();
        }
        expect(hidden).toEqual([]);
    });

    it('keeps the two clear of the card on a wide frame however far a chain draws them', () => {
        for (const [width, height] of WIDE) {
            const { camera, world } = makeWorld('Minimal', { width, height, reduced: true });
            const card = cardUnion(world.layout);
            world.onCombo(20);
            run(world, camera, 12, 30);
            world.root.updateMatrixWorld(true);
            const spirit = new THREE.Vector3().setFromMatrixPosition(world.spirit.figure.matrixWorld);
            const troll = new THREE.Vector3().setFromMatrixPosition(world.troll.figure.matrixWorld);
            const label = `${width} × ${height}`;
            // (Her own half width is about a fifth of her height; his about a third of his.)
            const herFlank = onScreen([spirit.x + SPIRIT.height * 0.2, spirit.y + 1, spirit.z], camera);
            const hisFlank = onScreen([troll.x - TROLL.height * 0.33, troll.y + 1, troll.z], camera);
            expect(herFlank.x, label).toBeLessThan(card.x0);
            expect(hisFlank.x, label).toBeGreaterThan(card.x1);
            world.dispose();
        }
    });

    /** How many of nine sight lines through the moon's disc (its middle and its rim) a drawn triangle of a part crosses. */
    function moonCrossings(world, camera, names) {
        world.root.updateMatrixWorld(true);
        const moon = moonFor(world.aspect);
        const lines = [[moon.azimuth, moon.elevation]];
        for (let k = 0; k < 8; k++) {
            const turn = (k * Math.PI) / 4;
            lines.push([moon.azimuth + Math.cos(turn) * MOON.radius, moon.elevation + Math.sin(turn) * MOON.radius]);
        }
        const corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
        const hit = new THREE.Vector3();
        let crossed = 0;
        for (const [azimuth, elevation] of lines) {
            const ray = new THREE.Ray(camera.position.clone(), new THREE.Vector3(...skyDirection(azimuth, elevation)));
            let blocked = false;
            for (const name of names) {
                const part = world.parts[name];
                if (!part || !part.mesh.visible || blocked) continue;
                const position = part.geometry.getAttribute('position');
                const index = part.geometry.getIndex();
                for (let i = 0; i < index.count && !blocked; i += 3) {
                    corners.forEach((corner, k) => {
                        corner.fromBufferAttribute(position, index.getX(i + k)).applyMatrix4(part.mesh.matrixWorld);
                    });
                    if (ray.intersectTriangle(corners[0], corners[1], corners[2], false, hit)) blocked = true;
                }
            }
            if (blocked) crossed += 1;
        }
        return crossed;
    }

    it('leaves the moon clear of trunks and boughs on any frame, as the frame is really drawn', () => {
        for (const quality of ['Minimal', 'High']) {
            for (const [width, height] of [[1600, 900], [2560, 1080], [1280, 1024], [1000, 1000], ...UPRIGHT]) {
                const { camera, world } = makeWorld(quality, { width, height, reduced: true });
                const label = `${quality} at ${width} × ${height}`;
                expect(moonCrossings(world, camera, ['trunks', 'boughs', 'fringe']), label).toBe(0);
                // The moon the sky draws is the one the sight lines were cast at.
                const moon = moonFor(width / height);
                expect(world.u.moonDir.value.toArray(), label).toEqual(skyDirection(moon.azimuth, moon.elevation));
                world.dispose();
            }
        }
    });

    it('hangs the giants\' boughs along the top of a wide frame', () => {
        const { camera, world } = makeWorld('High', { reduced: true });
        world.root.updateMatrixWorld(true);
        const { fringe } = world.parts;
        expect(fringe).toBeTruthy();
        expect(fringe.count).toBeGreaterThanOrEqual(2);
        // Drawn: its matrix has a size.
        expect(Math.abs(fringe.mesh.matrixWorld.determinant())).toBeGreaterThan(0.5);
        const position = fringe.geometry.getAttribute('position');
        let inFrame = 0;
        let low = 0;
        for (let i = 0; i < position.count; i++) {
            const p = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(fringe.mesh.matrixWorld);
            const seen = onScreen(p.toArray(), camera);
            if (seen.x > 0 && seen.x < 1 && seen.y > 0 && seen.y < 1) inFrame += 1;
            if (seen.x > 0 && seen.x < 1 && seen.y > 0.45) low += 1;
        }
        // Some of it hangs into the picture, none of it down across the middle.
        expect(inFrame).toBeGreaterThan(0);
        expect(low).toBe(0);
        world.dispose();
    });
});

describe('stillwater world: locks', () => {
    it.each([
        ['no board on screen (the solo board\'s place)', 1600, 900, false],
        ['a live board', 1584, 813, true],
    ])('drops a lock\'s light into open water on the piece\'s side, leaving a wisp: %s', (_, width, height, live) => {
        for (const [u, side] of [[0.2, -1], [0.85, 1]]) {
            const { camera, world } = makeWorld('Low', { width, height, live });
            const launches = record(world.drops, 'launch');
            const rings = recordRings(world);
            const card = cardUnion(world.layout);
            const board = world.layout.boards[0];
            const rgb = pieceColor('#6CC7C6');
            const t0 = world.time;
            world.onLock({ u, rows: [12, 13], color: '#6CC7C6' });
            expect(world.counts).toMatchObject({ locks: 1, wisps: 1, clears: 0 });

            // ── The drop: it leaves the card's edge on the piece's side, at the piece's height, now ──
            expect(launches).toHaveLength(1);
            const [drop] = launches[0];
            expect(drop.time).toBe(t0);
            expect(drop.flight).toBeGreaterThan(0);
            expect(drop.flight).toBeLessThanOrEqual(DROP_FLIGHT * 2);
            expect(drop.rgb).toEqual(rgb);
            const start = onScreen(drop.from, camera);
            expect(start.x).toBeCloseTo(side < 0 ? card.x0 : card.x1, 4);
            expect(start.y).toBeCloseTo(boardPoint(board, u, 13).y, 4);

            // ── The ring: one, when the drop lands, on open water on that side ──
            expect(rings).toHaveLength(1);
            const [ring] = rings;
            expect(ring.time).toBeCloseTo(t0 + drop.flight, 12);
            expect([ring.x, ring.z]).toEqual([drop.to[0], drop.to[2]]);
            expect(Math.sign(ring.x)).toBe(side);
            expect(ring.edge).toBeLessThan(0);
            expect(world.onWater(ring.x, ring.z)).toBe(true);
            expect(ring.rgb).toEqual(rgb);
            expect(ring.strength).toBeGreaterThan(0);
            expect(ring.reach).toBeGreaterThan(0);
            // It lands beside the card, not behind it, and in the frame.
            const landing = onScreen([ring.x, 0, ring.z], camera);
            if (side < 0) expect(landing.x).toBeLessThan(card.x0);
            else expect(landing.x).toBeGreaterThan(card.x1);
            expect(landing.x).toBeGreaterThan(0);
            expect(landing.x).toBeLessThan(1);
            expect(landing.y).toBeGreaterThan(0.4);
            expect(landing.y).toBeLessThan(1);

            // ── While the drop is in the air the water has the ring to come, and no wisp ──
            run(world, camera, 1 / 60);
            expect(ringsOf(world)).toHaveLength(1);
            expect(ringsOf(world)[0].time).toBeGreaterThan(world.time);
            expect(wispsOf(world)).toHaveLength(0);

            // ── The wisp: over the place the drop fell, in the piece's colour, well within two seconds ──
            run(world, camera, 2 - 1 / 60);
            const wisps = wispsOf(world);
            expect(wisps).toHaveLength(1);
            expect(Math.sign(wisps[0].x)).toBe(side);
            for (let c = 0; c < 3; c++) expect(wisps[0].rgb[c]).toBeCloseTo(rgb[c], 6);
            expect(wisps[0].light).toBeGreaterThan(0.5);
            expect(wisps[0].y).toBeGreaterThan(0.2);
            expect(wisps[0].y).toBeLessThan(3);
            expect(Math.hypot(wisps[0].x - ring.x, wisps[0].z - ring.z)).toBeLessThan(0.6);
            // Its light lies on that bank: the lamp the wisps of a side are gathered into is lit, the other is not.
            const [near, other] = side < 0 ? [world.u.poolL, world.u.poolR] : [world.u.poolR, world.u.poolL];
            expect(near.value.w).toBeGreaterThan(0);
            expect(other.value.w).toBe(0);
            // And it stays, long after the ring has run out.
            run(world, camera, RING_LIVE + 1, 20);
            expect(ringsOf(world)).toHaveLength(0);
            expect(wispsOf(world)).toHaveLength(1);
            expect(world.counts.gathered).toBe(0);
            world.dispose();
        }
    });

    it('lands every lock\'s light on open water on its own side of the card on a wide frame', () => {
        for (const [width, height, live] of [...WIDE.map((f) => [...f, true]), [1600, 900, false]]) {
            const { camera, world } = makeWorld('Low', { width, height, live });
            const rings = recordRings(world);
            const wrong = [];
            for (let i = 0; i < 160; i++) {
                const u = (i * 0.6180339887) % 1;
                if (Math.abs(u - 0.5) < 0.03) continue;
                const side = u < 0.5 ? -1 : 1;
                const from = rings.length;
                world.onLock({ u, rows: [(i * 7) % 20], hardDrop: i % 5 === 0 });
                for (const ring of rings.slice(from)) {
                    const lock = `lock ${i} (u ${u.toFixed(2)})`;
                    const across = Math.sign(ring.x) !== side;
                    if (across) wrong.push(`${lock} fell on the other side, at x ${ring.x.toFixed(1)}`);
                    const ashore = !world.onWater(ring.x, ring.z);
                    if (ashore) wrong.push(`${lock} fell ${ring.edge.toFixed(2)} m from the edge`);
                }
                run(world, camera, 0.37, 30);
            }
            expect(wrong, `${width} × ${height}`).toEqual([]);
            expect(rings.length).toBeGreaterThan(150);
            // They do not all fall in one place: a low piece's light falls near, a high one's far.
            const depths = rings.map((ring) => ring.z);
            expect(Math.max(...depths) - Math.min(...depths)).toBeGreaterThan(5);
            world.dispose();
        }
    });

    it('lands a lock\'s light on open water on a square or an upright frame too', () => {
        for (const [width, height] of [[1000, 1000], ...UPRIGHT]) {
            const { camera, world } = makeWorld('Low', { width, height });
            const rings = recordRings(world);
            for (let i = 0; i < 120; i++) {
                const from = rings.length;
                world.onLock({ u: (i * 0.6180339887) % 1, rows: [(i * 7) % 20], hardDrop: i % 5 === 0 });
                for (const ring of rings.slice(from)) {
                    expect(ring.edge, `${width} × ${height}`).toBeLessThan(0);
                    // In the frame as it is at that moment: the strip of water under the card, or beside it.
                    const seen = onScreen([ring.x, 0, ring.z], camera);
                    expect(seen.x, `${width} × ${height}`).toBeGreaterThan(0);
                    expect(seen.x, `${width} × ${height}`).toBeLessThan(1);
                    expect(seen.y, `${width} × ${height}`).toBeGreaterThan(0.4);
                    expect(seen.y, `${width} × ${height}`).toBeLessThan(1);
                }
                run(world, camera, 0.37, 30);
            }
            expect(rings.length).toBeGreaterThan(120);
            world.dispose();
        }
    });

    // Where a frame has no room beside the card (an upright phone; a square frame, where the stats
    // bar takes the right side's room) the light falls in the strip of water under the card: on
    // the piece's own side of the middle there too, or its wisp would go home to the other bank's
    // figure (a quarter of all lights once did).
    it('keeps a lock\'s light on the piece\'s own side on a square or an upright frame', () => {
        const wrong = [];
        for (const [width, height] of [[1000, 1000], ...UPRIGHT]) {
            const { camera, world } = makeWorld('Low', { width, height });
            const rings = recordRings(world);
            let locks = 0;
            let across = 0;
            for (let i = 0; i < 120; i++) {
                const u = (i * 0.6180339887) % 1;
                if (Math.abs(u - 0.5) < 0.03) continue;
                const from = rings.length;
                world.onLock({ u, rows: [(i * 7) % 20] });
                locks += 1;
                if (Math.sign(rings[from].x) !== (u < 0.5 ? -1 : 1)) across += 1;
                run(world, camera, 0.37, 30);
            }
            if (across > 0) wrong.push(`${width} × ${height}: ${across} of ${locks} on the other side`);
            world.dispose();
        }
        expect(wrong).toEqual([]);
    });

    it('takes turns for a piece down the middle, and a lock with no rows, no colour or no board in its stride', () => {
        const { camera, world } = makeWorld('Low');
        const rings = recordRings(world);
        world.onLock({ u: 0.5 });
        run(world, camera, 0.3);
        world.onLock({ u: 0.5 });
        expect(rings).toHaveLength(2);
        expect(Math.sign(rings[0].x)).toBe(-Math.sign(rings[1].x));
        // With no rows named the piece is taken to lie on the floor; a column off the board is the board's edge.
        const launches = record(world.drops, 'launch');
        world.onLock({ u: 7 });
        const far = onScreen(launches.at(-1)[0].from, camera);
        expect(far.x).toBeCloseTo(cardUnion(world.layout).x1, 4);
        expect(far.y).toBeCloseTo(boardPoint(world.layout.boards[0], 1, 19).y, 4);
        // A piece with no colour leaves the colour the core falls back on.
        expect(launches.at(-1)[0].rgb).toEqual(pieceColor(null));
        expect(() => {
            world.onLock();
            world.onLock({});
            world.onLock({ u: 0.4, rows: [], color: 'not-a-colour' });
            world.onLock({ u: NaN, rows: [NaN] });
            world.onLock({ u: 0.3, rows: 'nineteen', player: 3 });
        }).not.toThrow();
        // A card whose canvas is not up yet (a mode starting): the light still falls on the water.
        world.setLayout({
            cardCount: 1,
            cards: [{
                x0: 0.35, y0: 0.1, x1: 0.65, y1: 0.9,
            }],
            hud: null,
            boards: [null, null, null, null, null],
        }, 1600 / 900);
        world.onLock({ u: 0.2 });
        // And a mode that names a place on the screen is aimed from there.
        world.onLock({ u: 0.9, screen: { x: 0.2, y: 0.7 } });
        expect(Math.sign(rings.at(-1).x)).toBe(-1);
        for (const ring of rings) {
            expect(ring.edge).toBeLessThan(0);
            expect([ring.x, ring.z, ring.time].every(Number.isFinite)).toBe(true);
        }
        run(world, camera, 2);
        for (const [name, value] of sharedNumbers(world)) expect(Number.isFinite(value), name).toBe(true);
        world.dispose();
    });

    it('throws a second ring on a hard drop, on the same side, and still leaves one wisp', () => {
        for (const [u, side] of [[0.25, -1], [0.75, 1]]) {
            const soft = makeWorld('Low');
            const hard = makeWorld('Low');
            const softRings = recordRings(soft.world);
            const rings = recordRings(hard.world);
            const launches = record(hard.world.drops, 'launch');
            const rest = hard.world.u.wind.value;
            soft.world.onLock({ u, rows: [14, 15], color: '#D99A5E' });
            hard.world.onLock({
                u, rows: [14, 15], color: '#D99A5E', hardDrop: true,
            });
            expect(hard.world.counts).toMatchObject({ locks: 1, wisps: 1 });
            // Two drops leave the same point of the card; two rings, both on the piece's side, both on open water.
            expect(launches).toHaveLength(2);
            expect(launches[1][0].from).toEqual(launches[0][0].from);
            expect(softRings).toHaveLength(1);
            expect(rings).toHaveLength(2);
            for (const ring of rings) {
                expect(Math.sign(ring.x)).toBe(side);
                expect(hard.world.onWater(ring.x, ring.z)).toBe(true);
                expect(ring.rgb).toEqual(pieceColor('#D99A5E'));
            }
            // The second falls wide of the first.
            expect(Math.hypot(rings[0].x - rings[1].x, rings[0].z - rings[1].z)).toBeGreaterThan(0.3);
            // The piece's own is the one a soft lock makes, only harder.
            expect([rings[0].x, rings[0].z]).toEqual([softRings[0].x, softRings[0].z]);
            expect(rings[0].strength).toBeGreaterThan(softRings[0].strength);
            expect(rings[0].strength).toBeGreaterThan(rings[1].strength);
            // One wisp, over the piece's own ring, burning the brighter for the fall.
            expect(hard.world.wisps).toHaveLength(1);
            expect([hard.world.wisps[0].x, hard.world.wisps[0].z]).toEqual([rings[0].x, rings[0].z]);
            run(hard.world, hard.camera, 1 / 60);
            run(soft.world, soft.camera, 1 / 60);
            expect(ringsOf(hard.world)).toHaveLength(2);
            expect(ringsOf(soft.world)).toHaveLength(1);
            // It kicks the lens harder and stirs the air.
            expect(hard.world.getPostState().kick).toBeGreaterThan(soft.world.getPostState().kick);
            expect(hard.world.getPostState().flash).toBeGreaterThan(soft.world.getPostState().flash);
            expect(hard.camera.fov).toBeLessThan(soft.camera.fov);
            expect(hard.world.u.wind.value).toBeGreaterThan(rest);
            expect(soft.world.u.wind.value).toBeCloseTo(rest, 9);
            run(hard.world, hard.camera, 3);
            run(soft.world, soft.camera, 3);
            expect(wispsOf(hard.world)).toHaveLength(1);
            expect(wispsOf(soft.world)).toHaveLength(1);
            expect(wispsOf(hard.world)[0].light).toBeGreaterThan(wispsOf(soft.world)[0].light);
            soft.world.dispose();
            hard.world.dispose();
        }
    });

    it('never holds more wisps than it has slots for: the oldest goes home when another comes', () => {
        const { camera, world } = makeWorld('Low');
        const audit = () => {
            const { x, y, z } = world.u.counts.value;
            expect(x).toBeLessThanOrEqual(RING_SLOTS);
            expect(y).toBeLessThanOrEqual(STROKE_SLOTS);
            expect(z).toBeLessThanOrEqual(WISP_SLOTS);
            for (const table of [world.u.ringRows, world.u.strokeRows, world.u.wispRows]) {
                for (const row of table) expect(row.toArray().every(Number.isFinite)).toBe(true);
            }
            // Every row the shaders are told to read is a light that is lit.
            for (const wisp of wispsOf(world)) expect(wisp.light).toBeGreaterThan(0);
        };
        let fed = 0;
        const watch = () => {
            audit();
            fed = Math.max(fed, ...world.getState().fed);
        };
        for (let i = 0; i < 60; i++) {
            world.onLock({
                u: i % 2 ? 0.8 : 0.2,
                rows: [19 - (i % 10)],
                color: i % 3 ? '#9A7FB7' : '#F2D68A',
                hardDrop: i % 7 === 0,
            });
            run(world, camera, 0.25, 60, watch);
        }
        expect(world.counts).toMatchObject({ locks: 60, wisps: 60, gathered: 60 - WISP_SLOTS });
        // Those sent home fed the one they went to.
        expect(fed).toBeGreaterThan(0);
        // When the last of them has come home, a full pool stands over the water, and no more.
        run(world, camera, WISP_HOME + 1, 60, audit);
        expect(world.wisps).toHaveLength(WISP_SLOTS);
        expect(wispsOf(world)).toHaveLength(WISP_SLOTS);
        expect(world.wisps.every((wisp) => wisp.gatherAt === Infinity)).toBe(true);
        // The rings table wraps the same way.
        expect(world.rings.length).toBeLessThanOrEqual(RING_SLOTS);
        world.dispose();
    });

    // When the pool is full the one sent home to make room is still on its way (WISP_HOME seconds)
    // when the new wisp's drop lands: there are more lit wisps than rows for that while, and it
    // is the newest that must be drawn. (The table was once written oldest first: a new wisp was
    // not drawn for the first 0.8 s of its life, its whole rise out of the splash, then appeared
    // all at once.)
    it('draws a new wisp from the moment its drop lands when the pool is full', () => {
        const { camera, world } = makeWorld('Low');
        const late = [];
        let full = 0;
        for (let i = 0; i < WISP_SLOTS + 4; i++) {
            if (world.wisps.length === WISP_SLOTS) full += 1;
            world.onLock({ u: i % 2 ? 0.8 : 0.2, rows: [19 - (i % 10)] });
            const mine = world.wisps.at(-1);
            run(world, camera, mine.birth - world.time + 0.1);
            const drawn = wispsOf(world).some((wisp) => Math.abs(wisp.seed - mine.seed) < 1e-9);
            if (!drawn) late.push(i);
            // (Far enough apart that the one sent home has arrived, and nothing else is on its way, when the next lock comes.)
            run(world, camera, WISP_HOME + 0.25 - 0.5);
        }
        // The pool was full for the last of them.
        expect(full).toBeGreaterThanOrEqual(4);
        expect(late).toEqual([]);
    });

    it('lets a wisp that nothing gathers go out by itself, and feeds no one with it', () => {
        const { camera, world } = makeWorld('Low');
        world.onLock({ u: 0.2, color: '#5F9B72' });
        const [wisp] = world.wisps;
        run(world, camera, wisp.birth - world.time + WISP_RISE + 1, 30);
        const full = wispsOf(world)[0].light;
        expect(full).toBeGreaterThan(0.5);
        // It stands for most of its time at its own light.
        run(world, camera, WISP_HOLD * 0.6, 20);
        expect(wispsOf(world)).toHaveLength(1);
        expect(wispsOf(world)[0].light).toBeCloseTo(full, 2);
        // Then it fades, and is gone when its time is up.
        run(world, camera, wisp.birth + WISP_HOLD - 1 - world.time, 20);
        expect(wispsOf(world)).toHaveLength(1);
        expect(wispsOf(world)[0].light).toBeLessThan(full * 0.5);
        run(world, camera, 1.5, 20);
        expect(wispsOf(world)).toHaveLength(0);
        expect(world.wisps).toHaveLength(0);
        expect(world.counts.gathered).toBe(0);
        expect(world.getState().fed).toEqual([0, 0]);
        expect(world.u.poolL.value.w).toBe(0);
        world.dispose();
    });
});

describe('stillwater world: clears', () => {
    /** Three wisps standing over open water on one side, risen. */
    function withWisps(side, quality = 'Low', options = {}) {
        const made = makeWorld(quality, options);
        const { world } = made;
        for (let i = 0; i < 3; i++) {
            const at = [side * (2 + i) * world.squeeze, -2 - 3 * i];
            expect(world.onWater(at[0], at[1])).toBe(true);
            world.spawnWisp(at[0], at[1], world.time + 0.1 * i, pieceColor('#C36F73'));
        }
        run(made.world, made.camera, WISP_RISE + 1);
        expect(made.world.wisps).toHaveLength(3);
        expect(wispsOf(made.world)).toHaveLength(3);
        expect(made.world.wisps.every((wisp) => wisp.side === side)).toBe(true);
        return made;
    }

    it.each([[-1, 'the spirit'], [1, 'the troll\'s lantern']])(
        'sends a swell out from the tarn\'s heart that gathers every wisp it passes (side %i: home to %s)',
        (side) => {
            for (const [width, height] of [[1600, 900], [390, 844]]) {
                const { camera, world } = withWisps(side, 'Low', { width, height });
                const [mine, others] = side < 0 ? [0, 1] : [1, 0];
                const home = side < 0 ? world.u.spiritAt : world.u.lanternAt;
                const glow = home.value.w;
                const t0 = world.time;
                world.onClear({ rows: [18, 19], lines: 2 });
                expect(world.counts).toMatchObject({ clears: 1, quads: 0 });

                // ── The stroke: it leaves now, a front for each line ──
                run(world, camera, 1 / 60);
                const strokes = strokesOf(world);
                expect(strokes).toHaveLength(1);
                expect(strokes[0].time).toBe(t0);
                expect(strokes[0].fronts).toBe(2);
                expect(strokes[0].strength).toBeGreaterThan(0);
                expect(strokes[0].gold).toBe(0);
                for (const c of strokes[0].rgb) {
                    expect(c).toBeGreaterThan(0);
                    expect(c).toBeLessThanOrEqual(1 + 1e-6);
                }

                // ── Each wisp goes home when the swell from the heart reaches it ──
                const standing = world.wisps.map((wisp) => ({ ...wisp }));
                for (const wisp of standing) {
                    const fromHeart = Math.hypot(wisp.x - HEART[0] * world.squeeze, wisp.z - HEART[2]);
                    expect(wisp.gatherAt).toBeCloseTo(t0 + strokePassTime(fromHeart), 9);
                    expect(wisp.gatherAt).toBeGreaterThan(t0);
                }
                expect(world.counts.gathered).toBe(3);
                const first = Math.min(...standing.map((wisp) => wisp.gatherAt));
                const last = Math.max(...standing.map((wisp) => wisp.gatherAt));
                // Until the swell arrives they stand, and no one has been fed.
                run(world, camera, first - world.time - 1 / 60);
                expect(wispsOf(world)).toHaveLength(3);
                expect(world.getState().fed).toEqual([0, 0]);

                // ── They fly home, and the one who receives them burns the brighter ──
                let fed = 0;
                let nearest = Infinity;
                run(world, camera, last + WISP_HOME + 0.25 - world.time, 60, () => {
                    const state = world.getState();
                    fed = Math.max(fed, state.fed[mine]);
                    expect(state.fed[others]).toBe(0);
                    for (const wisp of wispsOf(world)) {
                        const away = Math.hypot(wisp.x - home.value.x, wisp.y - home.value.y, wisp.z - home.value.z);
                        nearest = Math.min(nearest, away);
                    }
                });
                expect(fed).toBeGreaterThan(0);
                expect(nearest).toBeLessThan(0.6);
                expect(home.value.w).toBeGreaterThan(glow);
                // All of them are gone from over the water within the swell's pass and their flight.
                expect(wispsOf(world)).toHaveLength(0);
                expect(world.wisps).toHaveLength(0);
                // The light they brought fades again.
                run(world, camera, 15, 20);
                expect(world.getState().fed[mine]).toBeLessThan(0.01);
                expect(home.value.w).toBeCloseTo(glow, 2);
                world.dispose();
            }
        },
    );

    it('leaves a wisp that is not there yet when the swell passes for the next swell', () => {
        const { camera, world } = withWisps(-1);
        const t0 = world.time;
        // One that will only be born long after the swell has crossed the tarn, and one born before it arrives.
        world.spawnWisp(-3, -2, t0 + 6, [1, 0.5, 0.2]);
        world.spawnWisp(-3.5, -3, t0 + 0.2, [0.2, 0.5, 1]);
        world.onClear({ lines: 1 });
        const [late, early] = world.wisps.slice(-2);
        expect(strokePassTime(Math.hypot(late.x - HEART[0], late.z - HEART[2]))).toBeLessThan(6);
        expect(late.gatherAt).toBe(Infinity);
        expect(early.gatherAt).toBeCloseTo(t0 + strokePassTime(Math.hypot(early.x - HEART[0], early.z - HEART[2])), 9);
        expect(early.gatherAt).toBeGreaterThan(early.birth);
        expect(world.counts.gathered).toBe(4);
        // It rises when its time comes and stands; the next clear takes it home.
        run(world, camera, 8);
        expect(world.wisps).toEqual([late]);
        expect(wispsOf(world)).toHaveLength(1);
        world.onClear({ lines: 1 });
        expect(late.gatherAt).toBeGreaterThan(world.time);
        expect(late.gatherAt).toBeLessThan(world.time + STROKE_LIVE);
        world.dispose();
    });

    it('gathers the clearing piece\'s own wisp with the clear it made, once it has landed', () => {
        // The game reports a lock and the clear it made in one frame: the drop is in the air when the swell leaves.
        const { camera, world } = makeWorld('Low');
        const t0 = world.time;
        world.onLock({ u: 0.2, rows: [19], color: '#F2D68A' });
        world.onClear({ rows: [19], lines: 1 });
        const [wisp] = world.wisps;
        expect(wisp.birth).toBeGreaterThan(t0);
        const pass = t0 + strokePassTime(Math.hypot(wisp.x - HEART[0], wisp.z - HEART[2]));
        // It is gathered if, and only if, it has landed by the time the swell reaches its place.
        expect(wisp.gatherAt).toBe(wisp.birth <= pass ? pass : Infinity);
        if (wisp.gatherAt !== Infinity) {
            run(world, camera, wisp.birth - t0 + 0.1);
            expect(wispsOf(world)).toHaveLength(1); // it does stand for a moment first
            run(world, camera, pass + WISP_HOME + 0.2 - world.time);
            expect(wispsOf(world)).toHaveLength(0);
            expect(world.getState().fed[0]).toBeGreaterThan(0);
        }
        world.dispose();
    });

    it('sends as many fronts as lines were cleared, and keeps no more strokes than it has slots for', () => {
        const { camera, world } = makeWorld('Low');
        const fronts = [];
        const asked = [[1, {}], [2, {}], [3, {}], [4, {}], [1, { perfect: true }], [0, {}], ['two', {}], [9, {}]];
        for (const [lines, extra] of asked) {
            world.seek(world.time + STROKE_LIVE + RING_LIVE);
            frame(world, camera, world.time, 0);
            world.onClear({ lines, ...extra });
            run(world, camera, HUSH_HOLD + 0.1);
            const strokes = strokesOf(world);
            expect(strokes).toHaveLength(1);
            fronts.push(strokes[0].fronts);
            // A stroke is drawn for STROKE_LIVE seconds, then its row is given up.
            run(world, camera, STROKE_LIVE + 0.1, 20);
            expect(strokesOf(world)).toHaveLength(0);
        }
        expect(fronts).toEqual([1, 2, 3, 4, 4, 1, 1, 4]);
        // Clears faster than strokes run out: the oldest gives way.
        for (let i = 0; i < STROKE_SLOTS * 3; i++) {
            world.onClear({ lines: 1 + (i % 3) });
            run(world, camera, 0.2);
            expect(strokesOf(world).length).toBeLessThanOrEqual(STROKE_SLOTS);
        }
        expect(strokesOf(world)).toHaveLength(STROKE_SLOTS);
        // Two boards that clear in the same frame are two strokes, told apart by their births.
        world.onClear({ lines: 1, player: 1 });
        world.onClear({ lines: 2, player: 2 });
        run(world, camera, 1 / 60);
        const births = strokesOf(world).map((stroke) => stroke.time);
        expect(new Set(births).size).toBe(births.length);
        expect(() => {
            world.onClear();
            world.onClear({});
            world.onClear({ rows: [], lines: 2 });
            world.onClear({ rows: [NaN, 40, -3], lines: 3, player: 4 });
            world.onClear({ lines: 2, screen: { x: 0.3, y: 0.7 } });
        }).not.toThrow();
        run(world, camera, 1);
        for (const [name, value] of sharedNumbers(world)) expect(Number.isFinite(value), name).toBe(true);
        world.dispose();
    });

    it('holds the night\'s breath on a four-line clear, then wakes the heart, the eyes and the lilies', () => {
        const { camera, world } = makeWorld('Low');
        const rings = recordRings(world);
        const t0 = world.time;
        const rest = {
            breath: world.u.breath.value, ruffle: world.u.ruffle.value, shafts: world.getPostState().shafts,
        };
        expect(rest.breath).toBeCloseTo(1, 6);
        world.onClear({ rows: [16, 17, 18, 19], lines: 4 });
        expect(world.counts).toMatchObject({ clears: 1, quads: 1 });

        // ── The hush: every light dims and the water stills, and nothing else has happened yet ──
        run(world, camera, HUSH_HOLD * 0.8);
        expect(world.time).toBeLessThan(t0 + HUSH_HOLD);
        expect(world.u.breath.value).toBeLessThan(rest.breath * 0.5);
        expect(world.u.ruffle.value).toBeLessThan(rest.ruffle);
        expect(world.getPostState().shafts).toBeLessThan(rest.shafts);
        expect(world.u.heartAt.value.w).toBe(0);
        expect(world.u.eyes.value.y).toBe(0);
        expect(world.u.lilies.value.y).toBe(0);

        // ── The answer: a gold stroke and a great ring from the heart, born as the hush ends ──
        expect(rings).toHaveLength(1);
        const [great] = rings;
        expect([great.x, great.z]).toEqual([HEART[0] * world.squeeze, HEART[2]]);
        expect(great.time).toBeCloseTo(t0 + HUSH_HOLD, 12);
        expect(great.edge).toBeLessThan(0);
        run(world, camera, HUSH_HOLD * 0.2 + 2 / 60);
        const [stroke] = strokesOf(world);
        expect(stroke.time).toBeCloseTo(t0 + HUSH_HOLD, 12);
        expect(stroke.fronts).toBe(4);
        expect(stroke.gold).toBe(1);
        // Gold: red over green over blue.
        expect(stroke.rgb[0]).toBeGreaterThan(stroke.rgb[1]);
        expect(stroke.rgb[1]).toBeGreaterThan(stroke.rgb[2]);
        expect(ringsOf(world).some((ring) => ring.x === great.x && ring.z === great.z)).toBe(true);
        // The heart flares under the water, every eye opens and every lily.
        expect(world.u.heartAt.value.w).toBeGreaterThan(0.9);
        expect(world.u.eyes.value.y).toBeGreaterThan(0.9);
        expect(world.u.lilies.value.y).toBeGreaterThan(0.9);
        expect(world.u.surge.value).toBeGreaterThan(0.8);
        // The post takes the kick, the flash and the ring that crosses the picture; the iris closes a little.
        const post = world.getPostState();
        expect(post.kick).toBeGreaterThan(0.2);
        expect(post.flash).toBeGreaterThan(0.1);
        expect(post.prism.strength).toBeGreaterThan(0.5);
        expect(post.prism.radius).toBeGreaterThan(0);
        expect(post.exposure).toBeLessThan(1);
        expect(post.exposure).toBeGreaterThan(0.3);

        // ── The breath comes back at once; the rest dies away ──
        run(world, camera, 0.6);
        expect(world.u.breath.value).toBeGreaterThan(0.95);
        expect(world.u.ruffle.value).toBe(rest.ruffle);
        let last = world.getPostState().prism.radius;
        run(world, camera, 1, 60, () => {
            const { radius, strength } = world.getPostState().prism;
            if (strength > 0) expect(radius).toBeGreaterThan(last);
            last = radius || last;
        });
        run(world, camera, SURGE_COOL * 5, 20);
        expect(world.u.heartAt.value.w).toBeLessThan(0.02);
        expect(world.u.eyes.value.y).toBeLessThan(0.02);
        expect(world.u.lilies.value.y).toBeLessThan(0.02);
        expect(world.u.surge.value).toBeLessThan(0.02);
        expect(world.getPostState().prism.strength).toBe(0);
        expect(world.getPostState().exposure).toBeCloseTo(1, 2);
        world.dispose();
    });

    it('lifts the mist on a perfect clear, and treats it as the tarn\'s waking whatever the lines', () => {
        const plain = makeWorld('Low');
        const perfect = makeWorld('Low');
        expect(perfect.world.u.lift.value).toBe(0);
        plain.world.onClear({ lines: 4 });
        perfect.world.onClear({ lines: 1, perfect: true });
        expect(perfect.world.counts.quads).toBe(1);
        run(plain.world, plain.camera, HUSH_HOLD + 0.1);
        run(perfect.world, perfect.camera, HUSH_HOLD + 0.1);
        expect(plain.world.u.lift.value).toBe(0);
        expect(perfect.world.u.lift.value).toBeGreaterThan(0.8);
        expect(perfect.world.u.lift.value).toBeLessThanOrEqual(1);
        expect(strokesOf(perfect.world)[0]).toMatchObject({ fronts: 4, gold: 1 });
        expect(perfect.world.u.heartAt.value.w).toBeGreaterThan(0.9);
        // It burns hotter than a plain four-line clear.
        expect(perfect.world.u.surge.value).toBeGreaterThan(plain.world.u.surge.value);
        // The mist comes back slowly.
        run(perfect.world, perfect.camera, 3, 20);
        expect(perfect.world.u.lift.value).toBeGreaterThan(0.2);
        run(perfect.world, perfect.camera, 40, 10);
        expect(perfect.world.u.lift.value).toBeLessThan(0.01);
        plain.world.dispose();
        perfect.world.dispose();
    });

    it('whirls the water where the piece went in on a T-spin', () => {
        const { camera, world } = makeWorld('Low');
        const rings = recordRings(world);
        world.onLock({ u: 0.3, rows: [18, 19] });
        run(world, camera, 1);
        const [landing] = rings;
        const rest = world.u.wind.value;
        const t0 = world.time;
        world.onClear({ rows: [19, 18], lines: 2, tspin: true });
        const whirl = rings.slice(1);
        expect(whirl.length).toBeGreaterThanOrEqual(2);
        for (const ring of whirl) {
            expect([ring.x, ring.z]).toEqual([landing.x, landing.z]);
            expect(ring.edge).toBeLessThan(0);
            expect(ring.time).toBeGreaterThanOrEqual(t0);
            expect(ring.time).toBeLessThan(t0 + 2);
        }
        // On one another's heels: each a little later and a little wider than the one before.
        for (let i = 1; i < whirl.length; i++) {
            expect(whirl[i].time).toBeGreaterThan(whirl[i - 1].time);
            expect(whirl[i].reach).toBeGreaterThan(whirl[i - 1].reach);
        }
        run(world, camera, 1 / 60);
        expect(world.u.wind.value).toBeGreaterThan(rest);
        expect(world.getPostState().prism.strength).toBeGreaterThan(0);
        world.dispose();
        // With no piece gone in yet it whirls on open water all the same.
        const fresh = makeWorld('Low', { width: 390, height: 844 });
        const first = recordRings(fresh.world);
        fresh.world.onClear({ lines: 1, tspin: true });
        expect(first.length).toBeGreaterThanOrEqual(2);
        for (const ring of first) expect(ring.edge).toBeLessThan(0);
        fresh.world.dispose();
    });
});

describe('stillwater world: a chain', () => {
    it('draws the spirit out over the water and the troll down to its edge, step by step, never too far', () => {
        const { camera, world } = makeWorld('Low');
        const spirit = world.spirit.figure.position;
        const troll = world.troll.figure.position;
        let lastSpirit = wayOf(SPIRIT, spirit).along;
        let lastTroll = wayOf(TROLL, troll).along;
        expect(lastSpirit).toBeCloseTo(0, 9);
        expect(lastTroll).toBeCloseTo(0, 9);
        const trollSteps = [];
        let spiritStep = 0;
        const before = new THREE.Vector3();
        const beforeSpirit = new THREE.Vector3();
        let target = 0;
        let label = '';
        const watch = () => {
            const s = wayOf(SPIRIT, spirit);
            const t = wayOf(TROLL, troll);
            // Each keeps to its own line, goes only forward, and never beyond where the chain has it.
            expect(s.off, label).toBeLessThan(1e-6);
            expect(t.off, label).toBeLessThan(1e-6);
            expect(s.along, label).toBeGreaterThanOrEqual(lastSpirit - 1e-9);
            expect(t.along, label).toBeGreaterThanOrEqual(lastTroll - 1e-9);
            expect(s.along, label).toBeLessThanOrEqual(smooth(0, 1, target) + 1e-9);
            expect(t.along, label).toBeLessThanOrEqual(target + 1e-9);
            expect(world.getState().spirit, label).toBeLessThanOrEqual(target + 1e-9);
            expect(world.getState().troll, label).toBeLessThanOrEqual(target + 1e-9);
            lastSpirit = s.along;
            lastTroll = t.along;
            trollSteps.push(Math.hypot(troll.x - before.x, troll.z - before.z));
            spiritStep = Math.max(spiritStep, Math.hypot(spirit.x - beforeSpirit.x, spirit.z - beforeSpirit.z));
            before.copy(troll);
            beforeSpirit.copy(spirit);
            // Her feet never go under the water; his are never under his own track.
            expect(spirit.y, label).toBeGreaterThan(0);
            expect(troll.y, label).toBeGreaterThanOrEqual(Math.min(TROLL.home[1], TROLL.reach[1]) - 1e-9);
            expect(troll.y, label).toBeLessThanOrEqual(Math.max(TROLL.home[1], TROLL.reach[1]) + 1e-9);
        };
        for (let combo = 1; combo <= 12; combo++) {
            world.onCombo(combo);
            target = approachForCombo(combo);
            label = `combo ${combo}`;
            before.copy(troll);
            beforeSpirit.copy(spirit);
            run(world, camera, 1.4, 60, watch);
            // The troll has made the step by now; she is still coming.
            expect(wayOf(TROLL, troll).along, label).toBeGreaterThan(Math.min(target, lastTroll) - 1e-9);
        }
        // ── His pace: a walk, the same at every step, never a jump ──
        const moving = trollSteps.filter((step) => step > 1e-9);
        expect(moving.length).toBeGreaterThan(60);
        const walked = moving.reduce((sum, step) => sum + step, 0);
        expect(walked).toBeCloseTo(wayOf(TROLL, troll).length, 6); // he went all the way, and not an inch further
        const pace = walked / (moving.length / 60);
        expect(Math.max(...trollSteps)).toBeLessThanOrEqual((pace / 60) * 1.5);
        // (Slower than one whole stride a second.)
        expect(pace).toBeLessThan(TROLL.stride);
        expect(pace).toBeGreaterThan(0.2);
        // She glides: never more than a twentieth of her way in a frame.
        expect(spiritStep).toBeLessThan(wayOf(SPIRIT, spirit).length / 20);
        expect(spiritStep).toBeGreaterThan(0);

        // ── At the end of the longest chain they stand where it draws them ──
        run(world, camera, 8, 30);
        expect(world.getState().troll).toBe(1);
        expect(troll.x).toBeCloseTo(TROLL.reach[0], 9);
        expect(troll.z).toBeCloseTo(TROLL.reach[2], 9);
        expect(troll.y).toBeCloseTo(TROLL.reach[1], 9);
        expect(world.getState().spirit).toBeLessThanOrEqual(1);
        expect(Math.hypot(spirit.x - SPIRIT.reach[0], spirit.z - SPIRIT.reach[2])).toBeLessThan(0.05);
        expect(Math.abs(spirit.y - SPIRIT.reach[1])).toBeLessThan(0.03);
        expect(world.onWater(spirit.x, spirit.z)).toBe(true);
        world.dispose();
    });

    it('sends both home when the chain breaks, and holds them where a shorter chain has them', () => {
        const { camera, world } = makeWorld('Low');
        const spirit = world.spirit.figure.position;
        const troll = world.troll.figure.position;
        world.onCombo(8);
        run(world, camera, 10, 30);
        const breath = world.u.breath.value;
        // A chain that broke and began again: back to where the new one has them.
        world.onCombo(2);
        run(world, camera, 1 / 60);
        // (The night catches its breath as the chain breaks.)
        expect(world.u.breath.value).toBeLessThan(breath);
        let lastSpirit = wayOf(SPIRIT, spirit).along;
        let lastTroll = wayOf(TROLL, troll).along;
        run(world, camera, 14, 30, () => {
            const s = wayOf(SPIRIT, spirit).along;
            const t = wayOf(TROLL, troll).along;
            expect(s).toBeLessThanOrEqual(lastSpirit + 1e-9);
            expect(t).toBeLessThanOrEqual(lastTroll + 1e-9);
            expect(t).toBeGreaterThanOrEqual(approachForCombo(2) - 1e-9);
            lastSpirit = s;
            lastTroll = t;
        });
        expect(world.getState().troll).toBeCloseTo(approachForCombo(2), 9);
        expect(world.getState().spirit).toBeCloseTo(approachForCombo(2), 2);
        expect(world.u.breath.value).toBeCloseTo(1, 3);
        // The chain breaks for good: both go home.
        world.onCombo(0);
        run(world, camera, 25, 30);
        expect(world.getState().troll).toBe(0);
        expect(troll.toArray()).toEqual([...TROLL.home]);
        expect(Math.hypot(spirit.x - SPIRIT.home[0], spirit.z - SPIRIT.home[2])).toBeLessThan(0.02);
        expect(Math.abs(spirit.y - SPIRIT.home[1])).toBeLessThan(0.03);
        world.dispose();
    });

    // (He once walked out over the water's edge and stood 0.27 m above the ground at the end of a long chain.)
    it('stands the troll on the ground at his seat, all the way down the bank, and at the end of his way', () => {
        const { camera, world } = makeWorld('Low');
        const troll = world.troll.figure.position;
        expect(troll.y).toBeCloseTo(groundHeight(troll.x, troll.z), 6);
        world.onCombo(20);
        let walked = 0;
        run(world, camera, 6, 60, () => {
            walked += 1;
            const off = troll.y - groundHeight(troll.x, troll.z);
            expect(Math.abs(off), `${(world.getState().troll * 100).toFixed(0)} % of his way`).toBeLessThan(0.05);
            // He walks on the bank: never out over the water.
            expect(shoreDistance(troll.x, troll.z)).toBeGreaterThan(0);
        });
        expect(walked).toBeGreaterThan(30);
        expect(world.getState().troll).toBe(1);
        expect(Math.abs(troll.y - groundHeight(troll.x, troll.z))).toBeLessThan(0.05);
        world.dispose();
    });

    it('rings the water at the spirit\'s every footfall as she walks out over it', () => {
        const { camera, world } = makeWorld('Low');
        const rings = recordRings(world);
        const spirit = world.spirit.figure.position;
        world.onCombo(8);
        run(world, camera, 10);
        // Several, a stride apart, each under her feet on the water, small and in her own light.
        expect(rings.length).toBeGreaterThanOrEqual(3);
        const way = wayOf(SPIRIT, spirit).length;
        expect(rings.length).toBeLessThan(way / 0.2);
        for (const ring of rings) {
            expect(ring.edge).toBeLessThan(0);
            expect(ring.time).toBe(ring.asked);
            expect(wayOf(SPIRIT, { x: ring.x, z: ring.z }).off).toBeLessThan(1e-6);
            expect(ring.rgb).toEqual([...paletteAt(world.hourNow()).spirit].map((c) => expect.closeTo(c, 2)));
        }
        for (let i = 1; i < rings.length; i++) {
            expect(Math.hypot(rings[i].x - rings[i - 1].x, rings[i].z - rings[i - 1].z)).toBeGreaterThan(0.2);
        }
        // Smaller than a lock's ring.
        const count = rings.length;
        world.onLock({ u: 0.8 });
        expect(rings[count].strength).toBeGreaterThan(rings[0].strength);
        expect(rings[count].reach).toBeGreaterThan(rings[0].reach);
        // Standing still she makes none.
        const standing = rings.length;
        run(world, camera, 5);
        expect(rings.length).toBe(standing);
        world.dispose();
    });

    // Her stride falls where it will on the way home and on a later walk out: wherever it falls,
    // it must be on the water. (Her stone once stood back from the edge, and a footfall on her way
    // home rang 0.11 m inland, under it.)
    it('rings no footfall on the bank, going out or coming home, on a wide frame or a narrow one', () => {
        for (const [width, height] of [[1600, 900], [390, 844]]) {
            const { camera, world } = makeWorld('Low', { width, height });
            const rings = recordRings(world);
            for (let round = 0; round < 3; round++) {
                for (let combo = 1; combo <= 8; combo++) {
                    world.onCombo(combo);
                    run(world, camera, 1.3);
                }
                run(world, camera, 3);
                world.onCombo(0);
                run(world, camera, 12);
            }
            // Out and home three times: a ring for every stride both ways.
            expect(rings.length).toBeGreaterThan(12);
            const ashore = rings.filter((ring) => ring.edge >= 0).map((ring) => ring.edge);
            expect(ashore, `${width} × ${height}`).toEqual([]);
            world.dispose();
        }
    });

    it('wakes the wood with the chain and lets it sleep again: eyes, lilies, caps, the heart, the charge', () => {
        const { camera, world } = makeWorld('Low');
        const { u } = world;
        const rest = {
            caps: u.caps.value.clone(),
            spirit: u.spiritAt.value.w,
            lantern: u.lanternAt.value.w,
            shafts: u.shafts.value,
        };
        expect(u.eyes.value.x).toBe(0);
        expect(u.lilies.value.x).toBe(0);
        expect(u.heartAt.value.w).toBe(0);
        expect(u.power.value).toBe(0);
        let last = {
            eyes: 0, lilies: 0, capsL: rest.caps.x, capsR: rest.caps.y, heart: 0, power: 0,
        };
        for (let combo = 1; combo <= 12; combo++) {
            world.onCombo(combo);
            // The step itself is felt at once: both lights flare.
            run(world, camera, 2 / 60);
            expect(u.spiritAt.value.w, `combo ${combo}`).toBeGreaterThan(rest.spirit);
            expect(u.lanternAt.value.w, `combo ${combo}`).toBeGreaterThan(rest.lantern);
            run(world, camera, 7, 30);
            const now = {
                eyes: u.eyes.value.x,
                lilies: u.lilies.value.x,
                capsL: u.caps.value.x,
                capsR: u.caps.value.y,
                heart: u.heartAt.value.w,
                power: u.power.value,
            };
            const label = `combo ${combo}`;
            for (const key of Object.keys(now)) {
                expect(now[key], `${label}: ${key}`).toBeGreaterThanOrEqual(last[key] - 1e-3);
                expect(now[key], `${label}: ${key}`).toBeLessThanOrEqual(1 + 1e-9);
            }
            // Each settles on what the core says the chain is worth.
            expect(now.eyes, label).toBeCloseTo(eyesForCombo(combo), 2);
            expect(now.power, label).toBeCloseTo(powerForCombo(combo), 2);
            expect(world.getState().eyes, label).toBe(now.eyes);
            expect(world.getState().power, label).toBe(now.power);
            expect(world.getState().heart, label).toBeCloseTo(heartForCombo(combo), 2);
            // The gold shows through the water only when the heart has woken.
            expect(now.heart > 0.01, label).toBe(heartForCombo(combo) > 0.01);
            // The caps light from the left bank's first; the right bank follows.
            expect(now.capsL, label).toBeGreaterThanOrEqual(now.capsR - 1e-6);
            expect(u.shafts.value, label).toBeGreaterThan(rest.shafts);
            last = now;
        }
        // The longest chain has all of it awake.
        expect(last.eyes).toBeCloseTo(1, 2);
        expect(last.lilies).toBeCloseTo(1, 2);
        expect(last.capsL).toBeCloseTo(1, 2);
        expect(last.capsR).toBeCloseTo(1, 2);
        expect(last.heart).toBeGreaterThan(0.5);
        // The first clear of a chain has already lit something on the left bank, and opened a lily.
        const fresh = makeWorld('Low');
        fresh.world.onCombo(1);
        run(fresh.world, fresh.camera, 6, 30);
        expect(fresh.world.u.caps.value.x).toBeGreaterThan(rest.caps.x + 0.05);
        expect(fresh.world.u.lilies.value.x).toBeGreaterThan(0.05);
        fresh.world.dispose();
        // The chain breaks: it all goes back to rest.
        world.onCombo(0);
        run(world, camera, 30, 20);
        expect(u.eyes.value.x).toBeLessThan(0.01);
        expect(u.lilies.value.x).toBeLessThan(0.01);
        expect(u.heartAt.value.w).toBeLessThan(0.01);
        expect(u.power.value).toBeLessThan(0.01);
        expect(u.caps.value.x).toBeCloseTo(rest.caps.x, 2);
        expect(u.caps.value.y).toBeCloseTo(rest.caps.y, 2);
        expect(u.spiritAt.value.w).toBeCloseTo(rest.spirit, 2);
        expect(u.lanternAt.value.w).toBeCloseTo(rest.lantern, 2);
        expect(u.shafts.value).toBeCloseTo(rest.shafts, 2);
        world.dispose();
    });

    it('takes a combo that is not a count for none at all', () => {
        const { camera, world } = makeWorld('Minimal');
        for (const junk of [NaN, undefined, null, -3, 'x', {}]) {
            world.onCombo(4);
            world.onCombo(junk);
            expect(world.combo, String(junk)).toBe(0);
        }
        world.onCombo('3');
        expect(world.combo).toBe(3);
        world.onCombo(2.6);
        expect(world.combo).toBe(3);
        world.onCombo(1e9);
        run(world, camera, 3);
        expect(world.getState().troll).toBeLessThanOrEqual(1);
        expect(world.getState().spirit).toBeLessThanOrEqual(1);
        for (const [name, value] of sharedNumbers(world)) expect(Number.isFinite(value), name).toBe(true);
        world.dispose();
    });
});

describe('stillwater world: the hours', () => {
    const n = HOURS.length;
    const onWheel = (hour) => ((hour % n) + n) % n;

    it('rests on the level\'s own hour, and writes that hour\'s palette into the shared uniforms', () => {
        const { camera, world } = makeWorld('Minimal', { drift: false });
        expect(world.hourNow()).toBe(0);
        expect(world.getState()).toMatchObject({
            level: 1, hour: 0, hourFrom: HOURS[0].name, hourTo: HOURS[1].name, hourMix: 0,
        });
        for (const key of PALETTE_KEYS) expect(world.u[key].value.toArray()).toEqual([...HOURS[0][key]]);
        for (const key of PALETTE_SCALARS) expect(world.u[key].value).toBe(HOURS[0][key]);
        for (let level = 2; level <= n + 2; level++) {
            world.levelUp(level, { silent: true });
            frame(world, camera, world.time, 0);
            const hour = HOURS[(level - 1) % n];
            expect(onWheel(world.hourNow())).toBe((level - 1) % n);
            expect(world.getState().hourFrom).toBe(hour.name);
            for (const key of PALETTE_KEYS) {
                expect(world.u[key].value.toArray(), `${hour.name}.${key}`).toEqual([...hour[key]]);
            }
            for (const key of PALETTE_SCALARS) expect(world.u[key].value, `${hour.name}.${key}`).toBe(hour[key]);
        }
        world.dispose();
    });

    it('turns the night to its next hour on a level, smoothly, in HOUR_TURN seconds, with a breath of wind', () => {
        const { camera, world } = makeWorld('Low', { drift: false });
        const rest = { wind: world.u.wind.value, sway: 0 };
        run(world, camera, 1 / 60, 60, () => {
            rest.sway = world.u.sway.value;
        });
        const t0 = world.time;
        world.levelUp(2);
        expect(world.level).toBe(2);
        // Nothing has jumped: the turn starts from where the night stood.
        expect(world.hourNow()).toBe(0);
        let last = 0;
        let steepest = 0;
        run(world, camera, HOUR_TURN, 60, () => {
            const hour = world.hourNow();
            expect(hour).toBeGreaterThanOrEqual(last);
            expect(hour - last).toBeLessThan(0.05);
            steepest = Math.max(steepest, hour - last);
            last = hour;
            // The palette the shaders read is the one of that hour, every frame.
            const palette = paletteAt(hour);
            for (const key of ['haze', 'zenith', 'moonLight', 'needle']) {
                expect(world.u[key].value.toArray()).toEqual(palette[key].map((c) => expect.closeTo(c, 9)));
            }
            expect(world.u.mist.value).toBeCloseTo(palette.mist, 9);
        });
        expect(steepest).toBeGreaterThan(0);
        expect(world.time).toBeCloseTo(t0 + HOUR_TURN, 9);
        expect(world.hourNow()).toBeCloseTo(1, 9);
        run(world, camera, 2);
        expect(world.hourNow()).toBe(1);
        expect(world.getState()).toMatchObject({ level: 2, hourFrom: HOURS[1].name });
        for (const key of PALETTE_KEYS) expect(world.u[key].value.toArray()).toEqual([...HOURS[1][key]]);
        // The wind got up as it turned, and has died down.
        const again = makeWorld('Low', { drift: false });
        again.world.levelUp(2);
        run(again.world, again.camera, 2 / 60);
        expect(again.world.u.wind.value).toBeGreaterThan(rest.wind * 2);
        expect(again.world.getPostState().flash).toBeGreaterThan(0);
        run(again.world, again.camera, 20, 20);
        expect(again.world.u.wind.value).toBeCloseTo(rest.wind, 2);
        again.world.dispose();
        world.dispose();
    });

    it('jumps to a level\'s hour without a turn when asked to be silent', () => {
        const { camera, world } = makeWorld('Low', { drift: false });
        const wind = world.u.wind.value;
        world.levelUp(4, { silent: true });
        expect(world.level).toBe(4);
        expect(world.hourNow()).toBe(3);
        // The palette is in the uniforms before the next frame is taken.
        for (const key of PALETTE_KEYS) expect(world.u[key].value.toArray()).toEqual([...HOURS[3][key]]);
        run(world, camera, 2 / 60);
        expect(world.hourNow()).toBe(3);
        expect(world.u.wind.value).toBeCloseTo(wind, 9);
        expect(world.getPostState().flash).toBe(0);
        // A level that is not one is the first.
        for (const junk of [NaN, undefined, 0, -5, 'x']) {
            world.levelUp(junk, { silent: true });
            expect(world.level, String(junk)).toBe(1);
            expect(onWheel(world.hourNow()), String(junk)).toBe(0);
        }
        world.dispose();
    });

    it.each([n, n + 2, 2 * n, 3])(
        'goes the short way round the wheel when a new run starts again at the first level (from level %i)',
        (from) => {
            const { camera, world } = makeWorld('Low', { drift: false });
            world.levelUp(from, { silent: true });
            frame(world, camera, world.time, 0);
            const start = world.hourNow();
            world.levelUp(1);
            let last = start;
            let furthest = 0;
            run(world, camera, HOUR_TURN + 0.5, 60, () => {
                const hour = world.hourNow();
                // (Several hours in one turn: still a turn, never a jump.)
                expect(Math.abs(hour - last)).toBeLessThan(0.05 * Math.max(1, n / 2));
                furthest = Math.max(furthest, Math.abs(hour - start));
                last = hour;
            });
            // It never passes through more than half the hours, and ends on the first.
            expect(furthest).toBeLessThanOrEqual(n / 2 + 1e-9);
            expect(furthest).toBeGreaterThan(0.5);
            const end = onWheel(world.hourNow());
            expect(Math.min(end, n - end)).toBeCloseTo(0, 9);
            const names = world.getState();
            expect(names.hourFrom === HOURS[0].name || names.hourTo === HOURS[0].name).toBe(true);
            for (const key of PALETTE_KEYS) {
                expect(world.u[key].value.toArray()).toEqual([...HOURS[0][key]].map((c) => expect.closeTo(c, 9)));
            }
            world.dispose();
        },
    );

    it('keeps turning smoothly when a second level comes in the middle of a turn', () => {
        const { camera, world } = makeWorld('Low', { drift: false });
        world.levelUp(2);
        let last = world.hourNow();
        const watch = () => {
            const hour = world.hourNow();
            expect(hour).toBeGreaterThanOrEqual(last - 1e-12);
            expect(hour - last).toBeLessThan(0.05);
            last = hour;
        };
        run(world, camera, HOUR_TURN * 0.4, 60, watch);
        world.levelUp(3);
        expect(world.hourNow()).toBeCloseTo(last, 12);
        run(world, camera, HOUR_TURN + 0.2, 60, watch);
        expect(world.hourNow()).toBeCloseTo(2, 9);
        world.dispose();
    });

    it('moves the night on with the clock on top of the level, unless it is held', () => {
        const { camera, world } = makeWorld('Low', { start: 30 });
        expect(world.hourDrift).toBe(true);
        // The level's hour, plus an hour for every HOUR_SECONDS the clock has run: what the core says.
        expect(world.hourNow()).toBeCloseTo(hourAt(1, 30), 12);
        run(world, camera, 20, 10);
        expect(world.hourNow()).toBeCloseTo(hourAt(1, 50), 9);
        world.levelUp(3, { silent: true });
        expect(world.hourNow()).toBeCloseTo(hourAt(3, 50), 9);
        // It turns for a level and drifts at once.
        world.levelUp(4);
        let last = world.hourNow();
        run(world, camera, HOUR_TURN, 60, () => {
            expect(world.hourNow()).toBeGreaterThan(last);
            expect(world.hourNow() - last).toBeLessThan(0.05);
            last = world.hourNow();
        });
        expect(world.hourNow()).toBeCloseTo(hourAt(4, world.time), 9);
        // The palette follows the drift between two hours.
        world.seek(HOUR_SECONDS * 1.5);
        frame(world, camera, world.time, 0);
        const palette = paletteAt(world.hourNow());
        expect(world.getState().hourMix).toBeCloseTo(0.5, 6);
        for (const key of PALETTE_KEYS) {
            expect(world.u[key].value.toArray()).toEqual(palette[key].map((c) => expect.closeTo(c, 9)));
        }
        // Held, it is the level's own hour however long the clock runs.
        world.setHourDrift(false);
        expect(world.hourNow()).toBe(hourAt(4, world.time, false));
        const held = world.hourNow();
        run(world, camera, 60, 2);
        expect(world.hourNow()).toBe(held);
        world.setHourDrift(true);
        expect(world.hourNow()).toBeCloseTo(hourAt(4, world.time), 9);
        // Anything but `false` lets it drift.
        world.setHourDrift(undefined);
        expect(world.hourDrift).toBe(true);
        world.dispose();
    });

    it('keeps its level across a seek', () => {
        const { camera, world } = makeWorld('Low', { drift: false });
        world.levelUp(5);
        run(world, camera, 1);
        world.seek(200);
        frame(world, camera, 200, 0);
        expect(world.level).toBe(5);
        expect(world.hourNow()).toBe(4);
        for (const key of PALETTE_KEYS) expect(world.u[key].value.toArray()).toEqual([...HOURS[4][key]]);
        world.dispose();
    });
});

describe('stillwater world: runs, captures and motion', () => {
    it('lets the night go back to rest for a new run: the chain breaks, the wisps go home, the hour stays', () => {
        const { camera, world } = makeWorld('Low', { drift: false });
        for (let i = 0; i < 6; i++) {
            world.onLock({ u: i % 2 ? 0.8 : 0.2, rows: [18], color: '#537E9F' });
            run(world, camera, 0.5);
        }
        world.levelUp(3, { silent: true });
        world.onCombo(4);
        world.onLock({ u: 0.3, rows: [17], hardDrop: true });
        run(world, camera, 3);
        expect(wispsOf(world)).toHaveLength(7);
        expect(world.getState().troll).toBeGreaterThan(0);
        const rings = ringsOf(world).length;
        expect(rings).toBeGreaterThan(0);
        const t0 = world.time;
        world.resetSession();
        expect(world.combo).toBe(0);
        expect(world.counts).toEqual({
            locks: 0, clears: 0, quads: 0, wisps: 0, gathered: 0,
        });
        // Every wisp has been let go, and is on its way within a moment.
        expect(world.wisps).toHaveLength(7);
        expect(world.wisps.every((wisp) => wisp.gatherAt >= t0 && wisp.gatherAt <= t0 + 2)).toBe(true);
        // What is already on the water runs out by itself.
        run(world, camera, 1 / 60);
        expect(ringsOf(world).length).toBe(rings);
        // The wisps are gone within two seconds of the new run.
        run(world, camera, Math.max(2, WISP_HOME + 1) - (world.time - t0));
        expect(wispsOf(world)).toHaveLength(0);
        expect(world.wisps).toHaveLength(0);
        // The two go home; the hour of the night stays.
        run(world, camera, 25, 30);
        expect(world.getState()).toMatchObject({ combo: 0, troll: 0, level: 3 });
        expect(world.getState().spirit).toBeLessThan(0.01);
        expect(world.hourNow()).toBe(2);
        expect(() => {
            world.resetSession();
            world.resetSession();
        }).not.toThrow();
        world.dispose();
    });

    it('lets go of a held breath for a new run: the flare it was holding never comes', () => {
        const kept = makeWorld('Low');
        const reset = makeWorld('Low');
        for (const { camera, world } of [kept, reset]) {
            world.onClear({ lines: 4 }); // the night holds its breath, and the heart is about to flare
            run(world, camera, HUSH_HOLD * 0.4);
            expect(world.u.breath.value).toBeLessThan(0.9);
        }
        reset.world.resetSession();
        expect(reset.world.counts.quads).toBe(0);
        run(kept.world, kept.camera, HUSH_HOLD + 0.2);
        run(reset.world, reset.camera, HUSH_HOLD + 0.2);
        expect(kept.world.u.eyes.value.y).toBeGreaterThan(0.5);
        expect(reset.world.u.eyes.value.y).toBe(0);
        expect(reset.world.u.lilies.value.y).toBe(0);
        expect(reset.world.u.heartAt.value.w).toBe(0);
        expect(reset.world.u.breath.value).toBeGreaterThan(0.95);
        expect(reset.world.u.ruffle.value).toBe(1);
        kept.world.dispose();
        reset.world.dispose();
    });

    it('sends the lights home when the run ends', () => {
        const { camera, world } = makeWorld('Low');
        for (let i = 0; i < 5; i++) {
            world.onLock({ u: i % 2 ? 0.8 : 0.2, rows: [18], hardDrop: i === 2 });
            run(world, camera, 0.5);
        }
        world.onCombo(3);
        run(world, camera, 2);
        expect(wispsOf(world)).toHaveLength(5);
        const { locks } = world.counts;
        const t0 = world.time;
        world.onGameOver();
        expect(world.combo).toBe(0);
        expect(world.counts.locks).toBe(locks); // the run's counts are the run's until a new one starts
        expect(world.counts.gathered).toBe(5);
        expect(world.wisps.every((wisp) => wisp.gatherAt >= t0 && wisp.gatherAt <= t0 + 2)).toBe(true);
        // One after another, not all in one frame.
        expect(new Set(world.wisps.map((wisp) => wisp.gatherAt)).size).toBe(5);
        let fed = [0, 0];
        run(world, camera, Math.max(2, WISP_HOME + 1), 60, () => {
            fed = fed.map((most, k) => Math.max(most, world.getState().fed[k]));
        });
        expect(wispsOf(world)).toHaveLength(0);
        expect(world.wisps).toHaveLength(0);
        expect(fed[0]).toBeGreaterThan(0);
        expect(fed[1]).toBeGreaterThan(0);
        run(world, camera, 25, 30);
        expect(world.getState().troll).toBe(0);
        expect(world.getState().spirit).toBeLessThan(0.01);
        expect(() => world.onGameOver()).not.toThrow();
        world.dispose();
    });

    it('replays the same picture from the same seek and the same events: two worlds, frame for frame', () => {
        const first = makeWorld('Low');
        const second = makeWorld('Low');
        // The second has seen other things before: it is sought to the same moment like the first.
        play(second.world, second.camera);
        second.world.levelUp(1, { silent: true });
        for (const { camera, world } of [first, second]) {
            world.seek(10);
            frame(world, camera, 10, 0);
        }
        expect(picture(second.world, true)).toBe(picture(first.world, true));
        play(first.world, first.camera);
        play(second.world, second.camera);
        const told = picture(first.world, true);
        expect(picture(second.world, true)).toBe(told);
        // It is a picture with something in it.
        const state = first.world.getState();
        expect(state.counts).toMatchObject({ locks: 8, clears: 5, quads: 1 });
        expect(state.rings).toBeGreaterThan(0);
        expect(state.level).toBe(2);
        expect(told).not.toContain('null'); // (a NaN would be written as null)
        // And a third, built new, tells it the same down to the rows nothing reads.
        const third = makeWorld('Low');
        const fourth = makeWorld('Low');
        play(third.world, third.camera);
        play(fourth.world, fourth.camera);
        expect(picture(third.world)).toBe(picture(fourth.world));
        expect(picture(third.world, true)).toBe(told);
        // The motes too: the same events throw the same sparks.
        const sparks = (world) => ['aBirth', 'aMotion', 'aLook', 'aMode']
            .map((name) => Array.from(world.sparks.geometry.getAttribute(name).array));
        expect(sparks(fourth.world)).toEqual(sparks(third.world));
        for (const { world } of [first, second, third, fourth]) world.dispose();
    });

    it('drops every event in flight on a seek, and stands the two at home', () => {
        const { camera, world } = makeWorld('Low');
        play(world, camera);
        world.onCombo(6);
        run(world, camera, 2);
        world.seek(42);
        expect(world.time).toBe(42);
        expect(world.getState()).toMatchObject({
            time: 42,
            combo: 0,
            spirit: 0,
            troll: 0,
            rings: 0,
            strokes: 0,
            wisps: 0,
            fed: [0, 0],
            counts: {
                locks: 0, clears: 0, quads: 0, wisps: 0, gathered: 0,
            },
        });
        expect(world.troll.figure.position.toArray()).toEqual([...TROLL.home]);
        expect(world.spirit.figure.position.x).toBe(SPIRIT.home[0]);
        frame(world, camera, 42, 0);
        expect(world.u.time.value).toBe(42);
        expect(ringsOf(world)).toHaveLength(0);
        expect(world.u.power.value).toBe(0);
        expect(world.u.breath.value).toBe(1);
        // A seek before the clock began is a seek to its beginning.
        world.seek(-5);
        expect(world.time).toBe(0);
        world.dispose();
    });

    it('stills the view under reduced motion, and still answers every event', () => {
        const { camera, world } = makeWorld('Low', { reduced: true });
        const at = (time, pointer = {}) => {
            world.updateCamera(camera, { time, delta: 0, ...pointer });
            return [...camera.position.toArray(), ...camera.quaternion.toArray(), camera.fov];
        };
        const rest = at(10);
        expect(at(27.3)).toEqual(rest);
        expect(at(1234.5)).toEqual(rest);
        expect(at(40, { pointerX: 1, pointerY: -1 })).toEqual(rest);
        // A hard drop does not kick the lens either.
        const launches = record(world.drops, 'launch');
        const rings = recordRings(world);
        world.onLock({ u: 0.2, hardDrop: true, color: '#C36F73' });
        expect(at(world.time)).toEqual(rest);
        // The events still land: the light falls (quicker), the ring, the wisp, the stroke, the chain.
        expect(rings).toHaveLength(2);
        expect(launches[0][0].flight).toBeLessThan(DROP_FLIGHT);
        run(world, camera, 2);
        expect(wispsOf(world)).toHaveLength(1);
        world.onClear({ lines: 4 });
        world.onCombo(5);
        run(world, camera, HUSH_HOLD + 0.1);
        expect(strokesOf(world)).toHaveLength(1);
        expect(world.u.heartAt.value.w).toBeGreaterThan(0.9);
        expect(world.getPostState().prism.strength).toBeGreaterThan(0);
        run(world, camera, 6);
        expect(world.getState().troll).toBeCloseTo(approachForCombo(5), 9);
        expect(world.getState().spirit).toBeGreaterThan(0.5);
        expect(at(world.time)).toEqual(rest);
        // The air moves more slowly than it does for everyone else.
        const calm = makeWorld('Low');
        const before = [world.u.drift.value, calm.world.u.drift.value];
        run(world, camera, 5);
        run(calm.world, calm.camera, 5);
        expect(world.u.drift.value - before[0]).toBeLessThan(calm.world.u.drift.value - before[1]);
        // Switched off again, the view breathes again.
        world.setReducedMotion(false);
        expect(at(27.3)).not.toEqual(rest);
        // Only `true` switches it on.
        world.setReducedMotion('yes');
        expect(world.reducedMotion).toBe(false);
        calm.world.dispose();
        world.dispose();
    });

    // The boughs, the reeds and the water read u.sway and u.drift as phases. If either were the
    // clock times a pace (clock × wind), a change of pace late in a session would move the phase
    // by the whole of the clock at once, and the wood would jump. They are integrated instead:
    // an event may hurry them, never jerk them.
    it('never jerks the air: after ten minutes a hard drop, a clear or a level hurries its phases, no more', () => {
        const { camera, world } = makeWorld('Low', { start: 600 });
        const read = () => [world.u.sway.value, world.u.drift.value];
        let last = read();
        const normal = [0, 0];
        run(world, camera, 1, 60, () => {
            const now = read();
            now.forEach((v, k) => {
                normal[k] = Math.max(normal[k], v - last[k]);
            });
            last = now;
        });
        expect(normal[0]).toBeGreaterThan(0);
        expect(normal[1]).toBeGreaterThan(0);
        // After ten minutes each phase is of the order of the clock: a rate multiplied into it would show.
        expect(last[0]).toBeGreaterThan(300);
        expect(last[1]).toBeGreaterThan(300);
        const events = [
            () => world.onLock({ u: 0.3, hardDrop: true }),
            () => world.onClear({ lines: 1 }),
            () => world.onClear({ lines: 4 }),
            () => world.levelUp(world.level + 1),
            () => world.onCombo(3),
            () => world.onCombo(0),
            () => world.onClear({ lines: 2, tspin: true }),
        ];
        const watch = () => {
            const now = read();
            now.forEach((v, k) => {
                const step = v - last[k];
                expect(step, k ? 'drift' : 'sway').toBeGreaterThan(0); // it never runs backward either
                expect(step, k ? 'drift' : 'sway').toBeLessThanOrEqual(normal[k] * 4);
            });
            last = now;
        };
        for (const fire of events) {
            fire();
            run(world, camera, 1.5, 60, watch);
        }
        world.dispose();
    });

    it('hands the post one object of finite numbers, the same one every frame', () => {
        const { camera, world } = makeWorld('Low');
        const post = world.getPostState();
        const check = () => {
            expect(world.getPostState()).toBe(post);
            const numbers = [post.flash, post.kick, post.shafts, post.bloomBoost, post.exposure, post.prism.radius,
                post.prism.strength, post.moon.x, post.moon.y, post.heart.x, post.heart.y, ...post.shade];
            expect(numbers.every(Number.isFinite)).toBe(true);
            expect(post.flash).toBeGreaterThanOrEqual(0);
            expect(post.kick).toBeGreaterThanOrEqual(0);
            expect(post.kick).toBeLessThanOrEqual(1);
            expect(post.shafts).toBeGreaterThanOrEqual(0);
            expect(post.bloomBoost).toBeGreaterThanOrEqual(0);
            expect(post.exposure).toBeGreaterThan(0);
            expect(post.exposure).toBeLessThanOrEqual(1);
            expect(post.prism.radius).toBeGreaterThanOrEqual(0);
            expect(post.prism.strength).toBeGreaterThanOrEqual(0);
            expect(post.shade).toHaveLength(3);
            for (const c of post.shade) expect(c).toBeGreaterThanOrEqual(0);
        };
        check();
        const { prism, shade, moon } = post;
        world.onLock({ u: 0.2, hardDrop: true });
        world.onClear({ lines: 4, perfect: true });
        world.onCombo(7);
        world.levelUp(3);
        run(world, camera, 6, 60, check);
        // Its parts are reused too: nothing is made per frame.
        expect(post.prism).toBe(prism);
        expect(post.shade).toBe(shade);
        expect(post.moon).toBe(moon);
        // At rest it asks for nothing: no flash, no kick, no ring.
        world.onCombo(0);
        run(world, camera, 30, 10, check);
        expect(post.flash).toBeLessThan(1e-6);
        expect(post.kick).toBeLessThan(1e-6);
        expect(post.prism.strength).toBe(0);
        expect(post.exposure).toBeCloseTo(1, 3);
        world.dispose();
    });

    it('reports a state that can be written down: numbers and names, and no one else\'s objects', () => {
        const { camera, world } = makeWorld('High');
        play(world, camera);
        const state = world.getState();
        const text = JSON.stringify(state);
        expect(text).not.toContain('null');
        expect(JSON.parse(text)).toEqual(state);
        expect(state.counts).not.toBe(world.counts);
        expect(state.fed).toHaveLength(2);
        expect(HOURS.map((hour) => hour.name)).toContain(state.hourFrom);
        expect(HOURS.map((hour) => hour.name)).toContain(state.hourTo);
        expect(state.hourMix).toBeGreaterThanOrEqual(0);
        expect(state.hourMix).toBeLessThanOrEqual(1);
        expect(state.quality).toBe('High');
        expect(state.mirror).toBe(true);
        world.dispose();
    });
});

describe('stillwater world: random play', () => {
    const COLOURS = ['#F2D68A', '#6CC7C6', '#5F9B72', '#9A7FB7', '#537E9F', '#D99A5E', '#C36F73', 0xff70ff];
    const JUNK = [null, undefined, '', 'blue', '#12', NaN, {}, -1];

    /** A board layout as the theme's layout watch would report it, or null (no board on screen). */
    function someLayout(rand, width, height) {
        const r = rand();
        if (r < 0.25) return null;
        if (r < 0.6) return fallbackLayout(width, height);
        const card = (x0, x1) => ({
            x0, y0: 0.12, x1, y1: 0.92,
        });
        const board = (x0, x1) => ({
            x0: x0 + 0.02, y0: 0.3, x1: x1 - 0.02, y1: 0.88,
        });
        if (r < 0.8) {
            // Two boards side by side.
            return {
                cardCount: 2,
                cards: [card(0.08, 0.4), card(0.6, 0.92)],
                hud: null,
                boards: [null, board(0.08, 0.4), board(0.6, 0.92), null, null],
            };
        }
        if (r < 0.92) {
            // Four across: no room beside the cards at all.
            const cards = [0, 1, 2, 3].map((i) => card(0.02 + i * 0.245, 0.02 + i * 0.245 + 0.225));
            return {
                cardCount: 4, cards, hud: null, boards: [null, ...cards.map((c) => board(c.x0, c.x1))],
            };
        }
        // A card whose canvas is not up yet (a mode starting).
        return {
            cardCount: 1, cards: [card(0.35, 0.65)], hud: null, boards: [null, null, null, null, null],
        };
    }

    /** Play `calls` random calls on a new world and audit every one. @returns {{ faults: string[], stats: object }} */
    function fuzz(seed, quality, calls = 3000) {
        const rand = mulberry32(seed);
        const pick = (list) => list[Math.floor(rand() * list.length)];
        const { camera, world } = makeWorld(quality, { start: Math.floor(rand() * 400) });
        let { time } = world;
        const faults = [];
        const stats = {
            locks: 0, clears: 0, frames: 0, seeks: 0, resizes: 0, mostWisps: 0, mostRings: 0, levels: 0,
        };
        let note = 'start';
        const fault = (what) => {
            const where = `seed ${seed} ${quality}, call ${stats.calls} (t=${time.toFixed(3)}), after ${note}`;
            if (faults.length < 10) faults.push(`${where}: ${what}`);
        };
        const within = (name, value, low, high) => {
            if (!(value >= low && value <= high)) fault(`${name} = ${value} is outside ${low}..${high}`);
        };
        const audit = () => {
            for (const [name, value] of sharedNumbers(world)) {
                if (!Number.isFinite(value)) fault(`${name} is ${value}`);
            }
            const { u } = world;
            const { x, y, z } = u.counts.value;
            within('rings live', x, 0, RING_SLOTS);
            within('strokes live', y, 0, STROKE_SLOTS);
            within('wisps live', z, 0, WISP_SLOTS);
            within('u.breath', u.breath.value, 0, 1 + 1e-9);
            within('u.power', u.power.value, 0, 1);
            within('u.surge', u.surge.value, 0, 1.5);
            within('u.lift', u.lift.value, 0, 1);
            within('u.squeeze', u.squeeze.value, 0.2, 1);
            within('u.eyes.x', u.eyes.value.x, 0, 1);
            within('u.eyes.y', u.eyes.value.y, 0, 1);
            within('u.lilies.x', u.lilies.value.x, 0, 1);
            within('u.caps.x', u.caps.value.x, 0, 1);
            within('u.caps.y', u.caps.value.y, 0, 1);
            within('u.heartAt.w', u.heartAt.value.w, 0, 1);
            within('u.wind', u.wind.value, 0, 2);
            within('spirit', world.spiritS, 0, 1);
            within('troll', world.trollS, 0, 1);
            within('stage', world.stage.scale.x, 0.2, 1);
            const post = world.getPostState();
            const numbers = [post.flash, post.kick, post.shafts, post.bloomBoost, post.exposure, post.prism.radius,
                post.prism.strength, post.moon.x, post.moon.y, post.heart.x, post.heart.y, ...post.shade];
            if (!numbers.every(Number.isFinite)) fault(`the post reads ${numbers}`);
            const figures = [...world.spirit.figure.position.toArray(), ...world.troll.figure.position.toArray()];
            if (!figures.every(Number.isFinite)) fault(`the figures stand at ${figures}`);
            const state = JSON.stringify(world.getState());
            if (state.includes('null')) fault(`the state has a number that is not one: ${state}`);
            for (let i = 0; i < z; i++) {
                if (!(u.wispRows[i * 2].w > 0)) fault(`wisp row ${i} is told to be read but is not lit`);
            }
            stats.mostWisps = Math.max(stats.mostWisps, z);
            stats.mostRings = Math.max(stats.mostRings, x);
        };
        const rings = recordRings(world);
        stats.calls = 0;
        for (; stats.calls < calls; stats.calls += 1) {
            const r = rand();
            if (r < 0.4) {
                const dt = rand() < 0.1 ? 0 : rand() * 0.2;
                time += dt;
                frame(world, camera, time, dt, { pointerX: rand() * 2 - 1, pointerY: rand() * 2 - 1 });
                stats.frames += 1;
                note = `a frame of ${dt.toFixed(3)} s`;
            } else if (r < 0.62) {
                const from = rings.length;
                const careless = rand() < 0.05;
                world.onLock({
                    u: careless ? pick([NaN, -2, 7, undefined]) : rand(),
                    rows: careless ? pick([null, [], [NaN], 'x']) : [Math.floor(rand() * 20), Math.floor(rand() * 20)],
                    hardDrop: rand() < 0.3,
                    color: rand() < 0.1 ? pick(JUNK) : pick(COLOURS),
                    player: Math.floor(rand() * 5),
                });
                stats.locks += 1;
                note = 'a lock';
                for (const ring of rings.slice(from)) {
                    const at = `(${ring.x.toFixed(1)}, ${ring.z.toFixed(1)})`;
                    if (!(ring.edge < 0)) fault(`a lock's light fell ${ring.edge.toFixed(2)} m inland, at ${at}`);
                }
            } else if (r < 0.74) {
                world.onClear({
                    rows: rand() < 0.1 ? null : [19, 18, 17, 16].slice(0, 1 + Math.floor(rand() * 4)),
                    lines: rand() < 0.05 ? pick([0, NaN, 'x', 99]) : 1 + Math.floor(rand() * 4),
                    perfect: rand() < 0.05,
                    tspin: rand() < 0.15,
                    player: Math.floor(rand() * 5),
                    screen: rand() < 0.1 ? { x: rand(), y: rand() } : null,
                });
                stats.clears += 1;
                note = 'a clear';
            } else if (r < 0.84) {
                const chain = Math.floor(rand() * 12) * (rand() < 0.3 ? 0 : 1);
                world.onCombo(rand() < 0.05 ? pick([NaN, -1, 1e6, 'x']) : chain);
                note = 'a combo';
            } else if (r < 0.88) {
                const level = rand() < 0.1 ? pick([NaN, 0, -3, 1e6]) : 1 + Math.floor(rand() * 30);
                world.levelUp(level, { silent: rand() < 0.3 });
                stats.levels += 1;
                note = 'a level';
            } else if (r < 0.9) {
                time = Math.floor(rand() * 2000);
                world.seek(time);
                stats.seeks += 1;
                note = 'a seek';
            } else if (r < 0.92) {
                if (rand() < 0.5) world.resetSession();
                else world.onGameOver();
                note = 'a new run';
            } else if (r < 0.955) {
                const aspect = 0.4 + rand() * 2;
                world.setLayout(someLayout(rand, aspect * 1000, 1000), rand() < 0.5 ? aspect : undefined);
                note = 'a layout';
            } else if (r < 0.99) {
                const aspect = 0.4 + rand() * 2;
                const height = 400 + Math.floor(rand() * 1200);
                world.setViewport(Math.round(height * aspect), height, aspect);
                camera.aspect = aspect;
                stats.resizes += 1;
                note = `a resize to ${aspect.toFixed(2)}`;
            } else {
                world.setReducedMotion(rand() < 0.5);
                world.setHourDrift(rand() < 0.7);
                note = 'a setting';
            }
            audit();
        }
        // ── Left alone, the night comes to rest ──
        world.onCombo(0);
        world.setReducedMotion(false);
        note = 'being left alone';
        for (let i = 0; i < 120; i++) {
            time += 0.5;
            frame(world, camera, time, 0.5);
            audit();
        }
        const { x, y, z } = world.u.counts.value;
        if (x + y + z !== 0) fault(`a minute later the tables still hold ${x} rings, ${y} strokes, ${z} wisps`);
        const kept = `${world.wisps.length} wisps and ${world.feeds.length} feeds`;
        if (world.wisps.length || world.feeds.length) fault(`a minute later ${kept} are still kept`);
        const places = `${world.spiritS}, ${world.trollS}`;
        if (world.trollS !== 0 || world.spiritS > 1e-6) fault(`a minute later the two are not home: ${places}`);
        if (world.u.power.value > 1e-6 || world.u.surge.value > 1e-3) fault('a minute later the wood is still charged');
        if (Math.abs(world.u.breath.value - 1) > 1e-6) fault(`a minute later the breath is ${world.u.breath.value}`);
        world.dispose();
        return { faults, stats };
    }

    it.each([[11, 'Low'], [2024, 'Minimal'], [77, 'High']])(
        'keeps every number the shaders read finite and in range through three thousand random calls (seed %i, %s)',
        (seed, quality) => {
            const { faults, stats } = fuzz(seed, quality);
            expect(faults).toEqual([]);
            // The run did exercise the world.
            expect(stats.locks).toBeGreaterThan(400);
            expect(stats.clears).toBeGreaterThan(200);
            expect(stats.frames).toBeGreaterThan(800);
            expect(stats.seeks).toBeGreaterThan(20);
            expect(stats.resizes).toBeGreaterThan(50);
            expect(stats.mostWisps).toBeGreaterThan(3);
            expect(stats.mostRings).toBeGreaterThan(3);
        },
    );
});
