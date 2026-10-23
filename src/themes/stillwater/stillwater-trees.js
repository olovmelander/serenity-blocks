/**
 * Stillwater — the old spruces.
 *
 * Trunks: every tree on the banks is built on the CPU and merged into ONE mesh — a column that
 * wanders a little as it rises, spreads into buttress roots where it meets the moss, and carries
 * a few dead stubs. The bark is drawn in the fragment stage: plates and fissures stretched up the
 * trunk, moss climbing from the foot, lichen higher up, the mist's own light on the flanks.
 *
 * Boughs: the two giants' hanging spruce boughs (the long curtains of an old "hänggran"), each a
 * spine with a curtain of twigs below it and a fan to either side, cut out of ribbons in the
 * fragment stage; they hang into the top of the frame and stir with the air. Out in the wood the
 * same ribbons are the old trunks' dead branches, hung with pale beards of lichen.
 *
 * Crowns: every tree on the banks ends in a spruce's crown, whorl under whorl of drooping
 * branches with the twigs hanging from them in curtains; the trees by the water keep their low
 * branches. Each crown is drawn on one card that turns about the trunk to face the eye, a little
 * in front of the trunk so the needles hide it, and is cut out in the fragment stage.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    ceil,
    clamp,
    dot,
    float,
    floor,
    fract,
    length,
    log2,
    max,
    min,
    mix,
    normalWorld,
    normalize,
    positionLocal,
    positionWorld,
    sin,
    smoothstep,
    step,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    DEG, EYE, lerp, mulberry32, smooth,
} from './stillwater-core.js';
import {
    azimuthOf, crownFloor, rangeOf, shoreDistance, valueNoise,
} from './stillwater-plan.js';
import {
    NOISE_SIZE, swFog, swFogAmount, swHash11, swHaze, swLight, swPart,
} from './stillwater-tsl.js';

/**
 * A tree's own numbers (its seed, a crown's shape) as the fragment stage reads them: flat, not
 * interpolated. Interpolated across a card, a constant comes out a few bits off from pixel to
 * pixel, and a hash of it then changes at random from one pixel to the next: a branch, a twig, a
 * beard of lichen long here and short beside it, a speckle round every tip that crawls as the view
 * breathes.
 */
const flat = (node, name) => varying(node, name).setInterpolation('flat', 'either');

// ── Trunks ──────────────────────────────────────────────────────────────────────

/** A trunk's radius at a height and an angle round it (metres). */
export function trunkRadius(t, y, angle) {
    const h = Math.max(0, y);
    const taper = 1 - 0.42 * Math.min(1, h / t.height) ** 0.8;
    // Buttress roots: a few lobes that spread where the trunk meets the ground.
    const lobes = 3 + Math.floor((t.seed * 7.3) % 3);
    const lobe = Math.max(0, Math.cos(angle * lobes + t.seed * 3.1)) ** 1.6;
    const flare = t.roots * Math.exp(-h / (t.radius * 1.5)) * (0.22 + 0.8 * lobe);
    const lump = (valueNoise(angle * 1.9 + t.seed * 5, h * 0.33 + t.seed) - 0.5) * 0.12;
    return t.radius * (taper * (1 + flare) + lump);
}

/** The trunk's centre line at a height (it leans, and wanders a little). */
export function trunkCentre(t, y, out = [0, 0, 0]) {
    const wander = Math.sin(y * 0.31 + t.seed) * 0.13 * t.radius + Math.sin(y * 0.11 + t.seed * 2.3) * 0.35 * t.radius;
    out[0] = t.x + t.lean[0] * y + wander;
    out[1] = t.y + y;
    out[2] = t.z + t.lean[1] * y + Math.cos(y * 0.27 + t.seed * 1.7) * 0.11 * t.radius;
    return out;
}

/**
 * All trunks as one geometry (stage space).
 * @param {Array} plan  planTrunks()
 */
export function createTrunkGeometry(plan) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const seeds = [];
    const index = [];
    const c = [0, 0, 0];
    const addTube = (rings, sides, pointAt, uvAt, seed) => {
        const base = positions.length / 3;
        const grid = [];
        for (let k = 0; k <= rings; k++) {
            for (let a = 0; a <= sides; a++) {
                const p = pointAt(k, a % sides);
                grid.push(p);
                positions.push(p[0], p[1], p[2]);
                const st = uvAt(k, a);
                uvs.push(st[0], st[1]);
                seeds.push(seed);
            }
        }
        const at = (k, a) => grid[Math.max(0, Math.min(rings, k)) * (sides + 1) + (((a % sides) + sides) % sides)];
        for (let k = 0; k <= rings; k++) {
            for (let a = 0; a <= sides; a++) {
                const u1 = at(k, a + 1);
                const u0 = at(k, a - 1);
                const v1 = at(k + 1, a);
                const v0 = at(k - 1, a);
                const ux = u1[0] - u0[0];
                const uy = u1[1] - u0[1];
                const uz = u1[2] - u0[2];
                const vx = v1[0] - v0[0];
                const vy = v1[1] - v0[1];
                const vz = v1[2] - v0[2];
                // (round the trunk) × (up the trunk) points outward for a ring that runs anticlockwise from above.
                let nx = uy * vz - uz * vy;
                let ny = uz * vx - ux * vz;
                let nz = ux * vy - uy * vx;
                const l = Math.hypot(nx, ny, nz) || 1;
                nx /= l;
                ny /= l;
                nz /= l;
                normals.push(nx, ny, nz);
            }
        }
        for (let k = 0; k < rings; k++) {
            for (let a = 0; a < sides; a++) {
                const i0 = base + k * (sides + 1) + a;
                const i1 = i0 + 1;
                const i2 = i0 + sides + 1;
                const i3 = i2 + 1;
                index.push(i0, i1, i2, i1, i3, i2);
            }
        }
    };

    plan.forEach((t) => {
        const near = t.hero || rangeOf(t.x, t.z) < 26;
        // Detail by how closely it will be looked at: the giants, the near ranks, the rest.
        const detail = (t.hero && 2) || (near && 1) || 0;
        const sides = [8, 12, 20][detail];
        const rings = [9, 16, 26][detail];
        // Rings crowd toward the foot, where the roots are.
        const heightAt = (k) => -0.5 + (t.height + 0.5) * (k / rings) ** 2.1;
        addTube(rings, sides, (k, a) => {
            const y = heightAt(k);
            // Anticlockwise seen from above: +x toward −z.
            const angle = (a / sides) * Math.PI * 2;
            const r = trunkRadius(t, y, angle);
            trunkCentre(t, y, c);
            return [c[0] + Math.cos(angle) * r, c[1], c[2] - Math.sin(angle) * r];
        }, (k, a) => [a / sides, heightAt(k)], t.seed);

        // Dead stubs: what is left of the lower branches.
        const rand = mulberry32(Math.round(t.seed * 1000) + 77);
        const stubs = near ? 3 + Math.floor(rand() * 5) : 1 + Math.floor(rand() * 2);
        for (let s = 0; s < stubs; s++) {
            const y0 = lerp(1.6, Math.min(13, t.height * 0.5), rand());
            const yaw = rand() * Math.PI * 2;
            const len = lerp(0.4, 2.1, rand() * rand()) * (0.7 + t.radius);
            const thick = lerp(0.03, 0.075, rand()) * (0.6 + t.radius);
            const droop = lerp(0.05, 0.5, rand());
            trunkCentre(t, y0, c);
            const from = [c[0], c[1], c[2]];
            const dir = [Math.cos(yaw), 0, -Math.sin(yaw)];
            const start = trunkRadius(t, y0, yaw) * 0.7;
            // A frame across the stub: up × `dir` = `side`, so the ring runs the right way round.
            const side = [dir[2], 0, -dir[0]];
            addTube(3, 5, (k, a) => {
                const f = k / 3;
                const along = start + len * f;
                const r = thick * (1 - f * 0.85);
                const angle = (a / 5) * Math.PI * 2;
                const cx = from[0] + dir[0] * along;
                const cy = from[1] - droop * f * f * len + Math.sin(f * 2.2) * 0.06;
                const cz = from[2] + dir[2] * along;
                return [
                    cx + side[0] * Math.cos(angle) * r,
                    cy + Math.sin(angle) * r,
                    cz + side[2] * Math.cos(angle) * r,
                ];
            }, (k, a) => [a / 5, y0 + k * 0.3], t.seed + s);
        }
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(seeds), 1));
    geometry.setIndex(index);
    return geometry;
}

export function createTrunks(u, plan) {
    const geometry = createTrunkGeometry(plan);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'StillwaterTrunks';
    material.fog = false;
    material.toneMapped = false;
    material.fragmentNode = Fn(() => {
        const P = positionWorld;
        const st = uv().toVar();
        const seed = attribute('aSeed', 'float').toVar();
        const N0 = normalize(normalWorld).toVar();
        // Plates and fissures, drawn out up the trunk.
        const around = st.x.mul(3.1);
        const plates = u.noise(vec2(around.add(seed.mul(0.37)), st.y.mul(0.085).add(seed.mul(0.11)))).toVar();
        const fissures = u.noise(vec2(around.mul(2.7).add(seed), st.y.mul(0.33))).toVar();
        const grain = u.noise(vec2(around.mul(7.0), st.y.mul(1.7))).toVar();
        const ridge = float(1.0).sub(abs(plates.r.mul(2.0).sub(1.0)));
        const crack = smoothstep(0.62, 0.96, ridge.mul(0.55).add(float(1.0).sub(abs(fissures.g.mul(2.0).sub(1.0))).mul(0.45)));
        const bark = u.bark.mul(plates.b.mul(0.7).add(0.62)).mul(float(1.0).sub(crack.mul(0.62)))
            .mul(grain.r.mul(0.3).add(0.85)).toVar();
        // Lichen pales the bark in patches higher up.
        const lichen = smoothstep(0.58, 0.8, plates.a).mul(smoothstep(1.5, 5.0, st.y)).mul(0.5);
        bark.assign(mix(bark, u.stone.mul(1.25).mul(grain.g.mul(0.4).add(0.8)), lichen));
        // Moss climbs from the foot, further on some sides than others.
        const reach = plates.g.mul(2.6).add(fissures.r.mul(0.9)).add(0.35);
        const mossy = float(1.0).sub(smoothstep(reach.mul(0.45), reach, st.y)).toVar();
        const albedo = mix(bark, u.moss.mul(grain.b.mul(0.5).add(0.72)), mossy.mul(0.9)).toVar();
        const N = normalize(N0.add(vec3(fissures.r.sub(0.5), 0.0, fissures.b.sub(0.5))
            .mul(float(0.5).sub(mossy.mul(0.3))))).toVar();
        const lit = swLight(u, albedo, N, P, { wrap: 0.22 }).toVar();
        // The mist's own light lies on a trunk's flanks: its edges are soft, never drawn.
        const V = normalize(P.sub(cameraPosition));
        const flank = float(1.0).sub(abs(dot(N0, V)));
        const f2 = flank.mul(flank);
        lit.addAssign(swHaze(u, V).mul(f2.mul(flank)).mul(swFogAmount(u, P).mul(0.6).add(0.34)).mul(0.38));
        // Looking toward the moon, a trunk's edge takes a thread of its light.
        const toMoon = smoothstep(0.55, 0.98, dot(V, u.moonDir));
        // (A trunk drawn in on a narrow frame is all edge: the thread thins with it.)
        const thread = u.squeeze.mul(u.squeeze).mul(0.5);
        lit.addAssign(u.moonLight.mul(f2.mul(f2)).mul(toMoon).mul(thread).mul(u.breath.mul(0.5).add(0.5)));
        return vec4(swFog(u, lit, P), 1.0);
    })();
    const part = swPart('StillwaterTrunks', geometry, material, 4);
    part.count = plan.length;
    return part;
}

// ── Crowns ──────────────────────────────────────────────────────────────────────

/** How far the card reaches past a crown's widest whorl, and below its foot (metres). */
const CROWN_SPAN = 1.2;
const CROWN_HANG = 0.9;

/**
 * Each tree's crown. Each: { x, y, z (its foot: where the lowest whorl leaves the trunk, stage
 * space), width (its half-width at the foot), length (foot to tip), spacing (between whorls),
 * push (how far in front of the trunk's axis the card stands), lean: [x, z], seed }. The giants
 * beside the viewer have none: their tops are far out of the frame and their boughs fringe it.
 */
export function planCrowns(trunks, seed = 5113) {
    const rand = mulberry32(seed);
    const out = [];
    const c = [0, 0, 0];
    trunks.forEach((t) => {
        // (Every trunk draws its numbers, crown or not: one tree's rule never moves another's crown.)
        const r = [rand(), rand(), rand(), rand(), rand()];
        const range = rangeOf(t.x, t.z);
        if (t.hero && range < 9) return;
        // A spruce at the water's edge has the light from the tarn and keeps its low branches.
        const byWater = 1 - smooth(1.2, 5.5, shoreDistance(t.x, t.z));
        const tip = t.height + lerp(0.8, 2.2, r[0]);
        let foot = t.height * lerp(lerp(0.42, 0.58, r[1]), lerp(0.13, 0.27, r[1]), byWater);
        let width = Math.min(3.6, Math.max(1.2, (tip - foot) * lerp(0.17, 0.24, r[2]) * lerp(1, 1.15, byWater)));
        // A crown that would reach into a window starts above it.
        const above = crownFloor(t.x, t.z, width * CROWN_SPAN);
        if (above !== null) foot = Math.max(foot, EYE.y + range * Math.tan(above) - t.y);
        foot = Math.min(foot, tip - 3);
        const span = tip - foot;
        width = Math.min(width, Math.max(1, span * 0.3));
        trunkCentre(t, foot, c);
        out.push({
            x: c[0],
            y: c[1],
            z: c[2],
            width,
            length: span,
            spacing: span / Math.max(4, Math.round(span / lerp(0.62, 0.95, r[3]))),
            push: trunkRadius(t, foot, 0) + 0.3,
            lean: [t.lean[0], t.lean[1]],
            seed: r[4] * 100,
        });
    });
    return out;
}

/**
 * The CPU twin of the vertex stage: where a crown's card stands (world metres) for an eye at
 * `eye` ([x, y, z], world) and the stage drawn in by `squeeze`, at rest (no air stirring it).
 * Corners: foot left, foot right, top left, top right.
 */
export function crownCard(k, eye, squeeze = 1) {
    let fx = eye[0] - k.x * squeeze;
    let fz = eye[2] - k.z;
    const l = Math.hypot(fx, fz) || 1;
    fx /= l;
    fz /= l;
    const corner = (cx, cy) => {
        const across = cx * k.width * CROWN_SPAN;
        const y = lerp(-CROWN_HANG, k.length + 0.3, cy);
        const x = fz * across + k.lean[0] * y + fx * k.push;
        const z = -fx * across + k.lean[1] * y + fz * k.push;
        return [(k.x + x) * squeeze, k.y + y, k.z + z];
    };
    return [corner(-1, 0), corner(1, 0), corner(-1, 1), corner(1, 1)];
}

/**
 * The crowns as one geometry: four corners per crown, all at the crown's foot; the vertex stage
 * spreads them into a card that faces the eye (crownCard).
 */
export function createCrownGeometry(plan) {
    const positions = [];
    const corners = [];
    const shapes = [];
    const leans = [];
    const index = [];
    plan.forEach((k, i) => {
        [[-1, 0], [1, 0], [-1, 1], [1, 1]].forEach(([x, y]) => {
            positions.push(k.x, k.y, k.z);
            corners.push(x, y);
            shapes.push(k.width, k.length, k.spacing, k.seed);
            leans.push(k.lean[0], k.lean[1], k.push, 0);
        });
        const b = i * 4;
        index.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('aCorner', new THREE.BufferAttribute(new Float32Array(corners), 2));
    geometry.setAttribute('aCrown', new THREE.BufferAttribute(new Float32Array(shapes), 4));
    geometry.setAttribute('aCrownLean', new THREE.BufferAttribute(new Float32Array(leans), 4));
    geometry.setIndex(index);
    return geometry;
}

/**
 * @param {object} u
 * @param {Array} plan  planCrowns()
 * @param {object} [opts]
 * @param {number} [opts.samples=0]  the scene pass's samples: with more than one, the cut-out
 *   edge is laid down by coverage (alpha to coverage) rather than all or nothing
 */
export function createCrowns(u, plan, { samples = 0 } = {}) {
    const geometry = createCrownGeometry(plan);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'StillwaterCrowns';
    material.side = THREE.DoubleSide;
    material.fog = false;
    material.toneMapped = false;
    const coverage = samples > 1;
    material.alphaToCoverage = coverage;
    const corner = attribute('aCorner', 'vec2');
    const shape = attribute('aCrown', 'vec4');
    const more = attribute('aCrownLean', 'vec4');
    material.positionNode = Fn(() => {
        const anchor = positionLocal;
        // The card turns about the trunk to face the eye (the mirror's eye too), in the world's
        // frame: the stage is only drawn in along x.
        const toEye = cameraPosition.xz.sub(vec2(anchor.x.mul(u.squeeze), anchor.z));
        const f = toEye.div(max(length(toEye), 1e-3));
        const across = corner.x.mul(shape.x).mul(CROWN_SPAN);
        const y = mix(float(-CROWN_HANG), shape.y.add(0.3), corner.y);
        // The top stirs with the air; the foot hardly does.
        const k = clamp(y.div(shape.y), 0.0, 1.0);
        const slow = sin(u.sway.mul(0.23).add(shape.w.mul(1.7))).mul(0.4);
        const stir = sin(u.sway.mul(0.45).add(shape.w)).mul(0.6).add(slow)
            .mul(k.mul(k))
            .mul(u.wind.mul(0.6).add(0.15));
        return anchor.add(vec3(
            f.y.mul(across).add(more.x.mul(y)).add(f.x.mul(more.z)).add(stir),
            y,
            f.x.negate().mul(across).add(more.y.mul(y)).add(f.y.mul(more.z)),
        ));
    })();
    const tree = flat(shape, 'vCrownShape');
    material.fragmentNode = Fn(() => {
        const W = tree.x;
        const L = tree.y;
        const s = tree.z;
        const seed = tree.w;
        const X = corner.x.mul(W).mul(CROWN_SPAN).toVar();
        const Y = mix(float(-CROWN_HANG), L.add(0.3), corner.y).toVar();
        const ax = abs(X).toVar();
        const side = step(0.0, X).mul(2.0).sub(1.0).toVar();
        const P = positionWorld;
        const rel = P.sub(cameraPosition);
        // Metres one pixel spans here: the cut-out's edge is drawn to it, and fine detail fades with it.
        const pxm = max(length(rel).mul(u.pixelAngle), 1e-4).toVar();
        const fine = float(1.0).sub(smoothstep(0.025, 0.05, pxm)).toVar();
        // (The whorl's own noise is read at the level this pixel's footprint calls for: its
        // coordinates jump from one whorl to the next, and a level taken from the screen's
        // differences would blur to grey on every 2 × 2 block across a whorl's line.)
        const coarseLod = log2(max(pxm.mul(1.7 * NOISE_SIZE), 1.0)).toVar();
        // The crown's outline: a narrow cone (some trees fuller, some more of a spire), its lowest
        // whorls short and sparse where the light no longer reaches them.
        const form = swHash11(seed.mul(5.3)).mul(0.4).add(0.72);
        const env = (y) => W.mul(clamp(float(1.0).sub(y.div(L)), 0.0, 1.0).pow(form))
            .mul(smoothstep(s.mul(-0.5), s.mul(4.5), y).mul(0.8).add(0.2));

        // Two whorls can reach a point: the one just above it, and the one above that (its
        // branches droop and its curtains hang a whole whorl down).
        const whorl = (j) => {
            const yw = j.mul(s);
            const h1 = swHash11(j.mul(2.0).add(side).add(seed.mul(13.0)));
            const h2 = swHash11(j.mul(3.1).add(side.mul(1.7)).add(seed.mul(7.0)));
            const lower = clamp(float(1.0).sub(yw.div(L)), 0.0, 1.0);
            // Now and then a branch is broken short.
            const broken = mix(float(0.45), float(1.0), step(0.12, h2));
            const R = env(yw).mul(h1.mul(0.55).add(0.62)).mul(broken).add(0.12);
            const q = clamp(ax.div(R), 0.0, 1.0);
            // The branch leaves the trunk level and bows under its weight toward the tip.
            const droop = s.mul(h2.mul(0.6).add(0.5)).mul(lower.mul(0.7).add(0.45));
            const yb = yw.sub(droop.mul(q.pow(1.6)));
            // Its twigs hang below it in a curtain: ragged, longest along its middle, short at the
            // tip, long enough that the curtains of one whorl reach the branches of the next.
            const coarse = u.noise(vec2(X.mul(1.7).add(j.mul(0.37)), j.mul(0.173).add(seed.mul(0.01))))
                .level(coarseLod).r;
            const col = swHash11(floor(X.mul(7.0)).add(j.mul(13.0)).add(seed));
            const rag = mix(coarse, coarse.mul(0.45).add(col.mul(0.55)), fine);
            const belly = sin(min(q.mul(1.1), 1.0).mul(Math.PI)).mul(0.5).add(0.5);
            const hang = s.mul(h1.mul(0.5).add(0.75)).mul(rag.mul(0.8).add(0.45)).mul(lower.mul(0.5).add(0.6))
                .mul(belly);
            const taper = float(1.0).sub(q.mul(q).mul(q).mul(q));
            const dTip = R.sub(ax).mul(0.8);
            const dTop = yb.add(s.mul(0.16).mul(taper)).sub(Y);
            const dBot = Y.sub(yb.sub(hang.mul(taper.mul(0.6).add(0.4))));
            return {
                d: min(dTip, min(dTop, dBot)), yb, hang, q, h1,
            };
        };
        const jA = ceil(Y.div(s)).toVar();
        const a = whorl(jA);
        const b = whorl(jA.add(1.0));
        // Close round the trunk the whorls run together into one dark mass.
        const knot = u.noise(vec2(Y.mul(0.9).add(seed), seed.mul(0.37))).g;
        const dCore = env(Y).mul(knot.mul(0.14).add(0.12)).add(0.1).sub(ax)
            .min(Y.add(0.3));
        const inside = max(max(a.d, b.d), dCore).toVar();

        // Beard lichen hangs in pale tufts from the lower branches of some trees.
        const tuftX = X.mul(4.5).add(seed);
        const tuft = swHash11(floor(tuftX).add(jA.mul(7.0)).add(seed.mul(3.0)));
        const tuftLen = s.mul(tuft.mul(0.9).add(0.5));
        const tuftTop = a.yb.sub(a.hang.mul(0.35));
        const across = abs(fract(tuftX).sub(0.5)).mul(1 / 4.5);
        const narrow = mix(float(0.05), float(0.012), clamp(tuftTop.sub(Y).div(tuftLen), 0.0, 1.0));
        const lichenOn = step(0.7, tuft).mul(step(0.45, swHash11(seed.mul(1.9))))
            .mul(step(Y, L.mul(0.55))).mul(step(a.q, 0.92))
            .mul(fine);
        const dLichen = min(narrow.sub(across), min(tuftTop.sub(Y), Y.sub(tuftTop.sub(tuftLen)))).mul(lichenOn)
            .sub(float(1.0).sub(lichenOn).mul(10.0));
        const lichen = step(inside, dLichen).toVar();
        inside.assign(max(inside, dLichen));

        const cover = clamp(inside.div(pxm).add(0.5), 0.0, 1.0).toVar();
        if (!coverage) cover.lessThan(0.5).discard();

        // Light: the crown as a mass, open to the sky on the upper side of each whorl, dark inside.
        const V = normalize(rel);
        const fwd = normalize(vec3(V.x.negate(), 0.0, V.z.negate()));
        const right = vec3(fwd.z, 0.0, fwd.x.negate());
        const nx = clamp(X.div(max(env(Y), 0.35)), -1.0, 1.0);
        const nearTop = smoothstep(a.hang.mul(0.7), 0.0, a.yb.sub(Y));
        const N = normalize(right.mul(nx.mul(0.85)).add(vec3(0.0, nearTop.mul(0.8).sub(0.15), 0.0))
            .add(fwd.mul(float(1.0).sub(abs(nx).mul(0.5))))).toVar();
        const tone = a.h1.mul(0.3).add(0.8).mul(smoothstep(0.0, 0.7, a.q).mul(0.2).add(0.8))
            .mul(nearTop.mul(0.2).add(0.9));
        const albedo = mix(u.needle.mul(tone), u.stone.mul(1.5).add(u.moss.mul(0.35)), lichen).toVar();
        const lit = swLight(u, albedo, N, P, { wrap: 0.6 }).toVar();
        // Close to the moon the outline takes a thread of its light, through the needles.
        // (Only out at the branches' ends: the seams between whorls inside the crown stay dark.)
        const edge = float(1.0).sub(smoothstep(0.0, pxm.mul(3.0).add(0.08), inside)).mul(smoothstep(0.55, 0.9, a.q));
        const toMoon = smoothstep(0.955, 0.995, dot(V, u.moonDir));
        lit.addAssign(u.moonLight.mul(edge.mul(0.5).add(lichen.mul(0.3))).mul(toMoon)
            .mul(u.breath.mul(0.5).add(0.5)).mul(0.5));
        return vec4(swFog(u, lit, P), coverage ? cover : 1.0);
    })();
    const part = swPart('StillwaterCrowns', geometry, material, 5);
    part.count = plan.length;
    part.plan = plan;
    return part;
}

// ── Boughs ──────────────────────────────────────────────────────────────────────

/**
 * Which boughs hang where. Each: { x, y, z (the foot, stage space), yaw, length, curtain, rise,
 * seed, fringe }. They are hung where they will show: along the top of the frame, clear of the
 * moon. `fringe` marks the boughs of the two giants beside the viewer.
 */
export function planBoughs(trunks, count = 46, seed = 1907) {
    const rand = mulberry32(seed);
    const out = [];
    const c = [0, 0, 0];
    const hang = (t, elevation, reach, bias) => {
        const range = rangeOf(t.x, t.z);
        const height = Math.max(2.2, EYE.y + range * Math.tan(elevation) - t.y);
        if (height > t.height * 0.8) return;
        // Nothing hangs across the moon.
        const taz = azimuthOf(t.x, t.z) / DEG;
        const moonSide = taz < -8 && taz > -40;
        if (moonSide && elevation / DEG < 17.5 && Math.abs(taz + 19.5) < 9) return;
        // The giants' boughs reach out over the water; the rest grow across the view.
        const inward = (t.x < 0 ? 1 : -1) * (range < 9 || rand() < 0.5 ? 1 : -1);
        const a = lerp(-0.75, 0.55, rand()) + bias;
        let yaw = Math.atan2(-Math.sin(a), inward * Math.cos(a));
        if (range >= 9) {
            // Out in the wood a bough hangs across the line of sight: pointing along it, seen from
            // below, its arc would read as a shelf on the trunk.
            const sx = (t.x - EYE.x) / range;
            const sz = (t.z - EYE.z) / range;
            yaw = Math.atan2(sx * inward, -sz * inward) + a * 0.35;
        }
        trunkCentre(t, height, c);
        out.push({
            x: c[0],
            y: c[1],
            z: c[2],
            yaw,
            length: reach * lerp(0.8, 1.15, rand()),
            // (A bough close to the eye is kept short: it fringes the picture, it does not hang across it.)
            curtain: lerp(0.7, 1.3, rand()) * Math.min(1.2, 0.3 + range * 0.05),
            rise: lerp(0.05, 0.3, rand()),
            seed: rand() * 100,
            // The giants' own: the fringe along the top of a wide frame (a narrow one leaves it out).
            fringe: t.hero && range < 9,
        });
    };
    // The two giants that frame the view: their low boughs fringe the top of the picture.
    trunks.filter((t) => t.hero && rangeOf(t.x, t.z) < 9).forEach((t) => {
        [18.5, 20, 21.5, 19, 17.6, 22.5].forEach((e, i) => hang(t, e * DEG, lerp(2.6, 4.4, rand()), (i - 2.5) * 0.26));
    });
    // (Not from the near trunks: seen steeply from below, a bough's arc there reads as a hoop.)
    const rest = trunks.filter((t) => !(t.hero && rangeOf(t.x, t.z) < 9) && rangeOf(t.x, t.z) >= 16
        && rangeOf(t.x, t.z) < 44 && Math.abs(azimuthOf(t.x, t.z)) < 44 * DEG)
        .sort((a, b) => rangeOf(a.x, a.z) - rangeOf(b.x, b.z));
    let round = 0;
    while (out.length < count && round < 5) {
        for (let i = 0; i < rest.length && out.length < count; i++) {
            const t = rest[i];
            const range = rangeOf(t.x, t.z);
            const e = lerp(7, 24, rand()) * DEG;
            hang(t, e, lerp(0.9, 2.1, rand()) * (range > 22 ? 1.2 : 1), 0);
        }
        round += 1;
    }
    return out.slice(0, count);
}

const BOUGH_SEGMENTS = 8;

/**
 * @param {object} u
 * @param {Array} plan  planBoughs()
 * @param {string} [name]
 * @param {object} [opts]
 * @param {number} [opts.samples=0]  the scene pass's samples (the twigs' edges by coverage above one)
 * @param {boolean} [opts.lichen=false]  dead branches hung with beard lichen instead of living ones
 */
export function createBoughs(u, plan, name = 'StillwaterBoughs', { samples = 0, lichen = false } = {}) {
    const positions = [];
    const uvs = [];
    const sways = [];
    const seeds = [];
    const index = [];
    plan.forEach((b) => {
        const dir = [Math.cos(b.yaw), 0, Math.sin(b.yaw)];
        const side = [-dir[2], 0, dir[0]];
        const spine = (s, o) => {
            // Out, up a little, then down under its own weight.
            const y = b.y + b.length * (b.rise * s - 0.17 * s * s);
            o[0] = b.x + dir[0] * b.length * s;
            o[1] = y;
            o[2] = b.z + dir[2] * b.length * s;
            return o;
        };
        const ribbon = (across, drop, twist) => {
            const base = positions.length / 3;
            const p = [0, 0, 0];
            for (let k = 0; k <= BOUGH_SEGMENTS; k++) {
                const s = k / BOUGH_SEGMENTS;
                spine(s, p);
                // The curtain is longest in the bough's middle.
                const len = b.curtain * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, s * 1.08)) ** 0.7);
                positions.push(p[0], p[1] + 0.03, p[2]);
                positions.push(
                    p[0] + side[0] * across * len,
                    p[1] - drop * len,
                    p[2] + side[2] * across * len,
                );
                uvs.push(s * b.length, 0, s * b.length, 1);
                // The free edge stirs; the spine hardly does.
                sways.push(side[0] * 0.02, 0.01, side[2] * 0.02, s * 6.3 + b.seed);
                sways.push(side[0] * twist + dir[0] * 0.05, 0.02, side[2] * twist + dir[2] * 0.05, s * 6.3 + b.seed + 1.1);
                seeds.push(b.seed, b.seed);
            }
            for (let k = 0; k < BOUGH_SEGMENTS; k++) {
                const i0 = base + k * 2;
                index.push(i0, i0 + 1, i0 + 2, i0 + 2, i0 + 1, i0 + 3);
            }
        };
        ribbon(0.0, 1.0, 0.16); // the curtain
        // The giants' boughs, seen against the sky, fan out to either side. (Lower down a bough on
        // a far trunk is seen from below, where fans read as a shelf: it is a curtain only.)
        if (b.fringe) {
            ribbon(0.62, 0.42, 0.1);
            ribbon(-0.62, 0.42, 0.1);
        }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    geometry.setAttribute('aSway', new THREE.BufferAttribute(new Float32Array(sways), 4));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(seeds), 1));
    geometry.setIndex(index);

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = name;
    material.side = THREE.DoubleSide;
    material.fog = false;
    material.toneMapped = false;
    const sway = attribute('aSway', 'vec4');
    material.positionNode = Fn(() => {
        const phase = sway.w;
        const stir = sin(u.sway.mul(0.9).add(phase)).mul(0.6).add(sin(u.sway.mul(0.37).add(phase.mul(1.7))).mul(0.4));
        return positionLocal.add(sway.xyz.mul(stir).mul(u.wind.mul(2.2).add(0.45)));
    })();
    const coverage = samples > 1;
    material.alphaToCoverage = coverage;
    const seed = flat(attribute('aSeed', 'float'), 'vBoughSeed');
    material.fragmentNode = lichen ? lichenFragment(u, coverage, seed) : Fn(() => {
        const st = uv().toVar();
        const P = positionWorld;
        // Metres a pixel spans here: twigs narrower than a few pixels close into one curtain.
        const pxm = max(length(P.sub(cameraPosition)).mul(u.pixelAngle), 1e-4).toVar();
        const PITCH = 24.0;
        const fine = float(1.0).sub(smoothstep(0.25, 0.5, pxm.mul(PITCH))).toVar();
        // The curtain's hem rises and falls in soft scallops; under it hang the twigs, closely set,
        // each its own length, wavering toward its end.
        const hem = u.noise(vec2(st.x.mul(0.5).add(seed.mul(0.23)), seed.mul(0.071))).g.toVar();
        const swell = u.noise(vec2(st.x.mul(2.2).add(seed.mul(0.61)), seed.mul(0.13).add(0.5))).b;
        const reach = hem.mul(0.55).add(swell.mul(0.35)).add(0.22).toVar();
        const waver = u.noise(vec2(st.x.mul(0.9).add(seed.mul(0.37)), st.y.mul(0.8).add(seed.mul(0.11)))).r
            .sub(0.5).mul(st.y).mul(1.8);
        const x = st.x.mul(PITCH).add(waver).add(seed.mul(3.7));
        const id = floor(x);
        const f = fract(x);
        const own = swHash11(id.add(seed.mul(13.0)));
        // (Now and then a twig is missing or short: the light shows through.)
        const len = reach.mul(own.mul(0.5).add(0.62)).mul(mix(float(0.35), float(1.0), step(0.1, own)));
        const along = clamp(st.y.div(max(len, 1e-3)), 0.0, 1.0);
        // A twig: a stem tapering to its tip, feathered with needles on both sides.
        const needles = abs(fract(st.y.mul(34.0).add(own.mul(3.0))).sub(0.5)).mul(2.0);
        // (Near the branch they crowd into one dark band; lower down they part.)
        const half = float(0.3).mul(float(1.0).sub(along.mul(along).mul(0.8)))
            .add(needles.mul(0.2).mul(float(1.0).sub(along)))
            .add(float(1.0).sub(smoothstep(0.0, 0.35, along)).mul(0.25));
        // (Twig widths are in places: one place is 1/PITCH metres.)
        const twigEdge = half.sub(abs(f.sub(0.5))).div(max(pxm.mul(PITCH), 1e-3));
        const twig = clamp(twigEdge.add(0.5), 0.0, 1.0).mul(clamp(len.sub(st.y).div(pxm).add(0.5), 0.0, 1.0));
        // Far off, the twigs are one curtain with that same scalloped hem.
        const curtain = clamp(reach.mul(0.82).sub(st.y).div(pxm).add(0.5), 0.0, 1.0);
        const strand = mix(curtain, twig, fine);
        const branch = clamp(float(0.05).sub(smoothstep(0.0, 4.5, st.x).mul(0.025)).sub(st.y).div(pxm)
            .add(0.5), 0.0, 1.0);
        const cover = max(strand, branch).toVar();
        if (!coverage) cover.lessThan(0.5).discard();
        // Needles: near black-green, a twig's tip a little fresher; the upper side takes what light there is.
        const tone = own.mul(0.35).add(0.72).mul(along.mul(0.25).add(0.9));
        const albedo = mix(u.needle.mul(tone), u.bark.mul(0.8), branch);
        const upper = float(1.0).sub(smoothstep(0.0, 0.5, st.y));
        const N = normalize(vec3(0.0, upper.mul(0.6).add(0.1), 0.25));
        const col = swLight(u, albedo, N, P, { wrap: 0.8, shade: float(0.3) }).toVar();
        // Against the moon the needles' edges take a little of its light.
        const V = normalize(P.sub(cameraPosition));
        const toMoon = smoothstep(0.93, 0.995, dot(V, u.moonDir));
        col.addAssign(u.moonLight.mul(toMoon).mul(float(1.0).sub(clamp(twigEdge, 0.0, 1.0)))
            .mul(fine).mul(0.1));
        return vec4(swFog(u, col, P), coverage ? cover : 1.0);
    })();
    const part = swPart(name, geometry, material, 5);
    part.count = plan.length;
    return part;
}

/**
 * A dead branch hung with beard lichen: a dark stick thinning to its end, and pale strands of
 * lichen hanging from it in beards, each its own length, wavering. Far off, the beards are a
 * faint pale curtain.
 */
function lichenFragment(u, coverage, seed) {
    return Fn(() => {
        const st = uv().toVar();
        const P = positionWorld;
        const pxm = max(length(P.sub(cameraPosition)).mul(u.pixelAngle), 1e-4).toVar();
        const PITCH = 11.0;
        const fine = float(1.0).sub(smoothstep(0.3, 0.6, pxm.mul(PITCH))).toVar();
        // The stick: thinning toward its end.
        const thick = mix(float(0.05), float(0.016), smoothstep(0.0, 2.2, st.x));
        const branch = clamp(thick.sub(st.y).div(pxm).add(0.5), 0.0, 1.0).toVar();
        // The beards: only some places along the stick carry one; each is its own length.
        const waver = u.noise(vec2(st.x.mul(1.3).add(seed.mul(0.37)), st.y.mul(1.1).add(seed.mul(0.11)))).r
            .sub(0.5).mul(st.y).mul(2.2);
        const x = st.x.mul(PITCH).add(waver).add(seed.mul(3.7));
        const id = floor(x);
        const f = fract(x);
        const own = swHash11(id.add(seed.mul(13.0)));
        const clump = u.noise(vec2(st.x.mul(0.8).add(seed.mul(0.29)), seed.mul(0.05))).g;
        const has = step(0.5, own.mul(0.55).add(clump.mul(0.6)));
        const len = own.mul(0.55).add(0.3).mul(clump.mul(0.7).add(0.45));
        const along = clamp(st.y.div(max(len, 1e-3)), 0.0, 1.0);
        const half = float(0.2).mul(float(1.0).sub(along.mul(0.75)));
        const strand = clamp(half.sub(abs(f.sub(0.5))).div(max(pxm.mul(PITCH), 1e-3)).add(0.5), 0.0, 1.0)
            .mul(clamp(len.sub(st.y).div(pxm).add(0.5), 0.0, 1.0)).mul(has);
        const curtain = clamp(clump.mul(0.5).sub(st.y).div(pxm).add(0.5), 0.0, 1.0).mul(0.4);
        const beard = mix(curtain, strand, fine);
        const cover = max(beard, branch).toVar();
        if (!coverage) cover.lessThan(0.5).discard();
        // Lichen: pale grey-green, lit softly all round; the stick dark.
        const V = normalize(P.sub(cameraPosition));
        const pale = mix(u.stone.mul(3.2), u.moss.mul(2.4), 0.3);
        const albedo = mix(pale, u.bark.mul(0.7), branch);
        const N = normalize(vec3(0.0, 0.35, 0.0).sub(V));
        const col = swLight(u, albedo, N, P, { wrap: 1.0 }).toVar();
        // Against the moon its filaments take a little of its light.
        const toMoon = smoothstep(0.9, 0.995, dot(V, u.moonDir));
        col.addAssign(u.moonLight.mul(toMoon).mul(float(1.0).sub(branch)).mul(0.2));
        return vec4(swFog(u, col, P), coverage ? cover : 1.0);
    })();
}
