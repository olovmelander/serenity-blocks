/**
 * Painted Ages — a whole session of the living world, played at random from a seed (no renderer):
 * ten minutes of theme time at 30 fps with everything a run can send (locks, clears of one to four
 * lines, twists with and without a clear, back-to-back runs, perfect clears, level-ups, game
 * overs and new runs), under the turning hours and airs and the clock's own happenings.
 *
 * Two things must hold whatever the dice say: nothing the materials read is ever non-finite, and
 * nothing is created at event time (the scene holds the same objects after as before).
 */
import { readFileSync } from 'node:fs';
import {
    afterEach, beforeAll, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    PaintedAgesWorld, REST_RIG, fovForAspect,
} from '../../src/themes/painted-ages/painted-ages-world.js';
import {
    FIELDS, FIELD_ORDER, PIECE_COLORS, mulberry32,
} from '../../src/themes/painted-ages/painted-ages-core.js';
import { DEVILS, RIBBONS, WAVES } from '../../src/themes/painted-ages/painted-ages-tsl.js';
import { decodeField } from '../../src/themes/painted-ages/painted-ages-field.js';
import { decodePng } from '../../scripts/painted-ages/png.mjs';

const FRAME = 1 / 30;
const SESSION_SECONDS = 600;
const worlds = [];
const preparedBy = {};
let fields;

beforeAll(() => {
    fields = {};
    for (const name of FIELD_ORDER) {
        const file = new URL(`../../src/themes/painted-ages/assets/badlands-${name}.png`, import.meta.url);
        const { rgba } = decodePng(readFileSync(file));
        fields[name] = { ...decodeField(rgba, FIELDS[name]), size: FIELDS[name].size, source: 'asset' };
    }
    fields.source = 'asset';
});

afterEach(() => {
    worlds.splice(0).forEach((world) => world.dispose());
});

const sim = (time, delta, pointerX = 0, pointerY = 0) => ({
    time, delta, pointerX, pointerY,
});

function makeWorld({
    width = 1600, height = 900, start = 0, quality = 'Low', reduced = false,
} = {}) {
    preparedBy[quality] ||= PaintedAgesWorld.prepareSync(quality, fields);
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new PaintedAgesWorld({
        scene, quality, capture: true, prepared: preparedBy[quality],
    }).build();
    worlds.push(world);
    world.bindCamera(camera);
    world.setViewport(width, height, aspect);
    world.setReducedMotion(reduced);
    world.seek(start);
    world.updateCamera(camera, sim(start, 0));
    world.update(sim(start, 0), camera);
    return { scene, camera, world };
}

/** Every number the materials read: the uniforms, every row of every table, the motes' buffers. */
function everythingRead(world) {
    const out = [];
    for (const [key, node] of Object.entries(world.u)) {
        if (key === 'tables' || !node || !('value' in node)) continue;
        const { value } = node;
        if (typeof value === 'number') out.push([key, value]);
        else if (value?.toArray) value.toArray().forEach((v, i) => out.push([`${key}.${i}`, v]));
    }
    for (const [name, rows] of Object.entries(world.u.tables)) {
        rows.forEach((row, r) => row.toArray().forEach((v, i) => out.push([`tables.${name}[${r}].${i}`, v])));
    }
    return out;
}
function postValues(world) {
    const post = world.getPostState();
    return [
        ['post.exposure', post.exposure], ['post.bloomBoost', post.bloomBoost], ['post.flash', post.flash],
        ['post.saturation', post.saturation], ['post.sun.x', post.sun.x], ['post.sun.y', post.sun.y],
        ['post.sun.onScreen', post.sun.onScreen], ['post.sun.strength', post.sun.strength],
        ...post.shaftColour.map((v, i) => [`post.shaftColour.${i}`, v]),
        ...post.flashColour.map((v, i) => [`post.flashColour.${i}`, v]),
    ];
}
/** The first non-finite entry of a typed array, or −1. */
function firstNonFinite(array) {
    for (let i = 0; i < array.length; i += 1) if (!Number.isFinite(array[i])) return i;
    return -1;
}
/** What stands in the scene: objects, geometries, materials (by identity). */
function census(scene, world) {
    const objects = new Set();
    const geometries = new Set();
    const materials = new Set();
    scene.traverse((object) => {
        objects.add(object);
        if (object.geometry) geometries.add(object.geometry);
        for (const material of [].concat(object.material || [])) materials.add(material);
    });
    return {
        rootChildren: world.root.children.length,
        sceneChildren: scene.children.length,
        objects,
        geometries,
        materials,
        attributes: new Set([...geometries].flatMap((geometry) => Object.values(geometry.attributes))),
        tables: Object.fromEntries(Object.entries(world.u.tables).map(([name, rows]) => [name, rows])),
        tableRows: Object.fromEntries(Object.entries(world.u.tables).map(([name, rows]) => [name, new Set(rows)])),
        moteCount: world.motes.count,
        moteBuffers: [world.motes.start, world.motes.move, world.motes.look, world.motes.kind],
        textures: new Set(Object.values(world.textures)
            .flatMap((t) => (t?.isTexture ? [t] : Object.values(t || {}).filter((inner) => inner?.isTexture)))),
    };
}
const sameSet = (a, b) => a.size === b.size && [...a].every((item) => b.has(item));

/** Uniforms that are shares: 0..1 whatever play and the weather do. */
const SHARES = [
    'sunUp', 'stars', 'moonUp', 'dusk', 'lamps', 'wet', 'paint', 'towerGrow', 'showerPower', 'fresh',
];
/** Linear colours: no channel may go negative. */
const COLOURS = [
    'sun', 'fill', 'bounce', 'zenith', 'horizon', 'glow', 'haze', 'mist', 'cloudLit', 'cloudShade', 'snow', 'moon',
];
/** Factors a shader divides by or scales with: they must stay above nothing. */
const POSITIVE = ['windSpeed', 'hazeDensity', 'mistDensity', 'mistHeight', 'cloudDepth'];

/** What is out of the range its uniform is documented to carry, this frame (cheap: every frame). */
function outOfRange(world) {
    const { u } = world;
    const out = [];
    const within = (name, v, lo, hi) => {
        if (!(v >= lo && v <= hi)) out.push(`${name} = ${v} (not in ${lo}..${hi})`);
    };
    for (const key of SHARES) within(key, u[key].value, 0, 1);
    for (const key of POSITIVE) if (!(u[key].value > 0)) out.push(`${key} = ${u[key].value}`);
    for (const key of COLOURS) {
        const { x, y, z } = u[key].value;
        if (!(x >= 0 && y >= 0 && z >= 0)) out.push(`${key} = ${x}, ${y}, ${z}`);
    }
    within('cloudCover', u.cloudCover.value, 0, 0.92 + 1e-12);
    within('cloudDepth', u.cloudDepth.value, 0, 1);
    within('cirrus', u.cirrus.value, 0, 4);
    within('virga amount', u.virga.value.y, 0, 1);
    within('bow', u.bow.value.x, 0, 1.2);
    within('second bow', u.bow.value.y, 0, 1);
    within('bowLeg', u.bowLeg.value, -1, 1);
    within('meteor', u.meteor.value.w, 0, 1);
    within('sheen', u.sheen.value, 0, 1.6);
    within('veins flare', u.veins.value.x, 0, 1.6);
    within('veins run', u.veins.value.y, 0, 60000);
    within('lamp flare', u.lampRun.value.y, 0, 1);
    within('strataShift', u.strataShift.value, 0, 400);
    within('strataGlow', u.strataGlow.value, 0, 1);
    within('flood', u.flood.value.y, 0, 1);
    within('settle', u.settle.value, 0, 8);
    within('sunDir length', u.sunDir.value.length(), 1 - 1e-6, 1 + 1e-6);
    within('moonDir length', u.moonDir.value.length(), 1 - 1e-6, 1 + 1e-6);
    if (!(u.flicker.value.y >= 0)) out.push(`flicker = ${u.flicker.value.y}`);
    const post = world.getPostState();
    within('post.flash', post.flash, 0, 1);
    within('post.bloomBoost', post.bloomBoost, 0, 1);
    within('post.sun.onScreen', post.sun.onScreen, 0, 1);
    if (!(post.exposure > 0)) out.push(`post.exposure = ${post.exposure}`);
    if (!(post.saturation > 0.5 && post.saturation < 2)) out.push(`post.saturation = ${post.saturation}`);
    if (!(post.sun.strength >= 0)) out.push(`post.sun.strength = ${post.sun.strength}`);
    return out;
}

/**
 * Play `seconds` of a run from the seed, a frame at a time as the theme does (the camera, the
 * events staged since the last frame, the world). `watch(world)` runs after every frame.
 */
function playSession(world, camera, seed, seconds, watch) {
    const random = mulberry32(seed);
    const pick = (n) => Math.floor(random() * n);
    const tally = {
        locks: 0, clears: 0, twists: 0, spins: 0, perfects: 0, levelUps: 0, gameOvers: 0, quads: 0, b2b: 0, chains: 0,
    };
    let nextLock = 0.5;
    let combo = 0;
    let b2b = 0;
    let lines = 0;
    let level = 1;
    let crownAt = Infinity;
    let restUntil = 0;
    const frames = Math.round(seconds / FRAME);
    for (let frame = 1; frame <= frames; frame += 1) {
        const t = world.time + FRAME;
        const s = sim(t, FRAME, Math.sin(t * 0.7), Math.cos(t * 0.31));
        world.updateCamera(camera, s);
        if (t >= crownAt) {
            // A perfect clear settles a moment after its clear, on its own.
            crownAt = Infinity;
            world.onClear({ lines: 4, perfect: true });
            tally.perfects += 1;
        }
        if (t >= nextLock && t >= restUntil) {
            // A quick hand for a while, then a slow one.
            const quick = Math.floor(t / 40) % 2 === 0;
            nextLock = t + (quick ? 0.25 + random() * 0.5 : 0.8 + random() * 1.6);
            const u = random();
            world.onLock({
                u,
                rows: [pick(20)],
                color: PIECE_COLORS[pick(PIECE_COLORS.length)],
                hardDrop: random() < 0.5,
                distance: pick(19),
            });
            tally.locks += 1;
            const roll = random();
            if (roll < (quick ? 0.55 : 0.3)) {
                const cleared = 1 + (random() < 0.25 ? 3 : pick(3));
                const twisted = random() < 0.2;
                const hard = cleared === 4 || twisted;
                combo += 1;
                if (combo >= 2) tally.chains += 1;
                if (hard) b2b = Math.min(4, b2b + 1);
                else b2b = 0;
                if (hard && b2b > 1) tally.b2b += 1;
                world.onB2B(b2b);
                world.onClear({
                    lines: cleared,
                    rowCodes: Array.from({ length: cleared * 10 }, () => pick(8)),
                    combo,
                    cascade: 1 + pick(3),
                    twist: twisted,
                    b2b: hard && b2b > 1,
                    u,
                    color: PIECE_COLORS[pick(PIECE_COLORS.length)],
                });
                world.onCombo(combo);
                tally.clears += 1;
                if (cleared === 4) tally.quads += 1;
                if (twisted) tally.twists += 1;
                if (random() < 0.04) crownAt = t + 0.36;
                lines += cleared;
                if (lines >= level * 6) {
                    level += 1;
                    world.levelUp(level);
                    tally.levelUps += 1;
                }
            } else {
                if (combo) world.onCombo(0);
                combo = 0;
                if (roll > 0.94) {
                    world.onSpin({ u, color: PIECE_COLORS[pick(PIECE_COLORS.length)] });
                    tally.spins += 1;
                } else if (roll > 0.915) {
                    // The run ends; a new one begins after a breath (or at once).
                    world.onGameOver();
                    world.resetSession();
                    tally.gameOvers += 1;
                    combo = 0;
                    b2b = 0;
                    lines = 0;
                    level = 1;
                    crownAt = Infinity;
                    restUntil = t + (random() < 0.5 ? 0 : 3 + random() * 25);
                    if (random() < 0.5) world.onSessionStart();
                }
            }
        }
        world.update(s, camera);
        watch(world, frame);
    }
    return tally;
}

describe.each([
    ['Low', 0x5e55101, false],
    ['Low', 0xbada55, false],
    ['Minimal', 0xc0ffee, false],
    ['Low', 0x7e57, true],
])('Painted Ages: ten minutes of a random session (%s, seed %i, reduced motion %s)', (quality, seed, reduced) => {
    it('keeps everything the materials read finite, and creates nothing at event time', () => {
        const { world, camera, scene } = makeWorld({ quality, reduced });
        const before = census(scene, world);
        const bad = [];
        const bounds = [];
        let lastWind = world.u.wind.value.x;
        const tally = playSession(world, camera, seed, SESSION_SECONDS, (w, frame) => {
            // Every frame: the cheap checks. Every second: every number.
            if (!Number.isFinite(w.u.sunDir.value.x + w.u.wind.value.x + w.u.strataShift.value + w.u.bow.value.x)) {
                if (bad.length < 10) bad.push(`frame ${frame}: the light or the wind is not a number`);
            }
            const at = `at ${w.time.toFixed(2)} s`;
            if (bounds.length < 10) for (const what of outOfRange(w)) bounds.push(`${what} ${at}`);
            if (w.tables.ribbonCount > RIBBONS || w.tables.waveCount > WAVES) bounds.push(`tables over ${at}`);
            if (w.devils.standing(w.time) > DEVILS) bounds.push(`devils over ${at}`);
            // The deck only ever drifts on (a seek aside): its shadows never slide back over the land.
            if (w.u.wind.value.x < lastWind) bounds.push(`the deck drifted back ${at}`);
            lastWind = w.u.wind.value.x;
            if (frame % 30 !== 0 || bad.length >= 10) return;
            for (const [key, v] of [...everythingRead(w), ...postValues(w)]) {
                if (!Number.isFinite(v)) bad.push(`${key} = ${v} at ${w.time.toFixed(2)} s`);
            }
        });
        expect(bad.slice(0, 10)).toEqual([]);
        expect(bounds.slice(0, 10)).toEqual([]);
        // The end of the session, every number once more, and the motes' buffers as they stand.
        for (const [key, v] of [...everythingRead(world), ...postValues(world)]) {
            expect(Number.isFinite(v), key).toBe(true);
        }
        for (const [name, buffer] of Object.entries({
            start: world.motes.start, move: world.motes.move, look: world.motes.look, kind: world.motes.kind,
        })) expect(firstNonFinite(buffer), `motes.${name}`).toBe(-1);
        expect(world.time).toBeCloseTo(SESSION_SECONDS, 6);

        // The dice did send everything (the session means something).
        expect(tally.locks).toBeGreaterThan(300);
        expect(tally.clears).toBeGreaterThan(100);
        for (const key of ['twists', 'spins', 'perfects', 'levelUps', 'gameOvers', 'quads', 'b2b', 'chains']) {
            expect(tally[key], key).toBeGreaterThan(0);
        }
        expect(world.counts.locks).toBe(tally.locks);
        expect(world.counts.gameOvers).toBe(tally.gameOvers);
        expect(world.counts.perfects).toBe(tally.perfects);
        expect(world.counts.twists).toBe(tally.twists + tally.spins);

        // Nothing was created: the same objects, geometries, materials, buffers and table rows.
        const after = census(scene, world);
        expect(after.rootChildren).toBe(before.rootChildren);
        expect(after.sceneChildren).toBe(before.sceneChildren);
        for (const key of ['objects', 'geometries', 'materials', 'attributes', 'textures']) {
            expect(after[key].size, key).toBe(before[key].size);
            expect(sameSet(after[key], before[key]), key).toBe(true);
        }
        for (const name of Object.keys(before.tables)) {
            expect(after.tables[name], name).toBe(before.tables[name]);
            expect(after.tables[name], name).toHaveLength(before.tables[name].length);
            expect(sameSet(after.tableRows[name], before.tableRows[name]), `${name} rows`).toBe(true);
        }
        expect(after.moteCount).toBe(before.moteCount);
        after.moteBuffers.forEach((buffer, i) => expect(buffer, `mote buffer ${i}`).toBe(before.moteBuffers[i]));
    });
});

describe('Painted Ages: a session\'s events one by one create nothing', () => {
    it('adds no object, geometry or material for any single event', () => {
        const { world, camera, scene } = makeWorld({ start: 10 });
        const before = census(scene, world);
        // The census sees what is there, and would see an addition.
        expect(before.rootChildren).toBeGreaterThanOrEqual(Object.keys(world.parts).length);
        expect(before.geometries.size).toBeGreaterThanOrEqual(Object.keys(world.parts).length);
        expect(before.materials.size).toBeGreaterThanOrEqual(Object.keys(world.parts).length);
        expect(before.textures.size).toBeGreaterThan(5);
        const stray = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicNodeMaterial());
        world.root.add(stray);
        const seen = census(scene, world);
        expect(seen.rootChildren).toBe(before.rootChildren + 1);
        for (const key of ['objects', 'geometries', 'materials']) {
            expect(sameSet(seen[key], before[key]), key).toBe(false);
        }
        world.root.remove(stray);
        const events = {
            lock: () => world.onLock({ u: 0.3, rows: [12], color: PIECE_COLORS[1] }),
            'hard drop': () => world.onLock({
                u: 0.7, rows: [18], color: PIECE_COLORS[2], hardDrop: true, distance: 14,
            }),
            quad: () => world.onClear({ lines: 4, rowCodes: Array.from({ length: 40 }, (_, i) => i % 7), combo: 1 }),
            'twist clear': () => world.onClear({
                lines: 2,
                rowCodes: Array.from({ length: 20 }, (_, i) => i % 7),
                combo: 2,
                twist: true,
                u: 0.2,
                color: PIECE_COLORS[2],
            }),
            spin: () => world.onSpin({ u: 0.8, color: PIECE_COLORS[2] }),
            'back-to-back': () => {
                world.onB2B(2);
                world.onClear({
                    lines: 4, rowCodes: Array.from({ length: 40 }, (_, i) => i % 7), combo: 3, b2b: true,
                });
            },
            chain: () => { for (let n = 1; n <= 9; n += 1) world.onCombo(n); },
            'chain break': () => world.onCombo(0),
            perfect: () => world.onClear({ lines: 4, perfect: true }),
            'level-up': () => world.levelUp(world.level + 1),
            'game over': () => world.onGameOver(),
            'new run': () => {
                world.resetSession();
                world.onSessionStart();
            },
        };
        for (const [name, send] of Object.entries(events)) {
            send();
            for (let i = 1; i <= 240; i += 1) {
                const s = sim(world.time + FRAME, FRAME);
                world.updateCamera(camera, s);
                world.update(s, camera);
            }
            const after = census(scene, world);
            expect(after.rootChildren, name).toBe(before.rootChildren);
            for (const key of ['objects', 'geometries', 'materials', 'attributes']) {
                expect(sameSet(after[key], before[key]), `${key} after ${name}`).toBe(true);
            }
        }
    });
});
