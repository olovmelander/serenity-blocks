/**
 * Stillwater — the story the two tell (stillwater-story.js).
 *
 * The story decides what each of them means to do: how far a chain has drawn them (the bond), where
 * the troll stands for it, when he sits and she kneels, the gold heart's flight after four lines, the
 * path of light, what each does with staff and hands and where each looks. It is a function of the
 * clock and of what it was told, so these tests tell it things at given times and read it back.
 * The timings are tuned freely; every one a test needs is read from the module's exports.
 *
 * A test marked `it.fails` pins a fault that is known and left open: it says what it expects and
 * what happens instead, and turns red the day the fault is fixed (drop `.fails` then).
 */
import { describe, expect, it } from 'vitest';
import {
    DOZE_AFTER, FERVOUR_BOND, HEART_FLIGHT, HEART_GAP, HEART_QUEUE, KNEEL_AFTER, PARTING, SIT_AFTER, StillwaterStory,
    bondForCombo, chainBond, spiritPathPoint, trollStation,
} from '../../src/themes/stillwater/stillwater-story.js';
import {
    APPROACH_STEPS, HEART, SPIRIT, TROLL,
} from '../../src/themes/stillwater/stillwater-core.js';

const DT = 1 / 60;
/** Where things are, as the world tells the story every frame (his place at home unless a test moves him). */
const SPIRIT_HEART = [-6.2, 1.5, -10.1];
const LANTERN = [8.3, 2.6, -11.2];
const where = (troll = [TROLL.home[0], TROLL.home[2]]) => ({ spiritHeart: SPIRIT_HEART, lantern: LANTERN, troll });

/** A story at `start`, updated once. */
function storyAt(start = 0) {
    const story = new StillwaterStory();
    story.reset(start);
    story.update(start, 0, where());
    return story;
}

/** Run the clock on from the story's time to `until` in frames of DT, calling `each(time)` after each update. */
function runTo(story, until, each = null, at = where()) {
    let { time } = story;
    while (time < until - 1e-9) {
        time = Math.min(until, time + DT);
        story.update(time, DT, at);
        if (each) each(time);
    }
    return time;
}

const stationAt = (bond) => {
    if (bond >= 0.7) return 'shallows';
    return bond >= 0.4 ? 'bank' : 'home';
};

describe('stillwater story: the bond', () => {
    it('reads a chain as how far it has drawn them: none for none, never less for more, at most all the way', () => {
        expect(bondForCombo(0)).toBe(0);
        for (const junk of [NaN, undefined, null, -3, 'x', {}]) expect(bondForCombo(junk), String(junk)).toBe(0);
        let last = 0;
        for (let n = 0; n <= 40; n++) {
            const bond = bondForCombo(n);
            expect(bond, `combo ${n}`).toBeGreaterThanOrEqual(last);
            expect(bond, `combo ${n}`).toBeLessThanOrEqual(1);
            last = bond;
        }
        expect(bondForCombo(1)).toBeGreaterThan(0);
        expect(bondForCombo(1e9)).toBe(APPROACH_STEPS.at(-1));
        expect(bondForCombo(2.4)).toBe(bondForCombo(2));
    });

    it('takes a single clear for no chain: two in a row begin to draw them, and each clear after one step more', () => {
        // The game reports 1 for the first clear of a chain.
        expect(chainBond(0)).toBe(0);
        expect(chainBond(1)).toBe(0);
        for (const junk of [NaN, undefined, null, -3, 'x', {}]) expect(chainBond(junk), String(junk)).toBe(0);
        expect(chainBond(2)).toBeGreaterThan(0);
        let last = 0;
        for (let n = 1; n <= 40; n++) {
            expect(chainBond(n), `combo ${n}`).toBe(bondForCombo(n - 1));
            expect(chainBond(n), `combo ${n}`).toBeGreaterThanOrEqual(last);
            last = chainBond(n);
        }
        expect(last).toBe(APPROACH_STEPS.at(-1));
        // And the story reads the game's combo so.
        const story = storyAt(0);
        for (const n of [1, 2, 3, 5, 9]) {
            story.onCombo(n, n);
            story.update(n, DT, where());
            expect(story.bond, `combo ${n}`).toBe(chainBond(n));
        }
    });

    it('stands him at home, on the bank or in the shallows by the bond: further for more, home for none', () => {
        const order = ['home', 'bank', 'shallows'];
        for (const current of order) {
            expect(trollStation(0, current), current).toBe('home');
            expect(trollStation(1, current), current).toBe('shallows');
        }
        // A rising bond walks him only forward; a falling one only back.
        let station = 'home';
        for (let bond = 0; bond <= 1.0001; bond += 0.005) {
            const next = trollStation(bond, station);
            expect(order.indexOf(next), `up at ${bond.toFixed(3)}`).toBeGreaterThanOrEqual(order.indexOf(station));
            station = next;
        }
        expect(station).toBe('shallows');
        for (let bond = 1; bond >= -0.0001; bond -= 0.005) {
            const next = trollStation(bond, station);
            expect(order.indexOf(next), `down at ${bond.toFixed(3)}`).toBeLessThanOrEqual(order.indexOf(station));
            station = next;
        }
        expect(station).toBe('home');
        // Every step of the way is used.
        expect(new Set([0, 0.2, 0.5, 0.9].map((b) => trollStation(b, 'home')))).toEqual(new Set(order));
    });

    it('does not walk him to and fro for a bond that wavers about a step', () => {
        const order = ['home', 'bank', 'shallows'];
        // Where the station changes as the bond rises, and as it falls.
        const edges = [];
        for (const direction of [1, -1]) {
            let station = direction > 0 ? 'home' : 'shallows';
            for (let k = 0; k <= 1000; k++) {
                const bond = direction > 0 ? k / 1000 : 1 - k / 1000;
                const next = trollStation(bond, station);
                if (next !== station) edges.push({ bond, from: station });
                station = next;
            }
        }
        expect(edges.length).toBeGreaterThanOrEqual(4);
        for (const { bond, from } of edges) {
            // Once over the edge, a bond that wavers a little either side of it leaves him where he went.
            const over = trollStation(bond, from);
            for (const wobble of [0.004, 0.02, 0.05]) {
                let station = over;
                const seen = new Set([station]);
                for (let i = 0; i < 20; i++) {
                    station = trollStation(bond + (i % 2 ? wobble : -wobble), station);
                    seen.add(station);
                }
                const label = `${from} → ${over} at ${bond.toFixed(3)}, wavering by ${wobble}`;
                // He may take the one step the wavering asks for, never come back over it.
                expect(seen.size, label).toBeLessThanOrEqual(2);
                const steps = [...seen].map((s) => order.indexOf(s)).sort().join();
                if (seen.size === 2) expect(steps, label).not.toBe('0,2');
                const flips = [];
                station = over;
                for (let i = 0; i < 20; i++) {
                    const next = trollStation(bond + (i % 2 ? wobble : -wobble), station);
                    if (next !== station) flips.push(next);
                    station = next;
                }
                expect(flips.length, label).toBeLessThanOrEqual(1);
            }
        }
        // (The plain rule, with no memory, would flip at every wobble: that is what this guards.)
        expect(stationAt(0.39)).not.toBe(stationAt(0.41));
    });

    it('draws them on at once for a chain, and holds them a parting\'s length when it breaks', () => {
        const story = storyAt(10);
        story.onCombo(3, 10);
        story.update(10 + DT, DT, where());
        expect(story.bond).toBe(chainBond(3));
        runTo(story, 20);
        story.onCombo(0, 20);
        const held = [];
        runTo(story, 20 + PARTING + 1, (time) => held.push([time, story.bond, story.gaze]));
        for (const [time, bond] of held) {
            // (The frame that falls on the parting's end may read either side of it.)
            if (Math.abs(time - (20 + PARTING)) < 1e-6) continue;
            if (time < 20 + PARTING) expect(bond, `t ${time.toFixed(3)}`).toBe(chainBond(3));
            else expect(bond, `t ${time.toFixed(3)}`).toBe(0);
        }
        // They hold each other's eyes while they part.
        const during = held.filter(([time]) => time > 21 && time < 20 + PARTING);
        expect(Math.max(...during.map(([, , gaze]) => gaze))).toBeGreaterThan(0.8);
    });

    it('lets a new chain begun in the parting cancel it', () => {
        const story = storyAt(0);
        story.onCombo(5, 1);
        runTo(story, 4);
        story.onCombo(0, 4);
        runTo(story, 4 + PARTING / 2);
        story.onCombo(2, story.time);
        runTo(story, 4 + PARTING * 3);
        expect(story.partingUntil).toBe(-1);
        expect(story.bond).toBe(chainBond(2));
    });

    it('parts them sooner when the run ends than when a chain breaks', () => {
        const broken = storyAt(0);
        const ended = storyAt(0);
        for (const story of [broken, ended]) {
            story.onCombo(4, 1);
            runTo(story, 5);
        }
        broken.onCombo(0, 5);
        ended.onEnd(5);
        const gone = (story) => {
            let at = null;
            runTo(story, 5 + PARTING + 2, (time) => {
                if (at === null && story.bond === 0) at = time;
            });
            return at;
        };
        const whenEnded = gone(ended);
        const whenBroken = gone(broken);
        expect(whenEnded).not.toBeNull();
        expect(whenBroken).not.toBeNull();
        expect(whenEnded).toBeLessThan(whenBroken);
        expect(ended.combo).toBe(0);
        expect(ended.ended).toBe(true);
    });

    // A chain that grows never lowers the bond; one that broke and began again holds them in the
    // parting first (found pinned: 8 → 3 → 4 once walked the troll back up the bank on a clear).
    it('never draws them back for a chain that grows', () => {
        const story = storyAt(0);
        let last = 0;
        for (const [time, combo] of [[1, 8], [2, 3], [3, 4], [4, 5]]) {
            story.onCombo(combo, time);
            story.update(time, DT, where());
            if (combo > 3) expect(story.bond, `combo ${combo}`).toBeGreaterThanOrEqual(last);
            last = story.bond;
        }
    });

    it('runs the path of light between them while the chain holds them near, and lets it fade when it breaks', () => {
        const story = storyAt(0);
        story.onCombo(2, 0.5);
        runTo(story, 6);
        expect(story.path).toBe(0);
        story.onCombo(6, 6);
        let last = story.path;
        runTo(story, 20, () => {
            expect(story.path).toBeGreaterThanOrEqual(last);
            expect(story.path).toBeLessThanOrEqual(1);
            last = story.path;
        });
        expect(story.path).toBeGreaterThan(0.95);
        story.onCombo(0, 20);
        runTo(story, 20 + PARTING + 10, () => {
            expect(story.path).toBeLessThanOrEqual(last);
            last = story.path;
        });
        expect(story.path).toBeLessThan(0.02);
    });
});

describe('stillwater story: the heart\'s flight', () => {
    /** A story told four lines at t = 10, with her heart at SPIRIT_HEART. */
    function quad(extra = {}) {
        const story = storyAt(9);
        story.onClear({ time: 10, lines: 4, ...extra });
        story.update(10, 0, where());
        return story;
    }

    it('is nowhere before four lines are cleared, nor before it rises, nor once it is done', () => {
        const story = storyAt(0);
        expect(story.heartAt(5)).toBeNull();
        story.onClear({ time: 6, lines: 3 });
        expect(story.heartAt(7)).toBeNull();
        expect(story.heartTaken(7)).toBe(0);
        const flying = quad();
        expect(flying.heartAt(10 + HEART_FLIGHT.rise - 1e-6)).toBeNull();
        expect(flying.heartAt(10 + HEART_FLIGHT.rise + 1e-6)).not.toBeNull();
        expect(flying.heartAt(10 + HEART_FLIGHT.held + 3)).toBeNull();
        // A perfect clear raises it whatever the lines.
        expect(quad({ lines: 1, perfect: true }).heartAt(10 + HEART_FLIGHT.crest)).not.toBeNull();
    });

    it('rises out of the dark under the water, crosses in an arc, and comes to rest in her breast', () => {
        const story = quad();
        const at = (t) => story.heartAt(10 + t, [0, 0, 0, 0]);
        const first = at(HEART_FLIGHT.rise + 1e-4);
        expect(first[1]).toBeLessThan(0);
        expect(first[1]).toBeCloseTo(HEART[1], 2);
        expect([first[0], first[2]]).toEqual([HEART[0], HEART[2]]);
        // At the surface, then high over the water at its crest.
        expect(at(HEART_FLIGHT.surface)[1]).toBeGreaterThanOrEqual(0);
        expect(at(HEART_FLIGHT.surface)[1]).toBeLessThan(0.2);
        expect(at(HEART_FLIGHT.crest)[1]).toBeGreaterThan(SPIRIT_HEART[1]);
        // Taken: in her breast, and it fades into her own light.
        for (const t of [HEART_FLIGHT.taken, (HEART_FLIGHT.taken + HEART_FLIGHT.held) / 2, HEART_FLIGHT.held]) {
            const p = at(t);
            const off = Math.hypot(p[0] - SPIRIT_HEART[0], p[1] - SPIRIT_HEART[1], p[2] - SPIRIT_HEART[2]);
            expect(off, `t ${t}`).toBeLessThan(1e-9);
        }
        expect(at(HEART_FLIGHT.taken)[3]).toBeCloseTo(1, 9);
        expect(at(HEART_FLIGHT.held)[3]).toBeCloseTo(0, 9);
        // It writes into what it is given.
        const out = [9, 9, 9, 9];
        expect(story.heartAt(10 + HEART_FLIGHT.crest, out)).toBe(out);
    });

    it('never jumps on its way: a frame moves it only so far, and it only brightens until it is taken', () => {
        const story = quad();
        let last = null;
        let farthest = 0;
        let seen = 0;
        for (let t = HEART_FLIGHT.rise + 1e-6; t <= HEART_FLIGHT.held + 1.5; t += DT) {
            const p = story.heartAt(10 + t, [0, 0, 0, 0]);
            if (!p) continue;
            seen += 1;
            expect(p.every(Number.isFinite)).toBe(true);
            expect(p[3]).toBeGreaterThanOrEqual(0);
            expect(p[3]).toBeLessThanOrEqual(1);
            if (last) {
                farthest = Math.max(farthest, Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]));
                if (t < HEART_FLIGHT.taken) expect(p[3]).toBeGreaterThanOrEqual(last[3] - 1e-12);
                else expect(p[3]).toBeLessThanOrEqual(last[3] + 1e-12);
            }
            last = p;
        }
        expect(seen).toBeGreaterThan((HEART_FLIGHT.held - HEART_FLIGHT.rise) * 60 * 0.9);
        // (Its whole way is some ten metres in a couple of seconds: a quarter metre a frame is a jump.)
        expect(farthest).toBeLessThan(0.25);
        // And where one stretch of the flight hands over to the next, it is where the last one left it.
        for (const t of [HEART_FLIGHT.surface, HEART_FLIGHT.crest, HEART_FLIGHT.taken]) {
            const before = story.heartAt(10 + t - 1e-9, [0, 0, 0, 0]);
            const after = story.heartAt(10 + t + 1e-9, [0, 0, 0, 0]);
            const seam = Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]);
            expect(seam, `at ${t}`).toBeLessThan(1e-6);
        }
    });

    it('flares her as it is taken, and the flare dies away', () => {
        const story = quad();
        expect(story.heartTaken(10 + HEART_FLIGHT.taken - 0.01)).toBe(0);
        expect(story.heartTaken(10 + HEART_FLIGHT.taken)).toBeCloseTo(1, 9);
        let last = 1;
        for (let t = HEART_FLIGHT.taken; t < HEART_FLIGHT.taken + 10; t += 0.1) {
            const k = story.heartTaken(10 + t);
            expect(k).toBeLessThanOrEqual(last);
            expect(k).toBeGreaterThanOrEqual(0);
            last = k;
        }
        expect(last).toBeLessThan(0.01);
    });

    it('raises another heart for more lines, never over one still on its way, and forgets them once held', () => {
        // (It once kept one heart: four lines more while it flew raised none, and four lines more
        // while she held it took it from her breast and her light fell by half in a frame.)
        const story = quad();
        story.onClear({ time: 10 + HEART_FLIGHT.crest, lines: 4 });
        expect(story.hearts.map((h) => h.time)[0]).toBe(10);
        expect(story.hearts).toHaveLength(2);
        // The second waits on the bed until she has taken the first.
        expect(story.heart.time + HEART_FLIGHT.rise).toBeCloseTo(10 + HEART_FLIGHT.taken + HEART_GAP, 9);
        // However many more come, the bed holds a few; the last of them comes up the brighter.
        for (let i = 0; i < 6; i++) story.onClear({ time: 10 + HEART_FLIGHT.crest + 0.1 * (i + 1), lines: 4 });
        expect(story.hearts).toHaveLength(1 + HEART_QUEUE);
        expect(story.heart.gain).toBeGreaterThan(1);
        const again = quad();
        runTo(again, 10 + HEART_FLIGHT.held + 3);
        expect(again.heart).toBeNull();
    });

    it('never puts out the light she holds: a heart that follows adds to it, and she takes every one', () => {
        // Four lines while the first flies, and again while she holds it.
        const story = quad();
        story.onClear({ time: 10 + HEART_FLIGHT.crest, lines: 4 });
        const takenAt = [];
        let lastOrb = null;
        let third = false;
        const flareFloor = Math.exp(-DT / 1.4);
        let previous = story.heartTaken(story.time);
        runTo(story, 10 + 4 * HEART_FLIGHT.held, (time) => {
            if (!third && time >= 10 + HEART_FLIGHT.taken + 1.2) {
                third = true;
                story.onClear({ time, lines: 4 });
            }
            const flare = story.heartTaken(time);
            // Her flare only falls as fast as it fades by itself; a new heart only lifts it.
            expect(flare, `t ${time}`).toBeGreaterThanOrEqual(previous * flareFloor - 1e-9);
            if (flare > previous + 0.3) takenAt.push(time);
            previous = flare;
            const orb = story.heartAt(time, [0, 0, 0, 0]);
            if (orb && lastOrb) {
                const moved = Math.hypot(orb[0] - lastOrb[0], orb[1] - lastOrb[1], orb[2] - lastOrb[2]);
                // Where it hands over from the one in her breast to the next rising from the bed,
                // the one she held has already sunk into her: nothing bright jumps.
                if (moved > 0.25) expect(lastOrb[3], `t ${time}`).toBeLessThan(0.05);
                else expect(orb[3], `t ${time}`).toBeGreaterThan(lastOrb[3] - 0.08);
            }
            lastOrb = orb;
        });
        // She took all three, one after another, and the story has let them go.
        expect(takenAt).toHaveLength(3);
        expect(takenAt[1] - takenAt[0]).toBeGreaterThan(HEART_GAP);
        expect(story.hearts).toHaveLength(0);
        // What she holds of them outlasts every flare.
        expect(story.heartsHeld(story.time)).toBeGreaterThan(0.3);
    });

    it('comes up the brighter for a perfect clear that settles on the lines that raised it', () => {
        const story = quad();
        story.onCrown(10.36);
        expect(story.hearts).toHaveLength(1);
        expect(story.heart.gain).toBeGreaterThan(1);
        // And with no heart on its way, a crown raises one.
        const lone = storyAt(9);
        lone.onCrown(10);
        expect(lone.hearts).toHaveLength(1);
    });

    it('draws the two out to the water in a fever of play, chain or none, and lets them go as it cools', () => {
        const story = storyAt(0);
        story.setFervour(1);
        runTo(story, 1);
        expect(story.bond).toBeCloseTo(FERVOUR_BOND, 9);
        expect(story.spiritWant(1).out).toBeCloseTo(FERVOUR_BOND, 9);
        story.setFervour(0);
        runTo(story, 2);
        expect(story.bond).toBe(0);
    });
});

describe('stillwater story: what he means to do', () => {
    it('sits on his stone only at home, after a calm, and gets up for a chain', () => {
        const story = storyAt(0);
        // A night that has been calm: he sits.
        expect(story.trollWant(0).sit).toBe(true);
        expect(story.trollWant(0).at).toEqual([TROLL.home[0], TROLL.home[2]]);
        // One clear on its own is no chain: he stays on his stone.
        story.onCombo(1, 1);
        story.update(1, DT, where());
        expect(story.bond).toBe(0);
        expect(story.trollWant(1).sit).toBe(true);
        // Two in a row get him up, at home.
        story.onCombo(2, 2);
        story.update(2, DT, where());
        expect(story.trollWant(2).sit).toBe(false);
        expect(story.trollWant(2).at).toEqual([TROLL.home[0], TROLL.home[2]]);
        // Longer chains walk him to the water's edge, then into the shallows; he sits nowhere there.
        const reach = [3, 4, 5, 6].find((n) => trollStation(chainBond(n), 'home') === 'bank');
        const wade = [4, 5, 6, 7, 8].find((n) => trollStation(chainBond(n), 'bank') === 'shallows');
        for (const [combo, spot] of [[reach, TROLL.reach], [wade, TROLL.shallows]]) {
            story.onCombo(combo, story.time + 1);
            runTo(story, story.time + 1 + SIT_AFTER * 2);
            const wanted = story.trollWant(story.time);
            expect(wanted.at, `combo ${combo}`).toEqual([spot[0], spot[2]]);
            expect(wanted.sit, `combo ${combo}`).toBe(false);
        }
        // The chain breaks: once they have parted he is home, and he sits only after a calm.
        const broke = story.time + 1;
        story.onCombo(0, broke);
        let rested = null;
        runTo(story, broke + PARTING + SIT_AFTER + 2, (time) => {
            const wanted = story.trollWant(time);
            if (time < broke + PARTING) expect(wanted.sit).toBe(false);
            if (wanted.sit && rested === null) rested = time;
        });
        expect(rested).not.toBeNull();
        expect(rested).toBeGreaterThanOrEqual(broke + PARTING + SIT_AFTER - 1e-6);
        expect(rested).toBeLessThan(broke + PARTING + SIT_AFTER + 0.1);
        // And nods off after a long calm, seated.
        const calm = story.time;
        runTo(story, calm + DOZE_AFTER + 1);
        expect(story.trollWant(story.time).doze).toBe(true);
    });

    it('lowers his staff to the water and crouches for the heart\'s rise when he is out, and lifts it after', () => {
        const story = storyAt(0);
        story.onCombo(4, 1);
        runTo(story, 6);
        story.onClear({ time: 6, lines: 4 });
        const seen = [];
        runTo(story, 6 + HEART_FLIGHT.taken + 1, (time) => {
            const wanted = story.trollWant(time);
            seen.push([time - 6, wanted.staff, wanted.crouch, wanted.look]);
        });
        const edge = (t) => [HEART_FLIGHT.crest, HEART_FLIGHT.taken + 0.6].some((e) => Math.abs(t - e) < 1e-6);
        for (const [t, staff, crouch, look] of seen) {
            const label = `${t.toFixed(3)} s after the clear`;
            if (edge(t)) continue;
            if (t < HEART_FLIGHT.crest) {
                expect(staff, label).toBe('dip');
                expect(crouch, label).toBe(true);
            } else if (t < HEART_FLIGHT.taken + 0.6) {
                expect(staff, label).toBe('raise');
                expect(crouch, label).toBe(false);
            }
            // While it flies, he watches it.
            if (t > HEART_FLIGHT.rise + 1e-6 && t < HEART_FLIGHT.taken) {
                const h = story.heartAt(t + 6);
                expect(look, label).toEqual([h[0], h[1], h[2]]);
            }
        }
        // At home he does not crouch for it: he lifts the lantern.
        const home = storyAt(0);
        home.onClear({ time: 2, lines: 4 });
        home.update(2 + HEART_FLIGHT.rise, DT, where());
        const wanted = home.trollWant(2 + HEART_FLIGHT.rise);
        expect(wanted.crouch).toBe(false);
        expect(wanted.staff).toBe('raise');
    });

    it('lifts his lantern for light coming home, holds it out in a long chain, carries it high going home', () => {
        const story = storyAt(0);
        runTo(story, 2);
        expect(story.trollWant(2).staff).toBe('walk');
        // Light that will reach his lantern at 4 s: he lifts it a little before, and lowers it after.
        story.onArrival(1, 4);
        // (Her light coming home is hers: it does not lift his lantern.)
        story.onArrival(-1, 2.5);
        runTo(story, 2.5);
        expect(story.trollWant(2.5).staff).toBe('walk');
        const raised = [];
        runTo(story, 6, (time) => {
            if (story.trollWant(time).staff === 'raise') raised.push(time);
        });
        expect(raised.length).toBeGreaterThan(10);
        expect(raised[0]).toBeLessThan(4);
        expect(raised.at(-1)).toBeGreaterThan(4);
        // One lift, over the light's arrival, not two.
        expect(raised.at(-1) - raised[0]).toBeLessThan(raised.length * DT + 1e-6);
        expect(story.trollWant(6).staff).toBe('walk');
        // A long chain: he holds it out to her from the shallows.
        story.onCombo(5, 6);
        runTo(story, 8);
        expect(story.trollWant(8).staff).toBe('offer');
        // While they part, he does not.
        story.onCombo(0, 8);
        runTo(story, 8 + PARTING / 2);
        expect(story.trollWant(story.time).staff).not.toBe('offer');
        // Walking home, away from his stone, he carries it up and goes slower, heavier.
        runTo(story, 8 + PARTING + 0.5);
        const away = where([TROLL.reach[0], TROLL.reach[2]]);
        story.update(story.time + DT, DT, away);
        const going = story.trollWant(story.time);
        expect(going.staff).toBe('high');
        expect(going.heavy).toBe(true);
        story.update(story.time + DT, DT, where());
        const there = story.trollWant(story.time);
        expect(there.heavy).toBe(false);
        expect(going.pace).toBeLessThan(there.pace);
        expect(there.staff).toBe('walk');
    });

    it('faces her and watches what falls on his side, and starts at a hard drop', () => {
        const story = storyAt(0);
        runTo(story, 2);
        const wanted = story.trollWant(2);
        const me = [TROLL.home[0], TROLL.home[2]];
        expect(wanted.face).toBeCloseTo(Math.atan2(SPIRIT_HEART[0] - me[0], SPIRIT_HEART[2] - me[1]), 12);
        story.onLock({
            time: 3, side: 1, at: [4, -6], hardDrop: true,
        });
        story.update(3, DT, where());
        // The moment of the start is handed on, for his body to take once however slow the frames.
        expect(story.trollWant(3).startleAt).toBe(3);
        runTo(story, 3.5);
        expect(story.trollWant(3.5).startleAt).toBe(3);
        expect(story.trollWant(3.5).look).toEqual([4, 0.1, -6]);
        // A soft one on her side turns her, not him.
        story.onLock({ time: 10, side: -1, at: [-4, -6] });
        runTo(story, 10.5);
        expect(story.spiritWant(10.5).look).toEqual([-4, 0.1, -6]);
        expect(story.trollWant(10.5).look).not.toEqual([-4, 0.1, -6]);
    });
});

describe('stillwater story: what she means to do', () => {
    it('kneels at the water only after a calm, and stands for a chain or a heart', () => {
        const story = storyAt(0);
        expect(story.spiritWant(0).kneel).toBe(true);
        story.onCombo(2, 1);
        runTo(story, 3);
        expect(story.spiritWant(3).kneel).toBe(false);
        expect(story.spiritWant(3).out).toBe(chainBond(2));
        story.onCombo(0, 3);
        let knelt = null;
        runTo(story, 3 + PARTING + KNEEL_AFTER + 2, (time) => {
            if (knelt === null && story.spiritWant(time).kneel) knelt = time;
        });
        expect(knelt).not.toBeNull();
        expect(knelt).toBeGreaterThanOrEqual(3 + PARTING + KNEEL_AFTER - 1e-6);
        // Not while a heart is in the story.
        story.onClear({ time: story.time, lines: 4 });
        story.update(story.time + DT, DT, where());
        expect(story.spiritWant(story.time).kneel).toBe(false);
    });

    it('opens her hands for the heart, holds it to her breast, cups them for light, reaches to him in a chain', () => {
        const story = storyAt(0);
        runTo(story, 2);
        expect(story.spiritWant(2).hands).toBe('rest');
        story.onClear({ time: 2, lines: 4 });
        const hands = [];
        runTo(story, 2 + HEART_FLIGHT.held + 0.5, (time) => hands.push([time - 2, story.spiritWant(time).hands]));
        for (const [t, h] of hands) {
            const label = `${t.toFixed(3)} s after the clear`;
            if (t >= HEART_FLIGHT.rise + 1e-9 && t < HEART_FLIGHT.taken - 1e-9) expect(h, label).toBe('open');
            else if (t >= HEART_FLIGHT.taken + 1e-9 && t < HEART_FLIGHT.held - 1e-9) expect(h, label).toBe('heart');
        }
        expect(hands.at(-1)[1]).toBe('rest');
        // Light coming home to her side: she cups her hands for it.
        story.onArrival(-1, 20);
        runTo(story, 19.8);
        expect(story.spiritWant(19.8).hands).toBe('receive');
        runTo(story, 21);
        expect(story.spiritWant(21).hands).toBe('rest');
        // A long chain: she reaches toward his lantern, and watches it.
        story.onCombo(6, 21);
        runTo(story, 23);
        const reaching = story.spiritWant(23);
        expect(reaching.hands).toBe('reach');
        expect(reaching.look).toEqual(LANTERN);
        expect(reaching.gazeDown).toBe(false);
    });

    it('looks back at him over her shoulder on her way home, and then down into the water', () => {
        const story = storyAt(0);
        // (Her wants read every frame, as the world reads them: see the pin below.)
        const read = (time) => story.spiritWant(time);
        story.onCombo(3, 1);
        runTo(story, 5, read);
        story.onCombo(0, 5);
        runTo(story, 5 + PARTING + 1, read);
        const going = story.spiritWant(story.time);
        expect(going.back).toBe(true);
        expect(going.look).toEqual(LANTERN);
        runTo(story, 5 + PARTING + 30, read);
        const settled = [];
        runTo(story, 5 + PARTING + 60, (time) => settled.push(story.spiritWant(time)));
        expect(settled.every((w) => !w.back)).toBe(true);
        // At rest she looks down into the water, but for a glance across now and then.
        expect(settled.some((w) => w.gazeDown && w.look === null)).toBe(true);
        expect(settled.some((w) => w.look === LANTERN)).toBe(true);
    });

    // What she wants is a function of the clock and the events told, however often it is read: the
    // update keeps when a chain last held her (found pinned: reading her wants once wrote it).
    it('knows she is going home from a chain whether or not her wants were read while it held', () => {
        const story = storyAt(0);
        story.onCombo(3, 1);
        runTo(story, 5);
        story.onCombo(0, 5);
        runTo(story, 5 + PARTING + 1);
        expect(story.spiritWant(story.time).back).toBe(true);
    });
});

describe('stillwater story: a replay', () => {
    /** A night of events, told at fixed times, every want read every frame. */
    function tellNight() {
        const story = storyAt(0);
        const events = [
            [1, (s) => s.onLock({ time: 1, side: -1, at: [-4, -5] })],
            [2, (s) => s.onLock({
                time: 2, side: 1, at: [4, -7], hardDrop: true,
            })],
            [2.5, (s) => s.onClear({ time: 2.5, lines: 1 })],
            [2.5, (s) => s.onCombo(1, 2.5)],
            [4, (s) => s.onCombo(2, 4)],
            [5, (s) => s.onArrival(1, 6)],
            [6, (s) => s.onCombo(4, 6)],
            [7, (s) => s.onClear({ time: 7, lines: 4 })],
            [9, (s) => s.onLevel(9)],
            [14, (s) => s.onCombo(0, 14)],
            [25, (s) => s.onEnd(25)],
        ];
        const frames = [];
        let next = 0;
        let time = 0;
        while (time < 45) {
            time += DT;
            while (next < events.length && events[next][0] <= time) events[next++][1](story);
            const troll = time > 6 && time < 20 ? [TROLL.reach[0], TROLL.reach[2]] : [TROLL.home[0], TROLL.home[2]];
            story.update(time, DT, where(troll));
            frames.push(JSON.stringify({
                troll: story.trollWant(time),
                spirit: story.spiritWant(time),
                heart: story.heartAt(time),
                bond: story.bond,
                path: story.path,
                gaze: story.gaze,
            }));
        }
        return frames;
    }

    it('tells the same story for the same events at the same times, frame for frame', () => {
        const first = tellNight();
        const second = tellNight();
        expect(second).toHaveLength(first.length);
        const differ = first.filter((frame, i) => frame !== second[i]).length;
        expect(differ).toBe(0);
        // (A story with something in it: they went out, the heart rose, they came home.)
        const read = first.map((f) => JSON.parse(f));
        expect(read.some((f) => f.troll.staff === 'dip')).toBe(true);
        expect(read.some((f) => f.spirit.hands === 'heart')).toBe(true);
        expect(read.at(-1).bond).toBe(0);
    });

    it('puts her path from her stone out over the water, all of it finite, and nowhere beyond its ends', () => {
        expect(spiritPathPoint(0)).toEqual([...SPIRIT.home]);
        const end = spiritPathPoint(1);
        expect(end[0]).toBe(SPIRIT.reach[0]);
        expect(end[2]).toBe(SPIRIT.reach[2]);
        expect(end[1]).toBeGreaterThanOrEqual(0);
        expect(end[1]).toBeLessThan(SPIRIT.home[1]);
        expect(spiritPathPoint(-3)).toEqual(spiritPathPoint(0));
        expect(spiritPathPoint(7)).toEqual(spiritPathPoint(1));
        let last = spiritPathPoint(0);
        for (let s = 0.01; s <= 1; s += 0.01) {
            const p = spiritPathPoint(s);
            expect(p.every(Number.isFinite)).toBe(true);
            // Out toward the board, and down off her stone onto the water, never back up.
            expect(p[0]).toBeGreaterThan(last[0]);
            expect(p[1]).toBeLessThanOrEqual(last[1] + 1e-12);
            last = p;
        }
        const out = [0, 0, 0];
        expect(spiritPathPoint(0.5, out)).toBe(out);
    });
});
