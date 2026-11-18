/**
 * Rainbark — the lorikeets.
 *
 * A little flock of rainbow lorikeets (2, now and then the whole flock) crosses the air in front
 * of the far grove every LORIKEET.every seconds (± jitter), and when the walkway climbs to a new
 * storey the whole flock goes up with it: out of the mist's side of the frame, up across the air
 * and away over the crowns (the Climb's own moment: u.flock holds when it began).
 *
 * A bird is a bird: a lofted body (tail root to face, six-sided), a beak, a long pointed tail and
 * two wings of two panels each, hinged at the shoulder and again at the wrist, the hand lagging
 * the arm as it beats (LORIKEET.flap Hz). Green back and wings, a blue head, an orange breast
 * running to yellow at its sides, a red beak, and under each wing the red and yellow that shows
 * as it lifts. Lit as the grove is (the sun where the canopy's gobo lets it through, the sky from
 * above, the mist's glow from below) and seen through the air at its place.
 *
 * Everything is closed form in the clock and one uniform, so the scene never changes after it is
 * built and a seek lands on the same frame. No bird crosses the card.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    cross,
    dot,
    faceDirection,
    float,
    floor,
    max,
    mix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    step,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    LORIKEET,
    TAU,
    hexToLinear,
    rbAir,
    rbFleck,
    rbHash21,
    rbPart,
} from './rainbark-tsl.js';

/** The birds fly in the air among the curls. */
const BIRD_ORDER = 66;

const PLUMAGE = Object.freeze({
    back: hexToLinear('#2FA83F'),
    head: hexToLinear('#2C4FCB'),
    breast: hexToLinear('#F2742B'),
    flank: hexToLinear('#F2C53A'),
    belly: hexToLinear('#3447B8'),
    beak: hexToLinear('#E8452F'),
    tail: hexToLinear('#248A4B'),
    under: hexToLinear('#E9552E'),
    band: hexToLinear('#F4D14A'),
});

/**
 * One bird in its own space (a unit is LORIKEET.size metres; +x its heading, +y up):
 * { position, normal, part (0 body · 1 wing, r, g, b), index }. Body vertices are places; a wing
 * vertex is (chord x, span from the shoulder, side ±1), stood by the vertex stage as it beats.
 */
export function birdGeometry() {
    const position = [];
    const normal = [];
    const part = [];
    const index = [];
    const push = (p, n, kind, c) => {
        position.push(p[0], p[1], p[2]);
        normal.push(n[0], n[1], n[2]);
        part.push(kind, c[0], c[1], c[2]);
        return position.length / 3 - 1;
    };
    const P = PLUMAGE;
    // The body: rings from the tail's root to the face (x, half height, half width, centre y).
    const rings = [
        [-0.2, 0.012, 0.014, 0.0],
        [-0.1, 0.044, 0.044, -0.004],
        [0.02, 0.06, 0.057, -0.008],
        [0.12, 0.05, 0.047, 0.0],
        [0.19, 0.04, 0.038, 0.012],
        [0.245, 0.02, 0.019, 0.012],
    ];
    const sides = 6;
    const ringStart = [];
    rings.forEach(([x, ry, rz, yc], r) => {
        ringStart.push(position.length / 3);
        for (let k = 0; k < sides; k++) {
            const a = ((k + 0.5) / sides) * TAU;
            const up = Math.sin(a);
            // Blue head; below, the breast orange (yellow at its sides), the belly blue behind it.
            let c = P.back;
            if (r >= 4) c = P.head;
            else if (up < -0.6) c = r >= 2 ? P.breast : P.belly;
            else if (up < 0.1) c = r >= 2 ? P.flank : P.back;
            push([x, yc + ry * up, rz * Math.cos(a)], [0, up, Math.cos(a)], 0, c);
        }
    });
    for (let r = 0; r < rings.length - 1; r++) {
        for (let k = 0; k < sides; k++) {
            const a = ringStart[r] + k;
            const b = ringStart[r] + ((k + 1) % sides);
            const c = ringStart[r + 1] + k;
            const d = ringStart[r + 1] + ((k + 1) % sides);
            index.push(a, c, b, b, c, d);
        }
    }
    // The beak: a short cone off the face.
    const tip = push([0.3, 0.004, 0], [1, 0, 0], 0, P.beak);
    const face = ringStart[rings.length - 1];
    for (let k = 0; k < sides; k++) {
        const a = push(position.slice((face + k) * 3, (face + k) * 3 + 3), [1, 0, 0], 0, P.beak);
        const b = push(position.slice((face + ((k + 1) % sides)) * 3, (face + ((k + 1) % sides)) * 3 + 3), [1, 0, 0], 0, P.beak);
        index.push(a, tip, b);
    }
    // The tail: long and pointed, a broad feather and a longer middle one.
    const t0 = push([-0.17, 0.004, -0.036], [0, 1, 0], 0, P.tail);
    const t1 = push([-0.17, 0.004, 0.036], [0, 1, 0], 0, P.tail);
    const t2 = push([-0.4, -0.004, 0.02], [0, 1, 0], 0, P.tail);
    const t3 = push([-0.4, -0.004, -0.02], [0, 1, 0], 0, P.tail);
    const t4 = push([-0.56, -0.01, 0], [0, 1, 0], 0, P.back);
    index.push(t0, t1, t2, t0, t2, t3, t3, t2, t4);
    // The wings: (chord x, span, side). An arm panel to the wrist, a pointed hand beyond it.
    [-1, 1].forEach((side) => {
        const w = (chord, span, c) => push([chord, span, side], [0, 1, 0], 1, c);
        const a = w(0.11, 0.0, P.back);
        const b = w(-0.07, 0.0, P.back);
        const c = w(0.1, LORIKEET.wrist, P.back);
        const d = w(-0.09, LORIKEET.wrist, P.tail);
        const e = w(-0.11, 0.36, P.tail);
        const f = w(-0.03, LORIKEET.span2, P.tail);
        index.push(a, b, c, c, b, d, c, d, e, c, e, f);
    });
    return {
        position: new Float32Array(position),
        normal: new Float32Array(normal),
        part: new Float32Array(part),
        index,
    };
}

/**
 * A wing vertex's place `beat` (radians) into the wingbeat: [y, z] off the shoulder for a span.
 * The vertex stage's CPU twin (the hand lags the arm: LORIKEET.lag).
 */
export function wingAt(span, beat, out = [0, 0]) {
    const L = LORIKEET;
    const arm = Math.sin(beat) * L.arm;
    const hand = arm + Math.sin(beat - L.lag) * L.hand;
    const d1 = Math.min(span, L.wrist);
    const d2 = Math.max(span - L.wrist, 0);
    out[0] = Math.sin(arm) * d1 + Math.sin(hand) * d2;
    out[1] = Math.cos(arm) * d1 + Math.cos(hand) * d2;
    return out;
}

/**
 * The birds' draw.
 * @param {object} u      the shared uniforms (u.flock: when the Climb's flock went up)
 * @param {number} count  birds (the tier's)
 */
export function createBirds(u, count) {
    const bird = birdGeometry();
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(bird.position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(bird.normal, 3));
    geometry.setAttribute('aBirdPart', new THREE.BufferAttribute(bird.part, 4));
    geometry.setIndex(bird.index);
    geometry.instanceCount = count;
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) seeds[i] = i;
    geometry.setAttribute('aBird', new THREE.InstancedBufferAttribute(seeds, 1));
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    material.name = 'RainbarkLorikeets';
    material.fog = false;
    const aBird = attribute('aBird', 'float');
    const aPart = attribute('aBirdPart', 'vec4');
    const aNormal = attribute('normal', 'vec3');
    const vCol = varying(vec3(0.0), 'rbBirdCol');
    const vUnder = varying(vec3(0.0), 'rbBirdUnder');
    const vWing = varying(float(0.0), 'rbBirdWing');
    const L = LORIKEET;

    material.positionNode = Fn(() => {
        const i = floor(aBird.add(0.5)).toVar();
        // The crossing: every `every` ± jitter seconds; which crossing, and how far into it.
        const pass = floor(u.time.div(L.every));
        const start = pass.mul(L.every).add(rbHash21(vec2(pass, 3.3)).mul(L.jitter));
        const age = u.time.sub(start).toVar();
        const crossing = step(0.0, age).mul(step(age, L.time));
        const few = mix(float(2.0), float(count), step(0.82, rbHash21(vec2(pass, 9.1))));
        const dir = mix(float(1.0), float(-1.0), step(0.5, rbHash21(vec2(pass, 5.7)))).toVar();
        const depth = mix(float(L.depth[0]), float(L.depth[1]), rbHash21(vec2(pass, 7.9))).toVar();
        const f = clamp(age.div(L.time), 0.0, 1.0).toVar();
        // Across the air in front of the far grove, rising a little then dipping, right of centre.
        const crossAt = vec3(
            mix(float(-0.5), float(0.5), f).mul(dir).mul(L.span).add(depth.mul(L.right)),
            u.camY.add(depth.mul(L.above)).add(sin(f.mul(Math.PI)).mul(L.rise))
                .add(rbHash21(vec2(pass, 1.1)).sub(0.5).mul(L.rise * 2)),
            depth.negate(),
        );
        const crossVel = vec3(dir.mul(L.span / L.time), cos(f.mul(Math.PI)).mul((L.rise * Math.PI) / L.time), 0.0);
        // The Climb's flock: every bird, up the open lanes either side of the card (one after
        // another, strung out), away over the crowns.
        const C = L.climb;
        const odd = step(0.5, i.mul(0.5).fract()).toVar();
        const up = u.time.sub(u.flock).sub(i.mul(C.stagger)).toVar();
        const rising = step(0.0, up).mul(step(up, C.time)).toVar();
        const g = clamp(up.div(C.time), 0.0, 1.0).toVar();
        const laneDepth = mix(float(C.depth[0]), float(C.depth[1]), odd).toVar();
        const weave = sin(g.mul(Math.PI * 1.5).add(i)).mul(C.sway);
        const climbAt = vec3(
            mix(float(C.lanes[0]), float(C.lanes[1]), odd).add(weave).mul(laneDepth).mul(u.tanHalf.x),
            u.camY.add(mix(float(C.rise[0]), float(C.rise[1]), g).mul(laneDepth)),
            laneDepth.negate().sub(g.mul(C.away)),
        );
        const climbVel = vec3(
            cos(g.mul(Math.PI * 1.5).add(i)).mul(C.sway * 4.0),
            laneDepth.mul((C.rise[1] - C.rise[0]) / C.time),
            float(-C.away / C.time),
        );
        const centre0 = mix(crossAt, climbAt, rising);
        const vel = mix(crossVel, climbVel, rising);
        const flying = max(crossing.mul(step(i.add(0.5), few)), rising);
        // Its place in the flock, loose and shifting.
        const spread = vec3(
            rbHash21(vec2(i, 2.2)).sub(0.5).mul(L.flock[0]),
            rbHash21(vec2(i, 4.4)).sub(0.5).mul(L.flock[1]).add(sin(u.time.mul(2.3).add(i)).mul(0.18)),
            rbHash21(vec2(i, 6.6)).sub(0.5).mul(L.flock[2]),
        ).mul(mix(float(1.0), float(C.tight), rising));
        const centre = centre0.add(spread).toVar();
        // Its own frame: heading along its flight, level wings.
        const fwd = normalize(vel).toVar();
        const right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0))).toVar();
        const upv = cross(right, fwd).toVar();
        // The wingbeat: the arm about the shoulder, the hand about the wrist, lagging.
        const beat = u.time.mul(TAU * L.flap).add(i.mul(1.7)).toVar();
        const arm = sin(beat).mul(L.arm).toVar();
        const hand = arm.add(sin(beat.sub(L.lag)).mul(L.hand)).toVar();
        const isWing = step(0.5, aPart.x).toVar();
        const span = positionGeometry.y;
        const side = positionGeometry.z;
        const d1 = span.min(L.wrist);
        const d2 = span.sub(L.wrist).max(0.0);
        const wingY = sin(arm).mul(d1).add(sin(hand).mul(d2)).add(L.shoulder[0]);
        const wingZ = cos(arm).mul(d1).add(cos(hand).mul(d2)).add(L.shoulder[1])
            .mul(side);
        // (The body rides the beat a little: down as the wings lift.)
        const bob = sin(beat).mul(-L.bob);
        const local = vec3(
            positionGeometry.x,
            mix(positionGeometry.y, wingY, isWing).add(bob),
            mix(positionGeometry.z, wingZ, isWing),
        ).mul(L.size);
        const world = centre.add(fwd.mul(local.x)).add(upv.mul(local.y)).add(right.mul(local.z)).toVar();
        // The wing's own normal as it beats (its outer panel's), the body's as lofted.
        const wingN = vec3(0.0, cos(hand), sin(hand).mul(side).negate());
        const nLocal = mix(aNormal, wingN, isWing);
        const N = normalize(fwd.mul(nLocal.x).add(upv.mul(nLocal.y)).add(right.mul(nLocal.z))).toVar();
        // Never across the card: a bird whose centre stands over it is not drawn.
        const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(centre, 1.0));
        const ndc = clip.xy.div(max(abs(clip.w), 1e-4));
        const scr = vec2(ndc.x.mul(0.5).add(0.5), float(0.5).sub(ndc.y.mul(0.5)));
        const r = u.cardRect;
        const away = max(max(r.x.sub(scr.x), scr.x.sub(r.z)), max(r.y.sub(scr.y), scr.y.sub(r.w)));
        const shown = flying.mul(step(0.015, away)).mul(step(0.0, clip.w));
        // Lit as the grove is, on either face; through the air at its place.
        const fl = rbFleck(u, centre, { lod: 'fixed' }).mul(u.fleckLight);
        const sunK = max(fl, u.fleckMean.mul(u.fleckLight));
        const lightOf = (n) => u.sunCol.mul(sunK).mul(max(dot(n, u.sunDir), 0.0).mul(0.3).add(0.06))
            .add(u.col.sky.mul(n.y.mul(0.5).add(0.5).mul(0.5).add(0.12)))
            .add(u.col.underglow.mul(n.y.negate().mul(0.5).add(0.5).mul(0.22)));
        vCol.assign(rbAir(u, aPart.yzw.mul(lightOf(N)), centre, null, { billows: 0 }));
        // (Under a wing: red at the arm, a yellow band along the hand.)
        const under = mix(vec3(...PLUMAGE.under), vec3(...PLUMAGE.band), smoothstep(L.wrist * 0.7, L.wrist * 1.2, span));
        vUnder.assign(rbAir(u, under.mul(lightOf(N.negate())), centre, null, { billows: 0 }));
        vWing.assign(isWing);
        return mix(centre, world, shown);
    })();
    material.colorNode = Fn(() => {
        // (A wing seen from below shows its red and yellow.)
        const below = step(faceDirection, 0.0).mul(step(0.5, vWing));
        return vec4(max(mix(vCol, vUnder, below), vec3(0.0)), 1.0);
    })();
    const part = rbPart('RainbarkLorikeets', geometry, material, BIRD_ORDER);
    part.count = count;
    return part;
}
