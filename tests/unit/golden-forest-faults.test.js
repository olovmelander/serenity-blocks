/**
 * Golden Forest — regressions: the faults the tests of the living-lake pass found, each kept as
 * the test that showed it (they failed until the source was put right; see the note on each).
 *
 * What holds by design is in golden-forest-living*.test.js. A test here that fails means the fault
 * it names is there (again, or still).
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { CraneSky } from '../../src/themes/golden-forest/golden-forest-crane-flight.js';
import { GoldenForestFlurry } from '../../src/themes/golden-forest/golden-forest-flurry.js';
import { GOLDEN_FOREST_ROAD, GoldenForestLake } from '../../src/themes/golden-forest/golden-forest-lake.js';
import { GoldenForestLight } from '../../src/themes/golden-forest/golden-forest-light.js';
import { GOLDEN_FOREST_TIERS } from '../../src/themes/golden-forest/golden-forest-quality.js';
import {
    GOLDEN_FOREST_TRACK_SECONDS, GOLDEN_FOREST_TRACK_SLOTS, GoldenForestReactions,
} from '../../src/themes/golden-forest/golden-forest-reactions.js';
import { GoldenForestStage } from '../../src/themes/golden-forest/golden-forest-stage.js';
import GoldenForestTheme from '../../src/themes/golden-forest/golden-forest-theme.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';
import { goldenForestCamera, nonFiniteUniforms, seededRandom } from './helpers/golden-forest-lake.js';

const DT = 1 / 60;
const owned = [];

function makeLight() {
    const light = new GoldenForestLight({ tier: GOLDEN_FOREST_TIERS.Minimal, rng: seededRandom(3) });
    owned.push(light);
    return light;
}

function makeLake() {
    return new GoldenForestLake({
        light: makeLight(),
        tier: GOLDEN_FOREST_TIERS.Minimal,
        lakeMap: new THREE.DataTexture(new Uint8Array(4), 1, 1),
    });
}

afterEach(() => {
    owned.splice(0).reverse().forEach((resource) => resource.dispose());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('a called skein on a wide screen (golden-forest-crane-flight.js: CALLED_SKEIN, call, calledAt)', () => {
    // Was: the lane began at x = -132, out of sight only up to about 2.07:1. On a phone held
    // sideways (19.5:9) a third of the skeins were born inside the frame, on 21:9 five in six, and
    // some were taken out of the sky with their last birds still in it. The lane a call is told
    // nothing about is now the one for the widest frame the lake is composed for (2.45:1).
    // (Held here for a call told nothing of its frame; through the camera, on every frame and at both
    // edges, in golden-forest-living-world.test.js, where what is still open of it is named.)
    const WIDE = [['a phone held sideways, 19.5:9', 19.5 / 9], ['21:9', 21 / 9], ['3440 x 1440', 3440 / 1440]];

    /** The skeins of many skies on a frame of this shape: the birds in sight at their call. */
    function flights(aspect) {
        const stage = new GoldenForestStage(goldenForestCamera(aspect));
        const point = new THREE.Vector3();
        const inSight = (sky, time) => sky.called.map((_, i) => {
            const at = sky.calledAt(i, time, [0, 0, 0]);
            const seen = stage.project(at[0], at[1], at[2], point);
            return seen.z > 0 && seen.x >= 0 && seen.x <= 1 && seen.y >= 0 && seen.y <= 1 ? seen.x : null;
        }).filter((x) => x !== null);
        const born = [];
        const worst = (xs) => Math.max(...xs).toFixed(3);
        for (let seed = 1; seed <= 30; seed += 1) {
            const sky = new CraneSky(GOLDEN_FOREST_TIERS.High.birds, seed);
            for (let n = 0; n < 4; n += 1) {
                const start = 20 + n * 100;
                sky.call(start);
                const first = inSight(sky, start);
                if (first.length) born.push(`sky ${seed} call ${n}: ${first.length} birds, up to x = ${worst(first)}`);
                // (Let it fly out, so the next call is a new skein.)
                expect(sky.calledAt(0, start + 60)).toBeNull();
            }
        }
        return born;
    }

    it.each(WIDE)('is born out of sight left of the frame on %s', (_, aspect) => {
        // Every bird of every skein left of the frame's edge (x < 0) when it is called.
        expect(flights(aspect)).toEqual([]);
    });
});

describe('a shaft of the fan in a cascade (golden-forest-reactions.js: openBeams)', () => {
    // Was: with every slot of the fan open, a new shaft took the place of the dimmest one past its
    // stand, however bright that one still was. In a cascade (waves 0.36 s apart) two-line waves
    // re-aimed shafts still giving 41 % of their light on every wave, three-line waves up to 85 %:
    // a snap of direction in the lens. Now a shaft gives its slot up only when nearly out, and the
    // new one is let go otherwise.
    it('lets a shaft go only when it is nearly out: never one still giving a third of its light', () => {
        const cuts = [];
        let opened = 0;
        for (const lines of [2, 3]) {
            const reactions = new GoldenForestReactions({ rng: seededRandom(2) });
            const seen = new Map();
            let next = 0;
            let wave = 0;
            for (let frame = 0; frame < 8 / DT; frame += 1) {
                const time = frame * DT;
                if (time >= next && wave < 12) {
                    wave += 1;
                    if (wave > 1) reactions.onCombo(wave);
                    reactions.onLineClear({ lineCount: lines, clearedRows: [22, 23], cascadeCount: wave });
                    next += 0.36;
                }
                const now = new Map(reactions.update(DT).beams.map((beam) => [beam.serial, beam.strength]));
                for (const [serial, light] of seen) {
                    if (now.has(serial)) {
                        light.last = now.get(serial);
                        light.peak = Math.max(light.peak, light.last);
                    } else {
                        // Gone from one frame to the next: how much of its own peak did it still give?
                        if (light.last > light.peak / 3) {
                            const share = Math.round((light.last / light.peak) * 100);
                            cuts.push(`${lines}-line waves: shaft ${serial} cut at ${share} % of its light`);
                        }
                        seen.delete(serial);
                    }
                }
                for (const [serial, strength] of now) {
                    if (!seen.has(serial)) {
                        seen.set(serial, { last: strength, peak: strength });
                        opened += 1;
                    }
                }
            }
        }
        expect(cuts).toEqual([]);
        // (The cascades did open their shafts: the fan was full, and the test is not vacuous.)
        expect(opened).toBeGreaterThan(12);
    });
});

describe('a pulse on the sun\'s road and its slot (golden-forest-reactions.js: track)', () => {
    // Was: every kind of track gave its slot up past 70 % of its life, "faint enough". A pulse on
    // the road is a bell (GoldenForestLake.setTracks): at 70 % of its life it was at 86 % of its
    // strength, at the eye's feet, and a third back-to-back in a row took it away in one frame.
    it('gives a road pulse\'s slot up only when the lake draws it faint', () => {
        const lake = makeLake();
        const drawn = (age, strength) => {
            lake.setTracks({ roads: [{ age, strength }] });
            return lake.uRoad.value.y;
        };
        const life = GOLDEN_FOREST_TRACK_SECONDS.roads;
        expect(life).toBe(GOLDEN_FOREST_ROAD.life);
        const reactions = new GoldenForestReactions({ rng: seededRandom(2) });
        // As many back-to-backs as the road has slots, then one more at every moment of their lives.
        for (let n = 0; n < GOLDEN_FOREST_TRACK_SLOTS.roads; n += 1) {
            reactions.onBackToBack();
            reactions.update(0.1);
        }
        let last = new Map(reactions.getFrame().roads.map((road) => [road.serial, { ...road }]));
        let worst = 0;
        for (let frame = 0; frame < (3 * life) / DT; frame += 1) {
            if (frame % 6 === 0) reactions.onBackToBack();
            const now = new Map(reactions.update(DT).roads.map((road) => [road.serial, { ...road }]));
            for (const [serial, road] of last) {
                const ranOut = road.age + DT >= life - 1e-9;
                if (!now.has(serial) && !ranOut) {
                    let peak = 0;
                    for (let age = 0; age < life; age += DT) peak = Math.max(peak, drawn(age, road.strength));
                    worst = Math.max(worst, drawn(road.age, road.strength) / peak);
                }
            }
            last = now;
        }
        // Whatever is cut for a new pulse is past its crest and under half its light.
        expect(worst).toBeLessThan(0.5);
    });
});

describe('the dusk and the settings (golden-forest-theme.js: onPieceLock; reactions: wake)', () => {
    // Was: game over lowered the light for everyone, but only a piece lock FORWARDED to the
    // director lifted it, and the theme forwards locks only while the lock ripple and the
    // background effects are on. With either off, a new game started straight away was played in
    // the dusk. Now the theme wakes the director on every lock, whatever the settings say.
    function playAgain(settings) {
        vi.stubGlobal('window', {
            settings,
            location: { search: '' },
            innerWidth: 1440,
            innerHeight: 900,
            devicePixelRatio: 1,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        });
        vi.stubGlobal('document', {
            hidden: false,
            getElementById: () => null,
            querySelector: () => null,
            querySelectorAll: () => [],
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        });
        const theme = new GoldenForestTheme();
        theme.isActive = true;
        theme.reactions = new GoldenForestReactions({ rng: seededRandom(1) });
        theme.setupEventListeners();
        try {
            const gameOver = window.addEventListener.mock.calls.findLast(([name]) => name === 'gameOver')[1];
            gameOver();
            // A second later the player is in the next game: pieces locking, lines clearing.
            for (let frame = 0; frame < 60; frame += 1) theme.reactions.update(DT);
            const sunk = theme.reactions.dusk;
            for (let second = 0; second < 6; second += 1) {
                eventBus.emit(EVENTS.HARD_DROP, { distance: 10 });
                eventBus.emit(EVENTS.PIECE_LOCK, { piece: { x: 2, y: 20, shape: [[1]] } });
                if (second % 2 === 0) eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 2 });
                for (let frame = 0; frame < 60; frame += 1) theme.reactions.update(DT);
            }
            return { sunk, dusk: theme.reactions.dusk, frame: theme.reactions.getFrame() };
        } finally {
            theme.teardownEventListeners();
        }
    }

    it.each([
        ['everything on', {}],
        ['the lock ripple off', { pieceLockRipple: false }],
        ['the background effects off', { backgroundComboEffects: false }],
        ['both off', { pieceLockRipple: false, backgroundComboEffects: false }],
    ])('lifts the dusk with the next game with %s', (_, settings) => {
        const { sunk, dusk } = playAgain(settings);
        // The light had begun to sink, and six seconds into the next game it is back.
        expect(sunk).toBeGreaterThan(0.1);
        expect(dusk).toBeLessThan(0.05);
    });

    it('still keeps the ripple and the effects themselves switched off while it does', () => {
        // The evening lifting is not an effect; the puffs, the rings and the jets are.
        const quiet = playAgain({ pieceLockRipple: false, backgroundComboEffects: false }).frame;
        expect(quiet.emitters).toEqual([]);
        expect(quiet.rings.every((ring) => ring.serial < 0)).toBe(true);
        expect(quiet.flurries.every((flurry) => flurry.serial < 0)).toBe(true);
        const noRipple = playAgain({ pieceLockRipple: false }).frame;
        expect(noRipple.emitters.every((emitter) => emitter.kind !== 'lock' && emitter.kind !== 'splash')).toBe(true);
        expect(noRipple.flurries.every((flurry) => flurry.serial < 0)).toBe(true);
    });
});

describe('junk into the new paths (GoldenForestLake.setTracks, GoldenForestFlurry.toss and cloud)', () => {
    it('keeps a track with a negative age off the water', () => {
        // Was: a negative age passed for live: the wave was drawn with a negative strength and a
        // negative radius, and the road's bell (sin(negative) ** 0.7) put NaN into uRoad.
        const lake = makeLake();
        for (const age of [-0.5, -1e-9, -40, -Infinity]) {
            const early = {
                x: 3, z: -20, age, strength: 1, turn: 1,
            };
            lake.setTracks({ waves: [early], swirls: [early], roads: [early] });
            expect(nonFiniteUniforms(lake), String(age)).toEqual([]);
            expect([lake.uWaveCount.value, lake.uSwirlCount.value], String(age)).toEqual([0, 0]);
            expect(lake.uRoad.value.toArray(), String(age)).toEqual([0, 0, 0, 0]);
        }
    });

    // STILL OPEN after the fix above: the road's own check lost `Number.isFinite(pulse.age)` (the
    // waves' and the spirals' `live()` has it). `null >= 0` and `null < life` are both true, so a
    // pulse whose age is null (or '', [], false) is taken for one at age 0: it lights nothing, but
    // it takes one of the road's two places, and a real pulse behind it is not drawn.
    it('gives a pulse whose age is no number no place on the road', () => {
        const lake = makeLake();
        const real = { age: 1, strength: 1 };
        for (const age of [null, '', [], false]) {
            const none = { age, strength: 1 };
            lake.setTracks({ roads: [none] });
            expect(lake.uRoad.value.toArray(), `age ${JSON.stringify(age)}`).toEqual([0, 0, 0, 0]);
            // Two of them ahead of a real pulse: the real one is still drawn.
            lake.setTracks({ roads: [none, none, real] });
            expect(lake.uRoad.value.y, `age ${JSON.stringify(age)}`).toBeGreaterThan(0);
        }
    });

    it('refuses a particle or a cloud that is not numbers, and loses no slot to a delay that is none', () => {
        // Was: toss() checked eight of its ten numbers; a NaN delay made the birth NaN, the record
        // was written and its slot was lost until reset(). cloud() checked nothing at all.
        const flurry = new GoldenForestFlurry({
            light: makeLight(), tier: { flurry: 4, puffs: 2 }, rng: seededRandom(4),
        }).build();
        owned.push(flurry);
        for (const delay of [NaN, Infinity, -3, undefined, null]) {
            flurry.toss('droplets', 0, 1, 0, 0, 1, 0, 1, 0.1, 0, delay);
            flurry.toss('droplets', 0, 1, 0, 0, 1, 0, 1, 0.1, NaN, delay);
            flurry.cloud(NaN, 5, 0, 1, 0, 0, NaN, 2, 1, 1, delay);
            flurry.cloud(0, 5, 0, 1, 0, 0, 4, 2, 1, 1, delay);
            expect(flurry.ring.data.every(Number.isFinite) && flurry.puffs.data.every(Number.isFinite)).toBe(true);
            flurry.time += 1000;
            expect(flurry.counts()).toMatchObject({ particles: 0, clouds: 0 });
            // Nothing is in flight, so the whole of both rings is there to take.
            const taken = [0, 1, 2, 3].filter(() => flurry.toss('droplets', 0, 1, 0, 0, 1, 0, 1, 0.1)).length;
            const breathed = [0, 1].filter(() => flurry.cloud(0, 5, 0, 1, 0, 0, 4, 2, 1, 1)).length;
            expect([taken, breathed], String(delay)).toEqual([4, 2]);
            flurry.time += 1000;
        }
    });
});
