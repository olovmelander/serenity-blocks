/**
 * Rainbark — the board's marks on the grove: the event table's writer, the beats the world turns
 * the director's sink calls into (the Peel, the Knock, the Shed, the Great Moult, the canopy gaps
 * and Quickening, the Set, the Unwinding, the Sunshower, the Floor), the curls they shed, and the
 * light wheel that turns with the clock.
 *
 * Relations, not tuning numbers: constants are imported; the assertions are counts, orders,
 * bounds and determinism.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { REST_RIG, RainbarkWorld, fovForAspect } from '../../src/themes/rainbark/rainbark-world.js';
import { RainbarkEvents } from '../../src/themes/rainbark/rainbark-events.js';
import {
    CURL, EVENT_ROWS, EVENT_SLOTS, FLOOR, GAP, HELIX, KNOCK, LIGHT_WHEEL, MOULT, PALETTE_ROWS, PEEL, PIECE_AGE, QUICKEN, RAIN, SET,
    SHED, TRUNK_STRIDE, floorEnvelope, lightWheelAt, packCodes, projectRest, quickenRate, recordAxis, restLens,
    trunkHeightAt, unpackCodes,
} from '../../src/themes/rainbark/rainbark-core.js';
import { fallbackLayout } from '../../src/themes/rainbark/rainbark-composition.js';

function makeWorld(quality = 'Low', {
    width = 1600, height = 900, at = 10, level = 4,
} = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new RainbarkWorld({ scene, quality, capture: true }).build();
    world.bindCamera(camera);
    world.setViewport(width, height, aspect, width, height);
    world.setLayout(fallbackLayout(width, height), aspect);
    world.seek(at);
    if (level > 1) world.levelUp(level, { silent: true });
    step(world, camera, 0);
    return { scene, camera, world };
}

/** One frame as the theme runs it (the events land between the camera and the world). */
function step(world, camera, dt, during = null) {
    const sim = {
        time: world.time + dt, delta: dt, pointerX: 0, pointerY: 0,
    };
    world.updateCamera(camera, sim);
    during?.();
    world.update(sim, camera);
}

const run = (world, camera, seconds, dt = 1 / 30) => {
    for (let t = 0; t < seconds; t += dt) step(world, camera, dt);
};

const lockAt = (u, rows, { shape = 'L', hardDrop = false, distance = 0 } = {}) => ({
    player: 0, rows, u, hardDrop, distance, color: null, shape, cells: null, screen: null,
});
const clearOf = (rows, lines = rows.length, extra = {}) => ({
    player: 0,
    rows,
    lines,
    combo: 1,
    cascade: 1,
    tspin: false,
    perfect: false,
    b2b: false,
    rowCodes: rows.flatMap((_, k) => Array.from({ length: 10 }, (__, c) => (c + k) % 7)),
    screen: null,
    ...extra,
});
const row = (world, block, i) => world.u.tables.events[EVENT_ROWS[block] + i];

describe('Rainbark events: the table writer', () => {
    const fakeTable = () => Array.from({ length: EVENT_ROWS.total }, () => new THREE.Vector4());

    it('writes each block compacted to its front and reports how many are live', () => {
        const ev = new RainbarkEvents();
        const table = fakeTable();
        for (let i = 0; i < 5; i++) {
            ev.peel(i, {
                code: 1, yTop: 60 + i, yBot: 59 + i, theta: 0.2, half: 0.15, age: PIECE_AGE[i], radius: 2.5, hard: 0,
            });
        }
        ev.knock(4.9, 1, 58, 0.7);
        const counts = ev.write(table, 5);
        expect(counts.peels).toBe(5);
        expect(counts.knocks).toBe(1);
        for (let i = 0; i < 5; i++) {
            expect(table[EVENT_ROWS.peels + i * 3].x).toBe(1);
            expect(table[EVENT_ROWS.peels + i * 3].w).toBe(i);
            expect(table[EVENT_ROWS.peels + i * 3 + 1].z).toBeCloseTo(PIECE_AGE[i], 6);
        }
        expect(table[EVENT_ROWS.knocks].y).toBe(58);
    });

    it('keeps a slot for the band in flight: past PEEL.held the oldest is told to erode', () => {
        const ev = new RainbarkEvents();
        for (let i = 0; i < EVENT_SLOTS.peels + 4; i++) {
            ev.peel(i * 0.1, {
                code: 1, yTop: 60, yBot: 59, theta: 0, half: 0.1, age: 0, radius: 2, hard: 0,
            });
        }
        expect(ev.peels.length).toBeLessThanOrEqual(EVENT_SLOTS.peels);
        const standing = ev.peels.filter((p) => p.kill === Infinity).length;
        expect(standing).toBeLessThanOrEqual(PEEL.held);
        // A told band is gone PEEL.kill after it was told; a standing one lives out its life.
        const t = 2 + PEEL.kill + 0.1;
        ev.prune(t);
        expect(ev.peels.every((p) => p.kill === Infinity || t < p.kill + PEEL.kill)).toBe(true);
        ev.prune(1e4);
        expect(ev.peels).toHaveLength(0);
    });

    it('knocks a trunk at most once per KNOCK.gap (a newer one restarts its slot)', () => {
        const ev = new RainbarkEvents();
        ev.knock(0, 1, 50, 1);
        ev.knock(KNOCK.gap * 0.5, 1, 52, 1);
        expect(ev.knocks).toHaveLength(1);
        expect(ev.knocks[0].y0).toBe(52);
        ev.knock(KNOCK.gap * 0.6, 2, 50, 1);
        expect(ev.knocks).toHaveLength(2);
        ev.prune(10);
        expect(ev.knocks).toHaveLength(0);
    });

    it('counts the open gaps as a prefix in station order', () => {
        const ev = new RainbarkEvents();
        const table = fakeTable();
        ev.gaps[0].open = 1;
        ev.gaps[1].open = 0.5;
        ev.gaps[3].open = 0.2;
        expect(ev.write(table, 0).gaps).toBe(4);
        ev.reset();
        expect(ev.write(table, 0).gaps).toBe(0);
    });

    it('heals every helix on a new level, and lets it go HELIX.heal later', () => {
        const ev = new RainbarkEvents();
        ev.helix(0, {
            code: 1, yTop: 60, turns: 2, pitch: HELIX.pitch.elder, theta: 0, width: HELIX.width.elder,
        });
        ev.prune(500);
        expect(ev.helices).toHaveLength(1);
        ev.healHelices(500);
        ev.prune(500 + HELIX.heal + 0.01);
        expect(ev.helices).toHaveLength(0);
    });
});

describe('Rainbark events: the core maths', () => {
    it('packs five 3-bit codes into one float exactly, and back', () => {
        const codes = [0, 7, 3, 5, 1, 6, 2, 4, 7, 0];
        for (const from of [0, 5]) {
            const p = packCodes(codes, from);
            expect(Math.fround(p)).toBe(p);
            expect(unpackCodes(p)).toEqual(codes.slice(from, from + 5));
        }
        expect(packCodes([7, 7, 7, 7, 7])).toBeLessThan(2 ** 15);
    });

    it('casts a screen row onto a trunk at the height the rest lens shows it there', () => {
        const { world } = makeWorld('Low');
        const { near } = world.parts.trunks;
        const lens = restLens(world.aspect);
        const eyeY = world.heightAt(world.time);
        const out = [0, 0];
        const axis = [0, 0, 0];
        for (const sy of [0.2, 0.5, 0.8]) {
            const theta = world.band.lanes[0].theta0 + 0.2;
            const [y, r] = trunkHeightAt(near.data, lens, sy, theta, eyeY, 0, out);
            recordAxis(near.data, y, axis, 0);
            const p = projectRest(lens, axis[0] + r * Math.cos(theta), y, axis[1] + r * Math.sin(theta), eyeY);
            expect(p[1]).toBeCloseTo(sy, 3);
        }
    });

    it('quickens the groups in order (the Elder first, the far grove last) and caps the rate', () => {
        expect(quickenRate(0, 1)).toBe(1);
        expect(quickenRate(0, QUICKEN.join[0])).toBeGreaterThan(1);
        expect(quickenRate(1, QUICKEN.join[0])).toBe(1);
        expect(quickenRate(3, QUICKEN.join[3] - 1)).toBe(1);
        expect(quickenRate(3, QUICKEN.join[3])).toBeLessThan(quickenRate(0, QUICKEN.join[3]));
        expect(quickenRate(0, QUICKEN.cap + 5)).toBe(quickenRate(0, QUICKEN.cap));
    });

    it('drains the Floor and lets it back: 0 before, 1 while it holds, 0 after', () => {
        expect(floorEnvelope(-1)).toBe(0);
        expect(floorEnvelope(FLOOR.drain + 0.01)).toBeCloseTo(1, 3);
        expect(floorEnvelope(FLOOR.hold - 0.01)).toBeCloseTo(1, 3);
        expect(floorEnvelope(FLOOR.back + 0.01)).toBe(0);
        expect(floorEnvelope((FLOOR.hold + FLOOR.back) / 2)).toBeGreaterThan(0);
    });
});

describe('Rainbark events: the light turns with the clock, whatever the level', () => {
    it('is on its way most of each step, holding only LIGHT_WHEEL.rest at either end', () => {
        const W = LIGHT_WHEEL;
        const at = (s) => lightWheelAt(s * W.step).mix;
        expect(at(0.05)).toBe(0);
        expect(at(0.5)).toBeCloseTo(0.5, 6);
        expect(at(0.95)).toBe(1);
        expect(lightWheelAt(W.step * W.moods.length).a).toBe(0);
    });

    it('moves the palette within the first minute at a fixed level, with no gameplay at all', () => {
        const { world, camera } = makeWorld('Low', { at: 0, level: 4 });
        const table = world.u.tables.palette;
        const { fleck } = PALETTE_ROWS;
        const before = table[fleck].clone();
        run(world, camera, 60, 0.5);
        expect(world.level).toBe(4);
        const after = table[fleck];
        expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y) + Math.abs(after.z - before.z)).toBeGreaterThan(1e-3);
        // A step in, it stands on the next mood.
        run(world, camera, LIGHT_WHEEL.step * 1.1 - 60, 0.5);
        expect(world.getState().light).toBe(LIGHT_WHEEL.moods[1].name);
    });
});

describe('Rainbark events: the beats in the world', () => {
    it('peels a band on the Elder for columns 0–4 and on Sister One for 5–9, in the piece\'s age', () => {
        const { world, camera } = makeWorld('Low');
        step(world, camera, 1 / 30, () => world.onLock(lockAt(0.2, [10, 11], { shape: 'Z' })));
        step(world, camera, 1 / 30, () => world.onLock(lockAt(0.8, [5, 6], { shape: 'S' })));
        expect(world.u.peelCount.value).toBe(2);
        const elder = row(world, 'peels', 0);
        const sister = row(world, 'peels', 3);
        expect(elder.x).toBe(1);
        expect(sister.x).toBe(2);
        expect(row(world, 'peels', 1).z).toBeCloseTo(PIECE_AGE[2], 6);
        // A band is taller than the rows it marks, and the higher rows sit higher on the trunk.
        expect(elder.y).toBeGreaterThan(elder.z);
        expect(sister.z).toBeGreaterThan(elder.z);
    });

    it('knocks the trunk and shakes flakes on a hard drop, harder from further', () => {
        const { world, camera } = makeWorld('Low');
        step(world, camera, 1 / 30, () => world.onLock(lockAt(0.2, [18, 19], { hardDrop: true, distance: KNOCK.reach })));
        expect(world.u.knockCount.value).toBe(1);
        expect(row(world, 'knocks', 0).w).toBeCloseTo(1, 6);
        run(world, camera, KNOCK.life + 0.1);
        expect(world.u.knockCount.value).toBe(0);
    });

    it('girdles both near trunks per cleared row, lowest first, and packs the row\'s codes', () => {
        const { world, camera } = makeWorld('Low');
        const C = clearOf([19, 18]);
        step(world, camera, 1 / 30, () => world.onClear(C));
        const live = world.events.girdles;
        expect(live.length).toBeGreaterThanOrEqual(4);
        expect(new Set(live.map((g) => g.code)).has(1)).toBe(true);
        expect(new Set(live.map((g) => g.code)).has(2)).toBe(true);
        expect(live[0].lo).toBe(packCodes(C.rowCodes, 0));
        // The second row starts SHED.stagger later (lowest first).
        const elder = live.filter((g) => g.code === 1);
        expect(elder[1].t0 - elder[0].t0).toBeCloseTo(SHED.stagger, 6);
        // Each arc runs screen left to right (θ falling through the eye's bearing).
        expect(elder[0].span).toBeLessThan(0);
    });

    it('moults on four lines (no rings), dims the iris and leaves the near groups younger', () => {
        const { world, camera } = makeWorld('Low');
        step(world, camera, 1 / 30, () => world.onClear(clearOf([19, 18, 17, 16], 4)));
        expect(world.events.moult.active).toBe(1);
        expect(world.events.girdles).toHaveLength(0);
        run(world, camera, 1.2);
        expect(world.getPostState().iris).toBeLessThan(1);
        expect(world.getPostState().iris).toBeGreaterThanOrEqual(2 ** -MOULT.iris - 1e-9);
        run(world, camera, 3);
        const bias = world.u.ageBias.value;
        expect(bias.x).toBeLessThan(bias.w);
    });

    it('opens one gap per link in station order and shuts them in reverse on the Set', () => {
        const { world, camera } = makeWorld('Low');
        for (let n = 2; n <= 5; n++) step(world, camera, 1 / 30, () => world.onCombo(n));
        run(world, camera, GAP.open + 0.5);
        expect(world.u.gapCount.value).toBe(4);
        for (let i = 0; i < 4; i++) expect(row(world, 'gaps', i).w).toBeCloseTo(1, 3);
        step(world, camera, 1 / 30, () => world.onCombo(0));
        // The last opened shuts first.
        expect(world.gapClose[3]).toBeLessThan(world.gapClose[0]);
        run(world, camera, 4 * GAP.stagger + GAP.close + 0.2);
        expect(world.u.gapCount.value).toBe(0);
        expect(world.counts.releases).toBe(1);
    });

    it('quickens the bark\'s clocks while a chain lives and lets them settle after', () => {
        const a = makeWorld('Low');
        const b = makeWorld('Low');
        step(a.world, a.camera, 1 / 30, () => a.world.onCombo(QUICKEN.cap));
        run(a.world, a.camera, 4);
        run(b.world, b.camera, 4 + 1 / 30);
        expect(a.world.clocks[0]).toBeGreaterThan(b.world.clocks[0] + 4);
        step(a.world, a.camera, 1 / 30, () => a.world.onCombo(0));
        run(a.world, a.camera, 3);
        expect(a.world.rates[0]).toBeCloseTo(1, 2);
        // The Set: the quickened bark's sheen dips while it sets, and comes back.
        expect(a.world.lastRelease.peak).toBe(QUICKEN.cap);
        run(a.world, a.camera, SET.sheenFor + 0.5);
        expect(a.world.u.sheenK.value).toBeGreaterThan(0);
    });

    it('unwinds a helix on a T-spin, one turn a line, on the T\'s side', () => {
        const { world, camera } = makeWorld('Low');
        step(world, camera, 1 / 30, () => {
            world.onLock(lockAt(0.8, [12, 13], { shape: 'T' }));
            world.onClear(clearOf([13, 12], 2, { tspin: true }));
        });
        expect(world.u.helixCount.value).toBe(1);
        const h = row(world, 'helices', 0);
        expect(h.x).toBe(2);
        expect(h.z).toBe(2);
        expect(world.events.girdles).toHaveLength(0);
    });

    it('brings the rain and the wet with a back-to-back run, and dries after it breaks', () => {
        const { world, camera } = makeWorld('Low');
        step(world, camera, 1 / 30, () => world.onB2B(3));
        run(world, camera, RAIN.fadeIn + 0.5);
        expect(world.u.rain.value).toBeCloseTo(1, 3);
        expect(world.u.wet.value).toBeGreaterThan(RAIN.wet[3] * 0.9);
        step(world, camera, 1 / 30, () => world.onB2B(0));
        run(world, camera, RAIN.fadeOut + 0.5);
        expect(world.u.rain.value).toBe(0);
        expect(world.u.wet.value).toBeLessThan(RAIN.wet[3]);
    });

    it('drains the mist below the floor on a perfect clear, then lets it back', () => {
        const { world, camera } = makeWorld('Low');
        const tide = world.u.tide.value;
        step(world, camera, 1 / 30, () => world.onClear(clearOf([], 1, { perfect: true })));
        run(world, camera, FLOOR.drain + 0.5);
        expect(world.u.drain.value).toBeCloseTo(1, 3);
        expect(world.u.tide.value).toBeLessThan(0);
        run(world, camera, FLOOR.back);
        expect(world.u.drain.value).toBe(0);
        expect(Math.abs(world.u.tide.value - tide)).toBeLessThan(20);
    });

    it('drops every curl and mark in flight on a seek, and replays the same way', () => {
        const play = () => {
            const { world, camera } = makeWorld('Low', { at: 30 });
            step(world, camera, 1 / 30, () => world.onLock(lockAt(0.3, [8, 9], { hardDrop: true, distance: 9 })));
            run(world, camera, 0.5);
            step(world, camera, 1 / 30, () => world.onClear(clearOf([19])));
            run(world, camera, 1);
            return world;
        };
        const a = play();
        const b = play();
        expect(Array.from(a.parts.curls.geometry.getAttribute('aCurlA').data.array))
            .toEqual(Array.from(b.parts.curls.geometry.getAttribute('aCurlA').data.array));
        expect(a.u.tables.events.map((v) => v.toArray())).toEqual(b.u.tables.events.map((v) => v.toArray()));
        a.seek(100);
        expect(a.events.peels).toHaveLength(0);
        expect(a.events.girdles).toHaveLength(0);
    });

    it('keeps the curls\' pools the tier\'s size, spawning the grove\'s own shedding by itself', () => {
        const { world, camera } = makeWorld('Medium');
        const { curls } = world.parts;
        expect(curls.ambient).toBeGreaterThan(0);
        expect(curls.geometry.instanceCount).toBe(curls.ambient + curls.events);
        run(world, camera, 2);
        const data = curls.geometry.getAttribute('aCurlA').data.array;
        let live = 0;
        for (let i = 0; i < curls.ambient; i++) if (data[i * CURL.stride + 6] > 0) live += 1;
        expect(live).toBeGreaterThan(0);
    });

    it('never grows the scene through every beat', () => {
        const { world, scene, camera } = makeWorld('Low');
        let count = 0;
        scene.traverse(() => { count += 1; });
        step(world, camera, 1 / 30, () => world.onLock(lockAt(0.2, [10, 11], { hardDrop: true, distance: 6 })));
        step(world, camera, 1 / 30, () => world.onClear(clearOf([19, 18, 17])));
        step(world, camera, 1 / 30, () => world.onCombo(4));
        step(world, camera, 1 / 30, () => world.onCombo(0));
        step(world, camera, 1 / 30, () => world.onB2B(2));
        step(world, camera, 1 / 30, () => world.onClear(clearOf([19, 18, 17, 16], 4)));
        step(world, camera, 1 / 30, () => world.onClear(clearOf([], 1, { perfect: true })));
        run(world, camera, 2);
        let after = 0;
        scene.traverse(() => { after += 1; });
        expect(after).toBe(count);
        expect(TRUNK_STRIDE).toBe(16);
    });
});
