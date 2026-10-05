/**
 * Astral Weave — silk dust: thousands of motes that live ON the weave.
 *
 * Each mote has a home on the rosette: a point on one chord (any chord of the continuous family,
 * not only the drawn threads), close to where that chord touches the envelope. Together they are
 * a glittering ghost of the figure, densest along the petals.
 *
 *  - WebGPU: a compute pass (two storage buffers, position and velocity) chases each mote toward
 *    its home with an exact critically damped spring. When the weave re-forms (a combo adds a
 *    petal, a quad gathers it into the crown and opens the iris) the homes fly and the dust
 *    streams after them, lagging; a lock kicks it away from the piece, a clear's shock front
 *    pushes a wave through it. Excited motes burn brighter.
 *  - WebGL2 and the low tiers: the same motes drawn AT their homes (closed form, no state).
 *
 * The spring step is exact for any frame time, so the simulation is frame-rate independent and a
 * fixed-step replay reproduces it for captures.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    clamp,
    cos,
    exp,
    float,
    instanceIndex,
    instancedArray,
    length,
    max,
    min,
    mix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    step,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
    vertexStage,
} from 'three/tsl';
import {
    TAU, awFxMaterial, awHash11, awLoomClip, awQuadGeometry, awSpectrum, awSpriteClip,
} from './astral-weave-tsl.js';
import { PLUCK_SLOTS } from './astral-weave-loom.js';

/** Motes per tier; `compute` tiers simulate on WebGPU, the rest are always closed-form. */
export const DUST_TIERS = Object.freeze({
    Minimal: { count: 0, compute: false },
    Low: { count: 1600, compute: false },
    Medium: { count: 5000, compute: true },
    High: { count: 14000, compute: true },
    Ultra: { count: 30000, compute: true },
    Extreme: { count: 60000, compute: true },
});

/** The most motes the closed-form path draws (WebGL2 and failed compute compiles). */
export const DUST_STATIC_MAX = 5000;

const { PI } = Math;
const SPRING = 5.5;

/** Four decorrelated per-mote randoms from the instance index. */
function moteSeeds(index) {
    const f = index.toFloat();
    return {
        u: awHash11(f.mul(0.7548).add(0.31)),
        s: awHash11(f.mul(1.3247).add(7.77)),
        n: awHash11(f.mul(0.5698).add(19.19)),
        z: awHash11(f.mul(1.6180).add(3.33)),
    };
}

/** A mote's home on the weave (loom-local). */
function moteHome(shared, seeds) {
    const {
        uTime, uK, uPhase, uSpin,
    } = shared;
    const base = seeds.u.mul(TAU);
    const a = base.add(uSpin);
    const b = base.mul(uK).add(uSpin).add(uPhase);
    const A = vec2(cos(a), sin(a));
    const B = vec2(cos(b), sin(b));
    const chord = B.sub(A);
    const len = max(length(chord), 1e-3);
    const nrm = vec2(chord.y.negate(), chord.x).div(len);
    // Gathered round the touch point of the chord with the envelope (t = 1 / (1 + k)).
    const touch = clamp(float(1.0).div(max(uK.add(1.0), 1.0)), 0.0, 1.0);
    const j = seeds.s.sub(0.5);
    const drift = sin(uTime.mul(0.21).add(seeds.n.mul(TAU))).mul(0.025);
    const t = clamp(touch.add(j.mul(abs(j)).mul(1.7)).add(drift), 0.015, 0.985);
    const flat = A.add(chord.mul(t)).add(nrm.mul(seeds.n.sub(0.5).mul(0.035)));
    const bow = sin(t.mul(PI)).mul(len).mul(-0.07);
    return vec3(flat, bow.add(seeds.z.sub(0.5).mul(0.07)));
}

/**
 * @param {object} shared     the world's shared uniforms
 * @param {number} count      motes
 * @param {boolean} simulate  build the compute path (WebGPU)
 */
export function createDust(shared, count, simulate) {
    const n = Math.max(1, count | 0);
    const {
        uTime, uViewport, uPxScale, uHeat, uEnergy, uFade, uPluck, uShock,
    } = shared;
    const geometry = awQuadGeometry(n, 2024);
    const material = awFxMaterial('astral-weave-dust');
    const seeds = moteSeeds(instanceIndex);
    const uDt = uniform(0);
    const uReady = uniform(simulate ? 0 : 1);

    let position = null;
    let velocity = null;
    let initNode = null;
    let stepNode = null;
    let centre = moteHome(shared, seeds);
    let excitement = float(0.0);
    let flight = null;

    if (simulate) {
        position = instancedArray(n, 'vec3');
        velocity = instancedArray(n, 'vec3');
        initNode = Fn(() => {
            position.element(instanceIndex).assign(moteHome(shared, moteSeeds(instanceIndex)));
            velocity.element(instanceIndex).assign(vec3(0.0));
        })().compute(n);

        stepNode = Fn(() => {
            const s = moteSeeds(instanceIndex);
            const p = position.element(instanceIndex);
            const v = velocity.element(instanceIndex);
            const home = moteHome(shared, s).toVar();
            // A slow wander round the home, so settled dust still breathes.
            home.addAssign(vec3(
                sin(home.y.mul(7.0).add(uTime.mul(0.6)).add(s.z.mul(TAU))),
                cos(home.x.mul(6.0).sub(uTime.mul(0.5)).add(s.n.mul(TAU))),
                sin(home.x.add(home.y).mul(5.0).add(uTime.mul(0.4))),
            ).mul(0.012));
            // Exact critically damped spring toward the (moving) home.
            const w = mix(float(SPRING * 0.7), float(SPRING * 1.4), s.s);
            const c1 = p.sub(home);
            const c2 = v.add(c1.mul(w));
            const e = exp(w.mul(uDt).negate());
            const pNew = home.add(c1.add(c2.mul(uDt)).mul(e)).toVar();
            const vNew = c2.sub(c1.add(c2.mul(uDt)).mul(w)).mul(e).toVar();
            // A lock kicks the dust away from the piece, once, in the frame it lands.
            for (let i = 0; i < PLUCK_SLOTS; i++) {
                const S = uPluck.element(i);
                const tau = uTime.sub(S.z);
                const fresh = step(1e-5, tau).mul(step(tau, uDt.mul(1.001)));
                const away = pNew.xy.sub(S.xy);
                const d = max(length(away), 1e-3);
                const kick = exp(d.mul(d).mul(-11.0)).mul(S.w).mul(fresh).mul(1.5);
                vNew.addAssign(vec3(away.div(d).mul(kick), kick.mul(s.z.sub(0.4)).mul(0.6)));
            }
            // A clear's shock front pushes a wave outward through it.
            const r = max(length(pNew.xy), 1e-3);
            const front = r.sub(uShock.x);
            const push = exp(front.mul(front).mul(-110.0)).mul(uShock.y).mul(26.0).mul(uDt);
            vNew.addAssign(vec3(pNew.xy.div(r).mul(push), push.mul(s.n.sub(0.5))));
            p.assign(pNew);
            v.assign(vNew);
        })().compute(n);

        centre = position.element(instanceIndex);
        flight = velocity.element(instanceIndex);
        excitement = clamp(length(flight).mul(1.3), 0.0, 3.0);
    }

    const sizePx = uPxScale.mul(mix(float(2.1), float(3.9), seeds.z));
    let stretch = float(0.0);
    if (flight) {
        // A moving mote is a streak along its screen-space velocity (a 1/50 s exposure), so blasted
        // dust reads as fine light trails instead of a blizzard of dots.
        const c0 = awLoomClip(centre);
        const c1 = awLoomClip(centre.add(flight.mul(1 / 50)));
        const half = uViewport.mul(0.5);
        const d = c1.xy.div(c1.w).sub(c0.xy.div(c0.w)).mul(half);
        const len = min(length(d), uPxScale.mul(16.0));
        const along = normalize(d.add(vec2(1e-4, 0.0)));
        const across = vec2(along.y.negate(), along.x);
        const offsetPx = along.mul(positionGeometry.x.mul(sizePx.add(len)))
            .add(across.mul(positionGeometry.y.mul(sizePx)));
        stretch = len.div(sizePx);
        material.vertexNode = vec4(c0.xy.add(offsetPx.mul(uReady).div(half).mul(c0.w)), c0.z, c0.w);
    } else {
        material.vertexNode = awSpriteClip(centre, positionGeometry.xy.mul(sizePx).mul(uReady), uViewport);
    }
    material.colorNode = Fn(() => {
        const st = uv().sub(0.5).mul(2.0);
        const vU = vertexStage(seeds.u);
        const vN = vertexStage(seeds.n);
        const vS = vertexStage(seeds.s);
        const vHot = vertexStage(excitement);
        const vStretch = vertexStage(stretch);
        const r2 = st.x.mul(st.x).add(st.y.mul(st.y));
        const body = exp(r2.mul(-4.5)).mul(float(1.0).sub(smoothstep(0.7, 1.0, r2)));
        const twinkle = sin(uTime.mul(vN.mul(2.6).add(0.8)).add(vS.mul(TAU))).mul(0.35).add(0.65);
        const tint = mix(awSpectrum(vU.add(0.04), uHeat), vec3(1.0, 0.96, 0.9), clamp(vHot.mul(0.4), 0.0, 0.7));
        // The streak spreads the same light over more pixels.
        const k = body.mul(twinkle).mul(vHot.mul(0.8).add(0.34)).div(vStretch.mul(0.9).add(1.0))
            .mul(uEnergy.mul(0.5).add(1.0));
        return vec4(tint.mul(k).mul(uFade).mul(uReady), 0.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'astral-weave-dust';
    mesh.frustumCulled = false;
    mesh.renderOrder = 21;

    let ready = false;
    return {
        mesh,
        count: n,
        simulated: simulate,
        /** The compute nodes to compile before the first dispatch (empty on the closed-form path). */
        computeNodes: simulate ? [initNode, stepNode] : [],
        /** The pipelines are compiled: seat every mote on its home and start simulating. */
        start(renderer) {
            if (!simulate || !renderer?.compute) return;
            renderer.compute(initNode);
            uReady.value = 1;
            ready = true;
        },
        /** Put every mote back on its home (a seek, a new session). */
        reseat(renderer) {
            if (ready) renderer.compute(initNode);
        },
        step(renderer, dt) {
            if (!ready || !(dt > 0)) return;
            uDt.value = Math.min(dt, 0.25);
            renderer.compute(stepNode);
        },
        get ready() {
            return ready || !simulate;
        },
        dispose() {
            ready = false;
            initNode?.dispose?.();
            stepNode?.dispose?.();
            geometry.dispose();
            material.dispose();
        },
    };
}
