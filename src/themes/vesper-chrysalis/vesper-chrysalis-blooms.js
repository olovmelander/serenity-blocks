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
 * There are three kinds (BLOOM_SHAPES): the lantern lotus, the star lily and the moon chalice, each
 * with its own petals, its own stamens and its own hours: a lily also opens and shuts by itself
 * as the evening moves on (u.tide), breathes a little, and opens to a wave that now and then
 * crosses the lake (u.bloomWave). Open by itself it glows faintly in its own kind's colour; a
 * moth's light is a lantern on top of that.
 *
 * Three draws: the petals and stamens (instanced, posed in the vertex shader by how open the lily
 * is), the pads (each lily's, with the pool of light on the water round it, and loose leaves
 * with dew on them) and the lanterns' auras.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    atan,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    dot,
    exp,
    float,
    floor,
    fract,
    int,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    positionWorld,
    reflect,
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
    SUN_DIR,
    TAU,
    bloomLevel,
    mulberry32,
    vcBell,
    vcFresnel,
    vcHash21,
    vcLuma,
    vcPart,
    vcSkyBase,
} from './vesper-chrysalis-tsl.js';
import { flatVarying } from '../shared/flat-varying.js';

/** Toward the place the sun went down, in plan: the side a petal is backlit from. */
const GLOW_FLAT = (() => {
    const l = Math.hypot(SUN_DIR[0], SUN_DIR[2]);
    return [SUN_DIR[0] / l, SUN_DIR[2] / l];
})();
/** Veins in a lily pad. */
const VEINS = 22;

/**
 * The three kinds, whorl by whorl (outer first), then their stamens. Each row: how many, how far
 * it leans from upright shut and open (radians), its length and width (in lily sizes), how much
 * and where along it the petal bows as it opens, and how blunt its tip is.
 */
export const BLOOM_SHAPES = Object.freeze([
    // The lantern lotus: broad cupped petals; opens to a bowl, its heart staying half shut.
    Object.freeze([
        {
            n: 8, shut: 0.26, open: 1.28, length: 1.0, width: 0.6, bow: 0.5, bowAt: 1, tip: 0.62,
        },
        {
            n: 8, shut: 0.16, open: 0.92, length: 0.86, width: 0.56, bow: 0.4, bowAt: 1, tip: 0.62,
        },
        {
            n: 6, shut: 0.07, open: 0.5, length: 0.66, width: 0.5, bow: 0.25, bowAt: 1, tip: 0.66,
        },
        {
            n: 10, shut: 0.03, open: 0.36, length: 0.3, width: 0.07, bow: 0.2, bowAt: 1, tip: 1,
        },
    ]),
    // The star lily: many narrow petals; opens flat on the water like a star.
    Object.freeze([
        {
            n: 11, shut: 0.2, open: 1.44, length: 1.12, width: 0.3, bow: 0.12, bowAt: 1, tip: 0.5,
        },
        {
            n: 11, shut: 0.12, open: 1.06, length: 0.92, width: 0.28, bow: 0.16, bowAt: 1, tip: 0.5,
        },
        {
            n: 7, shut: 0.06, open: 0.6, length: 0.62, width: 0.24, bow: 0.2, bowAt: 1, tip: 0.55,
        },
        {
            n: 7, shut: 0.03, open: 0.4, length: 0.32, width: 0.06, bow: 0.2, bowAt: 1, tip: 1,
        },
    ]),
    // The moon chalice: tall and narrow; it only ever opens at the lip, which curls back.
    Object.freeze([
        {
            n: 6, shut: 0.11, open: 0.56, length: 1.3, width: 0.8, bow: 1.25, bowAt: 2.6, tip: 0.9,
        },
        {
            n: 6, shut: 0.07, open: 0.38, length: 1.1, width: 0.72, bow: 0.95, bowAt: 2.6, tip: 0.9,
        },
        {
            n: 5, shut: 0.03, open: 0.2, length: 0.84, width: 0.56, bow: 0.5, bowAt: 2.2, tip: 0.9,
        },
        {
            n: 9, shut: 0.02, open: 0.22, length: 0.5, width: 0.06, bow: 0.3, bowAt: 1, tip: 1,
        },
    ]),
]);

/** A petal: a strip along +Y (0..1), five vertices across so it can cup. */
function buildPetalGeometry() {
    const seg = 7;
    const cols = 5;
    const pos = [];
    const index = [];
    for (let i = 0; i <= seg; i++) {
        const t = i / seg;
        for (let k = 0; k < cols; k++) pos.push(k / (cols - 1) - 0.5, t, 0);
        if (i < seg) {
            for (let k = 0; k < cols - 1; k++) {
                const p = i * cols + k;
                index.push(p, p + 1, p + cols, p + 1, p + cols + 1, p + cols);
            }
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(index);
    return g;
}

/** One of three numbers by a lily's kind (0, 1, 2). */
const byKind = (kind, v) => mix(mix(v.x, v.y, step(0.5, kind)), v.z, step(1.5, kind));

/**
 * @param {object} u       shared uniforms
 * @param {object[]} plan  the lilies (planBlooms), already cut to the tier
 * @param {object} [opts]
 * @param {number} [opts.whorls=3]
 * @param {object[]} [opts.pads]   loose pads (planPads)
 */
export function createBlooms(u, plan, opts = {}) {
    const whorls = Math.max(1, Math.min(3, opts.whorls ?? 3));
    const loose = opts.pads ?? [];
    const count = Math.min(BLOOM_MAX, plan.length);
    const rows = Array.from({ length: BLOOM_MAX }, () => new THREE.Vector4(-100, 0, 0, -100));
    const tints = Array.from({ length: BLOOM_MAX }, () => new THREE.Vector4(1, 0.7, 0.4, 0));
    const stateA = uniformArray(rows, 'vec4');
    const stateC = uniformArray(tints, 'vec4');

    /** The lily's light now, its colour and how long since it last flashed — in the vertex stage. */
    const readState = (indexNode) => {
        const A = stateA.element(int(max(indexNode, 0.0).add(0.5)));
        const C = stateC.element(int(max(indexNode, 0.0).add(0.5)));
        const age = max(u.time.sub(A.x), 0.0);
        const real = step(-0.5, indexNode);
        const level = mix(A.y, A.z, smoothstep(0.0, BLOOM_RISE, age)).mul(exp(age.div(-BLOOM_HOLD))).mul(real);
        const sinceFlash = u.time.sub(A.w);
        const flash = exp(max(sinceFlash, 0.0).mul(-5.0)).mul(step(0.0, sinceFlash)).mul(real);
        return { level, tint: C.rgb, flash };
    };
    /**
     * How far a lily stands open by itself: its kind's tide at this hour, its own slow breath,
     * and any wave of opening crossing the lake.
     */
    const ambient = (x, z, kind, seed) => {
        const tide = byKind(kind, u.tide);
        const breath = sin(u.drift.mul(0.13).add(seed.mul(40.0))).mul(0.13);
        const W = u.bloomWave;
        const behind = u.time.sub(W.z).mul(26.0).sub(x.mul(W.x).add(z.mul(W.y)).add(90.0));
        const wave = smoothstep(0.0, 14.0, behind).mul(exp(max(behind, 0.0).mul(-0.022))).mul(W.w);
        return clamp(tide.add(breath).add(wave), 0.0, 1.0);
    };

    // ── Petals ──
    const petalGeo = buildPetalGeometry();
    const lily = [];
    const petal = [];
    const shape = [];
    const curl = [];
    const rand = mulberry32(6007);
    for (let i = 0; i < count; i++) {
        const bloom = plan[i];
        const kind = bloom.kind ?? 0;
        const turn = rand() * TAU;
        BLOOM_SHAPES[kind].forEach((row, role) => {
            // A lean tier drops the innermost whorl and thins the stamens.
            if (role === 2 && whorls < 3) return;
            const n = role === 3 && whorls < 3 ? Math.ceil(row.n / 2) : row.n;
            for (let j = 0; j < n; j++) {
                const jitter = role === 3 ? rand() : 0;
                lily.push(bloom.x, bloom.z, bloom.size, i);
                petal.push(turn + ((j + role * 0.5 + jitter * 0.6) / n) * TAU, rand(), kind, role);
                shape.push(row.shut, row.open, row.length * (0.94 + rand() * 0.12), row.width);
                curl.push(row.bow, row.bowAt, row.tip, bloom.seed);
            }
        });
    }
    const n = lily.length / 4;
    petalGeo.setAttribute('aLily', new THREE.InstancedBufferAttribute(new Float32Array(lily), 4));
    petalGeo.setAttribute('aPetal', new THREE.InstancedBufferAttribute(new Float32Array(petal), 4));
    petalGeo.setAttribute('aShape', new THREE.InstancedBufferAttribute(new Float32Array(shape), 4));
    petalGeo.setAttribute('aCurl', new THREE.InstancedBufferAttribute(new Float32Array(curl), 4));
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
    const aShape = attribute('aShape', 'vec4');
    const aCurl = attribute('aCurl', 'vec4');
    const petalState = readState(aLily.w);
    const petalAmbient = ambient(aLily.x, aLily.y, aPetal.z, aCurl.w);
    const vLevel = varying(petalState.level, 'vPetalLevel');
    const vTint = varying(petalState.tint, 'vPetalTint');
    const vFlash = varying(petalState.flash, 'vPetalFlash');
    const vAmbient = varying(petalAmbient, 'vPetalAmbient');
    const vPetal = varying(vec2(positionGeometry.x, positionGeometry.y), 'vPetalAt');
    const vKind = flatVarying(vec3(aPetal.z, aPetal.w, aPetal.y), 'vPetalKind');

    petalMat.positionNode = Fn(() => {
        const t = positionGeometry.y;
        const { x } = positionGeometry;
        const open = max(smoothstep(0.02, 0.55, petalState.level), petalAmbient).toVar();
        // A breath of wind, and the shiver of a lily that has just been lit.
        const shiver = petalState.flash.mul(sin(u.time.mul(30.0).add(aPetal.y.mul(9.0)))).mul(0.06);
        const stir = sin(u.drift.mul(0.8).add(aPetal.y.mul(40.0))).mul(0.03).add(shiver);
        const lean = mix(aShape.x, aShape.y, open).add(stir).toVar();
        const len = aShape.z.mul(aLily.z);
        // The petal bows as it opens: it leans further toward its tip (the chalice only at its lip).
        const bow = lean.add(t.pow(aCurl.y).mul(open).mul(aCurl.x));
        const out = sin(bow).mul(t).mul(len);
        const rise = cos(lean).mul(t).mul(len).add(float(1.0).sub(cos(bow.sub(lean))).mul(-0.3).mul(len));
        // Lanceolate (a blunter or a sharper tip by its kind), and cupped across.
        const half = sin(t.pow(aCurl.z).mul(Math.PI)).mul(0.5).add(0.03).mul(len)
            .mul(aShape.w)
            .mul(mix(float(0.78), float(1.0), open));
        const cup = x.mul(x).mul(half).mul(mix(float(2.2), float(1.0), open));
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
        const kind = vKind.x;
        const stamen = step(2.5, vKind.y);
        // By the evening's light a petal is a pale shape of its kind's colour, greener at its foot.
        const sky = vcSkyBase(u, vec3(0.0, 1.0, 0.0)).add(vcSkyBase(u, vec3(0.45, 0.2, -0.87)).mul(0.5));
        const paint = mix(mix(vec3(0.9, 0.62, 0.74), vec3(0.7, 0.86, 0.98), step(0.5, kind)), vec3(0.76, 0.64, 0.98), step(1.5, kind));
        const lightOn = sky.mul(0.75).add(vec3(vcLuma(sky)).mul(1.5));
        const pale = mix(vec3(0.5, 0.62, 0.5), paint, smoothstep(0.0, 0.5, t)).mul(lightOn);
        const vein = vcBell(across.div(0.16)).mul(0.5).add(vcBell(across.abs().sub(0.55).div(0.12)).mul(0.25));
        const inner = float(1.0).sub(t).pow(1.3).mul(1.5)
            .add(vein.mul(0.6))
            .add(0.3);
        const whorlGain = mix(float(1.0), float(1.5), clamp(vKind.y.mul(0.5), 0.0, 1.0));
        const lit = vTint.mul(vLevel).mul(inner).mul(whorlGain).mul(1.6)
            .add(mix(vTint, vec3(1.0, 0.96, 0.9), 0.6).mul(vFlash).mul(3.0));
        // Open by itself, a lily glows a little in its own kind's light; shut, it holds an ember.
        const own = mix(mix(mix(u.wingRoot, u.glow, 0.5), u.crystal, step(0.5, kind)), u.wingMid, step(1.5, kind));
        const glow = own.mul(vAmbient.mul(float(1.0).sub(t).mul(0.7).add(vein.mul(0.25))
            .add(0.12)).mul(0.55));
        const ember = mix(u.core, own, 0.6).mul(float(1.0).sub(t).mul(0.13).add(vcBell(t.sub(0.86).div(0.3)).mul(0.08)));
        // A petal is thin: seen against the afterglow the evening's light comes through it, most
        // where it is thinnest (toward its edges and its tip), and its rim catches the glow.
        const V = normalize(positionWorld.sub(cameraPosition));
        const facing = clamp(dot(V, vec3(GLOW_FLAT[0], 0.0, GLOW_FLAT[1])), 0.0, 1.0);
        const thin = across.abs().pow(2.0).mul(0.6).add(t.mul(0.5))
            .add(0.25);
        const through = u.glow.mul(facing.mul(facing).mul(facing)).mul(thin).mul(0.55);
        const rim = vcBell(across.abs().sub(1.0).div(0.25)).mul(0.18);
        const edges = mix(u.shell, u.glow, 0.5).mul(rim).mul(vcSkyBase(u, vec3(0.0, 0.3, -1.0)).mul(2.0).add(0.1));
        const petalCol = pale.add(through).add(edges).add(lit.add(ember).add(glow).mul(u.breath));
        // A stamen: a gold thread with a bead of light at its tip.
        const bead = smoothstep(0.7, 0.95, t);
        const threadCol = vec3(0.5, 0.36, 0.1).mul(sky).mul(2.0)
            .add(mix(vec3(1.0, 0.8, 0.4), vTint, clamp(vLevel, 0.0, 1.0).mul(0.6))
                .mul(bead.mul(vAmbient.mul(1.4).add(vLevel.mul(1.6)).add(vFlash.mul(2.0)).add(0.1))).mul(u.breath));
        return vec4(mix(petalCol, threadCol, stamen), 1.0);
    })();
    petals.material = petalMat;

    // ── Pads, and the pool of light each lit lily lays on the water ──
    const padGeo = new THREE.PlaneGeometry(1, 1);
    padGeo.rotateX(-Math.PI / 2);
    const padCount = count + loose.length;
    const padData = new Float32Array(Math.max(1, padCount) * 4); // (x, z, size, index | −1 for a loose pad)
    const padMore = new Float32Array(Math.max(1, padCount) * 2); // (seed, kind)
    for (let i = 0; i < count; i++) {
        padData.set([plan[i].x, plan[i].z, plan[i].size, i], i * 4);
        padMore.set([plan[i].seed, plan[i].kind ?? 0], i * 2);
    }
    loose.forEach((p, k) => {
        padData.set([p.x, p.z, p.size, -1], (count + k) * 4);
        padMore.set([p.seed, 0], (count + k) * 2);
    });
    padGeo.setAttribute('aLily', new THREE.InstancedBufferAttribute(padData, 4));
    padGeo.setAttribute('aPad', new THREE.InstancedBufferAttribute(padMore, 2));
    const pads = new THREE.InstancedMesh(padGeo, null, Math.max(1, padCount));
    pads.count = padCount;
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
    const POOL = 9; // a lily's quad: its half-width in lily sizes (it holds the pool of light)
    const BARE = 1.4; // a loose pad's
    const aPad = attribute('aPad', 'vec2');
    const padState = readState(aLily.w);
    const padReach = mix(float(BARE), float(POOL), step(-0.5, aLily.w));
    const vPadLevel = varying(padState.level, 'vPadLevel');
    const vPadTint = varying(padState.tint, 'vPadTint');
    const vPadFlash = varying(padState.flash, 'vPadFlash');
    const vPadSeed = flatVarying(vec3(aPad.x, padReach, ambient(aLily.x, aLily.y, aPad.y, aPad.x).mul(step(-0.5, aLily.w))), 'vPadSeed');
    const vPadKind = flatVarying(aPad.y, 'vPadKind');
    const aPadKindOf = () => vPadKind;
    padMat.positionNode = Fn(() => vec3(
        aLily.x.add(positionGeometry.x.mul(aLily.z).mul(padReach).mul(2.0)),
        0.035,
        aLily.y.add(positionGeometry.z.mul(aLily.z).mul(padReach).mul(2.0)),
    ))();
    padMat.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    padMat.outputNode = Fn(() => {
        const reach = vPadSeed.y;
        const seed = vPadSeed.x;
        const q = uv().sub(0.5).mul(2.0).mul(reach)
            .toVar(); // in lily sizes
        const d = length(q).toVar();
        // The pad: a round leaf with a notch, its waxy face holding the sky like the water does,
        // only rougher; veins run out from the stem, and the rim turns up and catches the glow.
        const ang = atan(q.y, q.x).add(seed.mul(6.0)).toVar();
        const notch = smoothstep(0.0, 0.16, ang.sin().abs().add(step(0.0, ang.cos())));
        // (No two leaves are quite round.)
        const edge = sin(ang.mul(3.0).add(seed.mul(20.0))).mul(0.035).add(1.16);
        const leaf = float(1.0).sub(smoothstep(edge, edge.add(0.08), d)).mul(mix(float(1.0), notch, smoothstep(0.25, 0.5, d)))
            .toVar();
        // Veins: ridges every so many degrees, fading toward the stem and the rim.
        const vein = vcBell(sin(ang.mul(VEINS * 0.5)).div(0.07)).mul(smoothstep(0.12, 0.4, d))
            .mul(float(1.0).sub(smoothstep(0.85, 1.15, d)));
        // The leaf is a shallow dish: flat, with a lip that rises at the rim.
        const lip = smoothstep(1.0, 1.22, d);
        const out = q.div(max(d, 1e-3));
        const leafN = normalize(vec3(out.x.mul(lip.mul(-0.45).add(vein.mul(0.05))), 1.0, out.y.mul(lip.mul(-0.45))));
        const V = normalize(positionWorld.sub(cameraPosition)).toVar();
        const R = reflect(V, leafN);
        // (Wet patches shine more than the dry wax between them.)
        const wet = smoothstep(0.35, 0.75, sin(ang.mul(3.0).add(d.mul(4.0)).add(seed.mul(7.0))).mul(0.5).add(0.5));
        const sheen = vcFresnel(clamp(dot(V, leafN).negate(), 0.0, 1.0), 0.04).mul(wet.mul(0.5).add(0.75))
            .add(0.05);
        const mirrored = vcSkyBase(u, normalize(vec3(R.x, max(R.y, 0.0).add(0.03), R.z))).mul(sheen);
        // Its own green, deep at dusk, a shade brighter along the veins; some leaves turn to wine.
        const wine = smoothstep(0.62, 0.9, seed);
        const deep = mix(vec3(0.03, 0.085, 0.045), vec3(0.085, 0.03, 0.05), wine);
        const bright = mix(vec3(0.07, 0.16, 0.07), vec3(0.17, 0.07, 0.09), wine);
        const green = mix(deep, bright, vein.mul(0.6).add(lip.mul(0.3)))
            .mul(vcSkyBase(u, vec3(0.0, 1.0, 0.0)).mul(2.4).add(0.2));
        // Dew: beads on the leaf that hold a point of the evening each.
        const cellAt = q.mul(5.5).add(seed.mul(31.0)).toVar();
        const cell = floor(cellAt);
        const pick = vcHash21(cell.add(vec2(57.0, 113.0)));
        const drop = fract(cellAt).sub(vec2(0.3, 0.3).add(vec2(pick, fract(pick.mul(7.3))).mul(0.4)));
        const bead = exp(dot(drop, drop).mul(-90.0)).mul(step(0.8, pick)).mul(float(1.0).sub(lip));
        const wink = sin(u.time.mul(pick.mul(2.0).add(0.8)).add(pick.mul(90.0))).mul(0.4).add(0.6);
        const dew = u.glow.mul(0.6).add(vec3(0.5, 0.5, 0.55)).mul(bead.mul(wink)).mul(1.5)
            .mul(u.breath.mul(0.5).add(0.5));
        const own = mix(mix(mix(u.wingRoot, u.glow, 0.5), u.crystal, step(0.5, aPadKindOf(vPadSeed))), u.wingMid, step(1.5, aPadKindOf(vPadSeed)));
        const leafCol = green.add(mirrored).add(dew)
            .add(vPadTint.mul(vPadLevel).add(own.mul(vPadSeed.z.mul(0.3))).mul(exp(d.mul(-1.4))).mul(0.5)
                .mul(u.breath));
        // The pool: the lantern's light lying on the water.
        const poolEdge = float(1.0).sub(smoothstep(reach.mul(0.7), reach, d));
        const pool = exp(d.mul(-0.62)).mul(0.5).add(exp(d.mul(-1.9)).mul(0.9)).mul(poolEdge);
        const light = vPadTint.mul(vPadLevel.mul(0.42).add(vPadFlash.mul(0.5))).add(own.mul(vPadSeed.z.mul(0.1))).mul(pool).mul(u.breath);
        return vec4(mix(light, leafCol, leaf), leaf);
    })();
    pads.material = padMat;

    // ── Auras: the glow a lantern stands in, and the spark at its heart ──
    const auraGeo = new THREE.PlaneGeometry(1, 1);
    const auraData = new Float32Array(Math.max(1, count) * 4);
    for (let i = 0; i < count; i++) auraData.set([plan[i].x, plan[i].z, plan[i].size, i], i * 4);
    auraGeo.setAttribute('aLily', new THREE.InstancedBufferAttribute(auraData, 4));
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
            to = e.kind === 'strike' ? Math.min(BLOOM_FULL, held + e.amount) : held * e.keep;
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
            index, at, kind: 'strike', rgb: [rgb[0], rgb[1], rgb[2]], amount, tag: null, keep: 1,
        });
    };
    /**
     * Lily `index` lets its light go at `at`, keeping the share `keep` of it (BLOOM_KEEP; more
     * when play runs hot). `tag` names what makes it (a swell's birth), so `cancel(tag)` can call
     * it off.
     */
    part.release = (index, at, tag = null, keep = BLOOM_KEEP) => {
        if (!(index >= 0 && index < count) || !Number.isFinite(at)) return;
        const share = Number.isFinite(keep) ? Math.max(0, Math.min(1, keep)) : BLOOM_KEEP;
        schedule({
            index, at, kind: 'release', rgb: null, amount: 0, tag, keep: share,
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
                s.to = held * e.keep;
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
