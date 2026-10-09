/**
 * Vesper Chrysalis — the lantern lilies.
 *
 * Lilies float on the lake to either side of the board, closed. A moth that lands on one opens
 * it: the petals fold out, the lily takes the moth's colour and keeps it — a lantern on the
 * water, with its light pooled round it and its image under it — fading over half a minute
 * unless another moth comes. When a clear's swell passes, the lily lets most of its light go.
 *
 * A lily's light is a function of the clock and of its last change (when, from what level, to
 * what level): the shader and the CPU evaluate the same expression (bloomLevel, core), so
 * nothing is animated per frame and any moment can be replayed.
 *
 * Three draws: the petals (instanced, posed in the vertex shader by how open the lily is), the
 * pads with the pool of light on the water round them, and the lanterns' auras.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    atan,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    exp,
    float,
    int,
    length,
    max,
    mix,
    positionGeometry,
    sin,
    smoothstep,
    step,
    uniformArray,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    BLOOM_FULL,
    BLOOM_HOLD,
    BLOOM_KEEP,
    BLOOM_MAX,
    BLOOM_RISE,
    TAU,
    bloomLevel,
    mulberry32,
    vcBell,
    vcPart,
    vcSkyBase,
} from './vesper-chrysalis-tsl.js';

const PETALS_PER_WHORL = 7;
/** How far each whorl leans from upright when the lily is shut and when it is open (radians). */
const LEAN_SHUT = [0.2, 0.13, 0.06];
const LEAN_OPEN = [1.22, 0.86, 0.46];
const LENGTH = [1.0, 0.84, 0.64];

/** A petal: a strip along +Y (0..1), three vertices across so it can cup. */
function buildPetalGeometry() {
    const seg = 5;
    const pos = [];
    const index = [];
    for (let i = 0; i <= seg; i++) {
        const t = i / seg;
        for (let k = -1; k <= 1; k++) pos.push(k * 0.5, t, 0);
        if (i < seg) {
            const b = i * 3;
            index.push(b, b + 1, b + 3, b + 1, b + 4, b + 3, b + 1, b + 2, b + 4, b + 2, b + 5, b + 4);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(index);
    return g;
}

/**
 * @param {object} u       shared uniforms
 * @param {object[]} plan  the lilies (planBlooms), already cut to the tier
 * @param {object} [opts]
 * @param {number} [opts.whorls=3]
 */
export function createBlooms(u, plan, opts = {}) {
    const whorls = Math.max(1, Math.min(3, opts.whorls ?? 3));
    const count = Math.min(BLOOM_MAX, plan.length);
    const rows = Array.from({ length: BLOOM_MAX }, () => new THREE.Vector4(-100, 0, 0, -100));
    const tints = Array.from({ length: BLOOM_MAX }, () => new THREE.Vector4(1, 0.7, 0.4, 0));
    const stateA = uniformArray(rows, 'vec4');
    const stateC = uniformArray(tints, 'vec4');

    /** The lily's light now, its colour and how long since it last flashed — in the vertex stage. */
    const readState = (indexNode) => {
        const A = stateA.element(int(indexNode.add(0.5)));
        const C = stateC.element(int(indexNode.add(0.5)));
        const age = max(u.time.sub(A.x), 0.0);
        const level = mix(A.y, A.z, smoothstep(0.0, BLOOM_RISE, age)).mul(exp(age.div(-BLOOM_HOLD)));
        const sinceFlash = u.time.sub(A.w);
        const flash = exp(max(sinceFlash, 0.0).mul(-5.0)).mul(step(0.0, sinceFlash));
        return { level, tint: C.rgb, flash };
    };

    // ── Petals ──
    const petalGeo = buildPetalGeometry();
    const perLily = whorls * PETALS_PER_WHORL;
    const n = count * perLily;
    const lily = new Float32Array(n * 4); // (x, z, size, index)
    const petal = new Float32Array(n * 4); // (azimuth, whorl, seed, _)
    const rand = mulberry32(6007);
    for (let i = 0; i < count; i++) {
        const b = plan[i];
        const turn = rand() * TAU;
        for (let k = 0; k < whorls; k++) {
            for (let j = 0; j < PETALS_PER_WHORL; j++) {
                const o = (i * perLily + k * PETALS_PER_WHORL + j) * 4;
                lily.set([b.x, b.z, b.size, i], o);
                petal.set([turn + ((j + k * 0.5) / PETALS_PER_WHORL) * TAU, k, rand(), 0], o);
            }
        }
    }
    petalGeo.setAttribute('aLily', new THREE.InstancedBufferAttribute(lily, 4));
    petalGeo.setAttribute('aPetal', new THREE.InstancedBufferAttribute(petal, 4));
    const petals = new THREE.InstancedMesh(petalGeo, null, Math.max(1, n));
    petals.count = n;
    petals.frustumCulled = false;
    petals.renderOrder = 16;

    const petalMat = new THREE.MeshBasicNodeMaterial();
    petalMat.name = 'VesperChrysalisPetals';
    petalMat.side = THREE.DoubleSide;
    petalMat.fog = false;
    petalMat.toneMapped = false;
    const aLily = attribute('aLily', 'vec4');
    const aPetal = attribute('aPetal', 'vec4');
    const petalState = readState(aLily.w);
    const vLevel = varying(petalState.level, 'vPetalLevel');
    const vTint = varying(petalState.tint, 'vPetalTint');
    const vFlash = varying(petalState.flash, 'vPetalFlash');
    const vPetal = varying(vec3(positionGeometry.x, positionGeometry.y, aPetal.y), 'vPetalAt');

    petalMat.positionNode = Fn(() => {
        const t = positionGeometry.y;
        const { x } = positionGeometry;
        const whorl = aPetal.y;
        const open = smoothstep(0.02, 0.55, petalState.level).toVar();
        const pick = (table) => mix(
            mix(float(table[0]), float(table[1]), clamp(whorl, 0.0, 1.0)),
            float(table[2]),
            clamp(whorl.sub(1.0), 0.0, 1.0),
        );
        // A breath of wind, and the shiver of a lily that has just been lit.
        const shiver = petalState.flash.mul(sin(u.time.mul(30.0).add(aPetal.z.mul(9.0)))).mul(0.06);
        const stir = sin(u.drift.mul(0.8).add(aPetal.z.mul(40.0))).mul(0.03).add(shiver);
        const lean = mix(pick(LEAN_SHUT), pick(LEAN_OPEN), open).add(stir).toVar();
        const len = pick(LENGTH).mul(aLily.z);
        // The petal bows as it opens: it leans further toward its tip.
        const bow = lean.add(t.mul(open).mul(0.42));
        const out = sin(bow).mul(t).mul(len);
        const rise = cos(lean).mul(t).mul(len).add(float(1.0).sub(cos(bow.sub(lean))).mul(-0.3).mul(len));
        // Lanceolate, and cupped across.
        const half = sin(t.pow(0.72).mul(Math.PI)).mul(0.5).add(0.03).mul(len)
            .mul(mix(float(0.46), float(0.62), open));
        const cup = x.mul(x).mul(half).mul(mix(float(1.1), float(0.5), open));
        const dir = vec2(cos(aPetal.x), sin(aPetal.x));
        const side = vec2(dir.y.negate(), dir.x);
        const radial = out.add(float(0.1).mul(aLily.z)).sub(cup.mul(cos(lean)));
        return vec3(
            aLily.x.add(dir.x.mul(radial)).add(side.x.mul(x).mul(half).mul(2.0)),
            rise.add(cup.mul(sin(lean))).add(0.06),
            aLily.y.add(dir.y.mul(radial)).add(side.y.mul(x).mul(half).mul(2.0)),
        );
    })();
    petalMat.fragmentNode = Fn(() => {
        const t = clamp(vPetal.y, 0.0, 1.0);
        const across = clamp(vPetal.x.mul(2.0), -1.0, 1.0);
        // By the evening's light a petal is a pale shape; lit, it is a lantern's paper.
        const sky = vcSkyBase(u, vec3(0.0, 1.0, 0.0)).add(vcSkyBase(u, vec3(0.45, 0.2, -0.87)).mul(0.5));
        const pale = mix(u.shell.mul(0.6).add(0.08), vec3(0.8, 0.66, 0.78), t.mul(0.7)).mul(sky).mul(1.7);
        const vein = vcBell(across.div(0.16)).mul(0.5).add(vcBell(across.abs().sub(0.55).div(0.12)).mul(0.25));
        const inner = float(1.0).sub(t).pow(1.3).mul(1.5)
            .add(vein.mul(0.6))
            .add(0.3);
        const whorlGain = mix(float(1.0), float(1.5), clamp(vPetal.z.mul(0.5), 0.0, 1.0));
        const lit = vTint.mul(vLevel).mul(inner).mul(whorlGain).mul(1.6)
            .add(mix(vTint, vec3(1.0, 0.96, 0.9), 0.6).mul(vFlash).mul(3.0));
        // A shut lily still holds an ember at its heart.
        const ember = u.core.mul(float(1.0).sub(t).mul(0.1).add(vcBell(t.sub(0.86).div(0.3)).mul(0.14)));
        return vec4(pale.add(lit.add(ember).mul(u.breath)), 1.0);
    })();
    petals.material = petalMat;

    // ── Pads, and the pool of light each lit lily lays on the water ──
    const padGeo = new THREE.PlaneGeometry(1, 1);
    padGeo.rotateX(-Math.PI / 2);
    const padData = new Float32Array(Math.max(1, count) * 4); // (x, z, size, index)
    for (let i = 0; i < count; i++) padData.set([plan[i].x, plan[i].z, plan[i].size, i], i * 4);
    padGeo.setAttribute('aLily', new THREE.InstancedBufferAttribute(padData, 4));
    const pads = new THREE.InstancedMesh(padGeo, null, Math.max(1, count));
    pads.count = count;
    pads.frustumCulled = false;
    pads.renderOrder = 32;
    const padMat = new THREE.MeshBasicNodeMaterial();
    padMat.name = 'VesperChrysalisPads';
    padMat.transparent = true;
    padMat.blending = THREE.CustomBlending;
    padMat.blendEquation = THREE.AddEquation;
    padMat.blendSrc = THREE.OneFactor;
    padMat.blendDst = THREE.OneMinusSrcAlphaFactor;
    padMat.blendSrcAlpha = THREE.OneFactor;
    padMat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    padMat.depthWrite = false;
    padMat.fog = false;
    padMat.toneMapped = false;
    const POOL = 9; // the quad's half-width in lily sizes
    const padState = readState(aLily.w);
    const vPadLevel = varying(padState.level, 'vPadLevel');
    const vPadTint = varying(padState.tint, 'vPadTint');
    const vPadFlash = varying(padState.flash, 'vPadFlash');
    const vPadSeed = varying(aLily.w, 'vPadSeed');
    padMat.positionNode = Fn(() => vec3(
        aLily.x.add(positionGeometry.x.mul(aLily.z).mul(POOL * 2)),
        0.035,
        aLily.y.add(positionGeometry.z.mul(aLily.z).mul(POOL * 2)),
    ))();
    padMat.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    padMat.outputNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0 * POOL).toVar(); // in lily sizes
        const d = length(q);
        // The pad: a round leaf with a notch, dark, its rim catching the sky.
        const ang = atan(q.y, q.x).add(vPadSeed.mul(2.4));
        const notch = smoothstep(0.0, 0.16, ang.sin().abs().add(step(0.0, ang.cos())));
        const leaf = float(1.0).sub(smoothstep(1.16, 1.24, d)).mul(mix(float(1.0), notch, smoothstep(0.25, 0.5, d)));
        const sky = vcSkyBase(u, vec3(0.0, 1.0, 0.0));
        const leafRim = sky.mul(smoothstep(0.86, 1.2, d)).mul(0.95);
        const leafCol = mix(u.deep, u.shell, 0.3).mul(0.4).add(sky.mul(0.22)).add(leafRim)
            .add(vPadTint.mul(vPadLevel).mul(exp(d.mul(-1.4))).mul(0.5).mul(u.breath));
        // The pool: the lantern's light lying on the water.
        const poolEdge = float(1.0).sub(smoothstep(POOL * 0.7, POOL, d));
        const pool = exp(d.mul(-0.62)).mul(0.5).add(exp(d.mul(-1.9)).mul(0.9)).mul(poolEdge);
        const light = vPadTint.mul(vPadLevel.mul(0.42).add(vPadFlash.mul(0.5))).mul(pool).mul(u.breath);
        return vec4(mix(light, leafCol, leaf), leaf);
    })();
    pads.material = padMat;

    // ── Auras: the glow a lantern stands in, and the spark at its heart ──
    const auraGeo = new THREE.PlaneGeometry(1, 1);
    auraGeo.setAttribute('aLily', new THREE.InstancedBufferAttribute(padData, 4));
    const auras = new THREE.InstancedMesh(auraGeo, null, Math.max(1, count));
    auras.count = count;
    auras.frustumCulled = false;
    auras.renderOrder = 66;
    const auraMat = new THREE.MeshBasicNodeMaterial();
    auraMat.name = 'VesperChrysalisAuras';
    auraMat.transparent = true;
    auraMat.blending = THREE.AdditiveBlending;
    auraMat.premultipliedAlpha = true;
    auraMat.depthWrite = false;
    auraMat.fog = false;
    auraMat.toneMapped = false;
    auraMat.side = THREE.DoubleSide;
    const auraState = readState(aLily.w);
    const vAuraLevel = varying(auraState.level, 'vAuraLevel');
    const vAuraTint = varying(auraState.tint, 'vAuraTint');
    const vAuraFlash = varying(auraState.flash, 'vAuraFlash');
    auraMat.vertexNode = Fn(() => {
        const centre = cameraViewMatrix.mul(vec4(aLily.x, aLily.z.mul(0.55), aLily.y, 1.0));
        const size = aLily.z.mul(7.0);
        return cameraProjectionMatrix.mul(vec4(
            centre.x.add(positionGeometry.x.mul(size)),
            centre.y.add(positionGeometry.y.mul(size)),
            centre.z,
            1.0,
        ));
    })();
    auraMat.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    auraMat.outputNode = Fn(() => {
        const d = length(uv().sub(0.5).mul(2.0));
        const haloEdge = float(1.0).sub(smoothstep(0.75, 1.0, d));
        const halo = exp(d.mul(-5.5)).mul(0.5).add(exp(d.mul(-20.0)).mul(2.6)).mul(haloEdge);
        const flare = mix(vAuraTint, vec3(1.0, 0.96, 0.9), 0.5).mul(vAuraFlash).mul(1.6);
        const light = vAuraTint.mul(vAuraLevel.mul(0.5)).add(flare);
        return vec4(light.mul(halo).mul(u.breath), 0.0);
    })();
    auras.material = auraMat;

    const group = new THREE.Group();
    group.add(petals, pads, auras);
    const part = vcPart('VesperChrysalisBlooms', petalGeo, petalMat, 16, { mesh: group });
    part.count = count;
    part.plan = plan.slice(0, count);
    part.rows = rows;
    part.tints = tints;
    /** Changes still to come: { index, at, kind 'strike' | 'release', rgb, amount }. */
    part.pending = [];
    /** CPU twin of the shader's state. */
    part.state = Array.from({ length: count }, () => ({
        t0: -100, from: 0, to: 0, rgb: [1, 0.7, 0.4],
    }));

    part.levelAt = (index, t) => {
        const s = part.state[index];
        return s ? bloomLevel(s.from, s.to, t - s.t0) : 0;
    };
    /** Light a lily will hold once everything already on its way has landed. */
    part.promised = (index, t) => {
        let level = part.levelAt(index, t);
        for (let i = 0; i < part.pending.length; i++) {
            const e = part.pending[i];
            if (e.index === index && e.kind === 'strike') level += e.amount;
        }
        return level;
    };
    /**
     * The light lily `index` will hold at `t` (now or to come), counting only the changes on
     * their way that have landed by then: a moth still in the air has lit nothing yet.
     */
    part.heldAt = (index, t) => {
        const s = part.state[index];
        if (!s) return 0;
        let { from, to, t0 } = s;
        // (The list is kept in time order.)
        for (let i = 0; i < part.pending.length; i++) {
            const e = part.pending[i];
            if (e.at > t) break;
            if (e.index !== index) continue;
            const held = bloomLevel(from, to, e.at - t0);
            from = held;
            t0 = e.at;
            to = e.kind === 'strike' ? Math.min(BLOOM_FULL, held + e.amount) : held * BLOOM_KEEP;
        }
        return bloomLevel(from, to, t - t0);
    };
    /**
     * How much light lily `index` is spoken for at `t`: what it is opening to (a lily just lit
     * counts in full, though its light is still rising) plus what is on its way to it.
     */
    part.wanted = (index, t) => {
        const s = part.state[index];
        if (!s) return 0;
        const age = Math.max(0, t - s.t0);
        let level = Math.max(bloomLevel(s.from, s.to, age), s.to * Math.exp(-age / BLOOM_HOLD));
        for (let i = 0; i < part.pending.length; i++) {
            const e = part.pending[i];
            if (e.index === index && e.kind === 'strike') level += e.amount;
        }
        return level;
    };
    /** Put a change in the list, which is kept in time order (ties keep their order of arrival). */
    const schedule = (entry) => {
        let at = part.pending.length;
        while (at > 0 && part.pending[at - 1].at > entry.at) at -= 1;
        part.pending.splice(at, 0, entry);
    };
    /** A moth will land on lily `index` at `at`, bringing `amount` of light in `rgb`. */
    part.strike = (index, rgb, at, amount) => {
        if (!(index >= 0 && index < count) || !Number.isFinite(at) || !(amount > 0)) return;
        schedule({
            index, at, kind: 'strike', rgb: [rgb[0], rgb[1], rgb[2]], amount, tag: null,
        });
    };
    /**
     * Lily `index` lets its light go at `at`. `tag` names what makes it (a swell's birth), so
     * `cancel(tag)` can call it off.
     */
    part.release = (index, at, tag = null) => {
        if (!(index >= 0 && index < count) || !Number.isFinite(at)) return;
        schedule({
            index, at, kind: 'release', rgb: null, amount: 0, tag,
        });
    };
    /** Call off every release still to come that carries `tag`. */
    part.cancel = (tag) => {
        if (tag === null || tag === undefined) return;
        for (let i = part.pending.length - 1; i >= 0; i--) {
            const e = part.pending[i];
            if (e.kind === 'release' && e.tag === tag) part.pending.splice(i, 1);
        }
    };
    /** Every lily lets ALL its light go from `t` on, and nothing still on its way lands. */
    part.letGo = (t) => {
        part.pending.length = 0;
        for (let i = 0; i < count; i++) {
            const s = part.state[i];
            const held = bloomLevel(s.from, s.to, t - s.t0);
            if (held <= 0 && s.to <= 0) continue;
            s.from = held;
            s.to = 0;
            s.t0 = t;
            rows[i].set(s.t0, s.from, 0, rows[i].w);
        }
    };
    /** Apply every change that has come due. */
    part.tick = (t) => {
        if (!part.pending.length) return;
        let done = 0;
        while (done < part.pending.length && part.pending[done].at <= t) {
            const e = part.pending[done];
            const s = part.state[e.index];
            const held = bloomLevel(s.from, s.to, e.at - s.t0);
            s.from = held;
            s.t0 = e.at;
            if (e.kind === 'strike') {
                s.to = Math.min(BLOOM_FULL, held + e.amount);
                s.rgb = e.rgb;
            } else {
                s.to = held * BLOOM_KEEP;
            }
            rows[e.index].set(s.t0, s.from, s.to, e.at);
            tints[e.index].set(s.rgb[0], s.rgb[1], s.rgb[2], 0);
            done += 1;
        }
        if (done) part.pending.splice(0, done);
    };
    part.reset = () => {
        part.pending.length = 0;
        for (let i = 0; i < BLOOM_MAX; i++) {
            rows[i].set(-100, 0, 0, -100);
            tints[i].set(1, 0.7, 0.4, 0);
        }
        part.state.forEach((s) => {
            s.t0 = -100;
            s.from = 0;
            s.to = 0;
            s.rgb = [1, 0.7, 0.4];
        });
    };
    /** The colour lily `index` will hold at `t`: that of the last moth to have landed by then. */
    part.colourAt = (index, t) => {
        let rgb = part.state[index]?.rgb || [1, 0.7, 0.4];
        for (let i = 0; i < part.pending.length; i++) {
            const e = part.pending[i];
            if (e.at > t) break;
            if (e.index === index && e.kind === 'strike') ({ rgb } = e);
        }
        return rgb;
    };
    /** The colour lily `index` holds, or is about to be given. */
    part.colourOf = (index) => {
        for (let i = part.pending.length - 1; i >= 0; i--) {
            const e = part.pending[i];
            if (e.index === index && e.kind === 'strike') return e.rgb;
        }
        return part.state[index]?.rgb || [1, 0.7, 0.4];
    };
    part.totalHeld = (t) => {
        let sum = 0;
        for (let i = 0; i < count; i++) sum += part.levelAt(i, t);
        return sum;
    };
    part.dispose = () => {
        padGeo.dispose();
        padMat.dispose();
        auraGeo.dispose();
        auraMat.dispose();
    };
    return part;
}
