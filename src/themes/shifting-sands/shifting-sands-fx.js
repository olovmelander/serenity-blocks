/**
 * Shifting Sands — sand, spice and dust. Four instanced systems, one draw each, all closed-form
 * in the world clock (no compute, no per-frame uploads, nothing created at event time):
 *
 *  - Worm sand: curtains of sand pouring off the breaching body (each grain is born on the body
 *    at its own spawn time and falls ballistically, so the cascade trails the moving arch); the
 *    crown of sand thrown up where the maw erupts and where it strikes; the low wall of dust that
 *    races out from both; the dust boiling round the body; and the column the hole breathes out
 *    as it falls in behind the tail. Every grain reads its age off the worm's path clock, so the
 *    sand outlives the body and thins away on its own — nothing is switched off.
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
    sqrt,
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
import { WORM_SLOTS } from './shifting-sands-worm.js';

const TAU = Math.PI * 2;

/** Per-tier instance budgets (wormSand: per worm; a worm that is under the sand draws none). */
export const FX_TIERS = Object.freeze({
    Minimal: {
        wormSand: 0, motes: 300, spindrift: 0, blowPerSlot: 60,
    },
    Low: {
        wormSand: 520, motes: 600, spindrift: 24, blowPerSlot: 110,
    },
    Medium: {
        wormSand: 960, motes: 1000, spindrift: 48, blowPerSlot: 160,
    },
    High: {
        wormSand: 1500, motes: 1500, spindrift: 72, blowPerSlot: 220,
    },
    Ultra: {
        wormSand: 2000, motes: 2200, spindrift: 96, blowPerSlot: 280,
    },
    Extreme: {
        wormSand: 2600, motes: 3000, spindrift: 120, blowPerSlot: 340,
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

/**
 * Dust lit by the twin suns: violet sky fill + forward scattering (backlit grains glow).
 * `diffuse` is the share of sunlight a thick cloud scatters back whatever the angle: without it
 * dust only shows against the suns.
 */
function dustRadiance(shared, albedo, worldPos, forward = 1.0, diffuse = 0.0) {
    const {
        uSunA, uSunB, uSunLightA, uSunLightB, uUpper, uZenith,
    } = shared;
    const vdir = normalize(worldPos.sub(cameraPosition));
    const pA = ssPhaseHG(dot(vdir, uSunA), float(0.62)).mul(forward).add(float(0.07).add(diffuse));
    const pB = ssPhaseHG(dot(vdir, uSunB), float(0.66)).mul(forward).add(float(0.05).add(float(diffuse).mul(0.6)));
    const fill = uUpper.mul(0.55).add(uZenith.mul(0.4));
    return albedo.mul(uSunLightA.mul(pA).add(uSunLightB.mul(pB)).add(fill));
}

// ─────────────────────────────────────────────────────────────────────────────
// Worm sand: everything the body throws, drags and leaves hanging
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Share of one worm's pool per kind of grain, in kind order:
 *   0 cascade — sand pouring off the body in the air (streaks, looping)
 *   1 spray   — sand flung from a foot of the arch while the body runs through it (streaks, looping)
 *   2 burst   — the crown thrown up when the maw pierces a foot: the eruption, the strike (streaks)
 *   3 churn   — dust boiling round a foot while the body fills it (billows, looping)
 *   4 surge   — a low wall of dust racing out along the sand from the eruption / the strike (billows)
 *   5 slump   — the hole falling in behind the tail and breathing out a column of dust (billows)
 * A foot is where the body pierces the sand: 0 where the worm comes up, 1 where it goes down.
 */
const SAND_SHARES = Object.freeze([0.34, 0.16, 0.24, 0.11, 0.08, 0.07]);

/**
 * @param {object} shared world uniforms + atmosphere
 * @param {object} worm   createWorm() result (its per-slot path uniforms drive the sand)
 * @param {number} perWorm instances per worm slot
 */
export function createWormSand(shared, worm, perWorm) {
    const per = Math.max(0, perWorm | 0);
    const n = per * WORM_SLOTS;
    const rand = mulberry32(2718);
    const tags = new Float32Array(Math.max(1, n) * 4); // kind, foot, worm slot
    const seeds2 = new Float32Array(Math.max(1, n) * 4);
    for (let i = 0; i < n; i++) {
        const f = ((i % per) + 0.5) / per;
        let kind = SAND_SHARES.length - 1;
        let acc = 0;
        for (let k = 0; k < SAND_SHARES.length; k++) {
            acc += SAND_SHARES[k];
            if (f < acc) {
                kind = k;
                break;
            }
        }
        tags[i * 4] = kind;
        tags[i * 4 + 1] = rand() < 0.5 ? 0 : 1;
        tags[i * 4 + 2] = Math.floor(i / per);
    }
    for (let i = 0; i < seeds2.length; i++) seeds2[i] = rand();
    const geometry = quadGeometry(n, 4242, {
        aSand: new THREE.InstancedBufferAttribute(tags, 4),
        aSeed2: new THREE.InstancedBufferAttribute(seeds2, 4),
    });
    const material = fxMaterial('shifting-sands-worm-sand');
    const {
        uTime, atmosphere, noiseTex, uWindDir, uPxScale,
    } = shared;
    const {
        uB0, uB1, uB2, uB3, uB4,
    } = worm.uniforms;
    const FEET = WORM_SLOTS * 2;
    // Where each worm pierces the sand: the point (xyz) and the slope of the sand there (xz).
    const uFeet = uniformArray(Array.from({ length: FEET }, () => new THREE.Vector4(0, 0, 0, 0)), 'vec4');
    const uFeetSlope = uniformArray(Array.from({ length: FEET }, () => new THREE.Vector4(0, 0, 0, 0)), 'vec4');

    const seed = attribute('aSeed', 'vec4');
    const seed2 = attribute('aSeed2', 'vec4');
    const tag = attribute('aSand', 'vec4');
    const kind = tag.x;
    const site = tag.y;
    const slot = tag.z.toInt();
    const isKind = (k) => float(1.0).sub(step(0.5, abs(kind.sub(k))));
    const isCascade = isKind(0);
    const isBurst = isKind(2);
    const isChurn = isKind(3);
    const isSurge = isKind(4);
    const isSlump = isKind(5);
    const isEjecta = isKind(1).add(isBurst);
    const isDust = step(2.5, kind);

    const B0 = uB0.element(slot);
    const B1 = uB1.element(slot);
    const B2 = uB2.element(slot);
    const B3 = uB3.element(slot);
    const B4 = uB4.element(slot);
    const footIndex = tag.z.mul(2.0).add(site).toInt();
    const foot = uFeet.element(footIndex).xyz;
    const slope = uFeetSlope.element(footIndex).xy;
    const footUp = uFeet.element(tag.z.mul(2.0).toInt()).xyz;
    const footDown = uFeet.element(tag.z.mul(2.0).add(1.0).toInt()).xyz;

    const O = B0.xyz;
    const phiHead = B0.w;
    const D = vec3(B1.x, 0.0, B1.y);
    const Y = vec3(0.0, 1.0, 0.0);
    const W = vec3(uWindDir.x, 0.0, uWindDir.y);
    const a = B1.z;
    const b = B1.w;
    const k = B2.x;
    const R = B2.y;
    const span = B2.z;
    const omega = B3.x;
    const phiUp = B3.y;
    const phiDown = B3.w;
    const pathAt = (phi) => O.add(D.mul(a.mul(sin(phi)))).add(Y.mul(b.mul(cos(phi)).sub(k)));
    const tangentAt = (phi) => normalize(D.mul(a.mul(cos(phi))).sub(Y.mul(b.mul(sin(phi)))));
    const g = float(26.0);
    // Speeds grow with √size, so a giant's sand hangs longer and reads as heavier.
    const sv = sqrt(max(R, 1.0).div(30.0));

    // ── Clocks (s), all read off the path clock φ_head: nothing here knows about "now" ──
    const tHead = phiHead.sub(mix(phiUp, phiDown, site)).div(omega); // since the maw pierced this foot
    const tTail = tHead.sub(span.div(omega)); // since the tail left it
    const loopAge = (life) => fract(uTime.div(life).add(seed.z)).mul(life);
    /** 1 if a looping grain was born while the body filled its foot. */
    const bornFilled = (age) => step(0.0, tHead.sub(age)).mul(step(tTail.sub(age), 0.0));
    const shotLive = (age, life) => step(0.0, age).mul(step(age, life));
    const settle = (age, rate) => float(1.0).sub(exp(max(age, 0.0).mul(rate).negate())).div(rate);

    // ── 0 · Cascade: born on the back of the body at its own spawn time, falls and drifts ──
    const lifeC = seed.y.mul(1.8).add(2.4);
    const ageC = loopAge(lifeC);
    const sigma = seed.w.mul(0.86);
    const phiS = phiHead.sub(ageC.mul(omega)).sub(sigma.mul(span));
    const Tc = tangentAt(phiS);
    const Pn = normalize(cross(D, Y));
    const Bn = cross(Pn, Tc); // the outside of the arch
    const topDir = normalize(Bn.add(Pn.mul(seed2.x.sub(0.5).mul(2.4))));
    const taperC = mix(float(1.0), float(0.3), smoothstep(0.32, 1.0, sigma));
    const v0C = Tc.mul(B3.z.mul(0.24)).add(topDir.mul(seed2.y.mul(7.0).add(3.0)));
    const bornC = pathAt(phiS).add(topDir.mul(R.mul(taperC)));
    const posC = bornC.add(v0C.mul(ageC)).sub(Y.mul(ageC.mul(ageC).mul(g.mul(0.5))))
        .add(W.mul(ageC.mul(seed.x.mul(8.0).add(4.0))));
    const velC = v0C.sub(Y.mul(ageC.mul(g)));
    const aboveC = smoothstep(0.0, 0.07, phiS.sub(phiUp)).mul(smoothstep(0.0, 0.07, phiDown.sub(phiS)));
    // The body sheds most of its load just after it has risen.
    const carried = mix(float(1.0), float(0.3), smoothstep(0.0, 1.9, phiS.sub(phiUp)));
    const runC = clamp(dot(posC.sub(footUp), D).div(max(dot(footDown.sub(footUp), D), 1.0)), 0.0, 1.0);
    const groundC = mix(footUp.y, footDown.y, runC);
    const aliveC = aboveC.mul(carried).mul(smoothstep(groundC.sub(3.0), groundC.add(6.0), posC.y));
    const fadeC = smoothstep(0.0, 0.3, ageC).mul(float(1.0).sub(smoothstep(lifeC.mul(0.6), lifeC, ageC)));
    // Fine grains with a few clods among them (the cube keeps the clods rare).
    const clod = seed2.w.mul(seed2.w).mul(seed2.w);
    const sizeC = R.mul(clod.mul(0.1).add(0.04)).add(ageC.mul(0.5));

    // ── 1 · Spray, 2 · Burst: ballistic sand from a foot (a crown: the wide grains fly low) ──
    const lifeE = mix(seed.y.mul(1.8).add(2.4), seed.y.mul(2.6).add(3.4), isBurst);
    const ageLoopE = loopAge(lifeE);
    const ageShotE = tHead.sub(seed.w.mul(seed.w).mul(1.25)); // the eruption tails off over ~1 s
    const ageE = max(mix(ageLoopE, ageShotE, isBurst), 0.0);
    const liveE = mix(bornFilled(ageLoopE), shotLive(ageShotE, lifeE), isBurst);
    const ang = seed2.x.mul(TAU);
    const radial = vec3(cos(ang), 0.0, sin(ang));
    // The strike carries the worm's own momentum: its sand is thrown on ahead of the dive.
    const fwd = D.mul(mix(float(0.25), float(0.9), site));
    const v0E = radial.mul(seed2.y.mul(44.0).add(12.0))
        .add(Y.mul(seed2.z.mul(50.0).add(30.0).mul(float(1.0).sub(seed2.y.mul(0.45)))))
        .add(fwd.mul(seed2.w.mul(26.0).add(6.0)))
        .mul(mix(float(0.55), float(1.0), isBurst).mul(sv));
    const posE = foot.add(radial.mul(R.mul(seed2.w.mul(0.5).add(0.8)))).add(Y.mul(R.mul(0.15)))
        .add(v0E.mul(ageE)).sub(Y.mul(ageE.mul(ageE).mul(g.mul(0.5))))
        .add(W.mul(ageE.mul(seed.x.mul(5.0).add(3.0))));
    const velE = v0E.sub(Y.mul(ageE.mul(g)));
    const groundE = foot.y.add(dot(posE.xz.sub(foot.xz), slope));
    const aliveE = liveE.mul(smoothstep(groundE.sub(2.0), groundE.add(5.0), posE.y));
    const fadeE = smoothstep(0.0, 0.12, ageE).mul(float(1.0).sub(smoothstep(lifeE.mul(0.6), lifeE, ageE)));
    const sizeE = R.mul(clod.mul(0.13).add(0.04)).add(ageE.mul(0.4));

    // ── 3 · Churn: dust boiling up around the foot while the body runs through it ──
    const lifeH = seed.y.mul(2.6).add(3.6);
    const ageH = loopAge(lifeH);
    const posH = foot
        .add(radial.mul(R.mul(seed2.y.mul(0.55).add(1.05)).add(ageH.mul(seed2.w.mul(7.0).add(4.0)).mul(sv))))
        .add(Y.mul(R.mul(0.25).add(settle(ageH, 0.8).mul(seed2.z.mul(13.0).add(9.0)).mul(sv))))
        .add(W.mul(ageH.mul(seed.x.mul(6.0).add(5.0))));
    const sizeH = R.mul(ageH.div(lifeH).mul(1.2).add(0.7));

    // ── 4 · Surge: when the maw pierces, a low wall of dust races out along the sand ──
    const lifeU = seed.y.mul(2.6).add(3.8);
    const rawU = tHead.sub(seed.w.mul(0.55));
    const ageU = max(rawU, 0.0);
    const sizeU = R.mul(settle(ageU, 0.7).mul(1.33).add(0.55));
    const flatU = foot.add(normalize(radial.add(fwd.mul(0.6))).mul(R.mul(0.9).add(settle(ageU, 0.85)
        .mul(seed2.y.mul(44.0).add(52.0)).mul(sv)))).add(W.mul(ageU.mul(seed.x.mul(4.0).add(3.0))));
    const groundU = foot.y.add(dot(flatU.xz.sub(foot.xz), slope));
    const posU = vec3(
        flatU.x,
        groundU.add(sizeU.mul(0.28)).add(ageU.mul(seed2.z.mul(5.0).add(2.0)).mul(sv)),
        flatU.z,
    );

    // ── 5 · Slump: the hole falls in behind the tail and breathes out a slow column of dust ──
    const lifeL = seed.y.mul(3.0).add(4.4);
    const rawL = tTail.sub(seed.w.mul(1.1).sub(0.4));
    const ageL = max(rawL, 0.0);
    const posL = foot.add(radial.mul(R.mul(1.25).mul(sqrt(seed2.y)).add(ageL.mul(seed2.y.mul(6.0).add(2.0)))))
        .add(Y.mul(R.mul(0.2).add(settle(ageL, 0.6).mul(seed2.z.mul(seed2.z).mul(26.0).add(5.0)).mul(sv))))
        .add(W.mul(ageL.mul(seed.x.mul(9.0).add(5.0))));
    // The dive's is the larger: a whole worm has just gone down it.
    const sizeL = R.mul(settle(ageL, 0.5).mul(0.85).add(0.8)).mul(mix(float(0.85), float(1.15), site));

    // ── One grain out of the six ──
    const pick = (c, e, h, u, l) => {
        const grains = c.mul(isCascade).add(e.mul(isEjecta));
        return grains.add(h.mul(isChurn)).add(u.mul(isSurge)).add(l.mul(isSlump));
    };
    const center = pick(posC, posE, posH, posU, posL);
    // Grains never fall below a pixel and a half: far sand thins instead of flickering.
    const eyeDepth = max(cameraViewMatrix.mul(vec4(center, 1.0)).z.negate(), 1.0);
    const sizeFloor = eyeDepth.div(uPxScale).mul(1.5).mul(float(1.0).sub(isDust));
    const size = max(pick(sizeC, sizeE, sizeH, sizeU, sizeL), sizeFloor);
    const life = pick(lifeC, lifeE, lifeH, lifeU, lifeL);
    const age = pick(ageC, ageE, ageH, ageU, ageL);
    const fadeDust = smoothstep(float(0.0), life.mul(0.12), age)
        .mul(float(1.0).sub(smoothstep(life.mul(0.42), life, age)));
    const alpha = pick(
        aliveC.mul(fadeC).mul(0.5),
        aliveE.mul(fadeE).mul(0.58),
        bornFilled(ageH).mul(fadeDust).mul(0.42),
        shotLive(rawU, lifeU).mul(fadeDust).mul(0.5),
        shotLive(rawL, lifeL).mul(fadeDust).mul(0.32),
    ).mul(step(0.5, R)).mul(B4.y);
    const age01 = age.div(life);
    // Height of a billow's centre above the sand, in billow sizes (the fragment seats it there).
    const lift = center.y.sub(foot.y.add(dot(center.xz.sub(foot.xz), slope))).div(max(size, 1e-3));

    // Streak the grains along their flight; billows face the camera.
    const vel = velC.mul(isCascade).add(velE.mul(isEjecta));
    const dir2 = normalize(cameraViewMatrix.mul(vec4(vel, 0.0)).xy.add(vec2(1e-4, 0.0)));
    const q = positionGeometry.xy;
    const stretch = mix(float(2.2), float(7.0), clamp(length(vel).div(70.0), 0.0, 1.0));
    const streak = dir2.mul(q.x.mul(stretch)).add(vec2(dir2.y.negate(), dir2.x).mul(q.y));
    material.vertexNode = billboardClip(center, mix(streak, q, isDust).mul(size).mul(step(0.001, alpha)));

    material.colorNode = Fn(() => {
        const st = uv().sub(0.5);
        const vA = vertexStage(alpha);
        const vDust = vertexStage(isDust);
        const vC = vertexStage(center);
        const vSeed = vertexStage(seed);
        const vAge = vertexStage(age01);
        const vLift = vertexStage(lift);
        const r = length(st).mul(2.0);
        const nz = ssTexNoise(noiseTex, st.mul(3.8).add(vSeed.xy.mul(37.0)).add(vec2(0.0, vAge.mul(-0.9))));
        // A billow is lumpy at the rim, thins and tears as it ages, and thins out toward the sand
        // it stands on (zero at the surface, so the dunes never cut it along a line).
        const body = float(1.0).sub(smoothstep(0.1, 1.0, r.mul(nz.z.mul(0.5).add(0.78))));
        const tear = mix(float(-0.15), float(0.5), vAge);
        const dens = body.mul(smoothstep(tear, tear.add(0.55), nz.x.mul(0.7).add(body.mul(0.5))));
        const seat = smoothstep(0.0, 0.45, vLift.add(st.y));
        const grain = float(1.0).sub(smoothstep(0.1, 1.0, r));
        const shape = mix(grain, dens.mul(seat), vDust);
        // Airborne sand is paler than the erg: the fines are what hang in the light.
        const albedo = mix(vec3(0.6, 0.42, 0.27), vec3(0.56, 0.45, 0.36), vDust);
        // Thin dust lets the suns through: the fringes of a billow burn brighter than its heart.
        const lit = dustRadiance(
            shared,
            albedo,
            vC,
            mix(float(1.0), float(0.6), vDust),
            mix(float(0.26), float(0.17), vDust),
        ).mul(mix(float(1.0), mix(float(1.3), float(0.8), dens).mul(st.y.mul(0.3).add(1.0)), vDust));
        const col = atmosphere.applyAerial(lit, vC, 0.6);
        const a2 = clamp(shape.mul(vA), 0.0, 1.0);
        return vec4(col.mul(a2), a2);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'shifting-sands-worm-sand';
    mesh.frustumCulled = false;
    mesh.renderOrder = 30;
    return {
        mesh,
        uFeet,
        uFeetSlope,
        /**
         * Push the director's slots (pure writes). Dormant while no worm is throwing sand: one
         * degenerate instance keeps the pipeline compiled.
         */
        apply(slots) {
            let live = false;
            for (let i = 0; i < WORM_SLOTS; i++) {
                const st = slots[i];
                const br = st.breach;
                if (!br || !st.fx) continue;
                live = true;
                uFeet.array[i * 2].set(br.up.x, br.up.y, br.up.z, 0);
                uFeet.array[i * 2 + 1].set(br.down.x, br.down.y, br.down.z, 0);
                uFeetSlope.array[i * 2].set(br.up.gx, br.up.gz, 0, 0);
                uFeetSlope.array[i * 2 + 1].set(br.down.gx, br.down.gz, 0, 0);
            }
            geometry.instanceCount = live ? n : Math.min(1, n);
            return live;
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
