/**
 * Voltage Storm — the world's choreography, run without a renderer: a scene, a camera, and the
 * world driven in fixed steps (camera, then events, then the frame, as the theme does).
 *
 * The storm's own lightning is silenced unless a test is about it (`quiet: false`), so what a
 * test counts is what the board asked for. Nothing here pins a gain, a width, a colour or a
 * duration: the look is still being tuned.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    AMBIENT_BEAT, REST_RIG, SURGE_COOL, VOLTAGE_STORM_PARTS, VoltageStormWorld, fovForAspect,
} from '../../src/themes/voltage-storm/voltage-storm-world.js';
import {
    BOLT_RANGES, BOLT_ROWS, DEG, FLASH_SLOTS, HELD_MAX, HELD_TAU, HUSH_HOLD, MAX_CHAIN_ARCS, PALETTE_DRIFT,
    PALETTE_KEYS, PALETTE_REST, RIPPLE_SPEED, STORM, TOWER, TOWER_MAX, VOLTAGE_STORM_PALETTES, heldAt, paletteAt,
    palettePhase, pieceColor, powerForCombo,
} from '../../src/themes/voltage-storm/voltage-storm-core.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/voltage-storm/voltage-storm-quality.js';
import {
    boardFor, boardPoint, cardUnion, fallbackLayout,
} from '../../src/themes/voltage-storm/voltage-storm-composition.js';

vi.setConfig({ testTimeout: 30_000 }); // every test builds a storm or two, on a machine that may be busy

// Every world bakes the same two noise fields (the bakes themselves are pinned in
// voltage-storm-towers.test.js): bake each once for the whole file.
vi.mock('../../src/themes/voltage-storm/voltage-storm-tsl.js', async (importOriginal) => {
    const actual = await importOriginal();
    const baked = new Map();
    const once = (name) => (...args) => {
        const key = `${name}(${args.join()})`;
        if (!baked.has(key)) baked.set(key, actual[name](...args));
        return baked.get(key);
    };
    return { ...actual, bakeNoise: once('bakeNoise'), bakeCloudNoise: once('bakeCloudNoise') };
});

const START = 10;
const PIECES = ['#f5e000', '#b64bff', '#2bff6a', '#ff2a3d', '#1e9bff', '#ff7a1a', '#1ef0ff'];

function makeWorld(quality = 'High', {
    width = 1600, height = 900, live = true, quiet = true, renderer = null,
} = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new VoltageStormWorld({
        scene, quality, capture: true, renderer,
    }).build();
    if (quiet) vi.spyOn(world, 'ambient').mockImplementation(() => {});
    world.bindCamera(camera);
    world.setViewport(width, height, aspect);
    // As the theme does: the live rects, or null when no board is on screen.
    world.setLayout(live ? fallbackLayout(width, height) : null, aspect);
    settle(world, camera, START);
    return { scene, camera, world };
}

/** The capture's recipe: jump the clock, then draw that moment with the simulation frozen. */
function settle(world, camera, time) {
    world.seek(time);
    world.updateCamera(camera, { time, delta: 0 });
    world.update({ time, delta: 0 }, camera);
}

/** Advance the world from its current time by `seconds` in `steps` equal frames. */
function run(world, camera, seconds, steps = Math.max(1, Math.round(seconds * 60))) {
    const t0 = world.time;
    for (let i = 1; i <= steps; i++) {
        const sim = { time: i === steps ? t0 + seconds : t0 + (seconds * i) / steps, delta: seconds / steps };
        world.updateCamera(camera, sim);
        world.update(sim, camera);
    }
}

/** Advance to the moment `time` in frames of about `step` seconds, landing on it exactly. */
function runTo(world, camera, time, step = 1 / 60) {
    const t0 = world.time;
    const steps = Math.max(1, Math.round((time - t0) / step));
    for (let i = 1; i <= steps; i++) {
        const sim = { time: i === steps ? time : t0 + ((time - t0) * i) / steps, delta: (time - t0) / steps };
        world.updateCamera(camera, sim);
        world.update(sim, camera);
    }
}

/** Step one small frame at a time until `done()`; false if `limit` seconds pass first. */
function runUntil(world, camera, done, { step = 1 / 240, limit = 5 } = {}) {
    const stop = world.time + limit;
    while (!done() && world.time < stop) run(world, camera, step, 1);
    return done();
}

/** What every tower holds now. */
const held = (world) => world.towers.map((tower) => heldAt(tower.epoch, world.time));
/** The towers holding anything. */
const holders = (world) => held(world).map((h, i) => (h > 0 ? i : -1)).filter((i) => i >= 0);
/** A tower's finial: where lightning strikes. */
const tip = (tower) => [tower.x, tower.height * TOWER.tip, tower.z];
/** The slots of a kind (counted from the start of its range) that hold a bolt. */
function liveOf(world, kind) {
    const out = [];
    for (let i = 0; i < BOLT_RANGES[kind][1] - BOLT_RANGES[kind][0]; i++) if (world.bolts.isLive(kind, i)) out.push(i);
    return out;
}
/** The bolt table as plain numbers. */
const boltTable = (world) => world.bolts.rows.flatMap((row) => [row.x, row.y, row.z, row.w]);
const numbers = (rows) => rows.flatMap((row) => [row.x, row.y, row.z, row.w]);

/** Every bolt fired from now on, as it was asked for. A reader, newest last. */
function watchBolts(world) {
    const fired = [];
    const fire = world.bolts.fire.bind(world.bolts);
    vi.spyOn(world.bolts, 'fire').mockImplementation((bolt) => {
        fired.push({
            ...bolt, start: [...bolt.start], end: [...bolt.end], rgb: [...bolt.rgb],
        });
        return fire(bolt);
    });
    return (kind) => (kind ? fired.filter((bolt) => bolt.kind === kind) : fired);
}

/** The tower a world point stands on (by its place on the plain), or −1. */
function towerAt(world, point) {
    return world.towers.findIndex((tower) => Math.hypot(tower.x - point[0], tower.z - point[2]) < tower.height * 0.2);
}

/** The rings crossing the water: `{ x, z, time, strength }` of every slot in use. */
function shocks(world) {
    const rows = world.u.tables.shocks;
    const out = [];
    for (let i = 0; i < rows.length; i += 2) {
        if (rows[i].w > 0) {
            out.push({
                x: rows[i].x, z: rows[i].y, time: rows[i].z, strength: rows[i].w,
            });
        }
    }
    return out;
}

/** A world point on screen (fractions, y down). */
function onScreen(point, camera) {
    const p = new THREE.Vector3(point[0], point[1], point[2]).project(camera);
    return { x: p.x * 0.5 + 0.5, y: 0.5 - p.y * 0.5 };
}

const inside = (rect, x, y) => Boolean(rect) && x > rect.x0 && x < rect.x1 && y > rect.y0 && y < rect.y1;
const grown = (rect, pad) => rect && {
    x0: rect.x0 - pad, y0: rect.y0 - pad, x1: rect.x1 + pad, y1: rect.y1 + pad,
};

/**
 * Everything a frame is drawn from, and what the next events will be numbered by: the state, the
 * bolt, tower and shock tables, the sheet lightning, and when each spark was born.
 */
function snapshot(world) {
    const births = world.sparks.geometry.getAttribute('aBirth').array;
    return {
        state: world.getState(),
        bolts: boltTable(world),
        towers: numbers(world.u.tables.towers),
        shocks: numbers(world.u.tables.shocks),
        sheet: world.u.sheet.value.toArray(),
        sparks: Array.from(births).filter((_, i) => i % 4 === 3),
    };
}

/** A second and a half of play: locks either side, a clear, a chain, four lines with a T-spin. */
function play(world, camera) {
    world.onLock({
        u: 0.2, rows: [12], color: PIECES[0], hardDrop: true,
    });
    run(world, camera, 0.4, 48);
    world.onLock({ u: 0.8, rows: [14], color: PIECES[1] });
    world.onClear({ lines: 2, rows: [19, 18] });
    world.onCombo(2);
    run(world, camera, 0.4, 48);
    world.onLock({ u: 0.5, rows: [16], color: PIECES[2] });
    world.onClear({ lines: 4, rows: [19, 18, 17, 16], tspin: true });
    world.onCombo(3);
    run(world, camera, 0.7, 84);
}

/** The largest difference between two lists of numbers. */
function furthest(a, b) {
    let worst = a.length === b.length ? 0 : Infinity;
    for (let i = 0; i < a.length && i < b.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
    return worst;
}

afterEach(async () => {
    vi.restoreAllMocks();
    // Every test here is synchronous: let the runner's own messages through between two of them,
    // or a busy machine can hold them back for longer than the runner will wait.
    await new Promise((resolve) => { setImmediate(resolve); });
});

describe('voltage storm world: build', () => {
    it('builds every tier from node materials, with the whole picture and what the tier asks for', () => {
        const mirrors = VOLTAGE_STORM_PARTS.filter((name) => /mirror/i.test(name));
        expect(mirrors.length).toBeGreaterThan(0);
        for (const quality of QUALITY_NAMES) {
            const { scene, world } = makeWorld(quality);
            const tier = QUALITY[quality];
            const names = Object.keys(world.parts);
            for (const name of names) expect(VOLTAGE_STORM_PARTS, name).toContain(name);
            // Every part on every tier; only the images in the water are a tier's to leave out.
            for (const name of VOLTAGE_STORM_PARTS) {
                expect(names.includes(name), `${quality} ${name}`).toBe(tier.mirror || !mirrors.includes(name));
            }
            let materials = 0;
            scene.traverse((object) => {
                if (!object.material) return;
                materials += 1;
                expect(object.material.isNodeMaterial, object.name).toBe(true);
                expect(object.material.fog, object.name).toBe(false);
            });
            expect(materials).toBe(names.length);
            expect(world.getState()).toMatchObject({
                quality,
                towers: Math.min(TOWER_MAX, tier.towers),
                rain: tier.rain,
                sparks: tier.sparks,
                march: tier.march,
            });
        }
    });

    it('starts at rest: no chain, nothing held, nothing in flight', () => {
        const { world } = makeWorld();
        expect(world.getState()).toMatchObject({
            time: START,
            combo: 0,
            power: 0,
            surge: 0,
            breath: 1,
            twist: 0,
            level: 1,
            palette: VOLTAGE_STORM_PALETTES[0].name,
            counts: {
                locks: 0, clears: 0, quads: 0, arcs: 0, strikes: 0, flickers: 0,
            },
            held: 0,
            heldMax: HELD_MAX,
            bolts: 0,
            chainArcs: 0,
            flashes: 0,
            queued: 0,
        });
        expect(shocks(world)).toHaveLength(0);
        expect(boltTable(world).every((v) => v === 0)).toBe(true);
        expect(world.getPostState()).toMatchObject({
            flash: 0, kick: 0, exposure: 1, streak: 0, bloomBoost: 0,
        });
        expect(world.getPostState().ripple.strength).toBe(0);
    });

    it('stands the hero first and nearest, and tells the shaders where every tower is', () => {
        const { world, camera } = makeWorld('Minimal');
        const { towers } = world;
        expect(towers.length).toBeLessThan(TOWER_MAX);
        towers.forEach((tower, i) => {
            expect(tower.index).toBe(i);
            if (i > 0) expect(tower.dist).toBeGreaterThan(towers[i - 1].dist);
            // On the plain ahead of the lens, on its own side of the picture.
            expect(tower.z).toBeLessThan(0);
            expect(tower.x * tower.side).toBeGreaterThan(0);
            expect(tower.height).toBeGreaterThan(0);
            const place = world.u.tables.towers[i * 3];
            expect([place.x, place.y, place.z, place.w]).toEqual([tower.x, tower.z, tower.height, 1]);
            const mesh = new THREE.Matrix4();
            world.parts.towers.mesh.getMatrixAt(i, mesh);
            const at = new THREE.Vector3().setFromMatrixPosition(mesh);
            expect(at.x).toBeCloseTo(tower.x, 3);
            expect(at.y).toBeCloseTo(0, 6);
            expect(at.z).toBeCloseTo(tower.z, 3);
            expect(mesh.getMaxScaleOnAxis()).toBeCloseTo(tower.height, 3);
        });
        // Rows the tier leaves empty are marked absent.
        for (let i = towers.length; i < TOWER_MAX; i++) expect(world.u.tables.towers[i * 3].w).toBe(0);
        // The hero stands clear of the card, and the post's ripple will start from its finial.
        expect([...world.targets.left, ...world.targets.right]).toContain(0);
        const finial = onScreen(tip(towers[0]), camera);
        expect(world.getState().heart.x).toBeCloseTo(finial.x, 9);
        expect(world.getState().heart.y).toBeCloseTo(finial.y, 9);
        expect(world.u.twist.value.x).toBe(towers[0].x);
    });

    it('has towers to aim at either side of the card, none of them behind it or the HUD', () => {
        for (const [width, height] of [[414, 900], [900, 900], [1600, 900], [2100, 900]]) {
            const { world } = makeWorld('High', { width, height, live: false });
            const label = `${width}x${height}`;
            const card = cardUnion(world.layout);
            const centre = (card.x0 + card.x1) / 2;
            const { left, right } = world.targets;
            expect(left.length, label).toBeGreaterThan(0);
            expect(right.length, label).toBeGreaterThan(0);
            expect(world.getState().targets, label).toEqual({ left: left.length, right: right.length });
            for (const [list, side] of [[left, -1], [right, 1]]) {
                list.forEach((index, i) => {
                    const { sx, sy } = world.towers[index];
                    expect((sx - centre) * side, `${label} tower ${index}`).toBeGreaterThan(0);
                    expect(inside(card, sx, sy), `${label} tower ${index}`).toBe(false);
                    expect(inside(world.layout.hud, sx, sy), `${label} tower ${index}`).toBe(false);
                    expect(sx > 0 && sx < 1 && sy > 0 && sy < 1, `${label} tower ${index}`).toBe(true);
                    // Nearest first.
                    if (i > 0) expect(index).toBeGreaterThan(list[i - 1]);
                });
            }
            // And every tower that stands well clear is one of them.
            world.towers.forEach((tower, index) => {
                const clear = !inside(grown(card, 0.03), tower.sx, tower.sy)
                    && !inside(grown(world.layout.hud, 0.03), tower.sx, tower.sy)
                    && tower.sx > 0.03 && tower.sx < 0.97 && tower.sy > 0.03 && tower.sy < 0.97;
                if (clear) expect([...left, ...right], `${label} tower ${index}`).toContain(index);
            });
        }
    });
});

describe('voltage storm world: a lock', () => {
    it('charges a tower on the piece\'s own side of the card', () => {
        const { world, camera } = makeWorld();
        const sides = { '-1': [...world.targets.left], 1: [...world.targets.right] };
        for (let i = 0; i < 8; i++) {
            const side = i % 2 ? 1 : -1;
            const before = held(world);
            world.onLock({ u: 0.5 + side * (0.1 + i * 0.04), rows: [6 + i], color: PIECES[i % PIECES.length] });
            run(world, camera, 0.5);
            const charged = held(world).map((h, k) => (h > before[k] ? k : -1)).filter((k) => k >= 0);
            expect(charged, `lock ${i}`).toHaveLength(1);
            expect(sides[side], `lock ${i}`).toContain(charged[0]);
        }
        expect(world.getState().counts.locks).toBe(8);
    });

    it('charges it only once the arc has landed, in the piece\'s colour', () => {
        const { world, camera } = makeWorld();
        const fired = watchBolts(world);
        const t0 = world.time;
        world.onLock({ u: 0.2, rows: [6], color: '#ff2a3d' });
        // The frame of the lock: the arc is on its way, the tower still dark.
        expect(world.totalHeld()).toBe(0);
        expect(world.getState().queued).toBeGreaterThan(0);
        expect(world.getState().counts).toMatchObject({ locks: 1, arcs: 1 });
        expect(liveOf(world, 'arc')).toHaveLength(1);
        const [arc] = fired('arc');
        expect(arc.time).toBe(t0);
        expect(arc.rgb).toEqual(pieceColor('#ff2a3d'));

        expect(runUntil(world, camera, () => world.totalHeld() > 0)).toBe(true);
        // Not before its leader was across, and on the first frame after.
        const landed = arc.time + arc.leader;
        expect(world.time).toBeGreaterThanOrEqual(landed);
        expect(world.time - landed).toBeLessThan(1 / 240 + 1e-9);
        const [index] = holders(world);
        const tower = world.towers[index];
        pieceColor('#ff2a3d').forEach((channel, k) => expect(tower.tint[k]).toBeCloseTo(channel, 12));
        // The shaders read the same: the colour, how full the rings are, the pulse that climbs them.
        const rings = world.u.tables.towers[index * 3 + 1];
        const pulse = world.u.tables.towers[index * 3 + 2];
        expect([rings.x, rings.y, rings.z]).toEqual(tower.tint);
        expect(rings.w).toBeGreaterThan(0);
        expect(rings.w).toBeLessThanOrEqual(1);
        // The pulse starts at the moment the arc landed, not at the frame that noticed it.
        expect(pulse.y).toBe(landed);
        expect(pulse.y).toBeLessThanOrEqual(world.time);
        expect(pulse.z).toBeGreaterThan(0);
    });

    it('throws the arc from the card\'s edge, at the piece\'s own height, to the tower\'s electrode', () => {
        const { world, camera } = makeWorld();
        const fired = watchBolts(world);
        const card = cardUnion(world.layout);
        const board = boardFor(world.layout, 0);
        for (const [u, edge] of [[0.2, card.x0], [0.8, card.x1]]) {
            // A row that shows above the horizon, so the ray to it never meets the water.
            world.onLock({ u, rows: [2], color: PIECES[4] });
            const arc = fired('arc').at(-1);
            const from = onScreen(arc.start, camera);
            expect(from.x).toBeCloseTo(edge, 6);
            expect(from.y).toBeCloseTo(boardPoint(board, u, 2).y, 6);
            const tower = world.towers[towerAt(world, arc.end)];
            expect(arc.end[1]).toBeCloseTo(tower.height * TOWER.toroid, 9);
            expect(Math.hypot(arc.end[0] - tower.x, arc.end[2] - tower.z))
                .toBeCloseTo(tower.height * (TOWER.toroidRadius + TOWER.toroidTube), 6);
            run(world, camera, 0.5);
            expect(holders(world)).toContain(tower.index);
        }
        // A piece on the floor of the board is below the horizon: its arc still starts over the water.
        world.onLock({ u: 0.2, rows: [19], color: PIECES[4] });
        expect(fired('arc').at(-1).start[1]).toBeGreaterThan(0);
        expect(onScreen(fired('arc').at(-1).start, camera).x).toBeCloseTo(card.x0, 6);
    });

    it('throws from a screen point when it is given one, to that side', () => {
        const { world, camera } = makeWorld();
        const fired = watchBolts(world);
        for (const [x, list] of [[0.85, world.targets.right], [0.1, world.targets.left]]) {
            const before = held(world);
            // The board column says the other side: the point wins.
            world.onLock({ u: x > 0.5 ? 0.1 : 0.9, screen: { x, y: 0.2 }, color: PIECES[6] });
            const from = onScreen(fired('arc').at(-1).start, camera);
            expect(from.x).toBeCloseTo(x, 6);
            expect(from.y).toBeCloseTo(0.2, 6);
            run(world, camera, 0.5);
            const charged = held(world).findIndex((h, k) => h > before[k]);
            expect(list).toContain(charged);
        }
    });

    it('throws a hard drop harder: more charge, a second arc, a ring on the water, a kick', () => {
        const soft = makeWorld();
        const hard = makeWorld();
        const softBolts = watchBolts(soft.world);
        const hardBolts = watchBolts(hard.world);
        soft.world.onLock({ u: 0.2, rows: [8], color: PIECES[5] });
        hard.world.onLock({
            u: 0.2, rows: [8], color: PIECES[5], hardDrop: true,
        });
        run(soft.world, soft.camera, 1 / 120, 1);
        run(hard.world, hard.camera, 1 / 120, 1);
        expect(hard.world.getPostState().kick).toBeGreaterThan(soft.world.getPostState().kick);
        expect(softBolts('arc')).toHaveLength(1);
        expect(hardBolts('arc')).toHaveLength(2);
        expect(hardBolts('arc')[0].power).toBeGreaterThan(softBolts('arc')[0].power);
        // The second arc goes to another tower on the same side.
        const [first, second] = hardBolts('arc').map((arc) => towerAt(hard.world, arc.end));
        expect(second).not.toBe(first);
        expect(hard.world.targets.left).toEqual(expect.arrayContaining([first, second]));

        run(soft.world, soft.camera, 0.5);
        run(hard.world, hard.camera, 0.5);
        expect(hard.world.totalHeld()).toBeGreaterThan(soft.world.totalHeld());
        expect(holders(hard.world).sort()).toEqual([first, second].sort());
        expect(held(hard.world)[first]).toBeGreaterThan(held(soft.world)[holders(soft.world)[0]]);
        expect(held(hard.world)[first]).toBeGreaterThan(held(hard.world)[second]);
        // A ring leaves the foot of the tower the heavy arc hit, when it lands: the strongest ring
        // either lock makes.
        const under = hard.world.towers[first];
        const rings = shocks(hard.world);
        const ring = rings.find((shock) => shock.x === under.x && shock.z === under.z);
        expect(ring).toBeDefined();
        expect(ring.time).toBeGreaterThan(START);
        expect(ring.time).toBeLessThan(START + 0.5);
        for (const other of [...shocks(soft.world), ...rings.filter((shock) => shock !== ring)]) {
            expect(other.strength).toBeLessThan(ring.strength);
        }
    });

    it('never fills a tower past HELD_MAX', () => {
        const { world, camera } = makeWorld();
        for (let i = 0; i < 30; i++) {
            world.onLock({
                u: 0.1, rows: [10], color: PIECES[i % PIECES.length], hardDrop: true,
            });
            run(world, camera, 0.2, 6);
            for (const h of held(world)) expect(h).toBeLessThanOrEqual(HELD_MAX + 1e-9);
        }
        // It did come to the brim, and the rings show no more than full.
        expect(Math.max(...held(world))).toBeGreaterThan(HELD_MAX * 0.9);
        world.towers.forEach((tower, i) => expect(world.u.tables.towers[i * 3 + 1].w).toBeLessThanOrEqual(1));
        expect(world.getState().held).toBeLessThanOrEqual(HELD_MAX * world.towers.length);
    });

    it('mixes a second piece\'s colour into what a tower holds, and lets the charge fade', () => {
        const { world, camera } = makeWorld();
        world.charge(3, [1, 0.1, 0.1], 0.5);
        [1, 0.1, 0.1].forEach((channel, k) => expect(world.towers[3].tint[k]).toBeCloseTo(channel, 12));
        world.charge(3, [0.1, 0.1, 1], 0.5);
        const [r, g, b] = world.towers[3].tint;
        expect(r).toBeGreaterThan(0.1);
        expect(r).toBeLessThan(1);
        expect(b).toBeGreaterThan(0.1);
        expect(b).toBeLessThan(1);
        expect(g).toBeCloseTo(0.1, 12);
        expect(held(world)[3]).toBeCloseTo(1, 9);
        // Nothing is written per frame: it fades by itself, to 1/e in HELD_TAU.
        run(world, camera, HELD_TAU, 200);
        expect(held(world)[3]).toBeCloseTo(1 / Math.E, 9);
        expect(holders(world)).toEqual([3]);
        // A tower the world does not have is no one to charge.
        expect(() => world.charge(99, [1, 1, 1], 1)).not.toThrow();
        expect(holders(world)).toEqual([3]);
    });

    it('takes a lock with nothing in it, and turns a centred piece to either side in turn', () => {
        const { world, camera } = makeWorld();
        expect(() => {
            world.onLock();
            world.onLock({});
        }).not.toThrow();
        run(world, camera, 0.5);
        // Two locks down the middle of the board: one tower either side.
        const [a, b] = holders(world);
        expect(holders(world)).toHaveLength(2);
        expect(world.targets.left.includes(a)).not.toBe(world.targets.left.includes(b));
        expect(boltTable(world).every((v) => Number.isFinite(v))).toBe(true);
        expect(world.getState().counts.locks).toBe(2);
    });
});

describe('voltage storm world: a clear', () => {
    const bottom = (n) => Array.from({ length: n }, (_, i) => 19 - i);

    it('answers n lines with n strikes on n towers, and discharges each cleared row from the card', () => {
        for (const n of [1, 2, 3]) {
            const { world, camera } = makeWorld();
            const fired = watchBolts(world);
            world.onClear({ lines: n, rows: bottom(n) });
            expect(world.getState().counts).toMatchObject({
                clears: 1, quads: 0, strikes: n, arcs: n,
            });
            const strikes = fired('strike');
            expect(strikes).toHaveLength(n);
            // Each comes down from the cloud onto a different tower's finial.
            const struck = strikes.map((bolt) => towerAt(world, bolt.end));
            expect(new Set(struck).size).toBe(n);
            strikes.forEach((bolt, i) => {
                expect(bolt.end).toEqual(tip(world.towers[struck[i]]));
                expect(bolt.start[1]).toBeGreaterThan(bolt.end[1]);
                expect(bolt.time).toBeGreaterThan(START);
                if (i > 0) expect(bolt.time).toBeGreaterThan(strikes[i - 1].time);
            });
            // Nothing held: the nearest towers take them.
            expect(struck).toEqual(bottom(n).map((_, i) => i));
            // The rows' own arcs leave both edges of the card and charge nothing.
            const card = cardUnion(world.layout);
            const edges = fired('arc').map((arc) => onScreen(arc.start, camera).x);
            for (const x of edges) expect(Math.min(Math.abs(x - card.x0), Math.abs(x - card.x1))).toBeLessThan(1e-6);
            if (n > 1) expect(new Set(edges.map((x) => x.toFixed(4))).size).toBe(2);
            run(world, camera, 1.5);
            expect(world.totalHeld()).toBe(0);
            expect(world.getState().queued).toBe(0);
        }
    });

    it('strikes the towers holding the most, and each lets go when its leader connects, not before', () => {
        const { world, camera } = makeWorld();
        const fired = watchBolts(world);
        const charges = [[5, 1.3], [2, 1.0], [7, 0.7], [0, 0.4]];
        for (const [index, amount] of charges) world.charge(index, pieceColor(PIECES[index % 7]), amount);
        world.onClear({ lines: 2 });
        const strikes = fired('strike');
        expect(strikes.map((bolt) => towerAt(world, bolt.end))).toEqual([5, 2]);
        const emptied = {};
        runUntil(world, camera, () => {
            for (const index of [5, 2]) {
                if (emptied[index] === undefined && held(world)[index] === 0) emptied[index] = world.time;
            }
            return emptied[5] !== undefined && emptied[2] !== undefined;
        });
        strikes.forEach((bolt, i) => {
            const connects = bolt.time + bolt.leader;
            const at = emptied[[5, 2][i]];
            expect(at).toBeGreaterThanOrEqual(connects);
            expect(at - connects).toBeLessThan(1 / 240 + 1e-9);
        });
        // The others keep what they hold.
        run(world, camera, 1);
        expect(holders(world)).toEqual([0, 7]);
    });

    it('turns a struck tower white, throws what it held as sparks of its colour and rings the water', () => {
        const { world, camera } = makeWorld();
        const fired = watchBolts(world);
        const colour = pieceColor('#2bff6a');
        world.charge(1, colour, 1);
        run(world, camera, 0.2);
        const births = world.sparks.geometry.getAttribute('aBirth').array;
        const tints = world.sparks.geometry.getAttribute('aTint').array;
        world.onClear({ lines: 1 });
        const tower = world.towers[1];
        const [bolt] = fired('strike');
        expect(bolt.end).toEqual(tip(tower));
        // The moment its leader connects: what follows is dated from then, whatever frame notices.
        const connected = bolt.time + bolt.leader;
        let before = tower.strike;
        expect(runUntil(world, camera, () => {
            if (held(world)[1] > 0) before = tower.strike;
            return held(world)[1] === 0;
        })).toBe(true);
        expect(world.time).toBeGreaterThanOrEqual(connected);
        expect(world.time - connected).toBeLessThan(1 / 240 + 1e-9);
        // Whiter than anything an arc landing on it had left.
        expect(tower.strike).toBeGreaterThan(before);
        expect(tower.strike).toBeGreaterThan(0);
        expect(world.u.tables.towers[1 * 3 + 2].x).toBe(tower.strike);
        expect(world.getPostState().kick).toBeGreaterThan(0);
        // Sparks from the electrode, in the colour the tower kept (the buffer holds single floats).
        const thrown = [];
        for (let i = 0; i < births.length; i += 4) if (births[i + 3] >= connected - 1e-4) thrown.push(i);
        expect(thrown.length).toBeGreaterThan(0);
        for (const i of thrown) {
            expect(births[i]).toBeCloseTo(tower.x, 3);
            expect(births[i + 2]).toBeCloseTo(tower.z, 3);
            expect(births[i + 1]).toBeGreaterThan(tower.height * TOWER.mast);
            expect(tints[i] / tints[i + 1]).toBeCloseTo(colour[0] / colour[1], 4);
            expect(tints[i + 2] / tints[i + 1]).toBeCloseTo(colour[2] / colour[1], 4);
        }
        const ring = shocks(world).find((shock) => shock.time === connected);
        expect(ring).toMatchObject({ x: tower.x, z: tower.z });
        // The strike's ring is the strongest on the water.
        for (const other of shocks(world)) expect(other.strength).toBeLessThanOrEqual(ring.strength);
        // The white fades; the tower is left dark.
        const peak = tower.strike;
        run(world, camera, 3);
        expect(tower.strike).toBeLessThan(peak * 0.01);
        expect(held(world)[1]).toBe(0);
    });

    it('reads a silly line count as a number of lines between one and four', () => {
        const { world } = makeWorld();
        for (const [lines, strikes] of [[0, 1], [-3, 1], [2.4, 2], ['3', 3], [NaN, 1], [undefined, 1], [null, 1]]) {
            world.resetSession();
            world.onClear({ lines });
            expect(world.getState().counts, String(lines)).toMatchObject({ clears: 1, quads: 0, strikes });
        }
        world.resetSession();
        world.onClear({ lines: 99 });
        expect(world.getState().counts.quads).toBe(1);
        world.resetSession();
        expect(() => world.onClear()).not.toThrow();
        expect(world.getState().counts).toMatchObject({ clears: 1, strikes: 1 });
    });
});

describe('voltage storm world: four lines', () => {
    it('counts the quad at once and holds its breath: every light sinks, the storm\'s clock stops', () => {
        const { world, camera } = makeWorld();
        const { time: t0, stormClock } = world;
        const rainClock = world.u.rainClock.value;
        world.onClear({ lines: 4 });
        expect(world.getState().counts).toMatchObject({ clears: 1, quads: 1 });
        let previous = world.breath;
        const step = 1 / 240;
        while (world.time + step < t0 + HUSH_HOLD) {
            run(world, camera, step, 1);
            expect(world.breath).toBeLessThanOrEqual(previous);
            expect(world.surge).toBe(0);
            expect(world.getPostState().ripple.strength).toBe(0);
            expect(world.u.sheet.value.w).toBe(0);
            previous = world.breath;
        }
        expect(world.breath).toBeLessThan(0.9);
        expect(world.u.breath.value).toBe(world.breath);
        expect(world.stormClock).toBe(stormClock);
        // The rain hangs.
        expect(world.u.rainClock.value - rainClock).toBeLessThan((world.time - t0) * 0.5);
        // And it breathes again.
        run(world, camera, 3);
        expect(world.breath).toBeGreaterThan(0.99);
        expect(world.stormClock).toBeGreaterThan(stormClock);
    });

    it('strikes the hero with a superbolt as the hush ends, then the nearest others in turn', () => {
        const { world, camera } = makeWorld();
        const fired = watchBolts(world);
        // What the far towers hold does not bring the superbolt to them.
        world.charge(3, pieceColor(PIECES[0]), 1.2);
        world.charge(7, pieceColor(PIECES[1]), 1.5);
        world.charge(0, pieceColor(PIECES[2]), 0.3);
        const t0 = world.time;
        world.onClear({ lines: 4 });
        const [superbolt, ...others] = fired('strike');
        expect(superbolt.time).toBeCloseTo(t0 + HUSH_HOLD, 12);
        expect(superbolt.end).toEqual(tip(world.towers[0]));
        // The nearest four others, the one holding the most first, each after the one before.
        const struck = others.map((bolt) => towerAt(world, bolt.end));
        expect([...struck].sort()).toEqual([1, 2, 3, 4]);
        expect(struck[0]).toBe(3);
        others.forEach((bolt, i) => {
            expect(bolt.end).toEqual(tip(world.towers[struck[i]]));
            expect(bolt.time).toBeGreaterThan(i > 0 ? others[i - 1].time : superbolt.time);
            expect(bolt.power).toBeLessThan(superbolt.power);
            expect(bolt.strokes).toBeLessThanOrEqual(superbolt.strokes);
            expect(bolt.width).toBeLessThan(superbolt.width);
        });
        expect(world.getState().counts.strikes).toBe(5);
        // Nothing lets go before the hush is over; then every struck tower does.
        run(world, camera, HUSH_HOLD * 0.9);
        expect(holders(world)).toEqual([0, 3, 7]);
        run(world, camera, 2);
        expect(holders(world)).toEqual([7]);
    });

    it('lets go only when the superbolt connects: the surge, the sheet lightning, the ripple', () => {
        const { world, camera } = makeWorld();
        const fired = watchBolts(world);
        const t0 = world.time;
        world.onClear({ lines: 4 });
        const [superbolt] = fired('strike');
        // The moment the superbolt's leader connects: everything it sets off is dated from then.
        const connected = superbolt.time + superbolt.leader;
        expect(connected).toBeGreaterThanOrEqual(t0 + HUSH_HOLD);
        expect(runUntil(world, camera, () => world.surge > 0)).toBe(true);
        expect(world.time).toBeGreaterThanOrEqual(connected);
        expect(world.time - connected).toBeLessThan(1 / 240 + 1e-9);
        // Sheet lightning runs out through the cloud from over the hero.
        const sheet = world.u.sheet.value;
        expect(sheet.w).toBeGreaterThan(0);
        expect(sheet.z).toBe(connected);
        expect(Math.hypot(sheet.x - world.towers[0].x, sheet.y - world.towers[0].z)).toBeLessThan(world.towers[0].dist);
        expect(world.u.surge.value).toBe(world.surge);
        // The picture ripples out from the hero's finial: from nothing at that moment, wider every frame.
        const post = world.getPostState();
        const finial = onScreen(tip(world.towers[0]), camera);
        expect(post.ripple.x).toBeCloseTo(finial.x, 2);
        expect(post.ripple.y).toBeCloseTo(finial.y, 2);
        expect(post.ripple.radius).toBeCloseTo((world.time - connected) * RIPPLE_SPEED, 12);
        let wide = post.ripple.radius;
        let strongest = 0;
        for (let i = 0; i < 60; i++) {
            run(world, camera, 1 / 60, 1);
            expect(post.ripple.radius).toBeGreaterThan(wide);
            wide = post.ripple.radius;
            strongest = Math.max(strongest, post.ripple.strength);
        }
        expect(strongest).toBeGreaterThan(0);
        // The overdrive cools to 1/e in SURGE_COOL, and the ripple dies away.
        const { surge } = world;
        expect(post.bloomBoost).toBeGreaterThan(0);
        expect(post.exposure).toBeLessThan(1);
        run(world, camera, SURGE_COOL, 240);
        expect(world.surge).toBeCloseTo(surge / Math.E, 9);
        run(world, camera, SURGE_COOL * 2, 240);
        expect(post.ripple.strength).toBeLessThan(strongest * 0.01);
    });

    it('treats a perfect clear as four lines, and no weaker', () => {
        const four = makeWorld();
        const perfect = makeWorld();
        const fourBolts = watchBolts(four.world);
        const perfectBolts = watchBolts(perfect.world);
        four.world.onClear({ lines: 4 });
        perfect.world.onClear({ lines: 1, perfect: true });
        expect(perfect.world.getState().counts).toMatchObject({ clears: 1, quads: 1, strikes: 5 });
        const [superbolt] = perfectBolts('strike');
        expect(superbolt.time).toBeCloseTo(START + HUSH_HOLD, 12);
        expect(superbolt.end).toEqual(tip(perfect.world.towers[0]));
        expect(superbolt.power).toBeGreaterThanOrEqual(fourBolts('strike')[0].power);
        const followers = (bolts) => bolts('strike').slice(1).map((bolt) => bolt.time);
        expect(followers(perfectBolts)).toEqual(followers(fourBolts));
        expect(runUntil(perfect.world, perfect.camera, () => perfect.world.surge > 0)).toBe(true);
        expect(perfect.world.time).toBeGreaterThanOrEqual(START + HUSH_HOLD);
    });
});

describe('voltage storm world: a T-spin', () => {
    it('winds the cloud up over the hero, lets it spring back to rest, and sends an arc up the mast', () => {
        const plain = makeWorld();
        plain.world.onClear({ lines: 2 });
        run(plain.world, plain.camera, 1);
        expect(plain.world.twist).toBe(0);
        expect(plain.world.u.twist.value.z).toBe(0);

        const { world, camera } = makeWorld();
        const fired = watchBolts(world);
        const hero = world.towers[0];
        world.onClear({ lines: 2, tspin: true });
        let peak = 0;
        let shown = 0;
        for (let i = 0; i < 120; i++) {
            run(world, camera, 1 / 60, 1);
            peak = Math.max(peak, Math.abs(world.twist));
            shown = Math.max(shown, Math.abs(world.u.twist.value.z));
            expect(Math.sign(world.u.twist.value.z)).toBe(Math.sign(world.twist));
        }
        expect(peak).toBeGreaterThan(0);
        expect(shown).toBeGreaterThan(0);
        run(world, camera, 20);
        expect(Math.abs(world.twist)).toBeLessThan(peak * 0.01);
        expect(world.getState().twist).toBe(world.twist);
        // The arc: from the water at the tower's foot up to its electrode.
        const climbing = fired('arc').filter((arc) => arc.start[0] === hero.x && arc.start[2] === hero.z);
        expect(climbing).toHaveLength(1);
        expect(climbing[0].end).toEqual([hero.x, hero.height * TOWER.toroid, hero.z]);
        expect(climbing[0].start[1]).toBeLessThan(hero.height * TOWER.ringLo);
        expect(climbing[0].start[1]).toBeGreaterThanOrEqual(0);
        // And the clear is still answered.
        expect(world.getState().counts).toMatchObject({ clears: 1, strikes: 2 });
    });
});

describe('voltage storm world: a chain', () => {
    it('holds an arc between two tower tips for every step of the chain past the first', () => {
        const { world, camera } = makeWorld();
        for (const combo of [0, 1, 2, 3, MAX_CHAIN_ARCS + 1, MAX_CHAIN_ARCS + 7]) {
            world.onCombo(combo);
            run(world, camera, 0.1);
            const want = Math.min(MAX_CHAIN_ARCS, Math.max(0, combo - 1));
            expect(liveOf(world, 'chain'), `combo ${combo}`).toHaveLength(want);
            expect(world.getState(), `combo ${combo}`).toMatchObject({ combo, chainArcs: want });
        }
        const pairs = liveOf(world, 'chain').map((i) => {
            const base = (BOLT_RANGES.chain[0] + i) * BOLT_ROWS;
            const ends = [world.bolts.rows[base], world.bolts.rows[base + 1]].map((row) => {
                const index = towerAt(world, [row.x, row.y, row.z]);
                expect([row.x, row.y, row.z]).toEqual(tip(world.towers[index]));
                return index;
            });
            expect(ends[0]).not.toBe(ends[1]);
            return ends.sort().join('-');
        });
        // Five arcs, five pairs.
        expect(new Set(pairs).size).toBe(pairs.length);
    });

    it('raises each standing arc once, not on every frame', () => {
        const { world, camera } = makeWorld();
        const fired = watchBolts(world);
        world.onCombo(4);
        run(world, camera, 3);
        expect(fired('chain')).toHaveLength(3);
        for (const arc of fired('chain')) expect(arc.held).toBe(true);
        // A longer chain adds arcs; it does not raise the standing ones again.
        world.onCombo(5);
        run(world, camera, 1);
        expect(fired('chain')).toHaveLength(4);
        expect(new Set(fired('chain').map((arc) => arc.index)).size).toBe(4);
    });

    it('lets the arcs go when the chain breaks: they die out, and the storm lets its breath go', () => {
        const { world, camera } = makeWorld();
        const fired = watchBolts(world);
        world.onCombo(5);
        run(world, camera, 1);
        expect(liveOf(world, 'chain')).toHaveLength(4);
        world.onCombo(0);
        let lowest = 1;
        const t0 = world.time;
        expect(runUntil(world, camera, () => {
            lowest = Math.min(lowest, world.breath);
            return liveOf(world, 'chain').length === 0;
        }, { step: 1 / 60 })).toBe(true);
        expect(world.time).toBeGreaterThan(t0);
        expect(world.getState()).toMatchObject({ combo: 0, chainArcs: 0 });
        expect(lowest).toBeLessThan(1);
        run(world, camera, 3);
        expect(world.breath).toBeGreaterThan(0.99);
        expect(liveOf(world, 'chain')).toHaveLength(0);
        expect(fired('chain')).toHaveLength(4);
    });

    it('stands as many arcs as it says it holds, on every tier', () => {
        for (const quality of QUALITY_NAMES) {
            const { world, camera } = makeWorld(quality);
            world.onCombo(MAX_CHAIN_ARCS + 7);
            run(world, camera, 0.2);
            expect(world.getState().chainArcs, quality).toBeGreaterThan(0);
            expect(liveOf(world, 'chain').length, quality).toBe(world.getState().chainArcs);
        }
    });

    it('charges with the combo and runs down when it breaks, the same at any frame rate', () => {
        const { world, camera } = makeWorld();
        world.onCombo(4);
        const target = powerForCombo(4);
        let previous = 0;
        for (let i = 0; i < 60; i++) {
            run(world, camera, 1 / 60, 1);
            expect(world.power).toBeGreaterThan(previous);
            expect(world.power).toBeLessThan(target);
            previous = world.power;
        }
        expect(world.u.power.value).toBe(world.power);
        const slow = makeWorld();
        slow.world.onCombo(4);
        run(slow.world, slow.camera, 1, 12);
        expect(slow.world.power).toBeCloseTo(world.power, 9);
        run(world, camera, 30, 600);
        expect(world.power).toBeCloseTo(target, 4);
        // A longer chain charges it further; a broken one lets it run down (it does not drop).
        world.onCombo(9);
        run(world, camera, 30, 600);
        expect(world.power).toBeCloseTo(powerForCombo(9), 4);
        world.onCombo(0);
        run(world, camera, 1 / 60, 1);
        expect(world.power).toBeLessThan(powerForCombo(9));
        expect(world.power).toBeGreaterThan(powerForCombo(9) * 0.5);
        run(world, camera, 60, 600);
        expect(world.power).toBeLessThan(powerForCombo(9) * 0.01);
    });

    it('answers each new step from the cloud, and reads a silly combo as a whole number', () => {
        const { world } = makeWorld();
        const flickers = () => world.getState().counts.flickers;
        const steps = [[1, 0], [2, 1], [2, 1], [3, 2], [5, 3], [4, 3], [0, 3], [2, 4]];
        for (const [combo, expected] of steps) {
            world.onCombo(combo);
            expect(flickers(), `combo ${combo}`).toBe(expected);
        }
        for (const [combo, read] of [[NaN, 0], [-3, 0], ['4', 4], [2.6, 3], [undefined, 0], [null, 0]]) {
            world.onCombo(combo);
            expect(world.getState().combo, String(combo)).toBe(read);
        }
    });
});

describe('voltage storm world: levels', () => {
    /** How far the storm's live colours are from a palette (the largest channel difference). */
    const awayFrom = (world, palette) => Math.max(...PALETTE_KEYS.map((key) => (
        // The horizon is lifted by the chain's charge; at rest it is the palette's own.
        furthest(world.u[key].value.toArray(), palette[key])
    )));

    it('steps one palette on for a new level, through the mix between the two, or snaps when told to be silent', () => {
        const { world, camera } = makeWorld();
        // At the very start of a run: the clock leaves the light alone for the next ten seconds.
        settle(world, camera, 1);
        const n = VOLTAGE_STORM_PALETTES.length;
        for (let level = 1; level <= n * 2 + 1; level++) {
            world.levelUp(level, { silent: true });
            const palette = VOLTAGE_STORM_PALETTES[(level - 1) % n];
            expect(world.getState()).toMatchObject({ level, palette: palette.name });
        }
        for (const [level, read] of [[0, 1], [-4, 1], [NaN, 1], [undefined, 1], ['3', 3], [2.4, 2], [1, 1]]) {
            world.levelUp(level, { silent: true });
            expect(world.getState().level, String(level)).toBe(read);
        }
        world.update({ time: world.time, delta: 0 }, camera);

        // Early in the run the clock has not yet carried the light off the first palette.
        const [from, to] = VOLTAGE_STORM_PALETTES;
        expect(world.time / PALETTE_DRIFT).toBeLessThan(PALETTE_REST);
        expect(awayFrom(world, from)).toBeCloseTo(0, 12);
        const fired = watchBolts(world);
        world.levelUp(2);
        // Where it is heading is known at once; the colours have not moved yet.
        expect(world.getState().palette).toBe(to.name);
        expect(world.getState().counts.flickers).toBeGreaterThan(0);
        // The cloud answers in the light that is coming.
        const coming = paletteAt(palettePhase(2, world.time));
        for (const bolt of fired('crawler')) expect(bolt.rgb).toEqual(coming.flash);
        // On the way every colour lies between the old palette's and the new one's.
        let moved = false;
        for (let i = 0; i < 150; i++) {
            run(world, camera, 1 / 30, 1);
            PALETTE_KEYS.forEach((key) => {
                if (key === 'horizon') return;
                world.u[key].value.toArray().forEach((channel, c) => {
                    const lo = Math.min(from[key][c], to[key][c]) - 1e-9;
                    const hi = Math.max(from[key][c], to[key][c]) + 1e-9;
                    expect(channel, `${key}[${c}] at frame ${i}`).toBeGreaterThanOrEqual(lo);
                    expect(channel, `${key}[${c}] at frame ${i}`).toBeLessThanOrEqual(hi);
                });
            });
            if (awayFrom(world, from) > 0.01) moved = true;
        }
        expect(moved).toBe(true);
        // Nine seconds on it has arrived: where the level and the clock put it.
        run(world, camera, 4);
        expect(world.time / PALETTE_DRIFT).toBeLessThan(PALETTE_REST);
        expect(awayFrom(world, paletteAt(palettePhase(2, world.time)))).toBeLessThan(1e-3);
        expect(world.wheelPlace).toBeCloseTo(1, 2);

        const { flickers } = world.getState().counts;
        world.levelUp(4, { silent: true });
        world.update({ time: world.time, delta: 0 }, camera);
        expect(awayFrom(world, paletteAt(palettePhase(4, world.time)))).toBeCloseTo(0, 12);
        expect(world.getState().counts.flickers).toBe(flickers);
    });

    it('goes the short way round the wheel when a run ends on a high level', () => {
        const { world, camera } = makeWorld();
        const n = VOLTAGE_STORM_PALETTES.length;
        world.levelUp(n, { silent: true }); // the last palette: one step short of the first again
        world.update({ time: world.time, delta: 0 }, camera);
        expect(world.wheelPlace).toBe(n - 1);
        world.resetSession();
        const seen = new Set();
        for (let i = 0; i < 480; i++) {
            run(world, camera, 1 / 30, 1);
            seen.add(Math.floor(world.wheelPlace));
        }
        // Forward through the seam (last → first), never back through the three in between.
        expect([...seen].sort()).toEqual([0, n - 1]);
        expect(world.wheelPlace).toBe(0);
    });
});

describe('voltage storm world: the light drifts by itself', () => {
    const coloursOf = (world) => PALETTE_KEYS.filter((key) => key !== 'horizon')
        .flatMap((key) => world.u[key].value.toArray());
    const paletteNumbers = (palette) => PALETTE_KEYS.filter((key) => key !== 'horizon').flatMap((key) => palette[key]);

    it('rests on a palette, then mixes into the next as the clock runs, with no level reached', () => {
        const { world, camera } = makeWorld();
        const [first, second, third] = VOLTAGE_STORM_PALETTES;
        // Resting on the first palette at the start of a run.
        settle(world, camera, PALETTE_DRIFT * PALETTE_REST * 0.5);
        expect(coloursOf(world)).toEqual(paletteNumbers(first));
        expect(world.getState()).toMatchObject({ level: 1, palette: first.name, paletteMix: 0 });
        // Half a step on: an even mix of the first two.
        settle(world, camera, PALETTE_DRIFT * 0.5);
        const half = coloursOf(world);
        paletteNumbers(first).forEach((v, i) => expect(half[i]).toBeCloseTo((v + paletteNumbers(second)[i]) / 2, 9));
        expect(world.getState().paletteMix).toBeCloseTo(0.5, 9);
        expect(world.getState().paletteNext).toBe(second.name);
        // A whole step on: the second palette, with the level still 1.
        settle(world, camera, PALETTE_DRIFT * (1 + PALETTE_REST * 0.5));
        expect(coloursOf(world)).toEqual(paletteNumbers(second));
        expect(world.getState()).toMatchObject({ level: 1, palette: second.name });
        // Two steps on, the third; and the wheel comes round to the first again.
        settle(world, camera, PALETTE_DRIFT * 2.05);
        expect(coloursOf(world)).toEqual(paletteNumbers(third));
        settle(world, camera, PALETTE_DRIFT * (VOLTAGE_STORM_PALETTES.length + 0.05));
        expect(coloursOf(world)).toEqual(paletteNumbers(first));
    });

    it('moves a little every frame while it mixes, by the clock alone (no events, no level)', () => {
        const { world, camera } = makeWorld();
        settle(world, camera, PALETTE_DRIFT * 0.3);
        let previous = coloursOf(world);
        let total = 0;
        for (let i = 0; i < 40; i++) {
            run(world, camera, 1, 60);
            const now = coloursOf(world);
            let step = 0;
            for (let k = 0; k < now.length; k++) step = Math.max(step, Math.abs(now[k] - previous[k]));
            expect(step).toBeGreaterThan(0);
            // Slowly: no colour moves by more than a few hundredths in a second.
            expect(step).toBeLessThan(0.05);
            total += step;
            previous = now;
        }
        expect(total).toBeGreaterThan(0.1);
        expect(world.getState()).toMatchObject({ level: 1, counts: { locks: 0, clears: 0 } });
    });

    it('is the same light at a moment whether the clock ran there or was set there', () => {
        const ran = makeWorld();
        const set = makeWorld();
        const moment = PALETTE_DRIFT * 0.62;
        settle(ran.world, ran.camera, moment - 20);
        runTo(ran.world, ran.camera, moment, 1 / 7);
        settle(set.world, set.camera, moment);
        expect(coloursOf(ran.world)).toEqual(coloursOf(set.world));
        expect(ran.world.getState().palette).toBe(set.world.getState().palette);
    });

    it('adds a level\'s step to wherever the clock has carried the light', () => {
        const { world, camera } = makeWorld();
        const moment = PALETTE_DRIFT * 1.5; // by the clock alone: half-way from the second to the third
        settle(world, camera, moment);
        world.levelUp(3, { silent: true });
        world.update({ time: moment, delta: 0 }, camera);
        // Two steps further round: half-way from the fourth to the fifth.
        const want = paletteAt(3.5);
        expect(coloursOf(world)).toEqual(paletteNumbers(want));
        expect(world.getState().paletteNext).toBe(VOLTAGE_STORM_PALETTES[4].name);
    });

    it('keeps drifting through a new run: only the level\'s step is taken back', () => {
        const { world, camera } = makeWorld();
        settle(world, camera, PALETTE_DRIFT * 2.4);
        world.levelUp(3, { silent: true });
        world.resetSession();
        run(world, camera, 12);
        expect(world.getState().level).toBe(1);
        const want = paletteAt(palettePhase(1, world.time));
        coloursOf(world).forEach((v, i) => expect(v).toBeCloseTo(paletteNumbers(want)[i], 3));
        // And the step settles exactly, so the clock alone moves the light from here on.
        run(world, camera, 10);
        expect(world.wheelPlace).toBe(0);
        expect(coloursOf(world)).toEqual(paletteNumbers(paletteAt(palettePhase(1, world.time))));
    });
});

describe('voltage storm world: the storm\'s own lightning', () => {
    const beats = (from, to) => Math.floor(to / AMBIENT_BEAT) - Math.floor(from / AMBIENT_BEAT);

    it('fires on its own beat at rest, more often under a chain, and never while the clock is frozen', () => {
        const { world, camera } = makeWorld('High', { quiet: false });
        const ambient = vi.spyOn(world, 'ambient');
        const fired = watchBolts(world);
        // Start and stop well clear of a beat, so a frame's rounding cannot move the count.
        const from = AMBIENT_BEAT * 3 + AMBIENT_BEAT / 2;
        settle(world, camera, from);
        runTo(world, camera, from + AMBIENT_BEAT * 5);
        expect(ambient).toHaveBeenCalledTimes(beats(from, world.time));
        expect(ambient).toHaveBeenCalledTimes(5);
        expect(fired().length).toBeGreaterThanOrEqual(5);
        for (const bolt of fired()) {
            expect(['strike', 'crawler']).toContain(bolt.kind);
            // Up in the cloud or far off on the plain: never on a collector.
            expect(towerAt(world, bolt.end)).toBe(-1);
        }
        expect(world.getState().counts).toMatchObject({ strikes: 0, arcs: 0 });
        expect(world.totalHeld()).toBe(0);

        world.onCombo(8);
        run(world, camera, AMBIENT_BEAT * 5, Math.round(AMBIENT_BEAT * 5 * 60));
        expect(ambient.mock.calls.length - 5).toBeGreaterThan(5);

        // It holds its fire while the clock is frozen: a capture drawn again and again across a beat.
        ambient.mockClear();
        settle(world, camera, AMBIENT_BEAT * 4 - 0.01);
        for (let i = 0; i < 5; i++) {
            const sim = { time: AMBIENT_BEAT * 4 + 0.01, delta: 0 };
            world.updateCamera(camera, sim);
            world.update(sim, camera);
        }
        expect(ambient).not.toHaveBeenCalled();
        expect(world.getState().bolts).toBe(0);
    });
});

describe('voltage storm world: determinism', () => {
    it('plays the same script to the same frame, twice over and again after a seek', () => {
        const a = makeWorld('High', { quiet: false });
        const b = makeWorld('High', { quiet: false });
        for (const { world, camera } of [a, b]) {
            settle(world, camera, 20);
            runTo(world, camera, 22);
            play(world, camera);
        }
        const first = snapshot(a.world);
        expect(first.state.counts).toMatchObject({ locks: 3, clears: 2, quads: 1 });
        expect(first.state.bolts).toBeGreaterThan(5);
        expect(snapshot(b.world)).toEqual(first);
        // The same world, sent back: nothing of the first run is left to change the second.
        settle(a.world, a.camera, 20);
        runTo(a.world, a.camera, 22);
        play(a.world, a.camera);
        expect(snapshot(a.world)).toEqual(first);
    });

    it('is the same storm at a moment whatever went before the seek', () => {
        const used = makeWorld('High', { quiet: false });
        const fresh = makeWorld('High', { quiet: false });
        used.world.levelUp(3);
        used.world.onCombo(6);
        play(used.world, used.camera);
        used.world.setReducedMotion(true);
        run(used.world, used.camera, 6);
        used.world.setReducedMotion(false);
        used.world.setViewport(414, 900, 414 / 900);
        used.world.setViewport(1600, 900, 16 / 9);
        settle(used.world, used.camera, 31);
        settle(fresh.world, fresh.camera, 31);
        expect(snapshot(used.world)).toEqual(snapshot(fresh.world));
        expect(numbers(used.world.u.tables.flashes)).toEqual(numbers(fresh.world.u.tables.flashes));
        // (The palette is eased back, not assigned: a colour may be a rounding of the last bit off.)
        for (const key of PALETTE_KEYS) {
            const [was, is] = [used, fresh].map(({ world }) => world.u[key].value.toArray());
            expect(furthest(was, is), key).toBeLessThan(1e-12);
        }
        expect(used.world.getPostState()).toEqual(fresh.world.getPostState());
        // And they go on alike: the counters that number bolts and sparks started again too.
        play(used.world, used.camera);
        play(fresh.world, fresh.camera);
        const [after, expected] = [snapshot(used.world), snapshot(fresh.world)];
        expect(after.state).toEqual(expected.state);
        expect(furthest(after.bolts, expected.bolts)).toBeLessThan(1e-12);
        for (const key of ['towers', 'shocks', 'sheet', 'sparks']) expect(after[key], key).toEqual(expected[key]);
    });

    it('does not care how the lead-in at rest was stepped', () => {
        const a = makeWorld('High', { quiet: false });
        const b = makeWorld('High', { quiet: false });
        // A lead-in between two of the storm's own beats.
        const from = AMBIENT_BEAT * 3 + 0.3;
        const to = from + Math.min(2, AMBIENT_BEAT / 2);
        settle(a.world, a.camera, from);
        settle(b.world, b.camera, from);
        runTo(a.world, a.camera, to, 1 / 60);
        runTo(b.world, b.camera, to, 0.1);
        expect(snapshot(b.world)).toEqual(snapshot(a.world));
        play(a.world, a.camera);
        play(b.world, b.camera);
        expect(snapshot(b.world)).toEqual(snapshot(a.world));
    });

    it('does not care how the lead-in was stepped when the storm\'s own lightning struck during it', () => {
        const a = makeWorld('High', { quiet: false });
        const b = makeWorld('High', { quiet: false });
        // The lead-in crosses a beat 0.3 s before it ends: that bolt is still alight at the end.
        const beat = AMBIENT_BEAT * 3;
        settle(a.world, a.camera, beat - 2.03);
        settle(b.world, b.camera, beat - 2.03);
        runTo(a.world, a.camera, beat + 0.3, 1 / 60);
        runTo(b.world, b.camera, beat + 0.3, 0.1);
        expect(a.world.getState().bolts).toBeGreaterThan(0);
        // The same bolt, born at the beat and so as old in one run as in the other.
        expect(snapshot(b.world)).toEqual(snapshot(a.world));
        play(a.world, a.camera);
        play(b.world, b.camera);
        expect(snapshot(b.world)).toEqual(snapshot(a.world));
    });

    it('lands an arc and connects a leader at their own moments, however the frames are cut', () => {
        const fine = makeWorld();
        const coarse = makeWorld();
        const fired = [fine, coarse].map(({ world }) => watchBolts(world));
        [[fine, 1 / 240], [coarse, 1 / 20]].forEach(([{ world, camera }, step]) => {
            world.charge(2, pieceColor(PIECES[0]), 0.8);
            world.onLock({
                u: 0.2, rows: [8], color: PIECES[3], hardDrop: true,
            });
            world.onClear({ lines: 4 });
            runTo(world, camera, START + 2, step);
        });
        /** Everything an event dates: pulses, rings, the sheet, the ripple, sparks, charge, bolts. */
        const dated = ({ world }) => ({
            pulses: world.towers.map((_, i) => world.u.tables.towers[i * 3 + 2].y),
            shocks: numbers(world.u.tables.shocks),
            sheet: world.u.sheet.value.toArray(),
            ripple: world.getPostState().ripple.radius,
            sparks: Array.from(world.sparks.geometry.getAttribute('aBirth').array),
            held: held(world),
            bolts: boltTable(world),
            counts: world.getState().counts,
        });
        expect(shocks(fine.world).length).toBeGreaterThan(3);
        expect(dated(coarse)).toEqual(dated(fine));
        expect(fired[1]().map((bolt) => bolt.time)).toEqual(fired[0]().map((bolt) => bolt.time));
    });
});

describe('voltage storm world: a new run', () => {
    it('empties the towers, the queue and the chain, drops what was on its way, and keeps the storm drifting', () => {
        const { world, camera } = makeWorld();
        world.levelUp(3);
        world.onCombo(8);
        run(world, camera, 4);
        play(world, camera);
        const before = world.getState();
        expect(before.bolts).toBeGreaterThan(0);
        expect(before.queued + before.counts.strikes).toBeGreaterThan(0);
        const clocks = () => ({
            time: world.time,
            stormClock: world.stormClock,
            rainClock: world.rainClock,
            churn: world.churn,
            driftX: world.driftX,
            driftZ: world.driftZ,
            beat: world.beat,
        });
        const kept = clocks();
        // The chain has pushed the cloud well ahead of where the bare clock would have it.
        expect(Math.abs(kept.driftX - STORM.drift[0] * kept.time)).toBeGreaterThan(5);
        world.resetSession();
        expect(clocks()).toEqual(kept);
        expect(world.getState()).toMatchObject({
            time: kept.time,
            combo: 0,
            twist: 0,
            level: 1,
            palette: VOLTAGE_STORM_PALETTES[0].name,
            counts: {
                locks: 0, clears: 0, quads: 0, arcs: 0, strikes: 0, flickers: 0,
            },
            held: 0,
            bolts: 0,
            chainArcs: 0,
            queued: 0,
        });
        // The charge and the overdrive are kept, to ease away: a cut would jump the camera and
        // the iris on the frame the run ends.
        expect(world.getState().power).toBe(before.power);
        expect(world.getState().surge).toBe(before.surge);
        expect(before.power).toBeGreaterThan(0.5);
        expect(shocks(world)).toHaveLength(0);
        expect(boltTable(world).every((v) => v === 0)).toBe(true);
        world.towers.forEach((tower, i) => {
            expect(world.u.tables.towers[i * 3 + 1].w).toBe(0);
            expect(world.u.tables.towers[i * 3 + 2].x).toBe(0);
        });
        // The next frame carries on from there: no jump in the cloud.
        const drift = world.u.drift.value.x;
        run(world, camera, 1 / 60, 1);
        expect(Math.abs(world.u.drift.value.x - drift)).toBeLessThan(1);
        expect(world.u.rainClock.value).toBeGreaterThan(kept.rainClock);

        // What is on its way is dropped: nothing of the old run lands in the new one.
        world.onLock({
            u: 0.2, rows: [8], color: PIECES[3], hardDrop: true,
        });
        world.onClear({ lines: 4, tspin: true });
        world.onCombo(4);
        expect(world.getState().queued).toBeGreaterThan(0);
        world.resetSession();
        run(world, camera, 3);
        expect(world.getState()).toMatchObject({
            held: 0, twist: 0, bolts: 0, queued: 0, chainArcs: 0,
        });
        // The superbolt that was on its way never connected: the overdrive only cooled.
        expect(world.getState().surge).toBeLessThan(before.surge + 1e-9);
        expect(shocks(world)).toHaveLength(0);
        expect(world.getPostState().ripple.strength).toBe(0);
        expect(world.towers.every((tower) => tower.strike === 0)).toBe(true);
    });
});

describe('voltage storm world: what a second look found', () => {
    it('lets the charge of a run that ended ease away instead of cutting it', () => {
        const { world, camera } = makeWorld();
        world.levelUp(3, { silent: true });
        world.onCombo(8);
        run(world, camera, 4);
        const charged = world.getState().power;
        expect(charged).toBeGreaterThan(0.5);
        world.resetSession();
        expect(world.getState().power).toBe(charged);
        run(world, camera, 1 / 60, 1);
        expect(world.getState().power).toBeLessThan(charged);
        expect(world.getState().power).toBeGreaterThan(charged * 0.9);
        run(world, camera, 12);
        expect(world.getState().power).toBeLessThan(0.01);
        // The light goes back to the first level's place on the wheel, eased too.
        const resting = paletteAt(palettePhase(1, world.time));
        PALETTE_KEYS.forEach((key) => {
            if (key === 'horizon') return;
            expect(world.u[key].value.x).toBeCloseTo(resting[key][0], 3);
        });
    });

    it('gives a new ring the place of the weakest ring on the water', () => {
        const { world } = makeWorld();
        const slots = world.u.tables.shocks.length / 2;
        // One ring that has nearly died, then strong ones until the table is full.
        world.shock(1, 1, world.time - 6, 1);
        for (let i = 1; i < slots; i++) world.shock(i * 10, 0, world.time, 1);
        expect(shocks(world)).toHaveLength(slots);
        const hero = world.towers[0];
        world.shock(hero.x, hero.z, world.time, 0.5);
        const now = shocks(world);
        expect(now).toHaveLength(slots);
        expect(now.some((ring) => ring.x === 1 && ring.z === 1)).toBe(false);
        expect(now.filter((ring) => ring.strength === 1)).toHaveLength(slots - 1);
        expect(now.some((ring) => ring.x === hero.x && ring.z === hero.z)).toBe(true);
    });

    it('keeps a standing arc in the storm\'s light when the level changes it', () => {
        const { world, camera } = makeWorld();
        world.onCombo(3);
        run(world, camera, 0.5);
        const row = () => world.bolts.rows[BOLT_RANGES.chain[0] * BOLT_ROWS + 2];
        const first = [row().x, row().y, row().z];
        world.levelUp(2);
        run(world, camera, 8);
        expect(liveOf(world, 'chain')).toContain(0);
        const next = paletteAt(palettePhase(2, world.time)).chain;
        expect(row().x).toBeCloseTo(next[0], 2);
        expect(row().y).toBeCloseTo(next[1], 2);
        expect(row().z).toBeCloseTo(next[2], 2);
        expect([row().x, row().y, row().z]).not.toEqual(first);
    });

    it('under reduced motion gives every bolt one stroke and holds a standing arc steady', () => {
        const { world, camera } = makeWorld();
        world.setReducedMotion(true);
        const fired = watchBolts(world);
        world.onCombo(4);
        world.onLock({
            u: 0.2, rows: [8], color: PIECES[0], hardDrop: true,
        });
        world.onClear({ lines: 3 });
        run(world, camera, 0.5);
        expect(fired().length).toBeGreaterThan(3);
        const flickering = world.bolts.slots.filter((slot) => slot.live && !slot.held);
        expect(flickering.length).toBeGreaterThan(0);
        flickering.forEach((slot) => expect(slot.plan.times).toHaveLength(1));
        run(world, camera, 1);
        // The standing arc's light is the same from frame to frame, and the lens does not kick.
        const light = BOLT_RANGES.chain[0] * BOLT_ROWS + 3;
        const levels = [];
        for (let i = 0; i < 30; i++) {
            run(world, camera, 1 / 120, 1);
            levels.push(world.bolts.rows[light].y);
        }
        expect(levels[0]).toBeGreaterThan(0);
        expect(Math.max(...levels) - Math.min(...levels)).toBeLessThan(1e-9);
        expect(world.getPostState().kick).toBe(0);
    });

    it('survives a combo or a level that is not a number', () => {
        const { world, camera } = makeWorld();
        expect(() => {
            world.onCombo(Infinity);
            world.onCombo(NaN);
            world.levelUp(Infinity);
            world.levelUp('x');
            run(world, camera, 0.2);
        }).not.toThrow();
        expect(world.combo).toBe(0);
        expect(world.level).toBe(1);
    });

    it('starts a tower\'s white whole however long the frame that noticed the strike', () => {
        const strikeAt = (step) => {
            const { world, camera } = makeWorld();
            world.onClear({ lines: 1 });
            let peak = 0;
            for (let i = 0; i < Math.ceil(0.6 / step); i++) {
                run(world, camera, step, 1);
                peak = Math.max(peak, ...world.towers.map((tower) => tower.strike));
            }
            return peak;
        };
        const fine = strikeAt(1 / 240);
        const coarse = strikeAt(1 / 20);
        expect(fine).toBeGreaterThan(0.5);
        expect(coarse).toBeCloseTo(fine, 6);
    });
});

describe('voltage storm world: reduced motion', () => {
    it('still delivers every event', () => {
        const full = makeWorld();
        const calm = makeWorld();
        calm.world.setReducedMotion(true);
        for (const { world, camera } of [full, calm]) {
            world.onLock({ u: 0.2, rows: [8], color: PIECES[0] });
            world.onLock({
                u: 0.85, rows: [9], color: PIECES[1], hardDrop: true,
            });
            run(world, camera, 0.5);
        }
        expect(holders(calm.world)).toEqual(holders(full.world));
        expect(holders(calm.world).length).toBeGreaterThanOrEqual(2);
        for (const index of holders(calm.world)) {
            expect(held(calm.world)[index]).toBeCloseTo(held(full.world)[index], 2);
            expect(calm.world.towers[index].tint).toEqual(full.world.towers[index].tint);
        }
        expect(shocks(calm.world)).toHaveLength(shocks(full.world).length);
        for (const { world, camera } of [full, calm]) {
            world.onClear({ lines: 2, tspin: true });
            world.onCombo(4);
            world.levelUp(2);
            run(world, camera, 1);
            world.onClear({ lines: 4 });
            run(world, camera, 1.5);
        }
        const { counts, ...state } = calm.world.getState();
        // (The storm's own flickers are not the board's: they are counted apart.)
        expect({ ...counts, flickers: 0 }).toEqual({ ...full.world.getState().counts, flickers: 0 });
        expect(counts).toMatchObject({ locks: 2, clears: 2, quads: 1 });
        expect(state.palette).toBe(full.world.getState().palette);
        // The superbolt and the strikes after it emptied the same towers.
        expect(holders(calm.world)).toEqual(holders(full.world));
        for (let i = 0; i <= 4; i++) expect(held(calm.world)[i]).toBe(0);
        expect(state.surge).toBeGreaterThan(0);
        expect(state.chainArcs).toBeGreaterThan(0);
        expect(calm.world.u.sheet.value.w).toBeGreaterThan(0);
        expect(calm.world.getPostState().ripple.strength).toBeGreaterThan(0);
        expect(calm.world.twist).not.toBe(0);
    });

    it('holds the camera still and softens what flashes and shakes', () => {
        const full = makeWorld();
        const calm = makeWorld();
        calm.world.setReducedMotion(true);
        const peaks = [full, calm].map(({ world, camera }) => {
            const fired = watchBolts(world);
            // Where the lens stands at this moment with nothing going on.
            world.updateCamera(camera, { time: world.time, delta: 0 });
            const rest = camera.position.clone();
            const fov = fovForAspect(camera.aspect);
            const seen = {
                moved: 0, zoomed: 0, flash: 0, ripple: 0, twist: 0, sheet: 0, arcs: 0, strokes: 0,
            };
            world.onCombo(MAX_CHAIN_ARCS + 3);
            world.onClear({ lines: 4, tspin: true });
            for (let i = 0; i < 180; i++) {
                const sim = {
                    time: world.time + 1 / 60, delta: 1 / 60, pointerX: 1, pointerY: -1,
                };
                world.updateCamera(camera, sim);
                world.update(sim, camera);
                const post = world.getPostState();
                seen.moved = Math.max(seen.moved, camera.position.distanceTo(rest));
                seen.zoomed = Math.max(seen.zoomed, Math.abs(camera.fov - fov));
                seen.flash = Math.max(seen.flash, post.flash);
                seen.ripple = Math.max(seen.ripple, post.ripple.strength);
                seen.twist = Math.max(seen.twist, Math.abs(world.u.twist.value.z));
                seen.sheet = Math.max(seen.sheet, world.u.sheet.value.w);
                seen.arcs = Math.max(seen.arcs, liveOf(world, 'chain').length);
            }
            seen.strokes = Math.max(...fired('strike').map((bolt) => bolt.strokes));
            return seen;
        });
        const [loud, soft] = peaks;
        expect(loud.moved).toBeGreaterThan(0);
        expect(soft.moved).toBeCloseTo(0, 9);
        expect(soft.zoomed).toBeCloseTo(0, 9);
        expect(soft.flash).toBeLessThanOrEqual(loud.flash);
        expect(soft.ripple).toBeLessThan(loud.ripple);
        expect(soft.twist).toBeLessThan(loud.twist);
        expect(soft.sheet).toBeLessThan(loud.sheet);
        expect(soft.strokes).toBeLessThanOrEqual(loud.strokes);
        expect(soft.arcs).toBeLessThan(loud.arcs);
        expect(soft.arcs).toBeGreaterThan(0);
    });
});

describe('voltage storm world: layout and aspect', () => {
    const board = (card) => ({
        x0: card.x0 + 0.02, y0: card.y0 + 0.1, x1: card.x1 - 0.02, y1: card.y1 - 0.04,
    });

    it('aims at the live rects, and goes back to where the solo board would be without them', () => {
        const { world, camera } = makeWorld('High', { live: false });
        const fired = watchBolts(world);
        const fallback = { left: [...world.targets.left], right: [...world.targets.right] };
        expect(world.getState().layoutLive).toBe(false);
        const card = {
            x0: 0.56, y0: 0.1, x1: 0.8, y1: 0.9,
        };
        const hud = {
            x0: 0.04, y0: 0.3, x1: 0.12, y1: 0.7,
        };
        world.setLayout({
            cardCount: 1, cards: [card], hud, boards: [board(card), null, null, null, null],
        });
        expect(world.getState().layoutLive).toBe(true);
        const centre = (card.x0 + card.x1) / 2;
        const { left, right } = world.targets;
        expect(left.length).toBeGreaterThan(0);
        expect(left).not.toEqual(fallback.left);
        for (const [list, side] of [[left, -1], [right, 1]]) {
            for (const index of list) {
                const { sx, sy } = world.towers[index];
                expect((sx - centre) * side).toBeGreaterThan(0);
                expect(inside(card, sx, sy) || inside(hud, sx, sy)).toBe(false);
            }
        }
        // Every tower left of the card that is clear of it is a target now.
        world.towers.forEach((tower) => {
            const clear = tower.sx < card.x0 - 0.03 && !inside(grown(hud, 0.03), tower.sx, tower.sy);
            if (clear) expect(left).toContain(tower.index);
        });
        // A lock leaves the live card's edge at the live board's row.
        world.onLock({ u: 0.1, rows: [2], color: PIECES[2] });
        const from = onScreen(fired('arc').at(-1).start, camera);
        expect(from.x).toBeCloseTo(card.x0, 6);
        expect(from.y).toBeCloseTo(boardPoint(board(card), 0.1, 2).y, 6);

        world.setLayout(null);
        expect(world.getState().layoutLive).toBe(false);
        expect(world.targets).toEqual(fallback);
    });

    it('throws each board\'s arcs from its own card when several are on screen', () => {
        const { world, camera } = makeWorld();
        const fired = watchBolts(world);
        const cards = [{
            x0: 0.26, y0: 0.1, x1: 0.48, y1: 0.9,
        }, {
            x0: 0.52, y0: 0.14, x1: 0.74, y1: 0.86,
        }];
        world.setLayout({
            cardCount: 2, cards, hud: null, boards: [null, board(cards[0]), board(cards[1]), null, null],
        });
        expect(world.targets.left.length).toBeGreaterThan(0);
        expect(world.targets.right.length).toBeGreaterThan(0);
        for (const player of [1, 2]) {
            const own = cards[player - 1];
            for (const u of [0.1, 0.9]) {
                world.onLock({
                    u, rows: [2], player, color: PIECES[player],
                });
                const from = onScreen(fired('arc').at(-1).start, camera);
                const label = `player ${player}, column ${u}`;
                expect(Math.min(Math.abs(from.x - own.x0), Math.abs(from.x - own.x1)), label).toBeLessThan(1e-6);
                expect(from.y, label).toBeCloseTo(boardPoint(board(own), u, 2).y, 6);
            }
            const sent = fired('arc').length;
            world.onClear({ lines: 2, rows: [2, 3], player });
            const rows = fired('arc').slice(sent).map((arc) => onScreen(arc.start, camera));
            expect(rows).toHaveLength(2);
            rows.forEach((from, i) => {
                expect(Math.min(Math.abs(from.x - own.x0), Math.abs(from.x - own.x1))).toBeLessThan(1e-6);
                expect(from.y).toBeCloseTo(boardPoint(board(own), 0.5, 2 + i).y, 6);
            });
        }
        // A player with no board of its own on screen is still answered.
        expect(() => world.onLock({ u: 0.5, rows: [4], player: 4 })).not.toThrow();
        expect(() => world.onClear({ lines: 1, player: 9 })).not.toThrow();
        expect(boltTable(world).every((v) => Number.isFinite(v))).toBe(true);
    });

    it('re-stands the towers for an upright phone, keeping what they hold', () => {
        const { world, camera } = makeWorld('High', { live: false });
        world.charge(0, pieceColor(PIECES[0]), 1);
        world.charge(3, pieceColor(PIECES[1]), 0.5);
        const before = world.towers.map((tower) => ({ x: tower.x, z: tower.z }));
        const charge = held(world);
        camera.aspect = 414 / 900;
        world.setViewport(414, 900, 414 / 900);
        expect(world.towers).toHaveLength(before.length);
        expect(world.towers[0].x !== before[0].x || world.towers[0].z !== before[0].z).toBe(true);
        expect(held(world)).toEqual(charge);
        const matrix = new THREE.Matrix4();
        const at = new THREE.Vector3();
        world.towers.forEach((tower, i) => {
            expect(tower.index).toBe(i);
            if (i > 0) expect(tower.dist).toBeGreaterThan(world.towers[i - 1].dist);
            const place = world.u.tables.towers[i * 3];
            expect([place.x, place.y, place.z, place.w]).toEqual([tower.x, tower.z, tower.height, 1]);
            for (const name of ['towers', 'towerMirror']) {
                world.parts[name].mesh.getMatrixAt(i, matrix);
                at.setFromMatrixPosition(matrix);
                expect(at.x).toBeCloseTo(tower.x, 3);
                expect(at.z).toBeCloseTo(tower.z, 3);
            }
        });
        expect(world.u.twist.value.x).toBe(world.towers[0].x);
        expect(world.targets.left.length).toBeGreaterThan(0);
        expect(world.targets.right.length).toBeGreaterThan(0);
        // What is sized in pixels follows the new frame.
        expect(world.u.viewport.value.toArray()).toEqual([414, 900]);
        expect(world.u.pixelAngle.value).toBeCloseTo((2 * Math.tan((fovForAspect(414 / 900) * DEG) / 2)) / 900, 12);
        // And back again, to where they stood.
        world.setViewport(1600, 900, 16 / 9);
        world.towers.forEach((tower, i) => {
            expect(tower.x).toBeCloseTo(before[i].x, 9);
            expect(tower.z).toBeCloseTo(before[i].z, 9);
        });
    });

    it('stands a chain\'s arcs on the towers\' new tips after the frame changes shape', () => {
        const { world, camera } = makeWorld('High', { live: false });
        world.onCombo(4);
        run(world, camera, 0.5);
        expect(liveOf(world, 'chain')).toHaveLength(3);
        camera.aspect = 414 / 900;
        world.setViewport(414, 900, 414 / 900);
        run(world, camera, 3);
        const tips = world.towers.map((tower) => tip(tower).join());
        expect(liveOf(world, 'chain')).toHaveLength(3);
        for (const i of liveOf(world, 'chain')) {
            const base = (BOLT_RANGES.chain[0] + i) * BOLT_ROWS;
            for (const row of [world.bolts.rows[base], world.bolts.rows[base + 1]]) {
                expect(tips, `arc ${i}`).toContain([row.x, row.y, row.z].join());
            }
        }
    });
});

describe('voltage storm world: parts, frames and disposal', () => {
    /** A storm of everything the board can ask for. */
    function storm(world, camera) {
        world.onCombo(MAX_CHAIN_ARCS + 5);
        for (let i = 0; i < 12; i++) {
            world.onLock({
                u: (i * 0.37) % 1, rows: [4 + i], color: PIECES[i % PIECES.length], hardDrop: i % 2 === 0,
            });
            if (i % 3 === 0) world.onClear({ lines: 4, tspin: i % 2 === 0, perfect: i === 9 });
            else world.onClear({ lines: 1 + (i % 3), rows: [19, 18, 17].slice(0, 1 + (i % 3)) });
            if (i === 5) world.levelUp(2);
            run(world, camera, 0.4, 24);
        }
        world.onCombo(0);
        run(world, camera, 1);
    }

    it('draws only the parts it is told to', () => {
        const { world } = makeWorld();
        const visible = () => Object.keys(world.parts).filter((name) => world.parts[name].mesh.visible).sort();
        expect(visible()).toEqual([...VOLTAGE_STORM_PARTS].sort());
        world.showOnlyParts(['sky', 'towers', 'no such part']);
        expect(visible()).toEqual(['sky', 'towers']);
        world.showOnlyParts([]);
        expect(visible()).toEqual([]);
        world.showOnlyParts(VOLTAGE_STORM_PARTS);
        expect(visible()).toEqual([...VOLTAGE_STORM_PARTS].sort());
    });

    it('creates nothing at event time: the same objects, buffers and materials after a storm of events', () => {
        const { scene, world, camera } = makeWorld();
        const census = () => {
            const seen = [];
            scene.traverse((object) => {
                const { geometry, material } = object;
                const entry = { object, geometry, material };
                entry.buffers = [];
                if (object.geometry) {
                    Object.keys(object.geometry.attributes).sort().forEach((name) => {
                        entry.buffers.push(object.geometry.attributes[name].array);
                    });
                    entry.buffers.push(object.geometry.getIndex()?.array);
                    entry.count = object.count ?? object.geometry.instanceCount;
                }
                seen.push(entry);
            });
            return seen;
        };
        const before = census();
        const tables = Object.values(world.u.tables).flat();
        storm(world, camera);
        expect(world.getState().counts.quads).toBeGreaterThan(0);
        const after = census();
        expect(after).toHaveLength(before.length);
        after.forEach((entry, i) => {
            expect(entry.object).toBe(before[i].object);
            expect(entry.geometry).toBe(before[i].geometry);
            expect(entry.material).toBe(before[i].material);
            expect(entry.count).toBe(before[i].count);
            expect(entry.buffers).toHaveLength(before[i].buffers.length);
            entry.buffers.forEach((buffer, k) => expect(buffer).toBe(before[i].buffers[k]));
        });
        // The tables are written in place too.
        Object.values(world.u.tables).flat().forEach((row, i) => expect(row).toBe(tables[i]));
    });

    it('never lists more lights than the flash table holds, and counts the ones it lists', () => {
        const { world, camera } = makeWorld('High', { quiet: false });
        const update = vi.spyOn(world.bolts, 'update');
        const { flashes } = world.u.tables;
        expect(flashes).toHaveLength(FLASH_SLOTS * 2);
        let most = 0;
        world.onCombo(MAX_CHAIN_ARCS + 5);
        for (let round = 0; round < 4; round++) {
            world.onLock({
                u: round % 2 ? 0.8 : 0.2, rows: [8], color: PIECES[round], hardDrop: true,
            });
            world.onClear({ lines: 4 });
            for (let i = 0; i < 36; i++) {
                run(world, camera, 1 / 60, 1);
                const lights = update.mock.results.at(-1).value;
                const count = world.u.flashCount.value;
                expect(count).toBe(lights.length);
                expect(count).toBeLessThanOrEqual(FLASH_SLOTS);
                expect(world.getState().flashes).toBe(count);
                for (let k = 0; k < count; k++) {
                    const at = flashes[k * 2];
                    const light = flashes[k * 2 + 1];
                    expect([at.x, at.y, at.z, at.w]).toEqual([lights[k].x, lights[k].y, lights[k].z, lights[k].reach]);
                    for (const channel of [light.x, light.y, light.z]) {
                        expect(Number.isFinite(channel)).toBe(true);
                        expect(channel).toBeGreaterThanOrEqual(0);
                    }
                }
                most = Math.max(most, count);
            }
        }
        // The burst did fill it: more bolts were alight than the table has rows.
        expect(most).toBe(FLASH_SLOTS);
        expect(world.getState().bolts).toBeGreaterThan(FLASH_SLOTS);
    });

    it('paints its sky each frame unless told not to draw, and runs without a renderer at all', () => {
        const renderer = { getRenderTarget: vi.fn(() => 'screen'), setRenderTarget: vi.fn(), render: vi.fn() };
        const { world, camera } = makeWorld('Low', { renderer });
        const frame = (time, extra = {}) => {
            renderer.setRenderTarget.mockClear();
            renderer.render.mockClear();
            const sim = { time, delta: 0.1, ...extra };
            world.updateCamera(camera, sim);
            world.update(sim, camera);
        };
        frame(11);
        expect(renderer.render).toHaveBeenCalledTimes(1);
        // Into its own target, and the renderer is handed back aimed where it was.
        expect(renderer.setRenderTarget.mock.calls.map(([target]) => target)).toEqual([world.sky.target(), 'screen']);
        // A replay toward a seek point steps without drawing.
        frame(11.1, { draw: false });
        expect(renderer.render).not.toHaveBeenCalled();
        expect(renderer.setRenderTarget).not.toHaveBeenCalled();
        expect(world.time).toBe(11.1);
        world.showOnlyParts(['towers']);
        frame(11.2);
        expect(renderer.render).not.toHaveBeenCalled();

        const bare = makeWorld('Low');
        expect(() => {
            run(bare.world, bare.camera, 0.5);
            bare.world.update({ time: bare.world.time + 0.1, delta: 0.1, draw: false }, bare.camera);
        }).not.toThrow();
        // A world no camera was ever bound to still steps.
        const unbound = new VoltageStormWorld({ scene: new THREE.Scene(), quality: 'Low' }).build();
        expect(() => {
            unbound.onLock({ u: 0.3, color: PIECES[0] });
            unbound.onClear({ lines: 4 });
            unbound.update({ time: 1, delta: 0.1 });
            unbound.update({ time: 2, delta: 1 });
        }).not.toThrow();
        expect(unbound.getState().counts.quads).toBe(1);
    });

    it('hands the post a state it can read on every frame of a storm, whatever the frame\'s length', () => {
        const { world, camera } = makeWorld('High', { quiet: false });
        const post = world.getPostState();
        const readable = (label) => {
            // One reused object, every number finite and inside what the post stack is built for.
            expect(world.getPostState(), label).toBe(post);
            const { ripple, heart } = post;
            for (const value of [post.flash, post.kick, post.bloomBoost, post.streak, ripple.radius, ripple.strength]) {
                expect(Number.isFinite(value), label).toBe(true);
                expect(value, label).toBeGreaterThanOrEqual(0);
            }
            expect(post.kick, label).toBeLessThanOrEqual(1);
            expect(post.streak, label).toBeLessThanOrEqual(1);
            expect(post.exposure, label).toBeGreaterThan(0);
            expect(post.exposure, label).toBeLessThanOrEqual(1);
            expect([ripple.x, ripple.y, heart.x, heart.y].every((value) => Number.isFinite(value)), label).toBe(true);
        };
        world.onCombo(7);
        for (let i = 0; i < 240; i++) {
            if (i === 10) world.onClear({ lines: 4 });
            if (i === 90) world.onLock({ u: 0.3, hardDrop: true, color: PIECES[1] });
            run(world, camera, 1 / 60, 1);
            readable(`frame ${i}`);
        }
        expect(post.heart).toBe(world.heart);

        // A frame may be frozen, missing its length, backwards or thirty seconds long.
        world.onClear({ lines: 4, tspin: true });
        let { time } = world;
        for (const delta of [0, undefined, -1, NaN, 5, 0.016, 0, 30, 0.016]) {
            time += Number.isFinite(delta) && delta > 0 ? delta : 0;
            const sim = { time, delta };
            world.updateCamera(camera, sim);
            world.update(sim, camera);
            readable(`a frame of ${delta} s`);
            const state = world.getState();
            for (const key of ['power', 'surge', 'breath', 'twist', 'held']) {
                expect(Number.isFinite(state[key]), `${key} after ${delta}`).toBe(true);
            }
            expect(state.power).toBeLessThan(1);
            expect(state.breath).toBeGreaterThan(0);
            expect(state.breath).toBeLessThanOrEqual(1);
            expect(Math.abs(state.twist)).toBeLessThan(10);
            expect(boltTable(world).every((v) => Number.isFinite(v))).toBe(true);
            expect(camera.position.toArray().every((v) => Number.isFinite(v))).toBe(true);
        }
    });

    it('lets go of everything on dispose, once, and ignores whatever comes after', () => {
        const { scene, world, camera } = makeWorld();
        const disposed = [];
        Object.values(world.parts).forEach((part) => {
            vi.spyOn(part.geometry, 'dispose').mockImplementation(() => disposed.push(part.geometry));
            vi.spyOn(part.material, 'dispose').mockImplementation(() => disposed.push(part.material));
        });
        const parts = Object.keys(world.parts).length;
        world.onLock({ u: 0.2, color: PIECES[0], hardDrop: true });
        world.onClear({ lines: 4 });
        expect(world.getState().queued).toBeGreaterThan(0);
        world.dispose();
        expect(scene.children).toHaveLength(0);
        expect(disposed).toHaveLength(parts * 2);
        world.dispose();
        expect(disposed).toHaveLength(parts * 2);
        expect(new Set(disposed).size).toBe(parts * 2);
        expect(() => {
            world.onLock({ u: 0.3, color: PIECES[1], hardDrop: true });
            world.onClear({ lines: 2, tspin: true });
            world.onClear({ lines: 4, perfect: true });
            world.onCombo(5);
            world.levelUp(3);
            world.levelUp(4, { silent: true });
            world.charge(0, [1, 1, 1], 1);
            run(world, camera, 2);
            world.seek(3);
            world.resetSession();
            world.setViewport(800, 600, 4 / 3);
            world.setLayout(null, 1);
            world.setLayout(fallbackLayout(800, 600));
            world.showOnlyParts(['sky']);
            world.setReducedMotion(true);
            world.dispose();
        }).not.toThrow();
        // Nothing that was queued fired, and nothing was built again.
        expect(world.getState()).toMatchObject({
            bolts: 0, queued: 0, flashes: 0, rain: 0, sparks: 0,
        });
        expect(world.getState().counts).toMatchObject({ strikes: 0, arcs: 0, quads: 0 });
        expect(scene.children).toHaveLength(0);
        expect(Object.keys(world.parts)).toHaveLength(0);
    });
});
