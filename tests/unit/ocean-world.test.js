/**
 * Ocean — the real world (ocean-world.js), built without a GPU and driven through the calls the
 * theme makes: what each gameplay event leaves in the uniform tables the shaders read, and the
 * invariants that keep a long session sound (replay, capacity, the clock's drift).
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { OCEAN_PARTS, OceanWorld } from '../../src/themes/ocean/ocean-world.js';
import {
    CALLS, HUSH_HOLD, NEVER, PASS_SECONDS, RING_LIVE, RING_SLOTS, SCARE_SLOTS, STAIN_FADE, STAIN_SLOTS, SURGE_LIVE,
    VORTEX_HOLD,
} from '../../src/themes/ocean/ocean-core.js';
import { HOURS, HOUR_SECONDS } from '../../src/themes/ocean/ocean-hours.js';
import { OCEAN_TETROMINOS } from '../../src/themes/ocean/ocean-tetrominos.js';

// Every test builds a whole world (a noise field, the plans, some twenty node materials).
vi.setConfig({ testTimeout: 60000 });

const worlds = [];
afterEach(() => {
    worlds.splice(0).forEach((w) => w.dispose());
});

function build(quality = 'High') {
    const scene = new THREE.Scene();
    const world = new OceanWorld({ scene, quality, capture: true }).build();
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.2, 420);
    world.bindCamera(camera);
    world.setViewport(1920, 1080, 16 / 9);
    world.setLayout(null, 16 / 9);
    world.seek(10);
    world.updateCamera(camera, { time: 10, delta: 0 });
    world.update({ time: 10, delta: 0 }, camera);
    worlds.push(world);
    return { world, scene, camera };
}

/** Step the world by `seconds` at a fixed 1/60. */
function run(world, camera, seconds, dt = 1 / 60) {
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i++) {
        const sim = { time: world.time + dt, delta: dt };
        world.updateCamera(camera, sim);
        world.update(sim, camera);
    }
}

const pieces = Object.values(OCEAN_TETROMINOS.colors).slice(0, 7);

describe('Ocean world: building', () => {
    it('adds every part to the scene, and takes them all away again', () => {
        const { world, scene } = build();
        expect(Object.keys(world.parts).sort()).toEqual([...OCEAN_PARTS].sort());
        expect(scene.children).toContain(world.root);
        world.showOnlyParts(['seabed']);
        expect(world.parts.seabed.mesh.visible).toBe(true);
        expect(world.parts.surface.mesh.visible).toBe(false);
        world.dispose();
        expect(scene.children).not.toContain(world.root);
        expect(world.u).toBeNull();
        world.dispose(); // twice is harmless
    });

    it('builds every tier, the lowest without jellies, and reports its pool', () => {
        ['Minimal', 'Medium', 'Extreme'].forEach((q) => {
            const { world } = build(q);
            expect(world.getState().quality).toBe(q);
            expect(world.getState().pool).toBeGreaterThan(0);
            if (q === 'Minimal') expect(world.parts.jellies).toBeUndefined();
        });
    });
});

describe('Ocean world: a lock', () => {
    it('sinks its light to the reef on its side and leaves the colonies there holding its colour', () => {
        const { world, camera } = build();
        const { cursor } = world.pool;
        world.onLock({ u: 0.1, rows: [12, 11], color: pieces[6] });
        expect(world.pool.cursor).toBeGreaterThan(cursor);
        expect(world.stains).toHaveLength(1);
        const [stain] = world.stains;
        expect(stain.x).toBeLessThan(0);
        expect(stain.release).toBe(NEVER);
        // It lands a moment later, not now.
        expect(stain.birth).toBeGreaterThan(world.time);
        expect(world.rings[0].time).toBe(stain.birth);
        run(world, camera, 1);
        expect(world.u.counts.value.x).toBe(1);
        expect(world.u.counts.value.y).toBe(1);
        expect(world.u.counts.value.w).toBeGreaterThanOrEqual(1);
        expect(world.getState().counts.locks).toBe(1);
    });

    it('lands a hard drop harder: a ring of pressure crosses the picture', () => {
        const { world, camera } = build();
        world.onLock({
            u: 0.9, rows: [18], hardDrop: true, color: pieces[0],
        });
        expect(world.stains[0].x).toBeGreaterThan(0);
        run(world, camera, 0.8);
        const shock = world.getPostState().shocks.find((s) => s.strength > 0);
        expect(shock).toBeTruthy();
        expect(shock.radius).toBeGreaterThan(0);
    });

    it('never holds more colours than the table has rows: the oldest lets go by itself', () => {
        const { world, camera } = build();
        for (let i = 0; i < STAIN_SLOTS + 8; i++) {
            world.onLock({ u: i % 2 ? 0.9 : 0.1, rows: [19 - (i % 6)], color: pieces[i % 7] });
            run(world, camera, 0.2);
        }
        expect(world.stains.length).toBeLessThanOrEqual(STAIN_SLOTS);
        expect(world.rings.length).toBeLessThanOrEqual(RING_SLOTS);
        expect(world.scares.length).toBeLessThanOrEqual(SCARE_SLOTS);
        expect(world.getState().counts.released).toBeGreaterThan(0);
        expect(world.u.counts.value.y).toBeLessThanOrEqual(STAIN_SLOTS);
    });
});

describe('Ocean world: a clear', () => {
    it('sends a current across the canyon that lets every held colour go as its front passes', () => {
        const { world, camera } = build();
        world.onLock({ u: 0.1, rows: [19], color: pieces[1] });
        world.onLock({ u: 0.9, rows: [19], color: pieces[2] });
        run(world, camera, 1.5);
        world.onClear({ rows: [19], lines: 1 });
        expect(world.surges).toHaveLength(1);
        const releases = world.stains.map((s) => s.release);
        releases.forEach((r) => expect(r).toBeLessThan(NEVER));
        // The front crosses the frame: the two sides are let go at different moments.
        expect(releases[0]).not.toBe(releases[1]);
        // The school draws out into a ribbon while the current runs.
        run(world, camera, 1.5);
        expect(world.getState().school.ribbon).toBeGreaterThan(0.5);
        run(world, camera, Math.max(SURGE_LIVE, STAIN_FADE) + 6);
        expect(world.surges).toHaveLength(0);
        expect(world.stains).toHaveLength(0);
        expect(world.getState().school.ribbon).toBeLessThan(0.2);
    });

    it('never lets a colour go before its light has landed', () => {
        const { world } = build();
        // A current born right now reaches a far stage x later than a light that is still sinking
        // lands, and one already crossing it the moment the light lands.
        world.onLock({ u: 0.1, rows: [5], color: pieces[3] });
        world.onClear({ rows: [19], lines: 1 });
        world.stains.forEach((s) => {
            if (s.release !== NEVER) expect(s.release).toBeGreaterThanOrEqual(s.birth);
        });
        // A front that has already passed a landing leaves it held for the next current.
        const { world: late } = build();
        late.onClear({ rows: [19], lines: 1 });
        late.surges[0].time -= 30;
        late.onLock({ u: 0.1, rows: [5], color: pieces[3] });
        expect(late.stains[0].release).toBe(NEVER);
    });

    it('holds the sea\'s breath on four lines, then brings the great shaft down and the school round', () => {
        const { world, camera } = build();
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        run(world, camera, HUSH_HOLD * 0.5);
        expect(world.getState().breath).toBeLessThan(0.7);
        run(world, camera, 1.5);
        expect(world.getState().beam).toBeGreaterThan(0.5);
        expect(world.getState().school.vortex).toBeGreaterThan(0.5);
        expect(world.getState().calls.whale).toBe(true);
        run(world, camera, VORTEX_HOLD + 5);
        expect(world.getState().beam).toBe(0);
        expect(world.getState().school.vortex).toBeLessThan(0.2);
        expect(world.getState().counts.quads).toBe(1);
    });
});

describe('Ocean world: a chain calls the large animals', () => {
    it('sends for a turtle, then mantas, then a whale far out, then the whale over the board', () => {
        const { world, camera } = build();
        world.onCombo(CALLS.turtle);
        expect(world.getState().calls.turtle).toBe(true);
        expect(world.getState().calls.mantas).toBe(0);
        world.onCombo(CALLS.mantas);
        expect(world.getState().calls.mantas).toBe(1);
        world.onCombo(CALLS.whaleFar);
        expect(world.getState().calls.whale).toBe(true);
        expect(world.getState().calls.whaleFar).toBe(true);
        // A louder call does not turn a whale already on its way round.
        world.onCombo(CALLS.whale);
        expect(world.getState().calls.whaleFar).toBe(true);
        run(world, camera, PASS_SECONDS.whaleFar + 1);
        world.onCombo(0);
        world.onCombo(CALLS.whale);
        expect(world.getState().calls.whaleFar).toBe(false);
        expect(world.getState().calls.whale).toBe(true);
        // In the water and casting shadows through the shafts while it passes.
        run(world, camera, PASS_SECONDS.whale * 0.45);
        expect(world.giants.live().whales).toBeGreaterThanOrEqual(1);
        expect(world.u.counts2.value.y).toBeGreaterThan(0);
        // It sings as it comes over the board.
        expect(world.getState().songs + world.songs.length).toBeGreaterThan(0);
    });

    it('lets a pass finish when the chain breaks', () => {
        const { world, camera } = build();
        world.onCombo(CALLS.turtle);
        world.onCombo(0);
        run(world, camera, PASS_SECONDS.turtle * 0.5);
        expect(world.getState().calls.turtle).toBe(true);
        expect(world.giants.live().turtles).toBeGreaterThanOrEqual(1);
    });
});

describe('Ocean world: the hours', () => {
    it('moves the light on by the clock at a fixed level, and a level-up turns it one hour more', () => {
        const { world, camera } = build();
        const start = world.hourNow();
        run(world, camera, 30, 1 / 20);
        expect(world.hourNow() - start).toBeCloseTo(30 / HOUR_SECONDS, 3);
        const before = world.hourNow();
        world.levelUp(2);
        run(world, camera, 5, 1 / 20);
        expect(world.hourNow() - before).toBeCloseTo(1 + 5 / HOUR_SECONDS, 2);
    });

    it('never turns the light back: a new run\'s first level-up steps one hour on from where it stands', () => {
        const { world, camera } = build();
        // A long run: four level-ups, each one hour forward.
        for (let level = 2; level <= 5; level++) {
            world.levelUp(level);
            run(world, camera, 4, 1 / 20);
        }
        expect(world.turn.to).toBe(4);
        // The run ends; the light stays where it is.
        world.resetSession();
        const before = world.hourNow();
        world.levelUp(1);
        expect(world.hourNow()).toBeCloseTo(before, 6);
        // The new run's level 2 is one hour on from there, not three hours back to level 2's place.
        world.levelUp(2);
        expect(world.turn.to - world.turn.from).toBeCloseTo(1, 6);
        expect(world.turn.to).toBe(5);
        // Two levels at once are two hours; a repeated level is none.
        world.levelUp(4);
        expect(world.turn.to).toBe(7);
        world.levelUp(4);
        expect(world.turn.to).toBe(7);
    });

    it('takes up a place it is handed on a rebuild, without the ceremony', () => {
        const { world } = build();
        world.levelUp(3, { silent: true, place: 7.5 });
        expect(world.getState().levelPlace).toBe(7.5);
        expect(world.level).toBe(3);
        expect(world.rings).toHaveLength(0);
        world.levelUp(2, { silent: true });
        expect(world.getState().levelPlace % 6).toBe(1);
    });

    it('holds an hour for a capture, and names where it stands', () => {
        const { world } = build();
        world.holdHour(4);
        const state = world.getState();
        expect(state.hourName).toBe(HOURS[4].name);
        expect(world.u.night.value).toBeCloseTo(HOURS[4].night, 6);
    });
});

describe('Ocean world: a long session stays sound', () => {
    it('replays exactly: the same events from the same seek leave the same tables', () => {
        const script = (world, camera) => {
            world.onLock({ u: 0.2, rows: [15], color: pieces[1] });
            run(world, camera, 0.7);
            world.onLock({
                u: 0.8, rows: [17], hardDrop: true, color: pieces[4],
            });
            run(world, camera, 0.7);
            world.onClear({ rows: [19, 18], lines: 2, tspin: true });
            world.onCombo(3);
            run(world, camera, 2);
        };
        const a = build();
        const b = build();
        script(a.world, a.camera);
        script(b.world, b.camera);
        const rows = (w) => [w.u.ringRows, w.u.stainRows, w.u.surgeRows, w.u.scareRows, w.u.shadeRows]
            .map((list) => list.map((v) => v.toArray()));
        expect(rows(a.world)).toEqual(rows(b.world));
        expect(a.world.getState().school).toEqual(b.world.getState().school);
    });

    it('drops every event once its time is up, so the tables empty again', () => {
        const { world, camera } = build();
        world.onLock({ u: 0.2, rows: [15], color: pieces[1] });
        world.onClear({ rows: [19], lines: 1 });
        run(world, camera, Math.max(RING_LIVE, SURGE_LIVE) + 1, 1 / 30);
        world.resetSession();
        run(world, camera, STAIN_FADE + 2, 1 / 30);
        expect(world.u.counts.value.toArray()).toEqual([0, 0, 0, 0]);
    });

    it('keeps the school\'s pace bounded however a ten-minute session has bent it', () => {
        const { world, camera } = build();
        world.seek(600);
        run(world, camera, 0.5);
        const phases = [];
        for (let i = 0; i < 40; i++) {
            if (i % 5 === 0) world.onClear({ rows: [19], lines: (i % 4) + 1 });
            if (i % 7 === 0) world.onCombo(i);
            run(world, camera, 1 / 60, 1 / 60);
            phases.push(world.getState().school.phase);
        }
        for (let i = 1; i < phases.length; i++) {
            const step = phases[i] - phases[i - 1];
            expect(step).toBeGreaterThan(0);
            expect(step).toBeLessThan(0.05);
        }
    });

    it('lets everything go and breaks the chain on a new run, keeping the hour', () => {
        const { world, camera } = build();
        world.onLock({ u: 0.2, rows: [19], color: pieces[1] });
        run(world, camera, 1);
        world.onCombo(4);
        const hour = world.hourNow();
        world.resetSession();
        expect(world.combo).toBe(0);
        world.stains.forEach((s) => expect(s.release).toBeLessThan(NEVER));
        expect(world.hourNow()).toBeCloseTo(hour, 6);
        world.onGameOver();
    });

    it('softens what reduced motion asks it to', () => {
        const { world, camera } = build();
        world.setReducedMotion(true);
        world.onLock({
            u: 0.9, rows: [18], hardDrop: true, color: pieces[0],
        });
        expect(world.shocks[0].strength).toBeLessThan(0.5);
        run(world, camera, 0.5);
    });
});
