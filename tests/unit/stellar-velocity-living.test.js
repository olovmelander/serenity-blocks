/**
 * Stellar Velocity, the living pass (2026-11-17): the voyage through the nebula's regions, the
 * young stars in the walls, and the effects each event now has of its own (comets into the sun,
 * the sun's rings, a hard drop's shock ring, a chain's gear, the twist's helix, the run's end).
 *
 * These pin what the world DOES and in what order, never a tuning number: constants are imported.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    REST_RIG, StellarVelocityWorld, fovForAspect,
} from '../../src/themes/stellar-velocity/stellar-velocity-world.js';
import {
    BOLT_FLIGHT, B2B_GOLD, CRUISE, GAME_OVER_REST, HELIX_LIFE, HELIX_SLOTS, SHOCK_LIFE, SHOCK_SLOTS, STALL_FALL,
    SUN_RING_SLOTS, sunRingRadius,
} from '../../src/themes/stellar-velocity/stellar-velocity-core.js';
import {
    BEACON_LIGHTS, BEACON_SLOTS, REGION_BLEND, REGION_STEP, REGIONS, beaconDepth, beaconFade, beaconSites, regionAt,
    roundOrder, skipToNext, voyageAt, voyagePlace,
} from '../../src/themes/stellar-velocity/stellar-velocity-voyage.js';
import { fallbackLayout } from '../../src/themes/stellar-velocity/stellar-velocity-composition.js';
import { STELLAR_VELOCITY_TETROMINOS } from '../../src/themes/stellar-velocity/stellar-velocity-tetrominos.js';

const COLORS = STELLAR_VELOCITY_TETROMINOS.colors;

function makeWorld(quality = 'Minimal', { at = 10, width = 1600, height = 900 } = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new StellarVelocityWorld({ scene, quality, capture: true }).build();
    world.bindCamera(camera);
    world.setViewport(width, height, aspect);
    world.setLayout(fallbackLayout(width, height), aspect);
    world.seek(at);
    const sim = {
        time: at, delta: 0, pointerX: 0, pointerY: 0,
    };
    world.updateCamera(camera, sim);
    world.update(sim, camera);
    return { camera, world };
}

function frame(world, camera, dt, during = null) {
    const sim = {
        time: world.time + dt, delta: dt, pointerX: 0, pointerY: 0,
    };
    world.updateCamera(camera, sim);
    during?.();
    world.update(sim, camera);
}

function run(world, camera, seconds, steps = Math.max(1, Math.round(seconds * 60))) {
    for (let i = 0; i < steps; i++) frame(world, camera, seconds / steps);
}

/** Rings of light round the sun the world has thrown since `since`. */
const ringsSince = (world, since) => world.ringSlots.filter((slot) => slot.birth >= since && slot.strength > 0);

describe('stellar velocity: the voyage through the regions', () => {
    it('opens on the open reach, and every round visits every region, never one twice in a row', () => {
        expect(REGIONS[regionAt(0)].name).toBe('reach');
        let previous = -1;
        for (let k = 0; k < REGIONS.length * 40; k++) {
            const index = regionAt(k);
            expect(index).not.toBe(previous);
            previous = index;
        }
        for (let round = 0; round < 40; round++) {
            expect([...roundOrder(round)].sort()).toEqual(REGIONS.map((_, i) => i));
        }
    });

    it('rests in a region and passes into the next over the end of its step', () => {
        const at = (s) => voyageAt(voyagePlace(s));
        const first = REGIONS[regionAt(0)];
        const second = REGIONS[regionAt(1)];
        expect(at(REGION_STEP * 0.3)).toMatchObject({ name: first.name, mix: 0, scale: first.scale });
        const middle = at(REGION_STEP * (1 - REGION_BLEND * 0.5));
        expect(middle.mix).toBeGreaterThan(0.3);
        expect(middle.mix).toBeLessThan(0.7);
        expect(middle.scale).toBeCloseTo((first.scale + second.scale) / 2, 1);
        expect(at(REGION_STEP * 1.05)).toMatchObject({ name: second.name, mix: 0 });
    });

    it('a jump drops us out in the next region, already there', () => {
        const place = voyagePlace(REGION_STEP * 0.4);
        const after = voyageAt(place + skipToNext(place));
        expect(after.name).toBe(REGIONS[regionAt(1)].name);
        expect(after.mix).toBe(0);
    });

    it('in the world: a four\'s arrival is in the next region, with young stars of its own', () => {
        const { camera, world } = makeWorld('Minimal', { at: 5 });
        const before = world.getState().region;
        const sites = world.beaconSites;
        frame(world, camera, 1 / 60, () => world.onClear({ lines: 4 }));
        run(world, camera, 4.5);
        expect(world.getState().jumps).toBe(1);
        expect(world.getState().region).not.toBe(before);
        expect(world.getState().region).toBe(REGIONS[regionAt(1)].name);
        expect(world.beaconSites).not.toBe(sites);
        expect(world.beaconSites[0]).not.toEqual(sites[0]);
    });

    it('a gorge is run faster than a clearing, and the shaders hear where we are', () => {
        const { camera, world } = makeWorld('Minimal', { at: 5 });
        world.holdRegion('gorge');
        run(world, camera, 1);
        const gorge = world.speed;
        expect(world.u.region.value.x).toBe(REGIONS.find((r) => r.name === 'gorge').scale);
        world.holdRegion('clearing');
        run(world, camera, 1);
        expect(world.speed).toBeLessThan(gorge);
        expect(world.u.region.value.x).toBe(REGIONS.find((r) => r.name === 'clearing').scale);
        world.holdRegion(null);
        expect(world.regionHold).toBeNull();
    });
});

describe('stellar velocity: the young stars in the walls', () => {
    it('come toward us with the cloud and fade in from the haze and out once passed', () => {
        const site = beaconSites(0).find((one) => beaconDepth(one, 0) > 5);
        const near = beaconDepth(site, 0);
        expect(beaconDepth(site, 1)).toBeCloseTo(near - 1, 9);
        expect(beaconFade(60)).toBe(0);
        expect(beaconFade(-3)).toBe(0);
        expect(beaconFade(12)).toBe(1);
    });

    it('the nursery lights them; the march carries the light of the nearest ones ahead only', () => {
        const { camera, world } = makeWorld('High', { at: 5 });
        world.holdRegion('nursery');
        run(world, camera, 0.2);
        const rows = world.u.tables.beacons;
        const count = world.u.beaconLightCount.value;
        expect(world.getState().beacons).toBeGreaterThan(0);
        expect(count).toBeGreaterThan(0);
        expect(count).toBeLessThanOrEqual(BEACON_LIGHTS);
        for (let k = 0; k < count; k++) expect(-rows[k * 2].z).toBeGreaterThan(-0.5);
        expect(rows.length).toBe(BEACON_SLOTS * 2);
        world.holdRegion('gorge');
        const gorge = REGIONS.find((r) => r.name === 'gorge').nursery;
        run(world, camera, 0.2);
        const lit = rows.filter((row, i) => i % 2 === 0).reduce((sum, row) => sum + row.w, 0);
        expect(lit).toBeLessThan(BEACON_SLOTS * gorge + 1e-6);
    });

    it('the light the gas gets from them never jumps from one frame to the next (no pops as they pass)', () => {
        const { camera, world } = makeWorld('High', { at: 5 });
        world.holdRegion('nursery');
        const rows = world.u.tables.beacons;
        const carried = () => {
            let sum = 0;
            for (let k = 0; k < world.u.beaconLightCount.value; k++) sum += rows[k * 2 + 1].w;
            return sum;
        };
        let last = carried();
        let worst = 0;
        // A long glide and a run of speed: the stars pass us, leave the march's slots and take them.
        for (let i = 0; i < 60 * 40; i++) {
            if (i === 60 * 20) world.onCombo(6);
            frame(world, camera, 1 / 60);
            const now = carried();
            worst = Math.max(worst, Math.abs(now - last));
            last = now;
        }
        expect(worst).toBeLessThan(0.08);
    });
});

describe('stellar velocity: an effect of its own for each event', () => {
    it('a hard drop slams its hoop open: a shock ring bursts out where the bolt lands, and is gone', () => {
        const { camera, world } = makeWorld();
        const t0 = world.time;
        frame(world, camera, 1 / 60, () => world.onLock({
            u: 0.5, rows: [19], color: COLORS.I, hardDrop: true,
        }));
        run(world, camera, BOLT_FLIGHT * 1.5 + 0.05);
        const shock = world.shockSlots.find((slot) => slot.birth > t0);
        expect(shock).toBeTruthy();
        const row = world.shocks.table[world.shockSlots.indexOf(shock) * 2];
        const r0 = row.y;
        expect(row.z).toBeGreaterThan(0);
        run(world, camera, 0.1);
        expect(row.y).toBeGreaterThan(r0);
        run(world, camera, SHOCK_LIFE);
        expect(row.z).toBe(0);
        // A plain lock slams nothing.
        const { camera: c2, world: w2 } = makeWorld();
        frame(w2, c2, 1 / 60, () => w2.onLock({ u: 0.5, rows: [19], color: COLORS.I }));
        run(w2, c2, BOLT_FLIGHT * 2);
        expect(w2.shockSlots.every((slot) => slot.strength === 0)).toBe(true);
        expect(SHOCK_SLOTS).toBeGreaterThanOrEqual(3);
    });

    it('a twist winds a double helix of the twisting piece\'s colour out of the sun, the other way each time', () => {
        const { camera, world } = makeWorld();
        frame(world, camera, 1 / 60, () => {
            world.onLock({ u: 0.5, rows: [18, 17], color: COLORS.T });
            world.onClear({ lines: 2, twist: true });
        });
        const first = world.helixSlots.find((slot) => slot.strength > 0);
        expect(first).toBeTruthy();
        expect(first.rgb).toEqual(world.lastLockRgb);
        run(world, camera, 0.3);
        frame(world, camera, 1 / 60, () => world.onSpin());
        const second = world.helixSlots.find((slot) => slot !== first && slot.strength > 0);
        expect(second.way).toBe(-first.way);
        expect(second.strength).toBeLessThan(first.strength);
        run(world, camera, HELIX_LIFE + 0.1);
        const rows = world.helix.table;
        for (let i = 0; i < HELIX_SLOTS; i++) expect(rows[i * 2].z).toBe(0);
    });

    it('a back-to-back throws a broad ring of gold off the sun; a chain\'s gear a shock ahead and a ring', () => {
        const { camera, world } = makeWorld();
        const t0 = world.time;
        frame(world, camera, 1 / 60, () => world.onClear({ lines: 2, b2b: true }));
        run(world, camera, 0.1);
        expect(ringsSince(world, t0).some((slot) => slot.rgb.every((c, i) => c === B2B_GOLD[i]))).toBe(true);
        const t1 = world.time;
        frame(world, camera, 1 / 60, () => world.onCombo(2));
        frame(world, camera, 1 / 60, () => world.onCombo(3));
        run(world, camera, 0.1);
        expect(ringsSince(world, t1).length).toBe(2);
        expect(world.shockSlots.filter((slot) => slot.birth >= t1).length).toBe(2);
        expect(world.ringsLive).toBeGreaterThan(0);
        expect(world.ringsLive).toBeLessThanOrEqual(SUN_RING_SLOTS);
    });

    it('a ring leaves the sun fast and slows as it spreads; the run\'s end draws one falling into it', () => {
        expect(sunRingRadius(0, 0.5, 2)).toBe(0);
        expect(sunRingRadius(0.2, 0.5, 2)).toBeGreaterThan(sunRingRadius(0.4, 0.5, 2) - sunRingRadius(0.2, 0.5, 2));
        expect(sunRingRadius(0, -0.5, 2)).toBe(0.5);
        expect(sunRingRadius(3, -0.5, 2)).toBeLessThan(0.02);
    });

    it('the run\'s end: the drive dies (we coast, the sun sinks), and a new run or play rekindles it', () => {
        const { camera, world } = makeWorld();
        run(world, camera, 0.5);
        const glide = world.speed;
        const sun = world.u.sunGain.value;
        const t0 = world.time;
        world.onGameOver();
        expect(ringsSince(world, t0).some((slot) => slot.reach < 0)).toBe(true);
        run(world, camera, STALL_FALL * 1.5);
        expect(world.getState().stalled).toBe(true);
        expect(world.speed).toBeLessThan(glide * 0.4);
        expect(world.u.sunGain.value).toBeLessThan(sun * 0.6);
        // A second game over while it lies dead changes nothing.
        world.onGameOver();
        expect(world.stallAt).toBe(t0);
        world.onSessionStart();
        expect(world.getState().stalled).toBe(false);
        run(world, camera, 3);
        expect(world.getState().stall).toBeLessThan(0.05);
        expect(world.speed).toBeGreaterThan(CRUISE * 0.7);

        // Play after the end rekindles it too (a restart may not announce itself) ...
        world.onGameOver();
        run(world, camera, 1);
        frame(world, camera, 1 / 60, () => world.onLock({ u: 0.5, rows: [19], color: COLORS.O }));
        expect(world.getState().stalled).toBe(false);
        // ... and left alone it finds its breath by itself.
        world.onGameOver();
        run(world, camera, GAME_OVER_REST + 0.5, 200);
        expect(world.getState().stalled).toBe(false);
    });

    it('a new session wipes the stall; reduced motion keeps every effect but the twist\'s roll', () => {
        const { camera, world } = makeWorld();
        world.onGameOver();
        run(world, camera, 1);
        world.resetSession();
        expect(world.getState().stalled).toBe(false);
        world.setReducedMotion(true);
        frame(world, camera, 1 / 60, () => world.onClear({ lines: 2, twist: true }));
        expect(world.helixSlots.some((slot) => slot.strength > 0)).toBe(true);
    });
});
