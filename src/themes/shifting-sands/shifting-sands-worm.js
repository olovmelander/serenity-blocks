/**
 * Shifting Sands — Shai-Hulud.
 *
 * The worm is ONE tube mesh animated entirely in the vertex shader: every vertex knows its body
 * coordinate σ (0 = the maw, 1 = the tail) and its angle θ around the body; the body follows the
 * head's own path, so the arch is always a single continuous motion.
 *
 * The breach path is a tall half-ellipse in the vertical plane through the breach site, along the
 * heading D:  P(φ) = O + D·(a·sin φ) + Y·(b·cos φ − k),  φ ∈ [−φ₀, φ₀],  b·cos φ₀ = k.
 * The head sweeps φ at constant rate; a body point sits at φ_head − σ·Lφ. Whatever is below the
 * sand is hidden by the opaque dunes (depth test), so the worm rises out of and plunges back into
 * the erg with no clipping logic.
 *
 * The erg is not flat, so the two feet of the arch are solved against the real sand: φ_up and
 * φ_down are where the centre line crosses the dune surface, and each foot carries its sand height
 * and local slope. The dune shader builds a well there (a bulge that bursts into a rim, then a
 * crater that fills) and the FX layer throws sand from exactly that point.
 *
 * Geometry: a short inner tube (the throat, normals inward, ringed with crystal teeth), a flared
 * lip, then the segmented outer body tapering to a pointed tail. Skin: annular plates with dark
 * creases, a sand-dusted back, dusty ochre-grey hide, the twin-sun light, violet sky fill and a
 * strong backlit rim.
 *
 * The WormDirector (CPU) owns the schedule and the sites. A breach can happen anywhere in the
 * visible erg — any azimuth inside the lens, near or far, travelling any way across the view —
 * as long as it is clear of the rock, not hidden behind a formation and not behind the gameplay
 * board. Two worms can be live at once: slot 0 is the idle worm (a cycle of sign → breach →
 * settle), slot 1 the summoned one (a Tetris), so answering a Tetris never cuts a breach short.
 * Every slot is closed-form in the world clock, from the first tremor of the sign to the last
 * drifting dust of the settle: nothing switches off in a single frame.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    cross,
    dot,
    float,
    fract,
    frontFacing,
    max,
    mix,
    normalize,
    pow,
    select,
    sin,
    smoothstep,
    uniformArray,
    vec2,
    vec3,
    vec4,
    vertexStage,
} from 'three/tsl';
import { mulberry32, ssTexNoise } from './shifting-sands-tsl.js';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/** Worm slots: the idle worm and the summoned one can be above the sand together. */
export const WORM_SLOTS = 2;
export const SLOT_IDLE = 0;
export const SLOT_SUMMONED = 1;

// ── The breach path (CPU twin of the vertex shader) ─────────────────────────────

/** φ₀: where the ellipse meets its nominal surface. */
export function surfaceAngle(b, k) {
    return Math.acos(Math.min(1, Math.max(-1, k / b)));
}

/** Point on the breach path at angle φ (into `out`). */
export function breachPoint(br, phi, out) {
    const s = Math.sin(phi);
    const c = Math.cos(phi);
    out.x = br.ox + br.dx * br.a * s;
    out.y = br.oy + br.b * c - br.k;
    out.z = br.oz + br.dz * br.a * s;
    return out;
}

/** Body-length in path angle: the body covers `length` world units at the arch's mean radius. */
export function bodyAngleSpan(br) {
    const mean = Math.sqrt((br.a * br.a + br.b * br.b) / 2);
    return br.length / mean;
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ss = (e0, e1, x) => {
    const k = clamp01((x - e0) / (e1 - e0));
    return k * k * (3 - 2 * k);
};

/**
 * How a breach is drawn. dist: distance from the rest camera; lean: degrees the travel direction
 * turns toward the camera from a pure crossing (negative = away); leap: 0 a tall hoop → 1 a long
 * low leap; scale: size multiplier; lead: seconds of worm sign before the head breaks the sand.
 */
export const BREACH_STYLES = Object.freeze({
    idle: Object.freeze({
        dist: [760, 3300], lean: [-30, 55], leap: [0, 1], scale: 1, lead: 13, signSpeed: 62, departSpeed: 62,
    }),
    summoned: Object.freeze({
        dist: [820, 1250], lean: [12, 58], leap: [0, 0.55], scale: 1.45, lead: 1.6, signSpeed: 380, departSpeed: 110,
    }),
});

/** Seconds the worm sign travels before the head breaks the surface. */
export const SIGN_LEAD = Object.freeze({ idle: BREACH_STYLES.idle.lead, summoned: BREACH_STYLES.summoned.lead });
/** Idle cycle length (s): sign + breach + settle + quiet. */
export const IDLE_PERIOD = 52;
/** The first idle cycle starts this long after the scene starts (so the opening frames are calm). */
export const IDLE_OFFSET = 6;
/** Each idle breach starts up to this many seconds late, so the worm does not keep time. */
export const IDLE_JITTER = 9;
/**
 * Seconds the sand keeps moving after the tail has gone under: the wells collapse and fill, the
 * dust drifts off downwind and the sign travels on. Every envelope reaches zero inside it.
 */
export const SETTLE = 9;
/** A summons that arrives while the last summoned worm's dust still hangs fades that dust first. */
export const RESUMMON_FADE = 0.9;

/** The body is drawn from just before the maw breaks the sand until just after the tail is under. */
const SHOW_LEAD = 0.45;
const SHOW_TAIL = 0.3;
/** Path angle kept free between tail and head, so the buried head never laps the arch. */
const LOOP_MARGIN = 0.5;
/** Seconds the departing sign travels on after the dive. */
const DEPART = 6.5;
/** Site rules. */
const MIN_FOOT_DIST = 560;
const MAX_DURATION = 21;
const PICK_TRIES = 36;
const DEFAULT_HALF_AZ = 36;
const EDGE_MARGIN = 4;
/** A stretch of view between boards narrower than this (degrees) is not a place to breach. */
const MIN_ZONE = 7;
/** Sightline march step (world units): a third of the smallest dune that can hide a foot. */
const SIGHT_STEP = 70;

/** One breach shape from a seeded generator, at an azimuth inside [az0, az1]. */
function drawShape(style, rand, az0, az1) {
    const az = lerp(az0, az1, rand());
    const dist = style.dist[0] * (style.dist[1] / style.dist[0]) ** rand();
    const side = rand() < 0.5 ? -1 : 1;
    const lean = lerp(style.lean[0], style.lean[1], rand());
    const leap = lerp(style.leap[0], style.leap[1], rand());
    // Far worms are giants, so the arch still reads at the horizon.
    const scale = style.scale * Math.min(1.5, Math.max(0.86, (dist / 1300) ** 0.42));
    const b = lerp(252, 212, leap) * (0.92 + 0.16 * rand()) * scale;
    const a = lerp(104, 214, leap) * (0.9 + 0.2 * rand()) * scale;
    const R = (26 + 8 * rand()) * scale;
    return {
        az,
        dist,
        heading: az + side * (90 + lean),
        a,
        b,
        k: b * lerp(0.2, 0.44, leap),
        R,
        length: R * (19 + 4 * rand()),
        speed: (74 + 18 * rand()) * Math.sqrt(scale),
    };
}

/** Height of the path's centre line above the sand at angle φ. */
function clearance(br, phi, groundAt, p) {
    breachPoint(br, phi, p);
    return p.y - groundAt(p.x, p.z);
}

/**
 * Walk down the arch to the first point under the sand, then bisect. The walk starts a little
 * above the nominal foot (the dunes are far lower than the arch), or at the apex if a dune
 * already stands that high.
 */
function pierceAngle(br, dir, groundAt, p) {
    const limit = Math.PI * 0.7;
    const step = 0.05;
    let hi = Math.max(0, br.phi0 - 0.55);
    if (clearance(br, dir * hi, groundAt, p) <= 0) hi = 0;
    let lo = -1;
    for (let phi = hi + step; phi <= limit; phi += step) {
        if (clearance(br, dir * phi, groundAt, p) <= 0) {
            lo = phi;
            break;
        }
        hi = phi;
    }
    if (lo < 0) return null;
    for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        if (clearance(br, dir * mid, groundAt, p) > 0) hi = mid;
        else lo = mid;
    }
    return dir * (lo + hi) * 0.5;
}

/** A foot of the arch: the point where the body pierces the sand, with the local slope. */
function footAt(br, phi, groundAt) {
    const p = breachPoint(br, phi, { x: 0, y: 0, z: 0 });
    const e = Math.max(24, br.R);
    let gx = (groundAt(p.x + e, p.z) - groundAt(p.x - e, p.z)) / (2 * e);
    let gz = (groundAt(p.x, p.z + e) - groundAt(p.x, p.z - e)) / (2 * e);
    const steep = Math.hypot(gx, gz);
    if (steep > 0.7) {
        gx *= 0.7 / steep;
        gz *= 0.7 / steep;
    }
    return {
        x: p.x, y: groundAt(p.x, p.z), z: p.z, gx, gz,
    };
}

/**
 * The plan of a breach before it is seated on the sand: the site, the heading, the arch, and its
 * two feet where they would stand on level ground (enough to test every rule about where a worm
 * may be, without sampling the dunes).
 * @param {object} shape  { az, dist, heading, a, b, k, R, length, speed } (degrees, world units)
 * @param {number} t0     time the head breaks the surface
 */
function draftBreach(shape, t0) {
    const az = shape.az * DEG;
    const ox = Math.sin(az) * shape.dist;
    const oz = -Math.cos(az) * shape.dist;
    const hd = shape.heading * DEG;
    const dx = Math.sin(hd);
    const dz = -Math.cos(hd);
    const br = {
        t0,
        az: shape.az,
        dist: shape.dist,
        ox,
        oz,
        oy: 0,
        dx,
        dz,
        a: shape.a,
        b: shape.b,
        k: shape.k,
        R: shape.R,
        length: shape.length,
        speed: shape.speed,
    };
    br.phi0 = surfaceAngle(br.b, br.k);
    const reach = br.a * Math.sin(br.phi0);
    br.up = {
        x: ox - dx * reach, y: 0, z: oz - dz * reach, gx: 0, gz: 0,
    };
    br.down = {
        x: ox + dx * reach, y: 0, z: oz + dz * reach, gx: 0, gz: 0,
    };
    br.seated = null; // not yet on the sand
    br.leadTime = 0;
    br.signSpeed = 62;
    br.departSpeed = 62;
    br.summoned = false;
    return br;
}

/** Seat a drafted breach on the real sand: solve its feet and its timing. */
function seatBreach(br, groundAt) {
    // The nominal surface sits at the mean sand height of the two feet...
    const gUp = groundAt(br.up.x, br.up.z);
    const gDown = groundAt(br.down.x, br.down.z);
    br.oy = (gUp + gDown) / 2;
    br.footDrop = Math.abs(gUp - gDown);
    // ...and the real feet are where the centre line crosses the dunes.
    const p = { x: 0, y: 0, z: 0 };
    const up = pierceAngle(br, -1, groundAt, p);
    const down = pierceAngle(br, 1, groundAt, p);
    br.seated = up !== null && down !== null;
    br.phiUp = up ?? -br.phi0;
    br.phiDown = down ?? br.phi0;
    br.up = footAt(br, br.phiUp, groundAt);
    br.down = footAt(br, br.phiDown, groundAt);

    const mean = Math.sqrt((br.a * br.a + br.b * br.b) / 2);
    const arc = br.phiDown - br.phiUp;
    br.span = Math.min(bodyAngleSpan(br), TAU - LOOP_MARGIN - arc);
    br.length = br.span * mean;
    br.omega = br.speed / mean;
    /** Seconds from the head breaking the sand to: the head diving, the tail leaving the hole. */
    br.tDown = arc / br.omega;
    br.tOut = br.span / br.omega;
    /** ...and to the tail going under. The sand settles for SETTLE seconds after that. */
    br.duration = br.tDown + br.tOut;
    return br;
}

/**
 * Builds a concrete breach (site, heading, feet, timing) from a shape.
 * @param {object} shape  { az, dist, heading, a, b, k, R, length, speed } (degrees, world units)
 * @param {number} t0     time the head breaks the surface
 * @param {(x:number, z:number) => number} groundAt
 */
export function makeBreach(shape, t0, groundAt) {
    return seatBreach(draftBreach(shape, t0), groundAt);
}

// ── One slot, resolved at time t (closed form) ──────────────────────────────────

function makeSlotState() {
    const well = () => ({
        x: 0, z: 0, radius: 1, width: 1, rim: 0, bulge: 0, crater: 0, scar: 0,
    });
    return {
        breach: null, // the live breach (sign → breach → settle) or null
        phiHead: 0, // the path clock: linear in time through the whole life of the breach
        show: 0, // 1 while any of the body can be above the sand
        open: 0,
        fade: 1,
        fx: false, // sand pools live
        sign: {
            x: 0, z: 0, dx: 1, dz: 0, wake: 1, strength: 0,
        },
        wells: [well(), well()], // 0: where it comes up, 1: where it goes down
        ring: {
            x: 0, z: 0, t0: -100, strength: 0,
        },
        rumble: 0,
    };
}

function clearSlot(st) {
    st.breach = null;
    st.show = 0;
    st.open = 0;
    st.fade = 1;
    st.fx = false;
    st.sign.strength = 0;
    st.ring.strength = 0;
    st.rumble = 0;
    for (let i = 0; i < 2; i++) {
        const w = st.wells[i];
        w.rim = 0;
        w.bulge = 0;
        w.crater = 0;
        w.scar = 0;
    }
    return st;
}

/** True while a breach owns its slot at time t (sign, breach or settle). */
export function breachLive(br, t) {
    return br !== null && t > br.t0 - br.leadTime && t < br.t0 + br.duration + SETTLE;
}

/**
 * Resolve one breach at time t into a slot state. `fade` scales everything that would otherwise
 * be cut (a re-summons over the last worm's settling dust).
 */
export function resolveBreach(br, t, st, fade = 1) {
    clearSlot(st);
    if (!breachLive(br, t)) return st;
    const local = t - br.t0;
    const end = br.duration + SETTLE;
    const big = br.summoned;
    const { R } = br;
    st.breach = br;
    st.fade = fade;
    st.phiHead = br.phiUp + local * br.omega;
    st.show = local > -SHOW_LEAD && local < br.duration + SHOW_TAIL ? 1 : 0;
    st.fx = local > -0.5;
    // The maw opens as it rears and closes as it dives.
    const u = local / Math.max(1e-3, br.tDown);
    st.open = ss(0.04, 0.24, u) * (1 - ss(0.42, 0.62, u));

    const sinceOut = local - br.tOut; // the tail has left the hole it came up through
    const sinceHit = local - br.tDown; // the maw has struck the sand
    const under = local - br.duration; // the tail has gone under

    // ── Worm sign: a mound racing in to the emergence, and travelling on after the dive ──
    const sg = st.sign;
    sg.dx = br.dx;
    sg.dz = br.dz;
    if (local < 0.5) {
        const run = (local + br.leadTime) * br.signSpeed;
        const togo = -local * br.signSpeed;
        sg.x = br.up.x - br.dx * togo;
        sg.z = br.up.z - br.dz * togo;
        sg.wake = Math.max(1, Math.min(520, run));
        sg.strength = Math.min(1, (local + br.leadTime) / 1.5) * clamp01((0.5 - local) / 0.7)
            * (big ? 1.25 : 0.85) * fade;
    } else if (under > -0.6 && under < DEPART - 0.6) {
        const s = under + 0.6;
        const run = s * br.departSpeed;
        sg.x = br.down.x + br.dx * run;
        sg.z = br.down.z + br.dz * run;
        sg.wake = Math.max(1, Math.min(520, run));
        sg.strength = ss(0, 1.4, s) * (1 - ss(DEPART - 2.6, DEPART, s)) * (big ? 0.85 : 0.7) * fade;
    }

    // ── The wells: the sand around each foot of the arch ──
    // Far wells are broadened so the terrain grid still resolves them.
    const width = Math.max(R * 0.6, br.dist * 0.02);
    const radius = Math.max(R * 1.5, width * 1.4);
    const lift = (R * 0.6 * (R * 0.6)) / width; // a broader mound is a lower one
    const scarFade = (1 - ss(end - 3.5, end - 0.2, local)) * fade;
    const up = st.wells[0];
    up.x = br.up.x;
    up.z = br.up.z;
    up.radius = radius;
    up.width = width;
    // The sand domes over the rising maw, bursts into a rim, slumps when the tail has left and
    // leaves a crater that fills.
    up.bulge = R * 0.5 * ss(-1.5, -0.05, local) * (1 - ss(0, 0.9, local)) * fade;
    up.rim = lift * 1.05 * ss(-0.15, 1, local) * (1 - 0.8 * ss(-0.4, 2.8, sinceOut))
        * (1 - ss(2.2, 7.5, sinceOut)) * fade;
    up.crater = R * 0.5 * ss(-0.5, 0.6, sinceOut) * (1 - ss(1, 7, sinceOut)) * fade;
    up.scar = ss(-0.2, 0.8, local) * scarFade;
    const dn = st.wells[1];
    dn.x = br.down.x;
    dn.z = br.down.z;
    dn.radius = radius;
    dn.width = width;
    // The maw strikes: a rim is thrown up, held while the body pours in, then the hole closes
    // over the tail — the rim slumps inward and the crater fills.
    dn.bulge = 0;
    dn.rim = lift * ss(-0.05, 0.9, sinceHit) * (1 - 0.8 * ss(-0.5, 2.8, under)) * (1 - ss(2.2, 7.5, under)) * fade;
    dn.crater = R * 0.55 * ss(-0.7, 0.5, under) * (1 - ss(1, 7, under)) * fade;
    dn.scar = ss(0, 0.8, sinceHit) * scarFade;

    // ── One ground wave per event: the burst, then the strike ──
    const rg = st.ring;
    const struck = local >= br.tDown;
    const foot = struck ? br.down : br.up;
    rg.x = foot.x;
    rg.z = foot.z;
    rg.t0 = br.t0 + (struck ? br.tDown : 0);
    rg.strength = (big ? 2 : 1.1) * Math.min(1.6, R / 30) * fade;

    // ── Rumble: the sign, the body grinding through the sand, the kick of the strike ──
    const near = Math.min(1.3, Math.max(0.3, 1100 / br.dist));
    const grindUp = ss(-0.3, 0.3, local) * (1 - ss(0, 2, sinceOut));
    const grindDown = ss(-0.2, 0.2, sinceHit) * (1 - ss(0, 2.5, under));
    const kick = sinceHit > 0 ? Math.exp(-sinceHit * 1.6) : 0;
    st.rumble = near * fade * Math.max(
        sg.strength * (big ? 1 : 0.25),
        (big ? 0.8 : 0.2) * Math.max(grindUp, grindDown) + (big ? 0.5 : 0.15) * kick,
    );
    return st;
}

// ── Director ────────────────────────────────────────────────────────────────────

export class WormDirector {
    /**
     * @param {(x:number, z:number) => number} groundAt  sand height
     * @param {object} [opts]
     * @param {Array<{x:number, z:number, r:number, solid:number, h:number}>} [opts.obstacles] rock
     * @param {number} [opts.salt]     varies the sequence of sites (0 = the reference sequence)
     * @param {boolean} [opts.capture] deterministic captures: re-pick as soon as the view changes
     * @param {{x:number, y:number, z:number}} [opts.eye] the rest camera: both feet of a breach
     *        must be in its sight (no dune ridge in front of them)
     */
    constructor(groundAt, {
        obstacles = [], salt = 0, capture = false, eye = null,
    } = {}) {
        this.groundAt = groundAt;
        this.obstacles = obstacles;
        this.eye = eye;
        this.salt = salt >>> 0;
        this.capture = capture;
        this.view = { halfAz: DEFAULT_HALF_AZ, bands: [] };
        this.viewEpoch = 0;
        this.pinned = null;
        this.summoned = null;
        this.summonedAt = -Infinity;
        this.summonCount = 0;
        this.fading = null; // { br, cutAt }: the last summoned worm's dust, fading under a new summons
        this.apart = null; // a worm already above the sand: the one being drawn keeps its distance
        this.skipCycle = -1;
        this._idle = null; // { cycle, epoch, br }
        this.state = {
            slots: Array.from({ length: WORM_SLOTS }, makeSlotState),
            rumble: 0,
        };
    }

    reset() {
        this.summoned = null;
        this.summonedAt = -Infinity;
        this.summonCount = 0;
        this.fading = null;
        this.skipCycle = -1;
    }

    /**
     * What the lens shows: the half-angle of the horizontal field (degrees) and the azimuth bands
     * covered by the gameplay boards and the HUD (degrees, [from, to]).
     */
    setView({ halfAz = this.view.halfAz, bands = this.view.bands } = {}) {
        const v = this.view;
        const same = Math.abs(halfAz - v.halfAz) < 0.05 && bands.length === v.bands.length
            && bands.every((b, i) => Math.abs(b[0] - v.bands[i][0]) < 0.05 && Math.abs(b[1] - v.bands[i][1]) < 0.05);
        if (same) return;
        this.view = { halfAz, bands: bands.map((b) => [b[0], b[1]]) };
        this.viewEpoch += 1;
    }

    /** Debug / captures: hold the idle breach at a site ({ az, dist, heading, leap }), or null. */
    setPinned(pin) {
        this.pinned = pin || null;
        this._idle = null;
    }

    /**
     * The stretches of azimuth the boards and the HUD leave in view (degrees). With no board on
     * screen that is the whole lens.
     */
    freeZones() {
        const lim = Math.max(6, this.view.halfAz - EDGE_MARGIN);
        let zones = [[-lim, lim]];
        const { bands } = this.view;
        for (let i = 0; i < bands.length; i++) {
            const [b0, b1] = bands[i];
            const next = [];
            for (let j = 0; j < zones.length; j++) {
                const [z0, z1] = zones[j];
                if (b1 <= z0 || b0 >= z1) {
                    next.push(zones[j]);
                } else {
                    if (b0 > z0) next.push([z0, b0]);
                    if (b1 < z1) next.push([b1, z1]);
                }
            }
            zones = next;
        }
        zones = zones.filter((z) => z[1] - z[0] >= MIN_ZONE);
        return zones.length ? zones : [[-lim, lim]];
    }

    /** Fraction of the arch (as seen from the camera) that sits behind a board or the HUD. */
    hiddenFraction(br) {
        const { bands } = this.view;
        if (!bands.length) return 0;
        const rel = (Math.atan2(br.dx, -br.dz) / DEG - br.az) * DEG;
        const half = Math.atan2(br.a * Math.sin(br.phi0) * Math.abs(Math.sin(rel)) + br.R, br.dist) / DEG;
        const a0 = br.az - half;
        const a1 = br.az + half;
        let covered = 0;
        for (let i = 0; i < bands.length; i++) {
            covered += Math.max(0, Math.min(a1, bands[i][1]) - Math.max(a0, bands[i][0]));
        }
        return Math.min(1, covered / Math.max(1e-3, a1 - a0));
    }

    /** True when no dune rises into the sightline from the eye to a point. */
    sees(x, y, z) {
        const e = this.eye;
        if (!e) return true;
        const steps = Math.max(6, Math.ceil(Math.hypot(x - e.x, z - e.z) / SIGHT_STEP));
        for (let i = 1; i < steps; i++) {
            const s = i / steps;
            if (this.groundAt(e.x + (x - e.x) * s, e.z + (z - e.z) * s) > e.y + (y - e.y) * s) return false;
        }
        return true;
    }

    /**
     * 0 when a breach may happen as drawn; otherwise how badly it breaks the site rules. A draft
     * (not yet seated) is judged on where it stands; a seated breach also on how it sits.
     */
    faults(br) {
        let f = 0;
        const seated = br.seated !== null;
        if (seated) {
            if (!br.seated) f += 8;
            if (br.duration > MAX_DURATION) f += 3;
            if (br.footDrop > br.k * 0.8) f += 2;
        }
        const edge = (this.view.halfAz - 1.5) * DEG;
        const feet = [br.up, br.down];
        for (let i = 0; i < 2; i++) {
            const p = feet[i];
            if (Math.hypot(p.x, p.z) < MIN_FOOT_DIST) f += 4;
            if (Math.abs(Math.atan2(p.x, -p.z)) > edge) f += 2;
        }
        const ux = br.ox / br.dist;
        const uz = br.oz / br.dist;
        for (let i = 0; i < this.obstacles.length; i++) {
            const o = this.obstacles[i];
            const reach = o.r + br.R * 2.4;
            if (Math.hypot(br.up.x - o.x, br.up.z - o.z) < reach
                || Math.hypot(br.down.x - o.x, br.down.z - o.z) < reach
                || Math.hypot(br.ox - o.x, br.oz - o.z) < reach) f += 6;
            // A tall formation between the camera and the arch hides it.
            const along = o.x * ux + o.z * uz;
            if (along > 0 && along < br.dist && o.h > (br.b - br.k) * 0.6
                && Math.abs(o.x * uz - o.z * ux) < o.solid + br.R) f += 5;
        }
        // Two worms at once each get their own stretch of erg (and of the screen).
        const other = this.apart;
        if (other) {
            if (Math.hypot(br.ox - other.ox, br.oz - other.oz) < (br.a + other.a) * 1.6 + 260) f += 3;
            if (Math.abs(br.az - other.az) < 12) f += 2;
        }
        // The boards and the HUD: both feet stand clear beside them, and at most half the arch
        // passes behind.
        const { bands } = this.view;
        for (let i = 0; i < 2 && bands.length; i++) {
            const p = feet[i];
            const az = Math.atan2(p.x, -p.z) / DEG;
            const pad = Math.atan2(br.R * 1.6, Math.hypot(p.x, p.z)) / DEG + 0.5;
            for (let j = 0; j < bands.length; j++) {
                if (az > bands[j][0] - pad && az < bands[j][1] + pad) f += 3;
            }
        }
        const hidden = this.hiddenFraction(br);
        if (hidden > 0.5) f += 1 + hidden * 4;
        // The sand is the show: where the worm comes up and where it goes down must be in view
        // (the sightline march is the costly rule, so it runs only on otherwise good sites).
        if (f === 0 && seated) {
            for (let i = 0; i < 2; i++) {
                const p = feet[i];
                if (!this.sees(p.x, p.y + br.R * 0.5, p.z)) f += 1.5;
            }
        }
        return f;
    }

    /**
     * The first admissible breach from a seeded stream (or the least bad of the tries). The zone
     * is drawn first, by width, so a narrow strip of open erg beside the HUD gets its share of
     * worms instead of losing every draw to the wide side.
     */
    pick(style, rand, t0) {
        const zones = this.freeZones();
        const widths = zones.map((z) => z[1] - z[0]);
        const total = widths.reduce((sum, width) => sum + width, 0);
        const zoneAt = (u) => {
            let left = u * total;
            for (let i = 0; i < zones.length - 1; i++) {
                if (left < widths[i]) return zones[i];
                left -= widths[i];
            }
            return zones[zones.length - 1];
        };
        const home = zoneAt(rand());
        const dress = (br) => {
            br.leadTime = style.lead;
            br.signSpeed = style.signSpeed;
            br.departSpeed = style.departSpeed;
            br.summoned = style === BREACH_STYLES.summoned;
            return br;
        };
        const pin = style === BREACH_STYLES.idle ? this.pinned : null;
        let best = null;
        let bestFault = Infinity;
        for (let i = 0; i < PICK_TRIES; i++) {
            // Most of the tries belong to the drawn zone; the rest go wherever there is room.
            const zone = i < PICK_TRIES * 0.7 ? home : zoneAt(rand());
            const shape = drawShape(style, rand, zone[0], zone[1]);
            if (pin) {
                const leap = pin.leap ?? 0.3;
                Object.assign(shape, {
                    az: pin.az ?? shape.az,
                    dist: pin.dist ?? shape.dist,
                    heading: pin.heading ?? shape.heading,
                    a: lerp(104, 214, leap),
                    b: lerp(252, 212, leap),
                    k: lerp(252, 212, leap) * lerp(0.2, 0.44, leap),
                    R: pin.R ?? 30,
                });
                shape.length = shape.R * 20.5;
                shape.speed = 80;
                return dress(makeBreach(shape, t0, this.groundAt));
            }
            // Where it stands is cheap to judge; only a draft that passes is seated on the dunes.
            const br = draftBreach(shape, t0);
            let fault = this.faults(br);
            if (fault === 0) {
                fault = this.faults(seatBreach(br, this.groundAt));
                if (fault === 0) return dress(br);
            }
            if (fault < bestFault) {
                best = br;
                bestFault = fault;
            }
        }
        return dress(best.seated === null ? seatBreach(best, this.groundAt) : best);
    }

    idleBreach(cycle, t = -Infinity) {
        const e = this._idle;
        if (e && e.cycle === cycle) {
            // A view change re-picks a breach that has not begun (always, for captures).
            const begun = !this.capture && t >= e.br.t0 - e.br.leadTime;
            if (e.epoch === this.viewEpoch || begun) return e.br;
        }
        const style = BREACH_STYLES.idle;
        const rand = mulberry32((Math.imul(cycle + 1, 0x9e3779b1) ^ this.salt) >>> 0);
        const br = this.pick(style, rand, 0);
        const slack = IDLE_PERIOD - style.lead - br.duration - SETTLE - 1;
        const late = Math.max(0, Math.min(IDLE_JITTER, slack)) * rand();
        br.t0 = IDLE_OFFSET + cycle * IDLE_PERIOD + style.lead + late;
        this._idle = { cycle, epoch: this.viewEpoch, br };
        return br;
    }

    /**
     * A Tetris: the worm comes for the thumper. Refused only while the last summoned worm is
     * still above the sand; if its dust is still settling, that fades out under the new sign.
     */
    summon(t) {
        const cur = this.summoned;
        if (cur && t < cur.t0 + cur.duration + 1.5) return false;
        this.fading = cur && breachLive(cur, t) ? { br: cur, cutAt: t } : null;
        this.summonCount += 1;
        const style = BREACH_STYLES.summoned;
        const rand = mulberry32((Math.imul(this.summonCount, 0x85ebca6b) ^ this.salt ^ 0x5bd1e995) >>> 0);
        // The new sign starts once the old dust has faded, so the slot changes hands at zero.
        const wait = this.fading ? RESUMMON_FADE : 0;
        // If the idle worm is up (or about to be), the summoned one rises somewhere else.
        const idle = this._idle && this._idle.cycle !== this.skipCycle ? this._idle.br : null;
        this.apart = idle && t > idle.t0 - idle.leadTime && t < idle.t0 + idle.duration + 3 ? idle : null;
        this.summoned = this.pick(style, rand, t + wait + style.lead);
        this.apart = null;
        this.summonedAt = t;
        return true;
    }

    /** Where the summoned worm will break the surface (for the spice blow that heralds it). */
    summonedEmergence() {
        const br = this.summoned;
        return br ? br.up : { x: 0, y: 0, z: 0 };
    }

    /** Resolve both worms at time t (closed form in t and the summons timestamps). */
    update(t) {
        const { slots } = this.state;
        // ── Slot 1: the summoned worm (the last one's dust fades out under a new summons) ──
        const sm = this.summoned;
        const fd = this.fading;
        if (fd && t < fd.cutAt + RESUMMON_FADE) {
            resolveBreach(fd.br, t, slots[SLOT_SUMMONED], 1 - ss(0, RESUMMON_FADE, t - fd.cutAt));
        } else {
            resolveBreach(sm, t, slots[SLOT_SUMMONED]);
        }
        // ── Slot 0: the idle cycle ──
        let idle = null;
        if (t >= IDLE_OFFSET) {
            const cycle = Math.floor((t - IDLE_OFFSET) / IDLE_PERIOD);
            idle = this.idleBreach(cycle, t);
            // A summons that lands before an idle sign has begun keeps that cycle quiet: the
            // Tetris has the erg to itself. A breach already under way always runs its course.
            const signStart = idle.t0 - idle.leadTime;
            if (cycle === this.skipCycle) {
                idle = null;
            } else if (sm && this.summonedAt < signStart && signStart < sm.t0 + sm.duration + SETTLE) {
                this.skipCycle = cycle;
                idle = null;
            }
        }
        resolveBreach(idle, t, slots[SLOT_IDLE]);
        this.state.rumble = Math.max(slots[0].rumble, slots[1].rumble);
        return this.state;
    }
}

// ── The worm mesh ───────────────────────────────────────────────────────────────

/**
 * @param {object} shared world uniforms + atmosphere
 * @param {object} [opts] { rings, segs }
 */
export function createWorm(shared, { rings = 160, segs = 32, capRings = 10 } = {}) {
    const {
        uSunA, uSunB, uSunLightA, uSunLightB, uUpper, uZenith, uHorizonCool, atmosphere, noiseTex,
    } = shared;

    // aWorm = (σ, θ, part, α): part 0 = body (σ along the body), 1 = the maw cap (α: 0 at the
    // rim → 1 at the apex of the closed dome).
    const ringCount = (rings + 1) + (capRings + 1);
    const verts = ringCount * (segs + 1);
    const data = new Float32Array(verts * 4);
    const pos = new Float32Array(verts * 3); // unused: the vertex node builds every position
    let w = 0;
    const pushRing = (sigma, part, alpha) => {
        for (let j = 0; j <= segs; j++) {
            data[w * 4] = sigma;
            data[w * 4 + 1] = (j / segs) * Math.PI * 2;
            data[w * 4 + 2] = part;
            data[w * 4 + 3] = alpha;
            w++;
        }
    };
    for (let i = 0; i <= rings; i++) pushRing(i / rings, 0, 0);
    for (let i = 0; i <= capRings; i++) pushRing(0, 1, i / capRings);
    const index = [];
    const strip = (r0, nRings) => {
        for (let i = 0; i < nRings; i++) {
            for (let j = 0; j < segs; j++) {
                const a = (r0 + i) * (segs + 1) + j;
                const b = a + segs + 1;
                index.push(a, a + 1, b, a + 1, b + 1, b);
            }
        }
    };
    strip(0, rings);
    strip(rings + 1, capRings);
    // One instance per worm slot: the same tube, driven by that slot's path.
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(index);
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('aWorm', new THREE.BufferAttribute(data, 4));
    geometry.setAttribute('aSlot', new THREE.InstancedBufferAttribute(
        Float32Array.from({ length: WORM_SLOTS }, (_, i) => i),
        1,
    ));
    geometry.instanceCount = WORM_SLOTS;

    const slotVec = (x, y, z, v) => Array.from({ length: WORM_SLOTS }, () => new THREE.Vector4(x, y, z, v));
    const uB0 = uniformArray(slotVec(0, 0, 0, 0), 'vec4'); // O.xyz, φ_head
    const uB1 = uniformArray(slotVec(1, 0, 100, 200), 'vec4'); // D.xz, a, b
    const uB2 = uniformArray(slotVec(50, 0, 3, 0), 'vec4'); // k, R (0 = no breach), Lφ, open
    const uB3 = uniformArray(slotVec(0.4, -1.3, 90, 1.3), 'vec4'); // ω, φ_up, speed, φ_down
    const uB4 = uniformArray(slotVec(0, 1, 0, 0), 'vec4'); // body shown, fade

    const aW = attribute('aWorm', 'vec4');
    const slot = attribute('aSlot', 'float').toInt();
    const B0 = uB0.element(slot);
    const B1 = uB1.element(slot);
    const B2 = uB2.element(slot);
    const B4 = uB4.element(slot);
    const sigma = aW.x;
    const theta = aW.y;
    const isCap = aW.z;
    const alpha = aW.w;

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    material.name = 'shifting-sands-worm';
    material.fog = false;

    // ── Vertex: the body on the breach path ──
    const O = B0.xyz;
    const D = vec3(B1.x, 0.0, B1.y);
    const Y = vec3(0.0, 1.0, 0.0);
    const phi = B0.w.sub(sigma.mul(B2.z));
    const center = O.add(D.mul(B1.z.mul(sin(phi)))).add(Y.mul(B1.w.mul(cos(phi)).sub(B2.x)));
    const T = normalize(D.mul(B1.z.mul(cos(phi))).sub(Y.mul(B1.w.mul(sin(phi)))));
    const Pn = normalize(cross(D, Y));
    const Bn = cross(Pn, T);
    const ring = Pn.mul(cos(theta)).add(Bn.mul(sin(theta)));
    // Collapsed to zero area while the whole body is under the sand.
    const R = B2.y.mul(B4.x);
    const open = B2.w;

    // Body: annular plates, a fuller neck behind the maw, a long taper to a pointed tail.
    const segPhase = fract(sigma.mul(72.0));
    const plate = smoothstep(0.0, 0.16, segPhase).mul(float(1.0).sub(smoothstep(0.8, 1.0, segPhase)));
    const neck = smoothstep(0.0, 0.05, sigma).mul(float(1.0).sub(smoothstep(0.05, 0.16, sigma)));
    const tip = pow(clamp(float(1.0).sub(sigma).div(0.09), 0.0, 1.0), 0.55);
    const taper = mix(float(1.0), float(0.3), smoothstep(0.32, 1.0, sigma)).mul(neck.mul(0.06).add(1.0)).mul(tip);
    const bodyR = R.mul(taper).mul(plate.mul(0.022).add(0.982));

    // Maw cap: a closed dome peels open into a flared, faintly three-lobed bell.
    const petal = cos(theta.mul(3.0)).mul(0.5).add(0.5).mul(0.25);
    const a = alpha.mul(1.5708);
    const rClosed = R.mul(cos(a));
    const fClosed = R.mul(0.75).mul(sin(a));
    const rOpen = R.mul(float(1.0).add(alpha.pow(1.6).mul(float(0.42).add(petal))));
    const fOpen = R.mul(alpha.mul(0.22));
    const capR = mix(rClosed, rOpen, open);
    const capF = mix(fClosed, fOpen, open);
    const capN = normalize(mix(ring.mul(cos(a)).add(T.mul(sin(a))), ring.mul(0.75).sub(T.mul(0.66)), open));

    const radius = mix(bodyR, capR, isCap);
    const worldPos = center.add(ring.mul(radius)).add(T.mul(capF.mul(isCap)));
    const geomNormal = normalize(mix(ring, capN, isCap));

    material.vertexNode = Fn(() => cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(worldPos, 1.0))))();

    material.colorNode = Fn(() => {
        const wp = vertexStage(worldPos);
        const Ng = normalize(vertexStage(geomNormal));
        // Back faces are the inside of the worm: what the open maw reveals.
        const inside = select(frontFacing, float(0.0), float(1.0));
        const N = Ng.mul(mix(1.0, -1.0, inside)).toVar();
        const vSig = vertexStage(sigma);
        const vTh = vertexStage(theta);
        const vCap = vertexStage(isCap);
        const vAlpha = vertexStage(alpha);
        const vPlate = vertexStage(plate);
        const V = normalize(cameraPosition.sub(wp));

        // ── Hide: dusty grey-ochre plates with dark creases, sand on the back ──
        const n1 = ssTexNoise(noiseTex, vec2(vTh.mul(3.0), vSig.mul(96.0)));
        const hide = mix(vec3(0.2, 0.16, 0.13), vec3(0.31, 0.24, 0.18), n1.x).toVar();
        hide.mulAssign(mix(0.3, 1.0, max(vPlate, vCap)));
        const back = smoothstep(0.35, 0.85, N.y);
        hide.assign(mix(hide, vec3(0.7, 0.41, 0.2), back.mul(0.5).mul(n1.y.mul(0.5).add(0.5))));

        // ── Inside: ember flesh ringed with pale crystal teeth, darkening down the throat ──
        const teethRings = smoothstep(0.55, 0.8, fract(vSig.mul(300.0).add(vAlpha.mul(5.0))));
        const teethCols = smoothstep(0.7, 0.95, abs(fract(vTh.mul(72.0 / 6.2831)).sub(0.5)).mul(2.0));
        const nearMouth = float(1.0).sub(smoothstep(0.0, 0.05, vSig)).mul(float(1.0).sub(vCap))
            .add(vCap.mul(smoothstep(0.15, 0.7, vAlpha)));
        const tooth = teethRings.mul(teethCols).mul(nearMouth);
        const depth = float(1.0).sub(smoothstep(0.0, 0.06, vSig)).mul(float(1.0).sub(vCap)).add(vCap);
        const flesh = mix(vec3(0.02, 0.005, 0.004), vec3(0.2, 0.045, 0.025), depth);
        const insideAlbedo = mix(flesh, vec3(0.8, 0.74, 0.62), tooth.mul(0.7));

        const albedo = mix(hide, insideAlbedo, inside);
        const nlA = dot(N, uSunA);
        const nlB = dot(N, uSunB);
        const direct = uSunLightA.mul(clamp(nlA.mul(1.5), 0.0, 1.0)).add(uSunLightB.mul(clamp(nlB.mul(1.4), 0.0, 1.0)));
        const skyFill = mix(uHorizonCool.mul(0.4), uUpper.mul(0.8).add(uZenith.mul(0.6)), N.y.mul(0.5).add(0.5));
        const light = direct.mul(float(1.0).sub(inside.mul(0.9))).add(skyFill.mul(float(1.0).sub(inside.mul(0.55))));
        const col = albedo.mul(light).toVar();
        // The teeth hold a faint ember glow so the maw reads as depth, not as a hole.
        col.addAssign(vec3(1.0, 0.55, 0.25).mul(tooth.mul(inside).mul(0.22)));
        // Backlit rim: only the true silhouette burns, and only when the suns are behind.
        const rimF = pow(float(1.0).sub(clamp(abs(dot(N, V)), 0.0, 1.0)), 6.0).mul(float(1.0).sub(inside));
        const behind = smoothstep(0.55, 1.0, dot(V.negate(), uSunA).mul(0.5).add(0.5));
        col.addAssign(uSunLightA.mul(rimF.mul(behind).mul(0.9)).mul(vec3(1.0, 0.72, 0.42)));
        // Plate brinks catch the light.
        const brinkN = smoothstep(0.0, 0.12, vPlate).mul(float(1.0).sub(smoothstep(0.12, 0.3, vPlate)))
            .mul(float(1.0).sub(inside));
        col.addAssign(uSunLightA.mul(brinkN.mul(0.05).mul(clamp(nlA.add(0.3), 0.0, 1.0))));
        // Less haze than the sand: the worm stays a silhouette against the suns.
        return vec4(atmosphere.applyAerial(col, wp, 0.45), 1.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'shifting-sands-worm';
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;

    return {
        mesh,
        material,
        uniforms: {
            uB0, uB1, uB2, uB3, uB4,
        },
        /** Push the director's slots into the uniforms (pure writes). */
        apply(slots) {
            for (let i = 0; i < WORM_SLOTS; i++) {
                const st = slots[i];
                const br = st.breach;
                if (!br) {
                    uB2.array[i].y = 0; // no breach: zero area, zero fill, no sand
                    uB4.array[i].x = 0;
                    continue;
                }
                uB0.array[i].set(br.ox, br.oy, br.oz, st.phiHead);
                uB1.array[i].set(br.dx, br.dz, br.a, br.b);
                uB2.array[i].set(br.k, br.R, br.span, st.open);
                uB3.array[i].set(br.omega, br.phiUp, br.speed, br.phiDown);
                uB4.array[i].set(st.show, st.fade, 0, 0);
            }
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
