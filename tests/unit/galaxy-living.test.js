/**
 * Galaxy — what changes by itself, and the shapes play draws with it (the living pass, 2026-11).
 *
 * tests/unit/galaxy-world.test.js pins what play does from the rest look (its worlds hold the air
 * at rest and switch the happenings off). This file holds the rest: the airs, the happenings, the
 * light that runs along the arms, a new level's front, a run's end, the turning sky, the clusters.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    GalaxyWorld, OVER_HOLD, REST_RIG, fovForAspect,
} from '../../src/themes/galaxy/galaxy-world.js';
import {
    AIRS, AIR_HOLD, AIR_KEYS, AIR_SECONDS, HAPPENINGS, HAPPEN_BEAT, HAPPEN_FIRST, airAt, airDrift, happeningAt,
    happeningBeat,
} from '../../src/themes/galaxy/galaxy-living.js';
import {
    CLEAR_SLOTS, DEG, GALAXY, GALAXY_PALETTES, GALAXY_SECONDS, HUSH_HOLD, NOVA_SLOTS, PULSE_SLOTS, PULSE_TAIL, TAU,
    WIPE_SPEED, armAngle, armReach, galaxyAnchors,
} from '../../src/themes/galaxy/galaxy-core.js';
import {
    CLUSTER_SHARE, GLOBULARS, OPEN_CLUSTERS, buildPlan,
} from '../../src/themes/galaxy/galaxy-plan.js';
import { SKY_TURN, skyCloudPoint, skyFrame } from '../../src/themes/galaxy/galaxy-sky.js';
import { fallbackLayout } from '../../src/themes/galaxy/galaxy-composition.js';

function run(world, camera, seconds, steps = Math.max(1, Math.round(seconds * 60))) {
    const t0 = world.time;
    for (let i = 1; i <= steps; i++) {
        const sim = { time: t0 + (seconds * i) / steps, delta: seconds / steps };
        world.updateCamera(camera, sim);
        world.update(sim, camera);
    }
}

function settle(world, camera, time) {
    world.seek(time);
    world.updateCamera(camera, { time, delta: 0 });
    world.update({ time, delta: 0 }, camera);
}

/** A world left to itself (`living`), or one held at rest with nothing happening by itself. */
function makeWorld(quality = 'Low', { living = false, time = 10 } = {}) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(fovForAspect(16 / 9), 16 / 9, REST_RIG.near, REST_RIG.far);
    const world = new GalaxyWorld({ scene, quality, capture: true }).build();
    world.bindCamera(camera);
    world.setViewport(1600, 900, 16 / 9);
    world.setLayout(fallbackLayout(1600, 900), 16 / 9);
    if (!living) world.holdAir(0).setHappenings(false);
    settle(world, camera, time);
    return { camera, world };
}

/** The pulse slots stamped at `birth`. */
const pulsesBornAt = (world, birth) => world.u.pulseA.map((slot, i) => ({ a: slot.value, c: world.u.pulseC[i].value }))
    .filter(({ a }) => Math.abs(a.x - birth) < 1e-9 && a.w > 0);

/** How far the disc leans back from the line of sight right now (radians). */
function leanOf(world) {
    const axis = new THREE.Vector3().setFromMatrixColumn(world.u.frame.value, 1);
    return Math.acos(axis.dot(world.u.centre.value.clone().normalize().negate()));
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('galaxy living: the airs', () => {
    it('rests on today\'s look, then turns through its airs on a clock of its own', () => {
        const rest = airAt(0);
        for (const key of AIR_KEYS) expect(rest[key], key).toBe(AIRS[0][key]);
        // The first air IS the rest look: every factor one, nothing added.
        for (const key of ['knots', 'young', 'dust', 'core', 'halo', 'clouds']) expect(AIRS[0][key], key).toBe(1);
        for (const key of ['jets', 'stars', 'wind', 'lean', 'tilt']) expect(AIRS[0][key], key).toBe(0);
        expect(airDrift(AIR_SECONDS * AIR_HOLD * 0.99)).toBe(0);
        for (let k = 1; k <= AIRS.length + 1; k++) {
            expect(airDrift(AIR_SECONDS * k)).toBe(k);
            const air = airAt(airDrift(AIR_SECONDS * k));
            for (const key of AIR_KEYS) expect(air[key], `${k} ${key}`).toBeCloseTo(AIRS[k % AIRS.length][key], 12);
            expect(air.name).toBe(AIRS[k % AIRS.length].name);
        }
        // Between two it is neither, and never outside them.
        const mid = airAt(0.5);
        for (const key of AIR_KEYS) {
            expect(mid[key], key).toBeGreaterThanOrEqual(Math.min(AIRS[0][key], AIRS[1][key]) - 1e-12);
            expect(mid[key], key).toBeLessThanOrEqual(Math.max(AIRS[0][key], AIRS[1][key]) + 1e-12);
        }
        expect(mid.dust).not.toBe(AIRS[0].dust);
        // Every air is its own: none repeats another's numbers, and each has a name.
        const seen = new Set(AIRS.map((air) => AIR_KEYS.map((key) => air[key]).join(',')));
        expect(seen.size).toBe(AIRS.length);
        expect(new Set(AIRS.map((air) => air.name)).size).toBe(AIRS.length);
    });

    it('drifts against the palettes\' clock, so a palette meets a different air each round', () => {
        expect(AIR_SECONDS).not.toBe(GALAXY_SECONDS);
        const pairs = new Set();
        for (let t = 20; t < GALAXY_SECONDS * GALAXY_PALETTES.length * 4; t += 50) {
            const palette = Math.floor(t / GALAXY_SECONDS) % GALAXY_PALETTES.length;
            pairs.add(`${palette}:${Math.round(airDrift(t)) % AIRS.length}`);
        }
        expect(pairs.size).toBeGreaterThan(GALAXY_PALETTES.length * 2);
    });

    it('wears the air it is in: the dust, the clouds, the arms\' winding and the lean of the disc', () => {
        const { camera, world } = makeWorld('Low');
        const anchors = galaxyAnchors(16 / 9);
        const restLean = leanOf(world);
        const restNursery = world.u.nursery.value.x;
        expect(world.u.dustGain.value).toBe(1);
        expect(world.u.winding.value).toBeCloseTo(GALAXY.winding, 12);
        expect(world.getState().air).toBe('clear');
        const veiled = AIRS.findIndex((air) => air.name === 'veiled');
        world.holdAir(veiled);
        run(world, camera, 1 / 60, 1);
        expect(world.getState().air).toBe('veiled');
        expect(world.u.dustGain.value).toBe(AIRS[veiled].dust);
        expect(world.u.halo.value.w).toBe(AIRS[veiled].clouds);
        expect(world.u.winding.value).toBeCloseTo(GALAXY.winding + AIRS[veiled].wind, 9);
        expect(world.u.nursery.value.x).toBeCloseTo(restNursery * AIRS[veiled].knots, 6);
        // It leans further back by the air's own degrees (give or take a frame of its breathing).
        expect((leanOf(world) - restLean) / DEG).toBeCloseTo(AIRS[veiled].lean, 1);
        expect(Math.abs(leanOf(world) - anchors.inclination)).toBeLessThan(16 * DEG);
        // A nursery stands where the winding now puts it: play still aims true.
        const site = world.plan.nurseries[0];
        const local = new THREE.Vector3(
            Math.cos(armAngle(site.radius, world.u.winding.value) + site.offset) * site.radius,
            site.y,
            Math.sin(armAngle(site.radius, world.u.winding.value) + site.offset) * site.radius,
        ).applyMatrix4(world.u.frame.value);
        const [x, y, z] = world.nurseryWorld(0, [0, 0, 0]);
        expect(local.distanceTo(new THREE.Vector3(x, y, z))).toBeLessThan(1e-6);
        world.dispose();
    });

    it('wears an air\'s light under reduced motion, but not its lean or its winding', () => {
        const { camera, world } = makeWorld('Low');
        const anchors = galaxyAnchors(16 / 9);
        world.setReducedMotion(true);
        const tide = AIRS.findIndex((air) => air.name === 'tide');
        world.holdAir(tide);
        run(world, camera, 1 / 60, 1);
        expect(world.u.dustGain.value).toBe(AIRS[tide].dust);
        expect(world.u.winding.value).toBeCloseTo(GALAXY.winding, 12);
        expect(leanOf(world)).toBeCloseTo(anchors.inclination, 9);
        world.dispose();
    });

    it('turns by the clock in a world left to itself, the same whatever the frame rate, a level two airs on', () => {
        const slow = makeWorld('Low', { living: true });
        const fast = makeWorld('Low', { living: true });
        for (const made of [slow, fast]) made.world.setHappenings(false);
        // Inside the first air's rest nothing has moved.
        expect(slow.world.getState().airPhase).toBe(0);
        const span = AIR_SECONDS * (AIR_HOLD + (1 - AIR_HOLD) * 0.5) - slow.world.time;
        run(slow.world, slow.camera, span, Math.round(span * 20));
        run(fast.world, fast.camera, span, Math.round(span * 120));
        const phase = slow.world.getState().airPhase;
        expect(phase).toBeGreaterThan(0.3);
        expect(phase).toBeLessThan(0.7);
        expect(fast.world.getState().airPhase).toBeCloseTo(phase, 9);
        expect(fast.world.u.dustGain.value).toBeCloseTo(slow.world.u.dustGain.value, 9);
        // A level moves the air on with the palette, eased, in the same frame at any frame rate.
        slow.world.levelUp(2);
        fast.world.levelUp(2);
        run(slow.world, slow.camera, 1.5, 45);
        run(fast.world, fast.camera, 1.5, 360);
        expect(slow.world.getState().airPhase).toBeGreaterThan(phase + 0.5);
        expect(fast.world.getState().airPhase).toBeCloseTo(slow.world.getState().airPhase, 6);
        expect(fast.world.u.nursery.value.distanceTo(slow.world.u.nursery.value)).toBeLessThan(1e-3);
        slow.world.dispose();
        fast.world.dispose();
    });
});

describe('galaxy living: the happenings', () => {
    it('deals one a beat, a pure function of the beat, every kind in turn', () => {
        expect(happeningBeat(0)).toBe(-1);
        expect(happeningBeat(HAPPEN_FIRST - 0.01)).toBe(-1);
        expect(happeningBeat(HAPPEN_FIRST)).toBe(0);
        expect(happeningBeat(HAPPEN_FIRST + HAPPEN_BEAT * 3 + 1)).toBe(3);
        const kinds = new Set();
        for (let i = 0; i < HAPPENINGS.length * 2; i++) {
            const h = happeningAt(i);
            expect(happeningAt(i)).toEqual(h);
            expect(HAPPENINGS).toContain(h.kind);
            // It starts inside its own beat, well before the next.
            expect(h.time).toBeGreaterThanOrEqual(HAPPEN_FIRST + i * HAPPEN_BEAT);
            expect(h.time).toBeLessThan(HAPPEN_FIRST + i * HAPPEN_BEAT + HAPPEN_BEAT * 0.5);
            for (const key of ['a', 'b', 'c']) {
                expect(h[key]).toBeGreaterThanOrEqual(0);
                expect(h[key]).toBeLessThan(1);
            }
            kinds.add(h.kind);
        }
        expect([...kinds].sort()).toEqual([...new Set(HAPPENINGS)].sort());
        // Two rounds do not deal the kinds in the same order.
        const round = (r) => Array.from({ length: HAPPENINGS.length }, (_, i) => happeningAt(r * HAPPENINGS.length + i).kind);
        expect(round(0)).not.toEqual(round(1));
    });

    it('lets each happen at its own moment whatever the frame rate, once, and never in a frozen frame', () => {
        const first = happeningAt(0);
        const slow = makeWorld('Low', { living: true, time: HAPPEN_FIRST - 2 });
        const fast = makeWorld('Low', { living: true, time: HAPPEN_FIRST - 2 });
        const heardSlow = vi.spyOn(slow.world, 'happen');
        const heardFast = vi.spyOn(fast.world, 'happen');
        // Before its moment, nothing.
        run(slow.world, slow.camera, first.time - slow.world.time - 0.2, 20);
        expect(heardSlow).not.toHaveBeenCalled();
        run(slow.world, slow.camera, 2, 30);
        run(fast.world, fast.camera, first.time - fast.world.time + 1.8, 600);
        expect(heardSlow).toHaveBeenCalledOnce();
        expect(heardFast).toHaveBeenCalledOnce();
        expect(heardSlow.mock.calls[0][0]).toMatchObject({ kind: first.kind, time: first.time });
        expect(heardFast.mock.calls[0][0]).toMatchObject({ kind: first.kind, time: first.time });
        expect(slow.world.counts.happenings).toBe(1);
        // The rest of the beat adds none.
        run(slow.world, slow.camera, HAPPEN_BEAT * 0.4, 40);
        expect(heardSlow).toHaveBeenCalledOnce();
        // A capture stepping over beats with the clock frozen adds none either.
        slow.world.update({ time: slow.world.time + HAPPEN_BEAT * 3, delta: 0 }, slow.camera);
        expect(heardSlow).toHaveBeenCalledOnce();
        slow.world.dispose();
        fast.world.dispose();
    });

    it('lights a sun in an arm beside a nursery in view, and rings the gas round it a moment later', () => {
        const { camera, world } = makeWorld('Low');
        const t = world.time;
        expect(world.novae.count).toBe(NOVA_SLOTS);
        expect(world.novae.liveAt(t)).toBe(0);
        world.happen({
            kind: 'nova', time: t, a: 0.3, b: 0.5, c: 0.2,
        });
        expect(world.novae.liveAt(t)).toBe(1);
        const site = world.novae.geometry.getAttribute('aSite').array;
        expect(site[3]).toBe(t);
        expect(site[0]).toBeGreaterThan(GALAXY.armStart);
        expect(site[0]).toBeLessThan(GALAXY.radius);
        const ring = world.u.lockA.find((slot) => Math.abs(slot.value.z - (t + 0.25)) < 1e-6);
        expect(ring).toBeTruthy();
        expect(Math.hypot(ring.value.x, ring.value.y)).toBeCloseTo(site[0], 3);
        // It burns out, and the pool never grows: a fourth takes the slot spent first.
        for (let k = 1; k <= NOVA_SLOTS; k++) {
            world.happen({
                kind: 'nova', time: t + k, a: 0.1 * k, b: 0.5, c: 0.7,
            });
        }
        expect(world.novae.geometry.getAttribute('aSite').count).toBe(NOVA_SLOTS);
        expect(world.novae.liveAt(t + NOVA_SLOTS)).toBe(NOVA_SLOTS);
        run(world, camera, 30);
        expect(world.novae.liveAt(world.time)).toBe(0);
        world.dispose();
    });

    it('gives every kind its own doing: a slow pulse down one arm, a shower, the nucleus, the companion', () => {
        const { camera, world } = makeWorld('Low');
        const t = world.time;
        world.happen({
            kind: 'ripple', time: t, a: 0.2, b: 0, c: 0,
        });
        const [ripple] = pulsesBornAt(world, t);
        expect(ripple.a.y).toBeGreaterThan(3); // slow, outward
        expect(Math.abs(ripple.a.z)).toBe(1); // one arm
        const meteors = world.meteors.geometry.getAttribute('aStart').array;
        const flying = () => Array.from({ length: world.meteors.count }, (_, i) => meteors[i * 4 + 3]).filter((v) => v > -50).length;
        expect(flying()).toBe(0);
        world.happen({
            kind: 'shower', time: t, a: 0.9, b: 0, c: 0,
        });
        expect(flying()).toBeGreaterThanOrEqual(4);
        const jets = world.u.jets.value.w + world.u.jetBursts.value.y + world.u.jetBursts.value.w;
        world.happen({
            kind: 'stir', time: t, a: 0, b: 0, c: 0,
        });
        expect(world.u.jets.value.w + world.u.jetBursts.value.y + world.u.jetBursts.value.w).toBeGreaterThan(jets);
        world.happen({
            kind: 'flash', time: t, a: 0, b: 0, c: 0,
        });
        run(world, camera, 0.3);
        expect(world.u.companion.value.w).toBeGreaterThan(0.1);
        expect(world.counts.happenings).toBe(4);
        world.dispose();
    });

    it('does nothing by itself when switched off, or while a run\'s end holds it dark', () => {
        const off = makeWorld('Low', { living: true, time: HAPPEN_FIRST - 1 });
        off.world.setHappenings(false);
        const heardOff = vi.spyOn(off.world, 'happen');
        run(off.world, off.camera, HAPPEN_BEAT * 2, 200);
        expect(heardOff).not.toHaveBeenCalled();
        const dark = makeWorld('Low', { living: true, time: HAPPEN_FIRST - 1 });
        const heardDark = vi.spyOn(dark.world, 'happen');
        dark.world.onGameOver();
        run(dark.world, dark.camera, 7.5, 200);
        expect(dark.world.over).toBe(true);
        expect(heardDark).not.toHaveBeenCalled();
        off.world.dispose();
        dark.world.dispose();
    });
});

describe('galaxy living: light along the arms', () => {
    it('measures an arm from the bar to the rim', () => {
        expect(armReach(GALAXY.armStart)).toBe(0);
        expect(armReach(GALAXY.armStart * 0.3)).toBe(0);
        expect(armReach(GALAXY.radius)).toBeCloseTo(1, 12);
        let last = -1;
        for (let r = GALAXY.armStart; r <= GALAXY.radius; r += 5) {
            expect(armReach(r)).toBeGreaterThan(last);
            last = armReach(r);
        }
    });

    it('runs out one arm for a line (in turns), both for two and three, twice down both for four', () => {
        const { camera, world } = makeWorld('Low');
        expect(world.u.pulseA).toHaveLength(PULSE_SLOTS);
        expect(world.u.pulsesLive.value).toBe(0);
        let t = world.time;
        world.onClear({ lines: 1 });
        const [one] = pulsesBornAt(world, t);
        expect(pulsesBornAt(world, t)).toHaveLength(1);
        expect(one.a.y).toBeGreaterThan(0); // outward
        expect(Math.abs(one.a.z)).toBe(1); // one arm
        run(world, camera, 1 / 60, 1);
        expect(world.u.pulsesLive.value).toBe(1);
        run(world, camera, 0.5);
        t = world.time;
        world.onClear({ lines: 1 });
        expect(pulsesBornAt(world, t)[0].a.z).toBe(-one.a.z); // the other arm
        run(world, camera, 0.5);
        t = world.time;
        world.onClear({ lines: 2 });
        const [two] = pulsesBornAt(world, t);
        expect(two.a.z).toBe(0); // both
        run(world, camera, 0.5);
        t = world.time;
        world.onClear({ lines: 3 });
        const [three] = pulsesBornAt(world, t);
        expect(three.a.z).toBe(0);
        expect(three.a.w).toBeGreaterThan(two.a.w); // hotter
        expect(three.a.y).toBeLessThan(two.a.y); // and quicker
        run(world, camera, 4);
        // Four lines: the whole pattern ignites when the nucleus erupts, and again behind it.
        t = world.time;
        world.onClear({ lines: 4 });
        const threeWidth = three.c.w;
        const four = world.u.pulseA.map((slot, i) => ({ a: slot.value, c: world.u.pulseC[i].value }))
            .filter(({ a }) => a.x >= t + HUSH_HOLD - 1e-9 && a.w > 0);
        expect(four).toHaveLength(2);
        for (const { a } of four) expect(a.z).toBe(0);
        // (its head is the longest of all: the arms light whole, in their own colour)
        expect(Math.max(...four.map(({ c }) => c.w))).toBeGreaterThan(threeWidth);
        // Spent, the shaders skip the loop again.
        run(world, camera, 6);
        expect(world.u.pulsesLive.value).toBe(0);
        world.dispose();
    });

    it('runs IN along the arms on a twist, the other way from a clear', () => {
        const { camera, world } = makeWorld('Low');
        const t = world.time;
        world.onClear({ lines: 2, twist: true });
        const born = pulsesBornAt(world, t);
        expect(born).toHaveLength(2);
        expect(born.filter(({ a }) => a.y < 0)).toHaveLength(1);
        expect(born.filter(({ a }) => a.y > 0)).toHaveLength(1);
        const twistStrength = born.find(({ a }) => a.y < 0).a.w;
        run(world, camera, 3);
        const later = world.time;
        world.onSpin();
        const [spin] = pulsesBornAt(world, later);
        expect(spin.a.y).toBeLessThan(0);
        expect(Math.abs(spin.a.z)).toBe(1);
        expect(spin.a.w).toBeLessThan(twistStrength);
        world.dispose();
    });

    it('never cuts a brighter pulse for a fainter one, and never grows its table', () => {
        const { world } = makeWorld('Low');
        const t = world.time;
        const strong = world.pulse(t, { span: 1.4, strength: 1.5 });
        for (let k = 0; k < PULSE_SLOTS * 2; k++) world.pulse(t + 0.01 * (k + 1), { span: 1, strength: 0.3 });
        expect(world.u.pulseA).toHaveLength(PULSE_SLOTS);
        expect(world.u.pulseA[strong].value.w).toBe(1.5);
        expect(world.u.pulseA[strong].value.x).toBe(t);
        // A slot is live for its run and its wake, no longer.
        expect(PULSE_TAIL).toBeGreaterThan(0);
        world.dispose();
    });
});

describe('galaxy living: a new level, a perfect clear, a back-to-back', () => {
    it('sweeps a new level\'s colours out from the nucleus at a steady pace', () => {
        const { camera, world } = makeWorld('Low');
        expect(world.u.wipe.value.x).toBeGreaterThan(GALAXY.bound * 2);
        world.levelUp(2);
        run(world, camera, 0.5, 30);
        expect(world.u.wipe.value.x).toBeCloseTo(0.5 * WIPE_SPEED, 6);
        expect(world.u.wipe.value.y).toBeGreaterThan(0);
        run(world, camera, 0.5, 30);
        expect(world.u.wipe.value.x).toBeCloseTo(WIPE_SPEED, 6);
        // A capture that rests on a level wears it everywhere at once: no front.
        world.levelUp(3, { silent: true });
        settle(world, camera, 40);
        world.levelUp(3, { silent: true });
        world.update({ time: 40, delta: 0 }, camera);
        expect(world.u.wipe.value.x).toBeGreaterThan(GALAXY.bound * 2);
        world.dispose();
    });

    it('sends a front of gold across the whole sky for a perfect clear, and for its late crown', () => {
        const { camera, world } = makeWorld('Low');
        expect(world.u.crownWave.value.y).toBe(0);
        const t = world.time;
        world.onClear({ lines: 4, perfect: true });
        expect(world.u.crownWave.value.x).toBeCloseTo(t + HUSH_HOLD, 9);
        expect(world.u.crownWave.value.y).toBeGreaterThan(0);
        run(world, camera, 5);
        const later = world.time;
        world.onClear({ crown: true });
        expect(world.u.crownWave.value.x).toBe(later);
        // A plain four-line clear sends none.
        const plain = makeWorld('Low');
        plain.world.onClear({ lines: 4 });
        expect(plain.world.u.crownWave.value.y).toBe(0);
        plain.world.dispose();
        world.dispose();
    });

    it('answers a back-to-back with the companion\'s own ring across the sky', () => {
        const { world } = makeWorld('Low');
        world.onClear({ lines: 4 });
        expect(world.u.shockC.value.y).toBe(0);
        const t = world.time;
        world.onClear({ lines: 4, b2b: true });
        expect(world.u.shockC.value.x).toBeGreaterThan(t);
        expect(world.u.shockC.value.y).toBeGreaterThan(0);
        const first = world.u.shockC.value.y;
        world.onClear({ lines: 4, b2b: true });
        expect(world.u.shockC.value.y).toBeGreaterThan(first);
        world.dispose();
    });

    it('throws a plume out of the plane where a hard drop\'s seed lands, and none for a soft lock', () => {
        const soft = makeWorld('Low');
        const hard = makeWorld('Low');
        const softSparks = vi.spyOn(soft.world.sparks, 'emit');
        const hardSparks = vi.spyOn(hard.world.sparks, 'emit');
        soft.world.onLock({ u: 0.2, color: '#40ffc0' });
        hard.world.onLock({ u: 0.2, color: '#40ffc0', hardDrop: true });
        run(soft.world, soft.camera, 2);
        run(hard.world, hard.camera, 2);
        const plumes = (spy) => spy.mock.calls.filter(([burst]) => burst.lift > 1).length;
        expect(plumes(softSparks)).toBe(0);
        expect(plumes(hardSparks)).toBe(1);
        soft.world.dispose();
        hard.world.dispose();
    });
});

describe('galaxy living: a run\'s end', () => {
    it('sinks into the night, stays dark through the menu\'s reset, and comes back by itself', () => {
        const { camera, world } = makeWorld('Low');
        const before = { arm: world.u.armInner.value.clone(), glare: world.nucleus.uniforms.glare.value.x };
        world.onGameOver();
        expect(world.getState().over).toBe(true);
        run(world, camera, 4);
        expect(world.dusk).toBeGreaterThan(0.95);
        expect(world.u.breath.value).toBeLessThan(0.5);
        expect(world.u.breath.value).toBeGreaterThan(0.3);
        expect(world.u.armInner.value.length()).toBeLessThan(before.arm.length() * 0.55);
        // The theme resets the session behind it (the menu): the dusk holds.
        world.resetSession();
        run(world, camera, 1 / 60, 1);
        expect(world.over).toBe(true);
        expect(world.dusk).toBeGreaterThan(0.95);
        // Left alone it comes back, gently: no wave, no pulse.
        run(world, camera, OVER_HOLD);
        expect(world.over).toBe(false);
        run(world, camera, 12);
        expect(world.dusk).toBe(0);
        expect(world.u.breath.value).toBeCloseTo(1, 4);
        expect(world.u.armInner.value.distanceTo(before.arm)).toBeLessThan(1e-3);
        expect(world.u.wavesLive.value).toBe(0);
        world.dispose();
    });

    it('re-ignites from the nucleus when the next run starts, and only if it was dark', () => {
        const { camera, world } = makeWorld('Low');
        const wavesAt = (time) => world.u.waveA.filter((slot) => Math.abs(slot.value.x - time) < 1e-9 && slot.value.z > 0).length;
        // Nothing dark: a new run starts without a mark.
        world.onSessionStart();
        expect(wavesAt(world.time)).toBe(0);
        world.onGameOver();
        run(world, camera, 3);
        const t = world.time;
        world.onSessionStart();
        expect(world.over).toBe(false);
        expect(wavesAt(t)).toBe(1);
        expect(pulsesBornAt(world, t)).toHaveLength(1);
        expect(world.u.waveA).toHaveLength(CLEAR_SLOTS);
        run(world, camera, 13);
        expect(world.dusk).toBe(0);
        expect(world.u.breath.value).toBeCloseTo(1, 3);
        world.dispose();
    });

    it('forgets a run\'s end when the clock is jumped', () => {
        const { camera, world } = makeWorld('Low');
        world.onGameOver();
        run(world, camera, 2);
        settle(world, camera, 30);
        expect(world.getState()).toMatchObject({ over: false, dusk: 0 });
        expect(world.u.breath.value).toBe(1);
        world.dispose();
    });
});

describe('galaxy living: the turning sky', () => {
    it('turns its own frame rigidly about the band\'s pole, so the band\'s line never moves', () => {
        const a = skyFrame(0, new THREE.Matrix3());
        const b = skyFrame(1.3, new THREE.Matrix3());
        for (const m of [a, b]) {
            expect(m.determinant()).toBeCloseTo(1, 9);
            const mt = m.clone().transpose().multiply(m).elements;
            [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => expect(mt[i]).toBeCloseTo(v, 9));
        }
        const dirs = [[0, 0, -1], [0.3, 0.2, -0.93], [-0.5, -0.1, -0.86]].map((d) => new THREE.Vector3(...d).normalize());
        for (const dir of dirs) {
            const qa = dir.clone().applyMatrix3(a);
            const qb = dir.clone().applyMatrix3(b);
            // The latitude (the band's own coordinate) is the same at any turn; the longitude moved by it.
            expect(qb.y).toBeCloseTo(qa.y, 9);
            const moved = Math.atan2(qb.z, qb.x) - Math.atan2(qa.z, qa.x);
            expect(Math.cos(Math.abs(moved) - 1.3)).toBeCloseTo(1, 9);
            // The clouds' own coordinates are those two, scaled.
            const pa = skyCloudPoint(dir, a, new THREE.Vector2());
            expect(pa.y / qa.y).toBeCloseTo(skyCloudPoint(dirs[1], a, new THREE.Vector2()).y / dirs[1].clone().applyMatrix3(a).y, 9);
        }
    });

    it('turns the deep sky by the clock, slower under reduced motion, and keeps it through a new run', () => {
        const { camera, world } = makeWorld('Low');
        expect(world.skyTurn).toBeCloseTo((10 * TAU) / SKY_TURN, 12);
        run(world, camera, 6);
        expect(world.skyTurn).toBeCloseTo((16 * TAU) / SKY_TURN, 9);
        const kept = world.skyTurn;
        world.resetSession();
        expect(world.skyTurn).toBe(kept);
        // The uniform is the frame of that turn, and the galaxy stands where the frame puts it.
        const frame = skyFrame(world.skyTurn, new THREE.Matrix3());
        frame.elements.forEach((v, i) => expect(world.u.skyRot.value.elements[i]).toBeCloseTo(v, 12));
        const light = skyCloudPoint(world.u.nucleusDir.value, frame, new THREE.Vector2());
        expect(world.u.skyLight.value.distanceTo(light)).toBeLessThan(1e-9);
        world.setReducedMotion(true);
        run(world, camera, 6);
        expect(world.skyTurn - kept).toBeCloseTo(((6 * TAU) / SKY_TURN) * 0.3, 9);
        world.dispose();
    });

    it('hangs a halo round the galaxy as wide as its distance says and as flat as its lean', () => {
        const { camera, world } = makeWorld('Low');
        expect(world.u.halo.value.x).toBeGreaterThan(0.02);
        expect(world.u.halo.value.x).toBeLessThan(0.3);
        expect(world.u.halo.value.y).toBeGreaterThan(0.6);
        expect(world.u.halo.value.y).toBeLessThan(1);
        const rest = world.u.halo.value.z;
        expect(rest).toBeGreaterThan(0);
        world.onCombo(6);
        run(world, camera, 2);
        expect(world.u.halo.value.z).toBeGreaterThan(rest);
        world.dispose();
    });
});

describe('galaxy living: star clusters and near stars', () => {
    const plan = buildPlan(undefined, { stars: 40000 });

    it('gathers a share of the suns into clusters whose sites no tier moves', () => {
        expect(plan.clusters.open).toHaveLength(OPEN_CLUSTERS);
        expect(plan.clusters.globular).toHaveLength(GLOBULARS);
        expect(plan.stars.tally[4] / plan.stars.count).toBeCloseTo(CLUSTER_SHARE, 2);
        const small = buildPlan(undefined, { stars: 500 });
        expect(small.clusters).toEqual(plan.clusters);
        // Open ones stand in the arms; globular ones mostly well out of the plane.
        for (const c of plan.clusters.open) {
            expect(c.radius).toBeGreaterThan(GALAXY.armStart);
            expect(c.radius).toBeLessThan(GALAXY.radius);
            expect(Math.abs(c.y)).toBeLessThan(2);
            expect(c.temp).toBeGreaterThan(0.7);
        }
        const high = plan.clusters.globular.filter((c) => Math.abs(c.y) > 6).length;
        expect(high).toBeGreaterThan(GLOBULARS * 0.5);
        for (const c of plan.clusters.globular) expect(c.temp).toBeLessThan(0.4);
    });

    it('keeps every member within a few light-units of its cluster, where its shader will draw it', () => {
        const sites = [...plan.clusters.open, ...plan.clusters.globular].map((c) => {
            const angle = armAngle(c.radius) + c.offset;
            return [Math.cos(angle) * c.radius, c.y, Math.sin(angle) * c.radius];
        });
        let members = 0;
        let stray = 0;
        for (let i = 0; i < plan.stars.count; i++) {
            if (plan.stars.look[i * 4 + 2] !== 4) continue;
            members += 1;
            const radius = plan.stars.orbit[i * 4];
            // As the vertex stage places it: on its own radius, at its offset from that radius's ridge.
            const angle = armAngle(radius) + plan.stars.orbit[i * 4 + 1];
            const p = [Math.cos(angle) * radius, plan.stars.orbit[i * 4 + 2], Math.sin(angle) * radius];
            let near = Infinity;
            for (const s of sites) near = Math.min(near, Math.hypot(p[0] - s[0], p[1] - s[1], p[2] - s[2]));
            if (near > 4.5) stray += 1;
        }
        expect(members).toBeGreaterThan(1000);
        expect(stray / members).toBeLessThan(0.01);
    });

    it('hangs a few foreground stars nearer than the rest, none on the far shell\'s wrong side', () => {
        const near = plan.giants.map((g) => g.near);
        for (const n of near) {
            expect(n).toBeGreaterThanOrEqual(0);
            expect(n).toBeLessThanOrEqual(1);
        }
        expect(near.filter((n) => n > 0.1).length).toBeGreaterThan(3);
        expect(near.filter((n) => n < 0.05).length).toBeGreaterThan(near.length * 0.4);
    });
});
