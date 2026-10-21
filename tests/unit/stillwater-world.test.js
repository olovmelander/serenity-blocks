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
 *
 * The two figures are read from their real files (see the loader below): a test that is about
 * them builds its world with makeFiguredWorld, and the rest of the tarn's tests run without them,
 * as the world does until its figures arrive.
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
    eyesForCombo, heartForCombo, hourAt, moonFor, mulberry32, paletteAt, pieceColor, powerForCombo,
    skyDirection, squeezeFor, strokePassTime,
} from '../../src/themes/stillwater/stillwater-core.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/stillwater/stillwater-quality.js';
import { boardPoint, cardUnion, fallbackLayout } from '../../src/themes/stillwater/stillwater-composition.js';
import { groundHeight, shoreDistance } from '../../src/themes/stillwater/stillwater-plan.js';
import { crownCard } from '../../src/themes/stillwater/stillwater-trees.js';
import {
    HEART_FLIGHT, PARTING, chainBond, spiritPathPoint, trollStation,
} from '../../src/themes/stillwater/stillwater-story.js';

// Every test builds a whole world (a noise field, the plans, some twenty node materials).
vi.setConfig({ testTimeout: 60000 });

/**
 * The two figures are fetched by three's GLTFLoader, which has no server to fetch from here: the
 * loader is replaced by one that reads the real file the URL names from the theme's assets and
 * parses it with three's own loader, as the game does. A test that wants the fetch to fail, or to
 * arrive late, puts its own answer in `sculpt.load` (and can still reach the real file by
 * `sculpt.real(url)`). Every URL asked for is kept in `sculpt.urls`.
 */
const sculpt = vi.hoisted(() => ({
    load: null, urls: [], bytes: {}, real: null,
}));
vi.mock('three/addons/loaders/GLTFLoader.js', async (importOriginal) => {
    const actual = await importOriginal();
    const { readFileSync } = await import('node:fs');
    sculpt.real = (url) => {
        const name = String(url).match(/(?:troll|spirit)-lod\d\.glb/)?.[0];
        if (!name) return Promise.reject(new Error(`no figure file at ${url}`));
        if (!sculpt.bytes[name]) {
            const bytes = readFileSync(new URL(`../../src/themes/stillwater/assets/${name}`, import.meta.url));
            sculpt.bytes[name] = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        }
        return new Promise((resolve, reject) => {
            new actual.GLTFLoader().parse(sculpt.bytes[name], '', resolve, reject);
        });
    };
    return {
        GLTFLoader: class {
            loadAsync(url) {
                sculpt.urls.push(url);
                return sculpt.load ? sculpt.load(url) : sculpt.real(url);
            }
        },
    };
});

/** What stands on the banks (drawn in with them on a narrow frame), what hangs in the air, and what is not mirrored. */
const BANKS = ['ground', 'boulders', 'trunks', 'crowns', 'boughs', 'fringe', 'saplings', 'ferns', 'reeds', 'pads',
    'lilies', 'caps', 'spirit', 'troll'];
const AIR = ['mist', 'eyes', 'fireflies', 'wisps', 'drops', 'sparks', 'orb'];
/** (The low mist lies ON the water: what stands over it is mirrored, the veil itself is not.) */
const UNMIRRORED = ['sky', 'water', 'veil'];

/** The parts a tier may leave out, and the tier's number that says so. */
const OPTIONAL = {
    boughs: 'boughs',
    fringe: 'boughs',
    saplings: 'saplings',
    ferns: 'ferns',
    reeds: 'reeds',
    mist: 'mist',
    veil: 'veil',
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

/** A world as makeWorld builds it, with both figures fetched and in, and the clock sought to `start` again. */
async function makeFiguredWorld(quality = 'Low', options = {}) {
    const made = makeWorld(quality, options);
    const { world, camera } = made;
    await expect(world.prepare()).resolves.toBe(true);
    expect(world.getState()).toMatchObject({ trollReady: true, spiritReady: true });
    const start = options.start ?? 10;
    world.seek(start);
    frame(world, camera, start, 0);
    return made;
}

/** Where each figure stands now (the walk frame is the world's): the troll's root, the spirit's. */
const trollAt = (world) => world.troll.body.root;
const spiritAt = (world) => world.spirit.rootWalk();

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
    take('spirit.uFed', world.spirit.uFed.value);
    take('troll.uCloak', world.troll.uCloak.value);
    // And the figures' own poses, when they are in.
    for (const [who, body] of [['troll', world.troll.body], ['spirit', world.spirit.body]]) {
        if (!body) continue;
        Object.entries(body.local).forEach(([name, q]) => take(`${who}.${name}`, q));
        take(`${who}.root`, body.root);
        take(`${who}.hips`, body.hipsOffset);
    }
    return out;
}

/** Where a world point shows through a camera (screen fractions, y down). */
function onScreen(point, camera) {
    const v = new THREE.Vector3(...point).project(camera);
    return { x: v.x * 0.5 + 0.5, y: 0.5 - v.y * 0.5 };
}

/**
 * How far along the line from `from` to `to` (the stage's places) a point of the world stands
 * (0 at `from`, 1 at `to`), and how far off that line (m), on a stage drawn in by `squeeze`.
 */
function wayOf(from, to, point, squeeze = 1) {
    const ax = from[0] * squeeze;
    const dx = to[0] * squeeze - ax;
    const dz = to[2] - from[2];
    const along = ((point.x - ax) * dx + (point.z - from[2]) * dz) / (dx * dx + dz * dz);
    const off = Math.hypot(point.x - (ax + dx * along), point.z - (from[2] + dz * along));
    return { along, off, length: Math.hypot(dx, dz) };
}

/** The troll's way (his seat to the shallows) and the spirit's (her stone to as far as she comes). */
const TROLL_WAY = [TROLL.home, TROLL.shallows];
const SPIRIT_WAY = [SPIRIT.home, spiritPathPoint(1)];

/** Every number of both figures' poses (empty while they are not in). */
function posesOf(world) {
    const out = [];
    for (const body of [world.troll.body, world.spirit.body]) {
        if (!body) continue;
        Object.values(body.local).forEach((q) => out.push(...q.toArray()));
        out.push(...body.root.toArray(), ...body.hipsOffset.toArray(), body.heading);
    }
    return out;
}

/**
 * A run of play that touches every reaction: locks, a hard drop, clears, a chain to 5, four lines,
 * a level, a break. Each step is something the game tells the world, or a number of seconds to let
 * it run.
 */
const PLAY = [
    (world) => world.onLock({ u: 0.2, rows: [18, 19], color: '#F2D68A' }),
    0.5,
    (world) => world.onLock({
        u: 0.8, rows: [17, 18], color: '#6CC7C6', hardDrop: true,
    }),
    0.5,
    (world) => {
        world.onLock({ u: 0.35, rows: [19], color: '#C36F73' });
        world.onClear({ rows: [19], lines: 1 });
        world.onCombo(1);
    },
    0.6,
    (world) => {
        world.onLock({ u: 0.7, rows: [18, 19], color: '#5F9B72' });
        world.onClear({ rows: [18, 19], lines: 2 });
        world.onCombo(2);
    },
    0.6,
    (world) => {
        world.onLock({ u: 0.5, rows: [19], color: '#9A7FB7' });
        world.onClear({ rows: [19], lines: 1, tspin: true });
        world.onCombo(3);
    },
    0.6,
    (world) => {
        world.onLock({ u: 0.1, rows: [17, 18, 19], color: '#537E9F' });
        world.onClear({ rows: [17, 18, 19], lines: 3 });
        world.onCombo(4);
    },
    0.6,
    (world) => {
        world.onLock({
            u: 0.95, rows: [16, 17, 18, 19], color: '#D99A5E', hardDrop: true,
        });
        world.onClear({ rows: [16, 17, 18, 19], lines: 4 });
        world.onCombo(5);
    },
    0.8,
    (world) => world.levelUp(2),
    0.9,
    (world) => {
        world.onLock({ u: 0.4, rows: [19], color: '#F2D68A' });
        world.onCombo(0);
    },
    0.9,
];

function play(world, camera) {
    for (const step of PLAY) {
        if (typeof step === 'number') run(world, camera, step);
        else step(world);
    }
}

/** The same play on several worlds in lockstep, calling `each()` after every frame all of them have taken. */
function playTogether(made, each) {
    for (const step of PLAY) {
        if (typeof step !== 'number') {
            made.forEach(({ world }) => step(world));
            continue;
        }
        const frames = Math.max(1, Math.round(step * 60));
        const starts = made.map(({ world }) => world.time);
        for (let i = 1; i <= frames; i++) {
            made.forEach(({ world, camera }, k) => frame(world, camera, starts[k] + i / 60, 1 / 60));
            each();
        }
    }
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
        figures: [world.spirit.figure.position.toArray(), world.troll.figure.position.toArray(), posesOf(world)],
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
            // Every tree but the two giants ends in a crown; the veil has the layers the tier pays for.
            expect(world.parts.crowns.count, quality).toBe(tier.trunks - 2);
            if (tier.veil > 0) expect(world.parts.veil.count, quality).toBe(tier.veil);
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
                spiritReady: false,
                trollMode: null,
                spiritMode: null,
                bond: 0,
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
    /** Every draw of the world, in the order three would sort it: solid ones and blended ones. */
    function drawsOf(world) {
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
        return {
            drawn,
            solid: drawn.filter((item) => !item.transparent).sort((a, b) => a.renderOrder - b.renderOrder),
            blended: drawn.filter((item) => item.transparent).sort((a, b) => a.renderOrder - b.renderOrder),
        };
    }
    const place = (list, pattern) => list.findIndex((item) => pattern.test(item.name));

    it('draws the sky last of what is solid, and the lights after the mist', async () => {
        const { world } = await makeFiguredWorld('High');
        const { drawn, solid, blended } = drawsOf(world);
        expect(drawn.length).toBeGreaterThan(STILLWATER_PARTS.length);
        // No group outranks the orders of what is in it.
        expect(drawn.filter((item) => item.groupOrder !== 0)).toEqual([]);
        // The sky's shader runs only where the distance shows between the trunks; the water's only where no bank hides it.
        expect(solid.at(-1).name).toMatch(/Sky/);
        for (const pattern of [/Ground/, /Trunks/, /Boulders/, /StillwaterTroll$/, /StillwaterSpirit$/, /Staff/]) {
            expect(place(solid, pattern), String(pattern)).toBeGreaterThanOrEqual(0);
            expect(place(solid, pattern), String(pattern)).toBeLessThan(place(solid, /Water/));
        }
        // The mist on the water first, then the sheets of it over the water, then every light.
        expect(place(blended, /Veil/)).toBe(0);
        expect(place(blended, /Mist/)).toBe(1);
        for (const pattern of [/Wisps/, /Sparks/, /Drops/, /Eyes/, /Fireflies/, /Halo/, /Glow/, /Motes/, /HeartOrb/]) {
            expect(place(blended, pattern), String(pattern)).toBeGreaterThan(0);
        }
        world.dispose();
    });

    // What is blended is drawn back to front by its place in the list, so no two blended draws share
    // a renderOrder (found pinned: the spirit's motes and the heart's orb once shared theirs).
    it('draws each blended light in a place of its own', async () => {
        const { world } = await makeFiguredWorld('High');
        const { blended } = drawsOf(world);
        const twin = (item, i) => blended.some((other, k) => k !== i && other.renderOrder === item.renderOrder);
        const shared = blended.filter(twin);
        expect(shared.map((item) => `${item.name} ${item.renderOrder}`)).toEqual([]);
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

describe('stillwater world: the figures', () => {
    it('needs neither figure: the whole of play runs with the lantern standing by itself', () => {
        const { camera, world } = makeWorld('Low');
        expect(world.getState()).toMatchObject({ trollReady: false, spiritReady: false });
        expect(() => play(world, camera)).not.toThrow();
        for (const [name, value] of sharedNumbers(world)) expect(Number.isFinite(value), name).toBe(true);
        // His lantern is lit and stands by his seat, over the bank.
        const lantern = world.u.lanternAt.value;
        expect(lantern.w).toBeGreaterThan(0);
        expect(lantern.y).toBeGreaterThan(TROLL.home[1]);
        expect(Math.hypot(lantern.x - TROLL.home[0], lantern.z - TROLL.home[2])).toBeLessThan(TROLL.height);
        // Her light stands over her stone.
        const her = world.u.spiritAt.value;
        expect(Math.hypot(her.x - SPIRIT.home[0], her.z - SPIRIT.home[2])).toBeLessThan(0.5);
        expect(her.y).toBeGreaterThan(SPIRIT.home[1]);
        world.dispose();
    });

    it.each(['Minimal', 'High'])(
        'takes both figures when they arrive: the meshes the tier pays for, mirrored, in their own materials (%s)',
        async (quality) => {
            const { camera, world } = makeWorld(quality);
            await expect(world.prepare()).resolves.toBe(true);
            const tier = QUALITY[quality];
            // It fetched the meshes its tier pays for, one of each.
            expect(sculpt.urls).toHaveLength(2);
            expect(sculpt.urls.find((url) => url.includes('troll-lod'))).toContain(`troll-lod${tier.troll}.glb`);
            expect(sculpt.urls.find((url) => url.includes('spirit-lod'))).toContain(`spirit-lod${tier.spirit}.glb`);
            expect(world.getState()).toMatchObject({
                trollReady: true, spiritReady: true, trollMode: 'seated', spiritMode: 'standing',
            });
            const skins = {};
            for (const [who, part] of [['troll', world.troll], ['spirit', world.spirit]]) {
                expect(part.ready, who).toBe(true);
                expect(part.failed, who).toBe(false);
                // Each stands in its own group, shaded as part of the place, and the water mirrors it.
                part.mesh.traverse((object) => {
                    if (object.isSkinnedMesh) skins[who] = object;
                    expect(object.layers.mask, `${who}: ${object.name || object.type}`).toBe(1 << HERO_LAYER);
                });
                const skin = skins[who];
                expect(skin, who).toBeTruthy();
                expect(skin.material, who).toBe(part.material);
                expect(skin.material.isNodeMaterial, who).toBe(true);
                expect(skin.frustumCulled, who).toBe(false);
                expect(skin.geometry.getAttribute('position').array, who).toBeInstanceOf(Float32Array);
                // Its skeleton is the body's: every bone the body poses is a bone of the mesh.
                const names = skin.skeleton.bones.map((bone) => bone.name);
                expect(Object.keys(part.body.local).sort(), who).toEqual([...names].sort());
            }
            // They arrive at rest: she on her stone, he seated on his.
            expect([spiritAt(world).x, spiritAt(world).z]).toEqual([SPIRIT.home[0], SPIRIT.home[2]]);
            expect(Math.abs(spiritAt(world).y - SPIRIT.home[1])).toBeLessThan(0.02);
            run(world, camera, 0.5);
            world.root.updateMatrixWorld(true);
            const troll = trollAt(world);
            expect(Math.hypot(troll.x - TROLL.home[0], troll.z - TROLL.home[2])).toBeLessThan(0.05);
            expect(Math.abs(troll.y - groundHeight(troll.x, troll.z))).toBeLessThan(0.1);
            // His soles are where his root stands: the sculpt's sole height comes out at the root.
            const sole = new THREE.Vector3(0, world.troll.body.sole, 0)
                .applyMatrix4(skins.troll.matrixWorld);
            expect(sole.y).toBeCloseTo(troll.y, 6);
            // The skeleton carries the body's pose.
            for (const [who, skin] of Object.entries(skins)) {
                for (const bone of skin.skeleton.bones) {
                    const posed = world[who].body.local[bone.name].toArray();
                    expect(bone.quaternion.toArray(), `${who}: ${bone.name}`).toEqual(posed);
                }
            }
            // A chain gets him up and walks him down to the water's edge: his legs move as he goes.
            const thigh = skins.troll.skeleton.bones.find((bone) => bone.name === 'thighL');
            const atRest = thigh.quaternion.clone();
            let swung = 0;
            world.onCombo(3);
            run(world, camera, 6, 60, () => {
                swung = Math.max(swung, thigh.quaternion.angleTo(atRest));
            });
            expect(swung).toBeGreaterThan(0.1);
            run(world, camera, 8);
            expect(world.getState().trollMode).toBe('standing');
            expect(Math.hypot(trollAt(world).x - TROLL.reach[0], trollAt(world).z - TROLL.reach[2])).toBeLessThan(0.2);
            expect(world.troll.body.anySwing()).toBe(false);
            // His head turns to a clear.
            const head = world.troll.body.local.head.clone();
            world.onClear({ lines: 2 });
            let turned = 0;
            run(world, camera, 0.6, 60, () => {
                turned = Math.max(turned, world.troll.body.local.head.angleTo(head));
            });
            expect(turned).toBeGreaterThan(0.05);
            for (const [name, value] of sharedNumbers(world)) expect(Number.isFinite(value), name).toBe(true);
            // When the world goes, so do they.
            const gone = [vi.spyOn(skins.troll.geometry, 'dispose'), vi.spyOn(skins.spirit.geometry, 'dispose')];
            world.dispose();
            for (const spy of gone) expect(spy).toHaveBeenCalledOnce();
        },
    );

    it('plays the whole of play with both of them in, every number finite', async () => {
        const { camera, world } = await makeFiguredWorld('Low');
        expect(() => play(world, camera)).not.toThrow();
        for (const [name, value] of sharedNumbers(world)) expect(Number.isFinite(value), name).toBe(true);
        expect(posesOf(world).length).toBeGreaterThan(100);
        world.dispose();
    });

    it('survives figures that cannot be had: each says so once, and play goes on without them', async () => {
        const { camera, world } = makeWorld('Low');
        const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
        sculpt.load = () => Promise.reject(new Error('404'));
        await expect(world.prepare()).resolves.toBe(false);
        expect(warned).toHaveBeenCalledTimes(2);
        const said = warned.mock.calls.map((call) => String(call[0])).join(' | ');
        expect(said).toMatch(/troll/i);
        expect(said).toMatch(/spirit/i);
        expect(world.getState()).toMatchObject({ trollReady: false, spiritReady: false });
        expect(world.troll.failed).toBe(true);
        expect(world.spirit.failed).toBe(true);
        expect(() => play(world, camera)).not.toThrow();
        // A chain still wakes the wood; his lantern burns on where it stands by his seat.
        const before = world.u.lanternAt.value.clone();
        world.onCombo(8);
        run(world, camera, 5);
        const now = world.u.lanternAt.value;
        expect(Math.hypot(now.x - before.x, now.y - before.y, now.z - before.z)).toBeLessThan(1e-9);
        expect(now.w).toBeGreaterThan(0.5);
        expect(world.u.power.value).toBeGreaterThan(0.5);
        expect(world.getState()).toMatchObject({ troll: 0, spirit: 0, bond: chainBond(8) });
        for (const [name, value] of sharedNumbers(world)) expect(Number.isFinite(value), name).toBe(true);
        world.dispose();
    });

    it('takes the one that arrives without the other', async () => {
        const { camera, world } = makeWorld('Low');
        const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
        sculpt.load = (url) => (url.includes('spirit') ? Promise.reject(new Error('404')) : sculpt.real(url));
        await expect(world.prepare()).resolves.toBe(true);
        expect(warned).toHaveBeenCalledOnce();
        expect(world.getState()).toMatchObject({ trollReady: true, spiritReady: false });
        world.onCombo(6);
        run(world, camera, 10, 30);
        // He walks down to the water; her light waits at her stone.
        expect(world.getState().troll).toBeGreaterThan(0.5);
        expect(world.getState().spirit).toBe(0);
        expect(spiritAt(world).x).toBe(SPIRIT.home[0] * world.squeeze);
        for (const [name, value] of sharedNumbers(world)) expect(Number.isFinite(value), name).toBe(true);
        world.dispose();
    });

    it('drops figures that arrive after the world has gone', async () => {
        const { scene, world } = makeWorld('Minimal');
        const asked = [];
        sculpt.load = (url) => new Promise((resolve) => {
            asked.push({ url, resolve });
        });
        const preparing = world.prepare();
        expect(asked).toHaveLength(2);
        world.dispose();
        const arrived = [];
        for (const { url, resolve } of asked) {
            // eslint-disable-next-line no-await-in-loop
            const gltf = await sculpt.real(url);
            arrived.push(gltf);
            resolve(gltf);
        }
        await expect(preparing).resolves.toBe(false);
        // Neither was taken in: each file's mesh is still where the loader left it.
        for (const gltf of arrived) {
            let mesh = null;
            gltf.scene.traverse((object) => {
                if (object.isMesh && !mesh) mesh = object;
            });
            expect(mesh.parent).toBe(gltf.scene);
        }
        expect(scene.children).toHaveLength(0);
        expect(world.getState()).toMatchObject({ trollReady: false, spiritReady: false });
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

    it('draws the stage in on a tall frame, keeps the two figures their width, and moves the moon', async () => {
        const { camera, world } = await makeFiguredWorld('Low');
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
            // The two walk in true metres: the ground they walk on is widened back by what the stage is drawn in by.
            expect(world.spirit.figure.parent.scale.x, label).toBeCloseTo(1 / squeeze, 12);
            expect(world.troll.figure.parent.scale.x, label).toBeCloseTo(1 / squeeze, 12);
            expect(size(world.spirit.figure).toArray(), label).toEqual([1, 1, 1].map((v) => expect.closeTo(v, 9)));
            expect(size(world.troll.figure).toArray(), label).toEqual([1, 1, 1].map((v) => expect.closeTo(v, 9)));
            // They start again at rest where the banks now are: she on her stone, he seated on his.
            const spirit = new THREE.Vector3().setFromMatrixPosition(world.spirit.figure.matrixWorld);
            const troll = new THREE.Vector3().setFromMatrixPosition(world.troll.figure.matrixWorld);
            expect(spirit.x, label).toBeCloseTo(SPIRIT.home[0] * squeeze, 9);
            expect(spirit.z, label).toBeCloseTo(SPIRIT.home[2], 9);
            expect(troll.x, label).toBeCloseTo(TROLL.home[0] * squeeze, 9);
            expect(troll.z, label).toBeCloseTo(TROLL.home[2], 9);
            expect(world.getState().trollMode, label).toBe('seated');
            // He stands on the ground the stage has there now.
            expect(Math.abs(troll.y - groundHeight(troll.x / squeeze, troll.z)), label).toBeLessThan(0.1);
            // Their lights are where they stand: the water, the banks and the wisps read these.
            expect(Math.abs(world.u.spiritAt.value.x - spirit.x), label).toBeLessThan(0.1);
            expect(Math.abs(world.u.spiritAt.value.z - spirit.z), label).toBeLessThan(0.1);
            expect(world.u.spiritAt.value.y - spirit.y, label).toBeGreaterThan(SPIRIT.height * 0.5);
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
        expect(world.spirit.figure.parent.scale.x).toBe(1);
        expect(world.troll.figure.parent.scale.x).toBe(1);
        expect(trollAt(world).x).toBe(TROLL.home[0]);
        expect(spiritAt(world).x).toBe(SPIRIT.home[0]);
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

    it('stands the spirit left of the card and the troll right of it, both in the frame, on any frame', async () => {
        for (const [width, height] of [...WIDE, ...UPRIGHT]) {
            // eslint-disable-next-line no-await-in-loop
            const { camera, world } = await makeFiguredWorld('Minimal', { width, height, reduced: true });
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
            // His lantern is in the frame too, clear of the card.
            const lantern = onScreen(world.u.lanternAt.value.toArray().slice(0, 3), camera);
            expect(lantern.x, label).toBeGreaterThan(card.x1);
            expect(lantern.x, label).toBeLessThan(1);
            world.dispose();
        }
    });

    // On an upright frame his lantern once hung behind the card's edge at rest (430 × 932: the
    // flame at 0.777 of the width, the card's edge at 0.804): he held it out toward the board.
    // Seated with his staff at his side, it hangs in the strip beside the card.
    it('keeps the troll\'s lantern clear of the card on an upright frame while he rests', async () => {
        const hidden = [];
        for (const [width, height] of UPRIGHT) {
            // eslint-disable-next-line no-await-in-loop
            const { camera, world } = await makeFiguredWorld('Minimal', { width, height, reduced: true });
            const card = cardUnion(world.layout);
            let worst = 1;
            run(world, camera, 8, 30, () => {
                worst = Math.min(worst, onScreen(world.u.lanternAt.value.toArray().slice(0, 3), camera).x);
            });
            if (!(worst > card.x1)) hidden.push(`${width} × ${height}: ${worst.toFixed(3)} < ${card.x1.toFixed(3)}`);
            world.dispose();
        }
        expect(hidden).toEqual([]);
    });

    it('keeps the two and his lantern clear of the card on a wide frame however far a chain draws them', async () => {
        for (const [width, height] of WIDE) {
            // eslint-disable-next-line no-await-in-loop
            const { camera, world } = await makeFiguredWorld('Minimal', { width, height, reduced: true });
            const card = cardUnion(world.layout);
            const label = `${width} × ${height}`;
            world.onCombo(20);
            const worst = { her: 0, him: 1, lantern: 1 };
            run(world, camera, 14, 30, () => {
                const spirit = spiritAt(world);
                const troll = trollAt(world);
                // (Her own half width is about a fifth of her height; his about a third of his.)
                const herFlank = onScreen([spirit.x + SPIRIT.height * 0.2, spirit.y + 1, spirit.z], camera);
                const hisFlank = onScreen([troll.x - TROLL.height * 0.33, troll.y + 1, troll.z], camera);
                const lantern = onScreen(world.u.lanternAt.value.toArray().slice(0, 3), camera);
                worst.her = Math.max(worst.her, herFlank.x);
                worst.him = Math.min(worst.him, hisFlank.x);
                worst.lantern = Math.min(worst.lantern, lantern.x);
            });
            // (They did come all the way.)
            expect(world.getState().troll, label).toBeGreaterThan(0.95);
            expect(world.getState().spirit, label).toBeGreaterThan(0.9);
            expect(worst.her, label).toBeLessThan(card.x0);
            expect(worst.him, label).toBeGreaterThan(card.x1);
            expect(worst.lantern, label).toBeGreaterThan(card.x1);
            world.dispose();
        }
    });

    // The story reckons in the stage's coordinates and the world converts, so on an upright frame
    // he is home by his stone, not "still on his way" (found pinned: he held his lantern up there).
    it('lets the troll lean on his staff by his stone, on a narrow frame as on a wide one', async () => {
        for (const [width, height] of [[1600, 900], ...UPRIGHT]) {
            // eslint-disable-next-line no-await-in-loop
            const { camera, world } = await makeFiguredWorld('Minimal', { width, height });
            world.onCombo(2);
            run(world, camera, 5, 30);
            const label = `${width} × ${height}`;
            expect(world.getState().trollMode, label).toBe('standing');
            const home = [TROLL.home[0] * world.squeeze, TROLL.home[2]];
            const fromHome = Math.hypot(trollAt(world).x - home[0], trollAt(world).z - home[1]);
            expect(fromHome, label).toBeLessThan(0.1);
            expect(world.troll.body.staff.mode, label).toBe('planted');
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
                if (part.plan && name === 'crowns') {
                    // A crown's card is placed by the vertex stage: its CPU twin says where.
                    for (let c = 0; c < part.plan.length && !blocked; c++) {
                        const card = crownCard(part.plan[c], camera.position.toArray(), world.squeeze)
                            .map((p) => new THREE.Vector3(...p));
                        if (ray.intersectTriangle(card[0], card[1], card[2], false, hit)
                            || ray.intersectTriangle(card[2], card[1], card[3], false, hit)) blocked = true;
                    }
                    continue;
                }
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

    it('leaves the moon clear of trunks, crowns and boughs on any frame, as the frame is really drawn', () => {
        for (const quality of ['Minimal', 'High']) {
            for (const [width, height] of [[1600, 900], [2560, 1080], [1280, 1024], [1000, 1000], ...UPRIGHT]) {
                const { camera, world } = makeWorld(quality, { width, height, reduced: true });
                const label = `${quality} at ${width} × ${height}`;
                expect(moonCrossings(world, camera, ['trunks', 'crowns', 'boughs', 'fringe']), label).toBe(0);
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
                // A night with no wisps, kept in step with this one frame for frame: what the lights burn at without them.
                const calm = makeWorld('Low', { width, height });
                run(calm.world, calm.camera, WISP_RISE + 1);
                expect(calm.world.time).toBe(world.time);
                const step = world.update.bind(world);
                world.update = (sim, cam) => {
                    step(sim, cam);
                    calm.world.updateCamera(calm.camera, sim);
                    calm.world.update(sim, calm.camera);
                };
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
                // The light they brought fades again: it burns as it does in a night that had no wisps.
                // (At rest the two still glance across now and then, and a meeting of eyes warms both.)
                run(world, camera, 15, 20);
                expect(world.getState().fed[mine]).toBeLessThan(0.01);
                expect(calm.world.time).toBe(world.time);
                const calmHome = side < 0 ? calm.world.u.spiritAt : calm.world.u.lanternAt;
                expect(home.value.w).toBeCloseTo(calmHome.value.w, 2);
                calm.world.dispose();
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

    /** Four lines on a world with its figures in: the heart's flight, frame by frame, with where her breast is. */
    async function heartFlight(options = {}) {
        const { camera, world } = await makeFiguredWorld('Low', options);
        const t0 = world.time;
        world.onClear({ lines: 4 });
        const seen = [];
        run(world, camera, HEART_FLIGHT.held + 3, 60, () => {
            const o = world.u.orbAt.value;
            seen.push({
                t: world.time - t0, x: o.x, y: o.y, z: o.z, w: o.w, her: world.u.spiritAt.value.clone(),
            });
        });
        return { world, seen };
    }

    it('lifts the gold heart out of the tarn on four lines and carries it to her breast', async () => {
        const { world, seen } = await heartFlight();
        for (const s of seen) {
            expect([s.x, s.y, s.z, s.w].every(Number.isFinite)).toBe(true);
            if (s.t < HEART_FLIGHT.rise - 1e-6) expect(s.w).toBe(0);
        }
        const flying = seen.filter((s) => s.t > HEART_FLIGHT.rise + 0.05 && s.t < HEART_FLIGHT.taken);
        expect(flying.length).toBeGreaterThan(60);
        expect(flying.every((s) => s.w > 0)).toBe(true);
        // It comes up out of the dark under the water, from the tarn's heart, and rises high over it.
        expect(flying[0].y).toBeLessThan(0);
        expect(Math.hypot(flying[0].x - HEART[0], flying[0].z - HEART[2])).toBeLessThan(1e-9);
        expect(Math.max(...flying.map((s) => s.y))).toBeGreaterThan(1.5);
        // Taken, it is in her breast; then it is gone into her own light.
        const taken = seen.filter((s) => s.t >= HEART_FLIGHT.taken + 0.02 && s.t < HEART_FLIGHT.held);
        for (const s of taken) expect(Math.hypot(s.x - s.her.x, s.y - s.her.y, s.z - s.her.z)).toBeLessThan(0.3);
        expect(seen.at(-1).w).toBe(0);
        world.dispose();
    });

    // The heart's flight is reckoned in the stage's coordinates from start to end, so on a narrow
    // frame it lands at her breast (found pinned: it once landed 1.6 m short).
    it('carries the gold heart to her breast on a narrow frame too', async () => {
        const { world, seen } = await heartFlight({ width: 390, height: 844 });
        expect(world.squeeze).toBeLessThan(1);
        const taken = seen.filter((s) => s.t >= HEART_FLIGHT.taken + 0.02 && s.t < HEART_FLIGHT.held);
        expect(taken.length).toBeGreaterThan(30);
        for (const s of taken) expect(Math.hypot(s.x - s.her.x, s.y - s.her.y, s.z - s.her.z)).toBeLessThan(0.3);
        world.dispose();
    });
});

describe('stillwater world: a chain', () => {
    /** How far along his way (0 his seat, 1 the shallows) each place of his lies. */
    const trollFraction = (spot) => Math.hypot(spot[0] - TROLL.home[0], spot[2] - TROLL.home[2])
        / Math.hypot(TROLL.shallows[0] - TROLL.home[0], TROLL.shallows[2] - TROLL.home[2]);
    const PLACES = { home: TROLL.home, bank: TROLL.reach, shallows: TROLL.shallows };

    it('draws the spirit out over the water and walks the troll down to it and into it, step by step', async () => {
        const { camera, world } = await makeFiguredWorld('Low');
        let station = 'home';
        let label = 'at rest';
        let last = world.getState();
        let trollStep = 0;
        let spiritStep = 0;
        let before = { troll: trollAt(world).clone(), spirit: spiritAt(world).clone() };
        const watch = () => {
            const state = world.getState();
            const troll = trollAt(world);
            const spirit = spiritAt(world);
            // Each keeps to its own way, and goes only forward while the chain grows.
            expect(wayOf(...TROLL_WAY, troll).off, label).toBeLessThan(0.05);
            expect(wayOf(...SPIRIT_WAY, spirit).off, label).toBeLessThan(1e-6);
            expect(state.troll, label).toBeGreaterThanOrEqual(last.troll - 1e-3);
            expect(state.spirit, label).toBeGreaterThanOrEqual(last.spirit - 1e-9);
            // Never further than the chain has them: he no further than his station, she than her share of the path.
            expect(state.troll, label).toBeLessThanOrEqual(trollFraction(PLACES[station]) + 0.05);
            expect(state.spirit, label).toBeLessThanOrEqual(0.24 + 0.76 * state.bond + 1e-6);
            // Her hem is never under the water.
            expect(spirit.y, label).toBeGreaterThan(0);
            trollStep = Math.max(trollStep, Math.hypot(troll.x - before.troll.x, troll.z - before.troll.z));
            spiritStep = Math.max(spiritStep, Math.hypot(spirit.x - before.spirit.x, spirit.z - before.spirit.z));
            before = { troll: troll.clone(), spirit: spirit.clone() };
            last = state;
        };
        for (let combo = 1; combo <= 9; combo++) {
            world.onCombo(combo);
            station = trollStation(chainBond(combo), station);
            label = `combo ${combo}`;
            run(world, camera, 1.4, 60, watch);
            expect(world.getState().bond, label).toBe(chainBond(combo));
        }
        label = 'the longest chain';
        run(world, camera, 12, 60, watch);
        // He walks: never faster than his pace. She glides: never more than a twentieth of her way in a frame.
        expect(trollStep).toBeGreaterThan(0);
        expect(trollStep).toBeLessThanOrEqual((TROLL.pace / 60) * 1.001);
        expect(spiritStep).toBeGreaterThan(0);
        expect(spiritStep).toBeLessThan(wayOf(...SPIRIT_WAY, spiritAt(world)).length / 20);
        // At the end of the longest chain he stands in the shallows, and she as far out as she comes.
        const troll = trollAt(world);
        const spirit = spiritAt(world);
        const end = spiritPathPoint(1);
        expect(world.getState()).toMatchObject({ bond: 1, trollMode: 'standing', spiritMode: 'standing' });
        expect(Math.hypot(troll.x - TROLL.shallows[0], troll.z - TROLL.shallows[2])).toBeLessThan(0.2);
        expect(groundHeight(troll.x, troll.z)).toBeLessThan(0);
        expect(Math.hypot(spirit.x - end[0], spirit.z - end[2])).toBeLessThan(0.05);
        expect(world.onWater(spirit.x, spirit.z)).toBe(true);
        // And the path of light runs between them on the water, from her to his lantern.
        expect(world.getState().path).toBeGreaterThan(0.9);
        const ends = world.u.pathEnds.value;
        expect([ends.x, ends.y]).toEqual([spirit.x, spirit.z]);
        expect([ends.z, ends.w]).toEqual([world.u.lanternAt.value.x, world.u.lanternAt.value.z]);
        expect(world.u.path.value.x).toBe(world.getState().path);
        world.dispose();
    });

    it('sends both home when the chain breaks, but only once they have held each other\'s eyes a while', async () => {
        const { camera, world } = await makeFiguredWorld('Low');
        world.onCombo(9);
        run(world, camera, 16, 30);
        expect(world.getState().troll).toBeGreaterThan(0.95);
        const out = { troll: trollAt(world).clone(), spirit: spiritAt(world).clone() };
        const breath = world.u.breath.value;
        world.onCombo(0);
        run(world, camera, 1 / 60);
        // (The night catches its breath as the chain breaks.)
        expect(world.u.breath.value).toBeLessThan(breath);
        // While they part, neither turns for home: they look at each other.
        let gaze = 0;
        run(world, camera, PARTING - 0.2, 60, () => {
            expect(Math.hypot(trollAt(world).x - out.troll.x, trollAt(world).z - out.troll.z)).toBeLessThan(0.05);
            expect(Math.hypot(spiritAt(world).x - out.spirit.x, spiritAt(world).z - out.spirit.z)).toBeLessThan(1e-6);
            gaze = Math.max(gaze, world.getState().gaze);
        });
        expect(gaze).toBeGreaterThan(0.8);
        expect(world.getState().bond).toBe(1);
        // Then home, each the whole way back, never out again on the way.
        let last = world.getState();
        run(world, camera, 7.5, 30, () => {
            const state = world.getState();
            expect(state.troll).toBeLessThanOrEqual(last.troll + 1e-3);
            expect(state.spirit).toBeLessThanOrEqual(last.spirit + 1e-9);
            last = state;
        });
        expect(world.getState().bond).toBe(0);
        expect(Math.hypot(spiritAt(world).x - SPIRIT.home[0], spiritAt(world).z - SPIRIT.home[2])).toBeLessThan(0.05);
        expect(Math.abs(spiritAt(world).y - SPIRIT.home[1])).toBeLessThan(0.03);
        // He plods up the bank to his stone, and in time sits down on it.
        run(world, camera, 25, 30);
        expect(world.getState().troll).toBeLessThan(0.05);
        expect(world.getState().trollMode).toBe('seated');
        world.dispose();
    });

    // A chain that broke and began again holds them in the parting, then settles them where the
    // new chain has them (found pinned: they once never turned back).
    it('turns them back to where a chain that broke and began again has them', async () => {
        const { camera, world } = await makeFiguredWorld('Low');
        world.onCombo(8);
        run(world, camera, 16, 30);
        world.onCombo(3);
        run(world, camera, PARTING + 14, 30);
        expect(world.getState().bond).toBe(chainBond(3));
        expect(Math.hypot(trollAt(world).x - TROLL.reach[0], trollAt(world).z - TROLL.reach[2])).toBeLessThan(0.2);
        world.dispose();
    });

    // (He once walked out over the water's edge and stood 0.27 m above the ground at the end of a long chain.)
    it('stands the troll on the ground all the way: by his seat, down the bank, in the shallows', async () => {
        for (const [width, height] of [[1600, 900], [390, 844]]) {
            // eslint-disable-next-line no-await-in-loop
            const { camera, world } = await makeFiguredWorld('Low', { width, height });
            const { body } = world.troll;
            const label = `${width} × ${height}`;
            const off = [];
            let deepest = 0;
            let rode = 0;
            const check = () => {
                for (const side of ['L', 'R']) {
                    const foot = body.feet[side];
                    if (foot.swing) continue;
                    const gap = foot.pos.y - groundHeight(foot.pos.x / world.squeeze, foot.pos.z);
                    const way = `${(world.getState().troll * 100).toFixed(0)} %`;
                    if (gap !== 0 && off.length < 5) off.push(`${side} ${gap} m off at ${way}`);
                    deepest = Math.min(deepest, foot.pos.y);
                }
                // His body rides on his feet.
                rode = Math.max(rode, Math.abs(body.root.y - (body.feet.L.pos.y + body.feet.R.pos.y) / 2));
            };
            check();
            world.onCombo(20);
            run(world, camera, 16, 60, check);
            expect(off, label).toEqual([]);
            expect(rode, label).toBeLessThan(0.15);
            expect(world.getState().troll, label).toBeGreaterThan(0.95);
            // At the end of his way he stands in the water, and never deeper than shin-deep. (On a
            // narrow frame his true-metre stance spans more of the drawn-in bed: a little deeper.)
            for (const side of ['L', 'R']) expect(body.feet[side].pos.y, `${label} ${side}`).toBeLessThan(0);
            expect(deepest, label).toBeGreaterThan(-TROLL.height * 0.25);
            world.dispose();
        }
    });

    it('rings the water at the troll\'s steps in it, and at none of his steps on the bank, on any frame', async () => {
        for (const [width, height] of [[1600, 900], [390, 844]]) {
            // eslint-disable-next-line no-await-in-loop
            const { camera, world } = await makeFiguredWorld('Low', { width, height });
            const label = `${width} × ${height}`;
            const rings = recordRings(world);
            const steps = [];
            const { update } = world.troll;
            world.troll.update = (dt, want, time) => {
                const events = update(dt, want, time);
                events.forEach((e) => steps.push({ ...e }));
                return events;
            };
            for (let round = 0; round < 2; round++) {
                for (let combo = 1; combo <= 8; combo++) {
                    world.onCombo(combo);
                    run(world, camera, 1.3);
                }
                run(world, camera, 6);
                world.onCombo(0);
                run(world, camera, 18);
            }
            const rang = (e) => rings.some((ring) => ring.x === e.x && ring.z === e.z && ring.time === ring.asked);
            // (The ground at a step is the step's own height: the water lies at 0.)
            const wet = steps.filter((e) => e.y < 0);
            const dry = steps.filter((e) => e.y >= 0.03);
            expect(wet.length, label).toBeGreaterThan(4);
            expect(dry.length, label).toBeGreaterThan(4);
            expect(wet.filter((e) => !rang(e)).length, label).toBe(0);
            expect(dry.filter(rang).length, label).toBe(0);
            // (His feet, and his staff's foot when it stands in the water too.)
            const kinds = new Set(steps.filter(rang).map((e) => e.type));
            expect(kinds.has('footfall'), label).toBe(true);
            expect([...kinds].every((kind) => kind === 'footfall' || kind === 'staff'), label).toBe(true);
            // Every ring of his is born on the water, or at its very edge.
            for (const e of steps.filter(rang)) {
                expect(shoreDistance(e.x / world.squeeze, e.z), label).toBeLessThan(0.1);
            }
            world.dispose();
        }
    });

    it('leaves a soft wake as the spirit drifts out over the water, and touches it while she kneels', async () => {
        const { camera, world } = await makeFiguredWorld('Low');
        const rings = recordRings(world);
        const wakes = [];
        const { ring } = world;
        world.ring = (x, z, time, strength, rgb, reach) => {
            const her = spiritAt(world);
            if (x === her.x && z === her.z) {
                wakes.push({
                    x, z, time, strength,
                });
            }
            return ring(x, z, time, strength, rgb, reach);
        };
        // At rest she drifts out a little way and kneels at the water; there she trails her hand in it.
        run(world, camera, 16);
        expect(world.getState().spiritMode).toBe('kneeling');
        const kneeling = rings.length - wakes.length;
        expect(kneeling).toBeGreaterThanOrEqual(2);
        for (const r of rings) {
            expect(r.edge).toBeLessThan(0);
            expect(r.time).toBe(r.asked);
        }
        // A chain draws her out: a wake behind her, ring after ring, on the water.
        wakes.length = 0;
        world.onCombo(8);
        run(world, camera, 10);
        expect(wakes.length).toBeGreaterThanOrEqual(3);
        for (let i = 1; i < wakes.length; i++) expect(wakes[i].time - wakes[i - 1].time).toBeGreaterThan(0.3);
        for (const w of wakes) expect(world.onWater(w.x, w.z, 0)).toBe(true);
        // Softer than a lock's ring.
        const count = rings.length;
        world.onLock({ u: 0.8 });
        expect(rings[count].strength).toBeGreaterThan(wakes[0].strength);
        // Standing still she leaves none.
        const standing = wakes.length;
        run(world, camera, 6);
        expect(wakes.length).toBe(standing);
        world.dispose();
    });

    it('wakes the wood with the chain and lets it sleep again: eyes, lilies, caps, the heart, the charge', () => {
        const { camera, world } = makeWorld('Low');
        const { u } = world;
        // A night that never has a chain, kept in step with this one frame for frame.
        const calm = makeWorld('Low');
        const step = world.update.bind(world);
        world.update = (sim, cam) => {
            step(sim, cam);
            calm.world.updateCamera(calm.camera, sim);
            calm.world.update(sim, calm.camera);
        };
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
        expect(u.shafts.value).toBeCloseTo(rest.shafts, 2);
        // Their lights burn as they do in a night that never had a chain (at rest they still
        // glance across now and then, and a meeting of eyes warms both: the same moments in both).
        expect(calm.world.time).toBe(world.time);
        expect(u.spiritAt.value.w).toBeCloseTo(calm.world.u.spiritAt.value.w, 2);
        expect(u.lanternAt.value.w).toBeCloseTo(calm.world.u.lanternAt.value.w, 2);
        calm.world.dispose();
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
        expect(world.getState().bond).toBe(chainBond(4));
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
        // The chain is let go; the hour of the night stays.
        run(world, camera, 25, 30);
        expect(world.getState()).toMatchObject({ combo: 0, bond: 0, level: 3 });
        expect(world.hourNow()).toBe(2);
        expect(() => {
            world.resetSession();
            world.resetSession();
        }).not.toThrow();
        world.dispose();
    });

    it('sends the two home for a new run, sooner than a broken chain would', async () => {
        const runs = {};
        for (const how of ['new run', 'broken chain']) {
            // eslint-disable-next-line no-await-in-loop
            const { camera, world } = await makeFiguredWorld('Low');
            world.onCombo(6);
            run(world, camera, 8, 30);
            expect(world.getState().troll, how).toBeGreaterThan(0.5);
            if (how === 'new run') world.resetSession();
            else world.onCombo(0);
            const t0 = world.time;
            let turned = null;
            const out = trollAt(world).clone();
            run(world, camera, 30, 30, () => {
                const moved = Math.hypot(trollAt(world).x - out.x, trollAt(world).z - out.z);
                if (turned === null && moved > 0.05) turned = world.time - t0;
            });
            runs[how] = turned;
            // Home again: he by his stone (and down on it in time), she at rest on her side of the water.
            expect(world.getState().troll, how).toBeLessThan(0.05);
            expect(world.getState().trollMode, how).toBe('seated');
            expect(world.getState().spirit, how).toBeLessThan(0.35);
            expect(['standing', 'kneel', 'kneeling'], how).toContain(world.getState().spiritMode);
            world.dispose();
        }
        expect(runs['new run']).not.toBeNull();
        expect(runs['broken chain']).toBeGreaterThan(PARTING * 0.9);
        expect(runs['new run']).toBeLessThan(runs['broken chain']);
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
        // (A NaN would be written as null; with no figures in, only their modes are none.)
        expect(told.replace(/"(trollMode|spiritMode)":null/g, '')).not.toContain('null');
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

    it('moves the two the same for the same events: two worlds with their figures, frame for frame', async () => {
        const made = [await makeFiguredWorld('Low'), await makeFiguredWorld('Low')];
        let frames = 0;
        let differ = 0;
        let first = null;
        playTogether(made, () => {
            frames += 1;
            const [a, b] = made.map(({ world }) => picture(world, true));
            if (a !== b) {
                differ += 1;
                first ??= frames;
            }
        });
        expect(frames).toBeGreaterThan(300);
        expect({ differ, first }).toEqual({ differ: 0, first: null });
        // It is a picture with them in it, and nothing in it is not a number.
        const told = picture(made[0].world, true);
        expect(told).not.toContain('null');
        expect(posesOf(made[0].world).length).toBeGreaterThan(100);
        expect(made[0].world.getState().troll).toBeGreaterThan(0);
        for (const { world } of made) world.dispose();
    });

    // A seek stands both figures at rest with nothing of what they did before it (found pinned: the
    // troll's walk springs survived a reset).
    it('replays the figures from a seek, whatever they did before it', async () => {
        const first = await makeFiguredWorld('Low');
        const second = await makeFiguredWorld('Low');
        // The second's troll is setting off for the water when it is sought.
        second.world.onCombo(3);
        run(second.world, second.camera, 4.3);
        expect(second.world.troll.body.speed).toBeGreaterThan(0.1);
        for (const { camera, world } of [first, second]) {
            world.seek(10);
            frame(world, camera, 10, 0);
        }
        expect(posesOf(second.world)).toEqual(posesOf(first.world));
        let worst = 0;
        playTogether([first, second], () => {
            const a = posesOf(first.world);
            const b = posesOf(second.world);
            a.forEach((v, k) => {
                worst = Math.max(worst, Math.abs(v - b[k]));
            });
        });
        expect(worst).toBe(0);
        for (const { world } of [first, second]) world.dispose();
    });

    it('drops every event in flight on a seek, and stands the two at home', async () => {
        const { camera, world } = await makeFiguredWorld('Low');
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
            bond: 0,
            path: 0,
            trollMode: 'seated',
            spiritMode: 'standing',
            counts: {
                locks: 0, clears: 0, quads: 0, wisps: 0, gathered: 0,
            },
        });
        const troll = world.troll.figure.position;
        expect([troll.x, troll.z]).toEqual([TROLL.home[0], TROLL.home[2]]);
        expect(troll.y).toBeCloseTo(groundHeight(TROLL.home[0], TROLL.home[2]), 9);
        expect(world.spirit.figure.position.x).toBe(SPIRIT.home[0]);
        expect(world.spirit.figure.position.z).toBe(SPIRIT.home[2]);
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

    it('stills the view under reduced motion, and still answers every event', async () => {
        const { camera, world } = await makeFiguredWorld('Low', { reduced: true });
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
        // (Nor does the troll start at it.)
        let started = 0;
        run(world, camera, 2, 60, () => {
            started = Math.max(started, world.troll.body.startle.x);
        });
        expect(started).toBe(0);
        expect(wispsOf(world)).toHaveLength(1);
        world.onClear({ lines: 4 });
        world.onCombo(5);
        run(world, camera, HUSH_HOLD + 0.1);
        expect(strokesOf(world)).toHaveLength(1);
        expect(world.u.heartAt.value.w).toBeGreaterThan(0.9);
        expect(world.getPostState().prism.strength).toBeGreaterThan(0);
        run(world, camera, 6);
        expect(world.getState().bond).toBe(chainBond(5));
        expect(world.getState().troll).toBeGreaterThan(0.3);
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

    it('reports a state that can be written down: numbers and names, and no one else\'s objects', async () => {
        const { camera, world } = await makeFiguredWorld('High');
        play(world, camera);
        const state = world.getState();
        const text = JSON.stringify(state);
        expect(text).not.toContain('null');
        expect(JSON.parse(text)).toEqual(state);
        expect(state.counts).not.toBe(world.counts);
        expect(state.fed).toHaveLength(2);
        // What the two are doing, by name, and how far the story has them, each in 0..1.
        expect(state).toMatchObject({ trollReady: true, spiritReady: true });
        expect(['seated', 'standing', 'sitDown', 'standUp', 'crouch', 'crouched', 'rise']).toContain(state.trollMode);
        expect(['standing', 'kneel', 'kneeling', 'rise']).toContain(state.spiritMode);
        for (const key of ['bond', 'path', 'gaze', 'troll', 'spirit']) {
            expect(state[key], key).toBeGreaterThanOrEqual(0);
            expect(state[key], key).toBeLessThanOrEqual(1);
        }
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

    /** Play `calls` random calls on a new world, its figures in, and audit every one. @returns {{ faults: string[], stats: object }} */
    async function fuzz(seed, quality, calls = 3000) {
        const rand = mulberry32(seed);
        const pick = (list) => list[Math.floor(rand() * list.length)];
        const { camera, world } = await makeFiguredWorld(quality, { start: Math.floor(rand() * 400) });
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
        const quiet = rings.length;
        for (let i = 0; i < 1200; i++) {
            time += 0.05;
            frame(world, camera, time, 0.05);
            if (i % 10 === 0) audit();
        }
        const { y, z } = world.u.counts.value;
        if (y + z !== 0) fault(`a minute later the tables still hold ${y} strokes, ${z} wisps`);
        const kept = `${world.wisps.length} wisps and ${world.feeds.length} feeds`;
        if (world.wisps.length || world.feeds.length) fault(`a minute later ${kept} are still kept`);
        // The two are at rest: he by his stone and down on it, she kneeling at the water on her side.
        const state = world.getState();
        const places = `${state.trollMode} at ${world.trollS}, ${state.spiritMode} at ${world.spiritS}`;
        if (world.trollS > 0.05 || state.trollMode !== 'seated') fault(`a minute later he is not home: ${places}`);
        const resting = world.spiritS <= 0.35 && state.spiritMode === 'kneeling';
        if (!resting) fault(`a minute later she is not at rest: ${places}`);
        // The only rings still being born are her fingertips', where she kneels.
        const her = spiritAt(world);
        const late = rings.slice(quiet).filter((ring) => ring.asked > time - 20);
        const astray = late.filter((ring) => Math.hypot(ring.x - her.x, ring.z - her.z) > 1);
        if (astray.length) fault(`a minute later ${astray.length} rings are still born away from her`);
        if (late.length > 8) fault(`a minute later ${late.length} rings in twenty seconds`);
        if (world.u.power.value > 1e-6 || world.u.surge.value > 1e-3) fault('a minute later the wood is still charged');
        if (Math.abs(world.u.breath.value - 1) > 1e-6) fault(`a minute later the breath is ${world.u.breath.value}`);
        world.dispose();
        return { faults, stats };
    }

    it.each([[11, 'Low'], [2024, 'Minimal'], [77, 'High']])(
        'keeps every number the shaders read finite and in range through three thousand random calls (seed %i, %s)',
        async (seed, quality) => {
            const { faults, stats } = await fuzz(seed, quality);
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
