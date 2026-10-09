import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    FOX_BLEND, FOX_CLIPS, FOX_TROT, FoxMind, MOUSING, POUNCE_AIR, SLEEP_HOLD, foxGaitAmp, foxRunSpeed, foxStride,
} from '../../src/themes/winter/winter-fox-mind.js';
import {
    FOOT, FOX_ACTS, FOX_BONES, FOX_BONE_INDEX, FOX_LEGS, FOX_MARKS, FOX_RIG, SPEC, createFoxPosture, createFoxSpec,
    foxAct, foxGallop, foxPoint, foxSpec, solveFox,
} from '../../src/themes/winter/winter-fox-rig.js';
import {
    EYE, FOX_SCALE, foxAt, foxRound, groundHeight,
} from '../../src/themes/winter/winter-core.js';
import * as sharedMind from '../../src/themes/shared/fox-mind.js';

const themeSource = (...file) => readFileSync(path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'src',
    'themes',
    ...file,
), 'utf8');
const source = themeSource('winter', 'winter-fox-mind.js');

const DT = 1 / 60;
const REST = Object.freeze({ power: 0, surge: 0 });
/** Metres between prints. */
const PRINT_STEP = 0.33 * FOX_SCALE;
/** The acts it only does standing: everything but its gait, its leap and its sleep. */
const STANDING = Object.keys(FOX_CLIPS).filter((name) => !['Run', 'Pounce', 'CurlSleep'].includes(name));
/** Metres: how near a stopping place counts as on it (it brakes for the place and halts within a step of it). */
const NEAR = 0.25;

const WIDE = foxRound(16 / 9);

const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));

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

/** A fox that has just pulled up at one of its stopping places, and the time it did. */
function stoppedFox(seed) {
    const mind = new FoxMind(WIDE, seed);
    const time = runUntil(mind, 0, (m) => m.mode === 'idle');
    return { mind, time };
}

/** A fox that has stopped, faced the viewer and begun what it chose to do, and the time it chose. */
function busyFox(seed) {
    const { mind, time: stopped } = stoppedFox(seed);
    const time = runUntil(mind, stopped, (m) => m.act !== null, 10);
    return { mind, time, stopped };
}

/** A fox that has just pulled up because it heard something under the snow: its first stop is its hunt. */
function hunterFox() {
    for (let seed = 1; seed < 40; seed++) {
        const { mind, time } = stoppedFox(seed);
        if (mind.next?.includes('Pounce')) return { mind, time, seed };
    }
    throw new Error('no fox of the first forty begins its night with a hunt');
}

/** A fox trotting at a place `fraction` of the way round, at time 0. */
function placedFox(fraction) {
    const mind = new FoxMind(WIDE);
    mind.s = fraction * WIDE.length;
    // (Laying the round out again is how it is told its place changed under it.)
    mind.setRound(WIDE);
    mind.resolve(0);
    return mind;
}

/** A fox stopped where it was a second into its trot to do `clips`, and the time it began. */
function rehearsing(clips, fraction = null) {
    const mind = fraction === null ? new FoxMind(WIDE) : placedFox(fraction);
    const time = run(mind, 0, 1);
    mind.rehearse(clips, time);
    return { mind, time };
}

/** How far its nose is turned from the viewer (radians, + the viewer is to its left). */
const offViewer = (mind) => wrap(Math.atan2(EYE.x - mind.pose.x, EYE.z - mind.pose.z) - mind.pose.heading);
/** The body the rig makes of the pose it resolved. */
const bodyOf = (mind) => solveFox(foxSpec(mind.pose));
const noseOf = (mind) => foxPoint(bodyOf(mind), 'head', FOX_MARKS.nose);
/** How high a joint of a body is (model metres). */
const heightOf = (body, bone) => body.at[FOX_BONE_INDEX[bone]][1];
/** How far a paw of a spec is carried by the body (0 planted .. 1). */
const carriedOf = (spec, leg) => spec[SPEC.feet + leg * FOOT.size + FOOT.air];
/** Where the rig draws the tip of its tail, in the world (as the model is placed: turned its way, larger than life). */
function tailTipOf(mind) {
    const tip = foxPoint(bodyOf(mind), 'tail4', FOX_MARKS.tailTip);
    const { pose } = mind;
    const sin = Math.sin(pose.heading);
    const cos = Math.cos(pose.heading);
    return [
        pose.x + (tip[0] * cos + tip[2] * sin) * FOX_SCALE,
        pose.y + pose.lift + tip[1] * FOX_SCALE,
        pose.z + (tip[2] * cos - tip[0] * sin) * FOX_SCALE,
    ];
}

const DEG = Math.PI / 180;
/**
 * Watches the body the rig makes of a mind, step by step: `turn` the furthest any bone turned in
 * one step (degrees), `drop` the furthest its leap let it down in one (metres), `swing` the
 * furthest its heading changed in one (radians).
 */
function bodyWatch() {
    const spec = createFoxSpec();
    let before = createFoxPosture();
    let after = createFoxPosture();
    let last = null;
    const watch = {
        turn: 0,
        drop: 0,
        swing: 0,
        see(mind) {
            solveFox(foxSpec(mind.pose, spec), after);
            if (last) {
                for (let i = 0; i < FOX_BONES.length; i++) {
                    const a = before.world[i];
                    const b = after.world[i];
                    const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
                    watch.turn = Math.max(watch.turn, (2 * Math.acos(Math.min(1, dot))) / DEG);
                }
                watch.drop = Math.max(watch.drop, last.lift - mind.pose.lift);
                watch.swing = Math.max(watch.swing, Math.abs(wrap(mind.pose.heading - last.heading)));
            }
            last = { lift: mind.pose.lift, heading: mind.pose.heading };
            [before, after] = [after, before];
        },
    };
    return watch;
}
/**
 * The most a bone may turn in a step where nothing snaps (degrees). A trot turns a leg bone some
 * 12° a frame and a dash out of a leap 25°; the snaps these tests are about were 35° to 175°.
 */
const NO_SNAP = 30;

const printsOf = (mind) => mind.events.filter((event) => event.type === 'print').map((event) => ({ ...event }));
const landingsOf = (mind) => mind.events.filter((event) => event.type === 'land');

describe('winter fox mind: the module', () => {
    it('is three-free: it knows the plan of the place and its own body, and nothing of how either is drawn', () => {
        const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
        expect(imports).toEqual(['./winter-core.js', './winter-fox-rig.js', '../shared/fox-mind.js']);
        expect(source).not.toMatch(/\bTHREE\b|\bdocument\b|\bwindow\b|performance\.now|Date\.now|Math\.random/);
        // (Its body is as free of them, and so is the mind the themes share: winter-fox-rig.test.js,
        // shared-fox-mind.test.js.)
    });

    it('is the fox mind the themes share, on its round over the snowfield and at its own paces', () => {
        const mind = new FoxMind(WIDE);
        expect(mind).toBeInstanceOf(sharedMind.FoxMind);
        expect(mind.rig).toBe(FOX_RIG);
        // What is every fox's is passed on as it is.
        expect(MOUSING).toBe(sharedMind.MOUSING);
        expect(FOX_BLEND).toBe(sharedMind.FOX_BLEND);
        expect(foxGaitAmp).toBe(sharedMind.foxGaitAmp);
        expect(mind.stops).toBe(sharedMind.FOX_STOPS);
        // Its course is its round: as long, with its stopping places, over the snowfield's own
        // ground, and the viewer it turns to face stands at the origin.
        expect(mind.round).toBe(WIDE);
        expect(mind.course.length).toBe(WIDE.length);
        expect(mind.course.stations).toBe(WIDE.stations);
        expect(mind.course.height).toBe(groundHeight);
        expect(mind.course.viewer).toEqual([EYE.x, EYE.z]);
        for (const s of [0, 3.7, WIDE.length * 0.61, -2, WIDE.length * 2.4]) {
            expect(mind.course.at(s, [0, 0, 0])).toEqual(foxAt(WIDE, s));
        }
        // It starts on its way to its stopping place under the moon, at its trot.
        expect(mind.s).toBe(WIDE.stations[1] - 11);
        expect(mind.speed).toBe(FOX_TROT);
        expect(mind.paces.trot).toBe(FOX_TROT);
        expect(mind.paces.run).toBe(foxRunSpeed);
        // Its leaps and its prints are the size it is drawn at.
        expect(mind.paces.printStep).toBeCloseTo(PRINT_STEP, 12);
        expect(mind.paces.leapHigh).toBeGreaterThan(mind.paces.leapLow);
        expect(mind.paces.leapLow).toBeGreaterThan(0.2 * FOX_SCALE);
        // A new round is a new course, and where it would start on it: a reset goes there.
        const tall = foxRound(9 / 16);
        mind.setRound(tall);
        expect(mind.round).toBe(tall);
        expect(mind.course.length).toBe(tall.length);
        mind.reset(0);
        expect(mind.s).toBe(tall.stations[1] - 11);
    });

    it('names a length for every act it can ask its body for', () => {
        // The lengths are the body's own: there is one list, not two to keep in step.
        expect(FOX_CLIPS).toBe(FOX_ACTS);
        for (const [name, seconds] of Object.entries(FOX_CLIPS)) {
            expect(seconds, name).toBeGreaterThan(0);
        }
        const needed = ['Run', 'Pounce', 'CurlSleep', 'Stretch', 'Sit'];
        expect(Object.keys(FOX_CLIPS)).toEqual(expect.arrayContaining(needed));
        expect(STANDING.length).toBeGreaterThan(0);
        expect(POUNCE_AIR[0]).toBeGreaterThan(0);
        expect(POUNCE_AIR[1]).toBeGreaterThan(POUNCE_AIR[0]);
        expect(POUNCE_AIR[1]).toBeLessThan(FOX_CLIPS.Pounce); // it lands inside the act
        expect(SLEEP_HOLD).toBeGreaterThan(0);
        expect(SLEEP_HOLD).toBeLessThan(FOX_CLIPS.CurlSleep); // it is down before the act is over
    });

    it('asks its body only for acts it has a pose for', () => {
        // Every act the mind names anywhere — the ones it chooses between at a stop, its hunt,
        // its leap, its sleep, the stretch it wakes with — is one the body knows... (The names
        // are in the mind the themes share; this file's own would be found too.)
        const minds = `${themeSource('shared', 'fox-mind.js')}\n${source}`;
        const named = [...new Set([...minds.matchAll(/'([A-Z][A-Za-z]+)'/g)].map((m) => m[1]))];
        expect(named).toEqual(expect.arrayContaining(['Run', 'Pounce', 'CurlSleep', 'Stretch', ...MOUSING]));
        expect(named.length).toBeGreaterThan(MOUSING.length + 4);
        named.forEach((name) => expect(FOX_ACTS[name], name).toBeGreaterThan(0));
        // ...and, but for its gait, one that moves it: a name the body did not know would leave
        // the fox standing stock still for the length of it.
        const spec = createFoxSpec();
        named.filter((name) => name !== 'Run').forEach((name) => {
            let moved = 0;
            for (let t = 0; t <= FOX_ACTS[name]; t += DT) {
                moved = Math.max(moved, ...Array.from(foxAct(spec, name, t), Math.abs));
            }
            expect(moved, name).toBeGreaterThan(0.05);
        });
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
        let trotted = 0;
        const stopped = runUntil(mind, 0, (m) => {
            if (m.speed > FOX_TROT - 1e-6) trotted += 1;
            return m.mode === 'idle';
        });
        // It stopped where it likes to stop, having trotted there and braked for the place.
        expect(stationGap(mind)).toBeLessThan(NEAR);
        expect(trotted * DT).toBeGreaterThan(stopped * 0.8);
        expect(mind.speed).toBeLessThan(FOX_TROT);
        expect(mind.s - start).toBeLessThan(FOX_TROT * stopped);
        expect(mind.s - start).toBeGreaterThan(FOX_TROT * stopped * 0.9);
        // It does nothing yet: first it comes to a stand and faces the viewer (see below).
        expect(mind.act).toBeNull();
        expect(mind.pose.clip).toBe('Run');
        const chose = runUntil(mind, stopped, (m) => m.act !== null, 10);
        const act = [...mind.act];
        expect(act.length).toBeGreaterThan(0);
        for (const clip of act) expect(STANDING, clip).toContain(clip);
        // The act begins as a cross-fade out of its gait.
        expect(mind.pose).toMatchObject({ clip: act[0], from: 'Run', clipTime: 0 });
        expect(mind.pose.blend).toBe(0);
        const settled = run(mind, chose, mind.blendTime + 0.5);
        expect(mind.mode).toBe('idle');
        expect(mind.pose.blend).toBe(1);
        expect(mind.speed).toBeLessThan(0.01);
        expect(stationGap(mind)).toBeLessThan(0.6); // it pulls up within a stride or two
        // The act runs its clips through, one after another, and then it moves on.
        const seen = [];
        const left = runUntil(mind, settled, (m) => {
            if (seen[seen.length - 1] !== m.clip) seen.push(m.clip);
            return m.mode === 'gait';
        }, 60);
        const length = act.reduce((sum, clip) => sum + FOX_CLIPS[clip], 0);
        expect(left - chose).toBeGreaterThan(length - 1e-6);
        expect(left - chose).toBeLessThan(length + (act.length + 1) * DT);
        expect(seen).toEqual(act.filter((clip, i) => i === 0 || clip !== act[i - 1]));
        expect(mind.act).toBeNull();
        expect(mind.nextStop).toBeGreaterThan(left); // not again at once
        const from = mind.s;
        run(mind, left, 4);
        expect(mind.mode).toBe('gait');
        expect(mind.pose.clip).toBe('Run');
        expect(mind.speed).toBeCloseTo(FOX_TROT, 2);
        expect(mind.s).toBeGreaterThan(from + FOX_TROT * 2);
        // Under way again it faces the way it goes.
        expect(mind.pose.heading).toBeCloseTo(foxAt(WIDE, mind.s)[2], 3);
        expect(mind.pose.step).toBeLessThan(1e-3);
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
        for (const gap of stops) expect(gap).toBeLessThan(NEAR);
    });
});

describe('winter fox mind: at a stopping place', () => {
    it('pulls up knowing what for, steps round on the spot to face the viewer, and only then does it', () => {
        const { mind, time } = stoppedFox();
        // What it stopped for is drawn as it stops — here, nothing it has to keep its nose on.
        const drawn = [...mind.next];
        expect(drawn.length).toBeGreaterThan(0);
        expect(drawn).not.toContain('Pounce');
        expect(mind.act).toBeNull();
        const need = mind.toFace();
        const off = Math.abs(offViewer(mind));
        const from = { heading: mind.pose.heading, phase: mind.phase, s: mind.s };
        // (This place is one where the viewer is well off its path: there is a turn to make.)
        expect(Math.abs(need)).toBeGreaterThan(0.2);
        const steps = [];
        const chose = runUntil(mind, time, (m) => {
            const { heading, step, amp } = m.pose;
            steps.push({
                heading, step, amp, clip: m.pose.clip, mode: m.mode, chosen: m.act !== null, left: m.toFace(),
            });
            return m.act !== null;
        }, 10);
        expect(mind.act).toEqual(drawn);
        expect(mind.next).toBeNull();
        // It took its time over the turn, but not for ever.
        expect(chose - time).toBeGreaterThan(0.25);
        expect(chose - time).toBeLessThan(3);
        // Until it began it was still in its gait, on the spot: no act, a stride shrinking to nothing.
        const turning = steps.filter((s) => !s.chosen);
        turning.forEach((s) => {
            expect(s.mode).toBe('idle');
            expect(s.clip).toBe('Run');
        });
        expect(steps[steps.length - 1].amp).toBeLessThan(0.2);
        steps.forEach((s, i) => {
            expect(s.amp).toBeGreaterThanOrEqual(0);
            expect(s.amp).toBeLessThanOrEqual(i ? steps[i - 1].amp : 1);
        });
        expect(mind.s - from.s).toBeLessThan(0.5); // it coasted to a stand, no further
        // It turned toward the viewer, one way and without a jump, most of the way it meant to...
        const turned = mind.pose.heading - from.heading;
        expect(Math.sign(turned)).toBe(Math.sign(need));
        expect(Math.abs(turned)).toBeGreaterThan(Math.abs(need) * 0.75);
        expect(Math.abs(turned)).toBeLessThan(Math.abs(need));
        turning.forEach((s, i) => {
            const d = s.heading - (i ? turning[i - 1].heading : from.heading);
            expect(d * Math.sign(need)).toBeGreaterThan(0);
            expect(Math.abs(d)).toBeLessThan(0.1);
        });
        expect(Math.abs(offViewer(mind))).toBeLessThan(off - Math.abs(turned) * 0.9);
        // ...and began only when it all but faced the way it wanted.
        expect(Math.abs(turning[turning.length - 1].left)).toBeLessThan(Math.abs(need) * 0.25);
        // It did not swivel like a weathervane: it lifted its feet, and its gait turned over.
        expect(Math.max(...steps.map((s) => s.step))).toBeGreaterThan(0.5);
        steps.forEach((s) => {
            expect(s.step).toBeGreaterThanOrEqual(0);
            expect(s.step).toBeLessThanOrEqual(1);
        });
        expect(mind.phase).toBeGreaterThan(from.phase);
        // Once it has begun it stays as it stands: no more turning under what it does, and its
        // feet come to rest.
        expect(mind.toFace()).toBe(0);
        const { face } = mind;
        const facing = mind.pose.heading;
        run(mind, chose, 3, REST, (m) => expect(m.toFace()).toBe(0));
        expect(mind.face).toBe(face);
        expect(Math.abs(mind.pose.heading - facing)).toBeLessThan(1e-3);
        expect(mind.pose.step).toBeLessThan(0.05);
    });

    it('steps a few steps to the turn: its gait turns over by the ground it covers and its turn, no more', () => {
        const { mind, time } = stoppedFox();
        const marks = [{ face: mind.face, phase: mind.phase, s: mind.s }];
        // (What of its gait is the ground it is still covering, coasting to a stand: a cycle a stride.)
        let coasted = 0;
        runUntil(mind, time, (m) => {
            const before = marks[marks.length - 1];
            coasted += (m.s - before.s) / foxStride(m.speed);
            marks.push({
                face: m.face, phase: m.phase, s: m.s, coasted, step: m.pose.step, chosen: m.act !== null,
            });
            return m.act !== null;
        }, 10);
        // The step it began on turned nothing: all of the turn is before it.
        const last = marks.length - 2;
        expect(marks.length).toBeGreaterThan(30);
        // What is left of its gait is the turn: so many cycles to the radian, early in it and late alike...
        const cycles = (a, b) => (marks[b].phase - marks[a].phase - (marks[b].coasted - (marks[a].coasted ?? 0)))
            / Math.abs(marks[b].face - marks[a].face);
        const early = cycles(0, 15);
        expect(cycles(15, last)).toBeCloseTo(early, 6);
        expect(cycles(0, last)).toBeCloseTo(early, 6);
        // ...a few steps to a turn, not a shuffle and not a pivot on planted paws.
        expect(early).toBeGreaterThan(0.2);
        expect(early).toBeLessThan(2);
        // While it turns it lifts its feet; once it stands as it will, they come down again, and
        // the body the rig makes of it is on four paws.
        expect(marks[15].step).toBeGreaterThan(0.5);
        run(mind, time + (marks.length - 1) * DT, 3);
        expect(mind.pose.step).toBeLessThan(0.01);
        const body = bodyOf(mind);
        FOX_LEGS.forEach(([name, , , last4, paw]) => {
            expect(Math.abs(foxPoint(body, last4, FOX_MARKS[paw])[1]), name).toBeLessThan(0.002);
        });
    });

    it('does not turn from what it has heard: a hunt begins as it stands and leaps where its nose points', () => {
        const { mind, time } = hunterFox();
        expect(mind.next).toEqual(MOUSING);
        // Nothing to turn for: it faces along its path, and begins as soon as it has come to a
        // stand — not on the move, the moment it pulls up (it once began listening at half its
        // trot, still striding).
        expect(Math.abs(mind.toFace())).toBeLessThan(0.01);
        const pace = mind.speed;
        expect(pace).toBeGreaterThan(0.3);
        const speeds = [];
        const began = runUntil(mind, time, (m) => {
            speeds.push(m.speed);
            return m.act !== null;
        }, 2);
        expect(speeds.length).toBeGreaterThan(3);
        speeds.forEach((speed, i) => expect(speed).toBeLessThan(i ? speeds[i - 1] : pace));
        expect(mind.speed).toBeLessThan(0.3);
        expect(mind.pose.amp).toBeLessThan(1);
        expect(began - time).toBeLessThan(1);
        expect(mind.act).toEqual(MOUSING);
        expect(Math.abs(mind.face)).toBeLessThan(0.01);
        // Through its listening it stands as it stood...
        const stood = mind.pose.heading;
        const off = runUntil(mind, began, (m) => m.clip === 'Pounce' && m.pose.lift > 0, 10, REST);
        expect(Math.abs(wrap(mind.pose.heading - stood))).toBeLessThan(0.05);
        // ...and the leap carries it the way it faces: a few degrees off its nose at most (its
        // path bends a little under it), not half a metre sideways.
        const from = { x: mind.pose.x, z: mind.pose.z, heading: mind.pose.heading };
        runUntil(mind, off, (m) => m.pose.lift === 0, 2);
        const went = [mind.pose.x - from.x, mind.pose.z - from.z];
        const far = Math.hypot(...went);
        expect(far).toBeGreaterThan(0.5);
        const offNose = wrap(Math.atan2(went[0], went[1]) - from.heading);
        expect(Math.abs(offNose)).toBeLessThan(5 * DEG);
        expect(Math.abs(far * Math.sin(offNose))).toBeLessThan(0.08);
    });

    it('faces the way it goes when it is under way, and does not turn on the spot asleep', () => {
        const mind = new FoxMind(WIDE);
        run(mind, 0, 3, REST, (m) => {
            expect(m.toFace()).toBe(0);
            expect(m.pose.step).toBe(0);
            expect(m.pose.heading).toBeCloseTo(foxAt(WIDE, m.s)[2], 9);
        });
        // Asleep it lies as it lay down: it curls toward the viewer instead (see its sleep).
        const sleeper = placedFox(0.3);
        sleeper.sleep(0);
        const down = run(sleeper, 0, 3);
        const { heading } = sleeper.pose;
        run(sleeper, down, 10, REST, (m) => {
            expect(m.toFace()).toBe(0);
            expect(m.pose.heading).toBe(heading);
        });
        expect(sleeper.pose.heading).toBeCloseTo(foxAt(WIDE, sleeper.s)[2], 9);
        expect(sleeper.pose.step).toBeLessThan(1e-3);
    });

    it('sits with its tail toward whoever is watching', () => {
        const sides = new Set();
        for (const fraction of [0.15, 0.45, 0.6, 0.85]) {
            const { mind, time } = rehearsing(['Sit'], fraction);
            // Which side of it the viewer stands on, from where it is and the way it faces.
            const { x, z, heading } = mind.pose;
            const toItsLeft = (EYE.x - x) * Math.cos(heading) - (EYE.z - z) * Math.sin(heading);
            expect(mind.side, `${fraction} of the way round`).toBe(toItsLeft >= 0 ? 1 : -1);
            expect(mind.viewerSide()).toBe(mind.side);
            run(mind, time, FOX_CLIPS.Sit / 2);
            expect(mind.pose.side).toBe(mind.side);
            // (Stopped where it is, it sits as it stood: the side stays the side.)
            expect(mind.viewerSide()).toBe(mind.side);
            const tip = foxPoint(bodyOf(mind), 'tail4', FOX_MARKS.tailTip);
            expect(Math.sign(tip[0]), `${fraction} of the way round`).toBe(mind.side);
            sides.add(mind.side);
        }
        expect([...sides].sort()).toEqual([-1, 1]);
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
        expect(stationGap(mind)).toBeLessThan(NEAR);
    });

    it('leaves what it was doing when the chain starts', () => {
        const { mind, time } = busyFox();
        const act = mind.pose.clip;
        expect(act).not.toBe('Run');
        mind.step(DT, time + DT, { power: 0.8, surge: 0 });
        expect(mind.mode).toBe('gait');
        expect(mind.act).toBeNull();
        const on = run(mind, time + DT, 4, { power: 0.8, surge: 0 });
        expect(mind.pose).toMatchObject({ clip: 'Run', from: act });
        expect(mind.speed).toBeCloseTo(foxRunSpeed(0.8), 2);
        expect(on).toBeGreaterThan(time);
        // The same for a fox that had only just pulled up and was still turning to face the viewer.
        const turning = stoppedFox();
        turning.mind.step(DT, turning.time + DT, { power: 0.8, surge: 0 });
        expect(turning.mind.mode).toBe('gait');
        run(turning.mind, turning.time + DT, 4, { power: 0.8, surge: 0 });
        expect(turning.mind.speed).toBeCloseTo(foxRunSpeed(0.8), 2);
        expect(turning.mind.pose.heading).toBeCloseTo(foxAt(WIDE, turning.mind.s)[2], 3);
    });
});

describe('winter fox mind: a clear', () => {
    it('makes it leave an idle act', () => {
        const { mind, time } = busyFox();
        const act = mind.pose.clip;
        expect(act).not.toBe('Run');
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
        const { mind, time } = busyFox();
        const act = mind.pose.clip;
        expect(act).not.toBe('Run');
        mind.pounce(time);
        mind.step(DT, time + DT, REST);
        expect(mind.mode).toBe('pounce');
        expect(mind.pose).toMatchObject({ clip: 'Pounce', from: act });
        // ...and before it had chosen one, while it was still turning to face the viewer.
        const turning = stoppedFox();
        turning.mind.pounce(turning.time);
        turning.mind.step(DT, turning.time + DT, REST);
        expect(turning.mind.pose).toMatchObject({ clip: 'Pounce', from: 'Run' });

        const sleeper = new FoxMind(WIDE);
        const dozed = run(sleeper, 0, 1);
        sleeper.sleep(dozed);
        const woken = run(sleeper, dozed, 4);
        expect(sleeper.pose.clip).toBe('CurlSleep');
        sleeper.pounce(woken);
        expect(sleeper.asleep).toBe(false);
        // (Up and away in one move: it does not stretch first.)
        expect(sleeper.act).toBeNull();
        sleeper.step(DT, woken + DT, REST);
        expect(sleeper.pose).toMatchObject({ clip: 'Pounce', from: 'CurlSleep' });
        expect(sleeper.mode).toBe('pounce');
        let landed = 0;
        run(sleeper, woken + DT, FOX_CLIPS.Pounce + 0.5, REST, (m) => { landed += landingsOf(m).length; });
        expect(landed).toBe(1);
        expect(sleeper.mode).toBe('gait');
        // However slowly it would leave what it was doing otherwise, a leap does not wait: the
        // fade into it is over before it is in the air.
        const sitter = rehearsing(['Sit']);
        const sat = run(sitter.mind, sitter.time, 2);
        sitter.mind.pounce(sat);
        const lier = new FoxMind(WIDE);
        lier.sleep(0);
        lier.pounce(run(lier, 0, 4));
        for (const leaper of [sitter.mind, lier]) {
            expect(leaper.blendTime).toBeGreaterThanOrEqual(FOX_BLEND);
            expect(leaper.blendTime).toBeLessThan(POUNCE_AIR[0]);
        }
    });

    it('opens its trot into a gallop over a stride or two, not at the instant its speed crosses a line', () => {
        const mind = new FoxMind(WIDE);
        expect(mind.pose.gallop).toBe(foxGallop(FOX_TROT));
        expect(mind.pose.gallop).toBe(0);
        let before = mind.pose.gallop;
        let most = 0;
        const watch = (m) => {
            expect(m.pose.gallop).toBeGreaterThanOrEqual(0);
            expect(m.pose.gallop).toBeLessThanOrEqual(1);
            most = Math.max(most, Math.abs(m.pose.gallop - before));
            before = m.pose.gallop;
        };
        // The chain at its height: a flat-out gallop, once it has had the strides to open into it.
        const lit = { power: 1, surge: 1 };
        let time = run(mind, 0, 0.5, lit, watch);
        expect(foxGallop(mind.speed)).toBeGreaterThan(mind.pose.gallop); // its legs are behind its speed
        time = run(mind, time, 8, lit, watch);
        expect(foxGallop(mind.speed)).toBe(1);
        expect(mind.pose.gallop).toBeGreaterThan(0.95);
        // Four lines: the leap takes its speed in hand outright, in the air and when it lands...
        mind.pounce(time);
        let jolt = 0;
        let pace = mind.speed;
        time = run(mind, time, FOX_CLIPS.Pounce + 3 * DT, lit, (m) => {
            watch(m);
            jolt = Math.max(jolt, Math.abs(foxGallop(m.speed) - foxGallop(pace)));
            pace = m.speed;
        });
        expect(jolt).toBeGreaterThan(0.3); // (the speed did cross the line at a bound)
        // ...and then the chain breaks, and it falls back to its trot.
        run(mind, time, 4, REST, watch);
        expect(foxGallop(mind.speed)).toBe(0);
        expect(mind.pose.gallop).toBeLessThan(0.05);
        // Through all of it its gait never changed by more than a small part in one step.
        expect(most).toBeGreaterThan(0);
        expect(most).toBeLessThan(0.1);
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
        // And there it stays, whatever burns: no step, no print, held where the act has it lying.
        const lay = mind.s;
        mind.sleep(down + 1); // already asleep: nothing starts over
        expect(mind.modeAt).toBe(tired);
        const slept = run(mind, down, 40, { power: 1, surge: 1 }, (m) => {
            expect(m.pose.clip).toBe('CurlSleep');
            expect(m.pose.clipTime).toBe(SLEEP_HOLD);
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

    it('lies down into its sleep and holds it: the act played to where it lies curled, and no further', () => {
        const mind = new FoxMind(WIDE);
        const tired = run(mind, 0, 2);
        mind.sleep(tired);
        const times = [];
        const lain = run(mind, tired, 6, REST, (m) => {
            if (m.pose.clip === 'CurlSleep') times.push(m.pose.clipTime);
        });
        // It came to a stand first, then went down: the act's time runs up to the hold and stops.
        expect(times.length).toBeGreaterThan(SLEEP_HOLD / DT);
        expect(times.length).toBeLessThan(6 / DT);
        times.forEach((t, i) => {
            expect(t).toBeGreaterThanOrEqual(i ? times[i - 1] : 0);
            expect(t).toBeLessThanOrEqual(SLEEP_HOLD);
        });
        expect(times[0]).toBeLessThan(0.1);
        expect(times[times.length - 1]).toBe(SLEEP_HOLD);
        expect(mind.pose).toMatchObject({ clip: 'CurlSleep', clipTime: SLEEP_HOLD, blend: 1 });
        // What the body makes of it: down on the snow, every paw tucked up, its tail let down.
        const spec = foxSpec(mind.pose);
        FOX_LEGS.forEach(([name], leg) => expect(carriedOf(spec, leg), name).toBe(1));
        expect(heightOf(solveFox(spec), 'hips')).toBeLessThan(heightOf(solveFox(createFoxSpec()), 'hips') * 0.6);
        expect(mind.pose.tailLift).toBeLessThan(0.01);
        expect(mind.pose.amp).toBeLessThan(1e-6);
        expect(mind.pose.step).toBeLessThan(1e-3);
        // It breathes, slow and deep: deeper than it does standing, a breath every few seconds.
        const breaths = [];
        run(mind, lain, 20, REST, (m) => breaths.push(m.pose.breath));
        const standing = [];
        const { mind: stood, time } = busyFox();
        run(stood, time, 1.2, REST, (m) => standing.push(m.pose.breath));
        expect(Math.max(...breaths)).toBeGreaterThan(Math.max(...standing.map(Math.abs)));
        expect(Math.min(...breaths)).toBeLessThan(-Math.max(...standing.map(Math.abs)));
        const turns = (list) => list.filter((b, i) => i > 0 && b * list[i - 1] < 0).length;
        expect(turns(breaths)).toBeGreaterThan(3);
        expect(turns(breaths)).toBeLessThan(20);
    });

    it('curls toward whoever is watching: nose round to its left when the viewer is on its left', () => {
        const sides = new Set();
        for (let k = 0; k < 12; k++) {
            const mind = placedFox((k + 0.5) / 12);
            mind.sleep(0);
            run(mind, 0, 4);
            expect(mind.pose.clip).toBe('CurlSleep');
            // Which side of it the viewer stands on, from where it lies and the way it lies.
            const { x, z, heading } = mind.pose;
            const toItsLeft = (EYE.x - x) * Math.cos(heading) - (EYE.z - z) * Math.sin(heading);
            const side = toItsLeft >= 0 ? 1 : -1;
            expect(mind.viewerSide(), `${k} twelfths round`).toBe(side);
            expect(mind.pose.side, `${k} twelfths round`).toBe(side);
            // And its body does as the pose says: its nose is brought round to that side, low.
            const nose = noseOf(mind);
            expect(Math.sign(nose[0]), `${k} twelfths round`).toBe(side);
            expect(Math.abs(nose[0])).toBeGreaterThan(0.1);
            expect(nose[1]).toBeLessThan(FOX_MARKS.nose[1] * 0.5);
            sides.add(side);
        }
        // (Its round has places of both kinds.)
        expect([...sides].sort()).toEqual([-1, 1]);
    });

    it('takes its time over lying down, sitting and digging, and a quarter second over the rest', () => {
        // A change of act cross-fades: none of the next at first, all of it a blend time later.
        const { mind, time } = rehearsing(['LookAround']);
        expect(mind.blendTime).toBe(FOX_BLEND);
        mind.step(DT, time + DT, REST);
        expect(mind.pose).toMatchObject({ clip: 'LookAround', from: 'Run' });
        expect(mind.pose.blend).toBeCloseTo(DT / FOX_BLEND, 9);
        const half = run(mind, time + DT, FOX_BLEND / 2);
        expect(mind.pose.blend).toBeCloseTo((half - time) / FOX_BLEND, 9);
        expect(mind.pose.blend).toBeGreaterThan(0.4);
        expect(mind.pose.blend).toBeLessThan(0.8);
        run(mind, half, FOX_BLEND);
        expect(mind.pose.blend).toBe(1);
        // Sitting down takes longer, and so does getting up out of it.
        const sitter = rehearsing(['Sit']);
        const sitting = sitter.mind.blendTime;
        expect(sitting).toBeGreaterThan(FOX_BLEND);
        const sat = run(sitter.mind, sitter.time, 2);
        sitter.mind.startle(1);
        sitter.mind.step(DT, sat + DT, REST);
        expect(sitter.mind.pose).toMatchObject({ clip: 'Run', from: 'Sit' });
        expect(sitter.mind.blendTime).toBe(sitting);
        expect(sitter.mind.pose.blend).toBeLessThan(DT / FOX_BLEND);
        // Going nose down into the snow: slower than a look about.
        expect(rehearsing(['Dig']).mind.blendTime).toBeGreaterThan(FOX_BLEND);
        // Lying down is the slowest of all, and waking is as slow.
        const sleeper = new FoxMind(WIDE);
        sleeper.sleep(0);
        const down = run(sleeper, 0, 3);
        const lying = sleeper.blendTime;
        expect(lying).toBeGreaterThan(sitting);
        sleeper.wake(down);
        expect(sleeper.blendTime).toBe(lying);
        sleeper.step(DT, down + DT, REST);
        expect(sleeper.pose.blend).toBeCloseTo(DT / lying, 9);
        // No blend is ever shorter than the quarter second, whatever follows what.
        const busy = new FoxMind(WIDE);
        let was = busy.clip;
        run(busy, 0, 120, REST, (m) => {
            if (m.clip !== was) expect(m.blendTime, `${was} to ${m.clip}`).toBeGreaterThanOrEqual(FOX_BLEND);
            was = m.clip;
        });
    });

    it('begins an act over again by fading from where it had got to, not by snapping to its start', () => {
        const { mind, time } = rehearsing(['LookAround']);
        const into = run(mind, time, FOX_CLIPS.LookAround * 0.3);
        const turned = foxSpec(mind.pose)[SPEC.headYaw];
        expect(Math.abs(turned)).toBeGreaterThan(0.3); // its head is well round by now
        const had = mind.pose.clipTime;
        mind.rehearse(['LookAround'], into);
        mind.step(DT, into + DT, REST);
        expect(mind.pose).toMatchObject({ clip: 'LookAround', from: 'LookAround' });
        expect(mind.pose.fromTime).toBeCloseTo(had, 9);
        expect(mind.pose.clipTime).toBeLessThan(2 * DT);
        expect(mind.pose.blend).toBeGreaterThan(0);
        expect(mind.pose.blend).toBeLessThan(0.2);
        // Its head is where it was a frame ago, to within what a frame may move it.
        expect(Math.abs(foxSpec(mind.pose)[SPEC.headYaw] - turned)).toBeLessThan(Math.abs(turned) * 0.2);
        // And a blend later it is doing the act from its beginning.
        const begun = run(mind, into + DT, mind.blendTime + DT);
        expect(mind.pose.blend).toBe(1);
        expect(mind.pose.clipTime).toBeCloseTo(begun - into, 9);
    });
});

describe('winter fox mind: its hunt', () => {
    it('listens, leaps, digs the snow out and shakes itself off', () => {
        const { mind, time } = rehearsing(MOUSING);
        const from = mind.s;
        const length = MOUSING.reduce((sum, clip) => sum + FOX_CLIPS[clip], 0);
        const events = [];
        const clips = [];
        let lift = 0;
        const done = run(mind, time, length + 1, REST, (m, now) => {
            m.events.forEach((event) => events.push({ ...event, clip: m.clip, at: now - time }));
            if (clips[clips.length - 1] !== m.clip) clips.push(m.clip);
            if (m.clip === 'Pounce') lift = Math.max(lift, m.pose.lift);
            else expect(m.pose.lift).toBe(0);
        });
        expect(clips).toEqual([...MOUSING, 'Run']);
        expect(mind.mode).toBe('gait');
        expect(done - time).toBeGreaterThan(length);
        const of = (type) => events.filter((event) => event.type === type);
        // It comes down once, softly, where the leap of its hunt ends...
        expect(of('land')).toHaveLength(1);
        expect(of('land')[0]).toMatchObject({ soft: true, clip: 'Pounce' });
        const before = MOUSING.slice(0, MOUSING.indexOf('Pounce')).reduce((sum, clip) => sum + FOX_CLIPS[clip], 0);
        expect(of('land')[0].at - before).toBeGreaterThan(POUNCE_AIR[1] - 2 * DT);
        expect(of('land')[0].at - before).toBeLessThan(POUNCE_AIR[1] + 3 * DT);
        // ...throws the snow out behind it a few scrapes a second while it digs...
        const digs = of('dig');
        expect(digs.length).toBeGreaterThanOrEqual(4);
        expect(digs.length).toBeLessThanOrEqual(10);
        digs.forEach((dig) => expect(dig.clip).toBe('Dig'));
        const gaps = digs.slice(1).map((dig, i) => dig.at - digs[i].at);
        expect(Math.max(...gaps)).toBeLessThan(Math.min(...gaps) + 2 * DT); // evenly
        expect(Math.max(...gaps)).toBeLessThan(0.5);
        // ...and shakes once, when the shaking begins.
        expect(of('shake')).toHaveLength(1);
        expect(of('shake')[0].clip).toBe('Shake');
        expect(of('shake')[0].at).toBeGreaterThan(digs[digs.length - 1].at);
        // Nothing else happens to the world but the prints it leaves when it trots on.
        expect(events.filter((event) => !['land', 'dig', 'shake', 'print'].includes(event.type))).toEqual([]);
        expect(of('print').every((event) => event.clip === 'Run')).toBe(true);
        // The leap carried it a little way, a low one: lower than four lines' pounce.
        expect(mind.s - from).toBeGreaterThan(0.3);
        expect(lift).toBeGreaterThan(0.1 * FOX_SCALE);
        const leaper = new FoxMind(WIDE);
        leaper.pounce(0);
        let high = 0;
        run(leaper, 0, FOX_CLIPS.Pounce, REST, (m) => { high = Math.max(high, m.pose.lift); });
        expect(lift).toBeLessThan(high);
    });

    it('digs without a hunt too, and throws no snow once it is getting up', () => {
        const { mind, time } = rehearsing(['Dig', 'Shake']);
        const digs = [];
        run(mind, time, FOX_CLIPS.Dig + FOX_CLIPS.Shake + 0.5, REST, (m) => {
            m.events.filter((event) => event.type === 'dig').forEach(() => digs.push([m.clip, m.clipTime]));
        });
        expect(digs.length).toBeGreaterThanOrEqual(4);
        // The snow flies only while its nose is down: its chest as low as the act ever has it.
        const low = foxAct(createFoxSpec(), 'Dig', 0)[SPEC.fore];
        expect(low).toBeGreaterThan(0);
        digs.forEach(([clip, t]) => {
            expect(clip).toBe('Dig');
            expect(foxAct(createFoxSpec(), 'Dig', t)[SPEC.fore], `${t.toFixed(2)} s into the dig`).toBeCloseTo(low, 9);
        });
        expect(foxAct(createFoxSpec(), 'Dig', FOX_CLIPS.Dig)[SPEC.fore]).toBeLessThan(low * 0.01);
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
        const flicked = run(mind, time + DT, 0.3, REST, (m) => {
            // (The swing is the pose's: what the body is given is what the sparks are thrown by.)
            expect(m.tailSwing()).toBe(m.pose.tailYaw);
            swing = Math.max(swing, Math.abs(m.tailSwing()));
        });
        expect(swing).toBeGreaterThan(0.3);
        run(mind, flicked, 3);
        expect(pose.flick).toBeLessThan(0.001);
        expect(Math.abs(mind.tailSwing())).toBeLessThan(0.2); // only its gait swings it now
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

    // (A regression: the mind once kept its own idea of where its tail was — a fixed point behind
    // it — and the sparks left from there: a third of a metre from the tail the rig drew at a
    // run, half a metre when it sat with its tail curled round it.)
    it('says its tail tip is where its body carries it: trotting, running, sitting, leaping', () => {
        const near = (mind, label) => {
            const said = mind.tail();
            const drawn = tailTipOf(mind);
            expect(Math.hypot(said[0] - drawn[0], said[1] - drawn[1], said[2] - drawn[2]), label).toBeLessThan(0.03);
        };
        const trotting = new FoxMind(WIDE);
        run(trotting, 0, 3, REST, (m) => near(m, 'at a trot'));
        const running = new FoxMind(WIDE);
        const lit = { power: 1, surge: 0 };
        run(running, run(running, 0, 4, lit), 7, lit, (m) => near(m, 'at a run'));
        // Running, its tail streams out higher than it hangs at a trot, and swings off its line
        // in a turn: the tip is not a fixed point behind it.
        const height = (mind) => mind.tail()[1] - mind.pose.y;
        expect(height(running)).toBeGreaterThan(height(trotting));
        const leaping = new FoxMind(WIDE);
        leaping.pounce(0);
        run(leaping, 0, FOX_CLIPS.Pounce, REST, (m) => near(m, 'in a leap'));
        // Sitting, its tail is curled round to the viewer's side, and that is where the tip is:
        // beside it, not out behind.
        for (const fraction of [0.15, 0.6]) {
            const { mind, time } = rehearsing(['Sit'], fraction);
            run(mind, time, FOX_CLIPS.Sit / 2, REST, (m) => near(m, 'sitting'));
            const tip = mind.tail();
            const { x, z, heading } = mind.pose;
            const beside = (tip[0] - x) * Math.cos(heading) - (tip[2] - z) * Math.sin(heading);
            const behind = -((tip[0] - x) * Math.sin(heading) + (tip[2] - z) * Math.cos(heading));
            expect(Math.sign(beside), `${fraction} of the way round`).toBe(mind.side);
            expect(Math.abs(beside)).toBeGreaterThan(0.2);
            expect(behind).toBeGreaterThan(0);
            expect(behind).toBeLessThan(0.48 * FOX_SCALE * 0.8);
            expect(tip[1]).toBeGreaterThan(mind.pose.y);
            // It writes where it is told to, and says the same again.
            const out = [0, 0, 0];
            expect(mind.tail(out)).toBe(out);
            expect(mind.tail()).toEqual(out);
        }
    });
});

describe('winter fox mind: changes of mind', () => {
    /** The acts it may be in the middle of, each a while into it and well away from a stand. */
    const MIDWAY = [['Sit', 3], ['Stretch', 0.8], ['Stretch', 1.75], ['Dig', 0.5], ['LookAround', 1], ['Listen', 1],
        ['Greet', 0.8], ['Shake', 0.4]];
    /** How high its hips are when it stands (model metres). */
    const STANDS = heightOf(solveFox(createFoxSpec()), 'hips');
    /** Startled as it went down to dig out of a look about: the three acts its pose then holds. */
    const UP_FROM_DIG = Object.freeze({ clip: 'Run', from: 'Dig', was: 'LookAround' });

    // (A regression: the run over while it was in the middle of something, it spent 0.9 s
    // "slowing its gait" with the act's own clock overwritten by the gait's — a sitting fox was
    // on its feet in a frame — and curled to its right it then had the act's head thrown over
    // to the other side. It now lies down out of whatever it is doing, from where it had got to.)
    it('lies down out of whatever it was doing when the run ends: no snap, and all the way down', () => {
        const sides = new Set();
        MIDWAY.forEach(([clip, into]) => {
            for (const fraction of [0.15, 0.6]) {
                const { mind, time } = rehearsing([clip], fraction);
                const label = `${into} s into ${clip}, ${fraction} of the way round`;
                const tired = run(mind, time, into);
                const watch = bodyWatch();
                watch.see(mind);
                const had = mind.pose.clipTime;
                mind.sleep(tired);
                mind.step(DT, tired + DT, REST);
                watch.see(mind);
                // At once, from the act where it had got to in it: not from its beginning, and
                // not after a moment of pretending to trot.
                expect(mind.pose, label).toMatchObject({ clip: 'CurlSleep', from: clip });
                expect(mind.pose.fromTime, label).toBeCloseTo(had, 9);
                expect(mind.pose.blend, label).toBeLessThan(0.1);
                const down = run(mind, tired + DT, 4, REST, (m) => watch.see(m));
                expect(watch.turn, label).toBeLessThan(20);
                // And it does not stay half-way: it is down, curled and held, however it began.
                expect(mind.pose, label).toMatchObject({ clip: 'CurlSleep', clipTime: SLEEP_HOLD, blend: 1 });
                expect(mind.pose.eyes, label).toBe(1);
                expect(heightOf(bodyOf(mind), 'hips'), label).toBeLessThan(STANDS * 0.6);
                expect(Math.sign(noseOf(mind)[0]), label).toBe(mind.side);
                expect(down).toBeGreaterThan(tired);
                sides.add(mind.side);
            }
        });
        expect([...sides].sort()).toEqual([-1, 1]);
        // Still turning to face the viewer, or under way, its gait is what it lies down out of:
        // it slows to a stand first, and then goes down as smoothly.
        const turning = stoppedFox();
        run(turning.mind, turning.time, 0.3);
        const under = new FoxMind(WIDE);
        run(under, 0, 2);
        [[turning.mind, turning.time + 0.3], [under, 2]].forEach(([mind, now]) => {
            const watch = bodyWatch();
            watch.see(mind);
            mind.sleep(now);
            const slowing = run(mind, now, 0.5, REST, (m) => watch.see(m));
            expect(mind.pose.clip).toBe('Run');
            run(mind, slowing, 4, REST, (m) => watch.see(m));
            expect(watch.turn).toBeLessThan(20);
            expect(mind.pose).toMatchObject({ clip: 'CurlSleep', clipTime: SLEEP_HOLD, blend: 1 });
        });
    });

    // (A regression: a pose held two acts, so a change that came half-way through another dropped
    // the act it had been leaving. A sleeper woken and at once set running, startled or sent
    // leaping was on its feet in one frame; so was a fox startled as it went nose down to dig.)
    it('changes its mind half-way through a change without a snap: three acts in one pose', () => {
        const next = {
            'the chain': () => {},
            'a clear': (mind) => mind.startle(1),
            'four lines': (mind, now) => mind.pounce(now),
            'the run ending again': (mind, now) => mind.sleep(now),
        };
        for (const after of [0.05, 0.2, 0.4, 0.7]) {
            Object.entries(next).forEach(([what, happen]) => {
                const mind = placedFox(0.15);
                mind.sleep(0);
                const woke = run(mind, 0, 5);
                const watch = bodyWatch();
                watch.see(mind);
                mind.wake(woke);
                const changed = run(mind, woke, after, REST, (m) => watch.see(m));
                const label = `woken, then ${what} ${after} s later`;
                // It is half-way from its sleep to its stretch: two acts, and no third yet.
                expect(mind.pose, label).toMatchObject({ clip: 'Stretch', from: 'CurlSleep', was: null });
                expect(mind.pose.blend, label).toBeLessThan(1);
                const { blendAt, blendTime } = mind;
                happen(mind, changed);
                const env = what === 'the chain' ? { power: 0.5, surge: 0 } : REST;
                // (The chain takes a step to be felt: it leaves what it is doing, then it runs.)
                let now = changed;
                do {
                    now += DT;
                    mind.step(DT, now, env);
                    watch.see(mind);
                } while (mind.pose.clip === 'Stretch' && now < changed + 4 * DT);
                // Now it is three: what it does, the stretch it had begun, the sleep it was leaving
                // — held as far from it as it had come when it changed its mind.
                expect(mind.pose, label).toMatchObject({ from: 'Stretch', was: 'CurlSleep' });
                expect(mind.pose.clip, label).not.toBe('Stretch');
                const come = Math.min(1, ((what === 'four lines' ? changed : now) - blendAt) / blendTime);
                expect(mind.pose.hold, label).toBeCloseTo(come * come * (3 - 2 * come), 9);
                expect(mind.pose.hold, label).toBeGreaterThan(0);
                expect(mind.pose.hold, label).toBeLessThan(1);
                run(mind, now, 0.4, env, (m) => watch.see(m));
                expect(watch.turn, label).toBeLessThan(NO_SNAP);
            });
        }
        // As it goes nose down to dig, a clear: it comes up out of as much of the dig as it was in.
        for (const after of [0.05, 0.15, 0.3]) {
            const { mind, time } = rehearsing(['LookAround']);
            const stood = run(mind, time, 1);
            const watch = bodyWatch();
            mind.rehearse(['Dig'], stood);
            const digging = run(mind, stood, after, REST, (m) => watch.see(m));
            mind.startle(1);
            run(mind, digging, 0.4, REST, (m) => watch.see(m));
            expect(mind.pose, `${after} s into going down`).toMatchObject(UP_FROM_DIG);
            expect(watch.turn, `${after} s into going down`).toBeLessThan(NO_SNAP);
        }
        // A change that comes when the last is done is two acts again: nothing is held for ever.
        const settled = rehearsing(['Sit']);
        const sat = run(settled.mind, settled.time, 2);
        settled.mind.startle(1);
        settled.mind.step(DT, sat + DT, REST);
        expect(settled.mind.pose).toMatchObject({ clip: 'Run', from: 'Sit', was: null });
    });

    // (A regression: four lines on a sleeping fox woke it into a stretch and leapt out of that in
    // the same breath — the curled fox was standing in one frame, its tail thrown 175° round.)
    it('leaps straight out of its sleep, and gathers itself again if it is sent leaping in mid-leap', () => {
        const sleeper = placedFox(0.15);
        sleeper.sleep(0);
        const lay = run(sleeper, 0, 5);
        const watch = bodyWatch();
        watch.see(sleeper);
        sleeper.pounce(lay);
        let landings = 0;
        run(sleeper, lay, FOX_CLIPS.Pounce, REST, (m) => {
            watch.see(m);
            landings += landingsOf(m).length;
        });
        expect(watch.turn).toBeLessThan(NO_SNAP);
        expect(landings).toBe(1);
        // Twice, 0.8 s apart: the second finds it at the top of the first. It begins the leap
        // over again from where it is — one act, at two times — comes down no faster than it
        // would fall, and lands once.
        const leaper = new FoxMind(WIDE);
        const first = run(leaper, 0, 1);
        const twice = bodyWatch();
        leaper.pounce(first);
        const again = run(leaper, first, 0.8, REST, (m) => twice.see(m));
        const top = leaper.pose.lift;
        expect(top).toBeGreaterThan(0.5);
        const { clipTime } = leaper.pose;
        leaper.pounce(again);
        leaper.step(DT, again + DT, REST);
        twice.see(leaper);
        expect(leaper.pose).toMatchObject({ clip: 'Pounce', from: 'Pounce' });
        expect(leaper.pose.fromTime).toBeCloseTo(clipTime, 9);
        expect(leaper.pose.clipTime).toBeLessThan(2 * DT);
        expect(leaper.pose.lift).toBeGreaterThan(top * 0.8); // not on the snow in one frame
        landings = 0;
        const heights = [];
        const done = run(leaper, again + DT, FOX_CLIPS.Pounce + 0.3, REST, (m) => {
            twice.see(m);
            landings += landingsOf(m).length;
            heights.push(m.pose.lift);
        });
        expect(twice.turn).toBeLessThan(NO_SNAP);
        expect(twice.drop).toBeLessThan(0.15);
        expect(landings).toBe(1);
        // Down to the snow, gathered, and up again as high as the first time.
        expect(Math.min(...heights.slice(0, Math.round(POUNCE_AIR[0] / DT)))).toBe(0);
        expect(Math.max(...heights)).toBeGreaterThan(top * 0.9);
        expect(leaper.mode).toBe('gait');
        expect(leaper.pose.lift).toBe(0);
        expect(done).toBeGreaterThan(again);
    });

    // (A regression: how high it was, was read off the act it was in — so a leap cut short at its
    // top, by the run ending or by anything else, put the fox on the snow in one frame.)
    it('comes down from a leap cut short at its top as it would fall, never in one frame', () => {
        const cuts = {
            'the run ending': (mind, now) => mind.sleep(now),
            'being stopped to sit': (mind, now) => mind.rehearse(['Sit'], now),
        };
        Object.entries(cuts).forEach(([what, cut]) => {
            const mind = new FoxMind(WIDE);
            const from = run(mind, 0, 1);
            const watch = bodyWatch();
            mind.pounce(from);
            const top = run(mind, from, (POUNCE_AIR[0] + POUNCE_AIR[1]) / 2, REST, (m) => watch.see(m));
            const height = mind.pose.lift;
            expect(height, what).toBeGreaterThan(0.5);
            const flying = mind.speed;
            cut(mind, top);
            const falling = [];
            const places = [mind.s];
            run(mind, top, 1.5, REST, (m) => {
                watch.see(m);
                falling.push(m.pose.lift);
                places.push(m.s);
            });
            // Lower every step until it is down, and no step a long way.
            expect(falling[0], what).toBeGreaterThan(height * 0.8);
            const landed = falling.indexOf(0);
            expect(landed, what).toBeGreaterThan(4);
            expect(landed * DT, what).toBeLessThan(0.5);
            falling.slice(0, landed).forEach((lift, i) => expect(lift, what).toBeLessThan(i ? falling[i - 1] : height));
            expect(falling.slice(landed).every((lift) => lift === 0), what).toBe(true);
            expect(watch.drop, what).toBeLessThan(0.15);
            expect(watch.turn, what).toBeLessThan(NO_SNAP);
            expect(mind.pose.clip, what).not.toBe('Pounce');
            // (A regression: put to sleep in the air it stopped dead and fell straight down.) The
            // run ending under it, it comes down where its leap was taking it: on, every step it
            // is in the air, slower each time, and no further once it is down.
            if (what !== 'the run ending') return;
            const on = places.slice(1).map((s, i) => s - places[i]);
            expect(flying).toBeGreaterThan(2);
            on.slice(0, landed - 1).forEach((step, i) => {
                expect(step, `step ${i}`).toBeGreaterThan(0);
                expect(step, `step ${i}`).toBeLessThan(i ? on[i - 1] : flying * DT);
            });
            expect(places[landed] - places[0]).toBeGreaterThan(flying * DT * 3);
            expect(places[places.length - 1]).toBe(places[landed + 1]);
        });
        // A whole leap never falls faster than that either: its own arc is the gentler.
        const whole = new FoxMind(WIDE);
        const watch = bodyWatch();
        whole.pounce(0);
        run(whole, 0, FOX_CLIPS.Pounce, REST, (m) => watch.see(m));
        expect(watch.drop).toBeGreaterThan(0.02);
        expect(watch.drop).toBeLessThan(0.15);
        expect(whole.pose.lift).toBe(0);
    });

    // (A regression: woken, it turned on the spot to face the viewer while it was still curled up
    // — half a radian in the first fifth of a second, its feet "stepping" in the air under it.)
    it('wakes as it lay: it does not turn on the spot under its own stretch', () => {
        for (const fraction of [0.1, 0.3, 0.5, 0.7]) {
            const mind = placedFox(fraction);
            mind.sleep(0);
            const slept = run(mind, 0, 6);
            const { heading } = mind.pose;
            const watch = bodyWatch();
            watch.see(mind);
            mind.wake(slept);
            run(mind, slept, FOX_CLIPS.Stretch - 2 * DT, REST, (m) => {
                watch.see(m);
                expect(m.toFace()).toBe(0);
                expect(m.face).toBe(0);
                expect(Math.abs(m.pose.heading - heading)).toBeLessThan(1e-9);
                expect(m.pose.step).toBe(0);
            });
            expect(mind.pose.clip, `${fraction} of the way round`).toBe('Stretch');
            expect(watch.swing).toBeLessThan(1e-9);
            expect(watch.turn, `${fraction} of the way round`).toBeLessThan(20);
        }
    });

    // (A regression: a shake that began between two steps — a rehearsal that opens with one — was
    // wiped with the last step's events before the world saw it, and no snow flew.)
    it('tells the world of what began between steps with the next step, once', () => {
        const { mind, time } = rehearsing(['Shake']);
        mind.step(DT, time + DT, REST);
        expect(mind.events.filter((event) => event.type === 'shake')).toHaveLength(1);
        mind.step(DT, time + 2 * DT, REST);
        expect(mind.events.filter((event) => event.type === 'shake')).toHaveLength(0);
        // Inside a step it is told at once, as ever: a shake an act list comes to.
        const digger = rehearsing(['Dig', 'Shake']);
        const shakes = [];
        run(digger.mind, digger.time, FOX_CLIPS.Dig + 0.5, REST, (m, now) => {
            m.events.filter((event) => event.type === 'shake').forEach(() => shakes.push([now - digger.time, m.clip]));
        });
        expect(shakes).toHaveLength(1);
        expect(shakes[0][1]).toBe('Shake');
        expect(shakes[0][0]).toBeGreaterThan(FOX_CLIPS.Dig - DT);
        // And a reset forgets what was waiting to be told.
        const forgetful = rehearsing(['Shake']);
        forgetful.mind.reset(forgetful.time);
        forgetful.mind.step(DT, forgetful.time + DT, REST);
        expect(forgetful.mind.events.filter((event) => event.type === 'shake')).toHaveLength(0);
    });
});

describe('winter fox mind: how its body carries it', () => {
    /** What the rig is given beyond its place and its act. */
    const CARRIED = [
        'phase', 'amp', 'step', 'side', 'lean', 'nod', 'lookYaw', 'lookPitch', 'tailYaw', 'tailLift', 'breath', 'eyes',
    ];

    it('resolves a pose of plain numbers, with everything its body reads off it', () => {
        const mind = new FoxMind(WIDE);
        const { pose } = mind;
        const keys = Object.keys(pose);
        expect(keys).toEqual(expect.arrayContaining([
            'x', 'y', 'z', 'heading', 'lift', 'clip', 'clipTime', 'from', 'fromTime', 'blend', 'was', 'wasTime', 'hold',
            'flick', 'glow', 'speed', ...CARRIED,
        ]));
        // (What the clips once needed laid over them — a bob, a rock — its gait now does itself.)
        expect(keys).not.toContain('bob');
        expect(keys).not.toContain('rock');
        // Whatever the rig reads off a pose, the mind fills in: nothing falls back on a default.
        const rig = themeSource('shared', 'fox-rig.js');
        const body = rig.slice(rig.indexOf('const specOf = '), rig.indexOf('// ── Solving a spec'));
        const read = [...new Set([...body.matchAll(/\bp\.(\w+)/g)].map((m) => m[1]))];
        expect(read.length).toBeGreaterThan(12);
        read.forEach((name) => expect(keys, `the rig reads p.${name}`).toContain(name));
        // Through a night of everything, every number of it stays a number, and in its range.
        const wrong = [];
        const within = (key, lo, hi) => pose[key] >= lo && pose[key] <= hi;
        const ACTS_OF_IT = ['clip', 'from', 'was'];
        /** An act by name; `was`, the third it may be leaving, is none most of the time. */
        const named = (key) => FOX_CLIPS[pose[key]] > 0 || (key === 'was' && pose.was === null);
        const check = (m, now) => {
            const sound = m.pose === pose
                && Object.keys(pose).length === keys.length
                && keys.every((key) => (ACTS_OF_IT.includes(key) ? named(key) : Number.isFinite(pose[key])))
                && ['blend', 'hold', 'amp', 'step', 'gallop', 'eyes'].every((key) => within(key, 0, 1))
                && pose.wasTime >= 0
                && Math.abs(pose.side) === 1
                && within('clipTime', 0, FOX_CLIPS[pose.clip] + DT)
                && pose.lift >= 0
                && pose.amp === foxGaitAmp(pose.speed)
                // Nothing of it would tip the animal over or wring its neck.
                && within('lean', -0.6, 0.6)
                && within('nod', -0.4, 0.4)
                && within('lookYaw', -1.6, 1.6)
                && within('lookPitch', -1.2, 1.2)
                && within('breath', -2.5, 2.5);
            if (!sound) wrong.push({ at: now, mode: m.mode, ...pose });
        };
        let time = run(mind, 0, 30, REST, check);
        mind.attend(4, 9, -30, time + 2);
        time = run(mind, time, 5, { power: 0.6, surge: 0 }, check);
        mind.startle(1.3);
        mind.flickTail(1);
        time = run(mind, time, 3, { power: 1, surge: 1.4 }, check);
        mind.pounce(time);
        time = run(mind, time, 4, { power: 0.3, surge: 0.5 }, check);
        mind.sleep(time);
        time = run(mind, time, 5, REST, check);
        mind.wake(time);
        run(mind, time, 20, REST, check);
        expect(wrong.slice(0, 3)).toEqual([]);
    });

    it('shortens its stride to a halt instead of running on the spot', () => {
        expect(foxGaitAmp(0)).toBe(0);
        expect(foxGaitAmp(FOX_TROT)).toBe(1);
        expect(foxGaitAmp(foxRunSpeed(1, 1.4))).toBe(1);
        expect(foxGaitAmp(-1)).toBe(0);
        let last = 0;
        for (let speed = 0; speed <= FOX_TROT; speed += 0.01) {
            expect(foxGaitAmp(speed)).toBeGreaterThanOrEqual(last);
            last = foxGaitAmp(speed);
        }
        // Its gait turns over with the ground it covers: a cycle a stride, whatever its pace.
        for (const power of [0, 0.4, 1]) {
            const mind = new FoxMind(WIDE);
            const settled = run(mind, 0, 3, { power, surge: 0 });
            const from = { s: mind.s, phase: mind.phase };
            run(mind, settled, 1, { power, surge: 0 });
            expect(mind.pose.phase).toBe(mind.phase);
            expect((mind.phase - from.phase) * foxStride(mind.speed), `power ${power}`).toBeCloseTo(mind.s - from.s, 1);
        }
    });

    it('leans and looks into a turn at a run, the more the faster, and streams its tail out behind', () => {
        /** A fifth of a second: over how long its path's turning is taken (the round has corners). */
        const SPAN = 12;
        const lap = (power) => {
            const mind = new FoxMind(WIDE);
            const rows = [];
            const env = { power, surge: 0 };
            run(mind, run(mind, 0, 4, env), 30, env, (m) => {
                rows.push({
                    heading: m.pose.heading, lean: m.pose.lean, look: m.pose.lookYaw, tailLift: m.pose.tailLift,
                });
            });
            // How fast its path turns under it (rad/s, + to its left): it faces the way it goes.
            rows.forEach((row, i) => {
                row.rate = i < SPAN ? 0 : wrap(row.heading - rows[i - SPAN].heading) / (SPAN * DT);
            });
            return rows;
        };
        const most = (rows, key) => Math.max(...rows.map((row) => Math.abs(row[key])));
        const fast = lap(1);
        const slow = lap(0.2);
        // Where its round turns hard, it leans the way it turns and looks where it is going.
        const turning = fast.filter((row) => Math.abs(row.rate) > 0.5 * most(fast, 'rate'));
        expect(turning.length).toBeGreaterThan(30);
        const into = turning.filter((row) => row.lean * row.rate > 0 && row.look * row.rate > 0);
        expect(into.length).toBeGreaterThan(turning.length * 0.9);
        // The faster, the further over — and the higher it carries its tail.
        expect(most(slow, 'lean')).toBeGreaterThan(0.01);
        expect(most(fast, 'lean')).toBeGreaterThan(most(slow, 'lean'));
        const carried = (rows) => rows.map((row) => row.tailLift);
        expect(Math.min(...carried(fast))).toBeGreaterThan(Math.max(...carried(slow)));
        // And what the rig makes of a lean: the shoulder on the inside of the turn is the lower.
        const body = solveFox(foxSpec({
            clip: 'Run', from: 'Run', amp: 0, lean: 0.2,
        }));
        expect(heightOf(body, 'armL')).toBeLessThan(heightOf(body, 'armR'));
    });

    it('dips its nose as it brakes and lifts it as it springs away', () => {
        const steady = new FoxMind(WIDE);
        const time = run(steady, 0, 3);
        expect(Math.abs(steady.pose.nod)).toBeLessThan(1e-6);
        expect(Math.abs(steady.pose.lean)).toBeLessThan(0.1);
        // Braking for a stopping place...
        let dipped = 0;
        runUntil(steady, time, (m) => {
            dipped = Math.max(dipped, m.pose.nod);
            return m.mode === 'idle';
        });
        expect(dipped).toBeGreaterThan(1e-3);
        // ...and a dash out of a trot.
        const dasher = new FoxMind(WIDE);
        const from = run(dasher, 0, 1);
        dasher.startle(1.4);
        let lifted = 0;
        run(dasher, from, 0.6, REST, (m) => { lifted = Math.min(lifted, m.pose.nod); });
        expect(lifted).toBeLessThan(-0.02);
        expect(Math.abs(lifted)).toBeGreaterThan(dipped); // it springs harder than it brakes
        // Standing, it neither leans nor nods.
        const { mind: stood, time: chose } = busyFox();
        run(stood, chose, 1.5);
        expect(Math.abs(stood.pose.nod)).toBeLessThan(0.01);
        expect(Math.abs(stood.pose.lean)).toBeLessThan(0.01);
    });

    it('turns its head toward what it is told to attend to, for as long as it is told', () => {
        /** A point `ahead` metres before it and `left` metres to its left, `up` metres above the snow. */
        const pointBy = (mind, ahead, left, up) => {
            const {
                x, y, z, heading,
            } = mind.pose;
            return [
                x + Math.sin(heading) * ahead + Math.cos(heading) * left,
                y + up,
                z + Math.cos(heading) * ahead - Math.sin(heading) * left,
            ];
        };
        const looking = (left, up, weight) => {
            const mind = new FoxMind(WIDE);
            const twin = new FoxMind(WIDE);
            const time = run(mind, 0, 2);
            run(twin, 0, 2);
            mind.attend(...pointBy(mind, 60, left, up), time + 1.5, weight);
            const during = run(mind, time, 1);
            run(twin, time, 1);
            const look = { yaw: mind.pose.lookYaw - twin.pose.lookYaw, pitch: mind.pose.lookPitch, nose: noseOf(mind) };
            // Told nothing more, it lets go: a while after, it carries its head as it would have.
            run(mind, during, 3);
            run(twin, during, 3);
            expect(mind.pose.lookYaw).toBeCloseTo(twin.pose.lookYaw, 3);
            expect(mind.pose.lookPitch).toBeCloseTo(0, 3);
            // (And nothing else about it changed: it went where it would have gone.)
            expect(mind.s).toBe(twin.s);
            return look;
        };
        const leftUp = looking(60, 50, 1);
        expect(leftUp.yaw).toBeGreaterThan(0.2); // + is to its left
        expect(leftUp.pitch).toBeGreaterThan(0.2); // + is up
        expect(leftUp.nose[0]).toBeGreaterThan(0.05);
        expect(leftUp.nose[1]).toBeGreaterThan(FOX_MARKS.nose[1]);
        const right = looking(-60, 0, 1);
        expect(right.yaw).toBeLessThan(-0.2);
        expect(right.nose[0]).toBeLessThan(-0.05);
        // Half the attention, half the turn.
        const glance = looking(60, 50, 0.5);
        expect(glance.yaw).toBeGreaterThan(0);
        expect(glance.yaw).toBeLessThan(leftUp.yaw * 0.75);
        // An act that moves its head itself is left to: digging, it does not look up...
        const digger = rehearsing(['Dig']);
        digger.mind.attend(...pointBy(digger.mind, 60, 60, 50), digger.time + 9);
        run(digger.mind, digger.time, 1);
        expect(Math.abs(digger.mind.pose.lookYaw)).toBeLessThan(0.02);
        expect(Math.abs(digger.mind.pose.lookPitch)).toBeLessThan(0.02);
        // ...sitting (and facing the viewer by now), it turns its head part of the way.
        const sitter = rehearsing(['Sit']);
        const sat = sitter.mind;
        const facing = run(sat, sitter.time, 3);
        const point = pointBy(sat, 60, 60, 50);
        sat.attend(...point, facing + 9);
        run(sat, facing, 1.5);
        const bearing = wrap(Math.atan2(point[0] - sat.pose.x, point[2] - sat.pose.z) - sat.pose.heading);
        expect(bearing).toBeGreaterThan(0.5);
        expect(sat.pose.lookYaw).toBeGreaterThan(0.05);
        expect(sat.pose.lookYaw).toBeLessThan(bearing * 0.9);
    });
});

describe('winter fox mind: its eyes', () => {
    it('blinks now and then, by the clock', () => {
        const mind = new FoxMind(WIDE);
        // The same fox doing something else entirely, and another fox.
        const running = new FoxMind(WIDE);
        const other = new FoxMind(WIDE, 0xbeef);
        const seen = [];
        const others = [];
        run(mind, 0, 120, REST, (m, time) => {
            running.step(DT, time, { power: 1, surge: 0 });
            other.step(DT, time, REST);
            expect(m.pose.eyes).toBeGreaterThanOrEqual(0);
            expect(m.pose.eyes).toBeLessThanOrEqual(1);
            // When it blinks is read off the clock: whatever it is doing, it blinks the same.
            expect(running.pose.eyes).toBe(m.pose.eyes);
            seen.push([time, m.pose.eyes]);
            others.push(other.pose.eyes);
        });
        const shut = seen.map(([, eyes]) => eyes);
        // (Open is open: exactly 0 between blinks, not the hair off it a sine ends on — the
        // shader's lid is drawn from this number.)
        const closed = shut.map((eyes) => eyes > 0);
        expect(Math.min(...shut.filter((eyes) => eyes > 0))).toBeGreaterThan(1e-6);
        const blinks = closed.filter((is, i) => is && !closed[i - 1]).length;
        // Every few seconds, each over in a moment, each shut right over.
        expect(blinks).toBeGreaterThan(12);
        expect(blinks).toBeLessThan(120);
        expect(closed.filter(Boolean).length / closed.length).toBeLessThan(0.15);
        let longest = 0;
        let open = 0;
        let length = 0;
        let gap = 0;
        closed.forEach((is) => {
            length = is ? length + 1 : 0;
            gap = is ? 0 : gap + 1;
            longest = Math.max(longest, length);
            open = Math.max(open, gap);
        });
        expect(longest * DT).toBeLessThan(0.4);
        expect(open * DT).toBeLessThan(12); // it never stares for long
        expect(Math.max(...shut)).toBeGreaterThan(0.95);
        // Eased shut and open, not flicked: a frame's change is a part of the whole.
        expect(Math.max(...shut.map((eyes, i) => (i ? Math.abs(eyes - shut[i - 1]) : 0)))).toBeLessThan(0.5);
        // Another fox blinks at its own moments.
        expect(others).not.toEqual(shut);
        // A seek blinks the same: the pose resolved again for a moment has the eyes of that moment.
        const now = seen[seen.length - 1][0];
        seen.filter((_, i) => i % 7 === 0).forEach(([time, eyes]) => expect(mind.resolve(time).eyes).toBe(eyes));
        mind.resolve(now);
        const again = new FoxMind(WIDE);
        again.reset(50);
        const at = 50 + 600 * DT;
        run(again, 50, 600 * DT);
        expect(again.pose.eyes).toBe(mind.resolve(at).eyes);
        mind.resolve(now);
    });

    it('shuts them as it falls asleep, keeps them shut, and opens them when it wakes', () => {
        const mind = new FoxMind(WIDE);
        const twin = new FoxMind(WIDE);
        const tired = run(mind, 0, 2);
        run(twin, 0, 2);
        mind.sleep(tired);
        // Not at once: it lies down first, and its eyes close as it settles. They are never
        // wider open than a blink has them.
        const closing = [];
        const down = run(mind, tired, 3, REST, (m, time) => {
            twin.step(DT, time, REST);
            expect(m.pose.eyes).toBeGreaterThanOrEqual(twin.pose.eyes);
            closing.push(m.pose.eyes);
        });
        expect(Math.min(...closing.slice(0, 30))).toBe(0);
        closing.slice(-30).forEach((eyes, i, last) => expect(eyes).toBeGreaterThanOrEqual(i ? last[i - 1] : 0.5));
        expect(mind.pose.eyes).toBe(1);
        const slept = run(mind, down, 30, REST, (m) => expect(m.pose.eyes).toBe(1));
        mind.wake(slept);
        const waking = [];
        run(mind, slept, 2, REST, (m, time) => {
            twin.step(DT, time, REST);
            waking.push(m.pose.eyes === twin.pose.eyes);
        });
        expect(waking.every(Boolean)).toBe(true);
    });
});

describe('winter fox mind: replay', () => {
    /** A night's worth of everything the board can do to it, from `from`; every step's events. */
    function night(mind, from) {
        const log = [];
        const keep = (m, time) => m.events.forEach((event) => log.push({ ...event, at: time }));
        let time = run(mind, from, 3, REST, keep);
        mind.attend(3, 12, -40, time + 2, 0.8);
        time = run(mind, time, 4, { power: 0.5, surge: 0 }, keep);
        mind.flickTail(0.8);
        mind.startle(1.2);
        time = run(mind, time, 2, { power: 0.9, surge: 0.6 }, keep);
        mind.pounce(time);
        time = run(mind, time, 3, { power: 0.2, surge: 0.3 }, keep);
        time = run(mind, time, 25, REST, keep); // long enough to stop, face the viewer and choose an act
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
        // What its body carries from one step to the next: its facing, its feet, its tail's spring.
        body: [mind.face, mind.stepping, mind.side, mind.turn, mind.tailVel, mind.blendTime, mind.attending],
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
        expect(first.log.filter((event) => event.type === 'land' && !event.soft)).toHaveLength(1);
        expect(first.log.filter((event) => event.type === 'print').length).toBeGreaterThan(50);
        // And every number of the pose it ended in is a number: nothing its body is given went astray.
        Object.entries(a.pose).forEach(([key, value]) => {
            if (typeof value === 'number') expect(Number.isFinite(value), key).toBe(true);
        });
    });

    it('resolves the same pose again for the same moment: a frame drawn twice moves nothing', () => {
        const mind = new FoxMind(WIDE);
        const time = run(mind, 0, 9);
        const once = { ...mind.pose };
        expect({ ...mind.resolve(time) }).toEqual(once);
        expect({ ...mind.resolve(time) }).toEqual(once);
        // A frame drawn twice — a frozen-time capture, a paused game — moves nothing.
        mind.step(0, time, REST);
        expect({ ...mind.pose }).toEqual(once);
        expect(mind.events).toHaveLength(0);
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
        const acts = (seed, seconds = 240) => {
            const mind = new FoxMind(WIDE, seed);
            const chosen = [];
            let had = null;
            run(mind, 0, seconds, REST, (m) => {
                // (It chooses once it has faced the viewer, not the moment it pulls up.)
                if (m.mode === 'idle' && m.act && m.act !== had) chosen.push(m.act.join('+'));
                had = m.mode === 'idle' ? m.act : null;
            });
            return chosen;
        };
        const mine = acts(0xf0c5);
        expect(mine.length).toBeGreaterThan(3);
        expect(acts(0xf0c5)).toEqual(mine);
        expect(new FoxMind(WIDE).seed).toBe(0xf0c5); // the seed it has when given none
        // Another seed, another night: not every fox does the same things in the same order.
        const nights = [0xf0c5, 1, 2, 3].map((seed) => acts(seed, 120).join(' | '));
        expect(new Set(nights).size).toBeGreaterThan(1);
        // Whatever it chooses, it is something it does standing, and its hunt is among them.
        const all = [0xf0c5, 1, 2, 3].flatMap((seed) => acts(seed, 120));
        all.forEach((act) => act.split('+').forEach((clip) => {
            expect(clip === 'Pounce' || STANDING.includes(clip), act).toBe(true);
        }));
        expect(all).toContain(MOUSING.join('+'));
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
