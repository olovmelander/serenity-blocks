/**
 * Serenity Warp — the living warp (third pass, 2026-11): the moods on their own clock, the
 * wandering stars and the comet, the event shapes, a chain's surges and the gate closing at a
 * run's end. A real SerenityWarpWorld on the CPU (no renderer), as in serenity-warp-world.test.js.
 *
 * Relations, not tuning numbers: what changes by itself and how smoothly, which event throws which
 * shape, that nothing alive re-randomises, and that the game's end survives a session reset.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    REST_RIG, SerenityWarpWorld, fovForAspect,
} from '../../src/themes/serenity-warp/serenity-warp-world.js';
import {
    CLOSE_HOLD, CLOSE_IN, CLOSE_OPEN, COMET_EVERY, COMET_FIRST, COMET_LIFE, FORM_KINDS, FORM_SLOTS,
    INFALL_CLEAR, INFALL_EVERY, INFALL_RIDE, INFALL_TEAR, MOOD_STEP, WARP_MOODS,
    closedAt, cometPath, formLight, formReach, infallPlace, infallVisitor, moodAt, moodPlace, surgePlace,
} from '../../src/themes/serenity-warp/serenity-warp-living.js';
import { EVENT_ROWS } from '../../src/themes/serenity-warp/serenity-warp-tsl.js';
import { QUALITY } from '../../src/themes/serenity-warp/serenity-warp-quality.js';
import { fallbackLayout } from '../../src/themes/serenity-warp/serenity-warp-composition.js';

function makeWorld(quality = 'High', { width = 1600, height = 900, at = 10 } = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new SerenityWarpWorld({ scene, quality, capture: true }).build();
    world.bindCamera(camera);
    world.setViewport(width, height, aspect);
    world.setLayout(fallbackLayout(width, height), aspect);
    settle(world, camera, at);
    return { world, camera };
}

function settle(world, camera, time) {
    world.seek(time);
    const sim = {
        time, delta: 0, pointerX: 0, pointerY: 0,
    };
    world.updateCamera(camera, sim);
    world.update(sim, camera);
}

function frame(world, camera, dt, during = null) {
    const sim = {
        time: world.time + dt, delta: dt, pointerX: 0, pointerY: 0,
    };
    world.updateCamera(camera, sim);
    during?.();
    world.update(sim, camera);
}

function run(world, camera, seconds, dt = 1 / 30, each = null) {
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i++) {
        frame(world, camera, dt);
        each?.(world);
    }
}

describe('Serenity Warp living: moods', () => {
    it('rests on each mood whole and walks all four on the clock alone, then comes round', () => {
        const seen = [];
        for (let k = 0; k <= WARP_MOODS.length; k++) {
            // Inside each mood's rest the clock shows that mood exactly.
            const m = moodAt(moodPlace(0, (k + 0.2) * MOOD_STEP));
            seen.push(m.name);
            const want = WARP_MOODS[k % WARP_MOODS.length];
            for (const key of ['arms3', 'wind', 'streamers', 'throat']) expect(m[key]).toBeCloseTo(want[key], 9);
        }
        expect(seen).toEqual([...WARP_MOODS.map((m) => m.name), WARP_MOODS[0].name]);
    });

    it('melts from one mood to the next without a jump, and a level moves it one mood on', () => {
        let last = moodAt(moodPlace(0, 0));
        for (let t = 0; t < MOOD_STEP * WARP_MOODS.length; t += 0.5) {
            const m = moodAt(moodPlace(0, t));
            for (const key of ['arms3', 'wind', 'inflow', 'streamers', 'nebula', 'throat', 'knots', 'reach']) {
                expect(Math.abs(m[key] - last[key])).toBeLessThan(0.05);
            }
            last = m;
        }
        expect(moodAt(moodPlace(1, 5)).name).toBe(WARP_MOODS[1].name);
    });

    it('feeds the mood to the shaders and the gate (arms, wind, width) as the clock turns', () => {
        const { world, camera } = makeWorld('High', { at: 5 });
        const calm = world.u.mood.value.clone();
        const calmWiden = world.gateWiden;
        settle(world, camera, MOOD_STEP * 1.2);
        expect(world.mood.name).toBe('torrent');
        expect(world.u.mood.value.x).toBeGreaterThan(calm.x); // three arms
        expect(world.u.mood.value.y).toBeGreaterThan(calm.y); // wound tighter
        expect(world.gateWiden).toBeLessThan(calmWiden); // a narrower throat
        // The open sky turns round the gate and its clouds drift on, by the clock.
        expect(world.u.mood2.value.z).toBeGreaterThan(0);
        expect(world.u.cloudDrift.value).toBeGreaterThan(0);
    });
});

describe('Serenity Warp living: visitors', () => {
    it('schedules the wandering stars from the clock alone: the same star for the same k', () => {
        const a = infallVisitor(3);
        const b = infallVisitor(3);
        expect(a).toEqual(b);
        const births = [0, 1, 2, 3, 4].map((k) => infallVisitor(k).birth);
        births.forEach((t, i) => i && expect(t).toBeGreaterThan(births[i - 1] + INFALL_RIDE));
        expect(births[1] - births[0]).toBeGreaterThan(INFALL_EVERY * 0.7);
    });

    it('falls in steadily toward the ring and only then is torn', () => {
        const rim = 0.11;
        let last = infallPlace(0, rim).L;
        for (let age = 0.1; age <= INFALL_RIDE + INFALL_TEAR; age += 0.1) {
            const { L, tear } = infallPlace(age, rim);
            expect(L).toBeLessThanOrEqual(last + 1e-12);
            expect(tear === 0).toBe(age <= INFALL_RIDE);
            last = L;
        }
        expect(infallPlace(INFALL_RIDE + INFALL_TEAR, rim).tear).toBe(1);
    });

    it('stands a caught star on the open side of the gate, and flares the ring as it goes in', () => {
        const v = infallVisitor(0);
        const { world, camera } = makeWorld('High', { at: v.birth + 1 });
        expect(world.getState().visitors).toBe(1);
        // Run to where it leaves the board's shadow: its screen turn φ = turn − L·wind + spin.
        let phiAtClear = null;
        let flared = 0;
        run(world, camera, INFALL_RIDE + INFALL_TEAR + 0.5, 1 / 30, (w) => {
            const row = w.u.tables.events[EVENT_ROWS.visitors];
            if (w.getState().visitors && phiAtClear === null && row.y <= Math.log(INFALL_CLEAR)) {
                const wind = (1.35 + w.warp * 1.1) * w.mood.wind;
                const phi = row.x + row.y * wind - (w.spin % (Math.PI * 2 * 64)) - w.twist * (1.6 - row.y * 0.25);
                phiAtClear = ((phi % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
            }
            if (w.rimFlash > 0.7) flared += 1;
        });
        // Up and to the left of the gate: never behind the card on its right.
        expect(phiAtClear).toBeGreaterThan(Math.PI * 0.5);
        expect(phiAtClear).toBeLessThan(Math.PI * 0.75);
        expect(flared).toBeGreaterThan(0);
        expect(world.swallowed).toBe(0);
        expect(world.getState().visitors).toBe(0);
    });

    it('sends a comet across the open sky beyond the board, and none outside its crossing', () => {
        for (let k = 0; k < 6; k++) {
            const path = cometPath(k, 16 / 9);
            // Right of the HUD on a landscape frame, from past one edge to past the other.
            expect(Math.min(path.from.x, path.to.x)).toBeGreaterThan(0.75);
            expect(Math.min(path.from.y, path.to.y)).toBeLessThan(0);
            expect(Math.max(path.from.y, path.to.y)).toBeGreaterThan(1);
            const tall = cometPath(k, 9 / 19.5);
            // Below the card on an upright phone (the gate stands above it).
            expect(Math.min(tall.from.y, tall.to.y)).toBeGreaterThan(0.85);
        }
        const { world, camera } = makeWorld('High', { at: COMET_FIRST - 2 });
        expect(world.u.cometLight.value).toBe(0);
        settle(world, camera, COMET_FIRST + COMET_LIFE / 2);
        expect(world.u.cometLight.value).toBeGreaterThan(0.5);
        // Its tail points away from the gate.
        const head = world.u.tables.events[EVENT_ROWS.comet];
        const tail = world.u.tables.events[EVENT_ROWS.comet + 1];
        const g = world.u.gateDir.value;
        const away = (head.x + tail.x * 0.05) * g.x + (head.y + tail.y * 0.05) * g.y + (head.z + tail.z * 0.05) * g.z;
        expect(away).toBeLessThan(head.x * g.x + head.y * g.y + head.z * g.z);
        settle(world, camera, COMET_FIRST + COMET_LIFE + 1);
        expect(world.u.cometLight.value).toBe(0);
        settle(world, camera, COMET_FIRST + COMET_EVERY + 3);
        expect(world.u.cometLight.value).toBeGreaterThan(0);
    });
});

describe('Serenity Warp living: event shapes', () => {
    it('draws nothing at rest: no shape is alive and the loop runs zero times', () => {
        const { world } = makeWorld('High', { at: 12 });
        expect(world.u.formCount.value).toBe(0);
        expect(world.u.surge.value.y + world.u.surge.value.w).toBe(0);
    });

    it('throws a shape of its own for each event: pinwheel, cross, corona, lotus, surge', () => {
        const { world, camera } = makeWorld('High', { at: 20 });
        const kinds = () => new Set(world.formSlots
            .filter((s) => formLight(s.kind, world.time - s.birth) > 0)
            .map((s) => s.kind));
        frame(world, camera, 1 / 60, () => world.onSpin());
        run(world, camera, 0.2, 1 / 60);
        expect(kinds()).toEqual(new Set([FORM_KINDS.pinwheel]));
        frame(world, camera, 1 / 60, () => world.onClear({ rows: [19, 18], lines: 2, b2b: true }));
        run(world, camera, 0.2, 1 / 60);
        expect(kinds().has(FORM_KINDS.cross)).toBe(true);
        frame(world, camera, 1 / 60, () => world.levelUp(2));
        run(world, camera, 0.2, 1 / 60);
        expect(kinds().has(FORM_KINDS.petals)).toBe(true);
        const surges = world.surgeCursor;
        frame(world, camera, 1 / 60, () => world.onCombo(2));
        expect(world.surgeCursor).toBe(surges + 1);
        frame(world, camera, 1 / 60, () => world.onClear({ rows: [19, 18, 17, 16], lines: 4, perfect: true }));
        run(world, camera, 5, 1 / 30);
        expect(world.formSlots.some((s) => s.kind === FORM_KINDS.corona)).toBe(true);
        expect(world.u.formCount.value).toBeGreaterThan(0);
    });

    it('keeps a live shape as it was born: a burst never re-randomises one already in the sky', () => {
        const { world, camera } = makeWorld('High', { at: 20 });
        frame(world, camera, 1 / 60, () => world.onSpin());
        const first = world.formSlots.find((s) => s.kind === FORM_KINDS.pinwheel);
        const kept = { seed: first.seed, birth: first.birth, params: [...first.params] };
        // A burst of shapes, fewer than the slots: the first is untouched.
        for (let i = 0; i < FORM_SLOTS - 1; i++) {
            frame(world, camera, 1 / 60, () => world.onClear({ rows: [19], lines: 1, twist: true }));
        }
        expect(first).toMatchObject({ seed: kept.seed, birth: kept.birth, params: kept.params });
        // More than the slots: the weakest is taken, never one in full light.
        const lights = () => world.formSlots.map((s) => formLight(s.kind, world.time - s.birth) * s.strength);
        frame(world, camera, 1 / 60, () => world.onSpin());
        expect(Math.max(...lights())).toBeGreaterThan(0.5);
    });

    it('reaches out as a shape ages, and a surge runs inward to the rim', () => {
        for (const kind of Object.values(FORM_KINDS)) {
            expect(formReach(kind, 1)).toBeGreaterThan(formReach(kind, 0.1));
        }
        const rim = 0.11;
        expect(surgePlace(0.9, rim)).toBeLessThan(surgePlace(0.1, rim));
        expect(surgePlace(5, rim)).toBeNull();
    });
});

describe('Serenity Warp living: the game\'s end', () => {
    it('closes the gate, holds it shut and opens it again by itself', () => {
        expect(closedAt(-1)).toBe(0);
        expect(closedAt(CLOSE_IN)).toBe(1);
        expect(closedAt(CLOSE_IN + CLOSE_HOLD * 0.5)).toBe(1);
        expect(closedAt(CLOSE_IN + CLOSE_HOLD + CLOSE_OPEN)).toBe(0);
        const { world, camera } = makeWorld('High', { at: 20 });
        const open = world.u.gateRadius.value;
        world.onGameOver();
        run(world, camera, CLOSE_IN + 0.5, 1 / 30);
        expect(world.closed).toBe(1);
        expect(world.u.gateRadius.value).toBeLessThan(open * 0.3);
        expect(world.u.mood2.value.w).toBe(1);
        run(world, camera, CLOSE_HOLD + CLOSE_OPEN + 0.5, 1 / 30);
        expect(world.closed).toBe(0);
    });

    it('keeps the gate shut through a session reset (the menu) and opens it on a new run', () => {
        const { world, camera } = makeWorld('High', { at: 20 });
        world.onGameOver();
        run(world, camera, CLOSE_IN + 0.3, 1 / 30);
        world.resetSession();
        run(world, camera, 0.5, 1 / 30);
        expect(world.closed).toBe(1);
        world.onSessionStart();
        run(world, camera, 1.4, 1 / 30);
        expect(world.closed).toBe(0);
        // A seek (a capture) drops it altogether.
        world.onGameOver();
        run(world, camera, 1, 1 / 30);
        settle(world, camera, 40);
        expect(world.closed).toBe(0);
    });
});

describe('Serenity Warp living: tiers', () => {
    it('gives every tier streamers, and the lit nebula and far galaxies from Medium up', () => {
        for (const [name, tier] of Object.entries(QUALITY)) {
            expect(tier.streamers, name).toBeGreaterThanOrEqual(1);
            const rich = ['Medium', 'High', 'Ultra', 'Extreme'].includes(name);
            expect(tier.litNebula, name).toBe(rich);
            expect(tier.galaxies, name).toBe(rich);
        }
    });
});
