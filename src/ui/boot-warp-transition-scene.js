/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Boot Warp Transition — shared particle scene builder.
 *
 * Single source of truth for the game-ident -> intro reveal. The Serenity diamond
 * is a GPU compute point-cloud that focuses into view, opens into a restrained
 * hyperspace flight, then decelerates into the cool nebula field behind the title.
 * Renderer-agnostic: builds the InstancedMesh +
 * a TSL compute node and exposes uniform setters — the CALLER owns the
 * WebGPURenderer and dispatches `renderer.compute`.
 *
 * Consumed by:
 *   - src/playground/effects/logo-warp-transition.effect.js  (iteration harness)
 *   - src/ui/boot-warp-transition.js                         (the boot renderer)
 *
 * CONNECTED to the rest of the boot on purpose:
 *   - START: the opening faceted diamond matches the CSS game ident in silhouette,
 *     scale, and cyan-violet palette.
 *   - COLOUR: particles use the intro's GALAXY_COLORS, softened the same way as its
 *     star field, so the flight and live intro feel like one material system.
 *   - END: particles remain as a slow nebula seed instead of flying past the camera
 *     into black. The caller reveals the real intro and title through this field.
 *
 * The whole motion is a PURE FUNCTION of `progress` (0..1) + a per-particle
 * home/seed, so it is fully reproducible for phase-locked `?t=` stills.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    float,
    fract,
    instanceIndex,
    length,
    max,
    mix,
    positionLocal,
    sin,
    smoothstep,
    sqrt,
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

// Game-ident facet colours. These are mirrored by public/styles/main.css.
const SPLASH_CYAN = [0.549, 0.843, 1.0];
const SPLASH_VIOLET = [0.553, 0.651, 1.0];
const ARRIVAL_MIST = [0.42, 0.68, 0.98];

const DIAMOND_SIZE = 0.52; // fallback world half-extent when no viewport height is given
const Z_FAR = -34.0; // tunnel far plane
const Z_NEAR = 5.3; // tunnel near plane (camera at z=7)
const BASE_NDC = 0.0048; // half-size in aspect-corrected screen units
const TRAIL_MAX_NDC = 0.12;

// The warp OPENS as a match-dissolve of the CSS studio-ident mark, so the home diamond
// must project to that mark's on-screen size. gemHalf is derived per-resolution from this.
const GEM_TARGET_PX = 118;

// Opening seed-bloom tuning (screenshot-calibrated in the playground): how the dense home
// diamond reads as a SOFT GLOWING GEM instead of a grainy square, without the additive
// blend clipping to a white card. All seed terms are a no-op by p>=0.13 → warp/END untouched.
const SEED_FATTEN = 3.2;
const SEED_SUP_K = 16.0;

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

/**
 * @param {object} opts
 * @param {number} [opts.count]   particle count
 * @param {number} [opts.aspect]  initial viewport aspect (w/h)
 * @param {boolean} [opts.compute] whether renderer.compute is available
 * @param {() => number} [opts.rng] deterministic RNG (defaults to Math.random)
 * @returns {{ mesh, computeNode, setProgress, setTime, setAspect, setViewProj, uniforms, dispose }}
 */
export function createWarpParticles(opts = {}) {
    const count = Math.max(1, Math.floor(opts.count || 60000));
    const aspect0 = opts.aspect || 1.777;
    const computeOk = opts.compute !== false;
    const rng = opts.rng || Math.random;

    // World half-extent that projects the home diamond to GEM_TARGET_PX on screen at cam
    // z=7, fov45 (NDC half = gemHalf/(7·tan22.5°); 1 NDC unit = viewportH/2 px). This makes
    // the opening a true match-dissolve of the CSS ident mark on ANY resolution.
    const viewportH = opts.viewportHeight || 1080;
    const gemHalf = opts.viewportHeight
        ? (GEM_TARGET_PX * 7 * Math.tan(Math.PI / 8)) / viewportH
        : DIAMOND_SIZE;
    // The additive seed-bloom integral scales with particle count; calibrate against the
    // boot's 48k so the playground (60k default) and boot look identical.
    const densityScale = count / 48000;

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
        posData[i4 + 3] = 0.5;
    }

    const homeBuffer = new THREE.StorageBufferAttribute(homeData, 4);
    const metaBuffer = new THREE.StorageBufferAttribute(metaData, 4);
    const posBuffer = new THREE.StorageBufferAttribute(posData, 4);
    const velBuffer = new THREE.StorageBufferAttribute(velData, 4);

    const uProgress = uniform(0);
    const uTime = uniform(0);
    const uAspect = uniform(aspect0);
    const uViewProj = uniform(new THREE.Matrix4());

    const home = storage(homeBuffer, 'vec4', count);
    const meta = storage(metaBuffer, 'vec4', count);
    const positions = storage(posBuffer, 'vec4', count);
    const velocities = storage(velBuffer, 'vec4', count);

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

            // Keep each shard on the radial route it had inside the opening diamond.
            const theta = seedA.mul(6.28318).sub(3.14159).toVar();
            const cosT = cos(theta).toVar();
            const sinT = sin(theta).toVar();
            const rho = float(0.16).add(seedB.mul(2.15)).toVar();
            const zPhase = seedC.toVar();
            const warpRate = float(1.15).add(seedD.mul(1.2)).toVar();

            // Analytic position as a pure function of a progress value.
            const posAt = (pval) => {
                const wHome = smoothstep(0.05, 0.26, pval).oneMinus();
                const wArrival = smoothstep(0.62, 0.96, pval);
                const wTunnel = clamp(
                    float(1.0).sub(wHome).sub(wArrival),
                    float(0.0),
                    float(1.0),
                );

                // Focused ignition: the four facets breathe apart before depth takes over.
                const ignition = smoothstep(0.015, 0.09, pval)
                    .mul(smoothstep(0.18, 0.31, pval).oneMinus());
                const homeScale = float(1.0).add(ignition.mul(float(0.3).add(seedB.mul(0.5))));
                const homeLaunch = vec3(
                    homePos.x.mul(homeScale),
                    homePos.y.mul(homeScale),
                    homePos.z.sub(ignition.mul(float(0.45).add(seedC.mul(1.4)))),
                );

                // Acceleration lives in the middle of the shot; wrapping is hidden at both ends.
                const flight = smoothstep(0.08, 0.76, pval);
                const travel = fract(zPhase.add(flight.mul(warpRate)));
                const zStream = mix(float(Z_FAR), float(Z_NEAR), travel);
                const tunnelRadius = rho.mul(float(0.72).add(flight.mul(0.5)));
                const tunnelPos = vec3(cosT.mul(tunnelRadius), sinT.mul(tunnelRadius), zStream);

                // Arrival is a persistent, layered nebula seed with a quiet title-safe core.
                const arrivalAngle = theta.add(seedC.mul(1.6)).add(t.mul(0.025)).toVar();
                const arrivalRipple = sin(theta.mul(3.0).add(seedC.mul(6.28318))).mul(0.42);
                const arrivalDepthScale = float(1.0).add(seedD.mul(1.35));
                const innerDust = smoothstep(0.0, 0.14, seedC).oneMinus();
                const arrivalCore = mix(float(2.0), float(0.45), innerDust);
                const radialWave = float(1.0).add(
                    sin(theta.mul(2.0).add(seedD.mul(6.28318))).mul(0.14),
                );
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

                const turbAmp = wTunnel.mul(0.14)
                    .add(wArrival.mul(0.3))
                    .add(ignition.mul(0.07))
                    .add(0.008);
                const turb = curlNoise3(base.mul(0.31).add(vec3(0.0, 0.0, t.mul(0.08))), t);
                const withTurb = base.add(turb.mul(turbAmp));

                const spin = pval.mul(0.2).mul(wTunnel).add(t.mul(0.008).mul(wArrival));
                const rot = rotate2(withTurb.xy, spin);
                return vec3(rot.x, rot.y, withTurb.z);
            };

            const p = uProgress;
            const ignite = smoothstep(0.01, 0.08, p)
                .mul(smoothstep(0.17, 0.3, p).oneMinus())
                .toVar();
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
            const trailGate = smoothstep(0.13, 0.29, p)
                .mul(smoothstep(0.65, 0.87, p).oneMinus());
            const sLen = clamp(rawLen.mul(trailGate), float(0.0), float(TRAIL_MAX_NDC)).toVar();

            const wHomeE = smoothstep(0.05, 0.26, p).oneMinus().toVar();
            const wArrivalE = smoothstep(0.62, 0.96, p).toVar();
            const wTunnelE = clamp(
                float(1.0).sub(wHomeE).sub(wArrivalE),
                float(0.0),
                float(1.0),
            ).toVar();
            const speedGlow = clamp(sLen.mul(8.0), float(0.0), float(1.0)).toVar();
            const twinkle = sin(t.mul(1.15).add(seedC.mul(18.0))).mul(0.5).add(0.5);

            // Ascending smoothsteps keep particles soft at the tunnel wrap planes.
            const nearFade = smoothstep(Z_NEAR - 2.5, Z_NEAR + 0.4, cur.z).oneMinus();
            const farFade = smoothstep(Z_FAR + 2.0, Z_FAR + 12.0, cur.z);
            const depthFade = nearFade.mul(farFade).toVar();

            const energy = wHomeE.mul(0.3)
                .add(wTunnelE.mul(float(0.15).add(speedGlow.mul(0.58))))
                .add(wArrivalE.mul(float(0.32).add(twinkle.mul(0.28))))
                .add(ignite.mul(0.16))
                .mul(depthFade)
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

    // ── Render: additive billboards, screen-space streak-stretched ────────
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
    });

    material.vertexNode = Fn(() => {
        const pdata = positions.element(instanceIndex).toVar();
        const vdata = velocities.element(instanceIndex).toVar();
        const particlePos = pdata.xyz.toVar();
        const energy = pdata.w.toVar();
        const sDir = vdata.xy.toVar();
        const sLen = vdata.z.toVar();
        const depth = vdata.w.toVar();

        const sizeDepth = clamp(
            float(3.0).div(max(depth, float(0.2))),
            float(0.28),
            float(1.8),
        ).toVar();
        const half = float(BASE_NDC).mul(float(0.56).add(energy.mul(0.62))).mul(sizeDepth).toVar();
        const arrivalSize = smoothstep(0.62, 0.96, uProgress);
        const particleSeed = meta.element(instanceIndex).w;
        const softMote = smoothstep(0.0, 0.075, fract(particleSeed.mul(17.17))).oneMinus();
        const arrivalVariation = float(1.45)
            .add(particleSeed.mul(1.55))
            .add(softMote.mul(4.5));
        half.assign(half.mul(mix(float(1.0), arrivalVariation, arrivalSize)));
        // The opening seed closes the point cloud into one clean faceted silhouette.
        const seed = smoothstep(float(0.0), float(0.16), uProgress).oneMinus().toVar();
        half.assign(half.mul(float(1.0).add(seed.mul(SEED_FATTEN))));

        // Orientation basis: streak-aligned WHEN moving, but screen-axis-aligned at rest.
        // (sDir is 0 at zero streak — without this fallback the quad collapses to zero area
        // and the particle vanishes, which is why the resting gem looked hollow/grainy.)
        const hasStreak = smoothstep(float(0.0), float(0.008), sLen).toVar();
        const dir = mix(vec2(1.0, 0.0), sDir, hasStreak).toVar();
        const perp = vec2(dir.y.negate(), dir.x).toVar();
        const halfLen = half.add(sLen.mul(0.55)).toVar();
        const halfWid = half.mul(
            clamp(float(1.0).sub(sLen.mul(4.0)), float(0.32), float(1.0)),
        ).toVar();

        const offIso = dir.mul(positionLocal.x.mul(halfLen.mul(2.0)))
            .add(perp.mul(positionLocal.y.mul(halfWid.mul(2.0))));
        const offNdc = vec2(offIso.x.div(uAspect), offIso.y).toVar();

        const clipCenter = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(particlePos, 1.0))).toVar();
        return vec4(
            clipCenter.x.add(offNdc.x.mul(clipCenter.w)),
            clipCenter.y.add(offNdc.y.mul(clipCenter.w)),
            clipCenter.z,
            clipCenter.w,
        );
    })();

    const colorNode = Fn(() => {
        const pdata = positions.element(instanceIndex).toVar();
        const energy = pdata.w.toVar();
        const galaxyCol = meta.element(instanceIndex).xyz.toVar();
        const homePoint = home.element(instanceIndex).xy.toVar();

        const uvc = uv().sub(vec2(0.5, 0.5));
        const r = length(uvc).mul(2.0);
        const disc = smoothstep(0.0, 1.0, r).oneMinus();
        const core = smoothstep(0.0, 0.4, r).oneMinus();

        const facetMix = clamp(
            homePoint.x.sub(homePoint.y).div(float(gemHalf * 2)).add(0.5),
            float(0.0),
            float(1.0),
        );
        const identCol = mix(vec3(...SPLASH_CYAN), vec3(...SPLASH_VIOLET), facetMix.mul(0.72));
        // Intro stars use colour * 0.7 + 0.3. Matching that treatment makes the
        // arrival field visually survive the crossfade into the renderer behind it.
        const introStarCol = galaxyCol.mul(0.68).add(vec3(0.3, 0.3, 0.3));
        const arrivalCol = mix(introStarCol, vec3(...ARRIVAL_MIST), float(0.16));
        const revealAmt = smoothstep(0.1, 0.46, uProgress);
        const arrivalAmt = smoothstep(0.66, 0.96, uProgress);
        const baseCol = mix(mix(identCol, introStarCol, revealAmt), arrivalCol, arrivalAmt.mul(0.28));
        const hotT = smoothstep(0.52, 0.74, energy).mul(0.28);
        const col = mix(baseCol, vec3(1.0, 1.0, 1.0), hotT);

        const brightness = disc.mul(0.34).add(core.mul(0.38))
            .mul(energy.mul(0.68).add(0.14))
            .mul(0.92);
        const alpha = disc.mul(clamp(energy.mul(0.48).add(0.1), float(0.0), float(0.72)));

        // Count-aware suppression preserves facet colour instead of clipping the dense
        // opening into a white card. L1 distance keeps the edge a true diamond.
        const seed = smoothstep(float(0.0), float(0.16), uProgress).oneMinus().toVar();
        const seedSup = float(1.0).div(float(1.0).add(seed.mul(SEED_SUP_K * densityScale))).toVar();
        const homeR = abs(homePoint.x).add(abs(homePoint.y)).div(float(gemHalf)).toVar();
        const edgeSoft = smoothstep(float(0.78), float(1.02), homeR).oneMinus().toVar();
        const seedShape = mix(float(1.0), edgeSoft, seed).toVar();
        return vec4(col.mul(brightness).mul(seedSup).mul(seedShape), alpha);
    })();

    material.colorNode = colorNode;
    material.emissiveNode = colorNode.rgb;
    material.userData.emitsBloom = true;

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    return {
        mesh,
        computeNode,
        uniforms: {
            uProgress, uTime, uAspect, uViewProj,
        },
        setProgress(p) { uProgress.value = p; },
        setTime(t) { uTime.value = t; },
        setAspect(a) { uAspect.value = a; },
        setViewProj(matrix4) { uViewProj.value.copy(matrix4); },
        dispose() {
            geometry.dispose();
            material.dispose();
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
});
