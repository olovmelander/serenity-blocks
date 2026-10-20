/**
 * Synthwave Sunset — the palms: three tall framing palms on the beach at the right edge of the
 * game view, and a row along the promenade receding round the bay.
 *
 * Silhouettes against the sunset: curved, tapered trunks and a crown of folded fronds whose
 * leaflets are cut in the fragment shader (anti-aliased, so the edges do not crawl as the wind
 * moves them). Toward the sun the fronds turn faintly translucent-warm; edges catch a warm rim;
 * the near palms pick up the pier's pink and mint light on their lower trunks.
 *
 * All palms are ONE merged mesh. Wind is a vertex-stage offset: a slow trunk sway growing with
 * height plus a frond flutter growing toward the tips.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    clamp,
    dot,
    float,
    fract,
    fwidth,
    length,
    max,
    mix,
    normalize,
    normalWorld,
    positionLocal,
    positionWorld,
    pow,
    sin,
    smoothstep,
    step,
    uv,
    vec3,
} from 'three/tsl';
import { SHORE, rgb } from './synthwave-sunset-tsl.js';
import { inlandOf } from './synthwave-sunset-sea.js';

const DEG = Math.PI / 180;

/**
 * The framing palms (world x, z): on the beach just off the right edge of the game view, their
 * crowns high over the pier's land end. `lean` is a world azimuth (deg, 0 = −z) the trunk bows
 * toward. Lower tiers keep a prefix of the promenade row.
 */
const FRAMING = [
    {
        x: 24, z: 12.5, height: 15.5, lean: -95, leanAmount: 0.22, fronds: 14, scale: 1.08,
    },
    {
        x: 19.5, z: 15.8, height: 13.6, lean: -80, leanAmount: 0.26, fronds: 13, scale: 1.0,
    },
    {
        x: 29.5, z: 9.4, height: 12.2, lean: -120, leanAmount: 0.18, fronds: 13, scale: 0.95,
    },
];

/** The promenade row: one palm every `spacing` metres of x, on the beach side of the boulevard. */
function promenadePalms(count, rand) {
    const out = [];
    for (let i = 0; i < count; i += 1) {
        const x = 118 + i * 17 + rand() * 4;
        const q = inlandOf(x, SHORE.promenade + 3.5);
        out.push({
            x: q.x,
            z: q.z,
            height: 11 + rand() * 4,
            lean: -60 - rand() * 80,
            leanAmount: 0.08 + rand() * 0.1,
            fronds: 11,
            scale: 0.95 + rand() * 0.15,
        });
    }
    return out;
}

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function buildPalm(out, spec, rand, palmIndex) {
    const phase = palmIndex * 1.7 + rand() * 6.28;
    const bx = spec.x;
    const bz = spec.z;
    const lx = Math.sin(spec.lean * DEG);
    const lz = -Math.cos(spec.lean * DEG);
    const H = spec.height;
    const S = spec.scale;
    const spine = (s) => {
        const bow = spec.leanAmount * H * s ** 1.7;
        return v3(bx + lx * bow, s * H, bz + lz * bow);
    };

    // ── Trunk: a tapered tube ──
    const RINGS = 14;
    const SEG = 7;
    const trunkBase = out.position.length / 3;
    const tangent = v3();
    const n1 = v3();
    const n2 = v3();
    const offset = v3();
    for (let r = 0; r <= RINGS; r += 1) {
        const s = r / RINGS;
        const c = spine(s);
        tangent.copy(spine(Math.min(1, s + 0.02))).sub(spine(Math.max(0, s - 0.02))).normalize();
        n1.crossVectors(tangent, v3(0, 0, 1)).normalize();
        n2.crossVectors(tangent, n1).normalize();
        const radius = (0.34 - 0.15 * s + 0.2 * Math.exp(-s * 14)) * S;
        for (let k = 0; k <= SEG; k += 1) {
            const a = (k / SEG) * Math.PI * 2;
            offset.copy(n1).multiplyScalar(Math.cos(a)).addScaledVector(n2, Math.sin(a));
            out.position.push(c.x + offset.x * radius, c.y + offset.y * radius, c.z + offset.z * radius);
            out.normal.push(offset.x, offset.y, offset.z);
            out.uv.push(s, k / SEG);
            out.palm.push(phase, 0, 0, s);
        }
    }
    for (let r = 0; r < RINGS; r += 1) {
        for (let k = 0; k < SEG; k += 1) {
            const a = trunkBase + r * (SEG + 1) + k;
            const b = a + SEG + 1;
            out.index.push(a, b, a + 1, a + 1, b, b + 1);
        }
    }

    // ── Fronds: folded strips arching out and drooping from the crown ──
    const crown = spine(1);
    const up = v3(0, 1, 0);
    const N = 12;
    const q = v3();
    const qn = v3();
    const side = v3();
    const fup = v3();
    for (let f = 0; f < spec.fronds; f += 1) {
        const theta = (f / spec.fronds) * Math.PI * 2 + (rand() - 0.5) * 0.35;
        const pitch = f % 3 === 0 ? 0.5 + rand() * 0.2 : 0.12 + rand() * 0.28;
        const L = (5.0 + rand() * 1.9) * S;
        const droop = 0.85 + rand() * 0.6;
        const W = (0.82 + rand() * 0.26) * S;
        const dx = Math.cos(theta);
        const dz = Math.sin(theta);
        const at = (t, target) => target.set(
            crown.x + dx * t * L * Math.cos(pitch),
            crown.y + t * L * Math.sin(pitch) - droop * L * t * t * 0.55,
            crown.z + dz * t * L * Math.cos(pitch),
        );
        const frondBase = out.position.length / 3;
        for (let i = 0; i <= N; i += 1) {
            const t = i / N;
            at(t, q);
            at(Math.min(1, t + 0.02), qn);
            tangent.copy(qn).sub(q);
            if (t >= 1) tangent.copy(q).sub(at(0.98, qn));
            tangent.normalize();
            side.crossVectors(tangent, up).normalize();
            fup.crossVectors(side, tangent).normalize();
            const w = W * Math.sin(Math.PI * Math.min(t, 0.999)) ** 0.55 * Math.min(1, t / 0.12);
            const lift = w * 0.28;
            const verts = [
                [q.x - side.x * w, q.y - side.y * w, q.z - side.z * w, -1],
                [q.x + fup.x * lift, q.y + fup.y * lift, q.z + fup.z * lift, 0],
                [q.x + side.x * w, q.y + side.y * w, q.z + side.z * w, 1],
            ];
            for (const vtx of verts) {
                out.position.push(vtx[0], vtx[1], vtx[2]);
                out.normal.push(fup.x, fup.y, fup.z);
                out.uv.push(t, vtx[3]);
                out.palm.push(phase + f * 0.7, t, 1, 1);
            }
        }
        for (let i = 0; i < N; i += 1) {
            const a = frondBase + i * 3;
            const b = a + 3;
            out.index.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
        }
    }
}

/**
 * @param {object} u  shared world uniforms
 * @param {object} opts
 * @param {() => number} opts.rand
 * @param {number} opts.count  palms in the promenade row (the three framing palms always stand)
 * @returns {THREE.Mesh}
 */
export function createPalms(u, { rand, count }) {
    const placements = FRAMING.concat(promenadePalms(Math.max(0, count | 0), rand));
    const out = {
        position: [], normal: [], uv: [], palm: [], index: [],
    };
    placements.forEach((spec, i) => buildPalm(out, spec, rand, i));

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(out.position, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(out.normal, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2));
    geometry.setAttribute('aPalm', new THREE.Float32BufferAttribute(out.palm, 4));
    geometry.setIndex(out.index);
    geometry.computeBoundingSphere();

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'SynthwavePalms';
    material.side = THREE.DoubleSide;
    material.transparent = true;
    material.depthWrite = true;
    material.fog = false;

    const palm = attribute('aPalm', 'vec4');

    // ── Wind ──
    material.positionNode = Fn(() => {
        const phase = palm.x;
        const flex = palm.y;
        const heightFrac = palm.w;
        const t = u.time;
        const sway = heightFrac.mul(heightFrac);
        const swayX = sin(t.mul(0.55).add(phase)).mul(0.2).mul(sway);
        const swayZ = sin(t.mul(0.43).add(phase.mul(1.3))).mul(0.12).mul(sway);
        const flutter = pow(flex, 1.5);
        const fy = sin(t.mul(1.7).add(phase).add(flex.mul(2.4))).mul(0.2).mul(flutter);
        const fx = sin(t.mul(1.1).add(phase.mul(1.3))).mul(0.14).mul(flutter);
        return positionLocal.add(vec3(swayX.add(fx), fy, swayZ));
    })();

    // ── Leaflet cut-outs + silhouette shading ──
    const frondUv = uv();
    material.opacityNode = Fn(() => {
        const isFrond = step(0.5, palm.z);
        const along = frondUv.x;
        const across = frondUv.y;
        const lp = along.mul(26.0).sub(abs(across).mul(1.6));
        const f = fract(lp);
        const fwL = max(fwidth(lp), 1e-4);
        const half = smoothstep(0.1, 0.6, abs(across)).mul(0.28);
        const inGap = float(1.0).sub(smoothstep(half.sub(fwL), half.add(fwL), abs(f.sub(0.5))))
            .mul(clamp(half.div(fwL), 0.0, 1.0));
        // Leaflets reach furthest at their centres (f near 0/1), least beside a gap (f = 0.5).
        const tipReach = float(0.72).add(abs(f.sub(0.5)).mul(0.52));
        const fwT = max(fwidth(across), 1e-4);
        const inside = float(1.0).sub(smoothstep(tipReach.sub(fwT), tipReach.add(fwT), abs(across)));
        const frondAlpha = float(1.0).sub(inGap).mul(inside);
        return frondAlpha.mul(isFrond).add(float(1.0).sub(isFrond));
    })();

    material.colorNode = Fn(() => {
        const V = normalize(positionWorld.sub(cameraPosition));
        const heightFrac = palm.w;
        const isFrond = step(0.5, palm.z);
        const toward = pow(max(dot(V, u.sunDir), 0.0), 60.0);
        const translucent = rgb(0xff6a48).mul(toward.mul(float(0.05).add(isFrond.mul(0.14))));
        // The pier's lights on the lower trunks of the near palms.
        const near = float(1.0).sub(smoothstep(30.0, 60.0, length(positionWorld.sub(cameraPosition))));
        const low = clamp(float(1.0).sub(heightFrac), 0.0, 1.0);
        const bounce = rgb(0xff5fa8).mul(low.mul(low).mul(0.035).mul(float(1.0).sub(isFrond)).mul(near));
        const facing = abs(dot(normalize(normalWorld), V));
        const rim = rgb(0xff8a6a).mul(pow(float(1.0).sub(facing), 3.0).mul(0.12).mul(mix(float(1.0), float(0.4), u.dusk)));
        return rgb(0x0e0814).add(translucent).add(bounce).add(rim);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'SynthwavePalms';
    mesh.renderOrder = 10;
    mesh.frustumCulled = false;
    return mesh;
}
