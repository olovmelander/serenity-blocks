/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Boot Warp Transition — shared particle scene builder.
 *
 * Single source of truth for the studio-ident → intro reveal. The diamond studio
 * mark is a GPU compute point-cloud that IGNITES, DIVES through a hyperspace warp
 * toward the camera (light-streaks), then EXPLODES outward past the camera to clear
 * the frame straight into the intro. Renderer-agnostic: builds the InstancedMesh +
 * a TSL compute node and exposes uniform setters — the CALLER owns the
 * WebGPURenderer and dispatches `renderer.compute`.
 *
 * Consumed by:
 *   - src/playground/effects/logo-warp-transition.effect.js  (iteration harness)
 *   - src/ui/boot-warp-transition.js                         (the boot renderer)
 *
 * CONNECTED to the rest of the boot on purpose:
 *   - START: the opening diamond is small + `#8cd7ff` cyan to match the CSS studio
 *     ident mark (128px, --sb-accent), then blooms into colour as it ignites.
 *   - COLOUR: every particle is one of the intro's 8 GALAXY_COLORS, so the exploding
 *     debris reads as the SAME particles the live intro is made of.
 *   - END: an outward explosion (rush past camera → clear) hands straight to the
 *     intro's first frame — the caller crossfades the canvas out during the burst.
 *
 * The whole motion is a PURE FUNCTION of `progress` (0..1) + a per-particle
 * home/seed, so it is fully reproducible for phase-locked `?t=` stills.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
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

// Studio-ident mark colour (--sb-accent #8cd7ff) — the diamond starts here, then
// blooms into the galaxy colours as it ignites, matching the CSS splash.
const SPLASH_CYAN = [0.549, 0.843, 1.0];

const DIAMOND_SIZE = 0.52; // fallback world half-extent when no viewport height is given
const Z_FAR = -26.0; // tunnel far plane
const Z_NEAR = 6.0; // tunnel near plane (camera at z≈7)
const BASE_NDC = 0.010; // half-size in aspect-corrected screen units

// The warp OPENS as a match-dissolve of the CSS studio-ident mark, so the home diamond
// must project to that mark's on-screen size. gemHalf is derived per-resolution from this.
const GEM_TARGET_PX = 138; // on-screen full diameter to match (128px solid mark + a touch of its halo)

// Opening seed-bloom tuning (screenshot-calibrated in the playground): how the dense home
// diamond reads as a SOFT GLOWING GEM instead of a grainy square, without the additive
// blend clipping to a white card. All seed terms are a no-op by p>=0.13 → warp/END untouched.
const SEED_FATTEN = 1.7; // billboard grows (1 + seed*this)× at p0 to close speckle into a solid glow
const SEED_SUP_K = 42.0; // additive suppression: brightness /(1 + seed*this*densityScale)

// Center-weighted ROUND sample: a uniform-by-ANGLE direction scaled by a centre-biased
// radius (r = u^0.62). Round (not diamond) matches the CSS mark's circular radial-gradient
// glow, and uniform-by-angle avoids the axis-clustered "bright cross" you get from L1-
// normalizing a square. Dense core → soft edge, so the opening reads as a SOFT GLOWING GEM,
// not a hollow grainy square. Home positions only drive the opening (tunnel/burst use an
// independent per-particle radius), so this never touches the dive or the loved explosion end.
function sampleGem(rng) {
    const ang = rng() * Math.PI * 2;
    const r = rng() ** 0.62; // radius biased toward the centre
    return [Math.cos(ang) * r, Math.sin(ang) * r];
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
    //   home:  diamond xyz + seedA(w)
    //   meta:  galaxy colour rgb + seedB(w)
    //   pos:   live xyz + energy(w)          ← written each compute
    //   vel:   streakDir.xy + streakLen + depth ← written each compute
    const homeData = new Float32Array(count * 4);
    const metaData = new Float32Array(count * 4);
    const posData = new Float32Array(count * 4);
    const velData = new Float32Array(count * 4);

    for (let i = 0; i < count; i += 1) {
        const i4 = i * 4;
        const [dx, dy] = sampleGem(rng);
        homeData[i4] = dx * gemHalf;
        homeData[i4 + 1] = dy * gemHalf;
        homeData[i4 + 2] = (rng() - 0.5) * 0.12;
        homeData[i4 + 3] = rng(); // seedA

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

            // Tunnel constants for this particle.
            const theta = seedA.mul(6.28318).toVar();
            const cosT = cos(theta).toVar();
            const sinT = sin(theta).toVar();
            const rho = float(0.1).add(seedB.mul(2.4)).toVar();
            const zPhase = seedC.toVar();
            const warpRate = float(1.9).add(seedD.mul(1.7)).toVar();

            // Analytic position as a pure function of a progress value.
            const posAt = (pval) => {
                // Shoulder starts at 0 (not 0.10) so there is NO flat static beat: p=0 is
                // still exactly ==1 (identical prewarm gem) but the mark begins igniting the
                // instant progress advances. wTun auto-absorbs the earlier shoulder.
                const wHold = smoothstep(0.0, 0.22, pval).oneMinus();
                const wBurst = smoothstep(0.74, 1.0, pval);
                const wTun = clamp(float(1.0).sub(wHold).sub(wBurst), float(0.0), float(1.0));

                // Hyperspace tunnel (mid).
                const travel = fract(zPhase.add(pval.mul(warpRate)));
                const zStream = mix(float(Z_FAR), float(Z_NEAR), travel);
                const tunnelPos = vec3(cosT.mul(rho), sinT.mul(rho), zStream);

                // Explosion (end): rush outward radially + PAST the camera so the
                // frame clears straight into the intro.
                const burstR = rho.mul(9.0).add(2.2);
                const burstPos = vec3(cosT.mul(burstR), sinT.mul(burstR), float(Z_NEAR + 8.0));

                const base = homePos.mul(wHold).add(tunnelPos.mul(wTun)).add(burstPos.mul(wBurst));

                const turbAmp = wTun.mul(0.22).add(wBurst.mul(0.16)).add(0.01);
                const turb = curlNoise3(base.mul(0.35).add(vec3(0.0, 0.0, t.mul(0.12))), t);
                const withTurb = base.add(turb.mul(turbAmp));

                const spin = pval.mul(0.55).add(t.mul(0.05))
                    .mul(wTun.mul(0.7).add(wBurst.mul(0.45)).add(0.05));
                const rot = rotate2(withTurb.xy, spin);
                return vec3(rot.x, rot.y, withTurb.z);
            };

            const p = uProgress;
            // Opening-only ignition pulse (peaks ~p0.06, exactly 0 by p>=0.20). Pure fn of
            // progress → reproducible ?t= stills. Safe ascending·oneMinus form (no reversed edges).
            const ignite = smoothstep(0.0, 0.06, p).mul(smoothstep(0.08, 0.20, p).oneMinus()).toVar();
            const cur = posAt(p).toVar();
            const prev = posAt(p.sub(float(0.007))).toVar();

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
            const sLen = length(streak).toVar();
            const sDir = streak.div(max(sLen, float(0.0001))).toVar();

            const wHoldE = smoothstep(0.0, 0.22, p).oneMinus().toVar();
            const rimBonus = seedA.oneMinus().mul(0.18);
            const speedGlow = clamp(sLen.mul(7.0), float(0.0), float(1.0)).toVar();

            // Depth fades hide the tunnel wrap AND let the explosion vanish as it
            // passes the camera (z→Z_NEAR+8).
            const nearFade = smoothstep(Z_NEAR + 0.5, Z_NEAR - 3.0, cur.z);
            const farFade = smoothstep(Z_FAR + 2.0, Z_FAR + 12.0, cur.z);
            const depthFade = nearFade.mul(farFade).toVar();

            const energyBase = clamp(
                float(0.26).add(speedGlow.mul(0.9)).add(wHoldE.mul(0.4)).add(rimBonus),
                float(0.0),
                float(1.5),
            ).mul(depthFade);
            // Ignition lift ADDED OUTSIDE the clamp so it touches only the opening; ignite==0
            // by p>=0.20, so the burst/END energy (and thus the loved end) stays bit-identical.
            const energy = energyBase.add(ignite.mul(0.4).mul(depthFade)).toVar();

            const out = positions.element(idx).toVar();
            out.x.assign(cur.x); out.y.assign(cur.y); out.z.assign(cur.z);
            out.w.assign(energy);
            positions.element(idx).assign(out);

            const vout = velocities.element(idx).toVar();
            vout.x.assign(sDir.x); vout.y.assign(sDir.y);
            vout.z.assign(clamp(sLen, float(0.0), float(0.6)));
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

        const sizeDepth = clamp(float(3.0).div(depth), float(0.25), float(2.4)).toVar();
        const half = float(BASE_NDC).mul(float(0.5).add(energy.mul(0.7))).mul(sizeDepth).toVar();
        // Opening seed: fatten sprites so the dense home diamond fuses into a solid glow
        // (no-op by p0.13). Same smoothstep range as the colorNode seed — must stay identical.
        const seed = smoothstep(float(0.0), float(0.13), uProgress).oneMinus().toVar();
        half.assign(half.mul(float(1.0).add(seed.mul(SEED_FATTEN))));

        // Orientation basis: streak-aligned WHEN moving, but screen-axis-aligned at rest.
        // (sDir is 0 at zero streak — without this fallback the quad collapses to zero area
        // and the particle vanishes, which is why the resting gem looked hollow/grainy.)
        const hasStreak = smoothstep(float(0.0), float(0.015), sLen).toVar();
        const dir = mix(vec2(1.0, 0.0), sDir, hasStreak).toVar();
        const perp = vec2(dir.y.negate(), dir.x).toVar();
        const halfLen = half.add(sLen.mul(1.6)).toVar();
        const halfWid = half.mul(clamp(float(1.0).sub(sLen.mul(1.2)), float(0.35), float(1.0))).toVar();

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

        const uvc = uv().sub(vec2(0.5, 0.5));
        const r = length(uvc).mul(2.0);
        const disc = smoothstep(1.0, 0.0, r);
        const core = smoothstep(0.4, 0.0, r);

        // START cyan (matches the CSS ident mark) → blooms into the galaxy colour as
        // the mark ignites; extreme energy (ignition/warp crest) flashes white.
        const revealAmt = smoothstep(0.12, 0.42, uProgress);
        const baseCol = mix(vec3(...SPLASH_CYAN), galaxyCol, revealAmt);
        const hotT = smoothstep(0.85, 1.35, energy).mul(0.85);
        const col = mix(baseCol, vec3(1.0, 1.0, 1.0), hotT);

        // ×1.7 lift so the vivid galaxy hues carry over additive (echoes the intro's ×2.2).
        const brightness = disc.mul(0.42).add(core.mul(0.62)).mul(energy.mul(0.6).add(0.32)).mul(1.7);
        const alpha = disc.mul(clamp(energy.mul(0.5).add(0.14), float(0.0), float(0.85)));

        // OPENING SEED BLOOM (no-op by p0.13 → warp/END untouched). The centre-weighted home
        // distribution gives the gem its bright-core→soft body; here we (a) divide down the huge
        // additive integral so the dense core reads as a bright cyan glow not a clipped white
        // card (count-robust so 48k boot and 60k playground match), and (b) fade the outer rim
        // so the gem glows out softly instead of ending on a hard diamond edge.
        const seed = smoothstep(float(0.0), float(0.13), uProgress).oneMinus().toVar();
        const seedSup = float(1.0).div(float(1.0).add(seed.mul(SEED_SUP_K * densityScale))).toVar();
        const homeR = length(home.element(instanceIndex).xy).div(float(gemHalf)).toVar();
        const edgeSoft = smoothstep(float(0.55), float(1.02), homeR).oneMinus().toVar();
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
    Z_FAR, Z_NEAR, DIAMOND_SIZE, GALAXY_COLORS,
});
