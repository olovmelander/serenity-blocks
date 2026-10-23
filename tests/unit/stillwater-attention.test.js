/**
 * Stillwater — where each of the two looks, and for how long (stillwater-attention.js).
 *
 * A look is chosen among what there is to look at, held a while, and let go only for something
 * clearly worth more (or, held long enough, for anything better); a run of lights falling on one
 * side is watched as one place that moves smoothly. What is pinned is that behaviour (a look is
 * not dropped before its dwell, an urgent thing takes it at once, the watched place never jumps),
 * with every number read from the module's exports.
 */
import { describe, expect, it } from 'vitest';
import { ATTENTION, Area, Attention } from '../../src/themes/stillwater/stillwater-attention.js';
import { followTo, follower } from '../../src/themes/stillwater/stillwater-motion.js';

const it3 = (key, weight, at = [0, 0, 0]) => ({ key, weight, at });

describe('stillwater attention: holding a look', () => {
    it('takes the weightiest thing at once when it holds nothing, and nothing when nothing weighs', () => {
        const a = new Attention(ATTENTION.troll);
        expect(a.choose(0, [it3('water', 0.3), it3('partner', 0.6)]).key).toBe('partner');
        const b = new Attention(ATTENTION.troll);
        expect(b.choose(0, [it3('water', 0), it3('partner', -1)])).toBeNull();
    });

    it('holds a look for its dwell against anything merely better, then lets it go', () => {
        const { dwell, margin, urgent } = ATTENTION.troll;
        const a = new Attention(ATTENTION.troll);
        a.choose(0, [it3('water', 0.3)]);
        // Better by more than what holding is worth, but not by an urgent margin.
        const better = 0.3 + margin + (urgent - margin) / 2;
        const offer = [it3('water', 0.3), it3('area', better)];
        for (let t = 0.05; t < dwell - 1e-6; t += 0.05) expect(a.choose(t, offer).key).toBe('water');
        expect(a.choose(dwell + 0.01, offer).key).toBe('area');
    });

    it('lets something urgent take the look at once', () => {
        const { urgent } = ATTENTION.spirit;
        const a = new Attention(ATTENTION.spirit);
        a.choose(0, [it3('partner', 0.62)]);
        expect(a.choose(0.1, [it3('partner', 0.62), it3('heart', 0.62 + urgent)]).key).toBe('heart');
    });

    it('never trades a look for one barely better, however long it has held it', () => {
        const { margin } = ATTENTION.troll;
        const a = new Attention(ATTENTION.troll);
        a.choose(0, [it3('water', 0.4)]);
        expect(a.choose(30, [it3('water', 0.4), it3('area', 0.4 + margin * 0.5)]).key).toBe('water');
    });

    it('keeps its eyes where a thing was that went before the dwell was up, then takes the best left', () => {
        const { dwell } = ATTENTION.troll;
        const a = new Attention(ATTENTION.troll);
        a.choose(0, [it3('lock1', 0.9, [4, 0.1, -6])]);
        const left = [it3('water', 0.3), it3('partner', 0.5)];
        const still = a.choose(0.2, left);
        expect(still.key).toBe('lock1');
        expect(still.at).toEqual([4, 0.1, -6]);
        expect(a.choose(dwell + 0.01, left).key).toBe('partner');
    });

    it('in a quick run of offers turns no oftener than its dwell allows', () => {
        // Every 0.4 s something new, each a little more than the last: a look is taken at most once a dwell.
        const { dwell } = ATTENTION.troll;
        const a = new Attention(ATTENTION.troll);
        a.choose(0, [it3('water', 0.3)]);
        let t = 0;
        for (let n = 1; n <= 150; n++) {
            t = n * 0.4;
            a.choose(t, [it3('water', 0.3), it3(`lock${n}`, 0.6)]);
        }
        expect(a.switches).toBeLessThanOrEqual(Math.ceil(t / dwell) + 1);
    });
});

describe('stillwater attention: the place a run of lights is falling', () => {
    it('starts where the first falls, draws a share of the way to each next, and is followed without a jump', () => {
        const area = new Area();
        area.add([0, 0, 0]);
        expect(area.at).toEqual([0, 0, 0]);
        area.add([10, 0, 0]);
        expect(area.target[0]).toBeGreaterThan(0);
        expect(area.target[0]).toBeLessThan(10);
        let last = area.at[0];
        let biggest = 0;
        for (let i = 0; i < 600; i++) {
            area.step(1 / 60);
            biggest = Math.max(biggest, Math.abs(area.at[0] - last));
            last = area.at[0];
        }
        expect(area.at[0]).toBeCloseTo(area.target[0], 2);
        // (Spread over seconds, not taken in a frame.)
        expect(biggest).toBeLessThan(area.target[0] * 0.05);
    });

    it('has nothing to show before a light has fallen, and forgets on a reset', () => {
        const area = new Area();
        expect(area.step(1 / 60)).toBeNull();
        area.add([1, 2, 3]);
        area.reset();
        expect(area.at).toBeNull();
    });
});

describe('stillwater motion: a head\'s turn', () => {
    it('starts from rest and settles without a jolt, never faster than its cap', () => {
        const s = follower(0);
        const cap = 1.2;
        let last = 0;
        let lastV = 0;
        let maxSpeed = 0;
        let maxAccel = 0;
        const dt = 1 / 60;
        for (let i = 0; i < 300; i++) {
            followTo(s, 1.5, 0.2, dt, cap);
            const v = (s.x - last) / dt;
            maxSpeed = Math.max(maxSpeed, Math.abs(v));
            if (i > 0) maxAccel = Math.max(maxAccel, Math.abs(v - lastV) / dt);
            last = s.x;
            lastV = v;
        }
        expect(s.x).toBeCloseTo(1.5, 3);
        expect(maxSpeed).toBeLessThanOrEqual(cap + 1e-9);
        // (The first frame of a turn moves it only a hair: the lead must get going first.)
        const fresh = follower(0);
        followTo(fresh, 1.5, 0.2, dt, cap);
        expect(fresh.x).toBeLessThan(0.01);
        expect(Number.isFinite(maxAccel)).toBe(true);
    });

    it('does nothing in a frame of no time', () => {
        const s = follower(0.3);
        followTo(s, 2, 0.2, 0, 1);
        expect(s.x).toBe(0.3);
    });
});
