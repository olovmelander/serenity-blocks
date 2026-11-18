/**
 * Rainbark — life (§4.9, as built): what lives in the grove besides its bark.
 *
 *   liana      a woody vine slung between Sister One (camY + LIANA.from) and Sister Two
 *              (camY + LIANA.to), sagging LIANA.sag metres, swaying ±LIANA.sway metres at
 *              LIANA.rate Hz: a scale cue across the open air on the right. One camera-facing
 *              ribbon of LIANA.segments segments shaded as a tube (its normal from the ribbon's
 *              cross coordinate), lit by the canopy's light and seen through the air. Every tier;
 *              hidden with Sister Two (an upright frame). Opaque (it writes depth).
 *   lorikeets  a little flock of rainbow lorikeets crossing the air in front of the far grove
 *              now and then, and going up with the walkway when it climbs (rainbark-birds.js).
 *              Medium and up (QUALITY.lorikeets birds); none crosses the card.
 *   foliage    eucalyptus sprays hanging into the frame, shoots on the boles and the trunks'
 *              crowns (rainbark-foliage.js).
 *
 * Everything is closed form in the clock and a few uniforms the world writes (the liana's two
 * ends), so the scene never changes after it is built and a seek lands on the same frame.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    cameraPosition,
    clamp,
    cos,
    cross,
    dot,
    float,
    instanceIndex,
    max,
    mix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    sqrt,
    uniform,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    LIANA,
    TAU,
    hexToLinear,
    rbAir,
    rbFleck,
    rbPart,
} from './rainbark-tsl.js';
import { createFoliage } from './rainbark-foliage.js';
import { createBirds } from './rainbark-birds.js';

/** The liana is a solid among the trunks. */
const LIANA_ORDER = 20;
const VINE = hexToLinear('#4A3E2C');
const VINE_MOSS = hexToLinear('#55663A');

/** The liana's ribbon: x across (−1 … 1), y along (0 … 1). */
function ribbonGeometry(segments) {
    const corners = [];
    for (let j = 0; j <= segments; j++) corners.push(-1, j / segments, 0, 1, j / segments, 0);
    const index = [];
    for (let j = 0; j < segments; j++) {
        const a = j * 2;
        index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(corners, 3));
    geometry.setIndex(index);
    // Two strands winding round each other.
    geometry.instanceCount = 2;
    return geometry;
}

function createLiana(u, ends) {
    const geometry = ribbonGeometry(LIANA.segments);
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    material.name = 'RainbarkLiana';
    material.fog = false;
    const vWorld = varying(vec3(0.0), 'rbLianaWorld');
    const vAcross = varying(float(0.0), 'rbLianaAcross');
    const vSide = varying(vec3(1.0, 0.0, 0.0), 'rbLianaSide');
    material.positionNode = Fn(() => {
        const s = positionGeometry.y;
        const A = ends.a;
        const B = ends.b;
        const shown = A.w.mul(B.w);
        const bow = s.mul(float(1.0).sub(s)).mul(4.0);
        const sway = sin(u.time.mul(TAU * LIANA.rate)).mul(LIANA.sway).mul(bow);
        const along = mix(A.xyz, B.xyz, s);
        const span = B.xyz.sub(A.xyz);
        const flat = normalize(vec3(span.z.negate(), 0.0, span.x).add(vec3(1e-6, 0.0, 0.0)));
        // Two strands winding round each other along the vine (a turn every LIANA.twist metres).
        const strand = float(instanceIndex).mul(Math.PI);
        const wind = s.mul(span.length()).div(LIANA.twist).mul(TAU).add(strand);
        const coil = flat.mul(cos(wind)).add(vec3(0.0, sin(wind), 0.0)).mul(LIANA.thick * 0.55);
        const P = along.sub(vec3(0.0, float(LIANA.sag).mul(bow), 0.0)).add(flat.mul(sway)).add(coil).toVar();
        // The tangent of the sagging curve, and a side across it facing the eye.
        const dyds = float(LIANA.sag).mul(float(4.0).mul(float(1.0).sub(s.mul(2.0)))).negate();
        const tangent = normalize(span.add(vec3(0.0, dyds, 0.0)));
        const side = normalize(cross(tangent, normalize(cameraPosition.sub(P))).add(vec3(0.0, 1e-6, 0.0))).toVar();
        // (A few pixels wide at least, so far off it never breaks up.)
        const dist = cameraPosition.sub(P).length();
        // (Thicker toward its anchors; a few pixels wide at least.)
        const thick = float(LIANA.thick * 0.5).mul(float(1.6).sub(bow.mul(0.6)));
        const half = max(thick, dist.mul(u.pixelAngle).mul(0.7)).mul(shown);
        vWorld.assign(P);
        vAcross.assign(positionGeometry.x);
        vSide.assign(side);
        return P.add(side.mul(positionGeometry.x.mul(half)));
    })();
    material.colorNode = Fn(() => {
        const x = clamp(vAcross, -1.0, 1.0);
        // A tube: its normal leans from the side toward the eye by the cross coordinate.
        const toEye = normalize(cameraPosition.sub(vWorld));
        const N = normalize(vSide.mul(x).add(toEye.mul(sqrt(max(float(1.0).sub(x.mul(x)), 0.0)))));
        const twist = u.fbm(vec2(vWorld.x.mul(0.8).add(vWorld.z.mul(0.8)), vWorld.y.mul(0.5))).r;
        const albedo = mix(vec3(...VINE), vec3(...VINE_MOSS), smoothstep(0.35, 0.75, twist)).mul(twist.mul(0.4).add(0.8));
        const fl = rbFleck(u, vWorld, { lod: 'fixed' }).mul(u.fleckLight);
        const sun = u.sunCol.mul(max(fl, u.fleckMean.mul(u.fleckLight).mul(1.4))).mul(max(dot(N, u.sunDir), 0.0));
        const sky = u.col.sky.mul(N.y.mul(0.2).add(0.3));
        const glow = u.col.underglow.mul(max(N.y.negate(), 0.0).mul(0.25));
        return vec4(max(rbAir(u, albedo.mul(sun.add(sky).add(glow)), vWorld, null, { billows: 0 }), vec3(0.0)), 1.0);
    })();
    return rbPart('RainbarkLiana', geometry, material, LIANA_ORDER);
}

/**
 * The life part: the liana (every tier) and, from Medium up, the lorikeets.
 * @param {object} u     the shared uniforms (with textures)
 * @param {object} tier  the content tier (lorikeets)
 */
export function createLife(u, tier = {}) {
    const ends = {
        a: uniform(new THREE.Vector4(0, 0, 0, 0)),
        b: uniform(new THREE.Vector4(0, 0, 0, 0)),
    };
    const liana = createLiana(u, ends);
    const birds = (tier.lorikeets || 0) > 0 ? createBirds(u, tier.lorikeets) : null;
    const foliage = (tier.sprays || 0) + (tier.boughs || 0) > 0 ? createFoliage(u, tier) : null;
    const group = new THREE.Group();
    group.name = 'RainbarkLife';
    group.add(liana.mesh);
    if (foliage) group.add(foliage.mesh);
    if (birds) group.add(birds.mesh);
    return {
        mesh: group,
        material: null,
        geometry: null,
        liana,
        birds,
        foliage,
        ends,
        dispose() {
            [liana, birds, foliage].forEach((p) => {
                p?.geometry.dispose();
                p?.material.dispose();
            });
        },
    };
}
