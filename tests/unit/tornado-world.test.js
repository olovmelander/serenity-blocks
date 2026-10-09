/**
 * Tornado — the world's choreography, run without a renderer: a scene, a camera, and the world
 * driven in fixed steps (camera, then events, then the frame, as the theme does).
 *
 * Nothing here pins a gain, a width, a colour or a duration: the look is still being tuned.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    REST_RIG, TORNADO_PARTS, TornadoWorld, fovForAspect,
} from '../../src/themes/tornado/tornado-world.js';
import { HOUR_SECONDS, PALETTES, WORLD } from '../../src/themes/tornado/tornado-core.js';
import {
    BOLTS, FLIGHTS, RIBBONS, RINGS,
} from '../../src/themes/tornado/tornado-tsl.js';
import { cardUnion, fallbackLayout } from '../../src/themes/tornado/tornado-composition.js';

vi.setConfig({ testTimeout: 30_000 }); // every test builds a storm, on a machine that may be busy

// Every world bakes the same noise: bake it once for the whole file.
vi.mock('../../src/themes/tornado/tornado-tsl.js', async (importOriginal) => {
    const actual = await importOriginal();
    let baked = null;
    return {
        ...actual,
        bakeNoise: (...args) => {
            if (!baked) baked = actual.bakeNoise(...args);
            return baked;
        },
    };
});

const START = 10;
const worlds = [];

function step(world, camera, from, to, dt = 1 / 30) {
    const steps = Math.max(1, Math.round((to - from) / dt));
    const h = (to - from) / steps;
    for (let i = 1; i <= steps; i += 1) {
        const sim = {
            time: from + i * h, delta: h, pointerX: 0, pointerY: 0,
        };
        world.updateCamera(camera, sim);
        world.update(sim, camera);
    }
}

function makeWorld(quality = 'High', { width = 1600, height = 900, live = true } = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new TornadoWorld({ scene, quality, capture: true }).build();
    worlds.push(world);
    world.bindCamera(camera);
    world.setViewport(width, height, aspect);
    world.setLayout(live ? fallbackLayout(width, height) : null, aspect);
    world.seek(START);
    step(world, camera, START, START + 0.1);
    return { scene, camera, world };
}

const liveRibbons = (world) => world.u.tables.ribbons.filter((row, i) => i % 2 === 0 && row.w > 0).length;
const liveRings = (world) => world.u.tables.rings.filter((row, i) => i % 2 === 0 && row.w > 0).length;

afterEach(() => {
    worlds.splice(0).forEach((w) => w.dispose());
    vi.restoreAllMocks();
});

describe('TornadoWorld build', () => {
    it('builds every named part, on every tier', () => {
        ['Minimal', 'High'].forEach((quality) => {
            const { world, scene } = makeWorld(quality);
            expect([...world.parts.keys()]).toEqual(TORNADO_PARTS);
            world.parts.forEach((object) => expect(object.parent).toBe(world.root));
            expect(world.root.parent).toBe(scene);
        });
    });

    it('draws only the parts it is asked for', () => {
        const { world } = makeWorld('Low');
        world.showOnlyParts(['sky', 'funnel']);
        expect(world.parts.get('sky').visible).toBe(true);
        expect(world.parts.get('funnel').visible).toBe(true);
        expect(world.parts.get('wheat').visible).toBe(false);
    });

    it('leaves the scene clean when disposed', () => {
        const { world, scene } = makeWorld('Low');
        world.dispose();
        expect(scene.children).toHaveLength(0);
        expect(world.parts.size).toBe(0);
    });
});

describe('TornadoWorld composition', () => {
    it('stands the funnel in the free space left of the card on a wide screen', () => {
        const { world } = makeWorld('Low');
        const card = cardUnion(fallbackLayout(1600, 900));
        expect(world.funnelBeside).toBe(true);
        expect(world.funnelScreenX).toBeLessThan(card.x0);
        const axis = world.u.axis.value;
        expect(axis.z).toBeLessThan(0);
        expect(axis.x).toBeLessThan(0);
        expect(Math.hypot(axis.x, axis.z)).toBeCloseTo(WORLD.distance, 3);
        // The sun stands on the other side of the card.
        expect(world.u.sunDir.value.x).toBeGreaterThan(0);
        expect(world.u.sunDir.value.y).toBeGreaterThan(0);
    });

    it('opens the lens on a tall screen', () => {
        expect(fovForAspect(16 / 9)).toBeCloseTo(REST_RIG.fov, 5);
        expect(fovForAspect(0.5)).toBeGreaterThan(REST_RIG.fov);
        expect(fovForAspect(0.2)).toBeLessThanOrEqual(74);
    });

    it('holds the lens still under reduced motion', () => {
        const { world, camera } = makeWorld('Low');
        world.setReducedMotion(true);
        world.onClear({ lines: 4 });
        step(world, camera, START + 0.1, START + 3);
        expect(camera.position.x).toBe(0);
        expect(camera.rotation.y).toBe(0);
        expect(camera.rotation.x).toBeCloseTo(REST_RIG.pitch, 10);
        expect(world.getPostState().ripple.strength).toBe(0);
    });
});

describe('TornadoWorld gameplay', () => {
    it('answers a lock with sparks, a gust ring, and then a ribbon in the piece colour', () => {
        const { world, camera } = makeWorld();
        world.onLock({
            player: 0, rows: [12, 13], u: 0.3, color: '#3aa0ff', hardDrop: false,
        });
        const flight = world.u.tables.flights[0];
        expect(flight.w).toBeCloseTo(world.time, 6);
        const paint = world.u.tables.flights[1];
        expect(paint.z).toBeGreaterThan(paint.x); // a blue piece
        expect(paint.w).toBeGreaterThan(0);

        step(world, camera, world.time, world.time + 0.3);
        expect(liveRings(world)).toBe(1);
        expect(liveRibbons(world)).toBe(0); // the sparks are still in the air

        step(world, camera, world.time, world.time + 3);
        expect(liveRibbons(world)).toBe(1);
        const shape = world.u.tables.ribbons[0];
        const colour = world.u.tables.ribbons[1];
        expect(shape.y).toBeGreaterThan(shape.z); // head above tail
        expect(colour.z).toBeGreaterThan(colour.x);
        expect(world.getState().ribbons).toBe(1);
    });

    it('starts the gust ring out in the field, never under the lens', () => {
        const { world, camera } = makeWorld();
        for (let i = 0; i < 10; i += 1) {
            world.onLock({ rows: [19 - i], u: i / 9, color: '#2ee6e6' });
            const ring = world.rings[i % RINGS];
            expect(Math.hypot(ring.x - camera.position.x, ring.z - camera.position.z)).toBeGreaterThanOrEqual(11.9);
            expect(ring.z).toBeLessThan(0);
        }
    });

    it('throws more for a hard drop', () => {
        const { world } = makeWorld();
        world.onLock({ rows: [19], u: 0.5, color: '#ffc21a' });
        world.onLock({
            rows: [19], u: 0.5, color: '#ffc21a', hardDrop: true,
        });
        expect(world.u.tables.flights[3].w).toBeGreaterThan(world.u.tables.flights[1].w);
        expect(world.shake).toBeGreaterThan(0);
    });

    it('never holds more ribbons, rings or flights than its tables', () => {
        const { world, camera } = makeWorld('Low');
        for (let i = 0; i < 20; i += 1) {
            world.onLock({ rows: [19 - (i % 6)], u: (i * 0.37) % 1, color: '#ff4d6d' });
            step(world, camera, world.time, world.time + 0.2);
        }
        step(world, camera, world.time, world.time + 2);
        expect(liveRibbons(world)).toBeLessThanOrEqual(RIBBONS);
        expect(liveRings(world)).toBeLessThanOrEqual(RINGS);
        expect(world.u.tables.flights).toHaveLength(FLIGHTS * 2);
    });

    it('answers a clear by letting the ribbons go and calling one channel per line', () => {
        const { world, camera } = makeWorld();
        const strike = vi.spyOn(world.fx, 'strike');
        world.onLock({ rows: [19], u: 0.4, color: '#38f08c' });
        step(world, camera, world.time, world.time + 4);
        expect(liveRibbons(world)).toBe(1);

        world.onClear({ lines: 3, rows: [19, 18, 17] });
        step(world, camera, world.time, world.time + 0.6);
        expect(strike).toHaveBeenCalledTimes(3);
        strike.mock.calls.forEach(([slot]) => expect(slot).toBeLessThan(BOLTS));
        expect(world.u.release.value).toBeGreaterThan(0);

        step(world, camera, world.time, world.time + 2);
        expect(liveRibbons(world)).toBe(0);
        // The strokes are over: no channel is still alight.
        world.u.tables.bolts.forEach((row) => expect(row.x).toBe(0));
    });

    it('lands its lightning clear of the card', () => {
        const { world, camera } = makeWorld();
        const strike = vi.spyOn(world.fx, 'strike');
        const card = cardUnion(fallbackLayout(1600, 900));
        for (let i = 0; i < 6; i += 1) {
            world.onClear({ lines: 4 });
            step(world, camera, world.time, world.time + 0.8);
        }
        expect(strike.mock.calls.length).toBe(24);
        strike.mock.calls.forEach(([, x, z]) => {
            const sx = 0.5 + Math.atan2(x, -z) / (2 * world.azimuthOf(1));
            expect(sx < card.x0 || sx > card.x1).toBe(true);
        });
    });

    it('sends a dust front out on four lines, and not on fewer', () => {
        const { world, camera } = makeWorld();
        world.onClear({ lines: 2 });
        step(world, camera, world.time, world.time + 1);
        expect(world.u.shock.value.y).toBe(0);
        world.onClear({ lines: 4 });
        step(world, camera, world.time, world.time + 1);
        expect(world.u.shock.value.x).toBeGreaterThan(0);
        expect(world.u.shock.value.y).toBeGreaterThan(0);
        expect(world.getPostState().ripple.strength).toBeGreaterThan(0);
        step(world, camera, world.time, world.time + 6);
        expect(world.u.shock.value.y).toBe(0);
    });

    it('builds with a chain and lets go when it breaks', () => {
        const { world, camera } = makeWorld();
        const rest = world.u.girth.value;
        world.onCombo(6);
        step(world, camera, world.time, world.time + 4);
        const blown = world.u.girth.value;
        expect(world.u.fury.value).toBeGreaterThan(0.5);
        expect(blown).toBeGreaterThan(rest * 1.3);
        world.onCombo(0);
        step(world, camera, world.time, world.time + 12);
        expect(world.u.fury.value).toBeLessThan(0.05);
        expect(world.u.girth.value).toBeLessThan(blown);
    });

    it('shows the satellite vortices and the dust front only while they are called for', () => {
        const { world, camera } = makeWorld();
        const { children, front } = world.funnel;
        expect(children.length).toBeGreaterThan(0);
        children.forEach((c) => expect(c.visible).toBe(false));
        expect(front.visible).toBe(false);
        world.onCombo(7);
        step(world, camera, world.time, world.time + 4);
        children.forEach((c) => expect(c.visible).toBe(true));
        world.onClear({ lines: 4 });
        step(world, camera, world.time, world.time + 1);
        expect(front.visible).toBe(true);
        world.onCombo(0);
        step(world, camera, world.time, world.time + 14);
        children.forEach((c) => expect(c.visible).toBe(false));
        expect(front.visible).toBe(false);
    });

    it('turns its clocks faster while the chain runs, and never backwards', () => {
        const { world, camera } = makeWorld();
        const s0 = world.u.spin.value;
        step(world, camera, world.time, world.time + 2);
        const calm = world.u.spin.value - s0;
        world.onCombo(8);
        step(world, camera, world.time, world.time + 4);
        const s1 = world.u.spin.value;
        step(world, camera, world.time, world.time + 2);
        expect(world.u.spin.value - s1).toBeGreaterThan(calm * 1.5);
    });
});

describe('TornadoWorld hours', () => {
    it('turns the hour with the level and with the clock', () => {
        const { world, camera } = makeWorld('Low');
        expect(world.getState().hour).toBe(PALETTES[0].name);
        world.levelUp(3, { silent: true });
        step(world, camera, world.time, world.time + 0.1);
        expect(world.getState().hour).toBe(PALETTES[2].name);

        const later = makeWorld('Low');
        later.world.seek(HOUR_SECONDS * 1.2);
        step(later.world, later.camera, HOUR_SECONDS * 1.2, HOUR_SECONDS * 1.2 + 0.1);
        expect(later.world.getState().hour).toBe(PALETTES[1].name);
    });

    it('turns the light with the clock alone, on any level, with no gameplay at all', () => {
        [1, 3].forEach((level) => {
            const { world, camera } = makeWorld('Low');
            if (level > 1) world.levelUp(level, { silent: true });
            step(world, camera, world.time, world.time + 0.1);
            const first = world.getState().hour;
            const sunAt = () => world.u.sun.value.toArray().map((v) => Math.round(v * 1e4));
            const start = sunAt();
            // Within the first minute the light has already left the level's own hour...
            step(world, camera, world.time, HOUR_SECONDS * 0.5, 0.25);
            expect(world.level).toBe(level);
            expect(world.getState().hourTurn).toBeGreaterThan(0.3);
            expect(sunAt()).not.toEqual(start);
            // ...a step of the clock later it stands on the next hour, the level unchanged...
            step(world, camera, world.time, HOUR_SECONDS * 1.05, 0.25);
            expect(world.level).toBe(level);
            expect(world.getState().hour).toBe(PALETTES[level % PALETTES.length].name);
            expect(world.getState().hour).not.toBe(first);
            // ...and it keeps going.
            step(world, camera, world.time, HOUR_SECONDS * 2.05, 0.25);
            expect(world.getState().hour).toBe(PALETTES[(level + 1) % PALETTES.length].name);
        });
    });

    it('adds a level step on top of wherever the clock has carried the light', () => {
        const { world, camera } = makeWorld('Low');
        step(world, camera, world.time, HOUR_SECONDS * 1.05, 0.25);
        expect(world.getState().hour).toBe(PALETTES[1].name);
        world.levelUp(2, { silent: true });
        step(world, camera, world.time, world.time + 0.1);
        expect(world.getState().hour).toBe(PALETTES[2].name);
    });

    it('marks a new level with a stroke of lightning unless told to be silent', () => {
        const { world, camera } = makeWorld('Low');
        const strike = vi.spyOn(world.fx, 'strike');
        world.levelUp(2, { silent: true });
        step(world, camera, world.time, world.time + 0.5);
        expect(strike).not.toHaveBeenCalled();
        world.levelUp(3);
        step(world, camera, world.time, world.time + 0.5);
        expect(strike).toHaveBeenCalledTimes(1);
    });

    it('goes back to the first hour on a new run', () => {
        const { world, camera } = makeWorld('Low');
        world.levelUp(4, { silent: true });
        world.onCombo(5);
        world.resetSession();
        step(world, camera, world.time, world.time + 40);
        expect(world.level).toBe(1);
        expect(world.getState().hour).toBe(PALETTES[0].name);
        expect(world.u.fury.value).toBeLessThan(0.05);
    });
});

describe('TornadoWorld replay and live controls', () => {
    it('gives the same frame for the same events', () => {
        const run = () => {
            const { world, camera } = makeWorld('Low');
            world.onLock({ rows: [15], u: 0.7, color: '#d95bff' });
            step(world, camera, world.time, world.time + 2);
            world.onClear({ lines: 2 });
            step(world, camera, world.time, world.time + 0.3);
            const { tables } = world.u;
            return JSON.stringify([tables.ribbons, tables.rings, tables.flashes, tables.bolts]
                .map((rows) => rows.map((r) => r.toArray().map((v) => Math.round(v * 1e4)))));
        };
        expect(run()).toBe(run());
    });

    it('moves the funnel with the live controls and survives nonsense', () => {
        const { world, camera } = makeWorld('Low');
        step(world, camera, world.time, world.time + 0.1);
        const girth = world.u.girth.value;
        const sun = world.u.sun.value.clone();
        world.setLiveParams({ ribbonWidth: 1.5, timeScale: 2, emissiveColor: '#3aa0ff' });
        step(world, camera, world.time, world.time + 0.1);
        expect(world.u.girth.value).toBeCloseTo(girth * 1.5, 3);
        expect(world.live.speed).toBe(2);
        // A blue light: the sun loses red against blue.
        expect(world.u.sun.value.x / world.u.sun.value.z).toBeLessThan(sun.x / sun.z);

        world.setLiveParams({ ribbonWidth: 'wide', timeScale: null, emissiveColor: 'no' });
        step(world, camera, world.time, world.time + 0.1);
        expect(world.u.girth.value).toBeCloseTo(girth, 3);
        expect(world.u.sun.value.x).toBeCloseTo(sun.x, 5);
    });
});
