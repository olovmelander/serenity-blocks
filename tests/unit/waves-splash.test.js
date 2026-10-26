/**
 * Waves — a dolphin's splashes, on the CPU.
 *
 * The splash is written in one go from the leap (waves-splash.js): every drop and puff with its own
 * birth, the trail's seconds ahead. These tests read the pools back as the materials read them and
 * hold where and when the water leaves, not how it is tuned.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { uniform, uniformArray } from 'three/tsl';
import { REST_RIG, fallbackLayout } from '../../src/themes/waves/waves-composition.js';
import { HOURS, HOUR_COLOURS } from '../../src/themes/waves/waves-hours.js';
import { QUALITY, QUALITY_NAMES, tierFor } from '../../src/themes/waves/waves-quality.js';
import { createLight, createWaterNoise, sunDirection } from '../../src/themes/waves/waves-tsl.js';
import {
    FLUKE_REACH, NOSE_REACH, WavesPod, dolphinPose, leapersFor, surfaceTimes,
} from '../../src/themes/waves/waves-life.js';
import { GRAVITY, SprayPool } from '../../src/themes/waves/waves-spray.js';
import {
    FoamPool, dolphinBreach, dolphinEntry, splashDensity, splashReach,
} from '../../src/themes/waves/waves-splash.js';
import { WavesWorld, fovForAspect } from '../../src/themes/waves/waves-world.js';

vi.setConfig({ testTimeout: 30_000 });

const DT = 1 / 60;
const EYE = REST_RIG.eye;
const SUN = sunDirection();
const made = [];

function uniforms() {
    return {
        time: uniform(0),
        sun: uniform(SUN.clone()),
        warm: uniform(0),
        open: uniform(0),
        bulge: uniform(new THREE.Vector4(-60, 0, 5, 0)),
        tear: uniform(0),
        light: createLight(uniformArray(HOUR_COLOURS.map((key) => new THREE.Vector4(...HOURS[0][key], 0)), 'vec4')),
    };
}

function makeKit(quality = 'High', seed = 187) {
    const tier = tierFor(quality);
    const U = uniforms();
    const noise = createWaterNoise(tier.noise);
    const pod = new WavesPod({
        tier, U, sun: SUN, eye: EYE, seed,
    });
    const spray = new SprayPool({ tier, U, seed });
    const foam = new FoamPool({ tier, U, noise });
    made.push(pod, spray, foam, noise);
    return {
        tier, pod, spray, foam,
    };
}

afterEach(() => {
    for (const thing of made.splice(0)) thing.dispose();
    vi.restoreAllMocks();
});

/** Every drop of the spray pool that has been thrown, as the material reads it. */
function drops(spray) {
    const start = spray.geometry.getAttribute('aStart');
    const flight = spray.geometry.getAttribute('aFlight');
    const tint = spray.geometry.getAttribute('aTint');
    const out = [];
    for (let i = 0; i < spray.count; i++) {
        if (start.getW(i) < -1000) continue;
        out.push({
            x: start.getX(i),
            y: start.getY(i),
            z: start.getZ(i),
            birth: start.getW(i),
            vx: flight.getX(i),
            vy: flight.getY(i),
            vz: flight.getZ(i),
            size: flight.getW(i),
            life: tint.getW(i),
        });
    }
    return out;
}

/** Every puff of the foam pool that has been written, as the material reads it. */
function puffs(foam) {
    const start = foam.geometry.getAttribute('aStart');
    const move = foam.geometry.getAttribute('aMove');
    const look = foam.geometry.getAttribute('aLook');
    const out = [];
    for (let i = 0; i < foam.count; i++) {
        if (start.getW(i) < -1000) continue;
        out.push({
            x: start.getX(i),
            y: start.getY(i),
            z: start.getZ(i),
            birth: start.getW(i),
            v: [move.getX(i), move.getY(i), move.getZ(i)],
            size: move.getW(i),
            spread: look.getX(i),
            life: look.getY(i),
            strength: look.getZ(i),
            flat: look.getW(i),
        });
    }
    return out;
}

/** A spread of leaps: every way a pod sends them (open barrel or not, the hero across the sun). */
function leaps(pod) {
    const out = [];
    for (const open of [0, 0.5, 1]) {
        for (let i = 0; i < 6; i++) out.push({ ...pod.leap(10, open) });
        out.push({ ...pod.leap(10, open, { hero: true, d: 12.5 }) });
        out.push({ ...pod.leap(10, open, { height: 1.2 }) });
    }
    return out;
}

const finite = (list) => list.every((item) => Object.values(item).flat().every(Number.isFinite));

describe('waves splash: when the dolphin meets the water', () => {
    it('times the flukes out of the face, the nose into the sea and the flukes after it', () => {
        const { pod } = makeKit();
        const pose = {};
        for (const arc of leaps(pod)) {
            const where = `d ${-arc.z}, hero ${arc.vx}`;
            expect(arc.clearAt, where).toBeGreaterThan(0);
            expect(arc.clearAt, where).toBeLessThan(arc.flight / 2);
            expect(arc.noseAt, where).toBeGreaterThan(arc.flight / 2);
            expect(arc.noseAt, where).toBeLessThan(arc.flight);
            expect(arc.tailAt, where).toBeGreaterThan(arc.flight);
            // The flukes are a body's reach along the path from the hole when they clear it.
            dolphinPose(arc, arc.clearAt, pose);
            const out = Math.hypot(pose.x - arc.x, pose.y - arc.y, pose.z - arc.z);
            expect(out, where).toBeCloseTo(FLUKE_REACH * arc.size, 4);
            // The nose touches the water, and the flukes go under it, at those moments.
            dolphinPose(arc, arc.noseAt, pose);
            expect(pose.y + pose.fy * NOSE_REACH * arc.size, where).toBeCloseTo(0, 6);
            dolphinPose(arc, arc.tailAt, pose);
            expect(pose.y - pose.fy * FLUKE_REACH * arc.size, where).toBeCloseTo(0, 6);
            // It goes in nose first, so the nose is in before the middle and the middle before the flukes.
            expect(surfaceTimes(arc)).toEqual({ clearAt: arc.clearAt, noseAt: arc.noseAt, tailAt: arc.tailAt });
        }
    });

    it('splashes as the nose touches the water, and keeps the dolphin drawn until its flukes are under', () => {
        const { pod } = makeKit('Extreme');
        // The longest, slowest dolphin a pod sends: it takes longest to go under.
        let slowest = null;
        for (let i = 0; i < 40; i++) {
            const arc = pod.leap(0, 0);
            if (!slowest || arc.tailAt - arc.flight > slowest.tailAt - slowest.flight) slowest = { ...arc };
            arc.active = false;
        }
        const arc = pod.leap(0, 0, { slot: 0 });
        Object.assign(arc, slowest, { active: true });
        const calls = [];
        let drawnAtTail = 0;
        for (let n = 0; n * DT <= arc.flight + 4; n++) {
            const time = n * DT;
            pod.update(time, (x, y, z, strength, which) => {
                calls.push({ time, entered: which.entered, landed: which.landed });
            });
            if (time >= arc.tailAt - DT && time < arc.tailAt) drawnAtTail = pod.geometry.getAttribute('aPlace').getW(0);
        }
        expect(calls).toHaveLength(2);
        expect(calls[0].entered).toBe(false);
        expect(calls[1].entered).toBe(true);
        // The second splash is the nose going in: before the middle of the body is under.
        expect(calls[1].time).toBeGreaterThanOrEqual(arc.noseAt - 1e-9);
        expect(calls[1].time).toBeLessThan(arc.noseAt + DT + 1e-9);
        expect(calls[1].landed).toBe(false);
        expect(drawnAtTail).toBeGreaterThan(0);
        expect(arc.active).toBe(false);
    });
});

describe('waves splash: breaking out of the face', () => {
    it('throws its water from the hole and off the body, and rains it back under the leap', () => {
        const { pod, spray, foam } = makeKit();
        const arc = pod.leap(10, 0.3);
        dolphinBreach({
            spray, foam, arc, now: 10, eye: EYE,
        });
        const thrown = drops(spray);
        expect(finite(thrown)).toBe(true);
        expect(thrown.length).toBeGreaterThan(150);
        const pose = {};
        for (const drop of thrown) {
            const tau = drop.birth - arc.t0;
            // From the moment it breaks out to half-way over the leap: never before, never after.
            expect(tau).toBeGreaterThanOrEqual(-0.05);
            expect(tau).toBeLessThanOrEqual(arc.flight * 0.55 + 0.1);
            // Each drop leaves the dolphin where it was then: the hole, or the body over it.
            dolphinPose(arc, Math.max(0, tau), pose);
            const fromBody = Math.hypot(drop.x - pose.x, drop.y - pose.y, drop.z - pose.z);
            const fromHole = Math.hypot(drop.x - arc.x, drop.y - arc.y, drop.z - arc.z);
            expect(Math.min(fromBody, fromHole)).toBeLessThan(arc.size * (FLUKE_REACH + 0.4));
            // Out of the water, and up into the air: it rises or flies on before it falls back.
            expect(drop.y).toBeGreaterThan(-0.05);
            expect(drop.size).toBeGreaterThan(0);
            expect(drop.life).toBeGreaterThan(1);
        }
        // Some of it is still to come off the body when the splash is written: the trail.
        expect(thrown.filter((drop) => drop.birth > arc.t0 + arc.clearAt).length).toBeGreaterThan(20);
        // And what runs off it lags the body and falls back below its arc.
        const late = thrown.filter((drop) => drop.birth > arc.t0 + arc.clearAt + 0.2);
        for (const drop of late) {
            dolphinPose(arc, drop.birth - arc.t0, pose);
            expect(Math.hypot(drop.vx, drop.vy, drop.vz)).toBeLessThan(pose.speed);
        }
    });

    it('boils white water round the body and in front of it as it breaks out', () => {
        const { pod, spray, foam } = makeKit();
        const arc = pod.leap(10, 0.3);
        dolphinBreach({
            spray, foam, arc, now: 10, eye: EYE,
        });
        const boil = puffs(foam);
        expect(finite(boil)).toBe(true);
        expect(boil.length).toBeGreaterThanOrEqual(4);
        for (const puff of boil) {
            expect(puff.birth).toBeGreaterThanOrEqual(arc.t0 - 0.1);
            expect(puff.birth).toBeLessThanOrEqual(arc.t0 + arc.clearAt);
            expect(Math.hypot(puff.x - arc.x, puff.y - arc.y, puff.z - arc.z)).toBeLessThan(1.2);
            expect(puff.size).toBeGreaterThan(0.3);
            expect(puff.flat).toBe(0);
            expect(puff.strength).toBeGreaterThan(0);
        }
        // On average nearer the eye than the hole is: the body never hides the whole of it.
        const near = (p) => Math.hypot(p.x - EYE.x, p.z - EYE.z);
        const mean = boil.reduce((sum, puff) => sum + near(puff), 0) / boil.length;
        expect(mean).toBeLessThan(near(arc));
    });
});

describe('waves splash: going back in', () => {
    it('cuts in at the nose, closes in a crown over the body and kicks up a plume as the flukes go under', () => {
        const { pod, spray, foam } = makeKit();
        const arc = pod.leap(10, 0.3);
        const now = arc.t0 + arc.noseAt;
        dolphinEntry({
            spray, foam, arc, now, eye: EYE,
        });
        const thrown = drops(spray);
        expect(finite(thrown)).toBe(true);
        expect(thrown.length).toBeGreaterThan(100);
        const ex = arc.x + arc.vx * arc.flight;
        const ez = arc.z + arc.vz * arc.flight;
        for (const drop of thrown) {
            // From the water, at the slit the body cut, from when the nose touched to when the flukes went in.
            expect(drop.y).toBeGreaterThanOrEqual(0);
            expect(drop.y).toBeLessThan(0.05);
            expect(Math.hypot(drop.x - ex, drop.z - ez)).toBeLessThan(arc.size * 2);
            expect(drop.birth).toBeGreaterThanOrEqual(now - 0.13);
            expect(drop.birth).toBeLessThanOrEqual(arc.t0 + arc.tailAt + 0.15);
            expect(drop.vy).toBeGreaterThan(0);
        }
        // The flukes' kick comes last and throws highest; the nose's sheets stay low.
        const kick = thrown.filter((drop) => drop.birth > arc.t0 + arc.tailAt - 0.1);
        const nose = thrown.filter((drop) => drop.birth < arc.t0 + arc.flight - 0.13);
        expect(kick.length).toBeGreaterThan(20);
        expect(nose.length).toBeGreaterThan(5);
        const mean = (list) => list.reduce((sum, drop) => sum + drop.vy, 0) / list.length;
        expect(mean(kick)).toBeGreaterThan(mean(nose));
        // Never higher than the leap it ends: the tallest drop stays under the top of the dolphin's arc.
        const top = (drop) => drop.y + (drop.vy * drop.vy) / (2 * GRAVITY);
        expect(Math.max(...thrown.map(top))).toBeLessThan(arc.y + (arc.vy * arc.vy) / (2 * GRAVITY));
    });

    it('leaves white water in the crown and the kick, and foam lying on the water', () => {
        const { pod, spray, foam } = makeKit();
        const arc = pod.leap(10, 0.3);
        dolphinEntry({
            spray, foam, arc, now: arc.t0 + arc.noseAt, eye: EYE,
        });
        const white = puffs(foam);
        expect(finite(white)).toBe(true);
        const flat = white.filter((puff) => puff.flat === 1);
        expect(flat.length).toBeGreaterThanOrEqual(2);
        for (const puff of flat) {
            expect(puff.y).toBeLessThan(0.05);
            expect(puff.v).toEqual([0, 0, 0]);
            // Foam lingers longer than the boil.
            expect(puff.life).toBeGreaterThan(Math.max(...white.filter((p) => p.flat === 0).map((p) => p.life)));
        }
        expect(white.filter((puff) => puff.flat === 0).every((puff) => puff.v[1] > 0)).toBe(true);
    });
});

describe('waves splash: what it costs', () => {
    it('throws fewer drops into a smaller pool, and draws a far splash bigger, never smaller', () => {
        expect(splashDensity(QUALITY.Minimal.spray)).toBeLessThan(splashDensity(QUALITY.High.spray));
        for (let i = 1; i < QUALITY_NAMES.length; i++) {
            const cheaper = splashDensity(QUALITY[QUALITY_NAMES[i - 1]].spray);
            expect(splashDensity(QUALITY[QUALITY_NAMES[i]].spray)).toBeGreaterThanOrEqual(cheaper);
        }
        expect(splashDensity(0)).toBeGreaterThan(0);
        expect(splashDensity(1e9)).toBeLessThan(2);
        expect(splashReach(0, 0, -1, EYE)).toBe(1);
        expect(splashReach(0, 0, -14, EYE)).toBeGreaterThan(splashReach(0, 0, -9, EYE));
        expect(splashReach(0, 0, -500, EYE)).toBeLessThan(3);
        expect(splashReach(0, 0, -14, null)).toBe(1);
        // The whole pod splashing at once still leaves part of every tier's pool to the wave's own spray.
        for (const quality of QUALITY_NAMES) {
            const { pod, spray, foam } = makeKit(quality);
            const density = splashDensity(spray.count);
            for (let i = 0; i < pod.count; i++) {
                const arc = pod.leap(10 + i * 0.6, 0.3);
                dolphinBreach({
                    spray, foam, arc, now: 10, density, eye: EYE,
                });
                dolphinEntry({
                    spray, foam, arc, now: arc.t0 + arc.noseAt, density, eye: EYE,
                });
            }
            expect(drops(spray).length / spray.count, quality).toBeLessThan(0.8);
        }
    });
});

describe('waves splash: the white water pool', () => {
    it('keeps the puffs its tier pays for, in one draw, and never grows', () => {
        for (const quality of QUALITY_NAMES) {
            const { foam, tier } = makeKit(quality);
            expect(foam.count).toBe(tier.foam);
            expect(foam.geometry.instanceCount).toBe(tier.foam);
            expect(foam.mesh.material.isNodeMaterial).toBe(true);
            expect(foam.mesh.frustumCulled).toBe(false);
            expect(puffs(foam)).toHaveLength(0);
        }
        const { foam } = makeKit('Minimal');
        const size = foam.data.length;
        for (let i = 0; i < foam.count * 3; i++) foam.puff(10 + i * 0.01, 10 + i * 0.01, 0, 0, -5, { life: 2 });
        expect(foam.data.length).toBe(size);
        expect(puffs(foam)).toHaveLength(foam.count);
    });

    it('takes a spent slot first, else the puff nearest its end; never one still to come', () => {
        const { foam } = makeKit('Minimal');
        const before = foam.buffer.version;
        // A full pool: one puff still to be born, the rest showing, one nearly gone.
        foam.puff(10, 14, 0, 0, -5, { life: 2 });
        for (let i = 1; i < foam.count; i++) foam.puff(10, 9.5, 0, 0, -5, { life: i === 3 ? 0.6 : 3 });
        expect(foam.buffer.version).toBeGreaterThan(before);
        const future = puffs(foam).findIndex((puff) => puff.birth === 14);
        expect(future).toBeGreaterThanOrEqual(0);
        // Nothing is spent at 10: the new one takes the puff nearest its end (life 0.6, born 9.5).
        foam.puff(10, 10, 1, 0, -5, { life: 2 });
        const now = puffs(foam);
        expect(now.filter((puff) => puff.birth === 14)).toHaveLength(1);
        expect(now.filter((puff) => puff.life === 0.6)).toHaveLength(0);
        // Later, when some have gone, a new one takes a spent slot and leaves the rest alone.
        foam.puff(13, 13, 2, 0, -5, { life: 2 });
        expect(puffs(foam).filter((puff) => puff.birth === 14)).toHaveLength(1);
        expect(puffs(foam).filter((puff) => puff.birth === 10)).toHaveLength(1);
        foam.reset();
        expect(puffs(foam)).toHaveLength(0);
        expect(foam.cursor).toBe(0);
    });
});

describe('waves splash: in the world', () => {
    function makeWorld(quality = 'High', seed = 187) {
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(fovForAspect(16 / 9), 16 / 9, REST_RIG.near, REST_RIG.far);
        const world = new WavesWorld({
            scene, quality, capture: true, seed,
        }).build();
        world.setViewport(1600, 900, 16 / 9);
        world.setLayout(fallbackLayout(1600, 900), 16 / 9);
        world.bindCamera(camera);
        world.seek(10);
        made.push(world);
        return { camera, world };
    }
    const step = (world, camera, seconds) => {
        for (let i = Math.round(seconds / DT); i > 0; i--) {
            const sim = { time: world.time + DT, delta: DT };
            world.updateCamera(camera, sim);
            world.update(sim, camera);
        }
    };
    const chainFor = (n) => {
        for (let combo = 1; combo < 200; combo++) if (leapersFor(combo) >= n) return combo;
        throw new Error(`no chain calls ${n}`);
    };

    it('hands each leap to its splash: white water at the hole, the trail written ahead', () => {
        const { camera, world } = makeWorld();
        world.onCombo(chainFor(1));
        const [arc] = world.pod.arcs.filter((a) => a.active);
        step(world, camera, arc.t0 - world.clock + 0.05);
        expect(arc.started).toBe(true);
        expect(puffs(world.foam).length).toBeGreaterThanOrEqual(4);
        expect(drops(world.spray).filter((drop) => drop.birth > world.clock + 0.5).length).toBeGreaterThan(20);
        // And as it goes back in: foam lies on the water where it went.
        step(world, camera, arc.t0 + arc.noseAt - world.clock + 0.05);
        expect(puffs(world.foam).filter((puff) => puff.flat === 1).length).toBeGreaterThanOrEqual(2);
        // A new run empties the white water with everything else in the air.
        world.resetSession();
        expect(puffs(world.foam)).toHaveLength(0);
        expect(drops(world.spray)).toHaveLength(0);
    });

    it('splashes the same way every time it is played the same way', () => {
        const playThrough = () => {
            const { camera, world } = makeWorld('Medium', 42);
            world.onCombo(chainFor(3));
            step(world, camera, 9);
            return { spray: Array.from(world.spray.data), foam: Array.from(world.foam.data) };
        };
        expect(playThrough()).toEqual(playThrough());
    });
});
