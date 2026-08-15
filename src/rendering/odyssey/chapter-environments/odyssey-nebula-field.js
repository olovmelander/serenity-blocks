/**
 * @fileoverview Ch6 sculpted nebula field — the Wave 3 sprite retirement, re-composed
 * 2026-08-15 against the plan's §3b composition contract.
 *
 * Replaces the additive FBM sprite tiers (Wave 0: 1.70 ms Lane B) and the billboard
 * pillar with SIX authored opaque masses sculpted by the SHIPPED Act II cloud-field
 * sculptor (SDF-gradient normals, analytic AO / height / seed in vertex colour),
 * merged into TWO draws — one per PAINT ROLE, the forest's species-role idea:
 *
 * - WARM (workhorse): rose-amber lit / violet shade, full ember + drawn edge — the
 *   reef pair, the pillar, and the near witness. Crisp, saturated, mid-value.
 * - COOL (the giant): teal lit / deep-indigo shade, contrast and ember pulled DOWN —
 *   rule 6's "big + soft": the colossal hero veil reads enormous precisely because
 *   it is dimmer, softer, and lower-contrast than the small sharp things in front.
 *
 * REVEAL: deliberately NOT in the chapter's `entryContinuity` buckets.
 * `setOpacityScale` force-flips materials to `transparent = true` and writes
 * `material.opacity` — for these opaque materials that is both the transparent-queue
 * regression and (with an opacityNode present) the r181 dead-write trap. Instead the
 * field group exposes ONE shared `uReveal`, ticked by the chapter's update() from the
 * staging product (nebulaReveal × spaceReveal × chapterOpacity), and both meshes
 * dissolve as a DITHERED OPAQUE fade (opacityNode + alphaTest, transparent:false —
 * the cloud-field dissolve idiom, stays in the opaque queue).
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
// the march moves the hero ~0.1 rad against a wrap term with w=0.72, beneath the
// band threshold's notice. This is also §3b rule 8's causal illuminator: every
// mass's lit side agrees on where the light lives.
const NEBULA_KEY_DIR = Object.freeze([-0.48, 0.36, -0.62]);

// Palette ROLES (probe-derived, deep-space register; overshoot intentional — colour
// verdicts are taken through the grade, never in the flat playground).
const PAINT_ROLES = Object.freeze({
    warm: Object.freeze({
        lit: 0xd98a5c,
        litRampMul: 1.35,
        shade: 0x4a3c86,
        ember: 0xff9c38,
        emberStrength: 0.85,
        edge: 0xe8b8b2,
        edgeStrength: 0.6,
        bandLo: 0.40,
        bandHi: 0.52,
    }),
    cool: Object.freeze({
        // The giant's role: values pulled toward the void, band edges wider/softer,
        // ember faint — low contrast IS the scale statement (Gurney/Harris).
        lit: 0x5e93a8,
        litRampMul: 1.15,
        shade: 0x2c2a5e,
        ember: 0x7fb8c8,
        emberStrength: 0.30,
        edge: 0xa8c4d8,
        edgeStrength: 0.35,
        bandLo: 0.34,
        bandHi: 0.58,
    }),
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

function buildRoleMaterial(uReveal, role) {
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.FrontSide });
    material.transparent = false;
    material.depthWrite = true;
    // Dithered opaque dissolve: alphaTest discards below the hash threshold, so the
    // fade never leaves the opaque queue and never becomes a blend state.
    material.alphaTest = 0.5;

    const ao = attribute('color', 'vec3').x;
    const N = normalize(normalWorld);
    const V = normalize(cameraPosition.sub(positionWorld));
    const L = normalize(uniform(new THREE.Vector3(...NEBULA_KEY_DIR)));

    // Two-band wrap paint, band interiors flat, lit ramp over-extended past 1.
    const wrap = float(0.72);
    const d = dot(N, L).add(wrap).div(wrap.add(1));
    const band = smoothstep(role.bandLo, role.bandHi, d);
    const litRamp = mix(color(role.lit), color(role.lit).mul(role.litRampMul), d.mul(0.55));
    const base = mix(color(role.shade), litRamp, band);

    // Darkness-gated ember interior: the SDF crevices (low AO) are where ambient is
    // absent — that is where the accretion ember lives (Levistone rule).
    const crevice = smoothstep(0.72, 0.18, ao);
    const interior = color(role.ember).mul(crevice.mul(crevice).mul(role.emberStrength));

    // Drawn edge + fake-Mie lining (fires when the view OPPOSES the key — backlit).
    const fresnel = clamp(float(1).sub(dot(N, V)), 0, 1);
    const edge = color(role.edge).mul(fresnel.pow(2.5).mul(role.edgeStrength));
    const mie = clamp(dot(V, L).add(0.9).mul(-10), 0, 1).pow(4);
    const lining = color(role.ember).mul(mie.mul(role.emberStrength));

    material.colorNode = base.add(interior).add(edge).add(lining);

    // Screen-space hash dither against the SHARED uReveal — silhouette-only
    // fragments on opaque meshes, not a full-screen cost.
    const hash = fract(
        sin(dot(screenCoordinate.xy.floor(), vec2(12.9898, 78.233))).mul(43758.5453),
    );
    material.opacityNode = uReveal.sub(hash).add(0.5);
    return material;
}

export function createNebulaFieldTSL() {
    const uReveal = uniform(0);
    const group = new THREE.Group();
    group.name = 'nebula-field';

    let triangles = 0;
    let masses = 0;
    const parts = [];
    ['warm', 'cool'].forEach((paint) => {
        const specs = ODYSSEY_NEBULA_FIELD_SPECS.filter((s) => s.paint === paint);
        if (!specs.length) return;
        const built = buildCloudFieldGeometry(specs);
        const material = buildRoleMaterial(uReveal, PAINT_ROLES[paint]);
        const mesh = new THREE.Mesh(built.geometry, material);
        mesh.name = `nebula-field-${paint}`;
        // Merged meshes spanning the corridor: the camera lives inside their bounds
        // for most of the chapter — culling them would pop.
        mesh.frustumCulled = false;
        group.add(mesh);
        parts.push({ mesh, material, geometry: built.geometry });
        triangles += built.triangles;
        masses += built.masses;
    });

    group.userData.uReveal = uReveal;
    group.userData.triangles = triangles;
    group.userData.masses = masses;
    return {
        mesh: group, group, parts, uReveal, triangles, masses,
    };
}
