/**
 * @fileoverview Ch6 sculpted nebula field — the Wave 3 sprite retirement
 * (docs/ODYSSEY_CH6_SPACE_OVERHAUL_PLAN_2026-08.md §3.1/§5).
 *
 * Replaces the additive FBM sprite tiers (110 near + 90 far domain-warped-FBM
 * billboards, Wave 0: 1.70 ms Lane B) and the billboard pillar with FIVE authored
 * opaque masses sculpted by the SHIPPED Act II cloud-field sculptor (SDF-gradient
 * normals, analytic AO / height / seed in vertex colour) merged into ONE draw, and
 * painted as a nebula: 2-band wrap paint with a hue-shift shade (never grey, never
 * darker), a darkness-gated ember interior in the SDF crevices, a fresnel drawn
 * edge, and the fake-Mie backlit lining — the Wave 0 probe's paint, ported.
 *
 * REVEAL: deliberately NOT in the chapter's `entryContinuity` buckets.
 * `setOpacityScale` force-flips materials to `transparent = true` and writes
 * `material.opacity` — for this opaque material that is both the transparent-queue
 * regression and (with an opacityNode present) the r181 dead-write trap. Instead the
 * field exposes `uReveal`, ticked by the chapter's update() from the SAME staging
 * product (nebulaReveal × spaceReveal × chapterOpacity), and dissolves as a DITHERED
 * OPAQUE fade (opacityNode + alphaTest, transparent:false — the cloud-field dissolve
 * idiom, stays in the opaque queue).
 */

import * as THREE from 'three/webgpu';
import {
    attribute, cameraPosition, clamp, color, dot, float, fract, mix,
    normalWorld, normalize, positionWorld, screenCoordinate, sin, smoothstep, uniform, vec2,
} from 'three/tsl';
import { buildCloudFieldGeometry, cloudFieldSdf } from '../world/odyssey-cloud-field.js';
import {
    NEBULA_FIELD_CLEARANCE,
    ODYSSEY_NEBULA_FIELD_SPECS,
} from './odyssey-nebula-field-specs.js';

// One key light for the field, corridor-local: the accretion key lives up-left-ahead
// (the BH omen's marched poses, seen from the corridor frame). Authored constant —
// the march moves the hero ~0.1 rad against a light direction feeding a wrap term
// with w=0.72, which is beneath the band threshold's notice.
const NEBULA_KEY_DIR = Object.freeze([-0.48, 0.36, -0.62]);

// Probe palette (ch6-painted-cosmos.effect.js), deep-space register. Overshoot is
// intentional — colour verdicts are taken through the grade, not in the flat playground.
const PALETTE = Object.freeze({
    lit: 0xd98a5c,
    shade: 0x4a3c86,
    ember: 0xff9c38,
    edge: 0xe8b8b2,
});

export function validateNebulaFieldClearance(
    specs = ODYSSEY_NEBULA_FIELD_SPECS,
    clearance = NEBULA_FIELD_CLEARANCE,
) {
    const { zFrom, zTo, step } = clearance.travelWindow;
    const violations = [];
    for (let z = zFrom; z >= zTo; z -= step) {
        const d = cloudFieldSdf(specs, 0, 0, z);
        if (d < clearance.axis) {
            violations.push({ z, sdf: Number(d.toFixed(1)) });
        }
    }
    return violations;
}

export function createNebulaFieldTSL(uniforms) {
    const uReveal = uniform(0);
    const { geometry, triangles, masses } = buildCloudFieldGeometry(ODYSSEY_NEBULA_FIELD_SPECS);

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.FrontSide });
    material.transparent = false;
    material.depthWrite = true;
    // Dithered opaque dissolve: alphaTest discards below the hash threshold, so the
    // fade never leaves the opaque queue and never becomes a blend state.
    material.alphaTest = 0.5;

    const ao = attribute('color', 'vec3').x;
    const N = normalize(normalWorld);
    const V = normalize(cameraPosition.sub(positionWorld));
    const L = normalize(uniforms.uNebulaKeyDir ?? uniform(new THREE.Vector3(...NEBULA_KEY_DIR)));

    // Two-band wrap paint, band interiors flat, lit ramp over-extended past 1.
    const wrap = float(0.72);
    const d = dot(N, L).add(wrap).div(wrap.add(1));
    const band = smoothstep(0.40, 0.52, d);
    const litRamp = mix(color(PALETTE.lit), color(PALETTE.lit).mul(1.35), d.mul(0.55));
    const base = mix(color(PALETTE.shade), litRamp, band);

    // Darkness-gated ember interior: the SDF crevices (low AO) are where ambient is
    // absent — that is where the accretion ember lives (Levistone rule).
    const crevice = smoothstep(0.72, 0.18, ao);
    const interior = color(PALETTE.ember).mul(crevice.mul(crevice).mul(0.85));

    // Drawn edge + fake-Mie lining (fires when the view OPPOSES the key — backlit).
    const fresnel = clamp(float(1).sub(dot(N, V)), 0, 1);
    const edge = color(PALETTE.edge).mul(fresnel.pow(2.5).mul(0.6));
    const mie = clamp(dot(V, L).add(0.9).mul(-10), 0, 1).pow(4);
    const lining = color(PALETTE.ember).mul(mie.mul(0.9));

    material.colorNode = base.add(interior).add(edge).add(lining);

    // Screen-space hash dither against uReveal. The hash is per-fragment sin-hash —
    // silhouette-only fragments on an opaque mesh, not a full-screen cost.
    const hash = fract(
        sin(dot(screenCoordinate.xy.floor(), vec2(12.9898, 78.233))).mul(43758.5453),
    );
    material.opacityNode = uReveal.sub(hash).add(0.5);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'nebula-field';
    mesh.userData.uReveal = uReveal;
    mesh.userData.triangles = triangles;
    mesh.userData.masses = masses;
    // One merged mesh spanning the corridor: bounds are the whole field, and the
    // camera lives inside them for most of the chapter — culling it would pop.
    mesh.frustumCulled = false;
    return {
        mesh, material, geometry, uReveal, triangles, masses,
    };
}
