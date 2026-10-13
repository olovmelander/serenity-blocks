/**
 * Rainbark — life (§4.9, as built): what lives in the grove besides its bark.
 *
 *   liana      a woody vine slung between Sister One (camY + LIANA.from) and Sister Two
 *              (camY + LIANA.to), sagging LIANA.sag metres, swaying ±LIANA.sway metres at
 *              LIANA.rate Hz: a scale cue across the open air on the right. One camera-facing
 *              ribbon of LIANA.segments segments shaded as a tube (its normal from the ribbon's
 *              cross coordinate), lit by the canopy's light and seen through the air. Every tier;
 *              hidden with Sister Two (an upright frame). Opaque (it writes depth).
 *   lorikeets  a little flock (2, now and then up to 5) of rainbow lorikeets crossing the air in
 *              front of the far grove every LORIKEET.every seconds (± jitter), on a closed-form arc
 *              LORIKEET.span metres long at LORIKEET.depth metres, LORIKEET.time seconds a crossing;
 *              each bird a body and two wings flapping at LORIKEET.flap Hz: green back, blue head,
 *              orange breast. Medium and up (QUALITY.lorikeets birds); none crosses the card.
 *
 * Everything is closed form in the clock and a few uniforms the world writes (the liana's two
 * ends), so the scene never changes after it is built and a seek lands on the same frame.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    cross,
    dot,
    float,
    floor,
    instanceIndex,
    max,
    mix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    sqrt,
    step,
    uniform,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    LIANA,
    LORIKEET,
    TAU,
    hexToLinear,
    rbAir,
    rbFleck,
    rbFxMaterial,
    rbHash21,
    rbPart,
} from './rainbark-tsl.js';

/** The liana is a solid among the trunks; the birds fly in the air among the curls. */
const LIANA_ORDER = 20;
const BIRD_ORDER = 66;
const VINE = hexToLinear('#4A3E2C');
const VINE_MOSS = hexToLinear('#55663A');
const BIRD = Object.freeze({
    back: hexToLinear('#2E9E3C'), head: hexToLinear('#2D4FC8'), breast: hexToLinear('#F07A2A'),
});

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
 * The birds: `count` instances of a body quad and two wing quads (one geometry of three quads;
 * the vertex stage knows which part a vertex belongs to by its z: 0 body, ±1 a wing).
 */
function createBirds(u, count) {
    // Body: a diamond along +x (the heading); wings: quads hinged on the body's spine.
    const P = [
        // body (z = 0): tail, top, beak, bottom
        -0.16, 0, 0, 0, 0.045, 0, 0.14, 0, 0, 0, -0.04, 0,
        // left wing (z = −1): hinge front, hinge back, tip back, tip front
        0.04, 0, -1, -0.06, 0, -1, -0.09, 0.2, -1, 0.02, 0.2, -1,
        // right wing (z = 1)
        0.04, 0, 1, -0.06, 0, 1, -0.09, 0.2, 1, 0.02, 0.2, 1,
    ];
    const index = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11];
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geometry.setIndex(index);
    geometry.instanceCount = count;
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) seeds[i] = i;
    geometry.setAttribute('aBird', new THREE.InstancedBufferAttribute(seeds, 1));
    const material = rbFxMaterial('RainbarkLorikeets');
    const aBird = attribute('aBird', 'float');
    const vCol = varying(vec4(0.0), 'rbBirdCol');
    material.positionNode = Fn(() => {
        const L = LORIKEET;
        const i = floor(aBird.add(0.5));
        // The flock's crossing: every `every` ± jitter seconds; which crossing, and how far into it.
        const pass = floor(u.time.div(L.every));
        const start = pass.mul(L.every).add(rbHash21(vec2(pass, 3.3)).mul(L.jitter));
        const age = u.time.sub(start).toVar();
        const flying = step(0.0, age).mul(step(age, L.time));
        // How many birds this crossing (2, now and then more), and this one's place in the flock.
        const flock = mix(float(2.0), float(count), step(0.82, rbHash21(vec2(pass, 9.1))));
        const inFlock = step(i.add(0.5), flock);
        const dir = mix(float(1.0), float(-1.0), step(0.5, rbHash21(vec2(pass, 5.7))));
        const depth = mix(float(L.depth[0]), float(L.depth[1]), rbHash21(vec2(pass, 7.9)));
        const f = clamp(age.div(L.time), 0.0, 1.0);
        // Across the air in front of the far grove, rising a little then dipping, right of centre.
        const x = mix(float(-0.5), float(0.5), f).mul(dir).mul(L.span).add(depth.mul(L.right));
        const lift = sin(f.mul(Math.PI)).mul(L.rise).add(rbHash21(vec2(pass, 1.1)).sub(0.5).mul(L.rise * 2));
        const spread = vec3(
            rbHash21(vec2(i, 2.2)).sub(0.5).mul(1.6),
            rbHash21(vec2(i, 4.4)).sub(0.5).mul(1.0).add(sin(u.time.mul(2.3).add(i)).mul(0.15)),
            rbHash21(vec2(i, 6.6)).sub(0.5).mul(2.0),
        );
        const centre = vec3(x, u.camY.add(depth.mul(L.above)).add(lift), depth.negate()).add(spread).toVar();
        // A wing beats at `flap` Hz (its tip up and down round the hinge), each bird its own phase.
        const beat = sin(u.time.mul(TAU * L.flap).add(i.mul(1.7)));
        const side = positionGeometry.z;
        const isWing = abs(side);
        const wingUp = beat.mul(0.9);
        const local = vec3(
            positionGeometry.x,
            mix(positionGeometry.y, positionGeometry.y.mul(wingUp), isWing),
            mix(float(0.0), side.mul(positionGeometry.y.mul(0.9).add(0.03)), isWing),
        ).mul(L.size);
        // Heading along the crossing.
        const fwd = vec3(dir, 0.0, 0.0);
        const right = vec3(0.0, 0.0, dir);
        const world = centre.add(fwd.mul(local.x)).add(vec3(0.0, local.y, 0.0)).add(right.mul(local.z));
        // Never across the card: a bird whose centre stands over it is not drawn.
        const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(centre, 1.0));
        const ndc = clip.xy.div(max(abs(clip.w), 1e-4));
        const scr = vec2(ndc.x.mul(0.5).add(0.5), float(0.5).sub(ndc.y.mul(0.5)));
        const r = u.cardRect;
        const away = max(max(r.x.sub(scr.x), scr.x.sub(r.z)), max(r.y.sub(scr.y), scr.y.sub(r.w)));
        const shown = flying.mul(inFlock).mul(step(0.015, away)).mul(step(0.0, clip.w));
        // Colours: green back and wings, blue head (the front of the body), orange breast (below).
        const head = step(0.06, positionGeometry.x).mul(float(1.0).sub(isWing));
        const breast = step(positionGeometry.y, -0.005).mul(float(1.0).sub(isWing));
        const albedo = mix(mix(vec3(...BIRD.back), vec3(...BIRD.head), head), vec3(...BIRD.breast), breast);
        const fl = rbFleck(u, centre, { lod: 'fixed' }).mul(u.fleckLight);
        const light = u.sunCol.mul(max(fl, u.fleckMean.mul(u.fleckLight))).mul(0.35).add(u.col.sky.mul(0.35));
        vCol.assign(vec4(rbAir(u, albedo.mul(light), centre, null, { billows: 0 }), shown));
        return mix(centre, world, shown);
    })();
    material.colorNode = Fn(() => vec4(vCol.xyz.mul(vCol.w), vCol.w))();
    const part = rbPart('RainbarkLorikeets', geometry, material, BIRD_ORDER);
    part.count = count;
    return part;
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
    const group = new THREE.Group();
    group.name = 'RainbarkLife';
    group.add(liana.mesh);
    if (birds) group.add(birds.mesh);
    return {
        mesh: group,
        material: null,
        geometry: null,
        liana,
        birds,
        ends,
        dispose() {
            [liana, birds].forEach((p) => {
                p?.geometry.dispose();
                p?.material.dispose();
            });
        },
    };
}
