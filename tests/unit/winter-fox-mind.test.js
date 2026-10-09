import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    FOX_BLEND, FOX_CLIPS, FOX_TROT, FoxMind, POUNCE_AIR, foxRunSpeed, foxStride,
} from '../../src/themes/winter/winter-fox-mind.js';
import {
    FOX_SCALE, foxAt, foxRound, groundHeight,
} from '../../src/themes/winter/winter-core.js';

const source = readFileSync(path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'src',
    'themes',
    'winter',
    'winter-fox-mind.js',
), 'utf8');

const DT = 1 / 60;
const REST = Object.freeze({ power: 0, surge: 0 });
/** Metres between prints. */
const PRINT_STEP = 0.33 * FOX_SCALE;
/** The clips it only plays standing: everything but its gait, its leap and its sleep. */
const STANDING = Object.keys(FOX_CLIPS).filter((name) => !['Run', 'Pounce', 'CurlSleep'].includes(name));

const WIDE = foxRound(16 / 9);

/** Step a mind `seconds` on from `from` at the fixed step; `each` sees it after every step. */
function run(mind, from, seconds, env = REST, each = null) {
    const steps = Math.round(seconds / DT);
    let time = from;
    for (let i = 1; i <= steps; i++) {
        time = from + i * DT;
        mind.step(DT, time, env);
        each?.(mind, time);
    }
    return time;
}

/** Step until `done(mind)`; the time it came true. Fails the test if it never does. */
function runUntil(mind, from, done, limit = 120, env = REST) {
    const steps = Math.round(limit / DT);
    for (let i = 1; i <= steps; i++) {
        const time = from + i * DT;
        mind.step(DT, time, env);
        if (done(mind)) return time;
    }
    throw new Error(`the fox never got there in ${limit} s (mode ${mind.mode}, clip ${mind.clip})`);
}

/** Metres along the round to its nearest stopping place. */
function stationGap(mind) {
    const { length, stations } = mind.round;
    return Math.min(...stations.map((station) => {
        const ahead = (((mind.s - station) % length) + length) % length;
        return Math.min(ahead, length - ahead);
    }));
}

/** A fox standing at one of its stopping places, and the time it stopped. */
function stoppedFox() {
    const mind = new FoxMind(WIDE);
    const time = runUntil(mind, 0, (m) => m.mode === 'idle');
    return { mind, time };
}

const printsOf = (mind) => mind.events.filter((event) => event.type === 'print').map((event) => ({ ...event }));
const landingsOf = (mind) => mind.events.filter((event) => event.type === 'land');

describe('winter fox mind: the module', () => {
    it('is three-free: it knows the plan of the place and nothing of how it is drawn', () => {
        const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
        expect(imports).toEqual(['./winter-core.js']);
        expect(source).not.toMatch(/\bTHREE\b|\bdocument\b|\bwindow\b|performance\.now|Date\.now|Math\.random/);
    });

    it('names a length for every clip it can ask the model for', () => {
        for (const [name, seconds] of Object.entries(FOX_CLIPS)) {
            expect(seconds, name).toBeGreaterThan(0);
        }
        expect(Object.keys(FOX_CLIPS)).toEqual(expect.arrayContaining(['Run', 'Pounce', 'CurlSleep', 'Stretch']));
        expect(STANDING.length).toBeGreaterThan(0);
        expect(POUNCE_AIR[0]).toBeGreaterThan(0);
        expect(POUNCE_AIR[1]).toBeGreaterThan(POUNCE_AIR[0]);
        expect(POUNCE_AIR[1]).toBeLessThan(FOX_CLIPS.Pounce); // it lands inside the clip
    });
});

describe('winter fox mind: at rest', () => {
    it('trots its round on the snow', () => {
        const mind = new FoxMind(WIDE);
        expect(mind.mode).toBe('gait');
        expect(mind.asleep).toBe(false);
        expect(mind.pose).toMatchObject({
            clip: 'Run', lift: 0, speed: FOX_TROT, blend: 1, flick: 0, glow: 0,
        });
        const start = mind.s;
        const time = run(mind, 0, 2);
        expect(mind.mode).toBe('gait');
        expect(mind.speed).toBeCloseTo(FOX_TROT, 6);
        expect(mind.s - start).toBeCloseTo(FOX_TROT * 2, 6);
        // Its pose is where the round is, and on the ground there.
        const at = foxAt(WIDE, mind.s);
        expect(mind.pose.x).toBeCloseTo(at[0], 9);
        expect(mind.pose.z).toBeCloseTo(at[1], 9);
        expect(mind.pose.heading).toBeCloseTo(at[2], 9);
        expect(mind.pose.y).toBeCloseTo(groundHeight(at[0], at[1]), 9);
        expect(mind.pose.lift).toBe(0);
        // The gait turns over once a stride.
        expect(mind.pose.clip).toBe('Run');
        expect(mind.pose.clipTime).toBeGreaterThanOrEqual(0);
        expect(mind.pose.clipTime).toBeLessThan(FOX_CLIPS.Run);
        expect(mind.phase).toBeCloseTo((FOX_TROT * 2) / foxStride(FOX_TROT), 6);
        // The round is closed: a lap on, it is where it is now.
        const lap = foxAt(WIDE, mind.s + WIDE.length);
        expect(lap[0]).toBeCloseTo(at[0], 4);
        expect(lap[1]).toBeCloseTo(at[1], 4);
        expect(time).toBeCloseTo(2, 9);
    });

    it('stops at a station for an act, and goes on when it is done', () => {
        const mind = new FoxMind(WIDE);
        const start = mind.s;
        const stopped = runUntil(mind, 0, (m) => m.mode === 'idle');
        // It stopped where it likes to stop, having trotted there.
        expect(stationGap(mind)).toBeLessThan(FOX_TROT * DT + 1e-6);
        expect(mind.s - start).toBeCloseTo(FOX_TROT * stopped, 3);
        const act = [...mind.act];
        expect(act.length).toBeGreaterThan(0);
        for (const clip of act) expect(STANDING, clip).toContain(clip);
        // The act begins as a cross-fade out of its gait.
        expect(mind.pose).toMatchObject({ clip: act[0], from: 'Run', clipTime: 0 });
        expect(mind.pose.blend).toBe(0);
        const settled = run(mind, stopped, FOX_BLEND + 0.5);
        expect(mind.mode).toBe('idle');
        expect(mind.pose.blend).toBe(1);
        expect(mind.speed).toBeLessThan(0.2);
        expect(stationGap(mind)).toBeLessThan(0.6); // it pulls up within a stride or two
        // The act runs its clips through, one after another, and then it moves on.
        const seen = [];
        const left = runUntil(mind, settled, (m) => {
            if (seen[seen.length - 1] !== m.clip) seen.push(m.clip);
            return m.mode === 'gait';
        }, 60);
        const length = act.reduce((sum, clip) => sum + FOX_CLIPS[clip], 0);
        expect(left - stopped).toBeGreaterThan(length - 1e-6);
        expect(left - stopped).toBeLessThan(length + (act.length + 1) * DT);
        expect(seen).toEqual(act.filter((clip, i) => i === 0 || clip !== act[i - 1]));
        expect(mind.act).toBeNull();
        expect(mind.nextStop).toBeGreaterThan(left); // not again at once
        const from = mind.s;
        run(mind, left, 4);
        expect(mind.mode).toBe('gait');
        expect(mind.pose.clip).toBe('Run');
        expect(mind.speed).toBeCloseTo(FOX_TROT, 2);
        expect(mind.s).toBeGreaterThan(from + FOX_TROT * 2);
    });

    it('keeps to its round for lap after lap', () => {
        const mind = new FoxMind(WIDE);
        const stops = [];
        let was = mind.mode;
        let last = mind.s;
        run(mind, 0, 150, REST, (m) => {
            expect(m.s).toBeGreaterThanOrEqual(last); // never backward
            last = m.s;
            if (m.mode === 'idle' && was !== 'idle') stops.push(stationGap(m));
            was = m.mode;
        });
        expect(mind.s).toBeGreaterThan(WIDE.length * 2);
        expect(stops.length).toBeGreaterThan(2);
        for (const gap of stops) expect(gap).toBeLessThan(FOX_TROT * DT + 1e-6);
    });
});

describe('winter fox mind: the chain', () => {
    it('runs when the fires burn, faster the more they do', () => {
        const settle = (power, surge = 0, seconds = 8) => {
            const mind = new FoxMind(WIDE);
            run(mind, 0, seconds, { power, surge });
            return mind;
        };
        const still = settle(0, 0, 2); // (short of its first stop)
        expect(still.speed).toBeCloseTo(FOX_TROT, 6);
        expect(still.glow).toBe(0);
        const paces = [0.3, 0.6, 1].map((power) => {
            const mind = settle(power);
            expect(mind.mode, `power ${power}`).toBe('gait');
            expect(mind.pose.clip).toBe('Run');
            expect(mind.speed, `power ${power}`).toBeCloseTo(foxRunSpeed(power), 3);
            return mind;
        });
        expect(paces[0].speed).toBeGreaterThan(FOX_TROT);
        expect(paces[1].speed).toBeGreaterThan(paces[0].speed);
        expect(paces[2].speed).toBeGreaterThan(paces[1].speed);
        // Its coat takes the fires' light with the chain.
        expect(paces[0].pose.glow).toBeGreaterThan(0);
        expect(paces[2].pose.glow).toBeGreaterThan(paces[0].pose.glow);
        expect(paces[2].pose.glow).toBeLessThanOrEqual(1);
        // The overdrive after four lines drives it harder still.
        const surging = settle(1, 1);
        expect(surging.speed).toBeCloseTo(foxRunSpeed(1, 1), 3);
        expect(surging.speed).toBeGreaterThan(paces[2].speed);
        // A longer stride at speed, not only a quicker one.
        expect(foxStride(paces[2].speed)).toBeGreaterThan(foxStride(FOX_TROT));
        expect(foxRunSpeed(0.5)).toBeGreaterThan(foxRunSpeed(0.2));
        expect(foxRunSpeed(7)).toBe(foxRunSpeed(1)); // the charge is 0..1
    });

    it('does not stop to look about while it runs, and falls back to a trot when the chain breaks', () => {
        const mind = new FoxMind(WIDE);
        const lit = { power: 1, surge: 0 };
        const time = run(mind, 0, 60, lit, (m) => expect(m.mode).toBe('gait'));
        expect(mind.s).toBeGreaterThan(WIDE.length * 4); // several laps, past every station
        const slowed = run(mind, time, 8);
        expect(mind.speed).toBeCloseTo(FOX_TROT, 3);
        expect(mind.pose.glow).toBeLessThan(0.01);
        // Back at rest it stops again where it likes to.
        runUntil(mind, slowed, (m) => m.mode === 'idle');
        expect(stationGap(mind)).toBeLessThan(FOX_TROT * DT + 1e-3);
    });

    it('leaves what it was doing when the chain starts', () => {
        const { mind, time } = stoppedFox();
        mind.step(DT, time + DT, { power: 0.8, surge: 0 });
        expect(mind.mode).toBe('gait');
        const on = run(mind, time + DT, 4, { power: 0.8, surge: 0 });
        expect(mind.pose.clip).toBe('Run');
        expect(mind.speed).toBeCloseTo(foxRunSpeed(0.8), 2);
        expect(on).toBeGreaterThan(time);
    });
});

describe('winter fox mind: a clear', () => {
    it('makes it leave an idle act', () => {
        const { mind, time } = stoppedFox();
        const act = mind.pose.clip;
        const from = mind.s;
        run(mind, time, 0.5);
        expect(mind.mode).toBe('idle');
        mind.startle(1);
        expect(mind.mode).toBe('gait');
        expect(mind.act).toBeNull();
        mind.step(DT, time + 0.5 + DT, REST);
        expect(mind.pose).toMatchObject({ clip: 'Run', from: act });
        // It springs away: faster than its trot though nothing is burning.
        const after = run(mind, time + 0.5 + DT, 1.2);
        expect(mind.speed).toBeGreaterThan(FOX_TROT);
        expect(mind.s).toBeGreaterThan(from + 1);
        // ... and settles back into it.
        run(mind, after, 10, REST, (m) => expect(m.mode).not.toBe('pounce'));
        expect(mind.speed).toBeCloseTo(FOX_TROT, 2);
    });

    it('makes a trotting fox dash, the harder the bigger the clear', () => {
        const dash = (strength) => {
            const mind = new FoxMind(WIDE);
            const time = run(mind, 0, 1);
            mind.startle(strength);
            let top = 0;
            run(mind, time, 2, REST, (m) => { top = Math.max(top, m.speed); });
            return top;
        };
        expect(dash(0.75)).toBeGreaterThan(FOX_TROT * 1.2);
        expect(dash(1.4)).toBeGreaterThan(dash(0.75));
    });

    it('does not wake a sleeping fox', () => {
        const mind = new FoxMind(WIDE);
        const time = run(mind, 0, 1);
        mind.sleep(time);
        const later = run(mind, time, 3);
        mind.startle(1.4);
        run(mind, later, 2);
        expect(mind.asleep).toBe(true);
        expect(mind.mode).toBe('sleep');
        expect(mind.pose.clip).toBe('CurlSleep');
    });
});

describe('winter fox mind: four lines', () => {
    it('pounces: the Pounce clip, off the snow and down again, and one landing', () => {
        const mind = new FoxMind(WIDE);
        const called = run(mind, 0, 1);
        const from = mind.s;
        mind.pounce(called);
        expect(mind.mode).toBe('pounce');
        const landings = [];
        let peak = 0;
        const inClip = run(mind, called, FOX_CLIPS.Pounce - 2 * DT, REST, (m, time) => {
            const age = time - called;
            expect(m.pose.clip).toBe('Pounce');
            expect(m.pose.clipTime).toBeCloseTo(age, 6);
            landingsOf(m).forEach(() => landings.push(age));
            peak = Math.max(peak, m.pose.lift);
            // In the air between its two marks, on the snow before and after.
            if (Math.abs(age - POUNCE_AIR[0]) < 1e-6 || Math.abs(age - POUNCE_AIR[1]) < 1e-6) return;
            if (age > POUNCE_AIR[0] && age < POUNCE_AIR[1]) expect(m.pose.lift, `age ${age}`).toBeGreaterThan(0);
            else expect(m.pose.lift, `age ${age}`).toBe(0);
        });
        expect(peak).toBeGreaterThan(0.2 * FOX_SCALE);
        expect(landings).toHaveLength(1);
        expect(landings[0]).toBeGreaterThanOrEqual(POUNCE_AIR[1] - 1e-9);
        expect(landings[0]).toBeLessThan(POUNCE_AIR[1] + DT + 1e-9);
        expect(mind.s).toBeGreaterThan(from + 1); // the leap carries it along its round
        // On its feet again, it runs on; it does not land twice.
        const after = run(mind, inClip, 1, REST, (m) => expect(landingsOf(m)).toHaveLength(0));
        expect(mind.mode).toBe('gait');
        expect(mind.pose.clip).toBe('Run');
        expect(mind.pose.lift).toBe(0);
        expect(mind.speed).toBeGreaterThan(FOX_TROT); // out of the leap at a dash
        expect(after).toBeGreaterThan(called + FOX_CLIPS.Pounce);
    });

    it('pounces out of an act, and out of its sleep', () => {
        const { mind, time } = stoppedFox();
        mind.pounce(time);
        mind.step(DT, time + DT, REST);
        expect(mind.mode).toBe('pounce');
        expect(mind.pose.clip).toBe('Pounce');

        const sleeper = new FoxMind(WIDE);
        const dozed = run(sleeper, 0, 1);
        sleeper.sleep(dozed);
        const woken = run(sleeper, dozed, 4);
        expect(sleeper.pose.clip).toBe('CurlSleep');
        sleeper.pounce(woken);
        expect(sleeper.asleep).toBe(false);
        let landed = 0;
        run(sleeper, woken, FOX_CLIPS.Pounce + 0.5, REST, (m) => { landed += landingsOf(m).length; });
        expect(landed).toBe(1);
        expect(sleeper.mode).toBe('gait');
    });
});

describe('winter fox mind: the end of a run', () => {
    it('curls up where it is and sleeps, and wakes with a stretch', () => {
        const mind = new FoxMind(WIDE);
        const tired = run(mind, 0, 2);
        const from = mind.s;
        mind.sleep(tired);
        expect(mind.asleep).toBe(true);
        expect(mind.mode).toBe('sleep');
        // It slows to a stand and curls up.
        const down = run(mind, tired, 3);
        expect(mind.pose.clip).toBe('CurlSleep');
        expect(mind.pose.blend).toBe(1);
        expect(mind.speed).toBeLessThan(0.01);
        expect(mind.s - from).toBeGreaterThan(0);
        expect(mind.s - from).toBeLessThan(1);
        // And there it stays, whatever burns: no step, no print, the clip going round.
        const lay = mind.s;
        mind.sleep(down + 1); // already asleep: nothing starts over
        expect(mind.modeAt).toBe(tired);
        const slept = run(mind, down, 40, { power: 1, surge: 1 }, (m) => {
            expect(m.pose.clip).toBe('CurlSleep');
            expect(m.pose.clipTime).toBeGreaterThanOrEqual(0);
            expect(m.pose.clipTime).toBeLessThan(FOX_CLIPS.CurlSleep);
            expect(m.events).toHaveLength(0);
        });
        expect(mind.s).toBe(lay);
        expect(mind.asleep).toBe(true);

        mind.wake(slept);
        expect(mind.asleep).toBe(false);
        expect(mind.mode).toBe('idle');
        mind.step(DT, slept + DT, REST);
        expect(mind.pose).toMatchObject({ clip: 'Stretch', from: 'CurlSleep' });
        // The stretch done, it is back on its round.
        const up = runUntil(mind, slept + DT, (m) => m.mode === 'gait', 30);
        expect(up - slept).toBeGreaterThan(FOX_CLIPS.Stretch - 1e-6);
        expect(up - slept).toBeLessThan(FOX_CLIPS.Stretch + 3 * DT);
        run(mind, up, 4);
        expect(mind.pose.clip).toBe('Run');
        expect(mind.speed).toBeCloseTo(FOX_TROT, 2);
        expect(mind.s).toBeGreaterThan(lay + 2);
    });

    it('is not woken twice', () => {
        const mind = new FoxMind(WIDE);
        const time = run(mind, 0, 3);
        const before = { mode: mind.mode, clip: mind.clip, modeAt: mind.modeAt };
        mind.wake(time); // it was not asleep
        expect({ mode: mind.mode, clip: mind.clip, modeAt: mind.modeAt }).toEqual(before);
    });
});

describe('winter fox mind: its prints and its tail', () => {
    it('presses a print about every third of a metre of its scale, left and right in turn', () => {
        const mind = new FoxMind(WIDE);
        const start = mind.s;
        const prints = [];
        // Running, so that no stop falls inside the stretch: the spacing is the same at any pace.
        const time = run(mind, 0, 8, { power: 0.5, surge: 0 }, (m, now) => {
            printsOf(m).forEach((print) => {
                expect(print.time).toBe(now);
                prints.push(print);
            });
        });
        const travelled = mind.s - start;
        expect(travelled).toBeGreaterThan(20);
        expect(Math.abs(prints.length - travelled / PRINT_STEP)).toBeLessThan(1);
        expect(time).toBeCloseTo(8, 9);
        const sides = [];
        for (let i = 0; i < prints.length; i++) {
            const print = prints[i];
            // Each is on the snow, and knows which way the fox was going.
            expect(print.y).toBeCloseTo(groundHeight(print.x, print.z), 9);
            expect(Number.isFinite(print.heading)).toBe(true);
            if (i === 0) continue;
            const dx = print.x - prints[i - 1].x;
            const dz = print.z - prints[i - 1].z;
            const along = dx * Math.sin(print.heading) + dz * Math.cos(print.heading);
            const across = dx * Math.cos(print.heading) - dz * Math.sin(print.heading);
            expect(Math.abs(along - PRINT_STEP), `print ${i}`).toBeLessThan(PRINT_STEP * 0.15);
            expect(Math.abs(across), `print ${i}`).toBeGreaterThan(0.02);
            expect(Math.abs(across), `print ${i}`).toBeLessThan(PRINT_STEP);
            sides.push(Math.sign(across));
        }
        for (let i = 1; i < sides.length; i++) expect(sides[i], `print ${i + 1}`).toBe(-sides[i - 1]);
    });

    it('lays every print a long step covers, and none where it stands or sleeps', () => {
        const mind = new FoxMind(WIDE);
        const start = mind.s;
        mind.step(1, 1, REST); // a whole second in one step
        expect(mind.s - start).toBeCloseTo(FOX_TROT, 6);
        expect(printsOf(mind)).toHaveLength(Math.floor(FOX_TROT / PRINT_STEP + 1e-9));
        mind.step(0, 1, REST); // a frozen frame
        expect(mind.events).toHaveLength(0);
        // Events are this step's alone.
        mind.step(DT, 1 + DT, REST);
        expect(printsOf(mind).length).toBeLessThanOrEqual(1);
        mind.sleep(1 + DT);
        const down = run(mind, 1 + DT, 3);
        let pressed = 0;
        run(mind, down, 10, REST, (m) => { pressed += printsOf(m).length; });
        expect(pressed).toBe(0);
    });

    it('carries its tail behind it and flicks it when a ring of powder arrives', () => {
        const mind = new FoxMind(WIDE);
        const time = run(mind, 0, 2);
        const { pose } = mind;
        const out = [0, 0, 0];
        expect(mind.tail(out)).toBe(out);
        const back = (out[0] - pose.x) * Math.sin(pose.heading) + (out[2] - pose.z) * Math.cos(pose.heading);
        expect(back).toBeLessThan(0); // behind it
        expect(out[1]).toBeGreaterThan(pose.y); // and off the snow
        expect(mind.tail()).toEqual(out);
        // The flick is there at once and dies away in under a second.
        expect(pose.flick).toBe(0);
        mind.flickTail(1);
        mind.flickTail(0.3); // a weaker ring does not calm a stronger one
        mind.step(DT, time + DT, REST);
        expect(pose.flick).toBeGreaterThan(0.9);
        let swing = 0;
        const flicked = run(mind, time + DT, 0.3, REST, (m, now) => {
            swing = Math.max(swing, Math.abs(m.tailSwing(now)));
        });
        expect(swing).toBeGreaterThan(0.3);
        run(mind, flicked, 3);
        expect(pose.flick).toBeLessThan(0.001);
        expect(Math.abs(mind.tailSwing(flicked + 3))).toBeLessThan(0.2); // only its gait swings it now
    });

    it('carries the tail up with it when it leaps', () => {
        const mind = new FoxMind(WIDE);
        const time = run(mind, 0, 1);
        mind.pounce(time);
        const mid = (POUNCE_AIR[0] + POUNCE_AIR[1]) / 2;
        run(mind, time, mid);
        expect(mind.pose.lift).toBeGreaterThan(0);
        const tail = mind.tail();
        const grounded = tail[1] - mind.pose.lift;
        expect(grounded).toBeGreaterThan(mind.pose.y);
        expect(tail[1]).toBeCloseTo(grounded + mind.pose.lift, 9);
    });
});

describe('winter fox mind: replay', () => {
    /** A night's worth of everything the board can do to it, from `from`; every step's events. */
    function night(mind, from) {
        const log = [];
        const keep = (m, time) => m.events.forEach((event) => log.push({ ...event, at: time }));
        let time = run(mind, from, 3, REST, keep);
        time = run(mind, time, 4, { power: 0.5, surge: 0 }, keep);
        mind.flickTail(0.8);
        mind.startle(1.2);
        time = run(mind, time, 2, { power: 0.9, surge: 0.6 }, keep);
        mind.pounce(time);
        time = run(mind, time, 3, { power: 0.2, surge: 0.3 }, keep);
        time = run(mind, time, 25, REST, keep); // long enough to stop and choose an act
        mind.startle(0.6);
        time = run(mind, time, 6, REST, keep);
        mind.sleep(time);
        time = run(mind, time, 3, REST, keep);
        mind.wake(time);
        time = run(mind, time, 5, REST, keep);
        return { time, log };
    }

    const snapshot = (mind) => ({
        pose: { ...mind.pose },
        s: mind.s,
        speed: mind.speed,
        phase: mind.phase,
        mode: mind.mode,
        clip: mind.clip,
        nextStop: mind.nextStop,
        printRun: mind.printRun,
        printSide: mind.printSide,
        asleep: mind.asleep,
    });

    it('is deterministic: two minds stepped alike from reset(t) end in the same pose', () => {
        const a = new FoxMind(WIDE);
        const b = new FoxMind(WIDE);
        a.reset(7);
        b.reset(7);
        expect(snapshot(b)).toEqual(snapshot(a));
        const first = night(a, 7);
        const second = night(b, 7);
        expect(second.time).toBe(first.time);
        expect(snapshot(b)).toEqual(snapshot(a));
        expect(second.log).toEqual(first.log);
        // The night was a full one: it ran, leapt once, stood somewhere and left a line of prints.
        expect(first.log.filter((event) => event.type === 'land')).toHaveLength(1);
        expect(first.log.filter((event) => event.type === 'print').length).toBeGreaterThan(50);
    });

    it('replays the same night after a reset, whatever it had been doing', () => {
        const mind = new FoxMind(WIDE);
        mind.reset(7);
        const first = night(mind, 7);
        const ended = snapshot(mind);
        // Left asleep in mid-act, mid-stride, with a flick in its tail: reset forgets all of it.
        mind.sleep(first.time);
        mind.flickTail(1);
        mind.startle(1.4);
        mind.reset(7);
        const fresh = new FoxMind(WIDE);
        fresh.reset(7);
        expect(snapshot(mind)).toEqual(snapshot(fresh));
        expect(mind.events).toHaveLength(0);
        const again = night(mind, 7);
        expect(snapshot(mind)).toEqual(ended);
        expect(again.log).toEqual(first.log);
    });

    it('chooses its acts from its seed', () => {
        const acts = (seed) => {
            const mind = new FoxMind(WIDE, seed);
            const chosen = [];
            let was = mind.mode;
            run(mind, 0, 240, REST, (m) => {
                if (m.mode === 'idle' && was !== 'idle') chosen.push(m.act.join('+'));
                was = m.mode;
            });
            return chosen;
        };
        const mine = acts(0xf0c5);
        expect(mine.length).toBeGreaterThan(3);
        expect(acts(0xf0c5)).toEqual(mine);
        expect(new FoxMind(WIDE).seed).toBe(0xf0c5); // the seed it has when given none
    });
});

describe('winter fox mind: the frame changes shape', () => {
    it('keeps its fraction along the round when the round is laid out anew', () => {
        const tall = foxRound(9 / 16);
        expect(Math.abs(tall.length - WIDE.length)).toBeGreaterThan(1); // an upright screen draws it in
        const mind = new FoxMind(WIDE);
        const time = run(mind, 0, 6, { power: 0.6, surge: 0 });
        const fraction = mind.s / WIDE.length;
        expect(fraction).toBeGreaterThan(0);
        mind.setRound(tall);
        expect(mind.round).toBe(tall);
        expect(mind.s / tall.length).toBeCloseTo(fraction, 12);
        // From the next pose on it is drawn on the new round.
        mind.resolve(time);
        const at = foxAt(tall, mind.s);
        expect(mind.pose.x).toBeCloseTo(at[0], 9);
        expect(mind.pose.z).toBeCloseTo(at[1], 9);
        expect(mind.pose.y).toBeCloseTo(groundHeight(at[0], at[1]), 9);
        // It goes on from there without a jump, and the way back is the same fraction again.
        const before = mind.s;
        mind.step(DT, time + DT, { power: 0.6, surge: 0 });
        expect(mind.s - before).toBeCloseTo(mind.speed * DT, 3);
        const onward = mind.s / tall.length;
        mind.setRound(WIDE);
        expect(mind.s).toBeCloseTo(onward * WIDE.length, 9);
    });

    it('keeps its laps, and a place behind the start, through the change', () => {
        const tall = foxRound(9 / 16);
        for (const s of [-3.5, 0, WIDE.length * 2.25]) {
            const mind = new FoxMind(WIDE);
            mind.s = s;
            mind.setRound(tall);
            expect(mind.s / tall.length, `s ${s}`).toBeCloseTo(s / WIDE.length, 12);
        }
    });
});
