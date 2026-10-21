/**
 * Spring — the river's surface: the upper reach down to the fall's lip, then the plunge pool
 * under the fall and the rapids below it.
 *
 * One ribbon along the course (spring-plan) in two strips: the upper river, each of its columns
 * stopping at its own lip (where the fall's water takes over, spring-fall.js), drawing down as it
 * quickens over the brink; and the water below, from the back of the recess the main tongue has
 * worn under the lip, through the pool and down the rapids. Every vertex knows where it lies
 * along the river (s, metres) and across it (n, metres), and carries the water's speed there, how
 * white it runs (the boil where each tongue lands, the jump below every ledge, the wake behind
 * every boulder), the foam drifting on below them, and the standing waves. The rapids' ledges are
 * not straight: each slants and wanders across the river, so the water steps down unevenly.
 *
 * The material moves the water with a two-phase flow map: the foam and the ripples are read at
 * coordinates carried downstream at the local speed by the water's own clock (u.flowClock, which
 * the world integrates on the CPU so the flood can quicken it without the phase jumping), two
 * copies half a period apart cross-faded so neither is seen to reset. The water between the foam
 * is dark tea-green; at a glancing angle it mirrors the dark wooded banks, higher up the sky. Foam
 * is lit as a heap (its own lumps shade it) and kept within the range the tone curve can still
 * shape.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    atan,
    attribute,
    clamp,
    cos,
    dot,
    exp,
    float,
    fract,
    fwidth,
    length,
    max,
    mix,
    normalize,
    positionLocal,
    positionWorld,
    select,
    sin,
    smoothstep,
    step,
    texture,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { clamp as clampJs, smooth } from './spring-core.js';
import { aerial, skyColour } from './spring-light.js';
import { EVENT_ROWS, SURGES, spLuma } from './spring-tsl.js';
import {
    BOULDERS, FALL, LEDGES, LEDGE_LENGTH, RIVER, S_LIP, S_OUTLET, S_POOL, courseAt, levelAt, speedAt,
    turbulenceAt,
} from './spring-plan.js';
import {
    LIP_Y, POOL_Y, drawdown, lipAlong, lipDepth, poolBoil,
} from './spring-fall-plan.js';
import { forestCover, groundHeight, waterEdge } from './spring-terrain.js';
import { FACE, SHEET } from './spring-fall.js';

/** The ribbon starts this far up the river from the lip (out of sight up the valley). */
export const UPSTREAM = 320;
/** How far past the water's edge the ribbon runs under the banks (share of the half-width). */
export const TUCK = 1.16;
/** The pool reaches this far back (m) behind the lip's line, under the main tongue's recess. */
export const UNDER = 7.5;
/** The upper strip's rows run this far past the lip's middle (each column stops at its own lip). */
const LIP_OVER = 1.2;
/** Standing waves: wavelength (m) below a ledge, how far they reach, their height (m). */
export const WAVE = Object.freeze({ length: 3.6, reach: 22, height: 0.55 });
/**
 * A surge's speed down the rapids (m/s), its height (m), the length of its back and of its steep
 * front (m).
 */
export const SURGE = Object.freeze({
    speed: 7.5, height: 0.5, length: 9, front: 1.8,
});
/**
 * A T-spin's whirl where the plunge pool drains, clear of the fall's spray: its centre (m along
 * the river past the pool's start), its radius (m), how deep its eye dips (m), and its life
 * (s: spinning up, turning, dying away).
 */
export const WHIRL = Object.freeze({
    at: 24, radius: 16, dip: 1.2, life: Object.freeze([0.8, 4.5, 9]),
});
const WHIRL_CENTRE = courseAt(S_POOL + WHIRL.at, {});

export const WHIRL_CENTRE_AT = WHIRL_CENTRE;

/** How strong the whirl is at its age (0..1), from the uniform (start time, strength). */
const whirlNow = (u) => {
    const age = u.time.sub(u.whirl.x);
    return smoothstep(0.0, WHIRL.life[0], age).mul(float(1.0).sub(smoothstep(WHIRL.life[1], WHIRL.life[2], age)))
        .mul(u.whirl.y);
};

const fract1 = (v) => v - Math.floor(v);
const hashK = (k, salt) => fract1(Math.sin(k * 12.9898 + salt * 78.233) * 43758.5453);
/**
 * A ledge's line across the river: its slant and wander, and where it pours white and where the
 * water slides through a chute as a smooth tongue (two waves across the river, beating).
 */
const LEDGE_SHAPE = LEDGES.map((ledge, k) => ({
    at: S_OUTLET + ledge.at,
    drop: ledge.drop,
    slant: (hashK(k, 1) - 0.5) * 0.7,
    wander: 0.8 + hashK(k, 2) * 1.6,
    phase: k * 1.7,
    pourA: 0.16 + hashK(k, 3) * 0.2,
    pourB: 0.41 + hashK(k, 4) * 0.3,
    pourPhase: hashK(k, 5) * 6.28,
    pourBias: 0.35 + hashK(k, 6) * 0.3,
}));

/** How much a ledge pours white at nm metres from the river's middle (0 a chute … 1). */
function ledgePour(shape, nm) {
    const beat = 0.5 + 0.5 * Math.sin(nm * shape.pourA + shape.pourPhase) * Math.cos(nm * shape.pourB + shape.phase);
    return smooth(shape.pourBias - 0.12, shape.pourBias + 0.12, beat);
}

/** The s where ledge k crosses the river at nm metres from its middle. */
function ledgeAt(shape, nm) {
    return shape.at + shape.slant * nm + shape.wander * Math.sin(nm * 0.23 + shape.phase)
        + 0.5 * Math.sin(nm * 0.71 + shape.phase * 2.1);
}

/** The water's level at (s, nm) below the fall: the pool's, the rapids' ledges stepping unevenly. */
function localLevel(s, nm) {
    if (s < S_POOL) return FALL.pool;
    if (s < S_OUTLET - 4 || s > LEDGE_SHAPE[LEDGE_SHAPE.length - 1].at + 6) return levelAt(s);
    let level = FALL.pool;
    for (const shape of LEDGE_SHAPE) {
        const at = ledgeAt(shape, nm);
        level -= shape.drop * smooth(at - LEDGE_LENGTH, at + LEDGE_LENGTH, s);
    }
    return level;
}

/**
 * The jump below the ledges at (s, nm): white water where a ledge pours (0..1), the smooth
 * tongue where it slides through a chute (0..1), and the standing waves (0..1).
 */
function ledgeWater(s, nm) {
    let white = 0;
    let waves = 0;
    let glass = 0;
    for (const shape of LEDGE_SHAPE) {
        const after = s - ledgeAt(shape, nm);
        if (after < -LEDGE_LENGTH || after > 40) continue;
        const pour = ledgePour(shape, nm);
        // A chute's edges shear against the pour beside it: a seam of white.
        const seam = 4 * pour * (1 - pour);
        const k = Math.min(1, 0.35 + shape.drop);
        const jump = smooth(-LEDGE_LENGTH * 0.5, 0.8, after) * Math.exp(-Math.max(0, after - 1) / 4.5);
        white = Math.max(white, 0.85 * k * jump * Math.max(pour, seam * 0.8));
        glass = Math.max(glass, (1 - pour) * smooth(-LEDGE_LENGTH, 0, after) * Math.exp(-Math.max(0, after) / 6));
        // The chute's tongue runs into a train of standing waves; under a pour they are smaller.
        const train = smooth(-0.5, 1.8, after) * Math.exp(-Math.max(0, after) / 7);
        waves = Math.max(waves, Math.min(1, shape.drop * 1.3) * train * (0.55 + 0.45 * (1 - pour)));
    }
    return { white, waves, glass };
}

/** How far (m) the foam a source throws drifts down the river before it has thinned to a third. */
export const TRAIL = 11;

/**
 * What the water mirrors on either side: the banks' horizon is sampled square across the river at
 * these distances past the water's edge (m), the woods standing `trees` metres over the ground
 * where they close; `flat` is the horizon's slope where the ground is not known (tests); `every`
 * how far along the river (m) a measured horizon serves before it is measured again.
 */
export const MIRROR = Object.freeze({
    out: Object.freeze([0.5, 2, 4, 7, 11, 16, 23, 32, 45, 62, 85, 120, 170, 240, 340]),
    trees: 17,
    flat: 0.3,
    every: 1.5,
});

/**
 * The banks' horizon on both sides of the river at a station: for each side (+1 the river's
 * right, −1 its left), the ground and the trees' height over the water at each of MIRROR.out past
 * its edge, and how much of that height is trees.
 */
function bankProfile(baked, c, level) {
    const out = [];
    const edge = {};
    for (const side of [1, -1]) {
        const rise = [];
        const trees = [];
        for (const d of MIRROR.out) {
            const nm = side * (c.halfWidth + d);
            const x = c.x - c.tz * nm;
            const z = c.z + c.tx * nm;
            const h = groundHeight(baked, x, z);
            waterEdge(baked, x, z, edge);
            const wood = MIRROR.trees * smooth(0.1, 0.6, forestCover(x, z, edge.edge, h));
            rise.push(Math.max(0, h - level) + wood);
            trees.push(wood);
        }
        out.push({ rise, trees });
    }
    return out;
}

/**
 * The steepest rise of a bank's horizon seen square across from a point `toEdge` metres from its
 * edge (rise per metre across), and the share of that height that is trees.
 */
function bankHorizon(profile, toEdge) {
    let best = 0;
    let wood = 0;
    for (let k = 0; k < MIRROR.out.length; k++) {
        const slope = profile.rise[k] / (MIRROR.out[k] + toEdge);
        if (slope > best) {
            best = slope;
            wood = profile.rise[k] > 0 ? profile.trees[k] / profile.rise[k] : 0;
        }
    }
    return { slope: best, wood };
}

/** White water from the boulders at (s, n): the pillow upstream of each and its wake downstream. */
function boulderFoam(s, nm, hw) {
    let foam = 0;
    for (const b of BOULDERS) {
        const ds = s - b.s;
        if (ds < -b.r * 2 || ds > 26) continue;
        const dn = nm - b.n * hw;
        if (ds < 0) {
            const d = Math.hypot(ds, dn) - b.r;
            foam = Math.max(foam, Math.exp(-((d / 0.5) ** 2)) * 0.9);
        } else {
            const width = b.r * 0.9 + ds * 0.14;
            foam = Math.max(foam, Math.exp(-((dn / width) ** 2)) * Math.exp(-ds / (6 + b.r * 4)) * 0.95);
        }
    }
    return foam;
}

/**
 * The sample positions along the river for its two strips: the upper river (fine for its last
 * forty metres to the lip) and the water below the fall (fine through the pool, finer down the
 * rapids than on down the valley).
 */
export function riverStations(detail = 1) {
    const k = 1 / Math.max(0.25, detail);
    const upper = [];
    let s = Math.max(0, S_LIP - UPSTREAM);
    while (s < S_LIP + LIP_OVER) {
        upper.push(s);
        s += s < S_LIP - 40 ? 3 * k : 0.4 * k;
    }
    upper.push(S_LIP + LIP_OVER);
    const lower = [];
    const to = RIVER.length - 1;
    s = S_LIP - UNDER;
    while (s < to) {
        lower.push(s);
        if (s < S_LIP + 40) s += 0.3 * k;
        else if (s <= S_OUTLET + 330) s += 0.5 * k;
        else s += 4 * k;
    }
    lower.push(to);
    return { upper, lower };
}

/**
 * Build the ribbon. `cols` vertices across, `detail` the density along; `baked` the valley's
 * ground, from which the banks' horizon the water mirrors is measured (without it, a flat bank).
 */
export function createRiverGeometry({ cols = 40, detail = 1, baked = null } = {}) {
    const { upper, lower } = riverStations(detail);
    const across = cols + 1;
    const count = (upper.length + lower.length) * across;
    const position = new Float32Array(count * 3);
    const river = new Float32Array(count * 4);
    const flow = new Float32Array(count * 4);
    const extra = new Float32Array(count * 4);
    const horizon = new Float32Array(count * 4);
    const dir = new Float32Array(count * 2);
    const c = {};
    const lip = {};
    const index = [];
    let row0 = 0;
    const strip = (stations, isUpper) => {
        // The foam each column carries down the river from its sources (advected row by row).
        const trail = new Float32Array(across);
        // The banks' horizon, measured again only every MIRROR.every metres along (it hardly moves
        // between the fine stations through the pool and the rapids).
        let sides = null;
        let measuredAt = -Infinity;
        for (let r = 0; r < stations.length; r++) {
            const s = stations[r];
            courseAt(s, c);
            const hw = c.halfWidth;
            const speed = speedAt(s);
            const turb = turbulenceAt(s);
            const ds = r > 0 ? s - stations[r - 1] : 0;
            if (baked && s - measuredAt >= MIRROR.every) {
                sides = bankProfile(baked, c, isUpper ? levelAt(Math.min(s, S_LIP)) : localLevel(s, 0));
                measuredAt = s;
            }
            for (let k = 0; k < across; k++) {
                const nn = (k / cols) * 2 - 1;
                const nm = nn * TUCK * hw;
                const o = (row0 + r) * across + k;
                const edge = Math.abs(nm) / hw;
                let x = c.x - c.tz * nm;
                let z = c.z + c.tx * nm;
                let y;
                let brink = 0;
                let { tx, tz } = c;
                if (isUpper) {
                    // Each column stops at its own lip, the water drawing down as it quickens over it.
                    const lipX = lipAlong(nm);
                    const along = s - S_LIP;
                    if (along > lipX) {
                        courseAt(S_LIP + lipX, lip);
                        x = lip.x - lip.tz * nm;
                        z = lip.z + lip.tx * nm;
                        ({ tx, tz } = lip);
                    }
                    brink = smooth(lipX - 3, lipX, along);
                    y = levelAt(Math.min(s, S_LIP)) - drawdown(nm) * brink;
                    brink *= smooth(0.02, 0.2, lipDepth(nm));
                } else {
                    y = localLevel(s, nm);
                }
                const lw = isUpper ? { white: 0, waves: 0, glass: 0 } : ledgeWater(s, nm);
                // Water piles a little toward mid-stream over the waves; it tucks under at the banks.
                position[o * 3] = x;
                position[o * 3 + 1] = y + 0.06 * lw.waves * (1 - edge * edge) - 0.25 * Math.max(0, edge - 1);
                position[o * 3 + 2] = z;
                const hNext = isUpper ? 0 : localLevel(s + 0.3, nm) - localLevel(s - 0.3, nm);
                river[o * 4] = s;
                river[o * 4 + 1] = nm;
                river[o * 4 + 2] = hw;
                river[o * 4 + 3] = hNext / 0.6;
                // White water: the boil where the fall's tongues land, the ledges' jumps, the banks'
                // eddy lines, the boulders', a little everywhere the rapids run.
                const boil = !isUpper && s < S_LIP + 60 ? poolBoil(s - S_LIP, nm) : 0;
                const bank = smooth(0.78, 1.0, edge) * Math.min(1, (turb + lw.white + boil * 0.5) * 1.6) * 0.4;
                const poured = lw.white * (0.7 + 0.3 * (1 - edge * edge));
                const white = clampJs(Math.max(boil, poured, bank, boulderFoam(s, nm, hw), turb * 0.22), 0, 1);
                // Foam drifts on below its source, thinning.
                trail[k] = Math.max(white * 0.75, trail[k] * Math.exp(-ds / TRAIL));
                flow[o * 4] = isUpper ? speed * (1 + 1.4 * brink) : speed;
                flow[o * 4 + 1] = white;
                flow[o * 4 + 2] = lw.waves * WAVE.height * (1 - Math.min(1, edge) ** 2);
                flow[o * 4 + 3] = 0;
                extra[o * 4] = trail[k] * (1 - smooth(0.9, 1.08, edge));
                extra[o * 4 + 1] = 1;
                extra[o * 4 + 2] = 0;
                // Smooth, dark water: a chute's tongue, and the river quickening over the brink.
                extra[o * 4 + 3] = Math.max(lw.glass, brink * 0.9) * (1 - smooth(0.7, 1.0, edge));
                if (sides) {
                    const right = bankHorizon(sides[0], Math.max(0.5, hw - nm));
                    const left = bankHorizon(sides[1], Math.max(0.5, hw + nm));
                    horizon[o * 4] = right.slope;
                    horizon[o * 4 + 1] = left.slope;
                    horizon[o * 4 + 2] = right.wood;
                    horizon[o * 4 + 3] = left.wood;
                } else {
                    horizon[o * 4] = MIRROR.flat;
                    horizon[o * 4 + 1] = MIRROR.flat;
                    horizon[o * 4 + 2] = 0.6;
                    horizon[o * 4 + 3] = 0.6;
                }
                dir[o * 2] = tx;
                dir[o * 2 + 1] = tz;
            }
        }
        for (let r = 0; r < stations.length - 1; r++) {
            for (let k = 0; k < cols; k++) {
                const a = (row0 + r) * across + k;
                const b = a + 1;
                const cc = a + across;
                const d = cc + 1;
                index.push(a, d, b, a, cc, d);
            }
        }
        row0 += stations.length;
    };
    strip(upper, true);
    strip(lower, false);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('aRiver', new THREE.BufferAttribute(river, 4));
    geometry.setAttribute('aFlow', new THREE.BufferAttribute(flow, 4));
    geometry.setAttribute('aExtra', new THREE.BufferAttribute(extra, 4));
    geometry.setAttribute('aBank', new THREE.BufferAttribute(horizon, 4));
    geometry.setAttribute('aDir', new THREE.BufferAttribute(dir, 2));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(index), 1));
    geometry.computeBoundingSphere();
    return {
        geometry, triangles: index.length / 3, rows: upper.length + lower.length, cols,
    };
}

// Linear colours.
const DEEP = [0.005, 0.014, 0.011];
const SHALLOW = [0.024, 0.02, 0.009];
const FOAM = [0.8, 0.83, 0.84];
const GLASS = [0.05, 0.042, 0.016];
const BANKS = [0.018, 0.034, 0.02];
const MILKY = [0.15, 0.19, 0.18];
const TURF = [0.05, 0.08, 0.03];
const FELLS = [0.035, 0.05, 0.04];
const STEP_ROCK = [0.035, 0.037, 0.04];
/** The fells' ridge down the valley as the mirror meets it: its slope over the level, and its range. */
const MIRROR_FELLS = Object.freeze({ top: 0.11, range: 0.06 });

export function createRiverMaterial(u, tex) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'SpringRiver';
    material.fog = false;
    material.side = THREE.DoubleSide;
    const aRiver = attribute('aRiver', 'vec4');
    const aFlow = attribute('aFlow', 'vec4');
    const aExtra = attribute('aExtra', 'vec4');
    const aDir = attribute('aDir', 'vec2');
    const vRiver = varying(vec4(0.0), 'spRiver');
    const vFlow = varying(vec4(0.0), 'spFlow');
    const vExtra = varying(vec4(0.0), 'spRiverExtra');
    const vBank = varying(attribute('aBank', 'vec4'), 'spRiverBank');
    const vDir = varying(vec2(0.0, -1.0), 'spRiverDir');
    // Standing-wave slope along; a surge's breaking front; the foam it leaves drawn out behind.
    const vWave = varying(vec3(0.0), 'spRiverWave');

    material.positionNode = Fn(() => {
        const s = aRiver.x;
        // Standing waves below the ledges, stationary in the world; they heave a little.
        const phase = s.mul((2 * Math.PI) / WAVE.length).add(aRiver.y.mul(0.35));
        const heave = sin(u.time.mul(1.7).add(s.mul(0.31))).mul(0.18).add(1.0);
        const amp = aFlow.z.mul(heave).mul(u.foamBoost.mul(0.5).add(1.0));
        const wave = amp.mul(sin(phase)).add(amp.mul(0.4).mul(sin(phase.mul(1.7).add(aRiver.y.mul(0.9)))));
        const waveSlope = amp.mul(cos(phase)).mul((2 * Math.PI) / WAVE.length);
        // Surges: each clear sends a hump of water down the rapids from the pool. Its leading
        // slope breaks white in a ragged line across the river (a bore), and behind it the water
        // runs streaked with the foam it threw, thinning. Surges close behind each other do not
        // add their white: each point is as white as the strongest surge over it.
        const surge = float(0.0).toVar();
        const bore = float(0.0).toVar();
        const wake = float(0.0).toVar();
        // A surge rises out of the pool over its first metres: cut off where the surges start, a
        // young one's long back stood across the pool as a white step.
        const rising = smoothstep(S_POOL, S_POOL + 9, s);
        for (let k = 0; k < SURGES; k++) {
            const row = u.events.element(EVENT_ROWS.surge + k);
            const age = u.time.sub(row.x);
            const front = float(S_POOL).add(age.mul(SURGE.speed));
            // Metres ahead of the surge's middle: a long back, a steep front (seen from the knoll
            // the river lies nearly edge-on, and only a steep face stands up out of it). The front
            // is not a straight line across: it leads in mid-stream, where the water runs fastest,
            // and wanders, each surge its own way.
            const across = aRiver.y.div(aRiver.z.max(1.0));
            const wander = sin(aRiver.y.mul(0.31).add(k * 1.7)).mul(1.3)
                .add(sin(aRiver.y.mul(0.83).add(k * 2.9)).mul(0.6))
                .add(float(1.0).sub(across.mul(across)).mul(1.6));
            const x = s.sub(front).sub(wander);
            const live = age.greaterThan(0.0).and(age.lessThan(60.0)).and(s.greaterThan(S_POOL));
            const fade = exp(age.mul(-0.05));
            const span = select(x.greaterThan(0.0), float(SURGE.front), float(SURGE.length));
            const hump = exp(x.div(span).pow2().negate()).mul(row.y).mul(fade);
            surge.addAssign(select(live, hump, float(0.0)));
            // The face and its crest, breaking white.
            const face = exp(x.sub(SURGE.front * 0.4).div(SURGE.front * 0.9).pow2().negate()).mul(row.y).mul(fade);
            bore.assign(max(bore, select(live, face, float(0.0))));
            const behind = smoothstep(1.0, -12.0, x).mul(exp(age.mul(-0.4))).mul(row.y);
            wake.assign(max(wake, select(live, behind, float(0.0))));
        }
        vRiver.assign(aRiver);
        vFlow.assign(aFlow);
        vExtra.assign(aExtra);
        vDir.assign(aDir);
        // (Its white rises with it: no line across the water where the surges start.)
        vWave.assign(vec3(waveSlope, bore.min(1.0).mul(rising), wake.min(1.0).mul(rising)));
        // A T-spin's whirl: the pool's surface sinks toward the vortex's eye.
        const wd = positionLocal.xz.sub(vec2(WHIRL_CENTRE.x, WHIRL_CENTRE.z));
        const dip = exp(dot(wd, wd).div(-(WHIRL.radius * WHIRL.radius) * 0.35)).mul(whirlNow(u)).mul(WHIRL.dip);
        // The flood lifts the whole river.
        return positionLocal.add(vec3(0.0, u.flood.add(wave).add(surge.mul(SURGE.height).mul(rising)).sub(dip), 0.0));
    })();

    material.colorNode = Fn(() => {
        const P = positionWorld.toVar();
        const s = vRiver.x;
        const nm = vRiver.y;
        const hw = vRiver.z;
        const slopeAlong = vRiver.w;
        const speed = vFlow.x;
        const t = normalize(vec3(vDir.x, 0.0, vDir.y)).toVar();
        const r = vec3(t.z.negate(), 0.0, t.x);
        const up = vec3(0.0, 1.0, 0.0);
        const V = normalize(P.sub(u.eye)).toVar();
        const L = u.sunDir;
        const sunLight = u.sun.mul(u.sunUp);

        // ── The flow map: two copies of the moving water, half a period apart ──
        const PERIOD = 2.4;
        const tau = u.flowClock.div(PERIOD);
        const p0 = fract(tau);
        const p1 = fract(tau.add(0.5));
        const w0 = float(1.0).sub(abs(p0.mul(2.0).sub(1.0)));
        const off0 = speed.mul(PERIOD).mul(p0.sub(0.5));
        const off1 = speed.mul(PERIOD).mul(p1.sub(0.5));
        const stretch = speed.mul(0.22).add(1.0);
        // Each read is rotated and scaled out of step with the others, so the noise tile's
        // lattice never lines up into a visible grid.
        const rot = (v, c, sn) => vec2(v.x.mul(c).sub(v.y.mul(sn)), v.x.mul(sn).add(v.y.mul(c)));
        const flowAt = (off) => vec2(s.sub(off).div(stretch), nm);
        // Churn: foam lumps at three scales (~0.5 m, ~0.3 m, ~0.15 m).
        const churnAt = (off, seed) => {
            const p = flowAt(off);
            const a = texture(tex.noise, rot(p, 0.83, 0.56).div(3.7).add(seed)).r;
            const b = texture(tex.noise, rot(p, 0.31, -0.95).div(4.3).add(seed.yx)).g;
            const c = texture(tex.noise, rot(p, -0.66, 0.75).div(5.9).add(seed.mul(1.7))).b;
            return a.mul(0.5).add(b.mul(0.3)).add(c.mul(0.2));
        };
        // Rafts and patches a metre or more across, drawn out down the flow: what the white water
        // keeps of its structure when the fine churn is too small to see.
        const raftAt = (off, seed) => {
            const p = flowAt(off);
            return texture(tex.noise, rot(vec2(p.x.div(2.2), p.y), 0.94, 0.33).div(18.0).add(seed)).g.mul(0.6)
                .add(texture(tex.noise, rot(vec2(p.x.div(2.0), p.y), -0.29, 0.96).div(30.0).add(seed.yx)).r.mul(0.4));
        };
        const big = mix(raftAt(off1, vec2(0.83, 0.47)), raftAt(off0, vec2(0.29, 0.91)), w0);
        // Streaks: long thin lines of foam drifting on the calmer water.
        const streakAt = (off, seed) => {
            const p = flowAt(off);
            return texture(tex.noise, vec2(p.x.div(23.0), p.y.div(1.9)).add(seed)).g.mul(0.6)
                .add(texture(tex.noise, rot(vec2(p.x.div(13.0), p.y.div(1.3)), 0.97, 0.24).add(seed.yx)).r.mul(0.4));
        };
        const streak = mix(streakAt(off1, vec2(0.21, 0.83)), streakAt(off0, vec2(0.55, 0.12)), w0).toVar();
        // The heap: fine churn and metre-scale rafts; where the water is torn right through, its
        // dark lanes run with the flow (the streaks), not in blotches.
        const whiteIn = clamp(vFlow.y.mul(u.foamBoost.mul(0.25).add(1.0)), 0.0, 1.0);
        const torn = smoothstep(0.45, 0.9, whiteIn);
        const coarse = mix(big, streak, torn.mul(0.7));
        // Far off the fine churn averages out through the mips and only the rafts would be left to
        // draw the foam's edge, in blotches: there their share falls and the edge softens. In
        // water torn right through the holes are the churn's own, never raft-sized.
        const far = smoothstep(50.0, 130.0, length(P.sub(u.eye))).toVar();
        // (A small share: seen from the knoll the rafts foreshorten into horizontal blots.)
        const coarseShare = mix(float(0.2), float(0.06), torn).mul(float(1.0).sub(far.mul(0.65)));
        const churn = mix(churnAt(off1, vec2(0.37, 0.61)), churnAt(off0, vec2(0.11, 0.23)), w0).toVar();
        const heap = churn.mul(float(1.0).sub(coarseShare)).add(coarse.mul(coarseShare)).toVar();
        // Ripples: finer reads, as surface slopes.
        const ripAt = (off, seed) => {
            const p = flowAt(off);
            const a = texture(tex.noise, rot(p, 0.91, 0.41).div(2.9).add(seed));
            const b = texture(tex.noise, rot(p, -0.42, 0.91).div(4.1).add(seed.yx));
            return vec2(a.r.mul(0.6).add(b.g.mul(0.4)), a.g.mul(0.6).add(b.r.mul(0.4)));
        };
        const rip = mix(ripAt(off1, vec2(0.71, 0.05)), ripAt(off0, vec2(0.13, 0.29)), w0).toVar();

        // ── How white the water runs here. The flood whitens the white water further (it never
        // lays white over calm water: that read as blotches) and draws foam out in lines over all
        // of it; a surge's wake adds its own lines ──
        const white = clamp(vFlow.y.mul(u.foamBoost.mul(0.25).add(1.0)), 0.0, 1.0).toVar();
        const trail = clamp(vExtra.x.add(u.foamBoost.mul(0.35)).add(vWave.z.mul(0.7)), 0.0, 1.0).toVar();
        const glass = vExtra.w.toVar();
        // The churn: white where the water is torn, its edge lacy and soft. The threshold widens
        // by the heap's own change across the pixel: seen at a grazing angle a pixel spans metres
        // of water along the flow, and the foam there is its mean, not hard tiles of white.
        const threshold = float(1.0).sub(white.mul(0.8));
        const aaHeap = fwidth(heap).mul(1.5).add(far.mul(0.1));
        const cover = smoothstep(threshold.sub(0.04).sub(aaHeap), threshold.add(0.24).add(aaHeap), heap);
        const edgeLace = smoothstep(threshold.sub(0.07), threshold, heap).mul(float(1.0).sub(cover))
            .mul(white).mul(0.5);
        const churned = clamp(cover.add(edgeLace), 0.0, 1.0);
        // The trail: the foam a pour throws drifting on in lines and rafts, thinning downstream.
        // (Their edges widen by their own footprint, and the churn breaks them into lace: hard
        // lines foreshortened toward the eye read as brush strokes.)
        const lineAt = float(0.8).sub(trail.mul(0.3));
        const aaStreak = fwidth(streak).mul(1.5);
        const lace = smoothstep(0.28, 0.62, churn);
        const lines = smoothstep(lineAt.sub(aaStreak), lineAt.add(0.09).add(aaStreak), streak)
            .mul(smoothstep(0.05, 0.4, trail)).mul(lace.mul(0.85).add(0.15));
        const raftFrom = float(0.95).sub(trail.mul(0.22)).sub(aaHeap);
        const rafts = smoothstep(raftFrom, float(1.02).sub(trail.mul(0.2)).add(aaHeap), heap)
            .mul(trail).mul(0.6).mul(lace.mul(0.6).add(0.4));
        // Breaking crests on the standing waves.
        const crest = smoothstep(0.35, 0.9, vWave.x.mul(1.6)).mul(smoothstep(0.08, 0.3, vFlow.z));
        // A surge's front: a ragged line of white rolling across the river, broken by the churn
        // into heaps and gaps (a solid band read as a painted stripe).
        const ragged = vWave.y.mul(1.15).add(churn.sub(0.5).mul(1.5)).add(streak.sub(0.5).mul(0.6));
        const boreFoam = smoothstep(0.42, 0.72, ragged);
        // ── A T-spin's whirl: arms of foam winding in to a dark eye ──
        const wv = P.xz.sub(vec2(WHIRL_CENTRE.x, WHIRL_CENTRE.z));
        const wr = length(wv).toVar();
        const wk = whirlNow(u).mul(exp(wr.div(-WHIRL.radius))).toVar();
        const arms = sin(atan(wv.y, wv.x).mul(4.0).add(wr.mul(0.7)).sub(u.time.mul(3.2)));
        const spiral = smoothstep(0.55, 0.92, arms.mul(0.5).add(0.5).add(heap.sub(0.5).mul(0.35))).mul(wk);
        const eye = smoothstep(2.2, 0.4, wr).mul(wk);
        const settled = max(max(churned, max(lines, rafts)), max(crest.mul(0.75), boreFoam));
        const foam = clamp(mix(settled, spiral, clamp(wk.mul(1.6), 0.0, 1.0)).mul(float(1.0).sub(eye)), 0.0, 1.0)
            .mul(float(1.0).sub(glass.mul(0.85))).toVar();

        // ── The surface's normal ──
        const rough = white.mul(0.9).add(0.15).mul(float(1.0).sub(glass.mul(0.75)));
        const dAlong = rip.x.sub(0.5).mul(rough).sub(slopeAlong).add(vWave.x);
        const dAcross = rip.y.sub(0.5).mul(rough);
        const N = normalize(up.add(t.mul(dAlong.negate())).add(r.mul(dAcross.negate()))).toVar();

        // ── The water between the foam ──
        const cosV = clamp(dot(N, V.negate()), 0.0, 1.0);
        const m = float(1.0).sub(cosV);
        const m2 = m.mul(m);
        // (Torn water is rough and full of air: it hardly mirrors anything.)
        const fresnel = float(0.02).add(m2.mul(m2).mul(m).mul(0.98)).mul(float(1.0).sub(white.mul(0.95)));
        const R = V.sub(N.mul(dot(V, N).mul(2.0))).toVar();
        // Rough water mirrors a blur of many directions: the sky is read along a calmer normal,
        // and paler.
        const Ns = normalize(mix(N, up, rough.mul(0.6).add(0.2)));
        const Rs = V.sub(Ns.mul(dot(V, Ns).mul(2.0)));
        const skyR = skyColour(u, vec3(Rs.x, abs(Rs.y), Rs.z), { withSun: false });
        const sky = mix(skyR, vec3(spLuma(skyR)).mul(vec3(0.92, 0.97, 1.05)), rough.mul(0.5).add(0.15));
        const mirror = sky.toVar();
        // What stands over the water, in the mirror. The ray is read between the calm normal and
        // the rippled one, so the ripples break the reflection's edges; rough water mirrors only
        // a blur of what stands over it.
        const Rm = normalize(mix(R, Rs, rough.mul(0.4).add(0.5))).toVar();
        const blur = rough.mul(rough).mul(0.5);
        const ra = dot(Rm, r);
        const rt = dot(Rm, t);
        // Down the valley it meets the fells under the haze, their ridge rising and falling.
        const bearing = atan(Rm.x, Rm.z.negate());
        const ridge = texture(tex.noise, vec2(bearing.mul(1.3), 0.41)).g.mul(0.6)
            .add(texture(tex.noise, vec2(bearing.mul(5.1), 0.83)).r.mul(0.4));
        const fellTop = float(MIRROR_FELLS.top).add(ridge.sub(0.5).mul(MIRROR_FELLS.range));
        const tanUp = Rm.y.div(length(Rm.xz).max(1e-3));
        const aaFell = fwidth(tanUp).min(0.05).add(0.002).add(blur.mul(0.06));
        const onFells = smoothstep(fellTop.add(aaFell), fellTop.sub(aaFell), tanUp);
        const fells = mix(vec3(...FELLS).mul(sunLight.mul(0.5).add(u.fill.mul(1.6))), u.haze, 0.62);
        mirror.assign(mix(mirror, fells, onFells));
        // Either side, the banks: each one's horizon seen square across (the steepest rise of its
        // ground and trees, baked per vertex), met where the ray crosses toward that bank. Along
        // the bank the crowns of its woods rise and fall.
        const toRight = ra.greaterThan(0.0);
        const toEdge = select(toRight, hw.sub(nm), hw.add(nm)).max(0.5).toVar();
        const crossing = abs(ra).max(0.002).toVar();
        const climb = Rm.y.div(crossing).min(4.0).toVar();
        const wood = select(toRight, vBank.z, vBank.w).toVar();
        const sHit = s.add(clamp(rt.mul(toEdge.add(10.0)).div(crossing), -3000.0, 3000.0));
        const crowns = texture(tex.noise, vec2(sHit.div(9.0), select(toRight, float(0.27), float(0.73)))).r.mul(0.6)
            .add(texture(tex.noise, vec2(sHit.div(2.6), select(toRight, float(0.61), float(0.11)))).g.mul(0.4));
        const top = select(toRight, vBank.x, vBank.y).mul(float(1.0).add(crowns.sub(0.5).mul(wood).mul(0.8))).toVar();
        const aaBank = fwidth(climb).min(top.mul(0.5)).add(0.004).add(top.mul(blur));
        const onBank = smoothstep(top.add(aaBank), top.sub(aaBank), climb).toVar();
        // Its turf low down, its woods over it (their share of its height). The mirror sees the
        // bank from under its brow: its face, in the shade of its own grass.
        const height = clamp(climb.div(top.max(1e-3)), 0.0, 1.0);
        const turf = vec3(...TURF).mul(sunLight.mul(0.2).add(u.fill.mul(1.1)));
        const woods = vec3(...BANKS).mul(sunLight.mul(0.35).add(u.fill.mul(1.4)));
        const bankCol = mix(turf, woods, smoothstep(float(0.92).sub(wood), float(1.08).sub(wood), height))
            .add(u.haze.mul(0.08));
        mirror.assign(mix(mirror, bankCol, onBank));
        // In the pool and the rapids below it, a ray running back up the river meets the step:
        // the fall's white water between shoulders of dark rock.
        const back = rt.negate().max(0.002);
        const reach = s.sub(S_LIP).max(0.0).div(back).min(4000.0)
            .toVar();
        const atStep = abs(nm.add(ra.mul(reach)));
        const stepTop = float(LIP_Y - POOL_Y + 1.5).add(smoothstep(SHEET.to, SHEET.to + 6, atStep).mul(3.0));
        const onStep = smoothstep(stepTop.add(0.8), stepTop.sub(0.8), Rm.y.mul(reach))
            .mul(smoothstep(FACE.to, FACE.to - 4, atStep))
            .mul(smoothstep(S_LIP, S_LIP + 3, s)).mul(smoothstep(S_POOL + 70, S_POOL + 40, s))
            .mul(step(rt, 0.0));
        const fallFoam = vec3(...FOAM).mul(u.fill.mul(1.25).add(sunLight.mul(0.3)).add(u.bounce.mul(0.3)));
        const stepRock = vec3(...STEP_ROCK).mul(u.fill.mul(1.3).add(sunLight.mul(0.12)));
        const stepCol = mix(stepRock, fallFoam, smoothstep(SHEET.to + 0.5, SHEET.to - 2.5, atStep).mul(0.85));
        // The step stands in front of the banks only where the ray reaches it first.
        const stepFirst = reach.lessThan(toEdge.div(crossing));
        mirror.assign(mix(mirror, stepCol, select(stepFirst, onStep, onStep.mul(float(1.0).sub(onBank)))));
        const depth = float(1.0).sub(smoothstep(0.6, 1.0, abs(nm).div(hw)));
        const body = mix(vec3(...SHALLOW), vec3(...DEEP), depth).mul(u.fill.mul(2.2).add(sunLight.mul(0.06))).toVar();
        // Over a chute the water is thin and clear: the peat's amber shows, lit through.
        body.assign(mix(body, vec3(...GLASS).mul(u.fill.mul(2.0).add(sunLight.mul(0.14))), glass.mul(0.8)));
        // Torn water is full of air: milky between the foam, not dark (except in a whirl's
        // spiral, which draws the dark water in to its eye).
        const milky = vec3(...MILKY).mul(u.fill.mul(1.7).add(sunLight.mul(0.1)));
        const spun = clamp(wk.mul(1.6), 0.0, 1.0);
        body.assign(mix(body, milky, white.mul(0.75).mul(float(1.0).sub(spun))));
        body.mulAssign(float(1.0).sub(eye.mul(0.6)));
        const water = mix(body, mirror, fresnel).toVar();
        const glint = max(dot(R, L), 0.0);
        const g4 = glint.mul(glint).mul(glint).mul(glint);
        const g16 = g4.mul(g4).mul(g4).mul(g4);
        water.addAssign(sunLight.mul(g16.mul(g16).mul(1.6).add(g16.mul(0.08))).mul(float(1.0).sub(white.mul(0.7))));
        // Back-to-back: the river glitters, every ripple facing the sun throwing a spark.
        const spark = smoothstep(0.86, 0.97, rip.x.mul(0.55).add(heap.mul(0.45))).mul(g4.mul(0.7).add(0.3));
        water.addAssign(sunLight.mul(0.2).add(u.fill.mul(1.5)).mul(spark).mul(u.glory)
            .mul(1.4));

        // ── Foam: a heap lit by the sun, shaded in its own hollows ──
        const hx = rip.x.sub(0.5);
        const hz = rip.y.sub(0.5);
        const Nf = normalize(N.add(t.mul(hx.mul(1.4))).add(r.mul(hz.mul(1.4))));
        // Foam scatters light through itself: a wide wrap, and the whole sky over it.
        const lit = clamp(dot(Nf, L).add(0.6).div(1.6), 0.0, 1.0);
        // Its hollows are the fine churn's and the flow's streaks', never the metre-wide rafts' (a
        // white mass shaded by those reads as floating ice).
        const hollow = mix(float(0.6), float(1.0), smoothstep(0.25, 0.75, churn.mul(0.65).add(streak.mul(0.35))));
        const behind = clamp(dot(V, L), 0.0, 1.0);
        const foamLight = sunLight.mul(lit.mul(0.42).add(0.1)).add(u.fill.mul(1.2)).add(u.bounce.mul(0.3));
        const foamCol = vec3(...FOAM).mul(foamLight).mul(hollow).add(sunLight.mul(behind.mul(behind).mul(0.1)));
        // Behind the curtain, under the recess the main tongue has worn, the boil lies in the
        // curtain's shadow: lit white, the ribbon's straight back edge read as a hard line once
        // the flood had lifted it over the spray.
        const recess = mix(float(0.4), float(1.0), smoothstep(S_LIP + 1.0, S_LIP + 6.5, s));
        const col = mix(water, foamCol, foam.mul(recess.mul(0.5).add(0.5))).mul(recess);
        return vec4(aerial(u, P, col), 1.0);
    })();
    return material;
}

export function createRiver(u, tex, tier, baked = null) {
    const { geometry, triangles } = createRiverGeometry({
        cols: tier.riverCols ?? 40, detail: tier.riverDetail ?? 1, baked,
    });
    const material = createRiverMaterial(u, tex);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'SpringRiver';
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    return {
        mesh,
        meshes: [mesh],
        triangles,
        update() {},
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
