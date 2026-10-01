/**
 * Shifting Sands — sand, spice and dust. Four instanced systems, one draw each, all closed-form
 * in the world clock (no compute, no per-frame uploads, nothing created at event time):
 *
 *  - Worm sand: curtains of sand pouring off the breaching body (each grain is born on the body
 *    at its own spawn time and falls ballistically, so the cascade trails the moving arch), and
 *    the plumes heaved up where the body pierces the erg.
 *  - Spice motes: melange glittering in the air, drifting with the wind; the motes toward the suns
 *    flash in forward scatter. Pixel-floored so they never vanish into sub-pixel speckle.
 *  - Spindrift: veils of sand torn off the crests by the wind, seated on real crest points found
 *    on the CPU dune field, streaming downwind and glowing gold where they are backlit.
 *  - Spice blows: geysers of spice and dust (line clears), slot-pooled.
 *
 * Blending: premultiplied "over" (One, OneMinusSrcAlpha) for every system, so a grain can be
 * alpha dust and additive glow at once — rgb·a + emission, a.
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
    exp,
    float,
    floor,
    fract,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    pow,
    select,
    sin,
    smoothstep,
    step,
    uniformArray,
    uv,
    vec2,
    vec3,
    vec4,
    vertexStage,
} from 'three/tsl';
import { DUNE } from './shifting-sands-terrain.js';
import { mulberry32, ssPhaseHG, ssTexNoise } from './shifting-sands-tsl.js';

const TAU = Math.PI * 2;

/** Per-tier instance budgets. */
export const FX_TIERS = Object.freeze({
    Minimal: {
        wormSand: 0, motes: 300, spindrift: 0, blowPerSlot: 60,
    },
    Low: {
        wormSand: 260, motes: 600, spindrift: 24, blowPerSlot: 110,
    },
    Medium: {
        wormSand: 480, motes: 1000, spindrift: 48, blowPerSlot: 160,
    },
    High: {
        wormSand: 760, motes: 1500, spindrift: 72, blowPerSlot: 220,
    },
    Ultra: {
        wormSand: 1000, motes: 2200, spindrift: 96, blowPerSlot: 280,
    },
    Extreme: {
        wormSand: 1300, motes: 3000, spindrift: 120, blowPerSlot: 340,
    },
});

export const BLOW_SLOTS = 3;

function quadGeometry(count, seed, extra = null) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    const rand = mulberry32(seed);
    const seeds = new Float32Array(Math.max(1, count) * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = rand();
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    if (extra) {
        Object.keys(extra).forEach((k) => geometry.setAttribute(k, extra[k]));
    }
    geometry.instanceCount = count;
    return geometry;
}

function fxMaterial(name) {
    const m = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    m.name = name;
    m.fog = false;
    m.blending = THREE.CustomBlending;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneMinusSrcAlphaFactor;
    m.blendSrcAlpha = THREE.OneFactor;
    m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    m.forceSinglePass = true;
    return m;
}

/** Clip position of a camera-facing quad corner around `center` (view-space offset). */
function billboardClip(center, offset) {
    const vp = cameraViewMatrix.mul(vec4(center, 1.0));
    return cameraProjectionMatrix.mul(vec4(vp.xy.add(offset), vp.z, 1.0));
}

/** Dust lit by the twin suns: violet sky fill + forward scattering (backlit grains glow). */
function dustRadiance(shared, albedo, worldPos, forward = 1.0) {
    const {
        uSunA, uSunB, uSunLightA, uSunLightB, uUpper, uZenith,
    } = shared;
    const vdir = normalize(worldPos.sub(cameraPosition));
    const pA = ssPhaseHG(dot(vdir, uSunA), float(0.62)).mul(forward).add(0.07);
    const pB = ssPhaseHG(dot(vdir, uSunB), float(0.66)).mul(forward).add(0.05);
    const fill = uUpper.mul(0.55).add(uZenith.mul(0.4));
    return albedo.mul(uSunLightA.mul(pA).add(uSunLightB.mul(pB)).add(fill));
}

// ─────────────────────────────────────────────────────────────────────────────
// Worm sand: cascades + pierce plumes
// ─────────────────────────────────────────────────────────────────────────────

export function createWormSand(shared, worm, count) {
    const n = Math.max(0, count | 0);
    const geometry = quadGeometry(n, 4242);
    const material = fxMaterial('shifting-sands-worm-sand');
    const {
        uTime, atmosphere, noiseTex, uWindDir,
    } = shared;
    const {
        uB0, uB1, uB2, uB3,
    } = worm.uniforms;
    const seed = attribute('aSeed', 'vec4');

    const O = uB0.xyz;
    const D = vec3(uB1.x, 0.0, uB1.y);
    const Y = vec3(0.0, 1.0, 0.0);
    const W = vec3(uWindDir.x, 0.0, uWindDir.y);
    const a = uB1.z;
    const b = uB1.w;
    const k = uB2.x;
    const R = uB2.y;
    const span = uB2.z;
    const omega = uB3.x;
    const phi0 = uB3.y;
    const pathAt = (phi) => O.add(D.mul(a.mul(sin(phi)))).add(Y.mul(b.mul(cos(phi)).sub(k)));
    const tangentAt = (phi) => normalize(D.mul(a.mul(cos(phi))).sub(Y.mul(b.mul(sin(phi)))));

    const isPlume = step(0.7, seed.x);
    const life = mix(seed.y.mul(1.8).add(2.2), seed.y.mul(3.0).add(3.6), isPlume);
    const age = fract(uTime.div(life).add(seed.z)).mul(life);
    const phiSpawnHead = uB0.w.sub(age.mul(omega));

    // Cascade grain: born on the top of the body, falls and drifts.
    const sigma = seed.w.mul(0.8);
    const phiS = phiSpawnHead.sub(sigma.mul(span));
    const T = tangentAt(phiS);
    const Pn = normalize(cross(D, Y));
    const Bn = cross(Pn, T);
    const side = seed.y.sub(0.5).mul(1.6);
    const topDir = normalize(Bn.add(Pn.mul(side)));
    const taper = mix(float(1.0), float(0.35), smoothstep(0.32, 1.0, sigma));
    const spawnC = pathAt(phiS).add(topDir.mul(R.mul(taper)));
    const v0 = T.mul(uB3.z.mul(0.22)).add(topDir.mul(seed.z.mul(6.0).add(3.0)));
    const g = float(24.0);
    const cascadePos = spawnC.add(v0.mul(age)).add(Y.mul(age.mul(age).mul(g.mul(-0.5))))
        .add(W.mul(age.mul(seed.x.mul(8.0).add(4.0))));
    const aboveAtSpawn = smoothstep(0.0, 0.08, phi0.sub(abs(phiS)));

    // Plume puff: heaved up at the emergence (−φ0) or dive (+φ0) point while the body fills it.
    const dive = step(0.5, fract(seed.w.mul(7.31)));
    const pierce = mix(phi0.negate(), phi0, dive);
    const E = pathAt(pierce);
    const tailAtSpawn = phiSpawnHead.sub(span);
    const filled = step(pierce, phiSpawnHead).mul(step(tailAtSpawn, pierce));
    const ang = seed.y.mul(TAU);
    const radial = vec3(cos(ang), 0.0, sin(ang));
    const rise = age.mul(seed.z.mul(16.0).add(10.0)).sub(age.mul(age).mul(1.1));
    const plumePos = E.add(radial.mul(R.mul(1.15).add(age.mul(7.0)))).add(Y.mul(max(rise, 0.0).add(R.mul(0.2))))
        .add(W.mul(age.mul(9.0)));

    const center = mix(cascadePos, plumePos, isPlume);
    const sizeC = float(4.0).add(age.mul(5.0)).mul(R.div(40.0).add(0.4));
    const sizeP = float(15.0).add(age.mul(13.0)).mul(R.div(40.0).add(0.3));
    const size = mix(sizeC, sizeP, isPlume);
    const groundFade = smoothstep(O.y.sub(3.0), O.y.add(5.0), cascadePos.y);
    const alive = mix(aboveAtSpawn.mul(groundFade), filled, isPlume).mul(step(0.5, R));
    const fade = smoothstep(0.0, 0.35, age).mul(float(1.0).sub(smoothstep(life.mul(0.55), life, age)));
    const alpha = alive.mul(fade).mul(mix(0.55, 0.32, isPlume));

    // Streak cascade grains along their fall.
    const vel = v0.add(Y.mul(age.mul(g).negate()));
    const velV = cameraViewMatrix.mul(vec4(vel, 0.0)).xy;
    const dir2 = normalize(velV.add(vec2(1e-4, 0.0)));
    const stretch = mix(float(2.6), float(1.0), isPlume);
    const q = positionGeometry.xy;
    const along = mix(q.x, q.x.mul(dir2.x).sub(q.y.mul(dir2.y)), float(1.0).sub(isPlume));
    const across = mix(q.y, q.x.mul(dir2.y).add(q.y.mul(dir2.x)), float(1.0).sub(isPlume));
    const offset = vec2(along.mul(stretch), across).mul(size).mul(step(0.001, alpha));
    material.vertexNode = billboardClip(center, mix(offset, vec2(q.x, q.y).mul(size).mul(step(0.001, alpha)), isPlume));

    material.colorNode = Fn(() => {
        const st = uv().sub(0.5);
        const vA = vertexStage(alpha);
        const vPl = vertexStage(isPlume);
        const vC = vertexStage(center);
        const vSeed = vertexStage(seed);
        const r = length(st).mul(2.0);
        const nz = ssTexNoise(noiseTex, st.mul(3.0).add(vSeed.xy.mul(37.0)).add(uTime.mul(0.15)));
        const shape = float(1.0).sub(smoothstep(mix(0.2, 0.15, vPl), 1.0, r))
            .mul(mix(0.7, nz.x.mul(1.2).add(0.2), vPl));
        const albedo = mix(vec3(0.62, 0.37, 0.19), vec3(0.5, 0.34, 0.22), vPl);
        const col = atmosphere.applyAerial(dustRadiance(shared, albedo, vC, mix(1.0, 0.55, vPl)), vC, 0.6);
        const a2 = clamp(shape.mul(vA), 0.0, 1.0);
        return vec4(col.mul(a2), a2);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'shifting-sands-worm-sand';
    mesh.frustumCulled = false;
    mesh.renderOrder = 30;
    return {
        mesh,
        /** Dormant between breaches: one degenerate instance keeps the pipeline compiled. */
        setActive(active) {
            geometry.instanceCount = active ? n : Math.min(1, n);
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Spice motes
// ─────────────────────────────────────────────────────────────────────────────

const MOTE_BOX = Object.freeze({
    cx: 0, cz: -560, sx: 1500, sz: 1100, y0: 2, y1: 70,
});

export function createSpiceMotes(shared, count) {
    const n = Math.max(1, count | 0);
    const geometry = quadGeometry(n, 9001);
    const material = fxMaterial('shifting-sands-spice-motes');
    const {
        uTime, uSunA, uSpiceGlow, uWindDir, uPxScale, uDusk,
    } = shared;
    const seed = attribute('aSeed', 'vec4');

    // Drift with the wind inside a box in front of the camera (wraps seamlessly).
    const speed = seed.w.mul(10.0).add(5.0);
    const base = vec2(seed.x.sub(0.5).mul(MOTE_BOX.sx), seed.y.sub(0.5).mul(MOTE_BOX.sz));
    const drift = uWindDir.mul(uTime.mul(speed));
    const box = vec2(MOTE_BOX.sx, MOTE_BOX.sz);
    const xz = fract(base.add(drift).div(box).add(0.5)).sub(0.5).mul(box).add(vec2(MOTE_BOX.cx, MOTE_BOX.cz));
    const swirl = vec3(
        sin(uTime.mul(0.7).add(seed.z.mul(TAU))).mul(4.0),
        sin(uTime.mul(0.9).add(seed.w.mul(TAU))).mul(2.5),
        cos(uTime.mul(0.6).add(seed.x.mul(TAU))).mul(4.0),
    );
    const y = mix(float(MOTE_BOX.y0), float(MOTE_BOX.y1), pow(seed.z, 1.6));
    const center = vec3(xz.x, y, xz.y).add(swirl);
    const vp = cameraViewMatrix.mul(vec4(center, 1.0));
    const depth = max(vp.z.negate(), 1.0);
    const px = mix(float(1.4), float(2.8), seed.w.mul(seed.w));
    const size = max(px.mul(depth).div(uPxScale), float(0.25));
    // Edge fades so the wrap never pops.
    const fx = abs(fract(base.add(drift).div(box).add(0.5)).sub(0.5)).mul(2.0);
    const edge = float(1.0).sub(smoothstep(0.8, 1.0, max(fx.x, fx.y)));
    const corner = vp.xy.add(positionGeometry.xy.mul(size).mul(2.0));
    material.vertexNode = cameraProjectionMatrix.mul(vec4(corner, vp.z, 1.0));

    material.colorNode = Fn(() => {
        const st = uv().sub(0.5);
        const r = length(st).mul(2.0);
        const vC = vertexStage(center);
        const vSeed = vertexStage(seed);
        const vEdge = vertexStage(edge);
        const vdir = normalize(vC.sub(cameraPosition));
        const glint = pow(clamp(dot(vdir, uSunA), 0.0, 1.0), 10.0).mul(5.0);
        const tw = sin(uTime.mul(vSeed.w.mul(5.0).add(2.0)).add(vSeed.x.mul(TAU))).mul(0.5).add(0.5);
        const core = exp(r.mul(r).mul(-6.0));
        const blue = smoothstep(0.82, 1.0, vSeed.y).mul(uDusk.mul(0.6).add(uSpiceGlow.mul(0.25)));
        const hue = mix(vec3(1.0, 0.52, 0.16), vec3(0.35, 0.62, 1.0), clamp(blue, 0.0, 1.0));
        const intensity = float(0.16).add(glint).mul(tw.mul(0.7).add(0.3)).mul(float(1.0).add(uSpiceGlow.mul(1.6)))
            .mul(vEdge);
        return vec4(hue.mul(core).mul(intensity), 0.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'shifting-sands-spice-motes';
    mesh.frustumCulled = false;
    mesh.renderOrder = 31;
    return {
        mesh,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Spindrift: sand streaming off the crests
// ─────────────────────────────────────────────────────────────────────────────

/** Find crest points on the dune field inside the visible wedge. */
export function findCrestPoints(field, count, seed = 5150) {
    const rand = mulberry32(seed);
    const out = [];
    const s = field.scratch;
    const { wx } = field;
    const { wz } = field;
    let guard = 0;
    while (out.length < count && guard < count * 40) {
        guard++;
        const az = ((rand() * 2 - 1) * 48 * Math.PI) / 180;
        if (Math.abs(az) < (6 * Math.PI) / 180) continue; // behind the card: no fill for nothing
        const d = 140 + rand() ** 1.4 * 1700;
        let x = Math.sin(az) * d;
        let z = -Math.cos(az) * d;
        // Walk downwind/upwind to the nearest crest (two Newton steps on the phase).
        for (let it = 0; it < 3; it++) {
            field.sample(x, z, s);
            const p = s.u - Math.floor(s.u);
            let dp = DUNE.crest - p;
            if (dp > 0.5) dp -= 1;
            if (dp < -0.5) dp += 1;
            x += wx * dp * DUNE.lambda;
            z += wz * dp * DUNE.lambda;
        }
        field.sample(x, z, s);
        if (s.amp < 16) continue;
        out.push({
            x, y: s.h, z, amp: s.amp,
        });
    }
    return out;
}

export function createSpindrift(shared, field, count) {
    const pts = findCrestPoints(field, Math.max(0, count | 0));
    const n = pts.length;
    const posData = new Float32Array(Math.max(1, n) * 4);
    pts.forEach((p, i) => {
        posData[i * 4] = p.x;
        posData[i * 4 + 1] = p.y;
        posData[i * 4 + 2] = p.z;
        posData[i * 4 + 3] = p.amp;
    });
    const geometry = quadGeometry(n, 6161, {
        aCrest: new THREE.InstancedBufferAttribute(posData, 4),
    });
    const material = fxMaterial('shifting-sands-spindrift');
    const {
        uTime, uWind, uGust, uWindDir, noiseTex, atmosphere,
    } = shared;
    const seed = attribute('aSeed', 'vec4');
    const crest = attribute('aCrest', 'vec4');

    const W = normalize(vec3(uWindDir.x, -0.08, uWindDir.y));
    const C = crest.xyz.add(vec3(0.0, 0.6, 0.0));
    const len = seed.x.mul(70.0).add(40.0).mul(crest.w.div(30.0).add(0.4));
    const hgt = seed.y.mul(7.0).add(4.0).mul(crest.w.div(30.0).add(0.5));
    const toCam = normalize(cameraPosition.sub(C));
    // Axial billboard: long axis along the wind, the sheet turned to face the camera.
    const side = normalize(cross(W, toCam));
    const sideUp = side.mul(select(side.y.lessThan(0.0), float(-1.0), float(1.0)));
    const q = positionGeometry.xy.add(vec2(0.5, 0.5)); // x: 0 root → 1 tip, y: 0 → 1
    // The veil lifts off the brink and droops downwind.
    const tipDrop = q.x.mul(q.x).mul(len.mul(0.1));
    const worldPos = C.add(W.mul(q.x.mul(len))).add(sideUp.mul(q.y.sub(0.25).mul(hgt))).sub(vec3(0.0, tipDrop, 0.0));
    material.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(worldPos, 1.0)));

    material.colorNode = Fn(() => {
        const st = uv();
        const vSeed = vertexStage(seed);
        const vP = vertexStage(worldPos);
        const vLen = vertexStage(len);
        const flow = uTime.mul(uWind.mul(1.2).add(0.4).add(uGust.mul(2.0)));
        const n1 = ssTexNoise(noiseTex, vec2(
            st.x.mul(vLen.mul(0.06)).sub(flow.mul(1.6)),
            st.y.mul(5.0).add(vSeed.z.mul(50.0)),
        ));
        const n2 = ssTexNoise(noiseTex, vec2(
            st.x.mul(vLen.mul(0.15)).sub(flow.mul(3.1)),
            st.y.mul(11.0).add(vSeed.w.mul(30.0)),
        ));
        const streaks = smoothstep(0.42, 0.85, n1.x.mul(0.6).add(n2.y.mul(0.4)));
        const root = smoothstep(0.0, 0.12, st.x).mul(float(1.0).sub(smoothstep(0.45, 1.0, st.x)));
        const vert = float(1.0).sub(smoothstep(0.0, 1.0, st.y)).mul(smoothstep(0.0, 0.08, st.y).mul(0.5).add(0.5));
        const gust = sin(uTime.mul(0.37).add(vSeed.x.mul(TAU))).mul(0.5).add(0.5);
        const strength = clamp(uWind.mul(0.7).add(uGust.mul(1.2)).mul(gust.mul(0.6).add(0.4)), 0.0, 1.3);
        const a = clamp(streaks.mul(root).mul(vert).mul(strength.add(0.25)).mul(0.9), 0.0, 1.0);
        const col = atmosphere.applyAerial(dustRadiance(shared, vec3(0.78, 0.48, 0.25), vP, 1.25), vP, 0.9);
        return vec4(col.mul(a), a);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'shifting-sands-spindrift';
    mesh.frustumCulled = false;
    mesh.renderOrder = 29;
    return {
        mesh,
        count: n,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Spice blows (line clears)
// ─────────────────────────────────────────────────────────────────────────────

export function createSpiceBlows(shared, perSlot) {
    const n = Math.max(1, (perSlot | 0) * BLOW_SLOTS);
    const geometry = quadGeometry(n, 3131);
    const material = fxMaterial('shifting-sands-spice-blows');
    const {
        uTime, uWindDir, atmosphere, noiseTex,
    } = shared;
    const uBlows = uniformArray(Array.from({ length: BLOW_SLOTS }, () => new THREE.Vector4(0, -1000, 0, -100)), 'vec4');
    const uBlowPow = uniformArray(Array.from({ length: BLOW_SLOTS }, () => new THREE.Vector4(0, 0, 0, 0)), 'vec4');
    const seed = attribute('aSeed', 'vec4');

    // Slot from the seed (uniform pick; stable per instance).
    const slot = floor(seed.w.mul(BLOW_SLOTS));
    const S0 = uBlows.element(slot.toInt());
    const S1 = uBlowPow.element(slot.toInt());
    const origin = S0.xyz;
    const age = uTime.sub(S0.w);
    const strength = S1.x;
    const life = seed.y.mul(2.6).add(3.2);
    const live = step(0.0, age).mul(step(age, life)).mul(step(0.01, strength));
    // Geyser: a fast column with a crown of falling spice, drag-damped.
    const ang = seed.x.mul(TAU);
    const spread = pow(seed.z, 1.6);
    const lateral = spread.mul(60.0).add(5.0);
    const lift = seed.y.mul(150.0).add(80.0).mul(float(1.0).sub(spread.mul(0.6)));
    const v0 = vec3(cos(ang).mul(lateral), lift, sin(ang).mul(lateral))
        .mul(strength.mul(0.35).add(0.65));
    const kd = float(0.9);
    const e = float(1.0).sub(exp(age.mul(kd).negate())).div(kd);
    const gk = float(30.0).div(kd);
    const W = vec3(uWindDir.x, 0.0, uWindDir.y);
    const ballistic = vec3(v0.x.mul(e), v0.y.add(gk).mul(e).sub(gk.mul(age)), v0.z.mul(e));
    const pos = origin.add(ballistic).add(W.mul(age.mul(age).mul(3.0)));
    const center = vec3(pos.x, max(pos.y, origin.y.add(1.0)), pos.z);
    const size = float(5.0).add(age.mul(14.0)).mul(seed.z.mul(0.8).add(0.6)).mul(live);
    material.vertexNode = billboardClip(center, positionGeometry.xy.mul(size));

    material.colorNode = Fn(() => {
        const st = uv().sub(0.5);
        const r = length(st).mul(2.0);
        const vAge = vertexStage(age);
        const vLife = vertexStage(life);
        const vC = vertexStage(center);
        const vSeed = vertexStage(seed);
        const nz = ssTexNoise(noiseTex, st.mul(2.5).add(vSeed.xy.mul(41.0)));
        const shape = float(1.0).sub(smoothstep(0.15, 1.0, r)).mul(nz.x.mul(0.9).add(0.3));
        const fade = smoothstep(0.0, 0.08, vAge).mul(float(1.0).sub(smoothstep(vLife.mul(0.4), vLife, vAge)));
        const a = clamp(shape.mul(fade).mul(0.3), 0.0, 1.0);
        const dust = atmosphere.applyAerial(dustRadiance(shared, vec3(0.7, 0.4, 0.2), vC, 1.0), vC, 0.7);
        // Hot melange glow in the first moments, cooling to ember.
        const heat = exp(vAge.mul(-2.6)).mul(1.1);
        const glow = mix(vec3(1.0, 0.42, 0.1), vec3(1.0, 0.7, 0.35), exp(vAge.mul(-4.0)))
            .mul(heat).mul(shape.mul(fade));
        return vec4(dust.mul(a).add(glow.mul(0.6)), a);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'shifting-sands-spice-blows';
    mesh.frustumCulled = false;
    mesh.renderOrder = 32;
    return {
        mesh,
        /** Dormant while no slot is live: one degenerate instance keeps the pipeline compiled. */
        setActive(active) {
            geometry.instanceCount = active ? n : 1;
        },
        uBlows,
        uBlowPow,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
