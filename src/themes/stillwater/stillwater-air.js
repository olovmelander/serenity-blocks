/**
 * Stillwater — what the night's own weather puts in the air, and who comes by.
 *
 *   rain    streaks of a soft rain, each lit by whatever light it falls past (the lantern's gold,
 *           the spirit's pale): placed by the clock in the vertex stage, more of them the harder
 *           it rains, none drawn when it is dry
 *   birds   an owl that crosses the sky past the moon on slow wings, and a flight of ducks that
 *           gets up off the far water as the hour turns: real wings that fold (stillwater-birds.js)
 *   glow    the lantern's light in the mist round it: a wide soft warmth the bloom alone never gave
 *
 * Nothing is created at event time: each part reads a uniform that says when its moment began.
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
    exp,
    float,
    fract,
    length,
    max,
    min,
    mix,
    positionGeometry,
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
    SW_CULLED, mulberry32, swFogAmount, swHaze, swPart,
} from './stillwater-tsl.js';
import { BIRDS, birdGeometry } from './stillwater-birds.js';

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

// ── Birds ───────────────────────────────────────────────────────────────────

/**
 * The flights (world metres, seconds): the owl's way across the sky, past the moon (it begins and
 * ends out of the frame), and how long it takes; the ducks' flight off the far water, and the
 * metres a second they fly at.
 */
export const FLIGHT = Object.freeze({
    owlFrom: Object.freeze([-19, 8.2, -16]),
    owlTo: Object.freeze([16, 8.8, -8.5]),
    /**
     * Metres from the eye at which it crosses the moon's bearing, and how wide its dip there is:
     * high over the wood elsewhere, it comes down across the moon's disc, dark on the brightest sky.
     */
    owlMoonRange: 20.5,
    owlDipWidth: 6.5,
    owlSpan: 12,
    /** The owl: beats a second, and its beat-and-glide cycle (seconds; the share of it spent beating). */
    owlBeat: 2.2,
    owlCycle: 4.6,
    owlBeating: 0.55,
    flockFrom: Object.freeze([0.0, 0.25, -31]),
    flockSpeed: 5.5,
    /** Metres the ducks climb, and the seconds it takes them to (they go up over the far wood, into the sky). */
    flockClimb: 13,
    flockClimbTime: 2.4,
    flockSpan: 7.5,
    duckBeat: 5.6,
    /** How much larger than life each is drawn (they are far off). */
    owlScale: 1.2,
    duckScale: 1.15,
});

/** Where duck `i` of the flight is `own` seconds after it got up (side ±1: the way they go). */
export function duckAt(i, own, side, out = [0, 0, 0]) {
    const F = FLIGHT;
    // (They get up one after another from a little stretch of water, and string out in a line.)
    const x0 = F.flockFrom[0] + (((i * 0.61) % 1) - 0.5) * 3 - side * i * 0.25;
    const z0 = F.flockFrom[2] - ((i * 0.37) % 1) * 3;
    out[0] = x0 + side * F.flockSpeed * own;
    out[1] = F.flockFrom[1] + F.flockClimb * (1 - Math.exp(-own / F.flockClimbTime)) + Math.sin(i * 1.7) * 0.4 * Math.min(1, own);
    out[2] = z0 - 0.4 * own;
    return out;
}

/**
 * The owl and the ducks. `u.flight` = (when it began, 0 the owl / 1 the ducks, which way 0..1, _).
 * Each is a mesh of its own (stillwater-birds.js) whose wings fold in the vertex stage; the owl is
 * one bird, the ducks one instanced draw of `count`.
 * @param {object} u
 * @param {number} count  ducks in the flight
 */
export function createBirds(u, count) {
    const group = new THREE.Group();
    group.name = 'StillwaterBirds';
    const n = Math.max(1, count);
    const flock = new Float32Array(n * 4); // index, three seeds
    const rand = mulberry32(4407);
    for (let i = 0; i < n; i++) flock.set([i, rand(), rand(), rand()], i * 4);

    const make = (kind) => {
        const geometry = birdGeometry(kind);
        const instances = kind === 'owl' ? 1 : n;
        geometry.setAttribute('aBird', new THREE.InstancedBufferAttribute(
            kind === 'owl' ? new Float32Array([0, 0.5, 0.5, 0.5]) : flock,
            4,
        ));
        const mesh = new THREE.InstancedMesh(geometry, null, instances);
        mesh.frustumCulled = false;
        const material = new THREE.MeshBasicNodeMaterial();
        material.name = kind === 'owl' ? 'StillwaterOwl' : 'StillwaterDucks';
        material.side = THREE.DoubleSide;
        material.fog = false;
        material.toneMapped = false;
        const aBird = attribute('aBird', 'vec4');
        const aWing = attribute('aWing', 'vec4');
        const vWorld = varying(vec3(0.0), kind === 'owl' ? 'vOwlWorld' : 'vDuckWorld');
        const vUp = varying(float(0.0), kind === 'owl' ? 'vOwlUp' : 'vDuckUp');
        const B = BIRDS[kind];
        material.vertexNode = Fn(() => {
            const age = u.time.sub(u.flight.x).toVar();
            const side = step(0.5, u.flight.z).mul(2.0).sub(1.0).toVar();
            const at = vec3(0.0).toVar();
            const fwd = vec3(0.0, 0.0, 1.0).toVar();
            const own = float(0.0).toVar();
            const glide = float(0.0).toVar();
            const phase = float(0.0).toVar();
            let live;
            let scale;
            if (kind === 'owl') {
                const F = FLIGHT;
                // (One line across the sky, flown either way; it dips across the moon wherever the
                // hour has the moon stand.)
                const raw = clamp(age.div(F.owlSpan), 0.0, 1.0);
                const k = mix(float(1.0).sub(raw), raw, step(0.0, side));
                const a = vec3(F.owlFrom[0], F.owlFrom[1], F.owlFrom[2]);
                const b = vec3(F.owlTo[0], F.owlTo[1], F.owlTo[2]);
                const moon = u.moonDir.mul(F.owlMoonRange).add(vec3(0.0, 1.65, 6.0));
                const path = (kk) => {
                    const line = mix(a, b, kk);
                    const q = line.x.sub(moon.x).div(F.owlDipWidth);
                    const dip = max(line.y.sub(moon.y), 0.0).mul(exp(q.mul(q).negate()));
                    return line.sub(vec3(0.0, dip, 0.0));
                };
                at.assign(path(k).add(vec3(0.0, sin(age.mul(1.1)).mul(0.08), 0.0)));
                fwd.assign(path(k.add(side.mul(0.004))).sub(path(k)).normalize());
                // Beats, then a long silent glide, then beats again.
                const c = fract(age.div(F.owlCycle));
                glide.assign(smoothstep(F.owlBeating - 0.06, F.owlBeating + 0.04, c).mul(float(1.0).sub(smoothstep(0.93, 1.0, c))));
                phase.assign(age.mul(F.owlBeat));
                own.assign(age);
                live = step(0.0, age).mul(step(age, F.owlSpan));
                scale = F.owlScale;
            } else {
                const F = FLIGHT;
                const i = aBird.x;
                // (One after another off the water.)
                own.assign(max(age.sub(i.mul(0.22).add(aBird.y.mul(0.15))), 0.0));
                const x0 = float(F.flockFrom[0]).add(fract(i.mul(0.61)).sub(0.5).mul(3.0)).sub(side.mul(i).mul(0.25));
                const z0 = float(F.flockFrom[2]).sub(fract(i.mul(0.37)).mul(3.0));
                const climb = float(1.0).sub(exp(own.div(-F.flockClimbTime)));
                at.assign(vec3(
                    x0.add(side.mul(F.flockSpeed).mul(own)),
                    float(F.flockFrom[1]).add(climb.mul(F.flockClimb)).add(sin(i.mul(1.7)).mul(0.4).mul(min(own, 1.0))),
                    z0.sub(own.mul(0.4)),
                ));
                fwd.assign(vec3(side.mul(F.flockSpeed), exp(own.div(-F.flockClimbTime)).mul(F.flockClimb / F.flockClimbTime), -0.4)
                    .normalize());
                phase.assign(own.mul(F.duckBeat).add(aBird.z));
                live = step(0.0, age).mul(step(0.001, own)).mul(step(own, F.flockSpan));
                scale = F.duckScale;
            }
            // The wings fold at the wrist and the shoulder (stillwater-birds.js foldWing, line for line).
            const ang = phase.mul(Math.PI * 2);
            const owlish = kind === 'owl';
            const beat = sin(ang).mul(owlish ? 0.62 : 0.5).add(owlish ? 0.08 : 0.12);
            const handBeat = sin(ang.sub(0.7)).mul(owlish ? 0.45 : 0.32).sub(owlish ? 0.05 : 0.0);
            const sAng = beat.mul(float(1.0).sub(glide)).add(glide.mul(0.1));
            const wAng = handBeat.mul(float(1.0).sub(glide)).sub(glide.mul(0.06));
            const p = positionGeometry.toVar();
            const wingSide = aWing.x;
            const turn = (q, cx, angle) => {
                const c = angle.cos();
                const s2 = angle.sin();
                const dx = q.x.sub(cx);
                return vec3(cx.add(dx.mul(c)).sub(q.y.mul(s2)), dx.mul(s2).add(q.y.mul(c)), q.z);
            };
            p.assign(turn(p, wingSide.mul(B.wrist), wingSide.mul(wAng).mul(aWing.z)));
            p.assign(turn(p, wingSide.mul(B.shoulder), wingSide.mul(sAng).mul(aWing.y)));
            // The body heaves against the wingbeat.
            p.y.addAssign(sin(ang).mul(-0.025).mul(float(1.0).sub(glide)).mul(float(1.0).sub(abs(wingSide))));
            // On its way, banked a little into the air it rides.
            const upHint = vec3(0.0, 1.0, 0.0);
            const U0 = upHint.sub(fwd.mul(fwd.dot(upHint))).normalize();
            const X0 = U0.cross(fwd);
            const bank = sin(own.mul(0.7).add(aBird.w.mul(6.0))).mul(0.12);
            const X = X0.mul(bank.cos()).add(U0.mul(bank.sin()));
            const U = U0.mul(bank.cos()).sub(X0.mul(bank.sin()));
            const world = at.add(X.mul(p.x.mul(scale))).add(U.mul(p.y.mul(scale))).add(fwd.mul(p.z.mul(scale))).toVar();
            vWorld.assign(world);
            vUp.assign(U.y);
            const clip = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(world, 1.0)));
            return mix(SW_CULLED, clip, step(0.5, live));
        })();
        material.fragmentNode = Fn(() => {
            const P = vWorld;
            // A dark shape against the night: its underside darkest, a little moonlight on its back
            // and on the edges of its wings, the mist between it and the eye.
            const dir = P.sub(cameraPosition).normalize();
            const towardMoon = clamp(dir.dot(u.moonDir).mul(0.5).add(0.5), 0.0, 1.0);
            const base = u.forest.mul(0.2).add(u.moonLight.mul(0.008));
            const rim = u.glow.mul(towardMoon.mul(towardMoon).mul(towardMoon)).mul(0.06);
            const lamp = u.lantern.mul(u.lanternAt.w.div(P.sub(u.lanternAt.xyz).dot(P.sub(u.lanternAt.xyz)).mul(0.08).add(1.0)))
                .mul(0.05);
            const col = base.add(rim).add(lamp).mul(u.breath.mul(0.3).add(0.7));
            return vec4(mix(col, swHaze(u, dir), swFogAmount(u, P, 0.75).mul(0.7)), 1.0);
        })();
        mesh.material = material;
        mesh.renderOrder = 9;
        mesh.name = material.name;
        return mesh;
    };
    const owl = make('owl');
    const ducks = make('duck');
    group.add(owl, ducks);
    const part = swPart('StillwaterBirds', owl.geometry, owl.material, 9, { mesh: group });
    part.owl = owl;
    part.ducks = ducks;
    part.count = n;
    part.dispose = () => {
        ducks.geometry.dispose();
        ducks.material.dispose();
    };
    return part;
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
