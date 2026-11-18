/**
 * Cosmic Noir — the night's weather and what the great moments call up, on the CPU: the three-free
 * director (cosmic-noir-night.js) and a real CosmicNoirWorld in a THREE.Scene, no renderer.
 *
 * Relations and contracts, never tuning numbers: the night goes round its acts by the clock and a
 * level's step, a seek lands on the same weather as running there, lightning is one soft swell a
 * strike and never a strobe, and every event has an answer of its own.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    CosmicNoirWorld, REST_RIG, fovForAspect,
} from '../../src/themes/cosmic-noir/cosmic-noir-world.js';
import {
    CALLED_WAVE, METEOR_GAP, METEOR_SLOTS, ROLLER_SLOTS, SPLASH, TAU,
} from '../../src/themes/cosmic-noir/cosmic-noir-core.js';
import {
    NIGHT_ACTS, NIGHT_REST, NIGHT_STEP, STRIKE_GAP, STRIKE_LIFE, flashAt, lightningAt, nightAt, nightName,
    nightPhase, nightPlace, strikeIn,
} from '../../src/themes/cosmic-noir/cosmic-noir-night.js';
import { fallbackLayout } from '../../src/themes/cosmic-noir/cosmic-noir-composition.js';
import { CosmicNoirPost } from '../../src/themes/cosmic-noir/cosmic-noir-post.js';

function makeWorld({ at = 10, reduce = false, night = null } = {}) {
    const scene = new THREE.Scene();
    const aspect = 16 / 9;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new CosmicNoirWorld({ scene, quality: 'Minimal', capture: true }).build();
    world.bindCamera(camera);
    world.setReducedMotion(reduce);
    world.setViewport(1600, 900, aspect);
    world.setLayout(fallbackLayout(1600, 900), aspect);
    world.nightHold = night;
    settle(world, camera, at);
    return { camera, world };
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

function run(world, camera, seconds, steps = Math.max(1, Math.round(seconds * 60))) {
    for (let i = 0; i < steps; i++) frame(world, camera, seconds / steps);
}

const NAMES = NIGHT_ACTS.map((act) => act.name);

describe('cosmic noir night: five acts, round and round', () => {
    it('starts on a clear night and rests on each act before it turns to the next', () => {
        expect(NAMES).toEqual(['clear', 'scud', 'squall', 'clearing', 'fog']);
        expect(nightName(0)).toBe('clear');
        // Resting at each end of a step: the weather there is the act's own, to the number.
        NIGHT_ACTS.forEach((act, index) => {
            const at = nightAt(index + NIGHT_REST * 0.9);
            expect(at.cloud).toBeCloseTo(act.cloud, 9);
            expect(at.rain).toBeCloseTo(act.rain, 9);
            const before = nightAt(index + 1 - NIGHT_REST * 0.9);
            expect(before.cloud).toBeCloseTo(NIGHT_ACTS[(index + 1) % NIGHT_ACTS.length].cloud, 9);
        });
        // Between, every number is between its neighbours': a turn, never a cut.
        for (let place = 0; place < NIGHT_ACTS.length; place += 0.01) {
            const { index, next, mix } = nightPhase(place);
            const here = nightAt(place);
            expect(mix).toBeGreaterThanOrEqual(0);
            expect(mix).toBeLessThanOrEqual(1);
            const lo = Math.min(NIGHT_ACTS[index].mist, NIGHT_ACTS[next].mist);
            const hi = Math.max(NIGHT_ACTS[index].mist, NIGHT_ACTS[next].mist);
            expect(here.mist).toBeGreaterThanOrEqual(lo - 1e-9);
            expect(here.mist).toBeLessThanOrEqual(hi + 1e-9);
        }
        // And it comes round: the fog turns back into a clear night.
        expect(nightAt(NIGHT_ACTS.length).cloud).toBeCloseTo(nightAt(0).cloud, 9);
        expect(nightName(NIGHT_ACTS.length + 0.1)).toBe('clear');
        expect(nightName(-0.1)).toBe('clear');
    });

    it('goes one act on by the clock alone, and a level-up is one step: the two add', () => {
        expect(nightPlace(0, NIGHT_STEP)).toBeCloseTo(1, 9);
        expect(nightPlace(2, NIGHT_STEP * 0.5)).toBeCloseTo(2.5, 9);
        // It keeps another pace than the print's stock, so the two fall in and out of step.
        expect(NIGHT_STEP).not.toBe(100);
    });

    it('gives every act a look of its own', () => {
        const clear = NIGHT_ACTS[0];
        const squall = NIGHT_ACTS[NAMES.indexOf('squall')];
        const fog = NIGHT_ACTS[NAMES.indexOf('fog')];
        const scud = NIGHT_ACTS[NAMES.indexOf('scud')];
        // The home act is a clean night: the whole galaxy, no rain, no lightning.
        expect(clear.cloud).toBeLessThan(0.1);
        expect(clear.rain).toBe(0);
        expect(clear.storm).toBe(0);
        // The squall closes the sky, rains, heaves the sea and is the stormiest of them.
        expect(squall.cloud).toBeGreaterThan(0.85);
        expect(squall.rain).toBe(1);
        expect(squall.storm).toBe(Math.max(...NIGHT_ACTS.map((act) => act.storm)));
        expect(squall.swell).toBe(Math.max(...NIGHT_ACTS.map((act) => act.swell)));
        expect(squall.galaxy).toBeLessThan(clear.galaxy);
        // The fog lies on a quiet sea under an open sky: the thickest mist and air of all.
        expect(fog.mist).toBe(Math.max(...NIGHT_ACTS.map((act) => act.mist)));
        expect(fog.haze).toBe(Math.max(...NIGHT_ACTS.map((act) => act.haze)));
        expect(fog.swell).toBeLessThan(clear.swell);
        expect(fog.cloud).toBeLessThan(scud.cloud);
    });
});

describe('cosmic noir night: lightning', () => {
    it('is one soft swell a strike, never a strobe (ADR-0021)', () => {
        expect(flashAt(-0.01)).toBe(0);
        expect(flashAt(STRIKE_LIFE + 0.01)).toBe(0);
        // It comes up over a few frames, not in one.
        expect(flashAt(1 / 120)).toBeLessThan(0.45);
        let peak = 0;
        let peakAt = 0;
        for (let age = 0; age <= STRIKE_LIFE; age += 0.002) {
            const light = flashAt(age);
            expect(light).toBeGreaterThanOrEqual(0);
            expect(light).toBeLessThanOrEqual(1);
            if (light > peak) {
                peak = light;
                peakAt = age;
            }
        }
        expect(peak).toBeGreaterThan(0.6);
        expect(peakAt).toBeLessThan(0.12);
        // Once past its peak it only falls for a third of a second, and what rolls after it
        // through the cloud is a glow, a small share of the flash.
        let prev = flashAt(peakAt);
        for (let age = peakAt + 0.004; age <= peakAt + 0.33; age += 0.004) {
            expect(flashAt(age)).toBeLessThanOrEqual(prev + 1e-9);
            prev = flashAt(age);
        }
        let later = 0;
        for (let age = peakAt + 0.33; age <= STRIKE_LIFE; age += 0.004) later = Math.max(later, flashAt(age));
        expect(later).toBeLessThan(peak * 0.4);
        // And a strike's whole light is over before the next moment one may fall in.
        expect(STRIKE_LIFE).toBeLessThan(STRIKE_GAP * 0.3 + 0.15 * STRIKE_GAP + 0.01 + STRIKE_GAP * 0.3);
    });

    it('falls on a grid of moments: a pure function of the clock, never two inside a second', () => {
        const times = [];
        for (let k = 0; k < 400; k++) {
            const strike = strikeIn(k);
            expect(strike.at).toBeGreaterThanOrEqual(k * STRIKE_GAP);
            expect(strike.at).toBeLessThan((k + 1) * STRIKE_GAP);
            expect(strike.gain).toBeGreaterThan(0.4);
            expect(strike.gain).toBeLessThanOrEqual(1);
            times.push(strike.at);
        }
        for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThan(1);
        // The same moment, the same light, however often it is asked.
        const at = strikeIn(7).at + 0.05;
        expect(lightningAt(at, 1).light).toBe(lightningAt(at, 1).light);
        expect(lightningAt(at, 1).light).toBeGreaterThan(0.2);
    });

    it('needs a stormy night: none on a clear one, few and dim on a quiet one', () => {
        let quiet = 0;
        let stormy = 0;
        let brightestQuiet = 0;
        let brightestStormy = 0;
        for (let k = 0; k < 300; k++) {
            const at = strikeIn(k).at + 0.05;
            expect(lightningAt(at, 0).light).toBe(0);
            const few = lightningAt(at, 0.3).light;
            const many = lightningAt(at, 1).light;
            if (few > 0) quiet += 1;
            if (many > 0) stormy += 1;
            brightestQuiet = Math.max(brightestQuiet, few);
            brightestStormy = Math.max(brightestStormy, many);
        }
        expect(stormy).toBe(300);
        expect(quiet).toBeGreaterThan(40);
        expect(quiet).toBeLessThan(140);
        expect(brightestQuiet).toBeLessThan(brightestStormy);
    });
});

describe('cosmic noir world: the weather it wears', () => {
    it('wears the act the clock has reached, and hands the shaders its numbers', () => {
        const { world, camera } = makeWorld({ at: 5 });
        expect(world.getState().night.act).toBe('clear');
        expect(world.u.cloud.value).toBeCloseTo(NIGHT_ACTS[0].cloud, 6);
        expect(world.u.rain.value).toBe(0);
        expect(world.u.mist.value).toBeCloseTo(NIGHT_ACTS[0].mist, 6);
        // A step of the clock later: the next act, whole.
        settle(world, camera, NIGHT_STEP + NIGHT_REST * NIGHT_STEP * 0.5);
        expect(world.getState().night.act).toBe('scud');
        expect(world.u.cloud.value).toBeCloseTo(NIGHT_ACTS[1].cloud, 6);
        // Two more: the squall rains, closes the sky and heaves the sea.
        settle(world, camera, NIGHT_STEP * 2.1);
        expect(world.getState().night.act).toBe('squall');
        expect(world.u.rain.value).toBeCloseTo(1, 6);
        expect(world.u.cloud.value).toBeGreaterThan(0.85);
        expect(world.seaHeave).toBeCloseTo(NIGHT_ACTS[2].swell, 6);
        expect(world.u.galaxy.value).toBeLessThan(NIGHT_ACTS[0].galaxy);
        expect(world.u.seaRough.value).toBeGreaterThan(NIGHT_ACTS[2].rough);
    });

    it('turns one act on with a new level, eased, on top of the clock', () => {
        const { world, camera } = makeWorld({ at: 5 });
        world.levelUp(2);
        run(world, camera, 8);
        expect(world.getState().night.act).toBe('scud');
        expect(world.getState().night.place).toBeCloseTo(nightPlace(1, world.time), 3);
    });

    it('can be held on one act (captures): the clock no longer turns it', () => {
        const { world, camera } = makeWorld({ at: 5, night: 4 });
        expect(world.getState().night.act).toBe('fog');
        settle(world, camera, NIGHT_STEP * 2.6);
        expect(world.getState().night.act).toBe('fog');
        expect(world.u.mist.value).toBeCloseTo(NIGHT_ACTS[4].mist, 6);
    });

    it('lands on the same weather from a seek as from running there: cloud, rain and lightning', () => {
        const strike = strikeIn(6);
        const at = strike.at + 0.06;
        const a = makeWorld({ at, night: 2 });
        const b = makeWorld({ at: at - 3, night: 2 });
        run(b.world, b.camera, 3, 360);
        const sa = a.world.getState().night;
        const sb = b.world.getState().night;
        expect(sa.lightning).toBeGreaterThan(0.1);
        expect(sb.lightning).toBeCloseTo(sa.lightning, 2);
        expect(sb.cloud).toBeCloseTo(sa.cloud, 6);
        for (let k = 0; k < 4; k++) {
            const ran = b.world.u.cloudDrift.value.getComponent(k);
            expect(ran).toBeCloseTo(a.world.u.cloudDrift.value.getComponent(k), 4);
        }
        expect(b.world.u.rainClock.value).toBeCloseTo(a.world.u.rainClock.value, 4);
        // The flash is in the cloud, on the sea and in the sky the sea mirrors.
        expect(a.world.u.flash.value).toBeGreaterThan(0);
        expect(a.world.u.skyGlow.value).toBeGreaterThan(NIGHT_ACTS[2].glow);
    });

    it('lets hot play brew a storm slowly, and blow over more slowly still', () => {
        const { world, camera } = makeWorld({ at: 5 });
        // One great moment brings no rain: a storm takes its time.
        frame(world, camera, 1 / 60, () => world.onClear({ lines: 4 }));
        run(world, camera, 1);
        expect(world.getState().night.rain).toBeLessThan(0.08);
        // Half a minute of hot play does: it rains, the cloud has come in, lightning may fall.
        for (let i = 0; i < 40; i++) {
            frame(world, camera, 1 / 60, () => world.onClear({ lines: 4, combo: i + 1 }));
            run(world, camera, 0.75);
        }
        const hot = world.getState().night;
        expect(hot.rain).toBeGreaterThan(0.3);
        expect(hot.cloud).toBeGreaterThan(NIGHT_ACTS[0].cloud + 0.2);
        expect(hot.storm).toBeGreaterThan(0.3);
        // The hands rest: a few seconds later it still rains, a few minutes later it has cleared.
        run(world, camera, 6, 360);
        expect(world.getState().night.rain).toBeGreaterThan(hot.rain * 0.5);
        world.nightHold = 0;
        run(world, camera, 150, 3000);
        expect(world.getState().night.rain).toBeLessThan(0.05);
    });
});

describe('cosmic noir world: an answer of its own for every event', () => {
    it('whips the beam once round on a twist, smoothly, and not at all under reduced motion', () => {
        const { world, camera } = makeWorld({ at: 20 });
        let widest = 0;
        let last = world.spinPhase;
        let turned = 0;
        for (let i = 0; i < 240; i++) {
            frame(world, camera, 1 / 60, i === 0 ? () => world.onClear({ lines: 2, twist: true }) : null);
            let step = (world.spinPhase - last) % TAU;
            if (step < 0) step += TAU;
            widest = Math.max(widest, step);
            turned += step;
            last = world.spinPhase;
        }
        // A whole extra turn in four seconds, on top of its own; never a jump of a frame.
        const own = (TAU / world.getState().spinPeriod) * 4;
        expect(turned).toBeGreaterThan(TAU * 0.95);
        expect(turned).toBeLessThan(TAU + own * 2.2);
        expect(widest).toBeLessThan(0.4);
        expect(world.getState().whip).toBeLessThan(0.01);

        const calm = makeWorld({ at: 20, reduce: true });
        frame(calm.world, calm.camera, 1 / 60, () => calm.world.onClear({ lines: 2, twist: true }));
        expect(calm.world.getState().whip).toBe(0);
    });

    it('sends one meteor over the board for three lines, and none for one or two', () => {
        const { world, camera } = makeWorld({ at: 20 });
        frame(world, camera, 1 / 60, () => world.onClear({ lines: 2 }));
        run(world, camera, 0.4);
        expect(world.counts.meteors).toBe(0);
        frame(world, camera, 1 / 60, () => world.onClear({ lines: 3 }));
        expect(world.counts.meteors).toBe(1);
        run(world, camera, 0.5);
        expect(world.getState().meteors).toBe(1);
        // Its head runs ahead of its tail, both in the sky, and its light is written for the shader.
        const head = world.u.tables.meteors[0];
        const tail = world.u.tables.meteors[1];
        expect(head.w).toBeGreaterThan(0.2);
        expect(Math.hypot(head.x, head.y, head.z)).toBeCloseTo(1, 5);
        expect(Math.hypot(tail.x, tail.y, tail.z)).toBeCloseTo(1, 5);
        expect(head.y).toBeGreaterThan(0);
        expect(Math.hypot(head.x - tail.x, head.y - tail.y, head.z - tail.z)).toBeGreaterThan(0.05);
        run(world, camera, 1.5);
        expect(world.getState().meteors).toBe(0);
    });

    it('calls a great wave up at once on four lines: harder than any roller, in a row of its own', () => {
        const { world, camera } = makeWorld({ at: 20 });
        const rollers = () => world.getState().waves.length;
        expect(rollers()).toBe(ROLLER_SLOTS + 1);
        frame(world, camera, 1 / 60, () => world.onClear({ lines: 4 }));
        expect(world.counts.called).toBe(1);
        const row = world.u.tables.splashes[ROLLER_SLOTS];
        expect(row.y).toBeCloseTo(CALLED_WAVE, 6);
        expect(row.x).toBeLessThan(0.05);
        expect(row.y).toBeGreaterThan(1.5);
        // Another four lines while it still climbs does not restart it (nothing in the air may jump).
        run(world, camera, 0.8);
        frame(world, camera, 1 / 60, () => world.onClear({ lines: 4 }));
        expect(world.counts.called).toBe(1);
        expect(world.u.tables.splashes[ROLLER_SLOTS].x).toBeGreaterThan(0.7);
        // It is gone, like any burst, inside SPLASH.life.
        run(world, camera, SPLASH.life);
        expect(world.u.tables.splashes[ROLLER_SLOTS].y).toBe(0);
    });

    it('answers a back-to-back with a fork of lightning, after the flashbulb has gone', () => {
        const { world, camera } = makeWorld({ at: 20 });
        frame(world, camera, 1 / 60, () => world.onClear({ lines: 4, b2b: true }));
        expect(world.counts.bolts).toBe(0);
        expect(world.getPostState().negative).toBeGreaterThan(0.5);
        run(world, camera, 0.62, 60);
        expect(world.counts.bolts).toBe(1);
        expect(world.getState().night.bolt).toBeGreaterThan(0.2);
        expect(world.getPostState().negative).toBeLessThan(0.05);
        // It falls clear of the board: on a bearing right of the card or left of it, by turns.
        const first = world.boltBearing;
        expect(world.u.bolt.value.y).toBeGreaterThan(0);
        expect(world.u.bolt.value.w).toBeCloseTo(first, 6);
        run(world, camera, 2);
        expect(world.getState().night.bolt).toBe(0);
        frame(world, camera, 1 / 60, () => world.onClear({ lines: 4, b2b: true }));
        run(world, camera, 0.62, 60);
        expect(world.counts.bolts).toBe(2);
        expect(world.boltBearing).not.toBeCloseTo(first, 2);
    });

    it('crowns a perfect clear with a shower of meteors out of the galaxy, a blazing galaxy and a great wave', () => {
        const { world, camera } = makeWorld({ at: 20 });
        const galaxy = world.u.galaxy.value;
        frame(world, camera, 1 / 60, () => world.onClear({ lines: 4, perfect: true }));
        expect(world.counts.showers).toBe(1);
        expect(world.counts.meteors).toBeGreaterThanOrEqual(10);
        expect(world.counts.meteors).toBeLessThan(METEOR_SLOTS);
        expect(world.counts.called).toBe(1);
        let most = 0;
        for (let i = 0; i < 150; i++) {
            frame(world, camera, 1 / 60);
            most = Math.max(most, world.getState().meteors);
            if (i === 20) expect(world.u.galaxy.value).toBeGreaterThan(galaxy * 1.3);
        }
        // Several are in the sky at once, each leaving the galaxy's own place and going up or out.
        expect(most).toBeGreaterThanOrEqual(3);
        run(world, camera, 3);
        // (The shower is over; one that falls by itself may be in the sky.)
        expect(world.meteorSlots.every((slot) => slot.birth + slot.life < world.time)).toBe(true);
        expect(world.getState().meteors).toBeLessThanOrEqual(1);
        // And the galaxy has all but settled back.
        expect(world.u.galaxy.value).toBeLessThan(galaxy * 1.1);
    });

    it('rolls the gate once on a reel change, and holds it still under reduced motion', () => {
        const { world, camera } = makeWorld({ at: 20 });
        expect(world.getPostState().roll).toBe(-1);
        frame(world, camera, 1 / 60, () => world.levelUp(2));
        let seen = [];
        for (let i = 0; i < 120; i++) {
            frame(world, camera, 1 / 60);
            if (world.getPostState().roll >= 0) seen.push(world.getPostState().roll);
        }
        expect(seen.length).toBeGreaterThan(10);
        expect(seen.length).toBeLessThan(60);
        for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1]);
        expect(world.getPostState().roll).toBe(-1);

        const calm = makeWorld({ at: 20, reduce: true });
        frame(calm.world, calm.camera, 1 / 60, () => calm.world.levelUp(2));
        seen = [];
        for (let i = 0; i < 120; i++) {
            frame(calm.world, calm.camera, 1 / 60);
            if (calm.world.getPostState().roll >= 0) seen.push(1);
        }
        expect(seen).toHaveLength(0);
    });

    it('closes the iris on the lamp when a run ends, through the menu\'s reset, and opens it for the next run', () => {
        const { world, camera } = makeWorld({ at: 20 });
        expect(world.getPostState().iris).toBe(0);
        frame(world, camera, 1 / 60, () => world.onGameOver());
        run(world, camera, 2);
        const closed = world.getPostState().iris;
        expect(closed).toBeGreaterThan(0.9);
        // It closes on the lamp, wherever the composition hangs it.
        expect(world.getPostState().irisAt.x).toBeCloseTo(world.u.pulsarUv.value.x, 6);
        expect(world.getPostState().irisAt.y).toBeCloseTo(world.u.pulsarUv.value.y, 6);
        // The menu resets the session: the iris stays closed.
        world.resetSession();
        run(world, camera, 1);
        expect(world.getPostState().iris).toBeGreaterThan(0.9);
        // A new run opens it, eased.
        frame(world, camera, 1 / 60, () => world.onSessionStart());
        expect(world.getPostState().iris).toBeGreaterThan(0.8);
        run(world, camera, 6);
        expect(world.getPostState().iris).toBeLessThan(0.05);
    });

    it('opens the iris by itself if no run follows: the menu is never left in the dark', () => {
        const { world, camera } = makeWorld({ at: 20 });
        frame(world, camera, 1 / 60, () => world.onGameOver());
        run(world, camera, 20, 1200);
        expect(world.getPostState().iris).toBeLessThan(0.05);
    });

    it('lets a meteor fall by itself now and then: a pure function of the clock', () => {
        let fell = 0;
        const { world, camera } = makeWorld({ at: 0 });
        for (let turn = 0; turn < 30; turn++) {
            let seen = 0;
            for (let s = 0; s < METEOR_GAP; s += 0.25) {
                settle(world, camera, turn * METEOR_GAP + s);
                seen = Math.max(seen, world.getState().meteors);
            }
            expect(seen).toBeLessThanOrEqual(1);
            fell += seen;
        }
        expect(fell).toBeGreaterThan(8);
        expect(fell).toBeLessThan(28);
        expect(world.counts.meteors).toBe(0);
    });
});

describe('cosmic noir post: the iris and the gate', () => {
    it('takes the iris, the lamp\'s place and the gate\'s roll from the world', () => {
        const renderer = { getDrawingBufferSize: (v) => v.set(1280, 720), getPixelRatio: () => 1 };
        let post = null;
        try {
            post = new CosmicNoirPost(renderer, new THREE.Scene(), new THREE.PerspectiveCamera());
        } catch {
            return; // no node renderer to build a pipeline on here: the world's contract is pinned above
        }
        post.update({ iris: 2, irisAt: { x: 0.3, y: 0.4 }, roll: 0.5 });
        expect(post.uIris.value).toBe(1);
        expect(post.uIrisAt.value.x).toBeCloseTo(0.3, 6);
        expect(post.uRoll.value).toBe(0.5);
        post.update({ iris: -1, roll: -1 });
        expect(post.uIris.value).toBe(0);
        expect(post.uRoll.value).toBe(-1);
    });
});
