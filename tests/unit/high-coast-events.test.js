/**
 * High Coast — what each gameplay event draws on the water and in the light (2026-11-14 pass),
 * run without a renderer like high-coast-world.test.js: a lock's ring, a hard drop's splash, a
 * twist's whirl, the wave every clear sends out from the bay (four lines: the great one), the
 * glass a perfect clear spreads behind its wave, a level-up's time-lapse sky, the wind an event
 * throws at the old pine, the light night's noctilucent cloud, and where events land on a tall
 * screen. Held as relations (stronger, wider, later), not as metres or seconds.
 */
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    HighCoastWorld, REST_RIG, WAVE, fovForAspect, waveRadius, waveStrength,
} from '../../src/themes/high-coast/high-coast-world.js';
import { PIECE_COLORS, hexToLinear } from '../../src/themes/high-coast/high-coast-core.js';
import { RINGS, RING_KIND } from '../../src/themes/high-coast/high-coast-tsl.js';
import { MOTE_KIND } from '../../src/themes/high-coast/high-coast-motes.js';
import { cardUnion } from '../../src/themes/high-coast/high-coast-composition.js';
import { groundHeight } from '../../src/themes/high-coast/high-coast-field.js';

vi.setConfig({ testTimeout: 30_000 });

const START = 10;
const QUALITY = 'Minimal';
let prepared;
let shared;

function makeWorld(width = 1600, height = 900) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new HighCoastWorld({
        scene, quality: QUALITY, capture: true, prepared,
    }).build();
    world.bindCamera(camera);
    world.setViewport(width, height, aspect);
    return { scene, camera, world };
}

function begin({ world, camera }, time = START) {
    world.seek(time);
    world.updateCamera(camera, { time, delta: 0 });
    world.update({ time, delta: 0 }, camera);
}

function stepTo({ world, camera }, to, dt = 1 / 30) {
    const from = world.time;
    const steps = Math.max(1, Math.round((to - from) / dt));
    const h = (to - from) / steps;
    for (let i = 1; i <= steps; i += 1) {
        const time = from + i * h;
        world.updateCamera(camera, { time, delta: 0 });
        world.update({ time, delta: h }, camera);
    }
}

const ring = (world, slot) => world.u.tables.rings.slice(slot * 3, slot * 3 + 3);
/** How many motes of a kind are in the pool (written, alive or not). */
const motesOf = (world, kind) => {
    let n = 0;
    for (let i = 0; i < world.motes.count; i += 1) {
        if (world.motes.start[i * 4 + 3] > -1e5 && Math.round(world.motes.kind[i * 4]) === kind) n += 1;
    }
    return n;
};

beforeAll(() => {
    prepared = HighCoastWorld.prepareSync(QUALITY);
    shared = makeWorld();
    begin(shared);
});

afterAll(() => {
    shared?.world.dispose();
    vi.restoreAllMocks();
});

describe('High Coast events: rings on the water', () => {
    it('opens a ring where a lock touches the water, in the piece\'s colour lifted off the dark', () => {
        const { world } = shared;
        begin(shared);
        const color = PIECE_COLORS[2];
        world.onLock({ u: 0.2, rows: [14], color });
        const [place, shape, light] = ring(world, 0);
        const gust = world.u.tables.gusts[0];
        expect(place.z).toBe(START);
        expect(place.w).toBeGreaterThan(0);
        // It opens where the lock's gust sets out, on the water.
        expect(place.x).toBe(gust.x);
        expect(place.y).toBe(gust.y);
        expect(groundHeight(world.fields, place.x, place.y)).toBeLessThan(world.u.sea.value);
        expect(shape.z).toBe(RING_KIND.ring);
        expect(shape.x).toBeGreaterThan(0); // speed
        expect(shape.y).toBeGreaterThan(0); // width
        expect(shape.w).toBeGreaterThan(1); // life
        const rgb = hexToLinear(color);
        [light.x, light.y, light.z].forEach((v, k) => {
            expect(v).toBeGreaterThan(rgb[k]);
            expect(v).toBeGreaterThan(0.1);
        });
    });

    it('makes a hard drop\'s a splash: a stronger, wider, longer pair with spray, mist and a gust at the pine', () => {
        const { world } = shared;
        begin(shared);
        world.onLock({ u: 0.2, rows: [12], color: PIECE_COLORS[0] });
        expect(motesOf(world, MOTE_KIND.spray)).toBe(0);
        world.onLock({
            u: 0.2, rows: [12], color: PIECE_COLORS[0], hardDrop: true, distance: 14,
        });
        const [softPlace, soft] = ring(world, 0);
        const [hardPlace, hard] = ring(world, 1);
        expect(hard.z).toBe(RING_KIND.splash);
        expect(hardPlace.w).toBeGreaterThan(softPlace.w);
        expect(hard.x).toBeGreaterThan(soft.x);
        expect(hard.y).toBeGreaterThan(soft.y);
        expect(hard.w).toBeGreaterThan(soft.w);
        expect(motesOf(world, MOTE_KIND.spray)).toBeGreaterThan(20);
        expect(motesOf(world, MOTE_KIND.mist)).toBeGreaterThan(0);
        // The gust reaches the summit: the pine leans in it, and stands again.
        stepTo(shared, START + 0.5);
        expect(world.u.gale.value).toBeGreaterThan(0.1);
        stepTo(shared, START + 12);
        expect(world.u.gale.value).toBeLessThan(0.01);
    });

    it('rings round its ring slots, and a seek empties them', () => {
        const { world } = shared;
        begin(shared);
        expect(world.u.tables.rings).toHaveLength(RINGS * 3);
        const times = [];
        for (let k = 0; k <= RINGS; k += 1) {
            stepTo(shared, START + 0.1 * (k + 1));
            world.onLock({ u: k % 2 ? 0.8 : 0.2, rows: [12], color: PIECE_COLORS[k % 7] });
            times.push(world.time);
        }
        expect(ring(world, 0)[0].z).toBe(times[RINGS]);
        for (let slot = 1; slot < RINGS; slot += 1) expect(ring(world, slot)[0].z, `slot ${slot}`).toBe(times[slot]);
        begin(shared);
        for (let slot = 0; slot < RINGS; slot += 1) expect(ring(world, slot)[0].z).toBeLessThan(-1e5);
    });

    it('turns a twist into a whirl on the lock\'s side, its droplets wound up off the eye; a spin a smaller one', () => {
        const { world } = shared;
        begin(shared);
        world.onLock({ u: 0.85, rows: [15], color: PIECE_COLORS[1] });
        world.onClear({ lines: 2, twist: true, combo: 1 });
        const [place, shape, light] = ring(world, 1);
        const twistPower = place.w;
        expect(shape.z).toBe(RING_KIND.whirl);
        expect(place.z).toBe(START);
        // On the lock's side, where its ring opened, turning that side's way, in its colour.
        expect(place.x).toBe(ring(world, 0)[0].x);
        expect(Math.sign(shape.x)).toBe(1);
        expect(light.x).toBeCloseTo(ring(world, 0)[2].x, 9);
        const wound = motesOf(world, MOTE_KIND.whirl);
        expect(wound).toBeGreaterThan(30);
        expect(world.counts.twists).toBe(1);
        // Every droplet of a strand is born later than the one before it: a ribbon, not a burst.
        const born = [];
        for (let i = 0; i < world.motes.count; i += 1) {
            if (Math.round(world.motes.kind[i * 4]) === MOTE_KIND.whirl) born.push(world.motes.start[i * 4 + 3]);
        }
        expect(Math.max(...born) - Math.min(...born)).toBeGreaterThan(1.5);

        begin(shared);
        world.onLock({ u: 0.15, rows: [15], color: PIECE_COLORS[1] });
        world.onSpin();
        const [, spin] = ring(world, 1);
        expect(spin.z).toBe(RING_KIND.whirl);
        expect(Math.sign(spin.x)).toBe(-1);
        expect(ring(world, 1)[0].w).toBeLessThan(twistPower);
        expect(motesOf(world, MOTE_KIND.whirl)).toBeLessThan(wound);
        expect(world.counts.spins).toBe(1);
    });
});

describe('High Coast events: the wave of light', () => {
    it('shapes the wave: nothing before it sets out or after its life, growing all the way', () => {
        expect(waveStrength(-1)).toBe(0);
        expect(waveStrength(WAVE.life + 0.01)).toBe(0);
        expect(waveStrength(Number.NaN)).toBe(0);
        let last = 0;
        let peak = 0;
        for (let age = 0; age <= WAVE.life; age += 0.05) {
            const r = waveRadius(age);
            expect(r).toBeGreaterThan(last);
            last = r;
            const s = waveStrength(age);
            expect(s).toBeGreaterThanOrEqual(0);
            expect(s).toBeLessThanOrEqual(1);
            peak = Math.max(peak, s);
        }
        expect(peak).toBeGreaterThan(0.9);
        // It starts in the bay and is over the horizon when it ends.
        expect(waveRadius(0)).toBeLessThan(200);
        expect(waveRadius(WAVE.life)).toBeGreaterThan(50_000);
        expect(waveRadius(1e9)).toBe(waveRadius(WAVE.life));
    });

    it('sends the great wave out from the bay on four lines, and a ripple on a smaller clear', () => {
        const { world } = shared;
        const strengthAfter = (lines) => {
            begin(shared);
            world.onClear({ lines, combo: 1 });
            stepTo(shared, START + 0.6);
            return world.u.wave.value.w;
        };
        const one = strengthAfter(1);
        const three = strengthAfter(3);
        const four = strengthAfter(4);
        expect(one).toBeGreaterThan(0.05);
        expect(three).toBeGreaterThan(one);
        expect(four).toBeGreaterThan(three);
        // Its centre is water in the middle of the frame, found before the event (no march on it).
        const { x, y } = world.u.wave.value;
        expect(groundHeight(world.fields, x, y)).toBeLessThan(0);
        // It runs out and is gone.
        const r1 = world.u.wave.value.z;
        stepTo(shared, START + 2);
        expect(world.u.wave.value.z).toBeGreaterThan(r1 * 3);
        stepTo(shared, START + WAVE.life + 0.2);
        expect(world.u.wave.value.w).toBe(0);
        // The band's light is the hour's own, never a dimming.
        world.u.waveTint.value.toArray().forEach((v) => expect(v).toBeGreaterThan(0.4));
    });

    it('never lets a small clear\'s ripple cut off a great wave; a second quad feeds the one still young', () => {
        const { world } = shared;
        begin(shared);
        world.onClear({ lines: 4, combo: 1 });
        stepTo(shared, START + 1.6);
        const at = world.waveAt;
        const before = world.u.wave.value.w;
        world.onClear({ lines: 1, combo: 2 });
        expect(world.waveAt).toBe(at);
        stepTo(shared, START + 1.7);
        expect(world.u.wave.value.w).toBeGreaterThan(before * 0.7);

        begin(shared);
        world.onClear({ lines: 4, combo: 1 });
        const power = world.wavePower;
        stepTo(shared, START + 0.5);
        world.onClear({ lines: 4, combo: 2 });
        expect(world.waveAt).toBe(START);
        expect(world.wavePower).toBeGreaterThan(power);
        expect(world.wavePower).toBeLessThanOrEqual(1.6);
    });

    it('lets the sky catch the wave as it runs out, and lets it go', () => {
        const { world } = shared;
        begin(shared);
        world.setCaptureOverrides({ hour: 0 });
        stepTo(shared, START + 0.1);
        const rest = world.u.cloudLit.value.x;
        world.onClear({ lines: 4, combo: 1 });
        stepTo(shared, world.time + 3.2);
        expect(world.u.cloudLit.value.x).toBeGreaterThan(rest * 1.1);
        stepTo(shared, world.time + 30);
        expect(world.u.cloudLit.value.x).toBeLessThan(rest * 1.1);
        world.setCaptureOverrides({ hour: null });
    });

    it('spreads a perfect clear\'s glass out from the bay behind its wave', () => {
        const { world } = shared;
        begin(shared);
        expect(world.u.calmReach.value).toBeGreaterThan(1e5);
        world.onClear({ lines: 4, perfect: true });
        stepTo(shared, START + 0.5);
        const near = world.u.calmReach.value;
        expect(near).toBeLessThan(1000);
        expect(world.u.wave.value.w).toBeGreaterThan(0);
        stepTo(shared, START + 2.5);
        expect(world.u.calmReach.value).toBeGreaterThan(near * 3);
        expect(world.u.calm.value).toBeGreaterThan(0.9);
        stepTo(shared, START + WAVE.life + 0.2);
        expect(world.u.calmReach.value).toBeGreaterThan(1e5);
        // A second one while the glass holds keeps it whole: it does not shrink back to the bay.
        world.onClear({ lines: 1, perfect: true });
        stepTo(shared, world.time + 0.3);
        expect(world.u.calmReach.value).toBeGreaterThan(1e5);
    });
});

describe('High Coast events: the day, the night and the frame', () => {
    it('turns the day in time-lapse on a level-up: the deck races, and not under reduced motion', () => {
        const drift = (levelUp, reduced = false) => {
            const w = makeWorld();
            w.world.setReducedMotion(reduced);
            begin(w);
            if (levelUp) w.world.levelUp(2);
            stepTo(w, START + 6);
            const { x } = w.world.u.wind.value;
            w.world.dispose();
            return x;
        };
        const plain = drift(false);
        const lapsed = drift(true);
        expect(lapsed - plain).toBeGreaterThan(2000);
        // Reduced motion: no race (the level-up's own breath of wind is a few metres).
        expect(Math.abs(drift(true, true) - drift(false, true))).toBeLessThan(50);
    });

    it('shows noctilucent cloud in the light night only', () => {
        const { world } = shared;
        begin(shared);
        const at = (hour) => {
            world.setCaptureOverrides({ hour });
            stepTo(shared, world.time + 0.1);
            return world.u.nightShine.value;
        };
        expect(at(2)).toBeGreaterThan(0.8);
        expect(at(0)).toBe(0);
        expect(at(4)).toBe(0);
        expect(at(1)).toBeLessThan(0.05);
        world.setCaptureOverrides({ hour: null });
    });

    it('puts a tall screen\'s events in the water beside the card, not under it', () => {
        const tall = makeWorld(390, 844);
        begin(tall);
        const { world } = tall;
        const card = cardUnion(world.layout);
        for (const u of [0.05, 0.3, 0.49, 0.51, 0.7, 0.95]) {
            for (const row of [2, 12, 19]) {
                const p = world.sitePoint(u, row);
                if (u < 0.5) expect(p.x, `u ${u}`).toBeLessThan(card.x0);
                else expect(p.x, `u ${u}`).toBeGreaterThan(card.x1);
                expect(p.x).toBeGreaterThan(0);
                expect(p.x).toBeLessThan(1);
                expect(p.y, `row ${row}`).toBeGreaterThan(card.y0);
                expect(p.y, `row ${row}`).toBeLessThan((card.y0 + card.y1) / 2);
            }
        }
        // …and the lock finds water there.
        world.onLock({ u: 0.2, rows: [14], color: PIECE_COLORS[0] });
        const [place] = ring(world, 0);
        expect(place.w).toBeGreaterThan(0);
        expect(groundHeight(world.fields, place.x, place.y)).toBeLessThan(world.u.sea.value);
        world.dispose();
    });

    it('carries its rings, its wave and its gale through a rebuild in place', () => {
        const a = makeWorld();
        begin(a);
        a.world.onLock({
            u: 0.2, rows: [12], color: PIECE_COLORS[3], hardDrop: true, distance: 10,
        });
        a.world.onClear({ lines: 4, twist: true, combo: 2 });
        stepTo(a, START + 0.8);
        const state = structuredClone(a.world.exportSessionState());
        const b = makeWorld();
        b.world.seek(a.world.time);
        b.world.importSessionState(state);
        b.world.updateCamera(b.camera, { time: a.world.time, delta: 0 });
        b.world.update({ time: a.world.time, delta: 0 }, b.camera);
        a.world.u.tables.rings.forEach((row, k) => expect(b.world.u.tables.rings[k].toArray()).toEqual(row.toArray()));
        expect(b.world.u.wave.value.toArray()).toEqual(a.world.u.wave.value.toArray());
        expect(b.world.u.gale.value).toBeCloseTo(a.world.u.gale.value, 9);
        expect(b.world.lastLockU).toBe(a.world.lastLockU);
        a.world.dispose();
        b.world.dispose();
    });
});
