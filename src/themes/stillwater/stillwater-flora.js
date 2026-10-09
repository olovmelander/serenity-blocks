/**
 * Stillwater — what grows there.
 *
 *   saplings   young spruces on the banks: the wood's understorey, dark against the mist
 *   ferns      crowns of fronds on the moss
 *   reeds      in the shallows, stirring with the air
 *   pads       water-lily pads lying on the tarn in rafts off both banks
 *   lilies     the white water lilies among them: shut at rest, they open as a chain grows and
 *              all at once when the tarn wakes
 *   caps       small glowing mushrooms in drifts on both banks, lit from the frame's edge inward
 *              as a chain grows (the chain's own count, written into the place)
 *
 * Each is ONE instanced draw whose vertex stage places a unit shape from per-instance numbers
 * (stage space: the world hangs these meshes in the stage group).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    atan,
    attribute,
    cos,
    float,
    fract,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
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
    swFog, swHash11, swLight, swPart,
} from './stillwater-tsl.js';

const lit = (name) => {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = name;
    material.fog = false;
    material.toneMapped = false;
    return material;
};

const instanced = (geometry, count, attributes) => {
    Object.keys(attributes).forEach((key) => {
        geometry.setAttribute(key, new THREE.InstancedBufferAttribute(attributes[key].data, attributes[key].size));
    });
    const mesh = new THREE.InstancedMesh(geometry, null, Math.max(1, count));
    mesh.count = count;
    mesh.frustumCulled = false;
    return mesh;
};

/** Turn a point of a unit shape about the vertical by an angle (a node), scale it and stand it at a place. */
const stand = (shape, at, yaw, scale) => {
    const c = cos(yaw);
    const s = sin(yaw);
    return vec3(
        at.x.add(shape.x.mul(c).add(shape.z.mul(s)).mul(scale.x)),
        at.y.add(shape.y.mul(scale.y)),
        at.z.add(shape.z.mul(c).sub(shape.x.mul(s)).mul(scale.x)),
    );
};

// ── Saplings ────────────────────────────────────────────────────────────────────

/** A young spruce one unit tall: a stem and tiers of boughs, each a drooping cone. */
export function createSaplingGeometry() {
    const positions = [];
    const normals = [];
    const index = [];
    const sides = 7;
    const cone = (y0, y1, r, droop) => {
        const base = positions.length / 3;
        for (let a = 0; a < sides; a++) {
            const an = (a / sides) * Math.PI * 2;
            // The skirt is uneven: boughs, not a lampshade.
            const rr = r * (0.82 + 0.18 * Math.cos(an * 3 + y0 * 9));
            positions.push(Math.cos(an) * rr, y0 - droop, -Math.sin(an) * rr);
            const slope = r / Math.max(1e-3, y1 - y0);
            const l = Math.hypot(1, slope);
            normals.push(Math.cos(an) / l, slope / l, -Math.sin(an) / l);
        }
        positions.push(0, y1, 0);
        normals.push(0, 1, 0);
        for (let a = 0; a < sides; a++) index.push(base + a, base + ((a + 1) % sides), base + sides);
    };
    cone(0.0, 0.22, 0.03, 0);
    cone(0.1, 0.5, 0.2, 0.03);
    cone(0.3, 0.68, 0.16, 0.025);
    cone(0.48, 0.84, 0.12, 0.02);
    cone(0.64, 0.94, 0.085, 0.015);
    cone(0.8, 1.0, 0.05, 0.01);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
    geometry.setIndex(index);
    return geometry;
}

export function createSaplings(u, plan) {
    const geometry = createSaplingGeometry();
    const at = new Float32Array(plan.length * 4);
    const more = new Float32Array(plan.length * 2);
    plan.forEach((s, i) => {
        at.set([s.x, s.y - 0.05, s.z, s.height], i * 4);
        more.set([s.yaw, s.width], i * 2);
    });
    const mesh = instanced(geometry, plan.length, { aSapAt: { data: at, size: 4 }, aSapMore: { data: more, size: 2 } });
    const material = lit('StillwaterSaplings');
    const aAt = attribute('aSapAt', 'vec4');
    const aMore = attribute('aSapMore', 'vec2');
    const vHeight = varying(positionGeometry.y, 'vSapHeight');
    material.positionNode = stand(positionGeometry, aAt.xyz, aMore.x, vec2(aAt.w.mul(aMore.y), aAt.w));
    material.fragmentNode = Fn(() => {
        const P = positionWorld;
        const tone = u.noise(P.xz.mul(0.9)).r.mul(0.5).add(0.7);
        // The boughs take the sky's light from above and keep their own dark below.
        const N = normalize(vec3(0.0, vHeight.mul(0.5).add(0.5), 0.35));
        const col = swLight(u, u.needle.mul(tone), N, P, { wrap: 0.9, shade: float(0.6) });
        return vec4(swFog(u, col, P), 1.0);
    })();
    mesh.material = material;
    const part = swPart('StillwaterSaplings', geometry, material, 5, { mesh });
    part.count = plan.length;
    return part;
}

// ── Ferns ───────────────────────────────────────────────────────────────────────

const FRONDS = 7;
const FROND_SEGMENTS = 6;

/** A crown of fronds about one unit across: each an arching ribbon, cut into pinnae in the fragment stage. */
export function createFernGeometry() {
    const positions = [];
    const uvs = [];
    const index = [];
    for (let f = 0; f < FRONDS; f++) {
        const an = (f / FRONDS) * Math.PI * 2 + (f % 2) * 0.2;
        const len = 0.72 + 0.28 * Math.cos(f * 2.1);
        const dir = [Math.cos(an), -Math.sin(an)];
        const side = [Math.sin(an), Math.cos(an)];
        const base = positions.length / 3;
        for (let k = 0; k <= FROND_SEGMENTS; k++) {
            const s = k / FROND_SEGMENTS;
            // Up out of the crown, then arching over.
            const out = s * len * (0.55 + 0.45 * s);
            const up = Math.sin(s * 2.4) * 0.5 * len - s * s * 0.14;
            const half = 0.17 * len;
            positions.push(dir[0] * out - side[0] * half, up, dir[1] * out - side[1] * half);
            positions.push(dir[0] * out + side[0] * half, up, dir[1] * out + side[1] * half);
            uvs.push(s, -1, s, 1);
        }
        for (let k = 0; k < FROND_SEGMENTS; k++) {
            const i0 = base + k * 2;
            index.push(i0, i0 + 1, i0 + 2, i0 + 2, i0 + 1, i0 + 3);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    geometry.setIndex(index);
    return geometry;
}

export function createFerns(u, plan) {
    const geometry = createFernGeometry();
    const at = new Float32Array(plan.length * 4);
    const more = new Float32Array(plan.length * 2);
    plan.forEach((f, i) => {
        at.set([f.x, f.y, f.z, f.size], i * 4);
        more.set([f.yaw, f.seed], i * 2);
    });
    const mesh = instanced(geometry, plan.length, { aFernAt: { data: at, size: 4 }, aFernMore: { data: more, size: 2 } });
    const material = lit('StillwaterFerns');
    material.side = THREE.DoubleSide;
    const aAt = attribute('aFernAt', 'vec4');
    const aMore = attribute('aFernMore', 'vec2');
    material.positionNode = Fn(() => {
        const st = uv();
        // The tips nod with the air.
        const nod = sin(u.sway.mul(1.1).add(aMore.y.mul(6.0)).add(st.x.mul(2.0))).mul(st.x.mul(st.x)).mul(u.wind.mul(0.12).add(0.015));
        const shape = vec3(positionGeometry.x, positionGeometry.y.add(nod), positionGeometry.z);
        return stand(shape, aAt.xyz, aMore.x, vec2(aAt.w, aAt.w));
    })();
    material.fragmentNode = Fn(() => {
        const st = uv().toVar();
        // Pinnae: teeth along a midrib, the frond widest a third of the way out.
        const envelope = sin(st.x.mul(0.86).add(0.08).mul(Math.PI)).pow(0.7).mul(float(1.0).sub(st.x.mul(0.25)));
        const tooth = abs(fract(st.x.mul(15.0)).sub(0.5)).mul(2.0);
        const reach = envelope.mul(float(0.3).add(float(0.7).mul(float(1.0).sub(tooth))));
        abs(st.y).greaterThan(max(reach, 0.06)).discard();
        const P = positionWorld;
        const tone = swHash11(aMore.y.mul(31.0)).mul(0.4).add(0.75);
        const albedo = mix(u.moss.mul(0.95), u.moss.mul(1.5).add(u.needle.mul(0.2)), st.x).mul(tone)
            .mul(float(1.0).sub(abs(st.y).mul(0.35)));
        const col = swLight(u, albedo, normalize(vec3(0.0, 1.0, 0.3)), P, { wrap: 0.9 });
        return vec4(swFog(u, col, P), 1.0);
    })();
    mesh.material = material;
    const part = swPart('StillwaterFerns', geometry, material, 7, { mesh });
    part.count = plan.length;
    return part;
}

// ── Reeds ───────────────────────────────────────────────────────────────────────

const REED_SEGMENTS = 5;

export function createReeds(u, plan) {
    const positions = [];
    const uvs = [];
    const index = [];
    for (let k = 0; k <= REED_SEGMENTS; k++) {
        const s = k / REED_SEGMENTS;
        const half = 0.5 * (1 - s * 0.9);
        positions.push(-half, s, 0, half, s, 0);
        uvs.push(0, s, 1, s);
    }
    for (let k = 0; k < REED_SEGMENTS; k++) {
        const i0 = k * 2;
        index.push(i0, i0 + 1, i0 + 2, i0 + 2, i0 + 1, i0 + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    geometry.setIndex(index);
    const at = new Float32Array(plan.length * 4);
    const more = new Float32Array(plan.length * 3);
    plan.forEach((r, i) => {
        at.set([r.x, r.y, r.z, r.height], i * 4);
        more.set([r.lean, r.seed, (r.seed * 7.7) % 6.283], i * 3);
    });
    const mesh = instanced(geometry, plan.length, { aReedAt: { data: at, size: 4 }, aReedMore: { data: more, size: 3 } });
    const material = lit('StillwaterReeds');
    material.side = THREE.DoubleSide;
    const aAt = attribute('aReedAt', 'vec4');
    const aMore = attribute('aReedMore', 'vec3');
    material.positionNode = Fn(() => {
        const s = positionGeometry.y;
        const bend = s.mul(s);
        // Each leans its own way and all stir together; a wave on the water shivers them.
        const stir = sin(u.sway.mul(1.3).add(aMore.y.mul(6.0))).mul(u.wind.mul(0.2).add(0.02));
        const lean = aMore.x.add(stir);
        const yaw = aMore.z;
        const width = aAt.w.mul(0.035).add(0.012);
        const shape = vec3(positionGeometry.x.mul(width), s.mul(aAt.w), 0.0);
        const p = stand(shape, aAt.xyz, yaw, vec2(1.0, 1.0));
        return vec3(p.x.add(bend.mul(lean).mul(aAt.w).mul(cos(yaw.mul(1.7)))), p.y.sub(bend.mul(abs(lean)).mul(aAt.w).mul(0.25)), p.z.add(bend.mul(lean).mul(aAt.w).mul(sin(yaw.mul(1.7)))));
    })();
    material.fragmentNode = Fn(() => {
        const st = uv();
        const P = positionWorld;
        const tone = swHash11(aMore.y.mul(17.0)).mul(0.5).add(0.7);
        // Last year's stalks among this year's: some are pale straw.
        const straw = step(0.72, swHash11(aMore.y.mul(5.3)));
        const green = mix(u.needle.mul(1.2), u.moss.mul(1.25), st.y);
        const albedo = mix(green, u.moss.mul(0.7).add(u.stone.mul(0.9)), straw.mul(0.8)).mul(tone);
        const col = swLight(u, albedo, normalize(vec3(0.0, 0.8, 0.5)), P, { wrap: 1.0 });
        return vec4(swFog(u, col, P), 1.0);
    })();
    mesh.material = material;
    const part = swPart('StillwaterReeds', geometry, material, 7, { mesh });
    part.count = plan.length;
    return part;
}

// ── Lily pads ───────────────────────────────────────────────────────────────────

/** A pad: a disc of radius one with a notch cut to its middle. Its normal is up. */
export function createPadGeometry(segments = 14) {
    const positions = [0, 0, 0];
    const uvs = [0.5, 0.5];
    const index = [];
    const notch = 0.42; // radians
    for (let i = 0; i <= segments; i++) {
        const an = notch * 0.5 + (i / segments) * (Math.PI * 2 - notch);
        // The rim is a little wavy.
        const r = 1 + 0.05 * Math.cos(an * 5);
        positions.push(Math.cos(an) * r, 0, -Math.sin(an) * r);
        uvs.push(0.5 + Math.cos(an) * 0.5, 0.5 - Math.sin(an) * 0.5);
    }
    for (let i = 1; i <= segments; i++) index.push(0, i, i + 1);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    geometry.setIndex(index);
    return geometry;
}

export function createPads(u, plan) {
    const geometry = createPadGeometry();
    const at = new Float32Array(plan.length * 4);
    plan.forEach((p, i) => {
        at.set([p.x, p.z, p.size, p.yaw], i * 4);
    });
    const mesh = instanced(geometry, plan.length, { aPad: { data: at, size: 4 } });
    const material = lit('StillwaterPads');
    material.side = THREE.DoubleSide;
    const aPad = attribute('aPad', 'vec4');
    material.positionNode = stand(positionGeometry, vec3(aPad.x, 0.012, aPad.y), aPad.w, vec2(aPad.z, 1.0));
    material.fragmentNode = Fn(() => {
        const st = uv().sub(0.5).mul(2.0);
        const r = length(st);
        const P = positionWorld;
        // Veins out from the stalk, a paler rim, the leaf darker toward its middle.
        const veins = abs(fract(atan(st.y, st.x).mul(1.75)).sub(0.5));
        const leaf = mix(u.moss.mul(0.75), u.moss.mul(1.5), r.mul(r))
            .mul(float(1.0).sub(smoothstep(0.42, 0.5, veins).mul(0.16).mul(smoothstep(0.1, 0.5, r))));
        const tone = swHash11(aPad.w.mul(11.0)).mul(0.4).add(0.8);
        const col = swLight(u, leaf.mul(tone), vec3(0.0, 1.0, 0.0), P, { wrap: 0.2 }).toVar();
        // A wet leaf throws the moon back where it faces it.
        col.addAssign(u.moonLight.mul(smoothstep(0.82, 1.0, r)).mul(0.035));
        return vec4(swFog(u, col, P), 1.0);
    })();
    mesh.material = material;
    const part = swPart('StillwaterPads', geometry, material, 32, { mesh });
    part.count = plan.length;
    return part;
}

// ── Water lilies ────────────────────────────────────────────────────────────────

const PETALS = [
    {
        count: 7, length: 1.0, shut: 1.42, open: 0.3,
    },
    {
        count: 6, length: 0.8, shut: 1.5, open: 0.82,
    },
    {
        count: 5, length: 0.58, shut: 1.55, open: 1.22,
    },
];

/**
 * A flower's petals as data for the vertex stage: each vertex knows its petal's bearing, its
 * whorl's two tilts (shut and open), how far along the petal it is and how far across.
 */
export function createLilyGeometry() {
    const petal = []; // bearing, along 0..1, across -1..1, length
    const tilt = []; // shut, open
    const index = [];
    const positions = [];
    PETALS.forEach((whorl, w) => {
        for (let p = 0; p < whorl.count; p++) {
            const bearing = (p / whorl.count) * Math.PI * 2 + w * 0.45;
            const base = positions.length / 3;
            [[0, 0], [0.45, -1], [0.45, 1], [1, 0]].forEach(([along, across]) => {
                positions.push(0, 0, 0);
                petal.push(bearing, along, across, whorl.length);
                tilt.push(whorl.shut, whorl.open);
            });
            index.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
        }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('aPetal', new THREE.BufferAttribute(new Float32Array(petal), 4));
    geometry.setAttribute('aTilt', new THREE.BufferAttribute(new Float32Array(tilt), 2));
    geometry.setIndex(index);
    return geometry;
}

/**
 * @param {object} u
 * @param {Array} plan  the pads that carry a flower (planLilies().filter(flower))
 */
export function createLilies(u, plan) {
    const geometry = createLilyGeometry();
    const at = new Float32Array(plan.length * 4);
    plan.forEach((p, i) => {
        // Each opens at its own moment of a chain: the first early, the last only for a long one.
        at.set([p.x + p.size * 0.35, p.z + p.size * 0.2, p.size * 0.62, plan.length > 1 ? i / (plan.length - 1) : 0], i * 4);
    });
    const mesh = instanced(geometry, plan.length, { aLily: { data: at, size: 4 } });
    const material = lit('StillwaterLilies');
    material.side = THREE.DoubleSide;
    const aLily = attribute('aLily', 'vec4');
    const aPetal = attribute('aPetal', 'vec4');
    const aTilt = attribute('aTilt', 'vec2');
    const open = max(
        smoothstep(aLily.w.mul(0.85), aLily.w.mul(0.85).add(0.15), u.lilies.x),
        smoothstep(aLily.w.mul(0.5), aLily.w.mul(0.5).add(0.5), u.lilies.y.mul(1.5)),
    );
    const vAlong = varying(aPetal.y, 'vLilyAlong');
    const vOpen = varying(open, 'vLilyOpen');
    material.positionNode = Fn(() => {
        const tiltNow = mix(aTilt.x, aTilt.y, open);
        const len = aPetal.w.mul(aLily.z);
        const out = aPetal.y.mul(len).mul(cos(tiltNow));
        const up = aPetal.y.mul(len).mul(sin(tiltNow));
        const wide = aPetal.z.mul(len).mul(0.2);
        const c = cos(aPetal.x);
        const s = sin(aPetal.x);
        return vec3(
            aLily.x.add(c.mul(out)).sub(s.mul(wide)),
            float(0.03).add(up),
            aLily.y.sub(s.mul(out)).sub(c.mul(wide)),
        );
    })();
    material.fragmentNode = Fn(() => {
        const P = positionWorld;
        // White petals, gold at the heart; an open flower holds a little light of its own.
        const petal = mix(u.heart.mul(0.9), u.lily, smoothstep(0.0, 0.5, vAlong));
        const col = swLight(u, petal.mul(0.55), normalize(vec3(0.0, 1.0, 0.2)), P, { wrap: 1.0, shade: float(0.8) }).toVar();
        col.addAssign(petal.mul(vOpen.mul(0.5).add(0.04)).mul(u.breath).mul(vAlong.mul(0.5).add(0.5)));
        return vec4(swFog(u, col, P), 1.0);
    })();
    mesh.material = material;
    const part = swPart('StillwaterLilies', geometry, material, 33, { mesh });
    part.count = plan.length;
    return part;
}

// ── Glowing caps ────────────────────────────────────────────────────────────────

/** A small mushroom one unit tall: a stem and a domed cap. */
export function createCapGeometry() {
    const positions = [];
    const normals = [];
    const kinds = []; // 0 stem, 1 cap
    const index = [];
    const sides = 7;
    // The stem.
    for (let k = 0; k <= 1; k++) {
        for (let a = 0; a < sides; a++) {
            const an = (a / sides) * Math.PI * 2;
            const r = 0.1 - k * 0.03;
            positions.push(Math.cos(an) * r, k * 0.62, -Math.sin(an) * r);
            normals.push(Math.cos(an), 0, -Math.sin(an));
            kinds.push(0);
        }
    }
    for (let a = 0; a < sides; a++) {
        const b = (a + 1) % sides;
        index.push(a, b, sides + a, b, sides + b, sides + a);
    }
    // The cap: a shallow dome, its rim a little below where it joins the stem.
    const rings = 3;
    const base = positions.length / 3;
    for (let k = 0; k <= rings; k++) {
        const t = k / rings;
        const r = Math.cos(t * Math.PI * 0.5) * 0.5;
        const y = 0.5 + Math.sin(t * Math.PI * 0.5) * 0.5;
        for (let a = 0; a < sides; a++) {
            const an = (a / sides) * Math.PI * 2;
            positions.push(Math.cos(an) * r, y, -Math.sin(an) * r);
            const l = Math.hypot(Math.cos(t * Math.PI * 0.5), Math.sin(t * Math.PI * 0.5));
            normals.push((Math.cos(an) * Math.cos(t * Math.PI * 0.5)) / l, Math.sin(t * Math.PI * 0.5) / l, (-Math.sin(an) * Math.cos(t * Math.PI * 0.5)) / l);
            kinds.push(1);
        }
    }
    for (let k = 0; k < rings; k++) {
        for (let a = 0; a < sides; a++) {
            const b = (a + 1) % sides;
            const i0 = base + k * sides + a;
            const i1 = base + k * sides + b;
            const i2 = base + (k + 1) * sides + a;
            const i3 = base + (k + 1) * sides + b;
            index.push(i0, i1, i2, i1, i3, i2);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
    geometry.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(kinds), 1));
    geometry.setIndex(index);
    return geometry;
}

export function createCaps(u, plan) {
    const geometry = createCapGeometry();
    const at = new Float32Array(plan.length * 4);
    const more = new Float32Array(plan.length * 3);
    plan.forEach((c, i) => {
        at.set([c.x, c.y - 0.01, c.z, c.size], i * 4);
        more.set([c.seed, c.side, c.order], i * 3);
    });
    const mesh = instanced(geometry, plan.length, { aCapAt: { data: at, size: 4 }, aCapMore: { data: more, size: 3 } });
    const material = lit('StillwaterCaps');
    const aAt = attribute('aCapAt', 'vec4');
    const aMore = attribute('aCapMore', 'vec3');
    const reach = mix(u.caps.x, u.caps.y, step(0.0, aMore.y));
    const glow = smoothstep(aMore.z.mul(0.92), aMore.z.mul(0.92).add(0.08), reach);
    const vGlow = varying(glow, 'vCapGlow');
    const vKind = varying(attribute('aKind', 'float'), 'vCapKind');
    const vSeed = varying(aMore.x, 'vCapSeed');
    const vUp = varying(positionGeometry.y, 'vCapUp');
    material.positionNode = stand(
        positionGeometry,
        aAt.xyz,
        aMore.x.mul(6.283),
        vec2(aAt.w.mul(swHash11(aMore.x.mul(3.0)).mul(0.5).add(0.9)), aAt.w.mul(1.5)),
    );
    material.fragmentNode = Fn(() => {
        const P = positionWorld;
        const pale = mix(u.stone.mul(0.9), u.stone.mul(1.6), vKind);
        const col = swLight(u, pale, normalize(vec3(0.0, 1.0, 0.2)), P, { wrap: 1.0, shade: float(0.7) }).toVar();
        // Foxfire: cold and green, strongest under the cap's rim; it breathes.
        const breathe = sin(u.time.mul(0.9).add(vSeed.mul(40.0))).mul(0.18).add(0.82);
        const fire = mix(u.crest, u.firefly, 0.3).mul(vKind.mul(0.8).add(0.2))
            .mul(float(1.6).sub(vUp.mul(0.7)));
        col.addAssign(fire.mul(vGlow.mul(1.9).add(0.05)).mul(breathe).mul(u.breath));
        return vec4(swFog(u, col, P), 1.0);
    })();
    mesh.material = material;
    const part = swPart('StillwaterCaps', geometry, material, 7, { mesh });
    part.count = plan.length;
    return part;
}
