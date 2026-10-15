/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Luminous Tides — the palms: real trees along the top of the beach, not a cut-out.
 *
 * Two ranks. The front one stands on the back beach in clumps a few metres in front of the
 * jungle, each palm leaning out toward the sea and curving up again at the top; the back one
 * rises out of the jungle behind, taller and straighter, its crowns over the canopy. Every palm is
 * a ringed trunk (a bent tube, swollen at its foot) and a crown of fronds in three dimensions:
 * young ones standing up, old ones hanging, each a drooping rachis with its leaflets hung off it
 * in a tent, so the crown is round and turns as the eye moves. The fragment cuts the leaflets out
 * of each frond's strip (and fades the comb to its average where it gets finer than a pixel).
 *
 * The light is the night's (landLight): the air from above, the far coast's warm glow on the
 * faces turned to it, the sea's blue fire on the seaward faces near the sand, the sky wrapping the
 * edges, a little of it through the leaves. A breeze off the sea sways the crowns.
 *
 * The plan (planPalms) is plain numbers, so the tests can stand on it; the mesh is one draw.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraPosition, faceDirection, float, floor, fract, fwidth, length, max, mix, normalize,
    positionLocal, positionWorld, sin, smoothstep, vec2, vec3, vec4,
} from 'three/tsl';
import {
    DEG, EYE, SHORE_FRAME, fromShore, lerp, mulberry32, sandHeight, smooth,
} from './luminous-tides-core.js';
import {
    hash21, horizonHaze, landHaze, landLight, shoreOf, skyBase,
} from './luminous-tides-tsl.js';
import { bakeOnce } from '../shared/bake-cache.js';

/** Where the palms stand (shore a, s; s relative to the jungle's edge) and how they grow. */
export const PALMS = Object.freeze({
    /** The front rank: along the shore from here to there… */
    from: 44,
    to: 420,
    /** …this far apart on average where they grow (the tier's density divides it), in clumps… */
    gap: 4.6,
    /** …this far in front of the jungle's edge (metres seaward)… */
    out: [1.0, 6.0],
    /** …this tall (metres), leaning out to sea this far (degrees). */
    height: [8.5, 16],
    tilt: [3, 32],
    /** The back rank rises out of the jungle, behind its edge. */
    backFrom: 58,
    backTo: 400,
    backGap: 10,
    back: [3, 11],
    backHeight: [15, 21],
    backTilt: [0, 9],
    /** A frond's length (metres) and its leaflets' half-span at their longest. */
    frond: [3.8, 5.4],
    span: [1.0, 1.35],
});

/**
 * A frond by its age: how far it rises out of the crown and droops along its length (degrees), and
 * its length (a share). Young spears stand up, grown fronds spread, old ones hang.
 */
const FROND_AGES = Object.freeze({
    young: Object.freeze({ rise: [48, 66], droop: [15, 30], length: 0.72 }),
    grown: Object.freeze({ rise: [4, 34], droop: [38, 62], length: 1 }),
    old: Object.freeze({ rise: [-38, -12], droop: [40, 60], length: 1 }),
});

/** How finely a tier builds a palm (density is the tier's `palms`). */
export function palmDetail(density) {
    const d = Math.max(0.3, Math.min(1, density));
    return Object.freeze({
        fronds: Math.round(11 + ((d - 0.55) / 0.45) * 5),
        segments: d >= 1 ? 8 : 6,
        sides: d >= 0.85 ? 7 : 5,
        rings: d >= 1 ? 11 : 7,
    });
}

const UP = [0, 1, 0];
const OUT = [SHORE_FRAME.out.x, 0, SHORE_FRAME.out.z];
const ALONG = [SHORE_FRAME.along.x, 0, SHORE_FRAME.along.z];

/** Palms grow in clumps with open beach between: how likely a palm is at `a` (0..1). */
export function clumpAt(a) {
    const swell = 0.5 + 0.32 * Math.sin(a * 0.083 + 1.3) + 0.18 * Math.sin(a * 0.029 + 4.1);
    return smooth(0.32, 0.8, swell);
}

/**
 * Every palm, far ones first (the order they are drawn in). `lineAt(a)` is the jungle's edge (s).
 * Each: { a, s, foot, ctrl, top (world xyz: the trunk's Bezier), height, radius, seed, fronds: [{
 * heading, rise, droop, length, span, hang }] }.
 */
export function planPalms({ density = 1, lineAt, seed = 7 }) {
    const rand = mulberry32(seed);
    const detail = palmDetail(density);
    const palms = [];
    const at = { x: 0, z: 0 };
    const rank = (from, to, gap, outRange, heightRange, tiltRange, front) => {
        const step = gap / Math.max(0.3, density);
        for (let a0 = from; a0 < to; a0 += step) {
            const r = [rand(), rand(), rand(), rand(), rand(), rand(), rand(), rand()];
            if (r[0] > clumpAt(a0 + (front ? 0 : 137)) * 0.92 + 0.04) continue;
            const a = a0 + (r[1] - 0.5) * step * 0.8;
            const offset = lerp(outRange[0], outRange[1], r[2]);
            const s = lineAt(a) + (front ? offset : -offset);
            fromShore(a, s, at);
            const height = lerp(heightRange[0], heightRange[1], r[3]);
            const tilt = lerp(tiltRange[0], tiltRange[1], r[4] ** 0.8) * DEG;
            // Front palms lean out over the sand, toward the light; the back ones every way a little.
            const swing = front ? (r[5] - 0.5) * 1.7 : (r[5] - 0.5) * 6.2;
            const lean = [
                OUT[0] * Math.cos(swing) + ALONG[0] * Math.sin(swing),
                0,
                OUT[2] * Math.cos(swing) + ALONG[2] * Math.sin(swing),
            ];
            const footY = sandHeight(s) - 0.4;
            const foot = [at.x, footY, at.z];
            const sinT = Math.sin(tilt) * height;
            const cosT = Math.cos(tilt) * height;
            // Leaning hardest low down and curving up toward the crown.
            const ctrl = [foot[0] + lean[0] * sinT * 0.78, footY + cosT * 0.48, foot[2] + lean[2] * sinT * 0.78];
            const top = [foot[0] + lean[0] * sinT, footY + cosT, foot[2] + lean[2] * sinT];
            const palm = {
                a, s, foot, ctrl, top, height, radius: lerp(0.17, 0.23, r[6]), seed: r[7], front, fronds: [],
            };
            const n = detail.fronds;
            const spin = rand() * Math.PI * 2;
            for (let k = 0; k < n; k += 1) {
                const age = ((k * 0.618034 + r[7] * 3.7) % 1);
                let kind = FROND_AGES.grown;
                if (age < 0.18) kind = FROND_AGES.young;
                else if (age > 0.78) kind = FROND_AGES.old;
                palm.fronds.push({
                    heading: spin + (k / n) * Math.PI * 2 + (rand() - 0.5) * 0.35,
                    rise: lerp(kind.rise[0], kind.rise[1], rand()) * DEG,
                    droop: lerp(kind.droop[0], kind.droop[1], rand()) * DEG,
                    length: lerp(PALMS.frond[0], PALMS.frond[1], rand()) * kind.length * (front ? 1 : 1.08),
                    span: lerp(PALMS.span[0], PALMS.span[1], rand()),
                    hang: lerp(24, 42, rand()) * DEG,
                });
            }
            palms.push(palm);
        }
    };
    rank(PALMS.from, PALMS.to, PALMS.gap, PALMS.out, PALMS.height, PALMS.tilt, true);
    rank(PALMS.backFrom, PALMS.backTo, PALMS.backGap, PALMS.back, PALMS.backHeight, PALMS.backTilt, false);
    const far = (p) => Math.hypot(p.foot[0] - EYE.x, p.foot[2] - EYE.z);
    return palms.sort((p, q) => far(q) - far(p));
}

// ── Geometry ────────────────────────────────────────────────────────────────────────────────

const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const add = (p, q) => [p[0] + q[0], p[1] + q[1], p[2] + q[2]];
const scale = (p, k) => [p[0] * k, p[1] * k, p[2] * k];
const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
const unit = (p) => {
    const l = Math.hypot(p[0], p[1], p[2]) || 1;
    return [p[0] / l, p[1] / l, p[2] / l];
};
const bezier = (p0, p1, p2, t) => {
    const u = 1 - t;
    return add(add(scale(p0, u * u), scale(p1, 2 * u * t)), scale(p2, t * t));
};
const bezierTangent = (p0, p1, p2, t) => unit(add(scale(sub(p1, p0), 2 * (1 - t)), scale(sub(p2, p1), 2 * t)));

/** The crown's knot: an octahedron (its corners, and its faces counter-clockwise from outside). */
const KNOT = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const KNOT_FACES = [[0, 2, 4], [0, 5, 2], [0, 4, 3], [0, 3, 5], [1, 4, 2], [1, 2, 5], [1, 3, 4], [1, 5, 3]];

/** A frond's leaflets' half-span at v along it: a bare stalk, longest a third of the way, short at the tip. */
export function frondEnvelope(v) {
    return smooth(0.04, 0.16, v) * (1 - 0.82 * v ** 1.6);
}

/**
 * The palms as arrays: position and normal (world), aPalm = (u across, v along, kind 0 trunk / 1
 * frond, seed) and an index list. Counted first and written in place (no growing arrays).
 */
export function buildPalmArrays(palms, detail) {
    const { sides, rings, segments } = detail;
    let vertices = 0;
    let indices = 0;
    palms.forEach((palm) => {
        vertices += (rings + 1) * (sides + 1) + KNOT.length + palm.fronds.length * (segments + 1) * 4;
        indices += rings * sides * 6 + KNOT_FACES.length * 3 + palm.fronds.length * segments * 12;
    });
    const pos = new Float32Array(vertices * 3);
    const nor = new Float32Array(vertices * 3);
    const tag = new Float32Array(vertices * 4);
    const index = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
    let count = 0;
    let at = 0;
    const vertex = (p, n, u, v, kind, seed) => {
        pos[count * 3] = p[0];
        pos[count * 3 + 1] = p[1];
        pos[count * 3 + 2] = p[2];
        nor[count * 3] = n[0];
        nor[count * 3 + 1] = n[1];
        nor[count * 3 + 2] = n[2];
        tag[count * 4] = u;
        tag[count * 4 + 1] = v;
        tag[count * 4 + 2] = kind;
        tag[count * 4 + 3] = seed;
        count += 1;
    };
    const tri = (a, b, c) => {
        index[at] = a;
        index[at + 1] = b;
        index[at + 2] = c;
        at += 3;
    };
    palms.forEach((palm) => {
        // The trunk: rings round the Bezier, a seam vertex closing each ring.
        const first = count;
        for (let i = 0; i <= rings; i += 1) {
            const t = i / rings;
            const c = bezier(palm.foot, palm.ctrl, palm.top, t);
            const T = bezierTangent(palm.foot, palm.ctrl, palm.top, t);
            const n1 = unit(cross(T, [1, 0, 0.3]));
            const n2 = cross(T, n1);
            const r = palm.radius * (1 - 0.32 * t) + 0.16 * Math.exp(-t * 16);
            for (let j = 0; j <= sides; j += 1) {
                const phi = (j / sides) * Math.PI * 2;
                const n = add(scale(n1, Math.cos(phi)), scale(n2, Math.sin(phi)));
                vertex(add(c, scale(n, r)), n, (j / sides) * 2 - 1, t, 0, palm.seed);
            }
        }
        const row = sides + 1;
        for (let i = 0; i < rings; i += 1) {
            for (let j = 0; j < sides; j += 1) {
                const q = first + i * row + j;
                // Counter-clockwise seen from outside, so the front face is the one the normal leaves.
                tri(q, q + 1, q + row);
                tri(q + 1, q + row + 1, q + row);
            }
        }
        // The knot where the fronds spring (their bases, the nuts): a dark lump under the crown.
        const knot = count;
        const heart = add(palm.top, [0, -0.3, 0]);
        KNOT.forEach((d) => vertex(add(heart, [d[0] * 0.5, d[1] * 0.45, d[2] * 0.5]), d, 0, 1, 0, palm.seed));
        KNOT_FACES.forEach((f) => tri(knot + f[0], knot + f[1], knot + f[2]));

        // The fronds: a drooping rachis each, the leaflets hung off it in a tent. Four vertices
        // across (left edge, rachis twice, right edge) so each half keeps its own facing.
        palm.fronds.forEach((frond) => {
            const h = [Math.cos(frond.heading), 0, Math.sin(frond.heading)];
            const side = unit(cross(h, UP));
            let p = palm.top.slice();
            const base = count;
            const ds = frond.length / segments;
            for (let i = 0; i <= segments; i += 1) {
                const v = i / segments;
                const theta = frond.rise - frond.droop * v ** 1.3;
                const T = add(scale(h, Math.cos(theta)), scale(UP, Math.sin(theta)));
                if (i > 0) p = add(p, scale(T, ds));
                // Never narrower than the stalk itself.
                const w = frond.span * Math.max(frondEnvelope(v), 0.07);
                const out = Math.cos(frond.hang) * w;
                const down = Math.sin(frond.hang) * w;
                const left = add(add(p, scale(side, -out)), [0, -down, 0]);
                const right = add(add(p, scale(side, out)), [0, -down, 0]);
                // Each half's facing across its own slope (up the sky's way on all but the steepest
                // hanging fronds), wound to match: the fragment turns it to the side it is seen from.
                const nl = unit(cross(sub(p, left), T));
                const nr = unit(cross(sub(right, p), T));
                vertex(left, nl, -1, v, 1, palm.seed);
                vertex(p, nl, 0, v, 1, palm.seed);
                vertex(p, nr, 0, v, 1, palm.seed);
                vertex(right, nr, 1, v, 1, palm.seed);
            }
            for (let i = 0; i < segments; i += 1) {
                const q = base + i * 4;
                // Counter-clockwise seen from the side each half's normal faces.
                tri(q, q + 1, q + 4);
                tri(q + 1, q + 5, q + 4);
                tri(q + 2, q + 3, q + 6);
                tri(q + 3, q + 7, q + 6);
            }
        });
    });
    return {
        position: pos, normal: nor, palm: tag, index,
    };
}

/**
 * The palms a tier plants along the jungle's edge `lineAt` and their arrays, baked once per
 * (density, seed, line) and kept between builds (shared/bake-cache.js: read-only).
 */
export function bakePalms({
    density, lineAt, lineKey, seed = 7,
}) {
    return bakeOnce(`luminous-tides:palms:${density}:${seed}:${lineKey}`, () => {
        const plan = planPalms({ density, lineAt, seed });
        return { plan, arrays: buildPalmArrays(plan, palmDetail(density)) };
    });
}

// ── The mesh ────────────────────────────────────────────────────────────────────────────────

/** How finely a frond is cut into leaflets (along it, a whole frond), and how much of each step is leaf. */
const LEAFLETS = 30;
const LEAF = 0.7;
/** What the trunk and the fronds keep of the light (scene-linear albedo). */
const TRUNK = [0.2, 0.17, 0.14];
const FROND = [0.17, 0.26, 0.13];
/** The sea breeze: inland, a little along the shore. */
const WIND = unit([-OUT[0] + ALONG[0] * 0.3, 0, -OUT[2] + ALONG[2] * 0.3]);

/** The palms' mesh. `lineAt` is the jungle's edge (s at a), `lineKey` names it for the bake cache. */
export function createPalms({
    tier, U, lineAt, lineKey, seed = 7,
}) {
    const { plan, arrays } = bakePalms({
        density: tier.palms, lineAt, lineKey, seed,
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(arrays.position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(arrays.normal, 3));
    geometry.setAttribute('aPalm', new THREE.BufferAttribute(arrays.palm, 4));
    geometry.setIndex(new THREE.BufferAttribute(arrays.index, 1));
    geometry.computeBoundingSphere();

    const material = new THREE.MeshBasicNodeMaterial({
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: true,
        fog: false,
    });
    material.name = 'luminous-tides-palms';
    const aPalm = attribute('aPalm', 'vec4');
    const aNormal = attribute('normal', 'vec3');

    // The breeze: the trunk bends a little more the higher up it is; the crown rides on its top
    // and every frond flutters, more toward its tip.
    material.positionNode = Fn(() => {
        const v = aPalm.y;
        const kind = aPalm.z;
        const phase = aPalm.w.mul(6.2832);
        const gust = sin(U.time.mul(0.55).add(phase)).mul(0.5).add(0.5)
            .mul(sin(U.time.mul(0.23).add(phase.mul(0.37))).mul(0.3).add(0.7));
        const bend = mix(v.mul(v), float(1.0), kind).mul(0.22).mul(gust);
        const tip = v.mul(v).mul(kind);
        const flutter = sin(U.time.mul(2.1).add(phase.mul(3.0)).add(v.mul(4.0))).mul(0.09).mul(tip);
        const lift = sin(U.time.mul(1.3).add(phase.mul(1.7)).add(v.mul(2.0))).mul(0.12).mul(tip);
        const sway = vec3(WIND[0], 0.0, WIND[2]).mul(bend.add(flutter).add(tip.mul(gust).mul(0.35)));
        return positionLocal.add(sway).add(vec3(0.0, lift.sub(tip.mul(gust).mul(0.18)), 0.0));
    })();

    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    material.fragmentNode = Fn(() => {
        const u = aPalm.x;
        const v = aPalm.y;
        const kind = aPalm.z;
        const seedP = aPalm.w;

        // The leaflets: a comb swept toward the frond's tip, each its own length; finer than a
        // pixel it fades to its average cover. The rachis is always there.
        const along = v.mul(LEAFLETS).add(abs(u).mul(0.9)).toVar();
        const leaf = floor(along);
        const f = fract(along);
        const dw = max(fwidth(along), 1e-4).toVar();
        const blade = smoothstep(0.0, dw, f).mul(smoothstep(float(LEAF), float(LEAF).sub(dw), f));
        const comb = mix(blade, float(LEAF), smoothstep(0.35, 0.9, dw));
        const reach = hash21(vec2(leaf, seedP.mul(91.0))).mul(0.32).add(0.66);
        const du = max(fwidth(u), 1e-4).toVar();
        const leaflets = comb.mul(smoothstep(reach.add(du), reach.sub(du), abs(u)));
        const rib = smoothstep(du.mul(1.5).add(0.06), float(0.06), abs(u));
        const alpha = mix(float(1.0), max(leaflets, rib), kind).toVar();

        const P = positionWorld;
        const toEye = cameraPosition.sub(P);
        const dist = length(toEye);
        const V = toEye.div(max(dist, 1e-3)).toVar();
        const N = normalize(aNormal).mul(faceDirection).toVar();
        const s = shoreOf(P.xz).y;
        const lift = max(P.y.sub(1.0), 0.0);
        // Self-shade: the crown's heart and the trunk's neck under it are in their own shadow.
        const shade = mix(
            float(1.0).sub(smoothstep(0.78, 1.0, v).mul(0.6)),
            smoothstep(0.0, 0.5, v).mul(0.55).add(0.45),
            kind,
        );
        const tone = seedP.mul(0.5).add(0.75);
        const albedo = mix(vec3(...TRUNK), vec3(...FROND), kind).mul(shade).mul(tone);
        // The sky wraps a trunk's edges; a frond is thin and faces up, all of it "edge" to a level
        // sight line, so it keeps only a breath of that (the sky shows through it instead).
        const lit = landLight(N, V, albedo, lift, s.negate(), mix(float(0.5), float(0.1), kind), U);
        // Thin leaves let a little of the sky behind them through.
        const through = skyBase(V.negate(), U).mul(U.squallDim).mul(kind.mul(0.08));
        const air = horizonHaze(V.negate(), U);
        const colour = mix(lit.add(through), air, landHaze(dist, U));
        return vec4(colour.mul(alpha), alpha);
    })();
    material.blending = THREE.CustomBlending;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneMinusSrcAlphaFactor;
    material.alphaTest = 0.02;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'luminous-tides-palms';
    mesh.frustumCulled = false;
    mesh.renderOrder = 21;
    return {
        mesh,
        plan,
        dispose() {
            mesh.removeFromParent();
            geometry.dispose();
            material.dispose();
        },
    };
}
