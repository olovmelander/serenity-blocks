/**
 * Parhelion optics state (spec §7.2–§7.7, §8, §9).
 *
 * Turns the reaction director's cues into ONE flat, shader-facing `out` object per frame:
 * the optics gains (uK0/uK1), the sundog flares, the parhelic pulse, the eight ring arc
 * slots, the glint-pool burst slots, the six hound pillars, the dust effects, the stone rim,
 * the bloom kick, the CPU-integrated clocks and the theme's own rotational shake.
 *
 * Three-free, DOM-free, bus-free and deterministic. Every reaction is stored as numbers with
 * an ABSOLUTE birth time and evaluated analytically in update(now):
 * - envelopes `{birth, attack, hold, tau, amp}`, four per channel, oldest replaced;
 * - arc motions (φ from → to over a duration, eased on the CPU);
 * - burst and pillar slots (the shaders mask a slot while its age is negative).
 * Births may lie in the FUTURE. That is how the QUAD apex meet (+0.85 s), the Clear Sky
 * reveal (+0.35 s) and the Lumen return stages are scheduled: no timers, no callbacks, so the
 * same cue history and the same `now` always give the same `out`, and `?event=&fxAge=`
 * captures are frame-exact.
 *
 * Clocks (§8): veilPhase and driftPhase integrate constant rates. dustClock integrates its
 * base rate (1, or 0.5 under reduced motion) minus the Clear Sky hush. Each frame subtracts the
 * closed-form integral of the eased rate dip over its own [now − dt, now] window, so the freeze
 * never jumps or runs backwards, frame-stepping telescopes to the closed form, and seek(t)
 * (clocks = t·rate, minus scheduled hushes) lands on the clock a frame-stepped run reaches.
 *
 * Wiring (the director's sink): `cue(c) → applyCue(c, t)`, `count(n) → applyCount(n, t)`,
 * `resonance(r) → setResonance(r)`, `levelUp(n) → setLevel(n, t)`.
 *
 * Allocation discipline: the constructor allocates everything. applyCue(), update() and the
 * setters only write preallocated typed arrays and scratch objects. `out` is one object whose
 * identity, and whose arrays' identities, never change. "QUAD" is the four-line clear.
 */
import {
    CAM_REST,
    DEFAULT_LAYOUT,
    DOG_AZ,
    FALLBACK_RECT,
    MOTE_PLANE_DEPTH,
    PILLAR,
    R22,
    S,
    STATION_COUNT,
    TAN_V,
    U,
    cardFromBoard,
    dirToScreen,
    laneAnchors,
    ringDir,
    ringPoint,
    rowToPhi,
    screenToDir,
    screenToWorld55,
    stationPhi,
    tanH,
    writePillarPlaces,
} from '../../../playground/effects/parhelion-composition.js';
import { CUE, PARHELION_PLAYER_SLOTS, PARHELION_REDUCED_MOTION_INTENSITY } from './parhelion-reaction-director.js';

const HALF_PI = Math.PI / 2;
const TWO_PI = Math.PI * 2;
const DEG = Math.PI / 180;
const EMPTY = Object.freeze({});

// ---------------------------------------------------------------------------------------
// Tiers, caps and idle values (§7.7, §9)
// ---------------------------------------------------------------------------------------

function tierCaps(name, burstSlots, perSlot, pillars, crown, lowitz, prism) {
    return Object.freeze({
        name, burstSlots, perSlot, pillars, crown, lowitz, prism,
    });
}

/**
 * Per-tier pool sizes and the optics each tier draws (§7.7 pools, §9 "Optics disabled").
 * `burstSlots × perSlot` is the glint pool (Sprite count); `pillars` 4 means no echo spares.
 */
export const PARHELION_OPTICS_TIERS = Object.freeze({
    Minimal: tierCaps('Minimal', 4, 16, 4, false, false, false),
    Low: tierCaps('Low', 6, 16, 6, false, false, true),
    Medium: tierCaps('Medium', 8, 16, 6, true, false, true),
    High: tierCaps('High', 8, 24, 6, true, true, true),
    Ultra: tierCaps('Ultra', 8, 32, 6, true, true, true),
    Extreme: tierCaps('Extreme', 10, 32, 6, true, true, true),
});

/** Fixed pool shapes and per-player caps (§7.7). */
export const PARHELION_OPTICS_CAPS = Object.freeze({
    arcSlots: 8,
    beadSlots: 4,
    arcsPerPlayer: 2,
    burstsPerPlayer: 3,
    envelopesPerChannel: 4,
    pillars: 6,
});

/** Arc slot roles: 0–3 beads/orbits, 4–5 lock stations (ping-pong), 6 count-wave, 7 echo. */
export const ARC_SLOT = Object.freeze({
    STATION_A: 4,
    STATION_B: 5,
    WAVE: 6,
    ECHO: 7,
});

/** Arc slot `.w`: 0 mirrored bead pair (dispersive), 1 full-angle orbit (dispersive), 2 white. */
export const ARC_MODE = Object.freeze({ PAIR: 0, ORBIT: 1, WHITE: 2 });

/** Burst slot `uBurstD.x` (§5.5). */
export const BURST_MODE = Object.freeze({
    RADIAL: 0,
    FALL: 1,
    SPIRAL: 2,
    TOWARD_RING: 3,
});

/**
 * Resting values. Mirrors IDLE_OPTICS / REST_RIM and the uniform defaults in
 * parhelion-materials.js, which cannot be imported here (it pulls in three).
 */
export const PARHELION_OPTICS_IDLE = Object.freeze({
    k0: Object.freeze([1.0, 0.85, 0.22, 0.30]),
    k1: Object.freeze([0.0, 0.55, 0.0, 1.0]),
    dogTail: 1,
    rim: 1.0,
    dustGain: 1,
    density: 0.6,
    warmth: 0.1,
});

/**
 * Clock rates (§7.2, §8): dust 1 (0.5 reduced motion, 0.04 in the hush); veil and drift in the
 * snow/sky shaders' NOISE units per second. Screenshot-tuned (B2b): the spec's veil 0.004 left
 * the cirrostratus visibly frozen over 40 s (0.025 ≈ one noise cell per 40 s, so ring arcs
 * brighten and fade over 20–40 s); drift 0.18 ≈ 6 m/s spindrift at the snow's 0.03/m scale
 * (0.9 read as a 30 m/s gale).
 */
export const PARHELION_CLOCK_RATES = Object.freeze({
    dust: 1,
    dustReducedMotion: 0.5,
    hush: 0.04,
    veil: 0.025,
    drift: 0.18,
});

/** Scheduled beat timing (s after the cue). */
export const PARHELION_TIMING = Object.freeze({
    /** QUAD: the bead pair meets at the apex; UTA, sun pillar, prism and pillars fire here. */
    quadMeet: 0.85,
    /** Clear Sky: the hush holds until the reveal. */
    reveal: 0.35,
    /** Hush ease-in of the dim and the dust clock. */
    hushIn: 0.15,
    /** The dust clock returns to its base rate over this long, starting at the reveal. */
    hushOut: 0.6,
    /** B2B echo pillars and beads. */
    echoPillarLife: 1.2,
});

/**
 * Clear Sky "Lumen return" (§7.4): each stage holds from the reveal and starts decaying at
 * `start` (s after the cue) with time constant `tau`, rarest arc first; the ring and the
 * hounds settle last. Pillars end at `pillarsEnd`.
 */
export const PARHELION_LUMEN_RETURN = Object.freeze({
    lowitz: Object.freeze({ start: 0.9, tau: 0.5 }),
    crown: Object.freeze({ start: 1.2, tau: 0.8 }),
    uta: Object.freeze({ start: 1.5, tau: 1.0 }),
    parhelic: Object.freeze({ start: 1.9, tau: 1.2 }),
    crossArm: Object.freeze({ start: 1.9, tau: 1.0 }),
    sunPillar: Object.freeze({ start: 2.1, tau: 1.2 }),
    ring: Object.freeze({ start: 2.4, tau: 1.4 }),
    pillarsEnd: 2.6,
});

/** Ambient life (§8): six breaths a minute ±15%, horizon warmth ±8% over 90 s, dogs ±12%. */
export const PARHELION_AMBIENT = Object.freeze({
    breathPeriod: 10,
    breathDepth: 0.15,
    warmthPeriod: 90,
    warmthDepth: 0.08,
    warmthEase: 3,
    dogTwinkle: 0.12,
    cameraBreathReducedMotion: 0.3,
});

// Reduced motion (§7.6).
const RM_MOTES = 0.35;
const RM_LIFE = 0.6;
const RM_STATION_AMP = 0.12;

// Channel indices: one envelope pool each.
const CH_HALO = 0;
const CH_DOGS = 1;
const CH_PARHELIC = 2;
const CH_UTA = 3;
const CH_CROWN = 4;
const CH_SUN_PILLAR = 5;
const CH_LOWITZ = 6;
const CH_DIM = 7;
const CH_FLARE_L = 8;
const CH_FLARE_R = 9;
const CH_TAIL = 10;
const CH_RING_FLASH = 11;
const CH_PRISM = 12;
const CH_SHOWER = 13;
const CH_CROSS_ARM = 14;
const CH_DUST_GAIN = 15;
const CH_DENSITY = 16;
const CH_RIM = 17;
const CH_RIM_QUIET = 18;
const CH_KICK = 19;
const CH_SPOKE = 20;
const CH_PC = 21;
const CHANNEL_COUNT = 22;

const ENVELOPES = PARHELION_OPTICS_CAPS.envelopesPerChannel;
const ENV_STRIDE = 5;
const ENV_BLOCK = ENVELOPES * ENV_STRIDE;
/** An envelope is spent this many taus into its decay (e^-9 ≈ 1.2e-4). */
const ENV_TAIL_TAUS = 9;

const ARC_SLOTS = PARHELION_OPTICS_CAPS.arcSlots;
const ARC_EPSILON = 1e-4;
const DORMANT_BIRTH = -1e4;

const EASE_LINEAR = 0;
const EASE_OUT_CUBIC = 1;
const EASE_IN_OUT_CUBIC = 2;
const EASE_IN_CUBIC = 3;
const EASE_SMOOTH = 4;

// Ring slot widths (rad along the ring).
const BEAD_WIDTH = 0.07;
const ORBIT_WIDTH = 0.12;
const STATION_WIDTH = 0.12;
const WAVE_WIDTH = 0.5;
const WHOLE_RING_WIDTH = 6;
/** Glint Bloom: a click within 3° of the ring blinks a station there. */
const RING_CLICK_TOLERANCE = 3 * DEG;

// Rim: rest 1.0 (tuned in the material so the peak is ≤ 0.9, no bloom). Quiet beats
// (Frostfall) never stack past one Frostfall's worth; only QUAD/APEX/PERFECT reach RIM_MAX.
const RIM_QUIET_MAX = 0.12;
const RIM_MAX = 1.9;
const DIM_MIN = 0.3;
const DUST_GAIN_MIN = 0.1;
const DUST_GAIN_MAX = 4;
/** Hush depth: rate = base · (1 − HUSH_DEPTH · weight), 0.04 at full hush. */
const HUSH_DEPTH = 1 - PARHELION_CLOCK_RATES.hush;
const HUSH_HOLD_END = PARHELION_TIMING.reveal;

// Level "Lower Sun" (§7.4).
const WARMTH_MAX = 0.6;
const WARMTH_STEP = 0.055;
const LEVEL_DENSITY_STEP = 0.04;
const LEVEL_DENSITY_CAP = 0.10;
const LEVEL_GAIN_STEP = 0.03;
const LEVEL_GAIN_CAP = 0.30;
/** Crowning at a tier without the crown falls back to the dog gain (§7.4). */
const CROWN_DOG_FALLBACK = 0.2;

// Pillars: bead end height (uv.y) and the reduced-motion "no climb" start.
const PILLAR_BEAD_END = 1.05;
const PILLAR_STAGGER = 0.08;

// Spawning (§7.3: nothing reactive spawns inside a live board rect).
const SPAWN_MARGIN = 0.012;
const SPAWN_EDGE = 0.02;
const SPAWN_PASSES = 5;
const MP_LANE_GAP = 0.03;
const MAX_EXCLUSIONS = 8;
const TOWARD_SPEED_K = 2.0;
const TOWARD_SPEED_MAX = 40;

const MAX_DT = 0.1;

/** Clear beats ×1/×2/×3 (§7.4, §7.5 ladder: arc peaks 1.5 / 1.95 / 2.4). */
const CLEAR_BEATS = Object.freeze([
    Object.freeze({
        beadAmp: 0.5, beadDur: 1.0, dogs: 0.35, pillarAmp: 0.55, pillarLife: 1.4, motes: 16,
    }),
    Object.freeze({
        beadAmp: 0.65, beadDur: 1.0, dogs: 0.45, pillarAmp: 0.65, pillarLife: 1.5, motes: 16,
    }),
    Object.freeze({
        beadAmp: 0.8, beadDur: 0.9, dogs: 0.55, pillarAmp: 0.75, pillarLife: 1.5, motes: 24,
    }),
]);

// ---------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function clamp01(value) {
    return clamp(value, 0, 1);
}

function finiteNumber(value, fallback) {
    return Number.isFinite(value) ? Number(value) : fallback;
}

function smoothstep(edge0, edge1, x) {
    const u = clamp01((x - edge0) / (edge1 - edge0));
    return u * u * (3 - 2 * u);
}

function wrapPi(phi) {
    return phi - TWO_PI * Math.round(phi / TWO_PI);
}

function ease(kind, u) {
    if (kind === EASE_OUT_CUBIC) {
        const v = 1 - u;
        return 1 - v * v * v;
    }
    if (kind === EASE_IN_OUT_CUBIC) {
        return u < 0.5 ? 4 * u * u * u : 1 - ((2 - 2 * u) ** 3) / 2;
    }
    if (kind === EASE_IN_CUBIC) return u * u * u;
    if (kind === EASE_SMOOTH) return u * u * (3 - 2 * u);
    return u;
}

/**
 * §7.2 envelope: `amp·ss(0, attack, age)·(age < attack+hold ? 1 : exp(−(age−attack−hold)/tau))`,
 * 0 before its birth (births may be in the future).
 */
export function envelopeValue(t, birth, attack, hold, tau, amp) {
    const age = t - birth;
    if (age < 0 || amp === 0) return 0;
    const rise = attack > 0 ? smoothstep(0, attack, age) : 1;
    const sustain = attack + hold;
    if (age < sustain) return amp * rise;
    if (!(tau > 0)) return 0;
    return amp * rise * Math.exp(-(age - sustain) / tau);
}

/** Hush weight x s after the Clear Sky cue: eases in, holds to the reveal, eases back out. */
export function hushWeight(x) {
    const { hushIn, hushOut } = PARHELION_TIMING;
    if (x <= 0) return 0;
    if (x < hushIn) return smoothstep(0, hushIn, x);
    if (x < HUSH_HOLD_END) return 1;
    if (x < HUSH_HOLD_END + hushOut) return 1 - smoothstep(HUSH_HOLD_END, HUSH_HOLD_END + hushOut, x);
    return 0;
}

/** ∫₀ˣ hushWeight: closed form (∫₀ᵘ smoothstep = u³ − u⁴/2), so the frozen clock is exact. */
export function hushIntegral(x) {
    const { hushIn, hushOut } = PARHELION_TIMING;
    if (x <= 0) return 0;
    if (x < hushIn) {
        const u = x / hushIn;
        return hushIn * (u * u * u - (u * u * u * u) / 2);
    }
    const rampIn = hushIn / 2;
    if (x < HUSH_HOLD_END) return rampIn + (x - hushIn);
    const held = rampIn + (HUSH_HOLD_END - hushIn);
    if (x < HUSH_HOLD_END + hushOut) {
        const u = (x - HUSH_HOLD_END) / hushOut;
        return held + hushOut * (u - (u * u * u - (u * u * u * u) / 2));
    }
    return held + hushOut / 2;
}

/**
 * Pillar uv.y (0 ground, 1 top at PILLAR.HEIGHT) of the point on a pillar at world depth
 * `worldZ` that projects to screen height `sy` (y-down) through the rest camera. Screen y
 * does not depend on world x (R = +x), so one formula serves every lane.
 */
export function screenYToPillarV(sy, worldZ) {
    const k = (1 - 2 * sy) * TAN_V;
    const dz = worldZ - CAM_REST.z;
    const dh = (dz * (k * S.z - U.z)) / (U.y - k * S.y);
    return (CAM_REST.y + dh) / PILLAR.HEIGHT;
}

/** Resolves a tier name (case-insensitive) or a caps object (partial overrides allowed). */
export function resolveOpticsTierCaps(tier) {
    const tiers = PARHELION_OPTICS_TIERS;
    const byName = (name) => {
        if (typeof name !== 'string') return null;
        const key = Object.keys(tiers).find((entry) => entry.toLowerCase() === name.toLowerCase());
        return key ? tiers[key] : null;
    };
    if (typeof tier === 'string') return byName(tier) || tiers.High;
    if (!tier || typeof tier !== 'object') return tiers.High;
    const base = byName(tier.name) || tiers.High;
    const int = (value, fallback, min, max) => clamp(Math.trunc(finiteNumber(value, fallback)), min, max);
    const flag = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
    return Object.freeze({
        name: base.name,
        burstSlots: int(tier.burstSlots, base.burstSlots, 1, 32),
        perSlot: int(tier.perSlot, base.perSlot, 1, 64),
        pillars: int(tier.pillars, base.pillars, 0, PARHELION_OPTICS_CAPS.pillars),
        crown: flag(tier.crown, base.crown),
        lowitz: flag(tier.lowitz, base.lowitz),
        prism: flag(tier.prism, base.prism),
    });
}

function createRect() {
    return {
        x0: 0, y0: 0, x1: 0, y1: 0,
    };
}

function copyRect(src, dst) {
    dst.x0 = src.x0;
    dst.y0 = src.y0;
    dst.x1 = src.x1;
    dst.y1 = src.y1;
    return dst;
}

function validRect(r) {
    return !!r
        && Number.isFinite(r.x0) && Number.isFinite(r.y0)
        && Number.isFinite(r.x1) && Number.isFinite(r.y1)
        && r.x1 > r.x0 + 0.005 && r.y1 > r.y0 + 0.005;
}

function createOut(caps) {
    const slots = caps.burstSlots;
    return {
        /** Shader uTime (s): burst/pillar births are on this clock. */
        time: 0,
        /** uK0 = (halo, dogs, parhelic, uta); uK1 = (crown, sunPillar, lowitz, displayDim). */
        k0: new Float32Array(PARHELION_OPTICS_IDLE.k0),
        k1: new Float32Array(PARHELION_OPTICS_IDLE.k1),
        dogFlare: new Float32Array(2),
        dogTail: PARHELION_OPTICS_IDLE.dogTail,
        dogTint: 0,
        /** uPc = (pulse azimuth, pulse amplitude). */
        pc: new Float32Array([DOG_AZ, 0]),
        /** uArcs: 8 × (phiCenter, amp, width, mode); the shader loops i < arcCount. */
        arcs: new Float32Array(ARC_SLOTS * 4),
        arcCount: 0,
        /** Glint pool (§5.5): A origin.xyz+birth, B count/life/strength/hue, C dir+speed, D mode/spread/seed/size. */
        burstA: new Float32Array(slots * 4),
        burstB: new Float32Array(slots * 4),
        burstC: new Float32Array(slots * 4),
        burstD: new Float32Array(slots * 4),
        burstSlots: slots,
        burstPerSlot: caps.perSlot,
        /** True for the one update() after any burst slot write: upload the four arrays then. */
        burstDirty: true,
        /** uPillars: 6 × (birth, amp, beadStartV, life); uPillarPlace: 6 × (x, z, width, height). */
        pillars: new Float32Array(PARHELION_OPTICS_CAPS.pillars * 4),
        pillarPlace: new Float32Array(PARHELION_OPTICS_CAPS.pillars * 4),
        pillarCount: caps.pillars,
        pillarsDirty: true,
        pillarPlaceDirty: true,
        ringFlash: 0,
        prism: 0,
        shower: 0,
        /** uSpoke = (angle on the ring, amplitude). */
        spoke: new Float32Array(2),
        crossArm: 0,
        dustGain: PARHELION_OPTICS_IDLE.dustGain,
        density: PARHELION_OPTICS_IDLE.density,
        rim: PARHELION_OPTICS_IDLE.rim,
        bloomKick: 0,
        /** Same value as k1[3]. */
        displayDim: 1,
        warmth: PARHELION_OPTICS_IDLE.warmth,
        breath: 1,
        /** Camera breathing scale for breathingPose() (reduced motion 0.3). */
        breathScale: 1,
        clocks: {
            dustClock: 0,
            veilPhase: 0,
            driftPhase: 0,
            dustClockRate: 1,
        },
        /** Rotational-only shake (§2.5), degrees, added to the breathing pose. */
        shake: { yawDeg: 0, pitchDeg: 0 },
    };
}

// ---------------------------------------------------------------------------------------
// ParhelionOpticsState
// ---------------------------------------------------------------------------------------

export class ParhelionOpticsState {
    /**
     * @param {string|object} [tier] tier name ('High', …) or a caps object
     *   `{ name?, burstSlots?, perSlot?, pillars?, crown?, lowitz?, prism? }`
     */
    constructor(tier = 'High') {
        this.caps = resolveOpticsTierCaps(tier);
        this.out = createOut(this.caps);

        this.now = 0;
        this.reducedMotion = false;
        this.intensity = 1;
        this.gain = 1;
        this.resonance = 0;
        this.cueRm = false;

        // Clocks.
        this.dustBaseRate = PARHELION_CLOCK_RATES.dust;
        this.dustClock = 0;
        this.veilPhase = 0;
        this.driftPhase = 0;
        this.hushActive = false;
        this.hushBirth = 0;
        this.hushBank = 0;

        // Level ("Lower Sun"), eased: effective level = from → to over PARHELION_AMBIENT.warmthEase.
        this.levelFrom = 1;
        this.levelTo = 1;
        this.levelBirth = 0;

        // Envelope pools: CHANNEL_COUNT × ENVELOPES × (birth, attack, hold, tau, amp).
        this.env = new Float64Array(CHANNEL_COUNT * ENV_BLOCK);

        // Arc slot motions.
        this.arcPlayer = new Int8Array(ARC_SLOTS).fill(-1);
        this.arcBirth = new Float64Array(ARC_SLOTS);
        this.arcEnd = new Float64Array(ARC_SLOTS).fill(-Infinity);
        this.arcAmp = new Float64Array(ARC_SLOTS);
        this.arcWidth = new Float64Array(ARC_SLOTS).fill(1);
        this.arcMode = new Uint8Array(ARC_SLOTS);
        this.arcFrom = new Float64Array(ARC_SLOTS);
        this.arcTo = new Float64Array(ARC_SLOTS);
        this.arcDur = new Float64Array(ARC_SLOTS);
        this.arcEase = new Uint8Array(ARC_SLOTS);
        this.arcAttack = new Float64Array(ARC_SLOTS);
        this.arcHold = new Float64Array(ARC_SLOTS);
        this.arcTau = new Float64Array(ARC_SLOTS);
        this.stationToggle = 0;
        this.spokeSlot = -1;
        this.spokeAngle = 0;

        // Parhelic pulse motion.
        this.pcBirth = DORMANT_BIRTH;
        this.pcDur = 1;
        this.pcFrom = DOG_AZ;
        this.pcTo = DOG_AZ;

        // Burst slot bookkeeping (the values themselves live in out.burstA–D).
        const slots = this.caps.burstSlots;
        this.burstOwner = new Int8Array(slots).fill(-1);
        this.burstBirth = new Float64Array(slots).fill(DORMANT_BIRTH);
        this.burstEnd = new Float64Array(slots).fill(-Infinity);
        this.burstCursor = 0;
        this.burstSerial = 0;
        this.burstDirty = true;
        this.pillarsDirty = true;
        this.pillarPlaceDirty = true;

        // Shake.
        this.shakeBirth = DORMANT_BIRTH;
        this.shakeDur = 0;
        this.shakeAmp = 0;

        // Layout.
        this.aspect = DEFAULT_LAYOUT.aspect;
        this.mode = '';
        this.edgeAz = Math.atan(tanH(this.aspect)) + 0.02;
        this.cardRect = copyRect(DEFAULT_LAYOUT.card, createRect());
        this.boardRect = copyRect(DEFAULT_LAYOUT.board, createRect());
        this.playerRects = new Array(PARHELION_PLAYER_SLOTS);
        this.playerRectValid = new Uint8Array(PARHELION_PLAYER_SLOTS);
        for (let i = 0; i < PARHELION_PLAYER_SLOTS; i++) this.playerRects[i] = createRect();
        this.multiBoard = false;
        this.lanes = { xL: 0, xR: 0 };
        this.exclusion = new Float32Array(MAX_EXCLUSIONS * 4);
        this.exclusionCount = 0;

        // Scratch (applyCue-time; never allocated per cue).
        this.geo = {
            player: 0,
            side: 1,
            rowV: 0.5,
            lockV: 0.5,
            rowY: 0.5,
            lockY: 0.5,
            phiRow: 0,
            phiLock: 0,
            laneL: 0.2,
            laneR: 0.8,
            laneLock: 0.8,
        };
        this.spawn = {
            player: 0,
            birth: 0,
            count: 0,
            life: 1,
            strength: 1,
            hue: 0.5,
            mode: 0,
            speed: 0,
            spread: 2,
            sizePx: 4,
            dirX: 0,
            dirY: 0,
            dirZ: 0,
            targetPhi: 0,
        };
        this.placed = { x: 0, y: 0 };
        this.world = { x: 0, y: 0, z: 0 };
        this.target = { x: 0, y: 0, z: 0 };
        this.dir = { x: 0, y: 0, z: 0 };
        this.screen = { x: 0, y: 0, depth: 0 };
        this.cardScratch = createRect();

        this._resetBursts();
        this._resetPillars();
        this.setLayout(null);
    }

    // ── configuration ────────────────────────────────────────────────────────────

    /**
     * @param {{ reducedMotion?: boolean, intensity?: number }} [options] intensity 0 clears every
     *   live reaction (ambient life, level warmth and the clocks continue).
     */
    configure(options = EMPTY) {
        const opts = options || EMPTY;
        if (opts.reducedMotion !== undefined) {
            const rm = opts.reducedMotion === true;
            if (rm && !this.reducedMotion) this._endHush();
            this.reducedMotion = rm;
            this.dustBaseRate = rm ? PARHELION_CLOCK_RATES.dustReducedMotion : PARHELION_CLOCK_RATES.dust;
            if (rm) this.shakeAmp = 0;
        }
        if (opts.intensity !== undefined) {
            this.intensity = clamp01(finiteNumber(opts.intensity, this.intensity));
        }
        this.gain = this.reducedMotion
            ? Math.min(this.intensity, PARHELION_REDUCED_MOTION_INTENSITY)
            : this.intensity;
        if (this.intensity <= 0) this._clearReactions();
    }

    /**
     * Layout from the board-rect reader (normalised screen fractions, y-down). Runs on resize,
     * mode start and the delayed re-reads, never per frame.
     * @param {{
     *   card?: {x0,y0,x1,y1}, board?: {x0,y0,x1,y1}, queue?: object, next?: object, hud?: object,
     *   boards?: Array<{x0,y0,x1,y1}|null>, mode?: string, aspect?: number,
     *   width?: number, height?: number,
     * }|null} layout `boards[i]` is player i's board canvas (0 = the solo/default board,
     *   1..4 the local-MP boards); a missing entry falls back to `board`.
     */
    setLayout(layout) {
        const l = layout || EMPTY;
        let aspect = finiteNumber(l.aspect, 0);
        if (!(aspect > 0) && l.width > 0 && l.height > 0) aspect = l.width / l.height;
        this.aspect = aspect > 0 ? aspect : DEFAULT_LAYOUT.aspect;
        this.mode = typeof l.mode === 'string' ? l.mode : '';
        this.edgeAz = Math.atan(tanH(this.aspect)) + 0.02;
        const serenity = this.mode === 'serenity';

        const hasCard = validRect(l.card);
        let firstBoard = -1;
        let validBoards = 0;
        for (let i = 0; i < PARHELION_PLAYER_SLOTS; i++) {
            const r = Array.isArray(l.boards) ? l.boards[i] : null;
            const ok = validRect(r);
            this.playerRectValid[i] = ok ? 1 : 0;
            if (ok) {
                copyRect(r, this.playerRects[i]);
                validBoards += 1;
                if (firstBoard < 0) firstBoard = i;
            }
        }
        this.multiBoard = validBoards >= 2;

        // Board (row mapping): the board canvas, else the first player board, else the card.
        let boardSrc = null;
        if (validRect(l.board)) boardSrc = l.board;
        else if (firstBoard >= 0) boardSrc = this.playerRects[firstBoard];
        // No rects at all: the §6 fallback outside Serenity (the default frame before any layout).
        const fallback = !!layout && !serenity && !hasCard && !boardSrc;
        const bare = !!layout && serenity && !hasCard && !boardSrc;
        if (boardSrc) copyRect(boardSrc, this.boardRect);
        else if (hasCard) copyRect(l.card, this.boardRect);
        else copyRect(fallback ? FALLBACK_RECT : DEFAULT_LAYOUT.board, this.boardRect);
        // Card (stone target, lane anchors): the card, else the board expanded (§15 item 1).
        if (hasCard) copyRect(l.card, this.cardRect);
        else if (boardSrc) cardFromBoard(this.boardRect, this.cardRect);
        else copyRect(fallback ? FALLBACK_RECT : DEFAULT_LAYOUT.card, this.cardRect);
        laneAnchors(this.cardRect, this.lanes);

        // Spawn exclusion (§7.3): every live board rect. Serenity without rects has none.
        this.exclusionCount = 0;
        if (!bare) {
            this._addExclusion(this.cardRect);
            if (!fallback) this._addExclusion(this.boardRect);
            for (let i = 0; i < PARHELION_PLAYER_SLOTS; i++) {
                if (this.playerRectValid[i]) this._addExclusion(this.playerRects[i]);
            }
        }

        writePillarPlaces(this.aspect, this.out.pillarPlace);
        this.pillarPlaceDirty = true;
    }

    /** Eased combo resonance r ∈ [0, 1] from the director (Warm Hounds / Crowning / Parhelic Line). */
    setResonance(r) {
        this.resonance = clamp01(finiteNumber(r, 0));
    }

    /** LEVEL_UP → "Lower Sun": warmth, density and halo/dog baselines ease to the level over 3 s. */
    setLevel(n, now = this.now) {
        const t = finiteNumber(now, this.now);
        const level = Math.max(1, Math.trunc(finiteNumber(n, 1)));
        this.levelFrom = this._levelAt(t);
        this.levelTo = level;
        this.levelBirth = t;
    }

    /** gameOver / modeStopped: forget every reaction, the resonance and the level (eased back). */
    resetSession() {
        this._clearReactions();
        this.resonance = 0;
        this.setLevel(1, this.now);
    }

    /**
     * `?t=` reproducibility: integrated clocks = t·rate. The dust clock also subtracts every
     * Clear Sky hush already scheduled, exactly as a frame-stepped run would have.
     */
    seek(t) {
        const time = finiteNumber(t, 0);
        const live = this.hushActive ? HUSH_DEPTH * hushIntegral(time - this.hushBirth) : 0;
        this.dustClock = time * this.dustBaseRate - this.hushBank - live;
        this.veilPhase = time * PARHELION_CLOCK_RATES.veil;
        this.driftPhase = time * PARHELION_CLOCK_RATES.drift;
        this.now = time;
    }

    // ── cues ─────────────────────────────────────────────────────────────────────

    /**
     * One dominant cue from the director (or a B2B ECHO). `c` is the director's reused object:
     * every field needed later is copied into typed arrays here, never retained.
     * @param {object} c `{kind, player, primary, sx, sy, rowV, lockU, lockV?, lines, combo,
     *   cascade, depth, strength, reducedMotion, lockCount, b2b, echoOf?}`
     * @param {number} now theme time (s): the births of everything this cue schedules
     */
    applyCue(c, now) {
        if (!c || this.intensity <= 0) return;
        const t = finiteNumber(now, this.now);
        this.now = t;
        const s = clamp(finiteNumber(c.strength, 1), 0, 2);
        if (!(s > 0)) return;
        const rm = c.reducedMotion === true || this.reducedMotion;
        this.cueRm = rm;
        this._readGeometry(c);
        const { kind } = c;
        const click = finiteNumber(c.sx, -1) >= 0 && finiteNumber(c.sy, -1) >= 0;
        if (kind === CUE.LOCK) this._haloCount(c, t, s, rm);
        else if (kind === CUE.STONEFALL) this._frostfall(c, t, s, rm);
        else if ((kind === CUE.CLEAR || kind === CUE.QUAD) && click) this._glintBloom(c, t, s);
        else if (kind === CUE.CLEAR) this._houndsWake(c, t, s, rm);
        else if (kind === CUE.QUAD) this._haloCloses(c, t, s, rm);
        else if (kind === CUE.TSPIN) this._haloTurn(c, t, s, rm);
        else if (kind === CUE.APEX) this._sunCross(t, s, rm);
        else if (kind === CUE.PERFECT) this._clearSky(t, s, rm);
        else if (kind === CUE.ECHO) this._houndsAnswer(c, t, s, rm);
    }

    /** The director's `count(n)`: "Full Circle", a brightness wave once around the ring. */
    applyCount(n, now) {
        if (this.intensity <= 0) return;
        const t = finiteNumber(now, this.now);
        this.now = t;
        const g = this.gain;
        const slot = ARC_SLOT.WAVE;
        if (this.reducedMotion) {
            const amp = 0.15 * clamp01(g / PARHELION_REDUCED_MOTION_INTENSITY);
            this._arc(slot, 0, t, amp, WHOLE_RING_WIDTH, ARC_MODE.WHITE);
            this._arcMotion(slot, HALF_PI, HALF_PI, 0, EASE_LINEAR);
            this._arcEnvelope(slot, 0.1, 0.35, 0.15);
            return;
        }
        this._arc(slot, 0, t, 0.35 * g, WAVE_WIDTH, ARC_MODE.WHITE);
        this._arcMotion(slot, HALF_PI, HALF_PI - TWO_PI, 1.4, EASE_IN_OUT_CUBIC);
        this._arcEnvelope(slot, 0.1, 1.4, 0.3);
        this._env(CH_RING_FLASH, t, 0.1, 0, 0.45, 0.25 * g);
    }

    // ── frame ────────────────────────────────────────────────────────────────────

    /**
     * Evaluates every envelope, motion and clock at `now` into the reused `out`.
     * @param {number} now theme time (s)
     * @param {number} dt frame delta (s), clamped to [0, 0.1]; drives the integrated clocks
     */
    update(now, dt) {
        const t = finiteNumber(now, this.now);
        const step = clamp(finiteNumber(dt, 0), 0, MAX_DT);
        this.now = t;
        const { out, caps } = this;

        // Clocks (§8). The hush takes its exact integral over this frame's window, so the dust
        // clock never runs backwards (even across a clamped hitch) and frame-stepping telescopes
        // to the closed form seek() uses.
        let dustStep = step * this.dustBaseRate;
        let hushW = 0;
        if (this.hushActive) {
            const hushAge = t - this.hushBirth;
            hushW = hushWeight(hushAge);
            dustStep -= HUSH_DEPTH * (hushIntegral(hushAge) - hushIntegral(hushAge - step));
        }
        this.dustClock += dustStep;
        this.veilPhase += step * PARHELION_CLOCK_RATES.veil;
        this.driftPhase += step * PARHELION_CLOCK_RATES.drift;
        const { clocks } = out;
        clocks.dustClock = this.dustClock;
        clocks.veilPhase = this.veilPhase;
        clocks.driftPhase = this.driftPhase;
        clocks.dustClockRate = this.dustBaseRate * (1 - HUSH_DEPTH * hushW);
        out.time = t;

        // Resonance tiers (§7.4), scaled by the reaction gain.
        const g = this.gain;
        const r = this.resonance;
        const warm = smoothstep(0.1, 0.3, r) * g;
        const crowning = smoothstep(0.3, 0.45, r) * g;
        const line = smoothstep(0.6, 0.75, r) * g;

        // Level, warmth, breath (§7.4 Lower Sun, §8).
        const levelSteps = this._levelAt(t) - 1;
        const baseMul = 1 + Math.min(LEVEL_GAIN_CAP, LEVEL_GAIN_STEP * levelSteps);
        const warmthBase = Math.min(WARMTH_MAX, PARHELION_OPTICS_IDLE.warmth + WARMTH_STEP * levelSteps);
        const amb = PARHELION_AMBIENT;
        out.warmth = warmthBase * (1 + amb.warmthDepth * Math.sin((TWO_PI * t) / amb.warmthPeriod));
        out.breath = 1 + amb.breathDepth * Math.sin((TWO_PI * t) / amb.breathPeriod);
        out.breathScale = this.reducedMotion ? amb.cameraBreathReducedMotion : 1;
        const twinkle = 1 + amb.dogTwinkle * (0.6 * Math.sin(t * 1.69) + 0.4 * Math.sin(t * 3.31 + 1.3));

        // Optics gains.
        const idle = PARHELION_OPTICS_IDLE;
        const { k0, k1 } = out;
        const dogFallback = caps.crown ? 0 : CROWN_DOG_FALLBACK * crowning;
        const dogsBase = ((idle.k0[1] + 0.45 * warm) * baseMul + dogFallback) * twinkle;
        k0[0] = clamp(idle.k0[0] * baseMul + this._channel(CH_HALO, t), 0, 3);
        k0[1] = clamp(dogsBase + this._channel(CH_DOGS, t), 0, 3.5);
        k0[2] = clamp(idle.k0[2] + 0.78 * line + this._channel(CH_PARHELIC, t), 0, 2.5);
        // Crowning lifts the UTA base to .4·ss(r); the idle sliver is its floor (parhelion.effect agrees).
        k0[3] = clamp(Math.max(idle.k0[3], 0.4 * crowning) + this._channel(CH_UTA, t), 0, 2.5);
        k1[0] = caps.crown ? clamp(0.9 * crowning + this._channel(CH_CROWN, t), 0, 2) : 0;
        k1[1] = clamp(idle.k1[1] + this._channel(CH_SUN_PILLAR, t), 0, 3);
        k1[2] = caps.lowitz ? clamp(0.7 * line + this._channel(CH_LOWITZ, t), 0, 2) : 0;
        k1[3] = clamp(idle.k1[3] + this._channel(CH_DIM, t), DIM_MIN, 1);
        out.displayDim = k1[3];

        out.dogFlare[0] = clamp(this._channel(CH_FLARE_L, t), 0, 2);
        out.dogFlare[1] = clamp(this._channel(CH_FLARE_R, t), 0, 2);
        out.dogTail = clamp(idle.dogTail + this._channel(CH_TAIL, t), 1, 2.5);
        out.dogTint = clamp01(warm);
        out.pc[0] = this._pcAz(t);
        out.pc[1] = clamp(this._channel(CH_PC, t), 0, 1.5);

        // Dust effects, rim, bloom.
        out.ringFlash = clamp(this._channel(CH_RING_FLASH, t), 0, 1.5);
        out.prism = caps.prism ? clamp(this._channel(CH_PRISM, t), 0, 1.5) : 0;
        out.shower = clamp(this._channel(CH_SHOWER, t), 0, 1.5);
        out.crossArm = clamp(this._channel(CH_CROSS_ARM, t), 0, 1.5);
        const levelDensity = Math.min(LEVEL_DENSITY_CAP, LEVEL_DENSITY_STEP * idle.density * levelSteps);
        out.density = clamp(idle.density + levelDensity + 0.15 * line + this._channel(CH_DENSITY, t), 0, 1);
        const dustMul = (1 + 0.3 * line) * (1 + this._channel(CH_DUST_GAIN, t));
        out.dustGain = clamp(idle.dustGain * dustMul, DUST_GAIN_MIN, DUST_GAIN_MAX);
        const quietRim = Math.min(RIM_QUIET_MAX, this._channel(CH_RIM_QUIET, t));
        out.rim = clamp(idle.rim + quietRim + this._channel(CH_RIM, t), 0, RIM_MAX);
        out.bloomKick = clamp(this._channel(CH_KICK, t), 0, 1);

        // Arc slots: recomputed from their scheduled motion every frame.
        const { arcs } = out;
        let arcCount = 0;
        for (let i = 0; i < ARC_SLOTS; i++) {
            const o = i * 4;
            const amp = this.arcAmp[i] === 0 ? 0 : envelopeValue(
                t,
                this.arcBirth[i],
                this.arcAttack[i],
                this.arcHold[i],
                this.arcTau[i],
                this.arcAmp[i],
            );
            if (amp > ARC_EPSILON) {
                arcs[o] = wrapPi(this._arcPhi(i, t));
                arcs[o + 1] = amp;
                arcs[o + 2] = this.arcWidth[i];
                arcs[o + 3] = this.arcMode[i];
                arcCount = i + 1;
            } else {
                arcs[o] = 0;
                arcs[o + 1] = 0;
                arcs[o + 2] = 1;
                arcs[o + 3] = 0;
            }
        }
        out.arcCount = arcCount;

        // Spoke: follows its orbit bead (frozen where it was if that slot is re-used).
        out.spoke[0] = this.spokeSlot >= 0 ? wrapPi(this._arcPhi(this.spokeSlot, t)) : this.spokeAngle;
        out.spoke[1] = clamp(this._channel(CH_SPOKE, t), 0, 1);

        // Shake (rotation only, §2.5; none under reduced motion).
        const { shake } = out;
        const shakeAge = t - this.shakeBirth;
        if (!this.reducedMotion && this.shakeAmp > 0 && shakeAge >= 0 && shakeAge < this.shakeDur) {
            const fade = 1 - shakeAge / this.shakeDur;
            const amp = this.shakeAmp * fade * fade;
            shake.yawDeg = amp * Math.sin(TWO_PI * 17 * shakeAge);
            shake.pitchDeg = 0.7 * amp * Math.sin(TWO_PI * 23 * shakeAge + 1.1);
        } else {
            shake.yawDeg = 0;
            shake.pitchDeg = 0;
        }

        out.burstDirty = this.burstDirty;
        out.pillarsDirty = this.pillarsDirty;
        out.pillarPlaceDirty = this.pillarPlaceDirty;
        this.burstDirty = false;
        this.pillarsDirty = false;
        this.pillarPlaceDirty = false;
        return out;
    }

    /** Diagnostics only (allocates); applyCue() and update() never do. */
    getDiagnostics() {
        let liveBursts = 0;
        for (let i = 0; i < this.caps.burstSlots; i++) {
            if (this.burstOwner[i] >= 0 && this.now < this.burstEnd[i]) liveBursts += 1;
        }
        return {
            tier: this.caps.name,
            now: this.now,
            liveBursts,
            arcCount: this.out.arcCount,
            hushActive: this.hushActive,
            resonance: this.resonance,
            level: this._levelAt(this.now),
            reducedMotion: this.reducedMotion,
            intensity: this.intensity,
            exclusionCount: this.exclusionCount,
        };
    }

    // ── beats (§7.4) ─────────────────────────────────────────────────────────────

    /** LOCK "Halo Count": the next of 12 stations lights; 3 frost motes leave it. */
    _haloCount(c, t, s, rm) {
        const { geo } = this;
        if (!c.primary) {
            if (rm) return;
            const b = this._prepBurst(geo.player, t, 3, 0.55, 0.5, BURST_MODE.RADIAL);
            b.strength = s;
            this._emitBurst(geo.laneLock, geo.lockY);
            return;
        }
        const phi = stationPhi(this._stationIndex(c.lockCount));
        const amp = rm ? RM_STATION_AMP * clamp01(s / PARHELION_REDUCED_MOTION_INTENSITY) : 0.18 * s;
        this._station(t, phi, amp, geo.player);
        if (rm) return;
        dirToScreen(ringDir(phi, this.dir), this.aspect, this.screen);
        const b = this._prepBurst(geo.player, t, 3, 0.55, 0.5, BURST_MODE.RADIAL);
        b.strength = s;
        b.sizePx = 3.5;
        this._emitBurst(this.screen.x, this.screen.y);
    }

    /** STONEFALL "Frostfall": a brighter station, frost falling in the lock lane, a warm rim. */
    _frostfall(c, t, s, rm) {
        const { geo } = this;
        if (c.primary) {
            const phi = stationPhi(this._stationIndex(c.lockCount));
            const amp = rm ? RM_STATION_AMP * clamp01(s / PARHELION_REDUCED_MOTION_INTENSITY) : 0.3 * s;
            this._station(t, phi, amp, geo.player);
            this._env(CH_RIM_QUIET, t, 0.05, 0, 0.4, 0.12 * Math.min(1, s));
        }
        const b = this._prepBurst(geo.player, t, 6, 0.7, 0.72, BURST_MODE.FALL);
        b.strength = s;
        b.dirY = -1;
        b.speed = 3;
        b.spread = 0.8;
        this._emitBurst(geo.laneLock, geo.lockY);
    }

    /** CLEAR ×1/×2/×3 "One Hound Wakes / Both Hounds Rise / The Hounds Run". */
    _houndsWake(c, t, s, rm) {
        const { geo } = this;
        const lines = clamp(Math.trunc(finiteNumber(c.lines, 1)), 1, 3);
        const beat = CLEAR_BEATS[lines - 1];
        this._beadPair(this._allocBeadSlot(geo.player, t), t, beat.beadAmp * s, beat.beadDur, EASE_OUT_CUBIC, rm);

        const flare = beat.dogs * s;
        if (lines === 1) {
            this._env(geo.side < 0 ? CH_FLARE_L : CH_FLARE_R, t, 0.12, 0, 0.5, flare);
        } else {
            this._env(CH_FLARE_L, t, 0.12, 0, 0.5, flare);
            this._env(CH_FLARE_R, t, 0.12, 0, 0.5, flare);
        }
        const pAmp = beat.pillarAmp * s;
        if (lines === 1) {
            const lane = geo.side < 0 ? 0 : 1;
            this._pillar(lane, t, pAmp, this._beadStartV(lane, geo.rowY, rm), beat.pillarLife);
        } else {
            this._pillar(0, t, pAmp, this._beadStartV(0, geo.rowY, rm), beat.pillarLife);
            this._pillar(1, t + 0.06, pAmp, this._beadStartV(1, geo.rowY, rm), beat.pillarLife);
        }
        if (lines === 3) {
            const outer = geo.side < 0 ? 2 : 3;
            this._pillar(outer, t + 0.12, pAmp, this._beadStartV(outer, geo.rowY, rm), beat.pillarLife);
            this._env(CH_TAIL, t, 0.1, 0.2, 0.8, 0.6 * s);
            this._pcPulse(t, 0.9, 0.9 * s);
        }
        const motes = beat.motes + 4 * Math.min(3, Math.max(0, finiteNumber(c.depth, 0)));
        this._laneMotesTowardRing(t, s, motes, 0.9, 0.45);
    }

    /** QUAD "The Halo Closes": beads climb from the cleared rows and meet at the apex (+0.85 s). */
    _haloCloses(c, t, s, rm) {
        const { geo } = this;
        const meet = t + PARHELION_TIMING.quadMeet;
        this._beadPair(this._allocBeadSlot(geo.player, t), t, 1.0 * s, PARHELION_TIMING.quadMeet, EASE_IN_CUBIC, rm);
        // Future-dated at the meet: no timers.
        this._env(CH_UTA, meet, 0.15, 0, 0.9, 1.0 * s);
        this._env(CH_SUN_PILLAR, meet, 0.15, 0, 0.9, 1.0 * s);
        this._env(CH_RING_FLASH, meet, 0.05, 0, 0.45 / Math.LN2, 1.0 * s);
        this._env(CH_PRISM, meet, 0.05, 0, 0.7, 1.0 * s);
        this._env(CH_FLARE_L, meet, 0.15, 0.2, 0.7, 0.8 * s);
        this._env(CH_FLARE_R, meet, 0.15, 0.2, 0.7, 0.8 * s);
        this._env(CH_RIM, meet, 0.15, 0, 0.7, 0.8 * s);
        this._env(CH_KICK, meet, 0.08, 0, 0.6, 0.35 * s);
        for (let lane = 0; lane < 4; lane++) {
            this._pillar(lane, meet + lane * PILLAR_STAGGER, 1.0 * s, this._beadStartV(lane, geo.rowY, rm), 1.8);
        }
        if (!rm) this._shake(meet, 0.12, 0.15);
        const motes = 40 + 4 * Math.min(3, Math.max(0, finiteNumber(c.depth, 0)));
        this._laneMotesTowardRing(t, 1.3 * s, motes, 0.9, 0.4);
    }

    /** TSPIN "Halo Turn": one bead orbits the ring once from the lock side, sweeping a spoke. */
    _haloTurn(c, t, s, rm) {
        const { geo } = this;
        const withLines = finiteNumber(c.lines, 0) >= 1;
        const amp = (withLines ? 0.9 : 0.55) * s;
        if (rm) {
            this._arc(ARC_SLOT.WAVE, geo.player, t, 0.25 * s, WHOLE_RING_WIDTH, ARC_MODE.WHITE);
            this._arcMotion(ARC_SLOT.WAVE, HALF_PI, HALF_PI, 0, EASE_LINEAR);
            this._arcEnvelope(ARC_SLOT.WAVE, 0.1, 0.35, 0.15);
        } else {
            const slot = this._allocBeadSlot(geo.player, t);
            const start = geo.side < 0 ? Math.PI - geo.phiLock : geo.phiLock;
            this._arc(slot, geo.player, t, amp, ORBIT_WIDTH, ARC_MODE.ORBIT);
            this._arcMotion(slot, start, start + geo.side * TWO_PI, 1.1, EASE_SMOOTH);
            this._arcEnvelope(slot, 0.08, 1.1, 0.3);
            this.spokeSlot = slot;
            this.spokeAngle = wrapPi(start);
            this._env(CH_SPOKE, t, 0.1, 1.1, 0.4, 0.8 * s);
        }
        if (withLines) {
            this._env(CH_FLARE_L, t, 0.12, 0, 0.5, 0.3 * s);
            this._env(CH_FLARE_R, t, 0.12, 0, 0.5, 0.3 * s);
        }
        const b = this._prepBurst(geo.player, t, withLines ? 20 : 8, 1.0, 0.6, BURST_MODE.SPIRAL);
        b.strength = s;
        b.dirX = geo.side;
        b.speed = 2;
        b.spread = 1.5;
        this._emitBurst(geo.laneLock, geo.lockY);
    }

    /** APEX "Sun Cross": the ⊕ drawn around the stone; 4 pillars; the rim burns gold. */
    _sunCross(t, s, rm) {
        const idle = PARHELION_OPTICS_IDLE;
        const { geo } = this;
        this._env(CH_SUN_PILLAR, t, 0.25, 2.5, 1.2, (1.6 - idle.k1[1]) * s);
        this._env(CH_PARHELIC, t, 0.25, 2.5, 1.2, (1.2 - idle.k0[2]) * s);
        this._env(CH_CROWN, t, 0.25, 2.5, 1.2, 1.0 * s);
        this._env(CH_CROSS_ARM, t, 0.25, 2.5, 1.2, 1.2 * s);
        this._env(CH_DUST_GAIN, t, 0.25, 1.2, 1.5, 1.5 * s);
        this._env(CH_DENSITY, t, 0.25, 1.2, 1.5, 0.15 * s);
        this._env(CH_KICK, t, 0.1, 0, 0.6, 0.4 * s);
        this._env(CH_RIM, t, 0.25, 2.0, 1.2, 0.9 * s);
        for (let lane = 0; lane < 4; lane++) {
            this._pillar(lane, t + lane * PILLAR_STAGGER, 1.0 * s, this._beadStartV(lane, geo.rowY, rm), 2.6);
        }
        if (!rm) this._shake(t, 0.15, 0.19);
        this._laneMotesAir(t, 1.3 * s, 56, 1.6, 0.35, BURST_MODE.RADIAL);
    }

    /** PERFECT "Clear Sky": hush (0–350 ms), reveal (+350), then the Lumen return. */
    _clearSky(t, s, rm) {
        const idle = PARHELION_OPTICS_IDLE;
        const lumen = PARHELION_LUMEN_RETURN;
        const { geo } = this;
        const reveal = t + PARHELION_TIMING.reveal;
        const attack = 0.15;
        // Hold each stage from the reveal until its Lumen-return start.
        const hold = (stage) => Math.max(0, stage.start - PARHELION_TIMING.reveal - attack);
        if (!rm) {
            this._env(CH_DIM, t, PARHELION_TIMING.hushIn, 0.2, 0.1, -0.45);
            this._env(CH_DUST_GAIN, t, PARHELION_TIMING.hushIn, 0.2, 0.25, -0.6);
            this._startHush(t);
            this._shake(reveal, 0.2, 0.19);
        }
        this._env(CH_HALO, reveal, attack, hold(lumen.ring), lumen.ring.tau, (1.6 - idle.k0[0]) * s);
        this._env(CH_DOGS, reveal, attack, hold(lumen.ring), lumen.ring.tau, (2.2 - idle.k0[1]) * s);
        this._env(CH_FLARE_L, reveal, attack, hold(lumen.ring), lumen.ring.tau, 1.0 * s);
        this._env(CH_FLARE_R, reveal, attack, hold(lumen.ring), lumen.ring.tau, 1.0 * s);
        this._env(CH_PARHELIC, reveal, attack, hold(lumen.parhelic), lumen.parhelic.tau, (1.3 - idle.k0[2]) * s);
        this._env(CH_UTA, reveal, attack, hold(lumen.uta), lumen.uta.tau, (1.0 - idle.k0[3]) * s);
        this._env(CH_CROWN, reveal, attack, hold(lumen.crown), lumen.crown.tau, (1.0 - idle.k1[0]) * s);
        this._env(CH_SUN_PILLAR, reveal, attack, hold(lumen.sunPillar), lumen.sunPillar.tau, (2.0 - idle.k1[1]) * s);
        this._env(CH_LOWITZ, reveal, attack, hold(lumen.lowitz), lumen.lowitz.tau, (1.0 - idle.k1[2]) * s);
        this._env(CH_CROSS_ARM, reveal, attack, hold(lumen.crossArm), lumen.crossArm.tau, 0.8 * s);
        this._env(CH_RIM, reveal, attack, hold(lumen.ring), 1.0, (1.6 - idle.rim) * s);
        this._env(CH_SHOWER, reveal, 0.3, 0.5, 2.4, 1.0 * s);
        this._env(CH_KICK, reveal, 0.1, 0, 0.6, 0.5 * s);
        this._env(CH_RING_FLASH, reveal, 0.05, 0, 0.45 / Math.LN2, 0.8 * s);
        this._env(CH_PRISM, reveal, 0.05, 0, 0.7, 0.8 * s);
        this._pcPulse(reveal, 0.9, 0.9 * s);
        for (let lane = 0; lane < 4; lane++) {
            const birth = reveal + lane * PILLAR_STAGGER;
            const life = t + lumen.pillarsEnd - birth;
            this._pillar(lane, birth, 1.0 * s, this._beadStartV(lane, geo.rowY, rm), life);
        }
        this._laneMotesAir(reveal, 1.3 * s, 72, 2.2, 0.68, BURST_MODE.FALL);
    }

    /** ECHO "The Hounds Answer": a fainter repeat 0.18 s later (strength already halved). */
    _houndsAnswer(c, t, s, rm) {
        const { geo } = this;
        const slot = ARC_SLOT.ECHO;
        if (rm) {
            this._arc(slot, geo.player, t, s, BEAD_WIDTH, ARC_MODE.PAIR);
            this._arcMotion(slot, HALF_PI, HALF_PI, 0, EASE_LINEAR);
            this._arcEnvelope(slot, 0.1, 0.35, 0.15);
        } else if (c.echoOf === CUE.TSPIN) {
            const start = geo.side < 0 ? Math.PI - geo.phiLock : geo.phiLock;
            this._arc(slot, geo.player, t, 0.9 * s, ORBIT_WIDTH, ARC_MODE.ORBIT);
            this._arcMotion(slot, start, start + geo.side * TWO_PI, 1.1, EASE_SMOOTH);
            this._arcEnvelope(slot, 0.08, 1.1, 0.3);
        } else {
            this._beadPair(slot, t, 1.0 * s, PARHELION_TIMING.quadMeet, EASE_IN_CUBIC, false);
        }
        const life = PARHELION_TIMING.echoPillarLife;
        this._pillar(4, t, s, this._beadStartV(4, geo.rowY, rm), life);
        this._pillar(5, t + 0.06, s, this._beadStartV(5, geo.rowY, rm), life);
        const b = this._prepBurst(geo.player, t, 8, 0.8, 0.5, BURST_MODE.TOWARD_RING);
        b.strength = s;
        b.targetPhi = geo.side < 0 ? Math.PI - geo.phiRow : geo.phiRow;
        this._emitBurst(geo.laneLock, geo.rowY);
    }

    /** Serenity click "Glint Bloom": frost at the click; a click on the halo blinks the ring there. */
    _glintBloom(c, t, s) {
        const { geo } = this;
        const lines = clamp(Math.trunc(finiteNumber(c.lines, 1)), 1, 4);
        const b = this._prepBurst(geo.player, t, 6 + 4 * lines, 0.9, 0.55, BURST_MODE.RADIAL);
        b.strength = s;
        b.spread = 2.2;
        this._emitBurst(c.sx, c.sy);
        const d = screenToDir(c.sx, c.sy, this.aspect, this.dir);
        const a = Math.acos(clamp(d.x * S.x + d.y * S.y + d.z * S.z, -1, 1));
        if (Math.abs(a - R22) < RING_CLICK_TOLERANCE) {
            const phi = Math.atan2(d.x * U.x + d.y * U.y + d.z * U.z, d.x);
            this._station(t, phi, 0.5 * s, geo.player);
        }
    }

    // ── beat building blocks ─────────────────────────────────────────────────────

    _readGeometry(c) {
        const { geo } = this;
        geo.player = clamp(Math.trunc(finiteNumber(c.player, 0)), 0, PARHELION_PLAYER_SLOTS - 1);
        const rect = this.multiBoard && this.playerRectValid[geo.player]
            ? this.playerRects[geo.player]
            : this.boardRect;
        geo.rowV = clamp01(finiteNumber(c.rowV, 0.5));
        geo.lockV = clamp01(finiteNumber(c.lockV, geo.rowV));
        const lockU = clamp01(finiteNumber(c.lockU, 0.5));
        geo.side = lockU < 0.5 ? -1 : 1;
        const height = rect.y1 - rect.y0;
        geo.rowY = rect.y0 + geo.rowV * height;
        geo.lockY = rect.y0 + geo.lockV * height;
        geo.phiRow = rowToPhi(geo.rowV, rect);
        geo.phiLock = rowToPhi(geo.lockV, rect);
        if (this.multiBoard) {
            geo.laneL = clamp(rect.x0 - MP_LANE_GAP, 0.03, 0.97);
            geo.laneR = clamp(rect.x1 + MP_LANE_GAP, 0.03, 0.97);
        } else {
            geo.laneL = this.lanes.xL;
            geo.laneR = this.lanes.xR;
        }
        geo.laneLock = geo.side < 0 ? geo.laneL : geo.laneR;
    }

    /** Primary lock n lights station (n − 1) mod 12: the first lock is the top (12 o'clock). */
    _stationIndex(lockCount) {
        const n = Math.max(1, Math.trunc(finiteNumber(lockCount, 1)));
        return (n - 1) % STATION_COUNT;
    }

    _station(t, phi, amp, player) {
        const slot = ARC_SLOT.STATION_A + this.stationToggle;
        this.stationToggle ^= 1;
        this._arc(slot, player, t, amp, STATION_WIDTH, ARC_MODE.WHITE);
        this._arcMotion(slot, phi, phi, 0, EASE_LINEAR);
        this._arcEnvelope(slot, 0.06, 0.12, 0.22);
    }

    /** A mirrored bead pair climbing from the row's ring angle to the top (static under RM). */
    _beadPair(slot, t, amp, dur, easeKind, rm) {
        const { geo } = this;
        this._arc(slot, geo.player, t, amp, BEAD_WIDTH, ARC_MODE.PAIR);
        if (rm) {
            this._arcMotion(slot, HALF_PI, HALF_PI, 0, EASE_LINEAR);
            this._arcEnvelope(slot, 0.1, 0.35, 0.15);
            return;
        }
        this._arcMotion(slot, geo.phiRow, HALF_PI, dur, easeKind);
        this._arcEnvelope(slot, 0.08, dur, 0.3);
    }

    /** Motes split over both lanes at the row height, flying toward the ring on their side. */
    _laneMotesTowardRing(t, strength, total, life, hue) {
        const { geo } = this;
        const half = Math.ceil(total / 2);
        let b = this._prepBurst(geo.player, t, half, life, hue, BURST_MODE.TOWARD_RING);
        b.strength = strength;
        b.targetPhi = Math.PI - geo.phiRow;
        this._emitBurst(geo.laneL, geo.rowY);
        b = this._prepBurst(geo.player, t, half, life, hue, BURST_MODE.TOWARD_RING);
        b.strength = strength;
        b.targetPhi = geo.phiRow;
        this._emitBurst(geo.laneR, geo.rowY);
    }

    /** Big beats: the player's three burst slots across both lanes (high) and the lock lane (low). */
    _laneMotesAir(birth, strength, total, life, hue, mode) {
        const { geo } = this;
        const per = Math.ceil(total / 3);
        for (let i = 0; i < 3; i++) {
            const b = this._prepBurst(geo.player, birth, per, life, hue, mode);
            b.strength = strength;
            b.spread = 2.5;
            if (mode === BURST_MODE.FALL) {
                b.dirY = -1;
                b.speed = 1.2;
                b.spread = 1.2;
            }
            if (i === 0) this._emitBurst(geo.laneL, 0.3);
            else if (i === 1) this._emitBurst(geo.laneR, 0.3);
            else this._emitBurst(geo.laneLock, 0.6);
        }
    }

    _pcPulse(birth, dur, amp) {
        this.pcBirth = birth;
        this.pcDur = dur;
        this.pcFrom = DOG_AZ;
        this.pcTo = this.edgeAz;
        this._env(CH_PC, birth, 0.06, dur, 0.4, amp);
    }

    _pcAz(t) {
        const u = clamp01((t - this.pcBirth) / this.pcDur);
        return this.pcFrom + (this.pcTo - this.pcFrom) * ease(EASE_OUT_CUBIC, u);
    }

    _shake(birth, deg, dur) {
        if (this.reducedMotion) return;
        const running = this.shakeAmp > 0 && birth < this.shakeBirth + this.shakeDur && birth >= this.shakeBirth;
        if (running && this.shakeAmp > deg) return;
        this.shakeBirth = birth;
        this.shakeAmp = deg;
        this.shakeDur = dur;
    }

    _startHush(t) {
        if (this.hushActive) this.hushBank += HUSH_DEPTH * hushIntegral(t - this.hushBirth);
        this.hushActive = true;
        this.hushBirth = t;
    }

    _endHush() {
        if (!this.hushActive) return;
        this.hushBank += HUSH_DEPTH * hushIntegral(this.now - this.hushBirth);
        this.hushActive = false;
    }

    _levelAt(t) {
        const u = smoothstep(0, PARHELION_AMBIENT.warmthEase, t - this.levelBirth);
        return this.levelFrom + (this.levelTo - this.levelFrom) * u;
    }

    // ── envelopes ────────────────────────────────────────────────────────────────

    /** Adds an envelope to a channel's pool (a spent one, else the oldest is replaced). */
    _env(ch, birth, attack, hold, tau, amp) {
        if (!(Math.abs(amp) > 1e-6)) return;
        const { env } = this;
        const base = ch * ENV_BLOCK;
        let pick = -1;
        let oldest = Infinity;
        let oldestIndex = 0;
        for (let i = 0; i < ENVELOPES; i++) {
            const o = base + i * ENV_STRIDE;
            const spentAt = env[o] + env[o + 1] + env[o + 2] + ENV_TAIL_TAUS * env[o + 3];
            if (env[o + 4] === 0 || this.now > spentAt) {
                pick = i;
                break;
            }
            if (env[o] < oldest) {
                oldest = env[o];
                oldestIndex = i;
            }
        }
        const o = base + (pick >= 0 ? pick : oldestIndex) * ENV_STRIDE;
        env[o] = birth;
        env[o + 1] = attack;
        env[o + 2] = hold;
        env[o + 3] = tau;
        env[o + 4] = amp;
    }

    _channel(ch, t) {
        const { env } = this;
        const base = ch * ENV_BLOCK;
        let sum = 0;
        for (let i = 0; i < ENVELOPES; i++) {
            const o = base + i * ENV_STRIDE;
            const amp = env[o + 4];
            if (amp !== 0) sum += envelopeValue(t, env[o], env[o + 1], env[o + 2], env[o + 3], amp);
        }
        return sum;
    }

    // ── arc slots ────────────────────────────────────────────────────────────────

    /** Bead/orbit slots 0–3: at most 2 live per player (their oldest replaced), else a free one, else the oldest. */
    _allocBeadSlot(player, t) {
        const { beadSlots, arcsPerPlayer } = PARHELION_OPTICS_CAPS;
        let own = 0;
        let ownOldest = -1;
        let ownBirth = Infinity;
        let free = -1;
        let oldest = 0;
        let oldestBirth = Infinity;
        for (let i = 0; i < beadSlots; i++) {
            const live = this.arcAmp[i] !== 0 && t < this.arcEnd[i];
            if (!live) {
                if (free < 0) free = i;
                continue;
            }
            if (this.arcPlayer[i] === player) {
                own += 1;
                if (this.arcBirth[i] < ownBirth) {
                    ownBirth = this.arcBirth[i];
                    ownOldest = i;
                }
            }
            if (this.arcBirth[i] < oldestBirth) {
                oldestBirth = this.arcBirth[i];
                oldest = i;
            }
        }
        if (own >= arcsPerPlayer) return ownOldest;
        if (free >= 0) return free;
        return oldest;
    }

    _arc(slot, player, birth, amp, width, mode) {
        if (slot === this.spokeSlot) {
            // The orbit carrying the spoke is replaced: freeze the spoke where the bead was.
            this.spokeAngle = wrapPi(this._arcPhi(slot, birth));
            this.spokeSlot = -1;
        }
        this.arcPlayer[slot] = player;
        this.arcBirth[slot] = birth;
        this.arcAmp[slot] = amp;
        this.arcWidth[slot] = width;
        this.arcMode[slot] = mode;
    }

    _arcMotion(slot, from, to, dur, easeKind) {
        this.arcFrom[slot] = from;
        this.arcTo[slot] = to;
        this.arcDur[slot] = dur;
        this.arcEase[slot] = easeKind;
    }

    _arcEnvelope(slot, attack, hold, tau) {
        this.arcAttack[slot] = attack;
        this.arcHold[slot] = hold;
        this.arcTau[slot] = tau;
        this.arcEnd[slot] = this.arcBirth[slot] + attack + hold + ENV_TAIL_TAUS * tau;
    }

    _arcPhi(slot, t) {
        const dur = this.arcDur[slot];
        const u = dur > 0 ? clamp01((t - this.arcBirth[slot]) / dur) : 1;
        const from = this.arcFrom[slot];
        return from + (this.arcTo[slot] - from) * ease(this.arcEase[slot], u);
    }

    // ── pillars ──────────────────────────────────────────────────────────────────

    /** Where the pillar's light knot starts: the row's screen height on that lane (RM: no climb). */
    _beadStartV(lane, rowY, rm) {
        if (rm) return PILLAR_BEAD_END;
        return clamp01(screenYToPillarV(rowY, this.out.pillarPlace[lane * 4 + 1]));
    }

    /** Writes a pillar lane; a stronger pillar still standing at `birth` is kept. */
    _pillar(lane, birth, amp, beadV, life) {
        if (lane >= this.caps.pillars || !(amp > 0) || !(life > 0)) return;
        const p = this.out.pillars;
        const o = lane * 4;
        if (p[o + 1] > amp && p[o] + p[o + 3] > birth) return;
        p[o] = birth;
        p[o + 1] = amp;
        p[o + 2] = beadV;
        p[o + 3] = life;
        this.pillarsDirty = true;
    }

    // ── burst slots (glint pool) ─────────────────────────────────────────────────

    /** Fills the reused spawn spec; reduced motion scales the count ×0.35 and the life ×0.6. */
    _prepBurst(player, birth, count, life, hue, mode) {
        const b = this.spawn;
        const rm = this.cueRm;
        b.player = player;
        b.birth = birth;
        b.count = Math.min(this.caps.perSlot, Math.round(count * (rm ? RM_MOTES : 1)));
        b.life = life * (rm ? RM_LIFE : 1);
        b.hue = hue;
        b.mode = mode;
        b.strength = 1;
        b.speed = 0;
        b.spread = 2;
        b.sizePx = 4;
        b.dirX = 0;
        b.dirY = 0;
        b.dirZ = 0;
        b.targetPhi = 0;
        return b;
    }

    /** Writes the prepared spec into a burst slot at screen (x, y), pushed outside every board rect. */
    _emitBurst(x, y) {
        const b = this.spawn;
        if (!(b.count >= 1) || !this._placeOutside(x, y)) return -1;
        const slot = this._allocBurst(b.player, b.birth);
        const w = screenToWorld55(this.placed.x, this.placed.y, this.aspect, this.world);
        let dx = b.dirX;
        let dy = b.dirY;
        let dz = b.dirZ;
        let { speed } = b;
        if (b.mode === BURST_MODE.TOWARD_RING) {
            const target = ringPoint(b.targetPhi, MOTE_PLANE_DEPTH, this.target);
            dx = target.x - w.x;
            dy = target.y - w.y;
            dz = target.z - w.z;
            const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (len > 1e-6) {
                dx /= len;
                dy /= len;
                dz /= len;
                speed = Math.min(TOWARD_SPEED_MAX, len * TOWARD_SPEED_K);
            }
        }
        const {
            burstA, burstB, burstC, burstD,
        } = this.out;
        const o = slot * 4;
        this.burstSerial += 1;
        burstA[o] = w.x;
        burstA[o + 1] = w.y;
        burstA[o + 2] = w.z;
        burstA[o + 3] = b.birth;
        burstB[o] = b.count;
        burstB[o + 1] = b.life;
        burstB[o + 2] = b.strength;
        burstB[o + 3] = b.hue;
        burstC[o] = dx;
        burstC[o + 1] = dy;
        burstC[o + 2] = dz;
        burstC[o + 3] = speed;
        burstD[o] = b.mode;
        burstD[o + 1] = b.spread;
        burstD[o + 2] = 1 + ((this.burstSerial * 7.31) % 97);
        burstD[o + 3] = b.sizePx;
        this.burstOwner[slot] = b.player;
        this.burstBirth[slot] = b.birth;
        this.burstEnd[slot] = b.birth + b.life;
        this.burstDirty = true;
        return slot;
    }

    /** ≤ 3 live slots per player (their oldest replaced), else a free slot, else the global oldest. */
    _allocBurst(player, t) {
        const slots = this.caps.burstSlots;
        let own = 0;
        let ownOldest = -1;
        let ownBirth = Infinity;
        let free = -1;
        let oldest = 0;
        let oldestBirth = Infinity;
        for (let j = 0; j < slots; j++) {
            const i = (this.burstCursor + j) % slots;
            const live = this.burstOwner[i] >= 0 && t < this.burstEnd[i];
            if (!live) {
                if (free < 0) free = i;
                continue;
            }
            if (this.burstOwner[i] === player) {
                own += 1;
                if (this.burstBirth[i] < ownBirth) {
                    ownBirth = this.burstBirth[i];
                    ownOldest = i;
                }
            }
            if (this.burstBirth[i] < oldestBirth) {
                oldestBirth = this.burstBirth[i];
                oldest = i;
            }
        }
        let slot = oldest;
        if (own >= PARHELION_OPTICS_CAPS.burstsPerPlayer) slot = ownOldest;
        else if (free >= 0) slot = free;
        this.burstCursor = (slot + 1) % slots;
        return slot;
    }

    /**
     * Moves a spawn point sideways out of every exclusion rect (nearer side first, the other
     * side when that leaves the screen). Returns false, and nothing spawns, when no spot works.
     */
    _placeOutside(x, y) {
        let px = clamp(finiteNumber(x, 0.5), SPAWN_EDGE, 1 - SPAWN_EDGE);
        const py = clamp(finiteNumber(y, 0.5), SPAWN_EDGE, 1 - SPAWN_EDGE);
        const ex = this.exclusion;
        for (let pass = 0; pass < SPAWN_PASSES; pass++) {
            let hit = -1;
            for (let i = 0; i < this.exclusionCount; i++) {
                const o = i * 4;
                if (px > ex[o] && px < ex[o + 2] && py > ex[o + 1] && py < ex[o + 3]) {
                    hit = o;
                    break;
                }
            }
            if (hit < 0) {
                this.placed.x = px;
                this.placed.y = py;
                return true;
            }
            const left = ex[hit] - 1e-3;
            const right = ex[hit + 2] + 1e-3;
            const leftOk = left >= SPAWN_EDGE;
            const rightOk = right <= 1 - SPAWN_EDGE;
            const preferLeft = px - ex[hit] <= ex[hit + 2] - px;
            if (leftOk && (preferLeft || !rightOk)) px = left;
            else if (rightOk) px = right;
            else return false;
        }
        return false;
    }

    _addExclusion(r) {
        if (this.exclusionCount >= MAX_EXCLUSIONS || !validRect(r)) return;
        const o = this.exclusionCount * 4;
        this.exclusion[o] = r.x0 - SPAWN_MARGIN;
        this.exclusion[o + 1] = r.y0 - SPAWN_MARGIN;
        this.exclusion[o + 2] = r.x1 + SPAWN_MARGIN;
        this.exclusion[o + 3] = r.y1 + SPAWN_MARGIN;
        this.exclusionCount += 1;
    }

    // ── reset ────────────────────────────────────────────────────────────────────

    _resetBursts() {
        const {
            burstA, burstB, burstC, burstD,
        } = this.out;
        for (let i = 0; i < this.caps.burstSlots; i++) {
            const o = i * 4;
            burstA[o] = 0;
            burstA[o + 1] = 0;
            burstA[o + 2] = 0;
            burstA[o + 3] = DORMANT_BIRTH;
            burstB[o] = 0;
            burstB[o + 1] = 1;
            burstB[o + 2] = 0;
            burstB[o + 3] = 0;
            burstC[o] = 0;
            burstC[o + 1] = 0;
            burstC[o + 2] = 0;
            burstC[o + 3] = 0;
            burstD[o] = 0;
            burstD[o + 1] = 0;
            burstD[o + 2] = 0;
            burstD[o + 3] = 0;
        }
        this.burstOwner.fill(-1);
        this.burstBirth.fill(DORMANT_BIRTH);
        this.burstEnd.fill(-Infinity);
        this.burstCursor = 0;
        this.burstDirty = true;
    }

    _resetPillars() {
        const p = this.out.pillars;
        for (let lane = 0; lane < PARHELION_OPTICS_CAPS.pillars; lane++) {
            const o = lane * 4;
            p[o] = DORMANT_BIRTH;
            p[o + 1] = 0;
            p[o + 2] = PILLAR_BEAD_END;
            p[o + 3] = 1;
        }
        this.pillarsDirty = true;
    }

    _clearReactions() {
        this.env.fill(0);
        this.arcAmp.fill(0);
        this.arcPlayer.fill(-1);
        this.arcEnd.fill(-Infinity);
        this.stationToggle = 0;
        this.spokeSlot = -1;
        this.pcBirth = DORMANT_BIRTH;
        this.pcFrom = DOG_AZ;
        this.pcTo = DOG_AZ;
        this.shakeAmp = 0;
        this.shakeBirth = DORMANT_BIRTH;
        this._endHush();
        this._resetBursts();
        this._resetPillars();
    }
}

export default ParhelionOpticsState;
