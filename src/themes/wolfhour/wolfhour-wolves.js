/**
 * Wolfhour's wolves. Each wolf is one small quad whose shader unions the tapered capsules of its
 * rig (wolfhour-wolf-rig.js) smoothly into a single organic silhouette, roughens the outline into
 * fur with the sky's noise tile, and lights a hairline of moonlight along the edges that face the
 * moon (the union's own gradient gives the normal). Faint glints mark the eyes.
 *
 * The pack (a lead, a sitter and a young wolf) stands on the right-hand spur looking left toward
 * the moon; across the valley a lone wolf sits on the left-hand spur; now and then a scout walks
 * in along the foreground ridge, stops at a lookout (looks over the valley, sniffs the snow, lifts
 * a paw to listen, looks at you with a tilt of its head and back over its shoulder), turns round
 * and trots away. Each lives through its own repertoire (wolfhour-wolf-behaviour.js): the lead
 * looks round, yawns, shakes the snow off, stretches, sits, scratches, listens, circles and lies
 * down; the sitter lies down and rests its head, scratches; the young one paces, plays, digs and
 * hunts mice under the snow with a nose-first pounce. A wolf turns round through a view of its
 * face rather than flipping, sits down haunches first and walks its forepaws out to lie down. They
 * blink, and their breath smokes in the cold.
 *
 * Gameplay: a line clear makes the pack turn to look at you; a combo excites the young wolf (a
 * play bow, a wagging tail); a four-line clear makes the pack howl at the moon, one after another,
 * breath smoking (lying wolves sit up for it; a wolf in mid-pounce stays on the hunt), and the wolf
 * across the valley answers; a back-to-back clear makes it answer on its own. Fast play never
 * restarts these: the next clear holds the look, the bow or the howl's note on (heldEnvelope,
 * rearm), and a howl that comes as the last one falls rises under it.
 *
 * Every pose is a pure function of time (and of when the howls, glances and excitements began),
 * so a seek or a capture lands on the same frame. Rig units: a wolf faces +x with paws on y = 0.
 */
import * as THREE from 'three/webgpu';
import {
    attribute, exp, float, uv, vec3,
} from 'three/tsl';
import {
    CAPSULE_COUNT, CAPSULE_STRIDE, MAX_GROUND_SLOPE, WOLF_BOUNDS, poseWolf,
} from './wolfhour-wolf-rig.js';
import { WOLF_COATS, WOLF_LOOKS, roverLook } from './wolfhour-wolf-coats.js';
import {
    FAR_FILE, ROVER_COUNT, SETTLE, farFileAt, follow, moonWolfAt, roversAt, summonMoonWolf, visitPlan,
} from './wolfhour-wolf-travel.js';
import { WOLF_TEXELS, createWolfMaterial, createWolfTable } from './wolfhour-wolf-material.js';
import {
    REPERTOIRES, TURN, YOUNG_MOVES, behaviourAt, busyAt, glide, glidePace,
} from './wolfhour-wolf-behaviour.js';
import { createWolfhourNightLight, makeWolfhourNoiseTexture } from './wolfhour-sky.js';

/** How brightly the eyes give the moon back (the coat scales it). */
const EYE_SHINE = 0.5;

/** Rows in the wolves' table: the most wolves the night ever shows at once. */
export const MAX_WOLVES = 18;

/* ── Who stands where ──────────────────────────────────────────────────────────────── */

/**
 * The pack, in pack units from the lead's paws: its role (its repertoire), place, scale, resting
 * head lift, howl (head lift and how late it joins) and an idle phase so no two breathe together.
 */
export const PACK = Object.freeze([
    Object.freeze({
        name: 'lead',
        role: 'lead',
        x: 0,
        sink: 0.2,
        scale: 1,
        facing: -1,
        head: 2,
        howl: 64,
        delay: 0,
        idlePhase: 0.3,
    }),
    Object.freeze({
        name: 'sitter',
        role: 'sitter',
        x: -40,
        sink: 0.2,
        scale: 0.94,
        facing: -1,
        head: 4,
        howl: 66,
        delay: 0.55,
        idlePhase: 2.1,
    }),
    Object.freeze({
        name: 'young',
        role: 'young',
        x: 46,
        sink: 0.2,
        scale: 0.8,
        facing: -1,
        head: -4,
        howl: 58,
        delay: 1.05,
        idlePhase: 4.4,
    }),
    // The lead's mate lies on the near face of the spur, in front of the others (`drop` units
    // below the crest, `depth` in front).
    Object.freeze({
        name: 'mate',
        role: 'mate',
        x: 17,
        drop: 10,
        depth: 1.2,
        sink: 0.2,
        scale: 0.95,
        facing: -1,
        head: 3,
        howl: 66,
        delay: 0.8,
        idlePhase: 3.6,
    }),
    // The yearling, all ears and paws, busy on the slope below the sitter; it faces the pack and
    // turns round to the moon to howl.
    Object.freeze({
        name: 'yearling',
        role: 'yearling',
        x: -68,
        drop: 5,
        depth: 0.9,
        sink: 0.2,
        scale: 0.72,
        facing: 1,
        howlFacing: -1,
        head: 0,
        howl: 60,
        delay: 1.3,
        idlePhase: 6.1,
    }),
]);

/**
 * The white wolf of the left-hand summit: it looks toward the moon (its comings and goings:
 * wolfhour-wolf-travel.js MOON_WOLF).
 */
export const SUMMIT = Object.freeze({
    name: 'summit',
    role: 'summit',
    look: 'moon',
    sink: 0.2,
    scale: 1,
    facing: 1,
    head: 4,
    howl: 66,
    delay: 1.4,
    idlePhase: 3.3,
});

/** The far file's coats (wolfhour-wolf-coats.js looks): pale ones, that the moon finds on the skyline. */
const FAR_LOOKS = Object.freeze(['mate', 'moon', 'lead', 'scout', 'moon']);
/** A run called up by play: how long the ridge is taken for it, and the number its looks are dealt from. */
const DASH_LENGTH = 17;
const DASH_INDEX = 100001;
/** Snow kicked up by a galloping wolf: how long a puff lives (seconds). */
const KICK_LIFE = 0.9;

/** The wolf across the valley: sits facing the pack and answers a moment after the lead. */
export const ANSWERER = Object.freeze({
    name: 'answer',
    role: 'answer',
    x: 0,
    sink: 0.2,
    scale: 1,
    facing: 1,
    head: 6,
    howl: 68,
    delay: 1.9,
    idlePhase: 5.7,
});

/** The scout's visits to the foreground ridge (scout units from its anchor; seconds). */
export const SCOUT = Object.freeze({
    name: 'scout',
    sink: 0.2,
    scale: 1,
    head: 0,
    howl: 62,
    delay: 0.8,
    idlePhase: 1.3,
    /** From off screen to the right, to the lookout where it stops to look over the valley. */
    from: 190,
    to: -40,
    /** Walking in and trotting out (units per second along the ridge). */
    speed: 16,
    trotSpeed: 30,
    /** The first arrival, the period between visits, and the pause at the lookout. */
    first: 18,
    period: 96,
    pause: 12,
    /** How long it takes to get up to speed and to slow to a stop (seconds). */
    ramp: 0.8,
});

/**
 * Strides (rig units): the distance the body travels per gait cycle, walking and trotting. The
 * gait is read from the distance actually travelled, so a planted paw stays where it was put down.
 */
export const WALK_STRIDE = 15;
export const TROT_STRIDE = 22;

/** The howl's timing (seconds): the head rises, holds the note, and comes down. */
export const HOWL = Object.freeze({ rise: 0.6, hold: 2.6, fall: 1.0 });
/**
 * The longest a howl holds its note (seconds): a quad (a perfect clear, a fever) while the pack
 * is already howling holds the note on for it instead of being refused, up to this; after it the
 * pack draws breath, and the next one begins a fresh howl under the one still falling.
 */
export const HOWL_MAX_HOLD = 5.4;
/** After a note held that long, the pack's breath (seconds) between its fall and the next note. */
export const HOWL_BREATH = 0.6;
/** The wolf across the valley answering on its own (a back-to-back clear). */
export const ANSWER = Object.freeze({ rise: 0.5, hold: 1.7, fall: 0.9 });
/** A line clear's glance: the pack turns to look at you. */
const GLANCE = Object.freeze({ rise: 0.4, hold: 1.6, fall: 0.8 });
/** A combo's excitement: the young wolf bows, wags and bounces. */
const EXCITE = Object.freeze({ rise: 0.35, hold: 2.6, fall: 0.7 });
/** How long past a howl's note a moving wolf's behaviour still stands still for it. */
const HOWL_STILL_TAIL = HOWL.fall + 1.2;
/** Snow puffs: how long one lives (seconds). */
const PUFF_LIFE = 1.6;
/** A breath in the cold: how long a puff lives (seconds) and how dense it is. */
const BREATH = Object.freeze({ life: 2.2, alpha: 0.16 });
/** How fast a wolf breathes (radians per second): a breath every 4.8 s. */
const BREATH_RATE = 1.3;

const smooth = (t) => {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
};
const span = (u, from, to, ramp) => Math.min(smooth((u - from) / ramp), 1 - smooth((u - (to - ramp)) / ramp));

/** A blink, 0..1: about every five seconds the eyes close for a sixth of a second. */
export function blinkAt(t, phase = 0) {
    const period = 4.4 + phase * 0.35;
    const k = Math.floor((t + phase * 3.1) / period);
    const jitter = (Math.abs(Math.sin(k * 12.9898 + phase * 78.233)) * 43758.5453) % 1;
    const centre = k * period - phase * 3.1 + 0.3 + jitter * (period - 0.6);
    return 1 - smooth((Math.abs(t - centre) - 0.05) / 0.06);
}

/** 0..1 envelope of an event that started `age` seconds ago (rise, hold, fall). */
export function eventEnvelope(age, { rise, hold, fall }) {
    if (!Number.isFinite(age) || age < 0) return 0;
    if (age < rise) return smooth(age / rise);
    if (age < rise + hold) return 1;
    return 1 - smooth((age - rise - hold) / fall);
}

/**
 * 0..1 envelope of a HELD event at `t`: it rose from `start` over `rise`, holds until `holdEnd`
 * (at least `start + rise`) and falls over `fall`. With `holdEnd = start + rise + hold` it is
 * eventEnvelope; a later event of the same kind moves `holdEnd` on (rearm) instead of starting
 * over, so the pose it drives never snaps back down to lift again.
 */
export function heldEnvelope(t, start, holdEnd, { rise, fall }) {
    const age = t - start;
    if (!Number.isFinite(age) || age < 0) return 0;
    if (age < rise) return smooth(age / rise);
    if (t < holdEnd) return 1;
    return 1 - smooth((t - holdEnd) / fall);
}

/** The inverse of `smooth` on 0..1: how far along its rise a value lies. */
export function inverseSmooth(value) {
    const v = Math.min(1, Math.max(0, value));
    return 0.5 - Math.sin(Math.asin(1 - 2 * v) / 3);
}

/**
 * Re-arm a held event (`slot`: { start, holdEnd }) at `at`. While it is up (rising or holding)
 * its hold runs on a full `hold` past this one (never past `maxHold` of note); once it is falling
 * or over it rises again from exactly where it is. Either way the envelope stays continuous.
 * @returns {boolean} whether a new event began (false: the one under way was held on)
 */
export function rearm(slot, at, timing, maxHold = Infinity) {
    if (at >= slot.start && at < slot.holdEnd) {
        const wanted = Math.max(slot.holdEnd, at + timing.rise + timing.hold);
        slot.holdEnd = Math.min(wanted, slot.start + timing.rise + maxHold);
        return false;
    }
    const value = heldEnvelope(at, slot.start, slot.holdEnd, timing);
    slot.start = at - timing.rise * inverseSmooth(value);
    slot.holdEnd = slot.start + timing.rise + timing.hold;
    return true;
}

/**
 * Where the scout is at `time`: x (scout units), facing, how far it has moved on this leg of its
 * visit, whether it moves and how (it walks in and trots out), and how long it has paused at the
 * lookout; null between visits. A pure function of time.
 */
export function scoutAt(time) {
    const t = time - SCOUT.first;
    if (!Number.isFinite(t) || t < 0) return null;
    const local = t % SCOUT.period;
    const distance = SCOUT.from - SCOUT.to;
    const { ramp } = SCOUT;
    const walk = distance / SCOUT.speed + ramp;
    const trot = distance / SCOUT.trotSpeed + ramp;
    if (local < walk) {
        const d = glide(local, distance, SCOUT.speed, ramp);
        return {
            x: SCOUT.from - d,
            facing: -1,
            travel: d,
            walked: local * SCOUT.speed,
            pace: glidePace(local, distance, SCOUT.speed, ramp),
            moving: true,
            gaitKind: 'walk',
            pause: 0,
            settled: 0,
            yaw: 0,
        };
    }
    if (local < walk + SCOUT.pause) {
        // At the end of its pause it turns round (through a view of its face) to trot back.
        const pause = local - walk;
        const turnsAt = SCOUT.pause - TURN - 0.1;
        const f = Math.min(1, Math.max(0, (pause - turnsAt) / TURN));
        return {
            x: SCOUT.to,
            facing: -1,
            travel: 0,
            walked: 0,
            pace: 0,
            moving: false,
            gaitKind: 'walk',
            pause,
            // (Settled at its lookout: it joins a howl only from a moment after it stops until a
            // moment before it turns, so the howl never holds a turn back and lets go at once.)
            settled: Math.min(smooth(pause / SETTLE.in), smooth((turnsAt - pause) / SETTLE.out)),
            yaw: Math.PI * smooth(f),
            step: f * 2,
            stepHeight: 1.8 * Math.sin(f * Math.PI),
        };
    }
    if (local < walk + SCOUT.pause + trot) {
        const out = local - walk - SCOUT.pause;
        const d = glide(out, distance, SCOUT.trotSpeed, ramp);
        return {
            x: SCOUT.to + d,
            facing: 1,
            travel: d,
            walked: out * SCOUT.trotSpeed,
            pace: glidePace(out, distance, SCOUT.trotSpeed, ramp),
            moving: true,
            gaitKind: 'trot',
            pause: 0,
            settled: 0,
            yaw: 0,
        };
    }
    return null;
}

/**
 * What the scout does at its lookout, `pause` seconds after it stopped: looks out over the valley,
 * sniffs the snow, lifts a paw to listen, looks at you with a tilt of its head one way and the
 * other, glances back over its shoulder, and turns to go.
 */
export function scoutLookout(pause) {
    const p = pause;
    const scan = span(p, 0.2, 1.8, 0.5);
    const sniff = span(p, 1.6, 3.6, 0.45);
    const alert = span(p, 3.6, 6.1, 0.45);
    const look = span(p, 6, 9.5, 0.55);
    const back = span(p, 9.4, 10.9, 0.45);
    return {
        head: scan * (6 + Math.sin(p * 1.7) * 4) - sniff * 30 + alert * 10 + back * 30,
        ears: -alert * 10 - look * 8 + back * 6,
        pawUp: span(p, 4, 5.7, 0.35),
        turn: 0.85 * look,
        roll: 0.35 * span(p, 6.8, 7.9, 0.3) - 0.3 * span(p, 8.1, 9, 0.3),
        headYaw: 2.9 * back,
        neckYaw: 1.2 * back,
        tailUp: 0.25 * alert,
    };
}

/** Vapour and snow: soft round puffs, moonlit, fading as they rise and spread. */
function createVapour(capacity) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const alpha = new Float32Array(capacity);
    const alphaAttribute = new THREE.InstancedBufferAttribute(alpha, 1);
    alphaAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aPuff', alphaAttribute);
    const material = new THREE.MeshBasicNodeMaterial({
        name: 'Wolfhour breath vapour', transparent: true, depthWrite: false,
    });
    const p = uv().sub(0.5).mul(2);
    const r2 = p.dot(p);
    material.colorNode = vec3(0.3, 0.36, 0.5);
    material.opacityNode = exp(r2.mul(-3.2)).mul(float(1).sub(r2).max(0)).mul(attribute('aPuff', 'float'));
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = 'Wolfhour breath vapour';
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // One invisible puff is always drawn, so the scene's warm-up compiles the vapour before the
    // first howl rather than during it.
    mesh.setMatrixAt(0, new THREE.Matrix4().makeScale(0.001, 0.001, 1));
    mesh.count = 1;
    return { mesh, alpha, alphaAttribute };
}

/* ── The wolves ────────────────────────────────────────────────────────────────────── */

/**
 * Creates the wolves (no renderer). `group` is the pack, its origin the lead's paws;
 * `answerer.group` and `scout.group` stand elsewhere. Each takes `settle(groundAt)`: the ridge's
 * height under any x of its own frame.
 */
export function createWolfhourPack({
    quality = 'High', noiseMap = null, nightLight = createWolfhourNightLight(),
} = {}) {
    const ownsNoise = !noiseMap;
    const noise = noiseMap || makeWolfhourNoiseTexture();
    const lowTier = quality === 'Minimal' || quality === 'Low';
    const [bx0, by0, bx1, by1] = WOLF_BOUNDS;
    const quad = new THREE.PlaneGeometry(bx1 - bx0, by1 - by0);
    quad.translate((bx0 + bx1) / 2, (by0 + by1) / 2, 0);
    // One table and one material for every wolf: a wolf's row is its mesh's own number.
    const table = createWolfTable(MAX_WOLVES);
    const material = createWolfMaterial({
        table: table.map, noise, uMoonTint: nightLight.uMoon, uShadeTint: nightLight.uShade,
    });
    const materials = [material];
    let nextRow = 0;

    const makeWolf = (spec, index) => {
        const row = nextRow;
        nextRow += 1;
        const mesh = new THREE.Mesh(quad, material);
        mesh.name = `Wolfhour wolf (${spec.name})`;
        mesh.frustumCulled = false;
        mesh.userData.wolfRow = row;
        const entry = {
            spec,
            mesh,
            row,
            /** The rig's capsules (CAPSULE_STRIDE floats each), as the table holds them. */
            capsules: new Float32Array(CAPSULE_COUNT * CAPSULE_STRIDE),
            /** Its eyes ([x, y, how open and toward the viewer]), its fade and its shake. */
            eye: [0, 0, 0],
            eye2: [0, 0, 0],
            fade: 1,
            shake: [0, 0, 0],
            seed: 0.13 + index * 0.29,
            look: null,
            facing: spec.facing ?? -1,
            muzzle: [0, 0],
            toward: 0,
            howling: 0,
            paws: [],
            visible: true,
            act: null,
        };
        wear(entry, WOLF_LOOKS[spec.look ?? spec.role ?? spec.name] ?? WOLF_LOOKS.lead);
        return entry;
    };
    /** Give a wolf a coat and a build (wolfhour-wolf-coats.js). */
    function wear(entry, look) {
        const coat = WOLF_COATS[look.coat] ?? WOLF_COATS.timber;
        entry.look = look;
        entry.shape = look.shape ?? null;
        const { data } = table;
        data.set(coat.dark, table.offset(entry.row, WOLF_TEXELS.dark));
        data[table.offset(entry.row, WOLF_TEXELS.dark) + 3] = EYE_SHINE * coat.eye;
        data.set(coat.mid, table.offset(entry.row, WOLF_TEXELS.mid));
        data.set(coat.pale, table.offset(entry.row, WOLF_TEXELS.pale));
    }
    /** A wolf's pose, eyes and fade into its row of the table. */
    const write = (entry) => {
        const { data } = table;
        data.set(entry.capsules, table.offset(entry.row, 0));
        const e = table.offset(entry.row, WOLF_TEXELS.eye);
        data[e] = entry.eye[0]; data[e + 1] = entry.eye[1]; data[e + 2] = entry.eye[2]; data[e + 3] = entry.fade;
        data[e + 4] = entry.eye2[0]; data[e + 5] = entry.eye2[1]; data[e + 6] = entry.eye2[2];
        data[e + 7] = entry.facing;
        data[e + 8] = entry.shake[0]; data[e + 9] = entry.shake[1]; data[e + 10] = entry.shake[2];
        data[e + 11] = entry.seed;
    };

    const group = new THREE.Group();
    group.name = 'Wolfhour pack';
    const wolves = PACK.map((spec, i) => makeWolf(spec, i));
    for (const wolf of wolves) group.add(wolf.mesh);
    const vapour = createVapour(lowTier ? 28 : 96);
    group.add(vapour.mesh);

    const answererGroup = new THREE.Group();
    answererGroup.name = 'Wolfhour answering wolf';
    const answerer = makeWolf(ANSWERER, 5);
    answererGroup.add(answerer.mesh);

    // The foreground ridge: the scout (its first wolf) and the visits' other wolves.
    const scoutGroup = new THREE.Group();
    scoutGroup.name = 'Wolfhour foreground ridge';
    const rovers = Array.from({ length: quality === 'Minimal' ? 1 : ROVER_COUNT }, (_, i) => {
        const rover = makeWolf({
            ...SCOUT, name: i === 0 ? 'scout' : `rover ${i}`, facing: -1, idlePhase: SCOUT.idlePhase + i * 1.9,
        }, 6 + i);
        rover.spec = { ...rover.spec, role: 'scout' };
        rover.mesh.visible = false;
        rover.visible = false;
        scoutGroup.add(rover.mesh);
        return rover;
    });
    const [scout] = rovers;

    // The far file on the right-hand massif's skyline (none on the lowest tier).
    const farGroup = new THREE.Group();
    farGroup.name = 'Wolfhour far file';
    const farWolves = Array.from({ length: quality === 'Minimal' ? 0 : FAR_FILE.count + 1 }, (_, i) => {
        const far = makeWolf({
            ...SCOUT, name: `far ${i}`, role: 'far', look: FAR_LOOKS[i % FAR_LOOKS.length], idlePhase: 0.7 + i * 2.3,
        }, 11 + i);
        far.mesh.visible = false;
        far.visible = false;
        farGroup.add(far.mesh);
        return far;
    });

    // The white wolf of the left-hand summit.
    const moonGroup = new THREE.Group();
    moonGroup.name = 'Wolfhour summit wolf';
    const moonWolf = makeWolf(SUMMIT, 16);
    moonWolf.mesh.visible = false;
    moonWolf.visible = false;
    moonGroup.add(moonWolf.mesh);

    const everyWolf = [...wolves, answerer, ...rovers, ...farWolves, moonWolf];

    const state = {
        // The howl under way, and the one before it still falling while a fresh one rises (the
        // pose follows whichever is higher, so a new howl never cuts the old one off). `joins`:
        // whether the young wolf howls along (it stays on the hunt in mid-pounce).
        howl: { start: -Infinity, holdEnd: -Infinity, joins: true },
        echo: { start: -Infinity, holdEnd: -Infinity, joins: true },
        // Held events: a later one holds them on, or lifts them again from where they are.
        glance: { start: -Infinity, holdEnd: -Infinity },
        excite: { start: -Infinity, holdEnd: -Infinity },
        answer: { start: -Infinity, holdEnd: -Infinity },
        // The young wolf's own clock stands still through a howl it joins and while a combo
        // excites it: the stretches it stood still for, merged ([start, end] of the last one, and
        // the length of all those before it).
        stall: null,
        stalled: 0,
        excited: false,
        spread: 1,
        members: wolves.length,
        // The foreground ridge from edge to edge (null: too narrow a screen for the visits), the
        // visit its wolves are dressed for, a run called up by play, and the stays play called the
        // white wolf up for.
        ridge: null,
        dressed: null,
        dash: -Infinity,
        /** @type {import('./wolfhour-wolf-travel.js').MoonCall[]} */
        calls: [],
        far: false,
        summit: false,
    };
    const grounds = {
        pack: () => 0, answerer: () => 0, scout: () => 0, far: () => 0, moon: () => 0,
    };
    const matrix = new THREE.Matrix4();
    const point = new THREE.Vector3();
    const memberCap = { Minimal: 3, Low: 4 }[quality] ?? wolves.length;

    // The young wolf's own clock: real time less the stretches it stood still for (none before
    // the first howl or combo), so whatever it was doing waits and then carries on.
    const youngClock = (t) => {
        const last = state.stall;
        return t - state.stalled - (last ? Math.max(0, Math.min(t - last[0], last[1] - last[0])) : 0);
    };
    const standStill = (from, to) => {
        const last = state.stall;
        if (last && from <= last[1]) {
            last[1] = Math.max(last[1], to);
            return;
        }
        if (last) state.stalled += last[1] - last[0];
        state.stall = [from, to];
    };
    const joins = (spec, howl) => spec.role !== 'young' || howl.joins;
    const howlIn = (howl, spec, t) => (joins(spec, howl)
        ? heldEnvelope(t - spec.delay, howl.start, howl.holdEnd, HOWL) : 0);
    const howlOf = (spec, t) => Math.max(howlIn(state.howl, spec, t), howlIn(state.echo, spec, t));
    /**
     * The pack's chorus reaches the wolf across the valley late (its delay). While that wolf's own
     * answer still holds, it holds on until the chorus is up there (at most a long answer), so the
     * one takes over from the other at the top instead of the head dipping between them.
     */
    const bridgeAnswer = (time) => {
        const { answer, howl } = state;
        if (!(time >= answer.start && time < answer.holdEnd)) return;
        const up = howl.start + ANSWERER.delay + HOWL.rise;
        if (!(up > time)) return;
        answer.holdEnd = Math.max(answer.holdEnd, Math.min(up, answer.start + ANSWER.rise + ANSWER.hold * 2));
    };

    /**
     * Pose one wolf into its row at `x`, facing ±1, on the ridge `groundAt` describes (the
     * ridge's height under any x of the wolf's group), from its behaviour `act` and the howl.
     */
    const pose = (entry, t, m, {
        x, groundAt, facing, act, howl = 0, glance = 0, fade = 1, visible = true,
        gaitKind = 'walk', stride = WALK_STRIDE, walked = 0, pace = 1, moving = false, yaw = 0, still = 0,
        clock = t, drop = 0, speed = 0,
    }) => {
        const { spec, mesh } = entry;
        mesh.visible = visible;
        entry.visible = visible;
        entry.act = act;
        entry.moving = moving;
        entry.speed = speed;
        entry.gaitKind = gaitKind;
        if (!visible) return;
        const s = entry.size ?? spec.scale;
        const base = groundAt(x) - drop;
        const reach = (WOLF_BOUNDS[3] - WOLF_BOUNDS[1]) * 0.2;
        // The ridge under the wolf, in its own (mirrored, scaled) frame, relative to its middle.
        const ridge = (rx) => {
            const h = (groundAt(x + facing * s * rx) - drop - base) / s;
            const cap = Math.min(reach, Math.abs(rx) * MAX_GROUND_SLOPE);
            return Number.isFinite(h) ? Math.max(-cap, Math.min(cap, h)) : 0;
        };
        const keep = 1 - howl;
        const a = act || {};
        const idle = !act || act.action === 'idle' || act.action === undefined;
        // Breathing, an ear flicked back now and then, a sniff at the wind when nothing else is on.
        const breath = Math.sin(t * 1.3 + spec.idlePhase) * m;
        const flick = Math.max(0, Math.sin(t * 0.9 + spec.idlePhase * 3)) ** 40 * 14 * m;
        // A sniff only begins in an idle slot that lasts until it is over (on the wolf's own clock).
        const sniffPhase = (clock + spec.idlePhase * 7) % 23;
        const book = REPERTOIRES[spec.role];
        const into = a.u ?? 0;
        const fits = !book || (into >= sniffPhase - 17 && book.slot - into >= 23 - sniffPhase);
        const strolling = !moving || gaitKind === 'walk';
        const sniff = idle && fits && strolling && sniffPhase > 17 && (a.down ?? 0) < 0.5
            ? Math.sin(((sniffPhase - 17) / 6) * Math.PI) * 26 * m : 0;
        const restHead = spec.head + breath * 1.6 - sniff + (a.head ?? 0) + glance * 8;
        const wag = Math.max(a.wag ?? 0, 0);
        // The ears flick on their own, each now and then.
        const flickB = Math.max(0, Math.sin(t * 0.73 + spec.idlePhase * 5)) ** 40 * 12 * m;
        const sit = a.sit ?? 0;
        // A lying wolf sits up to howl.
        const down = (a.down ?? 0) * keep;
        const cycle = moving ? (walked / (stride * s)) : 0;
        const params = {
            gait: cycle,
            stride: moving ? stride * pace * (1 - still) : 0,
            gaitKind,
            step: a.step ?? 0,
            stepHeight: (a.stepHeight ?? 0) * (1 - still),
            yaw,
            sit,
            down,
            foreDown: a.foreDown ? a.foreDown.map((d) => d * keep) : null,
            foreLift: a.foreLift ? a.foreLift.map((l) => l * keep) : null,
            head: restHead + (spec.howl - restHead) * howl,
            // Turning to look at you: its own looks, and every glance for a line clear.
            turn: Math.max(a.turn ?? 0, glance * (spec.role === 'lead' ? 0.9 : 0.7)) * keep,
            headYaw: (a.headYaw ?? 0) * keep * (1 - glance),
            neckYaw: (a.neckYaw ?? 0) * keep * (1 - glance),
            roll: (a.roll ?? 0) * keep,
            // The howl's note wavers: the jaw works a little while it holds.
            jaw: (a.jaw ?? 0) * keep + howl * (13 + Math.sin(t * 6.3 + spec.idlePhase) * 2.5),
            tail: (moving
                ? Math.sin(cycle * Math.PI * 2) * 6 * pace
                : Math.sin(t * 0.7 + spec.idlePhase) * 5 * m * (1 - wag) - howl * 8)
                + Math.sin(t * 11 + spec.idlePhase) * 22 * wag + (a.tail ?? 0),
            tailUp: (a.tailUp ?? 0) * keep,
            breath,
            shape: entry.shape,
            ears: (a.ears ?? 0) * keep + howl * 14 + flick - glance * 6,
            earA: (a.earA ?? 0) * keep,
            earB: (a.earB ?? 0) * keep + flickB,
            crouch: (a.crouch ?? 0) * keep,
            lift: (a.lift ?? 0) * keep,
            pitch: (a.pitch ?? 0) * keep,
            tuck: (a.tuck ?? 0) * keep,
            reach: (a.reach ?? 0) * keep,
            hindReach: (a.hindReach ?? 0) * keep,
            pawUp: (a.pawUp ?? 0) * keep,
            scratch: (a.scratch ?? 0) * keep,
            scratchPhase: a.scratchPhase ?? 0,
            dig: (a.dig ?? 0) * keep,
            digPhase: a.digPhase ?? 0,
            ground: ridge,
        };
        const rig = poseWolf(params, entry.capsules);
        mesh.scale.set(facing * s, s, 1);
        mesh.position.set(x, base - spec.sink * s, (spec.depth ?? 0.01) * s);
        // (The moon is upper left on screen; a mirrored wolf sees it from its other side: the
        // table carries the wolf's facing.)
        const open = (1 - (a.eyesClosed ?? 0) * keep) * (1 - howl * 0.7)
            * (1 - blinkAt(t, spec.idlePhase) * (1 - howl));
        entry.eye[0] = rig.eye[0]; entry.eye[1] = rig.eye[1]; entry.eye[2] = open * rig.eye[2];
        entry.eye2[0] = rig.eye2[0]; entry.eye2[1] = rig.eye2[1]; entry.eye2[2] = open * rig.eye2[2];
        entry.fade = fade;
        const shake = (a.shake ?? 0) * keep;
        entry.shake[0] = Math.sin(t * 41) * 0.009 * shake;
        entry.shake[1] = Math.cos(t * 37) * 0.009 * shake;
        entry.shake[2] = 0.9 * shake;
        [entry.muzzle[0], entry.muzzle[1]] = rig.muzzle;
        entry.toward = rig.toward;
        entry.howling = howl;
        entry.paws = rig.paws;
        entry.ridge = ridge;
        entry.facing = facing;
        entry.cycle = cycle;
        entry.stride = stride;
        write(entry);
    };
    const hide = (entry) => {
        entry.mesh.visible = false;
        entry.visible = false;
        entry.act = null;
        entry.howling = 0;
        entry.moving = false;
    };

    /** Rig point (x, y) of a wolf into the pack group's frame. */
    const toGroup = (entry, x, y) => {
        entry.mesh.updateWorldMatrix(true, false);
        point.set(x, y, 0.3).applyMatrix4(entry.mesh.matrixWorld);
        return group.worldToLocal(point);
    };

    // The other wolves stand in groups of their own, at their own sizes.
    const groupScale = (entry) => (wolves.includes(entry) ? 1
        : (entry.mesh.parent?.scale.y || 1) / (group.scale.y || 1));
    const placeVapour = (t, breathing) => {
        let count = 0;
        const emit = (x, y, z, size, alpha) => {
            if (count >= vapour.alpha.length || !(alpha > 0.004)) return;
            matrix.makeScale(size, size, 1);
            matrix.setPosition(x, y, z);
            vapour.mesh.setMatrixAt(count, matrix);
            vapour.alpha[count] = alpha;
            count += 1;
        };
        for (const entry of everyWolf) {
            if (!entry.visible || entry.fade < 0.5) continue;
            const size0 = (entry.size ?? entry.spec.scale) * groupScale(entry);
            // A breath in the cold: a little smoke leaves the muzzle as each breath goes out (a
            // running wolf's comes faster).
            if (breathing > 0 && entry.howling < 0.05) {
                const rate = BREATH_RATE * (entry.moving && entry.speed > 40 ? 2.6 : 1);
                const phase = t * rate + entry.spec.idlePhase - Math.PI / 2;
                const turn = Math.PI * 2;
                const life = (((phase % turn) + turn) % turn) / rate;
                if (life < BREATH.life) {
                    const f = life / BREATH.life;
                    const m = toGroup(entry, entry.muzzle[0], entry.muzzle[1]);
                    const ahead = (1 - Math.abs(entry.toward) * 0.7) * entry.facing;
                    // (A runner leaves its breath behind it.)
                    const left = entry.moving ? entry.speed * life * entry.facing * size0 : 0;
                    emit(
                        m.x + (1 + f * 5) * ahead * size0 - left,
                        m.y + (f * 3.5 - 0.6) * size0,
                        m.z + 0.2,
                        (1.6 + f * 4.5) * size0,
                        BREATH.alpha * breathing * Math.sin(Math.min(1, f * 5) * Math.PI * 0.5) * (1 - f) ** 1.6,
                    );
                }
            }
            // The howl's breath: a puff leaves the muzzle every 0.4 s while the note is held,
            // rising and spreading for 2.2 s.
            if (entry.howling > 0.25) {
                const m = toGroup(entry, entry.muzzle[0], entry.muzzle[1]);
                const mx = m.x;
                const my = m.y;
                const mz = m.z;
                const beat = (((t + entry.spec.idlePhase) % 0.4) + 0.4) % 0.4;
                for (let k = 0; k < 6; k++) {
                    const life = beat + k * 0.4;
                    if (life > 2.2) break;
                    const f = life / 2.2;
                    emit(
                        mx + (2 + f * 9) * entry.facing * size0,
                        my + (1 + f * 13) * size0,
                        mz + 0.2,
                        (2.6 + f * 10) * size0,
                        0.6 * smooth((entry.howling - 0.25) / 0.5)
                            * Math.sin(Math.min(1, f * 4) * Math.PI * 0.5) * (1 - f) ** 1.5,
                    );
                }
            }
            // A galloping wolf kicks the snow up behind it: a puff where its hind paws last struck
            // and the one before, drifting and thinning.
            if (entry.moving && entry.speed > 40 && breathing > 0) {
                const strideUnits = entry.stride;
                for (let k = 0; k < 3; k++) {
                    const since = (entry.cycle - Math.floor(entry.cycle)) + k;
                    const life = (since * strideUnits) / entry.speed;
                    if (life > KICK_LIFE || entry.cycle - since < 0) continue;
                    const f = life / KICK_LIFE;
                    const o = toGroup(entry, -10 - since * strideUnits, 1.5 + f * 5);
                    emit(o.x, o.y, o.z + 0.25, (3 + f * 8) * size0, 0.5 * (1 - f) ** 1.4 * Math.min(1, life * 14));
                }
            }
            // Snow: thrown off the coat in a ring when it shakes, flung up in a plume where a
            // pounce lands.
            for (const burst of entry.act?.bursts ?? []) {
                const life = (entry.act.u ?? 0) - burst.at;
                if (life < 0 || life > PUFF_LIFE) continue;
                const f = life / PUFF_LIFE;
                const o = toGroup(entry, burst.x, burst.y);
                const ox = o.x;
                const oy = o.y;
                const oz = o.z;
                for (let j = 0; j < burst.count; j++) {
                    const spin = j * 2.399 + burst.at * 3.1;
                    let angle = Math.PI * 0.5 + Math.sin(spin) * 0.9 - entry.facing * 0.35;
                    if (burst.kind === 'ring') angle = spin;
                    // Digging throws the snow back between the legs, low.
                    if (burst.kind === 'spray') {
                        angle = (entry.facing > 0 ? Math.PI - 0.55 : 0.55) + Math.sin(spin) * 0.3;
                    }
                    const speed = (burst.kind === 'ring' ? 10 : 15) * (0.55 + ((j * 0.618) % 1) * 0.6)
                        * (burst.kind === 'spray' ? 0.8 : 1);
                    const travelled = speed * (1 - (1 - f) ** 2) * size0;
                    emit(
                        ox + Math.cos(angle) * travelled,
                        oy + Math.sin(angle) * travelled - f * f * 6 * size0,
                        oz + 0.25,
                        (2.2 + f * 5.5) * size0,
                        0.85 * (1 - f) ** 1.3 * Math.min(1, life * 10),
                    );
                }
            }
        }
        if (count === 0) {
            if (vapour.alpha[0] === 0 && vapour.mesh.count === 1) return;
            vapour.alpha[0] = 0;
            count = 1;
        }
        vapour.mesh.count = count;
        vapour.mesh.instanceMatrix.needsUpdate = true;
        vapour.alphaAttribute.needsUpdate = true;
    };

    /** Dress the foreground ridge's wolves for a visit (once, when it begins). */
    const dress = (key, looks) => {
        if (state.dressed === key) return;
        state.dressed = key;
        rovers.forEach((rover, i) => {
            const look = looks(i);
            wear(rover, look);
            rover.size = SCOUT.scale * (look.scale ?? 1);
        });
    };
    /** The visit a run called up by play makes: a hunt from when it was called. */
    const dashAt = (t) => {
        if (!state.ridge || !(t - state.dash < DASH_LENGTH)) return null;
        const plan = visitPlan(DASH_INDEX + Math.floor(state.dash), state.ridge, 'hunt');
        const u = t - state.dash;
        let any = false;
        const states = plan.wolves.map((wolf) => {
            const now = follow(wolf.legs, u - wolf.delay, wolf.x0, wolf.facing);
            if (now) any = true;
            return now;
        });
        return any ? {
            index: plan.index, kind: plan.kind, dir: plan.dir, u, wolves: states, plan,
        } : null;
    };

    return {
        group,
        wolves,
        /** Every wolf of the night (the pack, the answerer, the ridge's, the far file, the summit's). */
        everyWolf,
        answerer: {
            group: answererGroup,
            wolf: answerer,
            settle(groundAt) { grounds.answerer = groundAt; },
        },
        scout: {
            group: scoutGroup,
            wolf: scout,
            wolves: rovers,
            /**
             * `ridge`: the foreground ridge from edge to edge in the scout's units ({ left, right },
             * a wolf's length past the frame's edges), or null on a screen too narrow for visits.
             */
            settle(groundAt, ridge = null) {
                grounds.scout = groundAt;
                state.ridge = ridge && ridge.right - ridge.left > 300 ? { left: ridge.left, right: ridge.right } : null;
            },
        },
        /** The far file on the right-hand massif's skyline (`groundAt` null: not on this screen). */
        far: {
            group: farGroup,
            wolves: farWolves,
            settle(groundAt) {
                state.far = typeof groundAt === 'function' && farWolves.length > 0;
                if (state.far) grounds.far = groundAt;
            },
        },
        /** The white wolf of the left-hand summit (`groundAt` null: not on this screen). */
        summit: {
            group: moonGroup,
            wolf: moonWolf,
            settle(groundAt) {
                state.summit = typeof groundAt === 'function';
                if (state.summit) grounds.moon = groundAt;
            },
        },
        /**
         * Rest the pack on the ridge: `groundAt(x)` gives the ridge's height at pack x. `spread`
         * (0..1) draws it together on a narrow screen; `members` shows only the first wolves.
         */
        settle(groundAt, { spread = 1, members = wolves.length } = {}) {
            grounds.pack = groundAt;
            state.spread = Number.isFinite(spread) ? Math.min(1, Math.max(0.3, spread)) : 1;
            state.members = Math.min(members, memberCap);
        },
        /**
         * A four-line clear (a perfect clear, a fever): the pack howls. While the lead still
         * holds its note the howl is held on for this one too (up to HOWL_MAX_HOLD of note), so
         * a rapid run of quads swells one long chorus instead of being refused; once the note is
         * falling a fresh howl begins under it. The young wolf joins unless it is in mid-pounce,
         * in which case it stays on the hunt.
         * @returns {boolean} whether a fresh howl began (false: the one sounding was held on)
         */
        howl(time) {
            if (!Number.isFinite(time)) return false;
            const current = state.howl;
            // A note already due after the pack's breath: it will sound.
            if (time < current.start) return false;
            if (time < current.holdEnd) {
                current.holdEnd = Math.min(
                    Math.max(current.holdEnd, time + HOWL.rise + HOWL.hold),
                    current.start + HOWL.rise + HOWL_MAX_HOLD,
                );
                if (current.joins) standStill(time, current.holdEnd + HOWL_STILL_TAIL);
                bridgeAnswer(time);
                return false;
            }
            // The howl before keeps sounding under the fresh one until it has fallen (each wolf
            // hears it a moment late: its own delay), and the fresh one never dips under it:
            //  - after a note held as long as a howl goes, the pack draws breath: the note falls
            //    away and the next begins a breath after it has gone;
            //  - while a shorter note is still falling, the next takes it up from where it is;
            //  - from silence, it begins.
            const level = heldEnvelope(time, current.start, current.holdEnd, HOWL);
            const held = current.holdEnd - current.start >= HOWL.rise + HOWL_MAX_HOLD - 1e-6;
            state.echo.start = current.start;
            state.echo.holdEnd = current.holdEnd;
            state.echo.joins = current.joins;
            let start = time;
            let sings = current.joins;
            if (level > 0 && held) start = current.holdEnd + HOWL.fall + HOWL_BREATH;
            else if (level > 0) start = time - HOWL.rise * inverseSmooth(level);
            // (A note taken up keeps its singers; one begun afresh asks the young wolf again.)
            if (!(level > 0) || held) sings = !busyAt('young', youngClock(Math.max(time, start)));
            current.start = start;
            current.holdEnd = start + HOWL.rise + HOWL.hold;
            current.joins = sings;
            if (sings) standStill(time, current.holdEnd + HOWL_STILL_TAIL);
            bridgeAnswer(time);
            return true;
        },
        /**
         * A back-to-back clear: the wolf across the valley answers on its own (held on, not
         * restarted, by the next one).
         */
        answer(time) {
            if (!Number.isFinite(time)) return;
            const { answer } = state;
            if (time >= answer.start && time < answer.holdEnd) {
                rearm(answer, time, ANSWER, ANSWER.hold * 2);
                bridgeAnswer(time);
                return;
            }
            // Its own answer rises from wherever its head already is (the pack's howl may still
            // be falling there), so the two never meet in a dip.
            const level = Math.max(heldEnvelope(time, answer.start, answer.holdEnd, ANSWER), howlOf(ANSWERER, time));
            answer.start = time - ANSWER.rise * inverseSmooth(level);
            answer.holdEnd = answer.start + ANSWER.rise + ANSWER.hold;
            bridgeAnswer(time);
        },
        /**
         * A smaller clear: the pack turns to look at you, and keeps looking while the clears keep
         * coming (each holds the look on rather than turning the heads away and back).
         */
        glance(time) {
            if (Number.isFinite(time)) rearm(state.glance, time, GLANCE);
        },
        /**
         * A combo: the young wolf gets excited (unless it is busy hunting): whatever it was doing
         * waits while it bows and wags. A combo running on keeps it bowing and wagging.
         */
        excite(time) {
            if (!Number.isFinite(time)) return;
            const { excite } = state;
            if (state.excited && heldEnvelope(time, excite.start, excite.holdEnd, EXCITE) > 0) {
                rearm(excite, time, EXCITE);
            } else {
                // From rest (or while it was too busy hunting to show it) it starts afresh.
                excite.start = time;
                excite.holdEnd = time + EXCITE.rise + EXCITE.hold;
                state.excited = !busyAt('young', youngClock(time));
            }
            if (state.excited) standStill(time, excite.holdEnd + EXCITE.fall);
        },
        /**
         * Call the white wolf up onto the summit (a four-line clear, a perfect clear, a fever): it
         * stands its full stay from now. Climbing or up, it stays on (it never comes up a second
         * time); on its way down, it comes back once it has gone over.
         */
        summon(time) {
            if (!Number.isFinite(time)) return;
            state.calls = summonMoonWolf(state.calls, time);
        },
        /**
         * Send a hunt across the foreground ridge now (a level-up, a perfect clear): four or five
         * wolves loping through the frame. Refused while the ridge is busy.
         * @returns {boolean} whether it set off
         */
        dash(time) {
            if (!Number.isFinite(time) || !state.ridge) return false;
            if (time - state.dash < DASH_LENGTH) return false;
            if (roversAt(time, state.ridge) || roversAt(time + DASH_LENGTH, state.ridge)) return false;
            if (scoutAt(time) || scoutAt(time + DASH_LENGTH)) return false;
            state.dash = time;
            return true;
        },
        /** How strongly the pack is howling now (0..1): drives the mist and the moon's answer. */
        howlLevel(time) {
            let level = 0;
            for (const entry of wolves) level = Math.max(level, howlOf(entry.spec, time));
            return level;
        },
        /**
         * The howling wolves' muzzles now, in world space: [x, y, z, level] each (after update()),
         * for whatever draws the howl in the air.
         */
        voices(out = []) {
            let n = 0;
            for (const entry of everyWolf) {
                if (!entry.visible || entry.howling < 0.05) continue;
                entry.mesh.updateWorldMatrix(true, false);
                point.set(entry.muzzle[0], entry.muzzle[1], 0).applyMatrix4(entry.mesh.matrixWorld);
                const voice = out[n] ?? (out[n] = [0, 0, 0, 0]);
                voice[0] = point.x; voice[1] = point.y; voice[2] = point.z; voice[3] = entry.howling * entry.fade;
                n += 1;
            }
            out.length = n;
            return out;
        },
        /** Where the scout is now (null between its visits). */
        scoutAt,
        /** The visit on the foreground ridge now (null between visits and during the scout's). */
        visitAt(time) {
            return state.ridge ? (dashAt(time) ?? roversAt(time, state.ridge)) : null;
        },
        /**
         * Pose every wolf at `time`. `motion` (0..1) scales idle movement; below 0.5 the wolves stay
         * where they are (no pacing, no pouncing, no travellers) and only turn, yawn, sit and howl.
         */
        update(time, motion = 1) {
            const t = Number.isFinite(time) ? time : 0;
            const m = Number.isFinite(motion) ? Math.min(1, Math.max(0, motion)) : 1;
            const walking = m >= 0.5;
            const glance = heldEnvelope(t, state.glance.start, state.glance.holdEnd, GLANCE);
            const excite = heldEnvelope(t, state.excite.start, state.excite.holdEnd, EXCITE);
            // A wolf facing away from the moon when a howl begins turns round to it as its head
            // comes up, and back again as the note ends.
            const howlYaw = (yaw, facing, home, howl) => (howl > 0 && facing !== home
                ? yaw + (Math.PI - yaw) * howl
                : yaw * (1 - howl));
            wolves.forEach((entry, i) => {
                const { spec } = entry;
                const howl = howlOf(spec, t);
                const moves = spec.role === 'young';
                const clock = moves ? youngClock(t) : t;
                let act = behaviourAt(spec.role, clock, { still: !walking });
                // Excitement (a combo) puts the young wolf into a bow with a wagging tail.
                const excited = moves && walking && state.excited ? excite : 0;
                if (excited > 0) {
                    act = { ...act, reach: act.reach + 6 * excited, pitch: act.pitch - 0.28 * excited };
                    act.tailUp = Math.max(act.tailUp, excited);
                    act.wag = Math.max(act.wag, excited);
                    act.lift += Math.abs(Math.sin(t * 7)) * 2.5 * excited;
                }
                const x = (spec.x + (moves ? act.dx : 0)) * state.spread;
                // (Under Reduce motion a wolf that would turn round to the moon to howl faces it
                // from the start: no quick turn.)
                const facing = act.facing ?? (walking ? spec.facing : (spec.howlFacing ?? spec.facing));
                const turning = act.busy ? 0 : howl;
                pose(entry, t, m, {
                    x,
                    groundAt: grounds.pack,
                    drop: spec.drop ?? 0,
                    facing,
                    yaw: howlYaw(act.yaw ?? 0, facing, spec.howlFacing ?? spec.facing, turning),
                    clock,
                    act,
                    howl,
                    glance,
                    // A walk it stands still for (a howl, a combo) settles its paws.
                    moving: act.moving,
                    still: Math.max(howl, excited),
                    walked: act.walked * state.spread,
                    pace: act.pace,
                    visible: i < state.members,
                });
            });
            const far = behaviourAt(ANSWERER.role, t, { still: !walking });
            pose(answerer, t, m, {
                x: 0,
                groundAt: grounds.answerer,
                facing: ANSWERER.facing,
                act: far,
                // It answers the pack's howls, and on its own a back-to-back clear.
                howl: Math.max(
                    howlOf(ANSWERER, t),
                    heldEnvelope(t, state.answer.start, state.answer.holdEnd, ANSWER),
                ),
                glance: glance * 0.6,
            });

            // The foreground ridge: a run play called up, a visit, or the scout.
            const visit = walking && state.ridge && rovers.length > 1
                ? (dashAt(t) ?? roversAt(t, state.ridge)) : null;
            if (visit) {
                dress(`visit ${visit.index}`, (i) => {
                    const look = roverLook(visit.index, i);
                    const role = visit.plan.wolves[i]?.role;
                    if (role === 'yearling') return { ...look, shape: WOLF_LOOKS.yearling.shape, scale: 0.8 };
                    if (role === 'leader') return { ...look, scale: 1.08 };
                    return look;
                });
                const edge = state.ridge;
                rovers.forEach((rover, i) => {
                    const now = visit.wolves[i];
                    if (!now) {
                        hide(rover);
                        return;
                    }
                    // It howls with the pack and looks at you only as far as it has settled where
                    // it stands (follow(): eased in after it stops, out before it moves on).
                    const own = now.act?.howl ?? 0;
                    const howl = Math.max(own, howlOf(SCOUT, t) * (now.joins ?? 0));
                    pose(rover, t, m, {
                        x: now.x,
                        groundAt: grounds.scout,
                        facing: now.facing,
                        yaw: now.yaw,
                        act: now.act ?? {},
                        howl,
                        glance: glance * (now.settled ?? 0),
                        moving: now.moving,
                        walked: now.walked,
                        pace: now.pace,
                        gaitKind: now.gaitKind,
                        stride: now.stride,
                        speed: now.moving ? now.speed * now.pace : 0,
                        // They fade at the frame's edges rather than popping.
                        fade: Math.min(smooth((edge.right - now.x) / 30), smooth((now.x - edge.left) / 30)),
                    });
                });
            } else {
                const walk = walking ? scoutAt(t) : null;
                for (let i = 1; i < rovers.length; i++) hide(rovers[i]);
                if (walk) {
                    dress('scout', () => WOLF_LOOKS.scout);
                    // It fades in and out at the frame's edge rather than popping. At its lookout it
                    // looks round and at you, and howls with the pack if it stands there.
                    const howl = howlOf(SCOUT, t) * walk.settled;
                    pose(scout, t, m, {
                        x: walk.x,
                        groundAt: grounds.scout,
                        facing: walk.facing,
                        yaw: howlYaw(walk.yaw ?? 0, walk.facing, -1, howl),
                        act: {
                            ...(walk.moving ? {} : scoutLookout(walk.pause)),
                            step: walk.step ?? 0,
                            stepHeight: walk.stepHeight ?? 0,
                        },
                        howl,
                        glance,
                        moving: walk.moving,
                        walked: walk.walked,
                        pace: walk.pace,
                        gaitKind: walk.gaitKind,
                        stride: walk.gaitKind === 'trot' ? TROT_STRIDE : WALK_STRIDE,
                        speed: walk.moving ? (walk.gaitKind === 'trot' ? SCOUT.trotSpeed : SCOUT.speed) * walk.pace : 0,
                        fade: smooth((SCOUT.from - walk.x) / 30),
                    });
                } else {
                    pose(scout, t, m, {
                        x: SCOUT.from, groundAt: grounds.scout, facing: -1, visible: false,
                    });
                }
            }

            // The far file on the skyline.
            const file = walking && state.far ? farFileAt(t) : null;
            farWolves.forEach((entry, i) => {
                const now = file?.wolves[i];
                if (!now) {
                    hide(entry);
                    return;
                }
                pose(entry, t, m, {
                    x: now.x,
                    groundAt: grounds.far,
                    drop: now.sink,
                    facing: now.facing,
                    act: { head: -4 },
                    moving: true,
                    walked: now.walked,
                    pace: now.pace,
                    gaitKind: 'trot',
                    stride: TROT_STRIDE,
                    speed: now.speed * now.pace,
                    fade: now.fade,
                });
            });

            // The white wolf of the summit: its own visits, and whenever play calls it up. It
            // stands behind the crest, so the massif hides it until it walks up over the top (the
            // fade only covers its ear tips' first moment); under Reduce motion it stays where it
            // is and comes and goes by fading.
            const white = state.summit ? moonWolfAt(t, state.calls) : null;
            if (white) {
                // Its own song and the pack's chorus, either: as one fades while the other rises
                // the head stays up (the higher of the two would dip where they cross).
                const chorus = howlOf(SUMMIT, t);
                const howl = (1 - (1 - white.howl) * (1 - chorus)) * white.hold;
                pose(moonWolf, t, m, walking ? {
                    x: white.x,
                    groundAt: grounds.moon,
                    drop: white.drop,
                    facing: white.facing,
                    yaw: white.yaw,
                    act: white.act,
                    howl,
                    glance: glance * 0.5 * white.hold,
                    moving: white.moving,
                    walked: white.walked,
                    pace: white.pace,
                    gaitKind: white.gaitKind,
                    stride: white.stride,
                    speed: white.moving ? white.speed * white.pace : 0,
                    fade: smooth((1 - white.climb) / 0.12),
                } : {
                    x: 0,
                    groundAt: grounds.moon,
                    facing: SUMMIT.facing,
                    act: white.rest,
                    howl,
                    glance: glance * 0.5 * white.hold,
                    fade: smooth(1 - white.climb),
                });
            } else hide(moonWolf);

            placeVapour(t, m);
            table.touch();
        },
        dispose() {
            group.removeFromParent();
            answererGroup.removeFromParent();
            scoutGroup.removeFromParent();
            farGroup.removeFromParent();
            moonGroup.removeFromParent();
            quad.dispose();
            for (const owned of materials) owned.dispose();
            table.map.dispose();
            vapour.mesh.geometry.dispose();
            vapour.mesh.material.dispose();
            vapour.mesh.dispose();
            if (ownsNoise) noise.dispose();
            group.clear();
            answererGroup.clear();
            scoutGroup.clear();
            farGroup.clear();
            moonGroup.clear();
        },
    };
}

/** The young wolf's moves, for placement checks (pack units). */
export { YOUNG_MOVES };
