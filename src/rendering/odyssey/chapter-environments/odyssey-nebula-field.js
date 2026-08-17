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

// WAVE 6 LIGHTING AUDIT (2026-08-16) — FIXED; the owner flipped it to the default.
//
// This constant is authored in the CORRIDOR frame, but `N` below is `normalWorld` and the
// mesh is parented to the corridor group, so for the whole life of the field the key was
// dotted against world normals raw and never transformed — a 45.8 deg slip.
//
// MEASURED against the chapter's designated key. Plan §3.4 names the ACCRETION point
// light (the black hole) as ch6's one key — NOT the world sun, which the hero planet
// joined as a deliberate Wave 0.2 trade to stop its terminator swimming:
//
//        approach            0.0     0.5     1.0
//   was (applied raw)       55.8    67.7    95.5   deg off the BH
//   now (authored frame)    25.7    35.5    57.1   deg off the BH
//
// The authored intent was always sound — a raking key leaning toward the omen ahead,
// which is §3b rule 8's causal light. Only the frame was wrong, and by the chapter exit
// the masses had been lit from nearly a right angle to the thing they are falling into.
//
// A/B at all 8 stations: 2.6% of pixels move and they move the right way — the warm
// workhorse keeps its violet body and warm crest, the cool giant keeps its low-contrast
// role, and rule 4's value ladder holds. `?odysseyCh6LegacyKeyFrame=1` restores the slip
// (ADD-back polarity, like the procedural dome) so the comparison stays one flag away.
//
// ⚠️ A FIRST A/B TESTED THE WRONG FIX and its verdict does not apply: it put the masses on
// ODYSSEY_WORLD_SUN, which §3.4 never asks for. That variant moved 5.2% and flattened them
// face-on into a saturated orange shape competing with the hero (rule 1). Rejected.
//
// The CORRECTION the audit actually calls for: the same authored direction, rotated out
// of the corridor frame it was written in and into the world frame the normals live in.
// Not the world sun — see the note above on why that was the wrong fix to test.
function resolveKeyDir(authoredFrame, corridorQuaternion) {
    const v = new THREE.Vector3(...NEBULA_KEY_DIR).normalize();
    if (authoredFrame && corridorQuaternion) v.applyQuaternion(corridorQuaternion).normalize();
    return v;
}

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

function buildRoleMaterial(uReveal, role, authoredFrame = true, corridorQuaternion = null) {
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.FrontSide });
    material.transparent = false;
    material.depthWrite = true;
    // Dithered opaque dissolve: alphaTest discards below the hash threshold, so the
    // fade never leaves the opaque queue and never becomes a blend state.
    material.alphaTest = 0.5;

    const ao = attribute('color', 'vec3').x;
    const N = normalize(normalWorld);
    const V = normalize(cameraPosition.sub(positionWorld));
    const L = normalize(uniform(resolveKeyDir(authoredFrame, corridorQuaternion)));

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

    // SPATIALLY COHERENT DISSOLVE (fixed 2026-08-16 from ground-truth capture). A
    // pure screen-space hash reads as STATIC on these masses: the chapter spends
    // stations 7-11 at partial reveal and again fades at the ch7 handoff, and the
    // real-game frames showed the whole silhouette crawling with white noise — a
    // defect the flat-lit rig could not show because it was pinned at reveal 1.
    // The sculptor already stores normalised height per vertex in colour.g, so the
    // threshold is mostly that height plus a little grain: the mass MATERIALISES
    // from its base upward with a grainy leading edge, which reads as authored
    // weather rather than noise, and still never leaves the opaque queue.
    const height = attribute('color', 'vec3').g;
    const grain = fract(
        sin(dot(screenCoordinate.xy.floor(), vec2(12.9898, 78.233))).mul(43758.5453),
    );
    const dissolveThreshold = height.mul(0.75).add(grain.mul(0.25));
    // 1.15 gain guarantees full coverage at reveal 1 (threshold peaks at 1.0), and
    // reveal 0 stays fully discarded because alphaTest is 0.5.
    material.opacityNode = uReveal.mul(1.15).sub(dissolveThreshold).add(0.5);
    return material;
}

export function createNebulaFieldTSL({ authoredFrame = true, corridorQuaternion = null } = {}) {
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
        const material = buildRoleMaterial(uReveal, PAINT_ROLES[paint], authoredFrame, corridorQuaternion);
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
