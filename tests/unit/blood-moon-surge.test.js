import { describe, expect, it } from 'vitest';
import { BloodMoonReactions, WAVE_FRONTS } from '../../src/playground/effects/blood-moon-state.js';
import { DIAMOND_REACH, sampleEclipse } from '../../src/playground/effects/blood-moon-eclipse.js';
import { BloodMoonRipples, rippleCue } from '../../src/playground/effects/blood-moon-ripples.js';
import { BloodMoonMeteors } from '../../src/playground/effects/blood-moon-meteors.js';

const FRAME = 1 / 60;

/** Run the reactions for `seconds` at 60 fps. */
function run(state, seconds) {
    for (let t = 0; t < seconds - 1e-9; t += FRAME) state.update(FRAME);
}

/** One clearing lock of a chain, as the theme sends it (its ComboTracker counted `combo`). */
function clearingLock(state, combo, lines = 1) {
    state.noteLock();
    state.cue('hardDrop');
    state.cue('lock');
    state.setCombo(combo);
    state.cue(lines >= 4 ? 'tetris' : 'clear', { lineCount: lines });
}

const live = (state) => state.waves.filter((front) => front.age !== Infinity);

describe('Blood Moon builds with play', () => {
    it('never lets a weak answer right after a strong one cut the light', () => {
        const quad = new BloodMoonReactions();
        const both = new BloodMoonReactions();
        for (const state of [quad, both]) {
            state.cue('tetris', { lineCount: 4 });
            run(state, 0.2);
        }
        const front = both.waves[both._newestFront];
        const before = { age: front.age, strength: front.strength };
        both.cue('clear', { lineCount: 1 });
        for (const key of ['pulse', 'corona', 'starBoost', 'impact']) {
            expect(both[key], key).toBeGreaterThanOrEqual(quad[key]);
        }
        // The quad's front keeps racing out at full strength; the single takes a front of its own.
        expect(front.age).toBe(before.age);
        expect(front.strength).toBe(before.strength);
        expect(live(both)).toHaveLength(2);
        run(quad, 0.3);
        run(both, 0.3);
        for (const key of ['pulse', 'corona', 'starBoost']) expect(both[key], key).toBeGreaterThan(quad[key]);
    });

    it('sends a cascade out as concentric fronts, each wave faster and wider than the last', () => {
        const state = new BloodMoonReactions();
        state.cue('clear', { lineCount: 2 });
        run(state, 0.36);
        for (let depth = 2; depth <= 4; depth++) {
            state.cue('combo', { comboCount: depth });
            state.cue('clear', { lineCount: 1, cascadeCount: depth });
            run(state, 0.36);
        }
        const fronts = live(state).sort((a, b) => b.age - a.age);
        expect(fronts).toHaveLength(WAVE_FRONTS);
        // None restarted: the first is still the oldest, and they are spaced by the waves.
        expect(fronts[0].age).toBeCloseTo(1.44, 1);
        for (let i = 1; i < fronts.length; i++) {
            expect(fronts[i - 1].age - fronts[i].age).toBeCloseTo(0.36, 1);
            expect(fronts[i].speed).toBeGreaterThan(fronts[i - 1].speed);
            expect(fronts[i].width).toBeGreaterThan(fronts[i - 1].width);
        }
    });

    it('reads a long chain hotter than its first clear, then breathes back to calm', () => {
        const state = new BloodMoonReactions();
        clearingLock(state, 1);
        run(state, 0.64);
        const first = { ...state.crescendo, stage: state.heat.stage };
        for (let combo = 2; combo <= 12; combo++) {
            clearingLock(state, combo, combo % 4 === 0 ? 2 : 1);
            run(state, 0.64);
        }
        const peak = { ...state.crescendo, stage: state.heat.stage };
        expect(first.stage).toBe(0);
        expect(peak.stage).toBe(3);
        for (const key of ['corona', 'blood', 'sky', 'water', 'volcano', 'storm']) {
            expect(peak[key], key).toBeGreaterThan(first[key] + 0.4);
        }
        expect(peak.reach).toBeGreaterThan(1.5);
        expect(peak.iris).toBeLessThan(first.iris);
        // The hands rest: everything returns to how the night looks at rest.
        run(state, 16);
        const rest = state.crescendo;
        expect(state.heat.stage).toBe(0);
        for (const key of ['corona', 'blood', 'sky', 'water', 'volcano', 'storm']) {
            expect(rest[key], key).toBeLessThan(0.02);
        }
        expect(rest.reach).toBeLessThan(1.02);
    });

    it('crowns a late perfect clear on the quad still playing: a diamond ring, no restart', () => {
        const state = new BloodMoonReactions();
        clearingLock(state, 5, 4);
        run(state, 0.36);
        const quadFront = state.waves[state._newestFront];
        const { age } = quadFront;
        expect(state.cue('perfectClear', { depth: 4 })).toBeGreaterThan(0);
        expect(quadFront.age).toBe(age);
        expect(live(state)).toHaveLength(2);
        run(state, 0.6);
        expect(state.crescendo.crown).toBeGreaterThan(0.8);
        expect(state.crescendo.diamond).toBeGreaterThan(0.8);
        expect(state.crescendo.corona).toBeGreaterThan(0.25);
        // The diamond ring is a beat: the moon is back in totality within a few seconds.
        run(state, 3.5);
        expect(state.crescendo.diamond).toBeLessThan(0.1);
    });

    it('shows a zero-line T-spin small, and gives back-to-back a twin front and a waking volcano', () => {
        const spin = new BloodMoonReactions();
        expect(spin.cue('tspin', { lineCount: 0 })).toBe(0);
        expect(spin.corona).toBeGreaterThan(0.2);
        expect(live(spin)).toHaveLength(0);
        run(spin, 0.15);
        expect(spin.crescendo.spin).toBeGreaterThan(0.3);

        const b2b = new BloodMoonReactions();
        b2b.cue('tetris', { lineCount: 4 });
        b2b.cue('b2b', { active: true });
        const fronts = live(b2b);
        expect(fronts).toHaveLength(2);
        expect(Math.min(...fronts.map((front) => front.age))).toBeLessThan(0);
        run(b2b, 0.5);
        expect(b2b.crescendo.flare).toBeGreaterThan(0.5);
        expect(b2b.crescendo.volcano).toBeGreaterThan(0.5);
    });

    it('lets a broken chain out in a slow breath instead of snapping it to nothing', () => {
        const state = new BloodMoonReactions();
        for (let combo = 1; combo <= 5; combo++) {
            clearingLock(state, combo);
            run(state, 0.5);
        }
        expect(state.chain).toBeGreaterThan(4.5);
        state.noteLock();
        state.cue('lock');
        run(state, 0.3);
        expect(state.combo).toBe(0);
        expect(state.crescendo.exhale).toBeGreaterThan(0.3);
        // The chain as shown eases out over a second or two.
        expect(state.chain).toBeGreaterThan(3);
        expect(live(state).some((front) => front.width > 2 && front.speed < 0.1)).toBe(true);
        run(state, 4);
        expect(state.chain).toBeLessThan(0.2);
    });
});

describe('Blood Moon pools that never cut a live answer', () => {
    it('gives a full ring pool\'s weakest ring, not its oldest strong one, to a new ring', () => {
        const pool = new BloodMoonRipples(2);
        pool.add(0, 0, 1.4);
        pool.update(1.2);
        pool.add(5, 5, 0.2);
        pool.update(0.2);
        pool.add(9, 9, 1);
        const xs = pool.rows.slice(0, pool.count).map((row) => row.x).sort();
        expect(xs).toEqual([0, 9]);
    });

    it('lands a hard drop and a chain harder on the water', () => {
        expect(rippleCue('lock', {}, { hardDrop: true }).strength).toBeGreaterThan(rippleCue('lock').strength);
        expect(rippleCue('clear', { lineCount: 1 }, { chain: 6 }).strength)
            .toBeGreaterThan(rippleCue('clear', { lineCount: 1 }).strength);
        expect(rippleCue('tspin', { lineCount: 0 }).count).toBe(1);
    });

    it('flares a climbing fireball into a bolide and queues one past its best, never cutting it', () => {
        let seed = 3;
        const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        const meteors = new BloodMoonMeteors();
        meteors.cue(10, 1.2, random);
        const path = meteors.cuePath.a.slice();
        const before = meteors.sample(10.4).glow;
        meteors.cue(10.4, 1.6, random);
        expect(meteors.cuePath.a).toEqual(path);
        expect(meteors.sample(10.6).glow).toBeGreaterThan(before);
        const end = meteors.cued.start + meteors.cued.duration;
        meteors.cue(end - 0.2, 1.2, random);
        expect(meteors.sample(end - 0.1).fireball).toBe(1);
        expect(meteors.cuePath.a).toEqual(path);
        const next = meteors.sample(end + 0.6);
        expect(next.fireball).toBe(1);
        expect(meteors.cuePath.a).not.toEqual(path);
    });

    it('opens a storm only while play is hot, one meteor at a time from the open sky', () => {
        const meteors = new BloodMoonMeteors();
        meteors.avoid = { az: -0.34, el: 0.26, radius: 0.36 };
        let lit = 0;
        let launched = 0;
        for (let t = 0; t < 10; t += FRAME) {
            const count = meteors.stormCount;
            meteors.advanceStorm(t, FRAME, 1.5);
            if (meteors.stormCount > count) launched += 1;
            const m = meteors.sample(t);
            if (meteors.storm && m.glow > 0) {
                lit += 1;
                expect(Math.atan2(m.a[0], -m.a[2])).toBeGreaterThan(0);
            }
        }
        expect(launched).toBeGreaterThan(8);
        expect(lit).toBeGreaterThan(100);
        const calm = new BloodMoonMeteors();
        for (let t = 0; t < 10; t += FRAME) calm.advanceStorm(t, FRAME, 0);
        expect(calm.stormCount).toBe(0);
    });

    it('steps the shadow aside for the diamond ring, never past its reach, and stops the night down', () => {
        const totality = sampleEclipse(3);
        const ring = sampleEclipse(3, {}, 5);
        expect(ring.offset.x).toBeCloseTo(DIAMOND_REACH);
        expect(ring.exposure).toBeLessThan(0.6);
        expect(ring.exposure).toBeGreaterThan(0.3);
        expect(totality.exposure).toBe(1);
        expect(sampleEclipse(3, {}, 0)).toEqual(totality);
        // Where the cycle already shows the sliver, the nudge adds nothing.
        const sliver = sampleEclipse(60);
        expect(sampleEclipse(60, {}, 2).offset.x).toBe(sliver.offset.x);
    });
});
