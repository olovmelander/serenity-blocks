// @ts-check
/**
 * THE GLADE'S DEER, ALIVE — the herd's life on the CPU, without three.js (odyssey-deer.js draws
 * it). Chapter 3, Odyssey's first ground animals (2026-11-01).
 *
 * WHERE. A small herd of red deer (hinds, a yearling and a calf) grazes the glade on the rise above
 * the chapter-3 shore, west of the rail, and the open slope that runs from it down toward the beach.
 * Scouted on the REAL rail camera (docs/ODYSSEY_GROUND_ANIMALS_2026-11.md): the eye flies 60-170 u
 * over the island, so open ground is never nearer than ~120 u; this slope faces the camera as it
 * comes in from the sea, lit by the sun at its back, and stays in the frame without a break from the
 * breach to L15 (five orbs), at about 120-200 u.
 *
 * SIZE. Drawn at three times life (`scale`), like the act's other life (the gulls' 4.2 u span, the
 * butterflies at about three times life): at life size a hind's withers would be eight to seventeen
 * pixels tall in those shots at 1440p; at 3x they are 24-27 px from the sea-side parks (L11-L14),
 * 40 at L15 and 51 at L17 (odyssey-ground-animals.test.js pins them).
 *
 * LIFE. Every deer lives on its own clock, world-anchored: its place is a function of the board
 * clock alone (a seeded schedule that loops every `loop` seconds), and the camera moves past. Each
 * hind keeps to her own few spots in the glade: she grazes head down, takes a step or two between
 * bites, lifts her head to look round now and then, and every so often walks a few paces to her
 * next spot (turning on the spot first, stepping). The calf keeps at its mother's flank. The walk
 * is a four-beat walk whose phase follows the distance walked, so the hooves do not slide; the body
 * pitches and rolls with the ground under its hooves and the legs hang plumb, then the body is set
 * so that the hooves bearing weight stand on the drawn ground (`heightAt`, the world's own mirror
 * of the surface it draws).
 *
 * OUTPUT. `poseDeer` writes, per bone, the bone's world rotation (a quaternion) and where its rest
 * frame lands (`at - k * q * rest`, with `k` the drawn size), the table odyssey-deer.js uploads,
 * plus the hooves (for tests) and a ground plane under the deer (for its shadow).
 */

/** The herd and its clock. Spots are world (x, z); `size` is a share of a grown hind. */
export const ODYSSEY_DEER = Object.freeze({
    /** Drawn larger than life, like the act's other life. */
    scale: 3.0,
    /**
     * [first, last] journey progress the herd is drawn at. Both ends are where the glade is out of
     * the frame (the first deep in chapter 2's water, the last after L16 has turned the eye away):
     * odyssey-ground-animals.test.js holds the camera to that, so it never appears or leaves in view.
     */
    window: Object.freeze([0.08, 0.26]),
    /** Every schedule repeats after this many seconds of the board clock. */
    loop: 300,
    /** A walking stride (m, life size) and the seconds one takes at a hind's size. */
    stride: 0.98,
    cycle: 1.55,
    /** Stance share of the walk, and each leg's phase (left hind, left fore, right hind, right fore). */
    stance: 0.62,
    legPhase: Object.freeze({
        hindL: 0, foreL: 0.25, hindR: 0.5, foreR: 0.75,
    }),
    /** How far a leg swings either side of plumb (radians) in the walk. */
    swing: 0.32,
    /** Local rotations of a grazing head (the neck swung down, the face toward the grass) and how
     * far the forehand dips while grazing (radians of body pitch). */
    graze: Object.freeze({
        neck0: 2.0, neck1: 0, head: -1.5, dip: 0.06,
    }),
    members: Object.freeze([
        Object.freeze({
            name: 'lead hind',
            size: 1.0,
            seed: 11,
            tone: 0.55,
            spots: Object.freeze([[-207, -240], [-203, -235], [-209, -233]]),
        }),
        Object.freeze({
            name: 'hind',
            size: 0.95,
            seed: 23,
            tone: 0.25,
            spots: Object.freeze([[-203, -229], [-199, -227], [-206, -228]]),
        }),
        Object.freeze({
            name: 'hind',
            size: 1.04,
            seed: 37,
            tone: 0.8,
            spots: Object.freeze([[-193, -218], [-191, -214], [-195, -216]]),
        }),
        Object.freeze({
            name: 'yearling',
            size: 0.82,
            seed: 41,
            tone: 0.4,
            spots: Object.freeze([[-213, -230], [-212, -226]]),
        }),
        Object.freeze({
            name: 'calf', size: 0.6, seed: 67, tone: 0.3, follows: 0, offset: Object.freeze([0.85, -0.3]), lag: 0.25,
        }),
    ]),
});

/** The deer's rest skeleton: what the GLB carries (name, parent index, head in metres). */
/** @typedef {{name: string, parent: number, head: number[]}} DeerBone */

const TAU = Math.PI * 2;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (v) => {
    const t = clamp01(v);
    return t * t * (3 - (2 * t));
};
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Seeded uniform [0, 1) (mulberry32). */
function seeded(seed) {
    let s = (seed >>> 0) || 1;
    return () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * One deer's schedule: segments back to back over [0, loop), each `still` (grazing or looking,
 * maybe turning on the spot) or a move (a walk, or a grazing step with the head kept down).
 * Every segment carries where it starts and ends, its headings, the head's state and the gait
 * phase it starts on, so a state at any time is closed-form.
 * @param {{size: number, seed: number, spots: ReadonlyArray<ReadonlyArray<number>>}} member
 * @param {typeof ODYSSEY_DEER} [cfg]
 */
export function buildDeerSchedule(member, cfg = ODYSSEY_DEER) {
    const rand = seeded(member.seed * 7919);
    const k = cfg.scale * member.size;
    const strideW = cfg.stride * k;
    const cycle = cfg.cycle * Math.sqrt(member.size);
    const walkSpeed = strideW / cycle;
    const { spots } = member;
    const n = spots.length;
    const heading = (a, b) => Math.atan2(b[0] - a[0], b[1] - a[1]);
    // Walks between spots first, so the grazing in between fills the rest of the loop exactly.
    const legs = spots.map((s, i) => {
        const next = spots[(i + 1) % n];
        const d = Math.hypot(next[0] - s[0], next[1] - s[1]);
        return {
            from: s, to: next, d, h: heading(s, next),
        };
    });
    const walkTime = legs.reduce((sum, l) => sum + (l.d / walkSpeed) + 3.2, 0);
    const grazeEach = Math.max(20, (cfg.loop - walkTime) / n);
    const segs = [];
    let t = 0;
    let phase = 0;
    let [x, z] = spots[0];
    // Arrives at the first spot facing along the last walk, so the loop closes on itself.
    let { h } = legs[n - 1];
    const push = (seg) => {
        segs.push({ ...seg, t0: t, phase0: phase });
        t += seg.dur;
        phase += seg.cycles ?? 0;
    };
    for (let i = 0; i < n; i += 1) {
        const spot = spots[i];
        // GRAZING at this spot: bites with the head down, a step or two between, a look round now
        // and then. Steps wander round the spot (within ~0.6 of a body length) and never far.
        let left = grazeEach;
        while (left > 4) {
            const bite = Math.min(left, 5 + (rand() * 9));
            push({
                kind: 'graze', dur: bite, x0: x, z0: z, x1: x, z1: z, h0: h, h1: h, head: 1, look: 0,
            });
            left -= bite;
            if (left < 4) break;
            if (rand() < 0.3) {
                const dur = Math.min(left, 3 + (rand() * 4));
                push({
                    kind: 'look',
                    dur,
                    x0: x,
                    z0: z,
                    x1: x,
                    z1: z,
                    h0: h,
                    h1: h,
                    head: 0,
                    look: (rand() - 0.5) * 1.4,
                });
                left -= dur;
                if (left < 4) break;
            }
            // A grazing step: a pace or two, heading a little off the current one, curving back
            // toward the spot when it has wandered.
            const away = Math.hypot(x - spot[0], z - spot[1]);
            const home = Math.atan2(spot[0] - x, spot[1] - z);
            const wander = h + ((rand() - 0.5) * 0.9);
            const pull = clamp01((away - (0.25 * k)) / (0.8 * k));
            const hn = wrapAngle(wander + (wrapAngle(home - wander) * pull));
            const paces = 0.5 + (rand() * 0.8);
            const dist = paces * strideW * 0.55;
            const dur = Math.min(left, (dist / (walkSpeed * 0.45)) + 0.4);
            const nx = x + (Math.sin(hn) * dist);
            const nz = z + (Math.cos(hn) * dist);
            push({
                kind: 'step',
                dur,
                x0: x,
                z0: z,
                x1: nx,
                z1: nz,
                h0: h,
                h1: hn,
                head: 1,
                look: 0,
                cycles: dist / strideW,
            });
            x = nx;
            z = nz;
            h = hn;
            left -= dur;
        }
        if (left > 0) {
            push({
                kind: 'graze', dur: left, x0: x, z0: z, x1: x, z1: z, h0: h, h1: h, head: 1, look: 0,
            });
        }
        // WALK to the next spot: lift the head, turn on the spot (stepping), walk, settle.
        const { to } = legs[i];
        const hw = Math.atan2(to[0] - x, to[1] - z);
        const turn = Math.abs(wrapAngle(hw - h));
        const turnDur = 1.2 + (turn * 1.4);
        push({
            kind: 'turn',
            dur: turnDur,
            x0: x,
            z0: z,
            x1: x,
            z1: z,
            h0: h,
            h1: hw,
            head: 0,
            look: 0,
            cycles: 0.35 + (turn * 0.45),
        });
        h = hw;
        const d = Math.hypot(to[0] - x, to[1] - z);
        const walkDur = (d / walkSpeed) + 0.8;
        push({
            kind: 'walk',
            dur: walkDur,
            x0: x,
            z0: z,
            x1: to[0],
            z1: to[1],
            h0: h,
            h1: h,
            head: 0,
            look: 0,
            cycles: d / strideW,
        });
        [x, z] = to;
    }
    // The loop's length is what the segments add up to (the walks are fixed, the grazing fills).
    return {
        segments: segs, loop: t, k, strideW,
    };
}

/** The schedules of the whole herd (built once; pure). */
export function buildHerd(cfg = ODYSSEY_DEER) {
    const own = cfg.members.map((member) => ('spots' in member ? buildDeerSchedule(member, cfg) : null));
    return cfg.members.map((member, i) => {
        if (!('follows' in member)) return { member, ...own[i] };
        // A calf keeps to its mother's flank (an offset in HER frame, so it stays beside her as she
        // turns), a little behind her in time, its legs stepping its own shorter strides.
        const mother = { member: cfg.members[member.follows], ...own[member.follows] };
        const k = cfg.scale * member.size;
        return {
            member,
            mother,
            ratio: mother.k / k,
            segments: mother.segments,
            loop: mother.loop,
            k,
            strideW: cfg.stride * k,
        };
    });
}

/**
 * Where a deer is and what it is doing at board time `time` (closed-form in the clock).
 * @returns {{x:number, z:number, heading:number, head:number, look:number, gait:number, amp:number}}
 */
export function deerStateAt(deer, time, out = {
    x: 0, z: 0, heading: 0, head: 0, look: 0, gait: 0, amp: 0,
}) {
    if (deer.mother) {
        deerStateAt(deer.mother, time - (deer.member.lag ?? 0), out);
        const [side, back] = deer.member.offset;
        const km = deer.mother.k;
        const sh = Math.sin(out.heading);
        const ch = Math.cos(out.heading);
        // Her left (+x) and forward (+z) turned by her heading; the calf a little livelier.
        out.x += ((ch * side) + (sh * back)) * km;
        out.z += ((-sh * side) + (ch * back)) * km;
        out.gait *= deer.ratio;
        out.head = Math.min(out.head, 0.85);
        return out;
    }
    const lag = deer.member.lag ?? 0;
    const t = ((((time - lag) % deer.loop) + deer.loop) % deer.loop);
    const segs = deer.segments;
    let lo = 0;
    let hi = segs.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (segs[mid].t0 <= t) lo = mid; else hi = mid - 1;
    }
    const s = segs[lo];
    const u = clamp01((t - s.t0) / s.dur);
    const moving = s.kind === 'walk' || s.kind === 'step';
    // Moves ease in and out; the gait phase follows the ground covered.
    const along = moving ? smooth(u) : 0;
    out.x = s.x0 + ((s.x1 - s.x0) * along);
    out.z = s.z0 + ((s.z1 - s.z0) * along);
    // A turn turns over the whole segment, a grazing step over its first half, the rest not at all.
    let turnU = 1;
    if (s.kind === 'turn') turnU = smooth(u);
    else if (s.kind === 'step') turnU = smooth(Math.min(1, u * 2));
    out.heading = s.h0 + (wrapAngle(s.h1 - s.h0) * turnU);
    out.gait = s.phase0 + ((s.cycles ?? 0) * (s.kind === 'turn' ? u : along));
    // How much the legs step: up over the first and down over the last ~0.5 s of a move.
    const ramp = Math.min(1, (u * s.dur) / 0.5, ((1 - u) * s.dur) / 0.5);
    out.amp = moving || s.kind === 'turn' ? smooth(ramp) * (s.kind === 'walk' ? 1 : 0.6) : 0;
    // The head: blended across each segment boundary over ~1 s (from the previous segment's
    // state), so it never snaps.
    const prev = segs[(lo - 1 + segs.length) % segs.length];
    const into = smooth((t - s.t0) / 1.1);
    out.head = prev.head + ((s.head - prev.head) * into);
    const lookFade = s.kind === 'look' ? Math.min(smooth((u * s.dur) / 1.2), smooth(((1 - u) * s.dur) / 1.2)) : 0;
    out.look = s.look * lookFade;
    return out;
}

// -- the pose ------------------------------------------------------------------------------------

/** Row-major 3x3 multiply into `out` (out may not alias a or b). */
function mul3(a, b, out) {
    for (let r = 0; r < 3; r += 1) {
        for (let c = 0; c < 3; c += 1) {
            out[(r * 3) + c] = (a[r * 3] * b[c]) + (a[(r * 3) + 1] * b[3 + c]) + (a[(r * 3) + 2] * b[6 + c]);
        }
    }
    return out;
}

/** R = Ry * Rz * Rx (pitch about x first, then roll, then yaw): the GLB's convention. */
function rotation(rx, ry, rz, out) {
    const cx = Math.cos(rx);
    const sx = Math.sin(rx);
    const cy = Math.cos(ry);
    const sy = Math.sin(ry);
    const cz = Math.cos(rz);
    const sz = Math.sin(rz);
    // Rz * Rx
    const a00 = cz;
    const a01 = sz * cx;
    const a02 = -sz * sx;
    const a10 = -sz;
    const a11 = cz * cx;
    const a12 = cz * -sx;
    const a20 = 0;
    const a21 = sx;
    const a22 = cx;
    // Ry * (Rz * Rx)
    out[0] = (cy * a00) + (sy * a20);
    out[1] = (cy * a01) + (sy * a21);
    out[2] = (cy * a02) + (sy * a22);
    out[3] = a10;
    out[4] = a11;
    out[5] = a12;
    out[6] = (-sy * a00) + (cy * a20);
    out[7] = (-sy * a01) + (cy * a21);
    out[8] = (-sy * a02) + (cy * a22);
    return out;
}

/** A unit quaternion [x, y, z, w] from a row-major rotation matrix. */
function quatFrom(m, out, o) {
    const tr = m[0] + m[4] + m[8];
    let x;
    let y;
    let z;
    let w;
    if (tr > 0) {
        const s = 0.5 / Math.sqrt(tr + 1);
        w = 0.25 / s;
        x = (m[7] - m[5]) * s;
        y = (m[2] - m[6]) * s;
        z = (m[3] - m[1]) * s;
    } else if (m[0] > m[4] && m[0] > m[8]) {
        const s = 2 * Math.sqrt(1 + m[0] - m[4] - m[8]);
        w = (m[7] - m[5]) / s;
        x = 0.25 * s;
        y = (m[1] + m[3]) / s;
        z = (m[2] + m[6]) / s;
    } else if (m[4] > m[8]) {
        const s = 2 * Math.sqrt(1 + m[4] - m[0] - m[8]);
        w = (m[2] - m[6]) / s;
        x = (m[1] + m[3]) / s;
        y = 0.25 * s;
        z = (m[5] + m[7]) / s;
    } else {
        const s = 2 * Math.sqrt(1 + m[8] - m[0] - m[4]);
        w = (m[3] - m[1]) / s;
        x = (m[2] + m[6]) / s;
        y = (m[5] + m[7]) / s;
        z = 0.25 * s;
    }
    // (q and -q turn a vertex alike: the stage blends turned vertices, never quaternions.)
    const sign = w < 0 ? -1 : 1;
    out[o] = x * sign;
    out[o + 1] = y * sign;
    out[o + 2] = z * sign;
    out[o + 3] = w * sign;
}

/** @type {ReadonlyArray<[string, string, string[], boolean]>} */
const LEGS = Object.freeze([
    // [leg (its phase key), top bone, the chain below it, front?]
    ['foreL', 'humerusL', ['forearmL', 'foreCannonL', 'foreHoofL'], true],
    ['foreR', 'humerusR', ['forearmR', 'foreCannonR', 'foreHoofR'], true],
    ['hindL', 'femurL', ['tibiaL', 'hindCannonL', 'hindHoofL'], false],
    ['hindR', 'femurR', ['tibiaR', 'hindCannonR', 'hindHoofR'], false],
]);

/**
 * A rig for one skeleton: scratch and lookups, built once.
 * @param {DeerBone[]} skeleton
 */
export function createDeerRig(skeleton) {
    const count = skeleton.length;
    const index = Object.fromEntries(skeleton.map((b, i) => [b.name, i]));
    const missing = ['root', 'pelvis', 'chest', 'neck0', 'neck1', 'head', 'earL', 'earR', 'tail',
        ...LEGS.flatMap(([, top, chain]) => [top, ...chain])].filter((name) => index[name] == null);
    if (missing.length) throw new Error(`[Odyssey deer] the skeleton lacks ${missing.join(', ')}`);
    const hoofTip = (name) => {
        const { head } = skeleton[index[name]];
        return [head[0], 0, head[2] + 0.015];
    };
    return {
        skeleton,
        count,
        index,
        local: Array.from({ length: count }, () => [0, 0, 0]),
        R: Array.from({ length: count }, () => new Float64Array(9)),
        J: Array.from({ length: count }, () => new Float64Array(3)),
        L: new Float64Array(9),
        hooves: LEGS.map(([leg, , chain]) => ({ leg, bone: index[chain[2]], tip: hoofTip(chain[2]) })),
        legs: LEGS.map(([leg, top, chain, front]) => ({
            leg, front, top: index[top], chain: chain.map((name) => index[name]),
        })),
    };
}

/**
 * Pose one deer: its bones in the world for the shader table, its hooves, the ground plane under it.
 * @param {ReturnType<typeof createDeerRig>} rig
 * @param {ReturnType<typeof deerStateAt>} state
 * @param {number} k drawn size (metres of the model to world units)
 * @param {(x: number, z: number) => number} heightAt the drawn ground
 * @param {number} time board clock (for the small idle motions)
 * @param {number} seed per-deer offset for those
 * @param {Float32Array} [table] shader table, written at `offset` (8 floats a bone)
 * @param {number} [offset]
 * @param {typeof ODYSSEY_DEER} [cfg]
 */
export function poseDeer(rig, state, k, heightAt, time, seed, table = null, offset = 0, cfg = ODYSSEY_DEER) {
    const {
        skeleton, index, local, R, J, L,
    } = rig;
    for (const l of local) { l[0] = 0; l[1] = 0; l[2] = 0; }
    const set = (name, rx, ry = 0, rz = 0) => {
        const l = local[index[name]];
        l[0] += rx; l[1] += ry; l[2] += rz;
    };
    const g = state.head;
    const { amp } = state;
    const phase = state.gait;
    // The head and neck: down to the grass, or up and looking round (the yaw shared down the neck).
    const bob = Math.sin(phase * TAU * 2) * 0.05 * amp;
    const bite = Math.sin((time * TAU) / (1.1 + (seed % 0.3))) * 0.05 * g * (1 - amp);
    const G = cfg.graze;
    set('neck0', (G.neck0 * g) + bob - (0.06 * (1 - g)), state.look * 0.45);
    set('neck1', G.neck1 * g, state.look * 0.55);
    set('head', (G.head * g) + bite + (0.08 * (1 - g) * Math.sin((time * 0.7) + seed)));
    // Ears: forward when alert, back and flicking while grazing; a flick every few seconds.
    const flick = Math.max(0, Math.sin((time * 1.7) + (seed * 3.1))) ** 12;
    set('earL', 0.25 * g, 0, (-0.2 * g) + (0.35 * flick));
    set('earR', 0.25 * g, 0, (0.2 * g) - (0.35 * Math.max(0, Math.sin((time * 1.3) + (seed * 5.7))) ** 12));
    // The tail: down, a swish now and then.
    set('tail', 0.15, 0.35 * Math.sin(time * 5) * (Math.max(0, Math.sin((time * 0.4) + seed)) ** 8));
    // Grazing stance: the fore legs a little apart (one forward), the neck's weight over them.
    set('humerusL', -0.08 * g * (1 - amp));
    set('humerusR', 0.05 * g * (1 - amp));
    // THE WALK: each leg swings back through its stance, then lifts and folds forward.
    const A = cfg.swing;
    const beta = cfg.stance;
    const stance = {};
    for (const leg of rig.legs) {
        const u = (((phase + cfg.legPhase[leg.leg]) % 1) + 1) % 1;
        let swing;
        let fold;
        if (u < beta) {
            swing = -A + ((2 * A * u) / beta);
            fold = 0;
            stance[leg.leg] = 1;
        } else {
            const v = (u - beta) / (1 - beta);
            swing = A * Math.cos(Math.PI * v);
            fold = Math.sin(Math.PI * v);
            stance[leg.leg] = 1 - amp;
        }
        const top = skeleton[leg.top].name;
        const [c0, c1, c2] = leg.chain.map((i) => skeleton[i].name);
        set(top, swing * amp);
        if (leg.front) {
            set(c0, -0.35 * fold * amp);
            set(c1, 1.15 * fold * amp);
            set(c2, 0.5 * fold * amp);
        } else {
            set(c0, 0.45 * fold * amp);
            set(c1, -0.8 * fold * amp);
            set(c2, 0.55 * fold * amp);
        }
    }
    // THE GROUND: the body pitches and rolls with what is under its hooves (most of the way), and
    // the legs hang plumb from it.
    const sh = Math.sin(state.heading);
    const ch = Math.cos(state.heading);
    const at = (fx, fz) => heightAt(state.x + (sh * fz * k) + (ch * fx * k), state.z + (ch * fz * k) - (sh * fx * k));
    const yF = 0.5 * (at(0.105, 0.42) + at(-0.105, 0.42));
    const yH = 0.5 * (at(0.11, -0.58) + at(-0.11, -0.58));
    const yLeft = 0.5 * (at(0.3, 0.42) + at(0.3, -0.58));
    const yRight = 0.5 * (at(-0.3, 0.42) + at(-0.3, -0.58));
    const pitch = -Math.atan2(yF - yH, 1.0 * k) * 0.9;
    const roll = -Math.atan2(yLeft - yRight, 0.6 * k) * 0.7;
    for (const leg of rig.legs) {
        const l = local[leg.top];
        l[0] -= pitch;
        l[2] -= roll;
    }
    // FORWARD KINEMATICS in the world: the root turned by heading, pitch and roll, at (x, ?, z).
    const rootIndex = index.root;
    const dip = cfg.graze.dip * g;
    rotation(pitch + dip + local[rootIndex][0], state.heading, roll, R[rootIndex]);
    const rootHead = skeleton[rootIndex].head;
    J[rootIndex][0] = state.x;
    J[rootIndex][1] = rootHead[1] * k;
    J[rootIndex][2] = state.z;
    const fkBone = (b) => {
        const { parent, head } = skeleton[b];
        const pr = R[parent];
        const ph = skeleton[parent].head;
        const dx = (head[0] - ph[0]) * k;
        const dy = (head[1] - ph[1]) * k;
        const dz = (head[2] - ph[2]) * k;
        J[b][0] = J[parent][0] + (pr[0] * dx) + (pr[1] * dy) + (pr[2] * dz);
        J[b][1] = J[parent][1] + (pr[3] * dx) + (pr[4] * dy) + (pr[5] * dz);
        J[b][2] = J[parent][2] + (pr[6] * dx) + (pr[7] * dy) + (pr[8] * dz);
        const lr = local[b];
        mul3(pr, rotation(lr[0], lr[1], lr[2], L), R[b]);
    };
    for (let b = 0; b < skeleton.length; b += 1) {
        if (b !== rootIndex) fkBone(b);
    }
    // THE HOOVES ON THE GROUND. Where each hoof's sole lands; the body is set down until the
    // highest hoof bearing weight meets the drawn ground, then every other leg folds (knee and
    // fetlock, or stifle and hock) just enough to bring its hoof up onto the ground too, and a
    // swinging hoof is folded clear of it.
    const hooves = rig.hoofOut || (rig.hoofOut = rig.hooves.map(() => ({
        x: 0, y: 0, z: 0, ground: 0, stance: 0,
    })));
    const hoofAt = (i) => {
        const hoof = rig.hooves[i];
        const r = R[hoof.bone];
        const { head } = skeleton[hoof.bone];
        const dx = (hoof.tip[0] - head[0]) * k;
        const dy = (hoof.tip[1] - head[1]) * k;
        const dz = (hoof.tip[2] - head[2]) * k;
        const o = hooves[i];
        o.x = J[hoof.bone][0] + (r[0] * dx) + (r[1] * dy) + (r[2] * dz);
        o.y = J[hoof.bone][1] + (r[3] * dx) + (r[4] * dy) + (r[5] * dz);
        o.z = J[hoof.bone][2] + (r[6] * dx) + (r[7] * dy) + (r[8] * dz);
        o.ground = heightAt(o.x, o.z);
        return o;
    };
    let lift = Infinity;
    rig.hooves.forEach((hoof, i) => {
        const o = hoofAt(i);
        o.stance = stance[hoof.leg];
        if (o.stance > 0.5) lift = Math.min(lift, o.ground - o.y);
    });
    if (!Number.isFinite(lift)) lift = 0;
    for (let b = 0; b < skeleton.length; b += 1) J[b][1] += lift;
    const fold = rig.fold || (rig.fold = rig.legs.map((leg) => (leg.front ? [-0.5, 1, 0.4] : [0.5, -1, 0.4])));
    const base = [0, 0, 0];
    rig.legs.forEach((leg, i) => {
        const o = hoofAt(i);
        // How far its hoof must rise: onto the ground when bearing weight, clear of it in the swing.
        const need = o.stance > 0.5 ? o.ground - o.y : Math.max(0, o.ground + (0.015 * k) - o.y);
        if (need < 0.002 * k) return;
        leg.chain.forEach((b, c) => { base[c] = local[b][0]; });
        const foldBy = (d) => {
            leg.chain.forEach((b, c) => { local[b][0] = base[c] + (fold[i][c] * d); });
            fkBone(leg.top);
            leg.chain.forEach(fkBone);
            return hoofAt(i).y;
        };
        // The rise grows with the square of the fold near a straight leg and steadily after, so
        // it is found by halving (monotone over the range), not by Newton steps.
        const y0 = o.y;
        let lo = 0;
        let hi = 1.5;
        if (foldBy(hi) - y0 <= need) return;
        for (let n = 0; n < 12; n += 1) {
            const mid = 0.5 * (lo + hi);
            if (foldBy(mid) - y0 > need) hi = mid; else lo = mid;
        }
        foldBy(0.5 * (lo + hi));
    });
    // THE TABLE: per bone its world rotation and where its rest frame lands.
    if (table) {
        for (let b = 0; b < skeleton.length; b += 1) {
            const o = offset + (b * 8);
            const r = R[b];
            const [hx, hy, hz] = skeleton[b].head;
            quatFrom(r, table, o);
            table[o + 4] = J[b][0] - (k * ((r[0] * hx) + (r[1] * hy) + (r[2] * hz)));
            table[o + 5] = J[b][1] - (k * ((r[3] * hx) + (r[4] * hy) + (r[5] * hz)));
            table[o + 6] = J[b][2] - (k * ((r[6] * hx) + (r[7] * hy) + (r[8] * hz)));
            table[o + 7] = k;
        }
    }
    // The ground plane under the deer (its shadow lies on it): centre height and gradient.
    const e = 0.6 * k;
    const gx = (heightAt(state.x + e, state.z) - heightAt(state.x - e, state.z)) / (2 * e);
    const gz = (heightAt(state.x, state.z + e) - heightAt(state.x, state.z - e)) / (2 * e);
    return {
        hooves, ground: heightAt(state.x, state.z), gx, gz,
    };
}

/** Reveal (0 or 1) at journey progress `p`: drawn through the window, never faded in view. */
export function deerRevealAt(p, cfg = ODYSSEY_DEER) {
    return p >= cfg.window[0] && p <= cfg.window[1] ? 1 : 0;
}
