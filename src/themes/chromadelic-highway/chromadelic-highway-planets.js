/**
 * Chromadelic Highway — analytic planet impostors.
 *
 * Each body is ONE camera-plane quad whose fragment shader reconstructs the sphere:
 *   - always perfectly round (a quad parallel to the image plane has no perspective stretch),
 *   - shaded on a WORLD-space basis built from the camera→centre direction, so the terminator
 *     and the surface never swim when the camera yaws, floats or banks,
 *   - lit by a POINT key light at the highway core behind the card (every lit limb faces the
 *     board) plus a weak cool fill from the binary star, with a rose terminator line, limb
 *     darkening, a hot lit-limb crescent, a never-black night side and an environment rim,
 *   - the atmosphere halo lives in the same quad (no stacked glow planes),
 *   - optional analytic ring system (ray/plane intersection): lit/unlit-face scattering, the
 *     planet's shadow on the ring, the ring's shadow on the planet, front/back compositing,
 *   - hero extras: detail boost, polar hoods, zonal jets, the moon's transit shadow and cyan
 *     storm flashes; the moon turns ember-dark inside the hero's shadow.
 *
 * Compositing: premultiplied output with (One, OneMinusSrcAlpha) CustomBlending and the
 * material's own premultiply OFF: one draw is an opaque disc (alpha 1 hides the stars behind
 * it) and a purely additive halo (alpha 0) at the same time. Fragment-only: runs unchanged on
 * both WebGPURenderer backends.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    asin,
    atan,
    cameraProjectionMatrix,
    clamp,
    dot,
    exp,
    float,
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
import { chdLuma, chdSpectrum } from './chromadelic-highway-tsl.js';

const INV_TAU = 1 / (Math.PI * 2);
const INV_PI = 1 / Math.PI;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const _m4 = new THREE.Matrix4();
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
    key: linear('#ead9ff'),
    fill: linear('#9fd8ff'),
    terminator: linear('#ff5a8a'),
    rimTerminator: linear('#ff8ad8'),
    rimDay: linear('#6cc8ff'),
    heroEnvRim: linear('#b04cff'),
    secondaryEnvRim: linear('#4fd8ff'),
    voidHorizon: linear('#160a2c'),
    polarHood: linear('#2a1850'),
    storm: linear('#bffbff'),
});

/**
 * @param {object} opts
 * @param {THREE.Texture} opts.map          equirectangular surface texture
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
 * @param {number} [opts.night=1]           night-side level (the hero keeps ≤ 0.025 so its disc
 *                                          silhouettes against the nebula behind it)
 * @param {boolean} [opts.equalize=false]   equalise band luminance (a latitude-banded rainbow
 *                                          texture would otherwise read yellow-lime)
 * @param {number} [opts.axialTilt=0.3]     radians toward the camera
 * @param {number} [opts.axialRoll=0]       radians in the view plane
 * @param {number} [opts.spinSpeed=0.012]   radians per second (closed form in t)
 * @param {object} [opts.features]          { fill, detail, polarHood, zonal, storms, moonShadow,
 *                                            eclipse, ringShadows, transmission }
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
        polarHood: false,
        zonal: false,
        storms: false,
        moonShadow: false,
        eclipse: false,
        ringShadows: false,
        transmission: false,
        halo: haloGain > 0,
        rim: rimPeak > 0,
        ...features,
    };

    const uRadius = uniform(radius);
    const uQuad = uniform(Math.max(quad, ring ? ring.outer * 1.02 : 1.02));
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
    const uFillStrength = uniform(f.fill ? 0.22 : 0);
    const uRimPeak = uniform(rimPeak);
    const uEnvRim = uniform(new THREE.Color().copy(envRimColor).multiplyScalar(envRim));
    const uVeilColor = uniform(new THREE.Color().copy(veilColor));
    const uVeil = uniform(veil);
    const uHaloGain = uniform(haloGain);
    const uFlash = uniform(0);
    const uMoon = uniform(new THREE.Vector4(0, 0, 50, 0.1)); // offset / R (far away) , m
    const uEclipse = uniform(new THREE.Vector4(0, 0, 50, 5)); // hero centre in moon radii, R_h/R_m
    const uEclipseTint = uniform(new THREE.Color(0.2, 0.03, 0.14));
    const uRingN = uniform(new THREE.Vector3(0, 1, 0));
    const uRingLod = uniform(4); // explicit: the 2048-texel strip spans only ~40 px on screen
    const uOpacity = uniform(1);
    const uGradeAmount = uniform(grade?.amount ?? 0);
    const uGradeGain = uniform(grade?.gain ?? 1); // lifts dark source textures into the ramp
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

    const ringDensity = (rho) => {
        const t = rho.sub(ring.inner).div(ring.outer - ring.inner);
        const inside = step(0.0, t).mul(step(t, 1.0));
        return { t, a: texture(ring.map, vec2(clamp(t, 0.0, 1.0), 0.5)).level(uRingLod).a.mul(inside) };
    };

    material.colorNode = Fn(() => {
        // Derivatives first (uniform control flow).
        const q = positionLocal.xy.mul(uQuad).toVar();
        const r = length(q);
        const aa = max(fwidth(r), float(0.0005));
        const disc = smoothstep(float(1.0).add(aa), float(1.0).sub(aa), r);
        const mu = sqrt(max(float(1.0).sub(r.mul(r)), 0.0));
        const N = normalize(uBasis.mul(vec3(q.x, q.y, mu))).toVar();
        const Nl = uWorldToLocal.mul(N);

        // Surface albedo (explicit LOD: the atan seam has no derivatives).
        const lat = asin(clamp(Nl.y, -1.0, 1.0));
        let uE = atan(Nl.x, Nl.z).mul(INV_TAU).add(0.5);
        if (f.zonal) uE = uE.add(uTime.mul(0.0035).mul(sin(lat.mul(14.0)).mul(0.6).add(1.0)));
        const uvE = vec2(uE, lat.mul(INV_PI).add(0.5));
        const T0 = texture(map, uvE).level(uLod);
        const A0 = T0.rgb;
        let A = A0;
        // Coarse tap (3 mips up): the band colour without its fine detail.
        const Alow = f.detail ? T0.level(uLod.add(3.0)).rgb : A0;
        if (f.detail) A = max(A.add(A.sub(Alow).mul(0.35)), vec3(0.0));
        if (equalize) {
            // Balance the bands (the yellow ones are 5–8x brighter than the violet ones) from the
            // coarse tap, so the fine detail keeps its contrast; then a pastel body — full
            // saturation is left to the rim and the crescent.
            A = A.mul(clamp(pow(float(0.3).div(max(chdLuma(Alow), 0.02)), 0.5), 0.6, 2.0));
            A = mix(vec3(chdLuma(A)), A, 0.85);
        }
        if (grade) {
            const lum = chdLuma(A0).mul(uGradeGain);
            const g = mix(mix(uGradeLow, uGradeMid, smoothstep(0.0, 0.5, lum)), uGradeHigh, smoothstep(0.5, 1.0, lum));
            A = mix(A0, g, uGradeAmount);
        }
        if (f.polarHood) {
            A = mix(
                A,
                vec3(PLANET_PALETTE.polarHood.r, PLANET_PALETTE.polarHood.g, PLANET_PALETTE.polarHood.b),
                smoothstep(0.72, 0.92, abs(lat).mul(2.0 * INV_PI)).mul(0.55),
            );
        }

        // Key (point light at the highway core) + cool binary fill.
        const d1 = dot(N, uL1);
        const lit1 = smoothstep(-0.06, 0.22, d1);
        let shade = float(1.0);
        if (f.moonShadow) {
            const toM = uMoon.xyz.sub(N);
            const along = dot(toM, uL1);
            const perp = length(toM.sub(uL1.mul(along)));
            const m = uMoon.w;
            shade = shade.mul(float(1.0).sub(float(1.0).sub(smoothstep(m.mul(0.7), m.mul(1.25), perp))
                .mul(step(0.0, along)).mul(0.85)));
        }
        if (ring && f.ringShadows) {
            const nL = dot(uL1, uRingN);
            const s = dot(N, uRingN).negate().div(nL.add(nL.sign().mul(1e-4)).add(1e-5));
            const hit = N.add(uL1.mul(s));
            shade = shade.mul(float(1.0).sub(ringDensity(length(hit)).a.mul(step(0.0, s)).mul(0.7)));
        }
        let keyLight = uKeyColor.mul(lit1);
        if (f.fill) keyLight = keyLight.add(uFillColor.mul(uFillStrength).mul(smoothstep(-0.05, 0.4, dot(N, uL2))));
        let day = A.mul(uAlbedo).mul(keyLight).mul(sqrt(mu).mul(0.45).add(0.55)).mul(shade);
        if (f.eclipse) {
            // Moon: from each surface point toward the key, against the hero sphere.
            const toC = uEclipse.xyz.sub(N);
            const along = dot(toC, uL1);
            const perp = length(toC.sub(uL1.mul(along)));
            const ecl = float(1.0).sub(smoothstep(uEclipse.w.mul(0.92), uEclipse.w.mul(1.08), perp)).mul(step(0.0, along));
            day = mix(day, A.mul(uEclipseTint).mul(0.6), ecl);
        }
        const night = A.mul(vec3(0.05, 0.055, 0.13)).add(vec3(0.008, 0.008, 0.022)).mul(nightLevel);
        const surf = night.mul(float(1.0).sub(lit1)).add(day).toVar();
        // A thin rose sunset line just inside the terminator.
        surf.addAssign(vec3(PLANET_PALETTE.terminator.r, PLANET_PALETTE.terminator.g, PLANET_PALETTE.terminator.b)
            .mul(0.08).mul(smoothstep(-0.07, -0.02, d1)).mul(smoothstep(0.05, 0.0, d1)));
        if (f.rim) {
            const limb = float(1.0).sub(mu);
            const rimCol = mix(
                vec3(PLANET_PALETTE.rimTerminator.r, PLANET_PALETTE.rimTerminator.g, PLANET_PALETTE.rimTerminator.b),
                vec3(PLANET_PALETTE.rimDay.r, PLANET_PALETTE.rimDay.g, PLANET_PALETTE.rimDay.b),
                smoothstep(0.1, 0.6, d1),
            );
            surf.addAssign(rimCol.mul(pow(limb, 5.0)).mul(lit1).mul(uRimPeak));
            surf.addAssign(uEnvRim.mul(pow(limb, 6.0)).mul(float(1.0).sub(lit1)));
        }
        if (f.storms) {
            const detail = smoothstep(0.05, 0.12, chdLuma(max(A0.sub(Alow), vec3(0.0))));
            surf.addAssign(vec3(PLANET_PALETTE.storm.r, PLANET_PALETTE.storm.g, PLANET_PALETTE.storm.b)
                .mul(uFlash.mul(detail).mul(float(1.0).sub(lit1)).mul(1.6)));
        }
        const body = mix(surf, uVeilColor, uVeil);

        // Halo: light-side biased, zero before the quad edge.
        let haloRGB = vec3(0.0);
        if (f.halo) {
            const h = max(r.sub(1.0), 0.0);
            const sunSide = clamp(dot(q.div(max(r, 1e-4)), uLscreen).mul(0.5).add(0.5), 0.0, 1.0);
            const halo = exp(h.mul(-9.0)).mul(mix(float(0.25), float(1.0), sunSide)).mul(uHaloGain)
                .mul(float(1.0).sub(disc))
                .mul(smoothstep(uQuad, uQuad.mul(0.85), r));
            haloRGB = mix(uEnvRim, vec3(PLANET_PALETTE.rimDay.r, PLANET_PALETTE.rimDay.g, PLANET_PALETTE.rimDay.b), sunSide)
                .mul(halo);
        }

        const rgb = min(body, vec3(8.0)).mul(disc).add(haloRGB).toVar();
        const alpha = disc.toVar();

        if (ring) {
            // Orthographic ray along -T through the quad point, against the ring plane.
            const Rv = uBasis.mul(vec3(1.0, 0.0, 0.0));
            const Uv = uBasis.mul(vec3(0.0, 1.0, 0.0));
            const Tv = uBasis.mul(vec3(0.0, 0.0, 1.0));
            const n = uRingN;
            const nt = dot(Tv, n);
            const ntSafe = nt.add(nt.sign().mul(1e-4)).add(1e-5);
            const z = q.x.mul(dot(Rv, n)).add(q.y.mul(dot(Uv, n))).negate().div(ntSafe);
            const p = Rv.mul(q.x).add(Uv.mul(q.y)).add(Tv.mul(z));
            const rd = ringDensity(length(p));
            const nL = dot(n, uL1);
            // Lit face: the key light. Unlit face (what the camera sees here): the thin ringlets
            // glow with the binary's light scattered forward through them (the binary sits far
            // behind the planet).
            const litFace = step(0.0, nL.mul(nt));
            const litTerm = uKeyColor.mul(rd.a.mul(abs(nL).mul(0.55).add(0.45)).mul(0.35));
            const thin = rd.a.mul(float(1.0).sub(rd.a)).mul(4.0);
            const forward = f.transmission ? pow(clamp(dot(uL2, Tv).negate(), 0.0, 1.0), 3.0).mul(0.65).add(0.35) : float(0.35);
            const unlitTerm = uFillColor.mul(thin.mul(forward).mul(0.32));
            // One pale lavender with ±15° of iridescence across the system.
            const ringHue = mix(chdSpectrum(sin(rd.t.mul(9.42)).mul(0.042).add(0.27)), vec3(1.0), 0.62);
            let ringCol = ringHue.mul(mix(unlitTerm, litTerm, litFace));
            if (f.ringShadows) {
                const alongP = dot(p, uL1);
                const perpP = length(p.sub(uL1.mul(alongP)));
                ringCol = ringCol.mul(float(1.0).sub(step(alongP, 0.0).mul(smoothstep(1.02, 0.97, perpP)).mul(0.9)));
            }
            const ringA = rd.a.mul(0.92);
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

    // Spin-axis basis: tilt toward the camera (about world x), then roll in the view plane.
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
        textureWidth: map?.image?.width || 2048,
        get ringTexels() {
            return ring?.map?.image?.width || 2048;
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
            uFlash,
            uMoon,
            uEclipse,
            uOpacity,
            uVeil,
            uGradeAmount,
            uRingN,
        },
        get radius() {
            return uRadius.value;
        },
        setRadius(r) {
            uRadius.value = r;
        },
        /** Closed-form spin for time t. */
        setSpinForTime(t) {
            state.spin = spinPhase + t * spinSpeed;
        },
        /**
         * Per frame, after the camera moved: world basis, spin, lights and texture LOD.
         * @param {THREE.Camera} camera
         * @param {THREE.Vector3} keyWorld   the key light position (highway core)
         * @param {THREE.Vector3|null} fillWorld  the binary star position
         * @param {number} viewportHeightPx
         */
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
            _viewL.copy(uL1.value).transformDirection(camera.matrixWorldInverse);
            _v.set(_viewL.x, _viewL.y, 0);
            if (_v.lengthSq() > 1e-8) _v.normalize();
            uLscreen.value.set(_v.x, _v.y);

            // The quad is projected at the centre's VIEW depth (not its distance): off-axis bodies
            // are 15–20% bigger on screen than radius/dist says.
            const projScaleY = camera.projectionMatrix.elements[5];
            _cView.copy(c).applyMatrix4(camera.matrixWorldInverse);
            const depth = Math.max(1, -_cView.z);
            const radiusPx = (uRadius.value * 0.5 * viewportHeightPx * projScaleY) / depth;
            uLod.value = Math.log2(Math.max(1, state.textureWidth / (Math.PI * 2 * Math.max(1, radiusPx)))) + 0.6;
            if (ring) {
                const bandPx = Math.max(1, (ring.outer - ring.inner) * radiusPx);
                uRingLod.value = Math.max(0, Math.log2((state.ringTexels * 0.9) / bandPx) + 0.75);
            }
            return radiusPx;
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
