/**
 * Winter — the night builds with play (winter-world.js on the shared surge,
 * src/themes/shared/gameplay-surge.js): every flash, lift, strum and overdrive accumulates, so a
 * weak event on the heels of a strong one never cuts the light; a long chain reads hotter than
 * its first clear and breathes back once the hands rest; cascade waves, back-to-backs, a late
 * perfect clear and a T-spin that clears nothing each have their own answer.
 */

import {
    beforeAll, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { WinterWorld } from '../../src/themes/winter/winter-world.js';
import { planGhosts } from '../../src/themes/winter/winter-ghosts.js';
import {
    HUSH_HOLD, REST_RIG, SKY_HOLD, SKY_LET_GO, SKY_SLOTS, SPARK_RISE, SPIRIT_RUN, STRUM_SLOTS,
} from '../../src/themes/winter/winter-core.js';

let ghosts;
beforeAll(() => {
    ghosts = planGhosts();
});

function makeWorld([width, height] = [1600, 900]) {
    const scene = new THREE.Scene();
    const world = new WinterWorld({
        scene, quality: 'Low', capture: true, ghosts, fox: false,
    }).build();
    const camera = new THREE.PerspectiveCamera(50, width / height, REST_RIG.near, REST_RIG.far);
    world.bindCamera(camera);
    world.setViewport(width, height, width / height);
    world.updateCamera(camera, { time: 0, delta: 0 });
    world.update({ time: 0, delta: 0 }, camera);
    return { world, camera };
}

const frame = (world, camera, time, delta = 0) => {
    const sim = {
        time, delta, pointerX: 0, pointerY: 0,
    };
    world.updateCamera(camera, sim);
    world.update(sim, camera);
};
const step = (world, camera, from, to, dt = 1 / 60) => {
    const steps = Math.max(1, Math.round((to - from) / dt));
    const h = (to - from) / steps;
    for (let i = 1; i <= steps; i++) frame(world, camera, from + i * h, h);
};
const sum = (list) => list.reduce((total, v) => total + v, 0);

/** What the night shows at a moment: every light a clear, a four or the heat of play feeds. */
function lights(world) {
    const post = world.getPostState();
    const { u } = world;
    return {
        surge: world.surge,
        swell: world.swell,
        kick: post.kick,
        flash: post.flash,
        bloom: post.bloomBoost,
        curtains: sum(world.getState().curtains),
        strums: sum(u.strums.map((slot) => {
            const S = slot.value;
            const age = world.time - S.x;
            return age < 0 ? 0 : S.y * Math.exp(-age / 1.4);
        })),
        halo: u.halo.value,
        level: world.getState().heat.level,
    };
}

/** A lock and its clear, as the director hands them over in one frame. */
function clearing(world, lines, extra = {}) {
    world.onLock({
        u: 0.5, rows: [19], hardDrop: true, color: '#6de0ff',
    });
    world.onClear({
        rows: Array.from({ length: lines }, (_, i) => 19 - i), lines, ...extra,
    });
}

describe('Winter builds with play: nothing is cut', () => {
    it('never lets a single on the heels of a four cut the four\'s light', () => {
        const alone = makeWorld();
        const followed = makeWorld();
        for (const { world, camera } of [alone, followed]) {
            step(world, camera, 0, 1);
            clearing(world, 4);
            step(world, camera, 1, 1 + HUSH_HOLD + 0.3);
        }
        const strumSlot = followed.world.lastStrum;
        const quadStrum = followed.world.u.strums[strumSlot].value.toArray();
        clearing(followed.world, 1);
        // The single took a strum slot of its own: the four's strum runs on, untouched.
        expect(followed.world.lastStrum).not.toBe(strumSlot);
        expect(followed.world.u.strums[strumSlot].value.toArray()).toEqual(quadStrum);
        const start = alone.world.time;
        for (const t of [0.05, 0.2, 0.5, 1, 2, 3.5]) {
            for (const { world, camera } of [alone, followed]) step(world, camera, world.time, start + t);
            const a = lights(alone.world);
            const b = lights(followed.world);
            Object.keys(a).forEach((key) => {
                expect(b[key], `${key} at +${t}s`).toBeGreaterThanOrEqual(a[key] - 1e-9);
            });
        }
        alone.world.dispose();
        followed.world.dispose();
    });

    it('sends a cascade\'s waves out one after another, each deeper one wider, faster and brighter', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 1);
        const sent = [];
        for (let depth = 1; depth <= 4; depth++) {
            if (depth === 1) clearing(world, 2);
            else world.onClear({ rows: [19], lines: 1, cascade: depth });
            sent.push({ slot: world.lastStrum, value: world.u.strums[world.lastStrum].value.clone() });
            step(world, camera, world.time, world.time + 0.36);
        }
        // Four waves, four strums in flight at once: none pulled back to the board.
        expect(new Set(sent.map((s) => s.slot)).size).toBe(Math.min(4, STRUM_SLOTS));
        sent.forEach(({ slot, value }) => expect(world.u.strums[slot].value.toArray()).toEqual(value.toArray()));
        for (let i = 2; i < sent.length; i++) {
            // (Width, speed: every wave past the first beyond the one before.)
            expect(sent[i].value.z).toBeGreaterThan(sent[i - 1].value.z);
            expect(sent[i].value.w).toBeGreaterThan(sent[i - 1].value.w);
        }
        // The second wave clears one line, the first two: still, it strums at least as hard.
        expect(sent[3].value.y).toBeGreaterThan(sent[1].value.y);
        world.dispose();
    });

    it('lets a held sky colour go before the next takes its place: no bearing snaps to a new hue', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 1);
        const colours = ['#ff9ccf', '#6de0ff', '#b79bff', '#ffe2a0', '#5df2a6', '#ff7a7a', '#a0ffd0'];
        // Fill every slot (a lock's colour, and its tail flick's).
        let t = 1;
        while (world.skyQueue.every((q) => q.due === Infinity) && world.u.skyA.some((slot) => slot.value.z === 0)) {
            world.onLock({ u: 0.2, rows: [12], color: colours[world.counts.locks % colours.length] });
            step(world, camera, t, t + 0.5);
            t += 0.5;
        }
        expect(world.u.skyA.every((slot) => slot.value.z > 0)).toBe(true);
        step(world, camera, t, t + SPARK_RISE);
        t += SPARK_RISE;
        const before = world.u.skyA.map((slot) => slot.value.toArray());
        world.onLock({ u: 0.8, rows: [12], color: '#ffffff' });
        const slot = world.lastSky;
        // The old colour is still there, letting go from now; the new one waits for the slot.
        expect(world.u.skyA[slot].value.x).toBe(before[slot][0]);
        expect(world.u.skyA[slot].value.w).toBe(world.time);
        const queued = world.skyQueue[slot];
        expect(queued.due).toBeCloseTo(world.time + SKY_LET_GO, 9);
        expect(queued.arrives).toBeGreaterThan(queued.due);
        // Every other held colour untouched.
        world.u.skyA.forEach((other, i) => {
            if (i !== slot) expect(other.value.toArray()).toEqual(before[i]);
        });
        // Once it has let go, the new colour takes the slot, in time for its sparks.
        const { arrives } = queued;
        step(world, camera, t, t + SKY_LET_GO + 0.05);
        expect(world.u.skyA[slot].value.y).toBe(arrives);
        expect(world.u.skyA[slot].value.w).toBeGreaterThan(1e6);
        expect(world.u.skyA[slot].value.z).toBeGreaterThan(0);
        expect(SKY_LET_GO).toBeLessThan(SPARK_RISE * 0.7);
        expect(SKY_HOLD).toBeGreaterThan(SKY_LET_GO);
        expect(world.u.skyA).toHaveLength(SKY_SLOTS);
        world.dispose();
    });
});

describe('Winter builds with play: the crescendo', () => {
    /** Twelve clearing locks 0.64 s apart, as the tray's Fever plays them. */
    function chain(world, camera, from, count = 12) {
        let t = from;
        const firstAfter = { at: null };
        for (let n = 0; n < count; n++) {
            clearing(world, [1, 1, 2, 1, 2, 2, 3, 2, 2, 2, 3, 3][n % 12]);
            world.onCombo(n + 1);
            step(world, camera, t, t + 0.64);
            t += 0.64;
            if (n === 0) {
                firstAfter.at = { ...lights(world), heat: world.u.heat.value.toArray(), stars: world.u.stars.value };
            }
        }
        return { end: t, first: firstAfter.at };
    }

    it('reads a long chain hotter than its first clear, and breathes back once the hands rest', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 2);
        const rest = {
            ...lights(world), heat: world.u.heat.value.toArray(), stars: world.u.stars.value, gale: world.u.gale.value,
        };
        expect(rest.level).toBe(0);
        expect(rest.heat).toEqual([0, 0, 0, 0]);
        const { end, first } = chain(world, camera, 2);
        const hot = world.getState().heat;
        // The heat of play has climbed through warm and hot into the fever.
        expect(hot.level).toBeGreaterThan(first.level + 0.4);
        expect(hot.stage).toBe(3);
        expect(hot.fever).toBeGreaterThan(0.5);
        // The night spends it: the snow and the air glitter, in the fires' colours; the pillar
        // stands over the moon; the ring round it, the stars and the wind are all up on the start.
        const heat = world.u.heat.value.toArray();
        expect(heat[0]).toBeGreaterThan(first.heat[0] + 0.5);
        expect(heat[1]).toBeGreaterThan(0.5);
        expect(heat[3]).toBeGreaterThan(first.heat[3] + 0.2);
        expect(world.u.halo.value).toBeGreaterThan(first.halo);
        expect(world.u.stars.value).toBeGreaterThan(first.stars);
        expect(world.u.gale.value).toBeGreaterThan(rest.gale);
        // ...and keeps the darks: the iris has closed a little, the sheets are held under their ceiling.
        world.getState().curtains.forEach((energy) => expect(energy).toBeLessThan(1.81));
        // The hands rest (the chain over): the night breathes back to its twilight.
        world.onCombo(0);
        step(world, camera, end, end + 20, 1 / 30);
        const calm = world.getState().heat;
        expect(calm.stage).toBe(0);
        expect(calm.level).toBeLessThan(0.05);
        expect(calm.fever).toBe(0);
        expect(world.u.heat.value.x).toBeLessThan(0.05);
        expect(world.u.heat.value.w).toBeLessThan(0.05);
        expect(world.u.halo.value).toBeCloseTo(rest.halo, 1);
        world.dispose();
    });

    it('stays as it was at rest and under a lone lock: the build is play\'s, not the clock\'s', () => {
        const idle = makeWorld();
        const casual = makeWorld();
        for (const { world, camera } of [idle, casual]) step(world, camera, 0, 2);
        casual.world.onLock({ u: 0.3, rows: [15], color: '#b79bff' });
        for (const { world, camera } of [idle, casual]) step(world, camera, 2, 6);
        const { heat } = casual.world.getState();
        expect(heat.stage).toBe(0);
        expect(heat.warm).toBeLessThan(0.05);
        expect(idle.world.u.heat.value.toArray()).toEqual([0, 0, 0, 0]);
        idle.world.dispose();
        casual.world.dispose();
    });

    it('lets a four in a fever inhale instead of blacking the night out', () => {
        const cold = makeWorld();
        const fevered = makeWorld();
        step(cold.world, cold.camera, 0, 10);
        step(fevered.world, fevered.camera, 0, 2);
        chain(fevered.world, fevered.camera, 2);
        for (const { world, camera } of [cold, fevered]) {
            frame(world, camera, world.time, 0);
            clearing(world, 4);
            step(world, camera, world.time, world.time + HUSH_HOLD * 0.9, 1 / 120);
        }
        expect(cold.world.u.breath.value).toBeLessThan(0.5);
        expect(fevered.world.u.breath.value).toBeGreaterThan(0.7);
        cold.world.dispose();
        fevered.world.dispose();
    });
});

describe('Winter builds with play: its own moments', () => {
    it('crowns a late perfect clear on the four still playing: no second hush, the fox of light burns brighter', () => {
        const plain = makeWorld();
        const crowned = makeWorld();
        for (const { world, camera } of [plain, crowned]) {
            step(world, camera, 0, 1);
            clearing(world, 4);
            step(world, camera, 1, 1 + 0.36);
        }
        const { world } = crowned;
        const { spiritAt, hushUntil } = world;
        const { quads } = world.counts;
        world.onClear({ lines: 1, perfect: true, crown: true });
        expect(world.counts.crowns).toBe(1);
        expect(world.counts.quads).toBe(quads);
        expect(world.hushUntil).toBe(hushUntil);
        // The fox of light keeps its course: it is not sent back to the start of its run.
        expect(world.spiritAt).toBe(spiritAt);
        // (The night is still breathing in again after the four's hush: the crown never makes it hold
        // its breath a second time.)
        let breath = world.u.breath.value;
        let fell = 0;
        let brighter = false;
        let halo = false;
        for (let t = 1.36; t < 1.36 + 3; t += 1 / 60) {
            for (const each of [plain, crowned]) frame(each.world, each.camera, t + 1 / 60, 1 / 60);
            fell = Math.max(fell, breath - world.u.breath.value);
            breath = world.u.breath.value;
            if (world.spiritGlow > plain.world.spiritGlow + 0.05) brighter = true;
            if (world.u.halo.value > plain.world.u.halo.value + 0.3) halo = true;
        }
        expect(fell).toBeLessThan(1e-9);
        expect(breath).toBeGreaterThan(0.95);
        expect(brighter).toBe(true);
        expect(halo).toBe(true);
        // With no four running, the crown calls the fox of light up itself.
        const lone = makeWorld();
        step(lone.world, lone.camera, 0, 1);
        lone.world.onClear({ lines: 1, perfect: true, crown: true });
        expect(lone.world.spiritAt).toBeGreaterThan(1);
        expect(lone.world.counts.quads).toBe(0);
        step(lone.world, lone.camera, 1, 2);
        expect(lone.world.u.breath.value).toBeGreaterThan(0.9);
        plain.world.dispose();
        crowned.world.dispose();
        lone.world.dispose();
    });

    it('never sends the fox of light back to the start: a second four makes it burn brighter', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 1);
        clearing(world, 4);
        step(world, camera, 1, 3);
        const { spiritAt } = world;
        const glow = world.spiritGlow;
        clearing(world, 4);
        expect(world.spiritAt).toBe(spiritAt);
        step(world, camera, 3, 3.6);
        expect(world.spiritGlow).toBeGreaterThan(glow);
        // Once its run is over, a four calls it up again.
        step(world, camera, 3.6, spiritAt + SPIRIT_RUN + 0.2);
        clearing(world, 4);
        expect(world.spiritAt).toBeGreaterThan(spiritAt + SPIRIT_RUN);
        world.dispose();
    });

    it('answers a back-to-back from the moon, brighter for every one in a row', () => {
        const plain = makeWorld();
        const b2b = makeWorld();
        for (const { world, camera } of [plain, b2b]) step(world, camera, 0, 1);
        plain.world.onClear({ rows: [19, 18], lines: 2, tspin: true });
        b2b.world.onClear({
            rows: [19, 18], lines: 2, tspin: true, b2b: true,
        });
        for (const { world, camera } of [plain, b2b]) step(world, camera, 1, 1.5);
        const first = b2b.world.u.halo.value;
        expect(first).toBeGreaterThan(plain.world.u.halo.value + 0.3);
        expect(b2b.world.u.heat.value.w).toBeGreaterThan(plain.world.u.heat.value.w + 0.3);
        // The second in a row: the moon burns brighter still.
        step(b2b.world, b2b.camera, 1.5, 5);
        const between = b2b.world.u.halo.value;
        b2b.world.onClear({
            rows: [19, 18, 17, 16], lines: 4, b2b: true,
        });
        expect(b2b.world.b2bRun).toBe(2);
        let peak = 0;
        for (let t = 5; t < 6.5; t += 1 / 60) {
            frame(b2b.world, b2b.camera, t + 1 / 60, 1 / 60);
            peak = Math.max(peak, b2b.world.getState().heat.b2b);
        }
        expect(peak).toBeGreaterThan(1);
        expect(b2b.world.u.halo.value).toBeGreaterThan(between);
        // A clear that is not one ends the run.
        b2b.world.onClear({ rows: [19], lines: 1 });
        expect(b2b.world.b2bRun).toBe(0);
        plain.world.dispose();
        b2b.world.dispose();
    });

    it('still turns the wind a little for a T-spin that clears nothing', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 1);
        const { sparks } = world.counts;
        const { storm } = world;
        world.onSpin({ player: 0 });
        expect(world.counts.spins).toBe(1);
        expect(world.counts.sparks).toBeGreaterThan(sparks);
        expect(world.storm).toBeGreaterThan(storm);
        expect(world.counts.clears).toBe(0);
        step(world, camera, 1, 1.3);
        expect(world.getState().heat.punch).toBeGreaterThan(0);
        world.dispose();
    });
});
