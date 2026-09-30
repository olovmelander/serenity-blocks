/**
 * Parhelion particles and pillars (spec §5.4 diamond dust, §5.5 glint pool, §5.6 hound pillars).
 *
 * Every layer is analytic and allocation-free per frame:
 * - Diamond dust: ONE instanced Sprite, screen-parametrised (100 % of the instances are on
 *   screen, parallax by depth), all motion from uDustClock. Gated instances get size 0, so
 *   they are never rasterised. Glitters hardest on the 22° ring and around the hounds, goes
 *   prismatic on the ring (below the horizon too) and is calm-masked over the card.
 * - Glint pool: ONE instanced Sprite of SLOTS × PER_SLOT motes driven by four uniformArrays of
 *   burst slots — zero attribute uploads; a dormant/expired mote has size 0.
 * - Hound pillars: ONE mesh of 6 static quads placed and lit from two uniformArrays; a dormant
 *   pillar collapses to zero area.
 *
 * Materials are PointsNodeMaterial / MeshBasicNodeMaterial, additive, no depth writes. The
 * PointsNodeMaterial multiplies sizeNode by the renderer DPR itself (sizes here are CSS px).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    Loop,
    abs,
    acos,
    asin,
    atan,
    attribute,
    clamp,
    cos,
    cross,
    dot,
    exp,
    float,
    fract,
    instanceIndex,
    int,
    inverseSqrt,
    max,
    min,
    mix,
    normalize,
    pow,
    round,
    select,
    sin,
    smoothstep,
    step,
    uint,
    uniformArray,
    uv,
    vec2,
    vec3,
    vec4,
    vertexStage,
} from 'three/tsl';
import { hash21, noise2 } from '../../rendering/odyssey/chapter-environments/shared/odyssey-tsl-noise.js';
import {
    DOG_AZ, E, R, R22, S, U,
} from './parhelion-composition.js';
import { linearColor, phCalmBox, phSpectral } from './parhelion-optics.js';

const TWO_PI = 6.283185;
const round6 = (x) => Math.round(x * 1e6) / 1e6;
const S3 = [S.x, S.y, S.z].map(round6);
const R3 = [R.x, R.y, R.z].map(round6);
const U3 = [U.x, U.y, U.z].map(round6);
const R22S = round6(R22);
const DOG_AZS = round6(DOG_AZ);
const ES = round6(E);

/** Diamond-dust instance counts per tier (§9) and the near-bokeh class (Ultra and above). */
export const PARHELION_DUST_COUNTS = Object.freeze({
    Minimal: Object.freeze({ count: 800, near: 0 }),
    Low: Object.freeze({ count: 1600, near: 0 }),
    Medium: Object.freeze({ count: 2600, near: 0 }),
    High: Object.freeze({ count: 4000, near: 0 }),
    Ultra: Object.freeze({ count: 6000, near: 60 }),
    Extreme: Object.freeze({ count: 8000, near: 120 }),
});

function additive(material) {
    material.transparent = true;
    material.blending = THREE.AdditiveBlending;
    material.depthWrite = false;
    material.depthTest = true;
    material.fog = false;
    return material;
}

/** The sparkle profile both point layers share: a round core plus a soft four-point cross. */
function starProfile() {
    const r = uv().sub(0.5);
    const core = exp(dot(r, r).mul(-40.0));
    const armX = exp(abs(r.x).mul(-60.0)).mul(exp(abs(r.y).mul(-8.0)));
    const armY = exp(abs(r.y).mul(-60.0)).mul(exp(abs(r.x).mul(-8.0)));
    return core.add(armX.add(armY).mul(0.6));
}

const wrapPi = (x) => x.sub(round(x.div(TWO_PI)).mul(TWO_PI));

// ---------------------------------------------------------------------------------------
// Diamond dust (§5.4)
// ---------------------------------------------------------------------------------------

/**
 * Builds the dust Sprite: `aSeed` (u0, v0, depth z ∈ [4, 120] ∝ z², phase) and `aKind` (size,
 * omega, hue jitter, near flag). `rng` is the playground/theme seeded RNG (never Math.random).
 */
export function buildDustSprite(material, { count, near = 0 }, rng) {
    const sprite = new THREE.Sprite(material);
    sprite.geometry = sprite.geometry.clone();
    const seed = new Float32Array(count * 4);
    const kind = new Float32Array(count * 4);
    const zMin3 = 4 ** 3;
    const zMax3 = 120 ** 3;
    for (let i = 0; i < count; i++) {
        const isNear = i < near;
        const o = i * 4;
        seed[o] = rng();
        seed[o + 1] = rng();
        seed[o + 2] = isNear ? 4 + 4 * rng() : Math.cbrt(zMin3 + rng() * (zMax3 - zMin3));
        seed[o + 3] = rng();
        kind[o] = rng();
        kind[o + 1] = rng();
        kind[o + 2] = rng();
        kind[o + 3] = isNear ? 1 : 0;
    }
    sprite.geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    sprite.geometry.setAttribute('aKind', new THREE.InstancedBufferAttribute(kind, 4));
    sprite.count = count;
    sprite.frustumCulled = false;
    sprite.renderOrder = 20;
    sprite.name = 'parhelion-diamond-dust';
    return sprite;
}

/**
 * @param {object} u shared uniforms (parhelion-materials.js)
 * @param {{ minimal?: boolean }} [options] Minimal clamps the flashes (no post / no tone map)
 */
export function createDustMaterial(u, { minimal = false } = {}) {
    const material = additive(new THREE.PointsNodeMaterial());
    material.name = 'parhelion-dust';
    material.sizeAttenuation = false;

    const seed = attribute('aSeed', 'vec4');
    const kind = attribute('aKind', 'vec4');
    const clock = u.uDustClock;
    const sVec = vec3(...S3);

    // Screen parametrisation: wind drifts left → right, crystals settle slowly; parallax by depth.
    const par = float(40.0).div(seed.z);
    const wobble = sin(clock.mul(kind.y.mul(0.2).add(0.3)).add(seed.w.mul(TWO_PI))).mul(0.004);
    const su = fract(seed.x.add(clock.mul(par).mul(0.0035)).add(wobble));
    const sv = fract(seed.y.add(clock.mul(par).mul(0.0012)));
    const ray = sVec.add(vec3(...R3).mul(su.mul(2.0).sub(1.0).mul(u.uTanHV.x)))
        .add(vec3(...U3).mul(float(1.0).sub(sv.mul(2.0)).mul(u.uTanHV.y)));
    const dir = normalize(ray);
    const cA = dot(dir, sVec);
    // Never under the snow: a crystal on a downward ray stops short of the ground.
    const groundDepth = cA.mul(23.75).div(max(dir.y.negate(), 0.001));
    const zEff = select(dir.y.lessThan(0.0), min(seed.z, groundDepth), seed.z);
    material.positionNode = u.uCamRest.add(dir.mul(zEff.div(cA)));

    // Direction terms (§5.0) for this crystal's ray.
    const a = acos(clamp(cA, -1.0, 1.0));
    const xG = a.sub(R22S);
    const ly = dot(dir, vec3(...U3));
    const inv = inverseSqrt(dir.x.mul(dir.x).add(ly.mul(ly)).add(1e-8));
    const cphi = dir.x.mul(inv);
    const sphi = ly.mul(inv);
    const az = atan(dir.x, dir.z.negate());
    const el = asin(clamp(dir.y, -1.0, 1.0));

    // Reaction arcs light the crystals on the ring: ONE loop, free while no arc is live.
    const arcs = Fn(() => {
        const acc = float(0.0).toVar();
        If(u.uArcCount.greaterThan(0), () => {
            const phiM = atan(sphi, abs(cphi));
            const phiO = atan(sphi, cphi);
            Loop(u.uArcCount, ({ i }) => {
                const slot = u.uArcs.element(i);
                const dp = wrapPi(select(slot.w.lessThan(0.5), phiM, phiO).sub(slot.x));
                const w = slot.z.mul(1.8);
                acc.addAssign(slot.y.mul(exp(dp.mul(dp).div(w.mul(w)).negate())));
            });
        });
        return acc;
    })();
    const ringBand = exp(xG.mul(xG).div(0.000324).negate());
    const ringWide = exp(xG.mul(xG).div(0.0009).negate());
    // Squares, not pow(): WGSL pow() of a negative base is undefined.
    const dAz = abs(az).sub(DOG_AZS);
    const dEl = el.sub(ES);
    const dogD = dAz.mul(dAz).add(dEl.mul(dEl));
    const dogFlare = max(u.uDogFlare.x, u.uDogFlare.y).add(1.0);
    const spokeD = wrapPi(atan(sphi, cphi).sub(u.uSpoke.x));
    const alpha = a.mul(cphi);
    // Forward-scatter weighted: far from the sun a flash is faint (no daytime starfield).
    const gain = float(0.08).add(exp(a.div(0.25).negate()).mul(0.9))
        .add(ringBand.mul(u.uRingFlash.mul(4.0).add(1.0)).mul(2.2))
        .add(exp(dogD.div(0.0004).negate()).mul(u.uK0.y).mul(dogFlare).mul(2.5))
        .add(arcs.mul(ringWide))
        .add(u.uSpoke.y.mul(exp(spokeD.mul(spokeD).div(0.04).negate())))
        .add(u.uCrossArm.mul(exp(alpha.mul(alpha).div(0.000144).negate())));

    // Each plate catches the sun now and then; a top-down shower wave for Clear Sky.
    const glint = pow(sin(clock.mul(kind.y.mul(1.6).add(0.6)).add(seed.w.mul(40.0))).mul(0.5).add(0.5), 28.0);
    const wavePos = float(1.0).sub(sv).sub(fract(clock.mul(0.42)));
    const wave = exp(wavePos.mul(wavePos).div(0.004).negate());
    const flash = max(glint, max(u.uRingFlash.mul(ringWide), u.uShower.mul(wave)));
    // "Counting crystals": a stable hash order reveals more of them as the density rises.
    const reveal = step(hash21(vec2(float(instanceIndex).mul(0.61803), 7.1)), u.uDensity);
    const calm = phCalmBox(vec2(su, sv), u.uCalmUnion, 0.05, u.uAspect);
    const edge = pow(sin(su.mul(Math.PI)).mul(sin(sv.mul(Math.PI))), 0.3);
    const nearMul = mix(1.0, 0.25, kind.w);
    // Forward scattering: away from the sun a crystal is invisible until it flashes (no starfield).
    const ambient = exp(a.div(0.3).negate()).mul(0.045).add(0.004);
    const bright = flash.mul(gain).add(ambient).mul(u.uDustGain).mul(edge)
        .mul(float(1.0).sub(calm.mul(0.92)))
        .mul(nearMul)
        .mul(minimal ? 0.6 : 1.0);
    const px = clamp(kind.x.mul(1.6).add(1.2).mul(flash.mul(1.5).add(1.0)), 1.0, 5.0).mul(mix(1.0, 2.8, kind.w));
    material.sizeNode = px.mul(reveal).mul(step(0.004, bright));

    // Warm near the sun, prismatic on the ring (more so while the prism flash runs).
    const warm = mix(vec3(1.0), linearColor(0xFFE7B8), pow(max(cA, 0.0), 6.0));
    const prism = phSpectral(clamp(xG.add(0.01).div(0.03), 0.0, 1.0));
    const tint = mix(warm, prism, ringWide.mul(u.uPrism.mul(0.5).add(0.5)));
    material.colorNode = vertexStage(tint.mul(bright)).mul(starProfile());
    material.opacityNode = float(1.0);
    return material;
}

// ---------------------------------------------------------------------------------------
// Glint pool (§5.5)
// ---------------------------------------------------------------------------------------

/** Burst uniform arrays: A origin.xyz+birth, B count/life/strength/hue, C dir.xyz+speed, D mode/spread/seed/size. */
export function createBurstUniforms(slots) {
    const make = (w) => Array.from({ length: slots }, () => new THREE.Vector4(0, 0, 0, w));
    const values = {
        a: make(-1e4), b: make(1), c: make(0), d: make(0),
    };
    return {
        slots,
        values,
        uBurstA: uniformArray(values.a, 'vec4'),
        uBurstB: uniformArray(values.b, 'vec4'),
        uBurstC: uniformArray(values.c, 'vec4'),
        uBurstD: uniformArray(values.d, 'vec4'),
    };
}

export function buildGlintSprite(material, count) {
    const sprite = new THREE.Sprite(material);
    sprite.geometry = sprite.geometry.clone();
    sprite.count = count;
    sprite.frustumCulled = false;
    sprite.renderOrder = 21;
    sprite.name = 'parhelion-glint-pool';
    return sprite;
}

export function createGlintMaterial(u, bursts, perSlot) {
    const material = additive(new THREE.PointsNodeMaterial());
    material.name = 'parhelion-glints';
    material.sizeAttenuation = false;

    const per = uint(perSlot);
    const slot = instanceIndex.div(per);
    const local = float(instanceIndex.sub(slot.mul(per)));
    const a = bursts.uBurstA.element(slot);
    const b = bursts.uBurstB.element(slot);
    const c = bursts.uBurstC.element(slot);
    const d = bursts.uBurstD.element(slot);
    const age = u.uTime.sub(a.w);
    const active = step(0.0, age).mul(step(age, b.y)).mul(step(local.add(0.5), b.x));
    const h1 = hash21(vec2(local, d.z));
    const h2 = hash21(vec2(local.add(3.1), d.z));
    const h3 = hash21(vec2(local.add(7.7), d.z));
    const jitter = normalize(vec3(h1, h2, h3).sub(0.5).add(1e-4));
    const vel0 = c.xyz.mul(c.w).add(jitter.mul(d.y));
    // Spiral (mode 2): rotate the velocity about S (Rodrigues).
    const sVec = vec3(...S3);
    const th = age.mul(4.0);
    const cs = cos(th);
    const axial = sVec.mul(dot(sVec, vel0).mul(float(1.0).sub(cs)));
    const spun = vel0.mul(cs).add(cross(sVec, vel0).mul(sin(th))).add(axial);
    const vel = select(abs(d.x.sub(2.0)).lessThan(0.5), spun, vel0);
    const fall = select(abs(d.x.sub(1.0)).lessThan(0.5), vec3(0.0, age.mul(age).mul(-1.4), 0.0), vec3(0.0));
    const drift = float(1.0).sub(exp(age.mul(-2.2))).div(2.2);
    material.positionNode = a.xyz.add(vel.mul(drift)).add(vec3(1.2, -0.25, 0.4).mul(age.mul(0.3))).add(fall);

    const tn = age.div(max(b.y, 1e-3));
    const alive = smoothstep(0.0, 0.06, tn).mul(float(1.0).sub(smoothstep(0.55, 1.0, tn)));
    const flash = pow(sin(age.mul(h1.mul(6.0).add(9.0)).add(h2.mul(20.0))).mul(0.5).add(0.5), 10.0);
    const lit = alive.mul(active);
    material.sizeNode = d.w.mul(lit).mul(flash.add(1.0));
    const col = phSpectral(b.w.add(h1.sub(0.5).mul(0.12))).mul(b.z.mul(flash.add(1.0)).mul(lit));
    material.colorNode = vertexStage(col).mul(starProfile());
    material.opacityNode = float(1.0);
    return material;
}

// ---------------------------------------------------------------------------------------
// Hound pillars (§5.6)
// ---------------------------------------------------------------------------------------

/** Six static quads (12 tris): `aLane` 0..5 + quad uv; the shader places them. */
export function buildPillarGeometry(lanes = 6) {
    const positions = new Float32Array(lanes * 4 * 3);
    const uvs = new Float32Array(lanes * 4 * 2);
    const lane = new Float32Array(lanes * 4);
    const index = [];
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (let k = 0; k < lanes; k++) {
        for (let c = 0; c < 4; c++) {
            uvs[(k * 4 + c) * 2] = corners[c][0];
            uvs[(k * 4 + c) * 2 + 1] = corners[c][1];
            lane[k * 4 + c] = k;
        }
        const o = k * 4;
        index.push(o, o + 1, o + 2, o, o + 2, o + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute('aLane', new THREE.BufferAttribute(lane, 1));
    geometry.setIndex(index);
    return geometry;
}

/**
 * @param {object} u shared uniforms (uPillars, uPillarPlace, uTime, uCamRest)
 * @param {{ glitter?: boolean }} [options] glitter off at Minimal (0 noise evals)
 */
export function createPillarMaterial(u, { glitter = true } = {}) {
    const material = additive(new THREE.MeshBasicNodeMaterial());
    material.name = 'parhelion-pillars';
    material.side = THREE.FrontSide;

    const k = int(attribute('aLane', 'float'));
    const place = u.uPillarPlace.element(k);
    const st = u.uPillars.element(k);
    const age = u.uTime.sub(st.x);
    const lifeK = max(st.w, 1e-3);
    const alive = smoothstep(0.0, 0.15, age).mul(float(1.0).sub(smoothstep(lifeK.mul(0.55), lifeK, age)))
        .mul(step(0.0, age));
    const base = vec3(place.x, 0.0, place.y);
    const right = normalize(cross(vec3(0.0, 1.0, 0.0), u.uCamRest.sub(base)));
    const q = uv();
    // A dormant pillar has zero width: nothing is rasterised.
    material.positionNode = base.add(right.mul(q.x.sub(0.5).mul(place.z).mul(step(0.001, alive))))
        .add(vec3(0.0, 1.0, 0.0).mul(q.y.mul(place.w)));

    const state = vertexStage(vec4(age, alive, st.y, st.z));
    const life = vertexStage(lifeK);
    const ax = q.x.sub(0.5).mul(2.0);
    const beadV = mix(state.w, 1.05, smoothstep(0.0, life.mul(0.7), state.x));
    const shaft = smoothstep(0.0, 0.25, q.y).mul(float(1.0).sub(smoothstep(0.75, 1.0, q.y)));
    const core = exp(ax.mul(ax).mul(-9.0)).mul(shaft.mul(0.72).add(0.28));
    const bd = q.y.sub(beadV).div(0.045);
    const bead = exp(bd.mul(bd).negate()).mul(exp(ax.mul(ax).mul(-4.0))).mul(1.8);
    const sparkle = glitter
        ? step(0.55, noise2(vec2(ax.mul(7.0), q.y.mul(90.0).sub(u.uTime.mul(1.6))))).mul(0.5)
        : float(0.0);
    const gold = mix(linearColor(0xFFD98A), linearColor(0xFFF4DC), q.y);
    material.colorNode = gold.mul(core.mul(sparkle.add(0.7)).add(bead)).mul(state.z.mul(state.y));
    material.opacityNode = float(1.0);
    return material;
}
