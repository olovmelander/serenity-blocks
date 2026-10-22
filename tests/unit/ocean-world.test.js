/**
 * Ocean — the real world (ocean-world.js), built without a GPU and driven through the calls the
 * theme makes: what each gameplay event leaves in the uniform tables the shaders read, and the
 * invariants that keep a long session sound (replay, capacity, the clock's drift).
 */
import { readFileSync } from 'node:fs';
import {
    afterEach, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { OCEAN_PARTS, OceanWorld } from '../../src/themes/ocean/ocean-world.js';
import { parseCreatures, useCreatures } from '../../src/themes/ocean/ocean-creatures.js';
import {
    CALLS, HUSH_HOLD, NEVER, PASS_SECONDS, RING_LIVE, RING_SLOTS, SCARE_SLOTS, STAIN_FADE, STAIN_SLOTS, SURGE_LIVE,
    VORTEX_HOLD,
} from '../../src/themes/ocean/ocean-core.js';
import { HOURS, HOUR_SECONDS } from '../../src/themes/ocean/ocean-hours.js';
import { OCEAN_TETROMINOS } from '../../src/themes/ocean/ocean-tetrominos.js';

// Every test builds a whole world (a noise field, the plans, some twenty node materials).
vi.setConfig({ testTimeout: 60000 });

// The large animals' bodies, read from disk as the theme would fetch them.
beforeAll(() => {
    useCreatures(parseCreatures(readFileSync(new URL('../../src/themes/ocean/assets/creatures.glb', import.meta.url))));
});

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
        expect(world.getState().calls.whaleNear).toBe(false);
        // The far whale finishes her pass, and never keeps the whale over the board away: the top
        // of the chain brings her in while the far one is still out there.
        world.onCombo(CALLS.whale);
        expect(world.getState().calls.whaleFar).toBe(true);
        expect(world.getState().calls.whaleNear).toBe(true);
        run(world, camera, PASS_SECONDS.whaleFar + 1);
        world.onCombo(0);
        world.onCombo(CALLS.whale);
        expect(world.getState().calls.whaleFar).toBe(false);
        expect(world.getState().calls.whale).toBe(true);
        // In the water and casting shadows through the shafts while it passes.
        run(world, camera, PASS_SECONDS.whale * 0.45);
        expect(world.giants.live().humpback).toBeGreaterThanOrEqual(1);
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
        expect(world.giants.live().turtle).toBeGreaterThanOrEqual(1);
    });
});

describe('Ocean world: the sea\'s own visitors', () => {
    /** Kinds in the water at a time, seeking straight there (a capture's way). */
    const inWater = (world, camera, time) => {
        world.seek(time);
        world.updateCamera(camera, { time, delta: 0 });
        world.update({ time, delta: 0 }, camera);
        const live = world.giants.live();
        return Object.keys(live).filter((k) => live[k] > 0);
    };

    it('sends its visitors on its own schedule, and the same ones again after a seek', () => {
        const { world, camera } = build();
        const seen = new Set();
        const at = [];
        for (let t = 0; t < 900; t += 7) {
            const kinds = inWater(world, camera, t);
            kinds.forEach((k) => seen.add(k));
            at.push(kinds.join(','));
            // What the state says is in the water is what is drawn.
            if (world.getState().visits.length) expect(kinds.length).toBeGreaterThan(0);
        }
        expect(seen.size).toBeGreaterThanOrEqual(4);
        // Some of the time the blue is empty.
        expect(at.filter((a) => a === '').length).toBeGreaterThan(5);
        // A seek back lands on the same visitors (they are a function of the clock).
        expect(inWater(world, camera, 7 * 40).join(',')).toBe(at[40]);
    });

    it('keeps one schedule per seed: a capture\'s is seed 1, a rebuild hands its own on', () => {
        const scene = new THREE.Scene();
        const a = new OceanWorld({ scene, capture: true });
        const b = new OceanWorld({ scene, capture: false, visitSeed: 77 });
        const c = new OceanWorld({ scene, capture: false, visitSeed: 77 });
        expect(a.visitSeed).toBe(1);
        expect(b.visits.until(600).map((v) => v.act)).toEqual(c.visits.until(600).map((v) => v.act));
        expect(b.getState().visitSeed).toBe(77);
    });

    it('lets a capture name one act, alone in the water', () => {
        const { world, camera } = build();
        world.setVisits(false);
        const visit = world.addVisit('eagleRays', 0, 4, -1);
        visit.start = 20 - visit.seconds * 0.5;
        expect(inWater(world, camera, 20)).toEqual(['eagleRay']);
        expect(world.giants.live().eagleRay).toBe(visit.members.length);
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

describe('Ocean world: play builds instead of popping', () => {
    /** The tray's Fever: twelve clearing locks 0.64 s apart (a T-spin, a four-wave cascade), a quad. */
    const fever = (world, camera, from, to) => {
        const plan = [1, 1, 2, 1, 2, 2, 3, 'tspin', 2, 'cascade', 3, 4];
        for (let n = from; n < to; n++) {
            const step = plan[n];
            const lines = typeof step === 'number' ? step : 2;
            world.onLock({
                u: [0.2, 0.8, 0.4, 0.6][n % 4], rows: [19], hardDrop: true, color: pieces[n % 7],
            });
            world.onClear({
                rows: [19, 18, 17, 16].slice(0, lines), lines, tspin: step === 'tspin', combo: n + 1, cascade: 1,
            });
            world.onCombo(n + 1);
            if (step === 'cascade') {
                for (let w = 2; w <= 4; w++) {
                    run(world, camera, 0.36);
                    world.onClear({
                        rows: [19], lines: 1, combo: n + 1, cascade: w,
                    });
                }
                run(world, camera, 0.2);
            } else run(world, camera, 0.64);
        }
    };

    it('never lets a weak event cut the light of a strong one: a single after a quad, a second quad', () => {
        const { world, camera } = build();
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        run(world, camera, 1.5);
        const lit = world.getState().beam;
        const { surge } = world.getState();
        expect(lit).toBeGreaterThan(0.9);
        // A single right after: the great shaft and the overdrive carry on.
        world.onLock({ u: 0.3, rows: [19], color: pieces[2] });
        world.onClear({ rows: [19], lines: 1 });
        run(world, camera, 1 / 60);
        expect(world.getState().beam).toBeGreaterThanOrEqual(lit * 0.98);
        expect(world.getState().surge).toBeGreaterThan(surge * 0.98);
        // A second quad while the shaft stands: it never drops through the hush, the school stays
        // wound, and the shaft holds longer than the first alone would have.
        const before = world.getState().surge;
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        for (let i = 0; i < 40; i++) {
            run(world, camera, 1 / 60);
            expect(world.getState().beam).toBeGreaterThan(0.9);
            expect(world.getState().school.vortex).toBeGreaterThan(0.5);
        }
        // The overdrive is raised again, never set back.
        expect(world.getState().surge).toBeGreaterThan(before + 0.15);
        run(world, camera, VORTEX_HOLD - 1.5);
        expect(world.getState().beam).toBeGreaterThan(0.5);
    });

    it('reads a long chain hotter than its first clear, and breathes back to calm when the hands rest', () => {
        const { world, camera } = build();
        const hour = world.u.fluor.value;
        fever(world, camera, 0, 1);
        const first = {
            heat: world.getState().heat.level,
            fluor: world.u.fluor.value,
            beam: world.u.beam.value.w,
            vortex: world.getState().school.vortex,
        };
        fever(world, camera, 1, 11);
        const late = world.getState();
        expect(late.heat.level).toBeGreaterThan(first.heat + 0.4);
        expect(late.heat.fever).toBeGreaterThan(0.5);
        expect(late.heat.stage).toBe(3);
        expect(world.u.fluor.value).toBeGreaterThan(first.fluor + 0.3);
        // The light comes down over the board and the school winds round it, with no quad yet.
        expect(late.counts.quads).toBe(0);
        expect(world.u.beam.value.w).toBeGreaterThan(first.beam + 0.2);
        expect(late.school.vortex).toBeGreaterThan(first.vortex + 0.3);
        // Hot play keeps the reef alight: colonies a current passed still hold some of their colour.
        expect(late.counts.kept).toBeGreaterThan(0);
        expect(world.stains.some((s) => s.kept && s.release === NEVER)).toBe(true);
        // The chain breaks: what the reef kept lets go (a release, not a dimming).
        world.onLock({ u: 0.5, rows: [19], color: pieces[0] });
        world.onCombo(0);
        run(world, camera, 0.5);
        expect(world.getState().breath).toBeCloseTo(1, 2);
        expect(world.stains.filter((s) => s.kept).every((s) => s.release < NEVER)).toBe(true);
        run(world, camera, 16, 1 / 30);
        const rest = world.getState();
        expect(rest.heat.level).toBeLessThan(0.05);
        expect(rest.heat.fever).toBe(0);
        expect(rest.heat.stage).toBe(0);
        expect(world.u.beam.value.w).toBe(0);
        expect(rest.school.vortex).toBeLessThan(0.1);
        expect(world.u.fluor.value).toBeLessThan(hour + 0.05);
    });

    it('builds each wave of a cascade on the last, and answers a back-to-back with the sea ringing', () => {
        const { world, camera } = build();
        const strengths = [];
        for (let w = 1; w <= 4; w++) {
            world.onClear({ rows: [19, 18], lines: 2, cascade: w });
            strengths.push(world.surges[world.surges.length - 1].strength);
            run(world, camera, 0.36);
        }
        for (let i = 1; i < strengths.length; i++) expect(strengths[i]).toBeGreaterThan(strengths[i - 1]);
        const { world: b2b, camera: eye } = build();
        b2b.onClear({ rows: [19, 18, 17, 16], lines: 4, b2b: true });
        expect(b2b.songs.some((s) => Math.abs(s.x) < 1e-6)).toBe(true);
        expect(b2b.rings.some((r) => r.reach >= 2.5)).toBe(true);
        run(b2b, eye, 1);
        expect(b2b.getState().songs).toBeGreaterThan(0);
    });

    it('crowns a quad with a perfect clear on its own moment: no second clear, no second hush', () => {
        const { world, camera } = build();
        world.onLock({ u: 0.2, rows: [19], color: pieces[1] });
        run(world, camera, 1.2);
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        const { hushUntil } = world;
        const currents = world.surges.length;
        run(world, camera, 0.36);
        world.onLock({ u: 0.8, rows: [12], color: pieces[3] });
        world.onPerfect();
        expect(world.hushUntil).toBe(hushUntil);
        expect(world.surges.length).toBe(currents);
        expect(world.getState().counts.clears).toBe(1);
        expect(world.getState().counts.crowns).toBe(1);
        // The mass spawning: every colony lets go, even the one whose light is still sinking.
        world.stains.forEach((s) => expect(s.release).toBeLessThan(NEVER));
        run(world, camera, 0.5);
        expect(world.u.lift.value).toBeGreaterThan(0.4);
        expect(world.getState().beam).toBeGreaterThan(0.5);
    });

    it('answers a T-spin that cleared nothing with a ring where the piece went in', () => {
        const { world } = build();
        world.onLock({ u: 0.3, rows: [19], color: pieces[5] });
        const rings = world.rings.length;
        const { cursor } = world.pool;
        world.onSpin();
        expect(world.rings.length).toBe(rings + 1);
        expect(world.pool.cursor).toBeGreaterThan(cursor);
        expect(world.getState().counts.spins).toBe(1);
        expect(world.getState().counts.clears).toBe(0);
    });

    it('never refuses the whale a quad calls: one already over the board sings again', () => {
        const { world, camera } = build();
        world.onCombo(CALLS.whale);
        run(world, camera, PASS_SECONDS.whale * 0.5);
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        expect(world.calls.whale.encore).toBeGreaterThan(world.time);
        run(world, camera, 1.2);
        expect(world.calls.whale.sangAt).toBe(world.calls.whale.encore);
        expect(world.songs.some((s) => s.time === world.calls.whale.encore)).toBe(true);
    });
});
