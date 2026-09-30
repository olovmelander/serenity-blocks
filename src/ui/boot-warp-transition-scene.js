/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Boot Warp Transition — shared scene builder.
 *
 * Single source of truth for the game-ident -> intro reveal. Renderer-agnostic: it builds a
 * stage quad, a GPU compute point-cloud and a TSL compute node and exposes uniform setters;
 * the CALLER owns the WebGPURenderer and dispatches `renderer.compute`.
 *
 * Consumed by:
 *   - src/playground/effects/logo-warp-transition.effect.js  (iteration harness)
 *   - src/ui/boot-warp-transition.js                         (the boot renderer)
 *
 * The shot, by progress p:
 *   0.00–0.05  MATCH FRAME — the stage quad reproduces the CSS studio ident (shell gradients,
 *              vignette, letterbox bars, glow, the four conic facets, core diamond, highlights
 *              and cross lines) in sRGB, then applies the INVERSE of the renderer's ACES curve,
 *              so after tone mapping the pixels equal the CSS ones. The DOM mark can therefore
 *              disappear on the handoff frame with no visible seam.
 *   0.05–0.17  IGNITION — a flare peaks at p≈0.087 (on warp.ogg's peak: the sound starts at the
 *              reveal, p≈0.02), the solid gem shatters and the particles are born on its facets.
 *   0.17–0.33  CREEP → JUMP — the bars retract, the room falls away, then the flight kicks
 *              (trapezoid velocity profile) with an FOV push and a vanishing-point glow.
 *   0.33–0.60  CRUISE — long trailing streaks with bright heads.
 *   0.60–0.70  DROP-OUT — hard deceleration with a second, smaller flash.
 *   0.66–1.00  ARRIVAL — the streaks relax into a soft star field over a faint haze that the
 *              live intro nebula and title resolve out of.
 *
 * Everything is a PURE FUNCTION of `progress` (0..1) + per-particle seeds, so `?t=` stills
 * are reproducible.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    atan,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    exp,
    float,
    fract,
    instanceIndex,
    length,
    mat3,
    max,
    mix,
    positionLocal,
    pow,
    sin,
    smoothstep,
    sqrt,
    step,
    storage,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { curlNoise3, rotate2 } from '../themes/starlight/materials/tsl-noise-lib.js';

// The intro's exact particle palette (GALAXY_COLORS, intro-particle-compute.js:50-59)
// so the warp debris and the live intro particles are the same colours.
const GALAXY_COLORS = [
    [1.0, 0.2, 0.4], // magenta-pink #ff3366
    [0.0, 1.0, 1.0], // cyan #00ffff
    [1.0, 1.0, 0.0], // yellow #ffff00
    [1.0, 0.4, 0.0], // orange #ff6600
    [0.6, 0.2, 1.0], // purple #9933ff
    [0.0, 1.0, 0.4], // green #00ff66
    [1.0, 0.0, 0.6], // magenta #ff0099
    [0.2, 0.6, 1.0], // light blue #3399ff
];

// ── The CSS studio ident, mirrored (public/styles/main.css .startup-shell / .startup-logo*) ──
// Facets of `.startup-logo__mark`'s conic-gradient(from 45deg, ...), clockwise from the
// right-hand vertex. sRGB 0..1.
const FACET_SRGB = [
    [0xdf / 255, 0xf8 / 255, 0xff / 255], // #dff8ff — right
    [0x75 / 255, 0xc6 / 255, 0xee / 255], // #75c6ee — bottom
    [0x71 / 255, 0x86 / 255, 0xe8 / 255], // #7186e8 — left
    [0xa8 / 255, 0x78 / 255, 0xde / 255], // #a878de — top
];
const MARK_HALF_PX = 59; // 118px box, diamond clip
const CORE_HALF_PX = 18; // 36px core span
const BEFORE_HALF_PX = 57; // ::before inset 2px
const GLOW_OPACITY = 0.87; // mid-point of the hold's sb-glow-breathe (0.78..0.96)
const GLOW_SCALE = 1.04; //  mid-point of its scale (1..1.08)
const LETTERBOX_VH = 0.055;
const GRAIN_WEIGHT = 0.0275;
// Default mark centre relative to the viewport centre when the DOM mark cannot be measured
// (playground): the logo group centres mark (150) + gap (30) + name (~32), so the mark sits
// (30 + 32) / 2 px above centre.
export const DEFAULT_MARK_OFFSET_Y_PX = -31;

const ARRIVAL_MIST = [0.42, 0.68, 0.98];

const DIAMOND_SIZE = 0.52; // fallback world half-extent when no viewport height is given
const Z_FAR = -34.0; // tunnel far plane
const Z_NEAR = 5.3; // tunnel near plane (camera at z=7)
const CAM_Z = 7;
const BASE_FOV = 45;
const TAN_HALF_FOV = Math.tan((BASE_FOV / 2) * (Math.PI / 180));
const BASE_NDC = 0.0052; // particle half-size in aspect-corrected screen units
const TRAIL_MAX_NDC = 0.2;
const TONE_EXPOSURE = 0.9; // the boot renderer's toneMappingExposure (ACES)

// The warp OPENS as a match-cut of the CSS studio-ident mark, so the home diamond must project
// to that mark's on-screen size. gemHalf is derived per-resolution from this.
const GEM_TARGET_PX = 118;

// ── Progress timeline (see header) ──
// The reveal is at p≈0.02 (BOOT_WARP_REVEAL_PROGRESS) and warp.ogg starts there with its peak
// 0.4 s later, i.e. p≈0.02 + 0.4/6.5 ≈ 0.08: the flare peaks on that beat.
const T_FLARE_IN = 0.045;
const T_FLARE_PEAK_A = 0.08;
const T_FLARE_PEAK_B = 0.094;
const T_FLARE_OUT = 0.17;
const T_BIRTH_A = 0.058;
const T_BIRTH_B = 0.098;
const T_GEM_GONE_A = 0.068;
const T_GEM_GONE_B = 0.12;
// Trapezoid velocity profile for the flight: accelerate over [A0,A1], cruise, decelerate over [D0,D1].
const T_JUMP_A0 = 0.24;
const T_JUMP_A1 = 0.33;
const T_DROP_D0 = 0.6;
const T_DROP_D1 = 0.69;

/** Camera FOV over the shot: a push on the jump, a slight pull on the drop-out. Pure in p. */
export function warpFovAt(p) {
    const ss = (a, b, x) => {
        const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
        return t * t * (3 - 2 * t);
    };
    const jump = ss(0.23, 0.3, p) * (1 - ss(0.34, 0.52, p));
    const drop = ss(0.6, 0.655, p) * (1 - ss(0.68, 0.8, p));
    return BASE_FOV + 9 * jump - 3.5 * drop;
}

// Uniform sample inside |x| + |y| <= 1. The transformed-square construction keeps
// point density even across all four facets. Returning the polar angle lets each
// shard preserve its direction as the diamond opens into the tunnel.
function sampleGem(rng) {
    const u = rng();
    const v = rng();
    const x = u + v - 1;
    const y = u - v;
    const angle01 = (Math.atan2(y, x) + Math.PI) / (Math.PI * 2);
    return [x, y, angle01];
}

function invert3(m) {
    const [[a, b, c], [d, e, f], [g, h, i]] = m;
    const A = e * i - f * h;
    const B = -(d * i - f * g);
    const C = d * h - e * g;
    const det = a * A + b * B + c * C;
    return [
        [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
        [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
        [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
    ];
}

// three r185 ToneMappingFunctions.js acesFilmicToneMapping. A 9-scalar TSL mat3() is
// ROW-major (verified on the GPU: mat3(1..9) * (1,0,0) = (1,4,7)), so these rows are the
// matrices exactly as written there.
const ACES_IN = [[0.59719, 0.35458, 0.04823], [0.07600, 0.90834, 0.01566], [0.02840, 0.13383, 0.83777]];
const ACES_OUT = [[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]];
const ACES_IN_INV = invert3(ACES_IN);
const ACES_OUT_INV = invert3(ACES_OUT);
const rowsMat3 = (m) => mat3(...m[0], ...m[1], ...m[2]);

/** Exact inverse of acesFilmicToneMapping(color, exposure) for display-referred targets. */
const inverseAces = Fn(([linearTarget, exposure]) => {
    // ACES_OUT's rows sum to 1, so display white needs b = 1 (< the fit's 1/0.983729 asymptote).
    const t = clamp(linearTarget, 0.0, 0.999);
    const b = clamp(rowsMat3(ACES_OUT_INV).mul(t), 0.0, 1.0);
    // RRTAndODTFit(a) = (a² + 0.0245786a − 0.000090537) / (0.983729a² + 0.432951a + 0.238081)
    // solved for a ≥ 0 (A < 0 on this domain, so this root is the positive one).
    const A = b.mul(0.983729).sub(1.0);
    const B = b.mul(0.432951).sub(0.0245786);
    const C = b.mul(0.238081).add(0.000090537);
    const disc = sqrt(max(B.mul(B).sub(A.mul(C).mul(4.0)), vec3(0.0)));
    const a = B.negate().sub(disc).div(A.mul(2.0));
    const pre = rowsMat3(ACES_IN_INV).mul(max(a, vec3(0.0)));
    return max(pre, vec3(0.0)).mul(0.6).div(exposure);
});

const srgbToLinear = Fn(([c]) => {
    const lo = c.div(12.92);
    const hi = pow(c.add(0.055).div(1.055), vec3(2.4));
    return mix(hi, lo, float(1.0).sub(step(vec3(0.04045), c)));
});

/**
 * @param {object} opts
 * @param {number} [opts.count]   particle count
 * @param {number} [opts.aspect]  initial viewport aspect (w/h)
 * @param {number} [opts.viewportWidth]  CSS px
 * @param {number} [opts.viewportHeight] CSS px
 * @param {boolean} [opts.compute] whether renderer.compute is available
 * @param {() => number} [opts.rng] deterministic RNG (defaults to Math.random)
 * @returns {{ mesh, computeNode, setProgress, setTime, setAspect, setViewProj, setViewport, setGemCenterPx, uniforms, dispose }}
 */
export function createWarpParticles(opts = {}) {
    const count = Math.max(1, Math.floor(opts.count || 60000));
    const aspect0 = opts.aspect || 1.777;
    const computeOk = opts.compute !== false;
    const rng = opts.rng || Math.random;

    // World half-extent that projects the home diamond to GEM_TARGET_PX on screen at cam
    // z=7, fov45 (NDC half = gemHalf/(7·tan22.5°); 1 NDC unit = viewportH/2 px).
    const viewportH = opts.viewportHeight || 1080;
    const viewportW = opts.viewportWidth || Math.round(viewportH * aspect0);
    const gemHalf = opts.viewportHeight
        ? (GEM_TARGET_PX * CAM_Z * TAN_HALF_FOV) / viewportH
        : DIAMOND_SIZE;

    // Storage buffers (4 × vec4 × count):
    //   home:  diamond xyz + polar angle(w)
    //   meta:  galaxy colour rgb + seedB(w)
    //   pos:   live xyz + energy(w)          ← written each compute
    //   vel:   streakDir.xy + streakLen + depth ← written each compute
    const homeData = new Float32Array(count * 4);
    const metaData = new Float32Array(count * 4);
    const posData = new Float32Array(count * 4);
    const velData = new Float32Array(count * 4);

    for (let i = 0; i < count; i += 1) {
        const i4 = i * 4;
        const [dx, dy, angle01] = sampleGem(rng);
        homeData[i4] = dx * gemHalf;
        homeData[i4 + 1] = dy * gemHalf;
        homeData[i4 + 2] = (rng() - 0.5) * 0.05;
        homeData[i4 + 3] = angle01;

        const g = GALAXY_COLORS[(Math.floor(rng() * GALAXY_COLORS.length)) % GALAXY_COLORS.length];
        metaData[i4] = g[0];
        metaData[i4 + 1] = g[1];
        metaData[i4 + 2] = g[2];
        metaData[i4 + 3] = rng(); // seedB

        posData[i4] = homeData[i4];
        posData[i4 + 1] = homeData[i4 + 1];
        posData[i4 + 2] = homeData[i4 + 2];
        posData[i4 + 3] = 0;
    }

    const homeBuffer = new THREE.StorageBufferAttribute(homeData, 4);
    const metaBuffer = new THREE.StorageBufferAttribute(metaData, 4);
    const posBuffer = new THREE.StorageBufferAttribute(posData, 4);
    const velBuffer = new THREE.StorageBufferAttribute(velData, 4);

    const uProgress = uniform(0);
    const uTime = uniform(0);
    const uAspect = uniform(aspect0);
    const uViewProj = uniform(new THREE.Matrix4());
    const uViewportPx = uniform(new THREE.Vector2(viewportW, viewportH));
    const uGemCenterPx = uniform(new THREE.Vector2(viewportW / 2, viewportH / 2 + DEFAULT_MARK_OFFSET_Y_PX));
    const uGemOffset = uniform(new THREE.Vector2(0, 0)); // world xy at z=0 of the mark centre
    // The home diamond is baked for the prewarm viewport height; a later resize rescales it so
    // it still projects to the DOM mark's fixed CSS size (setViewport).
    const uGemScale = uniform(1.0);

    const home = storage(homeBuffer, 'vec4', count);
    const meta = storage(metaBuffer, 'vec4', count);
    const positions = storage(posBuffer, 'vec4', count);
    const velocities = storage(velBuffer, 'vec4', count);

    // Shared progress envelopes (TSL, used by compute, particle and stage shaders).
    const flareEnv = (p) => smoothstep(T_FLARE_IN, T_FLARE_PEAK_A, p)
        .mul(smoothstep(T_FLARE_PEAK_B, T_FLARE_OUT, p).oneMinus());
    const cruiseEnv = (p) => smoothstep(T_JUMP_A0, T_JUMP_A1, p)
        .mul(smoothstep(T_DROP_D0, T_DROP_D1, p).oneMinus());
    const dropFlashEnv = (p) => smoothstep(0.615, 0.65, p).mul(smoothstep(0.658, 0.705, p).oneMinus());
    // Integral of a smoothstep ramp from a to b (∫ 3x²−2x³ = x³ − x⁴/2), continuing at slope 1.
    const rampIntegral = (p, a, b) => {
        const x = clamp(p.sub(a).div(b - a), 0.0, 1.0);
        const inner = x.mul(x).mul(x).sub(x.mul(x).mul(x).mul(x).mul(0.5));
        return inner.mul(b - a).add(max(p.sub(b), 0.0));
    };
    const flightMax = ((T_JUMP_A1 - T_JUMP_A0) * 0.5 + (1 - T_JUMP_A1))
        - ((T_DROP_D1 - T_DROP_D0) * 0.5 + (1 - T_DROP_D1));
    const flightAt = (p) => smoothstep(0.1, 0.26, p).mul(0.04)
        .add(rampIntegral(p, T_JUMP_A0, T_JUMP_A1).sub(rampIntegral(p, T_DROP_D0, T_DROP_D1))
            .div(flightMax).mul(0.96));

    // Facet colour of a home point (the conic starts at 45deg, clockwise from up).
    const facetSrgb = (x, yUp) => {
        const theta = atan(x, yUp); // atan2(x, y): clockwise from up, (−π, π]
        const g = fract(theta.div(Math.PI * 2).sub(0.125).add(1.0));
        let c = vec3(...FACET_SRGB[0]);
        c = mix(c, vec3(...FACET_SRGB[1]), step(0.25, g));
        c = mix(c, vec3(...FACET_SRGB[2]), step(0.5, g));
        c = mix(c, vec3(...FACET_SRGB[3]), step(0.75, g));
        return c;
    };

    let computeNode = null;
    if (computeOk) {
        const computeFn = Fn(() => {
            const idx = instanceIndex;
            const h = home.element(idx).toVar();
            const homePos = h.xyz.toVar();
            const seedA = h.w.toVar();
            const seedB = meta.element(idx).w.toVar();
            const t = uTime;

            const seedC = fract(seedA.mul(37.19).add(seedB.mul(11.7))).toVar();
            const seedD = fract(seedA.mul(91.31).add(seedB.mul(53.4))).toVar();

            // Keep each shard on the radial route it had inside the opening diamond. A tenth of
            // the field rides close to the axis, so the vanishing point is a dense star core
            // instead of a hole.
            const theta = seedA.mul(6.28318).sub(3.14159).toVar();
            const cosT = cos(theta).toVar();
            const sinT = sin(theta).toVar();
            const coreRider = step(0.9, seedD);
            const rho = mix(float(0.22).add(seedB.mul(2.2)), float(0.03).add(seedB.mul(0.2)), coreRider).toVar();
            const zPhase = seedC.toVar();
            const warpRate = float(1.4).add(seedD.mul(1.6)).toVar();

            // Analytic position as a pure function of a progress value.
            const posAt = (pval) => {
                const wHome = smoothstep(0.1, 0.3, pval).oneMinus();
                const wArrival = smoothstep(0.62, 0.9, pval);
                const wTunnel = clamp(float(1.0).sub(wHome).sub(wArrival), 0.0, 1.0);

                // The shatter: facets burst apart on the flare, then fall into depth.
                const burst = smoothstep(T_BIRTH_A, 0.16, pval).mul(smoothstep(0.2, 0.32, pval).oneMinus());
                const homeScale = float(1.0).add(burst.mul(float(0.35).add(seedB.mul(0.9))));
                // The gem is born at the DOM mark's position and glides to the axis as it falls away.
                const glide = smoothstep(0.1, 0.34, pval).oneMinus();
                const homeLaunch = vec3(
                    homePos.x.mul(homeScale).mul(uGemScale).add(uGemOffset.x.mul(glide)),
                    homePos.y.mul(homeScale).mul(uGemScale).add(uGemOffset.y.mul(glide)),
                    homePos.z.sub(burst.mul(float(0.3).add(seedC.mul(1.6)))),
                );

                const flight = flightAt(pval);
                const travel = fract(zPhase.add(flight.mul(warpRate)));
                const zStream = mix(float(Z_FAR), float(Z_NEAR), travel);
                const tunnelRadius = rho.mul(float(0.72).add(flight.mul(0.5)));
                const tunnelPos = vec3(cosT.mul(tunnelRadius), sinT.mul(tunnelRadius), zStream);

                // Arrival is a persistent, layered star field with a quiet title-safe core.
                const arrivalAngle = theta.add(seedC.mul(1.6)).add(t.mul(0.025)).toVar();
                const arrivalRipple = sin(theta.mul(3.0).add(seedC.mul(6.28318))).mul(0.42);
                const arrivalDepthScale = float(1.0).add(seedD.mul(1.35));
                const innerDust = smoothstep(0.0, 0.14, seedC).oneMinus();
                const arrivalCore = mix(float(2.0), float(0.45), innerDust);
                const radialWave = float(1.0).add(sin(theta.mul(2.0).add(seedD.mul(6.28318))).mul(0.14));
                const arrivalRadius = arrivalCore.add(sqrt(seedB).mul(7.2))
                    .add(arrivalRipple)
                    .mul(arrivalDepthScale)
                    .mul(radialWave);
                const arrivalPos = vec3(
                    cos(arrivalAngle).mul(arrivalRadius),
                    sin(arrivalAngle).mul(arrivalRadius).mul(float(0.54).add(seedC.mul(0.16))),
                    float(-4.0).sub(seedD.mul(25.0)),
                );

                const base = homeLaunch.mul(wHome)
                    .add(tunnelPos.mul(wTunnel))
                    .add(arrivalPos.mul(wArrival));

                const turbAmp = wTunnel.mul(0.12)
                    .add(wArrival.mul(0.3))
                    .add(burst.mul(0.05))
                    .add(0.004);
                const turb = curlNoise3(base.mul(0.31).add(vec3(0.0, 0.0, t.mul(0.08))), t);
                const withTurb = base.add(turb.mul(turbAmp));

                const spin = pval.mul(0.2).mul(wTunnel).add(t.mul(0.008).mul(wArrival));
                const rot = rotate2(withTurb.xy, spin);
                return vec3(rot.x, rot.y, withTurb.z);
            };

            const p = uProgress;
            const cur = posAt(p).toVar();
            const prev = posAt(p.sub(float(0.0045))).toVar();

            // Screen-space (aspect-corrected) streak from projected cur/prev.
            const clipCur = uViewProj.mul(vec4(cur, 1.0)).toVar();
            const clipPrev = uViewProj.mul(vec4(prev, 1.0)).toVar();
            const wCur = max(clipCur.w, float(0.001));
            const ndcCur = vec2(clipCur.x.div(wCur).mul(uAspect), clipCur.y.div(wCur)).toVar();
            const ndcPrev = vec2(
                clipPrev.x.div(max(clipPrev.w, float(0.001))).mul(uAspect),
                clipPrev.y.div(max(clipPrev.w, float(0.001))),
            ).toVar();
            const streak = ndcCur.sub(ndcPrev).toVar();
            const rawLen = length(streak).toVar();
            const sDir = streak.div(max(rawLen, float(0.0001))).toVar();
            const trailGate = smoothstep(0.14, 0.3, p).mul(smoothstep(0.6, 0.7, p).oneMinus());
            const sLen = clamp(rawLen.mul(trailGate).mul(1.35), float(0.0), float(TRAIL_MAX_NDC)).toVar();

            const wHomeE = smoothstep(0.1, 0.3, p).oneMinus().toVar();
            const wArrivalE = smoothstep(0.62, 0.9, p).toVar();
            const wTunnelE = clamp(float(1.0).sub(wHomeE).sub(wArrivalE), 0.0, 1.0).toVar();
            const speedGlow = clamp(sLen.mul(7.0), float(0.0), float(1.0)).toVar();
            const twinkle = sin(t.mul(1.15).add(seedC.mul(18.0))).mul(0.5).add(0.5);
            const flare = flareEnv(p);

            // Ascending smoothsteps keep particles soft at the tunnel wrap planes.
            const nearFade = smoothstep(Z_NEAR - 2.5, Z_NEAR + 0.4, cur.z).oneMinus();
            const farFade = smoothstep(Z_FAR + 2.0, Z_FAR + 12.0, cur.z);
            // Close to the lens a mote that is NOT streaking is a big soft blob; only streaks earn it.
            // From the drop-out on, motion is the tunnel→arrival interpolation, not flight: never lit.
            const flightMotion = smoothstep(0.58, 0.66, p).oneMinus();
            const streaking = smoothstep(0.004, 0.02, sLen).mul(flightMotion);
            const closeFade = mix(smoothstep(1.4, 4.0, wCur), float(1.0), streaking);
            const depthFade = nearFade.mul(farFade).mul(closeFade).toVar();
            // Born on the flare: before it the stage quad draws the solid gem.
            const birth = smoothstep(T_BIRTH_A, T_BIRTH_B, p);

            const energy = wHomeE.mul(float(0.09).add(flare.mul(0.2)))
                .add(wTunnelE.mul(float(0.16).add(speedGlow.mul(0.95).mul(flightMotion))))
                .add(wArrivalE.mul(float(0.42).add(twinkle.mul(0.4))))
                .mul(depthFade)
                .mul(birth)
                .toVar();

            const out = positions.element(idx).toVar();
            out.x.assign(cur.x); out.y.assign(cur.y); out.z.assign(cur.z);
            out.w.assign(energy);
            positions.element(idx).assign(out);

            const vout = velocities.element(idx).toVar();
            vout.x.assign(sDir.x); vout.y.assign(sDir.y);
            vout.z.assign(sLen);
            vout.w.assign(wCur);
            velocities.element(idx).assign(vout);
        });
        computeNode = computeFn().compute(count);
    }

    // ── Stage: the ident match frame, the flares and the room, one full-screen quad ──────────
    const stageGeometry = new THREE.PlaneGeometry(2, 2);
    const stageMaterial = new THREE.MeshBasicNodeMaterial({
        depthWrite: false,
        depthTest: false,
    });
    stageMaterial.vertexNode = vec4(positionLocal.xy, 0.0, 1.0);
    stageMaterial.colorNode = Fn(() => {
        const W = uViewportPx.x;
        const H = uViewportPx.y;
        const p = uProgress;
        const px = uv().x.mul(W);
        const py = uv().y.oneMinus().mul(H); // CSS space, y down
        const s = vec3(0.0).toVar();

        // Shell background: linear-gradient(180deg, #090b13 0%, #03040a 56%, #010207 100%)
        const ty = py.div(H);
        const c0 = vec3(9 / 255, 11 / 255, 19 / 255);
        const c1 = vec3(3 / 255, 4 / 255, 10 / 255);
        const c2 = vec3(1 / 255, 2 / 255, 7 / 255);
        s.assign(mix(mix(c0, c1, clamp(ty.div(0.56), 0.0, 1.0)), c2, clamp(ty.sub(0.56).div(0.44), 0.0, 1.0)));

        // radial-gradient(ellipse at 50% 46%, rgba(49,104,155,.26) 0%, rgba(70,42,112,.12) 34%,
        // transparent 67%) — farthest-corner ellipse with the closest-side aspect.
        const k = W.mul(0.5).div(H.mul(0.46));
        const ry = sqrt(W.mul(0.5).div(k).pow(2.0).add(H.mul(0.54).pow(2.0)));
        const rx = ry.mul(k);
        const rr = length(vec2(px.sub(W.mul(0.5)).div(rx), py.sub(H.mul(0.46)).div(ry)));
        const p0 = vec4(vec3(49 / 255, 104 / 255, 155 / 255).mul(0.26), 0.26);
        const p1 = vec4(vec3(70 / 255, 42 / 255, 112 / 255).mul(0.12), 0.12);
        const radial = mix(
            mix(p0, p1, clamp(rr.div(0.34), 0.0, 1.0)),
            vec4(0.0),
            clamp(rr.sub(0.34).div(0.33), 0.0, 1.0),
        );
        s.assign(radial.rgb.add(s.mul(radial.a.oneMinus())));

        // .startup-shell__grain: 4.5% of an feTurbulence fractal-noise tile. Its mean lifts the
        // dark stage by ~3/255 (measured against the DOM ident); a static per-pixel hash with
        // the same effective weight reproduces both the lift and the texture.
        const grainSeed = fract(sin(vec2(px, py).floor().dot(vec2(12.9898, 78.233))).mul(43758.5453));
        s.assign(mix(s, vec3(grainSeed), GRAIN_WEIGHT));

        // .startup-shell__vignette: radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,.62) 100%)
        const vr = length(vec2(px.sub(W.mul(0.5)).div(W.mul(0.70711)), py.sub(H.mul(0.5)).div(H.mul(0.70711))));
        s.assign(s.mul(float(1.0).sub(clamp(vr.sub(0.4).div(0.6), 0.0, 1.0).mul(0.62))));

        // .startup-shell__spotlight: linear-gradient(90deg, transparent, rgba(140,215,255,.035) 42%,
        // rgba(199,125,255,.026) 58%, transparent)
        const ux = px.div(W);
        const sp0 = vec4(vec3(140 / 255, 215 / 255, 1.0).mul(0.035), 0.035);
        const sp1 = vec4(vec3(199 / 255, 125 / 255, 1.0).mul(0.026), 0.026);
        const spotRise = mix(vec4(0.0), sp0, clamp(ux.div(0.42), 0.0, 1.0));
        const spotMid = mix(sp0, sp1, clamp(ux.sub(0.42).div(0.16), 0.0, 1.0));
        const spotFall = mix(sp1, vec4(0.0), clamp(ux.sub(0.58).div(0.42), 0.0, 1.0));
        const spot = mix(mix(spotRise, spotMid, step(0.42, ux)), spotFall, step(0.58, ux));
        s.assign(spot.rgb.add(s.mul(spot.a.oneMinus())));

        // Letterbox bars (5.5vh, #000), retracting through the ignition.
        const barH = H.mul(LETTERBOX_VH).mul(smoothstep(0.07, 0.2, p).oneMinus());
        const inBar = clamp(barH.sub(py).add(0.5), 0.0, 1.0).add(clamp(py.sub(H.sub(barH)).add(0.5), 0.0, 1.0));
        s.assign(s.mul(clamp(inBar, 0.0, 1.0).oneMinus()));

        // .startup-logo__glow: 280px circle, radial-gradient(circle, rgba(140,215,255,.24) 0%,
        // rgba(199,125,255,.09) 40%, transparent 72%) — farthest-corner radius 140·√2.
        const gx = px.sub(uGemCenterPx.x);
        const gyUp = uGemCenterPx.y.sub(py);
        const gr = length(vec2(gx, gyUp)).div(197.99 * GLOW_SCALE);
        const gl0 = vec4(vec3(140 / 255, 215 / 255, 1.0).mul(0.24), 0.24);
        const gl1 = vec4(vec3(199 / 255, 125 / 255, 1.0).mul(0.09), 0.09);
        const glow = mix(mix(gl0, gl1, clamp(gr.div(0.4), 0.0, 1.0)), vec4(0.0), clamp(gr.sub(0.4).div(0.32), 0.0, 1.0))
            .mul(GLOW_OPACITY);
        s.assign(glow.rgb.add(s.mul(glow.a.oneMinus())));

        // .startup-logo__mark: diamond clip, four conic facets, core span, ::before highlights,
        // ::after cross lines (screen). Its drop-shadows are clipped away by its own clip-path
        // (filter runs before clip-path), so there are none to draw.
        const l1 = abs(gx).add(abs(gyUp));
        const markA = clamp(float(MARK_HALF_PX).sub(l1).div(1.41421).add(0.5), 0.0, 1.0);
        const facet = facetSrgb(gx, gyUp).toVar();
        const coreA = clamp(float(CORE_HALF_PX).sub(l1).div(1.41421).add(0.5), 0.0, 1.0).mul(0.88);
        facet.assign(mix(facet, vec3(238 / 255, 250 / 255, 1.0), coreA));
        // ::before (114px box, diamond half 57): linear-gradient(135deg, rgba(255,255,255,.5),
        // transparent 42%), linear-gradient(315deg, rgba(78,207,255,.25), transparent 52%).
        const L = float(114 * 1.41421);
        const xC = gx;
        const yC = gyUp.negate();
        const t135 = float(0.5).add(xC.mul(0.70711).add(yC.mul(0.70711)).div(L));
        const t315 = float(0.5).sub(xC.mul(0.70711).add(yC.mul(0.70711)).div(L));
        const hiA = clamp(float(1.0).sub(t135.div(0.42)), 0.0, 1.0).mul(0.5);
        const cyA = clamp(float(1.0).sub(t315.div(0.52)), 0.0, 1.0).mul(0.25);
        const beforeIn = clamp(float(BEFORE_HALF_PX).sub(l1).div(1.41421).add(0.5), 0.0, 1.0);
        const layerRgb = vec3(1.0).mul(hiA).add(vec3(78 / 255, 207 / 255, 1.0).mul(cyA).mul(hiA.oneMinus()));
        const layerA = hiA.add(cyA.mul(hiA.oneMinus())).mul(beforeIn);
        facet.assign(layerRgb.mul(beforeIn).add(facet.mul(layerA.oneMinus())));
        // ::after: vertical line (.5) over horizontal line (.38), screen-blended.
        const lineV = clamp(float(1.0).sub(abs(gx).div(118 * 0.0065)), 0.0, 1.0).mul(0.5);
        const lineH = clamp(float(1.0).sub(abs(gyUp).div(118 * 0.0065)), 0.0, 1.0).mul(0.38);
        const lineA = lineV.add(lineH.mul(lineV.oneMinus()));
        const lineCol = vec3(228 / 255, 246 / 255, 1.0);
        facet.assign(facet.add(lineCol.mul(facet.oneMinus()).mul(lineA)));

        // The gem shatters on the flare; the room falls away behind the particles.
        const gemAlpha = smoothstep(T_GEM_GONE_A, T_GEM_GONE_B, p).oneMinus();
        s.assign(mix(s, facet, markA.mul(gemAlpha)));

        // Display-referred sRGB → linear → pre-tonemap, so ACES(·) reproduces the CSS pixels.
        const matchPre = inverseAces(srgbToLinear(s), float(TONE_EXPOSURE)).toVar();
        const room = smoothstep(0.1, 0.42, p);
        const warpBlack = vec3(0.0006, 0.0011, 0.0035);
        const col = mix(matchPre, warpBlack, room).toVar();

        // Ignition flare (HDR, additive): gem over-exposure, bloom, anamorphic streak.
        const flare = flareEnv(p);
        const gd = length(vec2(gx, gyUp));
        const gemMask = markA.mul(gemAlpha);
        const facetLin = srgbToLinear(facetSrgb(gx, gyUp));
        col.addAssign(facetLin.mul(gemMask).mul(flare).mul(1.2));
        const bloomR = float(28.0).add(flare.mul(46.0));
        col.addAssign(vec3(0.72, 0.9, 1.0).mul(exp(gd.mul(gd).div(bloomR.mul(bloomR).mul(-2.0)))).mul(flare).mul(0.85));
        col.addAssign(vec3(0.5, 0.62, 1.0).mul(exp(gd.mul(gd).div(-2.0 * 150 * 150))).mul(flare).mul(0.16));
        const streakX = float(200.0).add(flare.mul(260.0));
        col.addAssign(vec3(0.66, 0.84, 1.0)
            .mul(exp(gyUp.mul(gyUp).div(-2.0 * 2.6 * 2.6)))
            .mul(exp(gx.mul(gx).div(streakX.mul(streakX).mul(-2.0))))
            .mul(flare)
            .mul(0.7));

        // Vanishing point (screen centre): a light at the end of the tunnel while cruising.
        const vx = px.sub(W.mul(0.5));
        const vy = py.sub(H.mul(0.5));
        const vd2 = vx.mul(vx).add(vy.mul(vy));
        const cruise = cruiseEnv(p);
        const vpGlow = exp(vd2.div(-2.0 * 34 * 34)).mul(0.55).add(exp(vd2.div(-2.0 * 170 * 170)).mul(0.1));
        col.addAssign(vec3(0.62, 0.82, 1.0).mul(vpGlow).mul(cruise));
        // Tunnel wall tint at the frame edges while cruising.
        const edge = smoothstep(0.35, 1.0, length(vec2(vx.div(W.mul(0.5)), vy.div(H.mul(0.5)))));
        col.addAssign(vec3(0.16, 0.1, 0.42).mul(edge).mul(cruise).mul(0.05));

        // Drop-out flash: a smaller bloom + streak where the flight ends.
        const drop = dropFlashEnv(p);
        const dropR = float(18.0).add(drop.mul(34.0));
        col.addAssign(vec3(0.7, 0.86, 1.0).mul(exp(vd2.div(dropR.mul(dropR).mul(-2.0)))).mul(drop).mul(1.1));
        col.addAssign(vec3(0.5, 0.6, 1.0).mul(exp(vd2.div(-2.0 * 120 * 120))).mul(drop).mul(0.07));
        col.addAssign(vec3(0.62, 0.8, 1.0)
            .mul(exp(vy.mul(vy).div(-2.0 * 2.2 * 2.2)))
            .mul(exp(vx.mul(vx).div(-2.0 * 420 * 420)))
            .mul(drop)
            .mul(0.35));

        // Arrival: the room the intro is lit in, so its nebula and title resolve out of the warp
        // instead of fading up from black — deep indigo, a violet band across the middle, a
        // lavender glow where the title lands (y ≈ 0.51H) and teal toward the top. The intro
        // renders the real thing behind this canvas; the warp fades onto it from p = 0.9.
        const haze = smoothstep(0.64, 0.95, p);
        const drift = uTime.mul(0.018);
        const nx = vx.div(W);
        const ny = vy.div(H); // 0 at centre, +down
        // pow2 (x*x), not pow(x, 2): WGSL pow is undefined for a negative base, and these
        // bases are negative over most of the screen (NaN on drivers that do not fold it).
        const band = exp(ny.sub(0.01).div(0.2).pow2().negate());
        const titleGlow = exp(nx.div(0.27).pow2().add(ny.sub(0.01).div(0.1).pow2()).negate());
        const top = exp(ny.add(0.4).div(0.16).pow2().negate());
        const sway = sin(nx.mul(5.0).add(drift)).mul(0.08).add(1.0);
        const arrivalRoom = vec3(0.004, 0.009, 0.04)
            .add(vec3(0.13, 0.025, 0.3).mul(band).mul(sway))
            .add(vec3(0.22, 0.19, 0.36).mul(titleGlow))
            .add(vec3(0.01, 0.05, 0.09).mul(top));
        col.addAssign(arrivalRoom.mul(haze));

        return vec4(col, 1.0);
    })();
    const stage = new THREE.Mesh(stageGeometry, stageMaterial);
    stage.frustumCulled = false;
    stage.renderOrder = 0;

    // ── Particles: additive trailing streaks, screen-space stretched ──────────────────────────
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
    });
    // One pipeline, no culling. A transparent DoubleSide material otherwise renders as a
    // BackSide + FrontSide pair, and r185's compileAsync drain builds only an unused DoubleSide
    // variant, so the real pair would still compile synchronously on the first visible frame
    // (post-target-compile.js beginDeferredSideCapture). These are screen-aligned billboards
    // whose winding flips with the streak direction, so they need no culling anyway.
    material.forceSinglePass = true;

    const pxNdc = uViewportPx.y.reciprocal().mul(2.0); // one CSS px in NDC (vertical)
    const halfWidthNode = Fn(([energy, depth, particleSeed]) => {
        const sizeDepth = clamp(float(3.0).div(max(depth, float(0.2))), float(0.28), float(1.8));
        const half = float(BASE_NDC).mul(float(0.56).add(energy.mul(0.5))).mul(sizeDepth).toVar();
        const arrivalSize = smoothstep(0.72, 0.95, uProgress);
        const softMote = smoothstep(0.0, 0.075, fract(particleSeed.mul(17.17))).oneMinus();
        const arrivalVariation = float(1.1).add(particleSeed.mul(0.7)).add(softMote.mul(1.6));
        half.assign(half.mul(mix(float(1.0), arrivalVariation, arrivalSize)));
        return half;
    });

    material.vertexNode = Fn(() => {
        const pdata = positions.element(instanceIndex).toVar();
        const vdata = velocities.element(instanceIndex).toVar();
        const particlePos = pdata.xyz.toVar();
        const energy = pdata.w.toVar();
        const sDir = vdata.xy.toVar();
        const sLen = vdata.z.toVar();
        const depth = vdata.w.toVar();
        const particleSeed = meta.element(instanceIndex).w;
        const half = halfWidthNode(energy, depth, particleSeed).toVar();

        // Orientation basis: streak-aligned WHEN moving, screen-axis-aligned at rest (sDir is 0
        // at zero streak — without this fallback the quad collapses to zero area).
        const hasStreak = smoothstep(float(0.0), float(0.006), sLen).toVar();
        const dir = mix(vec2(1.0, 0.0), sDir, hasStreak).toVar();
        const perp = vec2(dir.y.negate(), dir.x).toVar();
        // The quad runs from the tail (behind the particle) to just past its head, so the
        // trail follows the particle instead of straddling it.
        const along = positionLocal.x.add(0.5); // 0 tail → 1 head
        const offAlong = mix(sLen.add(half).negate(), half, along);
        // Streaks thin as they stretch, but never below ~0.7 CSS px (sub-pixel quads alias
        // into dotted lines on this no-MSAA canvas).
        const halfWid = max(half.mul(clamp(float(1.0).sub(sLen.mul(3.0)), float(0.35), float(1.0))), pxNdc.mul(0.7));
        const offIso = dir.mul(offAlong).add(perp.mul(positionLocal.y.mul(halfWid.mul(2.0))));
        const offNdc = vec2(offIso.x.div(uAspect), offIso.y).toVar();

        const clipCenter = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(particlePos, 1.0))).toVar();
        return vec4(
            clipCenter.x.add(offNdc.x.mul(clipCenter.w)),
            clipCenter.y.add(offNdc.y.mul(clipCenter.w)),
            clipCenter.z,
            clipCenter.w,
        );
    })();

    material.colorNode = Fn(() => {
        const pdata = positions.element(instanceIndex).toVar();
        const vdata = velocities.element(instanceIndex).toVar();
        const energy = pdata.w.toVar();
        const sLen = vdata.z.toVar();
        const galaxyCol = meta.element(instanceIndex).xyz.toVar();
        const homePoint = home.element(instanceIndex).xy.toVar();
        const particleSeed = meta.element(instanceIndex).w;
        const half = halfWidthNode(energy, vdata.w, particleSeed);

        // Shape: a round mote at rest; a tapered trail with a bright head when streaking.
        const q = uv();
        const across = abs(q.y.sub(0.5)).mul(2.0);
        const hasStreak = smoothstep(float(0.0), float(0.006), sLen);
        const trailLen = sLen.add(half.mul(2.0));
        const headPos = float(1.0).sub(half.div(max(trailLen, float(0.0001)))); // where the head disc sits
        const headD = length(vec2(q.x.sub(headPos).mul(trailLen).div(max(half, float(0.0001))), across));
        const head = smoothstep(0.0, 1.0, headD).oneMinus();
        const tail = pow(clamp(q.x.div(max(headPos, float(0.001))), 0.0, 1.0), float(1.8))
            .mul(smoothstep(0.25, 1.0, across).oneMinus());
        const streakShape = max(head, tail.mul(0.7));
        const r = length(q.sub(vec2(0.5, 0.5))).mul(2.0);
        const moteShape = smoothstep(0.0, 1.0, r).oneMinus().mul(0.6)
            .add(smoothstep(0.0, 0.4, r).oneMinus().mul(0.4));
        const shape = mix(moteShape, streakShape, hasStreak);

        const identCol = srgbToLinear(facetSrgb(homePoint.x, homePoint.y));
        // Intro stars use colour * 0.7 + 0.3; matching that lets the arrival field survive the
        // crossfade into the live intro behind it.
        const introStarCol = galaxyCol.mul(0.68).add(vec3(0.3, 0.3, 0.3));
        const arrivalCol = mix(introStarCol, vec3(...ARRIVAL_MIST), float(0.16));
        const revealAmt = smoothstep(0.14, 0.4, uProgress);
        const arrivalAmt = smoothstep(0.66, 0.92, uProgress);
        const baseCol = mix(mix(identCol, introStarCol, revealAmt), arrivalCol, arrivalAmt.mul(0.28));
        const hotT = smoothstep(0.9, 1.6, energy).mul(0.35);
        const col = mix(baseCol, vec3(1.0, 1.0, 1.0), hotT);

        // Arrival motes grow up to ~7x; keep their total light roughly constant as they do, or
        // the big near ones merge into a white fog.
        const softMote = smoothstep(0.0, 0.075, fract(particleSeed.mul(17.17))).oneMinus();
        const moteGrowth = mix(
            float(1.0),
            float(1.1).add(particleSeed.mul(0.7)).add(softMote.mul(1.6)),
            smoothstep(0.72, 0.95, uProgress),
        );

        // Intensity lives in the colour; alpha is only the shape (additive SrcAlpha·One — putting
        // energy in both multiplied it twice and left the flight at ~26% grey).
        return vec4(col.mul(energy).mul(0.62).div(sqrt(moteGrowth)), shape);
    })();
    material.userData.emitsBloom = true;

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    const group = new THREE.Group();
    group.add(stage);
    group.add(mesh);

    const setViewport = (w, h) => {
        if (!(w > 0 && h > 0)) return;
        uViewportPx.value.set(w, h);
        uAspect.value = w / h;
        if (opts.viewportHeight) uGemScale.value = viewportH / h;
    };
    const setGemCenterPx = (x, y) => {
        const w = uViewportPx.value.x;
        const h = uViewportPx.value.y;
        uGemCenterPx.value.set(x, y);
        // World xy at z=0 for the fixed 45° camera at z=7.
        const worldPerNdc = CAM_Z * TAN_HALF_FOV;
        uGemOffset.value.set(((x / w) * 2 - 1) * worldPerNdc * (w / h), (1 - (y / h) * 2) * worldPerNdc);
    };
    setGemCenterPx(viewportW / 2, viewportH / 2 + DEFAULT_MARK_OFFSET_Y_PX);

    return {
        mesh: group,
        particles: mesh,
        stage,
        computeNode,
        uniforms: {
            uProgress, uTime, uAspect, uViewProj, uViewportPx, uGemCenterPx, uGemOffset, uGemScale,
        },
        setProgress(p) { uProgress.value = p; },
        setTime(t) { uTime.value = t; },
        setAspect(a) { uAspect.value = a; },
        setViewProj(matrix4) { uViewProj.value.copy(matrix4); },
        setViewport,
        setGemCenterPx,
        dispose() {
            geometry.dispose();
            material.dispose();
            stageGeometry.dispose();
            stageMaterial.dispose();
        },
    };
}

export const WARP_CONSTANTS = Object.freeze({
    Z_FAR,
    Z_NEAR,
    DIAMOND_SIZE,
    GEM_TARGET_PX,
    TRAIL_MAX_NDC,
    GALAXY_COLORS,
    FACET_SRGB,
    TONE_EXPOSURE,
});
