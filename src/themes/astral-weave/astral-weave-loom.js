/**
 * Astral Weave — the loom. Every part lives in LOOM-LOCAL space: the hoop is the unit circle in
 * the z = 0 plane, +z toward the camera; the world scales, places and tilts the group.
 *
 *  - Rosette: the string-art weave. Thread i runs from the peg at angle a to the peg at k·a + φ;
 *    the envelope of the chords is an epicycloid with k − 1 cusps (the petals), a single fan at
 *    k = 0 and a hypocycloid star for k < 0. `k` is ONE uniform, so re-weaving the whole figure
 *    is free. Threads bow a little out of the plane (parallax under the hoop's tilt), carry
 *    travelling beads of light, ring like plucked strings near a lock and light in sequence
 *    when a clear's front runs round the hoop.
 *  - Wefts: one thread per board row, a horizontal chord of the hoop at that row's height. A
 *    lock throws the shuttle across its rows; the thread stays, ringing, until a clear burns it.
 *  - Warp: anchor threads from the hoop out past the frame, two opposed twists (a hyperboloid),
 *    defocused as they near the camera. A clear's front launches a pulse down each one.
 *  - Hoop, gimbals, pegs, the heart star and the crown flare, and a pool of stateless sparks.
 *
 * All motion is closed-form in the world clock and event timestamps: no compute, no per-frame
 * uploads, nothing created at event time (sparks are written into a ring of dormant slots).
 * Thread width is in SCREEN pixels (awRibbonClip), so the weave is as fine at 4K as at 720p.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    atan,
    attribute,
    clamp,
    cos,
    dot,
    exp,
    float,
    floor,
    fract,
    length,
    max,
    mix,
    positionGeometry,
    pow,
    sin,
    smoothstep,
    sqrt,
    step,
    texture,
    uv,
    vec2,
    vec3,
    vec4,
    vertexStage,
} from 'three/tsl';
import {
    TAU, awFxMaterial, awLoomClip, awQuadGeometry, awRibbonClip, awSpectrum, awSpriteClip, awThreadGeometry,
    mulberry32,
} from './astral-weave-tsl.js';

/** Per-tier loom budgets. */
export const LOOM_TIERS = Object.freeze({
    Minimal: {
        threads: 72, segments: 12, warp: 10, pegs: 24, gimbals: 1, sparks: 128,
    },
    Low: {
        threads: 96, segments: 16, warp: 14, pegs: 36, gimbals: 1, sparks: 192,
    },
    Medium: {
        threads: 132, segments: 20, warp: 20, pegs: 36, gimbals: 2, sparks: 320,
    },
    High: {
        threads: 180, segments: 24, warp: 26, pegs: 36, gimbals: 2, sparks: 512,
    },
    Ultra: {
        threads: 240, segments: 28, warp: 32, pegs: 36, gimbals: 2, sparks: 768,
    },
    Extreme: {
        threads: 300, segments: 32, warp: 40, pegs: 36, gimbals: 2, sparks: 1024,
    },
});

export const PLUCK_SLOTS = 3;
export const SWEEP_SLOTS = 4;
export const WEFT_ROWS = 20;
/** Seconds a clear's front takes to run half-way round the hoop (ease-out). */
export const SWEEP_SECONDS = 1.15;
/** Seconds the shuttle takes to cross the hoop. */
export const SHUTTLE_SECONDS = 0.42;
/** Where the warp threads end: radius and height (toward the camera), in hoop radii. */
const WARP_OUT = Object.freeze({ radius: 3.3, z: 0.95 });

const { PI } = Math;

/** |a − b| wrapped to [0, π]. */
const angDist = (a, b) => abs(fract(a.sub(b).div(TAU).add(0.5)).sub(0.5)).mul(TAU);

/**
 * How brightly something at hoop angle `angle` is lit by the clears' fronts right now: each front
 * starts at its own angle and runs both ways round the hoop, leaving a short afterglow.
 */
function sweepGlow(shared, angle) {
    const { uTime, uSweep } = shared;
    let glow = float(0.0);
    for (let i = 0; i < SWEEP_SLOTS; i++) {
        const S = uSweep.element(i);
        const tau = max(uTime.sub(S.y), 0.0);
        const h = clamp(tau.div(SWEEP_SECONDS), 0.0, 1.0);
        const frontA = float(1.0).sub(float(1.0).sub(h).mul(float(1.0).sub(h))).mul(PI);
        const d = angDist(angle, S.x).sub(frontA);
        const head = exp(d.mul(d).mul(-70.0));
        const wake = step(d, 0.0).mul(exp(d.mul(1.6))).mul(0.3);
        glow = glow.add(head.add(wake).mul(S.z).mul(exp(tau.mul(-1.15))));
    }
    return glow;
}

/** Seconds after a sweep starts that its front reaches the hoop angle `dA` away (inverse ease). */
const sweepArrival = (dA) => float(1.0).sub(sqrt(float(1.0).sub(clamp(dA.div(PI), 0.0, 0.995)))).mul(SWEEP_SECONDS);

// ─────────────────────────────────────────────────────────────────────────────
// The rosette
// ─────────────────────────────────────────────────────────────────────────────

const ROSETTE_HALF_PX = 5.0;

export function createRosette(shared, count, segments) {
    const geometry = awThreadGeometry(count, segments, 4242);
    const material = awFxMaterial('astral-weave-rosette');
    const {
        uTime, uViewport, uPxScale, uLoomPx, uK, uPhase, uSpin, uHeat, uEnergy, uPluck, uFade,
    } = shared;
    const th = attribute('aThread', 'vec4');
    const t = positionGeometry.x;
    const side = positionGeometry.y;

    const base = th.x.mul(TAU);
    const a = base.add(uSpin);
    const b = base.mul(uK).add(uSpin).add(uPhase);
    const A = vec2(cos(a), sin(a));
    const B = vec2(cos(b), sin(b));
    const chord = B.sub(A);
    const len = max(length(chord), 1e-3);
    const dirC = chord.div(len);
    const nrmC = vec2(dirC.y.negate(), dirC.x);

    // Plucks: a lock rings the threads that pass near it and sends light along them.
    const plucks = [];
    for (let i = 0; i < PLUCK_SLOTS; i++) {
        const S = uPluck.element(i);
        const rel = S.xy.sub(A);
        const t0 = clamp(dot(rel, dirC).div(len), 0.03, 0.97);
        const dist = dot(rel, nrmC);
        const tau = max(uTime.sub(S.z), 0.0);
        const weight = exp(dist.mul(dist).mul(-34.0)).mul(S.w);
        plucks.push({ t0, tau, weight });
    }
    const curveAt = (tt) => {
        const arch = sin(tt.mul(PI));
        let ring = float(0.0);
        for (let i = 0; i < PLUCK_SLOTS; i++) {
            const { tau, weight } = plucks[i];
            const wave = arch.mul(cos(tau.mul(23.0)))
                .add(sin(tt.mul(TAU)).mul(cos(tau.mul(46.0).add(1.0))).mul(0.45));
            ring = ring.add(wave.mul(weight).mul(exp(tau.mul(-2.6))));
        }
        const flat = A.add(chord.mul(tt)).add(nrmC.mul(ring.mul(0.026)));
        const bow = arch.mul(len).mul(th.y.mul(0.1).add(0.02)).negate();
        return vec3(flat, bow.add(ring.mul(0.02)));
    };
    material.vertexNode = awRibbonClip(
        curveAt(t),
        curveAt(t.add(0.02)),
        side,
        uPxScale.mul(ROSETTE_HALF_PX),
        uViewport,
    );

    const glow = sweepGlow(shared, a);

    material.colorNode = Fn(() => {
        const st = uv();
        const tt = st.x;
        const yPx = st.y.mul(2.0).sub(1.0).mul(ROSETTE_HALF_PX);
        const vTh = vertexStage(th);
        const vLen = vertexStage(len);
        const vGlow = vertexStage(glow);
        const core = exp(yPx.mul(yPx).div(-0.7));
        const halo = exp(yPx.mul(yPx).div(-8.5)).mul(0.24);
        const body = core.add(halo);
        const shimmer = sin(tt.mul(19.0).add(vTh.z.mul(40.0)).add(uTime.mul(0.5))).mul(0.18).add(0.82);
        const ends = smoothstep(0.0, 0.02, tt).mul(smoothstep(0.0, 0.02, float(1.0).sub(tt)));
        // Each chord touches the envelope at t = 1 / (1 + k): the thread is brightest there, so the
        // figure reads as luminous petals and the long spans stay quiet silk.
        const touch = tt.sub(clamp(float(1.0).div(max(uK.add(1.0), 1.0)), 0.0, 1.0));
        const petal = exp(touch.mul(touch).mul(-22.0)).mul(1.05).add(0.26);
        const k = body.mul(shimmer).mul(petal).mul(0.15).mul(uEnergy.mul(0.45).add(1.0))
            .toVar();
        k.mulAssign(vGlow.mul(7.0).add(1.0));

        // Beads of light on a third of the threads, two to a thread, drifting along it.
        const lenPx = vLen.mul(uLoomPx).div(uPxScale);
        const flow = mix(float(0.025), float(0.08), vTh.y).mul(uEnergy.mul(1.2).add(1.0))
            .mul(step(0.5, vTh.z).mul(2.0).sub(1.0));
        const dx = fract(tt.mul(2.0).sub(uTime.mul(flow)).add(vTh.z)).sub(0.5).mul(lenPx).mul(0.5);
        const bead = exp(dx.mul(dx).add(yPx.mul(yPx)).div(-3.4)).mul(step(0.66, vTh.w));
        k.addAssign(bead.mul(1.5).mul(vGlow.mul(2.0).add(1.0)));

        // Light running out from each pluck along the threads that pass near it.
        for (let i = 0; i < PLUCK_SLOTS; i++) {
            const vT0 = vertexStage(plucks[i].t0);
            const vW = vertexStage(plucks[i].weight);
            const vTau = vertexStage(plucks[i].tau);
            const d = abs(tt.sub(vT0)).mul(vLen).sub(vTau.mul(1.7));
            k.addAssign(body.mul(exp(d.mul(d).mul(-190.0))).mul(vW).mul(exp(vTau.mul(-1.9))).mul(1.5));
        }

        const tint = awSpectrum(vTh.x.add(tt.mul(0.12)).add(uTime.mul(0.006)), uHeat);
        // The hottest pile-ups (the caustics, the fan) burn toward white.
        const col = mix(tint, vec3(1.0, 0.97, 0.92), clamp(vGlow.mul(0.5), 0.0, 0.7));
        return vec4(col.mul(k).mul(ends).mul(uFade), 0.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'astral-weave-rosette';
    mesh.frustumCulled = false;
    mesh.renderOrder = 20;
    return {
        mesh,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// The wefts
// ─────────────────────────────────────────────────────────────────────────────

const WEFT_HALF_PX = 9.0;

export function createWefts(shared, segments) {
    const geometry = awThreadGeometry(WEFT_ROWS, segments, 7711);
    const material = awFxMaterial('astral-weave-wefts');
    const {
        uTime, uViewport, uPxScale, uLoomPx, uHeat, uBoard, uWeftA, uWeftB, uFade,
    } = shared;
    const th = attribute('aThread', 'vec4');
    const t = positionGeometry.x;
    const side = positionGeometry.y;

    const row = floor(th.x.mul(WEFT_ROWS).add(0.5));
    const WA = uWeftA.element(row.toInt()); // birth, strength, direction (±1), hard-drop gain
    const WB = uWeftB.element(row.toInt()); // clear time, clear strength, lock x, pluck gain
    const y = uBoard.z.sub(row.add(0.5).mul(uBoard.w));
    const inside = step(abs(y), 0.985);
    const half = sqrt(max(float(1.0).sub(y.mul(y)), 1e-4));
    const len = half.mul(2.0);
    const tau = max(uTime.sub(WA.x), 0.0);
    const strength = WA.y.mul(inside);
    const flight = clamp(tau.div(SHUTTLE_SECONDS), 0.0, 1.0);
    const eased = float(1.0).sub(float(1.0).sub(flight).mul(float(1.0).sub(flight)));
    const head = mix(float(1.0).sub(eased), eased, step(0.0, WA.z));
    const plucked = clamp(WB.z.add(half).div(len), 0.06, 0.94);

    const curveAt = (tt) => {
        // A string plucked at `plucked`: the first three harmonics, each dying faster.
        let wave = float(0.0);
        for (let n = 1; n <= 3; n++) {
            wave = wave.add(
                sin(plucked.mul(n * PI)).mul(sin(tt.mul(n * PI))).mul(cos(tau.mul(n * 17.0)))
                    .mul(exp(tau.mul(-1.5 * n)))
                    .div(n * n),
            );
        }
        const ring = wave.mul(WB.w).mul(strength).mul(0.034);
        return vec3(mix(half.negate(), half, tt), y.add(ring), ring.mul(0.6));
    };
    material.vertexNode = awRibbonClip(
        curveAt(t),
        curveAt(t.add(0.02)),
        side,
        uPxScale.mul(WEFT_HALF_PX).mul(step(0.001, strength)),
        uViewport,
    );

    material.colorNode = Fn(() => {
        const st = uv();
        const tt = st.x;
        const yPx = st.y.mul(2.0).sub(1.0).mul(WEFT_HALF_PX);
        const vWA = vertexStage(WA);
        const vWB = vertexStage(WB);
        const vRow = vertexStage(row);
        const vLen = vertexStage(len);
        const vHead = vertexStage(head);
        const vTau = vertexStage(tau);
        const vFlight = vertexStage(flight);
        const vStrength = vertexStage(strength);
        const lenPx = vLen.mul(uLoomPx).div(uPxScale);
        const core = exp(yPx.mul(yPx).div(-0.9));
        const halo = exp(yPx.mul(yPx).div(-11.0)).mul(0.24);
        const body = core.add(halo);

        // The thread exists behind the shuttle.
        const ahead = tt.sub(vHead).mul(vWA.z); // > 0: not yet woven
        const laid = float(1.0).sub(smoothstep(-0.004, 0.004, ahead));
        const dHead = tt.sub(vHead).mul(lenPx);
        const flying = float(1.0).sub(smoothstep(0.92, 1.0, vFlight));
        const shuttle = exp(dHead.mul(dHead).div(-150.0).add(yPx.mul(yPx).div(-10.0))).mul(flying).mul(11.0)
            .add(exp(dHead.mul(dHead).add(yPx.mul(yPx)).div(-7.0)).mul(flying).mul(16.0))
            .mul(vWA.w.mul(0.7).add(1.0));
        const wake = laid.mul(exp(abs(dHead).div(-190.0))).mul(flying).mul(2.2);
        const fresh = exp(vTau.mul(-1.3)).mul(0.9);
        const settled = exp(vTau.mul(-0.06)).mul(0.2).add(0.075);
        const k = body.mul(laid).mul(settled.add(fresh).add(wake)).add(shuttle).toVar();

        // A clear burns the row: a flash, a runner racing out to the hoop, then the thread is gone.
        const cleared = step(vWA.x, vWB.x);
        const tc = max(uTime.sub(vWB.x), 0.0);
        const xLocal = abs(tt.sub(0.5)).mul(vLen);
        const front = xLocal.sub(uBoard.y.mul(0.5)).sub(tc.mul(2.6));
        const runner = exp(front.mul(front).mul(-160.0)).mul(exp(tc.mul(-1.2))).mul(7.0);
        const flash = exp(tc.mul(-3.4)).mul(4.5);
        const burn = cleared.mul(vWB.y);
        k.assign(mix(k, k.mul(float(1.0).sub(smoothstep(0.3, 0.95, tc))).add(body.mul(flash.add(runner))), burn));

        const tint = awSpectrum(vRow.div(WEFT_ROWS).mul(0.45).add(0.05).add(tt.mul(0.08)), uHeat);
        const hot = clamp(shuttle.mul(0.2).add(burn.mul(exp(tc.mul(-2.0)))).add(fresh.mul(0.25)), 0.0, 0.85);
        const col = mix(tint, vec3(1.0, 0.95, 0.86), hot);
        return vec4(col.mul(k).mul(vStrength).mul(uFade), 0.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'astral-weave-wefts';
    mesh.frustumCulled = false;
    mesh.renderOrder = 22;
    return {
        mesh,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// The warp
// ─────────────────────────────────────────────────────────────────────────────

const WARP_HALF_PX = 12.0;

export function createWarp(shared, pairs, segments) {
    const count = Math.max(2, pairs * 2);
    const geometry = awThreadGeometry(count, Math.max(6, Math.round(segments * 0.5)), 3301);
    const material = awFxMaterial('astral-weave-warp');
    const {
        uTime, uViewport, uPxScale, uSpin, uHeat, uEnergy, uSweep, uWarpTwist, uFade,
    } = shared;
    const th = attribute('aThread', 'vec4');
    const t = positionGeometry.x;
    const side = positionGeometry.y;

    const index = floor(th.x.mul(count).add(0.5));
    const pair = floor(index.mul(0.5));
    const sgn = index.sub(pair.mul(2.0)).mul(2.0).sub(1.0);
    const a = pair.div(pairs).mul(TAU).add(uSpin.mul(0.6));
    const bAng = a.add(sgn.mul(uWarpTwist));
    const A = vec3(cos(a), sin(a), 0.0);
    const B = vec3(cos(bAng).mul(WARP_OUT.radius), sin(bAng).mul(WARP_OUT.radius), WARP_OUT.z);
    const curveAt = (tt) => mix(A, B, tt);
    // Nearer the camera the thread is out of focus: wider and softer.
    const blur = t.mul(t);
    material.vertexNode = awRibbonClip(
        curveAt(t),
        curveAt(t.add(0.03)),
        side,
        uPxScale.mul(mix(float(3.0), float(WARP_HALF_PX), blur)),
        uViewport,
    );

    // The clears' fronts launch a pulse out along each warp thread as they pass its peg.
    const pulseAge = [];
    for (let i = 0; i < SWEEP_SLOTS; i++) {
        const S = uSweep.element(i);
        pulseAge.push({
            age: uTime.sub(S.y).sub(sweepArrival(angDist(a, S.x))),
            gain: S.z,
        });
    }

    material.colorNode = Fn(() => {
        const st = uv();
        const tt = st.x;
        const vTh = vertexStage(th);
        const vPair = vertexStage(pair);
        const halfPx = mix(float(3.0), float(WARP_HALF_PX), tt.mul(tt));
        const yPx = st.y.mul(2.0).sub(1.0).mul(halfPx);
        const sigma = mix(float(0.8), float(4.2), tt.mul(tt));
        const body = exp(yPx.mul(yPx).div(sigma.mul(sigma).mul(-1.0))).div(sigma.mul(1.1).add(0.1));
        const reach = pow(float(1.0).sub(tt), float(1.2)).mul(smoothstep(0.0, 0.03, tt));
        const k = body.mul(reach).mul(0.075).mul(uEnergy.mul(0.5).add(1.0)).toVar();
        // A slow bead drifting in toward the hoop.
        const ph = fract(tt.mul(1.0).add(uTime.mul(mix(float(0.018), float(0.04), vTh.y))).add(vTh.z)).sub(0.5);
        k.addAssign(body.mul(exp(ph.mul(ph).mul(-5200.0))).mul(reach).mul(0.6));
        for (let i = 0; i < SWEEP_SLOTS; i++) {
            const vAge = vertexStage(pulseAge[i].age);
            const vGain = vertexStage(pulseAge[i].gain);
            const d = tt.sub(max(vAge, 0.0).mul(1.25));
            k.addAssign(body.mul(exp(d.mul(d).mul(-260.0))).mul(step(0.0, vAge)).mul(exp(max(vAge, 0.0).mul(-1.5)))
                .mul(vGain)
                .mul(2.6));
        }
        const tint = mix(awSpectrum(vPair.div(pairs).add(0.15), uHeat), vec3(0.4, 0.55, 0.95), tt.mul(0.5));
        return vec4(tint.mul(k).mul(uFade), 0.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'astral-weave-warp';
    mesh.frustumCulled = false;
    mesh.renderOrder = 18;
    return {
        mesh,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// The hoop and its gimbals
// ─────────────────────────────────────────────────────────────────────────────

const HOOP_EXTENT = 1.14;

/**
 * A ring drawn on a quad in its own plane. `main` builds the hoop proper (graduated ticks, the
 * clears' fronts, the crown); the gimbals are plain hairlines with two travelling beads.
 */
export function createHoop(shared, {
    main = true, radius = 1, gain = 1, speed = 0.21, name = 'astral-weave-hoop',
} = {}) {
    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = awFxMaterial(name);
    const {
        uTime, uPxScale, uLoomPx, uSpin, uHeat, uEnergy, uCrown, uFade,
    } = shared;
    const extent = HOOP_EXTENT * radius;
    material.vertexNode = awLoomClip(vec3(positionGeometry.xy.mul(extent), 0.0));

    material.colorNode = Fn(() => {
        const p = uv().sub(0.5).mul(2.0 * extent);
        const r = length(p).div(radius);
        const ang = atan(p.y, p.x);
        // One screen pixel in ring radii.
        const px = uPxScale.div(uLoomPx.mul(radius));
        const line = (r0, w) => {
            const d = r.sub(r0).div(px.mul(w));
            return exp(d.mul(d).negate());
        };
        const d1 = r.sub(1.0);
        const rim = float(1.0).sub(smoothstep(1.06, HOOP_EXTENT, r));
        const bloom = exp(d1.mul(d1).mul(-1300.0)).mul(0.11).add(exp(abs(d1).mul(-34.0)).mul(0.03)).mul(rim);
        // Highlights travelling round the ring.
        const comets = pow(max(cos(ang.sub(uTime.mul(speed))), 0.0), float(90.0))
            .add(pow(max(cos(ang.add(uTime.mul(speed * 0.61)).add(2.1)), 0.0), float(140.0)));
        const k = line(1.0, 1.25).mul(comets.mul(3.0).add(0.8)).add(bloom).toVar();
        const tint = mix(vec3(0.6, 0.8, 1.0), vec3(1.0, 0.76, 0.4), uHeat).toVar();
        if (main) {
            const sweep = sweepGlow(shared, ang);
            // Graduations: 180 minor ticks, 36 major, between the hoop and its outer hairline.
            const arc = (n) => {
                const f = fract(ang.sub(uSpin).div(TAU).mul(n)).sub(0.5).mul(TAU / n).mul(r);
                return exp(f.mul(f).div(px.mul(px).mul(-0.8)));
            };
            const minorBand = smoothstep(1.008, 1.013, r).mul(float(1.0).sub(smoothstep(1.027, 1.032, r)));
            const majorBand = smoothstep(1.008, 1.013, r).mul(float(1.0).sub(smoothstep(1.043, 1.048, r)));
            const ticks = arc(180).mul(minorBand).mul(0.22).add(arc(36).mul(majorBand).mul(0.5));
            const crown = exp(angDist(ang, uSpin.add(PI * 0.5)).mul(-5.0)).mul(uCrown);
            k.mulAssign(sweep.mul(6.0).add(crown.mul(5.0)).add(1.0));
            k.addAssign(line(1.05, 0.8).mul(0.4).add(line(0.966, 0.7).mul(0.2)).add(ticks)
                .mul(sweep.mul(3.0).add(1.0)));
            k.mulAssign(uEnergy.mul(0.4).add(1.0));
            tint.assign(mix(tint, awSpectrum(ang.div(TAU), uHeat), 0.3));
            tint.assign(mix(tint, vec3(1.0, 0.96, 0.9), clamp(sweep.add(crown), 0.0, 0.75)));
        }
        return vec4(tint.mul(k).mul(gain).mul(uFade), 0.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.renderOrder = main ? 24 : 16;
    return {
        mesh,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pegs
// ─────────────────────────────────────────────────────────────────────────────

export function createPegs(shared, count) {
    const geometry = awQuadGeometry(count, 5150);
    const material = awFxMaterial('astral-weave-pegs');
    const {
        uTime, uViewport, uPxScale, uSpin, uHeat, uEnergy, uFade,
    } = shared;
    const seed = attribute('aSeed', 'vec4');
    // aSeed carries no index: recover the slot from the instance order baked into .x below.
    const slot = attribute('aPeg', 'float');
    const ang = slot.div(count).mul(TAU).add(uSpin);
    const flare = sweepGlow(shared, ang);
    const sizePx = uPxScale.mul(mix(float(13.0), float(20.0), seed.y)).mul(flare.mul(1.6).add(1.0));
    material.vertexNode = awSpriteClip(vec3(cos(ang), sin(ang), 0.0), positionGeometry.xy.mul(sizePx), uViewport);
    material.colorNode = Fn(() => {
        const st = uv().sub(0.5).mul(2.0);
        const vSeed = vertexStage(seed);
        const vFlare = vertexStage(flare);
        const r = length(st);
        const arm = (v) => exp(abs(v.y).mul(-26.0)).mul(exp(abs(v.x).mul(-5.0)));
        const gem = exp(r.mul(r).mul(-42.0)).mul(1.5).add(arm(st).add(arm(st.yx)).mul(0.5));
        const tw = sin(uTime.mul(vSeed.x.mul(1.4).add(0.6)).add(vSeed.z.mul(TAU))).mul(0.25).add(0.75);
        const edge = float(1.0).sub(smoothstep(0.75, 1.0, r));
        const tint = mix(mix(vec3(0.66, 0.84, 1.0), vec3(1.0, 0.8, 0.46), uHeat), vec3(1.0, 0.97, 0.92), 0.35);
        const k = gem.mul(edge).mul(tw.add(vFlare.mul(5.0))).mul(uEnergy.mul(0.5).add(0.85));
        return vec4(tint.mul(k).mul(uFade), 0.0);
    })();
    const slots = new Float32Array(Math.max(1, count));
    for (let i = 0; i < slots.length; i++) slots[i] = i;
    geometry.setAttribute('aPeg', new THREE.InstancedBufferAttribute(slots, 1));

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'astral-weave-pegs';
    mesh.frustumCulled = false;
    mesh.renderOrder = 26;
    return {
        mesh,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// The heart star and the crown flare
// ─────────────────────────────────────────────────────────────────────────────

export function createFlares(shared) {
    const geometry = awQuadGeometry(2, 1123);
    const kinds = new Float32Array([0, 1]);
    geometry.setAttribute('aKind', new THREE.InstancedBufferAttribute(kinds, 1));
    const material = awFxMaterial('astral-weave-flares');
    const {
        uTime, uViewport, uLoomPx, uSpin, uHeat, uCore, uCrown, uFade, noiseTex,
    } = shared;
    const kind = attribute('aKind', 'float');
    const crownAng = uSpin.add(PI * 0.5);
    // The heart sits a little behind the weave; the crown is the peg at the top of the hoop.
    const centre = mix(vec3(0.0, 0.0, -0.22), vec3(cos(crownAng), sin(crownAng), 0.0), kind);
    const span = mix(float(2.3), float(1.7), kind); // quad edge, in hoop radii
    material.vertexNode = awSpriteClip(centre, positionGeometry.xy.mul(span).mul(uLoomPx), uViewport);
    material.colorNode = Fn(() => {
        const st = uv().sub(0.5).mul(2.0);
        const vKind = vertexStage(kind);
        const r = length(st);
        const ang = atan(st.y, st.x);
        const n = texture(noiseTex, vec2(ang.div(TAU).mul(2.0).add(vKind.mul(0.37)), uTime.mul(0.021))).level(0);
        const rays = pow(n.x, float(3.2)).mul(1.7).add(pow(n.y, float(6.0)).mul(1.2));
        const edge = float(1.0).sub(smoothstep(0.6, 1.0, r));
        // Heart: a broad cool wash and soft rays; its hot centre is behind the card.
        const heart = exp(r.mul(-6.5)).mul(0.5).add(exp(r.mul(r).mul(-55.0)).mul(1.2))
            .add(rays.mul(exp(r.mul(-3.4))).mul(0.16))
            .mul(uCore);
        // Crown: a hard star that only burns when the weave gathers there.
        const arm = (v) => exp(abs(v.y).mul(-150.0)).mul(exp(abs(v.x).mul(-3.2)));
        const crown = exp(r.mul(-11.0)).mul(2.6).add(exp(r.mul(r).mul(-900.0)).mul(9.0))
            .add(arm(st).mul(1.6))
            .add(arm(st.yx).mul(0.9))
            .add(rays.mul(exp(r.mul(-4.6))).mul(1.1))
            .mul(uCrown);
        const tint = mix(
            mix(vec3(0.42, 0.62, 1.0), vec3(1.0, 0.6, 0.24), uHeat),
            mix(vec3(0.9, 0.95, 1.0), vec3(1.0, 0.85, 0.55), uHeat),
            vKind,
        );
        return vec4(tint.mul(mix(heart, crown, vKind)).mul(edge).mul(uFade), 0.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'astral-weave-flares';
    mesh.frustumCulled = false;
    mesh.renderOrder = 14;
    return {
        mesh,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sparks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A ring of dormant spark slots. `emit` writes origin, velocity and look for a few of them; the
 * vertex stage flies each one in closed form (drag, a slow swirl round the hoop's axis), so a
 * burst costs one small buffer upload and nothing per frame.
 */
export function createSparks(shared, count) {
    const n = Math.max(1, count | 0);
    const origin = new Float32Array(n * 4);
    const velocity = new Float32Array(n * 4);
    const look = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
        origin[i * 4 + 3] = -1000;
        velocity[i * 4 + 3] = 1;
        look[i * 4 + 3] = 1;
    }
    const aOrigin = new THREE.InstancedBufferAttribute(origin, 4);
    const aVelocity = new THREE.InstancedBufferAttribute(velocity, 4);
    const aLook = new THREE.InstancedBufferAttribute(look, 4);
    const geometry = awQuadGeometry(n, 808, { aOrigin, aVelocity, aLook });
    const material = awFxMaterial('astral-weave-sparks');
    const {
        uTime, uViewport, uPxScale, uHeat, uFade,
    } = shared;
    const O = attribute('aOrigin', 'vec4');
    const V = attribute('aVelocity', 'vec4');
    const L = attribute('aLook', 'vec4'); // size px, hue, swirl, drag
    const seed = attribute('aSeed', 'vec4');

    const age = uTime.sub(O.w);
    const life = max(V.w, 1e-3);
    const alive = step(0.0, age).mul(step(age, life));
    const run = float(1.0).sub(exp(age.mul(L.w).negate())).div(L.w);
    const flown = O.xyz.add(V.xyz.mul(run));
    const turn = L.z.mul(age);
    const cs = cos(turn);
    const sn = sin(turn);
    const centre = vec3(
        flown.x.mul(cs).sub(flown.y.mul(sn)),
        flown.x.mul(sn).add(flown.y.mul(cs)),
        flown.z,
    );
    const spent = clamp(age.div(life), 0.0, 1.0);
    const sizePx = uPxScale.mul(L.x).mul(float(1.0).sub(spent.mul(spent)).mul(0.75).add(0.25)).mul(alive);
    material.vertexNode = awSpriteClip(centre, positionGeometry.xy.mul(sizePx), uViewport);
    material.colorNode = Fn(() => {
        const st = uv().sub(0.5).mul(2.0);
        const vL = vertexStage(L);
        const vSeed = vertexStage(seed);
        const vSpent = vertexStage(spent);
        const vAlive = vertexStage(alive);
        const r = length(st);
        const arm = (v) => exp(abs(v.y).mul(-22.0)).mul(exp(abs(v.x).mul(-4.0)));
        const body = exp(r.mul(r).mul(-14.0)).mul(1.6).add(arm(st).add(arm(st.yx)).mul(0.5));
        const edge = float(1.0).sub(smoothstep(0.7, 1.0, r));
        const fade = float(1.0).sub(vSpent).mul(float(1.0).sub(vSpent));
        const flicker = sin(uTime.mul(vSeed.x.mul(22.0).add(9.0)).add(vSeed.y.mul(TAU))).mul(0.25).add(0.75);
        const tint = mix(awSpectrum(vL.y, uHeat), vec3(1.0, 0.96, 0.9), fade.mul(0.6));
        return vec4(tint.mul(body).mul(edge).mul(fade).mul(flicker)
            .mul(vAlive)
            .mul(3.2)
            .mul(uFade), 0.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'astral-weave-sparks';
    mesh.frustumCulled = false;
    mesh.renderOrder = 30;

    const rand = mulberry32(60601);
    let cursor = 0;
    let dirty = false;
    return {
        mesh,
        count: n,
        /**
         * Write `amount` sparks. `shape`: x, y, z origin (hoop radii); `dirX/dirY` a preferred
         * direction (0 = radial burst); `speed`, `spread` (0..1), `life`, `size` (px at 1080p),
         * `hue` (0..1 round the spectrum), `swirl` (rad/s round the hoop axis).
         */
        emit(time, amount, shape) {
            const {
                x = 0, y = 0, z = 0, dirX = 0, dirY = 0, speed = 1, spread = 1, size = 9, hue = 0.2, swirl = 0,
                jitter = 0.02,
            } = shape;
            const seconds = shape.life ?? 1;
            const k = Math.min(n, Math.max(0, amount | 0));
            const hasDir = Math.abs(dirX) + Math.abs(dirY) > 1e-4;
            const baseAng = hasDir ? Math.atan2(dirY, dirX) : 0;
            for (let i = 0; i < k; i++) {
                const o = cursor * 4;
                cursor = (cursor + 1) % n;
                const ang = hasDir ? baseAng + (rand() - 0.5) * PI * spread : rand() * TAU;
                const v = speed * (0.35 + rand() * 0.85);
                origin[o] = x + (rand() - 0.5) * jitter;
                origin[o + 1] = y + (rand() - 0.5) * jitter;
                origin[o + 2] = z;
                origin[o + 3] = time + rand() * 0.05;
                velocity[o] = Math.cos(ang) * v;
                velocity[o + 1] = Math.sin(ang) * v;
                velocity[o + 2] = (rand() - 0.35) * v * 0.5;
                velocity[o + 3] = seconds * (0.55 + rand() * 0.75);
                look[o] = size * (0.5 + rand() * 0.9);
                look[o + 1] = hue + (rand() - 0.5) * 0.22;
                look[o + 2] = swirl * (0.4 + rand() * 0.9);
                look[o + 3] = 1.4 + rand() * 1.6;
            }
            dirty = dirty || k > 0;
        },
        /** Upload once per frame, however many bursts were written. */
        flush() {
            if (!dirty) return;
            dirty = false;
            aOrigin.needsUpdate = true;
            aVelocity.needsUpdate = true;
            aLook.needsUpdate = true;
        },
        /** Put every slot back to sleep (a new session). */
        reset() {
            for (let i = 0; i < n; i++) origin[i * 4 + 3] = -1000;
            cursor = 0;
            dirty = true;
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
