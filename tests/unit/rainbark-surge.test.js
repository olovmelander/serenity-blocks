/**
 * Rainbark — the grove builds with play (GROVE_SURGE and the shared GameplaySurge): nothing the
 * board starts is cut or restarted by the next beat (a second Moult, a second Floor, a gap shutting,
 * a ring cleared again, a level inside a Climb), a long chain opens the canopy wider and pours more
 * light than its first clear, and the grove breathes back to calm once the hands rest. The late
 * perfect clear is the crown on its clear, and a T-spin that clears nothing still turns some bark.
 *
 * Relations, not tuning numbers: constants are imported; the assertions are orders and bounds.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { REST_RIG, RainbarkWorld, fovForAspect } from '../../src/themes/rainbark/rainbark-world.js';
import { RainbarkDirector } from '../../src/themes/rainbark/rainbark-director.js';
import { RainbarkEvents, REBLAZE_AFTER, MOULT_SWEPT } from '../../src/themes/rainbark/rainbark-events.js';
import {
    FLOOR, GAP, MOULT, SHED, floorEnvelope,
} from '../../src/themes/rainbark/rainbark-core.js';
import { fallbackLayout } from '../../src/themes/rainbark/rainbark-composition.js';

function makeWorld(quality = 'Low', { at = 10, level = 4 } = {}) {
    const width = 1600;
    const height = 900;
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
    return { world, camera };
}

function step(world, camera, dt, during = null) {
    const sim = {
        time: world.time + dt, delta: dt, pointerX: 0, pointerY: 0,
    };
    world.updateCamera(camera, sim);
    during?.();
    world.update(sim, camera);
}

const run = (world, camera, seconds, dt = 1 / 30, each = null) => {
    for (let t = 0; t < seconds - 1e-9; t += dt) {
        step(world, camera, dt);
        each?.();
    }
};

const lockAt = (u, rows, { hardDrop = true, distance = 12 } = {}) => ({
    player: 0, rows, u, hardDrop, distance, color: null, shape: 'O', cells: null, screen: null,
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
const bottom = (n) => Array.from({ length: n }, (_, k) => 19 - k);

/** A chain of `n` clearing hard drops `gap` seconds apart (the combo rising with it). */
function chain(world, camera, n, gap = 0.64, from = 1) {
    for (let i = 0; i < n; i++) {
        const combo = from + i;
        step(world, camera, 1 / 30, () => {
            world.onLock(lockAt(0.3 + 0.05 * (i % 5), [18, 19]));
            world.onClear(clearOf(bottom(1 + (i % 3)), 1 + (i % 3), { combo }));
            world.onCombo(combo);
        });
        run(world, camera, gap - 1 / 30);
    }
}

describe('Rainbark surge: a beat never cuts what is still lit', () => {
    it('a single right after a quad never closes the light it opened', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 1 / 30, () => {
            world.onLock(lockAt(0.9, [16, 17, 18, 19]));
            world.onClear(clearOf(bottom(4), 4));
        });
        run(world, camera, 0.4);
        const before = { level: world.heat.level, fleck: world.u.fleckLight.value };
        step(world, camera, 1 / 30, () => {
            world.onLock(lockAt(0.2, [19], { hardDrop: false }));
            world.onClear(clearOf([19], 1, { combo: 2 }));
        });
        expect(world.heat.level).toBeGreaterThanOrEqual(before.level);
        expect(world.u.fleckLight.value).toBeGreaterThanOrEqual(before.fleck - 1e-6);
    });

    it('a second quad inside the Moult re-strips from the top instead of restarting it', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 1 / 30, () => world.onClear(clearOf(bottom(4), 4)));
        const first = world.events.moult.t0;
        // Inside its front: fed, nothing moves.
        run(world, camera, MOULT_SWEPT * 0.5);
        step(world, camera, 1 / 30, () => world.onClear(clearOf(bottom(4), 4)));
        expect(world.events.moult.t0).toBe(first);
        expect(world.events.moult.t1).toBe(first);
        // Once the grove stands stripped (and its colour is climbing back): a second front.
        run(world, camera, MOULT.ripenAt + 0.5);
        const irisBefore = world.getPostState().iris;
        const at = world.time + 1 / 30;
        step(world, camera, 1 / 30, () => world.onClear(clearOf(bottom(4), 4)));
        const m = world.events.moult;
        // (What stood stripped stays stripped: the base front is never later than the first.)
        expect(m.t0).toBe(first);
        expect(m.t1).toBeCloseTo(at, 6);
        // The iris never jumps open, and closes again only by easing.
        let last = world.getPostState().iris;
        expect(last).toBeLessThanOrEqual(irisBefore + 0.003);
        let biggest = 0;
        run(world, camera, 1.5, 1 / 60, () => {
            const { iris } = world.getPostState();
            biggest = Math.max(biggest, Math.abs(iris - last));
            last = iris;
        });
        expect(biggest).toBeLessThan(0.012);
        // The near groups never fall back to the grove's age for a second.
        expect(world.youngAt(world.time)).toBeGreaterThan(0.99);
    });

    it('a second perfect clear holds the Floor down instead of snapping the mist back up', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 1 / 30, () => world.onClear(clearOf([], 1, { perfect: true, crown: true })));
        run(world, camera, FLOOR.hold + 1.5);
        const drain = world.u.drain.value;
        expect(drain).toBeGreaterThan(0);
        expect(drain).toBeLessThan(1);
        step(world, camera, 1 / 30, () => world.onClear(clearOf([], 1, { perfect: true, crown: true })));
        // (No further than one frame of its own return.)
        expect(world.u.drain.value).toBeGreaterThanOrEqual(drain - 0.01);
        run(world, camera, FLOOR.drain + 0.2);
        expect(world.u.drain.value).toBeCloseTo(1, 3);
        expect(floorEnvelope(world.time - world.floorAt)).toBeCloseTo(1, 3);
    });

    it('a gap shutting on the Set opens again from where it stands', () => {
        const { world, camera } = makeWorld();
        for (let n = 2; n <= 4; n++) step(world, camera, 1 / 30, () => world.onCombo(n));
        run(world, camera, GAP.open + 0.3);
        step(world, camera, 1 / 30, () => world.onCombo(0));
        run(world, camera, 2 * GAP.setStagger + GAP.close * 0.5);
        const shutting = world.gapOpenAt(0, world.time);
        expect(shutting).toBeGreaterThan(0.05);
        expect(shutting).toBeLessThan(0.95);
        world.onCombo(2);
        expect(world.gapOpenAt(0, world.time)).toBeCloseTo(shutting, 4);
        run(world, camera, GAP.open + 0.1);
        expect(world.gapOpenAt(0, world.time)).toBeCloseTo(1, 3);
    });

    it('a ring cleared again re-blazes where it stands instead of taking a second slot', () => {
        const ev = new RainbarkEvents();
        const g = {
            code: 1, yC: 60, halfH: 0.3, lo: 0, hi: 0, thetaL: 1, span: -1, strength: 1,
        };
        const first = ev.girdle(0, g);
        ev.girdle(SHED.bare + 0.1, { ...g, yC: 60.05 });
        expect(ev.girdles).toHaveLength(1);
        // (Still blazing: fed, its blaze runs on.)
        expect(first.blaze).toBe(0);
        ev.girdle(REBLAZE_AFTER + 0.1, { ...g, yC: 59.95 });
        expect(ev.girdles).toHaveLength(1);
        expect(first.blaze).toBeCloseTo(REBLAZE_AFTER + 0.1, 6);
        expect(first.t0).toBe(0);
        // A ring a row higher is a ring of its own.
        ev.girdle(REBLAZE_AFTER + 0.2, { ...g, yC: 61 });
        expect(ev.girdles).toHaveLength(2);
    });

    it('a level inside a Climb rises on from where it ends, never snapping the zone', () => {
        const { world, camera } = makeWorld('Low', { level: 2 });
        step(world, camera, 1 / 30, () => world.levelUp(3));
        run(world, camera, 1.75);
        const mid = world.zoneAt(world.time).mix;
        expect(mid).toBeGreaterThan(0.05);
        expect(mid).toBeLessThan(0.95);
        let lastY = world.heightAt(world.time);
        let jump = 0;
        step(world, camera, 1 / 30, () => world.levelUp(4));
        run(world, camera, 8, 1 / 30, () => {
            const y = world.heightAt(world.time);
            jump = Math.max(jump, Math.abs(y - lastY));
            lastY = y;
        });
        // (Rising a storey over 3.5 s moves well under a metre a frame.)
        expect(jump).toBeLessThan(0.5);
        expect(world.climb).toBeNull();
        expect(world.level).toBe(4);
    });
});

describe('Rainbark surge: the canopy opens with play and breathes back', () => {
    it('a long chain opens the canopy wider and pours more light than its first clear', () => {
        const { world, camera } = makeWorld();
        // (The same stretch of the clock with no play, for the tide's own light.)
        const twin = makeWorld();
        const light = () => {
            run(twin.world, twin.camera, world.time - twin.world.time);
            return world.u.fleckLight.value / twin.world.u.fleckLight.value;
        };
        chain(world, camera, 1);
        const first = {
            level: world.heat.level,
            fleck: light(),
            radius: world.events.gaps[0].radius,
            iris: world.getPostState().iris,
            sat: world.getPostState().sat,
        };
        chain(world, camera, 11, 0.64, 2);
        expect(world.heat.level).toBeGreaterThan(first.level + 0.4);
        expect(world.heat.stage).toBe(3);
        expect(light()).toBeGreaterThan(first.fleck * 1.1);
        expect(world.events.gaps[0].radius).toBeGreaterThan(first.radius * 1.1);
        expect(world.getPostState().sat).toBeGreaterThan(first.sat);
        // (The iris closes a little as the light pours in, so the shade stays deep.)
        expect(world.getPostState().iris).toBeLessThan(first.iris);
        expect(world.getPostState().iris).toBeGreaterThan(2 ** -MOULT.iris - 1e-9);
        // The canopy's wind has run ahead of the clock, and the bark keeps more bands.
        expect(world.windLead).toBeGreaterThan(1);
    });

    it('breathes back to calm once the hands rest', () => {
        const { world, camera } = makeWorld();
        const twin = makeWorld();
        chain(world, camera, 10);
        expect(world.heat.stage).toBeGreaterThanOrEqual(2);
        run(world, camera, 12, 1 / 15);
        // (The same stretch of the clock with no play, for the tide's own light.)
        run(twin.world, twin.camera, world.time - twin.world.time, 1 / 15);
        expect(world.heat.level).toBeLessThan(0.1);
        expect(world.heat.stage).toBe(0);
        expect(world.getPostState().iris).toBeCloseTo(1, 2);
        expect(world.u.fleckLight.value / twin.world.u.fleckLight.value).toBeLessThan(1.02);
        expect(world.getPostState().sat / twin.world.getPostState().sat).toBeLessThan(1.01);
    });

    it('a back-to-back clear bursts the Sunshower, more for every step of the run', () => {
        const peakRain = (steps) => {
            const { world, camera } = makeWorld();
            world.onB2B(steps);
            step(world, camera, 1 / 30, () => world.onClear(clearOf(bottom(2), 2, { tspin: true, b2b: true })));
            let peak = 0;
            run(world, camera, 1.5, 1 / 30, () => { peak = Math.max(peak, world.u.rain.value - world.rain); });
            return peak;
        };
        const one = peakRain(0);
        expect(one).toBeGreaterThan(0.2);
        expect(peakRain(2)).toBeGreaterThan(one);
    });
});

describe('Rainbark surge: the crown and the empty spin', () => {
    it('the director resolves a perfect clear settled after its clear as the crown on it', () => {
        const clears = [];
        const spins = [];
        const director = new RainbarkDirector({
            sink: {
                clear: (c) => clears.push({ ...c, rows: [...c.rows] }),
                spin: (c) => spins.push({ ...c, rows: [...c.rows] }),
            },
        });
        const I = {
            shape: [[1, 1, 1, 1]], x: 3, y: 23, type: 'I',
        };
        director.onPieceLock({ piece: I });
        director.onLineClear({ lineCount: 4, clearedRows: [23, 22, 21, 20], cascadeCount: 1 });
        director.flush();
        director.onPerfectClear({ depth: 4 });
        director.flush();
        expect(clears).toHaveLength(2);
        expect(clears[0]).toMatchObject({ lines: 4, crown: false, perfect: false });
        expect(clears[1]).toMatchObject({ perfect: true, crown: true, rows: [] });
        // In its own clear's frame it rides on that clear.
        director.onPieceLock({ piece: I });
        director.onLineClear({ lineCount: 4, clearedRows: [23, 22, 21, 20], cascadeCount: 1 });
        director.onPerfectClear({ depth: 1 });
        director.flush();
        expect(clears[2]).toMatchObject({ lines: 4, perfect: true, crown: false });
        // A T-spin that clears nothing is an empty spin, not a clear.
        const T = {
            shape: [[0, 1, 0], [1, 1, 1]], x: 3, y: 22, type: 'T',
        };
        director.onPieceLock({ piece: T });
        director.onTSpin({ lineCount: 0 });
        director.flush();
        expect(clears).toHaveLength(3);
        expect(spins).toHaveLength(1);
        expect(spins[0].rows.length).toBeGreaterThan(0);
    });

    it('the crown flares the canopy and opens the Floor without clearing anything again', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 1 / 30, () => world.onClear(clearOf(bottom(4), 4)));
        const { clears, lines } = world.counts;
        const { sheds } = world;
        run(world, camera, 0.36);
        const fleck = world.u.fleckLight.value;
        step(world, camera, 1 / 30, () => world.onClear(clearOf([], 1, { perfect: true, crown: true })));
        expect(world.counts.clears).toBe(clears);
        expect(world.counts.lines).toBe(lines);
        expect(world.counts.perfects).toBe(1);
        expect(world.sheds).toBe(sheds);
        // (The Moult the quad began is not begun again.)
        expect(world.events.moult.t1).toBe(world.events.moult.t0);
        run(world, camera, 0.6);
        expect(world.u.fleckLight.value).toBeGreaterThan(fleck);
        expect(world.u.drain.value).toBeGreaterThan(0);
    });

    it('a T-spin that clears nothing unwinds half a turn that heals again', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 1 / 30, () => {
            world.onLock(lockAt(0.3, [12, 13], { hardDrop: false }));
            world.onSpin({ player: 0, rows: [12, 13], u: 0.3 });
        });
        expect(world.counts.spins).toBe(1);
        expect(world.u.helixCount.value).toBe(1);
        expect(world.events.helices[0].turns).toBeLessThan(1);
        run(world, camera, 10);
        expect(world.u.helixCount.value).toBe(0);
    });
});
