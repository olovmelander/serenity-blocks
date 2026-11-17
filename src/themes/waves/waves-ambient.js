/**
 * Waves — the sea's own comings and goings (CPU only, three-free).
 *
 * Nothing here answers the board. Every few seconds of the world's clock the sea may send a
 * visit: a pod riding inside the face beside the rider, dolphins rolling through the trough, a
 * far pod crossing the sun's road, one dolphin thrown clear of the water, a school of flying
 * fish, a turtle or a manta under the glass, a humpback out at sea, shearwaters on the wind.
 * Which one, and every number of it (how many, where, how fast, which way), is drawn from the
 * visit's own place in time and the world's seed, never from what came before: so the sea at a
 * given second is the same however that second was reached (a seek, a replay, a rebuild), no two
 * visits in a row are the same kind, and it is several minutes before anything repeats at all.
 *
 * A visit is a list of acts (waves-acts.js). `ambientActs` gives the acts that may be showing at
 * a moment of the clock; the caller asks each for its pose.
 */
import { TAU, mulberry32 } from './waves-core.js';
import {
    LEAP_LEAD, makeLeap, makePorpoise, makeRide, makeSoar, makeWhale, troughRow,
} from './waves-acts.js';

/** Seconds between the moments a visit may begin. */
export const VISIT_SECONDS = 8;
/** How many visits are kept as they were made (a few times what one moment shows). */
const KEPT_VISITS = 24;

/** No visit outlasts this many of them: how far back `ambientActs` has to look. */
export const VISIT_REACH = 4;

/** The visits and how often each comes (shares of the whole). */
export const VISITS = Object.freeze([
    ['rest', 1.6],
    ['ridePod', 4],
    ['troughPod', 4],
    ['farPod', 2.4],
    ['loneLeap', 2.6],
    // (Seen closest of all, through the glass beside the rider: they come by often.)
    ['turtle', 1.9],
    ['manta', 1.6],
    ['whaleBlow', 1.1],
    ['whaleFluke', 0.9],
    ['whaleBreach', 0.5],
    ['birds', 2.2],
]);
const VISIT_TOTAL = VISITS.reduce((sum, [, share]) => sum + share, 0);
/** What a whale's visit has it do (waves-acts.js WHALE_MODES). */
const WHALE_TURNS = Object.freeze({ whaleBreach: 'breach', whaleFluke: 'fluke', whaleBlow: 'blow' });

function pick(u) {
    let left = u * VISIT_TOTAL;
    for (let i = 0; i < VISITS.length; i += 1) {
        left -= VISITS[i][1];
        if (left < 0) return i;
    }
    return VISITS.length - 1;
}

/** The number stream of one visit: its own, whatever was drawn for the others. */
function streamFor(seed, index) {
    return mulberry32((Math.imul(seed | 0, 2654435761) ^ Math.imul(index + 7, 40503)) >>> 0);
}

/** How far back the walk below starts: far enough that it has forgotten where it began. */
const VISIT_WALK = 24;

/**
 * Which visit begins at a place in time (an index into VISITS): never the kind before it. What a
 * place draws by itself may repeat its neighbour's, so the answer is walked forward from a place
 * well before it, each place stepping on to the next kind along when it would repeat.
 */
export function visitAt(seed, index) {
    if (index < 0) return 0;
    let before = -1;
    for (let i = Math.max(0, index - VISIT_WALK); i <= index; i += 1) {
        let mine = pick(streamFor(seed, i)());
        // The same as the one before: the next kind along, past the rest.
        if (mine === before) mine = 1 + (mine % (VISITS.length - 1));
        before = mine;
    }
    return before;
}

const unit = (x, z) => {
    const len = Math.hypot(x, z) || 1;
    return [x / len, z / len];
};

/**
 * The acts of the visit that begins at `index`, at the clock time it begins.
 * @param {number} seed
 * @param {number} index
 * @param {number} [scale]   how full the sea is (a tier's share of each pod and school, 0..1)
 */
export function visitActs(seed, index, scale = 1) {
    const rand = streamFor(seed, index);
    rand();
    return stageVisit(VISITS[visitAt(seed, index)][0], rand, index * VISIT_SECONDS, scale);
}

/**
 * One visit of a named kind (VISITS) as its acts, beginning at `at` on the world's clock, every
 * number of it drawn from `rand`.
 * @param {string} kind
 * @param {() => number} rand
 * @param {number} at
 * @param {number} [scale]   how full the sea is (a tier's share of each pod and school, 0..1)
 */
export function stageVisit(kind, rand, at, scale = 1) {
    const range = (a, b) => a + (b - a) * rand();
    const count = (a, b) => Math.max(1, Math.round(range(a, b) * scale));
    const acts = [];
    switch (kind) {
    case 'ridePod': {
        // A pod inside the wall beside the rider: from behind the eye on down the line, or
        // dropping back past it, each on its own line up the face.
        const spinner = rand() < 0.3;
        const species = spinner ? 'spinner' : 'bottlenose';
        const n = count(1, spinner ? 4.4 : 3.4);
        const back = rand() < 0.3;
        const life = range(14, 18);
        const row = range(0.16, 0.3);
        for (let i = 0; i < n; i += 1) {
            // One in the pod may be a calf, tight beside the animal ahead of it.
            const calf = i > 0 && i === n - 1 && rand() < 0.45;
            const lag = i * range(1.1, 2.0);
            const from = -2.2 - lag;
            const to = 5.4 - lag;
            acts.push(makeRide({
                kind: species,
                at: at + i * range(0.2, 0.7),
                life,
                row: row + (i % 2 ? 0.07 : -0.03) * i + (calf ? 0.03 : 0),
                rowAmp: range(0.012, 0.035),
                rowRate: range(0.25, 0.45),
                d0: back ? to : from,
                d1: back ? from : to,
                depth: range(0.5, 0.95) + (calf ? 0.1 : 0),
                depthAmp: range(0.08, 0.2),
                fade: false,
                seed: rand() * TAU,
                variant: rand(),
                metres: calf ? 1.3 : undefined,
                lean: range(0.15, 0.4),
            }));
        }
        break;
    }
    case 'troughPod': {
        // Dolphins rolling through the trough in front of the wave, out to sea or in from it.
        const spinner = rand() < 0.4;
        const species = spinner ? 'spinner' : 'bottlenose';
        const n = count(2, spinner ? 5.4 : 4.4);
        // The rider sees a wedge of the trough: from the foot of the wave out to the left, wider
        // the further off. A pod goes away down it, comes in up it, or crosses it side-on.
        const way = rand();
        let life = range(13, 16);
        let speed = range(1.1, 1.35);
        let x = range(-3.2, -1.4);
        let z = range(-8, -6.2);
        let [hx, hz] = unit(range(-0.45, -0.25), -1);
        if (way < 0.28) {
            x = range(-9.5, -7);
            z = range(-26, -22);
            [hx, hz] = unit(range(0.28, 0.42), 1);
        } else if (way < 0.56) {
            x = range(-1.6, -0.8);
            z = range(-17, -12);
            [hx, hz] = unit(-1, range(-0.3, -0.05));
            speed = range(1.25, 1.5);
            life = range(8.5, 10);
        }
        const period = range(3.8, 4.8);
        const fast = rand() < 0.3;
        for (let i = 0; i < n; i += 1) {
            const calf = i > 0 && i === n - 1 && rand() < 0.4;
            // Abreast and a little behind one another, never nose to tail.
            const across = (i - (n - 1) / 2) * range(1.1, 1.7);
            const behind = Math.abs(i - (n - 1) / 2) * range(0.5, 1.2) + rand() * 0.4;
            acts.push(makePorpoise({
                kind: species,
                at: at + rand() * 0.5,
                life,
                x: x - hz * across - hx * behind,
                z: z + hx * across - hz * behind,
                hx,
                hz,
                speed,
                period: period * range(0.94, 1.06),
                rise: (fast ? range(0.62, 0.8) : range(0.34, 0.46)) * (calf ? 0.7 : 1),
                turn: range(-0.012, 0.012),
                seed: rand() * TAU,
                variant: rand(),
                metres: calf ? 1.3 : undefined,
            }));
        }
        break;
    }
    case 'farPod': {
        // A pod far out, crossing the sun's road in low clean leaps; one of them spins.
        const n = count(4, 7.4);
        const leftward = rand() < 0.5;
        const z = range(-85, -42);
        // (The eye of the barrel shows the sea from about 0.6 of the distance out to the left to
        // just right of the line: the pod crosses that.)
        const x = leftward ? range(-3, 3) : z * range(0.56, 0.64);
        const [hx, hz] = unit(leftward ? -1 : 1, range(-0.12, 0.2));
        const speed = range(1.9, 2.5);
        const life = range(17, 21);
        const period = range(2.6, 3.4);
        for (let i = 0; i < n; i += 1) {
            acts.push(makePorpoise({
                kind: 'spinner',
                at: at + rand() * 0.6,
                life,
                x: x - hx * i * range(2.2, 3.6) + hz * range(-3, 3),
                z: z - hz * i * range(2.2, 3.6) + hx * range(-3, 3),
                hx,
                hz,
                speed,
                period: period * range(0.9, 1.1),
                rise: range(0.8, 1.15),
                seed: rand() * TAU,
                variant: rand(),
            }));
        }
        break;
    }
    case 'loneLeap': {
        // One dolphin thrown clear of the trough, each in its own way.
        const u = rand();
        const spinner = u < 0.4;
        let style = 'arc';
        if (spinner) style = 'spin';
        else if (u < 0.62) style = 'flip';
        else if (u < 0.8) style = 'side';
        const d = range(8, 15);
        const x = range(-5.5, -1.5);
        const rise = spinner ? range(1.5, 2.2) : range(1.3, 2.1);
        const vy = Math.sqrt(2 * 0.46 * rise);
        acts.push(makeLeap({
            kind: spinner ? 'spinner' : 'bottlenose',
            at: at + LEAP_LEAD,
            row: troughRow(x, d),
            d,
            vx: range(-1.0, -0.45),
            vy,
            vz: range(-0.5, 0.35),
            style,
            turns: spinner ? Math.round(range(2, 4.4)) : 1,
            phase: rand() * TAU,
            variant: rand(),
        }));
        break;
    }
    case 'turtle': {
        // A green turtle in the wall, falling slowly back past the rider.
        acts.push(makeRide({
            kind: 'turtle',
            at,
            life: range(17, 21),
            row: range(0.17, 0.3),
            rowAmp: 0.025,
            rowRate: 0.3,
            d0: range(5, 6.5),
            d1: range(-3.5, -2.5),
            depth: range(0.55, 0.8),
            depthAmp: 0.1,
            fade: false,
            seed: rand() * TAU,
            variant: rand(),
            lean: 0.2,
            beat: 1.1,
        }));
        break;
    }
    case 'manta': {
        // A young manta in the wall, deeper than the pods swim: it flies slowly back past the
        // rider on its wings, its whole shape turned to the glass. (Under the flat of the trough,
        // where it used to pass, the sea mirrors the sky at the angle the rider sees it from and
        // nothing of a manta showed.)
        acts.push(makeRide({
            kind: 'manta',
            at,
            life: range(20, 24),
            row: range(0.2, 0.3),
            rowAmp: 0.03,
            rowRate: 0.22,
            d0: range(5.6, 6.8),
            d1: range(-4.2, -3.2),
            depth: range(0.95, 1.25),
            depthAmp: 0.12,
            fade: false,
            seed: rand() * TAU,
            variant: rand(),
            metres: range(2.1, 2.5),
            lean: 0.3,
            beat: 1,
        }));
        break;
    }
    case 'whaleBlow':
    case 'whaleFluke':
    case 'whaleBreach': {
        // A humpback far out on the sea: a blow, its flukes as it sounds, or the whole animal.
        const z = range(-170, -95);
        const x = z * range(0.12, 0.44);
        const [hx, hz] = unit(rand() < 0.5 ? -1 : 1, range(-0.5, 0.5));
        acts.push(makeWhale({
            at: at + 1,
            mode: WHALE_TURNS[kind],
            x,
            z,
            hx,
            hz,
            seed: rand() * TAU,
            variant: rand(),
            twist: rand() < 0.5 ? -1 : 1,
        }));
        break;
    }
    case 'birds': {
        // Shearwaters across the opening, in a loose line.
        const n = count(2, 5.4);
        const leftward = rand() < 0.5;
        const z = range(-80, -34);
        const y = range(3.5, 8.5);
        const x = leftward ? range(4, 9) : z * range(0.7, 0.76);
        const [hx, hz] = unit(leftward ? -1 : 1, range(-0.12, 0.16));
        const speed = range(2.6, 3.4);
        for (let i = 0; i < n; i += 1) {
            acts.push(makeSoar({
                at: at + i * range(0.5, 1.2),
                life: range(21, 25),
                x: x - hx * i * range(3, 6),
                y: y + range(-1.5, 1.5),
                z: z - hz * i * range(3, 6) + range(-4, 4),
                hx,
                hz,
                speed,
                swoop: range(1.1, 2.4),
                swoopRate: range(0.36, 0.5),
                sway: range(2, 5),
                seed: rand() * TAU,
                variant: rand(),
            }));
        }
        break;
    }
    default:
        break;
    }
    return acts;
}

/**
 * The sea's visits, kept as they are met (a visit's acts are the same every time they are made).
 */
export class WavesAmbient {
    /**
     * @param {object} p
     * @param {number} p.seed
     * @param {number} [p.scale]   how full the sea is (the tier's)
     */
    constructor({ seed = 1, scale = 1 } = {}) {
        this.seed = seed;
        this.scale = scale;
        this.kept = new Map();
    }

    visit(index) {
        let acts = this.kept.get(index);
        if (acts) {
            // Met again: the last to be let go (a Map keeps the order things were set in).
            this.kept.delete(index);
        } else {
            acts = visitActs(this.seed, index, this.scale);
        }
        this.kept.set(index, acts);
        // Keep the visits most lately met, never the one just asked for (a seek back to the
        // start once made every visit again every frame: the lowest index was the one let go).
        if (this.kept.size > KEPT_VISITS) this.kept.delete(this.kept.keys().next().value);
        return acts;
    }

    /** Every act that may be showing at `clock`, oldest visit first, into `out`. */
    actsAt(clock, out = []) {
        out.length = 0;
        const now = Math.floor(clock / VISIT_SECONDS);
        for (let index = Math.max(0, now - VISIT_REACH); index <= now; index += 1) {
            const acts = this.visit(index);
            for (let i = 0; i < acts.length; i += 1) out.push(acts[i]);
        }
        return out;
    }

    /** What the visit at a place in time is called. */
    nameAt(clock) {
        return VISITS[visitAt(this.seed, Math.floor(clock / VISIT_SECONDS))][0];
    }
}
