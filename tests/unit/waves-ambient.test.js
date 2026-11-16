/**
 * Waves — the sea's own comings and goings (waves-ambient.js), on the CPU.
 *
 * Nothing here answers the board: which visit begins at a place in time, and every number of it,
 * is drawn from that place and the world's seed alone. So the tests ask the same place twice, out
 * of order and after going away, and hold that the sea is the same sea; and they walk tens of
 * thousands of places to hold what the walk promises (no kind twice in a row, each about as often
 * as its share, nothing outlasting the reach the world looks back over).
 *
 * How many come, where and how fast are tuned by eye and keep moving: the tests read the tables
 * from the modules and assert the order of things.
 */
import { describe, expect, it } from 'vitest';
import {
    VISITS, VISIT_REACH, VISIT_SECONDS, WavesAmbient, stageVisit, visitActs, visitAt,
} from '../../src/themes/waves/waves-ambient.js';
import {
    KINDS, WHALE_MODES, actAlive, actPose, emptyPose,
} from '../../src/themes/waves/waves-acts.js';
import { landingDistance, mulberry32 } from '../../src/themes/waves/waves-core.js';
import { slotsFor } from '../../src/themes/waves/waves-fauna.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/waves/waves-quality.js';

const SEEDS = [1, 21, 99, 187, 4242];
const NAMES = VISITS.map(([name]) => name);
const TOTAL = VISITS.reduce((sum, [, share]) => sum + share, 0);
const nameAt = (seed, index) => NAMES[visitAt(seed, index)];

/** The visits that come as more than one animal: a tier's share of them is fewer. */
const GROUPS = ['ridePod', 'troughPod', 'farPod', 'skitter', 'birds'];

/** What each visit is made of: the act, and the animals it may be. */
const MADE_OF = {
    rest: null,
    ridePod: ['ride', ['bottlenose', 'spinner']],
    troughPod: ['porpoise', ['bottlenose', 'spinner']],
    farPod: ['porpoise', ['spinner']],
    loneLeap: ['leap', ['bottlenose', 'spinner']],
    skitter: ['skitter', ['flyingFish']],
    turtle: ['ride', ['turtle']],
    manta: ['porpoise', ['manta']],
    whaleBlow: ['whale', ['humpback']],
    whaleFluke: ['whale', ['humpback']],
    whaleBreach: ['whale', ['humpback']],
    birds: ['soar', ['seabird']],
};

describe('waves ambient: which visit comes', () => {
    it('lists its visits with a share each, a quiet sea among them', () => {
        expect(new Set(NAMES).size).toBe(NAMES.length);
        expect([...NAMES].sort()).toEqual(Object.keys(MADE_OF).sort());
        expect(Object.isFrozen(VISITS)).toBe(true);
        for (const [name, share] of VISITS) expect(share, name).toBeGreaterThan(0);
        // The pods are the sea's everyday; the whole whale out of the water is its rarest sight.
        const share = Object.fromEntries(VISITS);
        expect(Math.min(...VISITS.map(([, s]) => s))).toBe(share.whaleBreach);
        expect(Math.max(...VISITS.map(([, s]) => s))).toBe(share.ridePod);
        expect(VISIT_SECONDS).toBeGreaterThan(0);
        expect(Number.isInteger(VISIT_REACH) && VISIT_REACH >= 1).toBe(true);
    });

    it('never sends the same kind twice in a row, over tens of thousands of places and several seeds', () => {
        const places = 30_000;
        for (const seed of SEEDS) {
            let repeats = 0;
            let last = visitAt(seed, 0);
            const seen = new Set([last]);
            for (let index = 1; index < places; index++) {
                const visit = visitAt(seed, index);
                if (visit === last) repeats += 1;
                seen.add(visit);
                last = visit;
            }
            expect(repeats, `seed ${seed}`).toBe(0);
            // And every kind of visit comes, sooner or later.
            expect(seen.size, `seed ${seed}`).toBe(VISITS.length);
        }
    });

    it('sends each kind about as often as its share says', () => {
        const places = 30_000;
        for (const seed of SEEDS) {
            const counts = new Array(VISITS.length).fill(0);
            for (let index = 0; index < places; index++) counts[visitAt(seed, index)] += 1;
            VISITS.forEach(([name, share], i) => {
                // (Stepping past a repeat hands a little of each kind's share to the next along:
                // near its share, not on it.)
                expect(Math.abs(counts[i] / places - share / TOTAL), `${name}, seed ${seed}`).toBeLessThan(0.03);
                expect(counts[i] / places / (share / TOTAL), `${name}, seed ${seed}`).toBeGreaterThan(0.6);
                expect(counts[i] / places / (share / TOTAL), `${name}, seed ${seed}`).toBeLessThan(1.5);
            });
            const of = (name) => counts[NAMES.indexOf(name)];
            expect(of('ridePod')).toBeGreaterThan(of('loneLeap'));
            expect(of('troughPod')).toBeGreaterThan(of('birds'));
            expect(of('skitter')).toBeGreaterThan(of('whaleBlow'));
            expect(of('whaleBlow')).toBeGreaterThan(of('whaleBreach'));
        }
    });

    it('answers the same for a place however it is come to: in order, backwards, alone', () => {
        const seed = 187;
        const places = 2000;
        const forward = Array.from({ length: places }, (_, index) => visitAt(seed, index));
        const backward = [];
        for (let index = places - 1; index >= 0; index--) backward[index] = visitAt(seed, index);
        expect(backward).toEqual(forward);
        // Hopping about, and far on (where the walk no longer starts at the beginning of time).
        const rand = mulberry32(8);
        for (let k = 0; k < 500; k++) {
            const index = Math.floor(rand() * places);
            expect(visitAt(seed, index)).toBe(forward[index]);
        }
        expect(visitAt(seed, 1_000_000)).toBe(visitAt(seed, 1_000_000));
        // Before the start of time the sea is quiet.
        expect(NAMES[visitAt(seed, -1)]).toBe('rest');
        expect(NAMES[visitAt(seed, -500)]).toBe('rest');
        // Another seed is another sea.
        const other = Array.from({ length: places }, (_, index) => visitAt(5, index));
        expect(other).not.toEqual(forward);
        expect(other.filter((visit, index) => visit === forward[index]).length).toBeLessThan(places / 4);
    });
});

describe('waves ambient: what a visit is', () => {
    it('stages the same acts for the same place and seed every time, and others for another seed', () => {
        for (const seed of SEEDS) {
            for (let index = 0; index < 120; index++) {
                const first = visitActs(seed, index);
                const again = visitActs(seed, index);
                expect(again, `seed ${seed}, place ${index}`).toEqual(first);
                // Made again each time: an act is a plain object, nobody else's.
                if (first.length) expect(again[0]).not.toBe(first[0]);
            }
        }
        const sea = (seed) => JSON.stringify(Array.from({ length: 60 }, (_, index) => visitActs(seed, index)));
        expect(sea(187)).toBe(sea(187));
        expect(sea(187)).not.toBe(sea(188));
        // The same kind of visit at two places is not the same visit twice.
        const pods = [];
        for (let index = 0; pods.length < 2; index++) if (nameAt(187, index) === 'troughPod') pods.push(visitActs(187, index));
        const still = (acts) => JSON.stringify(acts.map(({ t0, ...rest }) => rest));
        expect(still(pods[0])).not.toBe(still(pods[1]));
    });

    it('makes every visit of animals the pack has, each doing what that visit is', () => {
        for (const name of NAMES) {
            const made = MADE_OF[name];
            let most = 0;
            for (let seed = 1; seed <= 300; seed++) {
                const acts = stageVisit(name, mulberry32(seed), 100, 1);
                most = Math.max(most, acts.length);
                if (!made) {
                    expect(acts, name).toEqual([]);
                    continue;
                }
                expect(acts.length, `${name}, seed ${seed}`).toBeGreaterThan(0);
                for (const act of acts) {
                    expect(act.type, name).toBe(made[0]);
                    expect(made[1], `${name}: a ${act.kind}`).toContain(act.kind);
                    expect(KINDS, name).toContain(act.kind);
                    expect(Array.isArray(act.events), name).toBe(true);
                    expect(act.life, name).toBeGreaterThan(0);
                }
                // One pod is one species.
                expect(new Set(acts.map((act) => act.kind)).size, name).toBe(1);
            }
            // The lone animals come alone; a pod, a school or a flock comes as several.
            if (made) expect(most > 1, name).toBe(GROUPS.includes(name));
        }
        // A whale's visit is the turn at the surface it is named for.
        for (const mode of WHALE_MODES) {
            const name = `whale${mode[0].toUpperCase()}${mode.slice(1)}`;
            expect(stageVisit(name, mulberry32(3), 0)[0].mode).toBe(mode);
        }
        // A manta and a turtle stay under the glass: nothing of theirs breaks the surface.
        expect(stageVisit('manta', mulberry32(3), 0)[0].events).toEqual([]);
        expect(stageVisit('turtle', mulberry32(3), 0)[0].events).toEqual([]);
        // A visit it does not know is nobody.
        expect(stageVisit('kraken', mulberry32(3), 0)).toEqual([]);
    });

    it('sends the whole pod, school or flock at the full tiers and a share of it for a leaner one, never nobody', () => {
        for (const name of NAMES.filter((n) => MADE_OF[n])) {
            let full = 0;
            let half = 0;
            for (let seed = 1; seed <= 300; seed++) {
                const whole = stageVisit(name, mulberry32(seed), 0, 1).length;
                const lean = stageVisit(name, mulberry32(seed), 0, 0.5).length;
                expect(lean, `${name}, seed ${seed}`).toBeLessThanOrEqual(whole);
                expect(lean, `${name}, seed ${seed}`).toBeGreaterThanOrEqual(1);
                full += whole;
                half += lean;
            }
            if (GROUPS.includes(name)) expect(half, name).toBeLessThan(full * 0.7);
            else expect(half, name).toBe(full);
        }
        // With nothing said the sea is full.
        expect(stageVisit('farPod', mulberry32(9), 0)).toEqual(stageVisit('farPod', mulberry32(9), 0, 1));
        expect(visitActs(187, 30)).toEqual(visitActs(187, 30, 1));
    });

    it('begins every act with its visit or after it, and has every one of them over within its reach', () => {
        const reach = VISIT_REACH * VISIT_SECONDS;
        let longest = 0;
        const wrong = [];
        for (const seed of SEEDS) {
            for (let index = 0; index < 4000; index++) {
                const start = index * VISIT_SECONDS;
                for (const act of visitActs(seed, index)) {
                    const where = `${nameAt(seed, index)}, seed ${seed}, place ${index}`;
                    // Nothing of a visit shows before its own moment (an act is drawn from its lead).
                    if (!(act.t0 - (act.lead || 0) >= start)) wrong.push(`${where}: shows ${start - act.t0} s early`);
                    // And nothing outlasts the visits the world looks back over.
                    const over = act.t0 + act.life - start;
                    if (!(over <= reach)) wrong.push(`${where}: over ${over} s after it began`);
                    longest = Math.max(longest, over);
                }
            }
        }
        expect(wrong.slice(0, 8)).toEqual([]);
        // A visit outlasts the gap to the next: the sea is rarely empty.
        expect(longest).toBeGreaterThan(VISIT_SECONDS * 2);
    });

    it('keeps its leaps in the trough ahead of the lip, its rides beside the rider, its whales and birds far out', () => {
        const wrong = [];
        let rides = 0;
        let overhead = 0;
        let leftward = 0;
        let school = 0;
        for (let seed = 1; seed <= 200; seed++) {
            const stage = (name) => stageVisit(name, mulberry32(seed), 50, 1);
            for (const leap of stage('loneLeap')) {
                // Out of the flat water in front of the wave, past where the lip comes down, up and out.
                if (!(leap.row <= 0 && leap.y === 0)) wrong.push(`seed ${seed}: a leap from row ${leap.row}`);
                if (!(-leap.z > landingDistance(0))) wrong.push(`seed ${seed}: a leap ${-leap.z} m ahead`);
                if (!(leap.vy > 0 && leap.vx < 0)) wrong.push(`seed ${seed}: a leap along (${leap.vx}, ${leap.vy})`);
            }
            const pod = stage('ridePod');
            const passing = [...pod, ...stage('turtle')];
            for (let i = 0; i < passing.length; i += 1) {
                const ride = passing[i];
                // Inside the wall, above the foot of the face, in the stretch of tube round the rider.
                rides += 1;
                if (ride.row > 0.45) overhead += 1;
                if (!(ride.row > 0 && ride.row < 0.56)) wrong.push(`seed ${seed}: a ride at row ${ride.row}`);
                if (!(Math.min(ride.d0, ride.d1) > -9 && Math.max(ride.d0, ride.d1) < 7)) {
                    wrong.push(`seed ${seed}: a ride from ${ride.d0} to ${ride.d1}`);
                }
                // The first of a pod, and a turtle, pass the eye: from behind it to ahead, or back.
                if ((i === 0 || i >= pod.length) && !(Math.min(ride.d0, ride.d1) < 0 && Math.max(ride.d0, ride.d1) > 0)) {
                    wrong.push(`seed ${seed}: a ride that never passes the eye (${ride.d0} to ${ride.d1})`);
                }
                if (!(ride.depth - ride.depthAmp > 0)) wrong.push(`seed ${seed}: a ride ${ride.depth} m deep`);
            }
            for (const roll of [...stage('troughPod'), ...stage('farPod'), ...stage('manta')]) {
                if (!(roll.z < 0)) wrong.push(`seed ${seed}: a roll behind the eye`);
                if (!(Math.abs(Math.hypot(roll.hx, roll.hz) - 1) < 1e-9)) wrong.push(`seed ${seed}: a roll with no heading`);
            }
            for (const whale of [...stage('whaleBlow'), ...stage('whaleFluke'), ...stage('whaleBreach')]) {
                if (!(whale.z < -90 && whale.x < 0)) wrong.push(`seed ${seed}: a whale at (${whale.x}, ${whale.z})`);
            }
            for (const fish of stage('skitter')) {
                // Out of the trough ahead of the eye, and on down the line.
                school += 1;
                if (fish.hx < 0) leftward += 1;
                if (!(fish.hz < 0 && fish.z < 0 && fish.vy > 0)) wrong.push(`seed ${seed}: a fish heading z ${fish.hz}`);
            }
            for (const bird of stage('birds')) {
                if (!(bird.z < -25 && bird.y > 1.5)) wrong.push(`seed ${seed}: a bird at y ${bird.y}, z ${bird.z}`);
            }
        }
        expect(wrong.slice(0, 8)).toEqual([]);
        // The school fans away from the wave, toward the open sea on the left.
        expect(leftward / school).toBeGreaterThan(0.9);
        // (waves-acts.js gives a ride's row as "0 its foot .. ~0.45 under the roof". The fourth of
        // a full pod is staged a little past that now and then, up in the roof itself: about one
        // ride in a hundred.)
        expect(overhead / rides).toBeLessThan(0.03);
    });

    it('flies its birds over the sea, all but a rare one clear of the water at the foot of every swoop', () => {
        let birds = 0;
        let wet = 0;
        let lowest = Infinity;
        for (const seed of SEEDS) {
            for (let index = 0; index < 4000; index++) {
                if (nameAt(seed, index) !== 'birds') continue;
                for (const bird of visitActs(seed, index)) {
                    birds += 1;
                    lowest = Math.min(lowest, bird.y - bird.swoop);
                    if (bird.y - bird.swoop <= 0) wet += 1;
                }
            }
        }
        expect(birds).toBeGreaterThan(3000);
        // (The lowest line and the deepest swoop the sea draws can meet: about one bird in two
        // thousand skims under for a moment. Never more than a wing's depth.)
        expect(wet / birds).toBeLessThan(0.005);
        expect(lowest).toBeGreaterThan(-0.5);
    });
});

describe('waves ambient: the sea at a moment', () => {
    it('hands back the acts of the last few visits, oldest first, into the list it is given', () => {
        const sea = new WavesAmbient({ seed: 187 });
        expect(sea).toMatchObject({ seed: 187, scale: 1 });
        for (const clock of [0, 3.9, 8, 100, 1234.5]) {
            const now = Math.floor(clock / VISIT_SECONDS);
            const expected = [];
            for (let index = Math.max(0, now - VISIT_REACH); index <= now; index++) expected.push(...visitActs(187, index));
            const list = [{ stale: true }];
            expect(sea.actsAt(clock, list)).toBe(list);
            expect(list, `at ${clock}`).toEqual(expected);
            // Asked again, they are the very same acts: the sea keeps the visits it has met.
            const again = sea.actsAt(clock);
            expect(again).not.toBe(list);
            expect(again.every((act, i) => act === list[i]), `at ${clock}`).toBe(true);
        }
        // Its own number of animals for a leaner tier.
        const lean = new WavesAmbient({ seed: 187, scale: 0.5 });
        const count = (ambient) => {
            let n = 0;
            for (let clock = 0; clock < 800; clock += VISIT_SECONDS) n += ambient.actsAt(clock).length;
            return n;
        };
        expect(count(lean)).toBeLessThan(count(sea));
        expect(count(lean)).toBeGreaterThan(0);
        // With nothing said: a full sea, on a seed of its own.
        expect(new WavesAmbient()).toMatchObject({ scale: 1 });
    });

    it('never leaves out an act that is showing: its look back reaches every visit still in the water', () => {
        for (const seed of [21, 187]) {
            const sea = new WavesAmbient({ seed });
            const every = [];
            for (let index = 0; index < 160; index++) every.push(...visitActs(seed, index));
            for (let clock = 0; clock < 150 * VISIT_SECONDS; clock += 1.7) {
                const showing = every.filter((act) => actAlive(act, clock - act.t0));
                const handed = sea.actsAt(clock).filter((act) => actAlive(act, clock - act.t0));
                expect(handed, `seed ${seed}, at ${clock.toFixed(1)}`).toEqual(showing);
            }
        }
    });

    it('is the same sea after going away and coming back: a seek', () => {
        const sea = new WavesAmbient({ seed: 21 });
        const clocks = [0, 42, 97.5, 400, 1900];
        const first = clocks.map((clock) => JSON.stringify(sea.actsAt(clock)));
        // Hours on, a visit at a time (far more visits than it keeps), then back.
        for (let clock = 2000; clock < 6000; clock += VISIT_SECONDS) sea.actsAt(clock);
        expect(clocks.map((clock) => JSON.stringify(sea.actsAt(clock)))).toEqual(first);
        // Backwards through them, and from a sea that was never anywhere else.
        expect([...clocks].reverse().map((clock) => JSON.stringify(sea.actsAt(clock)))).toEqual([...first].reverse());
        const fresh = new WavesAmbient({ seed: 21 });
        expect(JSON.stringify(fresh.actsAt(1900))).toBe(first[4]);
        expect(sea.nameAt(97.5)).toBe(fresh.nameAt(97.5));
        // It never keeps more than a few minutes of visits, however long it runs.
        expect(sea.kept.size).toBeLessThanOrEqual(32);
    });

    // The kept visits are the ones most lately met. Letting go of the lowest index instead threw the
    // visit just made away after any seek back by more than the cache (192 s), and every frame made
    // all its visits' acts again (the playground's ?t= seeks go back; the game's clock never does).
    it('keeps the visits it has met after a seek back: the same acts, not the same made again each ask', () => {
        const sea = new WavesAmbient({ seed: 187 });
        for (let clock = 0; clock < 60 * VISIT_SECONDS; clock += VISIT_SECONDS) sea.actsAt(clock);
        const back = sea.actsAt(20);
        const again = sea.actsAt(20);
        expect(back.length).toBeGreaterThan(0);
        expect(again).toEqual(back);
        expect(again.every((act, i) => act === back[i])).toBe(true);
    });

    it('names the visit that begins at a moment', () => {
        const sea = new WavesAmbient({ seed: 187 });
        for (let index = 0; index < 200; index++) {
            const name = nameAt(187, index);
            expect(sea.nameAt(index * VISIT_SECONDS)).toBe(name);
            expect(sea.nameAt((index + 0.99) * VISIT_SECONDS)).toBe(name);
            // What it names is what it stages.
            const acts = visitActs(187, index);
            if (name === 'rest') expect(acts).toEqual([]);
            else expect(acts[0].type).toBe(MADE_OF[name][0]);
        }
    });

    it('asks for no more of a kind than its tier can draw, all but a few moments in a hundred', () => {
        // Every animal the sea has in the water at a moment, kind by kind, against the slots that
        // kind has (waves-fauna.js). What does not fit is not drawn, so this is a budget the
        // staging has to keep to. Measured here (seeds 1, 21 and 187, every half second of 100
        // minutes each): at High the sea never asks for more bottlenose, whales, mantas, turtles
        // or flying fish than can be drawn; spinners are over about 3 moments in 100 (a far pod
        // over a pod in the wall and one in the trough: 18 staged at the worst, for 8 slots) and
        // seabirds a handful of moments in 10 000 (two flocks: 10 for 8). The leaner tiers halve
        // the slots and the pods alike, and two whales' visits can overlap for a second or two
        // where there is one slot.
        const pose = emptyPose();
        const list = [];
        for (const quality of ['Minimal', 'Medium', 'High']) {
            const tier = QUALITY[quality];
            const slots = Object.fromEntries(KINDS.map((kind) => [kind, slotsFor(kind, tier)]));
            const over = Object.fromEntries(KINDS.map((kind) => [kind, 0]));
            let moments = 0;
            for (const seed of [1, 21, 187]) {
                const sea = new WavesAmbient({ seed, scale: tier.life });
                for (let clock = 0; clock < 6000; clock += 0.5) {
                    const there = Object.fromEntries(KINDS.map((kind) => [kind, 0]));
                    for (const act of sea.actsAt(clock, list)) {
                        if (actPose(act, clock, 0, pose).metres > 0) there[act.kind] += 1;
                    }
                    moments += 1;
                    for (const kind of KINDS) if (there[kind] > slots[kind]) over[kind] += 1;
                }
            }
            for (const kind of KINDS) expect(over[kind] / moments, `${kind} at ${quality}`).toBeLessThan(0.05);
            if (quality === 'High') {
                for (const kind of ['bottlenose', 'humpback', 'manta', 'turtle', 'flyingFish']) {
                    expect(over[kind], `${kind} at High`).toBe(0);
                }
            }
        }
        // Every tier can draw at least one of everything, and never fewer than the tier below it.
        QUALITY_NAMES.forEach((quality, i) => {
            for (const kind of KINDS) {
                expect(slotsFor(kind, QUALITY[quality]), `${kind} at ${quality}`).toBeGreaterThanOrEqual(1);
                if (i > 0) {
                    expect(slotsFor(kind, QUALITY[quality])).toBeGreaterThanOrEqual(slotsFor(kind, QUALITY[QUALITY_NAMES[i - 1]]));
                }
            }
        });
    });
});
