/**
 * Pyrestorm — the ridge shakes: each cause's size, timing and feel, read without a renderer.
 *
 * Sizes are held in pixels at 1080p (one viewport height = 1080 px), with ranges rather than exact
 * numbers: the noise's luck moves each shake's peak, and the tuning may still move.
 */
import { describe, expect, it } from 'vitest';
import {
    RIDGE, RidgeShake, SHAKE, shakeNoise, thunderLoudness,
} from '../../src/themes/pyrestorm/pyrestorm-shake.js';

const H = 1080;
/** How far the frame has moved, in px at 1080p. */
const px = (o) => Math.hypot(o.x, o.y) * H;
/** Start times spread over the clock, so the noise's luck averages out. */
const STARTS = [10, 23.7, 51.3, 88.1, 130.9, 200.2, 333.3, 471.5, 902.6, 1500.4];

/** The shake every 1/fps s from `from` for `seconds`. */
function trace(shake, from, seconds, fps = 60) {
    const out = [];
    for (let k = 0; k <= Math.round(seconds * fps); k++) {
        const t = from + k / fps;
        out.push({ t, ...shake.sample(t) });
    }
    return out;
}
const peakOf = (tr) => Math.max(...tr.map(px));
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** The median peak (px) of one cause fired at each start, read for `seconds` after it. */
function medianPeak(fire, seconds = 4) {
    return median(STARTS.map((t0) => {
        const shake = new RidgeShake();
        fire(shake, t0);
        return peakOf(trace(shake, t0, seconds));
    }));
}

/** The largest step the frame takes between two frames at 60 fps (px). */
function worstStep(fire, seconds = 4) {
    let worst = 0;
    for (const t0 of STARTS) {
        const shake = new RidgeShake();
        fire(shake, t0);
        const tr = trace(shake, t0, seconds);
        for (let i = 1; i < tr.length; i++) {
            worst = Math.max(worst, Math.hypot(tr[i].x - tr[i - 1].x, tr[i].y - tr[i - 1].y) * H);
        }
    }
    return worst;
}

const CAUSES = {
    'a short hard drop': (s, t) => s.hardDrop(2 / 18, t),
    'a full hard drop': (s, t) => s.hardDrop(1, t),
    'far thunder': (s, t) => s.thunder(14000, 1, t),
    'near thunder': (s, t) => s.thunder(8000, 1, t),
    'the discharge': (s, t) => s.thunder(14400, 1.3, t, { discharge: true }),
    'the blast': (s, t) => s.blast(1, 14400, t),
    'a vortex ring': (s, t) => s.ring(false, t),
    'a perfect clear': (s, t) => s.sheet(t),
    'a level-up': (s, t) => s.surge(t),
};

describe('RidgeShake: at rest', () => {
    it('reads exactly zero at any time when nothing has happened', () => {
        const shake = new RidgeShake();
        for (const t of [0, 0.5, 10, 123.456, 1e4]) expect(shake.sample(t)).toEqual({ x: 0, y: 0, roll: 0 });
    });

    it('settles back to exactly zero after every cause', () => {
        for (const [name, fire] of Object.entries(CAUSES)) {
            const shake = new RidgeShake();
            fire(shake, 10);
            expect(px(shake.sample(10.5)), name).toBeGreaterThan(0);
            expect(shake.sample(40), name).toEqual({ x: 0, y: 0, roll: 0 });
        }
    });

    it('rides on a smooth, zero-mean noise whose typical peak is about one unit', () => {
        let sum = 0;
        let max = 0;
        let jump = 0;
        const n = 200000;
        for (let k = 0; k < n; k++) {
            const x = 5000 + k * 0.0137;
            const v = shakeNoise(x, 7);
            sum += v;
            max = Math.max(max, Math.abs(v));
            jump = Math.max(jump, Math.abs(shakeNoise(x + 1e-4, 7) - v));
        }
        expect(Math.abs(sum / n)).toBeLessThan(0.02);
        expect(max).toBeLessThan(2.4);
        expect(jump).toBeLessThan(0.01); // continuous: no steps
        // Over a short shake (2.7 lattice steps, a tremble's life at 9 Hz) it peaks near one unit.
        const windows = [];
        for (let w = 0; w < 2000; w++) {
            let m = 0;
            for (let k = 0; k < 60; k++) m = Math.max(m, Math.abs(shakeNoise(w * 7.31 + k * 0.045, 7)));
            windows.push(m);
        }
        expect(median(windows)).toBeGreaterThan(0.75);
        expect(median(windows)).toBeLessThan(1.3);
    });
});

describe('RidgeShake: the causes', () => {
    it('stays small: a thud or a clap about a pixel or two, the blast a few', () => {
        const peaks = Object.fromEntries(Object.entries(CAUSES).map(([name, fire]) => [name, medianPeak(fire)]));
        expect(peaks['a short hard drop']).toBeGreaterThan(0.3);
        expect(peaks['a short hard drop']).toBeLessThan(1.2);
        expect(peaks['a full hard drop']).toBeGreaterThan(1);
        expect(peaks['a full hard drop']).toBeLessThan(2.5);
        expect(peaks['near thunder']).toBeGreaterThan(0.8);
        expect(peaks['near thunder']).toBeLessThan(2.5);
        expect(peaks['the blast']).toBeGreaterThan(2);
        expect(peaks['the blast']).toBeLessThan(4.5);
        // The blast is the hardest single hit; the further the piece fell, the harder the thud.
        for (const [name, p] of Object.entries(peaks)) {
            if (name !== 'the blast') expect(p, name).toBeLessThan(peaks['the blast']);
        }
        expect(peaks['a full hard drop']).toBeGreaterThan(peaks['a short hard drop']);
    });

    it('a hard drop is a thud: the world sinks with the slam and springs back in one bounce', () => {
        const shake = new RidgeShake();
        shake.kick(1, 10); // the hard drop's kick alone: up the view (the picture sinks)
        const tr = trace(shake, 10, 1, 1000);
        const top = tr.reduce((m, s) => (s.y > m.y ? s : m), tr[0]);
        // One unit at its first swing (under the soft cap, which bends even a small shake a hair).
        expect(top.y / SHAKE.UNIT).toBeCloseTo(SHAKE.CAP * Math.tanh(1 / SHAKE.CAP), 3);
        expect(top.t - 10).toBeGreaterThan(0.02);
        expect(top.t - 10).toBeLessThan(0.07); // a snap, not a sway
        const back = Math.min(...tr.map((s) => s.y));
        expect(back / SHAKE.UNIT).toBeLessThan(-0.15); // it springs back past rest...
        expect(back / SHAKE.UNIT).toBeGreaterThan(-0.45); // ...once, much smaller
        expect(shake.sample(10.7).y).toBe(0);
    });

    it('thunder cracks once its sound has crossed the plain, louder the nearer the stroke', () => {
        for (const d of [7000, 11000, 15000]) {
            const shake = new RidgeShake();
            shake.thunder(d, 1, 10);
            const heard = 10 + d / SHAKE.SOUND;
            expect(shake.sample(heard - 0.004), `${d} m`).toEqual({ x: 0, y: 0, roll: 0 });
            expect(px(shake.sample(heard + 0.06)), `${d} m`).toBeGreaterThan(0);
        }
        expect(thunderLoudness(SHAKE.FAR + 5000)).toBeCloseTo(0.55, 9);
        expect(thunderLoudness(0)).toBeCloseTo(1.45, 9);
        for (let d = 0; d < 20000; d += 500) expect(thunderLoudness(d + 500)).toBeLessThanOrEqual(thunderLoudness(d));
        expect(medianPeak(CAUSES['near thunder'])).toBeGreaterThan(medianPeak(CAUSES['far thunder']));
        // The discharge from the anvil out-thunders a ground stroke at the same range.
        const ground = medianPeak((s, t) => s.thunder(14400, 1.3, t));
        expect(medianPeak(CAUSES['the discharge'])).toBeGreaterThan(ground);
    });

    it('the blast jolts the ground at once and its air wave knocks the view when it arrives', () => {
        const wave = 14400 / SHAKE.SOUND;
        const before = [];
        const after = [];
        for (const t0 of STARTS) {
            const shake = new RidgeShake();
            shake.blast(1, 14400, t0);
            expect(px(shake.sample(t0 + 0.03))).toBeGreaterThan(0); // the ground: at once
            before.push(peakOf(trace(shake, t0, wave - 0.01)));
            after.push(peakOf(trace(shake, t0 + wave, 0.5)));
        }
        expect(wave).toBeGreaterThan(0.2);
        expect(wave).toBeLessThan(0.5);
        expect(median(after)).toBeGreaterThan(median(before) * 1.5);
    });

    it('the slow causes swell in: a level-up groans, a perfect clear rolls on', () => {
        const groan = new RidgeShake();
        groan.surge(10);
        expect(groan.groan.valueAt(10.1)).toBeLessThan(groan.groan.valueAt(10.7));
        expect(groan.groan.valueAt(13)).toBeGreaterThan(0.2);
        expect(groan.tremble.valueAt(10.5)).toBe(0); // no crack in it
        const sheet = new RidgeShake();
        sheet.sheet(10);
        expect(sheet.roll.valueAt(10.5) + sheet.groan.valueAt(10.5)).toBeGreaterThan(1);
    });

    it('moves smoothly: no cause pops the frame more than a couple of pixels in one frame', () => {
        for (const [name, fire] of Object.entries(CAUSES)) expect(worstStep(fire), name).toBeLessThan(2.6);
        // The slow ones glide.
        expect(worstStep(CAUSES['a level-up'])).toBeLessThan(0.5);
        expect(worstStep(CAUSES['a perfect clear'])).toBeLessThan(0.8);
    });
});

describe('RidgeShake: it builds, and it is bounded', () => {
    it('adds every hit to what is still shaking and never cuts it', () => {
        const alone = new RidgeShake();
        const more = new RidgeShake();
        alone.blast(1, 14400, 10);
        more.blast(1, 14400, 10);
        more.hardDrop(0.1, 10.5); // a weak hit after a strong one
        more.thunder(13000, 0.6, 10.8);
        for (let t = 10; t < 14; t += 0.01) {
            for (const band of ['tremble', 'roll', 'groan']) {
                const label = `${band} at ${t.toFixed(2)}`;
                expect(more[band].valueAt(t), label).toBeGreaterThanOrEqual(alone[band].valueAt(t) - 1e-12);
            }
        }
    });

    it('the fever lifts every new hit', () => {
        const calm = new RidgeShake();
        const hot = new RidgeShake();
        hot.setFever(1);
        calm.thunder(10000, 1, 10);
        hot.thunder(10000, 1, 10);
        const t = 10 + 10000 / SHAKE.SOUND + 0.05;
        expect(hot.tremble.valueAt(t) / calm.tremble.valueAt(t)).toBeCloseTo(1 + RIDGE.fever, 6);
    });

    it('never passes its cap, however hard it is hammered', () => {
        const shake = new RidgeShake();
        shake.setFever(1);
        const cap = SHAKE.CAP * SHAKE.UNIT;
        for (let k = 0; k < 600; k++) {
            const t = 5 + k / 60;
            shake.hardDrop(1, t);
            shake.thunder(7000, 1.5, t, { discharge: true });
            if (k % 60 === 0) {
                shake.blast(1.45, 14400, t);
                shake.sheet(t);
                shake.surge(t);
            }
            const s = shake.sample(t);
            for (const axis of ['x', 'y', 'roll']) expect(Math.abs(s[axis])).toBeLessThanOrEqual(cap);
        }
    });

    it('a quad as it plays out (the blast, its bolts, the discharge) stays a few pixels', () => {
        const peaks = STARTS.map((t0) => {
            const shake = new RidgeShake();
            shake.blast(1, 14400, t0);
            for (let k = 0; k < 3; k++) shake.thunder(9000 + k * 1500, 0.85, t0 + 0.44 + k * 0.3);
            shake.thunder(14400, 1.5, t0 + 1.34, { discharge: true });
            return peakOf(trace(shake, t0, 5));
        });
        expect(Math.max(...peaks)).toBeLessThan(6);
    });
});

describe('RidgeShake: the clock', () => {
    const play = (shake) => {
        shake.hardDrop(0.8, 10.02);
        shake.blast(1, 14400, 10.4);
        shake.thunder(9000, 1, 10.7);
        shake.surge(11.1);
    };

    it('is a pure function of the clock: any frame rate lands on the same shake', () => {
        const slow = new RidgeShake();
        const fast = new RidgeShake();
        const once = new RidgeShake();
        play(slow);
        play(fast);
        play(once);
        const a = trace(slow, 10, 3, 30);
        const b = trace(fast, 10, 3, 150);
        for (let i = 0; i < a.length; i++) {
            const twin = b[i * 5];
            expect(twin.t).toBeCloseTo(a[i].t, 9);
            for (const axis of ['x', 'y', 'roll']) expect(twin[axis]).toBeCloseTo(a[i][axis], 12);
        }
        // Read once, cold, at the end: the same again.
        const end = a.at(-1);
        expect(once.sample(end.t).y).toBeCloseTo(end.y, 12);
    });

    it('reduced motion: records nothing, reads zero, and nothing in flight returns after', () => {
        const shake = new RidgeShake();
        play(shake);
        shake.setEnabled(false);
        expect(shake.sample(10.5)).toEqual({ x: 0, y: 0, roll: 0 });
        shake.hardDrop(1, 10.6);
        expect(shake.sample(10.65)).toEqual({ x: 0, y: 0, roll: 0 });
        shake.setEnabled(true);
        expect(shake.sample(10.7)).toEqual({ x: 0, y: 0, roll: 0 });
        expect(shake.sample(11.5)).toEqual({ x: 0, y: 0, roll: 0 });
    });

    it('reset forgets everything', () => {
        const shake = new RidgeShake();
        play(shake);
        shake.reset();
        for (const t of [10.1, 10.5, 11, 12]) expect(shake.sample(t)).toEqual({ x: 0, y: 0, roll: 0 });
    });
});
