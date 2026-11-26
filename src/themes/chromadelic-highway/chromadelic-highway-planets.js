/**
 * Chromadelic Highway — analytic planet impostors.
 *
 * Each body is ONE camera-plane quad whose fragment shader reconstructs the exact sphere:
 *   - perfectly round at any aspect ratio, shaded on a world-space basis (no swim),
 *   - lit by the highway-core sun behind the board + cool binary fill, with a lush Rayleigh-Mie
 *     sunset terminator (deep indigo -> violet -> rose-crimson -> sunlit gold), cloud-top altitude
 *     relief from the baked surface height channel, limb darkening, iridescent Fresnel crescent,
 *     never-black velvet night side and nebula environment rim,
 *   - hero extras: crisp turbulent rainbow bands with Great Chromatic Vortex, cloud relief, polar
 *     hoods, shimmering north/south polar auroral ovals that blaze on combos/twists/clears, moon
 *     transit shadow and night-side lightning cells;
 *   - moon extras: micro-crater luminance relief, stark terminator, copper-crimson hero eclipse;
 *   - ringed ice giant extras: jewel sapphire-cerulean methane bands, crisp CPU-mipped multi-zone
 *     icy rings (C/B/Cassini/A/Encke/F), mutual shadows, forward-scattered light, twinkling ice
 *     crystal sparkles along the sunlit ansa, liquid-gold B2B gilding and rotating Fever prism;
 *   - the board's light FRONTS (chromadelic-highway-planet-events.js) sweeping cleanly across
 *     every lit face and ring.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    asin,
    atan,
    cameraProjectionMatrix,
    clamp,
    cos,
    dot,
    exp,
    float,
    fract,
    fwidth,
    length,
    max,
    min,
    mix,
    modelViewMatrix,
    normalize,
    positionLocal,
    pow,
    sin,
    smoothstep,
    sqrt,
    step,
    texture,
    uniform,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    chdLuma, chdNeonColor, chdNeonHue,
} from './chromadelic-highway-tsl.js';
import { LIGHTNING_SLOTS, PLANET_FRONT_SLOTS } from './chromadelic-highway-planet-events.js';

const INV_TAU = 1 / (Math.PI * 2);
const INV_PI = 1 / Math.PI;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const _m4 = new THREE.Matrix4();
const _m3 = new THREE.Matrix3();
const _q = new THREE.Quaternion();
const _qSpin = new THREE.Quaternion();
const _T = new THREE.Vector3();
const _R = new THREE.Vector3();
const _U = new THREE.Vector3();
const _camUp = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _v = new THREE.Vector3();
const _viewL = new THREE.Vector3();
const _cView = new THREE.Vector3();

const linear = (hex) => new THREE.Color(hex);

/** Shared palette (linear, what `new THREE.Color(hex)` returns). */
export const PLANET_PALETTE = Object.freeze({
    key: linear('#f2e6ff'),
    fill: linear('#8cd8ff'),
    terminator: linear('#ff4678'),
    terminatorGold: linear('#ff9e3d'),
    rimTerminator: linear('#ff74d4'),
    rimDay: linear('#68d4ff'),
    heroEnvRim: linear('#b84cff'),
    secondaryEnvRim: linear('#3de0ff'),
    voidHorizon: linear('#0c051e'),
    polarHood: linear('#22114a'),
    storm: linear('#d0fcff'),
    stormGlow: linear('#88a0ff'),
    auroraBase: linear('#2cf2ff'),
    auroraTop: linear('#e84cff'),
    ringGold: linear('#ffd675'),
});

const vec3Of = (c) => vec3(c.r, c.g, c.b);

/**
 * @param {object} opts
 * @param {THREE.Texture} opts.map          equirectangular surface texture (alpha = cloud height if relief)
 * @param {number} opts.radius              world radius
 * @param {number} [opts.quad=1.3]          quad half-size in planet radii (≥ ring outer radius)
 * @param {number} [opts.albedo=0.35]
 * @param {number} [opts.rimPeak=0.8]       lit-limb crescent peak (scene-linear)
 * @param {THREE.Color} [opts.envRimColor]  night-limb rim (the nebula behind)
 * @param {number} [opts.envRim=0.6]
 * @param {THREE.Color} [opts.veilColor]
 * @param {number} [opts.veil=0]
 * @param {number} [opts.haloGain=0]
 * @param {object} [opts.grade]             luma gradient map { low, mid, high, amount }
 * @param {number} [opts.night=1]           night-side level
 * @param {boolean} [opts.equalize=false]   equalise band luminance
 * @param {number} [opts.axialTilt=0.3]     radians toward the camera
 * @param {number} [opts.axialRoll=0]       radians in the view plane
 * @param {number} [opts.spinSpeed=0.012]   radians per second (closed form in t)
 * @param {object} [opts.features]          { fill, detail, relief, aurora, polarHood, zonal, lightning,
 *                                            moonShadow, eclipse, ringShadows, transmission, fronts }
 * @param {object} [opts.ring]              { map, inner, outer, tilt, roll }
 */
export function createPlanetImpostor(opts) {
    const {
        map,
        radius = 400,
        quad = 1.3,
        albedo = 0.35,
        rimPeak = 0.8,
        envRimColor = PLANET_PALETTE.heroEnvRim,
        envRim = 0.6,
        veilColor = PLANET_PALETTE.voidHorizon,
        veil = 0,
        haloGain = 0,
        grade = null,
        night: nightLevel = 1,
        equalize = false,
        axialTilt = 0.3,
        axialRoll = 0,
        spinSpeed = 0.012,
        spinPhase = 0,
        features = {},
        ring = null,
        renderOrder = -65,
        name = 'chromadelic-planet',
    } = opts;
    const f = {
        fill: false,
        detail: false,
        relief: false,
        aurora: false,
        polarHood: false,
        zonal: false,
        lightning: false,
        fronts: true,
        moonShadow: false,
        eclipse: false,
        ringShadows: false,
        transmission: false,
        halo: haloGain > 0,
        rim: rimPeak > 0,
        ...features,
    };

    const uRadius = uniform(radius);
    const uQuad = uniform(Math.max(quad, ring ? ring.outer * 1.04 : 1.02));
    const uBasis = uniform(new THREE.Matrix3());
    const uWorldToLocal = uniform(new THREE.Matrix3());
    const uL1 = uniform(new THREE.Vector3(1, 0, 0));
    const uL2 = uniform(new THREE.Vector3(0, 1, 0));
    const uLscreen = uniform(new THREE.Vector2(1, 0));
    const uLod = uniform(0);
    const uTime = uniform(0);
    const uAlbedo = uniform(albedo);
    const uKeyColor = uniform(new THREE.Color().copy(PLANET_PALETTE.key));
    const uFillColor = uniform(new THREE.Color().copy(PLANET_PALETTE.fill));
    const uFillStrength = uniform(f.fill ? 0.28 : 0);
    const uRimPeak = uniform(rimPeak);
    const uEnvRim = uniform(new THREE.Color().copy(envRimColor).multiplyScalar(envRim));
    const uVeilColor = uniform(new THREE.Color().copy(veilColor));
    const uVeil = uniform(veil);
    const uHaloGain = uniform(haloGain);
    const uFronts = Array.from({ length: PLANET_FRONT_SLOTS }, () => ({
        a: uniform(new THREE.Vector4(9, 1, 0, 0)),
        c: uniform(new THREE.Vector4(0, 0, 0, 0)),
    }));
    const uFrontAxis = uniform(new THREE.Vector3(1, 0, 0));
    const uCells = Array.from({ length: LIGHTNING_SLOTS }, () => uniform(new THREE.Vector4(0, 1, 0, 0.05)));
    const uCellLight = uniform(new THREE.Vector4(0, 0, 0, 0));
    // Polar aurora boost + event tint (hero planet) & ring prism / gold gilding (ice giant).
    const uAuroraBoost = uniform(0.35);
    const uAuroraColor = uniform(new THREE.Color().copy(PLANET_PALETTE.auroraBase));
    const uRingPrism = uniform(0);
    const uRingFlow = uniform(0);
    const uRingGold = uniform(0);
    const uMoon = uniform(new THREE.Vector4(0, 0, 50, 0.1));
    const uEclipse = uniform(new THREE.Vector4(0, 0, 50, 5));
    const uEclipseTint = uniform(new THREE.Color(0.36, 0.04, 0.14));
    const uRingN = uniform(new THREE.Vector3(0, 1, 0));
    const uRingLod = uniform(2);
    const uOpacity = uniform(1);
    const uGradeAmount = uniform(grade?.amount ?? 0);
    const uGradeGain = uniform(grade?.gain ?? 1);
    const uGradeLow = uniform(new THREE.Color().copy(grade?.low ?? new THREE.Color(0, 0, 0)));
    const uGradeMid = uniform(new THREE.Color().copy(grade?.mid ?? new THREE.Color(0.5, 0.5, 0.5)));
    const uGradeHigh = uniform(new THREE.Color().copy(grade?.high ?? new THREE.Color(1, 1, 1)));

    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.FrontSide,
    });
    material.name = name;
    material.fog = false;
    material.forceSinglePass = true;
    material.premultipliedAlpha = false;
    material.blending = THREE.CustomBlending;
    material.blendEquation = THREE.AddEquation;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneMinusSrcAlphaFactor;
    material.blendEquationAlpha = THREE.AddEquation;
    material.blendSrcAlpha = THREE.OneFactor;
    material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;

    // Camera-plane billboard at the object origin, sized in world units.
    material.vertexNode = Fn(() => {
        const center = modelViewMatrix.mul(vec4(0.0, 0.0, 0.0, 1.0));
        const offset = positionLocal.xy.mul(uRadius.mul(uQuad));
        return cameraProjectionMatrix.mul(vec4(center.x.add(offset.x), center.y.add(offset.y), center.z, 1.0));
    })();

    const ringSample = (rho) => {
        const t = rho.sub(ring.inner).div(ring.outer - ring.inner);
        const inside = step(0.0, t).mul(step(t, 1.0));
        const s = texture(ring.map, vec2(clamp(t, 0.0, 1.0), 0.5)).level(uRingLod);
        return {
            t, a: s.a.mul(inside), irid: s.g, sparkle: s.b,
        };
    };

    const frontLight = (d) => {
        let sum = vec3(0.0);
        for (const { a, c } of uFronts) {
            const x = d.sub(a.x).mul(a.y);
            const x2 = x.mul(x);
            const band = exp(x2.negate()).mul(a.z);
            const spectrum = chdNeonColor(clamp(x.mul(0.36).add(0.42), 0.0, 0.83), 0.6);
            const col = mix(mix(c.xyz, spectrum, a.w), vec3(1.0), exp(x2.mul(-5.0)).mul(0.42));
            sum = sum.add(col.mul(band)).add(c.xyz.mul(smoothstep(-1.0, 1.0, x).mul(c.w)));
        }
        return sum;
    };

    material.colorNode = Fn(() => {
        const q = positionLocal.xy.mul(uQuad).toVar();
        const r = length(q).toVar();
        const aa = max(fwidth(r), float(0.0005));
        const disc = smoothstep(float(1.0).add(aa), float(1.0).sub(aa), r).toVar();
        const mu = sqrt(max(float(1.0).sub(r.mul(r)), 0.0)).toVar();
        const N = normalize(uBasis.mul(vec3(q.x, q.y, mu))).toVar();
        const Nl = uWorldToLocal.mul(N).toVar();

        // Surface albedo (explicit LOD: atan seam has no derivatives).
        const lat = asin(clamp(Nl.y, -1.0, 1.0)).toVar();
        let uE = atan(Nl.x, Nl.z).mul(INV_TAU).add(0.5);
        // Rotation is in the body's basis. Let the jets drift a fraction of a turn either way
        // so narrow belts and the storm eye still hold together late in a session.
        if (f.zonal) uE = uE.add(sin(uTime.mul(0.033).add(lat.mul(14.0))).mul(0.014));
        const uvE = vec2(uE, lat.mul(INV_PI).add(0.5)).toVar();
        const T0 = texture(map, uvE).level(uLod).toVar();
        const A0 = T0.rgb;
        let A = A0;
        const Alow = f.detail ? texture(map, uvE).level(uLod.add(2.8)).rgb : A0;
        if (f.detail) A = max(A.add(A.sub(Alow).mul(0.32)), vec3(0.0));
        if (equalize) {
            // Balance band luminance cleanly while preserving rich chromadelic jewel saturation.
            A = A.mul(clamp(pow(float(0.34).div(max(chdLuma(Alow), 0.03)), 0.42), 0.65, 1.85));
            A = mix(vec3(chdLuma(A)), A, 0.96);
        }
        if (grade) {
            const lum = chdLuma(A0).mul(uGradeGain);
            const g = mix(mix(uGradeLow, uGradeMid, smoothstep(0.0, 0.5, lum)), uGradeHigh, smoothstep(0.5, 1.0, lum));
            A = mix(A0, g, uGradeAmount);
        }
        if (f.polarHood) {
            A = mix(
                A,
                vec3Of(PLANET_PALETTE.polarHood),
                smoothstep(0.76, 0.96, abs(lat).mul(2.0 * INV_PI)).mul(0.45),
            );
        }

        // Key (highway-core sun) + binary fill + optional cloud-top / crater relief.
        const d1 = dot(N, uL1).toVar();
        let reliefTerm = float(1.0);
        if (f.relief) {
            // Raking cloud-ridge or crater relief: compare altitude (or luma) a tiny step along spin/lat.
            const h1 = texture(map, uvE.add(vec2(0.004, 0.006))).level(uLod);
            const deltaH = grade ? chdLuma(T0.rgb).sub(chdLuma(h1.rgb)).mul(2.2) : T0.a.sub(h1.a).mul(1.8);
            const raking = smoothstep(-0.08, 0.35, d1).mul(smoothstep(0.95, 0.12, d1));
            reliefTerm = clamp(float(1.0).add(deltaH.mul(raking).mul(0.55)), 0.72, 1.32);
        }

        // Smooth Rayleigh-Mie day-night transition (never a harsh plastic line).
        const lit1 = smoothstep(-0.1, 0.28, d1).toVar();
        const litCore = smoothstep(0.0, 0.55, d1);
        let shade = float(1.0);
        if (f.moonShadow) {
            const toM = uMoon.xyz.sub(N);
            const along = dot(toM, uL1);
            const perp = length(toM.sub(uL1.mul(along)));
            const m = uMoon.w;
            shade = shade.mul(float(1.0).sub(float(1.0).sub(smoothstep(m.mul(0.68), m.mul(1.25), perp))
                .mul(step(0.0, along)).mul(0.88)));
        }
        if (ring && f.ringShadows) {
            const nL = dot(uL1, uRingN);
            const s = dot(N, uRingN).negate().div(nL.add(nL.sign().mul(1e-4)).add(1e-5));
            const hit = N.add(uL1.mul(s));
            shade = shade.mul(float(1.0).sub(ringSample(length(hit)).a.mul(step(0.0, s)).mul(0.78)));
        }
        let keyLight = uKeyColor.mul(lit1.mul(0.75).add(litCore.mul(0.35)));
        if (f.fill) keyLight = keyLight.add(uFillColor.mul(uFillStrength).mul(smoothstep(-0.05, 0.45, dot(N, uL2))));
        let day = A.mul(uAlbedo).mul(keyLight).mul(sqrt(mu).mul(0.42).add(0.58)).mul(shade)
            .mul(reliefTerm);
        // Subtle atmospheric glossy sheen on sunlit upper cloud decks.
        if (f.detail || ring) {
            const halfV = normalize(uL1.add(uBasis.mul(vec3(0.0, 0.0, 1.0))));
            const spec = pow(clamp(dot(N, halfV), 0.0, 1.0), 11.0).mul(0.045).mul(shade).mul(lit1);
            day = day.add(uKeyColor.mul(spec));
        }

        let eclipsed = float(0.0);
        if (f.eclipse) {
            const toC = uEclipse.xyz.sub(N);
            const along = dot(toC, uL1);
            const perp = length(toC.sub(uL1.mul(along)));
            const ecl = float(1.0).sub(smoothstep(uEclipse.w.mul(0.9), uEclipse.w.mul(1.08), perp))
                .mul(step(0.0, along)).toVar();
            day = mix(day, A.mul(uEclipseTint).mul(0.75), ecl);
            eclipsed = ecl;
        }
        const planetshine = f.eclipse
            ? A.mul(vec3(0.22, 0.09, 0.28)).mul(0.45)
            : vec3(0.0);
        const night = A.mul(vec3(0.042, 0.046, 0.12)).add(vec3(0.005, 0.005, 0.018)).mul(nightLevel).add(planetshine);
        const surf = night.mul(float(1.0).sub(lit1)).add(day).toVar();

        // Lush Rayleigh-Mie twilight scatter along the terminator (rose-crimson -> warm amber).
        const termDeep = smoothstep(-0.14, -0.02, d1).mul(smoothstep(0.1, -0.02, d1));
        const termWarm = smoothstep(-0.04, 0.08, d1).mul(smoothstep(0.24, 0.06, d1));
        surf.addAssign(vec3Of(PLANET_PALETTE.terminator).mul(0.11).mul(termDeep).mul(shade));
        surf.addAssign(vec3Of(PLANET_PALETTE.terminatorGold).mul(0.065).mul(termWarm).mul(shade));

        if (f.rim) {
            const limb = float(1.0).sub(mu);
            const rimCol = mix(
                vec3Of(PLANET_PALETTE.rimTerminator),
                vec3Of(PLANET_PALETTE.rimDay),
                smoothstep(0.05, 0.58, d1),
            );
            surf.addAssign(rimCol.mul(pow(limb, 4.2)).mul(lit1.mul(0.85).add(0.15)).mul(uRimPeak));
            surf.addAssign(uEnvRim.mul(pow(limb, 5.2)).mul(float(1.0).sub(lit1)));
        }

        if (f.aurora) {
            // Shimmering north & south polar auroral ovals dancing in magnetic latitude (~71°).
            const absLat = abs(lat).mul(2.0 * INV_PI);
            const lon = atan(Nl.x, Nl.z);
            const ovalCenter = float(0.78).add(sin(lon.mul(3.0).add(uTime.mul(0.45))).mul(0.032))
                .add(cos(lon.mul(5.0).sub(uTime.mul(0.32))).mul(0.018));
            const bandD = absLat.sub(ovalCenter).div(0.055);
            const curtain = exp(bandD.mul(bandD).negate());
            const rays = sin(lon.mul(14.0).sub(uTime.mul(1.2))).mul(0.35).add(0.65)
                .mul(cos(lon.mul(9.0).add(uTime.mul(0.85))).mul(0.3).add(0.7));
            const aurCol = mix(uAuroraColor, vec3Of(PLANET_PALETTE.auroraTop), smoothstep(0.72, 0.9, absLat));
            // Most dramatic on the twilight & night side, softly glowing on the day limb too.
            const aurVis = mix(float(0.35), float(1.0), float(1.0).sub(lit1.mul(0.7)));
            surf.addAssign(aurCol.mul(curtain).mul(rays).mul(aurVis).mul(uAuroraBoost)
                .mul(0.72));
        }

        if (f.fronts) {
            const fl = frontLight(dot(N, uFrontAxis)).toVar();
            const reach = smoothstep(-0.16, 0.1, d1).mul(shade).mul(float(1.0).sub(eclipsed)).toVar();
            surf.addAssign(fl.mul(reach).mul(A.mul(uAlbedo).mul(sqrt(mu).mul(0.4).add(0.6)).add(0.18)));
        }

        if (f.lightning) {
            let core = float(0.0);
            let glow = float(0.0);
            const light = [uCellLight.x, uCellLight.y, uCellLight.z, uCellLight.w];
            uCells.forEach((cell, k) => {
                const dd = max(float(1.0).sub(dot(Nl, cell.xyz)), 0.0).mul(2.0);
                const inv = float(1.0).div(cell.w.mul(cell.w));
                core = core.add(exp(dd.mul(inv).negate()).mul(light[k]));
                glow = glow.add(exp(dd.mul(inv).mul(-0.12)).mul(light[k]));
            });
            const cloud = chdLuma(A).mul(1.4).add(0.24);
            const bolt = vec3Of(PLANET_PALETTE.storm).mul(core.mul(1.45))
                .add(vec3Of(PLANET_PALETTE.stormGlow).mul(glow.mul(cloud).mul(1.2)));
            surf.addAssign(bolt.mul(mix(float(0.2), float(1.0), float(1.0).sub(lit1))));
        }

        const body = mix(surf, uVeilColor, uVeil);

        // Volumetric atmospheric halo beyond the limb, light-side biased, zero before quad edge.
        let haloRGB = vec3(0.0);
        if (f.halo) {
            const h = max(r.sub(1.0), 0.0);
            const sunSide = clamp(dot(q.div(max(r, 1e-4)), uLscreen).mul(0.5).add(0.5), 0.0, 1.0);
            const halo = exp(h.mul(-7.5)).mul(mix(float(0.28), float(1.0), sunSide)).mul(uHaloGain)
                .mul(float(1.0).sub(disc))
                .mul(smoothstep(uQuad, uQuad.mul(0.84), r));
            haloRGB = mix(uEnvRim, vec3Of(PLANET_PALETTE.rimDay), sunSide).mul(halo);
            if (f.fronts) {
                const nLimb = uBasis.mul(vec3(q.div(max(r, 1e-4)), 0.0));
                const caught = frontLight(dot(nLimb, uFrontAxis)).mul(smoothstep(-0.16, 0.1, dot(nLimb, uL1)));
                haloRGB = haloRGB.add(caught.mul(exp(h.mul(-6.8)).mul(0.24))
                    .mul(float(1.0).sub(disc))
                    .mul(smoothstep(uQuad, uQuad.mul(0.84), r)));
            }
        }

        const rgb = min(body, vec3(8.0)).mul(disc).add(haloRGB).toVar();
        const alpha = disc.toVar();

        if (ring) {
            const Rv = uBasis.mul(vec3(1.0, 0.0, 0.0));
            const Uv = uBasis.mul(vec3(0.0, 1.0, 0.0));
            const Tv = uBasis.mul(vec3(0.0, 0.0, 1.0));
            const n = uRingN;
            const nt = dot(Tv, n);
            const ntSafe = nt.add(nt.sign().mul(1e-4)).add(1e-5);
            const z = q.x.mul(dot(Rv, n)).add(q.y.mul(dot(Uv, n))).negate().div(ntSafe);
            const p = Rv.mul(q.x).add(Uv.mul(q.y)).add(Tv.mul(z)).toVar();
            const rd = ringSample(length(p));
            const nL = dot(n, uL1);

            const litFace = step(0.0, nL.mul(nt));
            // Optical depth enters the final premultiplication. Applying it to the ice colour
            // again makes the fine outer rings disappear against the nebula.
            const litTerm = uKeyColor.mul(abs(nL).mul(0.46).add(0.76));
            const thin = rd.a.mul(float(1.0).sub(rd.a)).mul(4.0);
            const forward = f.transmission
                ? pow(clamp(dot(uL2, Tv).negate(), 0.0, 1.0), 3.0).mul(0.75).add(0.35)
                : float(0.45);
            const unlitTerm = uFillColor.mul(forward.mul(0.38).add(0.20)).add(uKeyColor.mul(0.25));

            // Opalescent sapphire-lavender icy ringlets at rest; B2B gilds them gold;
            // Quad / Perfect Clear / Fever sweeps full-spectrum iridescence outward through them.
            const restHue = mix(
                vec3(0.48, 0.68, 0.93),
                vec3(1.0, 0.85, 0.67),
                clamp(rd.irid.mul(0.40).add(rd.t.mul(0.43)), 0.0, 1.0),
            );
            const prismHue = mix(chdNeonHue(fract(rd.t.mul(1.35).sub(uRingFlow))), vec3(1.0), 0.22);
            const ringHue = mix(
                mix(restHue, vec3Of(PLANET_PALETTE.ringGold), clamp(uRingGold, 0.0, 1.0)),
                prismHue,
                uRingPrism,
            );

            // Sunlit ice-crystal micro-sparkles glittering gently along the ring ansa.
            const rAng = atan(dot(p, Rv), dot(p, Tv));
            const glintWave = pow(sin(rAng.mul(22.0).add(uTime.mul(0.9))).mul(0.5).add(0.5), 14.0)
                .mul(pow(cos(rd.t.mul(70.0).sub(uTime.mul(0.4))).mul(0.5).add(0.5), 8.0));
            const iceGlint = vec3(0.9, 0.96, 1.0).mul(glintWave).mul(rd.sparkle).mul(0.65);

            const ringCol = ringHue.mul(mix(unlitTerm, litTerm, litFace))
                .add(prismHue.mul(rd.a.mul(uRingPrism).mul(0.72)))
                .add(vec3Of(PLANET_PALETTE.ringGold).mul(rd.a.mul(uRingGold).mul(0.65)))
                .add(iceGlint)
                .toVar();

            // Planet's crisp shadow cast onto the ring.
            const alongP = dot(p, uL1).toVar();
            const inShadow = step(alongP, 0.0).mul(smoothstep(1.02, 0.96, length(p.sub(uL1.mul(alongP))))).toVar();
            if (f.ringShadows) ringCol.mulAssign(float(1.0).sub(inShadow.mul(0.92)));
            if (f.fronts) {
                ringCol.addAssign(frontLight(dot(p, uFrontAxis)).mul(float(1.0).sub(inShadow.mul(0.95)))
                    .mul(rd.a.mul(0.55).add(thin.mul(0.55))).mul(1.45));
            }
            const ringA = clamp(rd.a.mul(0.95), 0.0, 0.96);
            const ringPremul = ringCol.mul(ringA);
            const inFront = max(step(mu, z), float(1.0).sub(disc));
            const frontRGB = ringPremul.add(rgb.mul(float(1.0).sub(ringA)));
            const frontA = ringA.add(alpha.mul(float(1.0).sub(ringA)));
            const backRGB = rgb.add(ringPremul.mul(float(1.0).sub(alpha)));
            const backA = alpha.add(ringA.mul(float(1.0).sub(alpha)));
            rgb.assign(mix(backRGB, frontRGB, inFront));
            alpha.assign(mix(backA, frontA, inFront));
        }

        return vec4(rgb.mul(uOpacity), alpha.mul(uOpacity));
    })();

    const geometry = new THREE.PlaneGeometry(2, 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.renderOrder = renderOrder;

    const axisQuat = new THREE.Quaternion()
        .setFromAxisAngle(Z_AXIS, axialRoll)
        .multiply(new THREE.Quaternion().setFromAxisAngle(X_AXIS, axialTilt));
    const ringQuat = ring
        ? new THREE.Quaternion()
            .setFromAxisAngle(Z_AXIS, ring.roll ?? 0)
            .multiply(new THREE.Quaternion().setFromAxisAngle(X_AXIS, ring.tilt ?? 0.3))
        : null;
    if (ringQuat) uRingN.value.copy(Y_AXIS).applyQuaternion(ringQuat).normalize();

    const state = {
        spin: spinPhase,
        textureWidth: map?.image?.width || 512,
        get ringTexels() {
            return ring?.map?.image?.width || 512;
        },
    };
    return {
        mesh,
        material,
        uniforms: {
            uRadius,
            uQuad,
            uL1,
            uL2,
            uLod,
            uTime,
            uAlbedo,
            uFillStrength,
            uRimPeak,
            uHaloGain,
            uAuroraBoost,
            uAuroraColor,
            uMoon,
            uEclipse,
            uOpacity,
            uVeil,
            uGradeAmount,
            uRingN,
            uCellLight,
            uRingPrism,
            uRingFlow,
            uRingGold,
        },
        frontValues: uFronts.map(({ a, c }) => ({ a: a.value, c: c.value })),
        extent: ring ? ring.outer : 1,
        hasLightning: f.lightning,
        hasRing: Boolean(ring),
        get radius() {
            return uRadius.value;
        },
        pickSite(rand, out = new THREE.Vector3()) {
            for (let i = 0; i < 16; i++) {
                const rr = 0.86 * Math.sqrt(rand());
                const th = rand() * Math.PI * 2;
                const x = rr * Math.cos(th);
                const y = rr * Math.sin(th);
                out.set(x, y, Math.sqrt(1 - rr * rr)).applyMatrix3(uBasis.value);
                const d = out.dot(uL1.value);
                if (d > -0.7 && d < -0.08) return out.applyMatrix3(uWorldToLocal.value).normalize();
            }
            return null;
        },
        siteToWorld(dir, out = new THREE.Vector3()) {
            _m3.copy(uWorldToLocal.value).transpose();
            return out.copy(dir).applyMatrix3(_m3);
        },
        setCells(cells) {
            const L = uCellLight.value;
            for (let k = 0; k < uCells.length; k++) {
                const c = cells[k];
                const on = c && c.dir && c.light > 0;
                if (on) uCells[k].value.set(c.dir.x, c.dir.y, c.dir.z, Math.max(0.02, c.size));
                L.setComponent(k, on ? c.light : 0);
            }
        },
        setRingPrism(amount, flow, gold = 0) {
            uRingPrism.value = amount;
            uRingFlow.value = flow;
            uRingGold.value = gold;
        },
        setAurora(boost, color = null) {
            uAuroraBoost.value = boost;
            if (color) uAuroraColor.value.copy(color);
        },
        setRadius(r) {
            uRadius.value = r;
        },
        setSpinForTime(t) {
            state.spin = spinPhase + t * spinSpeed;
        },
        update(camera, keyWorld, fillWorld, viewportHeightPx) {
            const c = mesh.position;
            _camPos.setFromMatrixPosition(camera.matrixWorld);
            _T.subVectors(_camPos, c);
            const dist = Math.max(1, _T.length());
            _T.divideScalar(dist);
            _camUp.setFromMatrixColumn(camera.matrixWorld, 1);
            _R.crossVectors(_camUp, _T);
            if (_R.lengthSq() < 1e-8) _R.set(1, 0, 0);
            _R.normalize();
            _U.crossVectors(_T, _R);
            uBasis.value.set(_R.x, _U.x, _T.x, _R.y, _U.y, _T.y, _R.z, _U.z, _T.z);

            _qSpin.setFromAxisAngle(Y_AXIS, state.spin);
            _q.copy(axisQuat).multiply(_qSpin);
            _m4.makeRotationFromQuaternion(_q);
            uWorldToLocal.value.setFromMatrix4(_m4).transpose();

            uL1.value.subVectors(keyWorld, c).normalize();
            if (fillWorld) uL2.value.subVectors(fillWorld, c).normalize();
            const towardEye = Math.max(0, uL1.value.dot(_T));
            uFrontAxis.value.copy(uL1.value).addScaledVector(_T, -1.15 * towardEye).normalize();
            _viewL.copy(uL1.value).transformDirection(camera.matrixWorldInverse);
            _v.set(_viewL.x, _viewL.y, 0);
            if (_v.lengthSq() > 1e-8) _v.normalize();
            uLscreen.value.set(_v.x, _v.y);

            const projScaleY = camera.projectionMatrix.elements[5];
            _cView.copy(c).applyMatrix4(camera.matrixWorldInverse);
            const depth = Math.max(1, -_cView.z);
            const radiusPx = (uRadius.value * 0.5 * viewportHeightPx * projScaleY) / depth;
            uLod.value = Math.max(0, Math.log2(Math.max(1, state.textureWidth / (Math.PI * 2 * Math.max(1, radiusPx)))) + 0.45);
            if (ring) {
                const bandPx = Math.max(1, (ring.outer - ring.inner) * radiusPx);
                uRingLod.value = Math.max(0, Math.log2(Math.max(1, (state.ringTexels * 0.85) / bandPx)) + 0.35);
            }
            return radiusPx;
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
