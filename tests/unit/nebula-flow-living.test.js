/**
 * Star Cradle (Nebula Flow) — the living nursery (2026-11-17 pass): the weather on its own clock,
 * the happenings the nursery makes by itself, a shape of its own for each big moment on the aura
 * sheet, a perfect clear's light echo, a level-up's palette wave and a run's dusk.
 *
 * Behaviour and contracts, never tuning numbers: constants are imported, assertions are
 * relations (which shape, in what order, back to rest, deterministic).
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { NebulaFlowWorld, REST_RIG, fovForAspect } from '../../src/themes/nebula-flow/nebula-flow-world.js';
import {
    FAR_SPIRES,
    FAR_TOP,
    HAPPENINGS,
    HAPPEN_GAP,
    HAPPEN_JITTER,
    KIND_AMBIENT,
    SHAPES,
    WEATHERS,
    WEATHER_KEYS,
    WEATHER_STEP,
    cellsFromMatrix,
    happeningAfter,
    happeningAt,
    weatherAt,
} from '../../src/themes/nebula-flow/nebula-flow-core.js';
import {
    AURA_LIFE, AURA_LOBES, AURA_NOVA, AURA_PINWHEEL, AURA_SHELLS, SHELLS_MAX,
} from '../../src/themes/nebula-flow/nebula-flow-aura.js';
import { QUALITY } from '../../src/themes/nebula-flow/nebula-flow-quality.js';
import { fallbackLayout } from '../../src/themes/nebula-flow/nebula-flow-composition.js';
import { NEBULA_FLOW_TETROMINOS } from '../../src/themes/nebula-flow/nebula-flow-tetrominos.js';

vi.setConfig({ testTimeout: 30_000 });

const T_CELLS = cellsFromMatrix(SHAPES.T);
const worlds = [];

function makeWorld(quality = 'High', at = 10) {
    const scene = new THREE.Scene();
    const aspect = 16 / 9;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new NebulaFlowWorld({ scene, quality, capture: true }).build();
    worlds.push(world);
    world.bindCamera(camera);
    world.setViewport(1280, 720, aspect);
    world.setLayout(fallbackLayout(1280, 720), aspect);
    world.seek(at);
    const sim = {
        time: at, delta: 0, pointerX: 0, pointerY: 0,
    };
    world.updateCamera(camera, sim);
    world.update(sim, camera);
    return { world, camera };
}

function frame(world, camera, dt, during = null) {
    const sim = {
        time: world.time + dt, delta: dt, pointerX: 0, pointerY: 0,
    };
    world.updateCamera(camera, sim);
    during?.();
    world.update(sim, camera);
}

function run(world, camera, seconds, dt = 1 / 30) {
    for (let i = 0; i < Math.round(seconds / dt); i += 1) frame(world, camera, dt);
}

const lockT = (world) => world.onLock({
    u: 0.2, rows: [12, 11], color: NEBULA_FLOW_TETROMINOS.colors.T, cells: T_CELLS,
});
const kinds = (world) => world.parts.aura.live(world.time).map((a) => a.kind);

afterEach(() => {
    worlds.splice(0).forEach((w) => w.dispose());
});

describe('Star Cradle: the weather', () => {
    it('turns through every mood on its own clock, each a whole mood at a whole step', () => {
        WEATHERS.forEach((mood, i) => {
            const at = weatherAt(i);
            WEATHER_KEYS.forEach((key) => expect(at[key], `${mood.name}.${key}`).toBe(mood[key]));
            expect(at.name).toBe(mood.name);
        });
        // the wheel closes: one turn round is the first mood again
        expect(weatherAt(WEATHERS.length).name).toBe(WEATHERS[0].name);
        // between two moods every value lies between theirs
        const half = weatherAt(1.5);
        WEATHER_KEYS.forEach((key) => {
            const [a, b] = [WEATHERS[1][key], WEATHERS[2][key]];
            expect(half[key]).toBeGreaterThanOrEqual(Math.min(a, b) - 1e-9);
            expect(half[key]).toBeLessThanOrEqual(Math.max(a, b) + 1e-9);
        });
        // the rest look is the calm mood, exactly as it was
        expect(WEATHERS[0]).toMatchObject({
            shine: 1, burn: 1, lanes: 1, embers: 1, outflow: 1, rays: 0, flow: 1,
        });
    });

    it('moves the world through the moods with the clock alone, and a level-up a mood on', () => {
        const { world, camera } = makeWorld('High', 5);
        expect(world.getState().weather).toBe(WEATHERS[0].name);
        const seen = new Set();
        for (let i = 0; i < WEATHERS.length; i += 1) {
            world.seek(5 + i * WEATHER_STEP);
            run(world, camera, 0.1);
            seen.add(world.getState().weather);
        }
        expect(seen.size).toBe(WEATHERS.length);
        // a level moves it one mood on (the palette's place), with no clock change
        world.seek(5);
        run(world, camera, 0.1);
        world.levelUp(2);
        run(world, camera, 4);
        expect(world.getState().weather).toBe(WEATHERS[1].name);
    });
});

describe('Star Cradle: the nursery\'s own happenings', () => {
    it('are a function of the clock and the seed alone, each kind once in every block of four', () => {
        for (let k = 0; k < 24; k += 1) expect(happeningAt(k, 7)).toEqual(happeningAt(k, 7));
        for (let block = 0; block < 5; block += 1) {
            const kindsSeen = new Set();
            for (let k = block * HAPPENINGS.length; k < (block + 1) * HAPPENINGS.length; k += 1) {
                kindsSeen.add(happeningAt(k, 7).kind);
            }
            expect(kindsSeen.size).toBe(HAPPENINGS.length);
        }
        // in order, about a gap apart
        for (let k = 1; k < 24; k += 1) {
            const gap = happeningAt(k, 7).time - happeningAt(k - 1, 7).time;
            expect(gap).toBeGreaterThan(HAPPEN_GAP - HAPPEN_JITTER);
            expect(gap).toBeLessThan(HAPPEN_GAP + HAPPEN_JITTER);
        }
        // a seek starts after the moment shown, never replaying the past
        [0, 33, 100, 500].forEach((t) => {
            const k = happeningAfter(t, 7);
            expect(happeningAt(k, 7).time).toBeGreaterThan(t);
            if (k > 0) expect(happeningAt(k - 1, 7).time).toBeLessThanOrEqual(t);
        });
    });

    it('fire on the clock while nothing is played: a star kindled by itself, a flare, a nova', () => {
        const { world, camera } = makeWorld('High', 0);
        const due = happeningAt(0, world.seed).time;
        run(world, camera, due + 0.5);
        expect(world.happenIndex).toBeGreaterThan(0);
        // what the nursery kindles by itself is not counted as the board's
        expect(world.counts.locks).toBe(0);
        expect(world.getState().held).toBe(0);
        // each kind does something of its own
        const before = world.births.filter((b) => b.wild && b.power > 0).length;
        world.happen({ time: world.time, kind: 'kindle', seed: 0.3 });
        expect(world.births.filter((b) => b.wild && b.power > 0).length).toBe(before + 1);
        world.happen({ time: world.time, kind: 'nova', seed: 0.6 });
        expect(kinds(world)).toContain(AURA_NOVA);
        const young = world.births.filter((b) => b.kind === KIND_AMBIENT);
        world.happen({ time: world.time, kind: 'outburst', seed: 0.2 });
        expect(young.some((b) => b.flareAt === world.time)).toBe(true);
        world.happen({ time: world.time, kind: 'flare', seed: 0.9 });
        expect(world.clusterFlareAt).toBe(world.time);
    });

    it('lets a young star flare and settle back, its lantern reaching further while it burns', () => {
        const { world, camera } = makeWorld('High', 20);
        world.happen({ time: world.time, kind: 'outburst', seed: 0.2 });
        const star = world.births.find((b) => b.flareAt === world.time);
        run(world, camera, 1.2);
        expect(world.flareOf(star, world.time)).toBeGreaterThan(2);
        run(world, camera, 20);
        expect(world.flareOf(star, world.time)).toBe(1);
    });
});

describe('Star Cradle: a shape for each big moment', () => {
    it('opens an hourglass round four lines\' great star, and lays a back-to-back\'s shells round it', () => {
        const { world, camera } = makeWorld('High', 20);
        lockT(world);
        run(world, camera, 1);
        world.b2bStreak = 2;
        world.onClear({ rows: [19, 18, 17, 16], lines: 4, b2b: true });
        run(world, camera, 0.6);
        expect(world.lastGreat).not.toBeNull();
        const live = world.parts.aura.live(world.time);
        const lobes = live.find((a) => a.kind === AURA_LOBES);
        const shells = live.find((a) => a.kind === AURA_SHELLS);
        expect(lobes).toBeTruthy();
        expect(shells).toBeTruthy();
        // both on the great star, the shells as many as the streak
        expect([lobes.x, lobes.y]).toEqual([world.lastGreat.x, world.lastGreat.y]);
        expect([shells.x, shells.y]).toEqual([world.lastGreat.x, world.lastGreat.y]);
        expect(shells.a).toBe(3);
        // and they go when their lives are over
        run(world, camera, Math.max(AURA_LIFE[AURA_LOBES], AURA_LIFE[AURA_SHELLS]) + 0.5);
        expect(kinds(world)).toEqual([]);
    });

    it('unwinds a pinwheel from the star a twist\'s piece kindled: one arm for a spin, two for a clear', () => {
        const { world, camera } = makeWorld('High', 20);
        lockT(world);
        world.onSpin();
        run(world, camera, 1);
        let wheel = world.parts.aura.live(world.time).find((a) => a.kind === AURA_PINWHEEL);
        expect(wheel.a).toBe(1);
        expect([wheel.x, wheel.y]).toEqual([world.lastBirth.x, world.lastBirth.y]);
        // it starts when its star lights, never before the spark lands
        expect(wheel.born).toBe(world.lastBirth.born);
        world.parts.aura.reset();
        lockT(world);
        world.onClear({ rows: [19, 18], lines: 2, twist: true });
        run(world, camera, 1);
        wheel = world.parts.aura.live(world.time).find((a) => a.kind === AURA_PINWHEEL);
        expect(wheel.a).toBe(2);
    });

    it('counts a back-to-back streak in shells, at most SHELLS_MAX, and an easy clear breaks it', () => {
        const { world } = makeWorld('High', 20);
        for (let i = 0; i < SHELLS_MAX + 2; i += 1) {
            lockT(world);
            world.onClear({
                rows: [19, 18], lines: 2, twist: true, b2b: true,
            });
        }
        expect(world.b2bStreak).toBe(SHELLS_MAX);
        lockT(world);
        world.onClear({ rows: [19], lines: 1 });
        expect(world.b2bStreak).toBe(0);
    });

    it('sends a perfect clear\'s light echo out from its great star, and lets it end', () => {
        const { world, camera } = makeWorld('High', 20);
        world.onClear({ rows: [19, 18, 17, 16], lines: 4, perfect: true });
        run(world, camera, 2);
        expect(world.u.echo.value.w).toBeGreaterThan(0);
        expect([world.u.echo.value.x, world.u.echo.value.y]).toEqual([world.lastGreat.x, world.lastGreat.y]);
        // a plain four lines has none of its own
        const plain = makeWorld('High', 20);
        plain.world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        run(plain.world, plain.camera, 2);
        expect(plain.world.u.echo.value.w).toBe(0);
        run(world, camera, 12);
        expect(world.u.echo.value.w).toBe(0);
    });

    it('carries a level-up\'s new palette out from the cluster as a wave, the old one outside it', () => {
        const { world, camera } = makeWorld('High', 20);
        run(world, camera, 0.2);
        // no wave: the palette outside it is the live one
        expect(world.u.wipe.value.z).toBeGreaterThan(100);
        expect(world.u.wipeFrom.cavityNear.value.toArray()).toEqual(world.u.cavityNear.value.toArray());
        const before = world.u.cavityNear.value.toArray();
        world.levelUp(2);
        run(world, camera, 1.5);
        const r1 = world.u.wipe.value.z;
        expect(r1).toBeGreaterThan(0);
        expect(r1).toBeLessThan(100);
        // outside the wave the old palette holds while the live one has moved on
        expect(world.u.wipeFrom.cavityNear.value.toArray()).toEqual(before);
        expect(world.u.cavityNear.value.toArray()).not.toEqual(before);
        run(world, camera, 1);
        expect(world.u.wipe.value.z).toBeGreaterThan(r1);
        run(world, camera, 8);
        expect(world.u.wipe.value.z).toBeGreaterThan(100);
        expect(world.u.wipeFrom.cavityNear.value.toArray()).toEqual(world.u.cavityNear.value.toArray());
    });
});

describe('Star Cradle: a run\'s end', () => {
    it('sinks the cluster\'s light into a dusk that outlives the menu and lifts by itself', () => {
        const { world, camera } = makeWorld('High', 20);
        run(world, camera, 1);
        const { shine } = world;
        world.onGameOver();
        run(world, camera, 4);
        expect(world.getState().dusk).toBeGreaterThan(0.9);
        expect(world.shine).toBeLessThan(shine * 0.6);
        // the menu's reset keeps it
        world.resetSession();
        run(world, camera, 0.2);
        expect(world.getState().dusk).toBeGreaterThan(0.9);
        run(world, camera, 20);
        expect(world.getState().dusk).toBe(0);
    });

    it('lifts the dusk at once when a new run starts, with the cluster\'s light pouring back', () => {
        const { world, camera } = makeWorld('High', 20);
        world.onGameOver();
        run(world, camera, 4);
        const fronts = world.fronts.filter((f) => f.born > world.time - 0.01).length;
        world.onSessionStart();
        expect(world.fronts.filter((f) => f.born > world.time - 0.01).length).toBe(fronts + 1);
        run(world, camera, 6);
        expect(world.getState().dusk).toBe(0);
        // a run that never ended leaves the light alone
        const calm = makeWorld('High', 20);
        calm.world.onSessionStart();
        expect(calm.world.getState().dusk).toBe(0);
    });
});

describe('Star Cradle: the far range and the tiers', () => {
    it('stands every far spire below the frame\'s middle, inside the frame, each narrower at its head', () => {
        FAR_SPIRES.forEach((f) => {
            expect(Math.abs(f.s)).toBeLessThan(1);
            expect(f.top).toBeLessThanOrEqual(FAR_TOP);
            expect(f.w1).toBeLessThan(f.w0);
        });
        expect(FAR_TOP).toBeLessThan(0.5);
    });

    it('keeps more of the pillars\' young stars on the higher tiers, never fewer', () => {
        const order = ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme'];
        for (let i = 1; i < order.length; i += 1) {
            expect(QUALITY[order[i]].ambient).toBeGreaterThanOrEqual(QUALITY[order[i - 1]].ambient);
        }
        expect(QUALITY.Minimal.farRim).toBe(false);
        expect(QUALITY.High.farRim).toBe(true);
    });
});
