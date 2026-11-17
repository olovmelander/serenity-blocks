/**
 * Waves — what the sea life does (waves-acts.js), on the CPU.
 *
 * An act is a handful of numbers written once, and `actPose` says where its animal is at any
 * moment of the world's clock: a closed form, so nothing here steps anything. The tests ask each
 * kind of act for its pose all through its life and hold what must stay true of it: a pose is
 * finite, its heading and its back are directions square to each other, an animal in the air has
 * no water over it, the moments an act lists are the moments its animal breaks the surface.
 *
 * The speeds, heights and lengths are tuned by eye and keep moving: every number the tests need is
 * read from the module or from the act itself.
 *
 * The sweeps collect what is wrong and assert once.
 */
import { describe, expect, it } from 'vitest';
import {
    FLUKE_REACH, GRAVITY, KINDS, LEAP_STYLES, NOSE_REACH, RIDE_CLEARANCE, SPECIES, WHALE_MODES, actAlive, actPose,
    dolphinPose, emptyPose, makeLeap, makePorpoise, makeRide, makeSoar, makeWhale, porpoiseAt, surfaceTimes, troughRow,
} from '../../src/themes/waves/waves-acts.js';
import {
    TAU, WAVE, axisOffset, mulberry32, wavePoint,
} from '../../src/themes/waves/waves-core.js';

/** What a pose is made of (waves-fauna.js writes exactly these to the GPU). */
const POSE = [
    'x', 'y', 'z', 'fx', 'fy', 'fz', 'ux', 'uy', 'uz', 'metres', 'phase', 'beat', 'arch', 'spread', 'depth', 'variant',
];
const pick = (pose) => Object.fromEntries(POSE.map((key) => [key, pose[key]]));

/** The pose `t` seconds into an act (a fresh one every time). */
const at = (act, t, open = 0) => actPose(act, act.t0 + t, open);

const dot = (a, b) => a.fx * b.fx + a.fy * b.fy + a.fz * b.fz;

/** An angle brought back into (-π, π]. */
function wrap(angle) {
    let a = angle;
    while (a > Math.PI) a -= TAU;
    while (a <= -Math.PI) a += TAU;
    return a;
}

/**
 * How far a pose's back is turned about its heading from the back `level` has (radians, signed):
 * the roll of one animal against another flying the same way.
 */
function rollFrom(level, pose) {
    const cx = level.uy * pose.uz - level.uz * pose.uy;
    const cy = level.uz * pose.ux - level.ux * pose.uz;
    const cz = level.ux * pose.uy - level.uy * pose.ux;
    return Math.atan2(
        cx * pose.fx + cy * pose.fy + cz * pose.fz,
        level.ux * pose.ux + level.uy * pose.uy + level.uz * pose.uz,
    );
}

/** How far a point is from the tube's own section at its distance (the nearest point of the ellipse). */
function offWall(p) {
    const xc = axisOffset(-p.z);
    let off = Infinity;
    for (let i = 0; i < 4000; i++) {
        const phi = (TAU * i) / 4000;
        off = Math.min(off, Math.hypot(xc + WAVE.a * Math.sin(phi) - p.x, WAVE.b * (1 - Math.cos(phi)) - p.y));
    }
    return off;
}

/** Whether a point is in the water behind the tube's wall (outside its section). */
const inTheWall = (p) => ((p.x - axisOffset(-p.z)) / WAVE.a) ** 2 + ((p.y - WAVE.b) / WAVE.b) ** 2 > 1;

/**
 * One of every kind of act, each drawn from the ranges the sea and the board stage them in
 * (waves-ambient.js, waves-world.js), as [name, act, the barrel's opening].
 */
function troupe(rand) {
    const range = (a, b) => a + (b - a) * rand();
    const bearing = () => {
        const a = range(0, TAU);
        return { hx: Math.cos(a), hz: Math.sin(a) };
    };
    const out = [];
    for (const style of LEAP_STYLES) {
        const d = range(8, 16);
        const open = range(0, 1);
        out.push([`a ${style} leap`, makeLeap({
            kind: rand() < 0.5 ? 'spinner' : 'bottlenose',
            at: range(0, 400),
            row: troughRow(range(-5.5, -0.7), d),
            d,
            open,
            vx: range(-1.5, 0.3),
            vy: range(0.9, 1.9),
            vz: range(-0.5, 0.4),
            style,
            turns: 1 + Math.floor(rand() * 4),
            phase: range(0, TAU),
            variant: rand(),
        }), open]);
    }
    out.push(['a ride', makeRide({
        kind: ['bottlenose', 'spinner', 'turtle'][Math.floor(rand() * 3)],
        at: range(0, 400),
        life: range(13, 21),
        row: range(0.14, 0.4),
        rowAmp: range(0.01, 0.035),
        rowRate: range(0.25, 0.45),
        d0: range(-8, 6.5),
        d1: range(-8, 6.5),
        depth: range(0.5, 1.05),
        depthAmp: range(0.08, 0.2),
        fade: rand() < 0.5,
        seed: range(0, TAU),
        variant: rand(),
        lean: range(0.15, 0.4),
    }), range(0, 1)]);
    out.push(['a roll through the trough', makePorpoise({
        kind: rand() < 0.5 ? 'spinner' : 'bottlenose',
        at: range(0, 400),
        life: range(8.5, 21),
        x: range(-10, 3),
        z: range(-85, -6),
        ...bearing(),
        speed: range(1.1, 2.5),
        period: range(2.4, 4.8),
        rise: range(0.24, 1.15),
        turn: range(-0.012, 0.012),
        seed: range(0, TAU),
        variant: rand(),
    }), 0]);
    out.push(['a manta', makePorpoise({
        kind: 'manta',
        at: range(0, 400),
        life: range(18, 22),
        x: range(-11, -8),
        z: range(-24, -19),
        ...bearing(),
        speed: range(0.85, 1.05),
        period: range(9, 12),
        rise: range(0.12, 0.2),
        sink: range(0.8, 1.05),
        seed: range(0, TAU),
    }), 0]);
    for (const mode of WHALE_MODES) {
        out.push([`a whale's ${mode}`, makeWhale({
            at: range(0, 400),
            mode,
            x: range(-70, -10),
            z: range(-170, -50),
            ...bearing(),
            seed: range(0, TAU),
            variant: rand(),
            twist: rand() < 0.5 ? -1 : 1,
        }), 0]);
    }
    out.push(['a soaring bird', makeSoar({
        at: range(0, 400),
        life: range(21, 25),
        x: range(-50, 9),
        y: range(4, 10),
        z: range(-80, -34),
        ...bearing(),
        speed: range(2.6, 3.4),
        swoop: range(1.1, 2.4),
        swoopRate: range(0.36, 0.5),
        sway: range(2, 5),
        seed: range(0, TAU),
        variant: rand(),
    }), 0]);
    return out;
}

/** The moments an act is asked at: from before its lead to after its life. */
function moments(act, steps = 160) {
    const from = -(act.lead || 0) - 0.5;
    const to = act.life + 0.5;
    return Array.from({ length: steps + 1 }, (_, i) => from + ((to - from) * i) / steps);
}

/** A leap out of the trough, as the sea and the board throw them. */
function leapOf(options = {}) {
    const d = options.d ?? 12;
    return makeLeap({
        at: 30, row: troughRow(-2, d), d, vx: -0.8, vy: 1.3, vz: -0.2, ...options,
    });
}

describe('waves acts: the cast', () => {
    it('names six animals, each with a length, a stroke and room to be drawn', () => {
        expect(KINDS).toEqual(['bottlenose', 'spinner', 'humpback', 'manta', 'turtle', 'seabird']);
        expect(Object.isFrozen(KINDS)).toBe(true);
        expect(Object.keys(SPECIES).sort()).toEqual([...KINDS].sort());
        for (const kind of KINDS) {
            const species = SPECIES[kind];
            expect(Object.isFrozen(species), kind).toBe(true);
            expect(species.metres, kind).toBeGreaterThan(0);
            expect(species.stroke, kind).toBeGreaterThan(0);
            expect(Number.isInteger(species.slots) && species.slots >= 1, kind).toBe(true);
        }
        // The whale is the largest thing in the sea; nothing in it is smaller than a seabird
        // or a turtle (the flying fish, half a metre of them, were taken out: too small to be
        // anything but specks over the trough).
        const lengths = KINDS.map((kind) => SPECIES[kind].metres);
        expect(SPECIES.humpback.metres).toBe(Math.max(...lengths));
        expect(Math.min(...lengths)).toBeGreaterThanOrEqual(0.9);
        expect(SPECIES.flyingFish).toBeUndefined();
        expect(GRAVITY).toBeGreaterThan(0);
        expect(NOSE_REACH).toBeGreaterThan(0);
        expect(FLUKE_REACH).toBeGreaterThan(0);
        expect(RIDE_CLEARANCE).toBeGreaterThan(0);
        expect([...LEAP_STYLES].sort()).toEqual(['arc', 'flip', 'side', 'spin']);
        expect([...WHALE_MODES].sort()).toEqual(['blow', 'breach', 'fluke']);
    });

    it('hands out an empty pose with nothing to draw in it, and a heading and a back that are directions', () => {
        const pose = emptyPose();
        expect(Object.keys(pose).sort()).toEqual([...POSE, 'kind'].sort());
        expect(pose.metres).toBe(0);
        expect(Math.hypot(pose.fx, pose.fy, pose.fz)).toBe(1);
        expect(Math.hypot(pose.ux, pose.uy, pose.uz)).toBe(1);
        expect(pose.fx * pose.ux + pose.fy * pose.uy + pose.fz * pose.uz).toBe(0);
        // Under the sea, should anything ever draw it.
        expect(pose.y).toBeLessThan(0);
        expect(emptyPose()).not.toBe(pose);
        expect(emptyPose()).toEqual(pose);
    });
});

describe('waves acts: any act', () => {
    it('gives a finite pose, its heading and its back unit and square, at every moment of every act', () => {
        const wrong = [];
        let drawn = 0;
        for (const seed of [3, 17, 187, 4242]) {
            const rand = mulberry32(seed);
            for (let round = 0; round < 40; round++) {
                for (const [name, act, open] of troupe(rand)) {
                    for (const t of moments(act)) {
                        const pose = at(act, t, open);
                        const where = `${name} (seed ${seed}) ${t.toFixed(2)} s in`;
                        if (!POSE.every((key) => Number.isFinite(pose[key]))) wrong.push(`${where}: ${JSON.stringify(pose)}`);
                        if (pose.kind !== act.kind) wrong.push(`${where}: is a ${pose.kind}`);
                        if (!(pose.metres >= 0 && pose.depth >= 0)) wrong.push(`${where}: a negative length or depth`);
                        if (!(pose.metres > 0)) continue;
                        drawn += 1;
                        const heading = Math.hypot(pose.fx, pose.fy, pose.fz);
                        const back = Math.hypot(pose.ux, pose.uy, pose.uz);
                        const square = pose.fx * pose.ux + pose.fy * pose.uy + pose.fz * pose.uz;
                        // A heading that is not a direction would be normalised into NaN on the GPU.
                        if (!(Math.abs(heading - 1) < 1e-9)) wrong.push(`${where}: heading ${heading}`);
                        if (!(Math.abs(back - 1) < 1e-9)) wrong.push(`${where}: back ${back}`);
                        if (!(Math.abs(square) < 1e-9)) wrong.push(`${where}: back ${square} along its heading`);
                        if (!(pose.metres <= act.metres + 1e-12)) wrong.push(`${where}: longer than it is`);
                    }
                }
            }
        }
        expect(wrong.slice(0, 8)).toEqual([]);
        expect(drawn).toBeGreaterThan(50_000);
    });

    it('is a function of the clock alone: asked out of order, twice, or into a pose another act just used', () => {
        const rand = mulberry32(29);
        const cast = troupe(rand);
        const written = cast.map(([, act]) => JSON.stringify(act));
        const asked = [];
        for (const [name, act, open] of cast) {
            for (const t of moments(act, 24)) {
                asked.push({
                    name, act, open, clock: act.t0 + t,
                });
            }
        }
        // First in order, each into a pose of its own...
        const first = asked.map(({ act, open, clock }) => pick(actPose(act, clock, open)));
        // ...then backwards, every act into one shared pose, twice over.
        const shared = emptyPose();
        const differing = [];
        for (let pass = 0; pass < 2; pass++) {
            for (let i = asked.length - 1; i >= 0; i--) {
                const {
                    name, act, open, clock,
                } = asked[i];
                const again = actPose(act, clock, open, shared);
                // What is not drawn has no length; where it is nobody reads.
                const same = first[i].metres > 0
                    ? JSON.stringify(pick(again)) === JSON.stringify(first[i])
                    : again.metres === 0;
                if (!same) differing.push(`${name} at ${clock}`);
            }
        }
        expect(differing).toEqual([]);
        // Asking changes nothing: an act is written once, when it begins.
        expect(cast.map(([, act]) => JSON.stringify(act))).toEqual(written);
    });

    it('draws nothing before an act begins or after it is over, and still says which animal it is', () => {
        const rand = mulberry32(5);
        for (const [name, act, open] of troupe(rand)) {
            const lead = act.lead || 0;
            expect(actAlive(act, -lead - 0.01), name).toBe(false);
            expect(actAlive(act, -lead), name).toBe(true);
            expect(actAlive(act, act.life), name).toBe(true);
            expect(actAlive(act, act.life + 0.01), name).toBe(false);
            for (const t of [-lead - 5, -lead - 0.01, act.life + 0.01, act.life + 50]) {
                const pose = at(act, t, open);
                expect(pose.metres, `${name}, ${t} s in`).toBe(0);
                expect(pose.kind, name).toBe(act.kind);
            }
            // Somewhere in between it is there, at its full length.
            const longest = Math.max(...moments(act).map((t) => at(act, t, open).metres));
            expect(longest, name).toBeCloseTo(act.metres, 9);
            expect(act.life, name).toBeGreaterThan(0);
        }
    });

    it('writes into the pose it is given, and draws nothing for an act it does not know', () => {
        const act = leapOf();
        const out = emptyPose();
        expect(actPose(act, act.t0 + 1, 0, out)).toBe(out);
        expect(out.metres).toBeGreaterThan(0);
        const unknown = { ...act, type: 'cartwheel' };
        expect(actPose(unknown, act.t0 + 1, 0, out)).toBe(out);
        expect(out.metres).toBe(0);
    });
});

describe('waves acts: a leap', () => {
    it('leaves the trough where it is told, flies a ballistic arc and comes down to the sea', () => {
        const rand = mulberry32(7);
        const range = (a, b) => a + (b - a) * rand();
        const wrong = [];
        for (let i = 0; i < 120; i++) {
            const d = range(8, 16);
            const open = range(0, 1);
            const x = range(-5.5, -0.7);
            const arc = makeLeap({
                at: 30, row: troughRow(x, d), d, open, vx: range(-1.5, 0.3), vy: range(0.9, 1.9), vz: range(-0.5, 0.4),
            });
            const where = `leap ${i}`;
            const from = wavePoint(arc.row, d, open);
            // Out of the flat of the sea in front of the wave, at the place it was given.
            if (!(arc.row <= 0 && arc.y === 0)) wrong.push(`${where}: leaves row ${arc.row} at y ${arc.y}`);
            if (!(Math.abs(arc.x - x) < 1e-9 && arc.x === from.x && arc.z === -d)) wrong.push(`${where}: leaves (${arc.x}, ${arc.z})`);
            // Up for half its flight and down for the other half, back to the water it left.
            const landing = dolphinPose(arc, arc.flight);
            if (!(Math.abs(arc.flight - (2 * arc.vy) / GRAVITY) < 1e-9)) wrong.push(`${where}: flight ${arc.flight}`);
            if (!(Math.abs(landing.y) < 1e-9)) wrong.push(`${where}: lands at y ${landing.y}`);
            const top = at(arc, arc.vy / GRAVITY, open);
            if (!(Math.abs(top.y - (arc.vy * arc.vy) / (2 * GRAVITY)) < 1e-9)) wrong.push(`${where}: tops out at ${top.y}`);
            if (!(Math.abs(top.fy) < 1e-9)) wrong.push(`${where}: still climbing at the top (${top.fy})`);
            for (let k = 1; k < 24; k++) {
                const t = (arc.flight * k) / 24;
                const pose = at(arc, t, open);
                const ballistic = dolphinPose(arc, t);
                // In the air: on its arc, heading the way it flies, with no water over it.
                if (Math.hypot(pose.x - ballistic.x, pose.y - ballistic.y, pose.z - ballistic.z) > 1e-12) {
                    wrong.push(`${where}: off its arc ${t} s in`);
                }
                if (!(dot(pose, ballistic) > 1 - 1e-9)) wrong.push(`${where}: heads off its arc ${t} s in`);
                if (!(pose.y > 0 && pose.depth === 0)) wrong.push(`${where}: y ${pose.y}, depth ${pose.depth} ${t} s in`);
            }
            // Before and after, it is under the water it breaks: deeper the further from the moment.
            const before = [-arc.lead + 0.01, -1, -0.5, -0.1].map((t) => at(arc, t, open));
            const after = [0.1, 0.5, arc.wake - 0.01].map((t) => at(arc, arc.flight + t, open));
            for (const pose of [...before, ...after]) {
                if (!(pose.y < 0 && pose.depth > 0)) wrong.push(`${where}: y ${pose.y}, depth ${pose.depth} under the sea`);
            }
            if (!before.every((pose, k) => k === 0 || pose.depth < before[k - 1].depth)) wrong.push(`${where}: run-up`);
            if (!after.every((pose, k) => k === 0 || pose.depth > after[k - 1].depth)) wrong.push(`${where}: going down`);
        }
        expect(wrong.slice(0, 8)).toEqual([]);
        // It goes back in along the way it fell, and levels out as it slows.
        const arc = leapOf();
        expect(at(arc, arc.flight + 0.05).fy).toBeLessThan(at(arc, arc.life - 0.05).fy);
    });

    it('times its flukes clear of the water, its nose back into it and its flukes after it, in that order', () => {
        const rand = mulberry32(13);
        const range = (a, b) => a + (b - a) * rand();
        const pose = {};
        for (let i = 0; i < 80; i++) {
            const kind = i % 2 ? 'spinner' : 'bottlenose';
            // (As the sea and the board throw them: more than its own length high, out from the wave.)
            const arc = leapOf({
                kind, d: range(8, 16), vx: range(-1.5, -0.45), vy: range(1.1, 1.9), vz: range(-0.5, 0.4),
            });
            const where = `leap ${i}`;
            expect(arc.size, where).toBe(arc.metres / 2); // what its splashes are sized by
            expect(arc.clearAt, where).toBeGreaterThan(0);
            expect(arc.clearAt, where).toBeLessThan(arc.noseAt);
            expect(arc.noseAt, where).toBeLessThanOrEqual(arc.flight);
            expect(arc.flight, where).toBeLessThanOrEqual(arc.tailAt);
            expect(surfaceTimes(arc)).toEqual({ clearAt: arc.clearAt, noseAt: arc.noseAt, tailAt: arc.tailAt });
            // The flukes are a body's reach along the path from the hole when they clear it...
            dolphinPose(arc, arc.clearAt, pose);
            expect(Math.hypot(pose.x - arc.x, pose.y - arc.y, pose.z - arc.z), where).toBeCloseTo(FLUKE_REACH * arc.size, 6);
            // ...the nose touches the water, and the flukes go under it, at their moments.
            dolphinPose(arc, arc.noseAt, pose);
            expect(pose.y + pose.fy * NOSE_REACH * arc.size, where).toBeCloseTo(0, 6);
            dolphinPose(arc, arc.tailAt, pose);
            expect(pose.y - pose.fy * FLUKE_REACH * arc.size, where).toBeCloseTo(0, 6);
            // The water is thrown twice: as it breaks out, and as its nose goes back in.
            expect(arc.events).toEqual([{ t: 0, type: 'breach' }, { t: arc.noseAt, type: 'entry' }]);
            // It is drawn from its run-up until its flukes are well under again.
            expect(arc.lead, where).toBeGreaterThan(0);
            expect(arc.life, where).toBeGreaterThan(arc.tailAt);
            expect(at(arc, arc.tailAt).metres, where).toBeCloseTo(arc.metres, 9);
        }
    });

    it('spins about its own length as many whole turns as it is told, on the arc of a plain leap', () => {
        for (const turns of [1, 2, 3, 4]) {
            const spin = leapOf({ kind: 'spinner', style: 'spin', turns });
            const plain = leapOf({ kind: 'spinner', style: 'arc' });
            let turned = 0;
            let last = 0;
            const steps = 2000;
            for (let i = 0; i <= steps; i++) {
                const t = (spin.flight * i) / steps;
                const pose = at(spin, t);
                const level = at(plain, t);
                // The same flight: only its back goes round.
                expect(Math.hypot(pose.x - level.x, pose.y - level.y, pose.z - level.z)).toBe(0);
                expect(dot(pose, level)).toBeCloseTo(1, 12);
                const roll = rollFrom(level, pose);
                turned += wrap(roll - last);
                last = roll;
            }
            expect(Math.abs(turned) / TAU, `${turns} turns`).toBeCloseTo(turns, 9);
            // It goes in the right way up, as it came out, and stays so under the water.
            expect(rollFrom(at(plain, 0), at(spin, 0))).toBeCloseTo(0, 9);
            expect(Math.cos(rollFrom(at(plain, spin.flight + 0.5), at(spin, spin.flight + 0.5)))).toBeCloseTo(1, 9);
            // Straight as an arrow while it turns: a plain leap arches over its top.
            expect(at(spin, spin.flight / 2).arch).toBeLessThan(at(plain, plain.flight / 2).arch);
        }
    });

    it('somersaults whole turns in a flip and goes in nose first, along its fall', () => {
        for (const turns of [1, 2]) {
            const flip = leapOf({ style: 'flip', turns });
            const flat = Math.hypot(flip.vx, flip.vz);
            const pitchOf = (pose) => Math.atan2(pose.fy, (pose.fx * flip.vx + pose.fz * flip.vz) / flat);
            const launch = Math.atan2(flip.vy, flat);
            expect(pitchOf(at(flip, 0))).toBeCloseTo(launch, 9);
            let turned = 0;
            let last = launch;
            const steps = 2000;
            for (let i = 1; i <= steps; i++) {
                const pose = at(flip, (flip.flight * i) / steps);
                // Over and over in the plane of its flight: it never yaws out of it.
                expect(pose.fx * flip.vz - pose.fz * flip.vx).toBeCloseTo(0, 9);
                turned += wrap(pitchOf(pose) - last);
                last = pitchOf(pose);
            }
            // Nose over tail: the whole turns, and the way round from climbing to diving.
            expect(turned, `${turns} somersaults`).toBeCloseTo(-(TAU * turns + 2 * launch), 6);
            const entry = at(flip, flip.flight);
            expect(entry.fy).toBeLessThan(0);
            expect(dot(entry, dolphinPose(flip, flip.flight))).toBeCloseTo(1, 9);
            // Tucked through the turn, straight at both ends of it.
            expect(at(flip, flip.flight / 2).arch).toBeGreaterThan(at(flip, flip.flight * 0.02).arch);
        }
    });

    // A leap's back once came from the sky (`square(out, 0, 1, 0)`) and, within ten degrees of the
    // vertical, from the side it launched toward: the two disagree in a dive, so a somersault rolled
    // the dolphin half a turn between two frames, twice a turn. It now turns with the pitch, in the
    // upright plane of its flight (`pitched` in waves-acts.js).
    it('turns over smoothly in a flip: its back never jumps from one frame to the next', () => {
        const jumps = [];
        for (const turns of [1, 2]) {
            const flip = leapOf({ style: 'flip', turns });
            let last = at(flip, 0);
            for (let t = 1 / 120; t <= flip.flight; t += 1 / 120) {
                const pose = at(flip, t);
                const turned = Math.acos(Math.min(1, last.ux * pose.ux + last.uy * pose.uy + last.uz * pose.uz));
                if (turned > 0.5) jumps.push(`${turns} turn(s), ${t.toFixed(3)} s in: its back turns ${turned.toFixed(2)} rad`);
                last = pose;
            }
        }
        expect(jumps).toEqual([]);
    });

    // A back asked for along the heading falls back to a level one; a heading straight up or down
    // has none of its own, and the last resort once came out as (0, 0, 0) (`|| 1` had turned the
    // zero length into 1 before the check). No leap in play is exactly vertical; makeLeap's callers can be.
    it('keeps a back that is a direction for a leap thrown straight up', () => {
        const arc = leapOf({ vx: 0, vz: 0 });
        const backs = [-1, 0, arc.flight * 0.25, arc.flight * 0.75, arc.flight + 0.5]
            .map((t) => at(arc, t))
            .map((pose) => Math.hypot(pose.ux, pose.uy, pose.uz));
        expect(backs).toEqual([1, 1, 1, 1, 1]);
    });

    it('comes down on its side in a side breach', () => {
        const side = leapOf({ style: 'side' });
        const plain = leapOf({ style: 'arc' });
        // The same leap until it is over the top...
        expect(Math.abs(rollFrom(at(plain, side.flight * 0.3), at(side, side.flight * 0.3)))).toBeLessThan(1e-9);
        // ...then over onto its flank: its back no longer to the sky as it lands.
        const landing = Math.abs(rollFrom(at(plain, side.flight), at(side, side.flight)));
        expect(landing).toBeGreaterThan(1);
        expect(landing).toBeLessThan(Math.PI / 2 + 0.2);
        expect(Math.abs(at(side, side.flight).uy)).toBeLessThan(at(plain, plain.flight).uy);
    });

    it('grows out of nothing in its run-up and is gone by the end of its life', () => {
        const arc = leapOf();
        expect(at(arc, -arc.lead).metres).toBe(0);
        const growing = [0.05, 0.15, 0.3, 0.45].map((t) => at(arc, -arc.lead + t).metres);
        expect(growing.every((metres, i) => metres > (growing[i - 1] ?? 0))).toBe(true);
        // Whole before it breaks the surface, and all the way through the air.
        for (const t of [-0.5, 0, arc.flight / 2, arc.flight, arc.tailAt]) expect(at(arc, t).metres).toBe(arc.metres);
        const going = [0.3, 0.2, 0.1, 0].map((t) => at(arc, arc.life - t).metres);
        expect(going.every((metres, i) => i === 0 || metres < going[i - 1])).toBe(true);
        expect(going[going.length - 1]).toBe(0);
        // Its stroke runs on the world's clock at its animal's pace, from where it was told to start.
        const phase = (t) => at(arc, t).phase;
        expect(phase(1) - phase(0)).toBeCloseTo(SPECIES[arc.kind].stroke, 9);
        expect(at(leapOf({ phase: 2 }), 1).phase - phase(1)).toBeCloseTo(2, 9);
        expect(at(leapOf({ variant: 0.7 }), 1).variant).toBe(0.7);
    });
});

describe('waves acts: riding the wave', () => {
    const rides = (fade) => {
        const rand = mulberry32(fade ? 41 : 43);
        const range = (a, b) => a + (b - a) * rand();
        return Array.from({ length: 60 }, (_, i) => {
            const back = i % 3 === 0;
            const from = range(-8, -2);
            const to = range(2, 6.5);
            return [makeRide({
                kind: ['bottlenose', 'spinner', 'turtle'][i % 3],
                at: 20,
                life: range(13, 21),
                row: range(0.14, 0.4),
                rowAmp: range(0.01, 0.035),
                rowRate: range(0.25, 0.45),
                d0: back ? to : from,
                d1: back ? from : to,
                depth: range(0.5, 1.05),
                depthAmp: range(0.08, 0.2),
                fade,
                seed: range(0, TAU),
                lean: range(0.15, 0.4),
                metres: i % 7 === 0 ? 1.3 : undefined,
            }), range(0, 1)];
        });
    };

    it('swims behind the wall of the tube and never through it, with the water over it that its pose says', () => {
        const wrong = [];
        for (const fade of [false, true]) {
            rides(fade).forEach(([act, open], i) => {
                // Its middle is kept this far behind the surface, over the water it is drawn under.
                const clearance = RIDE_CLEARANCE * (act.metres / SPECIES.bottlenose.metres);
                for (let k = 0; k <= 40; k++) {
                    const t = (act.life * k) / 40;
                    const pose = at(act, t, open);
                    const where = `ride ${i}${fade ? ' (fading)' : ''} ${t.toFixed(1)} s in`;
                    if (!inTheWall(pose)) wrong.push(`${where}: inside the tube`);
                    if (!(pose.depth > 0)) wrong.push(`${where}: depth ${pose.depth}`);
                    const off = offWall(pose);
                    if (!(Math.abs(off - (pose.depth + clearance)) < 2e-3)) {
                        wrong.push(`${where}: ${off} m behind the wall, depth ${pose.depth}`);
                    }
                    // Beside the rider: on the face's side of the tube, at the distance it has swum to.
                    const d = act.d0 + (act.d1 - act.d0) * (t / act.life);
                    if (!(Math.abs(-pose.z - d) < 1e-9)) wrong.push(`${where}: at d ${-pose.z}, not ${d}`);
                    if (!(pose.x > axisOffset(d))) wrong.push(`${where}: left of the foot of the face`);
                }
            });
        }
        expect(wrong.slice(0, 8)).toEqual([]);
        expect(RIDE_CLEARANCE).toBeLessThan(WAVE.b);
    });

    it('heads the way it is sent down the line, its back to the rider', () => {
        const wrong = [];
        rides(false).forEach(([act, open], i) => {
            const down = Math.sign(act.d1 - act.d0); // +1: on down the line, away from the eye
            for (let k = 0; k <= 40; k++) {
                const t = (act.life * k) / 40;
                const pose = at(act, t, open);
                const where = `ride ${i} ${t.toFixed(1)} s in`;
                // Ahead is -z: an animal going down the line heads that way, one dropping back the other.
                if (!(pose.fz * -down > 0.2)) wrong.push(`${where}: heading z ${pose.fz}, sent ${down}`);
                // Its back toward the tube's axis, where the rider is: seen from above through the glass.
                const tx = axisOffset(-pose.z) - pose.x;
                const ty = WAVE.b - pose.y;
                const toRider = (pose.ux * tx + pose.uy * ty) / Math.hypot(tx, ty);
                if (!(toRider > 0.7)) wrong.push(`${where}: back ${toRider} toward the rider`);
            }
            if (act.events.length) wrong.push(`ride ${i}: lists ${act.events.length} moments at the surface`);
        });
        expect(wrong.slice(0, 8)).toEqual([]);
    });

    it('comes up out of the deep and goes back down when it fades, and simply swims through when it does not', () => {
        for (const [act, open] of rides(true).slice(0, 12)) {
            const depth = (t) => at(act, t, open).depth;
            const shown = [0.3, 0.5, 0.7].map((s) => depth(act.life * s));
            // In the middle of its visit: the water it was given, give or take its own rise and fall.
            for (const metres of shown) expect(Math.abs(metres - act.depth)).toBeLessThanOrEqual(act.depthAmp + 1e-9);
            // At both ends: metres further down, out of sight.
            expect(depth(0)).toBeGreaterThan(Math.max(...shown) + 2);
            expect(depth(act.life)).toBeGreaterThan(Math.max(...shown) + 2);
            expect(depth(0.6)).toBeLessThan(depth(0));
            expect(depth(act.life - 0.6)).toBeLessThan(depth(act.life));
        }
        for (const [act, open] of rides(false).slice(0, 12)) {
            for (let k = 0; k <= 40; k++) {
                const { depth, metres } = at(act, (act.life * k) / 40, open);
                expect(Math.abs(depth - act.depth)).toBeLessThanOrEqual(act.depthAmp + 1e-9);
                expect(metres).toBe(act.metres);
            }
        }
    });
});

describe('waves acts: rolling through the trough', () => {
    const rolls = () => {
        const rand = mulberry32(53);
        const range = (a, b) => a + (b - a) * rand();
        return Array.from({ length: 120 }, (_, i) => {
            const a = range(0, TAU);
            return makePorpoise({
                kind: i % 2 ? 'spinner' : 'bottlenose',
                at: 20,
                life: range(8.5, 21),
                x: range(-10, 3),
                z: range(-85, -6),
                hx: Math.cos(a),
                hz: Math.sin(a),
                speed: range(1.1, 2.5),
                period: range(2.4, 4.8),
                rise: range(0.24, 1.15),
                turn: range(-0.012, 0.012),
                seed: range(0, TAU),
            });
        });
    };
    /** How long it takes to come up out of the deep, and to go back down (waves-acts.js porpoisePose). */
    const FADE = 1.4;

    it('lists the moments its back breaks the surface and the moments the water closes over it, and no others', () => {
        const wrong = [];
        let listed = 0;
        rolls().forEach((act, i) => {
            // While it is fully up out of the deep, walk its life and note every time the water
            // over it comes and goes.
            const from = FADE;
            const to = act.life - FADE;
            const steps = 6000;
            const found = [];
            let under = at(act, from).depth > 0;
            for (let k = 1; k <= steps; k++) {
                const t = from + ((to - from) * k) / steps;
                const now = at(act, t).depth > 0;
                if (now !== under) found.push({ t, type: now ? 'dip' : 'surface' });
                under = now;
            }
            // (A moment listed while it is still coming up, or already going down, is left out here.)
            const breaks = act.events.filter((event) => event.t >= from && event.t <= to);
            listed += breaks.length;
            const where = `roll ${i}`;
            if (breaks.length !== found.length) wrong.push(`${where}: lists ${breaks.length} moments, breaks ${found.length}`);
            breaks.forEach((event, k) => {
                if (found[k]?.type !== event.type) wrong.push(`${where}: ${event.type} listed, ${found[k]?.type} found`);
                else if (!(Math.abs(found[k].t - event.t) < 2 * ((to - from) / steps))) {
                    wrong.push(`${where}: ${event.type} listed at ${event.t}, found at ${found[k].t}`);
                }
            });
            // In order, up before down, each roll once, all of them inside its life.
            if (!act.events.every((event, k) => k === 0 || event.t >= act.events[k - 1].t)) wrong.push(`${where}: out of order`);
            if (!act.events.every((event, k) => k === 0 || event.type !== act.events[k - 1].type)) wrong.push(`${where}: twice`);
            if (!act.events.every((event) => event.t > 0 && event.t < act.life)) wrong.push(`${where}: outside its life`);
        });
        expect(wrong.slice(0, 8)).toEqual([]);
        expect(listed).toBeGreaterThan(300);
    });

    it('rolls up through the surface heading up and under again heading down, its back to the sky', () => {
        for (const act of rolls().slice(0, 30)) {
            for (const event of act.events.filter((e) => e.t >= FADE && e.t <= act.life - FADE)) {
                const pose = at(act, event.t);
                // The surface is the trough's: y = 0, with its body riding a little under its line.
                expect(pose.depth).toBeLessThan(1e-6);
                expect(Math.abs(pose.y)).toBeLessThan(act.metres * 0.1);
                if (event.type === 'surface') expect(pose.fy).toBeGreaterThan(0);
                else expect(pose.fy).toBeLessThan(0);
                expect(pose.uy).toBeGreaterThan(0);
            }
        }
    });

    it('never breaks the surface when its line lies deeper than it rises: a manta flies under the glass', () => {
        const manta = makePorpoise({
            kind: 'manta', at: 5, life: 20, x: -9, z: -22, hx: 0.35, hz: 0.94, speed: 0.95, period: 10, rise: 0.16, sink: 0.9,
        });
        expect(manta.events).toEqual([]);
        for (let k = 0; k <= 200; k++) {
            const pose = at(manta, (manta.life * k) / 200);
            expect(pose.depth).toBeGreaterThan(manta.sink - manta.rise - 1e-9);
            expect(pose.y).toBeLessThan(0);
        }
        // Just under, at the top of every roll, is still under.
        expect(makePorpoise({
            at: 0, life: 20, x: 0, z: -9, hx: 0, hz: -1, rise: 0.5, sink: 0.5,
        }).events).toEqual([]);
        // Left to itself its line lies a share of its rise under: its back comes over the water.
        const dolphin = makePorpoise({
            at: 0, life: 20, x: 0, z: -9, hx: 0, hz: -1, rise: 0.5,
        });
        expect(dolphin.sink).toBeGreaterThan(0);
        expect(dolphin.sink).toBeLessThan(dolphin.rise);
        expect(dolphin.events.length).toBeGreaterThan(2);
    });

    it('travels its line at its own speed, and bends it by its turn', () => {
        const straight = makePorpoise({
            at: 0, life: 20, x: -2, z: -8, hx: -0.6, hz: -0.8, speed: 1.4,
        });
        for (const t of [0, 3, 9.5, 20]) {
            const here = porpoiseAt(straight, t);
            expect(here.x).toBeCloseTo(-2 - 0.6 * 1.4 * t, 9);
            expect(here.z).toBeCloseTo(-8 - 0.8 * 1.4 * t, 9);
            expect([here.hx, here.hz]).toEqual([-0.6, -0.8]);
            const pose = at(straight, t);
            expect([pose.x, pose.z]).toEqual([here.x, here.z]);
        }
        const bent = { ...straight, turn: 0.01 };
        const turned = porpoiseAt(bent, 10);
        // Its heading has come round by its turn, still a direction...
        expect(Math.hypot(turned.hx, turned.hz)).toBeCloseTo(1, 12);
        expect(Math.atan2(turned.hz, turned.hx) - Math.atan2(-0.8, -0.6)).toBeCloseTo(0.1, 9);
        // ...and it has left the straight line by a little, not by much.
        const off = Math.hypot(turned.x - porpoiseAt(straight, 10).x, turned.z - porpoiseAt(straight, 10).z);
        expect(off).toBeGreaterThan(0.1);
        expect(off).toBeLessThan(2);
        const out = {};
        expect(porpoiseAt(straight, 1, out)).toBe(out);
    });
});

describe('waves acts: the humpback', () => {
    const whale = (mode, extra = {}) => makeWhale({
        at: 40, mode, x: -20, z: -60, hx: 0.92, hz: -0.39, ...extra,
    });
    /** Where its nose and its flukes are: half its length along its heading from its middle. */
    const ends = (pose) => ({
        nose: pose.y + pose.fy * pose.metres * 0.5,
        tail: pose.y - pose.fy * pose.metres * 0.5,
    });
    /** The share of its length that stands above the sea. */
    const above = (pose) => {
        const { nose, tail } = ends(pose);
        const top = Math.max(nose, tail);
        const foot = Math.min(nose, tail);
        return top <= 0 ? 0 : (top - Math.max(0, foot)) / (top - foot);
    };
    const through = (act, steps = 400) => Array.from({ length: steps + 1 }, (_, i) => at(act, (act.life * i) / steps));

    it('throws most of its length out of the sea in a breach, turning as it falls, and ends under it', () => {
        const act = whale('breach');
        const poses = through(act);
        const shares = poses.map(above);
        const most = Math.max(...shares);
        expect(most).toBeGreaterThan(0.6);
        // Up almost on its tail at its highest...
        const top = poses[shares.indexOf(most)];
        expect(top.fy).toBeGreaterThan(0.9);
        expect(top.y).toBeGreaterThan(0);
        // ...out of a sea it was wholly under, and wholly under again at the end, lying level.
        expect(shares[0]).toBe(0);
        expect(shares[shares.length - 1]).toBe(0);
        const last = poses[poses.length - 1];
        expect(Math.max(ends(last).nose, ends(last).tail)).toBeLessThan(-act.metres * 0.25);
        expect(Math.abs(last.fy)).toBeLessThan(0.3);
        // It comes down on its back or its side: its back has turned from the sky.
        expect(last.uy).toBeLessThan(poses[0].uy);
        expect(last.uy).toBeLessThan(0);
        // And the other way round when it is told to turn the other way.
        const other = at(whale('breach', { twist: -1 }), act.life);
        expect(other.ux * last.ux + other.uz * last.uz).toBeLessThan(0);
        expect(other.uy).toBeCloseTo(last.uy, 9);
    });

    it('lifts its flukes clear of the water as it sounds, and goes down head first', () => {
        const act = whale('fluke');
        const poses = through(act);
        // Its flukes in the air over a body that is under: the last of it to be seen.
        const lifted = poses.filter((pose) => ends(pose).tail > 0 && pose.y < 0 && ends(pose).nose < 0);
        expect(lifted.length).toBeGreaterThan(40);
        expect(Math.max(...lifted.map((pose) => ends(pose).tail))).toBeGreaterThan(act.metres * 0.1);
        // Never out of the sea as a breach is.
        expect(Math.max(...poses.map(above))).toBeLessThan(0.5);
        // Standing on its head at the end, flukes and all under.
        const last = poses[poses.length - 1];
        expect(last.fy).toBeLessThan(-0.9);
        expect(ends(last).tail).toBeLessThan(-act.metres * 0.25);
        expect(ends(last).nose).toBeLessThan(ends(last).tail);
    });

    it('only rolls its back along the surface for a blow, and takes anything else for a blow', () => {
        const act = whale('blow');
        for (const pose of through(act)) {
            expect(Math.abs(pose.fy)).toBeLessThan(0.2);
            expect(pose.uy).toBeGreaterThan(0.95);
            // Its middle just under the water: its back at the surface, never its belly.
            expect(pose.y).toBeLessThan(0);
            expect(pose.y).toBeGreaterThan(-act.metres * 0.25);
        }
        const odd = whale('cartwheel');
        expect(odd.life).toBe(act.life);
        expect(odd.events).toEqual(act.events);
        expect(pick(at(odd, 3))).toEqual(pick(at(act, 3)));
    });

    it('lists what it does to the water in order, inside its life, and travels on as it does it', () => {
        const told = {
            breach: ['whale-rise', 'whale-fall'], fluke: ['whale-blow', 'whale-slip'], blow: ['whale-blow'],
        };
        for (const mode of WHALE_MODES) {
            const act = whale(mode);
            expect(act).toMatchObject({ type: 'whale', kind: 'humpback', metres: SPECIES.humpback.metres });
            expect(act.events.map((event) => event.type), mode).toEqual(told[mode]);
            expect(act.events.every((event, i) => event.t > 0 && event.t < act.life && event.t > (act.events[i - 1]?.t ?? 0)))
                .toBe(true);
            // Forward along its heading, never back: by less than its own length.
            const from = at(act, 0);
            const to = at(act, act.life);
            const along = (to.x - from.x) * act.hx + (to.z - from.z) * act.hz;
            expect(along, mode).toBeGreaterThan(0);
            expect(along, mode).toBeLessThan(act.metres);
            expect(Math.abs((to.x - from.x) * act.hz - (to.z - from.z) * act.hx)).toBeLessThan(1e-9);
        }
        // It bursts out before it is at its highest, and comes down after it.
        const breach = whale('breach');
        const heights = through(breach).map((pose) => pose.y);
        const top = (breach.life * heights.indexOf(Math.max(...heights))) / 400;
        expect(breach.events[0].t).toBeLessThan(top);
        expect(breach.events[1].t).toBeGreaterThan(top);
        expect(at(breach, breach.events[0].t + 0.1).y).toBeGreaterThan(at(breach, breach.events[0].t).y);
        expect(at(breach, breach.events[1].t + 0.1).y).toBeLessThan(at(breach, breach.events[1].t).y);
        // The flukes slip under after the blow: out of the water a moment before, at it then, gone after.
        const fluke = whale('fluke');
        const slip = fluke.events[1].t;
        expect(ends(at(fluke, slip - 1)).tail).toBeGreaterThan(0);
        expect(Math.abs(ends(at(fluke, slip)).tail)).toBeLessThan(fluke.metres * 0.1);
        expect(ends(at(fluke, slip + 1.5)).tail).toBeLessThan(-fluke.metres * 0.1);
    });
});

describe('waves acts: seabirds', () => {
    const bird = (extra = {}) => makeSoar({
        at: 8, life: 22, x: 5, y: 6, z: -50, hx: -1, hz: 0, speed: 3, swoop: 2, swoopRate: 0.45, sway: 4, seed: 0.3, ...extra,
    });
    const through = (act) => Array.from({ length: 1101 }, (_, i) => at(act, (act.life * i) / 1100));

    it('stays in the air, swooping about a line metres above the sea, and lists nothing at the surface', () => {
        const act = bird();
        const poses = through(act);
        expect(act.events).toEqual([]);
        expect(poses.every((pose) => pose.depth === 0)).toBe(true);
        const heights = poses.map((pose) => pose.y);
        // As far above its line as below it, by its swoop, and never down to the water.
        expect(Math.max(...heights)).toBeCloseTo(act.y + act.swoop, 2);
        expect(Math.min(...heights)).toBeCloseTo(act.y - act.swoop, 2);
        expect(Math.min(...heights)).toBeGreaterThan(0);
        // On down its heading all the while, swinging across it by its sway and no more.
        const from = poses[0];
        const to = poses[poses.length - 1];
        const along = (pose) => (pose.x - from.x) * act.hx + (pose.z - from.z) * act.hz;
        expect(poses.every((pose, i) => i === 0 || along(pose) > along(poses[i - 1]))).toBe(true);
        expect(along(to)).toBeGreaterThan(act.speed * act.life - 2 * act.sway);
        const across = poses.map((pose) => (pose.x - act.x) * -act.hz + (pose.z - act.z) * act.hx);
        expect(Math.max(...across.map(Math.abs))).toBeLessThanOrEqual(act.sway + 1e-9);
        expect(Math.max(...across)).toBeGreaterThan(0);
        expect(Math.min(...across)).toBeLessThan(0);
        // It comes and goes at the ends of its crossing, whole in between.
        expect(from.metres).toBe(0);
        expect(to.metres).toBe(0);
        expect(poses[550].metres).toBe(act.metres);
    });

    it('banks both ways as it swings across its line, and never over onto its back', () => {
        const act = bird();
        const banks = through(act).filter((pose) => pose.metres > 0).map((pose) => {
            // Its back against the back of a bird flying the same way with level wings.
            const flat = Math.hypot(pose.fx, pose.fz);
            const level = {
                ux: (-pose.fx * pose.fy) / flat, uy: flat, uz: (-pose.fz * pose.fy) / flat,
            };
            return rollFrom(level, pose);
        });
        expect(Math.max(...banks)).toBeGreaterThan(0.3);
        expect(Math.min(...banks)).toBeLessThan(-0.3);
        expect(Math.max(...banks.map(Math.abs))).toBeLessThan(0.8);
        for (const pose of through(act)) expect(pose.uy).toBeGreaterThan(0.7);
        // A few beats as it climbs out of each swoop, a glide the rest of the way.
        const beats = through(act).map((pose) => pose.beat);
        expect(Math.max(...beats)).toBeGreaterThan(0.9);
        expect(Math.min(...beats)).toBe(0);
        expect(beats.filter((beat) => beat < 0.1).length).toBeGreaterThan(beats.length / 2);
        // Its wings are set somewhere between drooped and lifted, never past either.
        expect(through(act).every((pose) => pose.spread >= 0 && pose.spread <= 1)).toBe(true);
    });
});

describe('waves acts: a place on the trough', () => {
    it('finds the row of a place on the sea in front of the wave, and the foot of the face for one behind it', () => {
        for (const d of [0, 6, 9, 12.5, 16, 40]) {
            for (const x of [-0.7, -1.5, -3, -5.5, -40]) {
                const row = troughRow(x, d);
                const here = wavePoint(row, d);
                expect(row, `x ${x}, d ${d}`).toBeLessThanOrEqual(0);
                expect(here.y).toBe(0);
                // Further ahead the line bowls to the left, and the foot of the face with it: a
                // place right of the foot there is the foot itself.
                expect(here.x, `x ${x}, d ${d}`).toBeCloseTo(Math.min(x, axisOffset(d)), 9);
                expect(here.z).toBe(-d);
            }
            expect(troughRow(axisOffset(d) + 2, d)).toBeCloseTo(0, 12);
        }
        // Further out is a row further from the wave.
        expect(troughRow(-6, 10)).toBeLessThan(troughRow(-1, 10));
    });
});
