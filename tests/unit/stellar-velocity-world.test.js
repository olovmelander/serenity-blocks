/**
 * Stellar Velocity — the world, on the CPU: a real StellarVelocityWorld in a THREE.Scene, no
 * renderer (the canyon's target is simply not painted).
 *
 * These pin behaviour and contracts — what a lock, a clear, a chain, four lines and a new level
 * DO, in what order and how often — never a tuning number: constants are imported, and the
 * assertions are relations (counted, ordered, bounded, monotonic).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    BOOST_MAX, REST_RIG, STELLAR_VELOCITY_PARTS, StellarVelocityWorld, TRAVEL_WRAP, fovForAspect,
} from '../../src/themes/stellar-velocity/stellar-velocity-world.js';
import {
    BOLT_FLIGHT, BOLT_SLOTS, CRUISE, FRONT_SLOTS, GEAR_CHAIN, HOOP_LIGHTS, HOOP_SLOTS, HOOP_STAGGER, HUSH_HOLD,
    JET_SLOTS, JUMP_EXIT, JUMP_TUNNEL, JUMP_TUNNEL_PERFECT, NEBULA_PALETTES, PALETTE_HOME, PALETTE_STEP, WARP_CHAIN,
    courseAnchors, gearForCombo, hoopDepth, hoopRun, warpForCombo,
} from '../../src/themes/stellar-velocity/stellar-velocity-core.js';
import { QUALITY } from '../../src/themes/stellar-velocity/stellar-velocity-quality.js';
import { fallbackLayout } from '../../src/themes/stellar-velocity/stellar-velocity-composition.js';
import { STELLAR_VELOCITY_TETROMINOS } from '../../src/themes/stellar-velocity/stellar-velocity-tetrominos.js';

const COLORS = STELLAR_VELOCITY_TETROMINOS.colors;

function makeWorld(quality = 'Minimal', {
    width = 1600, height = 900, layout, at = 10, reduce = false,
} = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new StellarVelocityWorld({ scene, quality, capture: true }).build();
    world.bindCamera(camera);
    world.setReducedMotion(reduce);
    world.setViewport(width, height, aspect);
    // As the theme does on its first frame: the live rects, or null when no board is on screen.
    world.setLayout(layout === undefined ? fallbackLayout(width, height) : layout, aspect);
    settle(world, camera, at);
    return { scene, camera, world };
}

/** The capture's recipe: jump the clock, then draw that moment with the simulation frozen. */
function settle(world, camera, time) {
    world.seek(time);
    const sim = {
        time, delta: 0, pointerX: 0, pointerY: 0,
    };
    world.updateCamera(camera, sim);
    world.update(sim, camera);
}

/**
 * One frame as the theme runs it: the camera (which stamps the clock), the gameplay staged since
 * the last frame, then the world.
 */
function frame(world, camera, dt, during = null) {
    const sim = {
        time: world.time + dt, delta: dt, pointerX: 0, pointerY: 0,
    };
    world.updateCamera(camera, sim);
    during?.();
    world.update(sim, camera);
}

/** Advance the world from its current time by `seconds` in `steps` equal frames. */
function run(world, camera, seconds, steps = Math.max(1, Math.round(seconds * 60))) {
    for (let i = 0; i < steps; i++) frame(world, camera, seconds / steps);
}

/** Lay `n` locks half a second apart and let the last one land. */
function lay(world, camera, n, options = {}) {
    for (let i = 0; i < n; i++) {
        frame(world, camera, 1 / 60, () => world.onLock({
            u: ((i * 0.37) % 1) * 0.9 + 0.05, rows: [19 - (i % 10)], color: Object.values(COLORS)[i % 7], ...options,
        }));
        run(world, camera, 0.5);
    }
    run(world, camera, BOLT_FLIGHT * 2);
}

const litSlots = (world) => world.hoopSlots
    .map((slot, i) => ({ ...slot, i }))
    .filter((slot) => slot.strength > 0 && slot.birth <= world.time && slot.fired === Infinity);

describe('stellar velocity world: at rest', () => {
    it('builds every part it names and adds one root to the scene', () => {
        const { scene, world } = makeWorld();
        expect(Object.keys(world.parts).sort()).toEqual([...STELLAR_VELOCITY_PARTS].sort());
        expect(scene.children).toContain(world.root);
        STELLAR_VELOCITY_PARTS.forEach((name) => expect(world.parts[name].mesh.parent).toBe(world.root));
        expect(world.stars.count).toBe(QUALITY.Minimal.stars);
        expect(world.motes.count).toBe(QUALITY.Minimal.motes);
    });

    it('glides: first gear, the sky unbunched, nothing on the course, every light at full', () => {
        const { world } = makeWorld();
        const state = world.getState();
        expect(state.gear).toBe(1);
        expect(state.warp).toBe(0);
        expect(state.speed).toBeCloseTo(CRUISE, 9);
        expect(state.hoops).toBe(0);
        expect(state.fronts).toBe(0);
        expect(state.jump).toBe(0);
        expect(state.breath).toBe(1);
        expect(world.u.hoopLightCount.value).toBe(0);
        expect(world.u.frontCount.value).toBe(0);
        expect(world.getPostState().exposure).toBeCloseTo(1, 9);
    });

    it('the sun hangs where the composition wants it for the aspect, wide and upright', () => {
        for (const [width, height] of [[1600, 900], [2560, 1080], [430, 932]]) {
            const { world } = makeWorld('Minimal', { width, height });
            const anchors = courseAnchors(width / height);
            // The camera sways a little round the anchor.
            expect(Math.abs(world.heart.x - anchors.x)).toBeLessThan(0.03);
            expect(Math.abs(world.heart.y - anchors.y)).toBeLessThan(0.03);
            expect(world.u.sunUv.value.x).toBeCloseTo(world.heart.x, 9);
        }
    });

    it('a ray through the sun on screen runs down the course', () => {
        const { world } = makeWorld();
        const point = world.screenToWorld(world.heart.x, world.heart.y, 10, [0, 0, 0]);
        expect(point[2]).toBeLessThan(-9.9);
        expect(Math.hypot(point[0], point[1])).toBeLessThan(0.5);
    });

    it('draws only the named parts when asked', () => {
        const { world } = makeWorld();
        world.showOnlyParts(['canyon', 'hoops']);
        expect(world.parts.canyon.mesh.visible).toBe(true);
        expect(world.parts.hoops.mesh.visible).toBe(true);
        expect(world.parts.stars.mesh.visible).toBe(false);
        expect(world.parts.bolts.mesh.visible).toBe(false);
    });
});

describe('stellar velocity world: a lock lays a hoop', () => {
    it('throws one bolt, and the hoop opens only when the bolt lands', () => {
        const { camera, world } = makeWorld();
        frame(world, camera, 1 / 60, () => world.onLock({ u: 0.3, rows: [10], color: COLORS.I }));
        expect(world.counts.locks).toBe(1);
        expect(world.counts.bolts).toBe(1);
        // In flight: a slot is spoken for, nothing stands on the course yet.
        expect(world.hoopSlots.filter((slot) => slot.reserved > world.time)).toHaveLength(1);
        expect(world.getState().hoops).toBe(0);
        const bolt = world.bolts.table;
        expect(bolt[0].w).toBeGreaterThan(world.time - 0.1);
        // It flies to its hoop's own place on the course.
        expect(bolt[1].x).toBe(0);
        expect(bolt[1].y).toBe(0);
        expect(bolt[1].z).toBeCloseTo(-hoopDepth(0), 9);
        run(world, camera, BOLT_FLIGHT * 2);
        expect(world.getState().hoops).toBe(1);
        expect(litSlots(world)).toHaveLength(1);
        // And its light comes down the canyon.
        expect(world.frontSlots.some((slot) => slot.birth > 10)).toBe(true);
    });

    it('the hoop burns in the piece\'s own colour', () => {
        const { camera, world } = makeWorld();
        lay(world, camera, 1, { color: '#ff0000' });
        const [hoop] = litSlots(world);
        expect(hoop.rgb[0]).toBeGreaterThan(hoop.rgb[1] * 3);
        expect(hoop.rgb[0]).toBeGreaterThan(hoop.rgb[2] * 3);
        const row = world.u.tables.hoops[hoop.i * 2 + 1];
        expect(row.x).toBeCloseTo(hoop.rgb[0], 9);
    });

    it('the course fills from the camera outward, one slot a lock', () => {
        const { camera, world } = makeWorld();
        lay(world, camera, 4);
        expect(litSlots(world).map((slot) => slot.i)).toEqual([0, 1, 2, 3]);
        expect(world.getState().hoops).toBe(4);
        // The cloud is marched with the nearest lit ones, nearest first.
        expect(world.u.hoopLightCount.value).toBe(Math.min(HOOP_LIGHTS, 4));
        const cast = world.u.tables.hoopLights;
        for (let k = 1; k < world.u.hoopLightCount.value; k++) expect(cast[k * 2].x).toBeGreaterThan(cast[(k - 1) * 2].x);
    });

    it('a hard drop takes one slot too, and its hoop stands brighter', () => {
        const { camera, world } = makeWorld();
        frame(world, camera, 1 / 60, () => world.onLock({
            u: 0.5, rows: [18], color: COLORS.T, hardDrop: true,
        }));
        expect(world.hoopSlots.filter((slot) => slot.reserved > world.time)).toHaveLength(1);
        run(world, camera, BOLT_FLIGHT * 2);
        frame(world, camera, 1 / 60, () => world.onLock({ u: 0.5, rows: [18], color: COLORS.T }));
        run(world, camera, BOLT_FLIGHT * 2);
        const [hard, soft] = litSlots(world);
        expect(litSlots(world)).toHaveLength(2);
        expect(hard.strength).toBeGreaterThan(soft.strength);
    });

    it('never holds more than its slots: a full course gives up its dimmest hoop', () => {
        const { camera, world } = makeWorld();
        lay(world, camera, HOOP_SLOTS + 3);
        expect(litSlots(world)).toHaveLength(HOOP_SLOTS);
        expect(world.getState().hoops).toBeLessThanOrEqual(HOOP_SLOTS);
        expect(world.counts.locks).toBe(HOOP_SLOTS + 3);
    });

    it('two locks in one frame never share a slot', () => {
        const { camera, world } = makeWorld();
        frame(world, camera, 1 / 60, () => {
            world.onLock({ u: 0.2, rows: [19], color: COLORS.I });
            world.onLock({ u: 0.8, rows: [19], color: COLORS.O });
        });
        expect(world.hoopSlots.filter((slot) => slot.reserved > world.time)).toHaveLength(2);
        run(world, camera, BOLT_FLIGHT * 2);
        expect(litSlots(world)).toHaveLength(2);
    });

    it('throws nothing before the world is built, and survives a lock with no arguments', () => {
        const world = new StellarVelocityWorld({ scene: new THREE.Scene(), quality: 'Minimal' });
        expect(() => world.onLock({})).not.toThrow();
        expect(() => world.onClear({})).not.toThrow();
        const built = makeWorld();
        expect(() => frame(built.world, built.camera, 1 / 60, () => built.world.onLock())).not.toThrow();
        expect(built.world.counts.locks).toBe(1);
    });
});

describe('stellar velocity world: a clear fires the drive', () => {
    it('we go through every held hoop, the nearest first, and each is gone once it is behind us', () => {
        const { camera, world } = makeWorld();
        lay(world, camera, 5);
        expect(world.getState().hoops).toBe(5);
        frame(world, camera, 1 / 60, () => world.onClear({ rows: [19, 18], lines: 2 }));
        const fired = world.hoopSlots.map((slot, i) => ({ ...slot, i })).filter((slot) => slot.fired < Infinity);
        expect(fired).toHaveLength(5);
        for (let k = 1; k < fired.length; k++) {
            expect(fired[k].fired - fired[k - 1].fired).toBeCloseTo(HOOP_STAGGER, 9);
        }
        run(world, camera, hoopRun(hoopDepth(4)) + 5 * HOOP_STAGGER + 1.2);
        expect(world.counts.passes).toBe(5);
        expect(world.getState().hoops).toBe(0);
        expect(litSlots(world)).toHaveLength(0);
        expect(world.counts.clears).toBe(1);
    });

    it('a front of light per line comes down the canyon, and the cleared rows leave as jets', () => {
        for (const lines of [1, 2, 3]) {
            const { camera, world } = makeWorld();
            const before = world.frontCursor;
            frame(world, camera, 1 / 60, () => world.onClear({ lines }));
            run(world, camera, 0.6);
            expect(world.frontCursor - before).toBe(lines);
            const jets = world.jets.table.filter((row, i) => i % 2 === 0 && row.w > 0);
            expect(jets).toHaveLength(lines);
            // Each jet leaves its own row's height.
            const ys = new Set(jets.map((row) => row.y.toFixed(4)));
            expect(ys.size).toBe(lines);
        }
        expect(JET_SLOTS).toBeGreaterThanOrEqual(8);
        expect(FRONT_SLOTS).toBeGreaterThanOrEqual(6);
    });

    it('thrusts: speed jumps with the clear and falls back to a glide', () => {
        const { camera, world } = makeWorld();
        frame(world, camera, 1 / 60, () => world.onClear({ lines: 2 }));
        run(world, camera, 0.5);
        expect(world.getState().gear).toBeGreaterThan(2);
        expect(world.getState().speed).toBeGreaterThan(CRUISE * 2);
        run(world, camera, 30);
        expect(world.getState().gear).toBeLessThan(1.05);
    });

    it('the more the board has laid, the more a clear sets off', () => {
        const bare = makeWorld();
        frame(bare.world, bare.camera, 1 / 60, () => bare.world.onClear({ lines: 1 }));
        run(bare.world, bare.camera, 0.2);
        const fed = makeWorld();
        lay(fed.world, fed.camera, 8);
        run(fed.world, fed.camera, 6);
        frame(fed.world, fed.camera, 1 / 60, () => fed.world.onClear({ lines: 1 }));
        run(fed.world, fed.camera, 0.2);
        expect(fed.world.boost).toBeGreaterThan(bare.world.boost);
        expect(fed.world.boost).toBeLessThanOrEqual(BOOST_MAX);
    });

    it('a lock that comes with the clear lays the first hoop of the next round', () => {
        const { camera, world } = makeWorld();
        lay(world, camera, 3);
        frame(world, camera, 1 / 60, () => {
            world.onClear({ lines: 1 });
            world.onLock({ u: 0.5, rows: [19], color: COLORS.Z });
        });
        run(world, camera, 3);
        expect(world.counts.passes).toBe(3);
        expect(litSlots(world)).toHaveLength(1);
    });
});

describe('stellar velocity world: a chain is a gear', () => {
    it('each step of a chain runs faster and bunches the sky further', () => {
        let lastGear = 1;
        let lastWarp = 0;
        for (const combo of [1, 2, 4, 8]) {
            const { camera, world } = makeWorld();
            world.onCombo(combo);
            run(world, camera, 12);
            const state = world.getState();
            expect(state.gear).toBeGreaterThan(lastGear);
            expect(state.warp).toBeGreaterThan(lastWarp);
            expect(state.gear).toBeCloseTo(gearForCombo(combo), 1);
            expect(state.warp).toBeCloseTo(warpForCombo(combo), 2);
            expect(state.warp).toBeLessThan(WARP_CHAIN);
            lastGear = state.gear;
            lastWarp = state.warp;
        }
        expect(lastGear).toBeLessThan(GEAR_CHAIN);
    });

    it('the lens opens, the rush blurs and the iris closes as we gather speed', () => {
        const { camera, world } = makeWorld();
        const restFov = camera.fov;
        world.onCombo(8);
        run(world, camera, 10);
        const post = world.getPostState();
        expect(camera.fov).toBeGreaterThan(restFov);
        expect(post.blur).toBeGreaterThan(0.2);
        expect(post.exposure).toBeLessThan(1);
        expect(world.u.iris.value).toBeGreaterThan(1);
        expect(world.u.sunGain.value).toBeGreaterThan(1);
    });

    it('a broken chain lets off slowly: we are still under way a second later', () => {
        const { camera, world } = makeWorld();
        world.onCombo(6);
        run(world, camera, 10);
        const fast = world.getState().gear;
        frame(world, camera, 1 / 60, () => world.onCombo(0));
        run(world, camera, 1);
        expect(world.getState().gear).toBeLessThan(fast);
        expect(world.getState().gear).toBeGreaterThan(1 + (fast - 1) * 0.3);
        run(world, camera, 30);
        expect(world.getState().gear).toBeLessThan(1.02);
        expect(world.getState().warp).toBeLessThan(0.01);
    });

    it('how far we have come only ever grows, by no more than the speed allows', () => {
        const { camera, world } = makeWorld('Minimal', { at: 600 });
        let last = world.distance;
        for (let i = 0; i < 240; i++) {
            frame(world, camera, 1 / 60, () => {
                // A rapid chain, late in a session.
                if (i % 20 === 0) {
                    world.onLock({
                        u: 0.5, rows: [19], color: COLORS.I, hardDrop: true,
                    });
                    world.onClear({ lines: 1 + (i % 3) });
                    world.onCombo(1 + i / 20);
                }
            });
            const step = world.distance - last;
            expect(step).toBeGreaterThan(0);
            expect(step).toBeLessThanOrEqual(world.speed / 60 + 1e-9);
            expect(world.u.travel.value).toBeGreaterThanOrEqual(0);
            expect(world.u.travel.value).toBeLessThan(TRAVEL_WRAP);
            last = world.distance;
        }
        expect(world.speed).toBeGreaterThan(CRUISE * 3);
    });
});

describe('stellar velocity world: four lines jump', () => {
    it('the drive holds its breath, then the tunnel opens, and we arrive somewhere else', () => {
        const { camera, world } = makeWorld();
        lay(world, camera, 4);
        const shiftBefore = world.u.shift.value.clone();
        frame(world, camera, 1 / 60, () => world.onClear({ rows: [19, 18, 17, 16], lines: 4 }));
        expect(world.counts.quads).toBe(1);
        // The hush: every light sinks while the sky is drawn into the sun.
        run(world, camera, HUSH_HOLD * 0.7);
        expect(world.getState().breath).toBeLessThan(0.5);
        expect(world.getState().jump).toBe(0);
        expect(world.getPostState().rays).toBeLessThan(0.1);
        // The tunnel.
        run(world, camera, HUSH_HOLD * 0.3 + JUMP_TUNNEL * 0.5);
        expect(world.getState().jump).toBe(1);
        expect(world.u.jump.value).toBe(1);
        expect(world.getState().warp).toBeGreaterThan(WARP_CHAIN);
        expect(world.getState().breath).toBeGreaterThan(0.9);
        expect(world.u.shift.value.equals(shiftBefore)).toBe(true);
        // The arrival.
        run(world, camera, JUMP_TUNNEL * 0.5 + JUMP_EXIT + 0.3);
        expect(world.getState().jump).toBe(0);
        expect(world.getState().jumps).toBe(1);
        expect(world.u.shift.value.equals(shiftBefore)).toBe(false);
        expect(world.getState().surge).toBeGreaterThan(0.3);
        // Every hoop was passed on the way in.
        expect(world.counts.passes).toBe(4);
        run(world, camera, 40);
        expect(world.getState().surge).toBeLessThan(0.01);
        expect(world.getState().warp).toBeLessThan(0.01);
    });

    it('a perfect clear stays longer in the tunnel', () => {
        const quad = makeWorld();
        const perfect = makeWorld();
        frame(quad.world, quad.camera, 1 / 60, () => quad.world.onClear({ lines: 4 }));
        frame(perfect.world, perfect.camera, 1 / 60, () => perfect.world.onClear({ lines: 2, perfect: true }));
        const at = HUSH_HOLD + (JUMP_TUNNEL + JUMP_TUNNEL_PERFECT) * 0.5 + JUMP_EXIT;
        run(quad.world, quad.camera, at);
        run(perfect.world, perfect.camera, at);
        expect(quad.world.getState().jump).toBe(0);
        expect(perfect.world.getState().jump).toBeGreaterThan(0);
        expect(perfect.world.counts.quads).toBe(1);
    });

    it('each arrival is a different place, and the same one every time the session is replayed', () => {
        const a = makeWorld();
        const b = makeWorld();
        const places = [];
        for (let k = 0; k < 2; k++) {
            [a, b].forEach(({ world, camera }) => {
                frame(world, camera, 1 / 60, () => world.onClear({ lines: 4 }));
                run(world, camera, HUSH_HOLD + JUMP_TUNNEL + JUMP_EXIT + 0.5);
            });
            expect(a.world.u.shift.value.equals(b.world.u.shift.value)).toBe(true);
            places.push(a.world.u.shift.value.clone());
        }
        expect(places[0].equals(places[1])).toBe(false);
    });
});

describe('stellar velocity world: a T-spin rolls the canyon', () => {
    it('the canyon winds round the course and springs back', () => {
        const { camera, world } = makeWorld();
        frame(world, camera, 1 / 60, () => world.onClear({ lines: 2, tspin: true }));
        let peak = 0;
        for (let i = 0; i < 60; i++) {
            frame(world, camera, 1 / 60);
            peak = Math.max(peak, Math.abs(world.twist));
        }
        expect(peak).toBeGreaterThan(0.02);
        expect(world.u.twist.value).not.toBe(0);
        run(world, camera, 6);
        expect(Math.abs(world.twist)).toBeLessThan(0.002);
    });
});

describe('stellar velocity world: the nebula follows the level and the clock', () => {
    it('left alone on level 1, it stands on the next palette one PALETTE_STEP later', () => {
        const { camera, world } = makeWorld('Minimal', { at: 5 });
        expect(world.getState().palette).toBe(NEBULA_PALETTES[PALETTE_HOME].name);
        expect(world.getState().level).toBe(1);
        const glow = world.u.glow.value.clone();
        // No gameplay at all: only the clock.
        run(world, camera, 50, 100);
        expect(world.u.glow.value.distanceTo(glow)).toBeGreaterThan(0.03);
        run(world, camera, PALETTE_STEP - 50, 100);
        expect(world.getState().palette).toBe(NEBULA_PALETTES[PALETTE_HOME + 1].name);
        expect(world.getState().level).toBe(1);
        const next = NEBULA_PALETTES[PALETTE_HOME + 1].glow;
        expect(world.u.glow.value.x).toBeCloseTo(next[0], 2);
        expect(world.u.glow.value.z).toBeCloseTo(next[2], 2);
    });

    it('a level-up adds one step to wherever the clock has carried it, eased, with a front of the new colour', () => {
        const { camera, world } = makeWorld('Minimal', { at: 5 });
        const fronts = world.frontCursor;
        frame(world, camera, 1 / 60, () => world.levelUp(2));
        expect(world.frontCursor).toBe(fronts + 1);
        // Eased: not there at once.
        expect(world.levelPlace).toBeLessThan(0.5);
        run(world, camera, 8);
        expect(world.levelPlace).toBe(1);
        expect(world.getState().palette).toBe(NEBULA_PALETTES[PALETTE_HOME + 1].name);
        run(world, camera, PALETTE_STEP - 8, 100);
        expect(world.getState().palette).toBe(NEBULA_PALETTES[PALETTE_HOME + 2].name);
    });

    it('a silent level change snaps (captures), and a seek keeps the clock\'s share', () => {
        const { camera, world } = makeWorld('Minimal', { at: 5 });
        world.levelUp(3, { silent: true });
        expect(world.levelPlace).toBe(2);
        expect(world.getState().palette).toBe(NEBULA_PALETTES[PALETTE_HOME + 2].name);
        settle(world, camera, 5 + PALETTE_STEP);
        expect(world.getState().palette).toBe(NEBULA_PALETTES[PALETTE_HOME + 1].name);
    });
});

describe('stellar velocity world: sessions, replays and calm', () => {
    const script = (world, camera) => {
        lay(world, camera, 3);
        frame(world, camera, 1 / 60, () => {
            world.onClear({ lines: 2 });
            world.onCombo(1);
        });
        run(world, camera, 0.8);
        frame(world, camera, 1 / 60, () => world.onLock({
            u: 0.4, rows: [12], color: COLORS.S, hardDrop: true,
        }));
        run(world, camera, 0.7);
    };

    it('a seek and a fixed-step replay reproduce the same frame', () => {
        const a = makeWorld();
        const b = makeWorld();
        script(a.world, a.camera);
        script(b.world, b.camera);
        expect(b.world.time).toBeCloseTo(a.world.time, 9);
        const sa = a.world.getState();
        const sb = b.world.getState();
        expect(sb.gear).toBe(sa.gear);
        expect(sb.warp).toBe(sa.warp);
        expect(sb.distance).toBe(sa.distance);
        expect(sb.counts).toEqual(sa.counts);
        const rowsA = a.world.u.tables.hoops.map((row) => row.toArray());
        const rowsB = b.world.u.tables.hoops.map((row) => row.toArray());
        expect(rowsB).toEqual(rowsA);
        expect(b.world.u.travel.value).toBe(a.world.u.travel.value);
    });

    it('a seek drops everything in flight', () => {
        const { camera, world } = makeWorld();
        script(world, camera);
        world.onCombo(5);
        settle(world, camera, 40);
        const state = world.getState();
        expect(state.hoops).toBe(0);
        expect(state.fronts).toBe(0);
        expect(state.queued).toBe(0);
        expect(state.combo).toBe(0);
        expect(state.gear).toBe(1);
        expect(state.counts.locks).toBe(0);
        expect(world.bolts.table[0].w).toBeLessThan(0);
        expect(world.distance).toBeCloseTo(40 * CRUISE, 9);
    });

    it('a new run is a glide again, but we keep going and the nebula keeps its clock', () => {
        const { camera, world } = makeWorld();
        script(world, camera);
        world.onCombo(4);
        world.levelUp(3);
        run(world, camera, 6);
        const { distance, time } = world;
        const place = world.levelPlace;
        world.resetSession();
        expect(world.time).toBe(time);
        expect(world.distance).toBe(distance);
        expect(world.levelPlace).toBe(place);
        expect(world.level).toBe(1);
        expect(world.combo).toBe(0);
        expect(world.getState().counts.locks).toBe(0);
        frame(world, camera, 1 / 60);
        expect(world.getState().hoops).toBe(0);
        // The nebula eases back to the first level's place; it does not jump.
        expect(world.levelPlace).toBeLessThan(place);
        expect(world.levelPlace).toBeGreaterThan(place * 0.9);
    });

    it('reduced motion keeps the picture and takes the rush out of it', () => {
        const calm = makeWorld('Minimal', { reduce: true });
        const full = makeWorld();
        [calm, full].forEach(({ world, camera }) => {
            world.onCombo(8);
            run(world, camera, 10);
        });
        expect(calm.world.speed).toBeLessThan(full.world.speed * 0.25);
        expect(calm.world.getState().warp).toBeLessThan(full.world.getState().warp * 0.5);
        expect(calm.world.getPostState().blur).toBe(0);
        expect(calm.camera.fov).toBeCloseTo(fovForAspect(1600 / 900), 9);
        // The events still happen.
        lay(calm.world, calm.camera, 2);
        expect(calm.world.getState().hoops).toBe(2);
    });

    it('with several boards on screen each lock leaves its own card', () => {
        const layout = fallbackLayout(1600, 900);
        layout.cards = [
            {
                x0: 0.3, x1: 0.48, y0: 0.1, y1: 0.9,
            },
            {
                x0: 0.52, x1: 0.7, y0: 0.1, y1: 0.9,
            },
        ];
        layout.cardCount = 2;
        layout.boards[1] = {
            x0: 0.32, x1: 0.46, y0: 0.2, y1: 0.88,
        };
        layout.boards[2] = {
            x0: 0.54, x1: 0.68, y0: 0.2, y1: 0.88,
        };
        const { camera, world } = makeWorld('Minimal', { layout });
        frame(world, camera, 1 / 60, () => world.onLock({
            u: 0.5, rows: [10], color: COLORS.I, player: 1,
        }));
        const first = world.bolts.table[0].clone();
        frame(world, camera, 1 / 60, () => world.onLock({
            u: 0.5, rows: [10], color: COLORS.O, player: 2,
        }));
        const second = world.bolts.table[3];
        expect(second.x).toBeGreaterThan(first.x);
        expect(BOLT_SLOTS).toBeGreaterThanOrEqual(8);
    });

    it('gives back everything it made', () => {
        const { scene, world } = makeWorld();
        world.dispose();
        expect(scene.children).not.toContain(world.root);
        expect(world.u).toBeNull();
        expect(world.parts).toEqual({});
        expect(() => world.dispose()).not.toThrow();
        expect(() => world.update({ time: 1, delta: 0.016 })).not.toThrow();
        expect(() => world.onLock({ color: COLORS.I })).not.toThrow();
    });
});
