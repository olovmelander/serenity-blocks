/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * CHAPTER 2'S FISH (item 3, Blender hulls 2026-11-01): four SCHOOLS on ribbon paths in the deep
 * ocean climb, countershaded and flashing, one draw.
 *
 * an underwater game's documented technique, ported to TSL: instanced static meshes animated ENTIRELY in the
 * vertex stage with waves — no skeletons, no CPU skinning, vertex-ALU only.
 *
 * WAS (until 2026-10): 110 copies of one hull each circling its OWN seed point, shaded near-black,
 * and ~3/7 of them seeded from rail samples inside the Earth Core shaft (below the seabed, so
 * early-Z'd invisible). The water column read as empty with a few dark slivers.
 * THEN: 150 instances in ONE draw, organised into SCHOOLS. Each school follows a fixed ribbon (a
 * gently undulating ellipse in open water around the ascent), and every fish keeps a fixed offset
 * inside it — along, across and above the ribbon — so the school moves as one body with a living
 * edge, the SCHOOL_LANES grammar of the ocean theme without a single CPU update. The ascent camera
 * looks almost straight UP (dirY ~0.99 for most of ch2), so the rail rising through the middle of
 * a circling ring is the shot: a ring of fish wheeling overhead, then around you.
 * NOW (2026-11-01): the hull is no longer an 11-triangle code-built sliver but two fish modelled in
 * Blender (scripts/blender/odyssey/odyssey_fish.py -> odyssey-fish-hulls.js): a schooling JACK for
 * the three schools and a TUNA for the cruisers, with real (smooth) normals that bend with the
 * swim. Both hulls ride in ONE geometry and the one draw: each instance keeps the hull its school
 * names and folds the other to a point (zero-area triangles draw nothing), so there is still one
 * pipeline, built with the world (no new pipeline mid-journey).
 *
 * THE SWIM is the body wave of a real fish: a travelling wave that starts at mid-body and grows
 * toward the tail, the tail fin sweeping widest, and the head yawing gently the opposite way (the
 * recoil about a pivot a quarter back). Jacks beat in a carangiform wave about a body length long;
 * the tuna's body stays stiff and the beat lives at its narrow tail stock and sickle tail
 * (thunniform), slower. The fins' trailing edges lag a little behind. The normal is bent by the
 * same wave (the wave's slope), so the light slides along the flank as the body flexes.
 *
 * THE SCHOOL MOVES AS ONE (2026-11-03, docs/ODYSSEY_SEA_MOTION_2026-11.md). Each fish used to sway its
 * heading ±14 degrees on its own clock while its body kept sliding along the ribbon, so it swam up to
 * 50 degrees sideways to the way it went, and a third of the fish passed through a neighbour. Now:
 *   - a fish points where it goes: its heading is the true direction of its motion (the analytic
 *     velocity of its path), never a sway laid on top;
 *   - the school FOLLOWS ITS LEADERS: its meander, its rise and fall and its surge of pace are laid
 *     out along the ring, so every fish behind swims the path the one ahead swam a moment before. A
 *     turn runs back through the school as a wave, and the flank flash ripples with it;
 *   - each fish keeps its place: the rest places are spread apart (a relaxation at build time) so no
 *     two bodies meet, and a small swerve of its own keeps neighbours out of lock-step;
 *   - the tail beat follows the pace (the beat's phase is the distance swum, so it never jumps),
 *     and the body bends into the curve it swims (a C toward the inside), leaning into it.
 * `fishPoseAt` is the CPU twin of the vertex stage (the tests read it).
 *
 * Shading is COUNTERSHADING, the way real pelagic fish are coloured: dark back, silver belly — and
 * a FLANK FLASH: the flank is a mirror, so when a fish's yaw wobble turns it to reflect the bright
 * surface into the eye it flares, the signature glint of a school turning. Three tint families:
 * silver sardines and teal (the cool body of the chapter) and one small warm-gold school near the
 * light as the complementary accent; the cruisers are slate blue.
 *
 * THE SEA'S RULES: behind chapter 1's steam (`behindSteamDepth`); after the breach seen through the
 * surface at the share the surface and the path leave it (`throughSurfaceNode`), drawn just after
 * the sea (renderOrder 2 > the sea's 1) and kept drawn while any school still shows
 * (`seenFromAbove`). Under the water nothing of that changes a pixel.
 */
import * as THREE from 'three/webgpu';
import {
    abs,
    attribute,
    cameraPosition as cameraPositionNode,
    clamp,
    cos,
    cross,
    dot,
    faceDirection,
    float,
    floor,
    fwidth,
    length,
    max,
    mix,
    normalGeometry,
    normalize,
    positionGeometry,
    positionWorld as positionWorldNode,
    reflect,
    sign,
    sin,
    smoothstep,
    step,
    varying,
    vec3,
    vec4,
} from 'three/tsl';
import { ODYSSEY_FISH_HULLS } from './odyssey-fish-hulls.js';
import { behindSteamDepth } from '../composition/odyssey-steam-quench.js';
import { throughSurfaceNode, throughSurfaceShare } from '../composition/odyssey-through-surface.js';

/**
 * The schools. f: fraction along the open-water span; dy: ring centre above that rail point;
 * rx/rz: ring radii; omega: angular speed (rad/s, sign = handedness); bob: vertical undulation;
 * spread: [along, across, vertical] half-extents in metres; scale: hull multipliers; tint: the
 * school's body colour (authored past the grade, like every palette here); hull: which fish.
 * RADII ARE SET BY THE CAMERA, not by taste: the ascent looks straight up through a ~30 degree
 * half-field, so a ring reads overhead only while it sits ~1.7x its radius above the eye. Rings
 * of 22-34 u stacked ~50 u apart keep one wheeling in frame for most of the climb; the cruisers
 * range wider and lower.
 * SIZES ARE SET BY THE WHALES (2026-10-22): at 1.3-2 u (a sardine against a 58 u whale) a school
 * ~50 u up drew as faint specks in the live journey. Fish are 2.9-4.4 u (jacks, ~1 m at the
 * whales' ~4 u/m) and the cruisers 6-9 u (tuna), with more of them in schools spread to match, so
 * a school reads as fish wheeling overhead.
 */
export const FISH_SCHOOLS = Object.freeze([
    {
        count: 48,
        f: 0.30,
        dy: 55,
        rx: 26,
        rz: 22,
        omega: 0.085,
        bob: 4,
        spread: [20, 5.6, 3.5],
        scale: [0.66, 0.88],
        tint: [0.66, 0.78, 0.84],
        hull: 'school',
    },
    {
        count: 42,
        f: 0.55,
        dy: 50,
        rx: 30,
        rz: 24,
        omega: -0.065,
        bob: 6,
        spread: [22, 7.0, 4.2],
        scale: [0.75, 1.0],
        tint: [0.24, 0.66, 0.70],
        hull: 'school',
    },
    {
        count: 40,
        f: 0.84,
        dy: 14,
        rx: 34,
        rz: 42,
        omega: 0.060,
        bob: 3,
        spread: [22, 7.0, 4.2],
        scale: [0.66, 0.92],
        tint: [0.86, 0.72, 0.38],
        hull: 'school',
    },
    {
        count: 20,
        f: 0.40,
        dy: 30,
        rx: 62,
        rz: 52,
        omega: -0.030,
        bob: 10,
        spread: [60, 22, 18],
        scale: [1.35, 2.0],
        tint: [0.34, 0.50, 0.64],
        hull: 'cruiser',
    },
]);

export const FISH_COUNT = FISH_SCHOOLS.reduce((n, s) => n + s.count, 0);

/**
 * The schools' look pushed for visibility (2026-11-03): how far the belly goes toward silver and
 * how bright it is, and the tuna's yellow fins (linear, past the grade like the tints).
 */
export const FISH_LOOK = Object.freeze({ bellySilver: 0.4, bellyGain: 0.82, tunaYellow: [0.78, 0.62, 0.12] });

/** Hull index by name: the integer part of each instance's `aFish.w` (its seed is the fraction). */
export const FISH_HULL_INDEX = Object.freeze({ school: 0, cruiser: 1 });

/** Hull units: nose at +2.10, tail tips at -2.25, the length every swim term is measured in. */
export const FISH_HULL_LENGTH = ODYSSEY_FISH_HULLS.noseZ - ODYSSEY_FISH_HULLS.tailZ;

/** Every hull is drawn this much over its school's scale (see fScaleBase). */
export const FISH_HULL_SCALE = 1.2;

/**
 * THE SWIM, per hull (indexed as FISH_HULL_INDEX). Lateral displacement of a point a share `s`
 * along the fish (0 nose .. 1 tail tips), in hull units, at beat phase `phi`:
 *   h(s) = tail * q(s)^2 * sin(phi - k s) - recoil * sin(phi - k) * (pivot - s),
 *   q(s) = max(s - from, 0) / (1 - from),  k = 2 pi / wavelength,
 * so the wave starts at `from`, grows toward the tail and reaches `tail` at the tips, and the head
 * swings the other way from the tail. `stride` beats per body length of travel plus `idle` Hz;
 * `flutter` is how far a fin's trailing edge lags (a quarter beat behind).
 */
export const FISH_SWIM = Object.freeze([
    // The jack: a carangiform wave about a body length long over the rear two thirds.
    Object.freeze({
        from: 0.28,
        tail: 0.30,
        wavelength: 1.0,
        recoil: 0.10,
        pivot: 0.25,
        stride: 1.3,
        idle: 0.5,
        flutter: 0.05,
    }),
    // The tuna: a stiff body, the beat at the tail stock and the sickle tail, slower.
    Object.freeze({
        from: 0.58,
        tail: 0.17,
        wavelength: 1.3,
        recoil: 0.03,
        pivot: 0.30,
        stride: 1.0,
        idle: 0.32,
        flutter: 0.03,
    }),
]);

/** The CPU twin of the vertex stage's body wave: lateral offset (hull units) at s, phase phi. */
export function fishSwimOffset(hull, s, phi) {
    const w = FISH_SWIM[hull];
    const k = (Math.PI * 2) / w.wavelength;
    const q = Math.max(s - w.from, 0) / (1 - w.from);
    return (w.tail * q * q * Math.sin(phi - (k * s))) - (w.recoil * Math.sin(phi - k) * (w.pivot - s));
}

/**
 * HOW A SCHOOL MOVES, per hull (jack, tuna). Angles in radians, rates in rad/s.
 *   surge: the pace swells and slackens by this share, `surgeRate` the swell's rate;
 *   yaw / yawRate: the school's meander, as the heading's swing and its rate;
 *   pitch / pitchRate: its rise and fall, the same way;
 *   ownYaw / ownRate: each fish's own small swerve (its rate varies per fish by ±25 %);
 *   bank / bankMax: the lean into the curve (rad per u/s^2 of sideways acceleration), capped.
 * The school-wide terms are laid out along the ring (phase = rate x (t + along / omega)), so every
 * fish follows the path its leaders swam.
 */
export const FISH_SCHOOL_MOTION = Object.freeze([
    Object.freeze({
        surge: 0.12,
        surgeRate: 0.35,
        yaw: 0.22,
        yawRate: 0.5,
        pitch: 0.05,
        pitchRate: 0.4,
        ownYaw: 0.06,
        ownRate: 0.9,
        bank: 1.2,
        bankMax: 0.45,
    }),
    Object.freeze({
        surge: 0.10,
        surgeRate: 0.25,
        yaw: 0.12,
        yawRate: 0.35,
        pitch: 0.04,
        pitchRate: 0.3,
        ownYaw: 0.04,
        ownRate: 0.6,
        bank: 1.0,
        bankMax: 0.35,
    }),
]);

/**
 * How far apart the rest places are kept, in body lengths (the mean of the two fish's), along the
 * ring, across it and up (an ellipsoid round each fish no other fish's centre enters).
 */
export const FISH_SPACING = Object.freeze({ along: 1.75, across: 0.62, up: 0.5 });

const fishHash = (n) => {
    let v = Math.imul(n ^ 0x51ed270b, 2654435761);
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
};

/**
 * Every fish's row: its school, its rest place in the school (along the ring as an angle, across,
 * up), its seed, scale and tint. Rest places start from a soft-edged (triangular) spread, dense in
 * the middle, and are then pushed apart until no two are closer than FISH_SPACING (a deterministic
 * relaxation, inside the school's spread).
 * @param {readonly object[]} [schools]
 */
export function fishSchoolRows(schools = FISH_SCHOOLS) {
    const tri = (n) => fishHash(n) + fishHash(n + 7919) - 1;
    const rows = [];
    schools.forEach((school, si) => {
        const meanR = (school.rx + school.rz) / 2;
        // Along the ring the places are kept apart where it is tightest (its smaller radius), so the
        // gap holds all the way round the ellipse. `a` is the distance along at that radius.
        const minR = Math.min(school.rx, school.rz);
        const reach = (school.spread[0] / meanR) * minR;
        const pts = [];
        for (let k = 0; k < school.count; k += 1) {
            const n = (si * 1009) + (k * 17);
            const sc = school.scale[0] + (fishHash(n + 5) * (school.scale[1] - school.scale[0]));
            pts.push({
                n,
                sc,
                len: sc * FISH_HULL_SCALE * FISH_HULL_LENGTH,
                a: ((tri(n + 1) * school.spread[0]) / meanR) * minR,
                c: tri(n + 2) * school.spread[1],
                u: tri(n + 3) * school.spread[2],
            });
        }
        const sp = [0, 0, 0];
        for (let it = 0; it < 120; it += 1) {
            let moved = false;
            for (let i = 0; i < pts.length; i += 1) {
                for (let j = i + 1; j < pts.length; j += 1) {
                    const A = pts[i];
                    const B = pts[j];
                    const len = (A.len + B.len) / 2;
                    sp[0] = FISH_SPACING.along * len;
                    sp[1] = FISH_SPACING.across * len;
                    sp[2] = FISH_SPACING.up * len;
                    const dx = (B.a - A.a) / sp[0];
                    const dy = (B.c - A.c) / sp[1];
                    const dz = (B.u - A.u) / sp[2];
                    const d = Math.hypot(dx, dy, dz);
                    if (d >= 1) continue;
                    moved = true;
                    // Apart along the line between them (a fixed axis when they coincide).
                    const k = d > 1e-6 ? ((1 - d) * 0.5) / d : 0.5;
                    const ux = d > 1e-6 ? dx : 1;
                    const uy = d > 1e-6 ? dy : 0;
                    const uz = d > 1e-6 ? dz : 0;
                    A.a -= ux * k * sp[0]; B.a += ux * k * sp[0];
                    A.c -= uy * k * sp[1]; B.c += uy * k * sp[1];
                    A.u -= uz * k * sp[2]; B.u += uz * k * sp[2];
                }
            }
            pts.forEach((pt) => {
                pt.a = Math.min(Math.max(pt.a, -reach), reach);
                pt.c = Math.min(Math.max(pt.c, -school.spread[1]), school.spread[1]);
                pt.u = Math.min(Math.max(pt.u, -school.spread[2]), school.spread[2]);
            });
            if (!moved) break;
        }
        pts.forEach((pt) => {
            const { n, sc } = pt;
            const tv = 0.88 + (fishHash(n + 6) * 0.24); // per-fish value variation inside a school
            rows.push({
                si,
                hull: FISH_HULL_INDEX[school.hull],
                along: pt.a / minR,
                across: pt.c,
                up: pt.u,
                seed: Math.min(fishHash(n + 4), 0.999),
                scale: sc,
                tint: [school.tint[0] * tv, school.tint[1] * tv, school.tint[2] * tv],
            });
        });
    });
    return rows;
}

/**
 * THE CPU TWIN of the vertex stage's school motion: where a fish is at time `t` (relative to its
 * ring's centre), the way it heads (unit, its velocity's), its speed, its sideways acceleration
 * toward its own left (u/s^2), its lean and its tail beat's phase.
 * @param {ReturnType<typeof fishSchoolRows>[number]} row
 * @param {object} school its FISH_SCHOOLS entry
 * @param {number} phase0 the school's phase (as the instance's aPathB.z)
 * @param {number} t seconds
 */
export function fishPoseAt(row, school, phase0, t) {
    const m = FISH_SCHOOL_MOTION[row.hull];
    const w = school.omega;
    const absW = Math.abs(w);
    const meanR = (school.rx + school.rz) / 2;
    const v0 = absW * meanR;
    const lag = t + (row.along / w); // the moment the school's head was where this fish is
    // the surge: theta' = w (1 + surge cos psiS)
    const psiS = (m.surgeRate * lag) + (phase0 * 1.7);
    const th = phase0 + (w * t) + row.along + (((m.surge * w) / m.surgeRate) * Math.sin(psiS));
    const thD = w * (1 + (m.surge * Math.cos(psiS)));
    const thDD = -w * m.surge * m.surgeRate * Math.sin(psiS);
    const ct = Math.cos(th);
    const st = Math.sin(th);
    const bobPh = (th * 2) + phase0;
    const R = [school.rx * ct, school.bob * Math.sin(bobPh), school.rz * st];
    const R1 = [-school.rx * st, 2 * school.bob * Math.cos(bobPh), school.rz * ct];
    const R2 = [-school.rx * ct, -4 * school.bob * Math.sin(bobPh), -school.rz * st];
    // across: level, square to the ring's way (its sign follows the hand, as the rest offset's)
    const hand = w >= 0 ? 1 : -1;
    const tl = Math.hypot(R1[0], R1[2]) || 1;
    const C = [-(R1[2] * hand) / tl, 0, (R1[0] * hand) / tl];
    // the meander (school-wide, laid along the ring) and the fish's own swerve
    const W = (m.yaw * v0) / m.yawRate;
    const own = 0.75 + (0.5 * row.seed);
    const ownRate = m.ownRate * own;
    const Wi = (m.ownYaw * v0) / ownRate;
    const psiW = (m.yawRate * lag) + (phase0 * 2.3);
    const psiI = (ownRate * t) + (row.seed * 41);
    const a = row.across + (W * Math.sin(psiW)) + (Wi * Math.sin(psiI));
    const aD = (W * m.yawRate * Math.cos(psiW)) + (Wi * ownRate * Math.cos(psiI));
    const aDD = -(W * m.yawRate * m.yawRate * Math.sin(psiW)) - (Wi * ownRate * ownRate * Math.sin(psiI));
    // the rise and fall
    const B = (m.pitch * v0) / m.pitchRate;
    const psiV = (m.pitchRate * lag) + (phase0 * 3.1);
    const b = row.up + (B * Math.sin(psiV));
    const bD = B * m.pitchRate * Math.cos(psiV);
    const bDD = -B * m.pitchRate * m.pitchRate * Math.sin(psiV);
    // ...and how the across direction turns with the ring (it carries a fish set off the ring a
    // little faster or slower than the ring itself, which sets how steeply it climbs and dips)
    const P1 = [-(R2[2] * hand), (R2[0] * hand)];
    const cP = (C[0] * P1[0]) + (C[2] * P1[1]);
    const C1 = [(P1[0] - (C[0] * cP)) / tl, (P1[1] - (C[2] * cP)) / tl];
    const centre = [R[0] + (C[0] * a), R[1] + b, R[2] + (C[2] * a)];
    const V = [
        (R1[0] * thD) + (C[0] * aD) + (C1[0] * thD * a),
        (R1[1] * thD) + bD,
        (R1[2] * thD) + (C[2] * aD) + (C1[1] * thD * a),
    ];
    const A = [
        (R2[0] * thD * thD) + (R1[0] * thDD) + (C[0] * aDD),
        (R2[1] * thD * thD) + (R1[1] * thDD) + bDD,
        (R2[2] * thD * thD) + (R1[2] * thDD) + (C[2] * aDD),
    ];
    const speed = Math.hypot(V[0], V[1], V[2]) || 1e-6;
    const fwd = [V[0] / speed, V[1] / speed, V[2] / speed];
    // left = up x fwd, levelled
    const lx = fwd[2];
    const lz = -fwd[0];
    const ll = Math.hypot(lx, lz) || 1;
    const left = [lx / ll, 0, lz / ll];
    const side = (A[0] * left[0]) + (A[2] * left[2]);
    const bank = -Math.min(m.bankMax, Math.max(-m.bankMax, side * m.bank));
    // the beat: its phase is the distance swum (in body lengths x stride) plus the idle beat
    const swim = FISH_SWIM[row.hull];
    const bodyLen = row.scale * FISH_HULL_SCALE * FISH_HULL_LENGTH;
    const swum = meanR * ((absW * t) + (((m.surge * absW) / m.surgeRate) * Math.sin(psiS)));
    const beat = (Math.PI * 2 * (((swim.stride * swum) / bodyLen) + (swim.idle * t))) + (row.seed * 60);
    return {
        centre, fwd, left, speed, side, curvature: side / (speed * speed), bank, beat,
    };
}

const decode = (text) => {
    const bytes = typeof atob === 'function'
        ? Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
        : Uint8Array.from(Buffer.from(text, 'base64'));
    return bytes.buffer;
};

/** One hull's arrays, decoded from the generated module. */
export function decodeFishHull(name) {
    const h = ODYSSEY_FISH_HULLS[name];
    return {
        hull: h.hull,
        vertexCount: h.vertexCount,
        triangleCount: h.triangleCount,
        bodyTriangleCount: h.bodyTriangleCount,
        positions: new Float32Array(decode(h.positions)),
        normals: new Float32Array(decode(h.normals)),
        parts: new Float32Array(decode(h.parts)),
        index: new Uint16Array(decode(h.index)),
    };
}

/**
 * Both hulls in one indexed geometry (the school's vertices first): position, normal and
 * `aPart` (s, d, flex, code = hull * 4 + region).
 */
export function buildFishHullGeometry(geometry = new THREE.BufferGeometry()) {
    const hulls = [decodeFishHull('school'), decodeFishHull('cruiser')];
    const vertices = hulls.reduce((n, h) => n + h.vertexCount, 0);
    const triangles = hulls.reduce((n, h) => n + h.triangleCount, 0);
    const position = new Float32Array(vertices * 3);
    const normal = new Float32Array(vertices * 3);
    const part = new Float32Array(vertices * 4);
    const index = new Uint16Array(triangles * 3);
    let v = 0;
    let t = 0;
    hulls.forEach((h) => {
        position.set(h.positions, v * 3);
        normal.set(h.normals, v * 3);
        part.set(h.parts, v * 4);
        for (let i = 0; i < h.index.length; i += 1) index[(t * 3) + i] = h.index[i] + v;
        v += h.vertexCount;
        t += h.triangleCount;
    });
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    geometry.setAttribute('aPart', new THREE.BufferAttribute(part, 4));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    return geometry;
}

/** A school's phase round its ring (the instances' aPathB.z). */
export function fishSchoolPhase(si) {
    return fishHash((si * 131) + 3) * Math.PI * 2;
}

/**
 * The schools as one instanced draw.
 *
 * @param {object} options
 * @param {any} options.uTime the world clock (s)
 * @param {any} options.uLife the 1->2 carry (0 in the cavern .. 1 in open water)
 * @param {number} options.seaLevel
 * @param {Array<{x:number,y:number,z:number}>} options.openWater rail points in the open water
 * @param {(x:number, z:number) => number} options.heightAt the seabed's height
 * @param {(c:any, p:any) => any} options.haze the world's water aerial
 * @param {(c:any) => any} options.grade the world's output grade
 * @param {any} [options.positionWorld] the world position node (the world's climb frame)
 * @param {any} [options.cameraPosition] the eye node (the world's climb frame)
 */
export function createOdysseyFish({
    uTime,
    uLife,
    seaLevel,
    openWater,
    heightAt,
    haze,
    grade,
    positionWorld = positionWorldNode,
    cameraPosition = cameraPositionNode,
}) {
    const fInst = buildFishHullGeometry(new THREE.InstancedBufferGeometry());
    fInst.instanceCount = FISH_COUNT;
    const aPath = new Float32Array(FISH_COUNT * 4);
    const aPathB = new Float32Array(FISH_COUNT * 4);
    const aFish = new Float32Array(FISH_COUNT * 4);
    const aLook = new Float32Array(FISH_COUNT * 4);
    // Each school's ring (centre, radii, reach in depth), for the gate that keeps the fish drawn
    // while any of them still shows through the surface to an eye above it.
    const rings = [];
    const rows = fishSchoolRows();
    let fi = 0;
    FISH_SCHOOLS.forEach((school, si) => {
        const anchor = openWater[Math.min(openWater.length - 1, Math.floor(school.f * openWater.length))];
        // Clearance: lift the ring until every point of it (with its vertical spread, bob and the
        // school's own rise and fall) clears the seabed by 6 u, and cap it 8 u under the surface.
        // Sampled on the CPU height mirror the vertex shader displaces to, so a buried school is
        // impossible.
        const motion = FISH_SCHOOL_MOTION[FISH_HULL_INDEX[school.hull]];
        const rise = (motion.pitch * Math.abs(school.omega) * ((school.rx + school.rz) / 2)) / motion.pitchRate;
        const reachUp = school.bob + school.spread[2] + rise;
        let cy = Math.min(anchor.y + school.dy, seaLevel - 8 - reachUp);
        for (let k = 0; k < 24; k += 1) {
            const a = (k / 24) * Math.PI * 2;
            const reach = 1 + (school.spread[1] / Math.min(school.rx, school.rz));
            const bed = heightAt(
                anchor.x + (Math.cos(a) * school.rx * reach),
                anchor.z + (Math.sin(a) * school.rz * reach),
            );
            cy = Math.max(cy, bed + 6 + reachUp);
        }
        const phase0 = fishSchoolPhase(si);
        rings.push({
            x: anchor.x, y: cy, z: anchor.z, rx: school.rx, rz: school.rz, up: reachUp,
        });
        for (let k = 0; k < school.count; k += 1, fi += 1) {
            const row = rows[fi];
            aPath.set([anchor.x, cy, anchor.z, school.rx], fi * 4);
            aPathB.set([school.rz, school.omega, phase0, school.bob], fi * 4);
            aFish.set([
                row.along, // along the ribbon, as an angle
                row.across,
                row.up,
                // The hull in the integer part, the fish's seed in the fraction (kept < 1).
                row.hull + row.seed,
            ], fi * 4);
            aLook.set([...row.tint, row.scale], fi * 4);
        }
    });
    fInst.setAttribute('aPath', new THREE.InstancedBufferAttribute(aPath, 4));
    fInst.setAttribute('aPathB', new THREE.InstancedBufferAttribute(aPathB, 4));
    fInst.setAttribute('aFish', new THREE.InstancedBufferAttribute(aFish, 4));
    fInst.setAttribute('aLook', new THREE.InstancedBufferAttribute(aLook, 4));

    const fishMat = new THREE.MeshBasicNodeMaterial();
    const fPath = attribute('aPath', 'vec4');
    const fPathB = attribute('aPathB', 'vec4');
    const fFish = attribute('aFish', 'vec4');
    const fLook = attribute('aLook', 'vec4');
    const fPart = attribute('aPart', 'vec4');
    const instHull = floor(fFish.w);
    const fS = fFish.w.sub(instHull);
    // Each instance keeps its own hull's vertices; the other hull folds onto the fish's centre.
    const vertHull = step(float(3.5), fPart.w);
    const keep = float(1).sub(abs(vertHull.sub(instHull)));
    const region = fPart.w.sub(vertHull.mul(4));
    // x1.2 after the first capture: at 40-110 u the 1.3-1.7 m hulls were 6-10 px slivers.
    // x(0.25..1) by uLife (the 1->2 carry): while the quench veil thins the schools come IN —
    // smaller and dissolved into the water (the haze floor on the aerial) — instead of standing
    // full-size and crisp beside Earth Core's basalt (the audit's p=0.0529 frame).
    const fScaleBase = fLook.w.mul(FISH_HULL_SCALE);
    const fScale = fScaleBase.mul(uLife.mul(0.75).add(0.25));
    const fOmega = fPathB.y;
    const fHand = step(float(0), fOmega).mul(2).sub(1);
    const motionOf = (key) => mix(float(FISH_SCHOOL_MOTION[0][key]), float(FISH_SCHOOL_MOTION[1][key]), instHull);
    const fMeanR = fPath.w.add(fPathB.x).mul(0.5);
    const fSpeed = abs(fOmega).mul(fMeanR);
    // THE SCHOOL FOLLOWS ITS LEADERS (fishPoseAt is the CPU twin of all of this): its surge of
    // pace, its meander and its rise and fall are laid out along the ring, read at the moment the
    // school's head was where this fish is (`lag`), so each fish swims the path of those ahead.
    const fLag = uTime.add(fFish.x.div(fOmega));
    const mSurge = motionOf('surge');
    const mSurgeRate = motionOf('surgeRate');
    const psiS = mSurgeRate.mul(fLag).add(fPathB.z.mul(1.7));
    const fTheta = fPathB.z.add(uTime.mul(fOmega)).add(fFish.x)
        .add(mSurge.mul(fOmega).div(mSurgeRate).mul(sin(psiS)));
    const thD = fOmega.mul(mSurge.mul(cos(psiS)).add(1));
    const thDD = fOmega.mul(mSurge).mul(mSurgeRate).mul(sin(psiS)).negate();
    const fCt = cos(fTheta);
    const fSt = sin(fTheta);
    const fBobPh = fTheta.mul(2).add(fPathB.z);
    const fRibbon = vec3(
        fPath.x.add(fPath.w.mul(fCt)),
        fPath.y.add(fPathB.w.mul(sin(fBobPh))),
        fPath.z.add(fPathB.x.mul(fSt)),
    );
    const fR1 = vec3(fPath.w.mul(fSt).negate(), fPathB.w.mul(2).mul(cos(fBobPh)), fPathB.x.mul(fCt));
    const fR2 = vec3(fPath.w.mul(fCt).negate(), fPathB.w.mul(4).mul(sin(fBobPh)).negate(), fPathB.x.mul(fSt).negate());
    const fWorldUp = vec3(0, 1, 0);
    // Across the ring, level (its sign follows the hand, as the rest offset's always has).
    const fAcrossRaw = vec3(fR1.z.mul(fHand).negate(), 0, fR1.x.mul(fHand));
    const fAcrossLen = max(length(fAcrossRaw), 1e-4);
    const fAcross = fAcrossRaw.div(fAcrossLen);
    // How the across direction turns with the ring (a fish set off the ring goes a little faster or
    // slower than it, which sets how steeply it climbs and dips).
    const fAcrossTurn = vec3(fR2.z.mul(fHand).negate(), 0, fR2.x.mul(fHand));
    const fAcross1 = fAcrossTurn.sub(fAcross.mul(dot(fAcross, fAcrossTurn))).div(fAcrossLen);
    // The meander (school-wide) and the fish's own small swerve, as offsets across the ring.
    const mYawRate = motionOf('yawRate');
    const fW = motionOf('yaw').mul(fSpeed).div(mYawRate);
    const fOwnRate = motionOf('ownRate').mul(fS.mul(0.5).add(0.75));
    const fWi = motionOf('ownYaw').mul(fSpeed).div(fOwnRate);
    const psiW = mYawRate.mul(fLag).add(fPathB.z.mul(2.3));
    const psiI = fOwnRate.mul(uTime).add(fS.mul(41));
    const fA = fFish.y.add(fW.mul(sin(psiW))).add(fWi.mul(sin(psiI)));
    const fAD = fW.mul(mYawRate).mul(cos(psiW)).add(fWi.mul(fOwnRate).mul(cos(psiI)));
    const fADD = fW.mul(mYawRate).mul(mYawRate).mul(sin(psiW))
        .add(fWi.mul(fOwnRate).mul(fOwnRate).mul(sin(psiI)))
        .negate();
    // The rise and fall.
    const mPitchRate = motionOf('pitchRate');
    const fB = motionOf('pitch').mul(fSpeed).div(mPitchRate);
    const psiV = mPitchRate.mul(fLag).add(fPathB.z.mul(3.1));
    const fBD = fB.mul(mPitchRate).mul(cos(psiV));
    const fBDD = fB.mul(mPitchRate).mul(mPitchRate).mul(sin(psiV)).negate();
    const fishCenter = fRibbon.add(fAcross.mul(fA)).add(vec3(0, fFish.z.add(fB.mul(sin(psiV))), 0));
    // A fish points where it goes: the heading is its path's own velocity.
    const fVel = fR1.mul(thD).add(fAcross.mul(fAD)).add(fAcross1.mul(thD.mul(fA))).add(vec3(0, fBD, 0));
    const fAcc = fR2.mul(thD.mul(thD)).add(fR1.mul(thDD)).add(fAcross.mul(fADD)).add(vec3(0, fBDD, 0));
    const fFwd = normalize(fVel);
    // The fish's own frame, right-handed: x its LEFT (the hull's +x), y up, z forward.
    const fLeft = normalize(cross(fWorldUp, fFwd));
    const fUp = cross(fFwd, fLeft);
    // Its sideways acceleration toward its left (u/s^2) and the curve it swims (1/u).
    const fSide = dot(fAcc, fLeft);
    const fCurve = fSide.div(max(dot(fVel, fVel), 1e-4));
    // SWIM: tail beat coupled to speed (beats per body length of travel + an idle floor). Its phase
    // is the distance swum, so the beat quickens and slows with the surge and never jumps. The
    // beat keys off the UNSCALED hull, so the 1->2 presence ramp never re-times the tail.
    const swimOf = (key) => mix(float(FISH_SWIM[0][key]), float(FISH_SWIM[1][key]), instHull);
    const bodyLen = fScaleBase.mul(FISH_HULL_LENGTH);
    const fSwum = fMeanR.mul(abs(fOmega).mul(uTime).add(mSurge.mul(abs(fOmega)).div(mSurgeRate).mul(sin(psiS))));
    const swimPhase = fSwum.div(bodyLen).mul(swimOf('stride')).add(swimOf('idle').mul(uTime))
        .mul(Math.PI * 2)
        .add(fS.mul(60));
    const waveK = float(Math.PI * 2).div(swimOf('wavelength'));
    const waveFrom = swimOf('from');
    const sAlong = fPart.x;
    const q = max(sAlong.sub(waveFrom), 0).div(float(1).sub(waveFrom));
    const envelope = swimOf('tail').mul(q).mul(q);
    const envelopeSlope = swimOf('tail').mul(q).mul(2).div(float(1).sub(waveFrom));
    const wavePh = swimPhase.sub(waveK.mul(sAlong));
    const tailSin = sin(swimPhase.sub(waveK));
    const recoil = swimOf('recoil');
    // Only the fins' trailing edges lag (a quarter beat behind the body under them).
    const finVertex = float(1).sub(clamp(abs(region.sub(1)), 0, 1));
    // The body bends into the curve it swims: a C toward the inside (nose and tail both), so it
    // follows its path instead of crossing it as a stiff stick.
    const zH = positionGeometry.z;
    const bend = fCurve.mul(fScale).mul(zH).mul(zH).mul(0.5);
    const sway = envelope.mul(sin(wavePh))
        .sub(recoil.mul(tailSin).mul(swimOf('pivot').sub(sAlong)))
        .add(fPart.z.mul(finVertex).mul(swimOf('flutter')).mul(cos(wavePh)))
        .add(bend);
    // The wave's slope along the hull (d/dz = -d/ds / length) bends the normal: for a shear
    // x' = x + h(z) the normal becomes (n.x, n.y, n.z - h'(z) n.x). The C adds its own slope.
    const swayDs = envelopeSlope.mul(sin(wavePh))
        .sub(envelope.mul(waveK).mul(cos(wavePh)))
        .add(recoil.mul(tailSin));
    const swayDz = swayDs.div(-FISH_HULL_LENGTH).add(fCurve.mul(fScale).mul(zH));
    const lx = positionGeometry.x.add(sway);
    const nIn = normalGeometry;
    const nz = nIn.z.sub(swayDz.mul(nIn.x));
    // It leans into the curve it swims, by its sideways acceleration (capped): the lean is what turns
    // a flank's mirror up to the surface and back, so the flash ripples through the school with its
    // meander.
    const bankMax = motionOf('bankMax');
    const bank = clamp(fSide.mul(motionOf('bank')), bankMax.negate(), bankMax).negate();
    const cb = cos(bank);
    const sb = sin(bank);
    const py = positionGeometry.y;
    const bx = lx.mul(cb).sub(py.mul(sb));
    const by = py.mul(cb).add(lx.mul(sb));
    const nbx = nIn.x.mul(cb).sub(nIn.y.mul(sb));
    const nby = nIn.y.mul(cb).add(nIn.x.mul(sb));
    fishMat.positionNode = fishCenter.add(
        fLeft.mul(bx).add(fUp.mul(by)).add(fFwd.mul(positionGeometry.z)).mul(fScale.mul(keep)),
    );
    const vFishN = varying(fLeft.mul(nbx).add(fUp.mul(nby)).add(fFwd.mul(nz)), 'vFishN');
    // The flank's MIRROR: a fish's silvering is a stack of reflecting platelets standing upright in
    // the skin, parallel to the body, whatever the curve of the flank over them (that is how a
    // silver fish hides in open water). So the mirror's normal is the fish's own sideways axis —
    // rolled with the bank and bent by the body wave like a normal — not the surface's: a curved
    // mirror would shine as a hairline along the turn of the body, a flat one lights the flank.
    const vFishMirror = varying(fLeft.mul(cb).add(fUp.mul(sb)).sub(fFwd.mul(swayDz)), 'vFishMirror');
    // (d dorsal share, flex, region, hull) for the fragment; region and hull are constant over a
    // triangle.
    const vFishPart = varying(vec4(fPart.y, fPart.z, region, vertHull), 'vFishPart');
    // How far along the fish (0 nose .. 1 tail tips), for the tuna's yellow fins.
    const vFishS = varying(fPart.x, 'vFishS');

    // COUNTERSHADING from the hull's own baked dorsal share, so the dark back is a property of
    // the fish rather than of where the light is — exactly how a real fish's pigment works. The
    // normal is the hull's own, bent by the swim and turned to the side the eye sees.
    const fV = normalize(cameraPosition.sub(positionWorld));
    const fN = normalize(vFishN).mul(faceDirection);
    const d = clamp(vFishPart.x, 0, 1);
    const isFin = smoothstep(float(0.5), float(0.6), vFishPart.z)
        .mul(float(1).sub(smoothstep(float(1.4), float(1.5), vFishPart.z)));
    const isEye = smoothstep(float(1.5), float(1.6), vFishPart.z);
    const isBody = float(1).sub(isFin).sub(isEye);
    // The back: the flank darkens upward and meets the dark back at a fairly crisp line (a
    // mackerel's or a tuna's). The line is widened by its own footprint: toward the silhouette the
    // body is foreshortened and the whole flank-to-back turn falls inside a pixel, where a crisp
    // step would freckle the rim, and the gradient below it keeps the lit upper flank from
    // drawing a pale line along the edge of a fish seen from below.
    const dW = fwidth(d).mul(1.5);
    const backLine = smoothstep(float(0.60).sub(dW), float(0.70).add(dW), d);
    const fDorsal = smoothstep(float(0.30), float(0.70), d).mul(0.5).add(backLine.mul(0.5));
    const fTint = fLook.xyz;
    const fBack = fTint.mul(vec3(0.20, 0.30, 0.36));
    // The belly is lighter than the back but still DARKER than the lit water around it: pure
    // countershading camouflages a fish against the surface (that is its purpose in nature), and
    // a fish the eye cannot find is no life at all. Silhouettes first, with the silver reserved
    // for the flash — the first capture's bright bellies all but vanished.
    // VISIBILITY (2026-11-03): seen from below the schools read as pale fish against the deep blue,
    // but in the brighter water of the upper climb a belly at 0.62 matched it (the teal school and
    // the tuna went blue on blue). The silvering is pushed: paler and brighter.
    const fBelly = mix(fTint, vec3(0.86, 0.93, 0.95), float(FISH_LOOK.bellySilver)).mul(FISH_LOOK.bellyGain);
    const fBodyAlbedo = mix(fBelly, fBack, fDorsal);
    // Fins: the body's colour where they stand, a little darker and greyer, thin enough that the
    // surface's light shows through them from below.
    // The tuna's yellow (a yellowfin's mark): its second dorsal, anal fin and finlets, between the
    // body's middle and the tail stock (the tail fin stays dark); the jack's fins stay the body's.
    const fYellow = vFishPart.w.mul(smoothstep(float(0.48), float(0.58), vFishS))
        .mul(float(1).sub(smoothstep(float(0.8), float(0.85), vFishS)));
    const fFinAlbedo = mix(
        mix(fBelly, fBack, smoothstep(float(0.25), float(0.85), d)).mul(0.78),
        vec3(...FISH_LOOK.tunaYellow),
        fYellow,
    );
    // The eye: a dark pupil in a pale iris (flex runs 0 at the pupil's centre to 1 at the rim).
    const fEyeAlbedo = mix(
        vec3(0.02, 0.022, 0.026),
        mix(fBelly, vec3(0.70, 0.72, 0.66), float(0.35)),
        smoothstep(float(0.5), float(0.85), vFishPart.y),
    );
    const fAlbedo = fBodyAlbedo.mul(isBody).add(fFinAlbedo.mul(isFin)).add(fEyeAlbedo.mul(isEye));
    // Down-welling light: the surface is the only lamp. Wrapped, so a belly seen from below is lit
    // by the bright water around it rather than going black.
    const fDown = clamp(fN.y.mul(0.5).add(0.5), 0, 1);
    const fDepth = clamp(float(seaLevel).sub(positionWorld.y).div(180), 0, 1);
    const fLight = mix(float(0.50), float(1.05), fDown).mul(float(1).sub(fDepth.mul(0.45)));
    // THE FLASH: the flank mirrors the surface when the reflected eye ray climbs into the Snell
    // window (y > ~0.8). The mirror is the flank's upright silvering (vFishMirror, on the side this
    // fragment is on), so a fish flashes as a whole flank, the signature glint of a school turning.
    // What shows is the CONTRAST between what the mirror sends the eye and the water behind the
    // fish: an upright mirror seen from below sends the eye light from as high as the eye looks
    // (that is the camouflage), so only a roll or a swerve that tips the mirror toward the surface
    // lights it, and it goes out again as the fish rights itself. It fades with how squarely the
    // skin itself faces the eye, so a flank turning edge-on draws no line.
    const mirrorRaw = normalize(vFishMirror);
    const fM = mirrorRaw.mul(sign(dot(fN, mirrorRaw)).add(0.0001));
    const fFacing = smoothstep(float(0.15), float(0.50), abs(dot(fN, fV)));
    const fWindow = (y) => smoothstep(float(0.86), float(0.98), y);
    const fMirrorFlash = clamp(fWindow(reflect(fV.negate(), fM).y).sub(fWindow(fV.y.negate())), 0, 1)
        .mul(step(float(0), dot(fM, fV))).mul(fFacing);
    // The silver runs from the belly's edge up the flank to the back's gradient: neither the belly
    // nor the dark back flash.
    // Soft at both ends, so a lit flank melts into the belly below and the back above.
    const fSilver = smoothstep(float(0.04), float(0.34), d)
        .mul(float(1).sub(smoothstep(float(0.42), float(0.64), d)));
    // The eye is a wet ball: a faint glint, so it stays a dark eye.
    const fEyeGlint = smoothstep(float(0.80), float(0.97), reflect(fV.negate(), fN).y);
    // The tuna's flank is half a jack's: a big, slow fish holding a roll would otherwise glare.
    const fFlashGain = mix(float(0.95), float(0.4), vFishPart.w);
    const fFlash = fMirrorFlash.mul(fSilver).mul(isBody).mul(fFlashGain)
        .add(fEyeGlint.mul(isEye).mul(0.12));
    // Light through a fin seen from below: the bright water above shows through its membrane.
    const fThrough = clamp(fV.y.negate(), 0, 1).mul(isFin).mul(0.16);
    const fLit = fAlbedo.mul(fLight)
        .add(vec3(0.82, 0.96, 1.0).mul(fFlash))
        .add(fTint.mul(vec3(0.55, 0.75, 0.8)).mul(fThrough));
    const fSeen = throughSurfaceNode(positionWorld, cameraPosition, seaLevel);
    fishMat.colorNode = grade(haze(fLit.mul(fSeen.tint), positionWorld));
    fishMat.opacityNode = fSeen.share;
    fishMat.transparent = true;
    fishMat.depthWrite = true;
    fishMat.depthNode = behindSteamDepth(positionWorld);
    // Two-sided for the fins and the eyes; the body is closed and wound outward, so its inside
    // is never meant to be seen. Its back faces are dropped: drawn, they fought the front faces
    // for depth along every silhouette (where the two meet) and freckled the rim with the inside's
    // darker shade. One pass, not three's back-then-front pair for two-sided transparents (the
    // fish only turn translucent as they fade through the surface, where the order is moot).
    fishMat.side = THREE.DoubleSide;
    fishMat.forceSinglePass = true;
    fishMat.maskNode = faceDirection.greaterThan(0).or(isBody.lessThan(0.5));
    fishMat.fog = false;
    const mesh = new THREE.Mesh(fInst, fishMat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    mesh.name = 'odyssey-world-fish';

    // Whether any school still shows through the surface to the eye (eight points round each
    // ring, at the top of its reach): the CPU side of the fish's opacity.
    const probe = { x: 0, y: 0, z: 0 };
    const eyeAt = new THREE.Vector3();
    const seenFromAbove = (viewCamera) => {
        if (!viewCamera?.getWorldPosition) return false;
        const eye = viewCamera.getWorldPosition(eyeAt);
        if (!(eye.y > seaLevel)) return false;
        return rings.some((ring) => {
            for (let k = 0; k < 8; k += 1) {
                const a = (k / 8) * Math.PI * 2;
                probe.x = ring.x + (Math.cos(a) * ring.rx);
                probe.y = ring.y + ring.up;
                probe.z = ring.z + (Math.sin(a) * ring.rz);
                if (throughSurfaceShare(eye, probe, seaLevel) > 0.01) return true;
            }
            return false;
        });
    };

    return {
        mesh,
        material: fishMat,
        count: FISH_COUNT,
        rings,
        seenFromAbove,
        dispose() {
            fInst.dispose();
            fishMat.dispose();
        },
    };
}
