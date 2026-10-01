/**
 * Nimbus Veil — the sea of clouds.
 *
 * A polar grid centred on the rest camera (dense near it, growing outward to the horizon, ~33k
 * vertices) displaced by a billowy eroded-fbm height field, so the near domes are real 3D
 * shapes, scrolling slowly toward the camera: a low flight over the clouds. The fragment lights
 * every dome from the field's ANALYTIC slope (no finite differences): wrap-lit gold tops facing
 * the low sun, lavender valleys, silver linings where the view looks toward the sun, and a
 * Gaussian haze that reaches the sky's exact horizon colour where the two meet.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    cameraPosition,
    clamp,
    dot,
    exp,
    float,
    length,
    max,
    mix,
    normalize,
    positionLocal,
    positionWorld,
    pow,
    smoothstep,
    vec2,
    vec3,
} from 'three/tsl';
import {
    RIG,
    nvApplyHaze,
    nvCloudField,
    nvNoise2,
    rgb,
} from './nimbus-veil-tsl.js';

/** Field scale (1 / feature size in world units) and dome height. */
export const SEA_SCALE = 1 / 34;
export const SEA_AMPLITUDE = 10;
/** The field is centred so the sea surface sits around y = 0. */
const SEA_OFFSET = 0.3;
/** Gaussian haze rate along the sea (1 / distance). */
export const SEA_HAZE = 1 / 1500;

/** Polar grid around the rest camera: rings grow geometrically, azimuth spans the yaw range. */
function buildSeaGeometry(rings, segments) {
    const r0 = 9;
    const growth = (3600 / r0) ** (1 / rings);
    const span = THREE.MathUtils.degToRad(124); // ± from the sun direction (−z)
    const position = new Float32Array((rings + 1) * (segments + 1) * 3);
    const index = [];
    let v = 0;
    for (let k = 0; k <= rings; k += 1) {
        const r = r0 * growth ** k;
        for (let s = 0; s <= segments; s += 1) {
            const a = -span + (2 * span * s) / segments;
            position[v * 3] = RIG.x + Math.sin(a) * r;
            position[v * 3 + 1] = 0;
            position[v * 3 + 2] = RIG.z - Math.cos(a) * r;
            v += 1;
        }
    }
    const row = segments + 1;
    for (let k = 0; k < rings; k += 1) {
        for (let s = 0; s < segments; s += 1) {
            const a = k * row + s;
            const b = a + row;
            index.push(a, a + 1, b, a + 1, b + 1, b);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setIndex(index);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(RIG.x, 0, RIG.z), 3700);
    return geometry;
}

/** Field sample point for a world position: scaled, scrolled toward the camera. */
const fieldPoint = (x, z, u) => vec2(x, z.sub(u.seaScroll)).mul(SEA_SCALE);

/** A gaussian light ring at distance `dist` for pulse slot P = (radius, 1/width, energy, 0). */
const ringTerm = (dist, P) => {
    const d = dist.sub(P.x).mul(P.y);
    return exp(d.mul(d).negate()).mul(P.z);
};

/**
 * @param {object} u  shared world uniforms
 * @param {object} [opts]
 * @param {number} [opts.rings=180]    radial resolution
 * @param {number} [opts.segments=180] angular resolution
 */
export function createCloudSea(u, opts = {}) {
    const geometry = buildSeaGeometry(opts.rings ?? 180, opts.segments ?? 180);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'NimbusCloudSea';
    material.fog = false;

    // ── Displacement: the same field the fragment lights ──
    material.positionNode = Fn(() => {
        const p = positionLocal;
        const f = nvCloudField(fieldPoint(p.x, p.z, u));
        const h = f.x.sub(SEA_OFFSET).mul(SEA_AMPLITUDE);
        return vec3(p.x, h, p.z);
    })();

    material.colorNode = Fn(() => {
        const p = positionWorld;
        const rel = p.sub(cameraPosition).toVar();
        const dist = length(vec2(rel.x, rel.z)).toVar();
        const f = nvCloudField(fieldPoint(p.x, p.z, u)).toVar();
        const height = f.x;
        // Slope in world units → normal; far away it relaxes toward up (sub-pixel domes would
        // only add shimmer under the haze).
        // Lighting uses a gentler slope than the geometry: full-strength normals turn the small
        // octaves into dune ripples; clouds scatter light and read soft.
        const slope = f.yz.mul(SEA_AMPLITUDE * SEA_SCALE * 0.62);
        const nRaw = normalize(vec3(slope.x.negate(), 1.0, slope.y.negate()));
        const n = normalize(mix(nRaw, vec3(0.0, 1.0, 0.0), smoothstep(260.0, 1300.0, dist))).toVar();
        const V = normalize(rel);
        const L = u.sunDir;

        // Wrap-lit domes: gold where they face the low sun, lavender in the shade.
        const ndl = dot(n, L);
        // The sun is low: a flat top gets a grazing ~0.16, so stretch the wrap until the faces
        // turned toward it blaze and the ones turned away fall into lavender shade.
        const diff = clamp(ndl.mul(1.5).add(0.32), 0.0, 1.0);
        const shade = mix(rgb(0x7476b4, 0.66), rgb(0xffe6c2, 1.2), pow(diff, 1.2));
        // Valleys (the creases between puffs) are occluded and bluer; crowns catch the light.
        // Near the camera the creases are seen at grazing angles: keep them lighter there.
        const occl = mix(mix(float(0.7), float(0.55), smoothstep(40.0, 160.0, dist)), float(1.0),
            smoothstep(0.12, 0.62, height));
        // Fine "cauliflower" grain in the shading only (the geometry stays smooth).
        const fp = vec2(p.x, p.z.sub(u.seaScroll)).mul(SEA_SCALE * 7.0);
        const grain = nvNoise2(fp).mul(0.6).add(nvNoise2(fp.mul(2.3)).mul(0.4));
        const col = shade.mul(occl).mul(mix(float(0.9), float(1.08), grain)).toVar();
        // Sky light from above, a touch of warm bounce on the sides.
        col.addAssign(rgb(0x9aa8e0).mul(n.y.mul(0.12)));
        // Silver lining: looking toward the sun, the thin dome edges glow (forward scattering).
        const toward = pow(max(dot(V, L), 0.0), 7.0);
        const edge = float(1.0).sub(n.y);
        const lining = toward.mul(edge.mul(2.2).add(0.18)).mul(float(1.0).add(u.sunPulse.mul(0.6)));
        col.addAssign(rgb(0xffd9a6, 1.6).mul(lining));
        // Light waves (line clears / level up) rolling over the domes toward the camera.
        const ring = ringTerm(dist, u.ring0).add(ringTerm(dist, u.ring1));
        col.addAssign(rgb(0xffe1b0, 1.4).mul(ring.mul(mix(float(0.35), float(1.0), diff))));
        // Soft mist pools in the valleys, so no crease ever reads as a hard edge.
        const mist = mix(rgb(0xd8c8ea, 0.95), rgb(0xffe4c8, 1.15), clamp(toward.mul(3.0), 0.0, 1.0));
        col.assign(mix(col, mist, float(1.0).sub(smoothstep(0.1, 0.42, height)).mul(0.55)));
        // Event glow: the whole sea warms a little on combos.
        col.mulAssign(float(1.0).add(u.seaGlow.mul(0.18)));

        return nvApplyHaze(col, rel, float(SEA_HAZE));
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'NimbusCloudSea';
    mesh.frustumCulled = false;
    mesh.renderOrder = -10;
    return mesh;
}
