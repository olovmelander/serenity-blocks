/**
 * Sunbraid — the braid (three-free): where the three suns stand, as a pure function of the clock
 * and of what gameplay has done to them.
 *
 * The answers are still being tuned, so they are held as relations to the module's own constants
 * (BRAID_RATE, BRAID_EVENTS), never as numbers: the calm turn, the nudges (a lock's tick, a
 * T-spin's twist, a level's wind) that add exactly their step and never turn the suns back, the
 * chain that turns them faster and opens them, the breath and the conjunction that draw them
 * together, the dusk, and the determinism a capture's seek relies on.
 */
import { describe, expect, it } from 'vitest';
import {
    BRAID_EVENTS, Braid, conjunctionSpread, conjunctionWhite,
} from '../../src/themes/sunbraid/sunbraid-braid.js';
import { BRAID_RATE, TAU, sunVector } from '../../src/themes/sunbraid/sunbraid-core.js';

const DT = 1 / 60;
const P0 = -1.7;

/** A calm braid at clock `t0` and phase `phase0`. */
function braidAt(t0 = 0, phase0 = P0) {
    const braid = new Braid();
    braid.reset(t0, phase0);
    return braid;
}

/** Step a braid from its clock to `to` in fixed frames of dt (as the world's frames do). */
function stepTo(braid, to, dt = DT) {
    const from = braid.time;
    const steps = Math.max(1, Math.round((to - from) / dt));
    const h = (to - from) / steps;
    for (let i = 1; i <= steps; i++) braid.step(from + i * h, h);
    return braid;
}

/** What the suns show at the braid's clock. */
const look = (braid) => ({
    phase: braid.phaseNow(), spread: braid.spreadNow(), white: braid.whiteNow(), dusk: braid.duskLevel(),
});

/** The rate the phase turns at now, measured over one short frame on a copy (no tween in flight). */
function rateOf(braid) {
    const copy = new Braid();
    copy.importState(structuredClone(braid.exportState()));
    copy.time = braid.time;
    for (const tw of copy.tweens) tw.live = false;
    const before = copy.phaseNow();
    copy.step(copy.time + 1e-3, 1e-3);
    return (copy.phaseNow() - before) / 1e-3;
}

describe('Sunbraid braid: the calm turn', () => {
    it('turns the phase at BRAID_RATE per second of clock, the suns gathered and coloured, no dusk', () => {
        const braid = braidAt(0, P0);
        expect(braid.phaseNow()).toBe(P0);
        stepTo(braid, 10);
        expect(braid.phaseNow()).toBeCloseTo(P0 + BRAID_RATE * 10, 9);
        expect(look(braid)).toMatchObject({ spread: 1, white: 0, dusk: 0 });
        // Whatever the frame length: the phase integrates the rate, frames of 1/15 s land where 1/144 s do.
        const coarse = stepTo(braidAt(0, P0), 10, 1 / 15);
        const fine = stepTo(braidAt(0, P0), 10, 1 / 144);
        expect(coarse.phaseNow()).toBeCloseTo(fine.phaseNow(), 9);
        // A reset at a later clock stands where the calm turn would have brought it.
        expect(braidAt(10, P0).phaseNow()).toBeCloseTo(P0 + BRAID_RATE * 10, 12);
        expect(rateOf(braid)).toBeCloseTo(BRAID_RATE, 9);
    });

    it('never moves on a frame of no time, or of negative time', () => {
        const braid = stepTo(braidAt(0, P0), 2);
        const { phase } = look(braid);
        braid.step(2, 0);
        braid.step(2, -0.5);
        expect(braid.phaseNow()).toBe(phase);
    });

    it('keeps the integrated phase small without the suns moving: the wrap is whole turns', () => {
        const braid = braidAt(0, 0);
        braid.phase = TAU * 1024 - 1e-3;
        const before = braid.phaseNow();
        braid.step(1, 1);
        const after = braid.phaseNow();
        expect(after).toBeLessThan(TAU); // wrapped
        expect(after + TAU * 1024 - before).toBeCloseTo(BRAID_RATE, 6);
        for (let k = 0; k < 3; k++) {
            const unwrapped = sunVector(before + BRAID_RATE, k, 1);
            sunVector(after, k, 1).forEach((v, i) => expect(v).toBeCloseTo(unwrapped[i], 6));
        }
    });
});

describe('Sunbraid braid: nudges (a lock, a T-spin, a level)', () => {
    /** The phase a nudged braid gains over a calm twin, sampled each frame until `until`. */
    function gainOf(nudge, until, t0 = 3) {
        const calm = stepTo(braidAt(0, P0), t0);
        const nudged = stepTo(braidAt(0, P0), t0);
        nudge(nudged, t0);
        const gains = [];
        const steps = Math.round((until - t0) / DT);
        for (let i = 1; i <= steps; i++) {
            const t = t0 + i * DT;
            calm.step(t, DT);
            nudged.step(t, DT);
            gains.push(nudged.phaseNow() - calm.phaseNow());
        }
        return gains;
    }
    const nondecreasing = (values) => values.every((v, i) => i === 0 || v >= values[i - 1] - 1e-12);

    const { tick, twist, level } = BRAID_EVENTS;
    const cases = [
        ['a lock tick', (b, t) => b.tick(false, t), tick.step, tick.ease],
        ['a hard-drop tick', (b, t) => b.tick(true, t), tick.hardStep, tick.ease],
        ['a T-spin twist', (b, t) => b.twist(1, t), twist.step, twist.ease],
        ['a T-spin double (two twists)', (b, t) => b.twist(2, t), 2 * twist.step, twist.gap + twist.ease],
        ['a T-spin triple (three twists)', (b, t) => b.twist(3, t), 3 * twist.step, 2 * twist.gap + twist.ease],
        ['a level wind', (b, t) => b.levelUp(1, t), level.step, level.ease],
        ['two levels at once', (b, t) => b.levelUp(2, t), 2 * level.step, level.ease],
    ];

    it.each(cases)('%s adds exactly its step once eased, never turning the suns back', (_, nudge, step, ease) => {
        const gains = gainOf(nudge, 3 + ease + 0.5);
        expect(gains[gains.length - 1]).toBeCloseTo(step, 9);
        expect(nondecreasing(gains)).toBe(true);
        expect(Math.min(...gains)).toBeGreaterThanOrEqual(-1e-12);
        expect(Math.max(...gains)).toBeLessThanOrEqual(step + 1e-9);
        // Eased in, not snapped: a frame in, it has given only a little of its step.
        expect(gains[0]).toBeLessThan(step * 0.25);
    });

    it('steps a hard drop further than a lock, a level further than a lock, a twist a third of a turn', () => {
        expect(tick.hardStep).toBeGreaterThan(tick.step);
        expect(level.step).toBeGreaterThan(tick.hardStep);
        expect(twist.step).toBeCloseTo(TAU / 3, 12);
    });

    it('winds nothing for a level-up of no levels; reads a twist of nonsense as one to three thirds', () => {
        expect(gainOf((b, t) => b.levelUp(0, t), 3 + level.ease + 0.5).every((g) => Math.abs(g) < 1e-12)).toBe(true);
        expect(gainOf((b, t) => b.levelUp(-2, t), 3 + level.ease + 0.5).every((g) => Math.abs(g) < 1e-12)).toBe(true);
        const nonsense = gainOf((b, t) => b.twist(0, t), 3 + twist.ease + 0.5);
        expect(nonsense[nonsense.length - 1]).toBeCloseTo(twist.step, 9);
        const many = gainOf((b, t) => b.twist(9, t), 3 + 2 * twist.gap + twist.ease + 0.5);
        expect(many[many.length - 1]).toBeCloseTo(3 * twist.step, 9);
    });

    it('composes nudges additively, overlapping or not', () => {
        const script = (b) => {
            b.tick(false, 3);
            b.tick(true, 3.1);
            b.twist(2, 3.2);
            b.levelUp(1, 3.3);
            b.tick(false, 4.0);
        };
        const gains = gainOf(script, 3 + 1 + level.ease + 1);
        const total = tick.step * 2 + tick.hardStep + 2 * twist.step + level.step;
        expect(gains[gains.length - 1]).toBeCloseTo(total, 9);
        expect(nondecreasing(gains)).toBe(true);
    });

    it('folds more nudges than it has tween slots into its base without losing any phase', () => {
        const n = 80; // well past the slots it keeps
        const gains = gainOf((b, t) => {
            for (let i = 0; i < n; i++) b.tick(false, t);
        }, 3 + tick.ease + 0.5);
        expect(gains[gains.length - 1]).toBeCloseTo(n * tick.step, 9);
        expect(nondecreasing(gains)).toBe(true);
        // Spread over frames, as a stream of locks would come.
        const calm = stepTo(braidAt(0, P0), 3);
        const busy = stepTo(braidAt(0, P0), 3);
        let last = busy.phaseNow() - calm.phaseNow();
        for (let i = 1; i <= n; i++) {
            const t = 3 + i * 0.01;
            busy.tick(i % 3 === 0, t);
            calm.step(t, 0.01);
            busy.step(t, 0.01);
            const gain = busy.phaseNow() - calm.phaseNow();
            expect(gain).toBeGreaterThanOrEqual(last - 1e-12);
            last = gain;
        }
        stepTo(calm, 3 + n * 0.01 + tick.ease + 0.5);
        stepTo(busy, 3 + n * 0.01 + tick.ease + 0.5);
        const hard = Math.floor(n / 3);
        expect(busy.phaseNow() - calm.phaseNow()).toBeCloseTo((n - hard) * tick.step + hard * tick.hardStep, 9);
        // Ended tweens leave their slots.
        expect(busy.tweens.every((tw) => !tw.live)).toBe(true);
    });
});

describe('Sunbraid braid: a chain', () => {
    const { chain } = BRAID_EVENTS;

    it('turns the suns faster and draws them closer with each step, toward its cap; a break eases both back', () => {
        const braid = stepTo(braidAt(0, P0), 2);
        braid.setCombo(1); // a chain of one is no chain
        stepTo(braid, 6);
        expect(braid.spreadNow()).toBe(1);
        expect(rateOf(braid)).toBeCloseTo(BRAID_RATE, 9);
        braid.setCombo(3);
        stepTo(braid, 6 + 10 * chain.ease);
        const three = { rate: rateOf(braid), spread: braid.spreadNow() };
        expect(three.rate / BRAID_RATE).toBeCloseTo(1 + 2 * chain.rate, 3);
        expect(three.spread).toBeCloseTo(1 - 2 * chain.draw, 3);
        braid.setCombo(6);
        stepTo(braid, braid.time + 10 * chain.ease);
        expect(rateOf(braid)).toBeGreaterThan(three.rate);
        expect(braid.spreadNow()).toBeLessThan(three.spread);
        // Past the knee every step still counts, less and less, and the cap is never passed: a
        // ten-chain reads hotter than a seven-chain, and no chain turns faster than the cap allows.
        const at = (combo) => {
            braid.setCombo(combo);
            stepTo(braid, braid.time + 10 * chain.ease);
            return { rate: rateOf(braid), spread: braid.spreadNow() };
        };
        const knee = at(chain.knee + 1);
        const ten = at(chain.knee + 4);
        const far = at(chain.knee + 60);
        expect(ten.rate).toBeGreaterThan(knee.rate);
        expect(ten.spread).toBeLessThan(knee.spread);
        expect(far.rate).toBeGreaterThan(ten.rate);
        expect(far.rate / BRAID_RATE).toBeLessThanOrEqual(1 + chain.cap * chain.rate + 1e-9);
        expect(far.spread).toBeGreaterThanOrEqual(1 - BRAID_EVENTS.draw.most - 1e-9);
        // The chain breaks: both ease back, never snapping.
        braid.setCombo(0);
        const before = braid.spreadNow();
        braid.step(braid.time + DT, DT);
        expect(braid.spreadNow()).toBeGreaterThan(before);
        expect(braid.spreadNow()).toBeLessThan(before + 0.1);
        stepTo(braid, braid.time + 12 * chain.ease);
        expect(braid.spreadNow()).toBeCloseTo(1, 3);
        expect(rateOf(braid) / BRAID_RATE).toBeCloseTo(1, 3);
    });

    it('winds the phase on continuously through a chain and its break (it integrates the rate)', () => {
        const braid = stepTo(braidAt(0, P0), 1);
        const fastest = BRAID_RATE * (1 + chain.cap * chain.rate);
        let last = braid.phaseNow();
        const script = {
            60: 4, 240: 9, 420: 0, 600: 2,
        };
        const steps = [];
        for (let frame = 1; frame <= 900; frame++) {
            if (script[frame] !== undefined) braid.setCombo(script[frame]);
            braid.step(1 + frame * DT, DT);
            const phase = braid.phaseNow();
            steps.push(phase - last);
            last = phase;
        }
        expect(Math.min(...steps)).toBeGreaterThanOrEqual(BRAID_RATE * DT * (1 - 1e-9));
        expect(Math.max(...steps)).toBeLessThanOrEqual(fastest * DT * (1 + 1e-9));
        expect(Math.max(...steps)).toBeGreaterThan(BRAID_RATE * DT * 2); // the chain did turn it faster
    });

    it('reads a combo of nonsense as no chain', () => {
        const braid = braidAt(0, P0);
        braid.setCombo('many');
        expect(braid.combo).toBe(0);
        braid.setCombo(-4);
        expect(braid.combo).toBe(0);
        braid.setCombo(4.4);
        expect(braid.combo).toBe(4);
    });
});

describe('Sunbraid braid: a clear\'s breath', () => {
    const { breath } = BRAID_EVENTS;

    it.each([1, 2, 3])('draws the suns in for a clear of %i line(s) and lets them go back to 1', (lines) => {
        const braid = stepTo(braidAt(0, P0), 2);
        braid.breathe(lines, 2);
        const samples = [];
        const until = 2 + breath.in + breath.out + 0.2;
        while (braid.time < until - 1e-9) {
            stepTo(braid, braid.time + 0.005, 0.005);
            samples.push([braid.time - 2, braid.spreadNow()]);
        }
        const deepest = Math.min(...samples.map(([, s]) => s));
        expect(deepest).toBeCloseTo(1 - breath.depth[lines], 2);
        samples.forEach(([age, spread]) => {
            expect(spread, `${age.toFixed(3)} s`).toBeLessThanOrEqual(1 + 1e-12);
            expect(spread, `${age.toFixed(3)} s`).toBeGreaterThan(0);
        });
        expect(braid.spreadNow()).toBe(1);
        expect(braid.whiteNow()).toBe(0);
        expect(braid.breaths.every((b) => !b.live)).toBe(true);
    });

    it('breathes deeper for more lines; four lines breathe as three (a conjunction answers four)', () => {
        for (let lines = 2; lines <= 3; lines++) expect(breath.depth[lines]).toBeGreaterThan(breath.depth[lines - 1]);
        breath.depth.slice(1).forEach((d) => {
            expect(d).toBeGreaterThan(0);
            expect(d).toBeLessThan(1);
        });
        const four = braidAt(0, P0);
        four.breathe(4, 0);
        const three = braidAt(0, P0);
        three.breathe(3, 0);
        stepTo(four, breath.in);
        stepTo(three, breath.in);
        expect(four.spreadNow()).toBeCloseTo(three.spreadNow(), 12);
    });

    it('takes breaths in a row, each on its own, the oldest giving way when too many overlap', () => {
        const braid = braidAt(0, P0);
        for (let i = 0; i < 12; i++) braid.breathe(1 + (i % 3), i * 0.05);
        stepTo(braid, 12 * 0.05 + breath.in);
        expect(braid.spreadNow()).toBeGreaterThan(0);
        expect(braid.spreadNow()).toBeLessThan(1);
        stepTo(braid, 12 * 0.05 + breath.in + breath.out + 0.1);
        expect(braid.spreadNow()).toBe(1);
    });
});

describe('Sunbraid braid: four lines, one white sun', () => {
    const c = BRAID_EVENTS.conjunction;
    const holdStart = c.close;
    const partStart = c.close + c.hold;
    const settleStart = partStart + c.part;
    const done = settleStart + c.settle;

    it('closes the spread to nothing and whitens the light through the hold, parts wide, then settles to 1', () => {
        const braid = stepTo(braidAt(0, P0), 5);
        braid.conjoin(5);
        stepTo(braid, 5 + holdStart + c.hold / 2);
        expect(braid.spreadNow()).toBe(0);
        expect(braid.whiteNow()).toBe(1);
        stepTo(braid, 5 + settleStart);
        expect(braid.spreadNow()).toBeGreaterThan(1);
        expect(braid.spreadNow()).toBeCloseTo(c.wide, 6);
        expect(braid.whiteNow()).toBe(0);
        stepTo(braid, 5 + done + 0.1);
        expect(braid.spreadNow()).toBe(1);
        expect(braid.whiteNow()).toBe(0);
    });

    it('reaches every beat continuously, no jump between frames', () => {
        let lastSpread = conjunctionSpread(0);
        let lastWhite = conjunctionWhite(0);
        expect(lastSpread).toBe(1);
        expect(lastWhite).toBe(0);
        let peak = 0;
        let worstSpread = 0;
        let worstWhite = 0;
        for (let i = 1; i <= Math.ceil((done + 0.5) * 1000); i++) {
            const age = i / 1000;
            const spread = conjunctionSpread(age);
            const white = conjunctionWhite(age);
            worstSpread = Math.max(worstSpread, Math.abs(spread - lastSpread));
            worstWhite = Math.max(worstWhite, Math.abs(white - lastWhite));
            expect(spread).toBeGreaterThanOrEqual(0);
            expect(white >= 0 && white <= 1).toBe(true);
            peak = Math.max(peak, spread);
            lastSpread = spread;
            lastWhite = white;
        }
        expect(worstSpread).toBeLessThan(0.02);
        expect(worstWhite).toBeLessThan(0.02);
        expect(peak).toBeCloseTo(c.wide, 6);
        expect(lastSpread).toBe(1);
        expect(lastWhite).toBe(0);
        // Spread 0 and white 1 hold together through the hold.
        for (let age = holdStart + 0.01; age < partStart; age += 0.05) {
            expect(conjunctionSpread(age)).toBe(0);
            expect(conjunctionWhite(age)).toBe(1);
        }
    });

    it('stands still outside a conjunction: before one, or for a nonsense age', () => {
        for (const age of [-1, -1e9, Number.NaN, done + 1, 1e9]) {
            expect(conjunctionSpread(age), String(age)).toBe(1);
            expect(conjunctionWhite(age), String(age)).toBe(0);
        }
        const braid = stepTo(braidAt(0, P0), 3);
        expect(braid.spreadNow()).toBe(1);
        expect(braid.whiteNow()).toBe(0);
    });

    it('closes a chain\'s drawn spread too: the suns still meet in one point', () => {
        const braid = braidAt(0, P0);
        braid.setCombo(6);
        stepTo(braid, 8);
        expect(braid.spreadNow()).toBeLessThan(1);
        braid.conjoin(8);
        stepTo(braid, 8 + holdStart + 0.1);
        expect(braid.spreadNow()).toBe(0);
    });
});

describe('Sunbraid braid: answers build, never restart', () => {
    const c = BRAID_EVENTS.conjunction;

    /** Spread and whiteness every frame from the braid's clock to `until`, with `act(braid, t)` per frame. */
    function track(braid, until, act = () => {}) {
        const out = [];
        while (braid.time < until - 1e-9) {
            const t = braid.time + DT;
            act(braid, t);
            braid.step(t, DT);
            out.push({ t, spread: braid.spreadNow(), white: braid.whiteNow() });
        }
        return out;
    }
    /** The most a frame may move the spread: the widest part at its own pace, never a jump. */
    const PART_STEP = (c.widest * 1.6 * DT) / c.part;
    /** The most a frame may move the whiteness: its fade at its own pace. */
    const WHITE_STEP = (1.6 * DT) / (c.part * 0.8);
    const worstJump = (frames, key) => frames.reduce(
        (worst, f, i) => (i ? Math.max(worst, Math.abs(f[key] - frames[i - 1][key])) : 0),
        0,
    );

    it('holds the one white sun when four lines land again while the suns are joined, and parts them wider', () => {
        const braid = stepTo(braidAt(0, P0), 2);
        braid.conjoin(2);
        const second = 2 + c.close + c.hold * 0.6;
        let fed = false;
        const frames = track(braid, 2 + 3 * c.close + 2 * c.hold + c.part + c.settle + 1, (b, t) => {
            if (!fed && t >= second) {
                b.conjoin(t);
                fed = true;
            }
        });
        // Never split back into three coloured suns: from the join on, one white sun until a full
        // hold after the second four lines.
        frames.filter((f) => f.t >= 2 + c.close && f.t < second + c.hold).forEach((f) => {
            expect(f.white, `${f.t.toFixed(3)} s`).toBe(1);
            expect(f.spread, `${f.t.toFixed(3)} s`).toBe(0);
        });
        expect(worstJump(frames, 'spread')).toBeLessThan(PART_STEP);
        expect(worstJump(frames, 'white')).toBeLessThan(WHITE_STEP);
        // The second parts them wider than one alone would, then they settle.
        const widest = Math.max(...frames.map((f) => f.spread));
        expect(widest).toBeGreaterThan(c.wide + c.wideStep * 0.9);
        expect(widest).toBeLessThanOrEqual(c.widest + 1e-9);
        expect(frames[frames.length - 1].spread).toBe(1);
    });

    it('draws the suns back in from where they stand when four lines land while they part', () => {
        for (const late of [c.close + c.hold + c.part * 0.5, c.close + c.hold + c.part + c.settle * 0.4]) {
            const braid = stepTo(braidAt(0, P0), 2);
            braid.conjoin(2);
            let fed = false;
            const frames = track(braid, 2 + late + c.close + c.hold + c.part + c.settle + 1, (b, t) => {
                if (!fed && t >= 2 + late) {
                    b.conjoin(t);
                    fed = true;
                }
            });
            expect(worstJump(frames, 'spread'), `at ${late}`).toBeLessThan(PART_STEP);
            expect(worstJump(frames, 'white'), `at ${late}`).toBeLessThan(WHITE_STEP);
            // And they do meet again.
            expect(frames.some((f) => f.t > 2 + late && f.white === 1 && f.spread === 0)).toBe(true);
        }
    });

    it('crowns a joined sun with a longer hold, and lifts the suns from wherever an earlier crown has them', () => {
        const braid = stepTo(braidAt(0, P0), 2);
        braid.conjoin(2);
        braid.crown(2 + 0.36);
        stepTo(braid, 2 + c.close + c.hold + c.crown * 0.5);
        expect(braid.whiteNow()).toBe(1); // still joined past a plain hold
        const { noon } = BRAID_EVENTS;
        // A second perfect clear while the first's climb is under way: no drop, a climb on.
        let last = braid.liftNow();
        stepTo(braid, braid.time + 0.5);
        braid.crown(braid.time);
        for (let i = 0; i < 300; i++) {
            braid.step(braid.time + DT, DT);
            const lift = braid.liftNow();
            expect(lift).toBeGreaterThanOrEqual(last - 1e-9);
            expect(lift).toBeLessThanOrEqual(noon.lift + 1e-12);
            last = lift;
        }
    });

    it('lets a weak breath never cut a strong one: the slot that gives way is the one with least to give', () => {
        const braid = braidAt(0, P0);
        braid.breathe(3, 0); // a deep one, just drawn in
        for (let i = 1; i <= 8; i++) braid.breathe(1, 0.01 * i);
        stepTo(braid, BRAID_EVENTS.breath.in);
        // The triple's breath is still there: deeper than any number of singles alone would make it.
        const singles = braidAt(0, P0);
        for (let i = 1; i <= 8; i++) singles.breathe(1, 0.01 * i);
        stepTo(singles, BRAID_EVENTS.breath.in);
        expect(braid.spreadNow()).toBeLessThan(singles.spreadNow());
    });

    it('turns no faster and draws no closer than the chain and the heat allow; the conjunction frees the draw', () => {
        const braid = stepTo(braidAt(0, P0), 1);
        braid.setCombo(40);
        braid.pull = 5;
        stepTo(braid, 1 + 12 * BRAID_EVENTS.chain.ease);
        expect(braid.spreadNow()).toBeCloseTo(1 - BRAID_EVENTS.draw.most, 3);
        // The suns part wide: the draw is let go and they open past rest.
        braid.conjoin(braid.time);
        const t0 = braid.time;
        stepTo(braid, t0 + c.close + c.hold + c.part);
        expect(braid.spreadNow()).toBeCloseTo(c.wide, 6);
        stepTo(braid, t0 + c.close + c.hold + c.part + c.settle + 0.5);
        expect(braid.spreadNow()).toBeCloseTo(1 - BRAID_EVENTS.draw.most, 3);
    });
});

describe('Sunbraid braid: dusk', () => {
    const { dusk } = BRAID_EVENTS;

    it('sets the suns over its time at game over and raises them on a new session, never jumping', () => {
        const braid = stepTo(braidAt(0, P0), 4);
        expect(braid.duskLevel()).toBe(0);
        braid.setDusk(true, 4);
        expect(braid.duskLevel()).toBe(0);
        let last = 0;
        while (braid.time < 4 + dusk.set - 1e-9) {
            stepTo(braid, braid.time + 0.1);
            const level = braid.duskLevel();
            expect(level).toBeGreaterThanOrEqual(last);
            expect(level - last).toBeLessThan(0.1);
            last = level;
        }
        expect(braid.duskLevel()).toBeCloseTo(1, 9);
        stepTo(braid, braid.time + 2);
        expect(braid.duskLevel()).toBe(1);
        const at = braid.time;
        braid.setDusk(false, at);
        expect(braid.duskLevel()).toBe(1);
        stepTo(braid, at + dusk.rise / 2);
        expect(braid.duskLevel()).toBeGreaterThan(0);
        expect(braid.duskLevel()).toBeLessThan(1);
        stepTo(braid, at + dusk.rise);
        expect(braid.duskLevel()).toBeCloseTo(0, 9);
        stepTo(braid, at + dusk.rise + 1);
        expect(braid.duskLevel()).toBe(0);
    });

    it('turns back from wherever it is when a new session starts mid-dusk', () => {
        const braid = stepTo(braidAt(0, P0), 1);
        braid.setDusk(true, 1);
        stepTo(braid, 1 + dusk.set / 2);
        const mid = braid.duskLevel();
        expect(mid > 0.2 && mid < 0.8).toBe(true);
        braid.setDusk(false, braid.time);
        expect(braid.duskLevel()).toBeCloseTo(mid, 12);
        stepTo(braid, braid.time + DT);
        expect(braid.duskLevel()).toBeLessThan(mid);
        expect(braid.duskLevel()).toBeGreaterThan(mid - 0.05);
    });

    it('does not touch the turn of the suns: dusk is height, not phase', () => {
        const dusky = stepTo(braidAt(0, P0), 2);
        const calm = stepTo(braidAt(0, P0), 2);
        dusky.setDusk(true, 2);
        stepTo(dusky, 10);
        stepTo(calm, 10);
        expect(dusky.phaseNow()).toBeCloseTo(calm.phaseNow(), 12);
        expect(dusky.spreadNow()).toBe(calm.spreadNow());
    });
});

describe('Sunbraid braid: determinism and snapshots', () => {
    /** A session with something of everything in it, from clock t0. */
    function play(braid, t0) {
        stepTo(braid, t0 + 0.5);
        braid.tick(false, braid.time);
        braid.breathe(2, braid.time);
        stepTo(braid, t0 + 1.2);
        braid.setCombo(3);
        braid.tick(true, braid.time);
        braid.twist(2, braid.time);
        stepTo(braid, t0 + 2.4);
        braid.levelUp(1, braid.time);
        braid.conjoin(braid.time);
        stepTo(braid, t0 + 3.1);
        braid.setCombo(0);
        braid.setDusk(true, braid.time);
        stepTo(braid, t0 + 4.0);
        return braid;
    }
    const full = (braid) => ({ ...structuredClone(braid.exportState()), ...look(braid), time: braid.time });

    it('resets to the calm braid at any clock, whatever was in flight', () => {
        const braid = play(braidAt(0, P0), 0);
        braid.reset(7, 0.25);
        expect(look(braid)).toEqual({
            phase: 0.25 + BRAID_RATE * 7, spread: 1, white: 0, dusk: 0,
        });
        expect(braid).toMatchObject({
            time: 7, combo: 0, chainRate: 0, chainDraw: 0, base: 0, pull: 0,
        });
        expect(braid.tweens.every((tw) => !tw.live)).toBe(true);
        expect(braid.breaths.every((b) => !b.live)).toBe(true);
    });

    it('replays a seek and the same frames to the same state, used or fresh', () => {
        const fresh = play(braidAt(10, P0), 10);
        const used = play(braidAt(0, 0.4), 0);
        used.reset(10, P0); // a capture seeks a braid that had played on
        play(used, 10);
        expect(full(used)).toEqual(full(fresh));
        // And again: the same seek, the same frames, the same suns.
        used.reset(10, P0);
        play(used, 10);
        expect(full(used)).toEqual(full(fresh));
    });

    it('round-trips its turn, its chain and its dusk through export and import', () => {
        const source = play(braidAt(0, P0), 0);
        const snapshot = structuredClone(source.exportState());
        expect(snapshot).toEqual(source.exportState());
        const copy = new Braid();
        copy.importState(snapshot);
        copy.time = source.time; // the world hands the braid its clock after an import
        expect(structuredClone(copy.exportState())).toEqual(snapshot);
        expect(copy.phaseNow()).toBe(source.phaseNow());
        expect(copy.duskLevel()).toBe(source.duskLevel());
        // The two go on together: the tweens in flight, the chain easing back, the dusk falling.
        for (let i = 0; i < 6; i++) {
            stepTo(source, source.time + 0.75);
            stepTo(copy, copy.time + 0.75);
            expect(copy.phaseNow()).toBeCloseTo(source.phaseNow(), 12);
            expect(copy.duskLevel()).toBeCloseTo(source.duskLevel(), 12);
            expect(rateOf(copy)).toBeCloseTo(rateOf(source), 12);
        }
        // Nothing, or a snapshot of nothing, changes nothing.
        const before = structuredClone(copy.exportState());
        copy.importState(null);
        copy.importState(undefined);
        expect(structuredClone(copy.exportState())).toEqual(before);
    });

    it('allocates no tween or breath slots as it plays', () => {
        const braid = new Braid();
        const { tweens, breaths } = braid;
        const counts = [tweens.length, breaths.length];
        play(braid, 0);
        for (let i = 0; i < 100; i++) braid.tick(false, braid.time);
        stepTo(braid, braid.time + 2);
        expect(braid.tweens).toBe(tweens);
        expect(braid.breaths).toBe(breaths);
        expect([braid.tweens.length, braid.breaths.length]).toEqual(counts);
    });
});
