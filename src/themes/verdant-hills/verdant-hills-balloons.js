/**
 * Verdant Hills — the balloons.
 *
 * Hot-air balloons go up from four fields in the valley, two either side of the board, near and
 * far, and fly as balloons do: they cannot steer, so their pilots climb and sink to find the air
 * that goes their way. The valley's air turns with height: low down it drifts away up the valley,
 * higher it runs out across it, and high up it comes back towards the hill. So every change of
 * height bends a balloon's track, and no two flights are alike: one hunts up and down for its
 * wind, one boxes out low and comes back high overhead, one skims a field and climbs away, one
 * climbs in steps until it is a speck. Each ends by landing in the valley (the envelope tips over
 * and is packed away) or by flying out of the frame.
 *
 * The envelope stands up from the grass as it fills, turns slowly as it flies, leans into every
 * change of wind and swells when the burner roars, and the burner roars when the pilot climbs.
 * The clock lets one go every two minutes or so, now and then two together, and every new level
 * lets one go of its own; line clears fire every burner at once, and at dusk each one burns by
 * itself now and then and glows like a lantern.
 *
 * A flight is a pure function of its number: its track is flown once, a second at a time, into a
 * table when it is first needed (`verdantHillsBalloonFlight`), so the same flight plays on both
 * backends, in the playground's seek and in the tests. One mesh holds every balloon; five rows of
 * a uniform array place, pose and paint each.
 */
import * as THREE from 'three/webgpu';
import {
    attribute, cos, cross, dot, float, floor, fract, mix, normalGeometry, normalize, positionGeometry, positionWorld,
    pow, saturate, sin, smoothstep, step, uniformArray, uv, varying, vec3,
} from 'three/tsl';
import { createVerdantHillsVisibilityTest, verdantHillsEye, VERDANT_HILLS_VIEWS } from './verdant-hills-composition.js';
import { VERDANT_HILLS_KITE_COLOURS } from './verdant-hills-tetrominos.js';

/** Rows per balloon: [place, size] [first colour, burner] [second colour, cut] [pose quaternion] [shape]. */
export const VERDANT_HILLS_BALLOON_ROWS = 5;
const ROWS = VERDANT_HILLS_BALLOON_ROWS;
/** The clock's launches kept in the air (each may be a pair), and the levels' own. */
const CLOCK_LAUNCHES = 6;
const LEVEL_SLOTS = 4;
export const VERDANT_HILLS_BALLOONS = CLOCK_LAUNCHES * 2 + LEVEL_SLOTS;
/** The longest a flight can last, seconds; most land or leave the frame well before. */
export const VERDANT_HILLS_BALLOON_LIFE = 600;
/** Mean seconds between two of the clock's launches, and how far each may come early or late. */
export const VERDANT_HILLS_BALLOON_EVERY = 130;
const CLOCK_JITTER = 0.25;
/** When the clock's launch 0 goes up: before the session begins, so it opens with balloons in the air. */
const CLOCK_FIRST = -110;
/** Share of the clock's launches that go up as a pair from one field. */
const PAIRS = 0.3;
/** Level flights are numbered from here, so they never share a number with the clock's. */
const LEVEL_FLIGHTS = 2000000;

/** Height of the envelope from its mouth to its crown, and of the mouth over the grass on the ground, metres. */
const ENVELOPE = 20;
const MOUTH = 3.2;
/** Seconds the envelope takes to fill and stand up, to lie down after touchdown, and to be packed away. */
export const VERDANT_HILLS_BALLOON_FILL = 10;
const FILL = VERDANT_HILLS_BALLOON_FILL;
const SETTLE = 5;
const DEFLATE = 14;
const PACK = 3;
/** How often the track is written, seconds. */
const STEP = 1;

/**
 * The four fields (x, z) and the side of the frame each is on. Each stands about seventeen degrees
 * off the line of sight, just clear of the board's card, so its balloons have the whole of their
 * side of the frame to fly out across; the air carries them only ever outward (see `AIR`).
 */
export const VERDANT_HILLS_BALLOON_FIELDS = Object.freeze([
    Object.freeze({
        x: -126, z: -418, side: -1, far: false,
    }),
    Object.freeze({
        x: -272, z: -940, side: -1, far: true,
    }),
    Object.freeze({
        x: 126, z: -422, side: 1, far: false,
    }),
    Object.freeze({
        x: 272, z: -935, side: 1, far: true,
    }),
]);

/**
 * The valley's air by height over the field (metres): which way it carries a balloon, as an angle
 * from straight away from the lens (0) round through straight outward (90) to straight back
 * towards it (180), and how fast (m/s). Every angle is between 0 and 180, so the air never carries
 * a balloon towards the board.
 */
const AIR = Object.freeze([
    [0, 14, 1.2],
    [70, 26, 1.8],
    [150, 62, 2.2],
    [230, 120, 2.5],
    [320, 162, 3.0],
]);

/** The flights' plans: the heights their pilots fly at, leg by leg, as made by `planVerdantHillsBalloon`. */
export const VERDANT_HILLS_BALLOON_KINDS = Object.freeze(['hunt', 'box', 'skim', 'climb', 'hop']);

/** Each balloon's cut of cloth: gores in turn, hoops, a spiral, chevrons, harlequin, every kite colour. */
export const VERDANT_HILLS_BALLOON_CUTS = 6;

const hash = (n) => {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
};
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const smooth = (edge0, edge1, x) => {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
};
const between = (low, high, u) => low + (high - low) * u;
const fract01 = (x) => x - Math.floor(x);

const [EYE_X, , EYE_Z] = verdantHillsEye(VERDANT_HILLS_VIEWS.landscape);
let inFrame = null;
/** Whether a balloon with its mouth at (x, y, z) could be in either framing (made once, on first use). */
function seen(x, y, z) {
    inFrame ??= createVerdantHillsVisibilityTest();
    return inFrame(x, y + ENVELOPE * 0.5, z, ENVELOPE * 0.8);
}

/** The air at `height` over the field: [angle from straight away, radians; speed, m/s]. */
export function verdantHillsBalloonAir(height) {
    const h = clamp(height, AIR[0][0], AIR[AIR.length - 1][0]);
    let i = 0;
    while (i < AIR.length - 2 && h > AIR[i + 1][0]) i += 1;
    const [h0, a0, s0] = AIR[i];
    const [h1, a1, s1] = AIR[i + 1];
    const t = smooth(h0, h1, h);
    return [((a0 + (a1 - a0) * t) * Math.PI) / 180, s0 + (s1 - s0) * t];
}

/** The legs of a plan: [seconds, height over the field, least clearance over the land ahead]. */
function planLegs(kind, high, r) {
    if (kind === 'hunt') {
        return [
            [between(55, 85, r(3)), between(50, 80, r(4)), 25],
            [between(60, 85, r(5)), between(175, 250, r(6)) * high, 25],
            [between(45, 70, r(7)), between(70, 110, r(8)), 25],
            [between(55, 80, r(9)), between(150, 220, r(10)) * high, 25],
        ];
    }
    if (kind === 'box') {
        return [
            [between(90, 130, r(3)), between(50, 75, r(4)), 25],
            [between(200, 260, r(5)), between(290, 340, r(6)), 30],
        ];
    }
    if (kind === 'hop') {
        // A short flight low down, where the air is slow, and down again in the valley in sight.
        return [
            [between(60, 90, r(3)), between(60, 95, r(4)), 25],
            [between(50, 80, r(5)), between(35, 60, r(6)), 20],
        ];
    }
    if (kind === 'skim') {
        return [
            [between(70, 100, r(3)), between(110, 150, r(4)), 25],
            [between(40, 50, r(5)), -40, 2.5],
            [between(90, 120, r(6)), between(160, 230, r(7)) * high, 25],
        ];
    }
    // Up in steps until it is a speck; from the near fields it climbs out of the top of the frame.
    const steps = 0.6 + 0.4 * high;
    return [
        [between(55, 70, r(3)), between(120, 140, r(4)), 25],
        [between(60, 80, r(5)), between(215, 245, r(6)) * steps, 30],
        [between(80, 110, r(7)), between(320, 360, r(8)) * steps, 30],
    ];
}

/**
 * Who flies flight `flight`, from where and how: its field, its plan (legs of [seconds, height
 * over the field, least clearance over the land]), its air, its size, shape and cloth.
 */
export function planVerdantHillsBalloon(flight) {
    const n = Math.floor(flight);
    const r = (k) => hash(n * 13 + k);
    const level = n >= LEVEL_FLIGHTS;
    const side = ((n % 2) + 2) % 2 === 0 ? -1 : 1;
    // A pair goes up from one field (the second a little way out and back from the first, so the
    // two are seen side by side); a level's balloon from the near field, in sight at once.
    const spot = Math.floor(n / 4);
    const second = ((n % 4) + 4) % 4 >= 2;
    const far = !level && hash(spot * 5 + 3) < 0.4;
    const field = VERDANT_HILLS_BALLOON_FIELDS.find((f) => f.side === side && f.far === far);
    const kinds = level
        ? ['hunt', 'skim', 'hop']
        : ['hunt', far ? 'box' : 'skim', 'climb', 'hop', far ? 'box' : 'hunt'];
    const kind = kinds[Math.floor(r(2) * kinds.length) % kinds.length];
    const giant = r(11) < 0.12;
    const colour = Math.floor(r(19) * 7) % 7;
    return {
        flight: n,
        level,
        side,
        far,
        kind,
        x: field.x + (hash(spot * 5 + 1) - 0.5) * 24 + (second ? side * (far ? 60 : 32) : 0),
        z: field.z + (hash(spot * 5 + 2) - 0.5) * 40 - (second ? 45 : 0),
        // Near balloons stay lower: high over the near fields is above the frame.
        legs: planLegs(kind, far ? 1 : 0.62, r),
        // The air is never quite the same twice.
        veer: (r(12) - 0.5) * 0.36,
        breeze: between(0.82, 1.22, r(13)),
        scale: giant ? between(1.3, 1.42, r(14)) : between(0.76, 1.12, r(14)),
        stretch: between(0.9, 1.14, r(15)),
        spin: (r(16) < 0.5 ? -1 : 1) * between(0.022, 0.06, r(17)),
        phase: r(18) * Math.PI * 2,
        colours: [colour, (colour + 1 + Math.floor(r(20) * 6)) % 7],
        cut: Math.floor(r(21) * VERDANT_HILLS_BALLOON_CUTS) % VERDANT_HILLS_BALLOON_CUTS,
    };
}

/**
 * Fly flight `flight` over the land `ground(x, z)`, a second at a time: the pilot's height
 * from the plan (never lower than the plan's clearance over the land ahead), the burner's
 * demand from the climb, and the balloon carried by the air at its height. Returns the plan,
 * the track (x, y, z of the mouth, vx, vz, burner demand per second) and when it touched down
 * and when it is gone.
 */
export function verdantHillsBalloonFlight(flight, ground) {
    const plan = planVerdantHillsBalloon(flight);
    const steps = Math.ceil(VERDANT_HILLS_BALLOON_LIFE / STEP) + 1;
    const track = new Float32Array(steps * 6);
    const base = ground(plan.x, plan.z);
    let { x, z } = plan;
    let y = base + MOUTH;
    let vx = 0;
    let vz = 0;
    let vy = 0;
    let touch = Infinity;
    let gone = VERDANT_HILLS_BALLOON_LIFE;
    let unseen = 0;
    const legEnds = [];
    let sum = FILL;
    for (const [seconds] of plan.legs) {
        sum += seconds;
        legEnds.push(sum);
    }
    for (let i = 0; i < steps; i += 1) {
        const age = i * STEP;
        let demand = 0;
        if (age >= FILL && age < touch) {
            const leg = legEnds.findIndex((end) => age < end);
            const under = ground(x, z);
            const landing = leg < 0;
            let target = under + MOUTH;
            if (!landing) {
                const [, height, clear] = plan.legs[leg];
                // The land ahead (where the air takes it in twenty and forty seconds) sets the floor.
                const ahead = Math.max(under, ground(x + vx * 20, z + vz * 20), ground(x + vx * 40, z + vz * 40));
                target = Math.max(base + MOUTH + height, ahead + MOUTH + clear);
            }
            const above = y - under - MOUTH;
            // Down gently, slowest of all over the last few metres of a landing.
            const down = landing ? between(0.45, 1.7, smooth(4, 40, above)) : 2;
            const want = clamp((target - y) / 14, -down, 2.6);
            vy += (want - vy) * (STEP / 5);
            // The burner roars to climb or to hold; a sinking balloon lets it rest.
            demand = clamp((want - vy) * 1.6 + Math.max(0, want) * 0.4 + 0.12, 0, 1);
            if (landing && above < 8) demand = 0;
            const [angle, speed] = verdantHillsBalloonAir(y - MOUTH - base);
            // Bearing from the lens, and the air's way from there: always outward of the line of sight.
            const bearing = Math.atan2(x - EYE_X, -(z - EYE_Z));
            const way = bearing + plan.side * clamp(angle + plan.veer, 0.12, Math.PI - 0.12);
            // Near the ground the air is slower.
            const drift = speed * plan.breeze * between(0.35, 1, smooth(0, 18, above));
            vx += (Math.sin(way) * drift - vx) * (STEP / 12);
            vz += (-Math.cos(way) * drift - vz) * (STEP / 12);
            x += vx * STEP;
            z += vz * STEP;
            y += vy * STEP;
            const lowest = ground(x, z) + MOUTH;
            if (y < lowest) {
                y = lowest;
                vy = Math.max(0, vy);
            }
            if (landing && y - lowest < 0.6) touch = age;
            // Out of every framing for a while, up and away: its flight is over for the eye.
            unseen = seen(x, y, z) ? 0 : unseen + STEP;
            if (unseen >= 6 && age > FILL + 30 && gone === VERDANT_HILLS_BALLOON_LIFE) gone = age;
        } else if (age >= touch) {
            // Down: the basket drags a few metres and stops.
            vx *= 0.55;
            vz *= 0.55;
            x += vx * STEP;
            z += vz * STEP;
            y = ground(x, z) + MOUTH;
        }
        track.set([x, y, z, vx, vz, demand], i * 6);
        // Past its end the rest of the track holds the last place.
        if (age >= gone) {
            for (let k = i + 1; k < steps; k += 1) track.set([x, y, z, 0, 0, 0], k * 6);
            break;
        }
    }
    if (Number.isFinite(touch)) gone = Math.min(gone, touch + SETTLE + DEFLATE + PACK);
    return {
        plan, track, touch, gone,
    };
}

const flights = new WeakMap();
/** A flight's track, flown once per land and kept while it may still be in the air. */
function flightFor(flight, ground) {
    let cache = flights.get(ground);
    if (!cache) {
        cache = new Map();
        flights.set(ground, cache);
    }
    let found = cache.get(flight);
    if (!found) {
        found = verdantHillsBalloonFlight(flight, ground);
        cache.set(flight, found);
        if (cache.size > 48) cache.delete(cache.keys().next().value);
    }
    return found;
}

/** Read the track at `age` (seconds, between rows) into `out` [x, y, z, vx, vz, demand]. */
function sample(track, age, out) {
    const last = track.length / 6 - 1;
    const at = clamp(age / STEP, 0, last);
    const i = Math.min(Math.floor(at), last - 1);
    const t = at - i;
    for (let k = 0; k < 6; k += 1) out[k] = track[i * 6 + k] + (track[(i + 1) * 6 + k] - track[i * 6 + k]) * t;
    return out;
}

const here = new Float32Array(6);
const before = new Float32Array(6);
const after = new Float32Array(6);
const spinQ = new THREE.Quaternion();
const leanQ = new THREE.Quaternion();
const leanAxis = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export function createVerdantHillsBalloonPose() {
    return {
        place: new THREE.Vector3(),
        size: 0,
        demand: 0,
        radial: 1,
        length: 1,
        lie: 0,
        lean: 0,
        turn: new THREE.Quaternion(),
        plan: null,
    };
}

/**
 * The pose of flight `flight` at `age` seconds after it was let go: where its mouth is
 * (`place`), how big it is (`size`, 0 before it is laid out and after it is packed away or
 * gone), how it is turned and leant (`turn`, `lean`), the envelope's fullness across and along
 * and how far it lies over (`radial`, `length`, `lie`) and how hard the pilot wants the burner
 * (`demand`).
 */
export function verdantHillsBalloonPose(flight, age, ground, pose = createVerdantHillsBalloonPose()) {
    const {
        plan, track, touch, gone,
    } = flightFor(flight, ground);
    sample(track, age, here);
    pose.place.set(here[0], here[1], here[2]);
    pose.demand = here[5];
    pose.plan = plan;
    if (!(age > 0) || age >= gone) {
        pose.size = 0;
        return pose;
    }
    // Laid out on the grass, it fills and stands up; down again, it lies over and is packed away.
    const fill = clamp(age / FILL, 0, 1);
    const landed = Number.isFinite(touch);
    const down = landed ? clamp((age - touch - SETTLE) / DEFLATE, 0, 1) : 0;
    const packed = landed ? clamp((age - touch - SETTLE - DEFLATE) / PACK, 0, 1) : 0;
    pose.size = plan.scale * smooth(0, 1.5, age) * (1 - smooth(0, 1, packed));
    pose.radial = (0.22 + 0.78 * smooth(0, 0.75, fill)) * (1 - 0.78 * smooth(0.15, 1, down));
    pose.length = plan.stretch * (0.84 + 0.16 * fill);
    pose.lie = 1.42 * (1 - smooth(0.4, 1, fill)) + 1.42 * smooth(0, 0.6, down);
    // It turns slowly as it goes, now one way, now back.
    const spin = plan.phase + plan.spin * age + 0.7 * Math.sin(age * 0.021 + plan.phase);
    spinQ.setFromAxisAngle(UP, spin);
    // It leans into every change of the air, and swings a little under its own weight.
    sample(track, age - 1.5, before);
    sample(track, age + 1.5, after);
    const aloft = age > FILL && age < touch ? 1 : 0;
    let lx = ((after[3] - before[3]) / 3) * 1.1 * aloft;
    let lz = ((after[4] - before[4]) / 3) * 1.1 * aloft;
    const swing = 0.03 * aloft * smooth(FILL, FILL + 20, age);
    lx += swing * Math.sin(age * 0.71 + plan.phase);
    lz += swing * Math.cos(age * 0.53 + plan.phase * 1.7);
    pose.lean = Math.min(0.15, Math.hypot(lx, lz));
    if (pose.lean > 1e-5) {
        // Tip the top towards (lx, lz): about the axis up × lean.
        leanAxis.set(lz, 0, -lx).normalize();
        leanQ.setFromAxisAngle(leanAxis, pose.lean);
    } else {
        leanQ.identity();
    }
    pose.turn.multiplyQuaternions(leanQ, spinQ);
    return pose;
}

const scratchPose = createVerdantHillsBalloonPose();
/**
 * Where the mouth of flight `flight` is `age` seconds after it was let go (into `out`), and how
 * much of its size it shows: 0 before it is laid out and after it has gone.
 */
export function verdantHillsBalloonPlace(flight, age, ground, out = new THREE.Vector3()) {
    const pose = verdantHillsBalloonPose(flight, age, ground, scratchPose);
    out.copy(pose.place);
    return pose.size;
}

/** When the clock's launch `k` goes up (seconds of this world's clock). */
export function verdantHillsClockLaunch(k) {
    return CLOCK_FIRST + (k + (hash(k * 7 + 3) - 0.5) * 2 * CLOCK_JITTER) * VERDANT_HILLS_BALLOON_EVERY;
}

/**
 * The clock's launch `k`: its flights (one, or a pair from one spot of a field) and when each
 * goes. Flight numbers keep the side in their parity, so the launches take the sides in turn.
 */
export function verdantHillsClockFlights(k) {
    const at = verdantHillsClockLaunch(k);
    const first = 8 * (k + 100000) + (((k % 2) + 2) % 2);
    const pair = hash(k * 11 + 5) < PAIRS;
    return {
        at, first, second: pair ? first + 2 : null, gap: between(18, 34, hash(k * 17 + 9)),
    };
}

/** The envelope's radius (of its height) at `t` up it: a narrow mouth, widest above the middle, a round crown. */
function envelopeRadius(t) {
    return 0.062 * (1 - t) + 0.4 * Math.sin(Math.PI * t ** 1.35) ** 0.6;
}

/** One balloon about its mouth: the envelope (part 0) and the basket under it (part 1). */
function createBalloonGeometry() {
    const around = 24;
    const up = 16;
    const positions = [];
    const normals = [];
    const uvs = [];
    const parts = [];
    const indices = [];
    for (let j = 0; j <= up; j += 1) {
        const t = j / up;
        const radius = envelopeRadius(t);
        // The slope of the profile gives the normal its lift.
        const slope = (envelopeRadius(Math.min(1, t + 0.01)) - envelopeRadius(Math.max(0, t - 0.01))) / 0.02;
        for (let i = 0; i <= around; i += 1) {
            const angle = (i / around) * Math.PI * 2;
            positions.push(Math.cos(angle) * radius * ENVELOPE, t * ENVELOPE, Math.sin(angle) * radius * ENVELOPE);
            const lift = j === up ? 1 : -slope;
            const length = Math.hypot(1, lift) || 1;
            normals.push(Math.cos(angle) / length, lift / length, Math.sin(angle) / length);
            uvs.push(i / around, t);
            parts.push(0);
        }
    }
    for (let j = 0; j < up; j += 1) {
        for (let i = 0; i < around; i += 1) {
            const a = j * (around + 1) + i;
            const b = a + around + 1;
            indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
    }
    // The basket: a small box hung under the mouth.
    const basket = new THREE.BoxGeometry(1.7, 1.3, 1.7);
    basket.translate(0, -2.5, 0);
    const base = positions.length / 3;
    const basketPositions = basket.getAttribute('position');
    const basketNormals = basket.getAttribute('normal');
    for (let i = 0; i < basketPositions.count; i += 1) {
        positions.push(basketPositions.getX(i), basketPositions.getY(i), basketPositions.getZ(i));
        normals.push(basketNormals.getX(i), basketNormals.getY(i), basketNormals.getZ(i));
        uvs.push(0, 0);
        parts.push(1);
    }
    for (let i = 0; i < basket.index.count; i += 1) indices.push(base + basket.index.getX(i));
    basket.dispose();
    return {
        positions, normals, uvs, parts, indices,
    };
}

/** Rotate `v` by the unit quaternion `q` (both nodes): v + 2 q×(q×v + w v). */
function rotateByQuaternion(v, q) {
    const axis = q.xyz;
    return v.add(cross(axis, cross(axis, v).add(v.mul(q.w))).mul(2));
}

/** Lay `v` over about its local z axis by the angle whose cosine and sine are `c` and `s`. */
function layOver(v, c, s) {
    return vec3(v.x.mul(c).sub(v.y.mul(s)), v.x.mul(s).add(v.y.mul(c)), v.z);
}

export class VerdantHillsBalloons {
    constructor({ light, groundHeight = () => 8 }) {
        this.light = light;
        this.groundHeight = groundHeight;
        this.group = new THREE.Group();
        this.group.name = 'VerdantHillsBalloons';
        this.rows = Array.from({ length: VERDANT_HILLS_BALLOONS * ROWS }, () => new THREE.Vector4(0, 0, 0, 0));
        this.pose = createVerdantHillsBalloonPose();
        this.tones = VERDANT_HILLS_KITE_COLOURS.map((hex) => new THREE.Color(hex));
        /** The levels' launches: when each was let go (the clock's are a closed form of the time). */
        this.launches = [];
        this.launched = 0;
        this.aloft = 0;
        this.time = 0;
        for (let slot = 0; slot < VERDANT_HILLS_BALLOONS; slot += 1) this.fold(slot);
    }

    build() {
        const one = createBalloonGeometry();
        const count = one.positions.length / 3;
        const positions = new Float32Array(count * 3 * VERDANT_HILLS_BALLOONS);
        const normals = new Float32Array(count * 3 * VERDANT_HILLS_BALLOONS);
        const uvs = new Float32Array(count * 2 * VERDANT_HILLS_BALLOONS);
        const parts = new Float32Array(count * 2 * VERDANT_HILLS_BALLOONS);
        const indices = [];
        for (let slot = 0; slot < VERDANT_HILLS_BALLOONS; slot += 1) {
            positions.set(one.positions, slot * count * 3);
            normals.set(one.normals, slot * count * 3);
            uvs.set(one.uvs, slot * count * 2);
            for (let i = 0; i < count; i += 1) parts.set([slot, one.parts[i]], (slot * count + i) * 2);
            for (const index of one.indices) indices.push(index + slot * count);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        geometry.setAttribute('aBalloon', new THREE.BufferAttribute(parts, 2));
        geometry.setIndex(indices);
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 150, -700), 1600);
        const material = this.createMaterial();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'VerdantHillsBalloons';
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = false;
        this.mesh = mesh;
        this.geometry = geometry;
        this.material = material;
        this.group.add(mesh);
        return this;
    }

    createMaterial() {
        const { light } = this;
        const material = new THREE.MeshBasicNodeMaterial({ fog: false });
        material.name = 'VerdantHillsBalloons';
        const rows = uniformArray(this.rows, 'vec4');
        const kites = uniformArray(this.tones, 'color');
        const tag = attribute('aBalloon', 'vec2'); // slot, part (0 envelope, 1 basket)
        const first = tag.x.add(0.5).floor().toInt().mul(ROWS);
        const place = rows.element(first);
        const paintA = rows.element(first.add(1));
        const paintB = rows.element(first.add(2));
        const turn = rows.element(first.add(3));
        const shape = rows.element(first.add(4));
        // The envelope is filled across (radial) and along (length) and lies over about its mouth;
        // the basket keeps its size and hangs under it. Then the whole turns and leans.
        const envelope = float(1).sub(tag.y);
        const radial = mix(float(1), shape.x, envelope);
        const length = mix(float(1), shape.y, envelope);
        const lie = shape.z.mul(envelope);
        const c = cos(lie);
        const s = sin(lie);
        const over = layOver(positionGeometry.mul(vec3(radial, length, radial)), c, s);
        // Lying, it is lowered onto the grass (shape.w) and squashed flat where it meets it: the
        // ground is MOUTH metres under the mouth, in the balloon's own units. Aloft, the envelope is
        // all above its mouth and neither touches it.
        const grass = float(-MOUTH).div(place.w.max(0.05)).add(0.05);
        const laid = vec3(over.x, mix(over.y, over.y.sub(shape.w).max(grass), envelope), over.z);
        // A balloon not in the air is folded to a point under the land.
        material.positionNode = place.xyz.add(rotateByQuaternion(laid, turn).mul(place.w));
        // Normals take the inverse of the fill's scale, then the same turns.
        const bent = layOver(normalGeometry.div(vec3(radial, length, radial)), c, s);
        const normal = normalize(varying(rotateByQuaternion(bent, turn), 'verdantBalloonNormal'));
        const first3 = varying(paintA.rgb, 'verdantBalloonFirst');
        const second3 = varying(paintB.rgb, 'verdantBalloonSecond');
        const burner = varying(paintA.w, 'verdantBalloonBurner');
        const cut = varying(paintB.w, 'verdantBalloonCut');
        const basket = varying(tag.y, 'verdantBalloonPart');
        const st = uv();
        const gore = fract(st.x.mul(12));
        const cream = vec3(0.94, 0.9, 0.78);
        // Six cuts of cloth: gores in turn, hoops, a spiral, chevrons, harlequin diamonds, and a
        // gore of every kite colour round the envelope under a cream crown.
        const gores = step(0.5, fract(st.x.mul(6)));
        const hoop = fract(st.y.mul(2.5));
        const hoops = mix(mix(first3, cream, step(0.34, hoop)), second3, step(0.67, hoop));
        const spiral = step(0.5, fract(st.x.mul(6).add(st.y.mul(2.6))));
        const chevron = step(0.5, fract(st.y.mul(5).add(gore.sub(0.5).abs().mul(1.4))));
        const diamondA = step(0.5, fract(st.x.mul(12).add(st.y.mul(5))));
        const diamondB = step(0.5, fract(st.x.mul(12).sub(st.y.mul(5))));
        const harlequin = mix(first3, mix(second3, cream, 0.25), diamondA.sub(diamondB).abs());
        const rainbow = mix(kites.element(floor(st.x.mul(12)).mod(7).toInt()), cream, step(0.78, st.y));
        const pick = (index) => saturate(float(1).sub(cut.sub(index).abs()));
        let cloth = mix(first3, second3, gores).mul(pick(0))
            .add(hoops.mul(pick(1)))
            .add(mix(first3, second3, spiral).mul(pick(2)))
            .add(mix(second3, mix(first3, cream, 0.35), chevron).mul(pick(3)))
            .add(harlequin.mul(pick(4)))
            .add(rainbow.mul(pick(5)));
        // A plain crown and a scorched skirt at the mouth, and a seam between every two gores.
        cloth = mix(cloth, first3, smoothstep(0.9, 0.94, st.y));
        cloth = mix(cloth, vec3(0.16, 0.13, 0.11), smoothstep(0.05, 0.02, st.y));
        const seam = smoothstep(0.42, 0.5, gore.sub(0.5).abs());
        cloth = cloth.mul(seam.mul(0.2).oneMinus());
        const tone = mix(cloth, vec3(0.26, 0.18, 0.1), step(0.5, basket));
        // Each gore bellies out between its seams: it is shaded like the round panel it is.
        const sun = light.uSunDir;
        const facing = dot(normal, sun);
        const belly = gore.sub(0.5).mul(0.5).oneMinus().mul(seam.mul(0.12).oneMinus());
        // Nylon is thin: the side turned from the sun glows with the light that comes through.
        const lit = saturate(facing.mul(0.62).add(0.42)).mul(belly).add(saturate(facing.negate()).mul(0.3));
        const world = positionWorld;
        // Under a cloud the thin cloth still carries the bright sky's light: the shadow only dims it,
        // or a balloon against the sky reads as a dark blot.
        const shade = light.cloudShadow(world).mul(0.6).add(0.4);
        const day = tone.mul(lit).mul(light.uSunColor).mul(shade).mul(0.3)
            .add(tone.mul(light.ambient(normal)).mul(0.9));
        // The burner: the envelope lights from the mouth up, as a lantern does, most of all at dusk.
        const flame = vec3(1.0, 0.52, 0.17);
        const lantern = mix(flame, cloth.mul(flame).mul(2.2), 0.55)
            .mul(pow(saturate(float(1).sub(st.y)), 1.6).mul(0.85).add(0.12))
            .mul(burner).mul(light.uNight.mul(1.5).add(0.28))
            .mul(step(basket, 0.5));
        // A slow shimmer runs up the cloth while the burner roars.
        const roar = sin(st.y.mul(26).sub(light.uTime.mul(9))).mul(0.12).add(1);
        material.colorNode = light.haze(day, { world }).add(lantern.mul(roar));
        return material;
    }

    /** Let a balloon go for a new level, at `time` (this world's clock). */
    launch(time = this.time) {
        const at = Number.isFinite(time) ? time : this.time;
        // The sides take turns, the first from the left, in sight at once.
        const n = this.launched;
        this.launches.push({ at, flight: LEVEL_FLIGHTS + 4 * n + (n % 2) });
        this.launched += 1;
        if (this.launches.length > LEVEL_SLOTS) this.launches.shift();
    }

    /** Fold slot `slot` away to a point under the land. */
    fold(slot) {
        const { rows } = this;
        const row = slot * ROWS;
        rows[row].set(0, -500, 0, 0);
        rows[row + 1].w = 0;
        rows[row + 3].set(0, 0, 0, 1);
        rows[row + 4].set(1, 1, 0, 0);
    }

    /** Pose flight `flight`, `age` seconds old, into slot `slot`; returns whether it is in the air. */
    fly(slot, flight, age, fire, dusk) {
        if (age === null || !(age > 0) || age >= VERDANT_HILLS_BALLOON_LIFE) {
            this.fold(slot);
            return false;
        }
        const { rows, pose, tones } = this;
        verdantHillsBalloonPose(flight, age, this.groundHeight, pose);
        if (!(pose.size > 0)) {
            this.fold(slot);
            return false;
        }
        const { plan } = pose;
        const row = slot * ROWS;
        rows[row].set(pose.place.x, pose.place.y, pose.place.z, pose.size);
        // The pilot's burns: short roars on a beat of its own, longer the harder it climbs; the
        // hot inflation as it stands up; at dusk now and then by itself; and every clear.
        const beat = fract01(this.time / 6 + plan.phase);
        const duty = pose.demand > 0.14 ? 0.12 + 0.6 * pose.demand : 0;
        const roar = duty > 0 ? smooth(1 - duty - 0.04, 1 - duty, beat) * (1 - smooth(0.96, 1, beat)) : 0;
        const inflate = smooth(0.5, 0.75, age / FILL) * (1 - smooth(1, 1.4, age / FILL));
        const glow = Math.max(0, Math.sin(this.time * 0.74 + plan.flight * 2.4)) ** 10 * 0.75 * dusk;
        const burner = Math.min(1, fire + Math.max(roar, inflate, glow));
        const swell = 1 + 0.03 * burner;
        // Lying on the grass, the envelope's side rests on the ground, not on the height of its mouth.
        const local = 1 / Math.max(pose.size, 0.05);
        const drop = Math.max(0, MOUTH * local - 0.4 * ENVELOPE * pose.radial) * smooth(0, 1.42, pose.lie);
        const [a, b] = plan.colours;
        rows[row + 1].set(tones[a].r, tones[a].g, tones[a].b, burner);
        rows[row + 2].set(tones[b].r, tones[b].g, tones[b].b, plan.cut);
        rows[row + 3].set(pose.turn.x, pose.turn.y, pose.turn.z, pose.turn.w);
        rows[row + 4].set(pose.radial * swell, pose.length * swell, pose.lie, drop);
        return true;
    }

    /**
     * Fly the balloons for this frame. `burn` (0..1) is how hard play fires the burners; `night`
     * (0..1) how far dusk has come, when each also burns by itself now and then.
     */
    update(time, { burn = 0, night = 0 } = {}) {
        this.time = Number.isFinite(time) ? time : this.time;
        const fire = Number.isFinite(burn) ? clamp(burn, 0, 1) : 0;
        const dusk = Number.isFinite(night) ? clamp(night, 0, 1) : 0;
        let aloft = 0;
        // The clock's launches, newest first: launch k takes slots 2(k mod 6) and the one after,
        // which launch k + 6 takes over only long after the last of k's flights has ended.
        let newest = Math.floor((this.time - CLOCK_FIRST) / VERDANT_HILLS_BALLOON_EVERY);
        if (verdantHillsClockLaunch(newest + 1) <= this.time) newest += 1;
        else if (verdantHillsClockLaunch(newest) > this.time) newest -= 1;
        for (let i = 0; i < CLOCK_LAUNCHES; i += 1) {
            const k = newest - i;
            const launch = verdantHillsClockFlights(k);
            const slot = (((k % CLOCK_LAUNCHES) + CLOCK_LAUNCHES) % CLOCK_LAUNCHES) * 2;
            if (this.fly(slot, launch.first, this.time - launch.at, fire, dusk)) aloft += 1;
            const second = launch.second === null ? null : this.time - launch.at - launch.gap;
            if (this.fly(slot + 1, launch.second ?? 0, second, fire, dusk)) aloft += 1;
        }
        for (let i = 0; i < LEVEL_SLOTS; i += 1) {
            const launch = this.launches[i];
            const age = launch ? this.time - launch.at : null;
            if (this.fly(CLOCK_LAUNCHES * 2 + i, launch ? launch.flight : 0, age, fire, dusk)) aloft += 1;
        }
        this.aloft = aloft;
    }

    /** Forget the levels' balloons (a new session, a replay): the clock's are the time's own. */
    reset() {
        this.launches.length = 0;
        this.launched = 0;
    }

    dispose() {
        this.geometry?.dispose();
        this.material?.dispose();
        this.group.removeFromParent();
        this.group.clear();
        this.mesh = null;
    }
}
