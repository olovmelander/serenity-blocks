/**
 * Waves — what the sea life does (CPU only, three-free).
 *
 * An act is one animal doing one thing: a dolphin riding inside the face of the wave, a pod
 * rolling through the trough, a leap, a spin, a somersault, a humpback throwing itself out of the
 * sea, a shearwater on the wind. Every act is written
 * once, when it begins, as a handful of numbers, and `actPose` says where the animal is at any
 * moment of it: a closed form of the world's clock, like the spray and the ribbons, so an act
 * looks the same at any frame rate, holds when the clock holds (four lines) and replays exactly
 * after a seek. Nothing is stepped.
 *
 * A pose is what the renderer needs (waves-fauna.js): where the middle of the body is, which way
 * it heads and where its back points (two unit vectors), how long it is (metres), where its
 * stroke stands (`phase`) and how hard it beats (`beat`), how far its body is arched (`arch`),
 * how far its wings or fins are spread (`spread`), and how deep under the water's surface it is
 * (`depth`, metres; 0 in the air): the animal is drawn through the water with that much of the
 * sea over it.
 *
 * Each act also lists the moments it breaks the surface (`events`: seconds into the act, what
 * happens, where), so the world can throw the water for it (waves-splash.js).
 */
import {
    TAU, WAVE, axisOffset, clamp01, floorRow, lerp, lipAngle, smooth, wavePoint,
} from './waves-core.js';

/** Gravity in the wave's slow motion (metres a second squared): what the spray falls under. */
export const GRAVITY = 0.46;

/**
 * A leap is drawn from a run-up of LEAP_LEAD seconds under the surface (from deep enough that
 * the water hides it) to LEAP_WAKE seconds or more after it went in, diving on down at up to
 * WAKE_DIVE metres a second while the speed it went in with dies away (WAKE_DRAG a second).
 */
export const LEAP_LEAD = 2.6;
export const LEAP_WAKE = 4;
export const WAKE_DRAG = 0.6;
export const WAKE_DIVE = 1.3;
const DIVE_ONSET = GRAVITY / WAKE_DIVE;

/** The animals, in the order the pack numbers them (scripts/blender/waves_sea_life/cast.py). */
export const KINDS = Object.freeze(['bottlenose', 'spinner', 'humpback', 'manta', 'turtle', 'seabird']);

/**
 * Each animal: its length in metres (the manta: across its wings; the bird: bill to tail, its
 * wings twice that across), how many of it can be drawn at once at the High tier, and how fast
 * its stroke runs (radians a second, in the wave's slow motion).
 */
export const SPECIES = Object.freeze({
    bottlenose: Object.freeze({ metres: 2.6, slots: 10, stroke: 3.1 }),
    spinner: Object.freeze({ metres: 1.9, slots: 8, stroke: 3.8 }),
    humpback: Object.freeze({ metres: 13, slots: 2, stroke: 0.9 }),
    manta: Object.freeze({ metres: 3.4, slots: 2, stroke: 1.15 }),
    turtle: Object.freeze({ metres: 1.05, slots: 3, stroke: 1.5 }),
    seabird: Object.freeze({ metres: 0.95, slots: 8, stroke: 3.4 }),
});

/** How far from the middle of a dolphin's body its nose and its flukes reach (half body lengths). */
export const NOSE_REACH = 1.0;
export const FLUKE_REACH = 1.1;

const tmp = { x: 0, y: 0, z: 0 };
const ahead = {};
const behind = {};

/** A pose with nothing in it (reused by callers). */
export function emptyPose() {
    return {
        x: 0,
        y: -100,
        z: 0,
        fx: 0,
        fy: 0,
        fz: -1,
        ux: 0,
        uy: 1,
        uz: 0,
        metres: 0,
        phase: 0,
        beat: 0,
        arch: 0,
        spread: 0,
        depth: 0,
        variant: 0,
        kind: 'bottlenose',
    };
}

/** Make `out`'s back point as near (ux, uy, uz) as its heading allows, both unit. */
function square(out, ux, uy, uz) {
    const fl = Math.hypot(out.fx, out.fy, out.fz) || 1;
    out.fx /= fl;
    out.fy /= fl;
    out.fz /= fl;
    const along = ux * out.fx + uy * out.fy + uz * out.fz;
    let x = ux - out.fx * along;
    let y = uy - out.fy * along;
    let z = uz - out.fz * along;
    let len = Math.hypot(x, y, z);
    if (len < 1e-4) {
        // Heading straight along the hint: any square direction will do.
        x = out.fz;
        y = 0;
        z = -out.fx;
        len = Math.hypot(x, y, z);
        if (len < 1e-4) {
            // (A heading straight up or down: any level direction is square to it.)
            x = 1;
            y = 0;
            z = 0;
            len = 1;
        }
    }
    out.ux = x / len;
    out.uy = y / len;
    out.uz = z / len;
    return out;
}

/**
 * For a heading that keeps to the upright plane through a level direction (hx, hz) (a leap, a
 * whale's rise: neither turns while it flies), the back that turns with its pitch: up while it
 * flies level, toward (-hx, -hz) as it heads straight up, and on down past it in a somersault,
 * with no jump as the nose passes the vertical (squaring against the sky's up flips there).
 */
function pitched(out, hx, hz) {
    const fl = Math.hypot(out.fx, out.fy, out.fz) || 1;
    out.fx /= fl;
    out.fy /= fl;
    out.fz /= fl;
    const level = out.fx * hx + out.fz * hz;
    out.ux = -hx * out.fy;
    out.uy = level;
    out.uz = -hz * out.fy;
    const len = Math.hypot(out.ux, out.uy, out.uz);
    if (len < 0.5) return square(out, 0, 1, 0);
    out.ux /= len;
    out.uy /= len;
    out.uz /= len;
    return out;
}

/** The level direction a leap's flight keeps to (unit): out of the wave when it has none. */
function levelOf(vx, vz, out) {
    const flat = Math.hypot(vx, vz);
    out.x = flat > 1e-6 ? vx / flat : -1;
    out.z = flat > 1e-6 ? vz / flat : 0;
    return out;
}
const heading = { x: -1, z: 0 };

/** Turn `out`'s back about its heading by `angle` (radians). */
function roll(out, angle) {
    if (!angle) return out;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    // side = heading x back
    const sx = out.fy * out.uz - out.fz * out.uy;
    const sy = out.fz * out.ux - out.fx * out.uz;
    const sz = out.fx * out.uy - out.fy * out.ux;
    out.ux = out.ux * c + sx * s;
    out.uy = out.uy * c + sy * s;
    out.uz = out.uz * c + sz * s;
    return out;
}

// ── Leaps ───────────────────────────────────────────────────────────────────────

/**
 * Where a leaping animal is `t` seconds into its flight, which way it flies and how fast (a plain
 * ballistic arc): x, y, z; the unit heading fx, fy, fz; vx, vy, vz; speed.
 */
export function dolphinPose(arc, t, out = {}) {
    const vy = arc.vy - GRAVITY * t;
    const speed = Math.hypot(arc.vx, vy, arc.vz) || 1;
    out.x = arc.x + arc.vx * t;
    out.y = arc.y + arc.vy * t - 0.5 * GRAVITY * t * t;
    out.z = arc.z + arc.vz * t;
    out.vx = arc.vx;
    out.vy = vy;
    out.vz = arc.vz;
    out.speed = speed;
    out.fx = arc.vx / speed;
    out.fy = vy / speed;
    out.fz = arc.vz / speed;
    return out;
}

/** Where `f(t)` (falling through zero between lo and hi) crosses it. */
function crossing(f, lo, hi) {
    let a = lo;
    let b = hi;
    for (let i = 0; i < 40; i += 1) {
        const m = (a + b) / 2;
        if (f(m) > 0) a = m;
        else b = m;
    }
    return (a + b) / 2;
}

/**
 * Seconds into a leap when the flukes clear the water it left (`clearAt`), when the nose touches
 * the water on the way down (`noseAt`) and when the flukes go under after it (`tailAt`). The
 * middle of the body crosses the surface at `flight`.
 */
export function surfaceTimes(arc, out = {}) {
    const pose = {};
    const tip = (t, reach) => {
        dolphinPose(arc, t, pose);
        return pose.y + pose.fy * arc.size * reach;
    };
    // The flukes are out of the hole once the middle is a body's reach along its path from it.
    const reach = FLUKE_REACH * arc.size;
    out.clearAt = crossing((t) => {
        dolphinPose(arc, t, pose);
        return reach - Math.hypot(pose.x - arc.x, pose.y - arc.y, pose.z - arc.z);
    }, 0, arc.flight / 2);
    const top = Math.min(arc.flight, Math.max(0, arc.vy / GRAVITY));
    out.noseAt = crossing((t) => tip(t, NOSE_REACH), top, arc.flight);
    out.tailAt = crossing((t) => tip(t, -FLUKE_REACH), arc.flight, arc.flight + 3);
    return out;
}

/** The ways a leap is flown: a plain arc, a spin about its own length, a somersault, a breach onto its side. */
export const LEAP_STYLES = Object.freeze(['arc', 'spin', 'flip', 'side']);

/**
 * A leap: the animal comes up under the surface along the line of its launch, flies a ballistic
 * arc and goes back into the trough.
 *
 * @param {object} p
 * @param {string} [p.kind]
 * @param {number} p.at        the world's clock when it breaks the surface
 * @param {number} p.row       where on the wave it leaves it (waves-core.js: ≤ 0 the trough)
 * @param {number} p.d         metres ahead of the eye
 * @param {number} [p.open]    the barrel's opening as it leaves
 * @param {number} p.vx, p.vy, p.vz   its launch (metres a second)
 * @param {number} [p.metres]  its length
 * @param {string} [p.style]   LEAP_STYLES
 * @param {number} [p.turns]   a spin's whole turns about its own length; a flip's somersaults
 */
export function makeLeap({
    kind = 'bottlenose', at, row, d, open = 0, vx, vy, vz, metres = SPECIES[kind].metres, style = 'arc', turns = 1,
    phase = 0, variant = 0, hero = false, lead = LEAP_LEAD,
}) {
    const from = wavePoint(row, d, open, tmp);
    const drop = Math.max(0, from.y);
    const flight = (vy + Math.sqrt(vy * vy + 2 * GRAVITY * drop)) / GRAVITY;
    // The water's own normal where it leaves (out of the water): up from the trough, off the face.
    const lo = wavePoint(row - 0.01, d, open, {});
    const hi = wavePoint(row + 0.01, d, open, {});
    const len = Math.hypot(hi.x - lo.x, hi.y - lo.y) || 1;
    const arc = {
        type: 'leap',
        kind,
        t0: at,
        x: from.x,
        y: from.y,
        z: from.z,
        vx,
        vy,
        vz,
        flight,
        // Half its length: what the splashes are sized by (waves-splash.js).
        size: metres / 2,
        metres,
        style,
        turns,
        phase,
        variant,
        hero,
        row,
        open,
        nx: row > 0 ? -(hi.y - lo.y) / len : 0,
        ny: row > 0 ? (hi.x - lo.x) / len : 1,
        active: true,
        started: false,
        entered: false,
        landed: false,
        clearAt: 0,
        noseAt: flight,
        tailAt: flight,
        // (Long enough to come up from where the water hides it: no dolphin grows out of nothing.)
        lead: Math.max(0.6, lead),
        life: 0,
        events: null,
    };
    surfaceTimes(arc, arc);
    // Drawn from a body's run-up under the surface until its flukes are well under again.
    arc.wake = Math.max(LEAP_WAKE, arc.tailAt - flight + 0.7);
    arc.life = flight + arc.wake;
    arc.events = [
        { t: 0, type: 'breach' },
        { t: arc.noseAt, type: 'entry' },
    ];
    return arc;
}

function leapPose(arc, t, open, out) {
    const { flight } = arc;
    let roll0 = 0;
    out.spread = 1;
    if (t < 0) {
        // The run-up: under the surface, on the curve its flight goes on with (a straight run that
        // met a curving flight was a kink in its turn at the breach), coming up steeper from deep.
        // A shorter one (a dolphin the board calls answers within a second) is the same path from
        // the same depth, come up faster at first and easing to its own speed at the breach.
        const k = t / arc.lead;
        const quick = Math.max(0, LEAP_LEAD / arc.lead - 1);
        const tr = t * (1 + quick * k * k);
        const vy = arc.vy - GRAVITY * tr;
        out.x = arc.x + arc.vx * tr;
        out.y = arc.y + arc.vy * tr - 0.5 * GRAVITY * tr * tr;
        out.z = arc.z + arc.vz * tr;
        const speed = Math.hypot(arc.vx, vy, arc.vz) || 1;
        out.fx = arc.vx / speed;
        out.fy = vy / speed;
        out.fz = arc.vz / speed;
        out.depth = Math.max(0, -tr * (arc.vx * arc.nx + arc.vy * arc.ny) + 0.5 * GRAVITY * tr * tr * Math.abs(arc.ny));
        out.beat = 1.1;
        out.arch = 0.06;
    } else if (t <= flight) {
        dolphinPose(arc, t, out);
        const s = t / flight;
        out.depth = 0;
        const crest = Math.sin(Math.PI * s);
        // The final driving stroke dies into a glide. The pectorals open over the apex, then
        // tuck against the body for entry. A spinner keeps them close through its fast turn.
        out.beat = 0.09 + 0.94 * (1 - smooth(0, 0.26, s));
        out.spread = arc.style === 'spin' ? 1 - 0.82 * crest : 1 - 0.74 * smooth(0.51, 0.94, s);
        // Arched over the top of the leap, straight as it goes in.
        out.arch = 0.06 + 0.38 * crest;
        if (arc.hero) roll0 = (0.24 + arc.variant * 0.09) * crest * crest;
        if (arc.style === 'spin') {
            roll0 = TAU * arc.turns * smooth(0.04, 0.92, s);
            out.arch = 0.05;
        } else if (arc.style === 'side') {
            roll0 = 1.45 * smooth(0.35, 0.95, s);
        } else if (arc.style === 'flip') {
            // A somersault: the nose leads the flight round by whole turns and meets it again as it goes in.
            const flat = Math.hypot(arc.vx, arc.vz);
            const pitch0 = Math.atan2(arc.vy, flat);
            const pitch = pitch0 + (-2 * pitch0 - TAU * arc.turns) * smooth(0.06, 0.94, s);
            levelOf(arc.vx, arc.vz, heading);
            out.fx = heading.x * Math.cos(pitch);
            out.fy = Math.sin(pitch);
            out.fz = heading.z * Math.cos(pitch);
            out.arch = 0.42 * Math.sin(Math.PI * s);
            out.beat = 0.15;
        }
    } else {
        // Under again: on along the way it went in, slowing, and diving on down until the water
        // hides it (it used to level out a metre under and shrink away there: a pop).
        const vy = arc.vy - GRAVITY * flight;
        const tau = t - flight;
        const slows = Math.exp(-WAKE_DRAG * tau);
        const run = (1 - slows) / WAKE_DRAG;
        // (The dive comes on at the rate gravity was bending its flight, so its path turns on
        // through the surface without a kink.)
        const dives = WAKE_DIVE * (1 - Math.exp(-DIVE_ONSET * tau));
        out.x = arc.x + arc.vx * flight + arc.vx * run;
        out.y = arc.y + arc.vy * flight - 0.5 * GRAVITY * flight * flight + vy * run
            - WAKE_DIVE * (tau - (1 - Math.exp(-DIVE_ONSET * tau)) / DIVE_ONSET);
        out.z = arc.z + arc.vz * flight + arc.vz * run;
        // Headed the way it goes.
        const gx = arc.vx * slows;
        const gy = vy * slows - dives;
        const gz = arc.vz * slows;
        const speed = Math.hypot(gx, gy, gz) || 1;
        out.fx = gx / speed;
        out.fy = gy / speed;
        out.fz = gz / speed;
        out.depth = Math.max(0, -out.y);
        out.beat = 0.9;
        out.arch = 0.04;
        if (arc.style !== 'spin') out.spread = 0.26 + 0.74 * smooth(0, 1.1, tau);
        if (arc.style === 'side') roll0 = 1.45;
        if (arc.style === 'spin') roll0 = TAU * arc.turns;
    }
    // Its back turns with its pitch (through the vertical too, in a somersault or a leap thrown
    // straight up), then rolls with its style.
    levelOf(arc.vx, arc.vz, heading);
    pitched(out, heading.x, heading.z);
    roll(out, roll0);
    out.metres = arc.metres * smooth(-arc.lead, -arc.lead + 0.5, t) * (1 - smooth(arc.life - 0.4, arc.life, t));
    out.phase = arc.phase + (arc.t0 + t) * SPECIES[arc.kind].stroke;
    out.variant = arc.variant;
    return out;
}

// ── Riding the wave ─────────────────────────────────────────────────────────────

/** The unit vector into the water behind a point of the tube's wall (z = 0: the section's own plane). */
function inward(point, d, out) {
    const xc = axisOffset(d);
    if (point.y <= 1e-4) {
        out.x = 0;
        out.y = -1;
        return out;
    }
    const nx = (point.x - xc) / (WAVE.a * WAVE.a);
    const ny = (point.y - WAVE.b) / (WAVE.b * WAVE.b);
    const len = Math.hypot(nx, ny) || 1;
    out.x = nx / len;
    out.y = ny / len;
    return out;
}

/** How far behind the wall a riding animal's middle is kept, over the water it is drawn under (metres, for a dolphin). */
export const RIDE_CLEARANCE = 0.55;
/**
 * A ride that starts or ends where the eye can see it (anywhere ahead of the rider, closer than
 * this behind it) comes up out of the deep there, or sinks back into it, over RIDE_EASE seconds:
 * RIDE_SINK metres more water over it is past where the water hides it all (waves-fauna.js fades
 * an animal out by 3.4 m). An end behind the rider is out of sight: there it simply swims through.
 */
export const RIDE_SEEN = -0.5;
export const RIDE_EASE = 3.2;
export const RIDE_SINK = 4.6;
/**
 * How much of that rise and sink tips a riding animal's nose, for every metre a second it swims
 * along the line (the rest it does level): never more than about fifteen degrees, however
 * slowly it goes.
 */
export const RIDE_DIVE_PITCH = 0.12;

const wallPoint = { x: 0, y: 0, z: 0 };
const wallNormal = { x: 0, y: 0 };

/**
 * Where a riding animal is at `t`. `dive` is how much of its rise out of the deep (and its sink
 * back) is counted: all of it for where it is, a little for which way it heads (counted whole,
 * the 4.6 m it rises in three seconds against the half metre a second it swims stood it on its
 * nose in the first and last seconds of every ride).
 */
function ridePoint(act, t, open, out, dive = 1) {
    // (Not clamped at its ends: the heading is read a moment either side, and a path that stopped
    // dead at an end swung the heading round in the last frames.)
    const d = lerp(act.d0, act.d1, t / act.life);
    const row = Math.max(0.03, act.row + act.rowAmp * Math.sin(act.rowRate * t + act.seed));
    // It comes up out of the deep and goes back down into it at every end the eye can see (an
    // animal that appeared, or vanished, in the open water of the wall was a pop), and simply
    // swims through an end behind the rider.
    const rises = act.fade || act.d0 > RIDE_SEEN ? smooth(0, RIDE_EASE, t) : 1;
    const sinks = act.fade || act.d1 > RIDE_SEEN ? 1 - smooth(act.life - RIDE_EASE, act.life, t) : 1;
    const shown = rises * sinks;
    const depth = act.depth + act.depthAmp * Math.sin(0.55 * t + act.seed * 1.7) + (1 - shown) * RIDE_SINK * dive;
    // `row` is a share of the closed tube's arc, the same angle round the tube at every distance
    // (as a share of the lip's own reach it bent the path where the lip lands: a kink in its turn).
    wavePoint((row * WAVE.lipClosed) / lipAngle(d, open), d, open, wallPoint);
    inward(wallPoint, d, wallNormal);
    // (Its middle is kept a fin's height and the wall's own swell behind the surface, so
    // nothing of it breaks through; it is drawn with only the water it was given over it.)
    const behindWall = depth + RIDE_CLEARANCE * (act.metres / 2.6);
    out.x = wallPoint.x + wallNormal.x * behindWall;
    out.y = wallPoint.y + wallNormal.y * behindWall;
    out.z = wallPoint.z;
    out.depth = depth;
    out.nx = wallNormal.x;
    out.ny = wallNormal.y;
    return out;
}

/**
 * A ride: the animal swims inside the wall of the wave, its back to the rider, weaving up and
 * down the face as it goes down the line.
 *
 * @param {object} p
 * @param {number} p.at, p.life
 * @param {number} p.row       how far up the face (0 its foot .. ~0.45 under the roof)
 * @param {number} p.d0, p.d1  metres ahead of the eye where it starts and ends
 * @param {number} p.depth     metres of water over it
 * @param {boolean} [p.fade]   it rises out of the deep and sinks back (else it swims through)
 */
export function makeRide({
    kind = 'bottlenose', at, life = 12, row = 0.25, rowAmp = 0.05, rowRate = 0.5, d0 = -2, d1 = 6, depth = 0.7,
    depthAmp = 0.15, metres = SPECIES[kind].metres, fade = true, seed = 0, variant = 0, lean = 0.25, beat = 0.45,
}) {
    return {
        type: 'ride',
        kind,
        t0: at,
        life,
        row,
        rowAmp,
        rowRate,
        d0,
        d1,
        depth,
        depthAmp,
        metres,
        fade,
        seed,
        variant,
        lean,
        beat,
        events: [],
    };
}

function ridePose(act, t, open, out) {
    const pitch = RIDE_DIVE_PITCH * Math.min(1, Math.abs(act.d1 - act.d0) / act.life);
    ridePoint(act, t + 0.06, open, ahead, pitch);
    ridePoint(act, t - 0.06, open, behind, pitch);
    ridePoint(act, t, open, out);
    out.fx = ahead.x - behind.x;
    out.fy = ahead.y - behind.y;
    out.fz = ahead.z - behind.z;
    // Its back to the tube: the rider looks down on it through the glass.
    square(out, -out.nx, -out.ny, 0);
    roll(out, act.lean * Math.sin(0.7 * t + act.seed * 2.3));
    out.metres = act.metres;
    out.phase = act.seed * 5 + (act.t0 + t) * SPECIES[act.kind].stroke;
    // It mostly lets the wave carry it: a few easy strokes, then a glide.
    out.beat = act.beat * (0.55 + 0.45 * Math.sin(0.9 * t + act.seed * 3.1));
    out.arch = 0.05 * Math.sin(0.8 * t + act.seed);
    out.spread = 1;
    out.variant = act.variant;
    return out;
}

// ── Rolling through the trough ──────────────────────────────────────────────────

/** How far under the water a porpoising animal's line lies (a share of its `rise`), unless it says. */
const ROLL_SINK = 0.35;

/**
 * Porpoising: the animal travels a straight line through the sea in front of the wave, rolling up
 * through the surface and under again every `period` seconds. With a tall `rise` it clears the
 * water in low leaps.
 *
 * @param {object} p
 * @param {number} p.x, p.z      where it starts (the trough's surface is y = 0)
 * @param {number} p.hx, p.hz    its heading on the water (unit)
 * @param {number} p.speed       metres a second
 * @param {number} p.rise        metres it rises and falls about its line
 * @param {number} [p.sink]      metres that line lies under the water (less than `rise`: its back
 *                               comes over the water at the top of each roll; more: it never does)
 */
export function makePorpoise({
    kind = 'bottlenose', at, life = 12, x, z, hx, hz, speed = 1.1, period = 3.2, rise = 0.5, sink = rise * ROLL_SINK,
    turn = 0, metres = SPECIES[kind].metres, seed = 0, variant = 0,
}) {
    const act = {
        type: 'porpoise',
        kind,
        t0: at,
        life,
        x,
        z,
        hx,
        hz,
        speed,
        period,
        rise,
        sink,
        turn,
        metres,
        seed,
        variant,
        events: [],
    };
    if (!(rise > sink)) return act;
    // Each roll breaks the surface going up and closes it going down.
    const up = Math.asin(sink / rise);
    for (let k = -1; k < life / period + 1; k += 1) {
        const rising = ((up + k * TAU - seed) * period) / TAU;
        const falling = ((Math.PI - up + k * TAU - seed) * period) / TAU;
        if (rising > 1.2 && rising < life - 1.2) act.events.push({ t: rising, type: 'surface' });
        if (falling > 1.2 && falling < life - 1.2) act.events.push({ t: falling, type: 'dip' });
    }
    act.events.sort((a, b) => a.t - b.t);
    return act;
}

/** Where a porpoising animal's middle is on the water `t` seconds in (x, z): its line bends by `turn`. */
export function porpoiseAt(act, t, out = {}) {
    const bend = act.turn * t;
    const c = Math.cos(bend);
    const s = Math.sin(bend);
    // (A gentle arc: the heading turns as it goes; for a small turn this is the chord of it.)
    const hx = act.hx * c - act.hz * s;
    const hz = act.hx * s + act.hz * c;
    out.x = act.x + (act.hx + hx) * 0.5 * act.speed * t;
    out.z = act.z + (act.hz + hz) * 0.5 * act.speed * t;
    out.hx = hx;
    out.hz = hz;
    return out;
}

function porpoisePose(act, t, out) {
    const theta = (TAU * t) / act.period + act.seed;
    const shown = smooth(0, 1.4, t) * (1 - smooth(act.life - 1.4, act.life, t));
    porpoiseAt(act, t, out);
    const y = act.rise * Math.sin(theta) - act.sink - (1 - shown) * 3;
    const vy = (act.rise * Math.cos(theta) * TAU) / act.period;
    out.y = y - act.metres * 0.06;
    out.fx = out.hx * act.speed;
    out.fy = vy;
    out.fz = out.hz * act.speed;
    square(out, 0, 1, 0);
    out.depth = Math.max(0, -y) + (1 - shown) * 3;
    out.metres = act.metres;
    out.phase = act.seed * 5 + (act.t0 + t) * SPECIES[act.kind].stroke;
    out.beat = 0.75;
    out.arch = 0.16 * Math.sin(theta);
    out.spread = 1;
    out.variant = act.variant;
    return out;
}

// ── The humpback ────────────────────────────────────────────────────────────────

/** A whale's three turns at the surface: thrown clear of it, its flukes lifted as it sounds, a blow. */
export const WHALE_MODES = Object.freeze(['breach', 'fluke', 'blow']);
const WHALE_SECONDS = Object.freeze({ breach: 10, fluke: 9, blow: 7 });

/**
 * @param {object} p
 * @param {string} p.mode        WHALE_MODES
 * @param {number} p.x, p.z      where it comes up (far out on the sea)
 * @param {number} p.hx, p.hz    its heading on the water (unit)
 */
export function makeWhale({
    at, mode = 'breach', x, z, hx, hz, metres = SPECIES.humpback.metres, seed = 0, variant = 0, twist = 1,
}) {
    const life = WHALE_SECONDS[mode] || WHALE_SECONDS.blow;
    const events = [];
    if (mode === 'breach') {
        // The snout reaches the surface here on the steep rise in whalePose.
        events.push({ t: life * 0.11, type: 'whale-rise' });
        events.push({ t: life * 0.6, type: 'whale-fall' });
    } else if (mode === 'fluke') {
        events.push({ t: life * 0.12, type: 'whale-blow' });
        events.push({ t: life * 0.74, type: 'whale-slip' });
    } else {
        events.push({ t: life * 0.2, type: 'whale-blow' });
    }
    return {
        type: 'whale', kind: 'humpback', t0: at, life, mode, x, z, hx, hz, metres, seed, variant, twist, events,
    };
}

function whalePose(act, t, out) {
    const L = act.metres;
    const s = clamp01(t / act.life);
    let pitch = 0;
    let y = -1.2 * L;
    let along = 0;
    let turned = 0;
    let arch = 0;
    if (act.mode === 'breach') {
        const rise = smooth(0.0, 0.36, s);
        const fall = smooth(0.42, 0.7, s);
        const sink = smooth(0.66, 1.0, s);
        // Thrown up almost on its tail, then over onto its back as it turns.
        pitch = lerp(1.2, 1.36, rise) * (1 - fall) - 0.12 * fall;
        y = L * (-0.66 + 0.92 * rise - 0.5 * fall - 0.56 * sink);
        along = L * (0.1 * rise + 0.3 * fall);
        turned = act.twist * 2.1 * smooth(0.12, 0.66, s);
        arch = -0.1 * rise * (1 - fall);
    } else if (act.mode === 'fluke') {
        const roll0 = smooth(0.0, 0.3, s);
        const tip = smooth(0.26, 0.58, s);
        const slip = smooth(0.62, 1.0, s);
        // Its back rolls up through the surface, then it stands on its head and slides under.
        pitch = lerp(0.07, -0.42, roll0) * (1 - tip) - 1.3 * tip;
        y = L * (lerp(-0.2, -0.085, Math.sin(Math.PI * Math.min(1, s / 0.34))) * (1 - tip) - 0.3 * tip - 0.78 * slip);
        along = L * 0.34 * s;
        arch = 0.18 * roll0 * (1 - tip);
    } else {
        pitch = lerp(0.05, -0.12, s);
        y = L * (-0.2 + 0.11 * Math.sin(Math.PI * smooth(0.05, 0.95, s)));
        along = L * 0.3 * s;
        arch = 0.08 * Math.sin(Math.PI * s);
    }
    out.x = act.x + act.hx * along;
    out.y = y;
    out.z = act.z + act.hz * along;
    out.fx = act.hx * Math.cos(pitch);
    out.fy = Math.sin(pitch);
    out.fz = act.hz * Math.cos(pitch);
    levelOf(act.hx, act.hz, heading);
    pitched(out, heading.x, heading.z);
    roll(out, turned);
    // The sea is not glass that far out: what is under it is not seen.
    out.depth = 30;
    out.metres = L;
    out.phase = act.seed * 5 + (act.t0 + t) * SPECIES.humpback.stroke;
    out.beat = 0.5;
    out.arch = arch;
    out.spread = 1;
    out.variant = act.variant;
    return out;
}

// ── Seabirds ────────────────────────────────────────────────────────────────────

/**
 * Soaring: the bird crosses the sky in long swoops, banking into each, with a few slow beats of
 * its wings now and then.
 *
 * @param {object} p
 * @param {number} p.x, p.y, p.z   where it starts
 * @param {number} p.hx, p.hz      its heading over the sea (unit)
 * @param {number} p.swoop         metres it rises and falls
 */
export function makeSoar({
    at, life = 20, x, y, z, hx, hz, speed = 4, swoop = 1.6, swoopRate = 0.42, sway = 3, metres = SPECIES.seabird.metres,
    seed = 0, variant = 0,
}) {
    return {
        type: 'soar',
        kind: 'seabird',
        t0: at,
        life,
        x,
        y,
        z,
        hx,
        hz,
        speed,
        swoop,
        swoopRate,
        sway,
        metres,
        seed,
        variant,
        events: [],
    };
}

function soarPose(act, t, out) {
    const w = act.swoopRate;
    const a = w * t + act.seed * 6;
    // It swings across its line as it rises and falls: the long S of a bird working the wind.
    const side = act.sway * Math.sin(a * 0.5);
    const vside = act.sway * 0.5 * w * Math.cos(a * 0.5);
    out.x = act.x + act.hx * act.speed * t - act.hz * side;
    out.y = act.y + act.swoop * Math.sin(a);
    out.z = act.z + act.hz * act.speed * t + act.hx * side;
    out.fx = act.hx * act.speed - act.hz * vside;
    out.fy = act.swoop * w * Math.cos(a);
    out.fz = act.hz * act.speed + act.hx * vside;
    square(out, 0, 1, 0);
    // Banked into the swing.
    roll(out, -0.5 * Math.sin(a * 0.5 + 0.9));
    out.depth = 0;
    out.metres = act.metres * smooth(0, 0.5, t) * (1 - smooth(act.life - 0.5, act.life, t));
    out.phase = act.seed * 5 + (act.t0 + t) * SPECIES.seabird.stroke;
    // A few beats as it climbs out of each swoop; a glide the rest of the way.
    const climbing = Math.max(0, Math.cos(a));
    out.beat = climbing * climbing * climbing;
    out.arch = 0;
    // How far its wings are lifted in the glide.
    out.spread = 0.5 + 0.5 * Math.sin(a);
    out.variant = act.variant;
    return out;
}

// ── Any act ─────────────────────────────────────────────────────────────────────

/** Whether an act shows anything `t` seconds after it began. */
export function actAlive(act, t) {
    return t >= -(act.lead || 0) && t <= act.life;
}

/**
 * Where an act's animal is at `clock` (the world's), with the barrel `open` (0..1). Returns the
 * pose (with `metres` 0 when it is not to be drawn).
 */
export function actPose(act, clock, open = 0, out = emptyPose()) {
    const t = clock - act.t0;
    out.kind = act.kind;
    if (!actAlive(act, t)) {
        out.metres = 0;
        return out;
    }
    switch (act.type) {
    case 'leap': return leapPose(act, t, open, out);
    case 'ride': return ridePose(act, t, open, out);
    case 'porpoise': return porpoisePose(act, t, out);
    case 'whale': return whalePose(act, t, out);
    case 'soar': return soarPose(act, t, out);
    default:
        out.metres = 0;
        return out;
    }
}

/** The row of the trough `x` metres in front of the foot of the face at a distance (x ≤ 0). */
export function troughRow(x, d) {
    return floorRow(x - axisOffset(d));
}
