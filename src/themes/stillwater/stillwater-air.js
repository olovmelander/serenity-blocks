/**
 * Stillwater — what the night's own weather puts in the air, and who comes by.
 *
 *   rain    streaks of a soft rain, each lit by whatever light it falls past (the lantern's gold,
 *           the spirit's pale): placed by the clock in the vertex stage, more of them the harder
 *           it rains, none drawn when it is dry
 *   birds   dark shapes against the sky: an owl that crosses the moon on slow wings, and the
 *           flight that bursts out of the far wood when the hour turns
 *   elk     the old elk of the wood, come down to the far shallows to drink: a shape in the mist,
 *           drawn as one figure (a 2D distance field of a few dozen limbs), its head lowered to
 *           the water and lifted again by the clock
 *   glow    the lantern's light in the mist round it: a wide soft warmth the bloom alone never gave
 *
 * Nothing is created at event time: each part reads a uniform that says when its moment began.
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
    dot,
    exp,
    float,
    fract,
    length,
    max,
    min,
    mix,
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
    EYE, SW_CULLED, mulberry32, swFogAmount, swHaze, swPart,
} from './stillwater-tsl.js';

const additive = (name) => {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = name;
    material.transparent = true;
    material.blending = THREE.AdditiveBlending;
    material.premultipliedAlpha = true;
    material.depthWrite = false;
    material.fog = false;
    material.toneMapped = false;
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    return material;
};

// ── Rain ────────────────────────────────────────────────────────────────────────

/** The air the rain falls through (world metres), and how fast (m/s). */
export const RAIN = Object.freeze({
    x: 17, z0: -30, z1: 3, top: 8.5, fall: 8.2, streak: 0.62,
});

/**
 * @param {object} u
 * @param {number} count  streaks at the hardest rain
 */
export function createRain(u, count) {
    const n = Math.max(1, count);
    const geometry = new THREE.PlaneGeometry(1, 1);
    const data = new Float32Array(n * 4); // x, z, phase, rank (which streaks a light rain shows)
    const rand = mulberry32(9091);
    for (let i = 0; i < n; i++) {
        data.set([(rand() * 2 - 1) * RAIN.x, RAIN.z0 + rand() * (RAIN.z1 - RAIN.z0), rand(), rand()], i * 4);
    }
    geometry.setAttribute('aRain', new THREE.InstancedBufferAttribute(data, 4));
    const mesh = new THREE.InstancedMesh(geometry, null, n);
    mesh.frustumCulled = false;

    const material = additive('StillwaterRain');
    const aRain = attribute('aRain', 'vec4');
    const vAt = varying(vec3(0.0), 'vRainAt');
    const vShow = varying(float(0.0), 'vRainShow');
    material.vertexNode = Fn(() => {
        const speed = aRain.w.mul(0.3).add(0.85).mul(RAIN.fall / RAIN.top);
        const fallen = fract(aRain.z.add(u.time.mul(speed)));
        const at = vec3(aRain.x, float(RAIN.top).mul(float(1.0).sub(fallen)), aRain.y).toVar();
        const view = cameraViewMatrix.mul(vec4(at, 1.0)).toVar();
        const dist = max(view.z.negate(), 0.5);
        // A streak hangs along the world's own down, as wide as a pixel or two at any range.
        const down = cameraViewMatrix.mul(vec4(0.0, 1.0, 0.0, 0.0)).xyz;
        const q = positionGeometry.xy;
        const wide = dist.mul(0.0011).add(0.006);
        const p = view.xyz.add(down.mul(q.y.mul(RAIN.streak))).add(vec3(q.x.mul(wide), 0.0, 0.0));
        // (A light rain shows only some of them; none right before the eye.)
        const shown = step(aRain.w, u.rain).mul(smoothstep(1.6, 4.5, dist));
        vAt.assign(at);
        vShow.assign(shown);
        return mix(SW_CULLED, cameraProjectionMatrix.mul(vec4(p, 1.0)), step(0.5, shown));
    })();
    material.outputNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const shape = float(1.0).sub(abs(q.x)).mul(float(1.0).sub(q.y.mul(q.y)));
        const lamp = (posPower, colour, reach) => {
            const d = length(posPower.xyz.sub(vAt));
            return colour.mul(posPower.w.div(d.mul(d).mul(reach).add(1.0)));
        };
        // The night's own light on it, and the lights it falls past.
        const light = u.moonLight.mul(0.09).add(u.skyAmb.mul(0.1))
            .add(lamp(u.lanternAt, u.lantern, 0.22).mul(0.85))
            .add(lamp(u.spiritAt, u.spirit, 0.35).mul(0.5));
        return vec4(light.mul(shape).mul(vShow).mul(u.rain).mul(u.breath)
            .mul(0.9), 0.0);
    })();
    mesh.material = material;
    const part = swPart('StillwaterRain', geometry, material, 73, { mesh });
    part.count = n;
    return part;
}

// ── Birds ───────────────────────────────────────────────────────────────────────

/** The owl's way across the sky (world metres), and how long the flights last (seconds). */
export const FLIGHT = Object.freeze({
    owlFrom: Object.freeze([-21, 6.4, -25]),
    owlTo: Object.freeze([20, 5.3, -21]),
    owlSpan: 12,
    flockSpan: 7.5,
});

/**
 * Dark wings against the sky. `u.flight` = (when it began, kind: 0 the owl, 1 the flock, seed, _).
 * @param {object} u
 * @param {number} count  birds in the flock (the owl is the first of them)
 */
export function createBirds(u, count) {
    const n = Math.max(1, count);
    const geometry = new THREE.PlaneGeometry(1, 1);
    const data = new Float32Array(n * 4); // which, three seeds
    const rand = mulberry32(4407);
    for (let i = 0; i < n; i++) data.set([i, rand(), rand(), rand()], i * 4);
    geometry.setAttribute('aBird', new THREE.InstancedBufferAttribute(data, 4));
    const mesh = new THREE.InstancedMesh(geometry, null, n);
    mesh.frustumCulled = false;

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'StillwaterBirds';
    material.transparent = true;
    material.premultipliedAlpha = true;
    material.depthWrite = false;
    material.fog = false;
    material.toneMapped = false;
    material.side = THREE.DoubleSide;
    const aBird = attribute('aBird', 'vec4');
    const vFlap = varying(float(0.0), 'vBirdFlap');
    const vShow = varying(float(0.0), 'vBirdShow');
    const vMist = varying(float(0.0), 'vBirdMist');
    const vDir = varying(vec3(0.0, 0.0, -1.0), 'vBirdDir');
    material.vertexNode = Fn(() => {
        const age = u.time.sub(u.flight.x).toVar();
        const flock = step(0.5, u.flight.y).toVar();
        const turned = step(0.5, u.flight.z).mul(2.0).sub(1.0).toVar();
        // The owl: one bird, a long shallow bow from one side of the picture to the other.
        const ko = clamp(age.div(FLIGHT.owlSpan), 0.0, 1.0);
        const a = vec3(turned.mul(FLIGHT.owlFrom[0]), FLIGHT.owlFrom[1], FLIGHT.owlFrom[2]);
        const b = vec3(turned.mul(FLIGHT.owlTo[0]), FLIGHT.owlTo[1], FLIGHT.owlTo[2]);
        const owl = mix(a, b, ko).add(vec3(0.0, sin(ko.mul(Math.PI)).mul(1.1).add(sin(age.mul(1.3)).mul(0.12)), 0.0));
        // The flock: each from its own place in the far wood, up and outward, a little after the last.
        const late = aBird.y.mul(1.6);
        const own = max(age.sub(late), 0.0).toVar();
        const side = step(0.5, fract(aBird.x.mul(0.5))).mul(2.0).sub(1.0);
        const from = vec3(side.mul(aBird.z.mul(11.0).add(4.0)), aBird.w.mul(1.6).add(2.2), aBird.w.mul(-9.0).sub(27.0));
        const way = vec3(side.mul(aBird.y.mul(1.6).add(1.9)), aBird.z.mul(1.1).add(1.9), aBird.w.mul(0.8).sub(0.6));
        const bird = from.add(way.mul(own)).add(vec3(0.0, sin(own.mul(2.1).add(aBird.z.mul(9.0))).mul(0.2), 0.0));
        const at = mix(owl, bird, flock).toVar();
        const span = mix(float(FLIGHT.owlSpan), float(FLIGHT.flockSpan), flock);
        const mine = mix(age, own, flock);
        const live = step(0.0, age).mul(step(mine, span)).mul(mix(step(aBird.x, 0.5), step(0.001, own), flock));
        const view = cameraViewMatrix.mul(vec4(at, 1.0)).toVar();
        // Its wings: the owl's slow and deep with a glide between, the flock's quick.
        const beat = mix(
            sin(age.mul(5.6)).mul(smoothstep(-0.6, 0.1, sin(age.mul(0.9)))),
            sin(own.mul(aBird.z.mul(3.0).add(9.5)).add(aBird.y.mul(20.0))),
            flock,
        );
        vFlap.assign(beat);
        vShow.assign(live.mul(smoothstep(0.0, 0.5, mine)).mul(float(1.0).sub(smoothstep(span.sub(1.2), span, mine))));
        vMist.assign(swFogAmount(u, at, 0.8));
        vDir.assign(at.sub(vec3(EYE.x, EYE.y, EYE.z)).normalize());
        const sizeOf = mix(float(1.7), aBird.w.mul(0.3).add(0.8), flock);
        const q = positionGeometry.xy.mul(vec2(sizeOf, sizeOf.mul(0.62)));
        const p = vec4(view.x.add(q.x), view.y.add(q.y), view.z, 1.0);
        return mix(SW_CULLED, cameraProjectionMatrix.mul(p), step(0.5, live));
    })();
    material.fragmentNode = Fn(() => {
        const p = uv().sub(0.5).mul(vec2(2.0, 1.24)).toVar();
        const s = abs(p.x).toVar();
        // A wing: its line rises or falls with the beat, bowed; thick at the shoulder, a point at the tip.
        // (Between beats they are held in a shallow V, their tips a little dropped.)
        const line = vFlap.mul(0.4).add(0.16).mul(s).mul(float(1.0).sub(s.mul(0.35)))
            .sub(s.mul(s).mul(0.12));
        const thick = float(1.0).sub(s).max(0.0).pow(0.7)
            .mul(0.1)
            .add(0.012);
        const wing = abs(p.y.sub(line)).sub(thick).toVar();
        const body = length(vec2(p.x.div(0.14), p.y.add(0.03).div(0.13))).sub(1.0).mul(0.12);
        const d = min(wing, body).add(step(0.98, s).mul(1.0));
        const a = smoothstep(0.03, -0.01, d).mul(vShow);
        // A dark shape with the night's mist between it and the eye.
        const col = mix(u.forest.mul(0.45), swHaze(u, vDir), vMist.mul(0.85));
        return vec4(col.mul(a), a);
    })();
    mesh.material = material;
    const part = swPart('StillwaterBirds', geometry, material, 46, { mesh });
    part.count = n;
    return part;
}

// ── The elk ─────────────────────────────────────────────────────────────────────

/**
 * Where the elk stands (stage metres: far out in the left bank's shallows, in the window of mist
 * between the spirit and the board), how deep it wades, and the beats of its visit (seconds).
 */
export const ELK = Object.freeze({
    at: Object.freeze([-6.6, -22.5]),
    wade: 0.5,
    /** (The quad, in the animal's own metres; `size` makes a big old bull of it.) */
    width: 4.6,
    height: 3.7,
    size: 1.22,
    appear: 6,
    lower: Object.freeze([12, 15]),
    lift: Object.freeze([25, 28]),
    leave: Object.freeze([39, 46]),
});

/** Distance to a limb: a line from `a` to `b` whose thickness runs from `ra` to `rb`. */
const limb = /* @__PURE__ */ Fn(([p, a, b, ra, rb]) => {
    const pa = p.sub(a);
    const ba = b.sub(a);
    const h = clamp(dot(pa, ba).div(max(dot(ba, ba), 1e-5)), 0.0, 1.0);
    return length(pa.sub(ba.mul(h))).sub(mix(ra, rb, h));
}).setLayout({
    name: 'sw_limb',
    type: 'float',
    inputs: [
        { name: 'p', type: 'vec2' }, { name: 'a', type: 'vec2' }, { name: 'b', type: 'vec2' },
        { name: 'ra', type: 'float' }, { name: 'rb', type: 'float' },
    ],
});

/**
 * The elk, as one shape. `u.elk` = (when it came, a seed, _, _).
 * @param {object} u
 */
export function createElk(u) {
    const geometry = new THREE.PlaneGeometry(ELK.width, ELK.height);
    geometry.translate(0.25, ELK.height / 2 - 0.12, 0);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'StillwaterElk';
    material.transparent = true;
    material.premultipliedAlpha = true;
    material.depthWrite = false;
    material.fog = false;
    material.toneMapped = false;
    material.side = THREE.DoubleSide;
    material.fragmentNode = Fn(() => {
        // The quad's own metres: x along the animal (its head to the right), y up from its hooves.
        const p = vec2(uv().x.sub(0.5).mul(ELK.width).add(0.25), uv().y.mul(ELK.height).sub(0.12)).toVar();
        const t = u.time.sub(u.elk.x).toVar();
        const lifted = smoothstep(ELK.lift[0], ELK.lift[1], t);
        const drink = smoothstep(ELK.lower[0], ELK.lower[1], t).mul(float(1.0).sub(lifted))
            .toVar();
        const gone = smoothstep(ELK.leave[0], ELK.leave[1], t);
        const show = smoothstep(0.0, ELK.appear, t).mul(float(1.0).sub(gone)).toVar();
        // It breathes, and its head is never quite still.
        const breath = sin(t.mul(1.3)).mul(0.012);
        const nod = sin(t.mul(0.7).add(u.elk.y.mul(6.0))).mul(0.03).mul(float(1.0).sub(drink));
        const v = (x, y) => vec2(x, y);
        const d = float(10.0).toVar();
        const add = (shape) => d.assign(min(d, shape));
        /** A limb of this figure (plain numbers become nodes). */
        const bone = (a, b, ra, rb) => limb(p, a, b, float(ra), float(rb));
        // The body: a deep chest, the hump over the shoulders, the rump.
        add(bone(v(-0.78, 1.5), v(0.55, 1.58), float(0.44).add(breath), float(0.5).add(breath)));
        add(length(p.sub(v(0.6, 1.88))).sub(0.36));
        add(length(p.sub(v(-0.86, 1.56))).sub(0.42));
        add(length(p.sub(v(-1.3, 1.62))).sub(0.06));
        // Long legs, each in two bones.
        add(bone(v(-0.96, 1.34), v(-0.8, 0.72), 0.15, 0.075));
        add(bone(v(-0.8, 0.72), v(-0.93, 0.0), 0.07, 0.05));
        add(bone(v(-0.68, 1.3), v(-0.56, 0.72), 0.13, 0.07));
        add(bone(v(-0.56, 0.72), v(-0.66, 0.0), 0.065, 0.048));
        add(bone(v(0.64, 1.34), v(0.67, 0.7), 0.13, 0.07));
        add(bone(v(0.67, 0.7), v(0.63, 0.0), 0.065, 0.05));
        add(bone(v(0.4, 1.3), v(0.4, 0.7), 0.12, 0.065));
        add(bone(v(0.4, 0.7), v(0.35, 0.0), 0.06, 0.048));
        // The neck and the long head, lowered to the water and lifted again.
        const base = v(0.8, 1.8);
        const head = mix(v(1.38, 2.2), v(1.5, 0.98), drink).add(vec2(0.0, nod)).toVar();
        const muzzle = head.add(mix(v(0.62, -0.2), v(0.3, -0.56), drink)).toVar();
        add(bone(base, head, 0.27, 0.17));
        add(bone(head, muzzle, 0.165, 0.115));
        add(length(p.sub(muzzle.add(mix(v(0.02, -0.03), v(0.0, -0.05), drink)))).sub(0.135));
        // The bell under its throat, and an ear.
        const throat = mix(base, head, 0.78).add(v(0.04, -0.2));
        add(bone(throat, throat.add(v(0.0, -0.2)), 0.05, 0.03));
        // What the head carries turns with it.
        const turn = drink.mul(-1.05).toVar();
        const c = cos(turn);
        const s = sin(turn);
        const on = (x, y) => head.add(vec2(c.mul(x).sub(s.mul(y)), s.mul(x).add(c.mul(y))));
        add(bone(on(-0.08, 0.14), on(-0.26, 0.3), 0.055, 0.02));
        // The antlers: a broad palm with its points.
        add(bone(on(-0.06, 0.24), on(-0.52, 0.62), 0.07, 0.13));
        add(bone(on(-0.2, 0.42), on(-0.12, 0.8), 0.04, 0.012));
        add(bone(on(-0.36, 0.54), on(-0.34, 0.94), 0.04, 0.012));
        add(bone(on(-0.5, 0.62), on(-0.58, 1.0), 0.04, 0.012));
        add(bone(on(-0.6, 0.62), on(-0.86, 0.84), 0.04, 0.012));
        add(bone(on(-0.0, 0.26), on(0.22, 0.54), 0.035, 0.012));
        const P = positionWorld;
        const a = smoothstep(0.035, -0.02, d).mul(show);
        // A shape in the mist: the wood's dark, paler along its back where the moon lies on it.
        const dir = P.sub(vec3(EYE.x, EYE.y, EYE.z)).normalize();
        const back = smoothstep(-0.13, 0.0, d).mul(smoothstep(1.4, 2.2, p.y)).mul(0.8);
        const hide = mix(u.forest.mul(0.28), u.moonLight.mul(0.2).add(u.forest), back);
        // (Less of the mist than its distance would take: it is what the eye is drawn to.)
        const col = mix(hide, swHaze(u, dir), swFogAmount(u, P, 1.0).mul(0.42));
        return vec4(col.mul(a), a);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    // (Turned to the left: it has come to look at her light.)
    mesh.scale.set(-ELK.size, ELK.size, ELK.size);
    return swPart('StillwaterElk', geometry, material, 47, { mesh });
}

// ── Pillars of tarnfire ─────────────────────────────────────────────────────────

/**
 * Where the pillars stand (stage x, z; a seed; how tall, metres): on open water to either side of
 * the board, near and far, so that four lines light the whole tarn.
 */
export const PILLARS = Object.freeze([
    [-3.3, -3.4, 0.11, 6.5], [-4.7, -6.2, 0.47, 8.5], [-3.4, -12.2, 0.83, 10], [-5.3, -17.4, 0.29, 11.5],
    [-2.9, -21.5, 0.61, 12], [-7.2, -26.5, 0.95, 13], [3.4, -3.6, 0.37, 6.5], [4.5, -6.6, 0.71, 8.5],
    [3.7, -12.6, 0.05, 10], [5.3, -17.8, 0.53, 11.5], [3.0, -22, 0.89, 12], [6.7, -27, 0.19, 13],
].map((p) => Object.freeze(p)));

/** Seconds a pillar takes to rise, and the time constant it dies away with after it has stood. */
export const PILLAR = Object.freeze({
    rise: 0.7, stand: 1.3, fade: 1.5, live: 7,
});

/**
 * Four lines: the heart's gold stands up out of the tarn in tall soft pillars of light, the far
 * ones a breath after the near, and the water holds them upside down. A perfect clear turns them
 * pale as the moon. `u.pillars` = (when they rise, how strongly, how pale 0..1, _).
 * @param {object} u
 */
export function createPillars(u) {
    const n = PILLARS.length;
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.translate(0, 0.5, 0);
    const data = new Float32Array(n * 4);
    PILLARS.forEach((p, i) => data.set(p, i * 4));
    geometry.setAttribute('aPillar', new THREE.InstancedBufferAttribute(data, 4));
    const mesh = new THREE.InstancedMesh(geometry, null, n);
    mesh.frustumCulled = false;

    const material = additive('StillwaterPillars');
    const aPillar = attribute('aPillar', 'vec4');
    const vAge = varying(float(0.0), 'vPillarAge');
    const vSeed = varying(float(0.0), 'vPillarSeed');
    material.vertexNode = Fn(() => {
        const base = vec3(aPillar.x.mul(u.squeeze), 0.0, aPillar.y);
        const view = cameraViewMatrix.mul(vec4(base, 1.0)).toVar();
        const up = cameraViewMatrix.mul(vec4(0.0, 1.0, 0.0, 0.0)).xyz;
        const q = positionGeometry.xy;
        // (The far ones rise a breath after the near: the fire runs out over the tarn.)
        const late = aPillar.y.negate().mul(0.022).add(aPillar.z.mul(0.25));
        vAge.assign(u.time.sub(u.pillars.x).sub(late));
        vSeed.assign(aPillar.z);
        const wide = aPillar.w.mul(0.16).add(0.7);
        const p = view.xyz.add(up.mul(q.y.mul(aPillar.w))).add(vec3(q.x.mul(wide), 0.0, 0.0));
        return cameraProjectionMatrix.mul(vec4(p, 1.0));
    })();
    material.outputNode = Fn(() => {
        // (Clamped: under MSAA the quad's edge rows are extrapolated past 0..1, and a root of a
        // negative height is not a number: the top edge once drew as a dark line across the sky.)
        const x = clamp(uv().x, 0.0, 1.0).sub(0.5).mul(2.0);
        const y = clamp(uv().y, 0.0, 1.0);
        const age = vAge;
        const risen = smoothstep(0.0, PILLAR.rise, age);
        const power = risen.mul(exp(max(age.sub(PILLAR.stand), 0.0).div(-PILLAR.fade))).mul(step(0.0, age))
            .mul(u.pillars.y);
        // A bright thread up the middle in a wide soft body, thinning as it climbs.
        const body = exp(x.mul(x).mul(-14.0)).mul(1.1).add(exp(x.mul(x).mul(-2.6)).mul(0.3));
        const top = smoothstep(risen.mul(1.05), risen.mul(1.05).sub(0.4), y);
        const climb = max(float(1.0).sub(y), 0.0).pow(1.4);
        // The light streams upward in it.
        const stream = u.noise(vec2(x.mul(0.07).add(vSeed), y.mul(0.55).sub(age.mul(0.42)))).r;
        const live = body.mul(top).mul(climb).mul(stream.mul(1.1).add(0.45))
            .mul(float(1.0).sub(smoothstep(0.8, 1.0, abs(x))));
        const colour = mix(u.heart, u.moon.mul(vec3(1.0, 0.97, 0.9)), u.pillars.z);
        return vec4(colour.mul(live).mul(power).mul(u.breath).mul(0.62), 0.0);
    })();
    mesh.material = material;
    const part = swPart('StillwaterPillars', geometry, material, 62, { mesh });
    part.count = n;
    return part;
}

// ── The lantern's light in the air ──────────────────────────────────────────────

/**
 * A wide soft warmth round the lantern, more of it the thicker the mist: the air itself lit.
 * (The flame's own sprite is small, so as not to wash out his face; this lies behind it, faint.)
 * @param {object} u
 */
export function createLampGlow(u) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = additive('StillwaterLampGlow');
    material.vertexNode = Fn(() => {
        const view = cameraViewMatrix.mul(vec4(u.lanternAt.xyz, 1.0));
        const size = float(8.5).add(min(u.lanternAt.w, 3.0).mul(1.4));
        const q = positionGeometry.xy.mul(size);
        // (Pushed a little way back: it glows round him, not across him.)
        return cameraProjectionMatrix.mul(vec4(view.x.add(q.x), view.y.add(q.y), view.z.sub(1.6), 1.0));
    })();
    material.outputNode = Fn(() => {
        const d = length(uv().sub(0.5).mul(2.0));
        const light = exp(d.mul(d).mul(-5.5)).mul(0.085).add(exp(d.mul(-5.0)).mul(0.05))
            .mul(float(1.0).sub(smoothstep(0.75, 1.0, d)));
        const air = u.mist.mul(0.5).add(0.5).mul(float(1.0).sub(u.lift.mul(0.6)));
        return vec4(u.lantern.mul(light).mul(min(u.lanternAt.w, 3.0)).mul(air).mul(u.breath), 0.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    return swPart('StillwaterLampGlow', geometry, material, 63, { mesh });
}
