/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Starlight — Deep Starfield (THE SUBJECT)
 *
 * An instanced billboard starfield — the always-on, fallback-safe canopy.
 * Deliberately NOT a compute dispatch and NOT THREE.Points: it must render on
 * the WebGL2 fallback backend and survive when compute is unavailable, and
 * THREE.Points caps at 1px on WebGPU. Each star is a camera-facing quad whose
 * per-instance data (position-on-shell, temperature, magnitude, twinkle, seed)
 * lives in InstancedBufferAttributes read via TSL `attribute()`.
 *
 * The linchpin anti-shimmer fix (per the masterpiece plan §3 / Perf judge):
 *   - HARD ~1.3px on-screen size floor. Size is computed in PIXELS (world units
 *     per pixel at the star's view depth) so faint stars never go sub-pixel and
 *     scintillate. Faintness lives in BRIGHTNESS/opacity, never in size.
 *   - Soft Gaussian sprite core (no hard edge) → no aliased rims.
 *   - Additive blending + bloom-eligible emissive for the glow.
 *
 * Twinkle is per-star (hashed phase/freq) under a slow global "sky breath"
 * envelope, so the canopy breathes organically instead of blinking uniformly.
 */
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    exp,
    float,
    length,
    mix,
    normalize,
    positionLocal,
    sin,
    smoothstep,
    step,
    uniform,
    vec4,
} from 'three/tsl';
import { blackbodyColor } from '../materials/tsl-noise-lib.js';
import { generateStarCatalog } from '../materials/star-data.js';

export function createDeepStarfield(options = {}) {
    const count = Math.max(1, Math.floor(options.count ?? 30000));
    const catalog = options.catalog || generateStarCatalog(count, options.catalogOpts);

    // ── Uniforms ──
    const uTime = uniform(0);
    const uViewportH = uniform(1080); // drawing-buffer pixel height (for the px floor)
    const uProjScaleY = uniform(1.7); // camera.projectionMatrix[1][1] (focal scale)
    const uSizeBoost = uniform(options.sizeBoost ?? 3.0); // extra px for bright stars
    const uSizeMul = uniform(options.sizeMul ?? 1.0); // global size knob
    const uBrightness = uniform(options.brightness ?? 1.5);
    const uTwAmp = uniform(options.twinkleAmp ?? 0.35);

    // ── Twinkle-WAVE uniforms (event ripple — Phase 1 combo/lock FX) ──
    // A brightening shell that ripples outward from a game-event origin across
    // the screen. Distance is ANGULAR (direction from the camera) so the ripple
    // tracks the event's SCREEN position, not the star's shell depth. Inert until
    // triggered (uWaveTime far in the past, uWaveBoost 0).
    const uWaveOrigin = uniform(new THREE.Vector3(0, 0, -2));
    const uWaveTime = uniform(-100);
    const uWaveSpeed = uniform(1.6); // angular units / second
    const uWaveBoost = uniform(0.0); // brightness amplitude (0 = no wave)
    const uWaveSigma = uniform(30.0); // gaussian sharpness (pulse width)
    const uWaveInvert = uniform(0.0); // 1 = dim-then-rebrighten (T-spin twist)

    // ── Geometry: unit quad, instanced per star, with per-instance attributes ──
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -0.5, -0.5, 0,
        0.5, -0.5, 0,
        0.5, 0.5, 0,
        -0.5, 0.5, 0,
    ], 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute([
        0, 0, 1,
        0, 0, 1,
        0, 0, 1,
        0, 0, 1,
    ], 3));
    geometry.setAttribute('aStarPos', new THREE.InstancedBufferAttribute(catalog.positions, 3));
    geometry.setAttribute('aTemp', new THREE.InstancedBufferAttribute(catalog.temp, 1));
    geometry.setAttribute('aMag', new THREE.InstancedBufferAttribute(catalog.mag, 1));
    geometry.setAttribute('aTwPhase', new THREE.InstancedBufferAttribute(catalog.twPhase, 1));
    geometry.setAttribute('aTwFreq', new THREE.InstancedBufferAttribute(catalog.twFreq, 1));
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(catalog.seed, 1));
    geometry.instanceCount = count;

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    // ── Vertex: billboard with a pixel-space size floor ──
    material.vertexNode = Fn(() => {
        const starPos = attribute('aStarPos', 'vec3');
        const mag = attribute('aMag', 'float');

        // Project center to view space; depth = distance in front of camera.
        const vp = cameraViewMatrix.mul(vec4(starPos, 1.0)).toVar();
        const dist = vp.z.negate().max(float(0.01));

        // World units per on-screen pixel at this depth:
        //   pxHeight = worldSize * (0.5*viewportH*projScaleY) / dist
        // → worldPerPx = dist / (0.5*viewportH*projScaleY)
        const worldPerPx = dist.div(float(0.5).mul(uViewportH).mul(uProjScaleY));
        // Desired on-screen size in PIXELS: 1.3 floor + brightness-scaled boost.
        const px = float(1.3).add(mag.mul(uSizeBoost));
        const size = worldPerPx.mul(px).mul(uSizeMul);

        const off = positionLocal.xy.mul(size);
        vp.x.addAssign(off.x);
        vp.y.addAssign(off.y);
        return cameraProjectionMatrix.mul(vp);
    })();

    // ── Fragment: soft Gaussian core + hero diffraction glints + twinkle ──
    const colorNode = Fn(() => {
        const temp = attribute('aTemp', 'float');
        const mag = attribute('aMag', 'float');
        const twPhase = attribute('aTwPhase', 'float');
        const twFreq = attribute('aTwFreq', 'float');
        const seed = attribute('aSeed', 'float');

        const uvc = positionLocal.xy.toVar();
        const d = length(uvc).mul(2.0);
        const core = exp(d.mul(d).mul(-4.5)); // soft Gaussian disc, no hard edge

        // 4-point diffraction glints — only the brightest ~1.5% of stars.
        const ax = abs(uvc.x);
        const ay = abs(uvc.y);
        const spikeH = smoothstep(0.5, 0.0, ay.mul(7.0)).mul(smoothstep(0.5, 0.0, ax));
        const spikeV = smoothstep(0.5, 0.0, ax.mul(7.0)).mul(smoothstep(0.5, 0.0, ay));
        const hero = step(0.985, seed);
        const spikes = spikeH.add(spikeV).mul(hero).mul(0.5);

        const shape = core.add(spikes);

        // Twinkle: per-star sine under a slow global sky-breath envelope.
        const tw = float(1.0).add(uTwAmp.mul(sin(uTime.mul(twFreq).add(twPhase))));
        const breath = float(0.92).add(float(0.08).mul(sin(uTime.mul(0.05))));
        const lum = mag.mul(tw).mul(breath).mul(uBrightness).toVar();

        // Twinkle-WAVE: a shell of brightness rippling outward from the event
        // origin. Angular distance (direction-from-camera) → screen-space ripple,
        // a gaussian pulse that reaches each star at delay = angDist / speed.
        const starPos = attribute('aStarPos', 'vec3');
        const dStar = normalize(starPos.sub(cameraPosition));
        const dOrigin = normalize(uWaveOrigin.sub(cameraPosition));
        const wavePhase = uTime.sub(uWaveTime).sub(length(dStar.sub(dOrigin)).div(uWaveSpeed));
        const pulse = exp(wavePhase.mul(wavePhase).mul(uWaveSigma.negate()));
        const signed = mix(pulse, pulse.negate(), uWaveInvert);
        lum.mulAssign(float(1.0).add(signed.mul(uWaveBoost)).clamp(0.4, 1.8));

        const rgb = blackbodyColor(temp).mul(lum).mul(shape);
        return vec4(rgb, shape.mul(lum).clamp(0.0, 1.0));
    })();

    material.colorNode = colorNode;
    material.emissiveNode = colorNode.rgb; // bloom samples this (HDR via lum)
    material.userData.emitsBloom = true;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = -100; // behind reactive layers, in front of the sky

    return {
        mesh,
        material,
        uniforms: {
            uTime,
            uViewportH,
            uProjScaleY,
            uSizeBoost,
            uSizeMul,
            uBrightness,
            uTwAmp,
            uWaveOrigin,
            uWaveTime,
            uWaveSpeed,
            uWaveBoost,
            uWaveSigma,
            uWaveInvert,
        },
        /** Push the camera projection params needed for the pixel-size floor. */
        setProjection(viewportHeightPx, projScaleY) {
            if (Number.isFinite(viewportHeightPx) && viewportHeightPx > 0) {
                uViewportH.value = viewportHeightPx;
            }
            if (Number.isFinite(projScaleY) && projScaleY > 0) {
                uProjScaleY.value = projScaleY;
            }
        },
        update(time) {
            uTime.value = time;
        },
        /**
         * Trigger a brightening ripple across the stars from a world-space origin
         * (Phase 1 combo/lock FX). opts: { boost, speed, sigma, invert }.
         */
        triggerWave(origin, opts = {}) {
            if (origin) uWaveOrigin.value.set(origin.x, origin.y, origin.z);
            uWaveTime.value = uTime.value;
            uWaveBoost.value = opts.boost ?? 0.4;
            uWaveSpeed.value = opts.speed ?? 1.6;
            uWaveSigma.value = opts.sigma ?? 30.0;
            uWaveInvert.value = opts.invert ? 1.0 : 0.0;
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
